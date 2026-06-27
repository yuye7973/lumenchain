#!/usr/bin/env node
// scripts/lib/learning-ledger.mjs — In-Task Learning Ledger（任務進行中即時學習帳本）
// RTL Loop 基元 3：把「任務進行當下的失敗」即時結晶成可被『同一任務下一步 / 下一個 agent』立刻引用的教訓。
//
// 融合自 2025-2026 SOTA（皆不改模型權重，對齊憲法「只進化 context/knowledge」）：
//   - ACE (arXiv:2510.04618)：條目化 bullet + helpful/harmful 計數 + 確定性合併(非 LLM 重寫) → 防 context collapse / brevity bias。
//   - FORGE：失敗 trajectory → Rule/Example 知識物件 → 即時注入下一步。
//   - Graphiti/Zep (arXiv:2501.13956)：bi-temporal 有效性 → 過期教訓「失效(invalidate)」而非刪除，避免引用被推翻的舊結論。
//   - AutoGuide (arXiv:2403.08978)：教訓帶「適用條件(condition)」→ 用得準、越用越深。
//   - SRT/Inference-Time Reward Hacking (arXiv:2506.19248)：純自評閉環必崩 → 計數須由『外部 ground truth(verify 閘)』回饋，不可自我加分。
//
// 設計鐵則：
//   1) 確定性去重：教訓 id = hash(正規化 rule + condition)，同教訓恆同 id → 原地更新計數，永不重複堆積。
//   2) 不靠 LLM 合併：合併純程式，避免「整段重寫越寫越短」的 collapse。
//   3) bi-temporal：invalidated_at != null 即失效；recall 預設只回有效教訓。
//   4) 自我糾錯：harmful - helpful 達閾值 → 自動失效（壞教訓會死，防越學越淺）。
//   5) 原子落盤：用 safe-write.mjs，停在任何一刻都不留半截/孤兒 tmp。
import { createHash } from "node:crypto";
import { readFileSync, existsSync, appendFileSync, mkdirSync } from "node:fs";
import { dirname } from "node:path";
import { safeWriteFileSync } from "./safe-write.mjs";

const HARM_NET_THRESHOLD = Number(process.env.LEDGER_HARM_THRESHOLD ?? 3); // (harmful-helpful)≥此值 → 自動失效

const norm = (s) => String(s ?? "").toLowerCase().replace(/\s+/g, " ").replace(/[^\p{L}\p{N} ]/gu, "").trim();
const lessonId = (rule, condition) => createHash("sha1").update(norm(rule) + "|" + norm(condition)).digest("hex").slice(0, 16);
const nowIso = () => new Date().toISOString();

// 讀 JSONL → 依 id 收斂（last-write-wins），回傳 Map<id, lesson>
export function loadLedger(path) {
  const map = new Map();
  if (!existsSync(path)) return map;
  let raw = "";
  try { raw = readFileSync(path, "utf8"); } catch { return map; }
  for (const line of raw.split(/\r?\n/)) {
    const t = line.trim();
    if (!t) continue;
    try { const o = JSON.parse(t); if (o && o.id) map.set(o.id, o); } catch { /* 跳過壞行，不讓單行污染整帳本 */ }
  }
  return map;
}

function persist(path, map) {
  const body = [...map.values()].map((o) => JSON.stringify(o)).join("\n") + "\n";
  safeWriteFileSync(path, body); // 原子寫（用修好的 safe-write，rename 失敗清 tmp 不洩漏）
}

// 記錄一條教訓（任務進行中失敗即呼叫）。同 id 已存在且有效 → 不重複，只回 deduped:true。
export function recordLesson(path, { slug = "", step = "", rule, condition = "*", evidence = "", supersedes = null }) {
  if (!rule || !norm(rule)) throw new Error("recordLesson: rule 不可為空");
  const map = loadLedger(path);
  const id = lessonId(rule, condition);
  const ts = nowIso();
  if (supersedes && map.has(supersedes)) { // 新教訓取代舊的 → 舊的 bi-temporal 失效（不刪）
    const old = map.get(supersedes);
    if (!old.invalidated_at) { old.invalidated_at = ts; old.invalidated_reason = `superseded_by:${id}`; map.set(supersedes, old); }
  }
  const existing = map.get(id);
  if (existing && !existing.invalidated_at) { persist(path, map); return { id, deduped: true }; } // 已有有效同教訓 → 不堆積
  map.set(id, {
    id, type: "lesson", slug, step, rule: String(rule), condition: String(condition), evidence: String(evidence),
    helpful: 0, harmful: 0, valid_from: ts, invalidated_at: null, invalidated_reason: null, supersedes: supersedes || null,
  });
  persist(path, map);
  return { id, deduped: false };
}

// 條件是否適用於當前 recall 情境（AutoGuide 條件式檢索：用得準）
function applies(lesson, haystackNorm) {
  const c = norm(lesson.condition);
  if (!c || c === "*") return true;
  if (haystackNorm.includes(c)) return true;
  const toks = c.split(" ").filter((w) => w.length > 2);
  return toks.some((w) => haystackNorm.includes(w));
}

// 取出當下可即時注入的有效教訓（in-task availability），依淨幫助度排序
export function recallLessons(path, { slug = "", step = "", contextText = "", limit = 10 } = {}) {
  const map = loadLedger(path);
  const haystack = norm([slug, step, contextText].join(" "));
  return [...map.values()]
    .filter((l) => !l.invalidated_at && applies(l, haystack))
    .sort((a, b) => (b.helpful - b.harmful) - (a.helpful - a.harmful) || Date.parse(b.valid_from) - Date.parse(a.valid_from))
    .slice(0, limit);
}

function bumpCounter(path, id, field) {
  const map = loadLedger(path);
  const l = map.get(id);
  if (!l) return null;
  l[field] = (Number(l[field]) || 0) + 1;
  // 自我糾錯：壞教訓淨負達閾值 → 自動 bi-temporal 失效（防越學越淺）
  if (!l.invalidated_at && (Number(l.harmful) - Number(l.helpful)) >= HARM_NET_THRESHOLD) {
    l.invalidated_at = nowIso(); l.invalidated_reason = `auto:harmful_net>=${HARM_NET_THRESHOLD}`;
  }
  map.set(id, l); persist(path, map); return l;
}
// helpful 必須由外部 ground truth(verify 閘通過)觸發，不可模型自我加分 → 防 reward hacking 崩潰
export const markHelpful = (path, id) => bumpCounter(path, id, "helpful");
export const markHarmful = (path, id) => bumpCounter(path, id, "harmful");

// 顯式失效（教訓被推翻 / 不再適用），bi-temporal soft-delete 留痕可回溯
export function invalidateLesson(path, id, reason = "manual") {
  const map = loadLedger(path);
  const l = map.get(id);
  if (!l || l.invalidated_at) return null;
  l.invalidated_at = nowIso(); l.invalidated_reason = reason; map.set(id, l); persist(path, map); return l;
}

// ②寫端：把教訓回流進既有神經結晶脊髓——append 一筆 failure_pattern 進 candidate-memory.jsonl，
// 由既有 openclaw-pattern-crystallizer.mjs 聚類(≥2 同根因)→ pattern-proposal → 女媧核准閘(不自動晉升)。
// 採 append-only：不 clobber factory-fixer 等並發寫入，符合 candidate-memory 的 raw-failure log 設計。
// pattern 字串依 crystallizer 的 rootSig 解析器格式（rootcause=<condition> 為聚類簽章）。
export function emitCandidate(candidatePath, { slug = "", step = "", rule, condition = "*", evidence = "" }) {
  if (!rule || !norm(rule)) throw new Error("emitCandidate: rule 不可為空");
  const ts = nowIso();
  const cond = norm(condition) || "misc";
  const short = String(rule).slice(0, 80);
  const pattern = `learning-ledger rootcause=${cond} fix=${short} lesson=${rule} slug=${slug} step=${step}${evidence ? " evidence=" + evidence : ""}`;
  const row = { ts, source: "learning-ledger", kind: "failure_pattern", pattern, occurrences: 1, firstSeen: ts, lastSeen: ts };
  try { mkdirSync(dirname(candidatePath), { recursive: true }); } catch {}
  appendFileSync(candidatePath, JSON.stringify(row) + "\n", "utf8");
  return { emitted: true, pattern };
}

// 學習深度量測（補 G-L3 膚淺健檢：衡量「真的有在學」而非僅結構就緒）
export function stats(path) {
  const all = [...loadLedger(path).values()];
  const valid = all.filter((l) => !l.invalidated_at);
  const used = all.filter((l) => (l.helpful + l.harmful) > 0);
  return {
    total: all.length,
    valid: valid.length,
    invalidated: all.length - valid.length,
    helpfulSum: all.reduce((s, l) => s + (Number(l.helpful) || 0), 0),
    harmfulSum: all.reduce((s, l) => s + (Number(l.harmful) || 0), 0),
    usedRate: all.length ? +(used.length / all.length).toFixed(3) : 0, // 教訓被實際引用比例 = 學習是否「活著」
  };
}
