"use client";

import { useEffect, useMemo, useState } from "react";
import { SiteNav } from "@/components/SiteNav";
import { StarDisplay } from "@/components/StarRating";

type MarketplaceItem = {
  id: string;
  title: string;
  summary: string;
  validFrom: string;
  validTo: string;
  regions: string[];
  columns: string[];
  sampleRow: Record<string, unknown>;
  sellerName: string;
  acquisitionCount: number;
  askingPrice?: string;
  askingCurrency?: string;
  industry?: string;
  dataType?: string;
  sellerAvgStars: number | null;
  sellerTotalRatings: number;
  sellerAvgCompletionMinutes: number | null;
};

function passesPrice(item: MarketplaceItem, min: string, max: string): boolean {
  if (min === "" && max === "") return true;
  if (item.askingPrice === undefined) return true;
  const price = parseFloat(item.askingPrice);
  if (isNaN(price)) return true;
  if (min !== "" && price < parseFloat(min)) return false;
  if (max !== "" && price > parseFloat(max)) return false;
  return true;
}

function SkeletonCards() {
  return (
    <div className="grid gap-4 sm:grid-cols-1 lg:grid-cols-2">
      {[0, 1, 2, 3].map((i) => (
        <div key={i} className="rounded-lg border border-[var(--border)] bg-[var(--card)] p-4 animate-pulse flex flex-col gap-3">
          <div className="h-4 w-3/4 rounded bg-[var(--border)]" />
          <div className="h-3 w-1/3 rounded bg-[var(--border)]" />
          <div className="h-3 w-full rounded bg-[var(--border)]" />
          <div className="h-3 w-5/6 rounded bg-[var(--border)]" />
          <div className="flex gap-1">
            <div className="h-5 w-16 rounded bg-[var(--border)]" />
            <div className="h-5 w-16 rounded bg-[var(--border)]" />
          </div>
        </div>
      ))}
    </div>
  );
}

function MarketplaceCard({ item }: { item: MarketplaceItem }) {
  return (
    <article className="rounded-lg border border-[var(--border)] bg-[var(--card)] p-4 flex flex-col gap-2">
      <div className="flex items-start justify-between gap-2">
        <h3 className="font-medium text-[var(--foreground)] leading-snug">{item.title}</h3>
        {item.acquisitionCount > 0 && (
          <span className="shrink-0 text-xs px-2 py-0.5 rounded border bg-[var(--accent)]/10 text-[var(--accent)] border-[var(--accent)]/30 whitespace-nowrap">
            {item.acquisitionCount}x acquired
          </span>
        )}
      </div>

      <div className="flex flex-wrap items-center gap-2 text-xs text-[var(--muted)]">
        <span>by {item.sellerName}</span>
        <StarDisplay value={item.sellerAvgStars} count={item.sellerTotalRatings} size="xs" />
        {item.sellerAvgCompletionMinutes != null && (
          <span className="px-1.5 py-0.5 rounded bg-[var(--border)] text-[var(--muted)]">
            ~{item.sellerAvgCompletionMinutes}min avg
          </span>
        )}
      </div>

      {(item.industry || item.dataType) && (
        <div className="flex gap-2 text-xs">
          {item.industry && (
            <span className="px-2 py-0.5 rounded bg-purple-500/10 text-purple-300 border border-purple-500/20">
              {item.industry}
            </span>
          )}
          {item.dataType && (
            <span className="px-2 py-0.5 rounded bg-blue-500/10 text-blue-300 border border-blue-500/20">
              {item.dataType}
            </span>
          )}
        </div>
      )}

      <p className="text-sm text-[var(--muted)] line-clamp-2">{item.summary}</p>

      {item.regions.length > 0 && (
        <div className="flex flex-wrap gap-1">
          {item.regions.map((r) => (
            <span key={r} className="text-[11px] px-1.5 py-0.5 rounded bg-[var(--border)] text-[var(--muted)]">
              {r}
            </span>
          ))}
        </div>
      )}

      <div className="flex flex-wrap gap-1">
        {item.columns.slice(0, 5).map((c) => (
          <span key={c} className="font-mono text-[11px] px-1.5 py-0.5 rounded bg-black/30 text-[var(--accent)]/80">
            {c}
          </span>
        ))}
        {item.columns.length > 5 && (
          <span className="text-[11px] text-[var(--muted)]">+{item.columns.length - 5} more</span>
        )}
      </div>

      <div className="flex items-center justify-between mt-auto pt-1 text-xs text-[var(--muted)]">
        {item.askingPrice ? (
          <span className="text-[var(--foreground)]/80 font-medium">
            {item.askingPrice} {item.askingCurrency}
          </span>
        ) : (
          <span>Price: open</span>
        )}
        <span>{item.validFrom.slice(0, 10)} &rarr; {item.validTo.slice(0, 10)}</span>
      </div>
    </article>
  );
}

const TODAY = new Date().toISOString();

const inputClass =
  "w-full rounded border border-[var(--border)] bg-[var(--card)] px-3 py-1.5 text-sm text-[var(--foreground)] placeholder-[var(--muted)] focus:outline-none focus:border-[var(--accent)]/60";
const selectClass =
  "w-full rounded border border-[var(--border)] bg-[var(--card)] px-3 py-1.5 text-sm text-[var(--foreground)] focus:outline-none focus:border-[var(--accent)]/60";

export default function MarketplacePage() {
  const [items, setItems] = useState<MarketplaceItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [textQuery, setTextQuery] = useState("");
  const [regionFilter, setRegionFilter] = useState("");
  const [columnFilter, setColumnFilter] = useState("");
  const [industryFilter, setIndustryFilter] = useState("");
  const [dataTypeFilter, setDataTypeFilter] = useState("");
  const [freshnessFilter, setFreshnessFilter] = useState<"any" | "active">("any");
  const [priceMin, setPriceMin] = useState("");
  const [priceMax, setPriceMax] = useState("");

  useEffect(() => {
    fetch("/api/marketplace")
      .then((r) => r.json())
      .then((data) => {
        if (data.error) setError(data.error);
        else setItems(data.items ?? []);
      })
      .catch(() => setError("Failed to load marketplace data"))
      .finally(() => setLoading(false));
  }, []);

  const industryOptions = useMemo(
    () => [...new Set(items.map((i) => i.industry).filter(Boolean) as string[])].sort(),
    [items]
  );
  const dataTypeOptions = useMemo(
    () => [...new Set(items.map((i) => i.dataType).filter(Boolean) as string[])].sort(),
    [items]
  );

  const filtered = useMemo(() => {
    const q = textQuery.trim().toLowerCase();
    return items.filter((item) => {
      if (q) {
        const haystack = [item.title, item.summary, ...item.regions, ...item.columns]
          .join(" ")
          .toLowerCase();
        if (!haystack.includes(q)) return false;
      }
      if (regionFilter.trim()) {
        const rf = regionFilter.trim().toLowerCase();
        if (!item.regions.some((r) => r.toLowerCase().includes(rf))) return false;
      }
      if (columnFilter.trim()) {
        const cf = columnFilter.trim().toLowerCase();
        if (!item.columns.some((c) => c.toLowerCase().includes(cf))) return false;
      }
      if (industryFilter && item.industry && item.industry !== industryFilter) return false;
      if (dataTypeFilter && item.dataType && item.dataType !== dataTypeFilter) return false;
      if (freshnessFilter === "active" && item.validTo < TODAY) return false;
      if (!passesPrice(item, priceMin, priceMax)) return false;
      return true;
    });
  }, [items, textQuery, regionFilter, columnFilter, industryFilter, dataTypeFilter, freshnessFilter, priceMin, priceMax]);

  const hasFilters =
    textQuery || regionFilter || columnFilter || industryFilter ||
    dataTypeFilter || freshnessFilter !== "any" || priceMin || priceMax;

  return (
    <main className="mx-auto min-h-screen max-w-5xl px-6 py-12">
      <div className="flex flex-col gap-8">
        <SiteNav />

        <header className="flex items-start justify-between gap-4">
          <div>
            <h1 className="text-2xl font-semibold text-[var(--foreground)]">Data marketplace</h1>
            <p className="mt-1 text-[var(--muted)]">All available datasets from seller agents</p>
          </div>
        </header>

        {error && (
          <p className="text-sm text-amber-400/90">{error}</p>
        )}

        {/* Filter bar */}
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
          <input
            className={inputClass + " lg:col-span-2"}
            placeholder="Search title, summary, columns..."
            value={textQuery}
            onChange={(e) => setTextQuery(e.target.value)}
          />
          <input
            className={inputClass}
            placeholder="Filter by region..."
            value={regionFilter}
            onChange={(e) => setRegionFilter(e.target.value)}
          />
          <input
            className={inputClass}
            placeholder="Filter by column/field..."
            value={columnFilter}
            onChange={(e) => setColumnFilter(e.target.value)}
          />
          <select
            className={selectClass}
            value={industryFilter}
            onChange={(e) => setIndustryFilter(e.target.value)}
          >
            <option value="">All industries</option>
            {industryOptions.map((o) => <option key={o} value={o}>{o}</option>)}
          </select>
          <select
            className={selectClass}
            value={dataTypeFilter}
            onChange={(e) => setDataTypeFilter(e.target.value)}
          >
            <option value="">All data types</option>
            {dataTypeOptions.map((o) => <option key={o} value={o}>{o}</option>)}
          </select>
          <select
            className={selectClass}
            value={freshnessFilter}
            onChange={(e) => setFreshnessFilter(e.target.value as "any" | "active")}
          >
            <option value="any">Any date range</option>
            <option value="active">Active only</option>
          </select>
          <div className="flex gap-2 items-center">
            <input
              className={inputClass}
              placeholder="Min price"
              type="number"
              min="0"
              value={priceMin}
              onChange={(e) => setPriceMin(e.target.value)}
            />
            <span className="text-[var(--muted)] text-sm shrink-0">–</span>
            <input
              className={inputClass}
              placeholder="Max price"
              type="number"
              min="0"
              value={priceMax}
              onChange={(e) => setPriceMax(e.target.value)}
            />
          </div>
          {hasFilters && (
            <button
              className="text-sm text-[var(--muted)] hover:text-[var(--accent)] transition text-left"
              onClick={() => {
                setTextQuery(""); setRegionFilter(""); setColumnFilter("");
                setIndustryFilter(""); setDataTypeFilter("");
                setFreshnessFilter("any"); setPriceMin(""); setPriceMax("");
              }}
            >
              Clear filters
            </button>
          )}
        </div>

        {!loading && (
          <p className="text-xs text-[var(--muted)]">
            Showing {filtered.length} of {items.length} listings
          </p>
        )}

        {loading ? (
          <SkeletonCards />
        ) : filtered.length === 0 ? (
          <p className="text-center text-[var(--muted)] py-16">
            {items.length === 0 ? "No listings yet." : "No listings match your filters."}
          </p>
        ) : (
          <div className="grid gap-4 sm:grid-cols-1 lg:grid-cols-2">
            {filtered.map((item) => (
              <MarketplaceCard key={item.id} item={item} />
            ))}
          </div>
        )}
      </div>
    </main>
  );
}
