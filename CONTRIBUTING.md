# Contributing to LumenChain

Thanks for your interest in building LumenChain with us. This is a multi-agent cognitive stack and contributions of all sizes are welcome — bug fixes, tests, docs, new neuron types, new brain strategies, and new skills.

## Ground rules

- Be respectful and constructive.
- Keep the cognitive layer **dependency-light**. `@lumenchain/neural-bus` and `@lumenchain/brain` are intentionally zero-dependency (Node standard library only). Please do not add runtime dependencies to them without discussion.
- OpenClaw and the `pi` framework are **optional** integrations. Never bundle their source here; depend on them via optional peer dependencies and guard imports so the package still runs standalone.
- Never commit secrets, API keys, live databases, or runtime state (see `.gitignore`).

## Project layout

```
packages/
  neural-bus/      perception + bus + failure detection + self-heal + schemas
  brain/           DMAD debate engine + cognitive spine + multi-brain MCP
  evolution/       self-evolving learning + cost governance (evomind)
  skill-workshop/  author + register agent skills
docs/              architecture and concept notes
```

## Getting started

```bash
git clone https://github.com/yuye7973/lumenchain.git
cd lumenchain
npm install
npm test -w @lumenchain/brain   # or any package
```

## Making a change

1. Fork the repo and create a branch: `git checkout -b fix/short-description`.
2. Make your change. Add or update tests in the affected package.
3. Run that package's tests: `npm test -w <package>`.
4. Keep commits focused and write a clear message.
5. Open a pull request describing **what** changed and **why**. Link any related issue.

## Good first contributions

- Add tests for an existing neuron / brain strategy.
- Add a new `neuraledge` relation type and document it.
- Improve a schema's descriptions and add examples.
- Add a new MCP wrapper under `brain/src/mcp-wrappers`.
- Improve docs or translate them.

## Reporting issues

Open an issue with: what you expected, what happened, and minimal steps to reproduce. For security-sensitive reports, please disclose privately first.

## License

By contributing you agree that your contributions are licensed under the project's [MIT License](LICENSE).
