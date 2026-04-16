import { getDb, ensureIndexes } from "@/lib/mongo";
import { handleRouteError, jsonError } from "@/lib/api-helpers";
import { toListingPreview } from "@/lib/listings";
import type { AgentDoc, DealDoc, ListingDoc, RatingDoc } from "@/types/datax";
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

    const [agents, releasedDeals, sellerRatings, sellerReleasedDeals] = await Promise.all([
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
      db
        .collection<RatingDoc>("ratings")
        .find({ targetAgentId: { $in: sellerOids } })
        .project({ targetAgentId: 1, stars: 1 })
        .toArray(),
      db
        .collection<DealDoc>("deals")
        .find({ sellerAgentId: { $in: sellerOids }, status: "released" })
        .project({ sellerAgentId: 1, createdAt: 1, updatedAt: 1 })
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

    type SellerReputation = { sum: number; count: number };
    const sellerRepMap = new Map<string, SellerReputation>();
    for (const r of sellerRatings) {
      const key = (r as unknown as RatingDoc).targetAgentId.toHexString();
      const entry = sellerRepMap.get(key) ?? { sum: 0, count: 0 };
      entry.sum += (r as unknown as RatingDoc).stars;
      entry.count += 1;
      sellerRepMap.set(key, entry);
    }

    type SellerTiming = { totalMs: number; count: number };
    const sellerTimingMap = new Map<string, SellerTiming>();
    for (const d of sellerReleasedDeals) {
      const key = d.sellerAgentId.toHexString();
      const entry = sellerTimingMap.get(key) ?? { totalMs: 0, count: 0 };
      entry.totalMs += new Date(d.updatedAt).getTime() - new Date(d.createdAt).getTime();
      entry.count += 1;
      sellerTimingMap.set(key, entry);
    }

    const items = listings.flatMap((doc) => {
      try {
        const sellerId = doc.sellerAgentId?.toHexString() ?? "";
        const listingId = doc._id?.toHexString() ?? "";
        const preview = toListingPreview(doc);
        const rep = sellerRepMap.get(sellerId);
        const timing = sellerTimingMap.get(sellerId);
        return [{
          ...preview,
          regions: preview.regions ?? [],
          columns: preview.columns ?? [],
          sellerName: sellerNameMap.get(sellerId) ?? "Seller",
          acquisitionCount: acquiredCount.get(listingId) ?? 0,
          sellerAvgStars: rep ? Math.round((rep.sum / rep.count) * 100) / 100 : null,
          sellerTotalRatings: rep?.count ?? 0,
          sellerAvgCompletionMinutes: timing
            ? Math.round((timing.totalMs / timing.count / 60_000) * 10) / 10
            : null,
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
