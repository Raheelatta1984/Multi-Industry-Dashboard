/**
 * Single flight — collapse identical concurrent work into one execution.
 *
 * A burst of the same read (five browsers loading the same board, a retry
 * storm, a prefetch fan-out) does not need five database round trips: the
 * first call starts the work, the others wait for its result.
 *
 * The promise is removed from the registry as soon as it settles, so a later
 * request with the same key starts fresh work (and the caches above it decide
 * whether the database is needed at all).
 */

const inflight = new Map<string, Promise<unknown>>();

export interface SingleFlightStats {
  /** Executions that actually ran. */
  executions: number;
  /** Calls that joined an execution already in flight. */
  coalesced: number;
  /** Promises currently in flight. */
  inFlight: number;
}

export async function singleFlight<T>(key: string, fn: () => Promise<T>): Promise<T> {
  const existing = inflight.get(key);
  if (existing) {
    stats.coalesced++;
    return existing as Promise<T>;
  }
  stats.executions++;
  const promise = (async () => fn())().finally(() => {
    inflight.delete(key);
  });
  inflight.set(key, promise);
  return promise;
}

const stats: SingleFlightStats = { executions: 0, coalesced: 0, inFlight: 0 };

export function getSingleFlightStats(): SingleFlightStats {
  stats.inFlight = inflight.size;
  return { ...stats };
}

/** Forget the counters (tests). */
export function resetSingleFlightStats(): void {
  stats.executions = 0;
  stats.coalesced = 0;
  stats.inFlight = 0;
}
