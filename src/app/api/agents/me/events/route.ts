import { findAgentByApiKey, parseBearer, AuthError } from "@/lib/auth";
import { getDb, ensureIndexes } from "@/lib/mongo";
import { handleRouteError, jsonError } from "@/lib/api-helpers";
import type { AgentDoc } from "@/types/datax";
import type { AgentEventDoc } from "@/lib/notify";

/**
 * GET /api/agents/me/events
 *
 * Drains the agent's event inbox — returns all undelivered events and marks them
 * delivered.  Agents that don't expose a public webhook endpoint can call this
 * instead; they get the same payload shape as a webhook POST without needing an
 * inbound HTTPS server.
 *
 * Query params:
 *   ?limit=N  — max events to return per call (default 20, max 100)
 *
 * Response:
 *   { events: AgentEvent[], undeliveredRemaining: number }
 *
 * Recommended polling interval: 10 s when a deal is active, 60 s otherwise.
 * Each event is delivered exactly once — reconnecting does NOT re-deliver.
 */
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

    const url = new URL(request.url);
    const limitParam = parseInt(url.searchParams.get("limit") ?? "20", 10);
    const limit = Math.min(Math.max(1, isNaN(limitParam) ? 20 : limitParam), 100);

    const col = db.collection<AgentEventDoc>("agent_events");

    // Fetch undelivered events oldest-first so agents process in order.
    const events = await col
      .find({ agentId: agent._id, deliveredAt: null })
      .sort({ createdAt: 1 })
      .limit(limit)
      .toArray();

    if (events.length > 0) {
      const ids = events.map((e) => e._id);
      await col.updateMany(
        { _id: { $in: ids } },
        { $set: { deliveredAt: new Date() } }
      );
    }

    // Count how many are still pending after this batch (so agent knows to call again).
    const undeliveredRemaining = await col.countDocuments({
      agentId: agent._id,
      deliveredAt: null,
    });

    return Response.json({
      events: events.map((e) => ({
        eventId: e._id?.toString(),
        event: e.event,
        dealId: e.dealId,
        status: e.status,
        yourRole: e.role,
        counterAmount: e.counterAmount,
        counterCurrency: e.counterCurrency,
        agreedAmount: e.agreedAmount,
        agreedCurrency: e.agreedCurrency,
        sellerCryptoWallet: e.sellerCryptoWallet,
        nextHttp: e.nextHttp,
        createdAt: e.createdAt,
      })),
      undeliveredRemaining,
      /** When > 0, call this endpoint again immediately to drain the queue. */
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
