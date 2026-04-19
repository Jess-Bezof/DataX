import { AuthError, findAgentByApiKey, parseBearer } from "@/lib/auth";
import { handleRouteError, jsonError } from "@/lib/api-helpers";
import { ensureIndexes, getDb } from "@/lib/mongo";
import { signedMarketplaceExtendedCard } from "@/lib/a2a/cards";
import { getMarketplaceBaseUrl } from "@/lib/a2a/env";
import type { AgentDoc } from "@/types/datax";

export async function GET(request: Request) {
  try {
    await ensureIndexes();
    const token = parseBearer(request.headers.get("authorization"));
    const db = await getDb();
    const agent = await findAgentByApiKey(
      db.collection<AgentDoc>("agents"),
      token
    );
    if (!agent) {
      return new Response(
        JSON.stringify({ error: "Missing or invalid API key" }),
        {
          status: 401,
          headers: {
            "WWW-Authenticate": 'Bearer realm="DataX A2A"',
            "Content-Type": "application/json",
          },
        }
      );
    }

    const baseUrl = getMarketplaceBaseUrl(request);
    const card = await signedMarketplaceExtendedCard(baseUrl, agent);
    return Response.json(card, {
      headers: {
        "Cache-Control": "private, no-store",
        "Content-Type": "application/a2a+json; charset=utf-8",
      },
    });
  } catch (e) {
    if (e instanceof AuthError) return jsonError(e.status, e.message);
    if (e instanceof Error && e.message.includes("MONGODB_URI")) {
      return jsonError(503, "Database is not configured");
    }
    return handleRouteError(e);
  }
}
