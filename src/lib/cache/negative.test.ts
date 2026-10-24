import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { MemoryTtlStore, NegativeCache } from "./negative.ts";

describe("negative cache", () => {
  it("remembers a missing key and reports it as missing", async () => {
    const cache = new NegativeCache({ ttlSec: 30, shared: false });
    assert.equal(await cache.has("revenue", "row-1"), false);
    await cache.mark("revenue", "row-1");
    assert.equal(await cache.has("revenue", "row-1"), true);
  });

  it("keeps namespaces apart", async () => {
    const cache = new NegativeCache({ ttlSec: 30, shared: false });
    await cache.mark("revenue", "row-1");
    assert.equal(await cache.has("expenses", "row-1"), false);
  });

  it("forgets a marker when the row appears", async () => {
    const cache = new NegativeCache({ ttlSec: 30, shared: false });
    await cache.mark("revenue", "row-1");
    await cache.remove("revenue", "row-1");
    assert.equal(await cache.has("revenue", "row-1"), false);
  });

  it("clears a whole namespace when the table is written", async () => {
    const cache = new NegativeCache({ ttlSec: 30, shared: false });
    await cache.mark("revenue", "row-1");
    await cache.mark("revenue", "row-2");
    await cache.mark("expenses", "row-3");
    const removed = await cache.removeNamespace("revenue");
    assert.equal(removed, 2);
    assert.equal(await cache.has("revenue", "row-1"), false);
    assert.equal(await cache.has("expenses", "row-3"), true);
  });

  it("counts hits and misses", async () => {
    const cache = new NegativeCache({ ttlSec: 30, shared: false });
    await cache.mark("revenue", "row-1");
    await cache.has("revenue", "row-1");
    await cache.has("revenue", "row-2");
    const stats = cache.stats();
    assert.equal(stats.hits, 1);
    assert.equal(stats.misses, 1);
    assert.equal(stats.marks, 1);
  });

  it("expires markers after their ttl", async () => {
    const cache = new NegativeCache({ ttlSec: 0.05, shared: false });
    await cache.mark("revenue", "row-1");
    assert.equal(await cache.has("revenue", "row-1"), true);
    await new Promise((resolve) => setTimeout(resolve, 80));
    assert.equal(await cache.has("revenue", "row-1"), false);
  });
});

describe("memory ttl store", () => {
  it("evicts the oldest key when it is full", () => {
    const store = new MemoryTtlStore(2);
    store.set("a", "1", 60);
    store.set("b", "1", 60);
    store.set("c", "1", 60);
    assert.equal(store.size, 2);
    assert.equal(store.get("a"), null);
    assert.equal(store.get("c"), "1");
  });

  it("removes every key of a prefix", () => {
    const store = new MemoryTtlStore(10);
    store.set("neg:revenue:1", "1", 60);
    store.set("neg:revenue:2", "1", 60);
    store.set("neg:expenses:1", "1", 60);
    assert.equal(store.deletePrefix("neg:revenue:"), 2);
    assert.equal(store.get("neg:expenses:1"), "1");
  });
});
