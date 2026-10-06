# 3 · Target Architecture

## 3.1 Reference architecture

```
   SOURCES                 INGESTION                AI PREP ENGINE
┌───────────────┐   ┌───────────────────┐   ┌─────────────────────────────┐
│ Excel / CSV   │──▶│ Drop zone · Email │   │ 1 PROFILER                  │
│ Postgres/MSSQL│──▶│ in · SFTP · API   │   │   types, stats, quality     │
│ Oracle / SAP  │──▶│ connectors ·      │   │ 2 CLEANER                   │
│ Snowflake /BQ │──▶│ schedulers        │   │   recipe generation         │
│ Google Sheets │──▶│                   │   │ 3 MAPPER                    │
└───────────────┘   └─────────┬─────────┘   │   rules + embeddings + LLM  │
                              │             │   → confidence + reasons    │
                              ▼             │ 4 HUMAN REVIEW CONSOLE      │
                    ┌───────────────┐       │   override / approve        │
                    │ BRONZE (raw)  │       └──────────────┬──────────────┘
                    │ immutable,    │──────────────────────┘
                    │ versioned     │                commit (gated)
                    └───────┬───────┘                       │
                            ▼                               ▼
                    ┌───────────────┐             ┌──────────────────┐
                    │ SILVER (clean)│────────────▶│ GOLD (canonical) │
                    │ recipes applied│            │ entities · depts │
                    └───────────────┘             │ KPIs · vocab     │
                                                  └────────┬─────────┘
                            ┌───────────────────────────────┼───────────────┐
                            ▼                               ▼               ▼
                     SEMANTIC LAYER                   BOARDS (150+)    ASK-AI / API
                     KPI dictionary · RLS ·           command center   NL → governed
                     lineage graph                    dept boards      tool calls
```

**Design rule #1: raw is sacred.** Files land in bronze exactly as received. Every later stage is a recorded transformation. Reproducibility is a board-level feature.

**Design rule #2: the AI proposes, the human disposes.** The commit gate (implemented in the prototype) is architectural, not cosmetic: publish requires either high-confidence complete mappings or explicit review sign-off, and every decision (including who made it) is logged.

**Design rule #3: the warehouse is portable.** Gold tables export to Parquet/Postgres. A customer who leaves takes their data and model definitions — a sales argument that disarms the "vendor lock-in" objection, and a discipline that keeps the product honest.

## 3.2 The mapping engine (the core IP)

A three-layer ensemble, ordered by cost and explainability:

1. **Deterministic rules (fast, free, auditable).** Header normalisation; exact canonical names; curated synonym dictionaries per field; value-shape evidence (every value a currency code → `currency`); controlled-vocabulary dictionaries with fuzzy (bigram Dice) matching. This layer alone resolves ~70–80% of columns in practice and is what the prototype runs on.
2. **Embedding similarity (cheap, learns).** Column names and sample values embedded and matched against the customer's historical confirmed mappings and the industry knowledge base. Resolves most of the remainder; confidence falls out of cosine distance.
3. **LLM arbitration (only for the residue).** For columns still unmapped, an LLM receives the column name, samples, the domain schema and the customer's past corrections, and returns structured JSON: `{field, confidence, reason}`. Never free-text into the warehouse.

**The learning loop is the moat.** Every human override is stored as a training example scoped to (industry, entity, field). The knowledge base compounds: onboarding entity #7 in retail costs a fraction of entity #1. This asset survives customer churn and prices your consulting down-market over time.

**Evaluation before release.** A golden dataset per industry (real anonymised files with expert-verified mappings) regression-scores any change to the ensemble. Mapping quality is a number on your release dashboard, not a vibe.

## 3.3 The canonical model

Twelve tables ship at MVP (all implemented in the prototype): `meta`, `fx`, `departments`, `revenue`, `expenses`, `sales`, `turnover`, `assets`, `licenses`, `upcoming`, `forecast`, `demand`. Industry-specific depth arrives as **overlay packs** — extra canonical tables plus KPI dictionary entries (e.g. healthcare: bed-occupancy, ALOS; logistics: on-time %, cost-per-shipment) — never as forks of the core model. A group with retail + hospitals + logistics runs one warehouse with three overlays.

## 3.4 Technology choices (pragmatic stack)

| Layer | Recommendation | Why |
|---|---|---|
| Warehouse | Postgres at MVP → clickhouse/duckdb-parquet for scale; Snowflake/BigQuery adapter for enterprises | Postgres keeps MVP cheap and RLS-capable; Parquet export keeps exit open |
| Transformation | Typed functions in the app language first; dbt when SQL-team customers demand it | Recipes as code-in-app are easier to auto-generate and version |
| Backend | One typed API layer (the prototype's TanStack Start + Node pattern extends directly) | SSR boards, one deployable, fast |
| Frontend | React + a charting library (recharts → visx at scale) | Already proven in the prototype |
| AI | Rules (in-repo) + embeddings (pgvector) + LLM API for arbitration | Ensemble = cost control + explainability |
| Files | S3-compatible object store (bronze) | Cheap, versioned, exportable |
| Auth | Better-auth/Entra/OIDC + per-entity RLS | Standard |

**Build vs buy:** buy *commodity* infrastructure (hosting, auth, LLM APIs); build *the differentiators* (mapping engine, semantic layer, boards, review console). Do not build connectors from scratch at v2 — wrap Airbyte/PandaCDC-class tooling or use managed JDBC polling.

## 3.5 Security & tenancy

- Multi-tenant with strict row-level security: every gold row carries `tenant, entity, department`; the semantic layer injects filters at query time — boards physically cannot cross a tenant boundary.
- Regional hosting cells (EU, UAE, KSA) from a single codebase — a frequent deciding factor for GCC groups.
- Audit: every upload, recipe, mapping override, commit and board view is an immutable event. The audit log *is* the compliance story for SOC 2 / ISO 27018 / local regulators.
- Least-privilege AI: the LLM sees column names, samples and schema — never unrelated tenant data — and its outputs are structured and logged.

## 3.6 What the prototype in this repo already proves

| Architectural element | Prototype status |
|---|---|
| Universal ingestion (no template) | ✅ `/ingest` — any xlsx/xls/csv; header auto-detection under title rows |
| Profiling | ✅ types incl. currency detection, fill rates, outliers, dupes, totals rows, quality score |
| Cleaning recipes | ✅ generated + applied: dates→ISO, currency stripping, dedupe, totals removal, category standardisation, with counts and previews |
| Semantic mapping | ✅ domain classification with evidence; column→field mapping with confidence + reasons; HITL override console |
| Value coercion | ✅ fuzzy mapping of entities, departments, regions, channels, currencies with per-value scores |
| Gated publish + merge | ✅ commit only after review; incremental merge by stable row ids; patch report |
| Canonical warehouse | ✅ 12-table model with multi-currency FX conversion |
| Leadership boards | ✅ 150+ boards, group command center, drill-downs, live patches |
| Warehouse browser | ✅ `/warehouse` — model, KPI dictionary, lineage chain, source registry with quality scores |
| NL Q&A | ✅ demo engine on `/` header (deterministic over selectors; production swaps in LLM tool-calls over the same layer) |
| Learning loop, connectors, RLS, multi-tenant, LLM arbitration | 🚧 documented here; Phase 1–2 build items |

The gap between prototype and production is real but *conventional*: persistence, auth, tenancy, connectors. The risky part — can messy files actually be profiled, cleaned, mapped and published with an auditable trail — is de-risked and demoable today.
