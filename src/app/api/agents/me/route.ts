import {
  findAgentByApiKey,
  parseBearer,
  AuthError,
} from "@/lib/auth";
import { getDb, ensureIndexes } from "@/lib/mongo";
import { handleRouteError, jsonError } from "@/lib/api-helpers";
import { parseCryptoWalletField } from "@/lib/validate";
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
    if (!("cryptoWallet" in body) && !("webhookUrl" in body) && !("webhookSecret" in body)) {
      return jsonError(
        400,
        'Body must include "cryptoWallet" (sellers), "webhookUrl", and/or "webhookSecret".'
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
    if ("webhookUrl" in body) {
      const url = body.webhookUrl;
      if (url === "" || url === null) {
        await db.collection("agents").updateOne(
          { _id: agent._id },
          { $unset: { webhookUrl: "" } }
        );
      } else {
        if (typeof url !== "string" || !url.startsWith("https://")) {
          return jsonError(
            400,
            "webhookUrl must be an https:// URL, or empty string to clear"
          );
        }
        await db.collection("agents").updateOne(
          { _id: agent._id },
          { $set: { webhookUrl: url.trim().slice(0, 500) } }
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
      webhookUrl: (updated as AgentDoc & { webhookUrl?: string })?.webhookUrl || null,
      webhookSecret: (updated as AgentDoc & { webhookSecret?: string })?.webhookSecret ? "set" : null,
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
