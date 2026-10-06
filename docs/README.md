# Meridian AI — Product & Market Analysis Package

**Working title:** *Meridian AI* (rename after trademark screening — alternatives in §6)
**Prepared for:** Product owner / data-consulting practice lead
**Date:** October 2026
**Companion prototype:** the app in this repository (`npm run dev`, then open `/ingest`)

---

## What this package is

You asked for a broader-level request analysis of one idea:

> *"Anyone can upload any raw Excel file; an internal AI-powered tool reviews every data point, manipulates and cleans it, performs the mapping into an internal AI-powered data warehouse, and produces dashboard visualisations for leadership — across multiple industries, entities and departments — with Alteryx-like functionality."*

This package stretches that idea into a product you can take to market as a data consultant: what to build, how it works, who buys it, what it costs, who else sells something like it, and how you sell and deliver it to group companies.

## Contents

| # | Document | What's inside |
|---|----------|---------------|
| 1 | [Vision & problem](01-vision-and-problem.md) | The market gap, personas, jobs-to-be-done, why now |
| 2 | [Requirements analysis](02-requirements-analysis.md) | The full functional & non-functional stretch of your one-paragraph brief |
| 3 | [Target architecture](03-target-architecture.md) | The AI data warehouse, the mapping engine, build-vs-buy, security |
| 4 | [Market & competition](04-market-and-competition.md) | Market sizing, competitor matrix, positioning, pricing |
| 5 | [GTM & consulting playbook](05-gtm-consulting-playbook.md) | Your service lines, packages, pricing, demo script, delivery method |
| 6 | [Roadmap & risks](06-roadmap-and-risks.md) | Phase plan from this prototype to production, risk register |
| — | [One-pager](one-pager.md) | Sales leave-behind for group decision makers |

## How to read it (10 minutes)

1. Start with the [one-pager](one-pager.md) — it is the whole story on one page.
2. If you are pitching: read 1, 4 and 5.
3. If you are building (or briefing a builder): read 2, 3 and 6.
4. Then run the prototype: `npm install && npm run dev` → open the **AI Ingest Studio** and feed it any spreadsheet you have. The messy demo files are one click away, and every AI decision — profiling, cleaning recipe, column mapping, value coercion — is inspectable and overridable before anything lands in the warehouse.

## The one-paragraph answer to "is this feasible?"

Yes — with one honest correction. "Any Excel file, fully automatically, zero human involvement" is not a product; it is a liability. The winning design (and the one prototyped here) is **AI-driven with a human approval gate**: the engine does 90–95% of the work — detects the header row, infers types, writes the cleaning recipe, maps columns onto the group semantic model, coerces messy values into controlled vocabularies — and a reviewer confirms the last mile in minutes, not days. That correction is precisely what makes the product *trustworthy enough for leadership reporting*, and it is also what makes your consulting services indispensable: you are selling certainty, not magic.
