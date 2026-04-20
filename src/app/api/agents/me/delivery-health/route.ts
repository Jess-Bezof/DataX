import { findAgentByApiKey, parseBearer, AuthError } from "@/lib/auth";
import { getDb, ensureIndexes } from "@/lib/mongo";
import { handleRouteError, jsonError } from "@/lib/api-helpers";
import type { AgentDoc } from "@/types/datax";
import type { AgentEventDoc } from "@/lib/notify";
import type { A2APushConfigDoc } from "@/types/datax";

/**
 * GET /api/agents/me/delivery-health
 *
 * Returns the current delivery configuration for the authenticated agent and
 * a `recommendedAction` hint when something looks misconfigured.
 *
 * Does NOT fire a live probe on every call — it returns the cached result
 * from the most recent PATCH /api/agents/me. To trigger a fresh probe, the
 * operator should call PATCH /api/agents/me with the same webhookUrl again.
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

    // --- inbox pending count ---
    const inboxPendingCount = await db
      .collection<AgentEventDoc>("agent_events")
      .countDocuments({ agentId: agent._id, deliveredAt: null });

    // --- webhook ---
    const webhookUrl = agent.webhookUrl?.trim() || null;
    const webhookProbeResult = agent.webhookProbeResult ?? null;

    // --- A2A per-task push configs ---
    const a2aPushConfigCount = await db
      .collection<A2APushConfigDoc>("a2a_push_configs")
      .countDocuments({ agentId: agent._id });

    // --- externalAgentCardUrl ---
    const externalAgentCardUrl = agent.externalAgentCardUrl?.trim() || null;

    // --- build recommendedAction hint ---
    const hints: string[] = [];

    if (inboxPendingCount > 0) {
      hints.push(
        `${inboxPendingCount} undelivered inbox event${inboxPendingCount === 1 ? "" : "s"} — call GET /api/agents/me/events to drain`
      );
    }

    if (webhookUrl && webhookProbeResult && !webhookProbeResult.ok) {
      const detail = webhookProbeResult.error
        ? ` (${webhookProbeResult.error})`
        : webhookProbeResult.statusCode
          ? ` (HTTP ${webhookProbeResult.statusCode})`
          : "";
      hints.push(
        `webhookUrl is set but last probe failed${detail} — check your endpoint is running, then call PATCH /api/agents/me to re-probe`
      );
    }

    if (!webhookUrl && a2aPushConfigCount === 0 && !externalAgentCardUrl) {
      hints.push(
        "No push delivery configured — events accumulate in the inbox. Set webhookUrl via PATCH /api/agents/me to enable push, or poll GET /api/agents/me/events."
      );
    }

    const recommendedAction = hints.length > 0 ? hints.join(" | ") : null;

    return Response.json({
      agentId: agent._id.toHexString(),
      role: agent.role,
      inboxAvailable: true,
      inboxPendingCount,
      webhook: {
        configured: Boolean(webhookUrl),
        url: webhookUrl,
        lastProbe: webhookProbeResult
          ? {
              ok: webhookProbeResult.ok,
              statusCode: webhookProbeResult.statusCode ?? null,
              error: webhookProbeResult.error ?? null,
              at: new Date(webhookProbeResult.at).toISOString(),
            }
          : null,
      },
      a2aPushConfigs: {
        count: a2aPushConfigCount,
      },
      externalAgentCard: {
        configured: Boolean(externalAgentCardUrl),
        url: externalAgentCardUrl,
      },
      recommendedAction,
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
