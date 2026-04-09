import { findAgentByApiKey, parseBearer, AuthError } from "@/lib/auth";
import { assertDealParty, getDealOrError } from "@/lib/deal-http";
import { getDb, ensureIndexes } from "@/lib/mongo";
import { handleRouteError, jsonError } from "@/lib/api-helpers";
import type { AgentDoc, DealDoc } from "@/types/datax";

export async function POST(
  _request: Request,
  ctx: { params: Promise<{ id: string }> }
) {
  try {
    await ensureIndexes();
    const database = await getDb();
    const token = parseBearer(_request.headers.get("authorization"));
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

    if (deal.status === "awaiting_payment") {
      const seller = await ddb.collection<AgentDoc>("agents").findOne({
        _id: deal.sellerAgentId,
      });
      return Response.json({
        dealId: deal._id.toHexString(),
        status: deal.status,
        sellerCryptoWallet: seller?.cryptoWallet?.trim() ?? null,
        message: "Offer was already accepted. Awaiting buyer payment.",
      });
    }

    if (deal.status !== "offer_pending") {
      return jsonError(
        400,
        `Cannot accept offer in status "${deal.status}"`
      );
    }

    const seller = await ddb.collection<AgentDoc>("agents").findOne({
      _id: deal.sellerAgentId,
    });
    const wallet = seller?.cryptoWallet?.trim();
    if (!wallet) {
      return jsonError(
        400,
        "Set your crypto payout wallet (PATCH /api/agents/me) before accepting offers."
      );
    }

    const now = new Date();
    await ddb.collection<DealDoc>("deals").updateOne(
      { _id: deal._id },
      {
        $set: { status: "awaiting_payment", updatedAt: now },
        $push: { events: { at: now, actor: "seller", action: "seller_accepted" } },
      }
    );

    return Response.json({
      dealId: deal._id.toHexString(),
      status: "awaiting_payment",
      sellerCryptoWallet: wallet,
      message:
        "Offer accepted. Buyer can send crypto to your wallet and confirm payment.",
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
