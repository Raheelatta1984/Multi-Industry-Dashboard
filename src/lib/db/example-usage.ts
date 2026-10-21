/**
 * Example usage of scalability features
 * This file is for documentation and can be imported in server functions
 */

import { getSql } from "../db";
import { nextId, parseId } from "../id/next-id";
import { resolveImageLocation, getShardForImage, getMachineMap } from "../storage/image-sharding";
import { getMemcachedClient, dashboardCache, cachedQuery } from "../cache/memcached";
import { queryWithRouting, isReadOnlyQuery } from "./replicas";
import { getPgbouncerConfig } from "./pgbouncer";

// Example 1: Generate distributed ID (no clash, sortable)
export async function exampleCreateRecord() {
  // Shard 42 (e.g. machine-2)
  const id = nextId(42);
  const parsed = parseId(id);
  console.log(`New ID: ${id}, shard=${parsed.shardId}, time=${parsed.timestamp.toISOString()}, counter=${parsed.counter}`);

  // Use in DB insert (primary via PgBouncer)
  const sql = await getSql();
  // await sql`INSERT INTO revenue (id, amount) VALUES (${id}, ${1000})`;
  return id;
}

// Example 2: Image upload with logical sharding
export async function exampleImageUpload(imageId: string, extension = "png") {
  const location = resolveImageLocation(imageId, extension);
  console.log(`Image ${imageId} -> shard ${location.logicalShard} -> machine ${location.machineId} -> path ${location.path}`);

  // In production: upload to S3 bucket or disk at location.path
  // await s3.putObject({ Bucket: location.machine.bucket, Key: location.path, Body: file });

  return location;
}

// Example 3: Read with replica routing + memcached
export async function exampleReadDashboard(boardId: string, slice: string, currency: string) {
  const cacheKey = dashboardCache.key(boardId, slice, currency);

  // Try cache first
  const cached = await dashboardCache.get(boardId, slice, currency);
  if (cached) return cached;

  // Cache miss: query with replica routing
  const { rows, fromReplica } = await queryWithRouting(
    "SELECT * FROM revenue WHERE industry = $1 AND currency = $2 LIMIT 100",
    [slice, currency]
  );

  console.log(`Query served from ${fromReplica ? "replica" : "primary"}, rows=${rows.length}`);

  // Populate cache for 2 minutes
  await dashboardCache.set(boardId, slice, currency, rows, 120);

  return rows;
}

// Example 4: Cached query helper
export async function exampleCachedFxRate(currency: string) {
  return cachedQuery(
    `fx:${currency}`,
    async () => {
      const sql = await getSql();
      const rows = await sql.query("SELECT rate FROM fx WHERE currency = $1", [currency]);
      return rows[0];
    },
    300 // 5 min TTL
  );
}

// Example 5: Check PgBouncer config
export function examplePgbouncerInfo() {
  const cfg = getPgbouncerConfig();
  console.log(`PgBouncer enabled=${cfg.enabled}, mode=${cfg.poolMode}, poolSize=${cfg.maxPoolSize}`);
  return cfg;
}

// Example 6: Machine map visualization
export function exampleMachineMap() {
  const map = getMachineMap();
  console.log(`Machine map v${map.version}, ${map.logicalShardCount} shards, ${map.machines.length} machines`);
  for (const m of map.machines) {
    console.log(`  ${m.id}: bucket=${m.bucket}, status=${m.status}`);
  }
  return map;
}

// Example 7: ID sorting
export function exampleIdSorting() {
  const ids = [nextId(1), nextId(1), nextId(2), nextId(1)];
  console.log("Unsorted:", ids);
  const sorted = ids.sort((a, b) => (BigInt(a) < BigInt(b) ? -1 : 1));
  console.log("Sorted (chronological):", sorted);
  return sorted;
}

// Example 8: Detect read vs write
export function exampleQueryRouting(sql: string) {
  const readOnly = isReadOnlyQuery(sql);
  console.log(`Query "${sql.slice(0, 50)}" is ${readOnly ? "READ -> replica+cache" : "WRITE -> primary"}`);
  return readOnly;
}
