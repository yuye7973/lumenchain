// 編碼: SPINE-COMMS | 標題: 跨AI不打架通訊層(append-only匯流排+租約式工作隊列) | 時間:2026-06-21 | 重點:多AI並發不打架,死亡自動回收、狀態可見、不孤兒、有界成長 | 內容重點:send/inbox + claim/heartbeat/done/fail/reap/status/rotateBus | agent_written: Claude(Cowork)
// 設計依據(開源標準·Redis Streams 消費者群組): 一任務一消費者 + 租約過期(min-idle-time) + 死亡自動回收(XAUTOCLAIM) + 待處理可見(PEL) + 完成確認/重試死信(XACK/DLQ)。
//   來源: redis.io/docs/latest/commands/xclaim、append/PIPE_BUF(nullprogram)、log rotation(nxlog/crowdstrike)。
// 檔案版映射(自足、跨 Win/Linux 原子): O_EXCL 建 processing 標記=原子認領; 過期標記用 rename 原子接管=回收死者; done/dead 目錄=完成/死信; status 數各目錄=可見。
//   ★claim 對過期租約自動接管→agent 死掉下一個自動接手,永不孤兒。 ★每行<PIPE_BUF(4096)→並發 append 原子不交錯。
//   ★bus 由單一維護者(comms-reap)輪替(appendFileSync 不持久fd+保留archive→輪替零丟失,避 rotation race)。
import { appendFileSync, readFileSync, writeFileSync, mkdirSync, existsSync, readdirSync, renameSync, unlinkSync, statSync } from "node:fs";
import { join } from "node:path";
import { resolve } from "./resolve.mjs";
import { emit as neuralEmit } from "../../neural-bus.mjs";   // 收斂:訊息同進既有 neural-bus 事件fabric(統一,不另立平行bus)

const ROOT = () => process.env.COMMS_ROOT || resolve("shared-memory");
const BUS = () => join(ROOT(), "comms-bus.jsonl");
const Q = () => join(ROOT(), ".queue");
const PROC = () => join(Q(), "processing");
const DONE = () => join(Q(), "done");
const DEAD = () => join(Q(), "dead");
const DEFAULT_LEASE_MS = 120000;
const MAX_ATTEMPTS = 5;
const SAFE_LINE = 3800;          // < PIPE_BUF(4096) 保證並發 append 原子不交錯
const BUS_CAP_BYTES = 5_000_000; // 5MB 觸發輪替(有界成長)
const INJ = /ignore (all |any )?(previous|prior|above)|\b(override|bypass|disable)\b.{0,20}(guard|safety|oversight|rule)/i;
const now = () => Date.now();
const iso = () => new Date().toISOString();
const eid = (id) => encodeURIComponent(id) + ".json";
const nulSafe = (b) => { const i = b.indexOf(0); return i > 0 ? b.subarray(0, i) : b; };
const ensure = (d) => mkdirSync(d, { recursive: true });
const rdj = (p) => JSON.parse(nulSafe(readFileSync(p)).toString("utf8"));

/** 送訊息(append-only,並發零丟失,自動縮行<PIPE_BUF)。 */
export function send({ from, to = "all", kind = "msg", body = "" }) {
  if (!from) return { ok: false, reason: "需 from" };
  const raw = String(body);
  if (INJ.test(raw) || raw.charCodeAt(0) === 0 || raw.includes(String.fromCharCode(0))) return { ok: false, reason: "guard:injection" };  // 防注入投毒/NUL(明確控制字元,不誤擋正常空白)
  const seq = `${now()}-${Math.random().toString(36).slice(2, 8)}`;
  ensure(ROOT());
  let body2 = raw.slice(0, 3500);
  let line = JSON.stringify({ seq, ts: iso(), from, to, kind, body: body2 }) + "\n";
  while (Buffer.byteLength(line, "utf8") > SAFE_LINE && body2.length > 0) { body2 = body2.slice(0, Math.floor(body2.length * 0.8)); line = JSON.stringify({ seq, ts: iso(), from, to, kind, body: body2 + "…[截]" }) + "\n"; }
  appendFileSync(BUS(), line, "utf8");
  try { neuralEmit(from, { event: { kind, to, body: body2.slice(0, 500) } }); } catch { /* neural-bus 不可用不致命:comms-bus 仍寫成功 */ }
  return { ok: true, seq };
}
/** 收件:給我的(to===me||all),游標 sinceTs 只讀新。 */
export function inbox(me, { sinceTs = "" } = {}) {
  if (!existsSync(BUS())) return [];
  const out = [];
  for (const l of nulSafe(readFileSync(BUS())).toString("utf8").split("\n")) {
    if (!l) continue; try { const m = JSON.parse(l); if ((m.to === me || m.to === "all") && (!sinceTs || m.ts > sinceTs)) out.push(m); } catch { /* skip */ }
  }
  return out;
}
/** bus 輪替(單一維護者呼叫,如 comms-reap):超過上限→改名歸檔,起新檔。保留 archive→零丟失。 */
export function rotateBus(maxBytes = BUS_CAP_BYTES) {
  const bus = BUS();
  if (!existsSync(bus)) return { ok: true, rotated: false };
  let sz = 0; try { sz = statSync(bus).size; } catch { return { ok: true, rotated: false }; }
  if (sz <= maxBytes) return { ok: true, rotated: false, size: sz };
  const archive = join(ROOT(), `comms-bus.${iso().replace(/[:.]/g, "-")}.jsonl`);
  try { renameSync(bus, archive); return { ok: true, rotated: true, archive, size: sz }; } catch (e) { return { ok: false, reason: String(e.message).slice(0, 60) }; }
}

/** 認領:O_EXCL 原子建 processing;已存在但租約過期→rename 原子接管(回收死者)。 */
export function claim(taskId, agent, { leaseMs = DEFAULT_LEASE_MS } = {}) {
  ensure(PROC());
  if (existsSync(join(DONE(), eid(taskId)))) return { ok: false, reason: "已完成" };
  const proc = join(PROC(), eid(taskId));
  const rec = { id: taskId, agent, exp: now() + leaseMs, attempts: 1, ts: iso() };
  try { writeFileSync(proc, JSON.stringify(rec) + "\n", { flag: "wx" }); return { ok: true, claimed: taskId, by: agent }; }
  catch (e) { if (e.code !== "EEXIST") throw e; }
  let cur; try { cur = rdj(proc); } catch { return { ok: false, reason: "認領中(讀不到)" }; }
  if (cur.exp > now()) return { ok: false, reason: "認領中(租約有效)", by: cur.agent };
  const steal = proc + "." + Math.random().toString(36).slice(2, 8) + ".steal";
  try { renameSync(proc, steal); } catch { return { ok: false, reason: "接管競爭中,他人先得", by: "?" }; }
  rec.attempts = (cur.attempts || 1) + 1;
  if (rec.attempts > MAX_ATTEMPTS) {
    ensure(DEAD()); writeFileSync(join(DEAD(), eid(taskId)), JSON.stringify({ ...cur, deadAt: iso(), reason: "max-attempts" }) + "\n", "utf8");
    try { unlinkSync(steal); } catch { /* ignore */ }
    return { ok: false, reason: "已進死信(重試耗盡)", attempts: rec.attempts };
  }
  writeFileSync(proc, JSON.stringify(rec) + "\n", "utf8");
  try { unlinkSync(steal); } catch { /* ignore */ }
  return { ok: true, claimed: taskId, by: agent, reclaimed: true, attempts: rec.attempts };
}

/** 續租。 */
export function heartbeat(taskId, agent, { leaseMs = DEFAULT_LEASE_MS } = {}) {
  const proc = join(PROC(), eid(taskId));
  if (!existsSync(proc)) return { ok: false, reason: "非進行中" };
  let cur; try { cur = rdj(proc); } catch { return { ok: false, reason: "讀不到" }; }
  if (cur.agent !== agent) return { ok: false, reason: "非你持有", by: cur.agent };
  cur.exp = now() + leaseMs; cur.ts = iso();
  writeFileSync(proc, JSON.stringify(cur) + "\n", "utf8");
  return { ok: true, exp: cur.exp };
}

/** 完成(=XACK)。 */
export function done(taskId, agent, result = "") {
  ensure(DONE());
  writeFileSync(join(DONE(), eid(taskId)), JSON.stringify({ id: taskId, agent, result: String(result).slice(0, 500), ts: iso() }) + "\n", "utf8");
  try { unlinkSync(join(PROC(), eid(taskId))); } catch { /* ignore */ }
  return { ok: true, done: taskId };
}

/** 失敗:清 processing 讓它可被重認領。 */
export function fail(taskId, agent, reason = "") {
  try { unlinkSync(join(PROC(), eid(taskId))); } catch { /* ignore */ }
  return { ok: true, failed: taskId, reason };
}

/** 主動巡邏:列出過期租約 + 清理孤兒 .steal(接管時死亡殘留)。 */
export function reap() {
  ensure(PROC());
  const expired = []; let cleanedSteal = 0;
  for (const f of readdirSync(PROC())) {
    const fp = join(PROC(), f);
    if (f.endsWith(".steal")) {   // 接管中途死亡殘留的孤兒→超過一個租約期就清
      try { if (now() - statSync(fp).mtimeMs > DEFAULT_LEASE_MS) { unlinkSync(fp); cleanedSteal++; } } catch { /* ignore */ }
      continue;
    }
    if (!f.endsWith(".json")) continue;
    let r; try { r = rdj(fp); } catch { continue; }
    if (r.exp <= now()) expired.push({ id: r.id, agent: r.agent, attempts: r.attempts || 1 });
  }
  return { ok: true, expired, cleanedSteal, note: "過期者下次 claim 會被自動接管" };
}

/** 全艦隊可見狀態。 */
export function status() {
  const list = (d) => existsSync(d) ? readdirSync(d).filter((f) => f.endsWith(".json")) : [];
  const inflight = list(PROC()).map((f) => { try { const r = rdj(join(PROC(), f)); return { id: r.id, agent: r.agent, alive: r.exp > now(), attempts: r.attempts || 1 }; } catch { return null; } }).filter(Boolean);
  return { ok: true, inflight, done: list(DONE()).length, dead: list(DEAD()).length, stuck: inflight.filter((x) => !x.alive).length };
}

/** 查活著的持有者(過期回 null)。 */
export function claimant(taskId) {
  const proc = join(PROC(), eid(taskId));
  try { const r = rdj(proc); return r.exp > now() ? r.agent : null; } catch { return null; }
}

export const comms = { send, inbox, rotateBus, claim, heartbeat, done, fail, reap, status, claimant, ROOT, PROC, DONE, DEAD };
