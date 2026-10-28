import { randomBytes } from "node:crypto";

/** The handoff is only needed for the dev/live-preview popup flow. */
export const PREVIEW_HANDOFF_TTL_MS = 60_000;

type PendingHandoff = {
  sessionCookie: string;
  expiresAt: number;
};

// The preview and its popup share one Vite process. The reusable session token
// never leaves this map; the browser receives only a single-use random code.
const pending = new Map<string, PendingHandoff>();

function purgeExpired(now: number): void {
  for (const [code, handoff] of pending) {
    if (handoff.expiresAt <= now) pending.delete(code);
  }
}

export function createPreviewHandoff(sessionCookie: string, now = Date.now()): string {
  if (!sessionCookie) throw new Error("cannot create an empty auth handoff");
  purgeExpired(now);
  const code = randomBytes(32).toString("base64url");
  pending.set(code, {
    sessionCookie,
    expiresAt: now + PREVIEW_HANDOFF_TTL_MS,
  });
  return code;
}

/** Consume atomically: a code can never be exchanged twice. */
export function consumePreviewHandoff(code: string, now = Date.now()): string | null {
  purgeExpired(now);
  const normalized = code.trim();
  if (!normalized) return null;
  const handoff = pending.get(normalized);
  if (!handoff) return null;
  pending.delete(normalized);
  return handoff.expiresAt > now ? handoff.sessionCookie : null;
}
