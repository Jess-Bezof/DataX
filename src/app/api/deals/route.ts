import { findAgentByApiKey, parseBearer, AuthError } from "@/lib/auth";
import { getDb, ensureIndexes } from "@/lib/mongo";
import { handleRouteError, jsonError } from "@/lib/api-helpers";
import { toListingPreview } from "@/lib/listings";
import type { AgentDoc, DealDoc, ListingDoc } from "@/types/datax";
import { ObjectId } from "mongodb";

export async function GET(request: Request) {
  try {
    await ensureIndexes();
    const db = await getDb();
    const token = parseBearer(request.headers.get("authorization"));
    const agent = await findAgentByApiKey(
      db.collection<AgentDoc>("agents"),
      token
    );
    if (!agent) throw new AuthError(401, "Missing or invalid API key");

    const deals = await db
      .collection<DealDoc>("deals")
      .find({
        $or: [{ buyerAgentId: agent._id }, { sellerAgentId: agent._id }],
      })
      .sort({ updatedAt: -1 })
      .limit(40)
      .toArray();

    if (deals.length === 0) {
      return Response.json({ deals: [] });
    }

    const listingIds = [
      ...new Map(
        deals.map((d) => [d.listingId.toHexString(), d.listingId])
      ).values(),
    ];
    const otherAgentIds = new Set<string>();
    for (const d of deals) {
      if (agent._id.equals(d.buyerAgentId)) {
        otherAgentIds.add(d.sellerAgentId.toHexString());
      } else {
        otherAgentIds.add(d.buyerAgentId.toHexString());
      }
    }
    const oids = [...otherAgentIds].map((id) => new ObjectId(id));

    const [listings, others] = await Promise.all([
      db
        .collection<ListingDoc>("listings")
        .find({ _id: { $in: listingIds } })
        .toArray(),
      db
        .collection<AgentDoc>("agents")
        .find({ _id: { $in: oids } })
        .project({ displayName: 1 })
        .toArray(),
    ]);

    const listingMap = new Map(
      listings.map((l) => [l._id.toHexString(), l])
    );
    const nameMap = new Map(
      others.map((a) => [a._id.toHexString(), a.displayName])
    );

    const sellerIdsForWallet = new Set<string>();
    for (const d of deals) {
      const isBuyer = agent._id.equals(d.buyerAgentId);
      if (
        isBuyer &&
        (d.status === "awaiting_payment" || d.status === "buyer_marked_sent")
      ) {
        sellerIdsForWallet.add(d.sellerAgentId.toHexString());
      }
    }
    const sellerOids = [...sellerIdsForWallet].map((id) => new ObjectId(id));
    const sellersWithWallet =
      sellerOids.length > 0
        ? await db
            .collection<AgentDoc>("agents")
            .find({ _id: { $in: sellerOids } })
            .project({ cryptoWallet: 1 })
            .toArray()
        : [];
    const walletMap = new Map(
      sellersWithWallet.map((s) => [
        s._id.toHexString(),
        s.cryptoWallet?.trim() || null,
      ])
    );

    const out = deals.map((d) => {
      const list = listingMap.get(d.listingId.toHexString());
      const isBuyer = agent._id.equals(d.buyerAgentId);
      const counterId = isBuyer
        ? d.sellerAgentId.toHexString()
        : d.buyerAgentId.toHexString();
      const showWallet =
        isBuyer &&
        (d.status === "awaiting_payment" || d.status === "buyer_marked_sent");
      return {
        dealId: d._id.toHexString(),
        status: d.status,
        role: isBuyer ? "buyer" : "seller",
        proposedAmount: d.proposedAmount,
        proposedCurrency: d.proposedCurrency,
        counterAmount: d.counterAmount,
        counterCurrency: d.counterCurrency,
        counterpartyName: nameMap.get(counterId) ?? "Agent",
        listing: list ? toListingPreview(list) : null,
        buyerMarkedSentAt: d.buyerMarkedSentAt?.toISOString() ?? null,
        sellerConfirmedReceivedAt: d.sellerConfirmedReceivedAt?.toISOString() ?? null,
        updatedAt: d.updatedAt.toISOString(),
        sellerCryptoWallet: showWallet
          ? walletMap.get(d.sellerAgentId.toHexString()) ?? null
          : null,
      };
    });

    return Response.json({ deals: out });
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
