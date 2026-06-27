#!/usr/bin/env node
import { startMcpServer, httpCall } from "./_http-mcp-base.mjs";
startMcpServer({
  serverName: "openclaw-gateway", serverVersion: "1.0",
  tools: [
    { name: "health", description: "OpenClaw Gateway 健康狀態", inputSchema: { type: "object", properties: {} },
      handler: async () => httpCall("localhost", 18789, "/health") },
    { name: "list_cron", description: "列出所有排程", inputSchema: { type: "object", properties: {} },
      handler: async () => httpCall("localhost", 18789, "/api/cron/list") },
    { name: "trigger_cron", description: "觸發指定排程", inputSchema: { type: "object", properties: { name: { type: "string" } }, required: ["name"] },
      handler: async (args) => httpCall("localhost", 18789, `/api/cron/trigger/${args.name}`, "POST") },
  ],
});
