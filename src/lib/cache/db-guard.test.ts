import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  analyzeInsert,
  analyzePointLookup,
  guardedQuery,
  noteWrite,
  parseWriteTables,
  primaryTable,
  quoteIdentifier,
} from "./db-guard.ts";

/**
 * A fake database. It answers the guard's internal metadata queries (primary
 * key lookup, row count, key scan) and the data query itself, so the test can
 * count how many round trips actually reached the "database".
 */
function fakeDb(options: {
  rows?: Record<string, unknown>[];
  table?: string;
  primaryKey?: string;
  count?: number;
  keys?: string[];
}) {
  const calls: { sql: string; params: unknown[] }[] = [];
  const table = options.table ?? "widgets";
  const primaryKey = options.primaryKey ?? "id";
  const rows = options.rows ?? [];
  const run = async (sql: string, params: unknown[] = []) => {
    calls.push({ sql, params });
    if (sql.includes("information_schema")) {
      return [{ column: primaryKey }] as Record<string, unknown>[];
    }
    if (sql.includes("count(*)")) {
      return [{ n: options.count ?? 0 }] as Record<string, unknown>[];
    }
    if (sql.includes("as k from")) {
      return (options.keys ?? []).map((k) => ({ k })) as Record<string, unknown>[];
    }
    return rows as Record<string, unknown>[];
  };
  return { run, calls, table };
}

describe("query analysis", () => {
  it("recognises a simple point lookup", () => {
    const lookup = analyzePointLookup("select * from widgets where id = $1", ["w-1"]);
    assert.deepEqual(lookup, {
      table: "widgets",
      column: "id",
      value: "w-1",
      paramIndex: 0,
    });
  });

  it("refuses anything that is not a single equality", () => {
    assert.equal(analyzePointLookup("select * from widgets", []), null);
    assert.equal(analyzePointLookup("select * from widgets where id = $1 or x = $2", ["a", "b"]), null);
    assert.equal(
      analyzePointLookup("select * from widgets join parts on parts.id = widgets.id where id = $1", ["a"]),
      null,
    );
    assert.equal(analyzePointLookup("select count(*) from widgets where id = $1", ["a"]), null);
    assert.equal(analyzePointLookup("select * from widgets where id = $1 limit 1", ["a"]), null);
    assert.equal(
      analyzePointLookup("with x as (select 1) select * from widgets where id = $1", ["a"]),
      null,
    );
    assert.equal(analyzePointLookup("select * from widgets where id = $1", []), null);
  });

  it("reads the table a statement touches", () => {
    assert.equal(primaryTable("select * from widgets where id = $1"), "widgets");
    assert.equal(primaryTable("insert into widgets (id) values ($1)"), "widgets");
    assert.deepEqual(parseWriteTables("update widgets set name = $1 where id = $2"), ["widgets"]);
    assert.deepEqual(parseWriteTables("delete from widgets where id = $1"), ["widgets"]);
    assert.deepEqual(parseWriteTables("select * from widgets"), []);
  });

  it("parses the keys an insert creates", () => {
    const insert = analyzeInsert("insert into widgets (id, name) values ($1, $2)", ["w-1", "A"]);
    assert.equal(insert?.table, "widgets");
    assert.deepEqual(insert?.columns, ["id", "name"]);
    assert.deepEqual(insert?.rows, [["w-1", "A"]]);
  });

  it("refuses to interpolate an unsafe identifier", () => {
    assert.throws(() => quoteIdentifier('widgets"; drop table users; --'));
    assert.equal(quoteIdentifier("widgets"), '"widgets"');
  });
});

describe("guarded query", () => {
  it("answers a repeated empty read from the negative cache", async () => {
    process.env.BLOOM_FILTER_ENABLED = "false";
    const db = fakeDb({ rows: [] });
    const sql = "select * from widgets where id = $1";
    const first = await guardedQuery({
      sql,
      params: ["missing-1"],
      run: db.run as never,
    });
    assert.equal(first.source, "database");
    assert.deepEqual(first.rows, []);

    const second = await guardedQuery({
      sql,
      params: ["missing-1"],
      run: db.run as never,
    });
    assert.equal(second.source, "negative-cache");
    assert.deepEqual(second.rows, []);

    // The second call must not have reached the database again.
    const dataCalls = db.calls.filter((c) => c.sql === sql);
    assert.equal(dataCalls.length, 1);
  });

  it("clears the negative marker when the table is written", async () => {
    process.env.BLOOM_FILTER_ENABLED = "false";
    const db = fakeDb({ rows: [] });
    const sql = "select * from widgets where id = $1";
    await guardedQuery({ sql, params: ["missing-2"], run: db.run as never });
    await noteWrite("insert into widgets (id) values ($1)", ["missing-2"]);

    const after = await guardedQuery({ sql, params: ["missing-2"], run: db.run as never });
    assert.equal(after.source, "database");
  });

  it("skips the database when the bloom filter knows the key is absent", async () => {
    process.env.BLOOM_FILTER_ENABLED = "true";
    process.env.BLOOM_FILTER_TRUST_LOCAL = "true";
    const db = fakeDb({ rows: [], table: "gadgets", primaryKey: "id", count: 2, keys: ["a", "b"] });
    const sql = "select * from gadgets where id = $1";

    const first = await guardedQuery({ sql, params: ["nope"], run: db.run as never });
    assert.equal(first.source, "bloom-filter");
    assert.deepEqual(first.rows, []);

    const second = await guardedQuery({ sql, params: ["nope"], run: db.run as never });
    assert.equal(second.source, "negative-cache");

    const dataCalls = db.calls.filter((c) => c.sql === sql);
    assert.equal(dataCalls.length, 0, "the point lookup must never reach the database");
    process.env.BLOOM_FILTER_ENABLED = "false";
  });

  it("still asks the database for a key the filter may contain", async () => {
    process.env.BLOOM_FILTER_ENABLED = "true";
    process.env.BLOOM_FILTER_TRUST_LOCAL = "true";
    const rows = [{ id: "a" }];
    const db = fakeDb({ rows, table: "gizmos", primaryKey: "id", count: 2, keys: ["a", "b"] });
    const sql = "select * from gizmos where id = $1";
    const result = await guardedQuery({ sql, params: ["a"], run: db.run as never });
    assert.equal(result.source, "database");
    assert.deepEqual(result.rows, rows);
    process.env.BLOOM_FILTER_ENABLED = "false";
  });

  it("coalesces identical concurrent reads into one query", async () => {
    process.env.BLOOM_FILTER_ENABLED = "false";
    const db = fakeDb({ rows: [{ id: "x" }], table: "coalesce_me", primaryKey: "id" });
    const sql = "select * from coalesce_me where id = $1";
    const run = async (queryText: string, queryParams: unknown[]) => {
      await new Promise((resolve) => setTimeout(resolve, 20));
      return db.run(queryText, queryParams) as Promise<Record<string, unknown>[]>;
    };
    const results = await Promise.all([
      guardedQuery({ sql, params: ["x"], run: run as never }),
      guardedQuery({ sql, params: ["x"], run: run as never }),
      guardedQuery({ sql, params: ["x"], run: run as never }),
    ]);
    assert.deepEqual(
      results.map((r) => r.rows.length),
      [1, 1, 1],
    );
    const dataCalls = db.calls.filter((c) => c.sql === sql);
    assert.ok(dataCalls.length <= 1, `expected one database call, saw ${dataCalls.length}`);
  });
});
