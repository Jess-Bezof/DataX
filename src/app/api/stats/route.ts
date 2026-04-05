import { getDb, ensureIndexes } from "@/lib/mongo";
import { handleRouteError, jsonError } from "@/lib/api-helpers";

export async function GET() {
  try {
    await ensureIndexes();
    const db = await getDb();
    const [connectionsCount, registeredAgents, dealsReleased, dealsInProgress] =
      await Promise.all([
        db.collection("connection_events").countDocuments(),
        db.collection("agents").countDocuments(),
        db.collection("deals").countDocuments({ status: "released" }),
        db.collection("deals").countDocuments({
          status: {
            $in: [
              "offer_pending",
              "awaiting_payment",
              "buyer_marked_sent",
            ],
          },
        }),
      ]);
    return Response.json({
      connectionsCount,
      registeredAgents,
      dealsReleased,
      dealsInProgress,
    });
  } catch (e) {
    if (e instanceof Error && e.message.includes("MONGODB_URI")) {
      return jsonError(503, "Database is not configured");
    }
    return handleRouteError(e);
  }
}
