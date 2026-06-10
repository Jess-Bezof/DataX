import { findAgentByApiKey, parseBearer, AuthError } from "@/lib/auth";
import { assertDealParty, getDealOrError } from "@/lib/deal-http";
import { getDb, ensureIndexes } from "@/lib/mongo";
import { handleRouteError, jsonError } from "@/lib/api-helpers";
import { notifyDealParties } from "@/lib/notify";
import {
  buildPaymentRequirements,
  verifyPayment,
  usdcToAtomic,
} from "@/lib/x402";
import type { AgentDoc, ListingDoc, DealDoc } from "@/types/datax";

export async function GET(
  request: Request,
  ctx: { params: Promise<{ id: string }> }
) {
  try {
    await ensureIndexes();
    const database = await getDb();
    const token = parseBearer(request.headers.get("authorization"));
    const agent = await findAgentByApiKey(
      database.collection<AgentDoc>("agents"),
      token
    );
    if (!agent) throw new AuthError(401, "Missing or invalid API key");

    const { id } = await ctx.params;
    const got = await getDealOrError(id);
    if (got instanceof Response) return got;
    const { db: ddb, deal } = got;

    const deny = assertDealParty(agent, deal, "buyer");
    if (deny) return deny;

    // --- X402: handle awaiting_payment ---
    if (deal.status === "awaiting_payment") {
      const xPaymentHeader = request.headers.get("x-payment");

      // No payment header → return 402 with requirements
      if (!xPaymentHeader) {
        const seller = await ddb
          .collection<AgentDoc>("agents")
          .findOne({ _id: deal.sellerAgentId });
        const sellerWallet = seller?.cryptoWallet?.trim();
        if (!sellerWallet) {
          return jsonError(400, "Seller has no payout wallet configured.");
        }

        const agreedAmount =
          (deal.counterAmount ?? deal.proposedAmount) || "0";

        const requirements = buildPaymentRequirements({
          dealId: deal._id.toHexString(),
          agreedAmount,
          sellerWallet,
          resourceUrl: `${process.env.NEXT_PUBLIC_BASE_URL ?? "https://data-xaidar.vercel.app"}/api/deals/${id}/payload`,
        });

        return new Response(
          JSON.stringify({
            error: "Payment required",
            paymentRequirements: requirements,
          }),
          {
            status: 402,
            headers: {
              "Content-Type": "application/json",
              "X-Payment-Requirements": JSON.stringify(requirements),
            },
          }
        );
      }

      // Payment header present → verify on-chain and release
      let txHash: string;
      try {
        const parsed = JSON.parse(xPaymentHeader);
        txHash = parsed.txHash ?? parsed.tx_hash ?? parsed.hash ?? "";
      } catch {
        return jsonError(400, "Invalid X-Payment header (expected JSON with txHash)");
      }

      if (!txHash || !txHash.startsWith("0x")) {
        return jsonError(400, "X-Payment must include a valid txHash (0x...)");
      }

      const seller = await ddb
        .collection<AgentDoc>("agents")
        .findOne({ _id: deal.sellerAgentId });
      const sellerWallet = seller?.cryptoWallet?.trim();
      if (!sellerWallet) {
        return jsonError(400, "Seller has no payout wallet configured.");
      }

      const agreedAmount = (deal.counterAmount ?? deal.proposedAmount) || "0";
      const minAmount = usdcToAtomic(agreedAmount);

      const verification = await verifyPayment({
        txHash,
        expectedTo: sellerWallet,
        minAmount,
      });

      if (!verification.ok) {
        return new Response(
          JSON.stringify({ error: `Payment verification failed: ${verification.error}` }),
          {
            status: 402,
            headers: { "Content-Type": "application/json" },
          }
        );
      }

      // Payment verified — transition to released
      const now = new Date();
      await ddb.collection<DealDoc>("deals").updateOne(
        { _id: deal._id },
        {
          $set: { status: "released", sellerConfirmedReceivedAt: now, updatedAt: now },
          $push: {
            events: {
              $each: [
                { at: now, actor: "buyer" as const, action: "payment_sent" as const },
                { at: now, actor: "seller" as const, action: "payment_confirmed" as const },
                { at: now, actor: "system" as const, action: "data_released" as const },
              ],
            },
          },
        }
      );

      await notifyDealParties({
        dealId: deal._id.toHexString(),
        buyerAgentId: deal.buyerAgentId,
        sellerAgentId: deal.sellerAgentId,
        newStatus: "released",
      });

      // Fall through to return payload below (re-fetch updated deal)
      const listing = await ddb.collection<ListingDoc>("listings").findOne({
        _id: deal.listingId,
      });
      if (!listing) return jsonError(404, "Listing no longer exists");

      return Response.json({
        dealId: deal._id.toHexString(),
        listingId: listing._id.toHexString(),
        fullPayload: listing.fullPayload,
        paymentVerified: true,
        txHash,
      });
    }

    // --- Normal released path ---
    if (deal.status !== "released") {
      return jsonError(
        403,
        `Full payload is available only after the deal is released (current: ${deal.status})`
      );
    }

    const listing = await ddb.collection<ListingDoc>("listings").findOne({
      _id: deal.listingId,
    });
    if (!listing) return jsonError(404, "Listing no longer exists");

    return Response.json({
      dealId: deal._id.toHexString(),
      listingId: listing._id.toHexString(),
      fullPayload: listing.fullPayload,
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
