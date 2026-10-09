# Multi-Industry-Dashboard — "Meridian"

**An AI-powered group data platform prototype:** upload *any* spreadsheet, and an AI pipeline profiles it, cleans it, maps it onto a universal multi-entity / multi-department / multi-currency warehouse, and drives 150+ leadership boards.

## Run it

```bash
npm install
npm run dev          # http://localhost:8080
```

## What to look at

| Route | What it shows |
|---|---|
| `/` | Group command center across 12 industries, live patches, FX conversion |
| `/ingest` | **AI Onboarding Studio** — the core demo. An agent chatbot with file upload, integrations and pipeline options conducts the intake interview: why is the data arriving, single or multiple companies, single or multiple departments, field-by-field review — then generates the onboarding profile. **Nothing is committed to the warehouse or shown on dashboards until onboarding is confirmed** |
| `/warehouse` | The semantic layer: canonical model, KPI dictionary, lineage, source registry with quality scores |
| `/catalog`, `/board/$id` | 150+ department boards, all driven by the same warehouse |
| `/data` | The legacy fixed-template Excel studio (still supported) |
| `/fx` | FX table and exposure |
| Header → **Ask AI** | Natural-language Q&A over the warehouse (demo engine) |

## How the AI pipeline works

`src/lib/ingest/` implements the engine in four auditable stages:

1. **Profile** (`profile.ts`) — header-row detection (even under title rows), per-column type inference (incl. currency detection), fill rates, outliers, duplicate/total-row findings, quality score.
2. **Clean** (`clean.ts`) — generates and applies a reviewable recipe: ISO dates, currency-symbol stripping, dedupe, totals removal, category standardisation.
3. **Map** (`semantic.ts`) — dataset classification into a canonical domain + column→field mapping via synonym dictionaries, value-shape evidence and fallbacks, each with confidence and a human-readable reason; fuzzy coercion of values into controlled vocabularies (entities, departments, regions, channels, currencies).
4. **Publish** (`publish.ts`) — builds canonical rows, records value coercions, merges incrementally into the live workbook by stable row ids, and reports the patch (+added / ~updated / boards lit).

**Onboarding gate** (`onboarding.ts` + the chat in `/ingest`): every file passes an AI-guided interview before publish is unlocked — purpose (why the data is injected), company scope (single/multiple, auto-detected from the data), department scope (single/multiple, auto-detected), field-by-field mapping review, and a generated onboarding profile attached to lineage. The gate is enforced in the store (`publish()` refuses unconfirmed onboardings), not just in the UI.

**Commit readiness and the onboarding log** (`preflight.ts`, `log.ts`, `store.ts`): `evaluateCommit` is the single source of truth for whether a file can land. It lists each condition, with a plain-language fix for every blocker: the interview answers, the target model, each required field for that model, the rows that would be committed, answers that disagree with the data (a single-company answer on a file that names five companies, for example), rows that look like duplicates of what is already in the warehouse, and data quality. `publish()` refuses while any blocker exists and logs the reasons. Every step is written to the onboarding log: intake, cleaning, target model, mapping, each interview answer, each mapping change, and each commit or refusal. The log is shown on `/ingest` and can be saved as text. The template route on `/data` writes an import log the same way.

Rules a reviewer should know:

- The company and department answers apply only to rows that have no company or department value of their own. Rows that name their own company keep it.
- With "Correct / replace data", a row whose business key matches exactly one existing row updates that row in place. Other changed figures are reported as possible double counts rather than silently added.
- Until a target model is chosen, columns are not guessed. The interview asks when the headers are not recognisable, and the mapping panel has a target-model selector.

`npm test` runs `scripts/ingest-onboarding.test.mjs`, which drives the real ingest store through Vite's SSR loader.

The prototype engine is deterministic on purpose (auditable, offline, instant); the production architecture swaps the matcher for an embeddings + LLM ensemble behind the same review gate — see the docs.

## Sandbox self-healing (`scripts/sandbox-guard.mjs`)

Arena sandboxes get recycled between sessions: the file patchset comes back, but the **git branch pointer resets to the scaffold commit**, `node_modules` is wiped, and the dev server dies. The sandbox guard detects and repairs that state automatically:

```
node scripts/sandbox-guard.mjs --status                 # what state are we in?
node scripts/sandbox-guard.mjs --recover                # heal git + deps
node scripts/sandbox-guard.mjs --recover --with-server  # also restart the preview
node scripts/sandbox-guard.mjs --recover --force        # reset even a dirty tree (snapshots to sandbox-rescue/* first)
npm run guard                                           # 15s watchdog
```

**Four trigger layers:**

| Trigger | Fires when | Effect |
|---|---|---|
| `~/.profile` / `~/.bash_profile` hook | every login shell — i.e. the **first command after a recycle** | full heal (git + deps + server), ~80ms when healthy |
| `startup.sh` | platform revive re-runs it (see `.grok/references/hibernate-revive.md`) | full heal + preview back up |
| `predev` npm hook | any `npm run dev` | heals before Vite starts |
| `npm run guard` watchdog | while a session is live | catches mid-session resets, restarts a crashed server |

**Safety rules** (all unit-tested in `scripts/sandbox-guard.test.mjs`):

- The pointer is only reset when the local branch is a plain ancestor of the remote (rolled-back pointer) **and** the worktree already matches the remote commit — a pointer-only heal.
- A worktree with real uncommitted changes is never reset automatically (log an `uncommitted-work` event; `--force` snapshots to a `sandbox-rescue/*` branch first).
- A diverged history is never touched.
- Unpushed local commits are kept, never "healed" away.

Runtime state lives in `.sandbox-guard.json` / `.sandbox-guard.log` (gitignored). To intentionally stop the server without the guard restarting it: `touch /tmp/.meridian-guard-paused`.

## Documentation

The full product & market analysis package lives in [`docs/`](docs/README.md):

1. [Vision & problem](docs/01-vision-and-problem.md)
2. [Requirements analysis](docs/02-requirements-analysis.md)
3. [Target architecture](docs/03-target-architecture.md)
4. [Market & competition](docs/04-market-and-competition.md)
5. [GTM & consulting playbook](docs/05-gtm-consulting-playbook.md)
6. [Roadmap & risks](docs/06-roadmap-and-risks.md)
7. [One-pager](docs/one-pager.md)

## Stack

React 19 · TanStack Start (SSR) · Zustand · Recharts · Tailwind 4 · xlsx · Vite 8
