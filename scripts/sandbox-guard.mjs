#!/usr/bin/env node
/**
 * sandbox-guard — self-healing for the Arena workspace recycle.
 *
 * What it protects against
 * ------------------------
 * When the sandbox is recycled/revived, the workspace comes back with the file
 * patchset applied but the git branch pointer reset to the original scaffold
 * commit, `node_modules` wiped, and the dev server dead. This guard detects
 * that state and repairs it:
 *
 *   1. git state  — fetch origin, and if HEAD is an ancestor of the remote
 *                   branch (the rolled-back-pointer case) AND the worktree
 *                   already matches the remote commit, `git reset --hard` to
 *                   the remote HEAD — a pointer-only heal. A worktree with
 *                   real uncommitted changes is never reset (that needs
 *                   --force, which snapshots to `sandbox-rescue/*` first), and
 *                   a diverged history is never touched.
 *   2. deps       — `npm install` when node_modules is missing.
 *   3. dev server — (with --with-server) start `npm run dev` detached and wait
 *                   for :8080 to answer.
 *
 * Triggers wired around it
 * ------------------------
 *   - `startup.sh`           → platform runs it on revive (full recovery)
 *   - `~/.profile` hooks     → every login shell heals git+deps instantly
 *   - `npm run dev` (predev) → heals before Vite starts
 *   - `npm run guard`        → 15s watchdog for mid-session drift
 *
 * Usage
 * -----
 *   node scripts/sandbox-guard.mjs                      # status report
 *   node scripts/sandbox-guard.mjs --recover            # heal git + deps
 *   node scripts/sandbox-guard.mjs --recover --force    # also reset a dirty
 *                                                       # tree (rescue first)
 *   node scripts/sandbox-guard.mjs --recover --with-server
 *   node scripts/sandbox-guard.mjs --watch --interval 15 --with-server
 *
 * The fast path is deliberately cheap (one `git rev-parse` + two existsSync,
 * ~80ms) so the profile hook never notices it when everything is healthy.
 * State lives in .sandbox-guard.json (gitignored); events append to
 * .sandbox-guard.log (gitignored).
 */
import { spawnSync } from "node:child_process";
import {
  appendFileSync,
  closeSync,
  existsSync,
  openSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import net from "node:net";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

export const SCAFFOLD_COMMIT = "0185ed99e9d50b8baf0d07c35d1e9bba31c2681f";
export const DEFAULT_BRANCH = "arena/b1a1f4fb-multi-industry-dashboard";
export const SERVER_PORT = 8080;

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const MARKER_PATH = join(ROOT, ".sandbox-guard.json");
const LOG_PATH = join(ROOT, ".sandbox-guard.log");
const LOCK_PATH = "/tmp/.sandbox-guard.lock";
const DEV_LOG = "/tmp/meridian-dev.log";
const PAUSE_PATH = "/tmp/.meridian-guard-paused";
const GIT_ENV = { ...process.env, GIT_TERMINAL_PROMPT: "0" };

// ---------------------------------------------------------------------------
// Pure decision helpers (unit-tested in sandbox-guard.test.mjs)
// ---------------------------------------------------------------------------

/** Healthy without touching the network? */
export function fastVerdict({ head, marker, nodeModulesOk }) {
  if (!head) return "verify";
  if (marker?.lastGoodCommit && marker.lastGoodCommit === head && nodeModulesOk) return "healthy";
  return "verify";
}

/**
 * Decide the recovery action. Ancestors tell the whole story:
 *  - head === target                       → nothing to do
 *  - target descends from head             → remote is ahead (recycle case) → reset
 *  - head descends from target             → local is ahead (unpushed work) → keep
 *  - neither                               → diverged → never auto-reset
 */
export function planRecovery({ head, target, targetDescendsFromHead, headDescendsFromTarget }) {
  if (!head || !target) return { action: "unknown" };
  if (head === target) return { action: "none" };
  if (targetDescendsFromHead) return { action: "reset" };
  if (headDescendsFromTarget) return { action: "ahead" };
  return { action: "diverged" };
}

// ---------------------------------------------------------------------------
// Small utilities
// ---------------------------------------------------------------------------

function run(cmd, args, timeoutMs = 30_000) {
  const r = spawnSync(cmd, args, { cwd: ROOT, encoding: "utf8", timeout: timeoutMs, env: GIT_ENV });
  return { code: r.status ?? -1, out: (r.stdout ?? "").trim(), err: (r.stderr ?? "").trim() };
}

function short(sha) {
  return sha ? sha.slice(0, 7) : "???????";
}

export function readMarker() {
  try {
    return JSON.parse(readFileSync(MARKER_PATH, "utf8"));
  } catch {
    return null;
  }
}

export function writeMarker(fields) {
  const marker = { ...readMarker(), ...fields, updatedAt: Date.now() };
  try {
    writeFileSync(MARKER_PATH, `${JSON.stringify(marker, null, 2)}\n`);
  } catch {
    /* best effort */
  }
  return marker;
}

function logEvent(event, detail, quiet) {
  const line = `${new Date().toISOString()} ${event} ${detail}`;
  try {
    appendFileSync(LOG_PATH, `${line}\n`);
  } catch {
    /* best effort */
  }
  if (!quiet) console.error(`[sandbox-guard] ${line}`);
}

function nodeModulesOk() {
  return existsSync(join(ROOT, "node_modules", "vite")) && existsSync(join(ROOT, "node_modules", ".package-lock.json"));
}

function currentBranch() {
  const b = run("git", ["rev-parse", "--abbrev-ref", "HEAD"]).out;
  if (b && b !== "HEAD") return b;
  return readMarker()?.branch ?? DEFAULT_BRANCH;
}

function currentHead() {
  const r = run("git", ["rev-parse", "HEAD"]);
  return r.code === 0 ? r.out : null;
}

function portOpen(port = SERVER_PORT, timeoutMs = 1200) {
  return new Promise((resolve) => {
    const sock = net.connect({ port, host: "127.0.0.1", timeout: timeoutMs });
    sock.once("connect", () => {
      sock.destroy();
      resolve(true);
    });
    sock.once("error", () => resolve(false));
    sock.once("timeout", () => {
      sock.destroy();
      resolve(false);
    });
  });
}

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

/** Single-instance lock — stale after 20 minutes (a crashed holder). */
function acquireLock() {
  try {
    if (existsSync(LOCK_PATH)) {
      const mtimeMs = statMtime(LOCK_PATH);
      if (mtimeMs && Date.now() - mtimeMs < 20 * 60_000) return false;
      rmSync(LOCK_PATH);
    }
    const fd = openSync(LOCK_PATH, "wx");
    writeFileSync(fd, String(process.pid));
    closeSync(fd);
    return true;
  } catch {
    return false;
  }
}

function statMtime(p) {
  const r = spawnSync("stat", ["-c", "%Y", p], { encoding: "utf8" });
  const secs = Number((r.stdout ?? "").trim());
  return Number.isFinite(secs) && secs > 0 ? secs * 1000 : 0;
}

function releaseLock() {
  try {
    rmSync(LOCK_PATH);
  } catch {
    /* ignore */
  }
}

// ---------------------------------------------------------------------------
// Recovery
// ---------------------------------------------------------------------------

function rescueSnapshot(head) {
  const dirty = run("git", ["status", "--porcelain"]).out !== "";
  if (!dirty) return null;
  run("git", ["add", "-A"]);
  const tree = run("git", ["write-tree"]).out;
  if (!tree) return null;
  const stamp = new Date().toISOString().replace(/[-:]/g, "").slice(0, 15);
  const commit = run("git", ["commit-tree", tree, "-p", head, "-m", "sandbox-guard rescue snapshot before reset"]).out;
  if (!commit) return null;
  const branch = `sandbox-rescue/${stamp}`;
  run("git", ["branch", branch, commit]);
  // Best effort: push the rescue branch so it survives another recycle.
  run("git", ["push", "-q", "origin", branch], 30_000);
  return branch;
}

async function ensureServer(quiet) {
  if (existsSync(PAUSE_PATH)) {
    logEvent("server-paused", `${PAUSE_PATH} present — leaving the server down on purpose`, quiet);
    return false;
  }
  if (await portOpen()) return true;
  logEvent("server-starting", `spawning npm run dev (log: ${DEV_LOG})`, quiet);
  // Background via sh + nohup so the server is reparented and survives this
  // process (and the watchdog) exiting. The shell returns immediately.
  spawnSync("sh", ["-c", `nohup npm run dev >>${DEV_LOG} 2>&1 &`], { cwd: ROOT, timeout: 5000, env: process.env });
  for (let i = 0; i < 90; i++) {
    if (await portOpen()) {
      logEvent("server-up", `dev server answering on :${SERVER_PORT}`, quiet);
      return true;
    }
    await sleep(1000);
  }
  logEvent("server-timeout", `dev server did not answer on :${SERVER_PORT} within 90s — see ${DEV_LOG}`, quiet);
  return false;
}

export async function recover(opts = {}) {
  const { withServer = false, quiet = false, force = false } = opts;
  const branch = currentBranch();
  const head = currentHead();
  const depsOk = nodeModulesOk();
  const marker = readMarker();

  // Fast path: everything the marker knows about is consistent — done.
  if (fastVerdict({ head, marker, nodeModulesOk: depsOk }) === "healthy") {
    if (withServer) await ensureServer(quiet);
    return { ok: true, action: "healthy-fast" };
  }

  // Slow path: verify against the remote.
  const fetch = run("git", ["fetch", "--quiet", "origin"], 45_000);
  let target = run("git", ["rev-parse", "--verify", "--quiet", `refs/remotes/origin/${branch}`]).out || null;
  if (!target && marker?.lastGoodCommit) {
    // Offline fallback: the marker's commit was verified pushed previously.
    if (run("git", ["cat-file", "-e", `${marker.lastGoodCommit}^{commit}`]).code === 0) {
      target = marker.lastGoodCommit;
      logEvent("offline-target", `fetch failed (${fetch.err || "network"}); using marker ${short(target)}`, quiet);
    }
  }
  if (!target) {
    logEvent("no-target", `cannot resolve origin/${branch} and no usable marker — leaving everything untouched`, quiet);
    return { ok: false, action: "no-target" };
  }

  // is-ancestor X Y  ⇔  Y descends from X.
  const targetDescendsFromHead = head ? run("git", ["merge-base", "--is-ancestor", head, target]).code === 0 : false;
  const headDescendsFromTarget = head ? run("git", ["merge-base", "--is-ancestor", target, head]).code === 0 : false;
  const plan = planRecovery({ head, target, targetDescendsFromHead, headDescendsFromTarget });

  if (plan.action === "none" || plan.action === "ahead") {
    if (plan.action === "ahead") {
      logEvent("local-ahead", `HEAD ${short(head)} has unpushed commits over origin ${short(target)} — keeping them`, quiet);
    }
    if (!depsOk) {
      logEvent("deps-installing", "node_modules missing — running npm install", quiet);
      const install = run("npm", ["install", "--no-audit", "--no-fund"], 15 * 60_000);
      if (install.code !== 0) logEvent("deps-failed", install.err.slice(0, 300), false);
      else logEvent("deps-installed", "node_modules restored", quiet);
    }
    writeMarker({ branch, lastGoodCommit: head ?? target });
    if (withServer) await ensureServer(quiet);
    return { ok: true, action: plan.action };
  }

  if (plan.action === "reset") {
    // SAFETY: only heal the pointer when the worktree already matches the
    // target (the recycle signature: patchset == pushed commit). Real
    // uncommitted work is never discarded — that needs --force.
    const worktreeDiff = run("git", ["diff", target, "--stat"]).out;
    if (worktreeDiff && !opts.force) {
      logEvent(
        "uncommitted-work",
        `worktree differs from origin ${short(target)} — NOT auto-resetting; commit & push, or rerun with --force (snapshots to sandbox-rescue/* first)`,
        quiet,
      );
      return { ok: false, action: "uncommitted-work" };
    }
    const rescue = worktreeDiff && head ? rescueSnapshot(head) : null;
    const reset = run("git", ["reset", "--hard", target]);
    if (reset.code !== 0) {
      logEvent("reset-failed", reset.err.slice(0, 300), quiet);
      return { ok: false, action: "reset-failed" };
    }
    logEvent(
      "recovered",
      `branch pointer was rolled back (${short(head)} → ${short(target)})${rescue ? `; dirty tree snapshotted to ${rescue}` : ""}`,
      quiet,
    );
    if (!nodeModulesOk()) {
      logEvent("deps-installing", "node_modules missing — running npm install", quiet);
      const install = run("npm", ["install", "--no-audit", "--no-fund"], 15 * 60_000);
      logEvent(install.code === 0 ? "deps-installed" : "deps-failed", install.code === 0 ? "node_modules restored" : install.err.slice(0, 300), quiet);
    }
    writeMarker({ branch, lastGoodCommit: target });
    if (withServer) await ensureServer(quiet);
    return { ok: true, action: "recovered" };
  }

  // diverged — never destroy; snapshot (if asked) and instruct.
  const rescue = opts.force && head ? rescueSnapshot(head) : null;
  if (rescue) run("git", ["reset", "--mixed", head]);
  logEvent(
    "diverged",
    `HEAD ${short(head)} and origin ${short(target)} diverged — NOT resetting${rescue ? `; snapshot in ${rescue}` : ""}`,
    quiet,
  );
  return { ok: false, action: "diverged", rescue };
}

// ---------------------------------------------------------------------------
// Status / watch / CLI
// ---------------------------------------------------------------------------

export async function status() {
  const branch = currentBranch();
  const head = currentHead();
  const marker = readMarker();
  const origin = run("git", ["rev-parse", "--verify", "--quiet", `refs/remotes/origin/${branch}`]).out || null;
  const depsOk = nodeModulesOk();
  const server = await portOpen();
  const verdict = fastVerdict({ head, marker, nodeModulesOk: depsOk });
  return {
    branch,
    head,
    originRef: origin,
    marker: marker?.lastGoodCommit ?? null,
    markerAgeMs: marker?.updatedAt ? Date.now() - marker.updatedAt : null,
    nodeModules: depsOk ? "present" : "missing",
    devServer: server ? `up on :${SERVER_PORT}` : "down",
    verdict: verdict === "healthy" ? "healthy" : "needs-verify (run --recover)",
  };
}

async function watch(opts) {
  const interval = opts.interval ?? 15;
  logEvent("watch-start", `polling every ${interval}s (with-server: ${opts.withServer})`, false);
  let busy = false;
  for (;;) {
    if (!busy) {
      busy = true;
      try {
        if (!acquireLock()) {
          // Another guard instance is mid-recovery; leave it to them.
        } else {
          try {
            await recover(opts);
          } finally {
            releaseLock();
          }
        }
      } catch (err) {
        logEvent("watch-error", String(err).slice(0, 200), false);
      } finally {
        busy = false;
      }
    }
    await sleep(interval * 1000);
  }
}

function parseArgs(argv) {
  const opts = { recover: false, watch: false, withServer: false, quiet: false, status: false, force: false, interval: 15 };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--recover") opts.recover = true;
    else if (a === "--force") opts.force = true;
    else if (a === "--watch") opts.watch = true;
    else if (a === "--with-server") opts.withServer = true;
    else if (a === "--quiet" || a === "-q") opts.quiet = true;
    else if (a === "--status" || a === "--check") opts.status = true;
    else if (a === "--interval") opts.interval = Number(argv[++i]) || 15;
  }
  return opts;
}

async function main() {
  const opts = parseArgs(process.argv.slice(2));
  if (opts.watch) {
    await watch(opts);
    return;
  }
  if (opts.recover) {
    if (!acquireLock()) {
      if (!opts.quiet) console.error("[sandbox-guard] another instance is already recovering");
      process.exit(0);
    }
    let result;
    try {
      result = await recover(opts);
    } finally {
      releaseLock();
    }
    process.exit(result.ok ? 0 : result.action === "diverged" ? 2 : 3);
  }
  const s = await status();
  console.log("sandbox-guard status");
  for (const [k, v] of Object.entries(s)) console.log(`  ${k.padEnd(12)}: ${v}`);
}

if (process.argv[1] && process.argv[1].endsWith("sandbox-guard.mjs")) {
  void main();
}
