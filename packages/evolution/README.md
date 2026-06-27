# EvoMind

> A four-layer **self-evolving cognitive framework** and **subscription-aware AI cost-governance** server, delivered over the **Model Context Protocol (MCP)**.

EvoMind gives any MCP-compatible coding agent — Claude Code, Codex, Cursor, and others — a persistent, self-improving reasoning layer plus a guardrail that keeps AI spending under control. State is stored locally in SQLite; no external service is required to run it.

[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](LICENSE)

---

## Why EvoMind

Coding agents are powerful but stateless and cost-blind. EvoMind adds two things they lack:

1. **Memory that compounds.** A learning loop that distills successful patterns, decays stale ones (a nightly "REM" cycle), and evolves agent roles over time.
2. **Cost awareness.** A subscription-aware guard that knows whether an operation is already covered by your plan (Claude Max, ChatGPT Pro, etc.) or would incur per-token charges — before it runs.

## Features

### Cognitive layer
- **Constitutional reasoning** — weighted principles steer decisions per task type.
- **Graph-of-Thoughts (GoT)** reasoning and **reflexion** for self-critique.
- **Role evolution** — agent personas evolve on a weekly cycle based on win/loss outcomes.
- **Multi-agent debate** for harder decisions.
- **Cognitive cycle** orchestrating the above into a single decision pass.
- **REM-cycle learning heartbeat** — nightly decay, causal-edge GC, monthly snapshot compaction.

### Cost-governance layer
- **Subscription registry** — models which AI subscriptions / API keys you hold across Anthropic, OpenAI/Codex, Google, Mistral, Groq, xAI, DeepSeek, and more.
- **Cost guard** — allows plan-covered operations, flags per-token ones, blocks the uncovered.
- **Dynamic model pricing** — pulls live prices from open sources (LiteLLM, OpenRouter) with offline fallback.
- **Subscription verifier** — periodic zero-cost key/plan validation using free `/v1/models` probes.

### Interfaces
- **MCP server** (`evomind-mcp`) — exposes EvoMind to any MCP client.
- **A2A server** (`evomind-a2a`) — agent-to-agent endpoint.
- **CLI** (`evomind`) — manage subscriptions, run cycles, inspect learning state.

## Install

```bash
npm install evomind
```

Requires Node.js >= 20. `openclaw` is an **optional** peer dependency — EvoMind runs fully standalone without it; if present, it enables extra learning-state sync.

## Quick start

Run the MCP server:

```bash
npx evomind-mcp
```

Register the tier you already pay for so the cost guard can reason about coverage:

```bash
export NUWA_CLAUDE_TIER=max-20      # max-20 | max-5 | pro | free
export NUWA_OPENAI_TIER=pro         # pro | plus | free
evomind sub verify
```

> Note: internal environment variables and the local state directory still use the engine's original `NUWA_` / `~/.nuwa` codename. They are functional aliases and do not change behavior.

Add to an MCP client (example):

```json
{
  "mcpServers": {
    "evomind": { "command": "npx", "args": ["evomind-mcp"] }
  }
}
```

## Architecture

```
MCP / A2A / CLI  ──▶  Cognitive cycle ──▶ constitutional · GoT · reflexion · debate · role-evolution
                          │
                          ├─ Cost guard ──▶ subscription-registry · model-pricing · verifier
                          │
                          └─ SQLite state ◀── REM-cycle scheduler (decay · GC · snapshots)
```

## Development

```bash
npm install
npm test          # vitest
npm run mcp       # run MCP server from source (tsx)
```

## License

[MIT](LICENSE) © Ming-Hsiu Yeh ([@yuye7973](https://github.com/yuye7973))

Built to complement the OpenClaw / MCP coding-agent ecosystem.
