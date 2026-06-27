# Light Neural Language v1

Light Neural Language (LNL) is the compact AI workflow language for this engine. It drives one local light chain, bounded execution cells, multi-agent teams, OpenClaw governance, DAG fanout, and same-chain membership gates.

## Syntax

```text
op|field1|field2|field3;op|field1
```

Fields are URL-encoded when they contain spaces or separators.

## Opcodes

| Op | Meaning | Example |
|---|---|---|
| `e` | append light-chain event | `e|codex|note|k=v` |
| `y` | join current chain | `y|codex|builder` |
| `r` | same-chain roster gate/audit | `r|codex,openclaw` |
| `r` | same-chain roster bridge/audit | `r|codex,remote|bridge` |
| `s` | runtime sentinel gate/audit | `s|gate` |
| `n` | allocate light cell | `n|codex|TASK-1` |
| `x` | release latest cell | `x|codex|done` |
| `t` | run multi-agent team | `t|goal|r,a,w,v` |
| `p` | run one of six workflow patterns | `p|f|market%20research` |
| `m` | run dynamic mesh | `m|debug%20flow` |
| `d` | append sharded DAG event | `d|taskA|codex|start|k=v` |
| `j` | merge DAG shards | `j|root|merger|taskA,taskB` |
| `h` | send same-chain handshake packet | `h|codex|ha|ok=1` |
| `o` | OpenClaw governance adapter | `o|lint|D%3A%5C%E5%85%AD%E7%A8%AEWorkflow%E6%A8%A1%E5%BC%8F` |
| `?` | status check | `?` |
| `@id` | expand local atom | `@lg` |

## Minimal Same-Chain Program

```text
y|codex|builder;o|join|openclaw;r|codex,openclaw|audit
```

## Multi-Agent Program

```text
s|gate;h|claude|ha|ok=1|ingest;r|codex,openclaw,claude;t|%E5%A4%9A%E6%99%BA%E8%83%BD%E9%AB%94%E7%A0%94%E7%A9%B6|r,a,w,v;?
```

## Rules

- `r` must pass before a workflow may claim true same-chain multi-agent execution.
- `r` is blocking by default; use `r|agents|check` for non-blocking inspection.
- `r|agents|bridge` (or `r|agents|bridge,check`) switches roster to bridge mode so different chainIds can participate when traceable.
- `s|gate` is blocking by default; `s|audit` writes a sanitized local script-pressure snapshot to the light chain.
- `o` is governance only; it must not activate OpenClaw as a second runtime.
- `d/j` are used for parallel fanout; final audit returns to the single light chain.
- `@id` atoms are the compression layer for repeated programs.
- Programs must respect `WF_LNL_MAX_CHARS`, `WF_LNL_MAX_STEPS`, and resource guards.
