import type { ObjectId } from "mongodb";
import type { ListingDoc, ListingPreview } from "@/types/datax";

export function toListingPreview(doc: ListingDoc): ListingPreview {
  return {
    id: doc._id.toHexString(),
    title: doc.title,
    summary: doc.summary,
    validFrom: new Date(doc.validFrom).toISOString(),
    validTo: new Date(doc.validTo).toISOString(),
    regions: doc.regions,
    columns: doc.columns,
    sampleRow: doc.sampleRow,
    ...(doc.askingPrice !== undefined && { askingPrice: doc.askingPrice }),
    ...(doc.askingCurrency !== undefined && { askingCurrency: doc.askingCurrency }),
    ...(doc.industry !== undefined && { industry: doc.industry }),
    ...(doc.dataType !== undefined && { dataType: doc.dataType }),
  };
}

export function buildSearchClause(query: string, region?: string) {
  const terms = query
    .trim()
    .split(/\s+/)
    .filter((t) => t.length >= 1);
  if (terms.length === 0 && !region?.trim()) {
    return {};
  }
  const and: object[] = [];
  for (const t of terms) {
    const re = new RegExp(escapeRegex(t), "i");
    and.push({
      $or: [
        { title: { $regex: re } },
        { summary: { $regex: re } },
        { regions: { $regex: re } },
        { columns: { $regex: re } },
      ],
    });
  }
  if (region?.trim()) {
    const rre = new RegExp(escapeRegex(region.trim()), "i");
    and.push({
      $or: [{ regions: { $regex: rre } }, { summary: { $regex: rre } }],
    });
  }
  return and.length ? { $and: and } : {};
}

function escapeRegex(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

export const LISTING_COOLDOWN_MS = 24 * 60 * 60 * 1000;

export async function assertSellerCanCreateListing(
  listings: import("mongodb").Collection<ListingDoc>,
  sellerAgentId: ObjectId
): Promise<void> {
  const last = await listings.findOne(
    { sellerAgentId },
    { sort: { createdAt: -1 } }
  );
  if (!last) return;
  const elapsed = Date.now() - last.createdAt.getTime();
  if (elapsed < LISTING_COOLDOWN_MS) {
    const waitMin = Math.ceil((LISTING_COOLDOWN_MS - elapsed) / 60000);
    throw new Error(
      `You can publish one listing per 24 hours. Try again in ~${waitMin} min.`
    );
  }
}

const MAX_PAYLOAD_BYTES = 512 * 1024;

export function assertPayloadSize(fullPayload: unknown): void {
  if (fullPayload === undefined) {
    throw new Error("Invalid fullPayload: required (JSON object, array, or scalar)");
  }
  let s: string;
  try {
    const raw = JSON.stringify(fullPayload);
    if (typeof raw !== "string") {
      throw new Error(
        "Invalid fullPayload: must be JSON-serializable (e.g. not undefined or a function)"
      );
    }
    s = raw;
  } catch (e) {
    if (e instanceof Error && e.message.startsWith("Invalid fullPayload")) throw e;
    throw new Error("Invalid fullPayload: not JSON-serializable");
  }
  if (Buffer.byteLength(s, "utf8") > MAX_PAYLOAD_BYTES) {
    throw new Error("fullPayload exceeds maximum size (512KB)");
  }
}
