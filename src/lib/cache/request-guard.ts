/**
 * Request guard middleware — the client-safe wrapper.
 *
 * `src/start.ts` is part of both the client and the server graph, so it must
 * not statically import a `.server.ts` module (the bundler rejects that: a
 * server module would be pulled into the browser bundle). The real work lives
 * in `request-guard.server.ts` and is imported dynamically **inside** the
 * server-only callback, the same pattern `authMiddleware` uses.
 *
 * The callback never runs in the browser, so the dynamic import only resolves
 * on the server.
 */

import { createMiddleware } from "@tanstack/react-start";

export const requestGuardMiddleware = createMiddleware({ type: "request" }).server(
  async (ctx) => {
    const { runRequestGuard } = await import("./request-guard.server.ts");
    return runRequestGuard(ctx);
  },
);
