#!/usr/bin/env node
import { startMcpServer, httpCall } from "./_http-mcp-base.mjs";
startMcpServer({ serverName: "prometheus", serverVersion: "1.0", tools: [
  { name: "query", description: "Prometheus PromQL 查詢", inputSchema: { type: "object", properties: { query: { type: "string" } }, required: ["query"] }, handler: async (a) => httpCall("localhost", 9090, `/api/v1/query?query=${encodeURIComponent(a.query)}`) },
  { name: "targets", description: "看所有 scrape targets", inputSchema: { type: "object", properties: {} }, handler: async () => httpCall("localhost", 9090, "/api/v1/targets") },
]});
