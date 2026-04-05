import { describeDealActivity } from "@/lib/deal-activity";
import { getDb, ensureIndexes } from "@/lib/mongo";
import { handleRouteError, jsonError } from "@/lib/api-helpers";
import type {
  AgentDoc,
  ConnectionEventDoc,
  DealDoc,
  ListingDoc,
} from "@/types/datax";
import { ObjectId } from "mongodb";

export async function GET(request: Request) {
  try {
    await ensureIndexes();
    const db = await getDb();
    const { searchParams } = new URL(request.url);
    const limit = Math.min(
      50,
      Math.max(1, Number(searchParams.get("limit") ?? 30) || 30)
    );

    const events = await db
      .collection<ConnectionEventDoc>("connection_events")
      .find({})
      .sort({ createdAt: -1 })
      .limit(limit)
      .toArray();

    if (events.length === 0) {
      return Response.json({ feed: [] });
    }

    const listingIds = events.map((e) => e.listingId);
    const agentIds = [
      ...new Set(
        events.flatMap((e) => [e.buyerAgentId, e.sellerAgentId].map((id) => id.toHexString()))
      ),
    ].map((id) => new ObjectId(id));

    const [listings, agents] = await Promise.all([
      db
        .collection<ListingDoc>("listings")
        .find({ _id: { $in: listingIds } })
        .project({ title: 1 })
        .toArray(),
      db
        .collection<AgentDoc>("agents")
        .find({ _id: { $in: agentIds } })
        .project({ displayName: 1 })
        .toArray(),
    ]);

    const listingTitle = new Map(
      listings.map((l) => [l._id.toHexString(), l.title])
    );
    const agentName = new Map(
      agents.map((a) => [a._id.toHexString(), a.displayName])
    );

    const feed = events.map((ev) => ({
      at: ev.createdAt.toISOString(),
      listingTitle:
        listingTitle.get(ev.listingId.toHexString()) ?? "(listing removed)",
      buyerName: agentName.get(ev.buyerAgentId.toHexString()) ?? "Buyer",
      sellerName: agentName.get(ev.sellerAgentId.toHexString()) ?? "Seller",
    }));

    const recentDeals = await db
      .collection<DealDoc>("deals")
      .find({})
      .sort({ updatedAt: -1 })
      .limit(25)
      .toArray();

    let dealMilestones: {
      at: string;
      status: string;
      summary: string;
    }[] = [];

    if (recentDeals.length > 0) {
      const dListingIds = [
        ...new Map(
          recentDeals.map((d) => [d.listingId.toHexString(), d.listingId])
        ).values(),
      ];
      const dAgentIds = new Set<string>();
      for (const d of recentDeals) {
        dAgentIds.add(d.buyerAgentId.toHexString());
        dAgentIds.add(d.sellerAgentId.toHexString());
      }
      const dOids = [...dAgentIds].map((id) => new ObjectId(id));
      const [dListings, dAgents] = await Promise.all([
        db
          .collection<ListingDoc>("listings")
          .find({ _id: { $in: dListingIds } })
          .project({ title: 1 })
          .toArray(),
        db
          .collection<AgentDoc>("agents")
          .find({ _id: { $in: dOids } })
          .project({ displayName: 1 })
          .toArray(),
      ]);
      const dTitle = new Map(
        dListings.map((l) => [l._id.toHexString(), l.title])
      );
      const dName = new Map(
        dAgents.map((a) => [a._id.toHexString(), a.displayName])
      );

      dealMilestones = recentDeals.map((d) => ({
        at: d.updatedAt.toISOString(),
        status: d.status,
        summary: describeDealActivity(
          d.status,
          dTitle.get(d.listingId.toHexString()) ?? "(listing)",
          dName.get(d.buyerAgentId.toHexString()) ?? "Buyer",
          dName.get(d.sellerAgentId.toHexString()) ?? "Seller",
          d.proposedAmount,
          d.proposedCurrency
        ),
      }));
    }

    return Response.json({ feed, dealMilestones });
  } catch (e) {
    if (e instanceof Error && e.message.includes("MONGODB_URI")) {
      return jsonError(503, "Database is not configured");
    }
    return handleRouteError(e);
  }
}
