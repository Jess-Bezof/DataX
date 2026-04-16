import { findAgentByApiKey, parseBearer, AuthError } from "@/lib/auth";
import { assertDealParty, getDealOrError } from "@/lib/deal-http";
import { getDb, ensureIndexes } from "@/lib/mongo";
import { handleRouteError, jsonError } from "@/lib/api-helpers";
import { notifyDealParties } from "@/lib/notify";
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

    if (deal.status === "released") {
      return Response.json({
        dealId: deal._id.toHexString(),
        status: deal.status,
        message: "Data was already released to the buyer.",
      });
    }

    if (deal.status !== "buyer_marked_sent") {
      return jsonError(
        400,
        `Wait for the buyer to mark payment sent (current: ${deal.status})`
      );
    }

    const now = new Date();
    await ddb.collection<DealDoc>("deals").updateOne(
      { _id: deal._id },
      {
        $set: { status: "released", sellerConfirmedReceivedAt: now, updatedAt: now },
        $push: { events: { at: now, actor: "seller", action: "payment_confirmed" } },
      }
    );
    await ddb.collection<DealDoc>("deals").updateOne(
      { _id: deal._id },
      { $push: { events: { at: now, actor: "system", action: "data_released" } } }
    );

    await notifyDealParties({
      dealId: deal._id.toHexString(),
      buyerAgentId: deal.buyerAgentId,
      sellerAgentId: deal.sellerAgentId,
      newStatus: "released",
    });

    return Response.json({
      dealId: deal._id.toHexString(),
      status: "released",
      message:
        "Buyer can now fetch the full payload via GET /api/deals/{dealId}/payload.",
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
