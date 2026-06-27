import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const currentFile = fileURLToPath(import.meta.url);
export const repoRoot = path.resolve(path.dirname(currentFile), "..", "..");

export function parseEvidenceExpectations(text) {
  return String(text ?? "")
    .replaceAll("\\r\\n", "\n")
    .replaceAll("\\n", "\n")
    .split(/\r?\n/g)
    .map((line) => /^\s*(?:[-*]\s*)?EXPECT_FILE_CONTAINS:\s*(.+?)\s*::\s*(.+?)\s*$/i.exec(line))
    .filter(Boolean)
    .map((match) => ({
      path: match[1].trim(),
      contains: match[2].trim(),
    }));
}

export async function checkEvidence(expectations, { root = repoRoot } = {}) {
  const checks = [];
  for (const expectation of expectations) {
    const absolutePath = path.resolve(root, expectation.path);
    const insideRepo = absolutePath === root || absolutePath.startsWith(`${root}${path.sep}`);
    if (!insideRepo) {
      checks.push({
        ...expectation,
        ok: false,
        error: "Expected file must stay inside the repo",
      });
      continue;
    }
    try {
      const content = await fs.readFile(absolutePath, "utf8");
      checks.push({
        ...expectation,
        ok: content.includes(expectation.contains),
      });
    } catch (error) {
      checks.push({
        ...expectation,
        ok: false,
        error: error?.message ?? String(error),
      });
    }
  }
  return checks;
}

async function checkRequiredTexts({ id, path: sourcePath, requiredText, root }) {
  const absolutePath = path.isAbsolute(sourcePath) ? sourcePath : path.join(root, sourcePath);
  try {
    const content = await fs.readFile(absolutePath, "utf8");
    const missingText = requiredText.filter((text) => !content.includes(text));
    return {
      id,
      path: sourcePath,
      ok: missingText.length === 0,
      missingText,
    };
  } catch (error) {
    return {
      id,
      path: sourcePath,
      ok: false,
      error: error?.message ?? String(error),
    };
  }
}

export async function buildCodexIntelligenceGrounding({ root = repoRoot } = {}) {
  const codexAgentsPath =
    process.env.OPENCLAW_CODEX_AGENTS_PATH ??
    path.join(process.env.USERPROFILE ?? process.env.HOME ?? "", ".codex", "AGENTS.md");
  const requiredText = [
    "OpenClaw 智能化遵守規則",
    "不是第二套系統",
    "already_done",
    "額滿",
    "六種 Workflow 模式學習規則",
    "classify-and-act",
    "fanout-synthesize",
    "adversarial-verification",
    "generate-and-filter",
    "tournament",
    "loop-until-done",
    "provider gate",
  ];
  const homeRule =
    codexAgentsPath.trim() === ""
      ? {
          id: "codex-home-agents",
          path: codexAgentsPath,
          ok: false,
          error:
            "OPENCLAW_CODEX_AGENTS_PATH or user home is required to check Codex intelligence rules",
        }
      : await checkRequiredTexts({
          id: "codex-home-agents",
          path: codexAgentsPath,
          requiredText,
          root,
        });
  return {
    schema: "openclaw.codex-intelligence-grounding.v1",
    ok: homeRule.ok,
    source: homeRule.path,
    checks: [homeRule],
    contracts: {
      noSecondSystem: true,
      alreadyDoneBeforeRouting: true,
      quotaAwareDegradeUpgrade: true,
      sixWorkflowSelection: [
        "classify-and-act",
        "fanout-synthesize",
        "adversarial-verification",
        "generate-and-filter",
        "tournament",
        "loop-until-done",
      ],
      evidenceFirstCompletion: true,
    },
  };
}

export async function buildArchitectureGrounding({ root = repoRoot } = {}) {
  const sourceChecks = [
    {
      id: "autonomous-runtime-contract",
      path: "docs/automation/autonomous-runtime.md",
      requiredText: [
        "Preflight",
        "Plan",
        "Apply",
        "Validate",
        "Report",
        "Intelligent runtime intake",
        "EXPECT_FILE_CONTAINS",
      ],
    },
    {
      id: "systematic-architecture-map",
      path: "docs/automation/systematic-architecture.md",
      requiredText: [
        "10-layer map",
        "L1 Official Core Foundation",
        "L10 Governance and Evidence Plane",
        "Layered resource executor",
        "report-only",
      ],
    },
    {
      id: "unified-governance-r8",
      path: "docs/automation/unified-governance-r8.md",
      requiredText: ["R8.1", "Mandatory order", "FMBG", "VFC", "pnpm governance:r8:check"],
    },
    {
      id: "package-runtime-commands",
      path: "package.json",
      requiredText: [
        "openclaw:intelligent:run",
        "autonomous:inventory:check",
        "governance:r8:check",
        "architecture:layered-resource-executor:check",
        "architecture:goal-completion-audit:check",
      ],
    },
  ];
  const checks = [];
  for (const source of sourceChecks) {
    checks.push(await checkRequiredTexts({ ...source, root }));
  }
  const agentSkillChecks = [
    {
      id: "skill:cowork-codex-relay",
      path: ".agents/skills/cowork-codex-relay-zh/SKILL.md",
      requiredText: ["Cowork", "OpenClaw", "Codex", "router"],
    },
    {
      id: "skill:feature-factory",
      path: ".agents/skills/feature-factory-zh/SKILL.md",
      requiredText: ["七代理人", "factory-gate-check", "OpenClaw", "Codex"],
    },
    {
      id: "skill:one-shot-token-min",
      path: ".agents/skills/one-shot-correct-token-min-zh/SKILL.md",
      requiredText: ["一次到位", "極省 token", "governance:r8:check"],
    },
    {
      id: "skill:learning-operator",
      path: ".agents/skills/openclaw-learning-operator/SKILL.md",
      requiredText: ["Learning", "sync"],
    },
    {
      id: "skill:small-bugfix-sweep",
      path: ".agents/skills/openclaw-small-bugfix-sweep/SKILL.md",
      requiredText: ["small", "high-certainty", "OpenClaw"],
    },
  ];
  const agentSkillGrounding = {
    schema: "openclaw.agent-skill-grounding.v1",
    checks: [],
    contracts: {
      coworkRelay:
        "Claude/Cowork plans, Codex executes narrow code tasks, OpenClaw records evidence.",
      factoryRoute:
        "Feature work uses the existing seven-agent factory gates instead of a parallel system.",
      tokenPolicy:
        "Prefer already-done proof, local checks, and minimal summaries before provider spend.",
      learningClosure: "Promote lessons only after evidence-backed closure.",
      bugfixBoundary: "Fix small, high-confidence issues only; no broad refactor by default.",
    },
  };
  for (const source of agentSkillChecks) {
    agentSkillGrounding.checks.push(await checkRequiredTexts({ ...source, root }));
  }
  agentSkillGrounding.ok = agentSkillGrounding.checks.every((check) => check.ok);
  const codexIntelligence = await buildCodexIntelligenceGrounding({ root });
  const codexWrapperPath = "scripts/codex-architecture-grounding-gate.mjs";
  let codexWrapperOk = false;
  try {
    await fs.access(path.join(root, codexWrapperPath));
    codexWrapperOk = true;
  } catch {
    codexWrapperOk = false;
  }
  return {
    schema: "openclaw.architecture-grounding.v1",
    ok: checks.every((check) => check.ok) && agentSkillGrounding.ok,
    checks,
    learnedContracts: {
      executionOrder: ["preflight", "plan", "apply", "validate", "report"],
      governanceOrder: ["FMBG", "single-ticket", "simulate", "same-case-rerun", "evidence-lock"],
      architectureLayers: ["L1", "L2", "L3", "L4", "L5", "L6", "L7", "L8", "L9", "L10"],
      ownerSurfaces: ["Gateway", "agent runtime", "TaskFlow", "controlled runner"],
      resourceLanes: ["ARM", "GPU", "CPU"],
      safety: ["report-only", "noLiveTrading", "noOrderWrite", "evidence-backed completion"],
      codexIntelligenceLoop: [
        "classify",
        "degrade",
        "verify",
        "minimal-change",
        "skill-route",
        "evidence-backflow",
      ],
      breakthroughPattern:
        "Turn learned Codex rules into runtime-checkable grounding instead of a second system.",
    },
    codexIntelligence,
    agentSkillGrounding,
    codexWrapper: {
      path: codexWrapperPath,
      expected: true,
      availableInRepo: codexWrapperOk,
      note: "Runtime uses repo-local architecture SSOT; external Codex-home wrapper must not be required for OpenClaw to decide safely.",
    },
  };
}
