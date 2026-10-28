import js from "@eslint/js";
import prettier from "eslint-config-prettier";
import reactHooks from "eslint-plugin-react-hooks";
import reactRefresh from "eslint-plugin-react-refresh";
import globals from "globals";
import tseslint from "typescript-eslint";

/** Flat ESLint config for the TanStack Start app-builder template. */
export default tseslint.config(
  {
    ignores: [
      "dist/**",
      ".output/**",
      ".vercel/**",
      ".nitro/**",
      "node_modules/**",
      "src/routeTree.gen.ts",
    ],
  },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    files: ["**/*.{ts,tsx,js,jsx,mjs,cjs}"],
    languageOptions: {
      ecmaVersion: 2022,
      globals: { ...globals.browser, ...globals.node },
    },
    plugins: {
      "react-hooks": reactHooks,
      "react-refresh": reactRefresh,
    },
    rules: {
      ...reactHooks.configs.recommended.rules,
      // eslint-plugin-react-hooks 7 turns on the React Compiler rules, which flag
      // three patterns this app uses deliberately. Downgraded to warn so they stay
      // visible without blocking a dependency migration; each deserves its own
      // considered refactor rather than a drive-by "fix" inside a version bump.
      //
      // set-state-in-effect (3 sites, 3 different reasons):
      //   - src/components/live-engine.tsx: the countdown seeds `now` as null so
      //     SSR renders a stable "1:00", then starts ticking client-side. The
      //     obvious lazy `useState(() => Date.now())` rewrite would render
      //     different values on server and client — the very hydration mismatch
      //     the effect exists to avoid.
      //   - src/routes/ingest.tsx: `setPhase(0)` resets a staged reveal keyed on
      //     runId, then walks the phases on timers. The reset is the point.
      //   - src/routes/scalability.tsx: poll-on-mount `refresh()` plus a 4s
      //     interval. Standard fetch-on-mount, which the rule treats as suspect.
      //
      // purity (1 site):
      //   - src/components/widgets.tsx: `Date.now() < dirtyUntil` drives the save
      //     flash. Impure during render by design; making it pure means moving the
      //     dirty window onto the tick the live engine already owns.
      //
      // preserve-manual-memoization (2 sites):
      //   - src/routes/fx.tsx: `fxMap()` is rebuilt every render, so `rates` is a
      //     fresh object each time and the useMemo keyed on it can never hit. This
      //     one is a genuine (if minor) perf bug, not a deliberate pattern.
      "react-hooks/set-state-in-effect": "warn",
      "react-hooks/purity": "warn",
      "react-hooks/preserve-manual-memoization": "warn",
      "react-refresh/only-export-components": [
        "warn",
        { allowConstantExport: true },
      ],
      "@typescript-eslint/no-unused-vars": [
        "warn",
        { argsIgnorePattern: "^_", varsIgnorePattern: "^_" },
      ],
      "@typescript-eslint/no-explicit-any": "off",
    },
  },
  // Disable rules that conflict with Prettier formatting.
  prettier,
);
