import { getDb, ensureIndexes } from "@/lib/mongo";
import { toListingPreview } from "@/lib/listings";
import { handleRouteError, jsonError } from "@/lib/api-helpers";
import type { ListingDoc } from "@/types/datax";
import { ObjectId } from "mongodb";

export async function GET(
  _req: Request,
  ctx: { params: Promise<{ id: string }> }
) {
  try {
    await ensureIndexes();
    const { id } = await ctx.params;
    if (!ObjectId.isValid(id)) {
      return jsonError(400, "Invalid listing id");
    }
    const db = await getDb();
    const doc = await db.collection<ListingDoc>("listings").findOne({
      _id: new ObjectId(id),
    });
    if (!doc) return jsonError(404, "Listing not found");
    return Response.json({ listing: toListingPreview(doc) });
  } catch (e) {
    if (e instanceof Error && e.message.includes("MONGODB_URI")) {
      return jsonError(503, "Database is not configured");
    }
    return handleRouteError(e);
  }
}
