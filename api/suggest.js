// POST /api/suggest - terminals worth adding to a driver's selection (cheapest detours first).
//   Same selection fields as /api/route, plus limit?: 8, maxExtraKm?: 15, includeOverDay?: false
import { endpoint } from "../lib/http.js";
import { suggestAddOns } from "../lib/plan.js";

export default endpoint(["POST"], suggestAddOns);
