import type { Db, ObjectId } from "mongodb";
import type { DealDoc, RatingDoc } from "@/types/datax";

export type AgentReputation = {
  averageStars: number | null;
  totalRatings: number;
  starDistribution: Record<string, number>;
  totalDealsCompleted: number;
  /** Sellers only. */
  averageDealCompletionMinutes?: number | null;
};

/** Compute the same reputation snapshot as /api/agents/:id/reputation. */
export async function computeAgentReputation(
  db: Db,
  agentId: ObjectId,
  role: "buyer" | "seller"
): Promise<AgentReputation> {
  const ratings = await db
    .collection<RatingDoc>("ratings")
    .find({ targetAgentId: agentId })
    .toArray();

  const totalRatings = ratings.length;
  const starDistribution: Record<string, number> = { "1": 0, "2": 0, "3": 0, "4": 0, "5": 0 };
  let starSum = 0;
  for (const r of ratings) {
    starSum += r.stars;
    const k = String(r.stars);
    starDistribution[k] = (starDistribution[k] ?? 0) + 1;
  }
  const averageStars =
    totalRatings > 0 ? Math.round((starSum / totalRatings) * 100) / 100 : null;

  if (role === "buyer") {
    const totalDealsCompleted = await db
      .collection<DealDoc>("deals")
      .countDocuments({ buyerAgentId: agentId, status: "released" });
    return { averageStars, totalRatings, starDistribution, totalDealsCompleted };
  }

  // seller — include avg completion time
  const releasedDeals = await db
    .collection<DealDoc>("deals")
    .find({ sellerAgentId: agentId, status: "released" })
    .project<{ createdAt: Date; updatedAt: Date; events?: DealDoc["events"] }>({
      createdAt: 1,
      updatedAt: 1,
      events: 1,
    })
    .toArray();

  let totalMs = 0;
  let counted = 0;
  for (const deal of releasedDeals) {
    const events = deal.events ?? [];
    const created = events.find((e) => e.action === "deal_created");
    const released = events.find((e) => e.action === "data_released");
    if (created && released) {
      totalMs += new Date(released.at).getTime() - new Date(created.at).getTime();
    } else {
      totalMs += new Date(deal.updatedAt).getTime() - new Date(deal.createdAt).getTime();
    }
    counted++;
  }
  const averageDealCompletionMinutes =
    counted > 0 ? Math.round((totalMs / counted / 60_000) * 10) / 10 : null;

  return {
    averageStars,
    totalRatings,
    starDistribution,
    totalDealsCompleted: releasedDeals.length,
    averageDealCompletionMinutes,
  };
}
