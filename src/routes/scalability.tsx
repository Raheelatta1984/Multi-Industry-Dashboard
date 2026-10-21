import { createFileRoute } from "@tanstack/react-router";
import { useMemo, useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";

export const Route = createFileRoute("/scalability")({
  component: ScalabilityPage,
});

function ScalabilityPage() {
  const [ids, setIds] = useState<string[]>([]);
  const [shardDemo, setShardDemo] = useState<{ imageId: string; shard: number; machine: string; path: string } | null>(null);

  // Mock data for demo (client-side, no DB needed)
  const mockPgbouncer = {
    enabled: false,
    mode: "transaction",
    maxPool: 20,
    note: "Set PGBOUNCER_ENABLED=true or PGBOUNCER_URL to enable in production",
  };

  const mockReplicas = {
    primary: "neon-primary (DATABASE_URL)",
    replicas: ["No replicas configured - set DATABASE_REPLICA_URLS", "Add comma-separated replica URLs for read scaling"],
    routing: "SELECT -> replica, INSERT/UPDATE -> primary",
  };

  const mockCache = {
    enabled: true,
    mode: "in-memory LRU fallback (no external Memcached)",
    ttl: "60-300s for queries, 120s for boards",
    hitRate: "N/A (dev)",
  };

  const mockShards = useMemo(() => {
    // Simulate distribution
    return Array.from({ length: 8 }, (_, i) => ({
      machine: `machine-${i}`,
      shards: 128,
      percent: 12.5,
      bucket: `meridian-images-${i}`,
    }));
  }, []);

  const generateIds = () => {
    // Client-side ID generation demo (mirrors server logic but simplified)
    const now = Date.now();
    const epoch = Date.UTC(2024, 0, 1);
    const ts = now - epoch;
    const shard = Math.floor(Math.random() * 8192);
    const counter = Math.floor(Math.random() * 1024);
    // Simplified 64-bit ID construction for demo (not exact same as server but shows pattern)
    const id = (BigInt(ts) << 23n) | (BigInt(shard) << 10n) | BigInt(counter);
    return id.toString();
  };

  const handleGenerateIds = () => {
    const newIds = Array.from({ length: 5 }, () => generateIds());
    setIds(newIds);
  };

  const handleShardDemo = () => {
    const imageId = `img_${Math.random().toString(36).slice(2, 10)}`;
    // FNV-1a hash simplified
    let hash = 0x811c9dc5;
    for (let i = 0; i < imageId.length; i++) {
      hash ^= imageId.charCodeAt(i);
      hash = Math.imul(hash, 0x01000193);
    }
    hash >>>= 0;
    const shard = hash % 1024;
    const machine = `machine-${shard % 8}`;
    const path = `meridian/images/${machine}/shard-${shard}/${imageId.slice(0, 2)}/${imageId}.png`;
    setShardDemo({ imageId, shard, machine, path });
  };

  return (
    <div className="min-h-screen bg-zinc-50 dark:bg-zinc-950 p-6 space-y-6">
      <div className="max-w-6xl mx-auto space-y-6">
        <div>
          <h1 className="text-3xl font-bold tracking-tight">Scalability Architecture</h1>
          <p className="text-zinc-500 mt-2">
            PgBouncer · Read Replicas · Memcached · Logical Shards + Machine Map · 64-bit next_id (41-13-10)
          </p>
        </div>

        <div className="grid md:grid-cols-2 gap-6">
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                PgBouncer <Badge variant="outline">Neon</Badge>
              </CardTitle>
               <div class="text-xs text-zinc-500">Transaction pooling for high concurrency</div>
            </CardHeader>
            <CardContent className="space-y-3 text-sm">
              <div className="flex justify-between"><span>Enabled</span><span>{mockPgbouncer.enabled ? "Yes" : "No (dev fallback)"}</span></div>
              <div className="flex justify-between"><span>Pool Mode</span><Badge>{mockPgbouncer.mode}</Badge></div>
              <div className="flex justify-between"><span>Max Pool Size</span><span>{mockPgbouncer.maxPool}</span></div>
              <div className="flex justify-between"><span>Max Client Conn</span><span>1000</span></div>
              <p className="text-xs text-zinc-500 pt-2">{mockPgbouncer.note}</p>
              <div className="bg-zinc-100 dark:bg-zinc-900 p-3 rounded text-xs font-mono">
                DATABASE_URL=postgres://...<br />
                PGBOUNCER_URL=postgres://...:6432/...<br />
                PGBOUNCER_ENABLED=true
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                Read Replicas <Badge variant="outline">Scale Reads</Badge>
              </CardTitle>
               <div class="text-xs text-zinc-500">Route SELECTs to replicas, writes to primary</div>
            </CardHeader>
            <CardContent className="space-y-3 text-sm">
              <div><span className="font-medium">Primary:</span> {mockReplicas.primary}</div>
              <div>
                <span className="font-medium">Replicas:</span>
                <ul className="list-disc ml-5 mt-1 text-xs">
                  {mockReplicas.replicas.map((r, i) => <li key={i}>{r}</li>)}
                </ul>
              </div>
              <div className="flex justify-between"><span>Routing</span><span className="text-xs">{mockReplicas.routing}</span></div>
              <div className="bg-zinc-100 dark:bg-zinc-900 p-3 rounded text-xs font-mono">
                DATABASE_REPLICA_URLS=postgres://replica1,postgres://replica2<br />
                REPLICA_ROUTING_ENABLED=true
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                Memcached <Badge variant="outline">Cache</Badge>
              </CardTitle>
               <div class="text-xs text-zinc-500">Look-aside cache for hot dashboards</div>
            </CardHeader>
            <CardContent className="space-y-3 text-sm">
              <div className="flex justify-between"><span>Enabled</span><span>{mockCache.enabled ? "Yes" : "No"}</span></div>
              <div className="flex justify-between"><span>Mode</span><span className="text-xs">{mockCache.mode}</span></div>
              <div className="flex justify-between"><span>TTL</span><span>{mockCache.ttl}</span></div>
              <div className="flex justify-between"><span>Hit Rate</span><span>{mockCache.hitRate}</span></div>
              <div className="bg-zinc-100 dark:bg-zinc-900 p-3 rounded text-xs font-mono">
                MEMCACHED_SERVERS=localhost:11211<br />
                MEMCACHED_DEFAULT_TTL=300<br />
                <br />
                dashboardCache.key(boardId, slice, currency)<br />
                cachedQuery(key, fn, ttl)
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                Image Sharding <Badge variant="outline">1024 shards</Badge>
              </CardTitle>
               <div class="text-xs text-zinc-500">Logical shards + machine map</div>
            </CardHeader>
            <CardContent className="space-y-3 text-sm">
              <div className="grid grid-cols-2 gap-2">
                {mockShards.map((m) => (
                  <div key={m.machine} className="bg-zinc-100 dark:bg-zinc-900 p-2 rounded text-xs">
                    <div className="font-medium">{m.machine}</div>
                    <div>{m.shards} shards ({m.percent}%)</div>
                    <div className="text-zinc-500">{m.bucket}</div>
                  </div>
                ))}
              </div>
              <Button size="sm" onClick={handleShardDemo} className="w-full">Demo: Resolve Image Location</Button>
              {shardDemo && (
                <div className="bg-zinc-100 dark:bg-zinc-900 p-3 rounded text-xs font-mono space-y-1">
                  <div>imageId: {shardDemo.imageId}</div>
                  <div>logicalShard: {shardDemo.shard}</div>
                  <div>machine: {shardDemo.machine}</div>
                  <div>path: {shardDemo.path}</div>
                </div>
              )}
            </CardContent>
          </Card>
        </div>

        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              Distributed IDs <Badge>64-bit: 41-13-10</Badge>
            </CardTitle>
             <div class="text-xs text-zinc-500">next_id with timestamp + shard + counter, sortable, no clash</div>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="grid md:grid-cols-3 gap-4 text-sm">
              <div className="bg-zinc-100 dark:bg-zinc-900 p-3 rounded">
                <div className="font-bold">41 bits timestamp</div>
                <div className="text-xs text-zinc-500">ms since 2024-01-01, ~69 years range</div>
                <div className="mt-2 font-mono text-xs">TS &lt;&lt; 23</div>
              </div>
              <div className="bg-zinc-100 dark:bg-zinc-900 p-3 rounded">
                <div className="font-bold">13 bits shard</div>
                <div className="text-xs text-zinc-500">8192 shards, aligns with image sharding</div>
                <div className="mt-2 font-mono text-xs">SHARD &lt;&lt; 10</div>
              </div>
              <div className="bg-zinc-100 dark:bg-zinc-900 p-3 rounded">
                <div className="font-bold">10 bits counter</div>
                <div className="text-xs text-zinc-500">1024 IDs/ms/shard, 1M/sec/shard</div>
                <div className="mt-2 font-mono text-xs">COUNTER (0..1023)</div>
              </div>
            </div>
            <div className="flex gap-2">
              <Button size="sm" onClick={handleGenerateIds}>Generate 5 IDs</Button>
              <span className="text-xs text-zinc-500 self-center">Sortable, no coordination, no clash</span>
            </div>
            {ids.length > 0 && (
              <div className="bg-zinc-100 dark:bg-zinc-900 p-3 rounded text-xs font-mono space-y-1">
                {ids.map((id) => {
                  const big = BigInt(id);
                  const counter = Number(big & 1023n);
                  const shard = Number((big >> 10n) & 8191n);
                  const ts = Number(big >> 23n);
                  const date = new Date(ts + Date.UTC(2024, 0, 1));
                  return (
                    <div key={id} className="flex justify-between">
                      <span>{id}</span>
                      <span className="text-zinc-500">shard={shard} counter={counter} {date.toISOString().slice(11, 23)}</span>
                    </div>
                  );
                })}
              </div>
            )}
            <div className="text-xs text-zinc-500">
              Server: <code>nextId(shardId)</code> · <code>parseId(id)</code> · <code>sortIds(ids)</code> · Env: <code>ID_SHARD_ID</code>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Data Flow</CardTitle>
          </CardHeader>
          <CardContent className="text-sm font-mono bg-zinc-950 text-zinc-100 p-4 rounded overflow-auto">
            <div>User uploads image + creates row</div>
            <div>  -&gt; nextId(shard) generates sortable ID (no clash)</div>
            <div>  -&gt; resolveImageLocation(id) finds machine via logical shard</div>
            <div>  -&gt; Store image on that machine (S3 bucket / disk)</div>
            <div>  -&gt; Write metadata to primary via PgBouncer pool</div>
            <div>  -&gt; Invalidate memcached for affected boards</div>
            <div>  -&gt; Subsequent reads:</div>
            <div>       - Check memcached (hit? return)</div>
            <div>       - Else query replica (round-robin)</div>
            <div>       - Populate cache (60-120s TTL)</div>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
