#!/usr/bin/env node
import { startMcpServer } from "./_http-mcp-base.mjs";
import { execSync as _origExecSync } from "node:child_process";
/* zero-flash-exec-patched */ // 永久零閃窗（依 no-break-guardrails 零閃窗鐵則）
const execSync = (cmd, opts) => _origExecSync(cmd, { windowsHide: true, ...(opts ?? {}) });
import { readFileSync } from "node:fs";
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
function repoPath(...parts) { return join(REPO, ...parts); }
function exec(cmd) { try { return execSync(cmd, { cwd: REPO, encoding: "utf8", timeout: 120000 }).slice(-2000); } catch (e) { return { error: e.message }; } }
function read(p) { try { return readFileSync(p, "utf8").slice(-3000); } catch (e) { return { error: e.message }; } }
startMcpServer({ serverName: "evolution", serverVersion: "1.0", tools: [
  { name: "run_cycle", description: "跑 Evolution Engine 一輪", inputSchema: { type: "object", properties: {} }, handler: async () => exec("node scripts/openclaw-evolution-engine.mjs --cycle --write-state") },
  { name: "read_registry", description: "讀 learning registry", inputSchema: { type: "object", properties: {} }, handler: async () => read(repoPath("reports", "state", "learning-registry.json")) },
]});
