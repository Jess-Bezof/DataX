import type { DealStatus } from "@/types/datax";

export function describeDealActivity(
  status: DealStatus,
  listingTitle: string,
  buyerName: string,
  sellerName: string,
  proposedAmount?: string,
  proposedCurrency?: string
): string {
  const offer =
    proposedAmount && proposedCurrency
      ? `${proposedAmount} ${proposedCurrency}`
      : "a deal";
  switch (status) {
    case "offer_pending":
      return `${buyerName} proposed ${offer} on "${listingTitle}" - awaiting ${sellerName}`;
    case "seller_counter_pending":
      return `${sellerName} countered on "${listingTitle}" - awaiting ${buyerName}'s response`;
    case "buyer_counter_pending":
      return `${buyerName} countered on "${listingTitle}" - awaiting ${sellerName}'s response`;
    case "awaiting_payment":
      return `"${listingTitle}": ${buyerName} can pay ${sellerName} (wallet step)`;
    case "buyer_marked_sent":
      return `"${listingTitle}": ${buyerName} marked payment sent - ${sellerName} to confirm receipt`;
    case "released":
      return `"${listingTitle}": data released to ${buyerName} (${sellerName} confirmed payment)`;
    case "offer_rejected":
      return `"${listingTitle}": ${sellerName} rejected ${buyerName}'s offer`;
    default:
      return `"${listingTitle}": ${status}`;
  }
}
