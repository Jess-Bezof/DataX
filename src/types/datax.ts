import type { ObjectId } from "mongodb";

export const CONTACT_METHODS = [
  "platform",
  "email",
  "telegram",
  "discord",
  "url",
  "other",
] as const;

export type ContactMethod = (typeof CONTACT_METHODS)[number];

export type AgentRole = "seller" | "buyer";

export type AgentDoc = {
  _id: ObjectId;
  role: AgentRole;
  displayName: string;
  apiKeyHash: string;
  contactMethod: ContactMethod;
  contactValue: string;
  contactNote?: string;
  /** Seller payout address; shown to buyers during manual crypto checkout */
  cryptoWallet?: string;
  /** HTTPS URL DataX will POST deal events to; enables instant agent reactions */
  webhookUrl?: string;
  /** Bearer token sent in Authorization header when firing webhooks */
  webhookSecret?: string;
  /** HTTPS URL of the agent's own A2A Agent Card; DataX will POST A2A push notifications here when no per-task config exists. */
  externalAgentCardUrl?: string;
  /** Bearer token DataX uses when calling the remote agent's A2A endpoint (if their card declares http/bearer). */
  a2aDefaultPushToken?: string;
  createdAt: Date;
};

/**
 * Per-task push-notification config registered by an A2A client via
 * CreateTaskPushNotificationConfig. One config per (agentId, taskId, id).
 */
export type A2APushConfigDoc = {
  _id: ObjectId;
  /** Agent that owns (and authenticated to create) this config. */
  agentId: ObjectId;
  /** A2A Task ID — always a DealDoc._id hex string. */
  taskId: string;
  /** Client-supplied config id so an agent can register multiple configs per task. */
  configId: string;
  /** Webhook URL DataX POSTs StreamResponse payloads to. */
  url: string;
  /** Optional bearer token included in the Authorization header on outbound webhooks. */
  token?: string;
  createdAt: Date;
  updatedAt: Date;
};

export type DealEvent = {
  at: Date;
  actor: "buyer" | "seller" | "system";
  action:
    | "deal_created"
    | "offer_proposed"
    | "seller_accepted"
    | "seller_rejected"
    | "seller_countered"
    | "buyer_accepted_counter"
    | "buyer_rejected_counter"
    | "buyer_countered"
    | "payment_sent"
    | "payment_confirmed"
    | "data_released";
  amount?: string;
  currency?: string;
  note?: string;
};

export const DEAL_STATUSES = [
  "offer_pending",
  "seller_counter_pending",
  "buyer_counter_pending",
  "awaiting_payment",
  "buyer_marked_sent",
  "released",
  "offer_rejected",
] as const;

export type DealStatus = (typeof DEAL_STATUSES)[number];

export type DealDoc = {
  _id: ObjectId;
  listingId: ObjectId;
  buyerAgentId: ObjectId;
  sellerAgentId: ObjectId;
  status: DealStatus;
  proposedAmount?: string;
  proposedCurrency?: string;
  counterAmount?: string;
  counterCurrency?: string;
  events?: DealEvent[];
  buyerMarkedSentAt?: Date;
  sellerConfirmedReceivedAt?: Date;
  createdAt: Date;
  updatedAt: Date;
};

export type ListingDoc = {
  _id: ObjectId;
  sellerAgentId: ObjectId;
  title: string;
  summary: string;
  validFrom: Date;
  validTo: Date;
  regions: string[];
  columns: string[];
  sampleRow: Record<string, unknown>;
  fullPayload: unknown;
  askingPrice?: string;
  askingCurrency?: string;
  industry?: string;
  dataType?: string;
  createdAt: Date;
  updatedAt: Date;
};

export type ConnectionEventDoc = {
  _id: ObjectId;
  buyerAgentId: ObjectId;
  sellerAgentId: ObjectId;
  listingId: ObjectId;
  createdAt: Date;
};

export type RatingDoc = {
  _id: ObjectId;
  dealId: ObjectId;
  listingId: ObjectId;
  raterAgentId: ObjectId;
  targetAgentId: ObjectId;
  raterRole: "buyer" | "seller";
  stars: number;
  comment?: string;
  createdAt: Date;
};

export const RATING_TIMEOUT_MS = 48 * 60 * 60 * 1000;

/** Public-safe shape (no fullPayload, no api keys) */
export type ListingPreview = {
  id: string;
  title: string;
  summary: string;
  validFrom: string;
  validTo: string;
  regions: string[];
  columns: string[];
  sampleRow: Record<string, unknown>;
  askingPrice?: string;
  askingCurrency?: string;
  industry?: string;
  dataType?: string;
  /** Set only by /api/marketplace — not present in toListingPreview() */
  sellerName?: string;
  acquisitionCount?: number;
};
