#!/usr/bin/env node

import fs from "node:fs/promises";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";

const REVIEW_REPORT = "reports/hermes-agent/state/openclaw-promotion-review-gate-latest.json";
const APPLY_REPORT = "reports/hermes-agent/state/openclaw-promotion-apply-gate-latest.json";
const APPLY_POLICY = ".openclaw/control-plane/promotion-apply-gate-policy.md";
const PROMOTED_LEDGER = ".openclaw/memory/shared/promoted-memory-ledger.jsonl";

function parseArgs(argv) {
  const options = { repoRoot: process.cwd(), json: false, applyApproved: false };
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === "--repo-root") {
      options.repoRoot = argv[index + 1];
      index += 1;
    } else if (arg === "--apply-approved") {
      options.applyApproved = true;
    } else if (arg === "--json") {
      options.json = true;
    } else if (arg === "--help" || arg === "-h") {
      options.help = true;
    }
  }
  return options;
}

function helpText() {
  return [
    "OpenClaw promotion apply gate",
    "",
    "Usage:",
    "  node scripts/openclaw-promotion-apply-gate.mjs [--apply-approved] [--json]",
    "",
    "Applies only approve-ready review candidates. Pending candidates are blocked and no ledger is written.",
  ].join("\n");
}

async function readJson(filePath) {
  return JSON.parse((await fs.readFile(filePath, "utf8")).replace(/^\uFEFF/u, ""));
}

async function appendJsonl(filePath, object) {
  await fs.mkdir(path.dirname(filePath), { recursive: true });
  await fs.appendFile(filePath, `${JSON.stringify(object)}\n`);
}

function applyDecision(review, applyApproved) {
  if (!applyApproved) return "blocked-apply-flag-missing";
  if (review.decision !== "approve-ready-requires-operator-promotion") {
    return "blocked-review-not-approve-ready";
  }
  if (review.safety?.separatePromotionStepRequired !== true) {
    return "blocked-missing-separate-promotion-contract";
  }
  return "applied-to-promoted-ledger";
}

function buildPolicyText(report) {
  return [
    "# OpenClaw Promotion Apply Gate Policy",
    "",
    "Purpose: provide an operator-owned final apply step for reviewed memory/routing learning candidates.",
    "",
    "Rules:",
    "- Default action is blocked.",
    "- `--apply-approved` is required.",
    "- Review decision must be `approve-ready-requires-operator-promotion`.",
    "- Pending candidates must not be written to promoted memory.",
    "- This gate writes only the promoted-memory ledger entry; it does not mutate skills, agents, routing registries, or runtime state.",
    "- Runtime mutation, agent start, direct deletion, and live trading are forbidden.",
    "",
    "Machine summary:",
    "",
    "```text",
    report.summary.machineLine,
    "```",
    "",
  ].join("\n");
}

export async function buildPromotionApplyGate({ repoRoot = process.cwd(), applyApproved = false } = {}) {
  const root = path.resolve(repoRoot);
  const review = await readJson(path.join(root, REVIEW_REPORT));
  const decision = applyDecision(review, applyApproved);
  const applied = decision === "applied-to-promoted-ledger";
  const promotedRecord = {
    schema: "openclaw.promoted-memory-ledger-entry.v1",
    generatedAt: new Date().toISOString(),
    candidateId: review.candidate.id,
    sourceReview: REVIEW_REPORT,
    appliedBy: "operator-owned-promotion-apply-gate",
    summary: review.candidate.summary,
    proposedLearning: review.candidate.proposedLearning,
    safety: {
      noRuntimeMutation: true,
      noAgentStart: true,
      noDeletion: true,
      noLiveTrading: true,
    },
  };
  const report = {
    schema: "openclaw.promotion-apply-gate.v1",
    generatedAt: new Date().toISOString(),
    repoRoot: root,
    sources: {
      reviewReport: REVIEW_REPORT,
      promotedLedger: PROMOTED_LEDGER,
    },
    outputs: {
      applyReport: APPLY_REPORT,
      policy: APPLY_POLICY,
      promotedLedger: PROMOTED_LEDGER,
    },
    input: {
      applyApproved,
      reviewDecision: review.decision,
      candidateId: review.candidate.id,
    },
    decision,
    applied,
    promotedRecord: applied ? promotedRecord : null,
    safety: {
      operatorOwned: true,
      noRuntimeMutation: true,
      noAgentStart: true,
      noExecution: true,
      noDeletion: true,
      noLiveTrading: true,
      blockedUnlessApproveReady: true,
    },
    summary: {
      machineLine: `promotionApplyGate=ready candidate=${review.candidate.id} decision=${decision} applied=${applied} noRuntimeMutation=true`,
    },
  };

  await fs.mkdir(path.dirname(path.join(root, APPLY_REPORT)), { recursive: true });
  await fs.writeFile(path.join(root, APPLY_REPORT), `${JSON.stringify(report, null, 2)}\n`);
  await fs.mkdir(path.dirname(path.join(root, APPLY_POLICY)), { recursive: true });
  await fs.writeFile(path.join(root, APPLY_POLICY), buildPolicyText(report));
  if (applied) {
    await appendJsonl(path.join(root, PROMOTED_LEDGER), promotedRecord);
  }
  return report;
}

function formatReport(report) {
  return [
    "OpenClaw promotion apply gate",
    `Candidate: ${report.input.candidateId}`,
    `Decision: ${report.decision}`,
    `Applied: ${report.applied}`,
    `Report: ${report.outputs.applyReport}`,
    report.summary.machineLine,
  ].join("\n");
}

async function main() {
  const options = parseArgs(process.argv.slice(2));
  if (options.help) {
    console.log(helpText());
    return;
  }
  const report = await buildPromotionApplyGate(options);
  console.log(options.json ? JSON.stringify(report, null, 2) : formatReport(report));
}

if (process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1])) {
  main().catch((error) => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  });
}
