#!/usr/bin/env node
import {
  discoverOpenHands,
  listConversations,
  runTask,
  sendMessageToConversation,
  startConversation,
} from "../lib/openhands-client.mjs";
import { startMcpServer } from "./_http-mcp-base.mjs";
startMcpServer({
  serverName: "openhands",
  serverVersion: "1.0",
  tools: [
    {
      name: "status",
      description: "探測 OpenHands 本機服務與 API 版本",
      inputSchema: { type: "object", properties: {} },
      handler: async () => discoverOpenHands(),
    },
    {
      name: "list_conversations",
      description: "列出 OpenHands 所有對話",
      inputSchema: { type: "object", properties: {} },
      handler: async () => listConversations(),
    },
    {
      name: "start_conversation",
      description: "新開 OpenHands 對話，並可等待 V1 start task ready",
      inputSchema: {
        type: "object",
        properties: {
          msg: { type: "string" },
          waitForReady: { type: "boolean" },
          readyTimeoutMs: { type: "number" },
        },
        required: ["msg"],
      },
      handler: async (args) =>
        startConversation(args.msg, {
          waitForReady: args.waitForReady ?? true,
          readyTimeoutMs: args.readyTimeoutMs,
        }),
    },
    {
      name: "send_message",
      description: "送後續訊息到既有 OpenHands 對話並觸發 agent run",
      inputSchema: {
        type: "object",
        properties: {
          conversationId: { type: "string" },
          msg: { type: "string" },
          run: { type: "boolean" },
        },
        required: ["conversationId", "msg"],
      },
      handler: async (args) =>
        sendMessageToConversation(args.conversationId, args.msg, { run: args.run ?? true }),
    },
    {
      name: "run_task",
      description: "建立 OpenHands 任務、等待 conversation ready，必要時等待終端狀態",
      inputSchema: {
        type: "object",
        properties: {
          msg: { type: "string" },
          waitForTerminal: { type: "boolean" },
          readyTimeoutMs: { type: "number" },
          terminalTimeoutMs: { type: "number" },
        },
        required: ["msg"],
      },
      handler: async (args) =>
        runTask(args.msg, {
          waitForTerminal: args.waitForTerminal ?? false,
          readyTimeoutMs: args.readyTimeoutMs,
          terminalTimeoutMs: args.terminalTimeoutMs,
        }),
    },
  ],
});
