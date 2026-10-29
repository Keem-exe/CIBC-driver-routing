// POST /api/route - best order for a driver's selected terminals.
//   { terminalIds: ["10013246", ...] | stopIds: ["S12", ...],
//     start?: {lat, lon} | {stopId} | {terminalId}   (default: New Kingston depot)
//     closed?: false, order?: "best" | "mine", drivers?: 1, path?: false, useGoogle?: true,
//     speedKmh?: 35, serviceMin?: 15, dayHours?: 8 }
import { endpoint } from "../lib/http.js";
import { planRoute } from "../lib/plan.js";

export default endpoint(["POST"], planRoute);
