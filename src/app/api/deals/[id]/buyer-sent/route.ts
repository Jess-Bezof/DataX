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

    const deny = assertDealParty(agent, deal, "buyer");
    if (deny) return deny;

    if (deal.status === "buyer_marked_sent") {
      return Response.json({
        dealId: deal._id.toHexString(),
        status: deal.status,
        message: "Payment was already marked as sent.",
      });
    }

    if (deal.status !== "awaiting_payment") {
      return jsonError(
        400,
        `Can only confirm payment while awaiting_payment (current: ${deal.status})`
      );
    }

    const now = new Date();
    await ddb.collection<DealDoc>("deals").updateOne(
      { _id: deal._id },
      {
        $set: {
          status: "buyer_marked_sent",
          buyerMarkedSentAt: now,
          updatedAt: now,
        },
      }
    );

    return Response.json({
      dealId: deal._id.toHexString(),
      status: "buyer_marked_sent",
      message:
        "Recorded. The seller must confirm they received the payment before data is released.",
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
