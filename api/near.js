// POST /api/near - real road km for pairs of stops (cache first, then Google within the daily budget).
//   { pairs: [{ a: "S12", b: "S40" }, ...] }  ->  { km: [3.4, null, ...] }  (null = no road distance available)
import { endpoint } from "../lib/http.js";
import { pairKm } from "../lib/matrix.js";
import { allStops, HttpError } from "../lib/stops.js";

export default endpoint(["POST"], async ({ pairs }) => {
  if (!Array.isArray(pairs) || !pairs.length || pairs.length > 12) throw new HttpError(400, "Provide 1-12 pairs");
  const byId = new Map((await allStops()).map((s) => [s.id, s]));
  const list = pairs.map(({ a, b }) => {
    if (!byId.has(a) || !byId.has(b)) throw new HttpError(400, `Unknown stop in pair ${a}, ${b}`);
    return { a: byId.get(a), b: byId.get(b) };
  });
  return { km: await pairKm(list) };
});
