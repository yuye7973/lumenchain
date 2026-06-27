#!/usr/bin/env node
import { startMcpServer } from "./_http-mcp-base.mjs";
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
function readJsonl(p) { try { return readFileSync(p, "utf8").split("\n").filter(Boolean).slice(-10).map(l => JSON.parse(l)); } catch (e) { return { error: e.message }; } }
startMcpServer({ serverName: "multibrain", serverVersion: "1.0", tools: [
  { name: "recent_dispatch", description: "最近 10 筆派工紀錄", inputSchema: { type: "object", properties: {} }, handler: async () => readJsonl(repoPath(".openclaw", "trading", "multi-brain-dispatch-journal.jsonl")) },
]});
