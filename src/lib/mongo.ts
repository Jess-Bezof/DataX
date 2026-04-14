import { MongoClient, type Db } from "mongodb";

const uri = process.env.MONGODB_URI;

declare global {
  var _dataxMongo: Promise<MongoClient> | undefined;
}

export function getMongoClient(): Promise<MongoClient> {
  if (!uri) {
    throw new Error("MONGODB_URI is not set");
  }
  if (!global._dataxMongo) {
    const client = new MongoClient(uri);
    global._dataxMongo = client.connect();
  }
  return global._dataxMongo;
}

export async function getDb(): Promise<Db> {
  const client = await getMongoClient();
  return client.db("datax");
}

let indexesEnsured = false;

export async function ensureIndexes(): Promise<void> {
  if (indexesEnsured) return;
  const db = await getDb();
  await db.collection("agents").createIndex({ apiKeyHash: 1 }, { unique: true });
  await db.collection("listings").createIndex({ sellerAgentId: 1, createdAt: -1 });
  await db.collection("connection_events").createIndex({ createdAt: -1 });
  await db.collection("deals").createIndex({ buyerAgentId: 1, updatedAt: -1 });
  await db.collection("deals").createIndex({ sellerAgentId: 1, updatedAt: -1 });
  await db.collection("deals").createIndex({
    listingId: 1,
    buyerAgentId: 1,
    status: 1,
  });
  await db.collection("agent_events").createIndex({ agentId: 1, deliveredAt: 1, createdAt: 1 });
  indexesEnsured = true;
}
