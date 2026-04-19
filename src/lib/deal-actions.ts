/**
 * Shared deal state-transition logic used by both the REST `/api/deals/[id]/*`
 * routes (historically) and the new A2A JSON-RPC handlers. Each function
 * applies the same validation + side effects (DB write, notifyDealParties)
 * and returns the updated DealDoc.
 *
 * Validation failures throw `DealActionError` with a status + message so
 * callers can surface them through their preferred error shape
 * (HTTP JSON, JSON-RPC error, etc.).
 */

import type { Db, ObjectId } from "mongodb";
import { ObjectId as MongoObjectId } from "mongodb";
import type {
  AgentDoc,
  DealDoc,
  DealEvent,
  DealStatus,
  ListingDoc,
} from "@/types/datax";
import { notifyDealParties } from "@/lib/notify";
import {
  ACTIVE_DEAL_STATUSES,
  initialDealStatus,
} from "@/lib/deals";

export class DealActionError extends Error {
  constructor(
    public status: number,
    message: string,
    public code?: string
  ) {
    super(message);
    this.name = "DealActionError";
  }
}

function trimmedString(v: unknown, field: string, max: number): string {
  if (typeof v !== "string" || !v.trim()) {
    throw new DealActionError(400, `${field} is required`);
  }
  return v.trim().slice(0, max);
}

async function getDealById(db: Db, dealId: string): Promise<DealDoc> {
  if (!MongoObjectId.isValid(dealId)) {
    throw new DealActionError(400, "Invalid deal id");
  }
  const deal = await db
    .collection<DealDoc>("deals")
    .findOne({ _id: new MongoObjectId(dealId) });
  if (!deal) throw new DealActionError(404, "Deal not found");
  return deal;
}

function assertParty(
  agent: AgentDoc,
  deal: DealDoc,
  party: "buyer" | "seller"
): void {
  const isBuyer = agent._id.equals(deal.buyerAgentId);
  const isSeller = agent._id.equals(deal.sellerAgentId);
  if (party === "buyer" && !isBuyer) {
    throw new DealActionError(403, "Only the buyer can perform this action");
  }
  if (party === "seller" && !isSeller) {
    throw new DealActionError(403, "Only the seller can perform this action");
  }
}

async function readDeal(db: Db, _id: ObjectId): Promise<DealDoc> {
  const updated = await db.collection<DealDoc>("deals").findOne({ _id });
  if (!updated) throw new DealActionError(500, "Deal disappeared after update");
  return updated;
}

/* --------------------- create deal (propose) --------------------- */

export type CreateDealOptions = {
  proposedAmount?: string;
  proposedCurrency?: string;
};

export async function createDealFromListing(
  db: Db,
  buyer: AgentDoc,
  listingId: string,
  options: CreateDealOptions = {}
): Promise<{ deal: DealDoc; listing: ListingDoc; seller: AgentDoc }> {
  if (buyer.role !== "buyer") {
    throw new DealActionError(403, "Only buyers can propose deals");
  }
  if (!MongoObjectId.isValid(listingId)) {
    throw new DealActionError(400, "Invalid listing id");
  }
  const listing = await db
    .collection<ListingDoc>("listings")
    .findOne({ _id: new MongoObjectId(listingId) });
  if (!listing) throw new DealActionError(404, "Listing not found");

  const seller = await db
    .collection<AgentDoc>("agents")
    .findOne({ _id: listing.sellerAgentId });
  if (!seller) throw new DealActionError(500, "Seller record missing");

  const hasProposal = Boolean(options.proposedAmount && options.proposedCurrency);
  if ((options.proposedAmount && !options.proposedCurrency) ||
      (!options.proposedAmount && options.proposedCurrency)) {
    throw new DealActionError(400, "Provide both proposedAmount and proposedCurrency, or neither");
  }
  const startStatus = initialDealStatus(hasProposal);

  const dealsCol = db.collection<DealDoc>("deals");
  const existing = await dealsCol.findOne({
    listingId: listing._id,
    buyerAgentId: buyer._id,
    status: { $in: ACTIVE_DEAL_STATUSES },
  });
  if (existing) {
    return { deal: existing, listing, seller };
  }

  if (startStatus === "awaiting_payment" && !seller.cryptoWallet?.trim()) {
    throw new DealActionError(
      400,
      "Seller has not set a crypto payout wallet yet."
    );
  }

  const now = new Date();
  const initialEvents: DealEvent[] = hasProposal
    ? [
        { at: now, actor: "system", action: "deal_created" },
        {
          at: now,
          actor: "buyer",
          action: "offer_proposed",
          amount: options.proposedAmount,
          currency: options.proposedCurrency,
        },
      ]
    : [
        { at: now, actor: "system", action: "deal_created" },
        {
          at: now,
          actor: "system",
          action: "seller_accepted",
          note: "No proposal — direct checkout.",
        },
      ];

  const insertDoc: Omit<DealDoc, "_id"> = {
    listingId: listing._id,
    buyerAgentId: buyer._id,
    sellerAgentId: seller._id,
    status: startStatus,
    ...(hasProposal
      ? {
          proposedAmount: options.proposedAmount,
          proposedCurrency: options.proposedCurrency,
        }
      : {}),
    events: initialEvents,
    createdAt: now,
    updatedAt: now,
  };
  const ins = await db.collection("deals").insertOne(insertDoc);
  const created = await dealsCol.findOne({ _id: ins.insertedId });
  if (!created) throw new DealActionError(500, "Could not create deal");

  await db.collection("connection_events").insertOne({
    buyerAgentId: buyer._id,
    sellerAgentId: seller._id,
    listingId: listing._id,
    createdAt: now,
  });

  await notifyDealParties({
    dealId: created._id.toHexString(),
    buyerAgentId: created.buyerAgentId,
    sellerAgentId: created.sellerAgentId,
    newStatus: created.status,
    ...(hasProposal
      ? {
          counterAmount: options.proposedAmount,
          counterCurrency: options.proposedCurrency,
        }
      : {}),
    sellerCryptoWallet:
      created.status === "awaiting_payment" ? seller.cryptoWallet?.trim() : undefined,
  });

  return { deal: created, listing, seller };
}

/* --------------------- seller actions --------------------- */

export async function sellerAccept(
  db: Db,
  agent: AgentDoc,
  dealId: string
): Promise<{ deal: DealDoc; wallet: string }> {
  const deal = await getDealById(db, dealId);
  assertParty(agent, deal, "seller");

  if (deal.status === "awaiting_payment") {
    const seller = await db
      .collection<AgentDoc>("agents")
      .findOne({ _id: deal.sellerAgentId });
    return { deal, wallet: seller?.cryptoWallet?.trim() ?? "" };
  }
  if (deal.status !== "offer_pending" && deal.status !== "buyer_counter_pending") {
    throw new DealActionError(400, `Cannot accept offer in status "${deal.status}"`);
  }

  const seller = await db
    .collection<AgentDoc>("agents")
    .findOne({ _id: deal.sellerAgentId });
  const wallet = seller?.cryptoWallet?.trim();
  if (!wallet) {
    throw new DealActionError(
      400,
      "Set your crypto payout wallet (PATCH /api/agents/me) before accepting offers."
    );
  }

  const agreedAmount = deal.counterAmount ?? deal.proposedAmount;
  const agreedCurrency = deal.counterCurrency ?? deal.proposedCurrency;
  const now = new Date();
  await db.collection<DealDoc>("deals").updateOne(
    { _id: deal._id },
    {
      $set: { status: "awaiting_payment", updatedAt: now },
      $push: {
        events: {
          at: now,
          actor: "seller",
          action: "seller_accepted",
          amount: agreedAmount,
          currency: agreedCurrency,
        },
      },
    }
  );

  await notifyDealParties({
    dealId: deal._id.toHexString(),
    buyerAgentId: deal.buyerAgentId,
    sellerAgentId: deal.sellerAgentId,
    newStatus: "awaiting_payment",
    agreedAmount,
    agreedCurrency,
    sellerCryptoWallet: wallet,
  });

  return { deal: await readDeal(db, deal._id), wallet };
}

export async function sellerReject(
  db: Db,
  agent: AgentDoc,
  dealId: string
): Promise<DealDoc> {
  const deal = await getDealById(db, dealId);
  assertParty(agent, deal, "seller");
  if (deal.status === "offer_rejected") return deal;
  if (deal.status !== "offer_pending" && deal.status !== "buyer_counter_pending") {
    throw new DealActionError(
      400,
      `Can only reject an active offer or counter (current: ${deal.status})`
    );
  }
  const now = new Date();
  await db.collection<DealDoc>("deals").updateOne(
    { _id: deal._id },
    {
      $set: { status: "offer_rejected", updatedAt: now },
      $push: { events: { at: now, actor: "seller", action: "seller_rejected" } },
    }
  );
  await notifyDealParties({
    dealId: deal._id.toHexString(),
    buyerAgentId: deal.buyerAgentId,
    sellerAgentId: deal.sellerAgentId,
    newStatus: "offer_rejected",
  });
  return readDeal(db, deal._id);
}

export async function sellerCounter(
  db: Db,
  agent: AgentDoc,
  dealId: string,
  input: { counterAmount: unknown; counterCurrency: unknown }
): Promise<DealDoc> {
  const deal = await getDealById(db, dealId);
  assertParty(agent, deal, "seller");
  if (deal.status !== "offer_pending" && deal.status !== "buyer_counter_pending") {
    throw new DealActionError(
      400,
      `Can only counter an active offer (current: ${deal.status})`
    );
  }
  const counterAmount = trimmedString(input.counterAmount, "counterAmount", 40);
  const counterCurrency = trimmedString(input.counterCurrency, "counterCurrency", 24);
  const now = new Date();
  await db.collection<DealDoc>("deals").updateOne(
    { _id: deal._id },
    {
      $set: {
        status: "seller_counter_pending",
        counterAmount,
        counterCurrency,
        updatedAt: now,
      },
      $push: {
        events: {
          at: now,
          actor: "seller",
          action: "seller_countered",
          amount: counterAmount,
          currency: counterCurrency,
        },
      },
    }
  );
  await notifyDealParties({
    dealId: deal._id.toHexString(),
    buyerAgentId: deal.buyerAgentId,
    sellerAgentId: deal.sellerAgentId,
    newStatus: "seller_counter_pending",
    counterAmount,
    counterCurrency,
  });
  return readDeal(db, deal._id);
}

export async function sellerReceived(
  db: Db,
  agent: AgentDoc,
  dealId: string
): Promise<DealDoc> {
  const deal = await getDealById(db, dealId);
  assertParty(agent, deal, "seller");
  if (deal.status === "released") return deal;
  if (deal.status !== "buyer_marked_sent") {
    throw new DealActionError(
      400,
      `Wait for the buyer to mark payment sent (current: ${deal.status})`
    );
  }
  const now = new Date();
  await db.collection<DealDoc>("deals").updateOne(
    { _id: deal._id },
    {
      $set: {
        status: "released",
        sellerConfirmedReceivedAt: now,
        updatedAt: now,
      },
      $push: { events: { at: now, actor: "seller", action: "payment_confirmed" } },
    }
  );
  await db.collection<DealDoc>("deals").updateOne(
    { _id: deal._id },
    { $push: { events: { at: now, actor: "system", action: "data_released" } } }
  );
  await notifyDealParties({
    dealId: deal._id.toHexString(),
    buyerAgentId: deal.buyerAgentId,
    sellerAgentId: deal.sellerAgentId,
    newStatus: "released",
  });
  return readDeal(db, deal._id);
}

/* --------------------- buyer actions --------------------- */

export async function buyerCounter(
  db: Db,
  agent: AgentDoc,
  dealId: string,
  input: { counterAmount: unknown; counterCurrency: unknown }
): Promise<DealDoc> {
  const deal = await getDealById(db, dealId);
  assertParty(agent, deal, "buyer");
  if (deal.status !== "seller_counter_pending") {
    throw new DealActionError(
      400,
      `Can only counter while seller counter is pending (current: ${deal.status})`
    );
  }
  const counterAmount = trimmedString(input.counterAmount, "counterAmount", 40);
  const counterCurrency = trimmedString(input.counterCurrency, "counterCurrency", 24);
  const now = new Date();
  await db.collection<DealDoc>("deals").updateOne(
    { _id: deal._id },
    {
      $set: {
        status: "buyer_counter_pending",
        counterAmount,
        counterCurrency,
        updatedAt: now,
      },
      $push: {
        events: {
          at: now,
          actor: "buyer",
          action: "buyer_countered",
          amount: counterAmount,
          currency: counterCurrency,
        },
      },
    }
  );
  await notifyDealParties({
    dealId: deal._id.toHexString(),
    buyerAgentId: deal.buyerAgentId,
    sellerAgentId: deal.sellerAgentId,
    newStatus: "buyer_counter_pending",
    counterAmount,
    counterCurrency,
  });
  return readDeal(db, deal._id);
}

export async function buyerAcceptCounter(
  db: Db,
  agent: AgentDoc,
  dealId: string
): Promise<{ deal: DealDoc; wallet: string }> {
  const deal = await getDealById(db, dealId);
  assertParty(agent, deal, "buyer");
  if (deal.status !== "seller_counter_pending") {
    throw new DealActionError(
      400,
      `No counter-offer to accept (current: ${deal.status})`
    );
  }
  const seller = await db
    .collection<AgentDoc>("agents")
    .findOne({ _id: deal.sellerAgentId });
  const wallet = seller?.cryptoWallet?.trim();
  if (!wallet) {
    throw new DealActionError(
      400,
      "Seller has no crypto wallet set. They must PATCH /api/agents/me first."
    );
  }
  const now = new Date();
  await db.collection<DealDoc>("deals").updateOne(
    { _id: deal._id },
    {
      $set: { status: "awaiting_payment", updatedAt: now },
      $push: {
        events: {
          at: now,
          actor: "buyer",
          action: "buyer_accepted_counter",
          amount: deal.counterAmount,
          currency: deal.counterCurrency,
        },
      },
    }
  );
  await notifyDealParties({
    dealId: deal._id.toHexString(),
    buyerAgentId: deal.buyerAgentId,
    sellerAgentId: deal.sellerAgentId,
    newStatus: "awaiting_payment",
    agreedAmount: deal.counterAmount,
    agreedCurrency: deal.counterCurrency,
    sellerCryptoWallet: wallet,
  });
  return { deal: await readDeal(db, deal._id), wallet };
}

export async function buyerRejectCounter(
  db: Db,
  agent: AgentDoc,
  dealId: string
): Promise<DealDoc> {
  const deal = await getDealById(db, dealId);
  assertParty(agent, deal, "buyer");
  if (deal.status !== "seller_counter_pending") {
    throw new DealActionError(
      400,
      `No counter-offer to reject (current: ${deal.status})`
    );
  }
  const now = new Date();
  await db.collection<DealDoc>("deals").updateOne(
    { _id: deal._id },
    {
      $set: { status: "offer_rejected", updatedAt: now },
      $push: { events: { at: now, actor: "buyer", action: "buyer_rejected_counter" } },
    }
  );
  await notifyDealParties({
    dealId: deal._id.toHexString(),
    buyerAgentId: deal.buyerAgentId,
    sellerAgentId: deal.sellerAgentId,
    newStatus: "offer_rejected",
  });
  return readDeal(db, deal._id);
}

export async function buyerSent(
  db: Db,
  agent: AgentDoc,
  dealId: string
): Promise<DealDoc> {
  const deal = await getDealById(db, dealId);
  assertParty(agent, deal, "buyer");
  if (deal.status === "buyer_marked_sent") return deal;
  if (deal.status !== "awaiting_payment") {
    throw new DealActionError(
      400,
      `Can only confirm payment while awaiting_payment (current: ${deal.status})`
    );
  }
  const now = new Date();
  await db.collection<DealDoc>("deals").updateOne(
    { _id: deal._id },
    {
      $set: {
        status: "buyer_marked_sent",
        buyerMarkedSentAt: now,
        updatedAt: now,
      },
      $push: { events: { at: now, actor: "buyer", action: "payment_sent" } },
    }
  );
  await notifyDealParties({
    dealId: deal._id.toHexString(),
    buyerAgentId: deal.buyerAgentId,
    sellerAgentId: deal.sellerAgentId,
    newStatus: "buyer_marked_sent",
  });
  return readDeal(db, deal._id);
}

/** Cancel by choosing whichever reject is appropriate for the caller. */
export async function cancelDealAsCaller(
  db: Db,
  agent: AgentDoc,
  dealId: string
): Promise<DealDoc> {
  const deal = await getDealById(db, dealId);
  const isBuyer = agent._id.equals(deal.buyerAgentId);
  const isSeller = agent._id.equals(deal.sellerAgentId);
  if (!isBuyer && !isSeller) {
    throw new DealActionError(403, "You are not a party to this deal");
  }
  const cancelableBySeller: DealStatus[] = ["offer_pending", "buyer_counter_pending"];
  const cancelableByBuyer: DealStatus[] = ["seller_counter_pending"];
  if (isSeller && cancelableBySeller.includes(deal.status)) {
    return sellerReject(db, agent, dealId);
  }
  if (isBuyer && cancelableByBuyer.includes(deal.status)) {
    return buyerRejectCounter(db, agent, dealId);
  }
  throw new DealActionError(
    400,
    `Task cannot be canceled from state ${deal.status}`,
    "TaskNotCancelable"
  );
}
