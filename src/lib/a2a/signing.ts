/**
 * JWS signing helpers for Agent Cards (spec Section 4.4.7).
 *
 * Key material: A2A_SIGNING_KEY env var. Accepts either:
 *   - A private JWK serialized as JSON (preferred; includes kid + alg).
 *   - A PKCS#8 PEM blob — then algorithm is inferred from A2A_SIGNING_ALG
 *     (EdDSA by default; set to ES256 for ECDSA P-256 keys).
 *
 * Ed25519 (EdDSA) is preferred. ES256 works as a fallback on environments
 * where Ed25519 is unavailable.
 *
 * When A2A_SIGNING_KEY is not set we skip signatures entirely and log a
 * single warning — the card itself is still served so local dev + preview
 * builds work without setup. Production should always configure it.
 */

import {
  importJWK,
  importPKCS8,
  exportJWK,
  CompactSign,
  type JWK,
  type CryptoKey,
} from "jose";

type SigningPrivateKey = CryptoKey | Uint8Array;
import type { A2AAgentCard, A2AAgentCardSignature } from "./types";

export const A2A_KID_DEFAULT = "datax-a2a-1";

type LoadedKey = {
  privateKey: SigningPrivateKey;
  publicJwk: JWK;
  alg: string;
  kid: string;
};

let cached: LoadedKey | null | "missing" = null;
let warned = false;

async function loadKey(): Promise<LoadedKey | null> {
  if (cached === "missing") return null;
  if (cached) return cached;

  const raw = process.env.A2A_SIGNING_KEY?.trim();
  if (!raw) {
    cached = "missing";
    if (!warned) {
      console.warn(
        "[a2a] A2A_SIGNING_KEY is not set — Agent Cards will be served unsigned. Set it in production."
      );
      warned = true;
    }
    return null;
  }

  try {
    // Try JWK JSON first
    if (raw.startsWith("{")) {
      const jwk = JSON.parse(raw) as JWK & { alg?: string; kid?: string };
      const alg = jwk.alg ?? "EdDSA";
      const kid = jwk.kid ?? A2A_KID_DEFAULT;
      const privateKey = (await importJWK(jwk, alg)) as SigningPrivateKey;
      const pubJwkRaw = { ...jwk };
      delete (pubJwkRaw as { d?: string }).d;
      delete (pubJwkRaw as { p?: string }).p;
      delete (pubJwkRaw as { q?: string }).q;
      delete (pubJwkRaw as { dp?: string }).dp;
      delete (pubJwkRaw as { dq?: string }).dq;
      delete (pubJwkRaw as { qi?: string }).qi;
      pubJwkRaw.kid = kid;
      pubJwkRaw.alg = alg;
      (pubJwkRaw as { use?: string }).use = "sig";
      cached = { privateKey, publicJwk: pubJwkRaw, alg, kid };
      return cached;
    }

    // Else treat as PKCS#8 PEM
    const alg = process.env.A2A_SIGNING_ALG?.trim() || "EdDSA";
    const kid = process.env.A2A_SIGNING_KID?.trim() || A2A_KID_DEFAULT;
    const privateKey = (await importPKCS8(raw, alg)) as SigningPrivateKey;
    const publicJwk = (await exportJWK(privateKey as CryptoKey)) as JWK;
    const pubJwkRaw = { ...publicJwk };
    delete (pubJwkRaw as { d?: string }).d;
    pubJwkRaw.kid = kid;
    pubJwkRaw.alg = alg;
    (pubJwkRaw as { use?: string }).use = "sig";
    cached = { privateKey, publicJwk: pubJwkRaw, alg, kid };
    return cached;
  } catch (e) {
    console.error(
      "[a2a] Failed to load A2A_SIGNING_KEY — Agent Cards will be unsigned:",
      e instanceof Error ? e.message : e
    );
    cached = "missing";
    return null;
  }
}

/**
 * Approximate RFC 8785 JCS canonicalization.
 *
 * Limitations: numbers are serialized via `JSON.stringify` (no special float
 * handling), which is fine for our card contents (integers and strings only).
 * Strings, booleans, nulls, arrays, and objects are handled per JCS.
 */
function canonicalJson(value: unknown): string {
  if (value === null || typeof value !== "object") {
    return JSON.stringify(value);
  }
  if (Array.isArray(value)) {
    return `[${value.map((v) => canonicalJson(v)).join(",")}]`;
  }
  const obj = value as Record<string, unknown>;
  const keys = Object.keys(obj)
    .filter((k) => obj[k] !== undefined)
    .sort();
  return `{${keys
    .map((k) => `${JSON.stringify(k)}:${canonicalJson(obj[k])}`)
    .join(",")}}`;
}

/**
 * Sign the Agent Card body (excluding any existing `signatures` field) and
 * return a new card with the signature attached. Returns the card unchanged
 * when no signing key is configured.
 */
export async function signAgentCard(
  card: A2AAgentCard,
  jkuUrl: string
): Promise<A2AAgentCard> {
  const key = await loadKey();
  if (!key) return card;

  const { signatures: _ignored, ...body } = card;
  void _ignored;

  const canonical = canonicalJson(body);
  const protectedHeader = {
    alg: key.alg,
    kid: key.kid,
    typ: "JOSE+JSON",
    jku: jkuUrl,
  };

  try {
    const jws = await new CompactSign(new TextEncoder().encode(canonical))
      .setProtectedHeader(protectedHeader)
      .sign(key.privateKey as CryptoKey);

    // CompactSign produces `BASE64URL(header).BASE64URL(payload).BASE64URL(sig)`;
    // we want the detached/flattened JSON form: (protected, signature) only.
    const parts = jws.split(".");
    const [prot, , signature] = parts;
    const entry: A2AAgentCardSignature = {
      protected: prot,
      signature,
    };
    return { ...card, signatures: [entry] };
  } catch (e) {
    console.error(
      "[a2a] signing failed, returning unsigned card:",
      e instanceof Error ? e.message : e
    );
    return card;
  }
}

export async function getPublicJwks(): Promise<{ keys: JWK[] }> {
  const key = await loadKey();
  if (!key) return { keys: [] };
  return { keys: [key.publicJwk] };
}
