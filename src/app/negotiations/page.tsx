"use client";

import { useEffect, useState } from "react";
import { SiteNav } from "@/components/SiteNav";
import { NegotiationStepTracker } from "@/components/NegotiationStepTracker";
import { describeDealActivity } from "@/lib/deal-activity";
import type { DealStatus } from "@/types/datax";

type NegotiationItem = {
  dealId: string;
  listingTitle: string;
  buyerName: string;
  sellerName: string;
  status: DealStatus;
  proposedAmount: string | null;
  proposedCurrency: string | null;
  counterAmount: string | null;
  counterCurrency: string | null;
  buyerMarkedSentAt: string | null;
  updatedAt: string;
  createdAt: string;
};

type DealEvent = {
  at: string;
  actor: "buyer" | "seller" | "system";
  action: string;
  amount: string | null;
  currency: string | null;
  note: string | null;
};

type DealDetail = {
  dealId: string;
  status: DealStatus;
  listingTitle: string;
  buyerName: string;
  sellerName: string;
  proposedAmount: string | null;
  proposedCurrency: string | null;
  counterAmount: string | null;
  counterCurrency: string | null;
  createdAt: string;
  updatedAt: string;
  events: DealEvent[];
};

function relativeTime(iso: string): string {
  const diffMs = Date.now() - new Date(iso).getTime();
  const mins = Math.floor(diffMs / 60_000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  return `${Math.floor(hrs / 24)}d ago`;
}

function formatTime(iso: string): string {
  return new Date(iso).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
}

function formatDate(iso: string): string {
  return new Date(iso).toLocaleDateString([], { month: "short", day: "numeric" });
}

type BadgeConfig = { label: string; className: string };

function getPriceBadge(item: NegotiationItem): BadgeConfig {
  const { status, proposedAmount, proposedCurrency, counterAmount, counterCurrency } = item;
  if (status === "released") {
    const price = counterAmount ?? proposedAmount;
    const cur = counterCurrency ?? proposedCurrency;
    return { label: price ? `${price} ${cur} · agreed` : "Released", className: "bg-[var(--accent)]/20 text-[var(--accent)] border-[var(--accent)]/40" };
  }
  if (status === "seller_counter_pending" && counterAmount) {
    return { label: `${counterAmount} ${counterCurrency ?? ""} · counter`, className: "bg-purple-500/20 text-purple-300 border-purple-500/40" };
  }
  if (status === "awaiting_payment" || status === "buyer_marked_sent") {
    const price = counterAmount ?? proposedAmount;
    const cur = counterCurrency ?? proposedCurrency;
    return { label: price ? `${price} ${cur} · agreed` : "Agreed", className: "bg-[var(--muted)]/20 text-[var(--muted)] border-[var(--border)]" };
  }
  if (status === "offer_pending" && proposedAmount) {
    return { label: `${proposedAmount} ${proposedCurrency ?? ""} · offer`, className: "bg-yellow-500/20 text-yellow-300 border-yellow-500/40" };
  }
  return { label: "Pending", className: "bg-[var(--muted)]/10 text-[var(--muted)] border-[var(--border)]" };
}

function actionLabel(event: DealEvent, buyerName: string, sellerName: string): { text: string; sub?: string } {
  const price = event.amount ? `${event.amount} ${event.currency ?? ""}` : null;
  switch (event.action) {
    case "deal_created":      return { text: "Negotiation started" };
    case "offer_proposed":    return { text: `${buyerName} proposed ${price ?? "a deal"}` };
    case "seller_accepted":   return { text: `${sellerName} accepted the offer`, sub: event.note ?? undefined };
    case "seller_rejected":   return { text: `${sellerName} rejected the offer` };
    case "seller_countered":  return { text: `${sellerName} countered with ${price ?? "a new price"}` };
    case "buyer_accepted_counter": return { text: `${buyerName} accepted the counter-offer${price ? ` (${price})` : ""}` };
    case "buyer_rejected_counter": return { text: `${buyerName} rejected the counter-offer` };
    case "payment_sent":      return { text: `${buyerName} marked payment as sent` };
    case "payment_confirmed": return { text: `${sellerName} confirmed payment received` };
    case "data_released":     return { text: "Data released to buyer", sub: "Deal complete" };
    default:                  return { text: event.action };
  }
}

function actorColor(actor: string): string {
  if (actor === "buyer") return "bg-blue-500";
  if (actor === "seller") return "bg-purple-500";
  return "bg-[var(--muted)]";
}

function actorLabel(actor: string, buyerName: string, sellerName: string): string {
  if (actor === "buyer") return buyerName;
  if (actor === "seller") return sellerName;
  return "System";
}

function ChatPanel({ dealId, onClose }: { dealId: string; onClose: () => void }) {
  const [detail, setDetail] = useState<DealDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    async function load() {
      try {
        const r = await fetch(`/api/deals/${dealId}/events`);
        const data = await r.json();
        if (cancelled) return;
        if (data.error) { setError(data.error); return; }
        setDetail(data);
        setError(null);
      } catch {
        if (!cancelled) setError("Failed to load events");
      } finally {
        if (!cancelled) setLoading(false);
      }
    }
    load();
    const interval = setInterval(load, 8_000);
    return () => { cancelled = true; clearInterval(interval); };
  }, [dealId]);

  return (
    <>
      {/* Backdrop */}
      <div
        className="fixed inset-0 bg-black/60 z-40"
        onClick={onClose}
      />
      {/* Panel */}
      <div className="fixed right-0 top-0 h-full w-full max-w-md bg-[var(--background)] border-l border-[var(--border)] z-50 flex flex-col">
        {/* Header */}
        <div className="flex items-start justify-between gap-3 p-4 border-b border-[var(--border)]">
          <div className="min-w-0">
            <p className="font-mono text-xs text-[var(--muted)]">#{dealId.slice(0, 7)}</p>
            {detail && (
              <>
                <h2 className="text-sm font-medium text-[var(--foreground)] truncate mt-0.5">
                  {detail.listingTitle}
                </h2>
                <p className="text-xs text-[var(--muted)] mt-0.5">
                  {detail.buyerName} ↔ {detail.sellerName}
                </p>
              </>
            )}
          </div>
          <button
            onClick={onClose}
            className="shrink-0 text-[var(--muted)] hover:text-[var(--foreground)] transition text-lg leading-none"
          >
            ✕
          </button>
        </div>

        {/* Step tracker */}
        {detail && (
          <div className="px-4 py-3 border-b border-[var(--border)]">
            <NegotiationStepTracker status={detail.status} />
          </div>
        )}

        {/* Events / chat feed */}
        <div className="flex-1 overflow-y-auto p-4 flex flex-col gap-3">
          {loading && !detail && (
            <div className="flex flex-col gap-3">
              {[0,1,2].map(i => (
                <div key={i} className="flex gap-3 animate-pulse">
                  <div className="w-6 h-6 rounded-full bg-[var(--border)] shrink-0 mt-1" />
                  <div className="flex-1 space-y-1">
                    <div className="h-3 w-20 rounded bg-[var(--border)]" />
                    <div className="h-4 w-full rounded bg-[var(--border)]" />
                  </div>
                </div>
              ))}
            </div>
          )}
          {error && <p className="text-sm text-amber-400/90">{error}</p>}
          {detail && detail.events.length === 0 && (
            <p className="text-sm text-[var(--muted)] text-center py-8">
              No events yet — this deal predates the event log.
            </p>
          )}
          {detail && detail.events.map((event, i) => {
            const { text, sub } = actionLabel(event, detail.buyerName, detail.sellerName);
            const isSystem = event.actor === "system";
            if (isSystem) {
              return (
                <div key={i} className="flex items-center gap-2 my-1">
                  <div className="flex-1 h-px bg-[var(--border)]" />
                  <span className="text-[11px] text-[var(--muted)] whitespace-nowrap">{text}</span>
                  <div className="flex-1 h-px bg-[var(--border)]" />
                </div>
              );
            }
            const isBuyer = event.actor === "buyer";
            return (
              <div key={i} className={`flex gap-2 ${isBuyer ? "" : "flex-row-reverse"}`}>
                <div className={`w-6 h-6 rounded-full shrink-0 mt-1 ${actorColor(event.actor)}`} title={actorLabel(event.actor, detail.buyerName, detail.sellerName)} />
                <div className={`max-w-[80%] flex flex-col gap-0.5 ${isBuyer ? "items-start" : "items-end"}`}>
                  <span className="text-[10px] text-[var(--muted)]">
                    {actorLabel(event.actor, detail.buyerName, detail.sellerName)} · {formatDate(event.at)} {formatTime(event.at)}
                  </span>
                  <div className={`rounded-lg px-3 py-2 text-sm ${
                    isBuyer
                      ? "bg-blue-500/15 text-[var(--foreground)] rounded-tl-none"
                      : "bg-purple-500/15 text-[var(--foreground)] rounded-tr-none"
                  }`}>
                    {text}
                    {sub && <p className="text-xs text-[var(--muted)] mt-0.5">{sub}</p>}
                  </div>
                </div>
              </div>
            );
          })}
        </div>

        {/* Footer */}
        {detail && (
          <div className="p-3 border-t border-[var(--border)] text-xs text-[var(--muted)] text-center">
            Started {formatDate(detail.createdAt)} · last activity {relativeTime(detail.updatedAt)}
          </div>
        )}
      </div>
    </>
  );
}

function SkeletonCards() {
  return (
    <div className="grid gap-4 lg:grid-cols-2">
      {[0, 1, 2].map((i) => (
        <div key={i} className="rounded-lg border border-[var(--border)] bg-[var(--card)] p-4 animate-pulse">
          <div className="h-3 w-24 rounded bg-[var(--border)] mb-2" />
          <div className="h-4 w-48 rounded bg-[var(--border)] mb-1" />
          <div className="h-3 w-36 rounded bg-[var(--border)] mb-4" />
          <div className="h-8 w-full rounded bg-[var(--border)] mb-3" />
          <div className="h-3 w-full rounded bg-[var(--border)]" />
        </div>
      ))}
    </div>
  );
}

function NegotiationCard({ item, onClick }: { item: NegotiationItem; onClick: () => void }) {
  const badge = getPriceBadge(item);
  const description = describeDealActivity(
    item.status, item.listingTitle, item.buyerName, item.sellerName,
    item.proposedAmount ?? undefined, item.proposedCurrency ?? undefined
  );

  return (
    <div
      className="rounded-lg border border-[var(--border)] bg-[var(--card)] p-4 flex flex-col gap-2 cursor-pointer hover:border-[var(--accent)]/40 transition-colors"
      onClick={onClick}
    >
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <span className="font-mono text-xs text-[var(--muted)]">#{item.dealId.slice(0, 7)}</span>
            <span className="text-sm font-medium text-[var(--foreground)] truncate">{item.listingTitle}</span>
          </div>
          <p className="text-xs text-[var(--muted)] mt-0.5">{item.buyerName} ↔ {item.sellerName}</p>
        </div>
        <span className={`text-xs px-2 py-0.5 rounded border whitespace-nowrap shrink-0 ${badge.className}`}>
          {badge.label}
        </span>
      </div>
      <NegotiationStepTracker status={item.status} />
      <p className="text-xs text-[var(--muted)] leading-relaxed">{description}</p>
      <div className="flex items-center justify-between">
        <p className="text-xs text-[var(--muted)]/60">Updated {relativeTime(item.updatedAt)}</p>
        <span className="text-xs text-[var(--accent)]/70">View chat →</span>
      </div>
    </div>
  );
}

export default function NegotiationsPage() {
  const [items, setItems] = useState<NegotiationItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [lastRefreshed, setLastRefreshed] = useState<Date | null>(null);
  const [activeDealId, setActiveDealId] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    async function load() {
      try {
        const r = await fetch("/api/negotiations");
        const data = await r.json();
        if (cancelled) return;
        if (data.error) { setError(data.error); return; }
        setItems(data.negotiations ?? []);
        setLastRefreshed(new Date());
        setError(null);
      } catch {
        if (!cancelled) setError("Failed to load negotiation data");
      } finally {
        if (!cancelled) setLoading(false);
      }
    }
    load();
    const interval = setInterval(load, 10_000);
    return () => { cancelled = true; clearInterval(interval); };
  }, []);

  return (
    <main className="mx-auto min-h-screen max-w-5xl px-6 py-12">
      <div className="flex flex-col gap-8">
        <SiteNav />
        <header>
          <h1 className="text-2xl font-semibold text-[var(--foreground)]">Negotiation sessions</h1>
          <p className="mt-1 text-[var(--muted)] flex items-center gap-2">
            <span className="w-2 h-2 rounded-full bg-[var(--accent)] animate-pulse inline-block" />
            Live state machine tracking for all agent negotiations
          </p>
          {lastRefreshed && (
            <p className="mt-1 text-xs text-[var(--muted)]/60">Last updated: {lastRefreshed.toLocaleTimeString()}</p>
          )}
        </header>

        {error && (
          <p className="text-sm text-amber-400/90">
            {error} — ensure <code className="text-[var(--foreground)]">MONGODB_URI</code> is set.
          </p>
        )}

        {loading ? (
          <SkeletonCards />
        ) : items.length === 0 ? (
          <p className="text-center text-[var(--muted)] py-16">No negotiation sessions yet.</p>
        ) : (
          <div className="grid gap-4 lg:grid-cols-2">
            {items.map((item) => (
              <NegotiationCard key={item.dealId} item={item} onClick={() => setActiveDealId(item.dealId)} />
            ))}
          </div>
        )}
      </div>

      {activeDealId && (
        <ChatPanel dealId={activeDealId} onClose={() => setActiveDealId(null)} />
      )}
    </main>
  );
}
