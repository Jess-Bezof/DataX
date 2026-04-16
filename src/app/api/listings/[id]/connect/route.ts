import {
  assertRole,
  findAgentByApiKey,
  parseBearer,
  AuthError,
} from "@/lib/auth";
import {
  ACTIVE_DEAL_STATUSES,
  initialDealStatus,
  parseDealProposal,
} from "@/lib/deals";
import { toListingPreview } from "@/lib/listings";
import { getDb, ensureIndexes } from "@/lib/mongo";
import { handleRouteError, jsonError } from "@/lib/api-helpers";
import { safeJsonBody } from "@/lib/request-json";
import { notifyDealParties } from "@/lib/notify";
import type { AgentDoc, DealDoc, ListingDoc } from "@/types/datax";
import { ObjectId } from "mongodb";

function nextStepsMessage(status: string, hasProposal: boolean): string {
  switch (status) {
    case "offer_pending":
      return "The seller must accept or reject your price proposal before you can pay.";
    case "awaiting_payment":
      return "Send crypto to the seller wallet below, then confirm you sent the payment.";
    case "buyer_marked_sent":
      return "Waiting for the seller to confirm they received the payment.";
    case "released":
      return "Use GET /api/deals/{dealId}/payload with your buyer API key to fetch the full dataset.";
    case "offer_rejected":
      return "This deal was rejected. You can start a new deal with a different proposal if the listing is still available.";
    default:
      return hasProposal
        ? "Awaiting seller response to your offer."
        : "Complete payment steps in the deal flow.";
  }
}

export async function POST(
  request: Request,
  ctx: { params: Promise<{ id: string }> }
) {
  try {
    await ensureIndexes();
    const { id } = await ctx.params;
    if (!ObjectId.isValid(id)) {
      return jsonError(400, "Invalid listing id");
    }

    const db = await getDb();
    const token = parseBearer(request.headers.get("authorization"));
    const buyer = await findAgentByApiKey(
      db.collection<AgentDoc>("agents"),
      token
    );
    if (!buyer) throw new AuthError(401, "Missing or invalid API key");
    assertRole(buyer, "buyer");

    let body: Record<string, unknown> = {};
    try {
      body = await safeJsonBody(request);
    } catch {
      return jsonError(400, "Invalid JSON body");
    }

    let proposal: { proposedAmount?: string; proposedCurrency?: string };
    try {
      proposal = parseDealProposal(body);
    } catch (e) {
      if (e instanceof Error && e.message.startsWith("Invalid")) {
        return jsonError(400, e.message);
      }
      if (e instanceof Error && e.message.startsWith("Provide both")) {
        return jsonError(400, e.message);
      }
      throw e;
    }
    const hasProposal = Boolean(
      proposal.proposedAmount && proposal.proposedCurrency
    );
    const startStatus = initialDealStatus(hasProposal);

    const listing = await db.collection<ListingDoc>("listings").findOne({
      _id: new ObjectId(id),
    });
    if (!listing) return jsonError(404, "Listing not found");

    const seller = await db.collection<AgentDoc>("agents").findOne({
      _id: listing.sellerAgentId,
    });
    if (!seller) return jsonError(500, "Seller record missing");

    const dealsCol = db.collection<DealDoc>("deals");
    const existing = await dealsCol.findOne({
      listingId: listing._id,
      buyerAgentId: buyer._id,
      status: { $in: ACTIVE_DEAL_STATUSES },
    });

    let deal: DealDoc;
    if (existing) {
      deal = existing;
    } else {
      if (startStatus === "awaiting_payment") {
        const wallet = seller.cryptoWallet?.trim();
        if (!wallet) {
          return jsonError(
            400,
            "Seller has not set a crypto payout wallet yet. They must save one on the seller dashboard (PATCH /api/agents/me) before checkout."
          );
        }
      }

      const now = new Date();
      const initialEvents = hasProposal
        ? [
            { at: now, actor: "system", action: "deal_created" },
            { at: now, actor: "buyer", action: "offer_proposed", amount: proposal.proposedAmount, currency: proposal.proposedCurrency },
          ]
        : [
            { at: now, actor: "system", action: "deal_created" },
            { at: now, actor: "system", action: "seller_accepted", note: "No proposal — direct checkout." },
          ];
      const insertDoc = {
        listingId: listing._id,
        buyerAgentId: buyer._id,
        sellerAgentId: seller._id,
        status: startStatus,
        ...(hasProposal
          ? {
              proposedAmount: proposal.proposedAmount,
              proposedCurrency: proposal.proposedCurrency,
            }
          : {}),
        events: initialEvents,
        createdAt: now,
        updatedAt: now,
      };
      const ins = await db.collection("deals").insertOne(insertDoc);
      const created = await dealsCol.findOne({ _id: ins.insertedId });
      if (!created) return jsonError(500, "Could not create deal");
      deal = created;

      await db.collection("connection_events").insertOne({
        buyerAgentId: buyer._id,
        sellerAgentId: seller._id,
        listingId: listing._id,
        createdAt: now,
      });

      await notifyDealParties({
        dealId: deal._id.toHexString(),
        buyerAgentId: deal.buyerAgentId,
        sellerAgentId: deal.sellerAgentId,
        newStatus: deal.status,
        ...(hasProposal ? { counterAmount: proposal.proposedAmount, counterCurrency: proposal.proposedCurrency } : {}),
        sellerCryptoWallet: deal.status === "awaiting_payment" ? seller.cryptoWallet?.trim() : undefined,
      });
    }

    const wallet =
      deal.status === "offer_pending" || deal.status === "offer_rejected"
        ? null
        : seller.cryptoWallet?.trim() || null;

    if (
      deal.status !== "offer_pending" &&
      deal.status !== "offer_rejected" &&
      !wallet
    ) {
      return jsonError(
        400,
        "Seller must set a crypto wallet before this deal can proceed."
      );
    }

    return Response.json({
      dealId: deal._id.toHexString(),
      status: deal.status,
      proposedAmount: deal.proposedAmount,
      proposedCurrency: deal.proposedCurrency,
      listing: toListingPreview(listing),
      seller: {
        displayName: seller.displayName,
        contactMethod: seller.contactMethod,
        contactValue: seller.contactValue,
        contactNote: seller.contactNote,
      },
      sellerCryptoWallet: wallet,
      nextSteps: nextStepsMessage(deal.status, hasProposal),
      message:
        deal.status === "offer_pending"
          ? "Price proposal sent. The seller will accept or reject before you pay."
          : deal.status === "awaiting_payment"
            ? "Send crypto to the seller wallet, then confirm payment sent."
            : deal.status === "buyer_marked_sent"
              ? "Payment marked as sent. Waiting for seller to confirm receipt."
              : deal.status === "released"
                ? "Deal complete. Fetch the payload with GET /api/deals/{id}/payload."
                : "Deal updated.",
    });
  } catch (e) {
    if (e instanceof Error && e.message.includes("MONGODB_URI")) {
      return jsonError(503, "Database is not configured");
    }
    if (e instanceof AuthError) {
      return jsonError(e.status, e.message);
    }
    return handleRouteError(e);
  }
}
