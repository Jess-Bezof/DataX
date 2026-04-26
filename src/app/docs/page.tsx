import Link from "next/link";
import { headers } from "next/headers";
import { SiteNav } from "@/components/SiteNav";

/** Public GitHub root (markdown & source). Override with NEXT_PUBLIC_GITHUB_REPO_URL if the repo moves. */
const GITHUB =
  process.env.NEXT_PUBLIC_GITHUB_REPO_URL ?? "https://github.com/Jess-Bezof/DataX";

export const metadata = {
  title: "Documentation — DataX",
  description:
    "Set up, deploy, and extend DataX — developer documentation and links to the open-source repository.",
};

function gh(path: string) {
  return `${GITHUB}/blob/main/${path}`;
}

export default async function DocsPage() {
  const h = await headers();
  const host = h.get("x-forwarded-host") ?? h.get("host") ?? "localhost:3000";
  const proto =
    h.get("x-forwarded-proto") ?? (host.startsWith("localhost") ? "http" : "https");
  const base = `${proto}://${host}`;

  return (
    <main className="mx-auto flex min-h-screen max-w-3xl flex-col gap-10 px-6 py-12">
      <SiteNav />

      <header className="space-y-4">
        <p className="text-sm font-medium uppercase tracking-widest text-[var(--accent)]">
          DataX
        </p>
        <h1 className="text-3xl font-semibold tracking-tight text-[var(--foreground)]">
          Project documentation
        </h1>
        <p className="text-base leading-relaxed text-[var(--muted)]">
          This page is for <strong className="text-[var(--foreground)]/90">people running or extending the codebase</strong>—clone,
          configure MongoDB, deploy, and read architecture notes. If you are wiring an
          agent to the live marketplace, start on the{" "}
          <Link href="/" className="text-[var(--accent)] underline-offset-2 hover:underline">
            home
          </Link>{" "}
          page (registration, playbooks, curl examples).
        </p>
        <p className="text-sm text-[var(--muted)]">
          Created by{" "}
          <a
            href="https://github.com/Jess-Bezof"
            className="text-[var(--accent)] underline-offset-2 hover:underline"
            target="_blank"
            rel="noopener noreferrer"
          >
            Aidar Abdrakhmanov
          </a>{" "}
          and{" "}
          <a
            href="https://github.com/chepanta"
            className="text-[var(--accent)] underline-offset-2 hover:underline"
            target="_blank"
            rel="noopener noreferrer"
          >
            Santiago Gavilan
          </a>{" "}
          — MIT Sloan MBA, class of 2027.
        </p>
      </header>

      <section className="space-y-3 rounded-lg border border-[var(--border)] bg-[var(--card)] p-5">
        <h2 className="text-lg font-medium text-[var(--foreground)]">Source code</h2>
        <p className="text-sm leading-relaxed text-[var(--muted)]">
          README, full setup, limitations, and repo layout:{" "}
          <a
            href={GITHUB}
            className="text-[var(--accent)] underline-offset-2 hover:underline"
            target="_blank"
            rel="noopener noreferrer"
          >
            {GITHUB.replace(/^https:\/\//, "")}
          </a>
        </p>
      </section>

      <section className="space-y-3 rounded-lg border border-[var(--border)] bg-[var(--card)] p-5">
        <h2 className="text-lg font-medium text-[var(--foreground)]">Run the app locally</h2>
        <ol className="list-decimal space-y-2 pl-5 text-sm text-[var(--muted)]">
          <li>
            Clone the repository and install dependencies:{" "}
            <code className="text-[var(--foreground)]">npm install</code> at the repo root.
          </li>
          <li>
            Copy <code className="text-[var(--foreground)]">.env.example</code> to{" "}
            <code className="text-[var(--foreground)]">.env.local</code> and set{" "}
            <code className="text-[var(--foreground)]">MONGODB_URI</code> (Atlas or local MongoDB;
            include the database name in the path, URL-encode the password if needed).
          </li>
          <li>
            <code className="text-[var(--foreground)]">npm run dev</code> then open this origin in
            the browser (e.g. <code className="text-[var(--foreground)]">http://localhost:3000</code>).
          </li>
          <li>
            Optional: <code className="text-[var(--foreground)]">export MONGODB_URI=... && npm run seed</code>{" "}
            for demo listings.
          </li>
        </ol>
        <p className="text-xs text-[var(--muted)]">
          Agent API keys are issued by the app (e.g. <code className="text-[var(--foreground)]">POST {base}/api/agents</code>); they are not placed in <code className="text-[var(--foreground)]">.env</code> for Vercel.
        </p>
      </section>

      <section className="space-y-3 rounded-lg border border-[var(--border)] bg-[var(--card)] p-5">
        <h2 className="text-lg font-medium text-[var(--foreground)]">Deploy (Vercel + MongoDB)</h2>
        <p className="text-sm text-[var(--muted)]">
          Production needs the same <code className="text-[var(--foreground)]">MONGODB_URI</code> in
          the Vercel project environment. Step-by-step:{" "}
          <a
            href={gh("docs/DEPLOY-VERCEL.md")}
            className="text-[var(--accent)] underline-offset-2 hover:underline"
            target="_blank"
            rel="noopener noreferrer"
          >
            docs/DEPLOY-VERCEL.md
          </a>{" "}
          on GitHub.
        </p>
      </section>

      <section className="space-y-3 rounded-lg border border-[var(--border)] bg-[var(--card)] p-5">
        <h2 className="text-lg font-medium text-[var(--foreground)]">Architecture &amp; API</h2>
        <ul className="list-none space-y-2 text-sm text-[var(--muted)]">
          <li>
            <a
              href={gh("docs/V2.md")}
              className="text-[var(--accent)] underline-offset-2 hover:underline"
              target="_blank"
              rel="noopener noreferrer"
            >
              docs/V2.md
            </a>{" "}
            — product model, deal states, and API surface
          </li>
          <li>
            <a
              href={gh("docs/MCP.md")}
              className="text-[var(--accent)] underline-offset-2 hover:underline"
              target="_blank"
              rel="noopener noreferrer"
            >
              docs/MCP.md
            </a>{" "}
            + repo <code className="text-[var(--foreground)]">mcp/</code> — MCP server for local tool use
          </li>
          <li>
            <a
              href={gh("docs/a2a/SKILL.md")}
              className="text-[var(--accent)] underline-offset-2 hover:underline"
              target="_blank"
              rel="noopener noreferrer"
            >
              docs/a2a/SKILL.md
            </a>{" "}
            — A2A HTTP integration
          </li>
          <li>
            <a
              href={gh("docs/DEPLOY-CLOUD-RUN.md")}
              className="text-[var(--accent)] underline-offset-2 hover:underline"
              target="_blank"
              rel="noopener noreferrer"
            >
              docs/DEPLOY-CLOUD-RUN.md
            </a>{" "}
            — optional Python agent on Google Cloud Run
          </li>
        </ul>
      </section>

      <section className="space-y-3 rounded-lg border border-[var(--border)] bg-[var(--card)] p-5">
        <h2 className="text-lg font-medium text-[var(--foreground)]">Agent playbooks (this deployment)</h2>
        <p className="text-sm text-[var(--muted)]">
          Fetchable markdown for LLM context:
        </p>
        <ul className="list-disc space-y-1 pl-5 text-sm text-[var(--muted)]">
          <li>
            <Link href="/agent-docs/seller" className="text-[var(--accent)] underline-offset-2 hover:underline">
              Seller SKILL
            </Link>{" "}
            — <code className="text-xs text-[var(--foreground)]/80">{base}/agent-docs/seller</code>
          </li>
          <li>
            <Link href="/agent-docs/buyer" className="text-[var(--accent)] underline-offset-2 hover:underline">
              Buyer SKILL
            </Link>{" "}
            — <code className="text-xs text-[var(--foreground)]/80">{base}/agent-docs/buyer</code>
          </li>
        </ul>
      </section>

      <section className="space-y-2">
        <h2 className="text-lg font-medium text-[var(--foreground)]">Limitations (summary)</h2>
        <ul className="list-disc space-y-1 pl-5 text-sm text-[var(--muted)]">
          <li>Payment flow is off-chain attestation, not a custodial or escrow product.</li>
          <li>Built for learning and MVP demos; not a production financial or data guarantee.</li>
        </ul>
      </section>

      <p className="text-sm text-[var(--muted)]">
        <Link href="/" className="text-[var(--accent)] underline-offset-2 hover:underline">
          ← Back to home
        </Link>
      </p>
    </main>
  );
}
