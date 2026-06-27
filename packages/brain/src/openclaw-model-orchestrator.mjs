#!/usr/bin/env node
// openclaw-model-orchestrator.mjs
// Smart Model Selector for OpenClaw LLM consumers.
// Reads catalog + consumer registry, probes resources, picks best model with VRAM-aware fallback.
//
// CLI usage:
//   node scripts/openclaw-model-orchestrator.mjs --consumer example-agent --task debate
//   node scripts/openclaw-model-orchestrator.mjs --status
//   node scripts/openclaw-model-orchestrator.mjs --self-test
//
// Module usage:
//   import { selectModel, getStatus, recordUsage } from "./openclaw-model-orchestrator.mjs";
import http from "node:http";
import { existsSync, mkdirSync, readFileSync, writeFileSync, appendFileSync, statSync } from "node:fs";
import { pickBestAvailable } from "./lib/best-available-model.mjs"; // 2026-06-16：難任務智能挑最強可用模型
import os, { availableParallelism, freemem, totalmem, cpus } from "node:os";
import { join, resolve } from "node:path";
import { spawnSync as _origSpawnSync} from "node:child_process";
/* zero-flash-patched */ // 永久零閃窗（依 no-break-guardrails 零閃窗鐵則）
const spawnSync = (cmd, args = [], opts = {}) => _origSpawnSync(cmd, args, { windowsHide: true, ...opts });
import { fileURLToPath, pathToFileURL } from "node:url";

const __dirname = fileURLToPath(new URL(".", import.meta.url));
const REPO_ROOT = resolve(__dirname, "..");
const CATALOG_PATH = join(REPO_ROOT, "config", "model-orchestrator-catalog.json");
const TELEMETRY_DIR = join(REPO_ROOT, ".lumenchain", "telemetry");
const TELEMETRY_PATH = join(TELEMETRY_DIR, "model-orchestrator.jsonl");
const STATE_DIR = join(REPO_ROOT, "reports", "hermes-agent", "state");
const STATUS_PATH = join(STATE_DIR, "openclaw-model-orchestrator-latest.json");
const OLLAMA_API = process.env.OLLAMA_HOST || "http://localhost:11434";
const SCHEMA = "openclaw.model-orchestrator.v1";
const CLOUD_PROVIDER_ENV = {
  openrouter: ["OPENROUTER_API_KEY"],
  nvidia: ["NVIDIA_API_KEY"],
  codex: ["OPENAI_API_KEY"],
};
const TIER_ORDER = new Map([
  ["embed", 0],
  ["basic", 1],
  ["medium", 2],
  ["code", 2],
  ["reasoning", 3],
  ["high", 4],
]);

function isoNow() { return new Date().toISOString(); }
function gb(bytes) { return Math.round((bytes / 1073741824) * 100) / 100; }
function ensureDir(p) { if (!existsSync(p)) mkdirSync(p, { recursive: true }); }

function loadCatalog() {
  if (!existsSync(CATALOG_PATH)) throw new Error(`catalog missing: ${CATALOG_PATH}`);
  return JSON.parse(readFileSync(CATALOG_PATH, "utf8"));
}

async function fetchJson(url, timeoutMs = 3000) {
  return new Promise((res) => {
    const req = http.get(url, { timeout: timeoutMs }, (resp) => {
      let body = "";
      resp.on("data", (c) => (body += c));
      resp.on("end", () => { try { res(JSON.parse(body)); } catch { res(null); } });
    });
    req.on("error", () => res(null));
    req.on("timeout", () => { req.destroy(); res(null); });
  });
}

async function probeOllama() {
  const ps = await fetchJson(`${OLLAMA_API}/api/ps`);
  const tags = await fetchJson(`${OLLAMA_API}/api/tags`);
  if (!ps) return { reachable: false, loaded: [], available: [] };
  return {
    reachable: true,
    loaded: (ps.models || []).map((m) => ({
      name: m.name,
      vramGb: gb(m.size_vram || 0),
      expiresAt: m.expires_at,
    })),
    available: (tags?.models || []).map((m) => m.name),
  };
}

function probeNvidiaGpu() {
  const res = spawnSync("nvidia-smi", [
    "--query-gpu=memory.total,memory.free,memory.used,utilization.gpu",
    "--format=csv,noheader,nounits",
  ], { encoding: "utf8" });
  if (res.status !== 0 || !res.stdout) {
    return { available: false, reason: "nvidia-smi unreachable" };
  }
  const line = res.stdout.trim().split("\n")[0];
  const [total, free, used, util] = line.split(",").map((s) => Number(s.trim()));
  return {
    available: true,
    totalMb: total, freeMb: free, usedMb: used, utilPct: util,
    totalGb: Math.round(total / 1024 * 10) / 10,
    freeGb: Math.round(free / 1024 * 10) / 10,
    usedGb: Math.round(used / 1024 * 10) / 10,
  };
}

function ramProbe() {
  const free = freemem();
  const total = totalmem();
  return { freeGb: gb(free), totalGb: gb(total) };
}

function cpuProbe() {
  const arch = process.arch;
  const platform = process.platform;
  const cores =
    typeof availableParallelism === "function"
      ? availableParallelism()
      : cpus().length;
  let loadPct = null;
  if (platform === "win32") {
    const result = spawnSync(
      "wmic",
      ["cpu", "get", "loadpercentage", "/value"],
      { encoding: "utf8", timeout: 4000 },
    );
    const match = String(result.stdout ?? "").match(/LoadPercentage=(\d+)/i);
    if (match) {
      loadPct = Number(match[1]);
    }
  } else {
    const load = os.loadavg?.()?.[0];
    if (Number.isFinite(load) && cores > 0) {
      loadPct = Math.max(0, Math.round((load / cores) * 1000) / 10);
    }
  }
  const hotPct = Number(process.env.OPENCLAW_MODEL_ORCH_CPU_HOT_PCT ?? 85);
  return {
    arch,
    platform,
    cores,
    loadPct,
    hotPct,
    hot: Number.isFinite(loadPct) ? loadPct >= hotPct : false,
    sampledAt: isoNow(),
  };
}

function tierRank(tier) {
  return TIER_ORDER.get(String(tier || "").toLowerCase()) ?? 99;
}

function tierAtOrBelow(tier, ceilingTier) {
  return tierRank(tier) <= tierRank(ceilingTier);
}

async function probeAll() {
  const catalog = loadCatalog();
  const ollama = await probeOllama();
  const gpu = probeNvidiaGpu();
  const ram = ramProbe();
  const cpu = cpuProbe();
  const cloud = probeCloudProviders(catalog);
  return { observedAt: isoNow(), ollama, gpu, ram, cpu, cloud };
}

function modelProvider(modelId, cfg = {}) {
  if (cfg.provider) return String(cfg.provider);
  if (String(modelId).startsWith("openrouter/")) return "openrouter";
  return String(modelId).split("/")[0] || "unknown";
}

function isCloudModel(modelId, cfg = {}) {
  return cfg.providerKind === "cloud" || cfg.remote === true || String(modelId).startsWith("openrouter/");
}

function providerConfiguredFromProbe(probe, provider) {
  return probe?.cloud?.providers?.[provider]?.configured === true;
}

function probeCloudProviders(catalog) {
  const providers = {};
  for (const [modelId, cfg] of Object.entries(catalog.models || {})) {
    if (!isCloudModel(modelId, cfg)) continue;
    const provider = modelProvider(modelId, cfg);
    const authEnv = Array.isArray(cfg.authEnv) && cfg.authEnv.length > 0
      ? cfg.authEnv
      : (CLOUD_PROVIDER_ENV[provider] || []);
    providers[provider] ??= {
      configured: false,
      authEnv,
      configuredEnv: [],
      freeModelCount: 0,
      modelCount: 0,
    };
    providers[provider].authEnv = [...new Set([...(providers[provider].authEnv || []), ...authEnv])];
    providers[provider].modelCount += 1;
    if (cfg.free === true || String(modelId).includes(":free")) providers[provider].freeModelCount += 1;
    const configuredEnv = authEnv.filter((key) => Boolean(process.env[key]));
    providers[provider].configuredEnv = [...new Set([...(providers[provider].configuredEnv || []), ...configuredEnv])];
    providers[provider].configured = providers[provider].configured || configuredEnv.length > 0;
  }
  return { providers };
}

function isKillSwitchActive(catalog) {
  const sw = catalog?.policy?.killSwitch;
  const val = catalog?.policy?.killValue ?? "1";
  if (!sw) return false;
  return process.env[sw] === val;
}

function chooseModel({ catalog, consumer, task, probe }) {
  if (isKillSwitchActive(catalog)) {
    return { ok: false, reason: "kill_switch_active", killSwitch: catalog.policy.killSwitch };
  }

  const consumerCfg = catalog.consumers[consumer] || catalog.consumers.default;
  if (!consumerCfg) return { ok: false, reason: "no_consumer_or_default_config" };

  const taskCfg = consumerCfg.tasks[task] || consumerCfg.tasks.default || Object.values(consumerCfg.tasks)[0];
  if (!taskCfg) return { ok: false, reason: "no_task_config" };

  const policy = catalog.policy || {};
  const cloudPolicy = policy.cloudFreeAutoRotation || {};
  const cloudFreeEnabled = cloudPolicy.enabled === true;
  const minFreeRam = policy.minFreeRamGb ?? 6.0;
  const desktopReserve = catalog.gpu.desktopReserveGb ?? 3.0;
  const armReserve = (probe.cpu?.arch === "arm64" || probe.cpu?.arch === "arm")
    ? Number(policy.armReserveGb ?? 2.0)
    : 0;
  const cpuHotMaxTier = policy.cpuHotMaxTier ?? "medium";
  const cpuHotThreshold = Number(policy.cpuHotLoadPct ?? 85);
  const cpuHot = Number.isFinite(probe.cpu?.loadPct)
    ? probe.cpu.loadPct >= cpuHotThreshold
    : probe.cpu?.hot === true;

  const candidates = [taskCfg.preferredModel, ...(taskCfg.fallbackChain || [])];
  const seen = new Set();
  const dedupedCandidates = candidates.filter((c) => { if (seen.has(c)) return false; seen.add(c); return true; });

  // 能力感知（修模擬抓到的 1878 例 RAM 緊選到缺能力模型）：所有路徑共用
  const requiredCaps = new Set(taskCfg.requiredCapabilities || []);
  const missingCaps = (m) => [...requiredCaps].filter((c) => !((catalog.models[m] && catalog.models[m].capabilities) || []).includes(c));
  const isCapable = (m) => missingCaps(m).length === 0;
  const providerConfigured = (provider) => providerConfiguredFromProbe(probe, provider);
  const cloudSkipReason = (m) => {
    const cfg = catalog.models[m] || {};
    if (!isCloudModel(m, cfg)) return "";
    const provider = modelProvider(m, cfg);
    if (!cloudFreeEnabled) return `${m}: cloud-free lane disabled`;
    if (!(cfg.free === true || String(m).includes(":free"))) return `${m}: cloud model is not marked free`;
    if (!providerConfigured(provider)) return `${m}: ${provider} auth not configured`;
    return "";
  };
  const isUsableCloudFree = (m) => {
    const cfg = catalog.models[m] || {};
    return isCloudModel(m, cfg) && cloudSkipReason(m) === "";
  };
  const cloudDescriptor = (m) => {
    const cfg = catalog.models[m] || {};
    const provider = modelProvider(m, cfg);
    return {
      model: m,
      providerKind: "cloud",
      provider,
      modelApiName: cfg.modelApiName || (provider === "openrouter" && String(m).startsWith("openrouter/")
        ? String(m).slice("openrouter/".length)
        : m),
      baseUrl: cfg.baseUrl || catalog.policy?.cloudFreeAutoRotation?.providers?.[provider]?.baseUrl,
      free: cfg.free === true || String(m).includes(":free"),
    };
  };
  const enrichChoice = (choice) => {
    if (!choice?.ok || !choice.model) return choice;
    const cfg = catalog.models[choice.model] || {};
    const provider = modelProvider(choice.model, cfg);
    const out = {
      ...choice,
      providerKind: isCloudModel(choice.model, cfg) ? "cloud" : "local",
      provider,
      modelApiName: cfg.modelApiName || (provider === "openrouter" && String(choice.model).startsWith("openrouter/")
        ? String(choice.model).slice("openrouter/".length)
        : choice.model),
      baseUrl: cfg.baseUrl || catalog.policy?.cloudFreeAutoRotation?.providers?.[provider]?.baseUrl,
      free: cfg.free === true || String(choice.model).includes(":free"),
    };
    if (out.providerKind === "cloud") {
      out.cloudFallbacks = dedupedCandidates
        .filter((m) => m !== choice.model && isUsableCloudFree(m) && isCapable(m))
        .map(cloudDescriptor);
    }
    return out;
  };

  const reasoning = [];
  if (probe.ram.freeGb < minFreeRam) {
    reasoning.push(`RAM low: ${probe.ram.freeGb} GB < ${minFreeRam} GB`);
    if (cloudPolicy.preferOnRamLow !== false) {
      const cloudPick = dedupedCandidates.find((m) => isUsableCloudFree(m) && isCapable(m));
      if (cloudPick) {
        reasoning.push(`${cloudPick}: cloud-free model selected because local RAM is low`);
        return enrichChoice({ ok: true, model: cloudPick, reason: "cloud_free_ram_fallback", reasoning, fallbackUsed: cloudPick !== taskCfg.preferredModel });
      }
    }
    const fitsSmall = dedupedCandidates.filter((m) => {
      const cfg = catalog.models[m] || {};
      return !isCloudModel(m, cfg) && (cfg.vramGb ?? 999) < 4;
    });
    const pick = fitsSmall.find(isCapable) || fitsSmall[0];
    if (pick) return enrichChoice({ ok: true, model: pick, reason: "ram_emergency_fallback", reasoning, fallbackUsed: true, capabilityDegraded: !isCapable(pick), missingCapabilities: missingCaps(pick) });
    return { ok: false, reason: "ram_low_no_fallback", reasoning };
  }

  const loadedNames = new Set(probe.ollama.loaded.map((l) => l.name));

  for (let i = 0; i < dedupedCandidates.length; i++) {
    const m = dedupedCandidates[i];
    const cfg = catalog.models[m];
    if (!cfg) { reasoning.push(`${m}: unknown model in catalog`); continue; }
    if (isCloudModel(m, cfg)) {
      const skip = cloudSkipReason(m);
      if (skip) { reasoning.push(skip); continue; }
      reasoning.push(`${m}: cloud-free provider configured, picking`);
      return enrichChoice({ ok: true, model: m, reason: "cloud_free_pick", reasoning, fallbackUsed: i > 0, capabilityDegraded: !isCapable(m), missingCapabilities: missingCaps(m) });
    }
    if (cfg.doesNotFit) { reasoning.push(`${m}: ${cfg.note}`); continue; }
    if (cpuHot && !tierAtOrBelow(cfg.tier, cpuHotMaxTier)) {
      reasoning.push(`${m}: cpu hot (${probe.cpu?.loadPct ?? "n/a"}%), tier ${cfg.tier} above ${cpuHotMaxTier}, try smaller`);
      continue;
    }

    if (loadedNames.has(m)) {
      reasoning.push(`${m}: already loaded, picking`);
      return enrichChoice({ ok: true, model: m, reason: "warm_pick", reasoning, fallbackUsed: i > 0, capabilityDegraded: !isCapable(m), missingCapabilities: missingCaps(m) });
    }

    const gpuFreeGb = probe.gpu.available ? probe.gpu.freeGb : (catalog.gpu.availableForLlmGb ?? 12);
    const effectiveFree = Math.max(0, gpuFreeGb - desktopReserve - armReserve);
    if (cfg.vramGb <= effectiveFree) {
      reasoning.push(
        `${m}: ${cfg.vramGb} GB fits in ${effectiveFree.toFixed(1)} GB available ` +
        `(after ${desktopReserve} GB desktop reserve${armReserve > 0 ? ` + ${armReserve} GB arm reserve` : ""})`,
      );
      return enrichChoice({ ok: true, model: m, reason: "cold_pick_fits", reasoning, fallbackUsed: i > 0, capabilityDegraded: !isCapable(m), missingCapabilities: missingCaps(m) });
    }
    reasoning.push(`${m}: ${cfg.vramGb} GB > ${effectiveFree.toFixed(1)} GB available, try next`);
  }

  // Emergency: no candidate fits cold. Try any warm model with required capability.
  const warmCandidates = [...probe.ollama.loaded]
    .map((loaded) => ({ loaded, cfg: catalog.models[loaded.name] }))
    .filter(({ cfg }) => cfg)
    .filter(({ cfg }) => !cpuHot || tierAtOrBelow(cfg.tier, cpuHotMaxTier))
    .sort((a, b) => (a.cfg.vramGb - b.cfg.vramGb) || a.loaded.name.localeCompare(b.loaded.name));
  for (const { loaded, cfg } of warmCandidates) {
    const hasAll = [...requiredCaps].every((cap) => (cfg.capabilities || []).includes(cap));
    if (hasAll) {
      reasoning.push(`emergency: using warm ${loaded.name} (capable, no cold pick fits${cpuHot ? ", cpu hot preferred smaller tier" : ""})`);
      return enrichChoice({ ok: true, model: loaded.name, reason: "warm_emergency_capable", reasoning, fallbackUsed: true });
    }
  }

  // 2026-06-11 修：原第二迴圈與第一迴圈條件重複＝死碼。改為能力降級暖備援——
  // 沒有任何暖模型具備全部能力時，選最小的暖模型並誠實標 capabilityDegraded（消費者可自行 fallback codex）
  for (const { loaded, cfg } of warmCandidates) {
    reasoning.push(`emergency-degraded: using warm ${loaded.name} (missing caps: ${missingCaps(loaded.name).join(",") || "?"})`);
    return enrichChoice({ ok: true, model: loaded.name, reason: "warm_emergency_degraded", reasoning, fallbackUsed: true, capabilityDegraded: true, missingCapabilities: missingCaps(loaded.name) });
  }

  return { ok: false, reason: "no_candidate_fits_vram", reasoning };
}

async function selectModel({ consumer = "default", task = "default", difficulty = "normal", wantStrongest = false } = {}) {
  const catalog = loadCatalog();
  const probe = await probeAll();
  // 2026-06-16 智能升級：難任務（hard / wantStrongest）→ 挑當下最強的可用模型（不可用自動跳過，如 Fable 5 灰掉）
  if (difficulty === "hard" || wantStrongest) {
    const best = pickBestAvailable({ allowCloud: true });
    if (best.model) {
    const r = { ok: true, model: best.model, reason: "strongest-available", strengthLadder: best.ladder, kind: best.kind, probe };
      if (best.kind === "cloud") {
        r.providerKind = "cloud";
        r.provider = String(best.model).split("/")[0];
        r.modelApiName = r.provider === "openrouter" && String(best.model).startsWith("openrouter/")
          ? String(best.model).slice("openrouter/".length)
          : best.model;
        r.free = String(best.model).includes(":free");
        r.baseUrl = r.provider === "openrouter" ? "https://openrouter.ai/api/v1" : undefined;
        r.cloudFallbacks = Object.entries(catalog.models || {})
          .filter(([modelId, cfg]) => modelId !== best.model && isCloudModel(modelId, cfg) && (cfg.free === true || String(modelId).includes(":free")))
          .filter(([modelId, cfg]) => providerConfiguredFromProbe(probe, modelProvider(modelId, cfg)))
          .map(([modelId, cfg]) => {
            const provider = modelProvider(modelId, cfg);
            return {
              model: modelId,
              providerKind: "cloud",
              provider,
              modelApiName: cfg.modelApiName || (provider === "openrouter" && String(modelId).startsWith("openrouter/")
                ? String(modelId).slice("openrouter/".length)
                : modelId),
              baseUrl: cfg.baseUrl || catalog.policy?.cloudFreeAutoRotation?.providers?.[provider]?.baseUrl,
              free: true,
            };
          });
      }
      recordUsage({ consumer, task, choice: r, probe });
      return r;
    }
    // 最強全不可用 → 退回常規本地路由（保底，不空手）
  }
  const choice = chooseModel({ catalog, consumer, task, probe });
  if (choice.ok && choice.model) { // 2026-06-11：補 tier 與 keep_alive 建議（暖留時間分層，減少載卸顛簸）
    const cfg = catalog.models[choice.model] || {};
    choice.tier = cfg.tier ?? null;
    const ka = (catalog.policy && catalog.policy.keepAliveByTier) || { basic: "2h", medium: "30m", high: "15m", reasoning: "15m", code: "30m", embed: "4h" };
    choice.keepAlive = ka[cfg.tier] ?? "30m";
  }
  recordUsage({ consumer, task, choice, probe });
  return { ...choice, probe };
}

function recordUsage({ consumer, task, choice, probe }) {
  try {
    ensureDir(TELEMETRY_DIR);
    const entry = {
      ts: isoNow(),
      consumer, task,
      ok: choice.ok,
      model: choice.model || null,
      reason: choice.reason,
      providerKind: choice.providerKind ?? choice.kind ?? null,
      provider: choice.provider ?? null,
      free: choice.free === true,
      fallbackUsed: choice.fallbackUsed === true,
      gpuFreeGb: probe.gpu.available ? probe.gpu.freeGb : null,
      ramFreeGb: probe.ram.freeGb,
      cpuLoadPct: probe.cpu?.loadPct ?? null,
      cpuArch: probe.cpu?.arch ?? null,
      loadedModels: probe.ollama.loaded.map((l) => l.name),
      cloudProviders: Object.fromEntries(Object.entries(probe.cloud?.providers || {}).map(([provider, info]) => [
        provider,
        { configured: info.configured === true, freeModelCount: info.freeModelCount ?? 0 },
      ])),
    };
    appendFileSync(TELEMETRY_PATH, JSON.stringify(entry) + "\n", "utf8");
    try { // 2026-06-11：遙測有界（>5MB 截尾 2000 行，防無限增長）
      const st = statSync(TELEMETRY_PATH);
      if (st.size > 5 * 1024 * 1024) {
        const lines = readFileSync(TELEMETRY_PATH, "utf8").split("\n");
        writeFileSync(TELEMETRY_PATH, lines.slice(-2000).join("\n"), "utf8");
      }
    } catch { /* tolerate */ }
  } catch { /* tolerate */ }
}

async function getStatus() {
  const catalog = loadCatalog();
  const probe = await probeAll();
  const status = {
    schema: SCHEMA,
    generatedAt: isoNow(),
    status: probe.gpu.available && probe.ollama.reachable ? "pass" : "degraded",
    catalog: {
      modelCount: Object.keys(catalog.models).length,
      consumerCount: Object.keys(catalog.consumers).length,
      gpuModel: catalog.gpu.model,
      gpuTotalVramGb: catalog.gpu.totalVramGb,
    },
    probe,
    killSwitchActive: isKillSwitchActive(catalog),
    cpu: probe.cpu,
    telemetryPath: TELEMETRY_PATH,
    catalogPath: CATALOG_PATH,
  };
  ensureDir(STATE_DIR);
  writeFileSync(STATUS_PATH, JSON.stringify(status, null, 2), "utf8");
  return status;
}

async function selfTest() {
  const catalog = loadCatalog();
  const probe = await probeAll();
  const cases = [
    { consumer: "example-agent", task: "market_analyst" },
    { consumer: "example-agent", task: "debate" },
    { consumer: "example-agent", task: "risk" },
    { consumer: "openclaw", task: "default" },
    { consumer: "unknown_consumer", task: "default" },
  ];
  const results = cases.map((c) => {
    const choice = chooseModel({ catalog, consumer: c.consumer, task: c.task, probe });
    return { ...c, ok: choice.ok, model: choice.model, reason: choice.reason };
  });
  return { ok: results.every((r) => r.ok), cases: results, probe };
}

function parseArgs(argv) {
  const args = { status: false, selfTest: false, consumer: null, task: null };
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === "--status") args.status = true;
    else if (argv[i] === "--self-test") args.selfTest = true;
    else if (argv[i] === "--consumer" && argv[i + 1]) args.consumer = argv[++i];
    else if (argv[i] === "--task" && argv[i + 1]) args.task = argv[++i];
  }
  return args;
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (args.selfTest) {
    const r = await selfTest();
    console.log(JSON.stringify(r, null, 2));
    process.exit(r.ok ? 0 : 1);
  }
  if (args.status) {
    const s = await getStatus();
    console.log(JSON.stringify(s, null, 2));
    process.exit(s.status === "pass" ? 0 : 1);
  }
  if (args.consumer) {
    const r = await selectModel({ consumer: args.consumer, task: args.task || "default" });
    console.log(JSON.stringify(r, null, 2));
    process.exit(r.ok ? 0 : 1);
  }
  const s = await getStatus();
  console.log(JSON.stringify(s, null, 2));
  process.exit(s.status === "pass" ? 0 : 1);
}

const invokedAsMain = process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href;
if (invokedAsMain) main();

export { selectModel, getStatus, chooseModel, probeAll, loadCatalog, cpuProbe, tierAtOrBelow };
