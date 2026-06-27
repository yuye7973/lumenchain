#!/usr/bin/env node
// OpenClaw 15+ Agent Dispatcher MCP
// 統一暴露所有 sbx-agent role 給 4 AI 呼叫
import { startMcpServer } from "./_http-mcp-base.mjs";
import { spawnSync as _origSpawnSync } from "node:child_process";
/* zero-flash-exec-patched */ // 永久零閃窗（依 no-break-guardrails 零閃窗鐵則）
const spawnSync = (cmd, args, opts) => {
  if (args && !Array.isArray(args)) { opts = args; args = undefined; }
  return _origSpawnSync(cmd, args ?? [], { windowsHide: true, ...(opts ?? {}) });
};
import { existsSync, readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const CANONICAL_REPO = resolve(HERE, "..", "..");
const LEGACY_REPO = resolve(process.env.OPENCLAW_ROOT || process.cwd());
function normalizeRepoRoot(value) {
  const candidate = resolve(value || CANONICAL_REPO);
  return candidate.toLowerCase() === LEGACY_REPO.toLowerCase() ? CANONICAL_REPO : candidate;
}
const REPO = normalizeRepoRoot(process.env.OPENCLAW_ROOT || process.env.OPENCLAW_REPO_ROOT);

const AGENTS = {
  "codex_agent": { role: "編碼/實作", img: "openclaw/codex-agent", tasks: "backend, frontend, bug-fix" },
  "claude_agent": { role: "推理/規格", img: "openclaw/claude-agent", tasks: "spec, research, complex-reasoning" },
  "research_agent": { role: "研究/調查", img: "openclaw/research-agent", tasks: "research, analysis, market-data" },
  "trading_agent": { role: "交易/策略", img: "openclaw/trading-agent", tasks: "trading, strategy, signal" },
  "accounting_agent": { role: "財務", img: "openclaw/accounting-agent", tasks: "accounting, finance, p&l" },
  "audit_agent": { role: "審計", img: "openclaw/audit-agent", tasks: "audit, review, compliance" },
  "repair_agent": { role: "修復/自癒", img: "openclaw/repair-agent", tasks: "self-heal, bug-fix, recovery" },
  "engineering_agent": { role: "工程", img: "openclaw/engineering-agent", tasks: "architecture, refactor" },
  "ui_agent": { role: "UI 設計", img: "openclaw/ui-agent", tasks: "ui, design, frontend-spec" },
  "video_agent": { role: "影片", img: "openclaw/video-agent", tasks: "video, media, transcript" },
  "skill_builder_agent": { role: "skill 創造", img: "openclaw/skill-builder", tasks: "create-skill, automation" },
  "ecommerce_agent": { role: "電商", img: "openclaw/ecommerce-agent", tasks: "ecommerce, product, inventory" },
  "watcher_agent": { role: "監控", img: "openclaw/watcher-agent", tasks: "monitoring, alert, health" },
  "expansion_agent": { role: "擴張", img: "openclaw/expansion-agent", tasks: "growth, scaling, expansion" },
  "support_agent": { role: "客服", img: "openclaw/support-agent", tasks: "support, customer, ticket" },
};

function runDocker(args) {
  const r = spawnSync("docker", args, { encoding: "utf8", windowsHide: true });
  return {
    ok: r.status === 0,
    stdout: (r.stdout || "").trim(),
    stderr: (r.stderr || "").trim(),
    status: r.status,
    error: r.error ? String(r.error) : null,
  };
}

function dockerCheck(name) {
  const r = runDocker(["ps", "-a", "--filter", `name=openclaw-sbx-agent-${name}`, "--format", "{{.Status}}"]);
  if (!r.ok && !r.stdout) return "docker-error";
  return r.stdout || "not-exist";
}

function tryStart(name) {
  try {
    const names = runDocker(["ps", "-a", "--filter", `name=openclaw-sbx-agent-${name}`, "--format", "{{.Names}}"])
      .stdout
      .split(/\r?\n/)
      .map((s) => s.trim())
      .filter(Boolean);
    if (names.length === 0) {
      return { ok: false, error: "no matching container found", output: "" };
    }
    const started = [];
    const errors = [];
    for (const containerName of names) {
      const r = runDocker(["start", containerName]);
      if (r.ok) started.push(containerName);
      else errors.push(`${containerName}: ${r.stderr || r.error || "start failed"}`);
    }
    return { ok: errors.length === 0, output: started.join("\n"), error: errors.join("\n") || null };
  } catch (e) { return { ok: false, error: e.message }; }
}

function spawnViaOpenclaw(agent, task) {
  try {
    const r = spawnSync(process.execPath, [join(REPO, "openclaw.mjs"), "agent", "spawn", agent, "--task", task], {
      encoding: "utf8",
      cwd: REPO,
      timeout: 60000,
      windowsHide: true,
    });
    const output = `${r.stdout || ""}${r.stderr || ""}`.trim();
    return r.status === 0
      ? { ok: true, output: output.slice(-2000) }
      : { ok: false, error: `openclaw spawn failed (status ${r.status ?? "unknown"})`, stderr: output.slice(-500) };
  } catch (e) { return { ok: false, error: e.message, stderr: "" }; }
}

function pickAgentForTask(taskText) {
  const t = (taskText || "").toLowerCase();
  if (/trading|策略|交易|signal/i.test(t)) return "trading_agent";
  if (/audit|審計|review|合規/i.test(t)) return "audit_agent";
  if (/research|研究|analysis|分析/i.test(t)) return "research_agent";
  if (/accounting|財務|finance/i.test(t)) return "accounting_agent";
  if (/repair|修復|fix|self-heal|自癒/i.test(t)) return "repair_agent";
  if (/skill|自動化|automation/i.test(t)) return "skill_builder_agent";
  if (/ui|介面|design|前端/i.test(t)) return "ui_agent";
  if (/video|影片|media|轉錄/i.test(t)) return "video_agent";
  if (/ecommerce|電商|product|庫存/i.test(t)) return "ecommerce_agent";
  if (/monitor|監控|watch|alert/i.test(t)) return "watcher_agent";
  if (/growth|scaling|expansion/i.test(t)) return "expansion_agent";
  if (/support|客服|ticket/i.test(t)) return "support_agent";
  if (/engineering|架構|refactor/i.test(t)) return "engineering_agent";
  if (/spec|推理|複雜推理/i.test(t)) return "claude_agent";
  return "codex_agent"; // default coding
}

startMcpServer({
  serverName: "openclaw-agents",
  serverVersion: "1.0",
  tools: [
    {
      name: "list_agents",
      description: "列出 OpenClaw 全 15+ 專業 agent",
      inputSchema: { type: "object", properties: {} },
      handler: async () => ({ total: Object.keys(AGENTS).length, agents: AGENTS }),
    },
    {
      name: "agent_status",
      description: "看單一 agent 容器狀態",
      inputSchema: { type: "object", properties: { agent: { type: "string" } }, required: ["agent"] },
      handler: async (a) => ({ agent: a.agent, status: dockerCheck(a.agent), info: AGENTS[a.agent] }),
    },
    {
      name: "all_status",
      description: "列出所有 agent 容器狀態",
      inputSchema: { type: "object", properties: {} },
      handler: async () => Object.fromEntries(Object.keys(AGENTS).map(n => [n, dockerCheck(n)])),
    },
    {
      name: "pick_agent",
      description: "根據任務內容智能選 agent",
      inputSchema: { type: "object", properties: { task: { type: "string" } }, required: ["task"] },
      handler: async (a) => ({ picked: pickAgentForTask(a.task), info: AGENTS[pickAgentForTask(a.task)] }),
    },
    {
      name: "dispatch",
      description: "派任務給智能選的最適 agent",
      inputSchema: { type: "object", properties: { task: { type: "string" }, force_agent: { type: "string" } }, required: ["task"] },
      handler: async (a) => {
        const agent = a.force_agent || pickAgentForTask(a.task);
        return { dispatched_to: agent, result: spawnViaOpenclaw(agent, a.task) };
      },
    },
  ],
});
