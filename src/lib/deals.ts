import type { DealStatus, ListingDoc } from "@/types/datax";

export const ACTIVE_DEAL_STATUSES: DealStatus[] = [
  "offer_pending",
  "seller_counter_pending",
  "awaiting_payment",
  "buyer_marked_sent",
];

export function parseDealProposal(body: Record<string, unknown>): {
  proposedAmount?: string;
  proposedCurrency?: string;
} {
  const amt = body.proposedAmount;
  const cur = body.proposedCurrency;
  let proposedAmount: string | undefined;
  let proposedCurrency: string | undefined;
  if (amt != null && amt !== "") {
    if (typeof amt !== "string" || !amt.trim()) {
      throw new Error("Invalid proposedAmount");
    }
    proposedAmount = amt.trim().slice(0, 40);
  }
  if (cur != null && cur !== "") {
    if (typeof cur !== "string" || !cur.trim()) {
      throw new Error("Invalid proposedCurrency");
    }
    proposedCurrency = cur.trim().slice(0, 24);
  }
  if ((proposedAmount && !proposedCurrency) || (!proposedAmount && proposedCurrency)) {
    throw new Error("Provide both proposedAmount and proposedCurrency, or neither");
  }
  return { proposedAmount, proposedCurrency };
}

export function initialDealStatus(
  hasProposal: boolean
): "offer_pending" | "awaiting_payment" {
  return hasProposal ? "offer_pending" : "awaiting_payment";
}

export function rankListings(
  docs: ListingDoc[],
  query: string,
  region?: string,
  topN = 4
): ListingDoc[] {
  const terms = query
    .trim()
    .split(/\s+/)
    .filter((t) => t.length >= 1)
    .map((t) => t.toLowerCase());
  const r = region?.trim().toLowerCase();

  const scored = docs.map((doc) => ({
    doc,
    score: scoreListing(doc, terms, r),
  }));
  scored.sort((a, b) => {
    if (b.score !== a.score) return b.score - a.score;
    return b.doc.createdAt.getTime() - a.doc.createdAt.getTime();
  });
  return scored.slice(0, topN).map((x) => x.doc);
}

function scoreListing(
  doc: ListingDoc,
  terms: string[],
  regionLower?: string
): number {
  let s = 0;
  const title = doc.title.toLowerCase();
  const summary = doc.summary.toLowerCase();
  const reg = doc.regions.join(" ").toLowerCase();
  const cols = doc.columns.join(" ").toLowerCase();
  for (const w of terms) {
    if (title.includes(w)) s += 6;
    if (summary.includes(w)) s += 2;
    if (reg.includes(w)) s += 4;
    if (cols.includes(w)) s += 1;
  }
  if (regionLower) {
    if (reg.includes(regionLower)) s += 5;
    if (summary.includes(regionLower)) s += 2;
    if (title.includes(regionLower)) s += 3;
  }
  return s;
}
