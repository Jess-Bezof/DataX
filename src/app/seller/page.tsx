"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { SiteNav } from "@/components/SiteNav";
import { ListingPreview } from "@/components/ListingPreview";
import { CONTACT_METHODS } from "@/types/datax";
import type { ListingPreview as ListingPreviewType } from "@/types/datax";

const STORAGE = "datax_seller_api_key";

const ACTIVE_DEAL = new Set([
  "offer_pending",
  "awaiting_payment",
  "buyer_marked_sent",
]);

const BACKUP_METHODS = CONTACT_METHODS.filter((m) => m !== "platform");

function splitList(s: string): string[] {
  return s
    .split(/[\n,]+/)
    .map((x) => x.trim())
    .filter(Boolean);
}

type DealRow = {
  dealId: string;
  status: string;
  role: string;
  proposedAmount?: string;
  proposedCurrency?: string;
  counterpartyName: string;
  listing: ListingPreviewType | null;
  updatedAt: string;
};

export default function SellerPage() {
  const [apiKey, setApiKey] = useState("");
  const [shownKey, setShownKey] = useState<string | null>(null);
  const [mine, setMine] = useState<ListingPreviewType[]>([]);
  const [deals, setDeals] = useState<DealRow[]>([]);
  const [msg, setMsg] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);

  const [regName, setRegName] = useState("");
  const [regWallet, setRegWallet] = useState("");
  const [backupMethod, setBackupMethod] = useState("email");
  const [backupValue, setBackupValue] = useState("");

  const [walletInput, setWalletInput] = useState("");

  const [title, setTitle] = useState("");
  const [summary, setSummary] = useState("");
  const [validFrom, setValidFrom] = useState("");
  const [validTo, setValidTo] = useState("");
  const [regionsText, setRegionsText] = useState("");
  const [columnsText, setColumnsText] = useState("");
  const [sampleRowText, setSampleRowText] = useState('{\n  "example": "value"\n}');
  const [payloadText, setPayloadText] = useState("[]");

  const sellerDeals = useMemo(
    () => deals.filter((d) => d.role === "seller"),
    [deals]
  );
  const activeDeals = useMemo(
    () => sellerDeals.filter((d) => ACTIVE_DEAL.has(d.status)),
    [sellerDeals]
  );
  const completedDeals = useMemo(
    () => sellerDeals.filter((d) => d.status === "released"),
    [sellerDeals]
  );

  const loadMine = useCallback(async (key: string) => {
    const r = await fetch("/api/listings/mine", {
      headers: { Authorization: `Bearer ${key}` },
    });
    const data = await r.json();
    if (!r.ok) throw new Error(data.error || "Could not load listings");
    setMine(data.listings ?? []);
  }, []);

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
      loadMine(k).catch(() => {});
      loadDeals(k).catch(() => {});
    }
  }, [loadMine, loadDeals]);

  async function register(e: React.FormEvent) {
    e.preventDefault();
    setErr(null);
    setMsg(null);
    try {
      const body: Record<string, string | undefined> = {
        role: "seller",
        displayName: regName,
      };
      if (regWallet.trim()) body.cryptoWallet = regWallet.trim();
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
      await loadMine(data.apiKey);
      await loadDeals(data.apiKey);
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Error");
    }
  }

  async function saveWallet(e: React.FormEvent) {
    e.preventDefault();
    setErr(null);
    setMsg(null);
    if (!apiKey) return;
    try {
      const r = await fetch("/api/agents/me", {
        method: "PATCH",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${apiKey}`,
        },
        body: JSON.stringify({
          cryptoWallet: walletInput.trim() === "" ? "" : walletInput.trim(),
        }),
      });
      const data = await r.json();
      if (!r.ok) throw new Error(data.error || "Save failed");
      setMsg(data.message);
      setWalletInput(data.cryptoWallet ?? "");
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Error");
    }
  }

  async function publish(e: React.FormEvent) {
    e.preventDefault();
    setErr(null);
    setMsg(null);
    if (!apiKey) {
      setErr("Register first to get an API key.");
      return;
    }
    let sampleRow: object;
    let fullPayload: unknown;
    try {
      sampleRow = JSON.parse(sampleRowText);
      if (sampleRow === null || typeof sampleRow !== "object" || Array.isArray(sampleRow)) {
        throw new Error("sampleRow must be a JSON object");
      }
    } catch {
      setErr("sampleRow must be valid JSON object");
      return;
    }
    try {
      fullPayload = JSON.parse(payloadText);
    } catch {
      setErr("fullPayload must be valid JSON");
      return;
    }
    const columns = splitList(columnsText);
    if (!columns.length) {
      setErr("Add at least one column name");
      return;
    }
    try {
      const r = await fetch("/api/listings", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${apiKey}`,
        },
        body: JSON.stringify({
          title,
          summary,
          validFrom: new Date(validFrom).toISOString(),
          validTo: new Date(validTo).toISOString(),
          regions: splitList(regionsText),
          columns,
          sampleRow,
          fullPayload,
        }),
      });
      const data = await r.json();
      if (!r.ok) throw new Error(data.error || "Publish failed");
      setMsg("Listing published (public preview only for buyers).");
      await loadMine(apiKey);
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Error");
    }
  }

  async function dealAction(
    dealId: string,
    path: "seller-accept" | "seller-reject" | "seller-received"
  ) {
    setErr(null);
    if (!apiKey) return;
    const r = await fetch(`/api/deals/${dealId}/${path}`, {
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

  function logout() {
    localStorage.removeItem(STORAGE);
    setApiKey("");
    setMine([]);
    setDeals([]);
    setShownKey(null);
    setMsg("Cleared saved API key from this browser.");
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
            Seller dashboard
          </h1>
          <p className="mt-2 text-sm text-[var(--muted)]">
            Negotiation and delivery run on DataX (deals + wallet + confirmations).
            You do <strong className="text-[var(--foreground)]">not</strong> need email or
            Telegram for the default flow. This screen is your hub: wallet, active deals,
            completed sales, listings, and publish.
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
          <section className="grid grid-cols-3 gap-2 rounded-lg border border-[var(--border)] bg-[var(--card)] p-3 text-center text-sm">
            <div>
              <p className="text-2xl font-semibold text-[var(--accent)]">{mine.length}</p>
              <p className="text-[var(--muted)]">Listings</p>
            </div>
            <div>
              <p className="text-2xl font-semibold text-[var(--accent)]">
                {activeDeals.length}
              </p>
              <p className="text-[var(--muted)]">Active deals</p>
            </div>
            <div>
              <p className="text-2xl font-semibold text-[var(--accent)]">
                {completedDeals.length}
              </p>
              <p className="text-[var(--muted)]">Sales done</p>
            </div>
          </section>
        )}

        <section className="space-y-3 rounded-lg border border-[var(--border)] bg-[var(--card)] p-4">
          <h2 className="font-medium text-[var(--foreground)]">
            {apiKey ? "Account" : "Register seller"}
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
              <label className="grid gap-1">
                <span className="text-[var(--muted)]">Crypto payout wallet</span>
                <input
                  className="rounded border border-[var(--border)] bg-[var(--background)] px-2 py-1.5 font-mono text-xs text-[var(--foreground)]"
                  value={regWallet}
                  onChange={(e) => setRegWallet(e.target.value)}
                  placeholder="Required before buyers can pay you"
                />
              </label>
              <details className="rounded border border-[var(--border)] bg-[var(--background)]/50 p-2">
                <summary className="cursor-pointer text-[var(--muted)]">
                  Optional backup contact (off-platform only)
                </summary>
                <p className="mt-2 text-xs text-[var(--muted)]">
                  Leave folded for platform-only. If you open this, fill both method and value.
                </p>
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
                Create seller &amp; API key
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

        <section className="space-y-3 rounded-lg border border-[var(--border)] bg-[var(--card)] p-4">
          <h2 className="font-medium text-[var(--foreground)]">Payout wallet</h2>
          <p className="text-xs text-[var(--muted)]">
            Buyers see this during checkout. Empty + save clears the wallet.
          </p>
          <form onSubmit={saveWallet} className="flex flex-col gap-2 sm:flex-row sm:items-end">
            <label className="grid flex-1 gap-1 text-sm">
              <span className="text-[var(--muted)]">Wallet address</span>
              <input
                className="rounded border border-[var(--border)] bg-[var(--background)] px-2 py-1.5 font-mono text-xs text-[var(--foreground)]"
                value={walletInput}
                onChange={(e) => setWalletInput(e.target.value)}
                disabled={!apiKey}
              />
            </label>
            <button
              type="submit"
              disabled={!apiKey}
              className="rounded bg-[var(--foreground)] px-3 py-2 text-sm font-medium text-[var(--background)] disabled:opacity-40"
            >
              Save wallet
            </button>
          </form>
        </section>

        <section className="space-y-3">
          <h2 className="text-lg font-medium text-[var(--foreground)]">Active deals</h2>
          {!apiKey || activeDeals.length === 0 ? (
            <p className="text-sm text-[var(--muted)]">
              {apiKey ? "No active deals." : "Register to see deals."}
            </p>
          ) : (
            <ul className="space-y-3 text-sm">
              {activeDeals.map((d) => (
                <li
                  key={d.dealId}
                  className="rounded-lg border border-[var(--border)] bg-[var(--card)] p-3"
                >
                  <p className="font-medium text-[var(--foreground)]">
                    {d.listing?.title ?? "Listing"} ·{" "}
                    <span className="text-[var(--muted)]">{d.status}</span>
                  </p>
                  <p className="text-xs text-[var(--muted)]">
                    Buyer: {d.counterpartyName}
                    {d.proposedAmount
                      ? ` · Offer: ${d.proposedAmount} ${d.proposedCurrency ?? ""}`
                      : ""}
                  </p>
                  {d.status === "offer_pending" && (
                    <div className="mt-2 flex flex-wrap gap-2">
                      <button
                        type="button"
                        onClick={() => dealAction(d.dealId, "seller-accept")}
                        className="rounded bg-[var(--accent)] px-2 py-1 text-xs font-medium text-black"
                      >
                        Accept offer
                      </button>
                      <button
                        type="button"
                        onClick={() => dealAction(d.dealId, "seller-reject")}
                        className="rounded border border-[var(--border)] px-2 py-1 text-xs"
                      >
                        Reject
                      </button>
                    </div>
                  )}
                  {d.status === "buyer_marked_sent" && (
                    <button
                      type="button"
                      onClick={() => dealAction(d.dealId, "seller-received")}
                      className="mt-2 rounded border border-[var(--accent)] px-2 py-1 text-[var(--accent)]"
                    >
                      I received the crypto
                    </button>
                  )}
                </li>
              ))}
            </ul>
          )}
        </section>

        <section className="space-y-3">
          <h2 className="text-lg font-medium text-[var(--foreground)]">Completed sales</h2>
          {!apiKey || completedDeals.length === 0 ? (
            <p className="text-sm text-[var(--muted)]">
              {apiKey ? "No completed releases yet." : "Register to see history."}
            </p>
          ) : (
            <ul className="space-y-2 text-sm text-[var(--muted)]">
              {completedDeals.map((d) => (
                <li
                  key={d.dealId}
                  className="rounded border border-[var(--border)] bg-[var(--card)] px-3 py-2"
                >
                  <span className="text-[var(--foreground)]">
                    {d.listing?.title ?? "Listing"}
                  </span>{" "}
                  → buyer {d.counterpartyName}
                  <time className="mt-1 block text-xs">
                    {new Date(d.updatedAt).toLocaleString()}
                  </time>
                </li>
              ))}
            </ul>
          )}
        </section>

        <section className="space-y-3 rounded-lg border border-[var(--border)] bg-[var(--card)] p-4">
          <h2 className="font-medium text-[var(--foreground)]">Publish listing</h2>
          <form onSubmit={publish} className="grid gap-3 text-sm">
            <label className="grid gap-1">
              <span className="text-[var(--muted)]">Title</span>
              <input
                required
                className="rounded border border-[var(--border)] bg-[var(--background)] px-2 py-1.5 text-[var(--foreground)]"
                value={title}
                onChange={(e) => setTitle(e.target.value)}
              />
            </label>
            <label className="grid gap-1">
              <span className="text-[var(--muted)]">Summary</span>
              <textarea
                required
                rows={3}
                className="rounded border border-[var(--border)] bg-[var(--background)] px-2 py-1.5 text-[var(--foreground)]"
                value={summary}
                onChange={(e) => setSummary(e.target.value)}
              />
            </label>
            <div className="grid grid-cols-2 gap-2">
              <label className="grid gap-1">
                <span className="text-[var(--muted)]">Valid from</span>
                <input
                  required
                  type="date"
                  className="rounded border border-[var(--border)] bg-[var(--background)] px-2 py-1.5 text-[var(--foreground)]"
                  value={validFrom}
                  onChange={(e) => setValidFrom(e.target.value)}
                />
              </label>
              <label className="grid gap-1">
                <span className="text-[var(--muted)]">Valid to</span>
                <input
                  required
                  type="date"
                  className="rounded border border-[var(--border)] bg-[var(--background)] px-2 py-1.5 text-[var(--foreground)]"
                  value={validTo}
                  onChange={(e) => setValidTo(e.target.value)}
                />
              </label>
            </div>
            <label className="grid gap-1">
              <span className="text-[var(--muted)]">Regions (comma or newline)</span>
              <textarea
                rows={2}
                className="rounded border border-[var(--border)] bg-[var(--background)] px-2 py-1.5 text-[var(--foreground)]"
                value={regionsText}
                onChange={(e) => setRegionsText(e.target.value)}
              />
            </label>
            <label className="grid gap-1">
              <span className="text-[var(--muted)]">Column names (comma or newline)</span>
              <textarea
                required
                rows={2}
                className="rounded border border-[var(--border)] bg-[var(--background)] px-2 py-1.5 text-[var(--foreground)]"
                value={columnsText}
                onChange={(e) => setColumnsText(e.target.value)}
              />
            </label>
            <label className="grid gap-1">
              <span className="text-[var(--muted)]">Sample row (JSON object)</span>
              <textarea
                rows={4}
                className="rounded border border-[var(--border)] bg-[var(--background)] px-2 py-1.5 font-mono text-xs text-[var(--foreground)]"
                value={sampleRowText}
                onChange={(e) => setSampleRowText(e.target.value)}
              />
            </label>
            <label className="grid gap-1">
              <span className="text-[var(--muted)]">Full dataset (JSON)</span>
              <textarea
                rows={6}
                className="rounded border border-[var(--border)] bg-[var(--background)] px-2 py-1.5 font-mono text-xs text-[var(--foreground)]"
                value={payloadText}
                onChange={(e) => setPayloadText(e.target.value)}
              />
            </label>
            <button
              type="submit"
              disabled={!apiKey}
              className="rounded bg-[var(--foreground)] px-3 py-2 font-medium text-[var(--background)] hover:opacity-90 disabled:opacity-40"
            >
              Publish
            </button>
          </form>
        </section>

        <section className="space-y-3">
          <h2 className="text-lg font-medium text-[var(--foreground)]">Your listings</h2>
          {!apiKey ? (
            <p className="text-sm text-[var(--muted)]">Register to see your catalog.</p>
          ) : mine.length === 0 ? (
            <p className="text-sm text-[var(--muted)]">None yet.</p>
          ) : (
            <div className="flex flex-col gap-4">
              {mine.map((l) => (
                <ListingPreview key={l.id} listing={l} />
              ))}
            </div>
          )}
        </section>
      </div>
    </main>
  );
}
