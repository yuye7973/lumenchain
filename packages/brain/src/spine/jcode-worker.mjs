// lib/spine/jcode-worker.mjs — 把 jcode CLI 包成艦隊可派工的本地編碼 worker（headless run）。
// 讓 OpenClaw orchestrator/智能體 派編碼任務給 jcode：spawn `jcode run --json` → 解析 → 抽出程式碼。
// 實測注意(2026-06-17)：headless run 是單回合生成(回文字、不自動寫檔)；--provider 可能被忽略(實測曾跑去 openrouter)。
// 故本 worker 定位＝「本地程式碼生成器」(回程式碼字串)，由呼叫端(OpenClaw)決定要不要寫檔。沙箱 bridge 無法執行 .exe，端到端由 host orchestrator 驗。
import { spawnSync } from "node:child_process";
const JCODE = process.env.JCODE_BIN || "jcode";
const MODEL = process.env.JCODE_MODEL || "qwen2.5-coder:14b";
const PROVIDER = process.env.JCODE_PROVIDER || "openai-compatible";

/** 派一個編碼任務給 jcode(headless)，回 {ok, code, text, provider, model, usage, error}。code＝抽出的純程式碼。 */
export function runJcode(task, { model = MODEL, provider = PROVIDER, timeoutMs = 120000 } = {}) {
  if (!task || typeof task !== "string") return { ok: false, error: "需 task 字串" };
  const r = spawnSync(JCODE, ["--quiet", "--no-update", "--no-selfdev", "--provider", provider, "--model", model, "run", "--json", task], { encoding: "utf8", timeout: timeoutMs, windowsHide: true });
  if (!r.stdout) return { ok: false, error: (r.stderr || ("jcode exit " + r.status)).slice(0, 200) };
  try {
    const j = JSON.parse(r.stdout);
    const text = j.text || "";
    // headless 常把碼包成 tool-call JSON 文字 → 抽出 arguments.content；否則直接回 text
    let code = text;
    try { const tc = JSON.parse(text); if (tc && tc.arguments && typeof tc.arguments.content === "string") code = tc.arguments.content; } catch {}
    return { ok: true, code, text, provider: j.provider, model: j.model, usage: j.usage };
  } catch (e) { return { ok: false, error: "parse:" + String(e.message).slice(0, 80), raw: r.stdout.slice(0, 200) }; }
}

// CLI：node scripts/lib/spine/jcode-worker.mjs "<task>" — 供測試/手動派工
import { fileURLToPath } from "node:url";
if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1].replace(/\//g, "\\")) {
  const out = runJcode(process.argv.slice(2).join(" "));
  console.log(JSON.stringify(out, null, 2));
}
