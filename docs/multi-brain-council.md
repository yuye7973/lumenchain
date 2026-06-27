---
name: 多腦合議
type: system-module
owner: 六種Workflow模式(單源)
version: v1
dependencies: [合議回證]
---

# 模組 多腦合議

**description**：多腦合議（Mixture-of-Brains / MoA）——把一題並行問算力池裡好幾顆「不同」本地模型，各自提案，

**inputs**：node:fs

**outputs**：registeredModels, modelFamily, pickDiverse, availableModels, council

**dependencies**：[[合議回證]]

**contract**：`registeredModels() / modelFamily() / pickDiverse() / availableModels() / council()`
