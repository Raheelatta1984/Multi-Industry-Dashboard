// @ts-check
/**
 * The sign-out sequence used by `src/lib/auth/client.ts`, kept here as a pure
 * module so its effects can be unit-tested (`node --test` only covers
 * `scripts/`), the same split `migration-plan.mjs` uses for the two appliers.
 *
 * Both current browser environments authenticate with an HttpOnly
 * `__Host-` cookie that JavaScript cannot delete. ONLY a completed sign-out
 * response clears it, and `server.ts` enables `session.cookieCache` (maxAge
 * 300), so `/get-session` would keep answering from the cached cookie for
 * minutes afterwards. The legacy bearer path remains represented by the
 * optional `cookieAuth: false` behavior below only for non-browser callers/tests;
 * the browser passes `cookieAuth: true`.
 * Redirecting on a timeout would show the visitor "signed out" while their
 * session is still live — so here we fail loudly instead of pretending.
 */

/**
 * Legacy bearer preview callers use an aggressive bound because their local
 * clear is the final fallback. Cookie-auth preview callers use the deployed
 * bound so the server has time to invalidate the HttpOnly session.
 */
export const PREVIEW_SIGN_OUT_TIMEOUT_MS = 1500;

/**
 * Deployed: generous, because only the server can end this session — but still
 * bounded, so a wedged request reports failure the visitor can retry instead of
 * spinning forever. A sign-out still unanswered at 10s is not going to land.
 */
export const DEPLOYED_SIGN_OUT_TIMEOUT_MS = 10_000;

/**
 * How long to wait for a sign-out in this environment. Every sign-out network
 * call picks its bound here, so the preview/deployed split cannot drift apart
 * between callers.
 * @param {boolean} livePreview
 * @returns {number}
 */
export function signOutTimeoutMs(livePreview) {
  return livePreview ? PREVIEW_SIGN_OUT_TIMEOUT_MS : DEPLOYED_SIGN_OUT_TIMEOUT_MS;
}

/**
 * Run `start()` but give up after `timeoutMs`, reporting which happened. Never
 * rejects — callers decide what a failure means, and a `try/catch` around an
 * `await` does nothing for a promise that never settles.
 * @param {() => unknown} start
 * @param {number} timeoutMs
 * @returns {Promise<"ok" | "failed" | "timeout">}
 */
export function settleWithin(start, timeoutMs) {
  return new Promise((resolve) => {
    const timer = setTimeout(() => resolve("timeout"), timeoutMs);
    /** @param {"ok" | "failed"} outcome */
    const done = (outcome) => {
      clearTimeout(timer);
      resolve(outcome);
    };
    try {
      Promise.resolve(start()).then(
        () => done("ok"),
        () => done("failed"),
      );
    } catch {
      done("failed");
    }
  });
}

/**
 * @typedef {object} SignOutSteps
 * @property {boolean} livePreview Whether the app is the sandbox preview iframe.
 * @property {boolean} [cookieAuth] Whether the browser session is an HttpOnly cookie.
 * @property {boolean} hasBearer Whether a legacy preview bearer token is stored.
 * @property {() => unknown} requestSignOut Ask the server to end the session; must reject on a failed response.
 * @property {() => void} clearToken Drop the stored bearer token.
 * @property {() => void} redirect Leave the page.
 * @property {number} [timeoutMs]
 */

/**
 * End the session, then clear the local token and redirect.
 *
 * Legacy bearer preview callers may clear their local bearer after a
 * best-effort request. Current cookie-auth callers, including live preview,
 * clear/redirect only after the server confirms, because nothing else can clear
 * the HttpOnly cookie.
 * @param {SignOutSteps} steps
 * @returns {Promise<void>}
 */
export async function runSignOut({
  livePreview,
  cookieAuth = false,
  hasBearer,
  requestSignOut,
  clearToken,
  redirect,
  timeoutMs,
}) {
  if (livePreview && !cookieAuth) {
    // Legacy non-cookie preview callers may clear their own in-memory bearer
    // after a best-effort server invalidation.
    if (hasBearer) {
      await settleWithin(requestSignOut, timeoutMs ?? signOutTimeoutMs(livePreview));
    }
    clearToken();
    redirect();
    return;
  }

  const outcome = await settleWithin(
    requestSignOut,
    timeoutMs ?? signOutTimeoutMs(livePreview && !cookieAuth),
  );
  if (outcome !== "ok") {
    throw new Error(
      outcome === "timeout"
        ? "Sign-out timed out — you are still signed in. Please try again."
        : "Sign-out failed — you are still signed in. Please try again.",
    );
  }
  clearToken();
  redirect();
}

/**
 * @typedef {object} PreSignInSteps
 * @property {boolean} livePreview Whether the app is the sandbox preview iframe.
 * @property {boolean} [cookieAuth] Whether the browser session is an HttpOnly cookie.
 * @property {boolean} hasBearer Whether a legacy preview bearer token is stored.
 * @property {() => unknown} requestSignOut Ask the server to end any prior session.
 * @property {() => void} clearToken Drop the stored bearer token.
 * @property {number} [timeoutMs]
 */

/**
 * Drop any prior session before a new sign-in starts, so switching providers
 * actually switches identity.
 *
 * Deliberately BEST EFFORT — unlike `runSignOut` this never throws. It also
 * runs when there is no prior session at all, so treating a failure as fatal
 * would block first-time sign-in on a transport hiccup, for a visitor with no
 * session to protect. The subsequent OAuth flow issues a fresh session either
 * way. Only the wait is bounded, and by the same per-environment rule as
 * `runSignOut`: a deployed session dies server-side, so it gets the full
 * window rather than the preview's aggressive one.
 * @param {PreSignInSteps} steps
 * @returns {Promise<void>}
 */
export async function runPreSignInSignOut({
  livePreview,
  cookieAuth = false,
  hasBearer,
  requestSignOut,
  clearToken,
  timeoutMs,
}) {
  // Cookie-auth browsers must always ask the server to clear the prior session;
  // legacy bearer callers may skip the request when no bearer exists.
  if (cookieAuth || hasBearer || !livePreview) {
    const outcome = await settleWithin(
      requestSignOut,
      timeoutMs ?? signOutTimeoutMs(livePreview && !cookieAuth),
    );
    if (cookieAuth && outcome !== "ok") {
      throw new Error(
        outcome === "timeout"
          ? "Previous sign-in timed out — please try again."
          : "Previous sign-in could not be cleared — please try again.",
      );
    }
  }
  clearToken();
}
