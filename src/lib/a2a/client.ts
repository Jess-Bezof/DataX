/**
 * Outbound A2A client — used by DataX to talk to remote A2A agents.
 *
 * v1 scope (spec v1.0):
 *   - Discovery: fetchAgentCard(url) with short in-memory cache.
 *   - SendMessage / GetTask: JSON-RPC over POST.
 *   - SubscribeToTask SSE consumer (best-effort; not used by default).
 *   - Push notification delivery: postStreamResponse().
 *
 * All outbound calls send A2A-Version: 1.0 + application/a2a+json.
 * Only http/bearer auth is supported.
 */

import type {
  A2AAgentCard,
  A2AAgentInterface,
  A2AMessage,
  A2AStreamResponse,
  A2ATask,
} from "./types";
import { CURRENT_VERSION, VERSION_HEADER } from "./version";

const CARD_CACHE_TTL_MS = 5 * 60 * 1000;
const cardCache = new Map<string, { at: number; card: A2AAgentCard }>();

export type OutboundAuth =
  | { type: "none" }
  | { type: "bearer"; token: string };

function withA2AHeaders(headers: Record<string, string>, auth?: OutboundAuth): Record<string, string> {
  const out: Record<string, string> = {
    "Content-Type": "application/a2a+json",
    Accept: "application/a2a+json, application/json",
    [VERSION_HEADER]: CURRENT_VERSION,
    ...headers,
  };
  if (auth && auth.type === "bearer") {
    out.Authorization = `Bearer ${auth.token}`;
  }
  return out;
}

export async function fetchAgentCard(url: string): Promise<A2AAgentCard | null> {
  const normalized = url.trim();
  const cached = cardCache.get(normalized);
  if (cached && Date.now() - cached.at < CARD_CACHE_TTL_MS) return cached.card;
  try {
    const res = await fetch(normalized, {
      method: "GET",
      headers: withA2AHeaders({}),
    });
    if (!res.ok) {
      console.warn(`[a2a/client] agent card fetch ${normalized} -> ${res.status}`);
      return null;
    }
    const card = (await res.json()) as A2AAgentCard;
    cardCache.set(normalized, { at: Date.now(), card });
    return card;
  } catch (e) {
    console.warn(
      `[a2a/client] agent card fetch ${normalized} failed:`,
      e instanceof Error ? e.message : e
    );
    return null;
  }
}

export function pickJsonRpcInterface(
  card: A2AAgentCard
): A2AAgentInterface | null {
  const ifaces = card.supportedInterfaces ?? [];
  const exact = ifaces.find(
    (i) => i.protocolBinding === "JSONRPC" && i.protocolVersion === CURRENT_VERSION
  );
  if (exact) return exact;
  const any = ifaces.find((i) => i.protocolBinding === "JSONRPC");
  return any ?? null;
}

async function jsonRpcCall<T>(
  endpoint: string,
  method: string,
  params: unknown,
  auth?: OutboundAuth
): Promise<T> {
  const res = await fetch(endpoint, {
    method: "POST",
    headers: withA2AHeaders({}, auth),
    body: JSON.stringify({
      jsonrpc: "2.0",
      id: `dx-${Date.now()}`,
      method,
      params,
    }),
  });
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(`A2A ${method} ${endpoint} ${res.status}: ${text.slice(0, 500)}`);
  }
  const body = (await res.json()) as {
    result?: T;
    error?: { code: number; message: string; data?: unknown };
  };
  if (body.error) {
    const err = new Error(
      `A2A ${method} error ${body.error.code}: ${body.error.message}`
    );
    (err as { a2aError?: unknown }).a2aError = body.error;
    throw err;
  }
  return body.result as T;
}

export async function sendMessage(
  cardUrl: string,
  message: A2AMessage,
  auth?: OutboundAuth
): Promise<{ task?: A2ATask; message?: A2AMessage }> {
  const card = await fetchAgentCard(cardUrl);
  if (!card) throw new Error(`Could not fetch Agent Card at ${cardUrl}`);
  const iface = pickJsonRpcInterface(card);
  if (!iface) throw new Error(`No JSON-RPC interface declared in ${cardUrl}`);
  return jsonRpcCall(iface.url, "SendMessage", { message }, auth);
}

export async function getTask(
  cardUrl: string,
  id: string,
  auth?: OutboundAuth
): Promise<A2ATask> {
  const card = await fetchAgentCard(cardUrl);
  if (!card) throw new Error(`Could not fetch Agent Card at ${cardUrl}`);
  const iface = pickJsonRpcInterface(card);
  if (!iface) throw new Error(`No JSON-RPC interface declared in ${cardUrl}`);
  return jsonRpcCall(iface.url, "GetTask", { id }, auth);
}

/**
 * Fire-and-forget push of a StreamResponse to a webhook URL. Used both
 * for push-notification configs and for the externalAgentCardUrl fallback.
 * Never throws; logs on failure.
 */
export async function postStreamResponse(
  url: string,
  payload: A2AStreamResponse,
  auth?: OutboundAuth,
  taskId?: string
): Promise<boolean> {
  try {
    const headers: Record<string, string> = withA2AHeaders({}, auth);
    if (taskId) headers["X-A2A-Task-Id"] = taskId;
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 25_000);
    const res = await fetch(url, {
      method: "POST",
      headers,
      body: JSON.stringify(payload),
      signal: controller.signal,
    });
    clearTimeout(timeout);
    if (!res.ok) {
      console.warn(`[a2a/client] push ${url} -> ${res.status}`);
      return false;
    }
    return true;
  } catch (e) {
    console.warn(
      `[a2a/client] push ${url} failed:`,
      e instanceof Error ? e.message : e
    );
    return false;
  }
}
