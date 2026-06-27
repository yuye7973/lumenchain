#!/usr/bin/env node

import fs from "node:fs";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";

const REVIEW_REPORT = "reports/hermes-agent/state/openclaw-promotion-review-gate-latest.json";
const REVIEW_POLICY = ".openclaw/control-plane/promotion-review-gate-policy.md";
const DEBATE_LEDGER = ".openclaw/memory/evolution/debate-ledger.jsonl";
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

function jsonlContains(filePath, predicate) {
  if (!fs.existsSync(filePath)) return false;
  return fs
    .readFileSync(filePath, "utf8")
    .split(/\r?\n/u)
    .filter(Boolean)
    .some((line) => {
      try {
        return predicate(JSON.parse(line));
      } catch {
        return false;
      }
    });
}

export function buildReport({ repoRoot = process.cwd() } = {}) {
  const root = path.resolve(repoRoot);
  const checks = [];
  const reviewFile = path.join(root, REVIEW_REPORT);
  const policyFile = path.join(root, REVIEW_POLICY);
  const debateFile = path.join(root, DEBATE_LEDGER);
  const promotedFile = path.join(root, PROMOTED_LEDGER);

  add(checks, "review-report-exists", fs.existsSync(reviewFile), `${REVIEW_REPORT} exists`);
  add(checks, "policy-exists", fs.existsSync(policyFile), `${REVIEW_POLICY} exists`);
  add(checks, "debate-ledger-exists", fs.existsSync(debateFile), `${DEBATE_LEDGER} exists`);
  add(checks, "promoted-ledger-exists", fs.existsSync(promotedFile), `${PROMOTED_LEDGER} exists`);
  if (!fs.existsSync(reviewFile)) return finish(root, checks);

  const review = readJson(reviewFile);
  add(checks, "schema", review.schema === "openclaw.promotion-review-gate.v1", "review schema is v1");
  add(checks, "candidate-id", typeof review.candidate?.id === "string" && review.candidate.id.startsWith("feedback:"), "candidate id present");
  add(
    checks,
    "decision-safe-default",
    ["pending-operator-review", "approve-ready-requires-operator-promotion", "rejected-by-review"].includes(review.decision),
    `decision ${review.decision} is valid`,
  );
  add(checks, "no-direct-promote", review.candidate?.mayPromoteDirectly === false, "candidate cannot promote directly");
  for (const key of [
    "reviewOnly",
    "noPromotionWritten",
    "noRuntimeMutation",
    "noAgentStart",
    "noExecution",
    "noDeletion",
    "noLiveTrading",
    "separatePromotionStepRequired",
  ]) {
    add(checks, `safety:${key}`, review.safety?.[key] === true, `${key}=true`);
  }
  add(checks, "evidence-present", review.evidence?.allRequiredEvidencePresent === true, "required evidence present");
  add(checks, "evidence-count", review.evidence?.presentEvidenceCount === review.evidence?.requiredEvidenceCount, "all evidence checks passed");
  add(
    checks,
    "debate-record-jsonl",
    jsonlContains(debateFile, (entry) => entry.candidateId === review.candidate.id && entry.decision === review.decision),
    "debate ledger contains review decision",
  );
  add(
    checks,
    "promoted-ledger-not-written-by-default",
    !jsonlContains(promotedFile, (entry) => entry.candidateId === review.candidate.id || entry.id === review.candidate.id),
    "candidate not written to promoted ledger by default",
  );
  const machineLine = review.summary?.machineLine ?? "";
  for (const token of ["promotionReviewGate=ready", "noPromotionWritten=true", "reviewOnly=true"]) {
    add(checks, `machine-line:${token}`, machineLine.includes(token), `machine line includes ${token}`);
  }

  return finish(root, checks);
}

function finish(repoRoot, checks) {
  const total = checks.length;
  const passed = checks.filter((check) => check.status === "pass").length;
  const failed = total - passed;
  return { repoRoot, reportPath: REVIEW_REPORT, checks, summary: { total, passed, failed, ok: failed === 0 } };
}

function formatReport(report) {
  const lines = [
    "OpenClaw promotion review gate",
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

function isDirectRun() {
  if (!process.argv[1]) return false;
  try {
    return fs.realpathSync.native(process.argv[1]) === fs.realpathSync.native(fileURLToPath(import.meta.url));
  } catch {
    return fileURLToPath(import.meta.url) === path.resolve(process.argv[1]);
  }
}

if (isDirectRun()) {
  main().catch((error) => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  });
}
