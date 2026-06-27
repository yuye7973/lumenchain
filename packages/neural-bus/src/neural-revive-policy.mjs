// 編碼: SPINE-REVIVE-POLICY | 標題: MAPE-K自癒決策腦(Analyze+Plan,φ+死亡頻率→不盲復活) | 時間:2026-06-21 | 重點:反覆死的agent不盲復活→退休候選,治哨兵治標復活迴圈 | 內容重點:decide(senseAgents)回每agent revive/hold/retire-candidate;死亡頻率持久化去重 | agent_written: Claude(Cowork)
// 病根(盤點實證):哨兵 Monitor→Execute(revive)是半套MAPE-K,缺 Analyze+Plan→反覆死的agent被盲目一直復活(治標不治本)。
// 融合(不造平行、不盲改哨兵核心):本模組=MAPE-K 的 Analyze+Plan 腦。哨兵復活前呼叫 decide(),依 φ+死亡頻率給策略;哨兵照策略 Execute。
//   ★創新:死亡頻率=recall。持久化每agent「alive→dead 轉換」次數(去重,只記轉換不記持續死),窗口內超閾值→retire-candidate(不盲復活,浮給人工/退休),對齊既有「退休而非刪除」鐵則。
import { readFileSync, writeFileSync, existsSync, mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const LOG = join(root, ".openclaw", "neural-bus", "revive-deathlog.json");
const now = () => Date.now();

function load() { try { return JSON.parse(readFileSync(LOG, "utf8")); } catch { return {}; } }
function save(d) { try { mkdirSync(dirname(LOG), { recursive: true }); writeFileSync(LOG, JSON.stringify(d, null, 2)); } catch { /* 靜默 */ } }

/** MAPE-K Analyze+Plan:給每個 agent 復活策略。回 {decisions:[{agent,state,deaths,plan}]}。
 *  agents = sense().agents（每個含 aliveCount）。tickIntervalMs=判定「剛死」的視窗。 */
export function decide(agents, { windowH = 24, maxDeaths = 3, tickIntervalMs = 1200000 } = {}) {
  const log = load(); const t = now(); const winMs = windowH * 3600000;
  const decisions = [];
  for (const [name, a] of Object.entries(agents || {})) {
    const aliveNow = (a.aliveCount || 0) > 0;
    const rec = log[name] || { lastAlive: 0, deaths: [] };
    rec.deaths = (rec.deaths || []).filter((ts) => t - ts < winMs);   // 只留窗口內死亡(recall衰退)
    if (aliveNow) {
      rec.lastAlive = t;                                              // 活著→更新
    } else if (rec.lastAlive && (t - rec.lastAlive) < tickIntervalMs * 2) {
      rec.deaths.push(t);                                            // alive→dead 轉換(去重:lastAlive 在近2個tick內才算「剛死」,持續死不重複計)
      rec.lastAlive = 0;
    }
    log[name] = rec;
    if (aliveNow) continue;                                          // 活的不需決策
    // Plan:依死亡頻率決定
    const deaths = rec.deaths.length;
    let plan;
    if (deaths > maxDeaths) plan = "retire-candidate";              // 反覆死→不盲復活,浮人工/退休候選(治標→治本)
    else plan = "revive";                                            // 偶發死→正常復活
    decisions.push({ agent: name, state: "dead", deaths, plan });
  }
  save(log);
  const report = { ts: new Date().toISOString(), decisions };
  try { mkdirSync(join(root, "reports"), { recursive: true }); writeFileSync(join(root, "reports", "neural-revive-policy-latest.json"), JSON.stringify(report, null, 2)); } catch { /* 靜默 */ }
  return report;
}

// CLI:讀 neural-bus sense → 出決策
if (process.argv[1] && process.argv[1].replace(/\\/g, "/").endsWith("neural-revive-policy.mjs")) {
  (async () => {
    try { const { sense } = await import("./neural-bus.mjs"); console.log(JSON.stringify(decide(sense().agents), null, 2)); }
    catch (e) { console.error("fail:", String(e.message)); }
  })();
}
