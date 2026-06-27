#!/usr/bin/env node

import fs from "node:fs";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";

const APPLY_REPORT = "reports/hermes-agent/state/openclaw-promotion-apply-gate-latest.json";
const APPLY_POLICY = ".openclaw/control-plane/promotion-apply-gate-policy.md";
const PROMOTED_LEDGER = ".openclaw/memory/shared/promoted-memory-ledger.jsonl";

function parseArgs(argv) {
  const options = { repoRoot: process.cwd(), json: false };
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === "--repo-root") {
      options.repoRoot = argv[index + 1];
      index += 1;
    } else if (arg === "--json") {
      options.json = true;
    }
  }
  return options;
}

function readJson(filePath) {
  return JSON.parse(fs.readFileSync(filePath, "utf8").replace(/^\uFEFF/u, ""));
}

function add(checks, id, ok, message) {
  checks.push({ id, status: ok ? "pass" : "fail", message });
}

function promotedContains(filePath, candidateId) {
  if (!fs.existsSync(filePath)) return false;
  return fs
    .readFileSync(filePath, "utf8")
    .split(/\r?\n/u)
    .filter(Boolean)
    .some((line) => {
      try {
        const entry = JSON.parse(line);
        return entry.candidateId === candidateId || entry.id === candidateId;
      } catch {
        return false;
      }
    });
}

export function buildReport({ repoRoot = process.cwd() } = {}) {
  const root = path.resolve(repoRoot);
  const checks = [];
  const reportFile = path.join(root, APPLY_REPORT);
  const policyFile = path.join(root, APPLY_POLICY);
  const promotedFile = path.join(root, PROMOTED_LEDGER);

  add(checks, "apply-report-exists", fs.existsSync(reportFile), `${APPLY_REPORT} exists`);
  add(checks, "policy-exists", fs.existsSync(policyFile), `${APPLY_POLICY} exists`);
  add(checks, "promoted-ledger-exists", fs.existsSync(promotedFile), `${PROMOTED_LEDGER} exists`);
  if (!fs.existsSync(reportFile)) return finish(root, checks);

  const report = readJson(reportFile);
  add(checks, "schema", report.schema === "openclaw.promotion-apply-gate.v1", "apply gate schema is v1");
  add(checks, "operator-owned", report.safety?.operatorOwned === true, "apply gate is operator-owned");
  for (const key of [
    "noRuntimeMutation",
    "noAgentStart",
    "noExecution",
    "noDeletion",
    "noLiveTrading",
    "blockedUnlessApproveReady",
  ]) {
    add(checks, `safety:${key}`, report.safety?.[key] === true, `${key}=true`);
  }
  add(checks, "candidate-id", typeof report.input?.candidateId === "string" && report.input.candidateId.startsWith("feedback:"), "candidate id present");
  add(checks, "pending-is-blocked", report.input?.reviewDecision !== "approve-ready-requires-operator-promotion" ? report.applied === false : true, "non approve-ready review is not applied");
  add(
    checks,
    "decision-valid",
    ["blocked-apply-flag-missing", "blocked-review-not-approve-ready", "blocked-missing-separate-promotion-contract", "applied-to-promoted-ledger"].includes(report.decision),
    `decision ${report.decision} is valid`,
  );
  add(checks, "promoted-record-null-when-blocked", report.applied === true || report.promotedRecord === null, "blocked apply has no promoted record");
  add(
    checks,
    "promoted-ledger-not-written-when-blocked",
    report.applied === true || !promotedContains(promotedFile, report.input.candidateId),
    "blocked candidate not in promoted ledger",
  );
  const machineLine = report.summary?.machineLine ?? "";
  for (const token of ["promotionApplyGate=ready", "applied=false", "noRuntimeMutation=true"]) {
    add(checks, `machine-line:${token}`, machineLine.includes(token), `machine line includes ${token}`);
  }

  return finish(root, checks);
}

function finish(repoRoot, checks) {
  const total = checks.length;
  const passed = checks.filter((check) => check.status === "pass").length;
  const failed = total - passed;
  return { repoRoot, reportPath: APPLY_REPORT, checks, summary: { total, passed, failed, ok: failed === 0 } };
}

function formatReport(report) {
  const lines = [
    "OpenClaw promotion apply gate",
    `Repo: ${report.repoRoot}`,
    `Report: ${report.reportPath}`,
    `Summary: ${report.summary.passed}/${report.summary.total} passed, ${report.summary.failed} failed`,
  ];
  for (const check of report.checks) {
    const mark = check.status === "pass" ? "[PASS]" : "[FAIL]";
    lines.push(`${mark} ${check.id} - ${check.message}`);
  }
  return lines.join("\n");
}

async function main() {
  const options = parseArgs(process.argv.slice(2));
  const report = buildReport(options);
  console.log(options.json ? JSON.stringify(report, null, 2) : formatReport(report));
  if (!report.summary.ok) process.exitCode = 1;
}

if (process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1])) {
  main().catch((error) => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  });
}
