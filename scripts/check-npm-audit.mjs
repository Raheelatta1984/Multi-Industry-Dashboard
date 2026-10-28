#!/usr/bin/env node
import { readFileSync } from "node:fs";

const [, , reportPath = "npm-audit.json", allowlistPath = ".security-audit-allowlist.json"] =
  process.argv;

function readJson(path) {
  try {
    return JSON.parse(readFileSync(path, "utf8"));
  } catch (error) {
    console.error(`[npm-audit] cannot read JSON report ${path}: ${error.message}`);
    process.exitCode = 2;
    return null;
  }
}

const report = readJson(reportPath);
const allowlist = readJson(allowlistPath);
if (!report || !allowlist) process.exit(2);

const today = new Date().toISOString().slice(0, 10);
const findings = [];
const allowed = [];

for (const [name, vulnerability] of Object.entries(report.vulnerabilities ?? {})) {
  if (!["high", "critical"].includes(vulnerability.severity)) continue;

  const advisoryIds = (vulnerability.via ?? [])
    .filter((entry) => entry && typeof entry === "object" && entry.source != null)
    .map((entry) => Number(entry.source));
  const exception = allowlist[name];
  const exceptionIsCurrent = exception && typeof exception.expires === "string" && exception.expires >= today;
  const exceptionCoversAll =
    exceptionIsCurrent &&
    Array.isArray(exception.advisories) &&
    advisoryIds.length > 0 &&
    advisoryIds.every((id) => exception.advisories.includes(id));

  if (exceptionCoversAll) {
    allowed.push(`${name} (${advisoryIds.join(", ")}) expires ${exception.expires}`);
    continue;
  }

  findings.push({
    name,
    severity: vulnerability.severity,
    advisories: advisoryIds,
    fixAvailable: Boolean(vulnerability.fixAvailable),
  });
}

for (const item of findings) {
  console.error(
    `[npm-audit] ${item.severity} vulnerability remains in ${item.name}` +
      (item.advisories.length ? ` (advisories: ${item.advisories.join(", ")})` : ""),
  );
}
for (const item of allowed) console.warn(`[npm-audit] allowlisted exception: ${item}`);

if (findings.length > 0) process.exit(1);
console.log(`[npm-audit] high/critical policy passed (${allowed.length} documented exception(s))`);
