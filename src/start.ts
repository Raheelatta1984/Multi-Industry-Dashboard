import { createCsrfMiddleware, createStart } from "@tanstack/react-start";
import { requestGuardMiddleware } from "@/lib/cache/request-guard";

/**
 * Server start instance — the request-level middleware chain.
 *
 * Adding a `startInstance` **replaces** the framework's default CSRF
 * middleware, so it is re-declared here with the same filter the default
 * uses (server functions only — they are the same-origin RPC endpoints that
 * need the origin check). Removing it would silently weaken the CSRF
 * protection of every server function in the app.
 */
const csrfMiddleware = createCsrfMiddleware({
  filter: (ctx) => ctx.handlerType === "serverFn",
});

export const startInstance = createStart(() => ({
  requestMiddleware: [csrfMiddleware, requestGuardMiddleware],
}));
