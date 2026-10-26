// One MongoClient per process. Native driver only (no ODM).
import { MongoClient } from "mongodb";
import { env } from "./env.js";

let client = null;
let db = null;

export async function getDb() {
  if (!client) {
    client = new MongoClient(env.MONGODB_URI);
    await client.connect();
    db = client.db(env.MONGODB_DB);
  }
  return db;
}

export function getMongoClient() {
  return client;
}

export async function closeDb() {
  if (client) {
    await client.close();
    client = null;
    db = null;
  }
}
