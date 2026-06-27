// server.mjs — 極簡標準 A2A Server（zero-dep, node:http）
// 服務兩件事：①GET /.well-known/agent-card.json 回 AgentCard（讓人發現）；
// ②POST / 處理 JSON-RPC 2.0 的 message/send（A2A 核心方法），把訊息交給可插拔 handler。
// 不依賴任何引擎；handler 由使用者接上自己的 agent（可接 LumenChain brain/DMAD、光鏈聯邦，或任意 LLM）。
import http from "node:http";
import crypto from "node:crypto";
import { AGENT_CARD_PATH } from "./agent-card.mjs";

/**
 * 建 A2A server。
 * @param card    標準 AgentCard（buildAgentCard 產出）
 * @param handler async ({ text, message }) => string | { text }
 */
export function createA2AServer({ card, handler, port = 0 } = {}) {
  if (!card) throw new Error("需要 AgentCard");
  if (typeof handler !== "function") throw new Error("需要 handler(message)");
  const server = http.createServer((req, res) => {
    handle(req, res, card, handler).catch((e) => sendJson(res, 500, { error: String(e?.message ?? e) }));
  });
  return {
    server,
    /** 啟動並回傳實際 port */
    listen: (p = port) => new Promise((r) => server.listen(p, () => r(server.address().port))),
    close: () => new Promise((r) => server.close(() => r())),
  };
}

async function handle(req, res, card, handler) {
  // 發現：回 AgentCard
  if (req.method === "GET" && req.url === AGENT_CARD_PATH) return sendJson(res, 200, card);
  // 協定：JSON-RPC 2.0
  if (req.method === "POST") {
    const body = await readJson(req);
    const { id = null, method, params, jsonrpc } = body ?? {};
    if (jsonrpc !== "2.0" || !method) return sendRpc(res, id, null, { code: -32600, message: "Invalid Request" });
    if (method !== "message/send") return sendRpc(res, id, null, { code: -32601, message: "Method not found" });
    const text = extractText(params?.message);
    const out = await handler({ text, message: params?.message });
    const replyText = typeof out === "string" ? out : out?.text ?? "";
    // 標準回應：一則 role=agent 的 Message
    return sendRpc(res, id, {
      role: "agent",
      parts: [{ kind: "text", text: replyText }],
      messageId: crypto.randomUUID(),
      kind: "message",
    });
  }
  return sendJson(res, 404, { error: "not found" });
}

/** 從標準 A2A Message 取出純文字（合併所有 text part） */
export function extractText(message) {
  if (!message?.parts) return "";
  return message.parts.filter((p) => p.kind === "text").map((p) => p.text).join("\n");
}

function readJson(req) {
  return new Promise((resolve, reject) => {
    let b = "";
    req.on("data", (c) => (b += c));
    req.on("end", () => {
      try {
        resolve(b ? JSON.parse(b) : {});
      } catch (e) {
        reject(e);
      }
    });
    req.on("error", reject);
  });
}
function sendJson(res, code, obj) {
  res.writeHead(code, { "content-type": "application/json" });
  res.end(JSON.stringify(obj));
}
function sendRpc(res, id, result, error) {
  sendJson(res, 200, error ? { jsonrpc: "2.0", id, error } : { jsonrpc: "2.0", id, result });
}
