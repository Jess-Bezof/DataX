#!/usr/bin/env node
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";

const base = (process.env.DATAX_URL || "").replace(/\/$/, "");
if (!base) {
  console.error("datax-mcp: set DATAX_URL (e.g. https://datax-mit.vercel.app)");
  process.exit(1);
}

function requireApiKey() {
  const k = process.env.DATAX_API_KEY;
  if (!k?.trim()) {
    throw new Error("Set environment variable DATAX_API_KEY (dx_... from POST /api/agents)");
  }
  return k.trim();
}

async function dataxFetch(path, { method = "GET", apiKey, json, body } = {}) {
  const headers = {};
  if (json !== undefined || (body && typeof body === "object")) {
    headers["Content-Type"] = "application/json";
  }
  if (apiKey) headers.Authorization = `Bearer ${apiKey}`;
  const init = { method, headers };
  if (json !== undefined) init.body = JSON.stringify(json);
  else if (body !== undefined) init.body = body;
  const res = await fetch(`${base}${path}`, init);
  const text = await res.text();
  return { status: res.status, text };
}

function okText(status, text) {
  return {
    content: [{ type: "text", text: `HTTP ${status}\n${text}` }],
  };
}

const server = new McpServer({
  name: "datax",
  version: "0.1.0",
});

server.tool(
  "datax_get_seller_skill",
  "Download the seller agent SKILL (markdown) from the live DataX site.",
  {},
  async () => {
    const { status, text } = await dataxFetch("/agent-docs/seller");
    return okText(status, text);
  },
);

server.tool(
  "datax_get_buyer_skill",
  "Download the buyer agent SKILL (markdown) from the live DataX site.",
  {},
  async () => {
    const { status, text } = await dataxFetch("/agent-docs/buyer");
    return okText(status, text);
  },
);

server.tool(
  "datax_register_seller",
  "Create a seller agent. Returns agentId and apiKey once — store apiKey securely.",
  {
    displayName: z.string().min(1).max(80),
    cryptoWallet: z.string().max(500).optional(),
  },
  async ({ displayName, cryptoWallet }) => {
    const body = { role: "seller", displayName };
    if (cryptoWallet != null && cryptoWallet !== "") body.cryptoWallet = cryptoWallet;
    const { status, text } = await dataxFetch("/api/agents", {
      method: "POST",
      json: body,
    });
    return okText(status, text);
  },
);

server.tool(
  "datax_register_buyer",
  "Create a buyer agent. Returns agentId and apiKey once — store apiKey securely.",
  {
    displayName: z.string().min(1).max(80),
  },
  async ({ displayName }) => {
    const { status, text } = await dataxFetch("/api/agents", {
      method: "POST",
      json: { role: "buyer", displayName },
    });
    return okText(status, text);
  },
);

server.tool(
  "datax_search",
  "Buyer: ranked search (up to 4 listings). Provide query and/or region (at least one).",
  {
    query: z.string().optional(),
    region: z.string().optional(),
  },
  async ({ query = "", region }) => {
    const q = query.trim();
    const r = region?.trim() ?? "";
    if (!q && !r) {
      throw new Error("Provide non-empty query and/or region");
    }
    const body = { query: q };
    if (r) body.region = r;
    const { status, text } = await dataxFetch("/api/search", {
      method: "POST",
      apiKey: requireApiKey(),
      json: body,
    });
    return okText(status, text);
  },
);

server.tool(
  "datax_list_public_listings",
  "No auth: list recent public listing previews (GET /api/listings).",
  {
    limit: z.coerce.number().int().min(1).max(100).optional(),
  },
  async ({ limit = 50 }) => {
    const { status, text } = await dataxFetch(`/api/listings?limit=${limit}`);
    return okText(status, text);
  },
);

server.tool(
  "datax_connect_listing",
  "Buyer: start or resume a deal on a listing. Optional proposedAmount + proposedCurrency together, or omit both for direct checkout (seller must have wallet).",
  {
    listingId: z.string().min(1),
    proposedAmount: z.string().optional(),
    proposedCurrency: z.string().optional(),
  },
  async ({ listingId, proposedAmount, proposedCurrency }) => {
    let json;
    if (proposedAmount != null || proposedCurrency != null) {
      if (!proposedAmount?.trim() || !proposedCurrency?.trim()) {
        throw new Error("Send both proposedAmount and proposedCurrency, or neither");
      }
      json = {
        proposedAmount: proposedAmount.trim(),
        proposedCurrency: proposedCurrency.trim(),
      };
    }
    const { status, text } = await dataxFetch(`/api/listings/${listingId}/connect`, {
      method: "POST",
      apiKey: requireApiKey(),
      json,
    });
    return okText(status, text);
  },
);

server.tool(
  "datax_post_listing",
  "Seller: create a listing. Pass listingJson as a single JSON string (title, summary, validFrom, validTo, regions, columns, sampleRow, fullPayload).",
  {
    listingJson: z.string().min(2),
  },
  async ({ listingJson }) => {
    let body;
    try {
      body = JSON.parse(listingJson);
    } catch {
      throw new Error("listingJson must be valid JSON");
    }
    const { status, text } = await dataxFetch("/api/listings", {
      method: "POST",
      apiKey: requireApiKey(),
      body: JSON.stringify(body),
    });
    return okText(status, text);
  },
);

server.tool(
  "datax_patch_seller_wallet",
  "Seller: set or clear payout wallet (body rule on API: include cryptoWallet string, empty string clears).",
  {
    cryptoWallet: z.string(),
  },
  async ({ cryptoWallet }) => {
    const { status, text } = await dataxFetch("/api/agents/me", {
      method: "PATCH",
      apiKey: requireApiKey(),
      json: { cryptoWallet },
    });
    return okText(status, text);
  },
);

server.tool(
  "datax_mark_payment_sent",
  "Buyer: after paying seller off-platform, mark deal as payment sent (awaiting_payment → buyer_marked_sent).",
  {
    dealId: z.string().min(1),
  },
  async ({ dealId }) => {
    const { status, text } = await dataxFetch(`/api/deals/${dealId}/buyer-sent`, {
      method: "POST",
      apiKey: requireApiKey(),
    });
    return okText(status, text);
  },
);

server.tool(
  "datax_get_deal_payload",
  "Buyer: fetch fullPayload only after deal status is released.",
  {
    dealId: z.string().min(1),
  },
  async ({ dealId }) => {
    const { status, text } = await dataxFetch(`/api/deals/${dealId}/payload`, {
      apiKey: requireApiKey(),
    });
    return okText(status, text);
  },
);

const transport = new StdioServerTransport();
await server.connect(transport);
