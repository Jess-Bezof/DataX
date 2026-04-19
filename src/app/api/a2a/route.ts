import { dispatchA2A } from "@/lib/a2a/dispatcher";
import { ensureIndexes, getDb } from "@/lib/mongo";
import { jsonError } from "@/lib/api-helpers";

// Vercel Pro upgrade path: uncomment the next line to raise the function timeout
// to 5 minutes; combine with A2A_SSE_STREAM_TTL_MS=270000. On Hobby (default)
// leaving it commented keeps us within the 60s cap.
// export const maxDuration = 300;

export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  try {
    await ensureIndexes();
    const db = await getDb();
    return await dispatchA2A(request, { db });
  } catch (e) {
    if (e instanceof Error && e.message.includes("MONGODB_URI")) {
      return jsonError(503, "Database is not configured");
    }
    console.error("[a2a] route error:", e);
    return jsonError(500, e instanceof Error ? e.message : "Internal error");
  }
}
