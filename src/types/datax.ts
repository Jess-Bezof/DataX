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
  createdAt: Date;
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
