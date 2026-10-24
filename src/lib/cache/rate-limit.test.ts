import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  ConcurrencyLimiter,
  RateLimitError,
  TokenBucketRateLimiter,
  clientKeyFromHeaders,
  rateLimitHeaders,
} from "./rate-limit.ts";

describe("token bucket rate limiter", () => {
  it("allows requests up to the limit and refuses the next one", () => {
    const limiter = new TokenBucketRateLimiter({ limit: 3, windowSec: 60 });
    assert.equal(limiter.consume("client").allowed, true);
    assert.equal(limiter.consume("client").allowed, true);
    assert.equal(limiter.consume("client").allowed, true);
    const denied = limiter.consume("client");
    assert.equal(denied.allowed, false);
    assert.equal(denied.remaining, 0);
    assert.ok(denied.retryAfterSec > 0);
  });

  it("keeps budgets separate per client", () => {
    const limiter = new TokenBucketRateLimiter({ limit: 1, windowSec: 60 });
    assert.equal(limiter.consume("a").allowed, true);
    assert.equal(limiter.consume("a").allowed, false);
    assert.equal(limiter.consume("b").allowed, true);
  });

  it("does not spend tokens on a refused request", () => {
    const limiter = new TokenBucketRateLimiter({ limit: 1, windowSec: 60 });
    limiter.consume("a");
    for (let i = 0; i < 5; i++) limiter.consume("a");
    const stats = limiter.stats();
    assert.equal(stats.allowed, 1);
    assert.equal(stats.denied, 5);
  });

  it("refills over time", async () => {
    const limiter = new TokenBucketRateLimiter({ limit: 10, windowSec: 0.05 });
    assert.equal(limiter.consume("a").allowed, true);
    for (let i = 0; i < 10; i++) limiter.consume("a");
    assert.equal(limiter.consume("a").allowed, false);
    await new Promise((resolve) => setTimeout(resolve, 80));
    assert.equal(limiter.consume("a").allowed, true);
  });

  it("reports headers a client can act on", () => {
    const limiter = new TokenBucketRateLimiter({ limit: 2, windowSec: 60 });
    const decision = limiter.consume("a");
    const headers = rateLimitHeaders(decision);
    assert.equal(headers["X-RateLimit-Limit"], "2");
    assert.equal(headers["X-RateLimit-Remaining"], "1");
    assert.ok(Number(headers["X-RateLimit-Reset"]) > 0);
  });
});

describe("concurrency limiter", () => {
  it("runs work up to the limit", async () => {
    const limiter = new ConcurrencyLimiter(2, 2);
    let running = 0;
    let peak = 0;
    const task = async () => {
      running++;
      peak = Math.max(peak, running);
      await new Promise((resolve) => setTimeout(resolve, 20));
      running--;
    };
    await Promise.all([limiter.run(task), limiter.run(task), limiter.run(task)]);
    assert.ok(peak <= 2, `peak concurrency ${peak} must not exceed 2`);
  });

  it("rejects with a 429 shaped error when the queue is full", async () => {
    const limiter = new ConcurrencyLimiter(1, 0);
    const slow = limiter.run(() => new Promise((resolve) => setTimeout(() => resolve(1), 50)));
    await assert.rejects(
      () => limiter.run(async () => 2),
      (error: unknown) => {
        assert.ok(error instanceof RateLimitError);
        assert.equal((error as RateLimitError).status, 429);
        return true;
      },
    );
    await slow;
  });
});

describe("client identification", () => {
  it("prefers the first forwarded address", () => {
    const headers = new Headers({
      "x-forwarded-for": "203.0.113.7, 70.41.3.18",
      "x-real-ip": "198.51.100.9",
    });
    assert.equal(clientKeyFromHeaders(headers), "203.0.113.7");
  });

  it("falls back to x-real-ip and then to a shared bucket", () => {
    assert.equal(clientKeyFromHeaders(new Headers({ "x-real-ip": "198.51.100.9" })), "198.51.100.9");
    assert.equal(clientKeyFromHeaders(new Headers()), "unknown");
  });
});
