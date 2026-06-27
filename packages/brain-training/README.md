# @lumenchain/brain-training

Zero-dependency **brain-training (練腦)** — how a local brain practices, is reviewed, and is promoted **without regressing**.

- **Promotion gates** — apply/review gates that a new brain version must pass before adoption.
- **Drift detection & hunting** — catch silent behavioural drift.
- **Pattern auto-promotion** — promote validated patterns automatically.
- **Memory promotion** — promote vetted memory into the knowledge layer.

## Install
```
npm i @lumenchain/brain-training
```

## Exports
`./promotion-apply-gate` · `./promotion-review-gate` · `./pattern-auto-promoter` · `./drift-check` · `./drift-hunter` · `./memory-promote`

## Why
Self-improving systems regress or get reward-hacked if changes are adopted blindly. Every promotion (e.g. v12 → v13) must pass an independent gate first — adoption is earned, not assumed.

## License
Apache-2.0
