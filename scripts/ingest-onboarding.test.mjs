/**
 * Onboarding gate, commit readiness and the onboarding log, exercised against
 * the real ingest store. The TypeScript modules are loaded through Vite's SSR
 * loader so this runs under `node --test` without a browser.
 */
import test, { before, after } from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const require = createRequire(join(ROOT, "package.json"));

let server;
let mods;

before(async () => {
  const { createServer } = await import(require.resolve("vite"));
  server = await createServer({
    root: ROOT,
    configFile: false,
    logLevel: "silent",
    appType: "custom",
    server: { middlewareMode: true, hmr: false, watch: null },
    optimizeDeps: { noDiscovery: true, include: [] },
    resolve: { alias: { "@": join(ROOT, "src") } },
  });
  const load = (p) => server.ssrLoadModule(p);
  mods = {
    samples: await load("/src/lib/ingest/samples.ts"),
    ingest: await load("/src/lib/ingest/store.ts"),
    app: await load("/src/lib/store.ts"),
    preflight: await load("/src/lib/ingest/preflight.ts"),
    onboarding: await load("/src/lib/ingest/onboarding.ts"),
    semantic: await load("/src/lib/ingest/semantic.ts"),
    log: await load("/src/lib/ingest/log.ts"),
  };
});

after(async () => {
  await server?.close();
});

const xlsx = createRequire(join(ROOT, "package.json"))("xlsx");

/** A real .xlsx in memory, as the upload path receives it. */
function workbookBuffer(aoa) {
  const ws = xlsx.utils.aoa_to_sheet(aoa);
  const wb = xlsx.utils.book_new();
  xlsx.utils.book_append_sheet(wb, ws, "Sheet1");
  return xlsx.write(wb, { type: "array", bookType: "xlsx" });
}

function store() {
  return mods.ingest.useIngestStore;
}

function reset() {
  store().getState().clearActive();
  store().getState().clearLogs();
}

/** Answers a reviewer gives for a single-company, single-department file. */
const SINGLE = {
  sourceKind: "upload",
  purpose: "monthly_reporting",
  entityScope: "single",
  entities: ["Retail"],
  entitiesConfirmed: true,
  departmentScope: "single",
  departments: ["Finance"],
  departmentsConfirmed: true,
  fieldsConfirmed: true,
};

test("the sample sales file is refused until onboarding is confirmed, then commits once", () => {
  reset();
  const sample = mods.samples.MESSY_SAMPLES.find((s) => s.id === "sales-q3");
  const ing = store();
  const run = ing.getState().ingestGrid(sample.fileName, "Export", sample.grid);
  const companies = mods.onboarding
    .detectEntities(run.cleaned, run.mappings)
    .map((e) => e.label)
    .filter(Boolean);
  ing.getState().patchOnboarding({
    ...SINGLE,
    entityScope: "multiple",
    entities: companies,
    departmentScope: "single",
    departments: ["Sales"],
  });

  const early = ing.getState().publish();
  assert.equal(early.ok, false, "publish must refuse before the profile is confirmed");
  const gate = early.blockers.find((b) => b.id === "summary");
  assert.ok(gate, "the refusal names the unconfirmed profile");
  assert.match(gate.fix, /Confirm onboarding/);

  ing.getState().patchOnboarding({ summaryConfirmed: true });
  const before = mods.app.useAppStore.getState().workbook.sales.length;
  const ok = ing.getState().publish();
  assert.equal(ok.ok, true);
  assert.equal(ok.run.result.rowsCommitted, 38);
  assert.equal(mods.app.useAppStore.getState().workbook.sales.length - before, 38);

  const again = ing.getState().publish();
  assert.equal(again.ok, true, "committing the same file again is allowed");
  assert.equal(again.run.result.report.added, 0, "re-committing identical rows adds nothing");

  const logs = ing.getState().logs;
  assert.ok(logs.some((l) => l.level === "error" && l.stage === "commit" && l.fix), "refusal is logged with a fix");
  assert.ok(logs.some((l) => l.level === "success" && /^Committed 38 rows/.test(l.title)), "success is logged");
});

test("a file without recognisable headers is refused with the reason, then onboards once a model is chosen", () => {
  reset();
  const ing = store();
  const buffer = workbookBuffer([
    ["Branch Name", "Reporting Month", "Takings (GBP)", "Staff Count"],
    ["Leeds", "Jan 2026", 18250, 12],
    ["York", "Feb 2026", 16400, 9],
  ]);
  const run = ing.getState().ingestBuffer("branch-takings.xlsx", buffer);
  assert.equal(run.domain?.domain ?? null, null, "no domain is inferred from these headers");
  ing.getState().patchOnboarding({ ...SINGLE, summaryConfirmed: true });

  const refused = ing.getState().publish();
  assert.equal(refused.ok, false);
  const model = refused.blockers.find((b) => b.id === "model");
  assert.ok(model, "the missing target model is named");
  assert.match(model.fix, /Target model/);

  ing.getState().setDomain("revenue");
  const amount = mods.preflight
    .evaluateCommit(ing.getState().active, ing.getState().onboarding, mods.app.useAppStore.getState().workbook)
    .blockers.find((b) => b.id === "req-amount");
  assert.ok(amount, "revenue needs an amount");
  assert.match(amount.fix, /takings_gbp/, "the fix points at the column that looks like the amount");

  ing.getState().overrideMapping("takings_gbp", "amount");
  const plan = mods.preflight.evaluateCommit(
    ing.getState().active,
    ing.getState().onboarding,
    mods.app.useAppStore.getState().workbook,
  );
  assert.equal(plan.ready, true, `expected ready, blockers: ${plan.blockers.map((b) => b.title).join("; ")}`);
  assert.ok(
    plan.plan.workbook.revenue.every((r) => r.industry === "retail" && r.department === "finance"),
    "the single-company and single-department answers apply to rows that have no value of their own",
  );

  const ok = ing.getState().publish();
  assert.equal(ok.ok, true);
  assert.equal(ok.run.result.rowsCommitted, 2);
});

test("a single-company answer does not overwrite a company the file names", () => {
  reset();
  const ing = store();
  const sample = mods.samples.MESSY_SAMPLES.find((s) => s.id === "sales-q3");
  ing.getState().ingestGrid(sample.fileName, "Export", sample.grid);
  ing.getState().patchOnboarding({ ...SINGLE, summaryConfirmed: true, departmentScope: "single", departments: ["Sales"] });
  const ev = mods.preflight.evaluateCommit(
    ing.getState().active,
    ing.getState().onboarding,
    mods.app.useAppStore.getState().workbook,
  );
  const names = ev.checks.find((c) => c.id === "scope-company");
  assert.ok(names, "a single-company answer on a multi-company file is flagged");
  assert.equal(names.level, "warn");
  assert.match(names.fix, /Multiple companies/);
  assert.ok(
    ev.plan.workbook.sales.some((r) => r.industry !== "retail"),
    "rows that name their own company keep it",
  );
});

test("US region names map to AMER, not to the EMEA default", () => {
  for (const v of ["US East", "US West", "U.S. West", "USA - Texas"]) {
    assert.equal(mods.semantic.coerceRegion(v).value, "AMER", v);
  }
  assert.equal(mods.semantic.coerceRegion("UAE").value, "EMEA");
  assert.equal(mods.semantic.coerceRegion("Atlantis").value, null);
});

test("a field takes one column: mapping a second column to it frees the first", () => {
  reset();
  const ing = store();
  ing.getState().ingestBuffer(
    "branch.xlsx",
    workbookBuffer([
      ["Branch Name", "Reporting Month", "Takings (GBP)", "Staff Count"],
      ["Leeds", "Jan 2026", 18250, 12],
    ]),
  );
  ing.getState().setDomain("revenue");
  ing.getState().overrideMapping("takings_gbp", "amount");
  ing.getState().overrideMapping("staff_count", "amount");
  const mappings = ing.getState().active.mappings;
  assert.deepEqual(
    mappings.filter((m) => m.target === "amount").map((m) => m.column),
    ["staff_count"],
  );
  assert.equal(mappings.find((m) => m.column === "takings_gbp").target, null);
  assert.ok(
    ing.getState().logs.some((l) => /no longer feeds/.test(l.detail ?? "")),
    "the displaced column is named in the log",
  );
});

test("a correction replaces the existing row only when the purpose says so", () => {
  reset();
  const ing = store();
  const sample = mods.samples.MESSY_SAMPLES.find((s) => s.id === "sales-q3");
  const companies = ["Technology", "Energy", "Retail", "Logistics", "Healthcare"];
  const answers = { ...SINGLE, entityScope: "multiple", entities: companies, departmentScope: "single", departments: ["Sales"], summaryConfirmed: true };

  ing.getState().ingestGrid(sample.fileName, "Export", sample.grid);
  ing.getState().patchOnboarding(answers);
  assert.equal(ing.getState().publish().ok, true);
  ing.getState().clearActive();

  const corrected = JSON.parse(JSON.stringify(sample.grid));
  const qtyCol = corrected[1].indexOf("Qty");
  const row = corrected.findIndex((r, i) => i > 1 && typeof r[qtyCol] === "number");
  corrected[row][qtyCol] = corrected[row][qtyCol] + 5;

  ing.getState().ingestGrid(sample.fileName, "Export", corrected);
  ing.getState().patchOnboarding({ ...answers, purpose: "monthly_reporting" });
  const asMonthly = mods.preflight.evaluateCommit(
    ing.getState().active,
    ing.getState().onboarding,
    mods.app.useAppStore.getState().workbook,
  );
  assert.equal(asMonthly.possibleDuplicates, 1, "a changed figure is reported as a possible double count");
  assert.ok(asMonthly.checks.some((c) => c.id === "possible-duplicates" && /Correct \/ replace/.test(c.fix)));

  ing.getState().patchOnboarding({ purpose: "replace_data" });
  const replaced = ing.getState().publish();
  assert.equal(replaced.ok, true);
  assert.equal(replaced.run.result.report.updated, 1);
  assert.equal(replaced.run.result.report.added, 0);
  assert.equal(replaced.run.result.rowsReplaced, 1);
});

test("an unreadable file is logged with what to do next", () => {
  reset();
  assert.throws(() => store().getState().ingestBuffer("empty.xlsx", new ArrayBuffer(0)));
  const entry = store()
    .getState()
    .logs.find((l) => l.level === "error" && l.stage === "intake");
  assert.ok(entry, "the failure is in the log");
  assert.match(entry.fix, /Save the file as \.xlsx or \.csv/);
});

test("the log names the steps and the text export keeps the fixes", () => {
  reset();
  const ing = store();
  const run = ing.getState().ingestBuffer(
    "branch.xlsx",
    workbookBuffer([
      ["Branch Name", "Reporting Month", "Takings (GBP)", "Staff Count"],
      ["Leeds", "Jan 2026", 18250, 12],
    ]),
  );
  const stages = new Set(ing.getState().logs.filter((l) => l.runId === run.id).map((l) => l.stage));
  for (const stage of ["intake", "profile", "clean", "model", "map"]) {
    assert.ok(stages.has(stage), `log has a ${stage} entry`);
  }
  ing.getState().setDomain("revenue");
  const text = mods.log.logToText(ing.getState().logs);
  assert.match(text, /Target model set to Revenue \/ income by reviewer/);
  assert.match(text, /Fix: Map “takings_gbp” to Amount/);
});
