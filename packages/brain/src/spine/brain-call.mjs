// lib/spine/brain-call.mjs — 本地大腦呼叫＋response 快取（省 token/算力、解壅塞）。
// 開源最強技術：prompt/semantic caching（重複呼叫零推理，省30-90%）。本檔先做 exact-match（stdlib crypto，零依賴，Ponytail「最小可行」）。
// 也統一三處重複的 fetch(模組唯一性)。命中＝零推理零雲端token。語意快取(nomic-embed)為V2。
import { createHash } from "node:crypto";
import { readFileSync, writeFileSync, existsSync, mkdirSync, readdirSync, statSync, unlinkSync } from "node:fs";
import { join } from "node:path";
const ROOT = process.env.OPENCLAW_ROOT || process.cwd();
const DIR = join(ROOT, ".openclaw", "cache", "brain");

// 本地嵌入（nomic-embed，零雲端 token）＋ cosine。語意快取用。
export async function embed(text) {
  try {
    const r = await fetch("http://localhost:11434/api/embeddings", { method: "POST", signal: AbortSignal.timeout(15000), body: JSON.stringify({ model: "nomic-embed-text", prompt: text.slice(0, 2000) }) });
    if (!r.ok) return null; const j = await r.json(); return Array.isArray(j.embedding) ? j.embedding : null;
  } catch { return null; }
}
const cosine = (a, b) => { let d = 0, na = 0, nb = 0; for (let i = 0; i < a.length; i++) { d += a[i] * b[i]; na += a[i] * a[i]; nb += b[i] * b[i]; } return d / (Math.sqrt(na) * Math.sqrt(nb) || 1); };

// 輕量 prompt 壓縮（stdlib，零安裝，取代重型 LLMLingua）：只去冗餘空白/重複空行，不刪內容（守懶≠疏忽:不損意義）。
// 短 prompt 邊際小但零成本；長 context 才考慮 LLMLingua(需源審+GPU+sandbox)。
export function compressPrompt(p) {
  return String(p)
    .replace(/[ \t]+/g, " ")      // 多空白→單空格
    .replace(/ *\n */g, "\n")     // 行首尾空白
    .replace(/\n{3,}/g, "\n\n")   // 3+空行→1空行
    .trim();
}

/**
 * 本地大腦呼叫，帶 response 快取。回 {response, cached, hit?, error?}。
 * 預設 exact-match（安全，決策類用）。semantic:true 才開語意近似命中（摘要/分類/描述類，near-match 可接受時用；
 * 守「懶≠疏忽」：決策/路由有副作用者勿開語意，避免近似誤命中回錯答案）。
 */
export async function brainCall({ prompt, schema = null, model = "qwen2.5:3b", ttlMin = 1440, temperature = 0.1, timeoutMs = 60000, semantic = false, simThreshold = 0.92, compress = true }) {
  if (compress) prompt = compressPrompt(prompt); // 壓縮後再算 key/送出，省 token 且快取一致
  // 本地模型(qwen)預設常出簡體/英文；自由文字回覆統一繁體中文(zh-Hant)。結構化輸出(schema)不加前綴以免干擾 JSON。
  if (!schema) prompt = "請一律使用繁體中文（台灣用語，zh-Hant）回答，不要使用簡體字或英文整段回覆。\n\n" + prompt;
  const key = createHash("sha256").update(model + "|" + JSON.stringify(schema) + "|" + prompt).digest("hex").slice(0, 24);
  const cf = join(DIR, key + ".json");
  // ① exact-match 命中（TTL 內）→ 零推理
  try { if (existsSync(cf)) { const c = JSON.parse(readFileSync(cf, "utf8")); if (Date.now() - c.ts < ttlMin * 60000) return { response: c.response, cached: true, hit: "exact" }; } } catch {}
  // ②（opt-in）語意近似命中：嵌入 query → cosine 掃近期快取 → ≥threshold 回快取（零生成推理）
  let qvec = null;
  if (semantic) {
    qvec = await embed(prompt);
    if (qvec) {
      try {
        const files = readdirSync(DIR).filter(f => f.endsWith(".json")).slice(-200);
        let best = 0, bestResp = null;
        for (const f of files) {
          try { const c = JSON.parse(readFileSync(join(DIR, f), "utf8")); if (c.model === model && c.embedding && Date.now() - c.ts < ttlMin * 60000) { const s = cosine(qvec, c.embedding); if (s > best) { best = s; bestResp = c.response; } } } catch {}
        }
        if (best >= simThreshold && bestResp != null) return { response: bestResp, cached: true, hit: "semantic", sim: Number(best.toFixed(3)) };
      } catch {}
    }
  }
  // ③ miss → 呼叫 Ollama（生成）
  try {
    const body = { model, prompt, stream: false, options: { temperature } };
    if (schema) body.format = schema;
    const r = await fetch("http://localhost:11434/api/generate", { method: "POST", signal: AbortSignal.timeout(timeoutMs), body: JSON.stringify(body) });
    if (!r.ok) return { error: "ollama " + r.status, cached: false };
    const j = await r.json();
    const response = j.response || "";
    try { mkdirSync(DIR, { recursive: true }); writeFileSync(cf, JSON.stringify({ ts: Date.now(), model, response, embedding: qvec || undefined }), "utf8"); } catch {}
    return { response, cached: false };
  } catch (e) { return { error: String(e.name || e.message).slice(0, 50), cached: false }; }
}

/** 健康 ping（短逾時，過載快速回退不硬打＝資源閘）。 */
export async function brainReady(timeoutMs = 5000) {
  try { const r = await fetch("http://localhost:11434/api/tags", { signal: AbortSignal.timeout(timeoutMs) }); return r.ok; } catch { return false; }
}

/** 快取統計（命中率觀測）＋ 過期清理。 */
export function cacheStats(pruneOlderMin = 10080) {
  let total = 0, pruned = 0;
  try { for (const f of readdirSync(DIR)) { if (!f.endsWith(".json")) continue; total++; const p = join(DIR, f); if (Date.now() - statSync(p).mtimeMs > pruneOlderMin * 60000) { try { unlinkSync(p); pruned++; } catch {} } } } catch {}
  return { entries: total - pruned, pruned };
}
