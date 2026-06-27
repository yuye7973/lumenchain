// 一次性:把 3 個 addy 人格加進 live nuwa.db(備份+插入+重建FTS+驗證)。跑完可刪本檔。
import Database from "better-sqlite3";
import { copyFileSync } from "node:fs";
import path from "node:path";
const DB = path.join(import.meta.dirname, ".claude", "evolution-state", "nuwa.db");
const bak = DB + ".bak-" + new Date().toISOString().replace(/[:.]/g,"").slice(0,15);
copyFileSync(DB, bak); console.log("備份:", bak);
const P = "C:/Users/user/.claude/plugins/cache/addy-agent-skills/agent-skills/0.6.0/agents";
const now = new Date().toISOString();
const rows = [
 ["addy-code-reviewer-v1","addy-code-reviewer","Senior Staff Code Reviewer",0.6,0.7,20,
  ["五軸審查","change sizing ~100行","嚴重度Nit/Optional/FYI","staff會批准嗎","拆分策略"],
  ["code review","程式審查","審查","review this","merge前","pr review"],
  "addy Senior Staff 程式審查人格,五軸(正確/設計/可讀/測試/安全)",P+"/code-reviewer.md"],
 ["addy-security-auditor-v1","addy-security-auditor","Security Auditor",0.6,0.7,20,
  ["OWASP Top 10","威脅建模","最小權限","祕密管理","三層邊界驗證"],
  ["security","資安","漏洞","owasp","威脅","injection","注入","稽核"],
  "addy 資安稽核人格,OWASP/威脅建模/邊界驗證",P+"/security-auditor.md"],
 ["addy-test-engineer-v1","addy-test-engineer","Test Engineer",0.6,0.7,20,
  ["測試金字塔80/15/5","Prove-It","覆蓋率分析","DAMP優於DRY","紅綠重構"],
  ["test","測試","tdd","覆蓋率","coverage","測試策略"],
  "addy 測試工程人格,金字塔/覆蓋率/Prove-It",P+"/test-engineer.md"],
];
const db = new Database(DB);
const cols = db.prepare("PRAGMA table_info(patterns)").all().map(c=>c.name);
const has = n => cols.includes(n);
const ins = db.prepare(`INSERT OR REPLACE INTO patterns
 (id,slug,target,confidence,success_rate,sample_count,mental_models,keywords,context,skill_path,frozen,scope,decay_score,created_at,updated_at${has('last_used')?',last_used':''}${has('last_activated')?',last_activated':''})
 VALUES (@id,@slug,@target,@confidence,@success_rate,@sample_count,@mental_models,@keywords,@context,@skill_path,0,'global',1.0,@now,@now${has('last_used')?',NULL':''}${has('last_activated')?',NULL':''})`);
const tx = db.transaction(()=>{ for(const r of rows) ins.run({id:r[0],slug:r[1],target:r[2],confidence:r[3],success_rate:r[4],sample_count:r[5],mental_models:JSON.stringify(r[6]),keywords:JSON.stringify(r[7]),context:r[8],skill_path:r[9],now}); });
tx();
try { db.prepare("INSERT INTO patterns_fts(patterns_fts) VALUES('rebuild')").run(); console.log("FTS 重建 ok"); } catch(e){ console.log("FTS skip:", e.message); }
console.log("patterns:", db.prepare("SELECT count(*) n FROM patterns").get().n);
console.log("addy:", db.prepare("SELECT slug,success_rate,sample_count FROM patterns WHERE slug LIKE 'addy-%'").all());
console.log("integrity:", db.prepare("PRAGMA integrity_check").get());
db.close();
