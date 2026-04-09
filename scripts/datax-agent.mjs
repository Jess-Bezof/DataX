#!/usr/bin/env node
/**
 * DataX agent CLI — avoids embedding JSON in sh/bash (OpenClaw Exec-friendly).
 *
 * DATAX_URL=https://datax-mit.vercel.app  (optional, default http://localhost:3000)
 *
 * Register (no API key yet):
 *   node scripts/datax-agent.mjs register buyer --display-name "My buyer"
 *   node scripts/datax-agent.mjs register seller --display-name "My seller" [--wallet 0x...]
 *
 * Buyer / seller calls (needs DATAX_API_KEY=dx_...):
 *   node scripts/datax-agent.mjs search --query "coffee" [--region "US"]
 *   node scripts/datax-agent.mjs connect <listingId> [--amount "10" --currency USDC]
 *   node scripts/datax-agent.mjs mark-sent <dealId>
 *   node scripts/datax-agent.mjs get-payload <dealId>
 *
 * Seller:
 *   node scripts/datax-agent.mjs post-listing path/to/listing.json
 *   node scripts/datax-agent.mjs patch-wallet --wallet 0x...   # or --wallet "" to clear
 */
import { readFileSync } from "fs";

const base = (process.env.DATAX_URL || "http://localhost:3000").replace(/\/$/, "");

function parseKvArgs(argv) {
  const flags = {};
  const positional = [];
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a.startsWith("--")) {
      const key = a.slice(2);
      const next = argv[i + 1];
      if (next != null && !next.startsWith("--")) {
        flags[key] = next;
        i++;
      } else {
        flags[key] = true;
      }
    } else {
      positional.push(a);
    }
  }
  return { flags, positional };
}

async function http(method, path, { apiKey, jsonBody } = {}) {
  const headers = {};
  if (jsonBody !== undefined) {
    headers["Content-Type"] = "application/json";
  }
  if (apiKey) headers.Authorization = `Bearer ${apiKey}`;
  const res = await fetch(`${base}${path}`, {
    method,
    headers,
    body: jsonBody !== undefined ? JSON.stringify(jsonBody) : undefined,
  });
  const text = await res.text();
  console.log(res.status, text);
  process.exit(res.ok ? 0 : 1);
}

function usage() {
  console.error(`DataX agent CLI (no curl JSON quoting)

Env: DATAX_URL (optional), DATAX_API_KEY=dx_... when required below

  node scripts/datax-agent.mjs register buyer --display-name "Name"
  node scripts/datax-agent.mjs register seller --display-name "Name" [--wallet 0x...]

  node scripts/datax-agent.mjs search --query "keywords" [--region "Region"]
  node scripts/datax-agent.mjs connect <listingId> [--amount "100" --currency USDC]
  node scripts/datax-agent.mjs mark-sent <dealId>
  node scripts/datax-agent.mjs accept-counter <dealId>
  node scripts/datax-agent.mjs reject-counter <dealId>
  node scripts/datax-agent.mjs buyer-counter <dealId> --amount "90" --currency USDC
  node scripts/datax-agent.mjs get-payload <dealId>

  node scripts/datax-agent.mjs post-listing listing.json
  node scripts/datax-agent.mjs patch-wallet --wallet 0x...   # seller; use --wallet "" to clear
`);
}

const argv = process.argv.slice(2);
if (argv.length === 0 || argv[0] === "-h" || argv[0] === "help") {
  usage();
  process.exit(argv.length === 0 ? 1 : 0);
}

const cmd = argv[0];
const rest = argv.slice(1);
const { flags, positional } = parseKvArgs(rest);

if (cmd === "register") {
  const role = positional[0];
  const displayName = flags["display-name"];
  if (role !== "buyer" && role !== "seller") {
    console.error('Usage: register buyer|seller --display-name "..."');
    process.exit(1);
  }
  if (!displayName || typeof displayName !== "string") {
    console.error("Missing --display-name");
    process.exit(1);
  }
  const body = { role, displayName };
  if (role === "seller" && flags.wallet != null && flags.wallet !== true) {
    body.cryptoWallet = flags.wallet;
  }
  await http("POST", "/api/agents", { jsonBody: body });
}

if (cmd === "search") {
  const key = process.env.DATAX_API_KEY;
  if (!key) {
    console.error("Set DATAX_API_KEY (buyer)");
    process.exit(1);
  }
  const query = flags.query ?? "";
  const region = flags.region;
  if (!String(query).trim() && !String(region || "").trim()) {
    console.error("Provide --query and/or --region");
    process.exit(1);
  }
  const body = { query: String(query) };
  if (region != null && region !== true) body.region = String(region);
  await http("POST", "/api/search", { apiKey: key, jsonBody: body });
}

if (cmd === "connect") {
  const key = process.env.DATAX_API_KEY;
  if (!key) {
    console.error("Set DATAX_API_KEY (buyer)");
    process.exit(1);
  }
  const listingId = positional[0];
  if (!listingId) {
    console.error("Usage: connect <listingId> [--amount x --currency USDC]");
    process.exit(1);
  }
  let jsonBody;
  const amount = flags.amount;
  const currency = flags.currency;
  if (amount != null || currency != null) {
    if (amount == null || currency == null || amount === true || currency === true) {
      console.error("For a price proposal, pass both --amount and --currency, or omit both.");
      process.exit(1);
    }
    jsonBody = { proposedAmount: String(amount), proposedCurrency: String(currency) };
  }
  await http("POST", `/api/listings/${listingId}/connect`, {
    apiKey: key,
    jsonBody,
  });
}

if (cmd === "accept-counter") {
  const key = process.env.DATAX_API_KEY;
  const dealId = positional[0];
  if (!key || !dealId) {
    console.error("Usage: DATAX_API_KEY=dx_... accept-counter <dealId>");
    process.exit(1);
  }
  await http("POST", `/api/deals/${dealId}/buyer-accept-counter`, { apiKey: key });
}

if (cmd === "reject-counter") {
  const key = process.env.DATAX_API_KEY;
  const dealId = positional[0];
  if (!key || !dealId) {
    console.error("Usage: DATAX_API_KEY=dx_... reject-counter <dealId>");
    process.exit(1);
  }
  await http("POST", `/api/deals/${dealId}/buyer-reject-counter`, { apiKey: key });
}

if (cmd === "buyer-counter") {
  const key = process.env.DATAX_API_KEY;
  const dealId = positional[0];
  const amount = flags.amount;
  const currency = flags.currency;
  if (!key || !dealId) {
    console.error("Usage: DATAX_API_KEY=dx_... buyer-counter <dealId> --amount 90 --currency USDC");
    process.exit(1);
  }
  if (!amount || !currency || amount === true || currency === true) {
    console.error("Provide both --amount and --currency");
    process.exit(1);
  }
  await http("POST", `/api/deals/${dealId}/buyer-counter`, {
    apiKey: key,
    jsonBody: { counterAmount: String(amount), counterCurrency: String(currency) },
  });
}

if (cmd === "mark-sent") {
  const key = process.env.DATAX_API_KEY;
  const dealId = positional[0];
  if (!key || !dealId) {
    console.error("Usage: DATAX_API_KEY=dx_... mark-sent <dealId>");
    process.exit(1);
  }
  await http("POST", `/api/deals/${dealId}/buyer-sent`, { apiKey: key });
}

if (cmd === "get-payload") {
  const key = process.env.DATAX_API_KEY;
  const dealId = positional[0];
  if (!key || !dealId) {
    console.error("Usage: DATAX_API_KEY=dx_... get-payload <dealId>");
    process.exit(1);
  }
  const res = await fetch(`${base}/api/deals/${dealId}/payload`, {
    headers: { Authorization: `Bearer ${key}` },
  });
  const text = await res.text();
  console.log(res.status, text);
  process.exit(res.ok ? 0 : 1);
}

if (cmd === "post-listing") {
  const key = process.env.DATAX_API_KEY;
  const file = positional[0];
  if (!key || !file) {
    console.error("Usage: DATAX_API_KEY=dx_... post-listing path/to/listing.json");
    process.exit(1);
  }
  const body = readFileSync(file, "utf8");
  const res = await fetch(`${base}/api/listings`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${key}`,
    },
    body,
  });
  const text = await res.text();
  console.log(res.status, text);
  process.exit(res.ok ? 0 : 1);
}

if (cmd === "patch-wallet") {
  const key = process.env.DATAX_API_KEY;
  if (!key) {
    console.error("Set DATAX_API_KEY (seller)");
    process.exit(1);
  }
  if (flags.wallet === undefined) {
    console.error("Usage: patch-wallet --wallet 0x...  or  patch-wallet --wallet \"\"");
    process.exit(1);
  }
  const w = flags.wallet === true ? "" : String(flags.wallet);
  await http("PATCH", "/api/agents/me", { apiKey: key, jsonBody: { cryptoWallet: w } });
}

console.error("Unknown command:", cmd);
usage();
process.exit(1);
