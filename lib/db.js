import dns from "node:dns";
import "dotenv/config";
import { MongoClient } from "mongodb";

// Some home/office routers refuse SRV lookups, which Atlas (mongodb+srv://) needs.
if (!process.env.VERCEL) dns.setServers(["8.8.8.8", "1.1.1.1"]);

let client;

export async function getDb() {
  if (!process.env.MONGODB_URI) throw new Error("MONGODB_URI is not set");
  client ??= new MongoClient(process.env.MONGODB_URI, { serverSelectionTimeoutMS: 10000 });
  await client.connect();
  return client.db();
}

export async function closeDb() {
  await client?.close();
  client = undefined;
}
