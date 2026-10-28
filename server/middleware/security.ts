import { applySecurityHeaders, shouldNoStore } from "../../scripts/security-headers.mjs";

interface SecurityEvent {
  url: URL;
  req: { headers: Headers };
}

/** Apply the same headers to deployed Nitro responses as Vite uses in dev. */
export default async function securityMiddleware(
  event: SecurityEvent,
  next: () => unknown | Promise<unknown>,
): Promise<unknown> {
  const result = await next();
  if (!(result instanceof Response)) return result;

  const forwardedProto = event.req.headers.get("x-forwarded-proto") ?? "";
  const host =
    event.req.headers.get("x-forwarded-host") ?? event.req.headers.get("host") ?? event.url.host;
  const headers = new Headers(result.headers);
  applySecurityHeaders(headers, {
    protocol: event.url.protocol,
    forwardedProto,
    host,
  });
  if (shouldNoStore(event.url.pathname)) headers.set("Cache-Control", "no-store");

  return new Response(result.body, {
    status: result.status,
    statusText: result.statusText,
    headers,
  });
}
