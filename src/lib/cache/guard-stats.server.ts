/**
 * Guard stats — **server-only** helpers for the "/scalability" guard panel.
 *
 * Kept in a `.server.ts` module (the repo convention): it touches the
 * database and the process-wide guard state, so it must never reach the
 * browser. `guard-api.ts` imports it dynamically from inside the server
 * function handlers.
 */

import { getBloomRegistry } from "./bloom.ts";
import { getGuardStats } from "./db-guard.ts";
import { getNegativeCache } from "./negative.ts";
import { getRequestGuardStats } from "./request-guard.server.ts";
import { getSingleFlightStats } from "./single-flight.ts";
import type { GuardProbeResult, GuardSnapshot } from "./guard-types.ts";

export function collectGuardSnapshot(): GuardSnapshot {
  return {
    http: getRequestGuardStats(),
    db: getGuardStats(),
    negativeCache: getNegativeCache().stats(),
    singleFlight: getSingleFlightStats(),
    bloom: getBloomRegistry().stats(),
  };
}

/**
 * Run the same missing-key lookup three times and report which layer
 * answered each time: database -> Bloom filter -> negative cache.
 */
export async function runGuardProbe(): Promise<GuardProbeResult> {
  const { getRawSql } = await import("@/lib/db");
  const { guardedQuery, getGuardStats } = await import("./db-guard.ts");

  // The raw client is the database itself — the probe measures how often the
  // guard decides to go there.
  const raw = await getRawSql();
  const tableRows = await raw.query<{ table_name: string; column_name: string }>(
    `select tc.table_name as table_name, kcu.column_name as column_name
       from information_schema.table_constraints tc
       join information_schema.key_column_usage kcu
         on kcu.constraint_name = tc.constraint_name
        and kcu.constraint_schema = tc.constraint_schema
        and kcu.table_name = tc.table_name
      where tc.constraint_type = 'PRIMARY KEY'
      order by tc.table_name
      limit 1`,
  );

  const target = tableRows[0];
  if (!target) {
    return {
      table: null,
      key: "",
      sources: [],
      rows: [],
      databaseRoundTrips: 0,
      summary: "No table with a primary key yet — create one and the probe lights up.",
    };
  }

  const key = "__guard_probe_missing__";
  // Unquoted identifiers: the guard only applies its Bloom filter to simple
  // identifiers, and these come from the catalog, not from user input.
  const statement = `select * from ${target.table_name} where ${target.column_name} = $1`;
  const before = getGuardStats().dbQueries;
  const sources: string[] = [];
  const rows: number[] = [];

  for (let i = 0; i < 3; i++) {
    const result = await guardedQuery({
      sql: statement,
      params: [key],
      run: (text, params) => raw.query(text, params),
      meta: (text, params) => raw.query(text, params),
    });
    sources.push(result.source);
    rows.push(result.rows.length);
  }

  const databaseRoundTrips = getGuardStats().dbQueries - before;
  const summary =
    databaseRoundTrips === 0
      ? `All three lookups were answered without touching the database (${sources.join(" → ")}).`
      : `The database was hit ${databaseRoundTrips} time(s); the repeats were served from cache (${sources.join(" → ")}).`;

  return {
    table: target.table_name,
    key,
    sources,
    rows,
    databaseRoundTrips,
    summary,
  };
}
