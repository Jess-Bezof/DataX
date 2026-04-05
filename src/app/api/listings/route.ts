import {
  assertRole,
  findAgentByApiKey,
  parseBearer,
  AuthError,
} from "@/lib/auth";
import {
  assertPayloadSize,
  assertSellerCanCreateListing,
  toListingPreview,
} from "@/lib/listings";
import { getDb, ensureIndexes } from "@/lib/mongo";
import { handleRouteError, jsonError } from "@/lib/api-helpers";
import { nonEmptyString } from "@/lib/validate";
import type { AgentDoc, ListingDoc } from "@/types/datax";

function parseISODate(v: unknown, field: string): Date {
  if (typeof v !== "string" || !v.trim()) {
    throw new Error(`Invalid ${field}`);
  }
  const d = new Date(v);
  if (Number.isNaN(d.getTime())) throw new Error(`Invalid ${field} date`);
  return d;
}

function parseStringArray(v: unknown, field: string, maxItems = 50): string[] {
  if (!Array.isArray(v)) throw new Error(`Invalid ${field}: expected array`);
  const out: string[] = [];
  for (const item of v) {
    if (typeof item !== "string" || !item.trim()) {
      throw new Error(`Invalid ${field}: all entries must be non-empty strings`);
    }
    out.push(item.trim());
    if (out.length > maxItems) throw new Error(`${field}: too many items`);
  }
  return out;
}

function parseSampleRow(v: unknown): Record<string, unknown> {
  if (v === null || typeof v !== "object" || Array.isArray(v)) {
    throw new Error("sampleRow must be a JSON object (not an array)");
  }
  return v as Record<string, unknown>;
}

export async function GET(req: Request) {
  try {
    await ensureIndexes();
    const db = await getDb();
    const { searchParams } = new URL(req.url);
    const limit = Math.min(
      100,
      Math.max(1, Number(searchParams.get("limit") ?? 50) || 50)
    );
    const cursor = db
      .collection<ListingDoc>("listings")
      .find({})
      .sort({ createdAt: -1 })
      .limit(limit);
    const docs = await cursor.toArray();
    return Response.json({
      listings: docs.map(toListingPreview),
    });
  } catch (e) {
    if (e instanceof Error && e.message.includes("MONGODB_URI")) {
      return jsonError(503, "Database is not configured");
    }
    return handleRouteError(e);
  }
}

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
    assertRole(agent, "seller");

    const body = await req.json();
    const title = nonEmptyString(body.title, "title", 200);
    const summary = nonEmptyString(body.summary, "summary", 4000);
    const validFrom = parseISODate(body.validFrom, "validFrom");
    const validTo = parseISODate(body.validTo, "validTo");
    if (validTo < validFrom) {
      return jsonError(400, "validTo must be on or after validFrom");
    }
    const regions = parseStringArray(body.regions ?? [], "regions");
    const columns = parseStringArray(body.columns, "columns", 200);
    if (columns.length === 0) {
      return jsonError(400, "columns must include at least one field name");
    }
    const sampleRow = parseSampleRow(body.sampleRow);
    const fullPayload = body.fullPayload;

    assertPayloadSize(fullPayload);

    await assertSellerCanCreateListing(
      db.collection<ListingDoc>("listings"),
      agent._id
    );

    const now = new Date();
    const listing = {
      sellerAgentId: agent._id,
      title,
      summary,
      validFrom,
      validTo,
      regions,
      columns,
      sampleRow,
      fullPayload,
      createdAt: now,
      updatedAt: now,
    };

    const res = await db.collection("listings").insertOne(listing);

    const inserted = await db
      .collection<ListingDoc>("listings")
      .findOne({ _id: res.insertedId });
    if (!inserted) return jsonError(500, "Failed to read listing");

    return Response.json({ listing: toListingPreview(inserted) });
  } catch (e) {
    if (e instanceof Error && e.message.includes("MONGODB_URI")) {
      return jsonError(503, "Database is not configured");
    }
    if (e instanceof AuthError) {
      return jsonError(e.status, e.message);
    }
    if (e instanceof Error && e.message.includes("publish one listing")) {
      return jsonError(429, e.message);
    }
    if (e instanceof Error && (e.message.startsWith("Invalid") || e.message.includes("maximum size"))) {
      return jsonError(400, e.message);
    }
    return handleRouteError(e);
  }
}
