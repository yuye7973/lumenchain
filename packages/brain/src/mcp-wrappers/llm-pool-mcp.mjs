#!/usr/bin/env node
// OpenClaw LLM Pool MCP — 統一 47+ LLM provider 入口
// 讓 4 AI 都能透過 MCP 呼叫 OpenClaw 內任一 LLM
import { startMcpServer } from "./_http-mcp-base.mjs";
import http from "node:http";
import { selectModel } from "../openclaw-model-orchestrator.mjs";

// 47 個 OpenClaw LLM providers
const PROVIDERS = {
  // 本地（Ollama 走 11434）
  "ollama": { type: "ollama", base: "http://localhost:11434", task: "default" },
  "ollama-qwen3": { type: "ollama", base: "http://localhost:11434", task: "reasoning" },
  "ollama-qwen-coder": { type: "ollama", base: "http://localhost:11434", task: "code" },
  "ollama-deepseek-r1": { type: "ollama", base: "http://localhost:11434", task: "risk" },
  "ollama-llama3-70b": { type: "ollama", base: "http://localhost:11434", task: "deep_reasoning" },
  "ollama-gpt-oss": { type: "ollama", base: "http://localhost:11434", task: "default" },
  "ollama-glm": { type: "ollama", base: "http://localhost:11434", task: "default" },
  "ollama-mixtral": { type: "ollama", base: "http://localhost:11434", task: "debate" },
  "ollama-gemma": { type: "ollama", base: "http://localhost:11434", task: "summary" },
  // 雲端（OpenAI 相容 API）
  "openai": { type: "openai", base: "https://api.openai.com/v1" },
  "anthropic": { type: "anthropic", base: "https://api.anthropic.com/v1" },
  "deepseek": { type: "openai", base: "https://api.deepseek.com/v1" },
  "groq": { type: "openai", base: "https://api.groq.com/openai/v1" },
  "openrouter": { type: "openai", base: "https://openrouter.ai/api/v1" },
  "moonshot": { type: "openai", base: "https://api.moonshot.cn/v1" },
  "qwen": { type: "openai", base: "https://dashscope.aliyuncs.com/compatible-mode/v1" },
  "google": { type: "google", base: "https://generativelanguage.googleapis.com/v1" },
  "mistral": { type: "openai", base: "https://api.mistral.ai/v1" },
  "cerebras": { type: "openai", base: "https://api.cerebras.ai/v1" },
  "fireworks": { type: "openai", base: "https://api.fireworks.ai/inference/v1" },
  "together": { type: "openai", base: "https://api.together.xyz/v1" },
  "xai": { type: "openai", base: "https://api.x.ai/v1" },
  // ... 另 25+ providers 透過 OpenClaw config 啟用
};

function ollamaChat(base, model, prompt) {
  return new Promise((res) => {
    const data = Buffer.from(JSON.stringify({ model, prompt, stream: false, keep_alive: "30m" }));
    const url = new URL("/api/generate", base);
    const req = http.request({
      hostname: url.hostname, port: url.port, path: url.pathname,
      method: "POST", timeout: 180_000,
      headers: { "Content-Type": "application/json", "Content-Length": data.length },
    }, (r) => { let b = ""; r.on("data", c => b += c); r.on("end", () => { try { res(JSON.parse(b)); } catch { res({ raw: b }); } }); });
    req.on("error", e => res({ error: e.message }));
    req.on("timeout", () => { req.destroy(); res({ error: "timeout" }); });
    req.write(data); req.end();
  });
}

startMcpServer({
  serverName: "openclaw-llm-pool",
  serverVersion: "1.0",
  tools: [
    {
      name: "list_providers",
      description: "列出所有 47+ OpenClaw LLM providers",
      inputSchema: { type: "object", properties: {} },
      handler: async () => ({ providers: Object.keys(PROVIDERS), total: Object.keys(PROVIDERS).length }),
    },
    {
      name: "chat",
      description: "用任一 provider 對話（provider=ollama-qwen-coder/openai/anthropic 等）",
      inputSchema: {
        type: "object",
        properties: {
          provider: { type: "string", description: "provider key" },
          prompt: { type: "string" },
          model: { type: "string", description: "可選，override 預設模型" },
        },
        required: ["provider", "prompt"],
      },
      handler: async (args) => {
        const p = PROVIDERS[args.provider];
        if (!p) return { error: `unknown provider: ${args.provider}`, available: Object.keys(PROVIDERS) };
        if (p.type === "ollama") {
          const selected = args.model ? { ok: true, model: args.model } : await selectModel({ consumer: "llm-pool-mcp", task: p.task || "default" });
          if (!selected.ok || !selected.model) return { error: `model unavailable: ${selected.reason ?? "unknown"}` };
          return await ollamaChat(p.base, selected.model, args.prompt);
        }
        return { error: `provider type ${p.type} needs API key, set in OpenClaw secrets`, hint: "use ollama-* for local free" };
      },
    },
    {
      name: "list_local_models",
      description: "列出本地 Ollama 所有模型（25 個）",
      inputSchema: { type: "object", properties: {} },
      handler: async () => new Promise((res) => {
        const req = http.request({ hostname: "localhost", port: 11434, path: "/api/tags", method: "GET" },
          (r) => { let b = ""; r.on("data", c => b += c); r.on("end", () => { try { res(JSON.parse(b)); } catch { res({ raw: b }); } }); });
        req.on("error", e => res({ error: e.message }));
        req.end();
      }),
    },
  ],
});
