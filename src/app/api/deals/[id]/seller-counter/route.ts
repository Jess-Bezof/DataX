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

    if (deal.status !== "offer_pending") {
      return jsonError(
        400,
        `Can only counter while offer is pending (current: ${deal.status})`
      );
    }

    const body = await request.json().catch(() => ({}));
    const amt = body.counterAmount;
    const cur = body.counterCurrency;

    if (!amt || typeof amt !== "string" || !amt.trim()) {
      return jsonError(400, "counterAmount is required");
    }
    if (!cur || typeof cur !== "string" || !cur.trim()) {
      return jsonError(400, "counterCurrency is required");
    }

    const counterAmount = amt.trim().slice(0, 40);
    const counterCurrency = cur.trim().slice(0, 24);

    const now = new Date();
    await ddb.collection<DealDoc>("deals").updateOne(
      { _id: deal._id },
      {
        $set: {
          status: "seller_counter_pending",
          counterAmount,
          counterCurrency,
          updatedAt: now,
        },
        $push: { events: { at: now, actor: "seller", action: "seller_countered", amount: counterAmount, currency: counterCurrency } },
      }
    );

    return Response.json({
      dealId: deal._id.toHexString(),
      status: "seller_counter_pending",
      counterAmount,
      counterCurrency,
      message:
        "Counter-offer sent. Buyer can accept (POST buyer-accept-counter) or reject (POST buyer-reject-counter).",
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
