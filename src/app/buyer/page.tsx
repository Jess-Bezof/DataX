"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { SiteNav } from "@/components/SiteNav";
import { ListingPreview } from "@/components/ListingPreview";
import { CONTACT_METHODS } from "@/types/datax";
import type { ListingPreview as ListingPreviewType } from "@/types/datax";

const STORAGE = "datax_buyer_api_key";

const TERMINAL = new Set(["released", "offer_rejected"]);

const BACKUP_METHODS = CONTACT_METHODS.filter((m) => m !== "platform");

type DealRow = {
  dealId: string;
  status: string;
  role: string;
  proposedAmount?: string;
  proposedCurrency?: string;
  counterpartyName: string;
  listing: ListingPreviewType | null;
  updatedAt: string;
  sellerCryptoWallet?: string | null;
};

export default function BuyerPage() {
  const [apiKey, setApiKey] = useState("");
  const [shownKey, setShownKey] = useState<string | null>(null);
  const [msg, setMsg] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);

  const [regName, setRegName] = useState("");
  const [backupMethod, setBackupMethod] = useState("email");
  const [backupValue, setBackupValue] = useState("");

  const [query, setQuery] = useState("");
  const [region, setRegion] = useState("");
  const [results, setResults] = useState<ListingPreviewType[]>([]);
  const [searchNote, setSearchNote] = useState<string | null>(null);

  const [offerAmount, setOfferAmount] = useState("");
  const [offerCurrency, setOfferCurrency] = useState("");

  const [connectFor, setConnectFor] = useState<string | null>(null);
  const [deals, setDeals] = useState<DealRow[]>([]);
  const [payloadByDeal, setPayloadByDeal] = useState<Record<string, string>>({});

  const buyerDeals = useMemo(
    () => deals.filter((d) => d.role === "buyer"),
    [deals]
  );
  const activeDeals = useMemo(
    () => buyerDeals.filter((d) => !TERMINAL.has(d.status)),
    [buyerDeals]
  );
  const pastDeals = useMemo(
    () => buyerDeals.filter((d) => d.status === "released"),
    [buyerDeals]
  );

  const loadDeals = useCallback(async (key: string) => {
    const r = await fetch("/api/deals", {
      headers: { Authorization: `Bearer ${key}` },
    });
    const data = await r.json();
    if (r.ok) setDeals(data.deals ?? []);
  }, []);

  useEffect(() => {
    const k = typeof window !== "undefined" ? localStorage.getItem(STORAGE) : null;
    if (k) {
      setApiKey(k);
      loadDeals(k).catch(() => {});
    }
  }, [loadDeals]);

  async function register(e: React.FormEvent) {
    e.preventDefault();
    setErr(null);
    setMsg(null);
    try {
      const body: Record<string, string | undefined> = {
        role: "buyer",
        displayName: regName,
      };
      const bv = backupValue.trim();
      if (bv) {
        body.contactMethod = backupMethod;
        body.contactValue = bv;
      }

      const r = await fetch("/api/agents", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const data = await r.json();
      if (!r.ok) throw new Error(data.error || "Registration failed");
      localStorage.setItem(STORAGE, data.apiKey);
      setApiKey(data.apiKey);
      setShownKey(data.apiKey);
      setMsg(data.message);
      await loadDeals(data.apiKey);
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Error");
    }
  }

  async function search(e: React.FormEvent) {
    e.preventDefault();
    setErr(null);
    setSearchNote(null);
    if (!apiKey) {
      setErr("Register first to get an API key.");
      return;
    }
    try {
      const r = await fetch("/api/search", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${apiKey}`,
        },
        body: JSON.stringify({ query, region: region || undefined }),
      });
      const data = await r.json();
      if (!r.ok) throw new Error(data.error || "Search failed");
      setResults(data.results ?? []);
      setSearchNote(data.message ?? null);
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Error");
    }
  }

  function connectBody(): Record<string, string> {
    const a = offerAmount.trim();
    const c = offerCurrency.trim();
    if (!a) return {};
    if (!c) {
      throw new Error("Add a currency next to your offer amount (e.g. USDC).");
    }
    return { proposedAmount: a, proposedCurrency: c };
  }

  async function connect(listingId: string) {
    setErr(null);
    setConnectFor(listingId);
    if (!apiKey) return;
    let body: Record<string, string>;
    try {
      body = connectBody();
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Invalid offer");
      setConnectFor(null);
      return;
    }
    try {
      const r = await fetch(`/api/listings/${listingId}/connect`, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${apiKey}`,
          ...(Object.keys(body).length
            ? { "Content-Type": "application/json" }
            : {}),
        },
        body: Object.keys(body).length ? JSON.stringify(body) : undefined,
      });
      const data = await r.json();
      if (!r.ok) throw new Error(data.error || "Connect failed");
      setMsg(data.message || "Deal updated.");
      await loadDeals(apiKey);
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Error");
    } finally {
      setConnectFor(null);
    }
  }

  async function buyerSent(dealId: string) {
    setErr(null);
    if (!apiKey) return;
    const r = await fetch(`/api/deals/${dealId}/buyer-sent`, {
      method: "POST",
      headers: { Authorization: `Bearer ${apiKey}` },
    });
    const data = await r.json();
    if (!r.ok) setErr(data.error || "Failed");
    else {
      setMsg(data.message);
      await loadDeals(apiKey);
    }
  }

  async function fetchPayload(dealId: string) {
    setErr(null);
    if (!apiKey) return;
    const r = await fetch(`/api/deals/${dealId}/payload`, {
      headers: { Authorization: `Bearer ${apiKey}` },
    });
    const data = await r.json();
    if (!r.ok) setErr(data.error || "Failed");
    else {
      setPayloadByDeal((p) => ({
        ...p,
        [dealId]: JSON.stringify(data.fullPayload, null, 2),
      }));
      setMsg("Payload loaded below.");
    }
  }

  function logout() {
    localStorage.removeItem(STORAGE);
    setApiKey("");
    setShownKey(null);
    setResults([]);
    setDeals([]);
    setPayloadByDeal({});
    setMsg("Cleared saved API key from this browser.");
  }

  function renderDealCard(d: DealRow, showPayload: boolean) {
    return (
      <li
        key={d.dealId}
        className="rounded-lg border border-[var(--border)] bg-[var(--card)] p-3"
      >
        <p className="font-medium text-[var(--foreground)]">
          {d.listing?.title ?? "Listing"} ·{" "}
          <span className="text-[var(--muted)]">{d.status}</span>
        </p>
        <p className="text-xs text-[var(--muted)]">
          Seller: {d.counterpartyName}
          {d.proposedAmount
            ? ` · Offer: ${d.proposedAmount} ${d.proposedCurrency ?? ""}`
            : ""}
        </p>
        {d.sellerCryptoWallet && (
          <p className="mt-2 break-all font-mono text-xs text-[var(--accent)]">
            Pay this wallet: {d.sellerCryptoWallet}
          </p>
        )}
        {d.status === "awaiting_payment" && (
          <button
            type="button"
            onClick={() => buyerSent(d.dealId)}
            className="mt-2 rounded border border-[var(--accent)] px-2 py-1 text-[var(--accent)]"
          >
            I sent the crypto
          </button>
        )}
        {showPayload && d.status === "released" && (
          <div className="mt-2 space-y-2">
            <button
              type="button"
              onClick={() => fetchPayload(d.dealId)}
              className="rounded bg-[var(--accent)] px-2 py-1 font-medium text-black"
            >
              Load full payload
            </button>
            {payloadByDeal[d.dealId] && (
              <pre className="max-h-48 overflow-auto rounded bg-black/30 p-2 font-mono text-[11px]">
                {payloadByDeal[d.dealId]}
              </pre>
            )}
          </div>
        )}
      </li>
    );
  }

  return (
    <main className="mx-auto min-h-screen max-w-3xl px-6 py-12">
      <div className="flex flex-col gap-8">
        <SiteNav />
        <header>
          <p className="text-xs font-medium uppercase tracking-wide text-[var(--accent)]">
            Agent console · not a public landing page
          </p>
          <h1 className="mt-1 text-2xl font-semibold text-[var(--foreground)]">
            Buyer dashboard
          </h1>
          <p className="mt-2 text-sm text-[var(--muted)]">
            You interact through <strong className="text-[var(--foreground)]">deals</strong> on
            DataX — no contact channel required by default. Search (top 4 matches), start a
            deal, pay the seller wallet, confirm, then load the payload after release.
          </p>
        </header>

        {shownKey && (
          <div className="rounded-lg border border-[var(--accent)]/40 bg-[var(--accent)]/10 p-3 text-sm">
            <p className="font-medium text-[var(--accent)]">Save this API key now</p>
            <code className="mt-2 block break-all text-[var(--foreground)]">
              {shownKey}
            </code>
          </div>
        )}

        {msg && <p className="text-sm text-[var(--accent)]">{msg}</p>}
        {err && <p className="text-sm text-red-400">{err}</p>}

        {apiKey && (
          <section className="grid grid-cols-2 gap-2 rounded-lg border border-[var(--border)] bg-[var(--card)] p-3 text-center text-sm sm:grid-cols-3">
            <div>
              <p className="text-2xl font-semibold text-[var(--accent)]">
                {activeDeals.length}
              </p>
              <p className="text-[var(--muted)]">Active deals</p>
            </div>
            <div>
              <p className="text-2xl font-semibold text-[var(--accent)]">
                {pastDeals.length}
              </p>
              <p className="text-[var(--muted)]">Purchases done</p>
            </div>
            <div className="sm:col-span-1 col-span-2 sm:col-auto">
              <p className="text-2xl font-semibold text-[var(--accent)]">
                {results.length > 0 ? results.length : "—"}
              </p>
              <p className="text-[var(--muted)]">Last search hits</p>
            </div>
          </section>
        )}

        <section className="space-y-3 rounded-lg border border-[var(--border)] bg-[var(--card)] p-4">
          <h2 className="font-medium text-[var(--foreground)]">
            {apiKey ? "Account" : "Register buyer"}
          </h2>
          {!apiKey ? (
            <form onSubmit={register} className="grid gap-3 text-sm">
              <label className="grid gap-1">
                <span className="text-[var(--muted)]">Display name</span>
                <input
                  required
                  className="rounded border border-[var(--border)] bg-[var(--background)] px-2 py-1.5 text-[var(--foreground)]"
                  value={regName}
                  onChange={(e) => setRegName(e.target.value)}
                />
              </label>
              <details className="rounded border border-[var(--border)] bg-[var(--background)]/50 p-2">
                <summary className="cursor-pointer text-[var(--muted)]">
                  Optional backup contact (off-platform only)
                </summary>
                <div className="mt-2 grid gap-2">
                  <select
                    className="rounded border border-[var(--border)] bg-[var(--background)] px-2 py-1.5 text-[var(--foreground)]"
                    value={backupMethod}
                    onChange={(e) => setBackupMethod(e.target.value)}
                  >
                    {BACKUP_METHODS.map((m) => (
                      <option key={m} value={m}>
                        {m}
                      </option>
                    ))}
                  </select>
                  <input
                    className="rounded border border-[var(--border)] bg-[var(--background)] px-2 py-1.5 text-[var(--foreground)]"
                    value={backupValue}
                    onChange={(e) => setBackupValue(e.target.value)}
                    placeholder="Only if you want a non-platform fallback"
                  />
                </div>
              </details>
              <button
                type="submit"
                className="rounded bg-[var(--accent)] px-3 py-2 font-medium text-black hover:opacity-90"
              >
                Create buyer &amp; API key
              </button>
            </form>
          ) : (
            <p className="text-sm text-[var(--muted)]">
              Signed in with API key in this browser.{" "}
              <button
                type="button"
                className="text-[var(--accent)] underline"
                onClick={logout}
              >
                Clear key
              </button>
            </p>
          )}
        </section>

        <section className="space-y-3">
          <h2 className="text-lg font-medium text-[var(--foreground)]">Active deals</h2>
          {!apiKey || activeDeals.length === 0 ? (
            <p className="text-sm text-[var(--muted)]">
              {apiKey ? "No active deals." : "Register to see deals."}
            </p>
          ) : (
            <ul className="space-y-3 text-sm">{activeDeals.map((d) => renderDealCard(d, false))}</ul>
          )}
        </section>

        <section className="space-y-3">
          <h2 className="text-lg font-medium text-[var(--foreground)]">Past purchases</h2>
          {!apiKey || pastDeals.length === 0 ? (
            <p className="text-sm text-[var(--muted)]">
              {apiKey ? "No completed purchases yet." : "Register to see history."}
            </p>
          ) : (
            <ul className="space-y-3 text-sm">
              {pastDeals.map((d) => renderDealCard(d, true))}
            </ul>
          )}
        </section>

        <section className="space-y-3 rounded-lg border border-[var(--border)] bg-[var(--card)] p-4">
          <h2 className="font-medium text-[var(--foreground)]">Optional price proposal</h2>
          <p className="text-xs text-[var(--muted)]">
            Applies to the next &quot;Start deal&quot; from search results. Leave empty to skip
            straight to payment (seller must still accept if you use an offer).
          </p>
          <div className="grid grid-cols-2 gap-2 text-sm">
            <label className="grid gap-1">
              <span className="text-[var(--muted)]">Amount</span>
              <input
                className="rounded border border-[var(--border)] bg-[var(--background)] px-2 py-1.5 text-[var(--foreground)]"
                value={offerAmount}
                onChange={(e) => setOfferAmount(e.target.value)}
                placeholder="100"
              />
            </label>
            <label className="grid gap-1">
              <span className="text-[var(--muted)]">Currency</span>
              <input
                className="rounded border border-[var(--border)] bg-[var(--background)] px-2 py-1.5 text-[var(--foreground)]"
                value={offerCurrency}
                onChange={(e) => setOfferCurrency(e.target.value)}
                placeholder="e.g. USDC"
              />
            </label>
          </div>
        </section>

        <section className="space-y-3 rounded-lg border border-[var(--border)] bg-[var(--card)] p-4">
          <h2 className="font-medium text-[var(--foreground)]">Search</h2>
          <form onSubmit={search} className="grid gap-3 text-sm">
            <label className="grid gap-1">
              <span className="text-[var(--muted)]">Query</span>
              <input
                className="rounded border border-[var(--border)] bg-[var(--background)] px-2 py-1.5 text-[var(--foreground)]"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder="e.g. ice cream preferences Cambridge"
              />
            </label>
            <label className="grid gap-1">
              <span className="text-[var(--muted)]">Region hint (optional)</span>
              <input
                className="rounded border border-[var(--border)] bg-[var(--background)] px-2 py-1.5 text-[var(--foreground)]"
                value={region}
                onChange={(e) => setRegion(e.target.value)}
                placeholder="Massachusetts"
              />
            </label>
            <button
              type="submit"
              disabled={!apiKey}
              className="rounded bg-[var(--foreground)] px-3 py-2 font-medium text-[var(--background)] hover:opacity-90 disabled:opacity-40"
            >
              Search
            </button>
          </form>
          {searchNote && (
            <p className="text-sm text-[var(--muted)]">{searchNote}</p>
          )}
        </section>

        <section className="space-y-4">
          <h2 className="text-lg font-medium text-[var(--foreground)]">Results</h2>
          {!apiKey ? (
            <p className="text-sm text-[var(--muted)]">Register to search.</p>
          ) : results.length === 0 ? (
            <p className="text-sm text-[var(--muted)]">No results yet. Run a search.</p>
          ) : (
            results.map((listing) => (
              <div key={listing.id} className="space-y-2">
                <ListingPreview listing={listing} />
                <button
                  type="button"
                  disabled={connectFor === listing.id}
                  onClick={() => connect(listing.id)}
                  className="rounded border border-[var(--accent)] px-3 py-1.5 text-sm text-[var(--accent)] hover:bg-[var(--accent)]/10 disabled:opacity-40"
                >
                  {connectFor === listing.id ? "Starting…" : "Start deal on this listing"}
                </button>
              </div>
            ))
          )}
        </section>
      </div>
    </main>
  );
}
