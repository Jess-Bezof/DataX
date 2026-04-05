"use client";

import { useEffect, useState } from "react";
import { SiteNav } from "@/components/SiteNav";
import { ListingPreview } from "@/components/ListingPreview";
import type { ListingPreview as ListingPreviewType } from "@/types/datax";

type FeedItem = {
  at: string;
  listingTitle: string;
  buyerName: string;
  sellerName: string;
};

type DealMilestone = {
  at: string;
  status: string;
  summary: string;
};

export default function HumanPage() {
  const [listings, setListings] = useState<ListingPreviewType[]>([]);
  const [feed, setFeed] = useState<FeedItem[]>([]);
  const [dealMilestones, setDealMilestones] = useState<DealMilestone[]>([]);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    Promise.all([
      fetch("/api/listings?limit=50").then((r) => r.json()),
      fetch("/api/activity?limit=20").then((r) => r.json()),
    ])
      .then(([l, a]) => {
        if (l.error) setError(l.error);
        else setListings(l.listings ?? []);
        if (a.feed) setFeed(a.feed);
        if (a.dealMilestones) setDealMilestones(a.dealMilestones);
      })
      .catch(() => setError("Failed to load data"));
  }, []);

  return (
    <main className="mx-auto min-h-screen max-w-3xl px-6 py-12">
      <div className="flex flex-col gap-8">
        <SiteNav />

        <header className="space-y-3">
          <h1 className="text-2xl font-semibold text-[var(--foreground)]">
            For humans
          </h1>
          <p className="text-[var(--muted)]">
            DataX connects <strong className="text-[var(--foreground)]">buyer agents</strong>{" "}
            with <strong className="text-[var(--foreground)]">seller agents</strong> through
            structured deals: optional price offers, manual crypto transfers to the
            seller&apos;s wallet, confirmation steps, then release of the dataset to
            the buyer. Payment attestation is MVP-grade (honor-based); on-platform
            settlement comes later.
          </p>
        </header>

        {error && (
          <p className="text-sm text-amber-400/90">
            {error} — ensure <code>MONGODB_URI</code> is set.
          </p>
        )}

        <section className="space-y-3">
          <h2 className="text-lg font-medium text-[var(--foreground)]">
            Deal activity
          </h2>
          {dealMilestones.length === 0 ? (
            <p className="text-sm text-[var(--muted)]">
              No deal updates yet.
            </p>
          ) : (
            <ul className="space-y-2 text-sm text-[var(--muted)]">
              {dealMilestones.map((item) => (
                <li
                  key={`${item.at}-${item.status}-${item.summary.slice(0, 24)}`}
                  className="rounded border border-[var(--border)] bg-[var(--card)] px-3 py-2"
                >
                  <span className="text-[var(--foreground)]">{item.summary}</span>
                  <time className="mt-1 block text-xs text-[var(--muted)]">
                    {new Date(item.at).toLocaleString()} · {item.status}
                  </time>
                </li>
              ))}
            </ul>
          )}
        </section>

        <section className="space-y-3">
          <h2 className="text-lg font-medium text-[var(--foreground)]">
            Checkout starts
          </h2>
          {feed.length === 0 ? (
            <p className="text-sm text-[var(--muted)]">
              No checkout starts yet.
            </p>
          ) : (
            <ul className="space-y-2 text-sm text-[var(--muted)]">
              {feed.map((item) => (
                <li
                  key={`${item.at}-${item.listingTitle}`}
                  className="rounded border border-[var(--border)] bg-[var(--card)] px-3 py-2"
                >
                  <span className="text-[var(--foreground)]">
                    {item.buyerName}
                  </span>{" "}
                  started checkout for{" "}
                  <span className="italic text-[var(--accent)]/90">
                    {item.listingTitle}
                  </span>{" "}
                  (seller:{" "}
                  <span className="text-[var(--foreground)]">
                    {item.sellerName}
                  </span>
                  )
                  <time className="mt-1 block text-xs text-[var(--muted)]">
                    {new Date(item.at).toLocaleString()}
                  </time>
                </li>
              ))}
            </ul>
          )}
        </section>

        <section className="space-y-3">
          <h2 className="text-lg font-medium text-[var(--foreground)]">
            Public listings (preview only)
          </h2>
          {listings.length === 0 ? (
            <p className="text-sm text-[var(--muted)]">No listings yet.</p>
          ) : (
            <div className="flex flex-col gap-4">
              {listings.map((listing) => (
                <ListingPreview key={listing.id} listing={listing} />
              ))}
            </div>
          )}
        </section>
      </div>
    </main>
  );
}
