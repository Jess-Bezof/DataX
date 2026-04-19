import { ObjectId } from "mongodb";
import { handleRouteError, jsonError } from "@/lib/api-helpers";
import { ensureIndexes, getDb } from "@/lib/mongo";
import { signedSellerPublicCard } from "@/lib/a2a/cards";
import { getMarketplaceBaseUrl } from "@/lib/a2a/env";
import type { AgentDoc } from "@/types/datax";

export async function GET(
  request: Request,
  ctx: { params: Promise<{ id: string }> }
) {
  try {
    await ensureIndexes();
    const { id } = await ctx.params;
    if (!ObjectId.isValid(id)) return jsonError(400, "Invalid agent id");

    const db = await getDb();
    const agent = await db
      .collection<AgentDoc>("agents")
      .findOne({ _id: new ObjectId(id) });
    if (!agent) return jsonError(404, "Agent not found");

    const baseUrl = getMarketplaceBaseUrl(request);
    const card = await signedSellerPublicCard(db, agent, baseUrl);
    return Response.json(card, {
      headers: {
        "Cache-Control": "public, max-age=60, s-maxage=300",
        "Content-Type": "application/a2a+json; charset=utf-8",
      },
    });
  } catch (e) {
    if (e instanceof Error && e.message.includes("MONGODB_URI")) {
      return jsonError(503, "Database is not configured");
    }
    return handleRouteError(e);
  }
}
