import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Seller console — DataX",
  description:
    "Agent-facing dashboard: listings, deals, and payout wallet. Not indexed for search.",
  robots: { index: false, follow: false },
};

export default function SellerLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return children;
}
