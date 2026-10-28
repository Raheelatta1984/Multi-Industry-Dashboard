# Credential storage and security hardening review

Date: 2026-10-28
Repository: `Raheelatta1984/Multi-Industry-Dashboard`
Branch: `arena/bcdf6e4b-multi-industry-dashboard`
Requested scope: all tiers (`APPLY_SCOPE=all`); CSP mode: auto; legacy-token grace: 0 days; default branch: `main`; squash requested; auto-merge requested; merged-only cleanup requested.

## Executive decision

Tier A, B, and C are applicable. The implementation below is complete for this branch, subject to the explicitly documented residuals: the local scaffold does not expose the Better Auth API route and its preview database is missing the Better Auth tables, `xlsx` remains a high-severity audit exception with no upstream fix, and full nonce/hash CSP enforcement is deferred until the framework/platform inline scripts can be controlled.

No secret value was printed, committed, exposed in this document, or rotated. The previously committed preview client secret was removed from source; deployment-side rotation/revocation remains a separate broker-owner operation.

## Phase 0 — preflight and baseline

- The working tree was clean at the start of the run.
- GitHub CLI was authenticated and the repository was identified as the non-fork `Raheelatta1984/Multi-Industry-Dashboard`; the default branch is `main`.
- The branch-protection API returned HTTP 403 (`Resource not accessible by integration`), so protection and required checks could not be independently read. No protection is assumed.
- The session branch is the required Arena branch. It remains `arena/bcdf6e4b-multi-industry-dashboard`; it was not renamed or replaced.
- `git fetch --prune origin` completed. The checkout is shallow/grafted at the same starting commit as `origin/main`.

Baseline commands were run before edits:

| Check | Result | Evidence |
|---|---|---|
| `npm test` | **FAIL (baseline dependency state)**; 35 passed, 2 failed because `@tanstack/react-start` and `jose` were not installed | `/tmp/security-hardening/baseline-test.log` |
| `npm run lint` | **FAIL (baseline dependency state)**; `eslint: not found` | `/tmp/security-hardening/baseline-lint.log` |
| `npm run typecheck` | **FAIL (baseline dependency state)**; `tsc: not found` | `/tmp/security-hardening/baseline-typecheck.log` |
| `npm run build` | **FAIL (baseline dependency state)**; `vite: ENOENT` | `/tmp/security-hardening/baseline-build.log` |

These baseline failures were caused by the absent install, not by a test change. No tests were disabled or weakened.

## Phase 1 — applicability discovery and findings

### Stack classification

This is a browser front-end and server/API application using React, Vite, TanStack Start/Nitro, Better Auth, PGLite/Postgres, and TypeScript: `package.json:27-100`, `vite.config.ts:148-184`, and `src/lib/auth/server.ts:32-251`. It serves HTML and contains authentication code, so all three tiers apply.

### Applicability verdict

- **Tier A — APPLICABLE.** Before remediation, `src/lib/auth/client.ts` stored a preview bearer and attached it to browser requests, while `src/lib/auth/popup.server.ts` placed the session value in the popup completion payload. The pre-remediation evidence and proposed disposition are preserved in findings 1 and 2 below. The final implementation now uses a one-time server-side handoff code and an HttpOnly cookie.
- **Tier B — APPLICABLE.** Before remediation, no shared response-header policy covered both Vite and Nitro. The app has inline popup/install scripts and styles (`src/lib/auth/popup.server.ts:215-247`, `scripts/install-page.html:17-55`) plus verified external font/extension origins (`src/styles.css:1`, `scripts/grok-pwa-shared.mjs:203-238`). A safe enforced CSP subset and a complete report-only policy are now shared by dev and deployed responses.
- **Tier C — APPLICABLE.** The tracked lockfile and direct dependency ranges were present, but there was no security workflow or Dependabot configuration. The final branch has exact direct pins, deterministic `npm ci --legacy-peer-deps` CI, SHA-pinned actions, high/critical audit policy, a browser-storage guard, tests, lint, typecheck, build, and weekly Dependabot updates.

### Findings and disposition

| # | Severity | Pre-remediation finding and evidence | Final disposition and evidence | Status |
|---:|---|---|---|---|
| 1 | High | The live-preview browser path stored a reusable bearer in script-readable storage and attached it as Authorization. Historical evidence: `src/lib/auth/client.ts` before the change, recorded in `/tmp/security-hardening/discovery.log` and the initial review diff. | Browser code now only removes the legacy key once at `src/lib/auth/client.ts:29-43`; it never reads or writes a credential and never constructs a browser Bearer header. The preview exchange uses `fetch` with the one-time code only at `src/lib/auth/client.ts:190-204`. The server-only Bearer compatibility path remains explicitly server-side at `src/lib/auth/server.ts:250-253`. | **Fixed** |
| 2 | High | Popup completion previously exposed the reusable session value to opener JavaScript. Historical location: `src/lib/auth/popup.server.ts` before remediation, recorded in `/tmp/security-hardening/discovery.log`. | Completion creates a short-lived code from the popup cookie at `src/lib/auth/popup.server.ts:45-62`; the server-side map consumes it once at `src/lib/auth/preview-handoff.server.ts:6-40`; the exchange consumes before setting cookies at `src/lib/auth/popup.server.ts:128-178`; completion posts only the code and escapes `<` in the JSON payload at `src/lib/auth/popup.server.ts:215-247`. Cookies are `HttpOnly`, `Secure`, `SameSite=Lax`, `Path=/`, bounded, and `__Host-`-named at `src/lib/auth/popup.server.ts:190-203` and `src/lib/auth/server.ts:146-149,220-239`. | **Fixed** |
| 3 | High | A preview OAuth client secret was present in the pre-remediation server source. Historical evidence: `src/lib/auth/preview.ts` before remediation, recorded in `/tmp/security-hardening/discovery.log`. | `src/lib/auth/preview.ts:8-13` now contains only the public client id and states that the secret is runtime-injected; `src/lib/auth/server.ts:77-85` reads `GROK_AUTH_CLIENT_SECRET` and never provides it to client code. No secret value was rotated or printed. | **Fixed in source; rotation deferred** |
| 4 | Medium | Vite/Nitro responses lacked one shared security-header/no-store policy. Historical evidence: pre-remediation `vite.config.ts` and `server/middleware/grok-pwa.ts`, recorded in `/tmp/security-hardening/discovery.log`. | `scripts/security-headers.mjs:5-101` defines the policy and `server/middleware/security.ts:8-33` applies it to Nitro. `vite.config.ts:65-84,217` applies the same policy to dev responses. Auth/API/server-function/popup/export/download paths receive `no-store` through `scripts/security-headers.mjs:83-92`. | **Fixed** |
| 5 | Medium | Inline popup/install code and external origins prevented a safe immediate full CSP block. Evidence: `src/lib/auth/popup.server.ts:215-247`, `scripts/install-page.html:17-55`, `scripts/grok-pwa-shared.mjs:203-238`, and `src/styles.css:1`. | The enforced CSP is deliberately non-breaking and contains no `unsafe-inline` in `script-src` at `scripts/security-headers.mjs:5-10`. The complete enumerated policy is report-only at `scripts/security-headers.mjs:12-25`; style `unsafe-inline` is retained only in `style-src` for current inline/framework styling. Full nonce/hash enforcement is deferred. | **Partially fixed by design; follow-up documented** |
| 6 | Medium | CI had no deterministic install/audit/security regression job or dependency update policy. | `.github/workflows/security.yml:19-69` uses SHA-pinned checkout/setup actions, `npm ci --legacy-peer-deps`, audit policy, storage guard, tests, lint, typecheck, and build. `.github/dependabot.yml:1-7` enables weekly npm updates. Direct dependency ranges are exact pins at `package.json:27-100`, mirrored in the lockfile root at `package-lock.json:6-81`. | **Fixed** |
| 7 | Info | The JWT gate-identity path is not browser session transport. | The positive control remains: `src/lib/auth/gate-identity.server.ts:93-104` uses the existing strict verification path. No change was needed. | **Retained** |

### Negative search results and not-applicable items

Searches used the runbook patterns while skipping vendored/build output; the broad final output is `/tmp/security-hardening/final-discovery.log` and the focused application scan is `/tmp/security-hardening/final-focused-scan.log`.

- **Browser credential storage:** the final application scan found the legacy purge at `src/lib/auth/client.ts:29-43` and ordinary currency preference storage at `src/lib/store.ts:53-62`; the latter is not authentication material. The CI-equivalent credential-keyed storage guard passed with no unexpected matches. `.security-storage-allowlist:1` documents the intentional legacy purge.
- **Bearer transport:** server-only uses remain at `src/lib/auth/verify.server.ts:54-66` and `src/lib/app-data/client.server.ts:100-116`; the browser client has no corresponding Authorization construction. This is intentional non-browser API compatibility, not browser credential storage.
- **DOM/XSS sinks:** the focused application scan returned no generic `innerHTML`, `outerHTML`, `insertAdjacentHTML`, `document.write`, `srcdoc`, `dangerouslySetInnerHTML`, `eval`, or `new Function` matches in `src`, `server`, and `scripts` (see `/tmp/security-hardening/final-focused-scan.log`; vendored/build/reference output was excluded). Dynamic popup data is JSON-serialized and `<`-escaped at `src/lib/auth/popup.server.ts:218-225`; React JSX remains the normal escaping boundary.
- **Cookies:** no `document.cookie` assignment or JavaScript cookie library was found. Better Auth defaults are explicit at `src/lib/auth/server.ts:220-239`, and the handoff exchange uses the same attributes at `src/lib/auth/popup.server.ts:190-203`.
- **CORS/CSRF:** no wildcard/reflected credentialed CORS configuration was found. TanStack server-function CSRF remains explicitly installed at `src/start.ts:1-18`; Better Auth credentialed origins are allowlisted at `src/lib/auth/server.ts:115-128`; per-user middleware invokes same-site protection at `src/lib/auth/middleware.ts:20-35`; and the preview exchange requires a matching Origin or Referer at `src/lib/auth/popup.server.ts:180-188`.
- **Secrets/config:** no tracked non-example `.env` file was found, and the final literal secret-assignment scan returned no matches. The secret name is read only from runtime configuration at `src/lib/auth/server.ts:77-85`.
- **Unsupported stacks/routes:** no mobile app, Python/Go/Rails/Django/Spring/Laravel/ASP.NET server, or SSR framework other than TanStack Start/Nitro was detected. Runtime probes for `/docs`, `/swagger`, `/graphql`, and common auth API routes returned 404; `/__app-env` returned 200 because it is an intentional development tooling endpoint.

## Phase 2 — implementation record

### Tier A: credential storage, popup handoff, and sign-out

- `src/lib/auth/client.ts:8-12,67-113,190-229` uses same-origin cookie authentication. Browser JavaScript does not persist, retrieve, or attach a reusable session bearer.
- `src/lib/auth/popup.server.ts:45-62,128-178,215-247` converts the popup cookie to a one-time code, posts only that code, and exchanges it in the opener context.
- `src/lib/auth/preview-handoff.server.ts:3-40` gives codes a 60-second TTL and single-use deletion semantics.
- `src/lib/auth/server.ts:146-149,220-253` defines bounded `__Host-` cookie names/attributes and retains Bearer support only for non-browser consumers.
- `scripts/sign-out-plan.mjs:7-15,81-124,150-174` requires confirmed server sign-out before redirecting cookie-auth browsers; `scripts/sign-out-plan.test.mjs` covers timeout/failure sequencing.
- `src/lib/auth/middleware.ts:1-35` relies on the session cookie and retains the same-site request guard.

User-visible behavior: live-preview sign-in now opens the popup synchronously, waits for a one-time handoff, exchanges it for the HttpOnly cookie, and refreshes the session. Switching provider or signing in while already authenticated performs a confirmed pre-sign-in sign-out. Sign-out no longer redirects and claims success when the server did not confirm invalidation; the visitor sees a retryable failure instead. Existing non-browser Bearer API consumers retain their transport.

### Tier B: XSS and response policy

- Enforced CSP: `object-src 'none'`, `base-uri 'none'`, `frame-ancestors 'none'`, and `form-action 'self'` at `scripts/security-headers.mjs:5-10`.
- Report-only CSP enumerates script, font, connection, image, frame, worker, object, base, framing, and form origins at `scripts/security-headers.mjs:12-25`. It intentionally has no `unsafe-inline` in `script-src`.
- Other headers: `nosniff`, strict-origin referrer policy, `X-Frame-Options: DENY`, restrictive permissions policy, and conditional HSTS at `scripts/security-headers.mjs:61-78`.
- No-store matching covers `/api`, `/_serverFn`, popup, export/download, and common file exports at `scripts/security-headers.mjs:83-92`.
- The Vite startup issue found during runtime verification (duplicate response-body binding) was corrected without changing policy: `vite.config.ts:156-186` now preserves the response buffer and all `Set-Cookie` headers.

Rollback: if the enforced subset breaks a consumer, revert the header-policy/plugin commit or temporarily remove the `securityHeadersPlugin`/Nitro middleware while preserving the cookie and CSRF changes; do not reintroduce browser bearer storage. The report-only policy can be tuned independently, and full CSP blocking should wait for nonce/hash control of `src/lib/auth/popup.server.ts:231-247` and `scripts/install-page.html:17-55`.

### Tier C: dependency and CI hardening

- All direct manifest ranges are exact-pinned in `package.json:27-100`; `npm ci --ignore-scripts --legacy-peer-deps` completed successfully from the refreshed lockfile.
- GitHub Actions are pinned to full commit SHAs at `.github/workflows/security.yml:19-26`; the workflow runs locked install, audit policy, storage guard, tests, lint, typecheck, and build at `.github/workflows/security.yml:28-69`.
- `.github/dependabot.yml:1-7` requests weekly npm update PRs.
- `xlsx@0.18.5` is the only remaining high-severity audit item. Raw audit exits 1 for advisories 1108110 and 1108111, with `fixAvailable: false`; policy exits 0 because `.security-audit-allowlist.json:2-5` documents and expires the exception on 2027-10-28. This is not claimed as fixed. Replace it with a maintained parser/writer before expiry while retaining server-side input limits.

## Phase 3 — verification evidence

All commands below were run after the final exact-pin reinstall and after the PWA helper correction. No test was disabled or rewritten to hide a failure.

| Verification | Result | Evidence |
|---|---|---|
| `npm ci --ignore-scripts --legacy-peer-deps` | **PASS**, 429 packages installed | command output retained in session; install was completed before final checks |
| `npm test` | **PASS**, 225/225 | `/tmp/security-hardening/final3-test.log` (`# tests 225`, `# pass 225`, `# fail 0`) |
| targeted security/sign-out tests | **PASS**, 25/25 | `/tmp/security-hardening/security-targeted-tests.log` |
| preview-handoff tests | **PASS**, 3/3 as part of the final suite | `/tmp/security-hardening/final3-test.log` |
| `npm run typecheck` | **PASS**, exit 0 | `/tmp/security-hardening/final3-typecheck.log` |
| `npm run lint` | **PASS**, exit 0; 12 existing warnings, 0 errors | `/tmp/security-hardening/final3-lint.log` |
| `npm run build` | **PASS**, exit 0; only dependency module-directive warnings; migration skipped because `DATABASE_URL` is unset | `/tmp/security-hardening/final3-build.log` |
| CI-equivalent credentialed-storage guard | **PASS**, no unexpected matches | `/tmp/security-hardening/final-discovery.log` |
| `npm run check:auth` | **PASS**, dev and build agree that sign-in is off in the shipped scaffold | `/tmp/security-hardening/final2-check-auth.log` |
| `git diff --check` | **PASS** | command completed with no output |

The PWA helper had six untouched fixture/title assertion failures during an intermediate full-suite run. That was not treated as a baseline excuse: the helper now correctly gives explicit test context and document titles precedence over the repository's baked identity, and the final suite is green at 225/225. The correction is limited to `scripts/grok-pwa-shared.mjs:303-440` and prevents a global workspace identity from contaminating explicit head-injection context.

### Runtime verification

The corrected dev server started on `0.0.0.0:8080` as process `website-3be53fec`. Final runtime artifacts are in `/tmp/security-hardening/runtime-final-*.headers` and `/tmp/security-hardening/runtime-final-*.body`.

| Probe | Result |
|---|---|
| `GET /` | 200; enforced CSP, report-only CSP, nosniff, strict-origin referrer policy, `X-Frame-Options: DENY`, and restrictive permissions policy present |
| `GET /auth/popup?done=1` | 200; `Cache-Control: no-store`; body includes only `handoffCode:null`, with no session token, Authorization, or Bearer value |
| `POST /auth/popup/exchange` with hostile Origin | 403; no `Set-Cookie` |
| Same-origin exchange with an invalid code | 401; no `Set-Cookie` |
| `/api/auth/get-session`, `/api/auth/sign-in/social`, `/docs`, `/swagger`, `/graphql` | 404 in this local scaffold |
| `/__app-env` | 200; intentional development-only tooling endpoint |

The dev log records Better Auth's missing `user`, `session`, `account`, and `verification` tables. Consequently, real local login and successful cookie issuance are **not verified** in this checkout; schema migration/deployment environment setup is required before asserting that end-to-end path.

### Supply-chain verification

- `npm audit --audit-level=high --json` exited 1 only for `xlsx` advisories 1108110 and 1108111; the JSON reports `fixAvailable: false`.
- `node scripts/check-npm-audit.mjs /tmp/security-hardening/final-npm-audit.json .security-audit-allowlist.json` exited 0 and printed one documented exception expiring 2027-10-28.
- The full SHA-pinned action count is two: `.github/workflows/security.yml:20,23`.

## Phase 4 — PR, merge, and cleanup record

This section is intentionally updated only after remote operations complete. The branch must remain the current Arena branch for all work. Required safety rules: use a PR, do not bypass protection or force-push, merge only a green PR with squash if permitted, never delete `main`/protected/open-PR branches, and delete only merged non-default branches.

- Implementation commits: `510a8f8` (`security: harden auth transport and response policy`) and `d285f8d` (`ci: align locked install with peer resolution`); review record was included in PR #7 by `8609dcb`.
- Push and PR: complete; [PR #7](https://github.com/Raheelatta1984/Multi-Industry-Dashboard/pull/7) was opened from the session branch into `main`.
- Checks/merge: the first CI attempt failed at `npm ci` because the lockfile requires legacy peer resolution; the workflow was corrected, the rerun passed, and PR #7 was merged with `gh pr merge 7 --squash` at merge commit `476d0dc1081028ac2fffd51eddedd14569cdbe11`.
- Cleanup: merged-only inspection confirmed PR #6 and PR #7 were merged, both branches were unprotected with no open PR, and `main` was never targeted. Remote `arena/a2ef1f91-multi-industry-dashboard` and `arena/bcdf6e4b-multi-industry-dashboard` were deleted; `origin` now exposes only `main`. The checked-out Arena branch remains only as the local session ref so no branch switch was required.

## Deferred work and rollback notes

1. **Secret rotation/revocation:** source removal is complete at `src/lib/auth/preview.ts:8-13` and runtime injection is required at `src/lib/auth/server.ts:77-85`; coordinate rotation with the broker owner. This run never prints or rotates a secret.
2. **Better Auth schema:** apply the repository's auth migration in the deployment/local database before enabling real login; the missing-table runtime evidence is recorded above.
3. **Full CSP enforcement:** replace inline popup/install scripts with nonce/hash-controlled responses or self-hosted modules, then promote the report-only directives at `scripts/security-headers.mjs:12-25` after reviewing reports. Do not add `unsafe-inline` to `script-src`.
4. **`xlsx`:** replace or isolate the vulnerable package before `.security-audit-allowlist.json:3-5` expires; keep input size/type limits during migration.
5. **Rollback:** revert the final PR commit through a reviewed PR if the change must be undone. Preserve the server-side cookie/CSRF model during rollback; rollback of CSP can remove the header integration, but must not restore browser storage or expose session tokens.
