// 編碼: SPINE-REGISTRY-BRIDGE | 標題: agent-registry→neural-bus橋(全艦隊agent自動成神經元) | 時間:2026-06-21 | 重點:讀registry把每個agent既有判活訊號翻成neural-bus emit,零改碼成網 | 內容重點:只對既有check=活的agent emit,死的不emit→sense正確顯示死 | agent_written: Claude(Cowork)
// 病根(使用者點出):只有 lightchain 一顆神經元在放電,其他AI(器官/Codex/OpenHands/Hermes)沒成神經元。
// 不可擴展的錯法:逐一改每個agent的碼去emit(請求-回應改不了、器官太多)。
// 正確融合(不造平行):agent-registry 已有每個agent的check(report mtime/heartbeat/port)。本橋讀registry,把既有判活訊號翻譯成neural-bus emit。
//   ★只對「既有check=活」的agent emit(寫新心跳→sense顯示alive);死的不emit(neural-bus心跳自然過期→sense顯示死)。判活仍以既有訊號為準,橋只翻譯不偽造。
import { emit } from "./neural-bus.mjs";
import { readFileSync, existsSync, statSync } from "node:fs";
import { dirname, join, isAbsolute } from "node:path";
import { fileURLToPath } from "node:url";

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const R = (p) => isAbsolute(p) ? p : join(root, ...p.split("/"));

/** 一次橋接:把 registry 內 report/heartbeat 型且既有判活=活的 agent emit 進 neural-bus。回 {emitted,stale,skipped}。 */
export function bridgeTick() {
  let reg;
  try { reg = JSON.parse(readFileSync(join(root, "config", "agent-registry.json"), "utf8")); }
  catch (e) { return { ok: false, reason: "讀不到 registry: " + String(e.message).slice(0, 50) }; }
  const now = Date.now();
  let emitted = 0, stale = 0, skipped = 0; const alive = [];
  for (const a of reg.agents || []) {
    const c = a.check || {};
    if ((c.type === "report" || c.type === "heartbeat") && c.path && c.maxMin) {
      const p = R(c.path);
      let fresh = false;
      try { fresh = existsSync(p) && (now - statSync(p).mtimeMs) < c.maxMin * 60000; } catch { /* 讀不到當死 */ }
      if (fresh) { try { emit(a.name, { intent: a.kind || "organ", progress: "alive-via-registry(" + c.type + ")", event: "heartbeat" }); emitted++; alive.push(a.name); } catch { /* emit 失敗略過 */ } }
      else stale++;
    } else skipped++;   // port/ps/files/ssot 型:本橋不處理(需 HTTP/程序探測),維持既有哨兵判活
  }
  return { ok: true, emitted, stale, skipped, alive };
}

// CLI
if (process.argv[1] && process.argv[1].replace(/\\/g, "/").endsWith("neural-bus-registry-bridge.mjs")) {
  console.log(JSON.stringify(bridgeTick(), null, 2));
}
