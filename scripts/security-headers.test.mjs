import assert from "node:assert/strict";
import { test } from "node:test";
import {
  applySecurityHeaders,
  securityHeaders,
  shouldNoStore,
} from "./security-headers.mjs";

test("security policy includes the required non-CSP headers", () => {
  const headers = securityHeaders({ protocol: "http:", host: "localhost:8080" });
  assert.equal(headers["X-Content-Type-Options"], "nosniff");
  assert.equal(headers["Referrer-Policy"], "strict-origin-when-cross-origin");
  assert.equal(headers["X-Frame-Options"], "DENY");
  assert.match(headers["Permissions-Policy"], /camera=\(\)/);
  assert.equal(headers["Strict-Transport-Security"], undefined);
  assert.doesNotMatch(headers["Content-Security-Policy"], /unsafe-inline/);
  assert.doesNotMatch(headers["Content-Security-Policy"], /unsafe-eval/);
});

test("HSTS is emitted only for non-loopback HTTPS", () => {
  const headers = securityHeaders({ protocol: "https:", host: "meridian.grok.me" });
  assert.equal(headers["Strict-Transport-Security"], "max-age=31536000; includeSubDomains");
  assert.match(headers["Content-Security-Policy-Report-Only"], /upgrade-insecure-requests/);

  const forwarded = securityHeaders({
    protocol: "http:",
    forwardedProto: "https",
    host: "preview.grok-sandbox.com",
  });
  assert.ok(forwarded["Strict-Transport-Security"]);
});

test("sensitive response paths are not cacheable", () => {
  assert.equal(shouldNoStore("/api/auth/get-session"), true);
  assert.equal(shouldNoStore("/_serverFn/data"), true);
  assert.equal(shouldNoStore("/auth/popup/exchange"), true);
  assert.equal(shouldNoStore("/exports/report.xlsx"), true);
  assert.equal(shouldNoStore("/"), false);
});

test("policy can be applied to Fetch Headers", () => {
  const headers = applySecurityHeaders(new Headers(), {
    protocol: "https:",
    host: "meridian.grok.me",
  });
  assert.equal(headers.get("x-content-type-options"), "nosniff");
  assert.match(headers.get("content-security-policy") ?? "", /frame-ancestors 'none'/);
});
