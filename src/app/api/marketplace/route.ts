import { getDb, ensureIndexes } from "@/lib/mongo";
import { handleRouteError, jsonError } from "@/lib/api-helpers";
import { toListingPreview } from "@/lib/listings";
import type { AgentDoc, DealDoc, ListingDoc } from "@/types/datax";
import { ObjectId } from "mongodb";

export async function GET() {
  try {
    await ensureIndexes();
    const db = await getDb();

    const listings = await db
      .collection<ListingDoc>("listings")
      .find({})
      .sort({ createdAt: -1 })
      .project({
        title: 1, summary: 1, validFrom: 1, validTo: 1,
        regions: 1, columns: 1, sampleRow: 1, sellerAgentId: 1,
        askingPrice: 1, askingCurrency: 1, industry: 1, dataType: 1,
        createdAt: 1,
      })
      .limit(200)
      .toArray() as unknown as ListingDoc[];

    if (listings.length === 0) {
      return Response.json({ items: [] });
    }

    const listingIds = listings.map((l) => l._id);
    const sellerIdSet = new Set(
      listings.flatMap((l) => l.sellerAgentId ? [l.sellerAgentId.toHexString()] : [])
    );
    const sellerOids = [...sellerIdSet].map((id) => new ObjectId(id));

    const [agents, releasedDeals] = await Promise.all([
      db
        .collection<AgentDoc>("agents")
        .find({ _id: { $in: sellerOids } })
        .project({ displayName: 1 })
        .toArray(),
      db
        .collection<DealDoc>("deals")
        .find({ listingId: { $in: listingIds }, status: "released" })
        .project({ listingId: 1 })
        .toArray(),
    ]);

    const sellerNameMap = new Map(
      agents.map((a) => [a._id.toHexString(), a.displayName])
    );
    const acquiredCount = new Map<string, number>();
    for (const deal of releasedDeals) {
      const key = deal.listingId.toHexString();
      acquiredCount.set(key, (acquiredCount.get(key) ?? 0) + 1);
    }

    const items = listings.flatMap((doc) => {
      try {
        const sellerId = doc.sellerAgentId?.toHexString() ?? "";
        const listingId = doc._id?.toHexString() ?? "";
        const preview = toListingPreview(doc);
        return [{
          ...preview,
          regions: preview.regions ?? [],
          columns: preview.columns ?? [],
          sellerName: sellerNameMap.get(sellerId) ?? "Seller",
          acquisitionCount: acquiredCount.get(listingId) ?? 0,
        }];
      } catch {
        return [];
      }
    });

    return Response.json({ items });
  } catch (e) {
    if (e instanceof Error && e.message.includes("MONGODB_URI")) {
      return jsonError(503, "Database is not configured");
    }
    return handleRouteError(e);
  }
}
