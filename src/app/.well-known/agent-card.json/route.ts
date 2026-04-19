import { handleRouteError } from "@/lib/api-helpers";
import { signedMarketplacePublicCard } from "@/lib/a2a/cards";
import { getMarketplaceBaseUrl } from "@/lib/a2a/env";

export async function GET(request: Request) {
  try {
    const baseUrl = getMarketplaceBaseUrl(request);
    const card = await signedMarketplacePublicCard(baseUrl);
    return Response.json(card, {
      headers: {
        "Cache-Control": "public, max-age=60, s-maxage=300",
        "Content-Type": "application/a2a+json; charset=utf-8",
      },
    });
  } catch (e) {
    return handleRouteError(e);
  }
}
