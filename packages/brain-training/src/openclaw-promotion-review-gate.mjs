#!/usr/bin/env node

import fs from "node:fs/promises";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";

const FEEDBACK_REPORT = "reports/hermes-agent/state/openclaw-intelligence-feedback-loop-latest.json";
const REVIEW_REPORT = "reports/hermes-agent/state/openclaw-promotion-review-gate-latest.json";
const REVIEW_POLICY = ".openclaw/control-plane/promotion-review-gate-policy.md";
const DEBATE_LEDGER = ".openclaw/memory/evolution/debate-ledger.jsonl";
const PROMOTED_LEDGER = ".openclaw/memory/shared/promoted-memory-ledger.jsonl";

function parseArgs(argv) {
  const options = { repoRoot: process.cwd(), json: false, approve: false, reject: false };
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === "--repo-root") {
      options.repoRoot = argv[index + 1];
      index += 1;
    } else if (arg === "--approve") {
      options.approve = true;
    } else if (arg === "--reject") {
      options.reject = true;
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
    "OpenClaw promotion review gate",
    "",
    "Usage:",
    "  node scripts/openclaw-promotion-review-gate.mjs [--approve|--reject] [--json]",
    "",
    "Reviews intelligence feedback candidates. Default is pending review and no promotion.",
  ].join("\n");
}

async function readJson(filePath) {
  return JSON.parse((await fs.readFile(filePath, "utf8")).replace(/^\uFEFF/u, ""));
}

async function pathExists(filePath) {
  try {
    await fs.stat(filePath);
    return true;
  } catch {
    return false;
  }
}

async function appendJsonl(filePath, object) {
  await fs.mkdir(path.dirname(filePath), { recursive: true });
  await fs.appendFile(filePath, `${JSON.stringify(object)}\n`);
}

function decide({ feedback, approve, reject, evidence }) {
  if (approve) {
    if (evidence.allRequiredEvidencePresent && feedback.memoryCandidate?.mayPromoteDirectly === false) {
      return "approve-ready-requires-operator-promotion";
    }
    return "blocked-missing-evidence";
  }
  if (reject) return "rejected-by-review";
  return "pending-operator-review";
}

function buildPolicyText(report) {
  return [
    "# OpenClaw Promotion Review Gate Policy",
    "",
    "Purpose: review intelligence feedback candidates before they can influence shared memory, routing, skills, agents, or runtime behavior.",
    "",
    "Rules:",
    "- Default decision is `pending-operator-review`.",
    "- This gate may write review reports and debate ledger records.",
    "- This gate must not write promoted memory by default.",
    "- `--approve` only marks a candidate approve-ready; a separate operator-owned promotion step is still required.",
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

export async function buildPromotionReviewGate({ repoRoot = process.cwd(), approve = false, reject = false } = {}) {
  const root = path.resolve(repoRoot);
  const feedback = await readJson(path.join(root, FEEDBACK_REPORT));
  const candidate = feedback.memoryCandidate;
  const evidencePaths = [
    feedback.sources?.dryRunReport,
    candidate?.evidence?.taskCard,
    feedback.outputs?.agentScorecard,
    feedback.outputs?.workingMemoryCandidate,
    feedback.outputs?.distillationCandidate,
  ].filter(Boolean);
  const evidenceChecks = [];
  for (const relPath of evidencePaths) {
    evidenceChecks.push({
      path: relPath,
      exists: await pathExists(path.join(root, relPath)),
    });
  }
  const evidence = {
    requiredEvidenceCount: evidenceChecks.length,
    presentEvidenceCount: evidenceChecks.filter((check) => check.exists).length,
    allRequiredEvidencePresent: evidenceChecks.every((check) => check.exists),
    checks: evidenceChecks,
  };
  const decision = decide({ feedback, approve, reject, evidence });
  const debateRecord = {
    schema: "openclaw.promotion-review-debate-record.v1",
    generatedAt: new Date().toISOString(),
    candidateId: candidate.id,
    decision,
    reasons: [
      "candidate is review-only",
      "direct promotion remains disabled",
      evidence.allRequiredEvidencePresent ? "required evidence present" : "required evidence missing",
      approve ? "operator approval flag supplied" : "operator approval flag not supplied",
    ],
    safety: {
      noPromotionWritten: true,
      noRuntimeMutation: true,
      noAgentStart: true,
      noDeletion: true,
      noLiveTrading: true,
    },
  };
  const report = {
    schema: "openclaw.promotion-review-gate.v1",
    generatedAt: new Date().toISOString(),
    repoRoot: root,
    sources: {
      feedbackReport: FEEDBACK_REPORT,
      promotedLedger: PROMOTED_LEDGER,
      debateLedger: DEBATE_LEDGER,
    },
    outputs: {
      reviewReport: REVIEW_REPORT,
      policy: REVIEW_POLICY,
      debateLedger: DEBATE_LEDGER,
    },
    candidate: {
      id: candidate.id,
      status: candidate.status,
      mayPromoteDirectly: candidate.mayPromoteDirectly,
      summary: candidate.summary,
      proposedLearning: candidate.proposedLearning,
    },
    evidence,
    decision,
    safety: {
      reviewOnly: true,
      noPromotionWritten: true,
      noRuntimeMutation: true,
      noAgentStart: true,
      noExecution: true,
      noDeletion: true,
      noLiveTrading: true,
      separatePromotionStepRequired: true,
    },
    debateRecord,
    summary: {
      machineLine: `promotionReviewGate=ready candidate=${candidate.id} decision=${decision} noPromotionWritten=true reviewOnly=true`,
    },
  };

  await fs.mkdir(path.dirname(path.join(root, REVIEW_REPORT)), { recursive: true });
  await fs.writeFile(path.join(root, REVIEW_REPORT), `${JSON.stringify(report, null, 2)}\n`);
  await fs.mkdir(path.dirname(path.join(root, REVIEW_POLICY)), { recursive: true });
  await fs.writeFile(path.join(root, REVIEW_POLICY), buildPolicyText(report));
  await appendJsonl(path.join(root, DEBATE_LEDGER), debateRecord);
  return report;
}

function formatReport(report) {
  return [
    "OpenClaw promotion review gate",
    `Candidate: ${report.candidate.id}`,
    `Decision: ${report.decision}`,
    `Report: ${report.outputs.reviewReport}`,
    report.summary.machineLine,
  ].join("\n");
}

async function main() {
  const options = parseArgs(process.argv.slice(2));
  if (options.help) {
    console.log(helpText());
    return;
  }
  const report = await buildPromotionReviewGate(options);
  console.log(options.json ? JSON.stringify(report, null, 2) : formatReport(report));
}

if (process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1])) {
  main().catch((error) => {
    console.error(error instanceof Error ? (error.stack ?? error.message) : String(error));
    process.exitCode = 1;
  });
}
