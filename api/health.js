// GET /api/health - MongoDB reachable? Google configured? Today's Google budget.
import { endpoint } from "../lib/http.js";
import { getDb } from "../lib/db.js";
import { googleEnabled, usageToday } from "../lib/google.js";

export default endpoint(["GET"], async () => {
  const db = await getDb();
  await db.command({ ping: 1 });
  return {
    ok: true,
    stops: await db.collection("stops").estimatedDocumentCount(),
    google: googleEnabled(),
    usage: await usageToday(db),
  };
});
