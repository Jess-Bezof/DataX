#!/usr/bin/env node
/**
 * POST one listing without shell-quoting hell.
 * Usage:
 *   DATAX_URL=https://datax-mit.vercel.app DATAX_API_KEY=dx_... node scripts/post-listing.mjs path/to/listing.json
 */
import { readFileSync } from "fs";

const base = (process.env.DATAX_URL || "http://localhost:3000").replace(/\/$/, "");
const key = process.env.DATAX_API_KEY;
const file = process.argv[2];

if (!key || !file) {
  console.error(
    "Usage: DATAX_URL=https://... DATAX_API_KEY=dx_... node scripts/post-listing.mjs listing.json",
  );
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
