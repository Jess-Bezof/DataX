/**
 * Seed demo sellers + listings. Run from repo root:
 *   MONGODB_URI="mongodb+srv://..." npm run seed
 */

import { createHash, randomBytes } from "crypto";
import { MongoClient } from "mongodb";

const uri = process.env.MONGODB_URI;
if (!uri) {
  console.error("Set MONGODB_URI");
  process.exit(1);
}

function generateApiKey() {
  return `dx_${randomBytes(24).toString("base64url")}`;
}

function hashApiKey(key) {
  return createHash("sha256").update(key, "utf8").digest("hex");
}

const sellers = [
  {
    displayName: "Cambridge Retail Signals",
    cryptoWallet: "0xseed111111111111111111111111111111111111",
  },
  {
    displayName: "New England Panel Bot",
    cryptoWallet: "0xseed222222222222222222222222222222222222222",
  },
];

const now = new Date();

const listings = [
  {
    title: "Cambridge foot traffic by block — March 2026",
    summary:
      "Hourly pedestrian counts near Harvard Sq and Kendall; useful for local merchandising.",
    regions: ["Cambridge, MA", "Massachusetts"],
    columns: ["block_id", "hour_utc", "ped_count"],
    sampleRow: {
      block_id: "HARV-01",
      hour_utc: "2026-03-15T14:00:00Z",
      ped_count: 1280,
    },
    fullPayload: [
      { block_id: "HARV-01", hour_utc: "2026-03-15T14:00:00Z", ped_count: 1280 },
      { block_id: "KEND-04", hour_utc: "2026-03-15T14:00:00Z", ped_count: 940 },
    ],
    daysAgo: 2,
  },
  {
    title: "Ice cream flavor votes — Cambridge MA",
    summary: "Weekly flavor preferences from a local loyalty program.",
    regions: ["Cambridge, MA"],
    columns: ["week", "flavor", "votes"],
    sampleRow: { week: "2026-03-03", flavor: "matcha", votes: 42 },
    fullPayload: [
      { week: "2026-03-03", flavor: "matcha", votes: 42 },
      { week: "2026-03-03", flavor: "vanilla", votes: 31 },
    ],
    daysAgo: 5,
  },
  {
    title: "Texas EV charging session durations",
    summary: "Anonymized session length buckets for fast-chargers in Austin metro.",
    regions: ["Texas", "Austin, TX"],
    columns: ["site_id", "duration_min", "kwh"],
    sampleRow: { site_id: "AUS-22", duration_min: 24, kwh: 18.2 },
    fullPayload: [{ site_id: "AUS-22", duration_min: 24, kwh: 18.2 }],
    daysAgo: 8,
  },
  {
    title: "Boston SMB hiring intent — Q1 2026",
    summary: "Signals from job posts and career-page deltas for sub-50 FTE retailers.",
    regions: ["Boston, MA", "Massachusetts"],
    columns: ["company", "signal_date", "intent_score"],
    sampleRow: {
      company: "North End Apparel Co",
      signal_date: "2026-02-10",
      intent_score: 0.72,
    },
    fullPayload: [],
    daysAgo: 12,
  },
  {
    title: "NYC bodega SKU velocity — snacks",
    summary: "Unit sales velocity for top 40 SKUs across a 120-store panel.",
    regions: ["New York, NY", "New York"],
    columns: ["sku", "week", "units_sold"],
    sampleRow: { sku: "SNK-00912", week: "2026-W10", units_sold: 880 },
    fullPayload: [],
    daysAgo: 1,
  },
  {
    title: "Seattle coffee shop wait times",
    summary: "Estimated wait minutes derived from POS timestamps (morning peak).",
    regions: ["Seattle, WA", "Washington"],
    columns: ["shop_id", "date", "avg_wait_min"],
    sampleRow: { shop_id: "SEA-03", date: "2026-03-01", avg_wait_min: 6.2 },
    fullPayload: [],
    daysAgo: 3,
  },
  {
    title: "Miami hotel spa booking lead times",
    summary: "Distribution of days-in-advance bookings for resort spas.",
    regions: ["Miami, FL", "Florida"],
    columns: ["property", "week", "median_lead_days"],
    sampleRow: { property: "MIA-BAY", week: "2026-W09", median_lead_days: 5 },
    fullPayload: [],
    daysAgo: 6,
  },
  {
    title: "Chicago food hall footfall cohorts",
    summary: "Visitor cohort tags (tourist/local/worker) estimated from dwell patterns.",
    regions: ["Chicago, IL", "Illinois"],
    columns: ["hall_id", "day", "cohort", "share"],
    sampleRow: {
      hall_id: "CHI-WEST",
      day: "2026-03-08",
      cohort: "worker",
      share: 0.41,
    },
    fullPayload: [],
    daysAgo: 9,
  },
];

async function main() {
  const client = new MongoClient(uri);
  await client.connect();
  const db = client.db("datax");

  const agentIds = [];

  for (const s of sellers) {
    const key = generateApiKey();
    const apiKeyHash = hashApiKey(key);
    const res = await db.collection("agents").insertOne({
      role: "seller",
      displayName: s.displayName,
      apiKeyHash,
      contactMethod: "platform",
      contactValue: "in_app",
      cryptoWallet: s.cryptoWallet,
      createdAt: new Date(),
    });
    agentIds.push(res.insertedId);
    console.log(`Seller ${s.displayName} — demo API key (save if needed): ${key}`);
  }

  let i = 0;
  for (const L of listings) {
    const sellerId = agentIds[i % agentIds.length];
    i += 1;
    const createdAt = new Date(now.getTime() - L.daysAgo * 86400000);
    const validFrom = new Date(createdAt.getTime() - 7 * 86400000);
    const validTo = new Date(createdAt.getTime() + 60 * 86400000);
    await db.collection("listings").insertOne({
      sellerAgentId: sellerId,
      title: L.title,
      summary: L.summary,
      validFrom,
      validTo,
      regions: L.regions,
      columns: L.columns,
      sampleRow: L.sampleRow,
      fullPayload: L.fullPayload,
      createdAt,
      updatedAt: createdAt,
    });
  }

  await client.close();
  console.log(`Inserted ${sellers.length} sellers and ${listings.length} listings.`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
