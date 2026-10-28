import assert from "node:assert/strict";
import { test } from "node:test";
import {
  PREVIEW_HANDOFF_TTL_MS,
  consumePreviewHandoff,
  createPreviewHandoff,
} from "./preview-handoff.server.ts";

test("preview handoffs are single-use", () => {
  const code = createPreviewHandoff("opaque-session-cookie", 1_000);
  assert.match(code, /^[A-Za-z0-9_-]{40,}$/);
  assert.equal(consumePreviewHandoff(code, 1_001), "opaque-session-cookie");
  assert.equal(consumePreviewHandoff(code, 1_002), null);
});

test("preview handoffs expire before they can be consumed", () => {
  const code = createPreviewHandoff("opaque-session-cookie", 2_000);
  assert.equal(consumePreviewHandoff(code, 2_000 + PREVIEW_HANDOFF_TTL_MS), null);
});

test("invalid preview handoffs do not reveal or consume anything", () => {
  assert.equal(consumePreviewHandoff(""), null);
  assert.equal(consumePreviewHandoff("not-a-real-handoff"), null);
  assert.throws(() => createPreviewHandoff(""), /empty auth handoff/);
});
