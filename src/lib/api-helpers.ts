import { AuthError } from "@/lib/auth";

export function jsonError(status: number, message: string): Response {
  return Response.json({ error: message }, { status });
}

export function handleRouteError(e: unknown): Response {
  if (e instanceof AuthError) {
    return jsonError(e.status, e.message);
  }
  if (e instanceof Error) {
    if (
      e.message.includes("24 hours") ||
      e.message.includes("maximum size") ||
      e.message.includes("Invalid")
    ) {
      return jsonError(400, e.message);
    }
    console.error(e);
    return jsonError(500, e.message);
  }
  console.error(e);
  return jsonError(500, "Internal server error");
}
