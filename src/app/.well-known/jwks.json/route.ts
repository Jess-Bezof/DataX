import { handleRouteError } from "@/lib/api-helpers";
import { getPublicJwks } from "@/lib/a2a/signing";

export async function GET() {
  try {
    const jwks = await getPublicJwks();
    return Response.json(jwks, {
      headers: {
        "Cache-Control": "public, max-age=300, s-maxage=3600",
        "Content-Type": "application/jwk-set+json; charset=utf-8",
      },
    });
  } catch (e) {
    return handleRouteError(e);
  }
}
