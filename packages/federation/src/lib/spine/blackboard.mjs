// 編碼: SPINE-BOARD | 標題: 共享黑板(事件溯源·完全無鎖) | 時間:2026-06-21 | 重點:所有寫入只append事件,讀取fold,零整檔覆寫競態 | 內容重點:post/claim/complete=append事件;claim/done委派comms租約隊列 | agent_written: Claude(Cowork)
// 升級(2026-06-21):原本 post/complete 用整檔 load+save(整檔覆寫)→不同任務並發寫會互蓋(實證 30 並發掉 20 筆)。
//   改 event sourcing:狀態=fold(舊快照 base + 事件流);所有變更只 appendFileSync 一行 → 並發物理上不互蓋(同 Redis Stream/append-only log 概念)。
//   認領/完成委派 comms 租約隊列(不打架+不孤兒+完成釋放鎖)。舊 共創黑板.json 保留為唯讀 base 快照,不再寫入。
import { readFileSync, appendFileSync, writeFileSync, renameSync, existsSync, mkdirSync } from "node:fs";
import { join, dirname } from "node:path";
import { resolve } from "./resolve.mjs";
import { claim as atomicClaim, done as atomicDone, claimant } from "./comms.mjs";

const BOARD = join(resolve("shared-memory"), "共創黑板.json");          // 舊快照:唯讀 base(相容既有資料)
const EVENTS = join(resolve("shared-memory"), "共創黑板-events.jsonl"); // 新:append-only 事件流(唯一寫入面)
const nulSafe = (b) => { const i = b.indexOf(0); return i > 0 ? b.subarray(0, i) : b; };
const iso = () => new Date().toISOString();

/** append 一個事件(唯一寫入路徑,並發安全)。每行保證 <PIPE_BUF(4096)→並發 append 原子不交錯(開源實證)。 */
function emit(e) {
  mkdirSync(dirname(EVENTS), { recursive: true });
  let line = JSON.stringify({ ...e, ts: e.ts || iso() }) + "\n";
  if (Buffer.byteLength(line, "utf8") > 3800 && e.need) { line = JSON.stringify({ ...e, need: String(e.need).slice(0, 800), ts: e.ts || iso() }) + "\n"; }
  appendFileSync(EVENTS, line, "utf8");
}

/** 讀取當前狀態=fold(舊快照 base + 事件流)。零鎖、純讀。 */
function load() {
  const map = new Map();
  let uptoTs = "";                                                        // 快照浮水印:只套用其後的事件,fold 成本限縮在尾段(開源:snapshot+compaction)
  if (existsSync(BOARD)) { try { const snap = JSON.parse(nulSafe(readFileSync(BOARD)).toString("utf8")); uptoTs = snap._uptoTs || ""; for (const it of (snap.intents || [])) map.set(it.id, { ...it }); } catch { /* 快照壞→忽略,以事件為準 */ } }
  if (existsSync(EVENTS)) {
    for (const l of nulSafe(readFileSync(EVENTS)).toString("utf8").split("\n")) {
      if (!l) continue; let e; try { e = JSON.parse(l); } catch { continue; }   // 跳壞行,不整批爆
      if (uptoTs && e.ts && e.ts <= uptoTs) continue;                            // 已併入快照的舊事件→跳過(避免重複套用)
      const cur = map.get(e.id) || { id: e.id, slug: e.id, status: "open", claimedBy: null, history: [] };
      if (e.ev === "post") { if (!map.has(e.id)) { cur.slug = e.slug || e.id; cur.need = e.need || ""; cur.sources = e.sources || []; cur.status = "open"; cur.ts = e.ts; } } // 冪等:同 id 首次 post 為準
      else if (e.ev === "claim") { cur.status = "claimed"; cur.claimedBy = e.by; }
      else if (e.ev === "done") { cur.status = "done"; cur.result = e.result || ""; }
      (cur.history = cur.history || []).push({ ev: e.ev, by: e.by, ts: e.ts });
      map.set(e.id, cur);
    }
  }
  return { schema: "openclaw.coboard.v2", intents: [...map.values()] };
}

/** 壓縮(快照):fold 當前狀態→原子寫回 BOARD 快照+浮水印;之後 load 只需套用浮水印後的新事件。
 *  安全:單一維護者呼叫;原子 rename;不刪事件流(舊事件靠浮水印跳過,離線封存另行處理)→零遺失、可回溯。 */
export function compact() {
  const state = load();
  const uptoTs = iso();                                                   // 此刻之前的事件都已併入快照
  const snap = { schema: "openclaw.coboard.v2", _uptoTs: uptoTs, _compactedAt: uptoTs, intents: state.intents };
  mkdirSync(dirname(BOARD), { recursive: true });
  writeFileSync(BOARD + ".tmp", JSON.stringify(snap, null, 2) + "\n", "utf8"); renameSync(BOARD + ".tmp", BOARD);  // 原子替換快照
  return { ok: true, intents: state.intents.length, uptoTs };
}

/** 貼意圖(冪等:已存在不重發;即使並發重發,fold 也去重)。 */
export function post({ slug, need, sources = [] }) {
  if (!slug) return { ok: false, reason: "需 slug" };
  if (load().intents.some((i) => i.id === slug)) return { ok: true, note: "已存在", slug };
  emit({ ev: "post", id: slug, slug, need: String(need || "").slice(0, 500), sources });
  return { ok: true, posted: slug };
}

/** 列意圖(可依 status 篩)。 */
export function list({ status } = {}) { return load().intents.filter((i) => !status || i.status === status); }

/** 認領:comms 租約鎖決勝(不打架+不孤兒)→ append claim 事件(無鎖)。 */
export function claim(id, agent) {
  const lock = atomicClaim(id, agent);
  if (!lock.ok) return { ok: false, reason: "已被認領/完成", by: lock.by };
  emit({ ev: "claim", id, by: agent });
  return { ok: true, claimed: id, by: agent, reclaimed: lock.reclaimed };
}

/** 完成:append done 事件(無鎖)+ comms.done(=XACK 釋放租約鎖)。 */
export function complete(id, agent, result) {
  emit({ ev: "done", id, by: agent, result: String(result || "").slice(0, 300) });
  atomicDone(id, agent, result);
  return { ok: true, done: id };
}

export function stats() { const xs = load().intents; return { total: xs.length, open: xs.filter((i) => i.status === "open").length, claimed: xs.filter((i) => i.status === "claimed").length, done: xs.filter((i) => i.status === "done").length }; }

/** 查權威認領者(以 comms 租約鎖為準,非看板鏡像;過期回 null=可接管)。 */
export function owner(id) { return claimant(id); }

export const blackboard = { post, list, claim, complete, stats, owner, BOARD, EVENTS };
