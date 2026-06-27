// 編碼: SPINE-RECALL | 標題: 累積記憶檢索注入推理(學習→應用閉環) | 時間:2026-06-21 | 重點:把crystallize的死檔記憶讀回來、注入模型推理,讓系統真的應用過去教訓不從零推理 | 內容重點:recall(query,k)關鍵詞重疊評分取相關教訓;零依賴 | agent_written: Claude(Cowork)
// 病根(使用者點出):記憶一直只寫不讀=死檔,神經鏈每次從零推理,沒應用累積教訓→學習了卻沒進化沒應用。
// 解法:處理任一gap前,先 recall 相關教訓注入 prompt,讓模型站在累積知識上推理(RAG over 共同記憶)。融合既有合議結晶/candidate-memory,不造平行。
import { readFileSync, existsSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { resolve } from "./resolve.mjs";
import { loadLedger } from "../learning-ledger.mjs";

const MEM = () => resolve("shared-memory");
// In-Task Learning Ledger 路徑（recall.mjs 在 scripts/lib/spine/ → OpenClaw root 上 3 層）
const OPENCLAW_ROOT = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "..");
const LEDGER_PATH = () => process.env.LEDGER_PATH || join(OPENCLAW_ROOT, ".openclaw", "state", "learning-ledger.jsonl");
const nulSafe = (b) => { const i = b.indexOf(0); return i > 0 ? b.subarray(0, i) : b; };

/** 載入可檢索教訓:合議結晶(question/conclusion) + candidate-memory(lessons[])。 */
function loadLessons() {
  const out = [];
  try {
    const cr = join(MEM(), "合議結晶.jsonl");
    if (existsSync(cr)) for (const l of nulSafe(readFileSync(cr)).toString("utf8").split("\n")) {
      if (!l) continue; try { const e = JSON.parse(l); const c = e.conclusion || e.answer; if (c && String(c).length > 20) out.push({ key: String((e.question || "") + " " + c), txt: String(c) }); } catch { /* skip */ }
    }
  } catch { /* 無檔→空 */ }
  // 第三來源：In-Task Learning Ledger（基元3）。bi-temporal：只注入有效教訓，過期/失效不召回；
  // 附 slug/step/condition 供關鍵詞命中。無帳本→略過，不影響既有合議結晶召回（純 additive）。
  try {
    for (const l of loadLedger(LEDGER_PATH()).values()) {
      if (l.invalidated_at) continue;
      const txt = String(l.rule || "");
      if (txt.length > 8) out.push({ key: [l.slug, l.step, l.condition, txt].join(" "), txt });
    }
  } catch { /* 無帳本/讀取失敗→略過，不影響既有召回 */ }
  return out;
}

/** 檢索與 query 最相關的 k 條教訓(關鍵詞重疊評分,零依賴)。回字串(換行分隔),無命中回 ""。 */
export function recall(query, { k = 3 } = {}) {
  const q = String(query || "").toLowerCase();
  const toks = [...new Set(q.split(/[^\p{L}\p{N}]+/u).filter((w) => w.length >= 2))];
  if (!toks.length) return "";
  const scored = loadLessons().map((L) => {
    const lt = L.key.toLowerCase(); let s = 0; for (const w of toks) if (lt.includes(w)) s++;
    return { s, txt: L.txt };
  }).filter((x) => x.s > 0).sort((a, b) => b.s - a.s).slice(0, k);
  return scored.map((x) => "• " + x.txt.slice(0, 300)).join("\n");
}

export default { recall };
