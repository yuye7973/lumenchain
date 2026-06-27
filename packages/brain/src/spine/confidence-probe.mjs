import { createHash } from "node:crypto";
import { appendFileSync, existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { embed as defaultEmbed } from "./brain-call.mjs";

const MODULE_DIR = dirname(fileURLToPath(import.meta.url));
const OPENCLAW_ROOT = process.env.OPENCLAW_ROOT || resolve(MODULE_DIR, "..", "..", "..");
const DEFAULT_DATA_DIR = join(OPENCLAW_ROOT, ".openclaw", "probes");
const MODEL_VERSION = "confidence-probe-v1";

function dataDir() {
  return process.env.CONFIDENCE_PROBE_DIR || DEFAULT_DATA_DIR;
}

function weightsPath() {
  return join(dataDir(), "confidence-probe-weights.json");
}

function trainLogPath() {
  return join(dataDir(), "probe-train.jsonl");
}

function sigmoid(value) {
  return 1 / (1 + Math.exp(-Math.max(-40, Math.min(40, value))));
}

function dot(a, b) {
  const n = Math.min(a.length, b.length);
  let out = 0;
  for (let i = 0; i < n; i++) out += Number(a[i] || 0) * Number(b[i] || 0);
  return out;
}

function normalizeEmbedding(value) {
  if (!Array.isArray(value) || value.length === 0) return null;
  const out = value.map((x) => Number(x)).filter((x) => Number.isFinite(x));
  return out.length ? out : null;
}

function featureSummary(embedding) {
  const dims = embedding.length;
  const mean = embedding.reduce((sum, x) => sum + x, 0) / dims;
  const norm = Math.sqrt(embedding.reduce((sum, x) => sum + x * x, 0));
  const sha = createHash("sha256").update(JSON.stringify(embedding.slice(0, 64))).digest("hex").slice(0, 16);
  return { dims, mean: Number(mean.toFixed(6)), norm: Number(norm.toFixed(6)), sha };
}

function readWeights(path = weightsPath()) {
  try {
    const parsed = JSON.parse(readFileSync(path, "utf8").replace(/^\uFEFF/, ""));
    if (!Array.isArray(parsed.weights) || !Number.isFinite(Number(parsed.bias))) return null;
    return parsed;
  } catch {
    return null;
  }
}

function atomicWriteJson(path, payload) {
  mkdirSync(dirname(path), { recursive: true });
  const tmp = `${path}.tmp-${process.pid}-${Date.now()}`;
  writeFileSync(tmp, `${JSON.stringify(payload, null, 2)}\n`, "utf8");
  renameSync(tmp, path);
}

async function embedPair(prompt, response, embedFn = defaultEmbed) {
  const text = `${String(prompt || "")}\n${String(response || "")}`.slice(0, 8000);
  const vector = normalizeEmbedding(await embedFn(text));
  return vector;
}

export async function predict({ prompt = "", response = "", _deps = {} } = {}) {
  const weights = readWeights(_deps.weightsPath || weightsPath());
  if (!weights) {
    return { confidence: null, fallback: true, reason: "weights-missing", features: null, modelVersion: MODEL_VERSION };
  }
  const embedding = normalizeEmbedding(_deps.embedding) || await embedPair(prompt, response, _deps.embed || defaultEmbed);
  if (!embedding) {
    return { confidence: null, fallback: true, reason: "embedding-unavailable", features: null, modelVersion: weights.modelVersion || MODEL_VERSION };
  }
  const confidence = sigmoid(dot(weights.weights, embedding) + Number(weights.bias || 0));
  return {
    confidence: Number(confidence.toFixed(6)),
    fallback: false,
    features: featureSummary(embedding),
    modelVersion: weights.modelVersion || MODEL_VERSION,
  };
}

export function train(samples = [], options = {}) {
  const normalized = samples
    .map((sample) => ({ embedding: normalizeEmbedding(sample.embedding), label: Number(sample.label) }))
    .filter((sample) => sample.embedding && (sample.label === 0 || sample.label === 1));
  if (!normalized.length) throw new Error("confidence-probe-train-samples-required");
  const dim = normalized[0].embedding.length;
  const usable = normalized.filter((sample) => sample.embedding.length === dim);
  if (!usable.length) throw new Error("confidence-probe-train-dim-mismatch");
  const epochs = Number(options.epochs || 240);
  const learningRate = Number(options.learningRate || 0.2);
  const l2 = Number(options.l2 || 0.001);
  const weights = Array(dim).fill(0);
  let bias = 0;
  for (let epoch = 0; epoch < epochs; epoch++) {
    for (const sample of usable) {
      const prediction = sigmoid(dot(weights, sample.embedding) + bias);
      const error = prediction - sample.label;
      for (let i = 0; i < dim; i++) {
        weights[i] -= learningRate * (error * sample.embedding[i] + l2 * weights[i]);
      }
      bias -= learningRate * error;
    }
  }
  const payload = {
    schema: "openclaw.confidence-probe.weights.v1",
    modelVersion: MODEL_VERSION,
    trainedAt: new Date().toISOString(),
    sampleCount: usable.length,
    dim,
    bias,
    weights,
  };
  atomicWriteJson(options.weightsPath || weightsPath(), payload);
  return payload;
}

export async function logOutcome({ prompt = "", response = "", passed = false, _deps = {} } = {}) {
  const embedding = normalizeEmbedding(_deps.embedding) || await embedPair(prompt, response, _deps.embed || defaultEmbed);
  if (!embedding) return { ok: false, reason: "embedding-unavailable" };
  const row = {
    ts: new Date().toISOString(),
    modelVersion: MODEL_VERSION,
    label: passed ? 1 : 0,
    embedding,
  };
  const outPath = _deps.trainLogPath || trainLogPath();
  mkdirSync(dirname(outPath), { recursive: true });
  appendFileSync(outPath, `${JSON.stringify(row)}\n`, "utf8");
  return { ok: true, path: outPath };
}

async function selfTest() {
  const priorDir = process.env.CONFIDENCE_PROBE_DIR;
  process.env.CONFIDENCE_PROBE_DIR = join(OPENCLAW_ROOT, ".openclaw", "tmp", `confidence-probe-selftest-${process.pid}`);
  try {
    const fallback = await predict({ prompt: "p", response: "r", _deps: { embed: async () => [1, 1] } });
    if (!fallback.fallback || fallback.reason !== "weights-missing") throw new Error("missing weights should fallback");
    train([
      { embedding: [0, 0], label: 0 },
      { embedding: [1, 1], label: 1 },
      { embedding: [0.1, 0.1], label: 0 },
      { embedding: [0.9, 0.9], label: 1 },
    ]);
    const low = await predict({ prompt: "low", response: "low", _deps: { embed: async () => [0, 0] } });
    const high = await predict({ prompt: "high", response: "high", _deps: { embed: async () => [1, 1] } });
    if (!(high.confidence > low.confidence)) throw new Error("trained probe direction failed");
    const logged = await logOutcome({ prompt: "p", response: "r", passed: true, _deps: { embed: async () => [1, 1] } });
    if (!logged.ok || !existsSync(logged.path)) throw new Error("logOutcome failed");
    console.log(JSON.stringify({ ok: true, status: "self-test-pass", low: low.confidence, high: high.confidence }));
  } finally {
    if (priorDir === undefined) delete process.env.CONFIDENCE_PROBE_DIR;
    else process.env.CONFIDENCE_PROBE_DIR = priorDir;
  }
}

if (import.meta.url === pathToFileURL(process.argv[1] || "").href && process.argv.includes("--self-test")) {
  await selfTest();
}
