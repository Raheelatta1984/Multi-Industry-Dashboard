/**
 * Logical Shards + Machine Map for Image Storage
 *
 * Problem: Single bucket/disk for images doesn't scale (thousands of dashboards, user uploads, chart thumbnails, etc.)
 * Solution: Logical sharding with consistent hashing + machine map
 *
 * Concepts:
 *   - Logical shards: fixed number of virtual shards (e.g. 1024) - stable, never changes
 *   - Physical machines/nodes: actual storage buckets / servers / disks (e.g. 8 machines)
 *   - Machine map: mapping logical shard -> physical machine. Allows rebalancing without moving all data.
 *   - Consistent hashing: imageId -> logical shard -> machine
 *
 * Benefits:
 *   - Scale by adding machines and updating machine map (only subset of shards move)
 *   - No hot shards: logical shards >> physical machines
 *   - Machine map can be versioned and rolled out gradually
 *   - Supports multiple storage backends (S3 buckets, local disks, etc.)
 *
 * Example:
 *   Logical shards: 0..1023
 *   Physical machines: 8 nodes (machine-0..machine-7)
 *   Machine map v1: shard % 8 -> machine
 *   Machine map v2: after adding machine-8, remap 1/9 of shards
 *
 * Env:
 *   IMAGE_LOGICAL_SHARDS - number of logical shards (default 1024)
 *   IMAGE_PHYSICAL_MACHINES - comma-separated machine IDs or count (default 8)
 *   IMAGE_SHARD_MAP_VERSION - version of machine map (default 1)
 *   IMAGE_STORAGE_PREFIX - prefix for storage paths (default "meridian/images")
 */

export interface MachineInfo {
  id: string; // e.g. "machine-0" or "s3-bucket-us-east-1-a"
  host?: string; // optional host for direct access
  bucket?: string; // S3 bucket name
  region?: string;
  capacityGB?: number;
  status: "active" | "draining" | "offline";
  weight?: number; // for weighted sharding (default 1)
}

export interface MachineMap {
  version: number;
  logicalShardCount: number;
  machines: MachineInfo[];
  shardToMachine: Record<number, string>; // logical shard -> machine id
  createdAt: string;
}

export interface ImageShardLocation {
  imageId: string;
  logicalShard: number;
  machineId: string;
  machine: MachineInfo;
  path: string; // full storage path
  url?: string; // optional public URL
}

function env(key: string): string | undefined {
  const v = process.env[key]?.trim();
  return v ? v : undefined;
}

function envInt(key: string, fallback: number): number {
  const v = env(key);
  if (!v) return fallback;
  const n = parseInt(v, 10);
  return Number.isFinite(n) ? n : fallback;
}

// ---------------------------------------------------------------------------
// Hash function - deterministic, fast, uniform distribution
// Using FNV-1a 32-bit hash for simplicity and speed
// ---------------------------------------------------------------------------

function fnv1aHash(str: string): number {
  let hash = 0x811c9dc5; // FNV offset basis
  for (let i = 0; i < str.length; i++) {
    hash ^= str.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193); // FNV prime
  }
  return hash >>> 0; // unsigned 32-bit
}

// ---------------------------------------------------------------------------
// Logical shard calculation
// ---------------------------------------------------------------------------

export function getLogicalShardCount(): number {
  return envInt("IMAGE_LOGICAL_SHARDS", 1024);
}

export function getShardForImage(imageId: string, logicalShardCount?: number): number {
  const count = logicalShardCount ?? getLogicalShardCount();
  const hash = fnv1aHash(imageId);
  return hash % count;
}

// ---------------------------------------------------------------------------
// Machine map management
// ---------------------------------------------------------------------------

function getPhysicalMachines(): MachineInfo[] {
  const envMachines = env("IMAGE_PHYSICAL_MACHINES");
  let machines: MachineInfo[] = [];

  if (envMachines) {
    // Could be count (e.g. "8") or list (e.g. "s3-us-east-1-a,s3-us-west-2-b")
    if (/^\d+$/.test(envMachines.trim())) {
      const count = parseInt(envMachines.trim(), 10);
      for (let i = 0; i < count; i++) {
        machines.push({
          id: `machine-${i}`,
          bucket: `meridian-images-${i}`,
          status: "active",
          weight: 1,
        });
      }
    } else {
      const parts = envMachines.split(",").map((s) => s.trim()).filter(Boolean);
      machines = parts.map((id, idx) => ({
        id,
        bucket: id.includes("s3") ? id : `meridian-images-${idx}`,
        status: "active" as const,
        weight: 1,
      }));
    }
  } else {
    // Default 8 machines
    for (let i = 0; i < 8; i++) {
      machines.push({
        id: `machine-${i}`,
        bucket: `meridian-images-${i}`,
        region: i % 2 === 0 ? "us-east-1" : "us-west-2",
        status: "active",
        weight: 1,
      });
    }
  }

  return machines;
}

let cachedMachineMap: MachineMap | null = null;

export function getMachineMap(): MachineMap {
  if (cachedMachineMap) return cachedMachineMap;

  const logicalShardCount = getLogicalShardCount();
  const machines = getPhysicalMachines();
  const version = envInt("IMAGE_SHARD_MAP_VERSION", 1);

  // Build shardToMachine mapping
  // Simple modulo with weight support: weighted round-robin
  const shardToMachine: Record<number, string> = {};

  // Expand machines by weight for weighted distribution
  const weightedMachines: string[] = [];
  for (const m of machines) {
    const weight = m.weight ?? 1;
    for (let w = 0; w < weight; w++) {
      if (m.status === "active") weightedMachines.push(m.id);
    }
  }

  // If all machines offline, fallback to first
  const effectiveMachines = weightedMachines.length > 0 ? weightedMachines : machines.map((m) => m.id);

  for (let shard = 0; shard < logicalShardCount; shard++) {
    // For versioning: we could use different hash for different versions to rebalance
    // Simple: shard % machineCount, but with version offset for rebalancing
    const machineIndex = (shard + version * 7) % effectiveMachines.length;
    shardToMachine[shard] = effectiveMachines[machineIndex];
  }

  cachedMachineMap = {
    version,
    logicalShardCount,
    machines,
    shardToMachine,
    createdAt: new Date().toISOString(),
  };

  return cachedMachineMap;
}

export function getMachineForShard(logicalShard: number): MachineInfo {
  const map = getMachineMap();
  const machineId = map.shardToMachine[logicalShard];
  if (!machineId) throw new Error(`No machine for shard ${logicalShard}`);
  const machine = map.machines.find((m) => m.id === machineId);
  if (!machine) throw new Error(`Machine ${machineId} not found in map`);
  return machine;
}

export function getMachineForImage(imageId: string): MachineInfo {
  const shard = getShardForImage(imageId);
  return getMachineForShard(shard);
}

// ---------------------------------------------------------------------------
// Path resolution
// ---------------------------------------------------------------------------

function getStoragePrefix(): string {
  return env("IMAGE_STORAGE_PREFIX") ?? "meridian/images";
}

export function resolveImagePath(imageId: string, extension = "png"): string {
  const shard = getShardForImage(imageId);
  const machine = getMachineForShard(shard);
  const prefix = getStoragePrefix();

  // Hierarchical path for filesystem efficiency: prefix / machine / shard / first2chars / imageId
  const subDir = imageId.slice(0, 2) || "xx";
  return `${prefix}/${machine.id}/shard-${shard}/${subDir}/${imageId}.${extension}`;
}

export function resolveImageLocation(imageId: string, extension = "png"): ImageShardLocation {
  const logicalShard = getShardForImage(imageId);
  const machine = getMachineForShard(logicalShard);
  const path = resolveImagePath(imageId, extension);

  // Build URL if bucket/host info available
  let url: string | undefined;
  if (machine.bucket) {
    // Example S3 URL - in production you'd sign this
    url = `https://${machine.bucket}.s3.amazonaws.com/${path}`;
  } else if (machine.host) {
    url = `https://${machine.host}/${path}`;
  }

  return {
    imageId,
    logicalShard,
    machineId: machine.id,
    machine,
    path,
    url,
  };
}

// ---------------------------------------------------------------------------
// Shard management utilities
// ---------------------------------------------------------------------------

/**
 * Get all images that belong to a specific machine (for rebalancing, migration)
 */
export function getShardsForMachine(machineId: string): number[] {
  const map = getMachineMap();
  const shards: number[] = [];
  for (const [shardStr, mid] of Object.entries(map.shardToMachine)) {
    if (mid === machineId) shards.push(parseInt(shardStr, 10));
  }
  return shards;
}

export function getShardDistribution(): Record<string, { count: number; percentage: number }> {
  const map = getMachineMap();
  const counts: Record<string, number> = {};
  for (const machineId of Object.values(map.shardToMachine)) {
    counts[machineId] = (counts[machineId] ?? 0) + 1;
  }

  const total = map.logicalShardCount;
  const dist: Record<string, { count: number; percentage: number }> = {};
  for (const [machineId, count] of Object.entries(counts)) {
    dist[machineId] = {
      count,
      percentage: Math.round((count / total) * 10000) / 100,
    };
  }
  return dist;
}

/**
 * Simulate adding a new machine and show which shards would move
 */
export function simulateAddMachine(newMachineId: string): {
  currentDistribution: ReturnType<typeof getShardDistribution>;
  newDistribution: Record<string, { count: number; percentage: number }>;
  shardsToMove: { from: string; shard: number; to: string }[];
} {
  const currentMap = getMachineMap();
  const currentDist = getShardDistribution();

  // Simulate new map with extra machine
  const newMachines = [...currentMap.machines, { id: newMachineId, status: "active" as const, weight: 1 }];
  const weightedMachines = newMachines.filter((m) => m.status === "active").map((m) => m.id);

  const newShardToMachine: Record<number, string> = {};
  for (let shard = 0; shard < currentMap.logicalShardCount; shard++) {
    const machineIndex = (shard + currentMap.version * 7) % weightedMachines.length;
    newShardToMachine[shard] = weightedMachines[machineIndex];
  }

  const newCounts: Record<string, number> = {};
  for (const mid of Object.values(newShardToMachine)) {
    newCounts[mid] = (newCounts[mid] ?? 0) + 1;
  }

  const newDist: Record<string, { count: number; percentage: number }> = {};
  for (const [mid, count] of Object.entries(newCounts)) {
    newDist[mid] = {
      count,
      percentage: Math.round((count / currentMap.logicalShardCount) * 10000) / 100,
    };
  }

  const shardsToMove: { from: string; shard: number; to: string }[] = [];
  for (let shard = 0; shard < currentMap.logicalShardCount; shard++) {
    const oldMachine = currentMap.shardToMachine[shard];
    const newMachine = newShardToMachine[shard];
    if (oldMachine !== newMachine) {
      shardsToMove.push({ from: oldMachine, shard, to: newMachine });
    }
  }

  return {
    currentDistribution: currentDist,
    newDistribution: newDist,
    shardsToMove,
  };
}

/**
 * Invalidate cached machine map (call after env change or new version deploy)
 */
export function invalidateMachineMapCache(): void {
  cachedMachineMap = null;
}

/**
 * Example: generate a new machine map version file for ops
 */
export function generateMachineMapJson(): string {
  const map = getMachineMap();
  return JSON.stringify(map, null, 2);
}
