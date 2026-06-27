// index.mjs — 標準 A2A 模組總出口（Agent2Agent 互通層）
// 取代原本綁死 OpenClaw 引擎的 sessions-send-tool.a2a.ts，改以官方 A2A 協定重生：
// AgentCard 發現 + message/send（JSON-RPC 2.0 over HTTP），zero-dep、framework-agnostic。
// 融合：cardFromManifests 把既有能力編目接上標準名片；server/client 可掛任意 agent（含 LumenChain brain/光鏈聯邦）。
export { AGENT_CARD_PATH, buildAgentCard, manifestToSkill, cardFromManifests } from "./agent-card.mjs";
export { createA2AServer, extractText } from "./server.mjs";
export { discoverAgent, sendMessage } from "./client.mjs";
