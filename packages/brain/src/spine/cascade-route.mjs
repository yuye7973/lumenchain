// Thin cascade router for agent inference:
// brain-call cache/local first, deterministic validation, then free cloud Qwen.
import fs from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { brainCall, compressPrompt } from "./brain-call.mjs";
import { logOutcome as probeLogOutcome, predict as probePredict } from "./confidence-probe.mjs";

const WF_ROOT = process.env.WF_ROOT || process.cwd();
const ENV_FILE = path.join(WF_ROOT, ".env");
const LOCAL_MODEL = process.env.CASCADE_LOCAL_MODEL || "qwen2.5:3b";
const SUMMARY_KINDS = new Set(["summary", "classify", "describe"]);
const DEFAULT_TIMEOUT_MS = Number(process.env.CASCADE_CLOUD_TIMEOUT_MS || process.env.WF_CLOUD_TIMEOUT_MS || 90000);
const DEFAULT_MODEL = process.env.WF_CLOUD_MODEL || "qwen/qwen3-coder:free";
const COUNCIL_FILE = path.join(WF_ROOT, "02_core", "engine", "laws", "多腦合議.mjs");
const CLOUD_MAX_TOKENS = Number(process.env.CASCADE_CLOUD_MAX_TOKENS || 128);
const PROBE_THRESHOLD = Number(process.env.CASCADE_PROBE_CONFIDENCE_THRESHOLD || 0.65);

const normalize = (value) => (typeof value === "string" ? value.trim() : "");

function allowedSemanticKind(kind) {
  return SUMMARY_KINDS.has(normalize(kind).toLowerCase());
}

function loadCloudEnv() {
  if (!fs.existsSync(ENV_FILE)) return;
  const text = fs.readFileSync(ENV_FILE, "utf8");
  for (const line of text.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const match = /^([A-Za-z_][A-Za-z0-9_]*)=(.*)$/.exec(trimmed);
    if (!match) continue;
    const [, key, rawValue] = match;
    if (!key.startsWith("WF_CLOUD")) continue;
    if (key === "WF_CLOUD_KEY") continue;
    if (process.env[key]) continue;
    let value = rawValue.trim();
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
      value = value.slice(1, -1);
    }
    process.env[key] = value;
  }
}

function normalizeProfile(raw, fallbackName) {
  if (!raw || typeof raw !== "object") return null;
  if (typeof raw.key === "string" || typeof raw.apiKey === "string" || typeof raw.token === "string" || typeof raw.api_key === "string") {
    return null;
  }
  const name = normalize(raw.name || fallbackName || "profile");
  const url = normalize(raw.url || raw.endpoint || raw.baseUrl || raw.apiUrl);
  const envKey = normalize(raw.envKey || raw.keyEnv || raw.env || raw.apiKeyEnv || raw.api_key_env);
  const key = envKey ? normalize(process.env[envKey]) : "";
  const model = normalize(raw.model || raw.modelName || DEFAULT_MODEL);
  const timeoutRaw = Number(raw.timeoutMs || raw.timeout_ms || DEFAULT_TIMEOUT_MS);
  if (!name || !url || !key) return null;
  return {
    name,
    url,
    envKey,
    key,
    model,
    timeoutMs: Number.isFinite(timeoutRaw) && timeoutRaw > 0 ? timeoutRaw : DEFAULT_TIMEOUT_MS,
  };
}

function parseProfiles(raw) {
  const text = normalize(raw);
  if (!text) return [];
  const out = [];
  if (text.startsWith("{") || text.startsWith("[")) {
    try {
      const parsed = JSON.parse(text);
      if (Array.isArray(parsed)) {
        for (const item of parsed) {
          const p = normalizeProfile(item);
          if (p) out.push(p);
        }
      } else if (parsed && typeof parsed === "object") {
        for (const [name, cfg] of Object.entries(parsed)) {
          if (name === "__proto__") continue;
          const p = normalizeProfile(cfg, name);
          if (p) out.push(p);
        }
      }
    } catch {
      return [];
    }
  }
  return out;
}

function orderProfiles(profiles) {
  const wanted = normalize(process.env.WF_CLOUD_PROFILE_ORDER);
  if (!wanted) return profiles;
  const names = wanted.split(",").map((x) => normalize(x).toLowerCase()).filter(Boolean);
  const byName = new Map(profiles.map((p) => [p.name.toLowerCase(), p]));
  const used = new Set();
  const out = [];
  for (const name of names) {
    const p = byName.get(name);
    if (!p || used.has(name)) continue;
    out.push(p);
    used.add(name);
  }
  for (const p of profiles) {
    const name = p.name.toLowerCase();
    if (used.has(name)) continue;
    out.push(p);
    used.add(name);
  }
  return out;
}

function availableProfiles() {
  loadCloudEnv();
  const profiles = orderProfiles(parseProfiles(process.env.WF_CLOUD_PROFILES));
  const pinned = normalize(process.env.WF_CLOUD_PROFILE).toLowerCase();
  if (!pinned) return profiles;
  const fixed = profiles.find((p) => p.name.toLowerCase() === pinned);
  return fixed ? [fixed, ...profiles.filter((p) => p !== fixed)] : profiles;
}

async function generateCloud(prompt, { schema = null, model = "" } = {}) {
  const profile = availableProfiles()[0];
  if (!profile) throw new Error("cloud-not-configured");
  const effectiveModel = normalize(model || profile.model || DEFAULT_MODEL);
  const systemHint = schema
    ? "Return only valid JSON that conforms to the requested schema. Do not include markdown fences."
    : "Reply in zh-Hant unless the prompt explicitly requests another language.";
  const ac = new AbortController();
  const timer = setTimeout(() => ac.abort(), profile.timeoutMs);
  try {
    const res = await fetch(profile.url, {
      method: "POST",
      signal: ac.signal,
      headers: { "content-type": "application/json", authorization: "Bearer " + profile.key },
      body: JSON.stringify({
        model: effectiveModel,
        messages: [
          { role: "system", content: systemHint },
          { role: "user", content: prompt },
        ],
        ...(Number.isFinite(CLOUD_MAX_TOKENS) && CLOUD_MAX_TOKENS > 0 ? { max_tokens: CLOUD_MAX_TOKENS } : {}),
        ...(schema && process.env.CASCADE_CLOUD_RESPONSE_FORMAT === "1" ? { response_format: { type: "json_object" } } : {}),
      }),
    });
    if (!res.ok) throw new Error("cloud http " + res.status);
    const json = await res.json();
    return {
      response: String(json.choices?.[0]?.message?.content ?? ""),
      provider: profile.name,
      model: effectiveModel,
      tokens: json.usage?.total_tokens || 0,
    };
  } finally {
    clearTimeout(timer);
  }
}

function parseJsonObject(text) {
  try {
    const parsed = JSON.parse(String(text));
    return { ok: true, value: parsed };
  } catch {
    return { ok: false, value: null };
  }
}

function validateType(value, schema) {
  if (!schema || typeof schema !== "object") return true;
  const expected = schema.type;
  if (!expected) return true;
  if (expected === "array") return Array.isArray(value);
  if (expected === "object") return value !== null && typeof value === "object" && !Array.isArray(value);
  if (expected === "integer") return Number.isInteger(value);
  return typeof value === expected;
}

function validateSchemaValue(value, schema, pathName = "$", reasons = []) {
  if (!schema || typeof schema !== "object") return reasons;
  if (!validateType(value, schema)) {
    reasons.push(`${pathName}:type`);
    return reasons;
  }
  if (schema.enum && !schema.enum.includes(value)) reasons.push(`${pathName}:enum`);
  if (schema.type === "object" && schema.properties && value && typeof value === "object") {
    for (const key of schema.required || []) {
      if (!(key in value)) reasons.push(`${pathName}.${key}:required`);
    }
    for (const [key, childSchema] of Object.entries(schema.properties)) {
      if (key in value) validateSchemaValue(value[key], childSchema, `${pathName}.${key}`, reasons);
    }
  }
  if (schema.type === "array" && schema.items && Array.isArray(value)) {
    value.slice(0, 20).forEach((item, index) => validateSchemaValue(item, schema.items, `${pathName}[${index}]`, reasons));
  }
  return reasons;
}

function deterministicSignal(response, { kind = "decision", schema = null, requiredKeywords = [] } = {}) {
  const text = String(response || "").trim();
  const reasons = [];
  if (!text) reasons.push("empty");
  if (text.length > 20000) reasons.push("too-long");
  if (/^(error|undefined|null)$/i.test(text)) reasons.push("placeholder");
  for (const keyword of requiredKeywords || []) {
    if (keyword && !text.includes(String(keyword))) reasons.push(`missing-keyword:${String(keyword).slice(0, 32)}`);
  }
  if (schema) {
    const parsed = parseJsonObject(text);
    if (!parsed.ok) reasons.push("json-parse");
    else validateSchemaValue(parsed.value, schema, "$", reasons);
  }
  const normalizedKind = normalize(kind).toLowerCase();
  if (normalizedKind === "classify" && !schema && text.length > 500) reasons.push("classify-too-long");
  return {
    method: schema ? "schema" : "deterministic-format",
    passed: reasons.length === 0,
    reasons,
  };
}

async function confidenceSignal({ prompt, response, kind, schema, requiredKeywords, deps, semantic }) {
  const predict = deps.probePredict || probePredict;
  const probe = await predict({ prompt, response });
  if (!probe || probe.fallback || probe.confidence == null) {
    return { ...deterministicSignal(response, { kind, schema, requiredKeywords }), semanticAllowed: semantic, probeFallback: probe?.reason || "probe-fallback" };
  }
  return {
    method: "confidence-probe",
    passed: Number(probe.confidence) >= PROBE_THRESHOLD,
    reasons: Number(probe.confidence) >= PROBE_THRESHOLD ? [] : [`confidence-below-threshold:${probe.confidence}`],
    confidence: probe.confidence,
    features: probe.features,
    modelVersion: probe.modelVersion,
    threshold: PROBE_THRESHOLD,
    semanticAllowed: semantic,
  };
}

function shouldDebate(kind, signal) {
  const normalizedKind = normalize(kind).toLowerCase();
  return (normalizedKind === "decision" || normalizedKind === "high-risk") && signal && signal.passed === false;
}

async function runCouncilDebate(prompt, { kind = "decision", schema = null, requiredKeywords = [], councilFn = null } = {}) {
  const runCouncil = councilFn || (await import(pathToFileURL(COUNCIL_FILE).href)).council;
  if (typeof runCouncil !== "function") throw new Error("council-not-available");
  const question = [
    "任務：對下列 agent 回答做節能型紅藍對抗，只在高風險低信心時使用。",
    "角色：Attacker 找錯與反例；Defender 保留可證明正確處；Judge 只能依 schema/格式/必含關鍵字/ground-truth/probe 訊號裁決。",
    "禁止：不得因語氣自信、篇幅較長或多數意見就判勝；不得新增未被題目或驗證訊號支持的主張。",
    schema ? `JSON schema: ${JSON.stringify(schema)}` : "JSON schema: none",
    requiredKeywords?.length ? `requiredKeywords: ${JSON.stringify(requiredKeywords)}` : "requiredKeywords: none",
    `kind: ${kind}`,
    "",
    "原始 prompt:",
    prompt,
  ].join("\n");
  const result = await runCouncil(question, {
    profile: "reasoning",
    rounds: 2,
    weighted: true,
    topK: 3,
    escalateBelow: 0.9,
  });
  if (!result?.ok || !normalize(result.synthesized)) {
    throw new Error(result?.reason || "council-failed");
  }
  return {
    response: String(result.synthesized),
    meta: {
      aggregator: result.aggregator || "",
      proposalCount: Array.isArray(result.proposals) ? result.proposals.length : 0,
      verifyRounds: result.verifyRounds || 0,
      antiEcho: result.antiEcho === true,
      reliabilityRanked: result.reliabilityRanked === true,
      diversity: result.diversity || [],
    },
  };
}

async function mineHardCase(result, deps) {
  try {
    // 可選硬例挖掘器:呼叫方注入 deps.caseMiner,或設環境變數 LUMEN_CASE_MINER 指向實作;OSS 預設無→回傳 null(安全降級)。
    const minerPath = process.env.LUMEN_CASE_MINER;
    const miner = deps.caseMiner || (minerPath ? (await import(pathToFileURL(minerPath).href)).mine : null);
    if (typeof miner === "function") return miner(result);
  } catch {
    return null;
  }
  return null;
}

export async function route({ prompt, kind = "decision", schema = null, requiredKeywords = [], _deps = null } = {}) {
  if (!normalize(prompt)) throw new Error("prompt-required");
  const deps = _deps || {};
  const finalize = async (result) => {
    try {
      const logOutcome = deps.probeLogOutcome || probeLogOutcome;
      await logOutcome({ prompt: compressed, response: result.response || "", passed: result.signal?.passed === true });
    } catch {
      // Probe training logs are best-effort and must not break routing.
    }
    return result;
  };
  const semantic = allowedSemanticKind(kind);
  const compressed = compressPrompt(prompt);
  const local = await (deps.brainCall || brainCall)({
    prompt: compressed,
    kind,
    schema,
    model: LOCAL_MODEL,
    semantic,
    compress: false,
  });
  const cacheHit = local?.cached ? String(local.hit || "exact") : "";
  if (local?.cached) {
    return await finalize({
      response: local.response || "",
      tier: cacheHit === "semantic" ? "semantic-cache" : "exact-cache",
      cached: true,
      escalated: false,
      debated: false,
      signal: { method: "cache", passed: true, hit: cacheHit || "exact", semanticAllowed: semantic },
    });
  }

  const signal = local?.error
    ? { method: "local-runtime", passed: false, reasons: [local.error], semanticAllowed: semantic }
    : await confidenceSignal({ prompt: compressed, response: local?.response || "", kind, schema, requiredKeywords, deps, semantic });
  if (signal.passed) {
    return await finalize({
      response: local.response || "",
      tier: "local",
      cached: false,
      escalated: false,
      debated: false,
      signal,
    });
  }

  const cloudGenerate = deps.cloudGenerate || generateCloud;
  try {
    const cloud = await cloudGenerate(compressed, { schema });
    const cloudSignal = deterministicSignal(cloud.response, { kind, schema, requiredKeywords });
    if (shouldDebate(kind, cloudSignal)) {
      try {
        const debate = await (deps.councilDebate || runCouncilDebate)(compressed, {
          kind,
          schema,
          requiredKeywords,
          councilFn: deps.council,
        });
        const debateSignal = deterministicSignal(debate.response, { kind, schema, requiredKeywords });
        const result = {
          response: debate.response,
          tier: "council",
          cached: false,
          escalated: true,
          debated: true,
          signal: {
            ...debateSignal,
            localRejected: signal.reasons || [],
            cloudRejected: cloudSignal.reasons || [],
            provider: cloud.provider || "",
            model: cloud.model || "",
            tokens: cloud.tokens || 0,
            debate: debate.meta || {},
            semanticAllowed: semantic,
          },
        };
        result.caseMining = debateSignal.passed
          ? await mineHardCase({
              ...result,
              prompt: compressed,
              wrong: cloud.response,
              corrected: debate.response,
              evidence: { type: "deterministic-signal", passed: debateSignal.passed, reasons: debateSignal.reasons },
              source: "cascade",
            }, deps)
          : { accepted: false, reason: "debate-signal-not-passed" };
        return await finalize(result);
      } catch (debateError) {
        return await finalize({
          response: cloud.response,
          tier: "cloud",
          cached: false,
          escalated: true,
          debated: false,
          signal: {
            ...cloudSignal,
            localRejected: signal.reasons || [],
            provider: cloud.provider || "",
            model: cloud.model || "",
            tokens: cloud.tokens || 0,
            debateSkipped: false,
            debateError: String(debateError?.message || debateError).slice(0, 80),
            semanticAllowed: semantic,
          },
        });
      }
    }
    return await finalize({
      response: cloud.response,
      tier: "cloud",
      cached: false,
      escalated: true,
      debated: false,
      signal: {
        ...cloudSignal,
        localRejected: signal.reasons || [],
        provider: cloud.provider || "",
        model: cloud.model || "",
        tokens: cloud.tokens || 0,
        debateSkipped: !shouldDebate(kind, cloudSignal),
        semanticAllowed: semantic,
      },
    });
  } catch (error) {
    return await finalize({
      response: local?.response || "",
      tier: local?.error ? "error" : "local",
      cached: false,
      escalated: false,
      debated: false,
      signal: {
        ...signal,
        cloudError: String(error?.message || error).slice(0, 80),
      },
    });
  }
}

async function selfTest() {
  const calls = [];
  const exact = await route({
    prompt: "cache me",
    kind: "summary",
    _deps: {
      brainCall: async (args) => {
        calls.push(args);
        return { response: "cached", cached: true, hit: "exact" };
      },
      probeLogOutcome: async () => ({ ok: true }),
    },
  });

  let escalatedCloud = false;
  const escalated = await route({
    prompt: "need json",
    kind: "decision",
    schema: { type: "object", required: ["ok"], properties: { ok: { type: "boolean" } } },
    _deps: {
      brainCall: async (args) => {
        calls.push(args);
        return { response: "not json", cached: false };
      },
      cloudGenerate: async () => {
        escalatedCloud = true;
        return { response: "{\"ok\":true}", provider: "mock", model: "mock-qwen", tokens: 1 };
      },
      probePredict: async () => ({ fallback: true, reason: "self-test" }),
      probeLogOutcome: async () => ({ ok: true }),
    },
  });

  let decisionSemantic = null;
  await route({
    prompt: "make a routing decision",
    kind: "decision",
    _deps: {
      brainCall: async (args) => {
        decisionSemantic = args.semantic;
        return { response: "go", cached: false };
      },
      probePredict: async () => ({ fallback: true, reason: "self-test" }),
      probeLogOutcome: async () => ({ ok: true }),
    },
  });

  let routineDebateCalls = 0;
  const routine = await route({
    prompt: "summarize invalid local",
    kind: "summary",
    schema: { type: "object", required: ["ok"], properties: { ok: { type: "boolean" } } },
    _deps: {
      brainCall: async () => ({ response: "not json", cached: false }),
      cloudGenerate: async () => ({ response: "not json either", provider: "mock", model: "mock-qwen", tokens: 1 }),
      councilDebate: async () => {
        routineDebateCalls++;
        return { response: "{\"ok\":true}", meta: {} };
      },
      probePredict: async () => ({ fallback: true, reason: "self-test" }),
      probeLogOutcome: async () => ({ ok: true }),
    },
  });

  let debateCalls = 0;
  const debated = await route({
    prompt: "high risk decision",
    kind: "decision",
    schema: { type: "object", required: ["ok"], properties: { ok: { type: "boolean" } } },
    _deps: {
      brainCall: async () => ({ response: "not json", cached: false }),
      cloudGenerate: async () => ({ response: "still not json", provider: "mock", model: "mock-qwen", tokens: 1 }),
      councilDebate: async () => {
        debateCalls++;
        return { response: "{\"ok\":true}", meta: { antiEcho: true } };
      },
      caseMiner: () => ({ accepted: true, reason: "self-test" }),
      probePredict: async () => ({ fallback: true, reason: "self-test" }),
      probeLogOutcome: async () => ({ ok: true }),
    },
  });

  const results = [
    ["exact cache hit", exact.cached === true && exact.tier === "exact-cache"],
    ["invalid local escalates", escalated.escalated === true && escalatedCloud && escalated.tier === "cloud"],
    ["decision disables semantic", decisionSemantic === false],
    ["routine does not debate", routineDebateCalls === 0 && routine.debated === false],
    ["decision low-confidence debates", debateCalls === 1 && debated.debated === true && debated.tier === "council"],
  ];
  const ok = results.every(([, pass]) => pass);
  console.log(JSON.stringify({ ok, results: results.map(([name, pass]) => ({ name, pass })) }, null, 2));
  process.exit(ok ? 0 : 1);
}

if (process.argv.includes("--self-test")) {
  await selfTest();
}
