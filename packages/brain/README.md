# @lumenchain/brain

Zero-dependency reasoning **brain** for multi-agent systems — the cognitive core of LumenChain.

- **DMAD multi-agent debate engine** — multiple reasoners debate to surface errors a single pass would miss.
- **Cognitive spine** — the routing/decision backbone (selective debate, escalation, cascade routing).
- **Multi-brain MCP wrappers** — expose brain capabilities over MCP.

## Install
```
npm i @lumenchain/brain
```

## Exports
| Path | What |
|---|---|
| `@lumenchain/brain/dmad-engine` | DMAD debate engine |
| `@lumenchain/brain/spine/*` | cognitive spine modules |
| `@lumenchain/brain/mcp/*` | MCP wrappers |

## Design
Zero runtime dependencies. Selective adversarial reasoning (debate only on hard/high-risk inputs) to keep cost bounded. See the repo root `README` for the full architecture.

## License
Apache-2.0
