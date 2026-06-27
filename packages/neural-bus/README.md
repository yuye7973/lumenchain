# @lumenchain/neural-bus

Zero-dependency **neural bus** — the shared nervous system that carries state and events between brains.

- **Sharded light-point state** — lock-free sharded state on the light-chain.
- **φ-accrual failure detection** — adaptive liveness, not fixed timeouts.
- **fs.watch perception** — file-backed events usable across processes.
- **MAPE-K self-healing** — monitor → analyze → plan → execute, with shared knowledge.
- **Knowledge-graph schemas** — the LumenChain KG contracts.

## Install
```
npm i @lumenchain/neural-bus
```

## Exports
`./bus` · `./watcher` · `./revive-policy` · `./registry-bridge`

## Design
Runtime state (the live bus, pids, logs) is never committed — only the mechanism ships. The bus is the seam other LumenChain packages (and external reflow contributors) connect through.

## License
Apache-2.0
