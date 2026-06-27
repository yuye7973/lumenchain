#!/usr/bin/env node
import { startMcpServer, httpCall } from "./_http-mcp-base.mjs";
startMcpServer({ serverName: "jaeger", serverVersion: "1.0", tools: [
  { name: "services", description: "Jaeger 所有 services", inputSchema: { type: "object", properties: {} }, handler: async () => httpCall("localhost", 16686, "/api/services") },
  { name: "traces", description: "查 traces", inputSchema: { type: "object", properties: { service: { type: "string" } }, required: ["service"] }, handler: async (a) => httpCall("localhost", 16686, `/api/traces?service=${a.service}&limit=10`) },
]});
