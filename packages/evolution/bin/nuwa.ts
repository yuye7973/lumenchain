#!/usr/bin/env node
/**
 * nuwa — 女媧進化學習系統獨立 CLI
 *
 * 安裝後可直接執行：
 *   nuwa status
 *   nuwa patterns --json
 *   nuwa cells
 *   nuwa distill "查理·芒格" --workspace /path/to/project
 *   nuwa freeze charlie-munger
 *   nuwa install charlie-munger
 *   nuwa forget charlie-munger --force
 *   nuwa hatch charlie-munger
 *
 * 多入口運行原則：
 *   1. 優先嘗試連接 OpenClaw gateway（WebSocket RPC）
 *   2. 若 gateway 未運行，直接讀寫檔案（standalone 模式）
 *
 * npm 安裝後自動進入 PATH：
 *   package.json → "bin": { "nuwa": "./bin/nuwa.js" }
 */

import { Command } from "commander";
import {
  cmdStatus,
  cmdPatterns,
  cmdCells,
  cmdTop,
  cmdRem,
  cmdDistill,
  cmdFreeze,
  cmdInstall,
  cmdForget,
  cmdHatch,
  cmdCostStatus,
  cmdModels,
  cmdSubList,
  cmdSubPlans,
  cmdSubAdd,
  cmdSubRemove,
  cmdSubDetect,
  cmdSubVerify,
  cmdSubBudget,
  cmdChat,
  cmdDebate,
  cmdPersonaList,
  cmdPersonaCreate,
  cmdPersonaUse,
  cmdHistory,
} from "../src/cli.js";

const program = new Command();

program
  .name("nuwa")
  .description("🏺 女媧四層進化學習系統 — 獨立 CLI")
  .version("2026.5.5");

// ── 查詢類指令 ────────────────────────────────────────────────────

program
  .command("status")
  .description("顯示整體進化狀態概覽")
  .option("-w, --workspace <dir>", "指定工作目錄（預設：當前目錄）")
  .option("--json", "以 JSON 格式輸出")
  .action((opts) => void cmdStatus(opts));

program
  .command("patterns")
  .description("列出所有女媧蒸餾模式")
  .option("-w, --workspace <dir>", "指定工作目錄")
  .option("--json", "以 JSON 格式輸出")
  .action((opts) => void cmdPatterns(opts));

program
  .command("cells")
  .description("顯示幹細胞池狀態（胚胎 → 孵化 → 就緒 → 常駐）")
  .option("-w, --workspace <dir>", "指定工作目錄")
  .option("--json", "以 JSON 格式輸出")
  .action((opts) => void cmdCells(opts));

program
  .command("top")
  .description("最常使用的 Top-5 人物框架")
  .option("-w, --workspace <dir>", "指定工作目錄")
  .option("--json", "以 JSON 格式輸出")
  .action((opts) => void cmdTop(opts));

// ── 操作類指令 ────────────────────────────────────────────────────

program
  .command("rem")
  .description("觸發 REM 週期（需 OpenClaw 插件上下文）")
  .option("-w, --workspace <dir>", "指定工作目錄")
  .action((opts) => void cmdRem(opts));

program
  .command("distill <target>")
  .description("自動蒸餾新主題為 NuwaPattern（可選 Tavily 搜尋加強）")
  .option("-w, --workspace <dir>", "指定工作目錄")
  .option("--tavily-key <key>", "Tavily API Key（也可用 TAVILY_API_KEY 環境變數）")
  .action((target: string, opts: { workspace?: string; tavilyKey?: string }) =>
    void cmdDistill(target, opts),
  );

program
  .command("freeze <slug>")
  .description("凍結 pattern，停止代謝衰減")
  .option("-w, --workspace <dir>", "指定工作目錄")
  .action((slug: string, opts: { workspace?: string }) =>
    void cmdFreeze(slug, { ...opts, unfreeze: false }),
  );

program
  .command("unfreeze <slug>")
  .description("解凍 pattern")
  .option("-w, --workspace <dir>", "指定工作目錄")
  .action((slug: string, opts: { workspace?: string }) =>
    void cmdFreeze(slug, { ...opts, unfreeze: true }),
  );

program
  .command("install <slug>")
  .description("手動晉升幹細胞為常駐（installed）")
  .option("-w, --workspace <dir>", "指定工作目錄")
  .action((slug: string, opts: { workspace?: string }) => void cmdInstall(slug, opts));

program
  .command("forget <slug>")
  .description("永久刪除 pattern 和幹細胞（需 --force 確認）")
  .option("-w, --workspace <dir>", "指定工作目錄")
  .option("--force", "確認永久刪除")
  .action((slug: string, opts: { workspace?: string; force?: boolean }) =>
    void cmdForget(slug, opts),
  );

program
  .command("hatch <slug>")
  .description("手動孵化：生成技能 Markdown 並更新 skillPath")
  .option("-w, --workspace <dir>", "指定工作目錄")
  .action((slug: string, opts: { workspace?: string }) => void cmdHatch(slug, opts));

program
  .command("cost")
  .description("查看費用守衛狀態與本月費用概況")
  .option("-w, --workspace <dir>", "指定工作目錄")
  .action((opts) => void cmdCostStatus(opts));

program
  .command("models")
  .description("查詢所有 AI 模型即時定價（LiteLLM 100+ 模型 + OpenRouter 400+ 模型）")
  .option("-w, --workspace <dir>", "指定工作目錄")
  .option("--search <query>", "搜尋廠商或模型名稱（例：claude、gpt-4、gemini、groq、deepseek）")
  .option("--refresh", "強制從網路拉取最新定價（每 24 小時自動刷新）")
  .action((opts) => void cmdModels(opts));

// ── 訂閱管理 ────────────────────────────────────────────────────

const sub = program
  .command("sub")
  .description("訂閱方案管理（決定哪些操作是訂閱內免費、哪些需要額外付費確認）");

sub
  .command("list")
  .description("查看已登記的訂閱與完整操作覆蓋矩陣")
  .option("-w, --workspace <dir>", "指定工作目錄")
  .action((opts) => void cmdSubList(opts));

sub
  .command("plans")
  .description("列出所有可登記的訂閱方案（Claude Pro/Max、OpenAI Plus/Pro、Codex CLI 等）")
  .action(() => void cmdSubPlans());

sub
  .command("add <id>")
  .description(
    "登記訂閱方案（例：claude-max-20、openai-pro、codex-cli-key、tavily-free）\n" +
    "  登記後，該訂閱覆蓋的操作將自動放行，不再需要每次確認",
  )
  .option("-w, --workspace <dir>", "指定工作目錄")
  .option("--key <apiKey>", "API Key（per-token 方案需要）")
  .option("--note <text>", "備注說明（例如：2026-05 月費訂閱）")
  .option("--budget <usd>", "此訂閱的月預算上限（USD），超過時警告")
  .action((id: string, opts) => void cmdSubAdd(id, opts));

sub
  .command("remove <id>")
  .description("移除已登記的訂閱（移除後，對應操作將重新受費用守衛管控）")
  .option("-w, --workspace <dir>", "指定工作目錄")
  .action((id: string, opts) => void cmdSubRemove(id, opts));

sub
  .command("detect")
  .description(
    "全自動掃描偵測你有哪些 AI 訂閱（無需手動設定）\n" +
    "  掃描來源：環境變數、~/.claude/settings.json、~/.codex/config.json、\n" +
    "            ~/.config/gcloud/、已安裝的 CLI 工具（claude、codex、gemini）等",
  )
  .option("-w, --workspace <dir>", "指定工作目錄")
  .option("--force", "強制重新掃描（忽略 1 小時快取）")
  .action((opts) => void cmdSubDetect(opts));

sub
  .command("verify")
  .description(
    "手動觸發訂閱查驗（系統每 15 天自動執行）\n" +
    "  查驗內容：重新掃描、API Key 探針（零成本）、與上次比對差異",
  )
  .option("-w, --workspace <dir>", "指定工作目錄")
  .option("--force", "強制執行（無論距上次多久）")
  .action((opts) => void cmdSubVerify(opts));

sub
  .command("budget <amount>")
  .description("設定全域月預算上限（USD），0 = 清除限制")
  .option("-w, --workspace <dir>", "指定工作目錄")
  .option(
    "--behavior <mode>",
    "超過預算時的行為：block（封鎖所有付費操作）或 warn（僅顯示警告）",
    "block",
  )
  .action((amount: string, opts) => void cmdSubBudget(amount, opts));

// ── Gateway 橋接（OpenClaw WebSocket RPC）────────────────────────

program
  .command("gateway <method> [params]")
  .description("直接呼叫 OpenClaw gateway RPC 方法（需 gateway 執行中）")
  .option("--url <url>", "Gateway URL", "ws://localhost:61500")
  .option("--token <token>", "Gateway 認證 Token（或用 OPENCLAW_TOKEN 環境變數）")
  .option("--json", "以 JSON 格式輸出結果")
  .action(async (method: string, params: string | undefined, opts: { url: string; token?: string; json?: boolean }) => {
    const token = opts.token ?? process.env.OPENCLAW_TOKEN;
    let parsedParams: unknown = undefined;
    if (params) {
      try { parsedParams = JSON.parse(params); } catch { parsedParams = params; }
    }
    try {
      // 動態 import openclaw CLI RPC（只有在 openclaw 安裝時才可用）
      const { callGatewayFromCli } = await import(
        "openclaw/plugin-sdk/gateway-runtime"
      ).catch(() => ({ callGatewayFromCli: null }));

      if (!callGatewayFromCli) {
        process.stderr.write(
          `❌ openclaw CLI 未安裝，無法呼叫 gateway。\n` +
          `   請先安裝：npm install -g openclaw\n`,
        );
        process.exitCode = 1;
        return;
      }

      const result = await callGatewayFromCli(method, { url: opts.url, token }, parsedParams);
      if (opts.json) {
        process.stdout.write(JSON.stringify(result, null, 2) + "\n");
      } else {
        process.stdout.write(`✅ ${method}：${JSON.stringify(result)}\n`);
      }
    } catch (err) {
      process.stderr.write(
        `❌ Gateway 呼叫失敗：${err instanceof Error ? err.message : String(err)}\n`,
      );
      process.exitCode = 1;
    }
  });

// ── 說明尾注 ──────────────────────────────────────────────────────

program.addHelpText(
  "after",
  `
訂閱設定（首次使用必做）：
  nuwa sub plans                      # 查看所有可登記的方案
  nuwa sub detect                     # 從環境變數自動偵測
  nuwa sub add claude-max-20          # 登記 Claude Max $200/月
  nuwa sub add openai-pro             # 登記 ChatGPT Pro $200/月（含 Codex CLI）
  nuwa sub add codex-cli-key --key sk-...  # 登記 Codex CLI API Key（per-token）
  nuwa sub add tavily-free            # 登記 Tavily 免費層（1000次/月）
  nuwa sub list                       # 查看覆蓋矩陣

費用查詢：
  nuwa cost                           # 本月費用概況
  nuwa sub budget 10                  # 設定月預算上限 $10

查詢類指令：
  nuwa status
  nuwa patterns --json
  nuwa cells -w /path/to/project
  nuwa top

操作類指令：
  nuwa distill "芒格" --tavily-key sk-xxx
  nuwa install charlie-munger
  nuwa forget charlie-munger --force
  nuwa hatch warren-buffett

多入口運行：
  • OpenClaw 內建：openclaw evolution <cmd>   (透過 api.registerCli)
  • 獨立 CLI    ：nuwa <cmd>                  (此程式)
  • MCP Server  ：nuwa-mcp / npm run mcp      (Claude Code CLI / 任何 MCP 客戶端)
  • WebSocket   ：nuwa gateway <method>       (呼叫 OpenClaw gateway)

訂閱規則：
  已登記的訂閱所覆蓋的操作 → 訂閱費已包含，零額外成本，直接放行
  訂閱外的 API 操作         → 估算費用，必須明確確認才執行
  無任何覆蓋的操作          → 硬拒絕，提示需要哪個訂閱
`,
);

// nuwa chat
program
  .command("chat")
  .description("開啟互動式 REPL 對話（與 AI 多輪對話）")
  .option("-w, --workspace <dir>", "指定工作目錄")
  .option("--persona <slug>", "帶角色進入對話（例：strict-cto）")
  .option("--session <id>", "續接上次對話")
  .option("--agent <type>", "指定代理（claude/codex/openclaw）", "claude")
  .action((opts) => void cmdChat(opts));

// nuwa debate
program
  .command("debate <topic>")
  .description("啟動三代理 DMAD 辯論（Claude + Codex + OpenClaw）")
  .option("-w, --workspace <dir>", "指定工作目錄")
  .option("--rounds <n>", "最多輪次（預設 3）", "3")
  .option("--model <name>", "MoA 聚合模型（預設 sonnet）", "sonnet")
  .option("--no-moa", "不做 MoA 聚合，直接看各代理結論")
  .action((topic, opts) =>
    void cmdDebate(topic, { ...opts, rounds: parseInt(opts.rounds as string) }),
  );

// nuwa persona
const persona = program.command("persona").description("角色管理（EvoAgentX 驅動）");

persona
  .command("list")
  .description("列出所有角色（含 fitness_score）")
  .option("-w, --workspace <dir>")
  .option("--min-fitness <n>", "最低適應度篩選")
  .action((opts) =>
    void cmdPersonaList({
      ...opts,
      minFitness: opts.minFitness ? parseFloat(opts.minFitness as string) : undefined,
    }),
  );

persona
  .command("create")
  .description("建立新角色")
  .requiredOption("--slug <slug>", "角色 slug")
  .requiredOption("--name <name>", "角色名稱")
  .requiredOption("--description <desc>", "角色描述")
  .option("--style <style>", "風格")
  .option("--focus <focus>", "關注點")
  .option("--pattern <slug>", "繼承的 nuwa pattern slug")
  .option("-w, --workspace <dir>")
  .action((opts) => void cmdPersonaCreate(opts));

persona
  .command("use <slug>")
  .description("設定本次 session 預設角色")
  .option("-w, --workspace <dir>")
  .action((slug, opts) => void cmdPersonaUse(slug, opts));

// nuwa history
program
  .command("history [sessionId]")
  .description("查看對話歷程（含角色對話）")
  .option("-w, --workspace <dir>")
  .option("--mode <mode>", "按模式篩選（normal/role-play/debate/interview）")
  .option("--search <query>", "全文搜尋歷史摘要")
  .option("--limit <n>", "最多顯示筆數", "20")
  .action((sessionId, opts) =>
    void cmdHistory({
      ...opts,
      sessionId: sessionId as string | undefined,
      limit: parseInt(opts.limit as string),
    }),
  );

program.parse(process.argv);
