import { getDb, ensureIndexes } from "@/lib/mongo";
import { handleRouteError, jsonError } from "@/lib/api-helpers";
import type { AgentDoc, DealDoc, ListingDoc } from "@/types/datax";
import { ObjectId } from "mongodb";

/** Public endpoint — no auth required. Returns event log + agent names for a deal. */
export async function GET(
  _request: Request,
  ctx: { params: Promise<{ id: string }> }
) {
  try {
    await ensureIndexes();
    const { id } = await ctx.params;
    if (!ObjectId.isValid(id)) {
      return jsonError(400, "Invalid deal id");
    }

    const db = await getDb();
    const deal = await db.collection<DealDoc>("deals").findOne({
      _id: new ObjectId(id),
    });
    if (!deal) return jsonError(404, "Deal not found");

    const [buyer, seller, listing] = await Promise.all([
      db.collection<AgentDoc>("agents").findOne({ _id: deal.buyerAgentId }, { projection: { displayName: 1 } }),
      db.collection<AgentDoc>("agents").findOne({ _id: deal.sellerAgentId }, { projection: { displayName: 1 } }),
      db.collection<ListingDoc>("listings").findOne({ _id: deal.listingId }, { projection: { title: 1 } }),
    ]);

    const events = (deal.events ?? []).map((e) => ({
      at: new Date(e.at).toISOString(),
      actor: e.actor,
      action: e.action,
      amount: e.amount ?? null,
      currency: e.currency ?? null,
      note: e.note ?? null,
    }));

    return Response.json({
      dealId: deal._id.toHexString(),
      status: deal.status,
      listingTitle: listing?.title ?? "(listing removed)",
      buyerName: buyer?.displayName ?? "Buyer",
      sellerName: seller?.displayName ?? "Seller",
      proposedAmount: deal.proposedAmount ?? null,
      proposedCurrency: deal.proposedCurrency ?? null,
      counterAmount: (deal as DealDoc & { counterAmount?: string }).counterAmount ?? null,
      counterCurrency: (deal as DealDoc & { counterCurrency?: string }).counterCurrency ?? null,
      createdAt: deal.createdAt.toISOString(),
      updatedAt: deal.updatedAt.toISOString(),
      events,
    });
  } catch (e) {
    if (e instanceof Error && e.message.includes("MONGODB_URI")) {
      return jsonError(503, "Database is not configured");
    }
    return handleRouteError(e);
  }
}
