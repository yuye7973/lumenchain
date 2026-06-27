#!/usr/bin/env node
// 通用 HTTP-to-MCP wrapper base
// stdio JSON-RPC server that proxies tool calls to an HTTP endpoint
import readline from "node:readline";
import http from "node:http";

export function startMcpServer({ serverName, serverVersion, tools, endpoint }) {
  const rl = readline.createInterface({ input: process.stdin });
  function send(obj) { process.stdout.write(JSON.stringify(obj) + "\n"); }
  
  rl.on("line", async (line) => {
    let msg;
    try { msg = JSON.parse(line); } catch { return; }
    const { id, method, params } = msg;
    
    if (method === "initialize") {
      send({ jsonrpc: "2.0", id, result: { protocolVersion: "2024-11-05", capabilities: { tools: {} }, serverInfo: { name: serverName, version: serverVersion } } });
    } else if (method === "tools/list") {
      send({ jsonrpc: "2.0", id, result: { tools } });
    } else if (method === "tools/call") {
      const tool = tools.find(t => t.name === params.name);
      if (!tool) { send({ jsonrpc: "2.0", id, error: { code: -32601, message: "tool not found" } }); return; }
      try {
        const result = await tool.handler(params.arguments || {});
        send({ jsonrpc: "2.0", id, result: { content: [{ type: "text", text: JSON.stringify(result) }] } });
      } catch (e) {
        send({ jsonrpc: "2.0", id, error: { code: -32000, message: e.message } });
      }
    } else if (method === "notifications/initialized") {
      // no response
    } else {
      send({ jsonrpc: "2.0", id, error: { code: -32601, message: "method not found" } });
    }
  });
}

export function httpCall(host, port, path, method = "GET", body = null) {
  return new Promise((resolve) => {
    const data = body ? Buffer.from(JSON.stringify(body)) : null;
    const req = http.request({ host, port, path, method, timeout: 30000, headers: { "Content-Type": "application/json", ...(data ? { "Content-Length": data.length } : {}) } }, (res) => {
      let b = ""; res.on("data", c => b += c);
      res.on("end", () => { try { resolve(JSON.parse(b)); } catch { resolve({ raw: b }); } });
    });
    req.on("error", e => resolve({ error: e.message }));
    req.on("timeout", () => { req.destroy(); resolve({ error: "timeout" }); });
    if (data) req.write(data);
    req.end();
  });
}
