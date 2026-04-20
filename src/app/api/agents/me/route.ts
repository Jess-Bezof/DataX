import {
  findAgentByApiKey,
  parseBearer,
  AuthError,
} from "@/lib/auth";
import { getDb, ensureIndexes } from "@/lib/mongo";
import { handleRouteError, jsonError } from "@/lib/api-helpers";
import { parseCryptoWalletField } from "@/lib/validate";
import { probeWebhookUrl, type WebhookProbeResult } from "@/lib/webhook-probe";
import type { AgentDoc } from "@/types/datax";

/** Update authenticated agent profile (cryptoWallet for sellers, webhookUrl for any role). */
export async function PATCH(request: Request) {
  try {
    await ensureIndexes();
    const db = await getDb();
    const token = parseBearer(request.headers.get("authorization"));
    const agent = await findAgentByApiKey(
      db.collection<AgentDoc>("agents"),
      token
    );
    if (!agent) throw new AuthError(401, "Missing or invalid API key");

    const body = (await request.json()) as Record<string, unknown>;
    if (
      !("cryptoWallet" in body) &&
      !("webhookUrl" in body) &&
      !("webhookSecret" in body) &&
      !("externalAgentCardUrl" in body) &&
      !("a2aDefaultPushToken" in body)
    ) {
      return jsonError(
        400,
        'Body must include "cryptoWallet" (sellers), "webhookUrl", "webhookSecret", "externalAgentCardUrl", and/or "a2aDefaultPushToken".'
      );
    }

    // --- cryptoWallet (sellers only) ---
    if ("cryptoWallet" in body) {
      if (agent.role !== "seller") {
        return jsonError(400, "Only sellers can set a crypto wallet");
      }
      if (body.cryptoWallet === "" || body.cryptoWallet === null) {
        await db.collection("agents").updateOne(
          { _id: agent._id },
          { $unset: { cryptoWallet: "" } }
        );
      } else {
        let wallet: string;
        try {
          const w = parseCryptoWalletField(body.cryptoWallet);
          if (!w) {
            return jsonError(400, "cryptoWallet cannot be empty unless clearing");
          }
          wallet = w;
        } catch (e) {
          if (e instanceof Error && e.message.startsWith("Invalid")) {
            return jsonError(400, e.message);
          }
          throw e;
        }
        await db.collection("agents").updateOne(
          { _id: agent._id },
          { $set: { cryptoWallet: wallet } }
        );
      }
    }

    // --- webhookSecret (any role) ---
    if ("webhookSecret" in body) {
      const secret = body.webhookSecret;
      if (secret === "" || secret === null) {
        await db.collection("agents").updateOne(
          { _id: agent._id },
          { $unset: { webhookSecret: "" } }
        );
      } else {
        if (typeof secret !== "string") {
          return jsonError(400, "webhookSecret must be a string or empty string to clear");
        }
        await db.collection("agents").updateOne(
          { _id: agent._id },
          { $set: { webhookSecret: secret.trim().slice(0, 500) } }
        );
      }
    }

    // --- webhookUrl (any role) ---
    // When setting a non-empty URL, fire a probe *after* saving so the caller
    // gets immediate feedback on whether their endpoint is reachable. The URL
    // is saved regardless of probe outcome (non-blocking).
    let probeResult: WebhookProbeResult | null = null;
    if ("webhookUrl" in body) {
      const url = body.webhookUrl;
      if (url === "" || url === null) {
        await db.collection("agents").updateOne(
          { _id: agent._id },
          { $unset: { webhookUrl: "", webhookProbeResult: "" } }
        );
      } else {
        if (typeof url !== "string" || !url.startsWith("https://")) {
          return jsonError(
            400,
            "webhookUrl must be an https:// URL, or empty string to clear"
          );
        }
        const trimmedUrl = url.trim().slice(0, 500);
        await db.collection("agents").updateOne(
          { _id: agent._id },
          { $set: { webhookUrl: trimmedUrl } }
        );

        // Re-read the latest secret to send with the probe (may have just been updated above).
        const latest = await db
          .collection<AgentDoc>("agents")
          .findOne({ _id: agent._id }, { projection: { webhookSecret: 1 } });
        const probeSecret = latest?.webhookSecret?.trim();

        probeResult = await probeWebhookUrl(trimmedUrl, probeSecret);

        // Persist probe result so delivery-health endpoint can return it without re-probing.
        await db.collection("agents").updateOne(
          { _id: agent._id },
          { $set: { webhookProbeResult: probeResult } }
        );
      }
    }

    // --- externalAgentCardUrl (A2A outbound push — any role) ---
    if ("externalAgentCardUrl" in body) {
      const cardUrl = body.externalAgentCardUrl;
      if (cardUrl === "" || cardUrl === null) {
        await db.collection("agents").updateOne(
          { _id: agent._id },
          { $unset: { externalAgentCardUrl: "" } }
        );
      } else {
        if (typeof cardUrl !== "string" || !cardUrl.startsWith("https://")) {
          return jsonError(400, "externalAgentCardUrl must be an https:// URL, or empty string to clear");
        }
        await db.collection("agents").updateOne(
          { _id: agent._id },
          { $set: { externalAgentCardUrl: cardUrl.trim().slice(0, 500) } }
        );
      }
    }

    // --- a2aDefaultPushToken (A2A outbound auth — any role) ---
    if ("a2aDefaultPushToken" in body) {
      const pushToken = body.a2aDefaultPushToken;
      if (pushToken === "" || pushToken === null) {
        await db.collection("agents").updateOne(
          { _id: agent._id },
          { $unset: { a2aDefaultPushToken: "" } }
        );
      } else {
        if (typeof pushToken !== "string") {
          return jsonError(400, "a2aDefaultPushToken must be a string or empty string to clear");
        }
        await db.collection("agents").updateOne(
          { _id: agent._id },
          { $set: { a2aDefaultPushToken: pushToken.trim().slice(0, 500) } }
        );
      }
    }

    const updated = await db.collection<AgentDoc>("agents").findOne({
      _id: agent._id,
    });

    return Response.json({
      displayName: updated?.displayName,
      role: updated?.role,
      cryptoWallet: updated?.cryptoWallet?.trim() || null,
      webhookUrl: updated?.webhookUrl || null,
      webhookSecret: updated?.webhookSecret ? "set" : null,
      externalAgentCardUrl: updated?.externalAgentCardUrl || null,
      a2aDefaultPushToken: updated?.a2aDefaultPushToken ? "set" : null,
      ...(probeResult !== null ? { webhookProbe: probeResult } : {}),
      message: "Profile updated.",
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
