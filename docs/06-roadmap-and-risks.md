# 6 · Roadmap & Risks

## 6.1 Phase plan

### Phase 0 — Prototype (✅ done, this repo)
- Universal Excel/CSV ingestion with header auto-detection
- Profiling, cleaning recipes, semantic mapping with confidence + HITL console
- Gated publish with incremental merge and patch reports
- 12-table canonical warehouse, 150+ boards, warehouse browser, NL Q&A demo engine
- **Purpose:** de-risk the core concept; serve as the sales demo.

### Phase 1 — MVP (8–10 weeks, 1–2 engineers)
Goal: first paying pilot on real client data.
- Persistence (Postgres) + auth (SSO) + single-tenant deployment
- Multi-user review console with audit log; recipes versioned in DB
- PDF/board-pack export; scheduled email digests
- Regional hosting cell #1 (e.g., UAE)
- Instrumentation: auto-accept rate, ingest latency, quality-score distributions

### Phase 2 — Production AI (8–12 weeks, +1 engineer)
- Embedding layer over confirmed mappings (the learning loop)
- LLM arbitration for unmapped columns with structured output + evaluation harness
- DB connectors (Postgres, SQL Server, Oracle) with scheduled pulls
- Multi-tenancy with row-level security; self-serve trial tenancy
- PII detection & masking

### Phase 3 — Group scale (12–16 weeks)
- Warehouse mirrors (Snowflake/BigQuery), API access
- Production NL Q&A (LLM tool-calls over the semantic layer, answers cite tables)
- Narrative insight generation on boards; anomaly alerts
- SOC 2 Type I; board-pack automation (PowerPoint/Excel outputs that match group templates)
- Partner/certification programme

## 6.2 Sequencing logic

The order is chosen to keep the two risks — **trust** and **cash** — always answered:
- Phase 1 sells pilots (cash) with the deterministic engine only (no AI-trust risk).
- Phase 2 adds AI *after* the review-gate UX is battle-tested with real clients.
- Phase 3 adds scale features only after retention is proven by the managed-service annuity.

## 6.3 Risk register

| # | Risk | Likelihood | Impact | Mitigation |
|---|---|---|---|---|
| R1 | **AI mis-maps silently** → wrong number reaches the board → credibility death | Med | Fatal | Human gate is architectural (no commit without review); confidence thresholds; golden-dataset regression; lineage makes every error traceable & correctable post-hoc; insurance: bronze keeps originals |
| R2 | **"Any Excel" over-promise** → Tier-3 files create expectation debt | High | High | Tier framing in every sale (§2.6); Tier-3 is priced consultant scope; demo only with pre-screened client files |
| R3 | **Incumbent response** (Microsoft/Fabric data agents improving fast) | Med | Med | Own the group semantic model + delivery relationship; integrate with (not fight) the client's Microsoft estate; moat = mapping knowledge base + service trust |
| R4 | **Security objection stalls deals** | Med | High | RLS by design; regional hosting cells; audit log; SOC 2 path on roadmap; offer single-tenant/VPC deploys for paranoid buyers |
| R5 | **Key-person dependency** (you are the product, delivery and sales) | High | High | Runbooks + review console make delivery delegable (Phase 1 includes them); certify associates in Year 2 |
| R6 | **Scope creep into bespoke BI** | High | Med | Fixed-price packages; "new board = template config, new concept = change order"; the offer ladder exists precisely to price ambiguity |
| R7 | **Data residency / regulation shifts** (esp. GCC) | Med | Med | Hosting cells; data export guarantee (Parquet) turns compliance into a config, not a rebuild |
| R8 | **Cost blowout on LLM inference at scale** | Low | Med | Ensemble design: rules first (free), embeddings (cheap), LLM only the residue; per-file cost budget tracked from Phase 1 |

## 6.4 Immediate next actions (next 30 days)

1. **Demo-data refresh:** load the prototype with one *real* anonymised file set from a target group (with permission) — a live demo of their own data closes.
2. **Name & entity:** shortlist names (screen trademarks): candidates beyond *Meridian AI* — *Consolidia, GroupLens, OneLedger OS, Datarium*. Register domain + company if proceeding.
3. **Three Diagnostic conversations:** use the demo script (§5.3) with three group networks in your market; price the Diagnostic at a level that gets a yes without approval chains.
4. **Decide the build path:** if you are not the builder, hand §2 + §3 to a development partner as the specification — they are written to be buildable as-is.
5. **Golden dataset v0:** save every messy file you encounter for the next 90 days, with the correct mapping written down — this becomes both the demo corpus and the evaluation harness.

## 6.5 Working-title alternatives

Meridian AI · Consolidia · GroupIQ · Datarium · OneSurface · Ledgerscope · Unify Group Reporting — run trademark screening before any external use; "Meridian" is used throughout this package only as the repo's existing brand.
