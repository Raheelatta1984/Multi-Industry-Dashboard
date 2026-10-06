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
| `/ingest` | **AI Ingest Studio** — the core demo. Drop any `.xlsx/.xls/.csv` (or run one of the bundled messy sample files) and watch: header detection → column profiling → generated cleaning recipe → semantic mapping with confidence scores → human review → gated publish into the warehouse |
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

The prototype engine is deterministic on purpose (auditable, offline, instant); the production architecture swaps the matcher for an embeddings + LLM ensemble behind the same review gate — see the docs.

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
