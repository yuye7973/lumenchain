// best-available-model.mjs — 智能挑「當下最強的可用模型」（難任務專用，不影響既有省錢路由）
// 邏輯：依強度排序的偏好梯 → 逐一探測可用性 → 回傳第一個真的可用的（不可用自動跳過，如 Fable 5 灰掉）
import { spawnSync as _s } from "node:child_process";

// 強度梯（強→弱）；雲端 frontier 在前，本地大模型墊底保底。可依實際帳號可用模型調整
const STRENGTH_LADDER = [
  { id: "openrouter/nvidia/nemotron-3-ultra-550b-a55b:free", kind: "cloud", probe: null },
  { id: "openrouter/cohere/north-mini-code:free", kind: "cloud", probe: null },
  { id: "openrouter/qwen/qwen3-coder:free", kind: "cloud", probe: null },
  { id: "openrouter/openai/gpt-oss-20b:free", kind: "cloud", probe: null },
  { id: "nvidia/moonshotai/kimi-k2.5", kind: "cloud", probe: null },
  { id: "codex/gpt-5.5",              kind: "cloud", probe: null },
  { id: "ollama/qwen2.5:14b",         kind: "local", probe: "qwen2.5:14b" },
  { id: "ollama/qwen2.5:7b",          kind: "local", probe: "qwen2.5:7b" },
  { id: "ollama/qwen2.5:3b",          kind: "local", probe: "qwen2.5:3b" },
];

const OLLAMA = "http://127.0.0.1:11434";

// 本地：問 ollama 有沒有這個模型（已下載即可用）
function localAvailable(name) {
  const r = _s(process.execPath, ["-e",
    `fetch('${OLLAMA}/api/tags',{signal:AbortSignal.timeout(3000)}).then(x=>x.json()).then(j=>{const ok=(j.models||[]).some(m=>String(m.name).startsWith(${JSON.stringify(name)}));console.log(ok?'YES':'NO');process.exit(0)}).catch(()=>{console.log('NO')})`
  ], { windowsHide: true, encoding: "utf8", timeout: 5000 });
  return (r.stdout || "").trim() === "YES";
}

// 雲端：是否有對應 provider 的金鑰/認證（不打 API 不花錢，只看認證存在）
function cloudConfigured(id) {
  const provider = id.split("/")[0];
  // 由呼叫端注入 checkCloud 可覆寫；預設保守：有環境變數或認證檔才算可用
  const envKeys = { codex: "OPENAI_API_KEY", nvidia: "NVIDIA_API_KEY", openrouter: "OPENROUTER_API_KEY" };
  const k = envKeys[provider];
  return k ? Boolean(process.env[k]) : false;
}

// 主入口：回傳 { model, reason, ladder } —— 當下最強且可用
export function pickBestAvailable({ allowCloud = true, checkCloud = cloudConfigured } = {}) {
  const tried = [];
  for (const m of STRENGTH_LADDER) {
    if (m.kind === "cloud" && !allowCloud) { tried.push(m.id + ":cloud-skipped"); continue; }
    const ok = m.kind === "local" ? localAvailable(m.probe) : checkCloud(m.id);
    tried.push(m.id + ":" + (ok ? "AVAILABLE" : "unavailable"));
    if (ok) return { model: m.id, reason: "strongest-available", kind: m.kind, ladder: tried };
  }
  return { model: null, reason: "none-available", ladder: tried };
}

export { STRENGTH_LADDER };
