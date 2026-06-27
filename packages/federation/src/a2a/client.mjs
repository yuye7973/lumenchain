// client.mjs — 標準 A2A Client（zero-dep, 用 node 內建 fetch）
// 兩步：①discoverAgent 讀遠端 /.well-known/agent-card.json 發現對方能力；
// ②sendMessage 用標準 message/send（JSON-RPC 2.0 over HTTP）送訊並取回對方回覆。
import crypto from "node:crypto";
import { AGENT_CARD_PATH } from "./agent-card.mjs";

/** 發現遠端 agent 的 AgentCard（agent 發現機制） */
export async function discoverAgent(baseUrl) {
  const u = new URL(AGENT_CARD_PATH, baseUrl);
  const r = await fetch(u, { headers: { accept: "application/json" } });
  if (!r.ok) throw new Error(`AgentCard 發現失敗：HTTP ${r.status}`);
  return r.json();
}

/**
 * 對遠端 agent 送一則訊息（標準 message/send）。
 * @param agentUrl 對方 AgentCard 裡的 url（A2A 端點）
 * @param text     要送的文字
 * @returns { text, raw } — text=對方回覆純文字，raw=原始 A2A Message/Task
 */
export async function sendMessage(agentUrl, text, { headers = {}, timeoutMs = 30000 } = {}) {
  const req = {
    jsonrpc: "2.0",
    id: crypto.randomUUID(),
    method: "message/send",
    params: {
      message: {
        role: "user",
        parts: [{ kind: "text", text }],
        messageId: crypto.randomUUID(),
        kind: "message",
      },
    },
  };
  const r = await fetch(agentUrl, {
    method: "POST",
    headers: { "content-type": "application/json", ...headers },
    body: JSON.stringify(req),
    signal: AbortSignal.timeout(timeoutMs),
  });
  const j = await r.json();
  if (j.error) throw new Error(`A2A 錯誤 ${j.error.code}: ${j.error.message}`);
  const parts = j.result?.parts ?? [];
  return {
    text: parts.filter((p) => p.kind === "text").map((p) => p.text).join("\n"),
    raw: j.result,
  };
}
