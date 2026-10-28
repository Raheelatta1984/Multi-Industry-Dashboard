import { createAuthClient } from "better-auth/react";
import { runPreSignInSignOut, runSignOut } from "../../../scripts/sign-out-plan.mjs";
import { GROK_PROVIDERS } from "./providers";

/**
 * Better Auth client for this React SPA (browser-side).
 *
 * Talks to this app's OWN Better Auth at same-origin `/api/auth/*`. Both the
 * deployed path and live-preview handoff use the server-managed HttpOnly cookie;
 * browser JavaScript never stores or attaches a reusable session bearer.
 *
 * To sign out call `signOut()` below so the server confirms that the HttpOnly
 * cookie was invalidated before the UI redirects.
 */
export const authClient = createAuthClient();

/**
 * True when sign-in UI should be shown — i.e. whenever `VITE_AUTH_ENABLED` is
 * not `"false"`. The shipped template sets it to `"false"`
 * (`.grok/app-env.json`), which selects the dev user (see `use-current-user`);
 * with the key removed, sign-in is real when the runtime injects the preview or
 * deployed client credentials.
 */
export const authEnabled = import.meta.env.VITE_AUTH_ENABLED !== "false";

/** The upstream providers to render sign-in buttons for. */
export { GROK_PROVIDERS };

// The old live-preview implementation persisted a reusable bearer in
// sessionStorage. Remove that legacy value once per page load; the current flow
// never reads from or writes credentials to browser storage.
const LEGACY_BEARER_KEY = "grok-auth.bearer-token";

function purgeLegacyBearer(): void {
  if (typeof window === "undefined") return;
  try {
    window.sessionStorage.removeItem(LEGACY_BEARER_KEY);
  } catch {
    /* storage unavailable — ignore */
  }
}

purgeLegacyBearer();

/**
 * The sandbox live preview runs this app inside an iframe on a `*.grok-sandbox.com`
 * host, where a full-page redirect to the broker can't work — so sign-in uses a
 * popup there and a normal redirect everywhere else.
 */
function inLivePreview(): boolean {
  return (
    typeof window !== "undefined" &&
    window.location.hostname.endsWith(".grok-sandbox.com")
  );
}

/** Message the popup posts back to the opener once sign-in completes. */
type PopupMessage = {
  source: "grok-auth-popup";
  handoffCode: string | null;
  error?: string;
};

/**
 * Start sign-in with one upstream provider (`providerId` from `GROK_PROVIDERS`),
 * federating through the Grok auth broker.
 *
 * - **Live preview** (`*.grok-sandbox.com` iframe): opens a POPUP to
 *   `/auth/popup`, served by the template Vite plugin (see `vite.config.ts` +
 *   `popup.server.ts`) — 302s to the broker/upstream login (no app chrome) and,
 *   on return, posts a one-time handoff code back. The opener exchanges it for
 *   an HttpOnly session cookie; no top-level navigation of the iframe to the
 *   broker.
 * - **Deployed** (and local non-iframe): a normal full-page redirect into the broker.
 *
 * Either way it clears any existing local session FIRST so switching providers
 * actually switches identity.
 */
export async function signIn(
  providerId: string,
  opts: { callbackURL?: string; errorCallbackURL?: string } = {},
): Promise<void> {
  const callbackURL = opts.callbackURL ?? "/";
  const errorCallbackURL = opts.errorCallbackURL ?? "/";

  // Open the popup SYNCHRONOUSLY on the user gesture — before any await
  // (including signOut). Awaiting first drops user-gesture privilege in some
  // browsers when the opener is a cross-origin live-preview iframe.
  const popup = inLivePreview() ? openSignInPopup(providerId) : null;

  // Clear any prior session so switching providers actually switches identity.
  // The cookie-auth path waits for server confirmation before starting OAuth;
  // the popup is already open, but a failed/timeout response must not leave an
  // old session riding into the new provider flow.
  await runPreSignInSignOut({
    livePreview: inLivePreview(),
    cookieAuth: true,
    hasBearer: false,
    requestSignOut: () => authClient.signOut(),
    clearToken: () => {},
  });

  if (inLivePreview()) {
    if (!popup) throw new Error("Pop-up blocked — allow pop-ups for sign-in");
    const handoffCode = await waitForPopupHandoff(popup);
    if (!handoffCode || !(await exchangePreviewHandoff(handoffCode))) {
      throw new Error("Sign-in was cancelled or failed");
    }
    // Refresh the client session store after the same-origin exchange sets the
    // HttpOnly cookie. Avoid a full iframe reload when we are already on the
    // destination — that reload was the slow "still loading" feeling.
    try {
      await authClient.getSession();
    } catch {
      /* session store will recover on next useSession fetch */
    }
    if (typeof window !== "undefined") {
      const dest = new URL(callbackURL, window.location.origin);
      const here = window.location;
      if (dest.origin !== here.origin || dest.pathname !== here.pathname || dest.search !== here.search) {
        window.location.href = callbackURL;
      }
    }
    return;
  }

  const { data, error } = await authClient.signIn.social({
    provider: providerId,
    callbackURL,
    errorCallbackURL,
  });
  if (error) throw new Error(error.message ?? "Sign-in failed");
  if (data?.url) window.location.href = data.url;
}

/**
 * Open `/auth/popup` in a new window. Must run synchronously inside the click
 * handler (no await before this). The path is served by the template Vite
 * plugin (`authPopupPlugin` in vite.config.ts) — NOT by a React route.
 *
 * Opens the real URL directly (not about:blank → assign). From a cross-origin
 * iframe the about:blank dance often fails on the first click and the window
 * ends up showing the app shell.
 */
function openSignInPopup(providerId: string): Window | null {
  const origin = window.location.origin;
  const url = `${origin}/auth/popup?providerId=${encodeURIComponent(providerId)}`;
  // Unique name per attempt so a prior attempt stuck on the SPA is not reused.
  const name = `grok-signin-${Date.now()}`;
  return window.open(url, name, "popup,width=500,height=650");
}

/**
 * Wait for the popup to post a one-time handoff code (or for the user to
 * dismiss the popup). The reusable session value never crosses this boundary.
 */
function waitForPopupHandoff(popup: Window): Promise<string | null> {
  return new Promise((resolve) => {
    const origin = window.location.origin;
    let settled = false;
    let closeTimer: number | undefined;
    const settle = (handoffCode: string | null) => {
      if (settled) return;
      settled = true;
      cleanup();
      resolve(handoffCode);
    };
    const onMessage = (event: MessageEvent) => {
      if (event.origin !== origin || event.source !== popup) return;
      const data = event.data as PopupMessage | undefined;
      if (!data || data.source !== "grok-auth-popup") return;
      settle(typeof data.handoffCode === "string" ? data.handoffCode : null);
    };
    // Fallback when the user dismisses the popup. Grace period lets the
    // completion page's postMessage win over a racing `popup.closed`.
    const pollTimer = window.setInterval(() => {
      if (!popup.closed) return;
      window.clearInterval(pollTimer);
      closeTimer = window.setTimeout(() => settle(null), 400);
    }, 300);
    function cleanup() {
      window.clearInterval(pollTimer);
      if (closeTimer !== undefined) window.clearTimeout(closeTimer);
      window.removeEventListener("message", onMessage);
    }
    window.addEventListener("message", onMessage);
  });
}

/** Exchange the short-lived code in the opener's same-origin cookie context. */
async function exchangePreviewHandoff(handoffCode: string): Promise<boolean> {
  try {
    const response = await fetch("/auth/popup/exchange", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ handoffCode }),
    });
    return response.ok;
  } catch {
    return false;
  }
}

/**
 * Sign out of THIS app's local session, then redirect.
 *
 * Use this, never `authClient.signOut()` — sequencing lives in
 * `scripts/sign-out-plan.mjs` so it can be unit-tested. The server must confirm
 * the HttpOnly cookie was invalidated; a failed or timed-out response does not
 * redirect and claim that the visitor is signed out.
 */
export async function signOut(redirectTo = "/"): Promise<void> {
  await runSignOut({
    livePreview: inLivePreview(),
    cookieAuth: true,
    hasBearer: false,
    // Better Auth resolves with `{ error }` instead of rejecting, so surface a
    // failed response as a rejection for the sequence to act on.
    requestSignOut: async () => {
      const { error } = await authClient.signOut();
      if (error) throw new Error(error.message ?? "Sign-out failed");
    },
    clearToken: () => {},
    redirect: () => {
      window.location.href = redirectTo;
    },
  });
}
