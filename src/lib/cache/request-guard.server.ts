/**
 * Request guard — the HTTP edge of the load protection.
 *
 * Every request that reaches the server passes through this middleware:
 *
 * 1. **Rate limit** — a token bucket per client (IP). Over the budget the
 *    request is refused with `429` and a `Retry-After` header *before* it can
 *    touch the database. Three budgets: page/API requests, static assets (a
 *    larger bucket, they are cheap but numerous) and authentication endpoints
 *    (a small bucket — sign-in is the endpoint worth protecting).
 *
 * 2. **Negative cache for missing resources** — a `GET` that comes back `404`
 *    is remembered for a short while. The next identical request is answered
 *    from the marker instead of running the router (and whatever it touches)
 *    again. This is what stops a client looping over guessed ids from
 *    turning into a stream of database work.
 *
 * 3. **Budget headers** — `X-RateLimit-*` on every response so a client (or
 *    the demo page) can see the remaining budget.
 *
 * The middleware is registered in `src/start.ts` next to the CSRF middleware,
 * so it also covers server-function calls (they are requests too). This module
 * is **server-only** (`.server.ts`); the thin `request-guard.ts` wrapper is
 * what `src/start.ts` imports, so no server module ends up in the client
 * bundle.
 */

import type { RequestServerOptions } from "@tanstack/react-start";
import { getNegativeCache } from "./negative.ts";
import {
  TokenBucketRateLimiter,
  clientKeyFromHeaders,
  getHttpRateLimitConfig,
  rateLimitHeaders,
} from "./rate-limit.ts";

/** How long a "this does not exist" answer is remembered (seconds). */
const NEGATIVE_TTL_SEC = 15;

export interface RequestGuardStats {
  /** Requests seen. */
  requests: number;
  /** Requests refused by the rate limiter. */
  rateLimited: number;
  /** Requests served from a negative marker (no routing, no database). */
  negativeHits: number;
  /** `404` responses remembered. */
  negativesMarked: number;
}

interface GuardState {
  stats: RequestGuardStats;
  limiter: TokenBucketRateLimiter;
  staticLimiter: TokenBucketRateLimiter;
  authLimiter: TokenBucketRateLimiter;
}

const globalRef = globalThis as typeof globalThis & {
  __requestGuardState__?: GuardState;
};

function guardState(): GuardState {
  if (!globalRef.__requestGuardState__) {
    const config = getHttpRateLimitConfig();
    globalRef.__requestGuardState__ = {
      stats: { requests: 0, rateLimited: 0, negativeHits: 0, negativesMarked: 0 },
      limiter: new TokenBucketRateLimiter({
        limit: config.max,
        windowSec: config.windowSec,
        burst: config.max,
      }),
      staticLimiter: new TokenBucketRateLimiter({
        limit: config.staticMax,
        windowSec: config.windowSec,
        burst: config.staticMax,
      }),
      authLimiter: new TokenBucketRateLimiter({
        limit: config.authMax,
        windowSec: config.windowSec,
        burst: config.authMax,
      }),
    };
  }
  return globalRef.__requestGuardState__;
}

export function getRequestGuardStats(): RequestGuardStats {
  return { ...guardState().stats };
}

export function resetRequestGuardStats(): void {
  const state = guardState();
  state.stats = { requests: 0, rateLimited: 0, negativeHits: 0, negativesMarked: 0 };
}

/** Static assets are served by the CDN in production — cheap, but numerous. */
function isStaticAsset(pathname: string): boolean {
  return (
    pathname.startsWith("/assets/") ||
    pathname.startsWith("/__grok/") ||
    pathname === "/favicon.svg" ||
    pathname === "/favicon.ico" ||
    pathname === "/robots.txt" ||
    /\.(?:js|mjs|css|png|jpe?g|svg|ico|webp|avif|woff2?|map|txt|xml|json)$/i.test(pathname)
  );
}

/** Authentication endpoints get their own (smaller) budget. */
function isAuthPath(pathname: string): boolean {
  return pathname.startsWith("/api/auth");
}

/**
 * The middleware body — runs for every request (page loads, server functions
 * and API calls alike). `request-guard.ts` wires it into
 * `createMiddleware({ type: "request" })`.
 */
export async function runRequestGuard({
  next,
  request,
  pathname,
}: RequestServerOptions<unknown, unknown>) {
  const state = guardState();
  const config = getHttpRateLimitConfig();
  state.stats.requests++;

  if (!config.enabled) return next();

  const clientKey = clientKeyFromHeaders(request.headers);
  const limiter = isStaticAsset(pathname)
    ? state.staticLimiter
    : isAuthPath(pathname)
      ? state.authLimiter
      : state.limiter;

  const decision = limiter.consume(clientKey);
  if (!decision.allowed) {
    state.stats.rateLimited++;
    const headers = new Headers({
      "content-type": "text/plain; charset=utf-8",
      "retry-after": String(decision.retryAfterSec),
      ...rateLimitHeaders(decision),
    });
    return new Response("Too many requests — slow down.", { status: 429, headers });
  }

  const method = request.method.toUpperCase();
  const cacheable = method === "GET" || method === "HEAD";
  const negativeCache = getNegativeCache();
  const negativeKey = `http:${method}:${pathname}`;

  // A resource we already know does not exist — answer without routing.
  if (cacheable && (await negativeCache.has("http", negativeKey))) {
    state.stats.negativeHits++;
    return new Response("Not Found", {
      status: 404,
      headers: { ...rateLimitHeaders(decision), "x-cache": "negative" },
    });
  }

  const result = await next();
  const response = result.response;

  // Remember a missing resource so the next request for it is cheap.
  if (cacheable && response.status === 404) {
    await negativeCache.mark("http", negativeKey, NEGATIVE_TTL_SEC);
    state.stats.negativesMarked++;
  }

  // Surface the remaining budget (best effort — some responses are immutable).
  try {
    response.headers.set("X-RateLimit-Limit", String(decision.limit));
    response.headers.set("X-RateLimit-Remaining", String(Math.max(0, decision.remaining)));
    response.headers.set("X-RateLimit-Reset", String(Math.ceil(decision.resetAt / 1000)));
  } catch {
    // Immutable response (e.g. a streamed SSR body) — the guard still ran.
  }

  return result;
}
