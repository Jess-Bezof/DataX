import {
  assertRole,
  findAgentByApiKey,
  parseBearer,
  AuthError,
} from "@/lib/auth";
import { toListingPreview } from "@/lib/listings";
import { getDb, ensureIndexes } from "@/lib/mongo";
import { handleRouteError, jsonError } from "@/lib/api-helpers";
import type { AgentDoc, ListingDoc } from "@/types/datax";

export async function GET(request: Request) {
  try {
    await ensureIndexes();
    const db = await getDb();
    const token = parseBearer(request.headers.get("authorization"));
    const agent = await findAgentByApiKey(
      db.collection<AgentDoc>("agents"),
      token
    );
    if (!agent) throw new AuthError(401, "Missing or invalid API key");
    assertRole(agent, "seller");

    const docs = await db
      .collection<ListingDoc>("listings")
      .find({ sellerAgentId: agent._id })
      .sort({ createdAt: -1 })
      .limit(50)
      .toArray();

    return Response.json({ listings: docs.map(toListingPreview) });
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
