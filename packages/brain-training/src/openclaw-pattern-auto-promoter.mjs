#!/usr/bin/env node
// 自動晉升器（閉環最後一哩）：crystallizer 草案 → 通過三閘 → 安全寫入女媧 L0
// 三閘（全過才晉升）：①重複≥3 ②有具體解法 ③classifyActionSafety 判 safe-readonly（交易/寫入/刪除一律擋）
// 反向可逆：所有自動晉升 row scope='auto-promoted-l0'，可一鍵清除
import { readFileSync, writeFileSync, renameSync, existsSync, copyFileSync } from "node:fs";
import { createRequire } from "node:module";
const require = createRequire(import.meta.url);
const ROOT = process.env.OPENCLAW_ROOT || process.cwd();
const DB = ROOT + "extensions\\evolution-learning\\.claude\\evolution-state\\nuwa.db";
const PROPOSALS = ROOT + ".openclaw\\memory\\working\\pattern-proposals.json";
const REPORT = ROOT + "reports\\pattern-auto-promoter-latest.json";

// 安全白名單/黑名單（與 nuwa-dispatch.classifyActionSafety 同源精神）
const DENY = /(下單|order|trade|交易|live|payment|付款|transfer|轉帳|提領|withdraw|刪除|\bdelete\b|\brm -rf\b|secret|私鑰|private[_-]?key|deploy|production|git push|外發)/i;
const ALLOW = /(讀取|讀檔|report|報告|verify|驗證|check|掃描|status|查|read|node --check|atomic|心跳|heartbeat|registry|路徑|path|encoding|cp950|windowsHide|閃窗|unlock|worktree)/i;
const classify = (text) => DENY.test(text) ? "unsafe" : (ALLOW.test(text) ? "safe-readonly" : "unknown");

const out = { schema: "openclaw.pattern-auto-promoter.v1", ts: new Date().toISOString(), considered: 0, promoted: [], skipped: [] };
let proposals = [];
try { proposals = JSON.parse(readFileSync(PROPOSALS, "utf8")); } catch { out.note = "no proposals file"; }

if (proposals.length) {
  copyFileSync(DB, DB + ".bak-autopromote-" + Date.now()); // 不可逆前先備份
  const Database = require(ROOT + "node_modules\\better-sqlite3");
  const db = new Database(DB);
  const now = new Date().toISOString();
  const upsert = db.prepare(`INSERT INTO patterns
    (id,slug,target,confidence,success_rate,sample_count,mental_models,keywords,context,skill_path,frozen,last_used,created_at,updated_at,parent_slug,scope,decay_score,last_activated)
    VALUES (@id,@slug,@target,@confidence,@success_rate,@sample_count,'[]',@keywords,@context,NULL,0,NULL,@now,@now,NULL,'auto-promoted-l0',1.0,@now)
    ON CONFLICT(id) DO UPDATE SET confidence=@confidence,success_rate=@success_rate,sample_count=@sample_count,updated_at=@now,last_activated=@now,scope='auto-promoted-l0'`);

  for (const p of proposals) {
    out.considered++;
    const occ = p.shadow?.recurrence ?? p.evidence?.occurrences ?? 0;
    const hasFix = p.shadow?.hasFix === true || (p.bestSolution?.strategy && p.bestSolution.strategy !== "(未萃取，需人工)");
    const text = [p.blocker, p.bestSolution?.strategy].join(" ");
    const safety = classify(text);
    const reasons = [];
    if (occ < 3) reasons.push("recurrence<3(" + occ + ")");
    if (!hasFix) reasons.push("no-fix");
    if (safety !== "safe-readonly") reasons.push("safety:" + safety);
    if (reasons.length) { out.skipped.push({ id: p.patternId, why: reasons.join(",") }); continue; }
    const slug = String(p.patternId).replace(/-draft$/, "").slice(0, 48);
    upsert.run({ id: slug + "-l0", slug, target: p.blocker.slice(0, 60),
      confidence: 0.8, success_rate: 0.8, sample_count: occ,
      keywords: JSON.stringify(p.blocker.toLowerCase().split(/[\s_:-]+/).filter(Boolean).slice(0, 8)),
      context: p.bestSolution.strategy.slice(0, 300), now });
    out.promoted.push({ id: slug + "-l0", occ, safety });
  }
  db.close();
}
writeFileSync(REPORT + ".tmp", JSON.stringify(out, null, 2) + "\n", "utf8"); renameSync(REPORT + ".tmp", REPORT);
console.log(JSON.stringify({ considered: out.considered, promoted: out.promoted.length, skipped: out.skipped.length, detail: out.promoted }));
