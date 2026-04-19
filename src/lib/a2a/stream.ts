/**
 * A2A SSE streaming for SendStreamingMessage + SubscribeToTask (spec Section
 * 3.1.2, 3.1.6). Source of truth is the existing `agent_events` collection
 * — same one drained by /api/agents/me/events. We don't flip deliveredAt
 * here so the two transports stay idempotent.
 *
 * Design is Hobby-safe: each open SSE connection terminates gracefully
 * before Vercel's function-timeout kills it. Clients are expected to
 * reconnect using `Last-Event-ID`.
 */

import { ObjectId, type Db, type WithId } from "mongodb";
import type { DealDoc, ListingDoc } from "@/types/datax";
import type { AgentEventDoc } from "@/lib/notify";
import {
  buildTaskStatus,
  dealToTask,
  taskArtifactUpdateEvent,
  taskStatusUpdateEvent,
} from "./mapping";
import type {
  A2AStreamResponse,
  A2ATask,
  A2ATaskArtifactUpdateEvent,
  A2ATaskStatusUpdateEvent,
} from "./types";
import { TERMINAL_TASK_STATES } from "./types";
import { getSsePollMs, getSseStreamTtlMs } from "./env";
import {
  JsonRpcError,
  JSON_RPC_ERROR,
  taskNotFound,
  unsupportedOperation,
} from "./errors";
import {
  assertAgentCanReadDeal,
  handleSendMessage,
  loadDeal,
} from "./handlers";
import type { HandlerContext } from "./handlers";

const KEEPALIVE_INTERVAL_MS = 15_000;
const CLOSE_GRACE_MS = 5_000;

export type StreamResult =
  | { kind: "sse"; response: Response }
  | { kind: "json"; result: { task?: A2ATask; message?: import("./types").A2AMessage } };

type SseController = ReadableStreamDefaultController<Uint8Array>;

function sseWrite(
  controller: SseController,
  event: { id?: string; event?: string; data?: string; retry?: number; comment?: string }
) {
  const lines: string[] = [];
  if (event.comment) lines.push(`: ${event.comment}`);
  if (event.id) lines.push(`id: ${event.id}`);
  if (event.event) lines.push(`event: ${event.event}`);
  if (event.retry != null) lines.push(`retry: ${event.retry}`);
  if (event.data != null) {
    for (const dataLine of event.data.split("\n")) {
      lines.push(`data: ${dataLine}`);
    }
  }
  lines.push("", ""); // end of event
  controller.enqueue(new TextEncoder().encode(lines.join("\n")));
}

function sseData(
  controller: SseController,
  id: string | undefined,
  payload: A2AStreamResponse
) {
  sseWrite(controller, { id, data: JSON.stringify(payload) });
}

function parseLastEventIdObjectId(
  raw: string | null | undefined
): ObjectId | null {
  if (!raw) return null;
  const trimmed = raw.trim();
  if (!trimmed) return null;
  if (!ObjectId.isValid(trimmed)) return null;
  return new ObjectId(trimmed);
}

async function eventDocToStreamItem(
  db: Db,
  doc: WithId<AgentEventDoc>,
  baseUrl: string
): Promise<{ payload: A2AStreamResponse; id: string } | null> {
  if (doc.event !== "deal_updated") return null;
  if (!ObjectId.isValid(doc.dealId)) return null;
  const deal = await db
    .collection<DealDoc>("deals")
    .findOne({ _id: new ObjectId(doc.dealId) });
  if (!deal) return null;

  // Released → emit artifactUpdate + final statusUpdate. For other states,
  // a single statusUpdate suffices.
  const id = doc._id.toHexString();

  if (deal.status === "released") {
    const listing = await db
      .collection<ListingDoc>("listings")
      .findOne({ _id: deal.listingId });
    const art: A2ATaskArtifactUpdateEvent | null = taskArtifactUpdateEvent(
      deal,
      listing,
      baseUrl
    );
    if (art) {
      return { id, payload: { artifactUpdate: art } };
    }
  }

  const statusUpdate: A2ATaskStatusUpdateEvent = taskStatusUpdateEvent(deal);
  return { id, payload: { statusUpdate } };
}

type StreamParams = {
  taskId: string;
  lastEventId?: string | null;
};

async function runTaskStream(
  ctx: HandlerContext,
  params: StreamParams,
  abortSignal: AbortSignal,
  opts: { emitInitialTask: boolean }
): Promise<Response> {
  const deal = await loadDeal(ctx.db, params.taskId);
  assertAgentCanReadDeal(ctx.agent, deal);

  const pollMs = getSsePollMs();
  const ttlMs = getSseStreamTtlMs();

  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      const startedAt = Date.now();
      let cursor: ObjectId | null = parseLastEventIdObjectId(params.lastEventId ?? null);
      let closed = false;

      const close = (reason: "ttl" | "terminal" | "abort") => {
        if (closed) return;
        closed = true;
        try {
          sseWrite(controller, {
            event: "close",
            retry: 3000,
            data: JSON.stringify({ reason }),
          });
        } catch {
          /* ignore */
        }
        try {
          controller.close();
        } catch {
          /* already closed */
        }
      };

      abortSignal.addEventListener("abort", () => close("abort"));

      // Initial snapshot (always for SubscribeToTask; for SendStreamingMessage
      // we include the Task so the client gets the initial state too).
      if (opts.emitInitialTask) {
        const initialTask = await dealToTask(ctx.db, deal, ctx.baseUrl);
        sseData(controller, undefined, { task: initialTask });
      }

      // Replay missed events, then live-tail until terminal or TTL.
      const keepaliveTimer = setInterval(() => {
        if (closed) return;
        try {
          sseWrite(controller, { comment: "ka" });
        } catch {
          /* ignore */
        }
      }, KEEPALIVE_INTERVAL_MS);

      async function pollOnce(): Promise<"terminal" | "continue"> {
        const filter: Record<string, unknown> = {
          agentId: ctx.agent._id,
          dealId: params.taskId,
        };
        if (cursor) filter._id = { $gt: cursor };
        const rows = await ctx.db
          .collection<AgentEventDoc>("agent_events")
          .find(filter)
          .sort({ _id: 1 })
          .limit(50)
          .toArray();

        for (const row of rows) {
          const item = await eventDocToStreamItem(ctx.db, row, ctx.baseUrl);
          if (item) {
            sseData(controller, item.id, item.payload);
          }
          cursor = row._id;
        }

        // If the current deal is terminal, close the stream.
        const fresh = await ctx.db
          .collection<DealDoc>("deals")
          .findOne({ _id: deal._id });
        if (fresh) {
          const state = buildTaskStatus(fresh).state;
          if ((TERMINAL_TASK_STATES as readonly string[]).includes(state)) {
            return "terminal";
          }
        }
        return "continue";
      }

      try {
        while (!closed) {
          const result = await pollOnce();
          if (result === "terminal") {
            close("terminal");
            break;
          }
          const elapsed = Date.now() - startedAt;
          if (elapsed >= ttlMs - CLOSE_GRACE_MS) {
            close("ttl");
            break;
          }
          const sleep = Math.min(pollMs, ttlMs - CLOSE_GRACE_MS - elapsed);
          if (sleep <= 0) {
            close("ttl");
            break;
          }
          await new Promise<void>((resolve) => {
            const t = setTimeout(resolve, sleep);
            abortSignal.addEventListener(
              "abort",
              () => {
                clearTimeout(t);
                resolve();
              },
              { once: true }
            );
          });
        }
      } catch (e) {
        console.error("[a2a/stream] poll loop error:", e);
        close("abort");
      } finally {
        clearInterval(keepaliveTimer);
      }
    },
  });

  return new Response(stream, {
    status: 200,
    headers: {
      "Content-Type": "text/event-stream; charset=utf-8",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
      "X-Accel-Buffering": "no",
    },
  });
}

/* ========================= SendStreamingMessage ========================= */

/**
 * SendStreamingMessage: executes the action (same logic as SendMessage) and
 * then streams updates. For message-only results (e.g. search) the stream
 * contains exactly one `message` payload and closes.
 *
 * For task results we open a live stream rooted at the new task id.
 */
export async function handleSendStreamingMessage(
  ctx: HandlerContext,
  rawParams: unknown,
  abortSignal: AbortSignal,
  lastEventId: string | null
): Promise<Response> {
  const initial = await handleSendMessage(ctx, rawParams);

  if (initial.message && !initial.task) {
    const stream = new ReadableStream<Uint8Array>({
      start(controller) {
        sseData(controller, undefined, { message: initial.message! });
        sseWrite(controller, {
          event: "close",
          retry: 3000,
          data: JSON.stringify({ reason: "message-complete" }),
        });
        controller.close();
      },
    });
    return new Response(stream, {
      status: 200,
      headers: {
        "Content-Type": "text/event-stream; charset=utf-8",
        "Cache-Control": "no-cache, no-transform",
        Connection: "keep-alive",
        "X-Accel-Buffering": "no",
      },
    });
  }

  if (!initial.task) {
    throw new JsonRpcError(
      JSON_RPC_ERROR.InternalError,
      "Handler did not return a Task or Message"
    );
  }
  return runTaskStream(
    ctx,
    { taskId: initial.task.id, lastEventId },
    abortSignal,
    { emitInitialTask: false /* initial task already came from SendMessage result */ }
  );
}

/* ========================= SubscribeToTask ========================= */

export async function handleSubscribeToTask(
  ctx: HandlerContext,
  rawParams: unknown,
  abortSignal: AbortSignal,
  lastEventId: string | null
): Promise<Response> {
  if (!rawParams || typeof rawParams !== "object" || Array.isArray(rawParams)) {
    throw new JsonRpcError(
      JSON_RPC_ERROR.InvalidParams,
      "Params for SubscribeToTask must be an object"
    );
  }
  const params = rawParams as Record<string, unknown>;
  const id = typeof params.id === "string" ? params.id.trim() : "";
  if (!id) {
    throw new JsonRpcError(JSON_RPC_ERROR.InvalidParams, "`id` is required");
  }
  const deal = await loadDeal(ctx.db, id);
  assertAgentCanReadDeal(ctx.agent, deal);
  const state = buildTaskStatus(deal).state;
  if ((TERMINAL_TASK_STATES as readonly string[]).includes(state)) {
    throw unsupportedOperation(
      `Task ${id} is already in terminal state ${state}. Use GetTask instead.`,
      { id, state }
    );
  }

  const paramLast =
    typeof params.lastEventId === "string" && params.lastEventId.trim()
      ? params.lastEventId.trim()
      : null;
  return runTaskStream(
    ctx,
    { taskId: id, lastEventId: lastEventId ?? paramLast },
    abortSignal,
    { emitInitialTask: true }
  );
}

export { taskNotFound };
