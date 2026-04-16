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

    const deny = assertDealParty(agent, deal, "buyer");
    if (deny) return deny;

    if (deal.status !== "seller_counter_pending") {
      return jsonError(
        400,
        `No counter-offer to accept (current: ${deal.status})`
      );
    }

    const seller = await ddb.collection<AgentDoc>("agents").findOne({
      _id: deal.sellerAgentId,
    });
    const wallet = seller?.cryptoWallet?.trim();
    if (!wallet) {
      return jsonError(
        400,
        "Seller has no crypto wallet set. They must PATCH /api/agents/me first."
      );
    }

    const now = new Date();
    await ddb.collection<DealDoc>("deals").updateOne(
      { _id: deal._id },
      {
        $set: { status: "awaiting_payment", updatedAt: now },
        $push: { events: { at: now, actor: "buyer", action: "buyer_accepted_counter", amount: deal.counterAmount, currency: deal.counterCurrency } },
      }
    );

    await notifyDealParties({
      dealId: deal._id.toHexString(),
      buyerAgentId: deal.buyerAgentId,
      sellerAgentId: deal.sellerAgentId,
      newStatus: "awaiting_payment",
      agreedAmount: deal.counterAmount,
      agreedCurrency: deal.counterCurrency,
      sellerCryptoWallet: wallet,
    });

    return Response.json({
      dealId: deal._id.toHexString(),
      status: "awaiting_payment",
      agreedAmount: deal.counterAmount,
      agreedCurrency: deal.counterCurrency,
      sellerCryptoWallet: wallet,
      message:
        "Counter-offer accepted. Send payment to seller wallet then POST buyer-sent.",
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
