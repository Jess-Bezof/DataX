import {
  findAgentByApiKey,
  parseBearer,
  assertRole,
  AuthError,
} from "@/lib/auth";
import { getDb, ensureIndexes } from "@/lib/mongo";
import { handleRouteError, jsonError } from "@/lib/api-helpers";
import { parseCryptoWalletField } from "@/lib/validate";
import type { AgentDoc } from "@/types/datax";

/** Update authenticated seller profile (crypto wallet for manual payouts). */
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
    assertRole(agent, "seller");

    const body = (await request.json()) as Record<string, unknown>;
    if (!("cryptoWallet" in body)) {
      return jsonError(
        400,
        'Body must include "cryptoWallet" (string, or empty string to clear).'
      );
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

    const updated = await db.collection<AgentDoc>("agents").findOne({
      _id: agent._id,
    });

    return Response.json({
      displayName: updated?.displayName,
      cryptoWallet: updated?.cryptoWallet?.trim() || null,
      message:
        body.cryptoWallet === "" || body.cryptoWallet === null
          ? "Crypto wallet cleared."
          : "Crypto wallet saved.",
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
