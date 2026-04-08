import { findAgentByApiKey, parseBearer, AuthError } from "@/lib/auth";
import { getDb, ensureIndexes } from "@/lib/mongo";
import { handleRouteError, jsonError } from "@/lib/api-helpers";
import type { AgentDoc, DealDoc, ListingDoc } from "@/types/datax";

/**
 * Machine-oriented: what this agent should do next, without a human narrating.
 * Agents should poll on an interval (see pollSuggestionSeconds) or after events.
 */
export async function GET(request: Request) {
  try {
    await ensureIndexes();
    const db = await getDb();
    const token = parseBearer(request.headers.get("authorization"));
    const agent = await findAgentByApiKey(
      db.collection<AgentDoc>("agents"),
      token
    );
    if (!agent) throw new AuthError(401, "Missing or invalid API key");

    const warnings: string[] = [];
    if (agent.role === "seller" && !agent.cryptoWallet?.trim()) {
      warnings.push(
        "Set cryptoWallet (PATCH /api/agents/me) so buyers can complete checkout."
      );
    }

    const dealsCol = db.collection<DealDoc>("deals");
    const listingsCol = db.collection<ListingDoc>("listings");

    type ActionItem = {
      dealId: string;
      listingTitle: string;
      status: string;
      yourRole: "seller" | "buyer";
      requiredAction: string;
      nextHttp: { method: string; path: string; note?: string }[];
    };

    const actionable: ActionItem[] = [];

    if (agent.role === "seller") {
      const pending = await dealsCol
        .find({
          sellerAgentId: agent._id,
          status: { $in: ["offer_pending", "buyer_marked_sent"] },
        })
        .sort({ updatedAt: 1 })
        .toArray();

      for (const d of pending) {
        const listing = await listingsCol.findOne({ _id: d.listingId });
        const id = d._id.toHexString();
        if (d.status === "offer_pending") {
          actionable.push({
            dealId: id,
            listingTitle: listing?.title ?? "(listing)",
            status: d.status,
            yourRole: "seller",
            requiredAction: "accept_reject_or_counter_buyers_price_proposal",
            nextHttp: [
              {
                method: "POST",
                path: `/api/deals/${id}/seller-accept`,
                note: "Requires cryptoWallet set first.",
              },
              { method: "POST", path: `/api/deals/${id}/seller-reject` },
              {
                method: "POST",
                path: `/api/deals/${id}/seller-counter`,
                note: "Body: { counterAmount, counterCurrency }",
              },
            ],
          });
        } else {
          actionable.push({
            dealId: id,
            listingTitle: listing?.title ?? "(listing)",
            status: d.status,
            yourRole: "seller",
            requiredAction: "confirm_you_received_crypto_payment",
            nextHttp: [
              {
                method: "POST",
                path: `/api/deals/${id}/seller-received`,
                note: "After this, buyer can GET payload.",
              },
            ],
          });
        }
      }
    } else {
      const awaitingPay = await dealsCol
        .find({
          buyerAgentId: agent._id,
          status: { $in: ["awaiting_payment", "seller_counter_pending"] },
        })
        .sort({ updatedAt: 1 })
        .toArray();

      const releasedRecent = await dealsCol
        .find({ buyerAgentId: agent._id, status: "released" })
        .sort({ updatedAt: -1 })
        .limit(5)
        .toArray();

      const buyerDeals = [...awaitingPay, ...releasedRecent];

      for (const d of buyerDeals) {
        const listing = await listingsCol.findOne({ _id: d.listingId });
        const id = d._id.toHexString();
        if (d.status === "seller_counter_pending") {
          actionable.push({
            dealId: id,
            listingTitle: listing?.title ?? "(listing)",
            status: d.status,
            yourRole: "buyer",
            requiredAction: "accept_or_reject_sellers_counter_offer",
            counterAmount: (d as { counterAmount?: string }).counterAmount,
            counterCurrency: (d as { counterCurrency?: string }).counterCurrency,
            nextHttp: [
              {
                method: "POST",
                path: `/api/deals/${id}/buyer-accept-counter`,
                note: "Accepts seller counter; returns sellerCryptoWallet.",
              },
              { method: "POST", path: `/api/deals/${id}/buyer-reject-counter` },
            ],
          });
        } else if (d.status === "awaiting_payment") {
          actionable.push({
            dealId: id,
            listingTitle: listing?.title ?? "(listing)",
            status: d.status,
            yourRole: "buyer",
            requiredAction: "pay_seller_wallet_offchain_then_mark_sent",
            nextHttp: [
              {
                method: "GET",
                path: "/api/deals",
                note: "Response includes sellerCryptoWallet for each deal row.",
              },
              {
                method: "POST",
                path: `/api/deals/${id}/buyer-sent`,
                note: "Call after you broadcast the transfer.",
              },
            ],
          });
        } else {
          actionable.push({
            dealId: id,
            listingTitle: listing?.title ?? "(listing)",
            status: d.status,
            yourRole: "buyer",
            requiredAction: "fetch_full_dataset_json",
            nextHttp: [
              {
                method: "GET",
                path: `/api/deals/${id}/payload`,
              },
            ],
          });
        }
      }
    }

    return Response.json({
      agentRole: agent.role,
      displayName: agent.displayName,
      /** Suggested interval for autonomous polling when not event-driven */
      pollSuggestionSeconds: 60,
      warnings,
      actionableCount: actionable.length,
      actionableDeals: actionable,
      reference:
        "Bundle docs/seller-agent/SKILL.md or docs/buyer-agent/SKILL.md in the agent context, or expose this API via MCP tools.",
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
