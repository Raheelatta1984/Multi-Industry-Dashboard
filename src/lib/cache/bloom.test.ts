import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { BloomFilter, BloomFilterRegistry, bytesToBase64, base64ToBytes, fnv1a } from "./bloom.ts";

describe("bloom filter", () => {
  it("never reports an added key as absent", () => {
    const filter = new BloomFilter({ expectedItems: 100, falsePositiveRate: 0.01 });
    for (let i = 0; i < 100; i++) filter.add(`row-${i}`);
    for (let i = 0; i < 100; i++) {
      assert.equal(filter.has(`row-${i}`), true, `row-${i} must be present`);
    }
  });

  it("keeps the false positive rate near the configured target", () => {
    const filter = new BloomFilter({ expectedItems: 1000, falsePositiveRate: 0.01 });
    for (let i = 0; i < 1000; i++) filter.add(`present-${i}`);
    let falsePositives = 0;
    const probes = 10_000;
    for (let i = 0; i < probes; i++) {
      if (filter.has(`absent-${i}`)) falsePositives++;
    }
    const rate = falsePositives / probes;
    // Generous bound: the formula is approximate and the hash is not perfect.
    assert.ok(rate < 0.05, `false positive rate ${rate} should stay under 5%`);
  });

  it("reports absent keys as absent", () => {
    const filter = new BloomFilter({ expectedItems: 16 });
    filter.add("alpha");
    assert.equal(filter.has("beta"), false);
  });

  it("stops answering 'definitely absent' once saturated", () => {
    const filter = new BloomFilter({ expectedItems: 4 });
    for (let i = 0; i < 40; i++) filter.add(`k-${i}`);
    assert.equal(filter.isSaturated, true);
    // A saturated filter must never claim a key is absent.
    assert.equal(filter.has("definitely-not-there"), true);
  });

  it("survives a serialize/deserialize round trip", () => {
    const filter = new BloomFilter({ expectedItems: 64 });
    for (let i = 0; i < 64; i++) filter.add(`key-${i}`);
    const restored = BloomFilter.deserialize(filter.serialize());
    assert.equal(restored.size, 64);
    for (let i = 0; i < 64; i++) {
      assert.equal(restored.has(`key-${i}`), true);
    }
  });

  it("round trips bytes through base64", () => {
    const bytes = new Uint8Array([0, 1, 127, 128, 255, 42]);
    assert.deepEqual([...base64ToBytes(bytesToBase64(bytes))], [...bytes]);
  });

  it("hashes deterministically and spreads keys", () => {
    assert.equal(fnv1a("meridian"), fnv1a("meridian"));
    assert.notEqual(fnv1a("meridian"), fnv1a("meridian "));
    const hashes = new Set<string>();
    for (let i = 0; i < 100; i++) hashes.add(String(fnv1a(`key-${i}`)));
    assert.equal(hashes.size, 100);
  });

  it("registers, invalidates and reports named filters", () => {
    const registry = new BloomFilterRegistry();
    const entry = registry.ensure("revenue", { expectedItems: 8 });
    entry.filter.add("r1");
    assert.equal(registry.get("revenue")?.filter.has("r1"), true);
    assert.ok(registry.stats()["revenue"]);
    assert.equal(registry.invalidate("revenue"), true);
    assert.equal(registry.get("revenue"), undefined);
  });
});
