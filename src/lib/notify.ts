import { getDb } from "@/lib/mongo";
import type { AgentDoc, DealStatus } from "@/types/datax";
import type { ObjectId } from "mongodb";

export type AgentEventDoc = {
  agentId: ObjectId;
  role: "buyer" | "seller";
  event: "deal_updated";
  dealId: string;
  status: DealStatus;
  counterAmount?: string;
  counterCurrency?: string;
  agreedAmount?: string;
  agreedCurrency?: string;
  sellerCryptoWallet?: string;
  nextHttp: { method: string; path: string; note?: string }[];
  createdAt: Date;
  deliveredAt: Date | null;
};

type NextHttp = { method: string; path: string; note?: string };

type NotifyPayload = {
  event: "deal_updated";
  dealId: string;
  status: DealStatus;
  yourRole: "buyer" | "seller";
  counterAmount?: string;
  counterCurrency?: string;
  agreedAmount?: string;
  agreedCurrency?: string;
  sellerCryptoWallet?: string;
  nextHttp: NextHttp[];
};

/** Fire-and-forget webhook POST. Silently ignores all errors. */
async function fireWebhook(url: string, payload: NotifyPayload, secret?: string): Promise<void> {
  try {
    console.log(`[notify] firing webhook to ${url} status=${payload.status} role=${payload.yourRole}`);
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 25000);
    const headers: Record<string, string> = { "Content-Type": "application/json" };
    if (secret) headers["Authorization"] = `Bearer ${secret}`;
    const res = await fetch(url, {
      method: "POST",
      headers,
      body: JSON.stringify(payload),
      signal: controller.signal,
    });
    clearTimeout(timeout);
    console.log(`[notify] webhook response ${res.status} from ${url}`);
  } catch (e) {
    console.error(`[notify] webhook failed for ${url}:`, e instanceof Error ? e.message : e);
  }
}

function buildNextHttp(
  role: "buyer" | "seller",
  id: string,
  status: DealStatus,
  sellerWallet?: string
): NextHttp[] {
  if (role === "buyer") {
    switch (status) {
      case "seller_counter_pending":
        return [
          { method: "POST", path: `/api/deals/${id}/buyer-accept-counter`, note: "Returns sellerCryptoWallet." },
          { method: "POST", path: `/api/deals/${id}/buyer-reject-counter` },
          { method: "POST", path: `/api/deals/${id}/buyer-counter`, note: "Body: { counterAmount, counterCurrency }" },
        ];
      case "awaiting_payment":
        return [
          { method: "POST", path: `/api/deals/${id}/buyer-sent`, note: sellerWallet ? `Send payment to ${sellerWallet} first` : "Send payment to seller wallet first" },
        ];
      case "released":
        return [{ method: "GET", path: `/api/deals/${id}/payload` }];
      default:
        return [];
    }
  } else {
    switch (status) {
      case "offer_pending":
        return [
          { method: "POST", path: `/api/deals/${id}/seller-accept`, note: "Requires cryptoWallet set first." },
          { method: "POST", path: `/api/deals/${id}/seller-reject` },
          { method: "POST", path: `/api/deals/${id}/seller-counter`, note: "Body: { counterAmount, counterCurrency }" },
        ];
      case "buyer_counter_pending":
        return [
          { method: "POST", path: `/api/deals/${id}/seller-accept` },
          { method: "POST", path: `/api/deals/${id}/seller-reject` },
          { method: "POST", path: `/api/deals/${id}/seller-counter`, note: "Body: { counterAmount, counterCurrency }" },
        ];
      case "buyer_marked_sent":
        return [{ method: "POST", path: `/api/deals/${id}/seller-received` }];
      default:
        return [];
    }
  }
}

/**
 * Notify both deal parties of a state change via their registered webhookUrl.
 * Must be awaited before returning the HTTP response — Vercel serverless stops
 * execution once a response is sent, so fire-and-forget does not work.
 * Swallows all errors so deal routes always succeed regardless of webhook status.
 */
export async function notifyDealParties(params: {
  dealId: string;
  buyerAgentId: ObjectId;
  sellerAgentId: ObjectId;
  newStatus: DealStatus;
  counterAmount?: string;
  counterCurrency?: string;
  agreedAmount?: string;
  agreedCurrency?: string;
  sellerCryptoWallet?: string;
}): Promise<void> {
  try {
    const db = await getDb();
    const [buyer, seller] = await Promise.all([
      db.collection<AgentDoc>("agents").findOne(
        { _id: params.buyerAgentId },
        { projection: { webhookUrl: 1, webhookSecret: 1 } }
      ),
      db.collection<AgentDoc>("agents").findOne(
        { _id: params.sellerAgentId },
        { projection: { webhookUrl: 1, webhookSecret: 1 } }
      ),
    ]);

    const id = params.dealId;
    const s = params.newStatus;
    const fires: Promise<void>[] = [];

    const buyerWebhook = (buyer as (AgentDoc & { webhookUrl?: string }) | null)?.webhookUrl;
    const sellerWebhook = (seller as (AgentDoc & { webhookUrl?: string }) | null)?.webhookUrl;
    const buyerSecret = (buyer as (AgentDoc & { webhookSecret?: string }) | null)?.webhookSecret;
    const sellerSecret = (seller as (AgentDoc & { webhookSecret?: string }) | null)?.webhookSecret;

    console.log(`[notify] dealId=${id} status=${s} buyerWebhook=${buyerWebhook ?? "none"} sellerWebhook=${sellerWebhook ?? "none"}`);

    // Always write to the event inbox so agents without a public server can poll for events.
    const now = new Date();
    const inboxWrites: Promise<unknown>[] = [];
    if (buyer) {
      inboxWrites.push(db.collection<AgentEventDoc>("agent_events").insertOne({
        agentId: buyer._id,
        role: "buyer",
        event: "deal_updated",
        dealId: id,
        status: s,
        counterAmount: params.counterAmount,
        counterCurrency: params.counterCurrency,
        agreedAmount: params.agreedAmount,
        agreedCurrency: params.agreedCurrency,
        sellerCryptoWallet: params.sellerCryptoWallet,
        nextHttp: buildNextHttp("buyer", id, s, params.sellerCryptoWallet),
        createdAt: now,
        deliveredAt: null,
      }));
    }
    if (seller) {
      inboxWrites.push(db.collection<AgentEventDoc>("agent_events").insertOne({
        agentId: seller._id,
        role: "seller",
        event: "deal_updated",
        dealId: id,
        status: s,
        counterAmount: params.counterAmount,
        counterCurrency: params.counterCurrency,
        agreedAmount: params.agreedAmount,
        agreedCurrency: params.agreedCurrency,
        nextHttp: buildNextHttp("seller", id, s),
        createdAt: now,
        deliveredAt: null,
      }));
    }
    await Promise.all(inboxWrites).catch(() => {/* never block deal routes */});

    if (buyerWebhook) {
      fires.push(fireWebhook(buyerWebhook, {
        event: "deal_updated",
        dealId: id,
        status: s,
        yourRole: "buyer",
        counterAmount: params.counterAmount,
        counterCurrency: params.counterCurrency,
        agreedAmount: params.agreedAmount,
        agreedCurrency: params.agreedCurrency,
        sellerCryptoWallet: params.sellerCryptoWallet,
        nextHttp: buildNextHttp("buyer", id, s, params.sellerCryptoWallet),
      }, buyerSecret));
    }

    if (sellerWebhook) {
      fires.push(fireWebhook(sellerWebhook, {
        event: "deal_updated",
        dealId: id,
        status: s,
        yourRole: "seller",
        counterAmount: params.counterAmount,
        counterCurrency: params.counterCurrency,
        agreedAmount: params.agreedAmount,
        agreedCurrency: params.agreedCurrency,
        nextHttp: buildNextHttp("seller", id, s),
      }, sellerSecret));
    }

    await Promise.all(fires);
  } catch {
    // Never surface errors from notifications
  }
}
