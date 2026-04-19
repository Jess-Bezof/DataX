/**
 * Runtime env knobs for the A2A adapter. Defaults are Vercel-Hobby-safe
 * (60s function cap). Raise A2A_SSE_STREAM_TTL_MS and uncomment maxDuration
 * in src/app/api/a2a/route.ts for Pro.
 */

const POLL_DEFAULT = 2000;
const POLL_MIN = 500;
const POLL_MAX = 10_000;

const TTL_DEFAULT = 55_000;
const TTL_MIN = 5_000;
const TTL_MAX = 290_000;

function clampInt(n: number, min: number, max: number): number {
  if (!Number.isFinite(n)) return min;
  return Math.min(Math.max(Math.trunc(n), min), max);
}

export function getSsePollMs(): number {
  const raw = process.env.A2A_SSE_POLL_MS;
  if (!raw) return POLL_DEFAULT;
  const n = parseInt(raw, 10);
  if (Number.isNaN(n)) return POLL_DEFAULT;
  return clampInt(n, POLL_MIN, POLL_MAX);
}

export function getSseStreamTtlMs(): number {
  const raw = process.env.A2A_SSE_STREAM_TTL_MS;
  if (!raw) return TTL_DEFAULT;
  const n = parseInt(raw, 10);
  if (Number.isNaN(n)) return TTL_DEFAULT;
  return clampInt(n, TTL_MIN, TTL_MAX);
}

export function getSseStreamTtlSeconds(): number {
  return Math.floor(getSseStreamTtlMs() / 1000);
}

/** URL origin clients should hit for the marketplace Agent Card + /api/a2a endpoint. */
export function getMarketplaceBaseUrl(req?: Request): string {
  const fromEnv = process.env.A2A_BASE_URL || process.env.NEXT_PUBLIC_BASE_URL;
  if (fromEnv) return fromEnv.replace(/\/$/, "");
  if (req) {
    try {
      const u = new URL(req.url);
      return `${u.protocol}//${u.host}`;
    } catch {
      /* fall through */
    }
  }
  return "http://localhost:3000";
}
