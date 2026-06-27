#!/usr/bin/env node
// spine-federation-dispatch.mjs — 聯邦派工（共創全艦隊化，非只 Codex）
// 把共創黑板 open 意圖路由給「真實可達」的其他 agent，讓全艦隊參與共創。
// 教訓(承 Codex escalation):不丟未定案 build 任務→改派【研究型】任務(研究X/提方案/列來源),
//   對模糊意圖穩健,OpenHands 在 Docker 沙箱跑研究無紅線。研究產出回饋工廠鏈再建。
// 路由(僅真實可達):OpenHands(在跑+有inbox/pending)。Hermes intake 待確認暫不假派。CrewAI 未安裝→跳過。
// 冪等:已在 pending/processed/failed 出現過的 slug 不重派。
import { readFileSync, writeFileSync, existsSync, mkdirSync, readdirSync } from "node:fs";
import { dirname, join, resolve as resolvePath } from "node:path";
import { fileURLToPath } from "node:url";
import { resolve } from "./lib/spine/resolve.mjs";
import { list, claim } from "./lib/spine/blackboard.mjs";

const DEFAULT_ROOT = resolvePath(dirname(fileURLToPath(import.meta.url)), "..");
const ROOT = resolvePath(process.env.OPENCLAW_ROOT || DEFAULT_ROOT);
const OH_INBOX = join(ROOT, ".openclaw", "openhands", "inbox");
const REPORT = join(ROOT, "reports", "federation-dispatch-latest.json");
const HERMES_INTAKE_PROOF = join(ROOT, "reports", "hermes-agent", "state", "hermes-nuwa-intake-proof-latest.json");
const out = { schema: "openclaw.federation-dispatch.v1", ts: new Date().toISOString(), routed: [], skipped: [], agents: {} };

function readJsonIfExists(path) {
  if (!existsSync(path)) return { exists: false, data: undefined };
  try {
    return { exists: true, data: JSON.parse(readFileSync(path, "utf8").replace(/^\uFEFF/, "")) };
  } catch (error) {
    return { exists: true, error: String(error?.message ?? error) };
  }
}

// ── 探可達 agent ──
out.agents.openhands = { reachable: existsSync(join(ROOT, "scripts", "openclaw-openhands-inbox.mjs")), inbox: OH_INBOX };
const hermesProof = readJsonIfExists(HERMES_INTAKE_PROOF);
const hermesIntakeVerified = hermesProof.data?.schema === "openclaw.hermes_nuwa_intake_proof.v1" && hermesProof.data?.ok === true;
out.agents.hermes = {
  reachable: existsSync(join(ROOT, "reports", "hermes-agent", "state", "cowork-bridge.json")),
  intakeProof: {
    path: HERMES_INTAKE_PROOF,
    exists: hermesProof.exists,
    ok: hermesIntakeVerified,
    status: hermesProof.data?.status,
    error: hermesProof.error,
  },
  note: hermesIntakeVerified
    ? "本地 dry-run intake adapter proof 已通過；仍未啟用自動派工(需人工核准 consumer/dispatcher 邊界)"
    : "intake 格式待確認,暫不假派(誠實)",
};
out.agents.crewai = { reachable: false, note: "未安裝,不適用(誠實)" };

// ── 已派過的 slug（冪等）──
const seen = new Set();
for (const sub of ["pending", "processed", "failed"]) {
  try { for (const f of readdirSync(join(OH_INBOX, sub))) { const m = f.match(/^cocreate-(.+)\.(md|txt)$/i); if (m) seen.add(m[1]); } } catch {}
}

// ── 路由 open 意圖 → OpenHands 研究任務 ──
if (out.agents.openhands.reachable) {
  const pending = join(OH_INBOX, "pending");
  mkdirSync(pending, { recursive: true });
  for (const it of list({ status: "open" })) {
    if (seen.has(it.slug)) { out.skipped.push(it.slug + ":已派過"); continue; }
    const body = `# 共創研究任務：${it.slug}\n\n## 角色\n你是共創艦隊的 OpenHands 研究員。**只做研究與方案提案，不做正式建造**（建造由七代理工廠鏈經人工核准後進行）。\n\n## 需求\n${it.need}\n\n## 產出（寫成 markdown）\n1. 開源既有做法調研（GitHub/開源/討論區，列來源連結）—— 不要重造輪子。\n2. 建議架構/方案（含取捨），對齊 OpenClaw 既有護欄（單一職責、不碰官方碼、可逆、不可逆操作需人工核准）。\n3. 風險與驗證方式。\n4. 給工廠鏈的 spec 草稿要點。\n\n## 禁止\n production / live trading / payment / secrets / 刪除 / 外發 / 不可逆操作。研究階段一律 dry-run / read-only。\n\n## 回報\n 完成後結果寫入 results；可在共創黑板對 ${it.slug} 補充貢獻。\n`;
    writeFileSync(join(pending, `cocreate-${it.slug}.md`), body, "utf8");
    claim(it.id, "openhands-research"); // 標記由 OpenHands 認領研究
    out.routed.push({ slug: it.slug, agent: "openhands", kind: "research" });
  }
} else out.skipped.push("openhands:不可達");

mkdirSync(join(REPORT, ".."), { recursive: true });
writeFileSync(REPORT + ".tmp", JSON.stringify(out, null, 2) + "\n", "utf8");
import("node:fs").then(fs => fs.renameSync(REPORT + ".tmp", REPORT));
console.log(JSON.stringify({ routedToOpenHands: out.routed.length, skipped: out.skipped.length, hermes: out.agents.hermes.note, crewai: out.agents.crewai.note }));
