/**
 * A2A v1.0 JSON-RPC method handlers (spec Sections 3.1.1 – 3.1.10, 5.3).
 *
 * All handlers receive a resolved authenticated agent (via the dispatcher)
 * and delegate to the shared deal state machine in src/lib/deal-actions.ts.
 *
 * The methods implemented here are the unary ones that return a JSON result.
 * Streaming methods (SendStreamingMessage, SubscribeToTask) and push-config
 * CRUD live in separate files because they have different transports
 * (SSE, DB-only CRUD).
 */

import { ObjectId } from "mongodb";
import type { Db } from "mongodb";
import type { AgentDoc, DealDoc, DealStatus, ListingDoc } from "@/types/datax";
import { DEAL_STATUSES } from "@/types/datax";
import { rankListings } from "@/lib/deals";
import { buildSearchClause, toListingPreview } from "@/lib/listings";
import {
  DealActionError,
  buyerAcceptCounter,
  buyerCounter,
  buyerRejectCounter,
  buyerSent,
  cancelDealAsCaller,
  createDealFromListing,
  sellerAccept,
  sellerCounter,
  sellerReceived,
  sellerReject,
} from "@/lib/deal-actions";
import type { A2AMessage, A2ATask, TaskState } from "./types";
import {
  dealStatusToTaskState,
  dealToTask,
  extractDataPart,
  newServerMessageId,
} from "./mapping";
import {
  JsonRpcError,
  JSON_RPC_ERROR,
  taskNotCancelable,
  taskNotFound,
  unsupportedOperation,
} from "./errors";

export type HandlerContext = {
  db: Db;
  agent: AgentDoc;
  baseUrl: string;
};

function requireObject(params: unknown, method: string): Record<string, unknown> {
  if (!params || typeof params !== "object" || Array.isArray(params)) {
    throw new JsonRpcError(JSON_RPC_ERROR.InvalidParams, `Params for ${method} must be an object`);
  }
  return params as Record<string, unknown>;
}

function extractMessage(params: Record<string, unknown>): A2AMessage {
  const m = params.message;
  if (!m || typeof m !== "object" || Array.isArray(m)) {
    throw new JsonRpcError(JSON_RPC_ERROR.InvalidParams, "`message` is required");
  }
  const msg = m as Record<string, unknown>;
  if (!Array.isArray(msg.parts)) {
    throw new JsonRpcError(JSON_RPC_ERROR.InvalidParams, "`message.parts` must be an array");
  }
  if (typeof msg.role !== "string") {
    throw new JsonRpcError(JSON_RPC_ERROR.InvalidParams, "`message.role` is required");
  }
  if (typeof msg.messageId !== "string") {
    // Be lenient; generate one if missing.
    msg.messageId = newServerMessageId("client");
  }
  return msg as unknown as A2AMessage;
}

async function dealActionToTask(
  ctx: HandlerContext,
  deal: DealDoc,
  opts: { historyLength?: number; includeArtifacts?: boolean } = {}
): Promise<A2ATask> {
  return dealToTask(ctx.db, deal, ctx.baseUrl, opts);
}

function translateDealError(e: unknown): JsonRpcError {
  if (e instanceof JsonRpcError) return e;
  if (e instanceof DealActionError) {
    if (e.code === "TaskNotCancelable") return taskNotCancelable("?", e.message);
    if (e.status === 404) return taskNotFound(e.message);
    if (e.status === 403) return unsupportedOperation(e.message);
    return new JsonRpcError(JSON_RPC_ERROR.InvalidParams, e.message);
  }
  if (e instanceof Error) {
    return new JsonRpcError(JSON_RPC_ERROR.InternalError, e.message);
  }
  return new JsonRpcError(JSON_RPC_ERROR.InternalError, "Unknown error");
}

/* ========================= SendMessage ========================= */

export async function handleSendMessage(
  ctx: HandlerContext,
  rawParams: unknown
): Promise<{ task?: A2ATask; message?: A2AMessage }> {
  const params = requireObject(rawParams, "SendMessage");
  const message = extractMessage(params);
  const config = (params.configuration as Record<string, unknown> | undefined) ?? {};
  const historyLength =
    typeof config.historyLength === "number" ? config.historyLength : undefined;

  const data = extractDataPart(message);
  if (!data || typeof data.action !== "string") {
    throw new JsonRpcError(
      JSON_RPC_ERROR.InvalidParams,
      'message.parts must include a data part with an "action" field. Supported actions: propose, accept, reject, counter, buyer-sent, seller-received, search.'
    );
  }
  const action = data.action;

  try {
    switch (action) {
      case "search": {
        const query = typeof data.query === "string" ? data.query : "";
        const region = typeof data.region === "string" ? data.region : undefined;
        if (!query.trim() && !region?.trim()) {
          throw new JsonRpcError(
            JSON_RPC_ERROR.InvalidParams,
            'Provide "query" and/or "region" for the search action.'
          );
        }
        const filter = buildSearchClause(query, region);
        const pool = await ctx.db
          .collection<ListingDoc>("listings")
          .find(filter)
          .sort({ createdAt: -1 })
          .limit(80)
          .toArray();
        const top = rankListings(pool, query, region, 8);
        const responseMessage: A2AMessage = {
          messageId: newServerMessageId("search"),
          role: "ROLE_AGENT",
          parts: [
            {
              text:
                top.length === 0
                  ? "No listings matched. Try broader terms or another region."
                  : `Found ${top.length} listing${top.length === 1 ? "" : "s"} (ranked by relevance).`,
            },
            {
              data: {
                results: top.map((d) => ({ ...toListingPreview(d), listingId: d._id.toHexString() })),
              },
            },
          ],
        };
        return { message: responseMessage };
      }

      case "propose": {
        if (ctx.agent.role !== "buyer") {
          throw unsupportedOperation("Only buyers can propose deals");
        }
        const listingId = typeof data.listingId === "string" ? data.listingId : null;
        if (!listingId) {
          throw new JsonRpcError(JSON_RPC_ERROR.InvalidParams, "`listingId` is required");
        }
        const proposedAmount =
          typeof data.proposedAmount === "string" ? data.proposedAmount : undefined;
        const proposedCurrency =
          typeof data.proposedCurrency === "string" ? data.proposedCurrency : undefined;

        const { deal } = await createDealFromListing(ctx.db, ctx.agent, listingId, {
          proposedAmount,
          proposedCurrency,
        });
        return { task: await dealActionToTask(ctx, deal, { historyLength }) };
      }

      case "accept": {
        const taskId = taskIdFromMessage(message);
        const existing = await loadDeal(ctx.db, taskId);
        const { deal } = ctx.agent._id.equals(existing.sellerAgentId)
          ? await sellerAccept(ctx.db, ctx.agent, taskId)
          : await buyerAcceptCounter(ctx.db, ctx.agent, taskId);
        return { task: await dealActionToTask(ctx, deal, { historyLength }) };
      }

      case "reject": {
        const taskId = taskIdFromMessage(message);
        const existing = await loadDeal(ctx.db, taskId);
        const deal = ctx.agent._id.equals(existing.sellerAgentId)
          ? await sellerReject(ctx.db, ctx.agent, taskId)
          : await buyerRejectCounter(ctx.db, ctx.agent, taskId);
        return { task: await dealActionToTask(ctx, deal, { historyLength }) };
      }

      case "counter": {
        const taskId = taskIdFromMessage(message);
        const input = {
          counterAmount: data.counterAmount,
          counterCurrency: data.counterCurrency,
        };
        const existing = await loadDeal(ctx.db, taskId);
        const deal = ctx.agent._id.equals(existing.sellerAgentId)
          ? await sellerCounter(ctx.db, ctx.agent, taskId, input)
          : await buyerCounter(ctx.db, ctx.agent, taskId, input);
        return { task: await dealActionToTask(ctx, deal, { historyLength }) };
      }

      case "buyer-sent": {
        const taskId = taskIdFromMessage(message);
        const deal = await buyerSent(ctx.db, ctx.agent, taskId);
        return { task: await dealActionToTask(ctx, deal, { historyLength }) };
      }

      case "seller-received": {
        const taskId = taskIdFromMessage(message);
        const deal = await sellerReceived(ctx.db, ctx.agent, taskId);
        return { task: await dealActionToTask(ctx, deal, { historyLength }) };
      }

      default:
        throw new JsonRpcError(
          JSON_RPC_ERROR.InvalidParams,
          `Unknown action "${action}". Supported: propose, accept, reject, counter, buyer-sent, seller-received, search.`
        );
    }
  } catch (e) {
    throw translateDealError(e);
  }
}

function taskIdFromMessage(msg: A2AMessage): string {
  if (typeof msg.taskId === "string" && msg.taskId.trim()) return msg.taskId.trim();
  throw new JsonRpcError(
    JSON_RPC_ERROR.InvalidParams,
    "message.taskId is required for this action"
  );
}

async function loadDeal(db: Db, taskId: string): Promise<DealDoc> {
  if (!ObjectId.isValid(taskId)) throw taskNotFound(taskId);
  const deal = await db
    .collection<DealDoc>("deals")
    .findOne({ _id: new ObjectId(taskId) });
  if (!deal) throw taskNotFound(taskId);
  return deal;
}

function assertAgentCanReadDeal(agent: AgentDoc, deal: DealDoc): void {
  if (!agent._id.equals(deal.buyerAgentId) && !agent._id.equals(deal.sellerAgentId)) {
    throw taskNotFound(deal._id.toHexString());
  }
}

/* ========================= GetTask ========================= */

export async function handleGetTask(
  ctx: HandlerContext,
  rawParams: unknown
): Promise<A2ATask> {
  const params = requireObject(rawParams, "GetTask");
  const id = typeof params.id === "string" ? params.id.trim() : "";
  if (!id) throw new JsonRpcError(JSON_RPC_ERROR.InvalidParams, "`id` is required");
  const deal = await loadDeal(ctx.db, id);
  assertAgentCanReadDeal(ctx.agent, deal);
  const historyLength =
    typeof params.historyLength === "number" ? params.historyLength : undefined;
  return dealActionToTask(ctx, deal, { historyLength });
}

/* ========================= ListTasks ========================= */

type ListTasksPageToken = { t?: number; id?: string };

function encodePageToken(token: ListTasksPageToken): string {
  return Buffer.from(JSON.stringify(token), "utf8").toString("base64url");
}

function decodePageToken(raw: string | undefined | null): ListTasksPageToken | null {
  if (!raw) return null;
  try {
    const decoded = Buffer.from(raw, "base64url").toString("utf8");
    const parsed = JSON.parse(decoded);
    if (parsed && typeof parsed === "object") return parsed as ListTasksPageToken;
  } catch {
    /* fall through */
  }
  return null;
}

const TASK_STATE_TO_DEAL_STATUSES: Record<TaskState, DealStatus[]> = {
  TASK_STATE_UNSPECIFIED: [],
  TASK_STATE_SUBMITTED: [],
  TASK_STATE_WORKING: ["awaiting_payment", "buyer_marked_sent"],
  TASK_STATE_INPUT_REQUIRED: [
    "offer_pending",
    "seller_counter_pending",
    "buyer_counter_pending",
  ],
  TASK_STATE_AUTH_REQUIRED: [],
  TASK_STATE_COMPLETED: ["released"],
  TASK_STATE_FAILED: [],
  TASK_STATE_CANCELED: [],
  TASK_STATE_REJECTED: ["offer_rejected"],
};

export async function handleListTasks(
  ctx: HandlerContext,
  rawParams: unknown
): Promise<{ tasks: A2ATask[]; nextPageToken: string; pageSize: number; totalSize: number }> {
  const params = requireObject(rawParams ?? {}, "ListTasks");
  const pageSizeRaw =
    typeof params.pageSize === "number" ? params.pageSize : 50;
  const pageSize = Math.min(Math.max(1, Math.trunc(pageSizeRaw)), 100);
  const pageTokenRaw = typeof params.pageToken === "string" ? params.pageToken : null;
  const cursor = decodePageToken(pageTokenRaw);
  const historyLength =
    typeof params.historyLength === "number" ? params.historyLength : undefined;
  const includeArtifacts = params.includeArtifacts === true;
  const contextIdFilter = typeof params.contextId === "string" ? params.contextId : null;
  const statusFilter = typeof params.status === "string" ? (params.status as TaskState) : null;
  const statusTimestampAfter =
    typeof params.statusTimestampAfter === "string"
      ? new Date(params.statusTimestampAfter)
      : null;

  const query: Record<string, unknown> = {
    $or: [{ buyerAgentId: ctx.agent._id }, { sellerAgentId: ctx.agent._id }],
  };
  if (contextIdFilter) {
    if (!ObjectId.isValid(contextIdFilter)) {
      throw new JsonRpcError(JSON_RPC_ERROR.InvalidParams, "Invalid contextId");
    }
    query.listingId = new ObjectId(contextIdFilter);
  }
  if (statusFilter) {
    const mapped = TASK_STATE_TO_DEAL_STATUSES[statusFilter];
    if (!mapped) {
      throw new JsonRpcError(JSON_RPC_ERROR.InvalidParams, `Unknown status ${statusFilter}`);
    }
    if (mapped.length === 0) {
      return { tasks: [], nextPageToken: "", pageSize, totalSize: 0 };
    }
    query.status = { $in: mapped };
  }
  if (statusTimestampAfter && !Number.isNaN(statusTimestampAfter.getTime())) {
    query.updatedAt = { $gte: statusTimestampAfter };
  }

  const totalSize = await ctx.db.collection<DealDoc>("deals").countDocuments(query);

  // Cursor paginates on (updatedAt desc, _id desc).
  const paginated: Record<string, unknown> = { ...query };
  if (cursor?.t && cursor?.id && ObjectId.isValid(cursor.id)) {
    const cursorDate = new Date(cursor.t);
    paginated.$and = [
      {
        $or: [
          { updatedAt: { $lt: cursorDate } },
          { updatedAt: cursorDate, _id: { $lt: new ObjectId(cursor.id) } },
        ],
      },
    ];
  }

  const deals = await ctx.db
    .collection<DealDoc>("deals")
    .find(paginated)
    .sort({ updatedAt: -1, _id: -1 })
    .limit(pageSize + 1)
    .toArray();

  let nextPageToken = "";
  const slice = deals.slice(0, pageSize);
  if (deals.length > pageSize) {
    const last = slice[slice.length - 1];
    nextPageToken = encodePageToken({
      t: last.updatedAt.getTime(),
      id: last._id.toHexString(),
    });
  }

  const tasks = await Promise.all(
    slice.map((d) =>
      dealToTask(ctx.db, d, ctx.baseUrl, { historyLength, includeArtifacts })
    )
  );
  return { tasks, nextPageToken, pageSize, totalSize };
}

/* ========================= CancelTask ========================= */

export async function handleCancelTask(
  ctx: HandlerContext,
  rawParams: unknown
): Promise<A2ATask> {
  const params = requireObject(rawParams, "CancelTask");
  const id = typeof params.id === "string" ? params.id.trim() : "";
  if (!id) throw new JsonRpcError(JSON_RPC_ERROR.InvalidParams, "`id` is required");
  try {
    const existing = await loadDeal(ctx.db, id);
    assertAgentCanReadDeal(ctx.agent, existing);
    const deal = await cancelDealAsCaller(ctx.db, ctx.agent, id);
    return dealActionToTask(ctx, deal);
  } catch (e) {
    if (e instanceof DealActionError && e.code === "TaskNotCancelable") {
      throw taskNotCancelable(id, "unknown");
    }
    throw translateDealError(e);
  }
}

export { taskIdFromMessage, loadDeal, assertAgentCanReadDeal };

// Re-export for type consistency across handlers.
export type { TaskState, DealStatus };
export { DEAL_STATUSES, dealStatusToTaskState };
