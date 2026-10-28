/**
 * Live-preview sign-in popup — server-only (NEVER import from the client).
 *
 * The sandbox preview runs the app in a partitioned iframe, so OAuth must happen
 * in a top-level popup (first-party cookies). This handler is the ENTIRE popup
 * document — no React shell:
 *
 *   Phase 1 (`?providerId=…`): start OAuth server-side and 302 straight to the
 *     broker / upstream login page. The popup never paints the app.
 *   Phase 2 (`?done=1`): exchange the popup's session cookie for a short-lived,
 *     single-use handoff code. The code is posted to the opener; the reusable
 *     session value stays server-side and is set only as an HttpOnly cookie by
 *     `/auth/popup/exchange`.
 *
 * Wired automatically by the Vite `authPopupPlugin` in `vite.config.ts` during
 * `npm run dev` (live preview). Do NOT create `src/routes/auth/popup.tsx` — a
 * React route here paints the full app shell in the popup. The opener lives in
 * `client.ts` (`signIn` → `openSignInPopup`).
 */
import {
  SESSION_DATA_COOKIE,
  SESSION_MAX_AGE_SECONDS,
  SESSION_TOKEN_COOKIE,
  auth,
} from "./server";
import {
  consumePreviewHandoff,
  createPreviewHandoff,
} from "./preview-handoff.server";

type PopupMessage = {
  source: "grok-auth-popup";
  handoffCode: string | null;
  error?: string;
};

/**
 * Handle `GET /auth/popup`. Invoked by the Vite `authPopupPlugin` (dev / live
 * preview). Do not re-export this from a React route file.
 */
export async function handleAuthPopupRequest(request: Request): Promise<Response> {
  const url = new URL(request.url);
  const done = url.searchParams.get("done") === "1";

  if (done) {
    const errored = url.searchParams.has("error");
    const sessionCookie = errored ? null : readCookie(request, SESSION_TOKEN_COOKIE);
    const handoffCode = sessionCookie ? createPreviewHandoff(sessionCookie) : null;
    const message: PopupMessage = {
      source: "grok-auth-popup",
      handoffCode,
      ...(!handoffCode ? { error: "sign_in_failed" } : {}),
    };
    return new Response(completionHtml(message), {
      status: 200,
      headers: {
        "content-type": "text/html; charset=utf-8",
        // Never cache a page containing even a one-time handoff capability.
        "cache-control": "no-store",
      },
    });
  }

  const providerId = url.searchParams.get("providerId")?.trim();
  if (!providerId) {
    return new Response("Missing providerId", {
      status: 400,
      headers: { "content-type": "text/plain; charset=utf-8" },
    });
  }

  // Stay first-party for the callback so the session cookie lands in THIS popup.
  const back = `${url.origin}/auth/popup?done=1`;
  try {
    const apiRes = await auth.api.signInSocial({
      body: {
        provider: providerId,
        callbackURL: back,
        errorCallbackURL: `${back}&error=1`,
      },
      // Forward the preview host so Better Auth derives the correct baseURL /
      // redirect_uri for the dynamic `*.grok-sandbox.com` origin.
      headers: request.headers,
      asResponse: true,
    });

    if (!apiRes.ok) {
      return completionResponse({
        source: "grok-auth-popup",
        handoffCode: null,
        error: "oauth_init_failed",
      });
    }

    const body = (await apiRes.json().catch(() => null)) as {
      url?: string;
    } | null;
    const location = body?.url;
    if (!location) {
      return completionResponse({
        source: "grok-auth-popup",
        handoffCode: null,
        error: "oauth_init_missing_url",
      });
    }

    // 302 to the broker (which headlessly forwards to Google/X). Forward any
    // Set-Cookie (OAuth state / PKCE) so the callback can complete in this popup.
    const headers = new Headers({ location, "cache-control": "no-store" });
    for (const cookie of apiRes.headers.getSetCookie()) {
      headers.append("set-cookie", cookie);
    }
    return new Response(null, { status: 302, headers });
  } catch {
    return completionResponse({
      source: "grok-auth-popup",
      handoffCode: null,
      error: "oauth_init_failed",
    });
  }
}

/**
 * Exchange the popup-only handoff code in the opener's same-origin context.
 * The request must carry a matching Origin or Referer, and the code is consumed
 * before a Set-Cookie is returned, so a replay cannot re-authenticate a browser.
 */
export async function handlePreviewHandoffExchange(request: Request): Promise<Response> {
  const url = new URL(request.url);
  if (request.method !== "POST") {
    return new Response("Method Not Allowed", { status: 405 });
  }
  if (!sameOriginMutation(request, url)) {
    return new Response("Forbidden", {
      status: 403,
      headers: { "cache-control": "no-store" },
    });
  }

  const contentType = request.headers.get("content-type") ?? "";
  if (!contentType.toLowerCase().startsWith("application/json")) {
    return new Response("Unsupported Media Type", { status: 415 });
  }
  const raw = await request.text();
  if (raw.length > 2048) {
    return new Response("Request Entity Too Large", { status: 413 });
  }

  let body: unknown;
  try {
    body = JSON.parse(raw);
  } catch {
    return new Response("Bad Request", { status: 400 });
  }
  const code =
    body && typeof body === "object" && "handoffCode" in body
      ? (body as { handoffCode?: unknown }).handoffCode
      : null;
  if (typeof code !== "string" || code.length > 256) {
    return new Response("Bad Request", { status: 400 });
  }

  const sessionCookie = consumePreviewHandoff(code);
  if (!sessionCookie) {
    return new Response("Handoff expired", {
      status: 401,
      headers: { "cache-control": "no-store" },
    });
  }

  const headers = new Headers({ "cache-control": "no-store" });
  headers.append("set-cookie", sessionCookieHeader(sessionCookie));
  // Do not let a prior iframe cache answer as the newly signed-in user.
  headers.append("set-cookie", expiredCookieHeader(SESSION_DATA_COOKIE));
  return new Response(null, { status: 204, headers });
}

function sameOriginMutation(request: Request, url: URL): boolean {
  const origin = request.headers.get("origin");
  if (origin) return origin === url.origin;
  const referer = request.headers.get("referer");
  if (!referer) return false;
  try {
    return new URL(referer).origin === url.origin;
  } catch {
    return false;
  }
}

function sessionCookieHeader(value: string): string {
  return [
    `${SESSION_TOKEN_COOKIE}=${encodeURIComponent(value)}`,
    `Max-Age=${SESSION_MAX_AGE_SECONDS}`,
    "Path=/",
    "HttpOnly",
    "Secure",
    "SameSite=Lax",
  ].join("; ");
}

function expiredCookieHeader(name: string): string {
  return `${name}=; Max-Age=0; Path=/; HttpOnly; Secure; SameSite=Lax`;
}

function completionResponse(message: PopupMessage): Response {
  return new Response(completionHtml(message), {
    status: 200,
    headers: {
      "content-type": "text/html; charset=utf-8",
      "cache-control": "no-store",
    },
  });
}

/** Minimal HTML: post only the one-time handoff code and close. No session token. */
function completionHtml(message: PopupMessage): string {
  // JSON is safe inside a <script type="application/json"> block; the inline
  // script only reads it. Escape `<` so a future message field cannot terminate
  // the data element and become markup.
  const payload = JSON.stringify(message).replace(/</g, "\\u003c");
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<title>Signing in…</title>
<style>
  html,body{margin:0;min-height:100%;background:#0b0b0c;color:#a1a1aa;
    font:14px/1.5 -apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,Helvetica,Arial,sans-serif}
  main{min-height:100vh;display:grid;place-items:center;padding:1.5rem;text-align:center}
</style>
</head>
<body>
<main><p>Signing you in…</p></main>
<script type="application/json" id="grok-auth-popup-msg">${payload}</script>
<script>
(function () {
  var el = document.getElementById("grok-auth-popup-msg");
  var msg = { source: "grok-auth-popup", handoffCode: null };
  try { if (el && el.textContent) msg = JSON.parse(el.textContent); } catch (e) {}
  try {
    if (window.opener) window.opener.postMessage(msg, window.location.origin);
  } catch (e) {}
  try { window.close(); } catch (e) {}
})();
</script>
</body>
</html>`;
}

/** Read a single cookie value from the request (handles `=` inside values). */
function readCookie(request: Request, name: string): string | null {
  const header = request.headers.get("cookie");
  if (!header) return null;
  for (const part of header.split(";")) {
    const trimmed = part.trim();
    if (!trimmed) continue;
    const eq = trimmed.indexOf("=");
    if (eq <= 0) continue;
    if (trimmed.slice(0, eq) !== name) continue;
    const raw = trimmed.slice(eq + 1);
    try {
      return decodeURIComponent(raw);
    } catch {
      return raw;
    }
  }
  return null;
}
