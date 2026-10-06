# 2 · Requirements Analysis

This document stretches the original brief into a full requirement set. Priorities use MoSCoW: **M** = must have for MVP, **S** = should have in v1.x, **C** = could have (differentiators), **W** = won't have for now (explicitly out of scope).

## 2.1 Scope frame

| Dimension | Requirement |
|---|---|
| Industries | Unlimited; industry is metadata, not code. Launch verticals: retail/FMCG, manufacturing, healthcare, financial services, logistics, energy, hospitality, real estate, education, technology, wholesale, CPG (the prototype ships twelve) |
| Entities | Multi-entity (group companies, subsidiaries, JVs) with per-entity security boundaries |
| Departments | Unlimited functions per entity (finance, sales, marketing, operations, procurement, IT, treasury, supply chain, HR, frontline…) |
| Currencies | Multi-currency ingestion; single display currency with live conversion |
| Periods | Monthly grain minimum; daily/transactional grain retained where source provides it |
| Sources | Any Excel/CSV at MVP; databases and warehouses at v2 (see connector list) |
| Users | Three tiers: viewer (leadership), contributor (uploads files, reviews mappings), admin (model, users, governance) |

## 2.2 Capability map

```
┌──────────────────────────────────────────────────────────────────┐
│  CONSUMPTION    Boards · Ask-AI · Alerts · Exports · API         │
├──────────────────────────────────────────────────────────────────┤
│  SEMANTIC       Canonical model · KPI dictionary · ontologies    │
│  LAYER          per industry · row-level security                │
├──────────────────────────────────────────────────────────────────┤
│  AI PREP        Profile → Clean → Map → (Human review) → Publish │
│  ENGINE         + learning loop from reviewer corrections        │
├──────────────────────────────────────────────────────────────────┤
│  WAREHOUSE      Bronze (raw) · Silver (clean) · Gold (business)  │
├──────────────────────────────────────────────────────────────────┤
│  INGESTION      Excel/CSV · DB connectors · warehouse mirrors ·  │
│                 REST · SFTP · scheduled pulls                     │
└──────────────────────────────────────────────────────────────────┘
```

## 2.3 Functional requirements

### A. Ingestion

| ID | Requirement | Priority |
|---|---|---|
| A1 | Upload any `.xlsx`, `.xls`, `.csv` file; multiple files per day; no template required | M |
| A2 | Auto-detect the header row (including under title/subtitle rows, footers, multi-row headers) | M |
| A3 | Multi-sheet files: user picks which sheet(s) to ingest; "all sheets" supported | S |
| A4 | Connectors: PostgreSQL, SQL Server, MySQL, Oracle, SAP extractors | S (v2) |
| A5 | Warehouse mirrors: Snowflake, BigQuery, Databricks | C (v2) |
| A6 | Google Sheets, SFTP drop folders, email-in ingestion address | C |
| A7 | Scheduled re-pulls from connectors (hourly/daily/monthly) with incremental (delta) loads | S |
| A8 | Merged-cell repair, formula-result extraction, password-protected files | S |
| A9 | Files up to 250MB / 5M rows via async processing queue | S |

### B. AI profiling

| ID | Requirement | Priority |
|---|---|---|
| B1 | Per-column type inference: text, number, currency (with detected currency), percent, date (with detected format), boolean, category, identifier | M |
| B2 | Per-column stats: fill rate, distinct count/ratio, min/max, sample values | M |
| B3 | Quality findings: nulls, mixed formats, outliers (IQR), duplicate headers, duplicate rows, totals/subtotal rows, whitespace | M |
| B4 | File-level quality score (0–100) with drill-down to the findings that caused deductions | M |
| B5 | PII detection (emails, phone numbers, national IDs) with masking option | S |
| B6 | Cross-file anomaly detection: "this month's revenue is 4σ below the entity's history" | C |

### C. AI cleaning (the Alteryx-like stage)

| ID | Requirement | Priority |
|---|---|---|
| C1 | Auto-generate a reviewable cleaning recipe: header normalisation, whitespace trim, date → ISO, currency symbols → numeric + currency metadata, percent → fraction, category spelling standardisation, dedupe, totals-row removal | M |
| C2 | Every recipe step shows affected counts and before/after previews | M |
| C3 | Recipes are versioned, replayable and exportable (audit artefact) | M |
| C4 | Reviewer can disable/enable individual steps | S |
| C5 | Unit-aware conversion (thousands vs units, cases vs pieces) with confirmation | C |
| C6 | Cross-currency normalisation with FX as-of dates from the FX table or an API | S |

### D. AI semantic mapping

| ID | Requirement | Priority |
|---|---|---|
| D1 | Dataset-level domain classification (revenue / expenses / sales / assets / licenses / commitments / inventory / headcount / custom) with confidence + evidence | M |
| D2 | Column-level mapping to canonical fields with per-mapping confidence and reason (exact name / synonym / value pattern / fallback) | M |
| D3 | Value-level coercion into controlled vocabularies (entities, departments, regions, channels, currencies, categories) with fuzzy matching and per-value confidence | M |
| D4 | Human-in-the-loop console: accept all, override any mapping or value, exclude columns — overrides are logged and marked "human" | M |
| D5 | Learning loop: confirmed mappings become examples that bias future suggestions for the same entity/industry | S |
| D6 | LLM-assisted mapping for columns the rule/embedding engine cannot place, with structured output (field + confidence + explanation) | S |
| D7 | New-entity onboarding: map a new entity's chart of accounts / org structure to the group model in a guided session | S |
| D8 | Golden-dataset evaluation harness per industry; regression-score every mapping-model change before release | S |

### D-bis. AI onboarding interview (the publish gate)

The onboarding agent is the trust ceremony between ingestion and the warehouse. It is a chat with an agent that accepts **file upload, integrations, data pipelines, or direct data mapping** as the entry point, then asks — with answers pre-filled from what the profiler found in the file:

| ID | Requirement | Priority |
|---|---|---|
| D9 | Entry points: file upload, connector/integration, scheduled pipeline, or start-from-mapping — all funnel into the same interview | M |
| D10 | Intent question: "why are you injecting this data?" (monthly reporting / new entity / one-off analysis / historical backfill / correction) — recorded on lineage | M |
| D11 | Scope questions, data-aware: single vs multiple companies and departments, with the entities/functions detected in the file proposed for confirmation | M |
| D12 | Field-by-field review step: the agent walks every column's proposed mapping; low-confidence items called out; overrides taken inline | M |
| D13 | Generated onboarding profile (purpose, scope, domain, fields, quality, period, currency) presented for confirmation before publish unlocks | M |
| D14 | **Hard gate:** no data is committed, displayed or visualised on any dashboard until the onboarding profile is confirmed — enforced server/store-side, not only in the UI | M |
| D15 | Interview transcript retained as an audit artefact alongside recipe and mappings | S |
| D16 | Repeat-onboarding memory: same entity + similar file structure auto-answers the interview in production (draft for one-click confirmation) | S |

### E. Warehouse & semantic layer

| ID | Requirement | Priority |
|---|---|---|
| E1 | Medallion storage: bronze (raw as received), silver (cleaned), gold (canonical business model) | M (bronze/silver at MVP may be simplified to raw + canonical) |
| E2 | Canonical model: entities, departments, revenue, expenses, sales, inventory, assets, licenses, commitments, forecast, headcount + custom tables | M |
| E3 | KPI dictionary: every KPI has an owner, formula, grain and freshness SLA; one definition per KPI group-wide | M |
| E4 | Lineage: any board number traceable to source file + recipe + mapping + commit | M |
| E5 | Row-level security by entity and department; group-level aggregate roles | M |
| E6 | Slowly-changing dimensions: mapping changes keep history (what the board saw last quarter remains reproducible) | S |
| E7 | Data contracts: per-entity schema expectations with drift alerts | C |

### F. Dashboards & visualisation

| ID | Requirement | Priority |
|---|---|---|
| F1 | Group command center: cross-entity KPIs, industry mix, entity league table, alert feed | M |
| F2 | Department boards per entity (finance, sales, operations, …) generated from the canonical model — 150+ board templates ship at MVP | M |
| F3 | Global filters: entity, industry, department, period, currency — every board respects them | M |
| F4 | Drill: group → industry → entity → department → transaction-level rows | M |
| F5 | Natural-language Q&A over the warehouse (governed; answers cite the tables used) | S |
| F6 | Auto-generated narrative insights ("Revenue +12% QoQ, driven by retail EMEA; margin down 1.4pp on freight costs") | S |
| F7 | Scheduled board digests (PDF/PowerPoint) emailed to leadership | S |
| F8 | Custom board builder for power users (drag widgets onto a grid) | C |
| F9 | Board-level commenting and @mentions for the monthly close ritual | C |

### G. Governance, security, admin

| ID | Requirement | Priority |
|---|---|---|
| G1 | SSO (Entra ID / Google Workspace / Okta), SCIM provisioning | S |
| G2 | Full audit log: who uploaded, who reviewed, who overrode, who viewed | M |
| G3 | Role model: viewer / contributor / reviewer / admin; per-entity scoping | M |
| G4 | Hosting options: cloud multi-tenant, dedicated single-tenant, or in-region (UAE/KSA/EU data residency) | S |
| G5 | SOC 2 Type I → Type II path; GDPR/PCI awareness; backup & recovery SLAs | S |
| G6 | Sandboxed trial tenancy for prospect demos with sample data | M |

## 2.4 Non-functional requirements

| Category | Requirement |
|---|---|
| Scale | 50 entities, 500 users, 10M fact rows per tenant at MVP; horizontal beyond |
| Ingestion latency | 10k-row file: profile+clean+map < 60s; interactive review included |
| Board latency | P95 < 2s for any board at MVP scale |
| Availability | 99.5% MVP → 99.9% with multi-region |
| AI trust | No AI action commits without either (a) ≥ threshold confidence **and** no required-field gaps, or (b) explicit human approval. All AI decisions logged with reasoning |
| Explainability | Every transformation and mapping human-readable in business language |
| Portability | Warehouse layer exportable to Parquet/Postgres — no hostage data |
| Cost | Inference cost per ingested file < $0.10 typical |

## 2.5 Flagship user stories (acceptance criteria)

**US-01 — "Upload anything" (the demo moment)**
*As an entity FD, I drop the regional sales export I received by email.*
- The system detects the header row under a title row ✓
- Types, currencies and dates are inferred and shown with confidence ✓
- A cleaning recipe is proposed: dates → ISO, `$1,234.56` → 1234.56 USD, 2 duplicate rows and 1 TOTAL row dropped ✓
- The dataset is classified (e.g. "Sales, 75%") with evidence ✓
- Columns are mapped to the model; `Sales Rep` is excluded as descriptive ✓
- Nothing commits until I press *Commit* ✓
- After commit, the patch report shows rows added/updated and boards affected ✓

**US-02 — "Board trust"**
*As group CFO, I tap a number on the command center.*
- I see lineage: entity → source file → recipe steps → mappings → the exact committed rows ✓
- I see the quality score and open findings for that source ✓

**US-03 — "Ask the warehouse"**
*As chairman, I ask "which entity has the best margin?"*
- The answer is computed from governed gold tables, shows the ranking, and names the tables used ✓
- Questions outside the governed model are refused with an explanation, not hallucinated ✓

**US-04 — "Onboarded, or it doesn't exist"**
*As group CFO, a file arrives from an entity.*
- Before anything is committed, the agent interviews the uploader: why the data is arriving, whose it is, and a field-by-field review ✓
- The interview must be confirmed before publish unlocks — un-onboarded data physically cannot reach a dashboard ✓
- The confirmed purpose and scope are stamped onto the file's lineage forever ✓

**US-05 — "New subsidiary"**
*As group analyst, a new company joins with 3 years of Excel history.*
- I upload their files; the mapping console pre-fills from similar entities in the same industry ✓
- Where their chart of accounts differs, I map once; it sticks for future uploads ✓

## 2.6 The honesty clause: what "any Excel file" really means

The brief promises "any Excel file, automatically." The product promise must be stated carefully, because this is where trust is won or lost:

- **Tier 1 (auto, ≥95% of files):** recognisable tabular data with headers the synonym/embedding engine can place — commits after one human confirmation.
- **Tier 2 (guided, common):** unusual headers, multi-row headers, pivoted layouts — the AI proposes, the reviewer corrects 2–5 fields. Minutes of work.
- **Tier 3 (consultant session, rare):** genuinely novel structure (scanned PDFs, 40-tab workbooks, report-style sheets) — becomes a billable onboarding session. **This tier is a service revenue line, not a product failure.**

The UI must never silently guess below threshold; it must escalate. This behaviour is implemented in the prototype (mapping confidence bars, "no signal — map manually" reasons, required-field gating on publish).
