/**
 * Guard panel types — shared by the client page and the server-only
 * implementation (kept in their own module so neither side has to import the
 * other).
 */

export interface GuardSnapshot {
  /** Counters of the HTTP request guard. */
  http: {
    requests: number;
    rateLimited: number;
    negativeHits: number;
    negativesMarked: number;
  };
  /** Counters of the database guard. */
  db: {
    queries: number;
    positiveCacheHits: number;
    negativeCacheHits: number;
    bloomHits: number;
    dbQueries: number;
    dbQueriesSaved: number;
    coalesced: number;
    rateLimited: number;
    writes: number;
  };
  /** Counters of the negative cache. */
  negativeCache: {
    hits: number;
    misses: number;
    marks: number;
    evictions: number;
    size: number;
  };
  /** Counters of the request coalescer. */
  singleFlight: {
    executions: number;
    coalesced: number;
    inFlight: number;
  };
  /** One entry per Bloom index (table). */
  bloom: Record<string, BloomIndexStats>;
}

/** The live counters of one Bloom index. */
export interface BloomIndexStats {
  /** Bits in the bitset (m). */
  bitCount: number;
  /** Hash functions used (k). */
  hashCount: number;
  /** Keys in the index. */
  inserted: number;
  /** Fraction of bits set (0..1). */
  fillRatio: number;
  /** Estimated false-positive rate at the current fill. */
  falsePositiveRate: number;
  /** Bytes the bitset occupies. */
  bytes: number;
  /** True once the index holds more keys than it was sized for. */
  saturated: boolean;
  /** When the snapshot was taken. */
  builtAt: number;
}

export interface GuardProbeResult {
  /** The table the probe looked in. */
  table: string | null;
  /** The key the probe looked for. */
  key: string;
  /** Where each run was answered. */
  sources: string[];
  /** Rows returned (always empty for the probe key). */
  rows: number[];
  /** Database round trips the probe actually caused. */
  databaseRoundTrips: number;
  /** A human readable summary. */
  summary: string;
}
