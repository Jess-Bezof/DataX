import type { ListingPreview as ListingPreviewType } from "@/types/datax";

export function ListingPreview({ listing }: { listing: ListingPreviewType }) {
  return (
    <article
      className="rounded-lg border border-[var(--border)] bg-[var(--card)] p-4 text-left"
      key={listing.id}
    >
      <h3 className="font-medium text-[var(--foreground)]">{listing.title}</h3>
      <p className="mt-2 text-sm text-[var(--muted)]">{listing.summary}</p>
      <dl className="mt-3 grid gap-1 text-xs text-[var(--muted)]">
        <div>
          <dt className="inline font-medium text-[var(--foreground)]/80">
            Timeframe:{" "}
          </dt>
          <dd className="inline">
            {listing.validFrom.slice(0, 10)} → {listing.validTo.slice(0, 10)}
          </dd>
        </div>
        <div>
          <dt className="inline font-medium text-[var(--foreground)]/80">
            Regions:{" "}
          </dt>
          <dd className="inline">
            {listing.regions.length ? listing.regions.join(", ") : "—"}
          </dd>
        </div>
        <div>
          <dt className="font-medium text-[var(--foreground)]/80">Columns</dt>
          <dd className="mt-0.5 font-mono text-[11px] text-[var(--accent)]/90">
            {listing.columns.join(", ")}
          </dd>
        </div>
      </dl>
      <div className="mt-3">
        <p className="text-xs font-medium text-[var(--foreground)]/80">
          Sample row (preview)
        </p>
        <pre className="mt-1 max-h-32 overflow-auto rounded bg-black/30 p-2 font-mono text-[11px] text-[var(--foreground)]/90">
          {JSON.stringify(listing.sampleRow, null, 2)}
        </pre>
      </div>
    </article>
  );
}
