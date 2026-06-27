// 光源+光鏈 v2：分片到「每任務一光點」(state/<agent>/<taskId>.json)，多任務並發各寫各檔，無共用單檔/無鎖/不互蓋。
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
const ROOT = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const BUS = process.env.NEURAL_BUS_DIR || path.join(ROOT, ".openclaw", "neural-bus");
const STATE = () => path.join(BUS, "state");
const EVENTS = () => path.join(BUS, "events");
function atomicWrite(p, s) { fs.mkdirSync(path.dirname(p), { recursive: true }); const t = p + "." + process.pid + "." + Math.random().toString(36).slice(2, 6) + ".tmp"; fs.writeFileSync(t, s); fs.renameSync(t, p); }

// φ-accrual 故障偵測(融合既有·創新:間隔歷史持久化進state檔,請求-回應模型也能算連續懷疑度,取代二元誤判)
function _normCdf(x) { const t = 1 / (1 + 0.2316419 * Math.abs(x)); const d = 0.3989423 * Math.exp(-x * x / 2); const p = d * t * (0.3193815 + t * (-0.3565638 + t * (1.781478 + t * (-1.821256 + t * 1.330274)))); return x > 0 ? 1 - p : p; }
export function phiAccrual(intervals, elapsedMs) {
  if (!Array.isArray(intervals) || intervals.length < 2) return 0;   // 樣本不足→不判死(fallback 二元)
  const mean = intervals.reduce((a, b) => a + b, 0) / intervals.length;
  const variance = intervals.reduce((a, b) => a + (b - mean) ** 2, 0) / intervals.length;
  const std = Math.max(Math.sqrt(variance), 50);                      // std 下限防除0/曲線過陡
  return +(-Math.log10(Math.max(1 - _normCdf((elapsedMs - mean) / std), 1e-12))).toFixed(2);
}

// 光源：emit(agent, taskId, opts) 或 emit(agent, opts)。每任務一個光點檔，並發不互蓋。
export function emit(agent, a, b) {
  const taskId = typeof a === "object" || a == null ? "_main" : String(a);
  const opts = (typeof a === "object" && a) ? a : (b || {});
  const sf = path.join(STATE(), agent, taskId + ".json");
  const prev = (() => { try { return JSON.parse(fs.readFileSync(sf, "utf8")); } catch { return { seq: 0 }; } })();
  const seq = (prev.seq || 0) + 1;
  const _now = Date.now();
  const _hist = Array.isArray(prev.hbIntervals) ? prev.hbIntervals.slice(-19) : [];        // 持久化心跳間隔歷史(融合φ-accrual,請求-回應也能算)
  if (prev.heartbeat && _now > prev.heartbeat) _hist.push(_now - prev.heartbeat);
  const state = { agent, taskId, seq, ts: new Date().toISOString(), heartbeat: _now, hbIntervals: _hist, intent: opts.intent ?? prev.intent ?? null, progress: opts.progress ?? prev.progress ?? null };
  atomicWrite(sf, JSON.stringify(state, null, 2));
  if (opts.event) fs.appendFileSync(path.join(EVENTS(), agent + ".ndjson"), JSON.stringify({ id: agent + "/" + taskId + "#" + seq, agent, taskId, ts: state.ts, event: opts.event }) + "\n");
  return state;
}
export function done(agent, taskId) { try { fs.rmSync(path.join(STATE(), agent, String(taskId) + ".json")); } catch {} } // 任務結束熄燈

// 光鏈：聚合全網光點矩陣 + 每光點判活
export function sense({ staleMs = 600000 } = {}) {
  const now = Date.now(); const agents = {};
  let st; try { st = fs.readdirSync(STATE(), { withFileTypes: true }); } catch { st = []; }
  for (const d of st) {
    if (!d.isDirectory()) continue;
    const tasks = {}; let alive = 0;
    for (const f of fs.readdirSync(path.join(STATE(), d.name))) {
      if (!f.endsWith(".json")) continue;
      try { const s = JSON.parse(fs.readFileSync(path.join(STATE(), d.name, f), "utf8")); const a = (now - (s.heartbeat || 0)) < staleMs; if (a) alive++; const ph = phiAccrual(s.hbIntervals, now - (s.heartbeat || 0)); tasks[s.taskId] = { intent: s.intent, progress: s.progress, ageSec: Math.round((now - (s.heartbeat || 0)) / 1000), alive: a, phi: ph, suspect: ph >= 8 }; } catch {}
    }
    agents[d.name] = { taskCount: Object.keys(tasks).length, aliveCount: alive, tasks };
  }
  return { ts: new Date().toISOString(), agents };
}
export function recent(agent, n = 5) { try { return fs.readFileSync(path.join(EVENTS(), agent + ".ndjson"), "utf8").trim().split("\n").slice(-n).map((l) => JSON.parse(l)); } catch { return []; } }
