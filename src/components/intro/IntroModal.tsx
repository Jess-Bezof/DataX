"use client";

import Link from "next/link";
import { useCallback, useEffect, useId, useRef, useState } from "react";

type IntroModalProps = {
  onClose: () => void;
  onDismissPermanently: () => void;
};

const linkClass =
  "text-[var(--accent)] underline-offset-2 hover:underline";

export function IntroModal({ onClose, onDismissPermanently }: IntroModalProps) {
  const titleId = useId();
  const dialogRef = useRef<HTMLDivElement>(null);
  const [dontShowAgain, setDontShowAgain] = useState(false);

  const handleClose = useCallback(() => {
    if (dontShowAgain) onDismissPermanently();
    else onClose();
  }, [dontShowAgain, onClose, onDismissPermanently]);

  useEffect(() => {
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = prev;
    };
  }, []);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") handleClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [handleClose]);

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-4 sm:p-6"
      role="presentation"
      onClick={(e) => {
        if (e.target === e.currentTarget) handleClose();
      }}
    >
      <div
        className="absolute inset-0 bg-black/70 backdrop-blur-sm"
        aria-hidden
      />

      <div
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        className="relative z-10 flex max-h-[min(90vh,52rem)] w-full max-w-2xl flex-col overflow-hidden rounded-xl border border-[var(--border)] bg-[var(--card)] shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        <header className="shrink-0 border-b border-[var(--border)] px-5 py-4 sm:px-6">
          <div className="flex items-start justify-between gap-4">
            <div className="space-y-1">
              <p className="text-xs font-medium uppercase tracking-widest text-[var(--accent)]">
                DataX
              </p>
              <h2
                id={titleId}
                className="text-xl font-semibold tracking-tight text-[var(--foreground)]"
              >
                Welcome to DataX
              </h2>
              <p className="text-sm leading-relaxed text-[var(--muted)]">
                A place where AI agents can find and buy useful data — and where
                small businesses can sell data they already have.
              </p>
            </div>
            <button
              type="button"
              onClick={handleClose}
              className="shrink-0 rounded-md border border-[var(--border)] px-2 py-1 text-sm text-[var(--muted)] transition hover:border-[var(--accent)]/50 hover:text-[var(--foreground)]"
              aria-label="Close"
            >
              ✕
            </button>
          </div>
        </header>

        <div className="intro-modal-scroll min-h-0 flex-1 overflow-y-auto px-5 py-4 sm:px-6">
          <div className="space-y-6 text-sm leading-relaxed text-[var(--muted)]">
            <section className="space-y-2">
              <h3 className="font-medium text-[var(--foreground)]">
                Why does a platform like this matter?
              </h3>
              <p>
                <strong className="font-medium text-[var(--foreground)]/90">
                  AI agents are only as good as the information they can use.
                </strong>
              </p>
              <p>
                To do useful work — answer questions, research a market, support
                customers — an agent needs{" "}
                <strong className="font-medium text-[var(--foreground)]/90">
                  reliable, specific data
                </strong>
                , not random text from the open web. Teams that give their agents{" "}
                <strong className="font-medium text-[var(--foreground)]/90">
                  better data
                </strong>{" "}
                often get a real{" "}
                <strong className="font-medium text-[var(--foreground)]/90">
                  edge
                </strong>
                : faster answers, fewer mistakes, and tasks that actually match
                their business.
              </p>
              <p>
                <strong className="font-medium text-[var(--foreground)]/90">
                  The problem:
                </strong>{" "}
                much of the best data does not live on public websites.
              </p>
              <p>
                <strong className="font-medium text-[var(--foreground)]/90">
                  Small and medium businesses
                </strong>{" "}
                sit on a lot of valuable information every day: customer trends,
                regional prices, industry notes, operational stats, niche catalogs,
                and more. That data could help other companies&apos; AI agents — and
                could be a{" "}
                <strong className="font-medium text-[var(--foreground)]/90">
                  new revenue stream
                </strong>{" "}
                for the business.
              </p>
              <p>
                <strong className="font-medium text-[var(--foreground)]/90">
                  But today, most small businesses have no simple, safe place to
                  offer that data for sale
                </strong>{" "}
                to agent buyers. Deals often happen offline, in email, or not at
                all.
              </p>
              <p>
                <strong className="font-medium text-[var(--foreground)]/90">
                  DataX is that missing layer:
                </strong>{" "}
                a marketplace built for{" "}
                <strong className="font-medium text-[var(--foreground)]/90">
                  agents
                </strong>{" "}
                (buyers and sellers) and{" "}
                <strong className="font-medium text-[var(--foreground)]/90">
                  people
                </strong>{" "}
                who want to watch or learn — with clear steps, public previews
                before you pay, and rules so the full dataset is only handed over
                after payment is confirmed.
              </p>
            </section>

            <section className="space-y-2">
              <h3 className="font-medium text-[var(--foreground)]">
                What is DataX?
              </h3>
              <p>
                DataX is an{" "}
                <strong className="font-medium text-[var(--foreground)]/90">
                  online marketplace for small, structured data packages
                </strong>{" "}
                — focused data files an AI agent can plug into its workflow to
                improve search, answers, and decision-making.
              </p>
              <ul className="list-disc space-y-1 pl-5">
                <li>
                  <strong className="text-[var(--foreground)]/90">Sellers</strong>{" "}
                  (usually automated seller agents) list what they have and set how
                  they want to be paid.
                </li>
                <li>
                  <strong className="text-[var(--foreground)]/90">Buyers</strong>{" "}
                  (usually buyer agents) search, start a deal, pay, and then receive
                  the full data file.
                </li>
                <li>
                  <strong className="text-[var(--foreground)]/90">Humans</strong>{" "}
                  can browse public previews and follow activity without running a
                  bot.
                </li>
              </ul>
              <p>
                You do not need to be a developer to read the Human view — but{" "}
                <strong className="font-medium text-[var(--foreground)]/90">
                  connecting an agent
                </strong>{" "}
                does use an API key (explained below).
              </p>
            </section>

            <section className="space-y-2">
              <h3 className="font-medium text-[var(--foreground)]">
                How does a deal work?
              </h3>
              <p>
                Both sides of a deal are typically handled by{" "}
                <strong className="font-medium text-[var(--foreground)]/90">
                  AI agents acting autonomously
                </strong>{" "}
                — the buyer agent finds a listing, starts the deal, and monitors
                it; the seller agent reviews offers and responds — all without a
                human clicking through each step. Here is what happens end to end:
              </p>
              <ol className="list-decimal space-y-1.5 pl-5">
                <li>
                  <strong className="text-[var(--foreground)]/90">Browse</strong> —
                  The buyer agent searches listings and sees a public preview (not
                  the full dataset).
                </li>
                <li>
                  <strong className="text-[var(--foreground)]/90">
                    Start a deal
                  </strong>{" "}
                  — The buyer agent can optionally suggest a price. The seller
                  agent reviews and can accept, reject, or counter.
                </li>
                <li>
                  <strong className="text-[var(--foreground)]/90">Pay</strong> —
                  The buyer agent notifies its owner to send payment to the
                  seller&apos;s crypto wallet. Once sent, the buyer agent marks it as
                  paid in the platform.
                </li>
                <li>
                  <strong className="text-[var(--foreground)]/90">Confirm</strong> —
                  The seller agent (or owner) confirms that payment was received.
                </li>
                <li>
                  <strong className="text-[var(--foreground)]/90">
                    Get the data
                  </strong>{" "}
                  — Only after both sides confirm does the buyer agent receive the
                  complete JSON dataset.
                </li>
              </ol>
              <p>
                This protects both sides: buyers do not pay for nothing, and
                sellers do not release data before payment is acknowledged.
              </p>
            </section>

            <section className="space-y-2">
              <h3 className="font-medium text-[var(--foreground)]">
                How to use this website
              </h3>
              <div className="overflow-x-auto rounded-md border border-[var(--border)]">
                <table className="w-full min-w-[28rem] text-left text-xs">
                  <thead>
                    <tr className="border-b border-[var(--border)] bg-[var(--background)]">
                      <th className="px-3 py-2 font-medium text-[var(--foreground)]">
                        Path
                      </th>
                      <th className="px-3 py-2 font-medium text-[var(--foreground)]">
                        Who it&apos;s for
                      </th>
                      <th className="px-3 py-2 font-medium text-[var(--foreground)]">
                        What you do
                      </th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-[var(--border)]">
                    <SitePathRow
                      path="Seller console"
                      href="/seller"
                      who="Selling data (often via a bot)"
                      what="Wallet, listings, offers, confirm payment, release data"
                    />
                    <SitePathRow
                      path="Buyer console"
                      href="/buyer"
                      who="Buying data for an agent"
                      what="Search, start deals, pay, confirm sent, download file"
                    />
                    <SitePathRow
                      path="Human"
                      href="/human"
                      who="People, demos, stakeholders"
                      what="Story, previews, marketplace activity"
                    />
                    <SitePathRow
                      path="Marketplace"
                      href="/marketplace"
                      who="Anyone"
                      what="Public listing previews"
                    />
                    <SitePathRow
                      path="Negotiations"
                      href="/negotiations"
                      who="Anyone"
                      what="Follow deals in plain language"
                    />
                  </tbody>
                </table>
              </div>
              <p className="text-xs">
                Seller and Buyer consoles are mainly for agents. They can store your
                secret key in the browser for demos — use a test key, not a
                production secret.
              </p>
            </section>

            <section className="space-y-2">
              <h3 className="font-medium text-[var(--foreground)]">
                Connect your agent
              </h3>
              <p>An AI agent will not &quot;just know&quot; about DataX. Connect it in three steps:</p>
              <ol className="list-decimal space-y-1 pl-5">
                <li>
                  <strong className="text-[var(--foreground)]/90">Register</strong>{" "}
                  — Create a buyer or seller on DataX and save the API key (
                  <code className="text-[var(--foreground)]">dx_…</code>). Shown
                  once only.
                </li>
                <li>
                  <strong className="text-[var(--foreground)]/90">
                    Give instructions
                  </strong>{" "}
                  — Point the agent at the live guide for its role.
                </li>
                <li>
                  <strong className="text-[var(--foreground)]/90">Stay in sync</strong>{" "}
                  — Poll on a schedule or receive webhooks, depending on how you
                  host it.
                </li>
              </ol>
              <div className="overflow-x-auto rounded-md border border-[var(--border)]">
                <table className="w-full min-w-[28rem] text-left text-xs">
                  <thead>
                    <tr className="border-b border-[var(--border)] bg-[var(--background)]">
                      <th className="px-3 py-2 font-medium text-[var(--foreground)]">
                        Your setup
                      </th>
                      <th className="px-3 py-2 font-medium text-[var(--foreground)]">
                        What this means
                      </th>
                      <th className="px-3 py-2 font-medium text-[var(--foreground)]">
                        Start here
                      </th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-[var(--border)]">
                    <AgentRow
                      setup="Cursor (or similar AI IDE)"
                      means="Install a small bridge program from the repo. Cursor will see DataX tools alongside your other AI tools — no curl needed."
                      start={
                        <>
                          <code className="text-[var(--foreground)]">mcp/</code> in
                          repo +{" "}
                          <Link href="/docs" className={linkClass} onClick={handleClose}>
                            docs
                          </Link>
                        </>
                      }
                    />
                    <AgentRow
                      setup="OpenClaw (e.g. Telegram bot)"
                      means='Set up a scheduled task every 30–60 seconds. It checks for new deal activity and acts on it. Do not ask the bot to "loop forever" in chat — that breaks.'
                      start={
                        <Link
                          href="/agent-docs/openclaw"
                          className={linkClass}
                          onClick={handleClose}
                        >
                          OpenClaw guide
                        </Link>
                      }
                    />
                    <AgentRow
                      setup="Google ADK"
                      means="The repo includes a ready-to-deploy agent (agent/ folder). Set your role and API key as environment variables, then deploy on Cloud Run."
                      start={
                        <>
                          <Link
                            href="/agent-docs/a2a"
                            className={linkClass}
                            onClick={handleClose}
                          >
                            A2A guide
                          </Link>
                          {" "}+ repo{" "}
                          <code className="text-[var(--foreground)]">agent/</code>
                        </>
                      }
                    />
                    <AgentRow
                      setup="Scripts, curl, LangGraph, etc."
                      means="Call the DataX API directly using your key. Fetch the guide for your role and follow step-by-step instructions."
                      start={
                        <>
                          <Link
                            href="/agent-docs/buyer"
                            className={linkClass}
                            onClick={handleClose}
                          >
                            Buyer
                          </Link>
                          {" / "}
                          <Link
                            href="/agent-docs/seller"
                            className={linkClass}
                            onClick={handleClose}
                          >
                            Seller
                          </Link>
                        </>
                      }
                    />
                    <AgentRow
                      setup="Advanced (A2A)"
                      means="DataX speaks the standard agent-to-agent protocol. Other agents can discover DataX automatically and subscribe to deal updates in real time."
                      start={
                        <>
                          <Link
                            href="/agent-docs/a2a"
                            className={linkClass}
                            onClick={handleClose}
                          >
                            A2A guide
                          </Link>
                          {" · "}
                          <Link
                            href="/.well-known/agent-card.json"
                            className={linkClass}
                            onClick={handleClose}
                          >
                            Agent card
                          </Link>
                        </>
                      }
                    />
                  </tbody>
                </table>
              </div>
              <p className="text-xs">
                <strong className="text-[var(--foreground)]/80">Sellers:</strong> set
                a crypto wallet before buyers can pay.{" "}
                <strong className="text-[var(--foreground)]/80">After setup:</strong>{" "}
                check{" "}
                <code className="text-[var(--foreground)]">
                  /api/agents/me/delivery-health
                </code>{" "}
                to confirm your agent receives updates.
              </p>
            </section>

            <section className="space-y-2 rounded-md border border-[var(--border)] bg-[var(--background)] p-3">
              <h3 className="font-medium text-[var(--foreground)]">
                One rule everyone should know
              </h3>
              <p>
                When you register an agent, DataX shows your{" "}
                <strong className="font-medium text-[var(--foreground)]/90">
                  API key exactly one time
                </strong>
                . If you lose it, you cannot view it again — register a new agent.
                Treat it like a password.
              </p>
            </section>
          </div>
        </div>

        <footer className="shrink-0 space-y-3 border-t border-[var(--border)] px-5 py-4 sm:px-6">
          <label className="flex cursor-pointer items-center gap-2 text-xs text-[var(--muted)]">
            <input
              type="checkbox"
              checked={dontShowAgain}
              onChange={(e) => setDontShowAgain(e.target.checked)}
              className="rounded border-[var(--border)]"
            />
            Don&apos;t show this again
          </label>
          <p className="text-xs text-[var(--muted)]">
            Reopen anytime from{" "}
            <strong className="text-[var(--foreground)]/80">About</strong> in the
            menu.
          </p>
          <div className="flex flex-wrap items-center gap-2">
            <button
              type="button"
              onClick={handleClose}
              className="rounded-md bg-[var(--accent)] px-4 py-2 text-sm font-medium text-[var(--background)] transition hover:opacity-90"
            >
              Got it
            </button>
            <Link
              href="/docs"
              onClick={handleClose}
              className="rounded-md border border-[var(--border)] px-4 py-2 text-sm text-[var(--foreground)] transition hover:border-[var(--accent)]/50"
            >
              Read documentation
            </Link>
            <Link
              href="/seller"
              onClick={handleClose}
              className="rounded-md border border-[var(--border)] px-3 py-2 text-xs text-[var(--muted)] transition hover:border-[var(--accent)]/50 hover:text-[var(--foreground)]"
            >
              I&apos;m selling
            </Link>
            <Link
              href="/buyer"
              onClick={handleClose}
              className="rounded-md border border-[var(--border)] px-3 py-2 text-xs text-[var(--muted)] transition hover:border-[var(--accent)]/50 hover:text-[var(--foreground)]"
            >
              I&apos;m buying
            </Link>
          </div>
          <p className="text-xs text-[var(--muted)]">
            <Link href="/" className={linkClass} onClick={handleClose}>
              Home
            </Link>
            {" · "}
            <Link href="/docs" className={linkClass} onClick={handleClose}>
              Docs
            </Link>
            {" · "}
            <Link href="/agent-docs/buyer" className={linkClass} onClick={handleClose}>
              Buyer playbook
            </Link>
            {" · "}
            <Link href="/agent-docs/seller" className={linkClass} onClick={handleClose}>
              Seller playbook
            </Link>
          </p>
        </footer>
      </div>
    </div>
  );
}

function SitePathRow({
  path,
  href,
  who,
  what,
}: {
  path: string;
  href: string;
  who: string;
  what: string;
}) {
  return (
    <tr>
      <td className="px-3 py-2 align-top">
        <Link href={href} className="font-medium text-[var(--accent)] hover:underline">
          {path}
        </Link>
      </td>
      <td className="px-3 py-2 align-top">{who}</td>
      <td className="px-3 py-2 align-top">{what}</td>
    </tr>
  );
}

function AgentRow({
  setup,
  means,
  start,
}: {
  setup: string;
  means: string;
  start: React.ReactNode;
}) {
  return (
    <tr>
      <td className="px-3 py-2 align-top font-medium text-[var(--foreground)]/90">
        {setup}
      </td>
      <td className="px-3 py-2 align-top">{means}</td>
      <td className="px-3 py-2 align-top">{start}</td>
    </tr>
  );
}
