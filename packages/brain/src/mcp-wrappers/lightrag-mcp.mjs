#!/usr/bin/env node
import { startMcpServer, httpCall } from "./_http-mcp-base.mjs";
startMcpServer({
  serverName: "lightrag", serverVersion: "1.0",
  tools: [
    { name: "insert", description: "餵知識進 LightRAG KG", inputSchema: { type: "object", properties: { text: { type: "string" } }, required: ["text"] },
      handler: async (args) => httpCall("localhost", 9621, "/documents/text", "POST", { text: args.text }) },
    { name: "query", description: "查詢 KG", inputSchema: { type: "object", properties: { query: { type: "string" }, mode: { type: "string" } }, required: ["query"] },
      handler: async (args) => httpCall("localhost", 9621, "/query", "POST", { query: args.query, mode: args.mode || "hybrid" }) },
  ],
});
