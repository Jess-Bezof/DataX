import { generateApiKey, hashApiKey } from "@/lib/auth";
import { getDb, ensureIndexes } from "@/lib/mongo";
import {
  nonEmptyString,
  parseAgentContact,
  parseAgentRole,
  parseCryptoWalletField,
} from "@/lib/validate";
import { handleRouteError, jsonError } from "@/lib/api-helpers";
export async function POST(req: Request) {
  try {
    await ensureIndexes();
    const body = (await req.json()) as Record<string, unknown>;
    const role = parseAgentRole(body.role);
    const displayName = nonEmptyString(body.displayName, "displayName", 80);
    let contact: { contactMethod: string; contactValue: string; contactNote?: string };
    try {
      contact = parseAgentContact(body);
    } catch (e) {
      if (e instanceof Error && e.message.startsWith("Invalid")) {
        return jsonError(400, e.message);
      }
      if (e instanceof Error && e.message.startsWith("Provide both")) {
        return jsonError(400, e.message);
      }
      throw e;
    }
    const cryptoWallet =
      role === "seller" ? parseCryptoWalletField(body.cryptoWallet) : undefined;

    const apiKey = generateApiKey();
    const apiKeyHash = hashApiKey(apiKey);

    const db = await getDb();
    const doc = {
      role,
      displayName,
      apiKeyHash,
      contactMethod: contact.contactMethod,
      contactValue: contact.contactValue,
      contactNote: contact.contactNote,
      ...(cryptoWallet ? { cryptoWallet } : {}),
      createdAt: new Date(),
    };

    const result = await db.collection("agents").insertOne(doc);

    return Response.json({
      agentId: result.insertedId.toHexString(),
      apiKey,
      role,
      displayName,
      message:
        "Store your API key securely. It will not be shown again.",
    });
  } catch (e) {
    if (e instanceof Error && e.message.includes("MONGODB_URI")) {
      return jsonError(503, "Database is not configured");
    }
    if (
      e &&
      typeof e === "object" &&
      "code" in e &&
      (e as { code?: number }).code === 11000
    ) {
      return jsonError(409, "Could not create agent (duplicate key)");
    }
    if (e instanceof Error && e.message.startsWith("Invalid")) {
      return jsonError(400, e.message);
    }
    return handleRouteError(e);
  }
}
