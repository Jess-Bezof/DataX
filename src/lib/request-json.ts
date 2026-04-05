/** Parse JSON body if present; empty body → {} */
export async function safeJsonBody(
  request: Request
): Promise<Record<string, unknown>> {
  const ct = request.headers.get("content-type");
  if (!ct?.includes("application/json")) return {};
  const text = await request.text();
  if (!text.trim()) return {};
  try {
    const v = JSON.parse(text) as unknown;
    if (v === null || typeof v !== "object" || Array.isArray(v)) {
      return {};
    }
    return v as Record<string, unknown>;
  } catch {
    throw new Error("Invalid JSON body");
  }
}
