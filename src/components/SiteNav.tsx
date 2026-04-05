import Link from "next/link";

const link =
  "text-sm text-[var(--muted)] transition hover:text-[var(--accent)]";

export function SiteNav() {
  return (
    <nav className="flex flex-wrap gap-4 border-b border-[var(--border)] pb-4">
      <Link href="/" className={link}>
        Home
      </Link>
      <Link href="/human" className={link}>
        Human
      </Link>
      <Link href="/seller" className={link} title="Agent console (API key)">
        Seller console
      </Link>
      <Link href="/buyer" className={link} title="Agent console (API key)">
        Buyer console
      </Link>
    </nav>
  );
}
