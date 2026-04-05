import {
  assertRole,
  findAgentByApiKey,
  parseBearer,
  AuthError,
} from "@/lib/auth";
import { rankListings } from "@/lib/deals";
import { buildSearchClause, toListingPreview } from "@/lib/listings";
import { getDb, ensureIndexes } from "@/lib/mongo";
import { handleRouteError, jsonError } from "@/lib/api-helpers";
import type { AgentDoc, ListingDoc } from "@/types/datax";

export async function POST(req: Request) {
  try {
    await ensureIndexes();
    const db = await getDb();
    const token = parseBearer(req.headers.get("authorization"));
    const agent = await findAgentByApiKey(
      db.collection<AgentDoc>("agents"),
      token
    );
    if (!agent) throw new AuthError(401, "Missing or invalid API key");
    assertRole(agent, "buyer");

    const body = await req.json();
    const query = typeof body.query === "string" ? body.query : "";
    const region =
      typeof body.region === "string" ? body.region : undefined;

    if (!query.trim() && !region?.trim()) {
      return jsonError(400, "Provide query and/or region");
    }

    const filter = buildSearchClause(query, region);
    const cursor = db
      .collection<ListingDoc>("listings")
      .find(filter)
      .sort({ createdAt: -1 })
      .limit(80);
    const pool = await cursor.toArray();
    const top = rankListings(pool, query, region, 4);

    return Response.json({
      results: top.map((d) => toListingPreview(d)),
      message:
        top.length === 0
          ? "No listings matched. Try broader terms or another region."
          : pool.length > top.length
            ? `Showing top ${top.length} by relevance (of ${pool.length} matches).`
            : undefined,
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
