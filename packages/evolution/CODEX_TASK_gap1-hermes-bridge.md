# CODEX_TASK — 缺口① Hermes 橋路徑修復

> **status: pending**（完成後改 `completed` + 加 `completed_at`，見文末「完成判定」）
> 工作目錄：`extensions/evolution-learning/`　語言：TypeScript ESM　**註解用繁體中文**
> 由 Claude(Lead) 打包；Codex(builder) 執行 + 驗證。**禁碰 trading（capital-hft/auto-trading/paper-hft）；未過測試不得宣稱完成。**

## 任務
修復 Hermes 學習橋「寫入端 vs 讀取端」路徑不一致 → 學習回流斷裂。

## 背景（已讀碼鐵證）
- 寫入端 `src/hermes-gate.ts` 寫 `<stateDir>/learning-state.json`，stateDir = `resolveStateDir()` = `<base>/.claude/evolution-state`。
- 讀取端 `runEvolutionCycle` / `croner` / `cognitive-cycle` 讀 `(NUWA_WORKSPACE ?? cwd)/reports/hermes-agent/state/learning-state.json`。
- 兩目錄不同 → 橋斷。

## 已完成（Claude 製作 + node 驗證通過、純新增零破壞）
- 已新增 `src/learning-state-path.ts`，匯出 `resolveLearningStatePath()`（回傳讀取端標準路徑；已驗證 NUWA_WORKSPACE 與 cwd 兩案例）。

## 待做（Claude 已改碼，Codex 只需驗證+補測試）
1. ✅ **已由 Claude 改完**：`src/hermes-gate.ts` 加 `import { resolveLearningStatePath }`、行 111 改用它、`appendLearningRecord` 參數標 `_stateDir`(避 unused)。
2. 跑測試（見下）；若失敗則修。
3. 檢查 hermes-gate 相關測試是否斷言舊路徑 → 有則同步更新。
4. 邊角確認：`cognitive-cycle.ts:72` DEFAULT 只用 `cwd`，順手確認是否加 `NUWA_WORKSPACE`（非阻塞）。

## 驗證（必跑，全綠才算完成；用 PowerShell + OpenClaw 根）
```powershell
# vitest 用「路徑」過濾，不是 --filter（--filter 是 pnpm workspace 用、vitest 不認會 CACError）
pnpm exec vitest run extensions/evolution-learning
pnpm governance:r8:check
```

## 回報（貼回 Claude/Lead 驗收）
變更檔 / `git diff --stat` / `pnpm test` 結果 / `governance:r8:check` 結果 / 風險 / 回退(`git revert`)。

## 完成判定（防重複 / 自動結束）
- 完成定義：3 步全做 + `pnpm test`/`governance:r8:check` 全綠 + 回報已提交。
- 完成後：本檔 `status:` 改 `completed` + 加 `completed_at`（或改名 `.done.md` / 移至 `done/`）。
- 防重複：掃描待辦時**跳過 `status: completed`**；佇列無 pending → idle 停、**不重跑**（避免無限迴圈/重複亂修）。
- ⚠ `autonomous:controlled:watch:daemon` 涉 capital-hft：**可用但需判斷**——交易任務經 manual_approval 判斷閘（`task_router` 既有 `trading_payment→manual_approval`）；真實交易執行禁/人工，狀態/檢查/模擬/演化可自動。

## 安全
分支上做；不碰 trading；只修路徑、不動四層邏輯與 schema。
