import { findAgentByApiKey, parseBearer, AuthError } from "@/lib/auth";
import { getDealOrError } from "@/lib/deal-http";
import { getDb, ensureIndexes } from "@/lib/mongo";
import { handleRouteError, jsonError } from "@/lib/api-helpers";
import type { AgentDoc, RatingDoc } from "@/types/datax";
import { RATING_TIMEOUT_MS } from "@/types/datax";

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
    const { db, deal } = got;

    const isBuyer = agent._id.equals(deal.buyerAgentId);
    const isSeller = agent._id.equals(deal.sellerAgentId);
    if (!isBuyer && !isSeller) {
      return jsonError(403, "You are not a party to this deal");
    }

    const raterRole = isBuyer ? "buyer" : "seller";

    if (isBuyer) {
      if (deal.status === "released") {
        // Happy path: buyer can rate after data is released
      } else if (deal.status === "buyer_marked_sent") {
        const sentAt = deal.buyerMarkedSentAt;
        if (!sentAt || Date.now() - new Date(sentAt).getTime() < RATING_TIMEOUT_MS) {
          return jsonError(
            400,
            "You can rate the seller after data is released, or 48 hours after marking payment sent if seller hasn't confirmed."
          );
        }
      } else {
        return jsonError(400, "You can only rate after the deal is released or 48h after marking payment sent.");
      }
    }

    if (isSeller) {
      if (deal.status !== "released") {
        return jsonError(400, "You can only rate the buyer after the deal is released.");
      }
    }

    const body = await request.json().catch(() => ({}));
    const stars = body.stars;
    if (typeof stars !== "number" || !Number.isInteger(stars) || stars < 1 || stars > 5) {
      return jsonError(400, "stars must be an integer from 1 to 5");
    }
    let comment: string | undefined;
    if (body.comment != null && body.comment !== "") {
      if (typeof body.comment !== "string") {
        return jsonError(400, "comment must be a string");
      }
      comment = body.comment.trim().slice(0, 300) || undefined;
    }

    const targetAgentId = isBuyer ? deal.sellerAgentId : deal.buyerAgentId;

    const ratingDoc: Omit<RatingDoc, "_id"> = {
      dealId: deal._id,
      listingId: deal.listingId,
      raterAgentId: agent._id,
      targetAgentId,
      raterRole,
      stars,
      ...(comment ? { comment } : {}),
      createdAt: new Date(),
    };

    try {
      await db.collection("ratings").insertOne(ratingDoc);
    } catch (e) {
      if (e && typeof e === "object" && "code" in e && (e as { code?: number }).code === 11000) {
        return jsonError(409, "You have already rated this deal.");
      }
      throw e;
    }

    return Response.json({
      dealId: deal._id.toHexString(),
      raterRole,
      stars,
      comment: comment ?? null,
      message: "Rating submitted.",
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
