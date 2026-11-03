// Serves the dashboard's stops from MongoDB (written by build_data.py).
// Needs MONGODB_URI (and optionally MONGODB_DB) in the Vercel project's environment variables.
const { MongoClient } = require("mongodb");

let client;  // reused while the function stays warm

module.exports = async (req, res) => {
  res.setHeader("Cache-Control", "no-store");
  if (!process.env.MONGODB_URI) return res.status(404).json({ error: "MONGODB_URI is not set" });
  try {
    client ??= new MongoClient(process.env.MONGODB_URI, { serverSelectionTimeoutMS: 10000 });
    const db = client.db(process.env.MONGODB_DB || "driver_routes");
    const [meta, stops] = await Promise.all([
      db.collection("meta").findOne({ _id: "current" }, { projection: { _id: 0 } }),
      db.collection("stops").find({}, { projection: { _id: 0 } }).toArray()
    ]);
    if (!meta) return res.status(404).json({ error: "No data yet: run build_data.py with MONGODB_URI set" });
    res.status(200).json({ ...meta, stops });
  } catch (err) {
    client = undefined;
    res.status(500).json({ error: "Could not read MongoDB", detail: String(err.message || err) });
  }
};
