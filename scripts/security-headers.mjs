// Central, dependency-free response policy shared by Vite dev and Nitro.
// Keep the enforced CSP deliberately small until every inline framework/platform
// script has a nonce or hash. The full policy remains report-only in auto mode.

const ENFORCED_CSP = [
  "object-src 'none'",
  "base-uri 'none'",
  "frame-ancestors 'none'",
  "form-action 'self'",
].join("; ");

const REPORT_ONLY_CSP_DIRECTIVES = [
  "default-src 'self'",
  "script-src 'self' https://grok.com",
  "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com",
  "img-src 'self' data: blob:",
  "font-src 'self' https://fonts.gstatic.com",
  "connect-src 'self' https://auth.grok.me https://gate.grok.me https://gate.app-builder-testing.com https://connectors.grok.me https://connectors.app-builder-testing.com",
  "frame-src 'self'",
  "worker-src 'self' blob:",
  "object-src 'none'",
  "base-uri 'none'",
  "frame-ancestors 'none'",
  "form-action 'self'",
];

/** @param {unknown} host */
function normalizedHost(host) {
  return String(host ?? "")
    .trim()
    .toLowerCase()
    .replace(/^\[/, "")
    .replace(/\](:\d+)?$/, "")
    .split(":", 1)[0];
}

/** @param {unknown} host */
function isLoopbackHost(host) {
  const normalized = normalizedHost(host);
  return normalized === "localhost" || normalized === "127.0.0.1" || normalized === "::1";
}

/**
 * Whether the request arrived over HTTPS, including a reverse-proxy hint.
 * HSTS is intentionally omitted for loopback/plain-HTTP development.
 */
export function isSecureTransport({ protocol = "http:", forwardedProto = "", host = "" } = {}) {
  const effective = String(forwardedProto || protocol || "")
    .split(",", 1)[0]
    .trim()
    .replace(/:$/, "")
    .toLowerCase();
  return effective === "https" && !isLoopbackHost(host);
}

/**
 * Headers for every HTML/API response. The report-only policy deliberately
 * enumerates the platform extension and Google font origins used by the app.
 */
/** @returns {Record<string, string>} */
export function securityHeaders(options = {}) {
  const secure = isSecureTransport(options);
  const reportOnly = [...REPORT_ONLY_CSP_DIRECTIVES];
  if (secure) reportOnly.push("upgrade-insecure-requests");

  /** @type {Record<string, string>} */
  const headers = {
    "Content-Security-Policy": ENFORCED_CSP,
    "Content-Security-Policy-Report-Only": reportOnly.join("; "),
    "X-Content-Type-Options": "nosniff",
    "Referrer-Policy": "strict-origin-when-cross-origin",
    // The application has no supported cross-origin framing requirement. The
    // preview bridge is a postMessage bridge, not an authorization boundary.
    "X-Frame-Options": "DENY",
    "Permissions-Policy": "camera=(), microphone=(), geolocation=(), payment=()",
  };
  if (secure) headers["Strict-Transport-Security"] = "max-age=31536000; includeSubDomains";
  return headers;
}

/** Responses containing sessions, RPC/API data, or generated exports are not cacheable. */
export function shouldNoStore(pathname = "") {
  const path = String(pathname || "");
  return (
    /^\/(?:api|_serverFn)(?:\/|$)/i.test(path) ||
    /^\/auth\/popup(?:\/|$)/i.test(path) ||
    /(?:^|\/)(?:export|download)(?:\/|$|\.[^/]+$)/i.test(path) ||
    /\.(?:csv|xlsx|xls|pdf|zip)$/i.test(path)
  );
}

/** Apply the policy to a Fetch API Headers object and return it. */
/** @param {Headers} headers */
export function applySecurityHeaders(headers, options = {}) {
  for (const [name, value] of Object.entries(securityHeaders(options))) {
    headers.set(name, value);
  }
  return headers;
}

export { ENFORCED_CSP, REPORT_ONLY_CSP_DIRECTIVES };
