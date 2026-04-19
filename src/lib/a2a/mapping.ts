/**
 * DataX DealDoc <-> A2A Task mapping.
 *
 * All enum values follow v1 ProtoJSON serialization (spec Section 5.5):
 * SCREAMING_SNAKE_CASE strings for TaskState and Role.
 */

import { randomUUID } from "crypto";
import type { Db } from "mongodb";
import type {
  A2AArtifact,
  A2AMessage,
  A2ARole,
  A2ATask,
  A2ATaskArtifactUpdateEvent,
  A2ATaskStatus,
  A2ATaskStatusUpdateEvent,
  TaskState,
} from "./types";
import type {
  AgentDoc,
  DealDoc,
  DealEvent,
  DealStatus,
  ListingDoc,
} from "@/types/datax";

/** Convert a DataX DealStatus to the v1 TaskState enum. */
export function dealStatusToTaskState(status: DealStatus): TaskState {
  switch (status) {
    case "offer_pending":
    case "seller_counter_pending":
    case "buyer_counter_pending":
      return "TASK_STATE_INPUT_REQUIRED";
    case "awaiting_payment":
    case "buyer_marked_sent":
      return "TASK_STATE_WORKING";
    case "released":
      return "TASK_STATE_COMPLETED";
    case "offer_rejected":
      return "TASK_STATE_REJECTED";
  }
}

export function isTerminalDealStatus(status: DealStatus): boolean {
  return status === "released" || status === "offer_rejected";
}

function actorToRole(actor: DealEvent["actor"]): A2ARole {
  if (actor === "buyer") return "ROLE_USER";
  return "ROLE_AGENT"; // seller + system
}

function dealEventText(event: DealEvent): string {
  const price =
    event.amount && event.currency ? `${event.amount} ${event.currency}` : "";
  switch (event.action) {
    case "deal_created":
      return "Deal created.";
    case "offer_proposed":
      return `Buyer proposed ${price}.`;
    case "seller_accepted":
      return price ? `Seller accepted at ${price}.` : "Seller accepted.";
    case "seller_rejected":
      return "Seller rejected the offer.";
    case "seller_countered":
      return `Seller countered with ${price}.`;
    case "buyer_accepted_counter":
      return "Buyer accepted the counter-offer.";
    case "buyer_rejected_counter":
      return "Buyer rejected the counter-offer.";
    case "buyer_countered":
      return `Buyer countered with ${price}.`;
    case "payment_sent":
      return "Buyer marked payment as sent.";
    case "payment_confirmed":
      return "Seller confirmed payment received.";
    case "data_released":
      return "Data released to the buyer.";
  }
}

export function dealEventToMessage(
  event: DealEvent,
  taskId: string,
  contextId: string
): A2AMessage {
  const meta: Record<string, unknown> = {
    dataxAction: event.action,
    dataxActor: event.actor,
  };
  if (event.amount) meta.amount = event.amount;
  if (event.currency) meta.currency = event.currency;
  if (event.note) meta.note = event.note;
  return {
    messageId: `evt-${new Date(event.at).getTime()}-${event.action}`,
    taskId,
    contextId,
    role: actorToRole(event.actor),
    parts: [
      { text: dealEventText(event) },
      { data: { action: event.action, amount: event.amount, currency: event.currency, note: event.note, at: new Date(event.at).toISOString() } },
    ],
    metadata: meta,
  };
}

function statusMessage(deal: DealDoc, status: DealStatus): A2AMessage | undefined {
  const taskId = deal._id.toHexString();
  const contextId = deal.listingId.toHexString();
  switch (status) {
    case "offer_pending":
      return {
        messageId: `status-${taskId}-offer-pending`,
        taskId,
        contextId,
        role: "ROLE_AGENT",
        parts: [
          {
            text: "Seller must accept or reject your offer before payment can proceed.",
          },
        ],
      };
    case "seller_counter_pending":
      return {
        messageId: `status-${taskId}-seller-counter`,
        taskId,
        contextId,
        role: "ROLE_AGENT",
        parts: [
          {
            text: `Seller countered with ${deal.counterAmount ?? "?"} ${deal.counterCurrency ?? ""}. Accept, reject, or counter.`.trim(),
          },
        ],
      };
    case "buyer_counter_pending":
      return {
        messageId: `status-${taskId}-buyer-counter`,
        taskId,
        contextId,
        role: "ROLE_USER",
        parts: [
          {
            text: `Buyer countered with ${deal.counterAmount ?? "?"} ${deal.counterCurrency ?? ""}.`.trim(),
          },
        ],
      };
    case "awaiting_payment":
      return {
        messageId: `status-${taskId}-awaiting-payment`,
        taskId,
        contextId,
        role: "ROLE_AGENT",
        parts: [{ text: "Awaiting buyer payment. Buyer must send crypto then mark payment-sent." }],
      };
    case "buyer_marked_sent":
      return {
        messageId: `status-${taskId}-buyer-sent`,
        taskId,
        contextId,
        role: "ROLE_USER",
        parts: [{ text: "Buyer marked payment as sent. Awaiting seller confirmation." }],
      };
    case "released":
      return {
        messageId: `status-${taskId}-released`,
        taskId,
        contextId,
        role: "ROLE_AGENT",
        parts: [{ text: "Payment confirmed. Dataset released." }],
      };
    case "offer_rejected":
      return {
        messageId: `status-${taskId}-rejected`,
        taskId,
        contextId,
        role: "ROLE_AGENT",
        parts: [{ text: "Seller rejected the offer." }],
      };
  }
}

export function buildTaskStatus(deal: DealDoc): A2ATaskStatus {
  return {
    state: dealStatusToTaskState(deal.status),
    message: statusMessage(deal, deal.status),
    timestamp: new Date(deal.updatedAt).toISOString(),
  };
}

const ARTIFACT_INLINE_MAX_BYTES = 200 * 1024;

export function buildReleasedArtifact(
  deal: DealDoc,
  listing: ListingDoc | null,
  baseUrl: string
): A2AArtifact | null {
  if (deal.status !== "released") return null;
  const artifactId = `dataset-${deal._id.toHexString()}`;
  const title = listing?.title ?? "Released dataset";

  // Try inline, fall back to URL if payload is large.
  let inline: string | null = null;
  try {
    const raw = listing ? JSON.stringify(listing.fullPayload) : null;
    if (raw && Buffer.byteLength(raw, "utf8") <= ARTIFACT_INLINE_MAX_BYTES) {
      inline = raw;
    }
  } catch {
    inline = null;
  }

  if (inline !== null && listing) {
    return {
      artifactId,
      name: title,
      description: `Full payload released after deal ${deal._id.toHexString()} settled.`,
      parts: [
        {
          data: listing.fullPayload,
          mediaType: "application/json",
          filename: `${artifactId}.json`,
        },
      ],
      metadata: {
        dataxListingId: deal.listingId.toHexString(),
        dataxDealId: deal._id.toHexString(),
      },
    };
  }

  return {
    artifactId,
    name: title,
    description: `Full payload released after deal ${deal._id.toHexString()} settled. Fetch via URL with the buyer's bearer token.`,
    parts: [
      {
        url: `${baseUrl}/api/deals/${deal._id.toHexString()}/payload`,
        mediaType: "application/json",
        filename: `${artifactId}.json`,
      },
    ],
    metadata: {
      dataxListingId: deal.listingId.toHexString(),
      dataxDealId: deal._id.toHexString(),
    },
  };
}

/**
 * Build a full A2A Task from a DealDoc. Loads the listing only when needed
 * for the released artifact.
 */
export async function dealToTask(
  db: Db,
  deal: DealDoc,
  baseUrl: string,
  options: {
    includeHistory?: boolean;
    historyLength?: number;
    includeArtifacts?: boolean;
  } = {}
): Promise<A2ATask> {
  const id = deal._id.toHexString();
  const contextId = deal.listingId.toHexString();

  const task: A2ATask = {
    id,
    contextId,
    status: buildTaskStatus(deal),
    metadata: {
      dataxDealStatus: deal.status,
      dataxBuyerAgentId: deal.buyerAgentId.toHexString(),
      dataxSellerAgentId: deal.sellerAgentId.toHexString(),
      dataxListingId: contextId,
      ...(deal.proposedAmount ? { proposedAmount: deal.proposedAmount } : {}),
      ...(deal.proposedCurrency ? { proposedCurrency: deal.proposedCurrency } : {}),
      ...(deal.counterAmount ? { counterAmount: deal.counterAmount } : {}),
      ...(deal.counterCurrency ? { counterCurrency: deal.counterCurrency } : {}),
    },
  };

  if (options.includeHistory !== false) {
    const events = deal.events ?? [];
    let slice: typeof events;
    if (options.historyLength === 0) {
      slice = [];
    } else if (
      typeof options.historyLength === "number" &&
      options.historyLength > 0
    ) {
      slice = events.slice(-options.historyLength);
    } else {
      slice = events;
    }
    if (slice.length > 0) {
      task.history = slice.map((e) => dealEventToMessage(e, id, contextId));
    }
  }

  if (options.includeArtifacts !== false && deal.status === "released") {
    const listing = await db
      .collection<ListingDoc>("listings")
      .findOne({ _id: deal.listingId });
    const artifact = buildReleasedArtifact(deal, listing, baseUrl);
    if (artifact) task.artifacts = [artifact];
  }

  return task;
}

/** Build a TaskStatusUpdateEvent suitable for the wire (SSE or push webhook). */
export function taskStatusUpdateEvent(deal: DealDoc): A2ATaskStatusUpdateEvent {
  return {
    taskId: deal._id.toHexString(),
    contextId: deal.listingId.toHexString(),
    status: buildTaskStatus(deal),
    metadata: { dataxDealStatus: deal.status },
  };
}

export function taskArtifactUpdateEvent(
  deal: DealDoc,
  listing: ListingDoc | null,
  baseUrl: string
): A2ATaskArtifactUpdateEvent | null {
  const artifact = buildReleasedArtifact(deal, listing, baseUrl);
  if (!artifact) return null;
  return {
    taskId: deal._id.toHexString(),
    contextId: deal.listingId.toHexString(),
    artifact,
    append: false,
    lastChunk: true,
  };
}

/** Generate a fresh message ID for server-initiated messages. */
export function newServerMessageId(prefix = "msg"): string {
  return `${prefix}-${randomUUID()}`;
}

/**
 * Extract a structured `DataPart` payload from a v1 Message. Returns null
 * if no `parts[].data` entry is present. Works with both object-shaped
 * payloads and JSON-encoded text-only clients.
 */
export function extractDataPart(
  message: Pick<A2AMessage, "parts">
): Record<string, unknown> | null {
  for (const part of message.parts ?? []) {
    if (part.data != null && typeof part.data === "object" && !Array.isArray(part.data)) {
      return part.data as Record<string, unknown>;
    }
  }
  // Fallback: some minimal clients only send a text part with a JSON string.
  for (const part of message.parts ?? []) {
    if (typeof part.text === "string") {
      const trimmed = part.text.trim();
      if (trimmed.startsWith("{") && trimmed.endsWith("}")) {
        try {
          const parsed = JSON.parse(trimmed);
          if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
            return parsed as Record<string, unknown>;
          }
        } catch {
          /* ignore */
        }
      }
    }
  }
  return null;
}

/** Does this agent participate in the deal? Useful as a role scope check. */
export function agentRoleInDeal(
  agent: AgentDoc,
  deal: DealDoc
): "buyer" | "seller" | null {
  if (agent._id.equals(deal.buyerAgentId)) return "buyer";
  if (agent._id.equals(deal.sellerAgentId)) return "seller";
  return null;
}
