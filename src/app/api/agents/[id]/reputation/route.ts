import { getDb, ensureIndexes } from "@/lib/mongo";
import { handleRouteError, jsonError } from "@/lib/api-helpers";
import type { DealDoc, RatingDoc } from "@/types/datax";
import { ObjectId } from "mongodb";

export async function GET(
  _request: Request,
  ctx: { params: Promise<{ id: string }> }
) {
  try {
    await ensureIndexes();
    const { id } = await ctx.params;
    if (!ObjectId.isValid(id)) {
      return jsonError(400, "Invalid agent id");
    }
    const agentId = new ObjectId(id);
    const db = await getDb();

    const agent = await db.collection("agents").findOne(
      { _id: agentId },
      { projection: { displayName: 1, role: 1 } }
    );
    if (!agent) return jsonError(404, "Agent not found");

    const ratings = await db
      .collection<RatingDoc>("ratings")
      .find({ targetAgentId: agentId })
      .toArray();

    const totalRatings = ratings.length;
    const starDistribution: Record<number, number> = { 1: 0, 2: 0, 3: 0, 4: 0, 5: 0 };
    let starSum = 0;
    for (const r of ratings) {
      starSum += r.stars;
      starDistribution[r.stars] = (starDistribution[r.stars] ?? 0) + 1;
    }
    const averageStars = totalRatings > 0 ? Math.round((starSum / totalRatings) * 100) / 100 : null;

    const isSeller = agent.role === "seller";

    let averageDealCompletionMinutes: number | null = null;
    let totalDealsCompleted = 0;

    if (isSeller) {
      const releasedDeals = await db
        .collection<DealDoc>("deals")
        .find({ sellerAgentId: agentId, status: "released" })
        .project({ createdAt: 1, updatedAt: 1, events: 1 })
        .toArray();

      totalDealsCompleted = releasedDeals.length;

      if (releasedDeals.length > 0) {
        let totalMs = 0;
        let counted = 0;
        for (const deal of releasedDeals) {
          const events = (deal as unknown as DealDoc).events ?? [];
          const created = events.find((e) => e.action === "deal_created");
          const released = events.find((e) => e.action === "data_released");
          if (created && released) {
            totalMs += new Date(released.at).getTime() - new Date(created.at).getTime();
            counted++;
          } else {
            totalMs += new Date(deal.updatedAt).getTime() - new Date(deal.createdAt).getTime();
            counted++;
          }
        }
        if (counted > 0) {
          averageDealCompletionMinutes = Math.round(totalMs / counted / 60_000 * 10) / 10;
        }
      }
    } else {
      const releasedDeals = await db
        .collection<DealDoc>("deals")
        .find({ buyerAgentId: agentId, status: "released" })
        .project({ _id: 1 })
        .toArray();
      totalDealsCompleted = releasedDeals.length;
    }

    return Response.json({
      agentId: id,
      displayName: agent.displayName,
      role: agent.role,
      averageStars,
      totalRatings,
      starDistribution,
      totalDealsCompleted,
      ...(isSeller ? { averageDealCompletionMinutes } : {}),
    });
  } catch (e) {
    if (e instanceof Error && e.message.includes("MONGODB_URI")) {
      return jsonError(503, "Database is not configured");
    }
    return handleRouteError(e);
  }
}
