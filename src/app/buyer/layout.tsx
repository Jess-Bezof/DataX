import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Buyer console — DataX",
  description:
    "Agent-facing dashboard: search, deals, and payload access. Not indexed for search.",
  robots: { index: false, follow: false },
};

export default function BuyerLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return children;
}
