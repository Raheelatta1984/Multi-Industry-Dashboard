# 1 · Vision & Problem

## 1.1 The product in one sentence

**Meridian AI is a group-reporting platform where anyone can drop any spreadsheet into an AI-powered data warehouse, and leadership gets governed, drillable dashboards across every industry, entity and department in the group.**

Three claims are packed into that sentence, and each is a pillar:

1. **Any spreadsheet.** No template, no naming conventions, no data engineer. The AI profiles, cleans and maps the file (Alteryx-class data preparation) and asks a human to confirm before committing.
2. **One internal warehouse.** Raw files never touch dashboards. Everything lands in a canonical, multi-entity, multi-currency model with lineage back to source — the "AI-powered data warehouse" of the brief.
3. **Leadership-grade output.** Not analyst workbenches: executive command centers, department boards, natural-language Q&A, exports. Built for the group boardroom, priced for the mid-market.

## 1.2 The problem, precisely

Group companies and mid-market conglomerates — the "group of companies" you intend to serve — share a pathological data pattern:

- **Fragmentation by history.** Each entity grew its own systems: an ERP here, a POS there, HR in spreadsheets, finance in email attachments. Twelve entities means twelve dialects of "revenue."
- **Excel as the de facto integration layer.** Monthly reporting is a ritual of exporting, pasting, fixing `#REF!`, and re-keying. The group CFO's "data warehouse" is a folder of 200 Excel files with no lineage.
- **No data team.** A 300–3,000-person group cannot justify (or retain) a platform engineering team. The skills that run Alteryx, dbt or Fabric simply are not on payroll.
- **Tools that assume the opposite.** Enterprise data-prep and BI platforms assume trained analysts, clean governed sources, and five-figure annual seats. When a group does buy them, licences decay into shelfware after the implementing consultant leaves — because nobody internally can maintain the pipelines.

The result is the same everywhere: group leadership makes capital-allocation decisions on numbers that are months old, manually assembled, and impossible to drill into or audit.

## 1.3 Why the incumbents leave this gap open

| Incumbent approach | Why it misses the group mid-market |
|---|---|
| **Alteryx** (data prep, 300+ drag-and-drop tools, 8,300+ customers) | Priced and designed for enterprises with $100K–500K analytics budgets and dedicated analyst teams; taken private by Clearlake/Insight in a $4.4B deal in March 2024, which typically shifts focus to profitability and pricing discipline. Workflow *building* is the product — someone still has to build. |
| **Microsoft Fabric / Power BI** | Excellent once data is modelled — but the modelling, cleaning and mapping is exactly the work the group cannot do. Copilot and data agents are arriving fast for enterprises already inside the Microsoft estate. |
| **Databricks / Snowflake** | Engineering-first platforms; a group without data engineers cannot operationalise them. Their AI features (Cortex, Agent Bricks, AI/BI Genie) target companies that already have a platform team. |
| **Fivetran / Airbyte / dbt** | Move and transform data but assume a target model exists and someone owns it. Pipelines, not outcomes. |
| **ThoughtSpot / NL BI layers** | Answer questions *after* the warehouse exists. They do not build the warehouse. |

The gap: **nobody sells "bring us your messy spreadsheets, we'll give the board one trustworthy surface" as a productised, consultant-led outcome at group scale.** The technology to do it became viable only recently (LLM-based schema mapping, embedding-based synonym matching, cheap hosted warehouses) — which is why the gap still exists.

## 1.4 Personas

| Persona | Pain | What they need from Meridian AI |
|---|---|---|
| **Group CFO / Chairman** | Cannot compare entities; numbers arrive late and pre-filtered | One command center; drill from group → industry → entity → department in two clicks; trust indicator on every number |
| **Entity finance director** | Wastes days a month reformatting group templates | "Just drop the file" ingestion; the AI handles formats, currencies, charts of accounts |
| **Group analyst / FP&A** | Owns a folder of Excel Sisyphus tasks | The pipeline does the merging, deduping, FX; they review mappings once and never again |
| **IT / security officer** | Fears shadow IT and data leakage | Tenancy, role-based access by entity/department, audit log, on-prem or regional hosting option |
| **The data consultant (you)** | Sells hours, competes with other integrators | A repeatable product that makes every engagement faster, stickier and margin-accretive |

## 1.5 Jobs-to-be-done

- *"When I receive the monthly pack from 10 entities in 10 formats, I want to produce one consolidated leadership dashboard by the next morning, so the board stops making decisions on stale numbers."*
- *"When a new subsidiary joins the group, I want their historical Excel files onboarded in a week, so we can compare them to everyone else from day one."*
- *"When a number on a board looks wrong, I want to trace it to the source file and the transformations applied, so I can defend it in the board meeting."*
- *"When I ask 'which entity has the best margin?', I want an answer from governed data — not from whoever shouts loudest."*

## 1.6 Why now

1. **LLM-based mapping is production-viable.** Schema matching, synonym detection and value coercion are now solvable with an ensemble of deterministic rules + embeddings + an LLM for the ambiguous residue — at cents per file.
2. **The market is growing into this.** Data-integration spending is growing ~13% a year, and the data-preparation segment — the exact category — is growing ~19% a year, explicitly driven by AI-enabled data preparation (see §4).
3. **Incumbent pricing is drifting up, not down.** Alteryx under PE ownership, enterprise Fabric commitments — the mid-market is being priced out of the tools that were already too heavy for it.
4. **Group structures dominate emerging markets.** In the GCC, South Asia, Africa and family-office conglomerates worldwide, the group-of-companies structure is the norm — and it is the exact shape this product is designed around.

## 1.7 What "winning" looks like

A group signs with one entity and one department. Within a quarter, the CFO asks "can we do this for all entities?" — and each new entity is a configuration exercise, not a project. The consultant's delivery margin improves every quarter because the mapping knowledge base compounds: every confirmed mapping makes the next file from that industry cheaper to onboard. That compounding asset — *the learned semantic mappings per industry* — is the defensible moat.
