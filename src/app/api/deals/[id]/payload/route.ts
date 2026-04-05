import { findAgentByApiKey, parseBearer, AuthError } from "@/lib/auth";
import { assertDealParty, getDealOrError } from "@/lib/deal-http";
import { getDb, ensureIndexes } from "@/lib/mongo";
import { handleRouteError, jsonError } from "@/lib/api-helpers";
import type { AgentDoc, ListingDoc } from "@/types/datax";

export async function GET(
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

    if (deal.status !== "released") {
      return jsonError(
        403,
        `Full payload is available only after the deal is released (current: ${deal.status})`
      );
    }

    const listing = await ddb.collection<ListingDoc>("listings").findOne({
      _id: deal.listingId,
    });
    if (!listing) return jsonError(404, "Listing no longer exists");

    return Response.json({
      dealId: deal._id.toHexString(),
      listingId: listing._id.toHexString(),
      fullPayload: listing.fullPayload,
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
