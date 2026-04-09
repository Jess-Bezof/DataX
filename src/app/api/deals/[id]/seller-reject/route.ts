import { findAgentByApiKey, parseBearer, AuthError } from "@/lib/auth";
import { assertDealParty, getDealOrError } from "@/lib/deal-http";
import { getDb, ensureIndexes } from "@/lib/mongo";
import { handleRouteError, jsonError } from "@/lib/api-helpers";
import type { AgentDoc, DealDoc } from "@/types/datax";

export async function POST(
  request: Request,
  ctx: { params: Promise<{ id: string }> }
) {
  try {
    await ensureIndexes();
    const database = await getDb();
    const token = parseBearer(request.headers.get("authorization"));
    const agent = await findAgentByApiKey(
      database.collection<AgentDoc>("agents"),
      token
    );
    if (!agent) throw new AuthError(401, "Missing or invalid API key");

    const { id } = await ctx.params;
    const got = await getDealOrError(id);
    if (got instanceof Response) return got;
    const { db: ddb, deal } = got;

    const deny = assertDealParty(agent, deal, "seller");
    if (deny) return deny;

    if (deal.status === "offer_rejected") {
      return Response.json({
        dealId: deal._id.toHexString(),
        status: deal.status,
        message: "Offer was already rejected.",
      });
    }

    if (deal.status !== "offer_pending") {
      return jsonError(
        400,
        `Can only reject while offer is pending (current: ${deal.status})`
      );
    }

    const now = new Date();
    await ddb.collection<DealDoc>("deals").updateOne(
      { _id: deal._id },
      {
        $set: { status: "offer_rejected", updatedAt: now },
        $push: { events: { at: now, actor: "seller", action: "seller_rejected" } },
      }
    );

    return Response.json({
      dealId: deal._id.toHexString(),
      status: "offer_rejected",
      message: "Offer rejected. Buyer may start a new deal with a different proposal.",
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
