// 編碼: SPINE-EVENT-WATCHER | 標題: 事件驅動即時感知器(取代10分輪詢→秒級反應) | 時間:2026-06-21 | 重點:watch關鍵目錄,失敗/gap一寫出立刻觸發神經tick,非定時撈 | 內容重點:fs.watch事件驅動+200ms防抖+單例+detached觸發 | agent_written: Claude(Cowork)
// 病根(使用者點出):神經鏈每10分輪詢=批次,不是即時感知。一個錯誤要等最多10分才被看到。
// 解法(調研:Node fs.watch=inotify/ReadDirectoryChangesW事件驅動毫秒級;須防抖200ms因單次存檔噴4-12事件;本機碟可靠):
//   watch reports/ 與 neural-bus 狀態,相關檔變更→防抖→立即 detached 觸發 lightchain tick。延遲 10分→秒級=真即時感知。
// 安全:只讀watch+觸發既有tick;單例pidfile防雙跑;detached+windowsHide零閃窗;不碰production/secrets/git。
// 來源:nodejs.org fs.watch、chokidar、medium「file watchers lie:debounce」。
import { watch, existsSync, mkdirSync, writeFileSync, readFileSync, statSync } from "node:fs";
import { spawn } from "node:child_process";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const R = (p) => join(root, ...p.split("/"));

// 單例鎖(防雙跑賽跑):pidfile
const LOCK = R(".openclaw/flags/neural-event-watcher.pid");
try {
  mkdirSync(dirname(LOCK), { recursive: true });
  if (existsSync(LOCK)) { const old = Number(readFileSync(LOCK, "utf8")); try { process.kill(old, 0); console.error("已有 watcher 在跑(pid " + old + "),退出"); process.exit(0); } catch { /* 舊pid死了,接管 */ } }
  writeFileSync(LOCK, String(process.pid), "utf8");
} catch { /* 鎖失敗不致命 */ }

// 監看目標:這些一變更代表「有新事件要感知」→ 觸發神經
// 監看既有 neural-bus(emit 寫 events/<agent>.ndjson 與 state/) → 補上 neural-bus 缺的「即時推送」(原本只有 sense 拉取)
const WATCH = ["reports", ".openclaw/neural-bus/events", ".openclaw/neural-bus/state", "06_任務看板"].map((p) => R(p)).filter((d) => existsSync(d));
// 觸發條件:agent emit(.ndjson)＋關鍵失敗/gap 檔
const TRIGGER = /\.ndjson$|factory-fixer-latest|open-gaps|CODEX-INBOX|-failed|escalat|error/i;

// 神經元不應期 + 合併(融合 lightchain refractoryMs 概念·反壓):放電後 REFRACTORY 內的事件不丟失,合併延到期末放一次,既不漏也不打爆模型
let scheduled = null, lastFire = 0;
const REFRACTORY_MS = 5000;
function fire(why) {
  if (scheduled) return;                                          // 已排程→合併(coalesce),不重複放電
  const since = Date.now() - lastFire;
  const delay = since >= REFRACTORY_MS ? 200 : (REFRACTORY_MS - since);  // 不應期內→延到期末才放電(不丟事件)
  scheduled = setTimeout(() => {
    scheduled = null; lastFire = Date.now();
    try { const cp = spawn(process.execPath, [R("scripts/lightchain-autopilot-tick.mjs")], { detached: true, windowsHide: true, stdio: "ignore" }); cp.unref(); } catch { /* 略過 */ }
    try { writeFileSync(R("reports/neural-event-watcher-latest.json"), JSON.stringify({ ts: new Date().toISOString(), firedBy: why, model: "refractory-coalesce" }, null, 2)); } catch {}
  }, delay);
}

for (const dir of WATCH) {
  try {
    watch(dir, { persistent: true }, (evt, fname) => {
      if (!fname) return;
      if (TRIGGER.test(String(fname))) fire(dir + "/" + fname);  // 相關事件→即時觸發神經
    });
    console.error("[watcher] 監看(事件驅動,毫秒級): " + dir);
  } catch (e) { console.error("[watcher] 無法監看 " + dir + ": " + String(e.message)); }
}
console.error("[watcher] 即時感知已啟動;失敗/gap/訊息一寫出→秒級觸發神經(取代10分輪詢)。");
// 心跳:每60s寫一次,給 agent-registry heartbeat 判活(事件驅動watcher平時安靜,需獨立心跳證明還活著)
setInterval(() => { try { writeFileSync(R("reports/neural-event-watcher-heartbeat.json"), JSON.stringify({ ts: new Date().toISOString(), pid: process.pid }), "utf8"); } catch { /* 靜默 */ } }, 60000);
try { writeFileSync(R("reports/neural-event-watcher-heartbeat.json"), JSON.stringify({ ts: new Date().toISOString(), pid: process.pid }), "utf8"); } catch { /* 啟動即寫一次 */ }
// 常駐
process.stdin.resume?.();
