#!/usr/bin/env node
// openclaw-agent-card-generator.mjs — 智能能力卡產生器（本地大腦讀 agent 真定義 → 生成 capability-manifest.v1 自述卡）
// 開源對齊：A2A/AgentScope「LLM 從 agent 定義生成 agent card」模式；描述須具體可區分(供其他 LLM 路由判斷)。
// 接地：讀 registry 定義 + 該 agent 腳本 header 註解，餵本地大腦(零雲端 token)結構化輸出。冪等：已有 manifest 跳過。批次限量控資源。
// 用法: node scripts/openclaw-agent-card-generator.mjs [--batch 3] [--force] [--only <name>]
import { readFileSync, writeFileSync, renameSync, existsSync, mkdirSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { brainCall } from "./lib/spine/brain-call.mjs"; // 統一本地大腦呼叫+快取+壓縮(省token)
const ROOT = process.env.OPENCLAW_ROOT || process.cwd();
const MANI = join(ROOT, ".openclaw", "capabilities", "manifests");
const nul = (b) => { const i = b.indexOf(0); return i > 0 ? b.subarray(0, i) : b; };
const rd = (p) => { try { return nul(readFileSync(p)).toString("utf8"); } catch { return ""; } };
const argv = process.argv.slice(2);
const getArg = (f, d) => { const i = argv.indexOf(f); return i >= 0 ? argv[i + 1] : d; };
const BATCH = Number(getArg("--batch", 3)); const FORCE = argv.includes("--force"); const ONLY = getArg("--only", null);
const model = process.env.CARD_GEN_MODEL || "qwen2.5:7b";

const reg = JSON.parse(nul(readFileSync(join(ROOT, "config", "agent-registry.json"))).toString("utf8").replace(/^﻿/, ""));
mkdirSync(MANI, { recursive: true });
const existing = new Set(readdirSync(MANI).filter(f => f.endsWith(".json")).map(f => f.replace(/\.json$/, "")));

const schema = { type: "object", properties: { officialName: { type: "string" }, purpose: { type: "string" }, triggers: { type: "array", items: { type: "string" } }, handles: { type: "array", items: { type: "string" } }, riskLevel: { type: "string", enum: ["read_only", "local_write", "external_write", "trading_payment", "credential"] } }, required: ["officialName", "purpose", "triggers", "handles", "riskLevel"] };

async function genCard(a) {
  // 接地材料：registry 定義 + 腳本 header 註解（前 25 行）
  let scriptHead = "";
  const sp = Array.isArray(a.bootCmd) ? a.bootCmd.find(x => /\.(mjs|ts|mts)$/.test(x)) : null;
  if (sp) scriptHead = rd(join(ROOT, sp)).split("\n").slice(0, 25).filter(l => /^\s*(\/\/|\*|#)/.test(l)).join("\n").slice(0, 800);
  // 提示工程框架套用(Role+Goal+Constraints+Format)：修原本 riskLevel 全被標 external_write 的缺陷
  const prompt = `你是 OpenClaw 能力編目專家。\n【目標】為下面這個 agent 產生一張精準能力卡，讓其他 AI 能正確判斷要不要把任務派給它。\n【約束】\n- purpose/handles 要具體、能跟其他 agent 區分，不要只寫「X agent」。\n- riskLevel 照「它實際會做什麼」如實判，不要一律標高：純監控/探測/讀取/分析 → read_only；只在本地讀寫檔/建置/重整 → local_write；會對外發送/HTTP/webhook/部署上線 → external_write；碰真實交易/付款 → trading_payment；碰憑證/密鑰/secret → credential。\n【agent 資料】\n名稱：${a.name}｜kind：${a.kind}\n既有說明：${a.boot || ""}\n腳本註解：${scriptHead || "(無)"}\n【輸出】officialName、purpose(1-2句具體用途)、triggers(觸發關鍵字/情境)、handles(實際處理什麼,條列)、riskLevel(依上面約束如實判)。`;
  const out = await brainCall({ prompt, schema, model, timeoutMs: 45000, temperature: 0.1 });
  if (out.error) return null;
  try {
    const c = JSON.parse((out.response || "{}").trim());
    if (!c.purpose) return null;
    return { schema: "openclaw.capability-manifest.v1", id: a.name, officialName: c.officialName || a.name, purpose: c.purpose, triggers: c.triggers || [], handles: c.handles || [], riskLevel: c.riskLevel || "local_write", mayExecute: false, mayStartAi: false, source: "agent-card-generator(local-brain)", generatedFrom: ["registry", sp || "(no-script)"], generatedAt: new Date().toISOString() };
  } catch { return null; }
}

const out = { schema: "openclaw.agent-card-generator.v1", ts: new Date().toISOString(), generated: [], skipped: 0, failed: [] };
const targets = (reg.agents || []).filter(a => a.name && (ONLY ? a.name === ONLY : (FORCE || !existing.has(a.name)))).slice(0, ONLY ? 1 : BATCH);
for (const a of targets) {
  const card = await genCard(a);
  if (!card) { out.failed.push(a.name); continue; }
  const p = join(MANI, a.name + ".json");
  writeFileSync(p + ".tmp", JSON.stringify(card, null, 2) + "\n", "utf8"); renameSync(p + ".tmp", p);
  out.generated.push({ id: a.name, purpose: card.purpose.slice(0, 60), risk: card.riskLevel });
}
out.剩餘未生成 = (reg.agents || []).filter(a => a.name && !existing.has(a.name)).length - out.generated.length;
console.log(JSON.stringify(out, null, 2));
