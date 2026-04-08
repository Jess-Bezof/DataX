import { getDb, ensureIndexes } from "@/lib/mongo";
import { handleRouteError, jsonError } from "@/lib/api-helpers";
import type { AgentDoc, DealDoc, ListingDoc } from "@/types/datax";
import { ObjectId } from "mongodb";

export async function GET() {
  try {
    await ensureIndexes();
    const db = await getDb();

    const deals = await db
      .collection<DealDoc>("deals")
      .find({})
      .sort({ updatedAt: -1 })
      .limit(50)
      .toArray();

    if (deals.length === 0) {
      return Response.json({ negotiations: [] });
    }

    const listingIds = [
      ...new Map(
        deals.map((d) => [d.listingId.toHexString(), d.listingId])
      ).values(),
    ];
    const agentIdSet = new Set<string>();
    for (const d of deals) {
      agentIdSet.add(d.buyerAgentId.toHexString());
      agentIdSet.add(d.sellerAgentId.toHexString());
    }
    const agentOids = [...agentIdSet].map((id) => new ObjectId(id));

    const [listings, agents] = await Promise.all([
      db
        .collection<ListingDoc>("listings")
        .find({ _id: { $in: listingIds } })
        .project({ title: 1 })
        .toArray(),
      db
        .collection<AgentDoc>("agents")
        .find({ _id: { $in: agentOids } })
        .project({ displayName: 1 })
        .toArray(),
    ]);

    const titleMap = new Map(
      listings.map((l) => [l._id.toHexString(), l.title])
    );
    const nameMap = new Map(
      agents.map((a) => [a._id.toHexString(), a.displayName])
    );

    const negotiations = deals.map((d) => ({
      dealId: d._id.toHexString(),
      listingTitle:
        titleMap.get(d.listingId.toHexString()) ?? "(listing removed)",
      buyerName: nameMap.get(d.buyerAgentId.toHexString()) ?? "Buyer",
      sellerName: nameMap.get(d.sellerAgentId.toHexString()) ?? "Seller",
      status: d.status,
      proposedAmount: d.proposedAmount ?? null,
      proposedCurrency: d.proposedCurrency ?? null,
      counterAmount: (d as DealDoc & { counterAmount?: string }).counterAmount ?? null,
      counterCurrency: (d as DealDoc & { counterCurrency?: string }).counterCurrency ?? null,
      buyerMarkedSentAt: d.buyerMarkedSentAt?.toISOString() ?? null,
      updatedAt: d.updatedAt.toISOString(),
      createdAt: d.createdAt.toISOString(),
    }));

    return Response.json({ negotiations });
  } catch (e) {
    if (e instanceof Error && e.message.includes("MONGODB_URI")) {
      return jsonError(503, "Database is not configured");
    }
    return handleRouteError(e);
  }
}
