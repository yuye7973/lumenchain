#!/usr/bin/env node
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { basename, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const __dirname = fileURLToPath(new URL(".", import.meta.url));
const REPO_ROOT = resolve(__dirname, "..");
const DEFAULT_REGISTRY = join(REPO_ROOT, "config", "agent-registry.json");
const DEFAULT_OUT_DIR = join(REPO_ROOT, "config", "agent-cards");

function readJson(path) {
  try {
    return JSON.parse(readFileSync(path, "utf8"));
  } catch (error) {
    throw new Error(`Failed to read JSON ${path}: ${error.message}`);
  }
}

function normalizeId(value, field) {
  if (typeof value !== "string" || !value.trim()) {
    throw new Error(`agent missing required string field: ${field}`);
  }
  return value.trim();
}

function cardFileName(name) {
  return `${name.replace(/[^a-zA-Z0-9._-]/g, "-")}.json`;
}

function mapCheckEndpoint(agent) {
  const check = agent.check;
  if (!check || typeof check !== "object") {
    throw new Error(`agent ${agent.name} missing required object field: check`);
  }
  const type = normalizeId(check.type, `check.type for ${agent.name}`);
  if (type === "port") {
    const url = normalizeId(check.url, `check.url for ${agent.name}`);
    return { type: "health", transport: "http", url };
  }
  if (type === "heartbeat" || type === "report") {
    const path = normalizeId(check.path, `check.path for ${agent.name}`);
    return { type, transport: "file", path, maxMinutes: check.maxMin ?? null };
  }
  if (type === "ps") {
    const pattern = normalizeId(check.pattern, `check.pattern for ${agent.name}`);
    return { type: "process", transport: "process-list", pattern };
  }
  if (type === "script") {
    const command = normalizeId(check.cmd, `check.cmd for ${agent.name}`);
    return { type: "script", transport: "command", command };
  }
  if (type === "files") {
    const glob = normalizeId(check.glob, `check.glob for ${agent.name}`);
    return { type: "files", transport: "filesystem", glob, expect: check.expect ?? null };
  }
  if (type === "ssot") {
    const ref = normalizeId(check.ref, `check.ref for ${agent.name}`);
    return { type: "ssot", transport: "reference", ref };
  }
  throw new Error(`agent ${agent.name} has unsupported check.type: ${type}`);
}

export function buildAgentCard(agent) {
  const name = normalizeId(agent.name, "name");
  const kind = normalizeId(agent.kind, `kind for ${name}`);
  const endpoint = mapCheckEndpoint({ ...agent, name });
  const boot = normalizeId(agent.boot, `boot for ${name}`);
  const description =
    typeof agent.description === "string" && agent.description.trim()
      ? agent.description.trim()
      : `${name} OpenClaw ${kind} agent derived from config/agent-registry.json.`;

  return {
    name,
    description,
    version: "1.0.0",
    capabilities: {
      kind,
      healthCheck: endpoint.type,
    },
    skills: [
      {
        id: `${name}.status`,
        name: `${name} status`,
        description: `Report ${name} availability from the OpenClaw agent registry.`,
        tags: [kind, "openclaw-agent-registry"],
      },
    ],
    endpoints: [endpoint],
    metadata: {
      source: "config/agent-registry.json",
      boot,
    },
  };
}

export function buildAgentCards(registry) {
  if (!registry || typeof registry !== "object" || !Array.isArray(registry.agents)) {
    throw new Error("registry missing required agents array");
  }
  const retired = new Set(
    Array.isArray(registry.retired)
      ? registry.retired
          .map((agent) => (agent && typeof agent.name === "string" ? agent.name.trim() : ""))
          .filter(Boolean)
      : [],
  );
  return registry.agents
    .filter((agent) => agent && typeof agent === "object")
    .filter((agent) => !retired.has(agent.name))
    .map(buildAgentCard)
    .sort((a, b) => a.name.localeCompare(b.name));
}

export function writeAgentCards(cards, outDir = DEFAULT_OUT_DIR) {
  mkdirSync(outDir, { recursive: true });
  const written = [];
  for (const card of cards) {
    const file = join(outDir, cardFileName(card.name));
    const text = `${JSON.stringify(card, null, 2)}\n`;
    writeFileSync(file, text, "utf8");
    JSON.parse(readFileSync(file, "utf8"));
    written.push(file);
  }
  return written.sort();
}

function parseArgs(argv) {
  const args = { registry: DEFAULT_REGISTRY, outDir: DEFAULT_OUT_DIR };
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === "--registry") {
      args.registry = resolve(argv[++i] ?? "");
    } else if (arg === "--out-dir") {
      args.outDir = resolve(argv[++i] ?? "");
    } else {
      throw new Error(`Unknown argument: ${arg}`);
    }
  }
  return args;
}

export function run(argv = process.argv.slice(2)) {
  const args = parseArgs(argv);
  if (!existsSync(args.registry)) {
    throw new Error(`registry not found: ${args.registry}`);
  }
  const cards = buildAgentCards(readJson(args.registry));
  const written = writeAgentCards(cards, args.outDir);
  return { status: "ok", count: written.length, outDir: args.outDir, files: written.map((file) => basename(file)) };
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) {
  try {
    console.log(JSON.stringify(run(), null, 2));
  } catch (error) {
    console.error(error.message);
    process.exit(1);
  }
}
