#!/usr/bin/env node
import { execFileSync as _origExecFileSync } from "node:child_process";
/* zero-flash-exec-patched */ // 永久零閃窗（依 no-break-guardrails 零閃窗鐵則）
const execFileSync = (file, args, opts) => {
  if (args && !Array.isArray(args)) { opts = args; args = undefined; }
  return _origExecFileSync(file, args ?? [], { windowsHide: true, ...(opts ?? {}) });
};
import { startMcpServer } from "./_http-mcp-base.mjs";

const REPO_ROOT = process.env.OPENCLAW_ROOT || process.cwd();
const OPENCLAW_RUNNER = "scripts/run-node.mjs";
const OPENCLAW_TIMEOUT_MS = 240000;
const OPENCLAW_ATTEMPTS = 3;
const OPENCLAW_RETRY_DELAY_MS = 2500;

function sleepSync(ms) {
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);
}

function isTransientRuntimeError(error) {
  const text = `${error instanceof Error ? error.message : String(error)}\n${String(error?.stderr ?? "")}`;
  return /\b(EBUSY|ETIMEDOUT|resource busy|artifact lock|still running)\b/i.test(text);
}

function formatOpenClawError(error) {
  return {
    error: error instanceof Error ? error.message : String(error),
    stderr: String(error?.stderr ?? "").slice(-500),
  };
}

function runOpenClaw(args) {
  let lastError;
  for (let attempt = 1; attempt <= OPENCLAW_ATTEMPTS; attempt += 1) {
    try {
      return execFileSync(process.execPath, [OPENCLAW_RUNNER, ...args], {
        cwd: REPO_ROOT,
        encoding: "utf8",
        timeout: OPENCLAW_TIMEOUT_MS,
        env: {
          ...process.env,
          OPENCLAW_DISABLE_LOCAL_RUNTIME_DELEGATE: "1",
        },
      }).slice(-2000);
    } catch (error) {
      lastError = error;
      if (attempt >= OPENCLAW_ATTEMPTS || !isTransientRuntimeError(error)) {
        break;
      }
      sleepSync(OPENCLAW_RETRY_DELAY_MS);
    }
  }
  return formatOpenClawError(lastError);
}

startMcpServer({
  serverName: "hermes",
  serverVersion: "1.0",
  tools: [
    {
      name: "plan",
      description: "Hermes 規劃任務包 (dry-run)",
      inputSchema: {
        type: "object",
        properties: { goal: { type: "string" } },
        required: ["goal"],
      },
      handler: async (args) => runOpenClaw(["hermes", "plan", String(args.goal ?? "")]),
    },
    {
      name: "deploy_plan",
      description: "Hermes 部署規劃",
      inputSchema: {
        type: "object",
        properties: { goal: { type: "string" } },
        required: ["goal"],
      },
      handler: async (args) => runOpenClaw(["hermes", "deploy-plan", String(args.goal ?? "")]),
    },
    {
      name: "list_taskflows",
      description: "列出 taskflow registry",
      inputSchema: { type: "object", properties: {} },
      handler: async () => runOpenClaw(["tasks", "flow", "list", "--json"]),
    },
  ],
});
