#!/usr/bin/env node
/**
 * 編碼: UTF-8
 * 標題: memory.promote — nuwa 模式→可重用 skill 結晶晉升(B,補斷掉的晉升迴路)
 * 時間: 2026-06-22
 * 重點: 借 MemOS eligibility(gain/support)概念;調 minSupport≥3+濾雜訊源,避免 bloat;dry-run 不活化
 * 內容重點: 讀 nuwa.db patterns(走硬化 openDb=node:sqlite)→濾雜訊→eligibility→輸出 skill 卡候選+報告
 * agent: Cowork(Claude)
 * written: 2026-06-22
 * status: draft(dry-run 預設只出候選報告;--live 才寫 promoted 旗標+skill 卡,須人工核准)
 *
 * 對映:nuwa decay_score≈MemOS gain(信心/價值)、sample_count≈support(不同 episode 背書)。
 * 反 bloat(DMAD 反方+模擬證據):minSupport 預設 3(非 MemOS 預設 1)、排除 task-runner/autonomy 雜訊。
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { openDb } from "./lib/sqlite-compat.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO = path.resolve(__dirname, "..");
const NUWA_DB = path.join(REPO, "extensions", "evolution-learning", ".claude", "evolution-state", "nuwa.db");
const REPORT = path.join(REPO, "reports", "memory-promote-latest.json");

const arg = (k, d) => { const i = process.argv.indexOf(k); return i >= 0 && process.argv[i + 1] ? process.argv[i + 1] : d; };
const LIVE = process.argv.includes("--live");
const MIN_SUPPORT = Number(arg("--min-support", "3"));   // 反 bloat:≥3 個樣本才結晶
const MIN_SCORE = Number(arg("--min-score", "0.6"));     // decay_score≥0.6 才算穩定 engram
// 雜訊源/模式(不結晶):控制任務跑批、autonomy tick 等非真實學習
const NOISE = /controlled-task-runner|blackbox|autonomy-tick|smoke|heartbeat|tick$/i;

function toCard(p) {
  // p: nuwa pattern row(欄位 slug/target/confidence/success_rate/sample_count/mental_models/keywords/...)
  const slug = p.slug || p.id;
  return {
    name: `skill.${slug}`,
    description: (p.target || p.summary || slug).toString().slice(0, 160),
    inputs: "context matching keywords/mental_models",
    outputs: "proven successful procedure/decision",
    dependencies: [],
    owner: "memory.promote",
    version: "0.1.0-draft",
    contract: `crystallized from nuwa pattern ${slug} (support=${p.sample_count}, score=${p.decay_score ?? p.confidence})`,
    evidence: { slug, support: p.sample_count, score: p.decay_score ?? p.confidence, keywords: p.keywords },
    status: "draft",
  };
}

async function main() {
  if (!fs.existsSync(NUWA_DB)) { console.error("nuwa.db 不存在:", NUWA_DB); process.exit(1); }
  const db = await openDb(NUWA_DB, { readonly: !LIVE });
  const cols = db.prepare("PRAGMA table_info(patterns)").all().map((r) => r.name);
  const scoreCol = cols.includes("decay_score") ? "decay_score" : (cols.includes("confidence") ? "confidence" : null);
  const suppCol = cols.includes("sample_count") ? "sample_count" : (cols.includes("success_count") ? "success_count" : null);
  const keyCol = cols.includes("slug") ? "slug" : "id";
  const rows = db.prepare(`SELECT * FROM patterns`).all();

  const eligible = [], skippedNoise = [], skippedWeak = [];
  for (const r of rows) {
    const slug = String(r[keyCol] || "");
    const support = Number(suppCol ? r[suppCol] : 1) || 1;
    const score = Number(scoreCol ? r[scoreCol] : 0);
    if (NOISE.test(slug)) { skippedNoise.push(slug); continue; }
    if (support >= MIN_SUPPORT && score >= MIN_SCORE) eligible.push({ ...r, _slug: slug, _support: support, _score: score });
    else skippedWeak.push({ slug, support, score });
  }
  eligible.sort((a, b) => (b._score * b._support) - (a._score * a._support));
  const cards = eligible.map(toCard);

  const report = {
    generatedAt: new Date().toISOString(), mode: LIVE ? "live" : "dry-run",
    thresholds: { minSupport: MIN_SUPPORT, minScore: MIN_SCORE, noiseFilter: NOISE.source },
    totalPatterns: rows.length, eligible: eligible.length,
    skippedNoise: skippedNoise.length, skippedWeak: skippedWeak.length,
    topCards: cards.slice(0, 10),
  };
  fs.writeFileSync(REPORT, JSON.stringify(report, null, 2));

  if (LIVE) {
    // 寫 skill 卡 + 回標 nuwa pattern promoted(須人工核准後才 --live)
    const skillDir = path.join(REPO, ".planning", "skills-crystallized");
    fs.mkdirSync(skillDir, { recursive: true });
    for (const c of cards) fs.writeFileSync(path.join(skillDir, `${c.name}.json`), JSON.stringify(c, null, 2));
    if (cols.includes("promoted")) {
      const upd = db.prepare(`UPDATE patterns SET promoted=1 WHERE ${keyCol}=?`);
      for (const e of eligible) upd.run(e._slug);
    }
  }
  try { db.close(); } catch { /* ignore */ }
  console.log(JSON.stringify({ mode: report.mode, totalPatterns: report.totalPatterns, eligible: report.eligible, skippedNoise: report.skippedNoise, skippedWeak: report.skippedWeak, report: "reports/memory-promote-latest.json" }, null, 0));
}
main().catch((e) => { console.error("promote err:", e.message); process.exit(1); });
