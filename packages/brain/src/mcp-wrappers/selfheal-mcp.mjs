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
function read(p) { try { return JSON.parse(readFileSync(p, "utf8")); } catch (e) { return { error: e.message }; } }
startMcpServer({ serverName: "selfheal", serverVersion: "1.0", tools: [
  { name: "stats", description: "Self-heal 統計（tick/revive/alert）", inputSchema: { type: "object", properties: {} }, handler: async () => read(repoPath(".openclaw", "trading", "self-heal-stats.json")) },
  { name: "dashboard", description: "Factory dashboard", inputSchema: { type: "object", properties: {} }, handler: async () => read(repoPath(".openclaw", "trading", "factory-dashboard.json")) },
]});
