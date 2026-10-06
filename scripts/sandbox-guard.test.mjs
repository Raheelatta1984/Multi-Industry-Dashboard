import test from "node:test";
import assert from "node:assert/strict";
import { fastVerdict, planRecovery, SCAFFOLD_COMMIT } from "./sandbox-guard.mjs";

test("fastVerdict: healthy when marker matches HEAD and deps present", () => {
  assert.equal(
    fastVerdict({ head: "abc123", marker: { lastGoodCommit: "abc123" }, nodeModulesOk: true }),
    "healthy",
  );
});

test("fastVerdict: verify when HEAD rolled back to the scaffold commit", () => {
  // The recycle signature: marker remembers the pushed commit, HEAD is the scaffold.
  assert.equal(
    fastVerdict({ head: SCAFFOLD_COMMIT, marker: { lastGoodCommit: "d08a90e" }, nodeModulesOk: false }),
    "verify",
  );
});

test("fastVerdict: verify when node_modules is missing even if HEAD matches", () => {
  assert.equal(fastVerdict({ head: "abc", marker: { lastGoodCommit: "abc" }, nodeModulesOk: false }), "verify");
});

test("fastVerdict: verify when no marker exists (first run)", () => {
  assert.equal(fastVerdict({ head: "abc", marker: null, nodeModulesOk: true }), "verify");
});

test("fastVerdict: verify when HEAD is unknown", () => {
  assert.equal(fastVerdict({ head: null, marker: { lastGoodCommit: "abc" }, nodeModulesOk: true }), "verify");
});

test("planRecovery: none when HEAD equals target", () => {
  assert.equal(planRecovery({ head: "a", target: "a" }).action, "none");
});

test("planRecovery: reset when HEAD is an ancestor of target (rolled-back pointer)", () => {
  const plan = planRecovery({
    head: SCAFFOLD_COMMIT,
    target: "d08a90e",
    targetDescendsFromHead: true,
    headDescendsFromTarget: false,
  });
  assert.equal(plan.action, "reset");
});

test("planRecovery: ahead when target is an ancestor of HEAD (unpushed local commits)", () => {
  const plan = planRecovery({
    head: "local1",
    target: "origin1",
    targetDescendsFromHead: false,
    headDescendsFromTarget: true,
  });
  assert.equal(plan.action, "ahead");
});

test("planRecovery: diverged when neither is an ancestor — never auto-reset", () => {
  const plan = planRecovery({
    head: "x",
    target: "y",
    targetDescendsFromHead: false,
    headDescendsFromTarget: false,
  });
  assert.equal(plan.action, "diverged");
});

test("planRecovery: unknown without a target", () => {
  assert.equal(planRecovery({ head: "x", target: null }).action, "unknown");
  assert.equal(planRecovery({ head: null, target: "y" }).action, "unknown");
});
