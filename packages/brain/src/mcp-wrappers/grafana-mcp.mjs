#!/usr/bin/env node
import { startMcpServer, httpCall } from "./_http-mcp-base.mjs";
startMcpServer({ serverName: "grafana", serverVersion: "1.0", tools: [
  { name: "list_dashboards", description: "Grafana 所有 dashboard", inputSchema: { type: "object", properties: {} }, handler: async () => httpCall("localhost", 3000, "/api/search") },
  { name: "health", description: "Grafana 健康", inputSchema: { type: "object", properties: {} }, handler: async () => httpCall("localhost", 3000, "/api/health") },
]});
