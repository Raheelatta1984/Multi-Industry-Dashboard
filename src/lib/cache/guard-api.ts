/**
 * Guard API — the server functions behind the "/scalability" guard panel.
 *
 * Two calls:
 *   - `getGuardSnapshot` — the live counters of both guards (HTTP + database).
 *   - `probeGuard` — a live demonstration: it runs a point lookup for a key
 *     that does not exist and repeats it, so the page can show which layer
 *     answered (database -> Bloom filter -> negative cache).
 *
 * This module is shared (the browser imports it to *call* the functions), so
 * the server-only implementation is imported dynamically inside the handlers —
 * the handler bodies never ship to the client.
 */

import { createServerFn } from "@tanstack/react-start";

export const getGuardSnapshot = createServerFn({ method: "GET" }).handler(async () => {
  const { collectGuardSnapshot } = await import("./guard-stats.server.ts");
  return collectGuardSnapshot();
});

export const probeGuard = createServerFn({ method: "GET" }).handler(async () => {
  const { runGuardProbe } = await import("./guard-stats.server.ts");
  return runGuardProbe();
});

export type { GuardSnapshot, GuardProbeResult } from "./guard-types.ts";
