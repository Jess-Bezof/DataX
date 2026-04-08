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

function relativeTime(iso: string): string {
  const diffMs = Date.now() - new Date(iso).getTime();
  const mins = Math.floor(diffMs / 60_000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  return `${Math.floor(hrs / 24)}d ago`;
}

type BadgeConfig = { label: string; className: string };

function getPriceBadge(item: NegotiationItem): BadgeConfig {
  const { status, proposedAmount, proposedCurrency, counterAmount, counterCurrency } = item;

  if (status === "released") {
    const price = counterAmount ?? proposedAmount;
    const cur = counterCurrency ?? proposedCurrency;
    return {
      label: price ? `${price} ${cur} · agreed` : "Released",
      className: "bg-[var(--accent)]/20 text-[var(--accent)] border-[var(--accent)]/40",
    };
  }
  if (status === "seller_counter_pending" && counterAmount) {
    return {
      label: `${counterAmount} ${counterCurrency ?? ""} · counter`,
      className: "bg-purple-500/20 text-purple-300 border-purple-500/40",
    };
  }
  if (status === "awaiting_payment" || status === "buyer_marked_sent") {
    const price = counterAmount ?? proposedAmount;
    const cur = counterCurrency ?? proposedCurrency;
    return {
      label: price ? `${price} ${cur} · agreed` : "Agreed",
      className: "bg-[var(--muted)]/20 text-[var(--muted)] border-[var(--border)]",
    };
  }
  if (status === "offer_pending" && proposedAmount) {
    return {
      label: `${proposedAmount} ${proposedCurrency ?? ""} · offer`,
      className: "bg-yellow-500/20 text-yellow-300 border-yellow-500/40",
    };
  }
  return {
    label: "Pending",
    className: "bg-[var(--muted)]/10 text-[var(--muted)] border-[var(--border)]",
  };
}

function SkeletonCards() {
  return (
    <div className="grid gap-4 lg:grid-cols-2">
      {[0, 1, 2].map((i) => (
        <div
          key={i}
          className="rounded-lg border border-[var(--border)] bg-[var(--card)] p-4 animate-pulse"
        >
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

function NegotiationCard({ item }: { item: NegotiationItem }) {
  const badge = getPriceBadge(item);
  const description = describeDealActivity(
    item.status,
    item.listingTitle,
    item.buyerName,
    item.sellerName,
    item.proposedAmount ?? undefined,
    item.proposedCurrency ?? undefined
  );

  return (
    <div className="rounded-lg border border-[var(--border)] bg-[var(--card)] p-4 flex flex-col gap-2">
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <span className="font-mono text-xs text-[var(--muted)]">
              #{item.dealId.slice(0, 7)}
            </span>
            <span className="text-sm font-medium text-[var(--foreground)] truncate">
              {item.listingTitle}
            </span>
          </div>
          <p className="text-xs text-[var(--muted)] mt-0.5">
            {item.buyerName} ↔ {item.sellerName}
          </p>
        </div>
        <span
          className={`text-xs px-2 py-0.5 rounded border whitespace-nowrap shrink-0 ${badge.className}`}
        >
          {badge.label}
        </span>
      </div>

      <NegotiationStepTracker status={item.status} />

      <p className="text-xs text-[var(--muted)] leading-relaxed">{description}</p>
      <p className="text-xs text-[var(--muted)]/60">
        Updated {relativeTime(item.updatedAt)}
      </p>
    </div>
  );
}

export default function NegotiationsPage() {
  const [items, setItems] = useState<NegotiationItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [lastRefreshed, setLastRefreshed] = useState<Date | null>(null);

  useEffect(() => {
    let cancelled = false;

    async function load() {
      try {
        const r = await fetch("/api/negotiations");
        const data = await r.json();
        if (cancelled) return;
        if (data.error) {
          setError(data.error);
          return;
        }
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
    return () => {
      cancelled = true;
      clearInterval(interval);
    };
  }, []);

  return (
    <main className="mx-auto min-h-screen max-w-5xl px-6 py-12">
      <div className="flex flex-col gap-8">
        <SiteNav />

        <header>
          <h1 className="text-2xl font-semibold text-[var(--foreground)]">
            Negotiation sessions
          </h1>
          <p className="mt-1 text-[var(--muted)] flex items-center gap-2">
            <span className="w-2 h-2 rounded-full bg-[var(--accent)] animate-pulse inline-block" />
            Live state machine tracking for all agent negotiations
          </p>
          {lastRefreshed && (
            <p className="mt-1 text-xs text-[var(--muted)]/60">
              Last updated: {lastRefreshed.toLocaleTimeString()}
            </p>
          )}
        </header>

        {error && (
          <p className="text-sm text-amber-400/90">
            {error} — ensure{" "}
            <code className="text-[var(--foreground)]">MONGODB_URI</code> is
            set.
          </p>
        )}

        {loading ? (
          <SkeletonCards />
        ) : items.length === 0 ? (
          <p className="text-center text-[var(--muted)] py-16">
            No negotiation sessions yet.
          </p>
        ) : (
          <div className="grid gap-4 lg:grid-cols-2">
            {items.map((item) => (
              <NegotiationCard key={item.dealId} item={item} />
            ))}
          </div>
        )}
      </div>
    </main>
  );
}
