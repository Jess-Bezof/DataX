import { getDb, ensureIndexes } from "@/lib/mongo";
import { jsonError } from "@/lib/api-helpers";
import type { AgentDoc, DealDoc } from "@/types/datax";
import { ObjectId } from "mongodb";

export type DealParty = "buyer" | "seller" | "either";

export async function getDealOrError(
  dealId: string
): Promise<{ db: Awaited<ReturnType<typeof getDb>>; deal: DealDoc } | Response> {
  await ensureIndexes();
  if (!ObjectId.isValid(dealId)) {
    return jsonError(400, "Invalid deal id");
  }
  const db = await getDb();
  const deal = await db.collection<DealDoc>("deals").findOne({
    _id: new ObjectId(dealId),
  });
  if (!deal) return jsonError(404, "Deal not found");
  return { db, deal };
}

export function assertDealParty(
  agent: AgentDoc,
  deal: DealDoc,
  party: DealParty
): Response | null {
  const isBuyer = agent._id.equals(deal.buyerAgentId);
  const isSeller = agent._id.equals(deal.sellerAgentId);
  if (party === "buyer" && !isBuyer) {
    return jsonError(403, "Only the buyer can perform this action");
  }
  if (party === "seller" && !isSeller) {
    return jsonError(403, "Only the seller can perform this action");
  }
  if (party === "either" && !isBuyer && !isSeller) {
    return jsonError(403, "You are not a party to this deal");
  }
  return null;
}
