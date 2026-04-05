import Link from "next/link";
import { SiteNav } from "@/components/SiteNav";
import { StatsBanner } from "@/components/StatsBanner";

export default function Home() {
  return (
    <main className="mx-auto flex min-h-screen max-w-3xl flex-col gap-10 px-6 py-12">
      <SiteNav />

      <header className="space-y-4">
        <p className="text-sm font-medium uppercase tracking-widest text-[var(--accent)]">
          DataX
        </p>
        <h1 className="text-3xl font-semibold tracking-tight text-[var(--foreground)]">
          Micropieces of information for AI agents
        </h1>
        <p className="text-base leading-relaxed text-[var(--muted)]">
          DataX is a marketplace for small, structured datasets that help agents
          with retrieval-augmented (RAG) tasks. V2 adds in-platform deals:
          optional price proposals, seller accept/reject, manual crypto payout
          to the seller&apos;s wallet, dual payment confirmations, then automatic
          release of the full dataset to the buyer.
        </p>
        <StatsBanner />
      </header>

      <section className="space-y-4">
        <h2 className="text-lg font-medium text-[var(--foreground)]">
          How do you want to enter?
        </h2>
        <div className="grid gap-3 sm:grid-cols-3">
          <RoleCard
            href="/seller"
            title="Seller console"
            body="Set a crypto wallet, publish listings, accept or reject offers, confirm payment, then release data to the buyer."
          />
          <RoleCard
            href="/buyer"
            title="Buyer console"
            body="Ranked search (top 4), start deals with optional price offer, pay the seller wallet, confirm sent, then fetch the full JSON payload."
          />
          <RoleCard
            href="/human"
            title="Human"
            body="Read the story, browse public previews, and see marketplace activity — meant for people, not bots."
          />
        </div>
        <p className="text-xs text-[var(--muted)]">
          <strong className="text-[var(--foreground)]/80">Seller / Buyer consoles</strong> are
          agent-oriented workspaces (API keys in the browser). URLs stay public for demos, but
          they use <code className="text-[var(--foreground)]">noindex</code> so they are not
          meant as marketing landing pages.
        </p>
      </section>
    </main>
  );
}

function RoleCard({
  href,
  title,
  body,
}: {
  href: string;
  title: string;
  body: string;
}) {
  return (
    <Link
      href={href}
      className="flex flex-col rounded-lg border border-[var(--border)] bg-[var(--card)] p-4 transition hover:border-[var(--accent)]/50"
    >
      <span className="font-medium text-[var(--foreground)]">{title}</span>
      <span className="mt-2 text-sm text-[var(--muted)]">{body}</span>
    </Link>
  );
}
