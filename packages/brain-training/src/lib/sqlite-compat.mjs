#!/usr/bin/env node
/**
 * SQLite compatibility layer — 後端優先序(2026-06-22 突破式硬化):
 *   1) node:sqlite (Node 22+/24 內建 DatabaseSync,真 C SQLite,免編譯,WAL+檔鎖) ← 首選
 *   2) better-sqlite3 (原生,若已編成)
 *   3) sql.js (WASM 後援:加寫鎖+原子寫+寫後自驗,僅在前兩者皆無時用)
 *
 * 治本:nuwa.db 多寫者損壞源於落到無鎖、整檔重寫的 sql.js;改用內建 node:sqlite
 * 取得真正的檔鎖+WAL+busy_timeout,根除 torn/lost-update 損壞類。
 * 介面契約(消費端只用這些):db.prepare(sql).all()/.get()/.run() · db.pragma(str) · db.exec(sql) · db.close()
 */

import fs from "node:fs";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);

let nodeSqliteCache = null;
let betterSqlite3Cache = null;
let sqlJsCache = null;
let warnedSqlJs = false;

// ── 後端探測 ──
function tryNodeSqlite() {
  if (nodeSqliteCache !== null) return nodeSqliteCache;
  try {
    const mod = require("node:sqlite");          // 需要時可加 --experimental-sqlite
    nodeSqliteCache = mod && mod.DatabaseSync ? mod : false;
  } catch {
    nodeSqliteCache = false;
  }
  return nodeSqliteCache;
}
function tryBetterSqlite3() {
  if (betterSqlite3Cache !== null) return betterSqlite3Cache;
  try { betterSqlite3Cache = require("better-sqlite3"); }
  catch { betterSqlite3Cache = false; }
  return betterSqlite3Cache;
}
async function trySqlJs() {
  if (sqlJsCache !== null) return sqlJsCache;
  try { const initSqlJs = require("sql.js"); sqlJsCache = await initSqlJs(); }
  catch { sqlJsCache = false; }
  return sqlJsCache;
}

// ── 共用:寫者上 WAL + busy_timeout(node:sqlite / better-sqlite3 皆適用 exec) ──
function hardenPragmas(execFn) {
  try {
    execFn("PRAGMA journal_mode = WAL");          // 並發:讀寫不互鎖
    execFn("PRAGMA busy_timeout = 8000");         // 撞鎖等 8s 不直接失敗
    execFn("PRAGMA synchronous = NORMAL");        // WAL 下安全且快
  } catch { /* best-effort */ }
}

// ── node:sqlite 介面轉接(補 .pragma(),其餘 DatabaseSync 原生相容) ──
class NodeSqliteWrapper {
  constructor(DatabaseSync, dbPath, { readonly }) {
    this.db = new DatabaseSync(dbPath, { readOnly: !!readonly });
    this.readonly = !!readonly;
    if (!readonly) hardenPragmas((s) => this.db.exec(s));
  }
  pragma(str) { try { this.db.exec(`PRAGMA ${str}`); } catch { /* ignore */ } }
  prepare(sql) { return this.db.prepare(sql); }   // StatementSync: all/get/run 簽名相容
  exec(sql) { this.db.exec(sql); }
  close() { try { this.db.close(); } catch { /* ignore */ } }
}

// ── sql.js 後援:寫鎖 ──
function sleepBusy(ms) {
  try { Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms); }
  catch { const end = Date.now() + ms; while (Date.now() < end) { /* fallback */ } }
}
function acquireWriteLock(filePath, timeoutMs = 8000, staleMs = 30000) {
  const lock = `${filePath}.wlock`;
  const start = Date.now();
  for (;;) {
    try {
      const fd = fs.openSync(lock, "wx");
      try { fs.writeSync(fd, `${process.pid}@${Date.now()}`); } catch { /* ignore */ }
      return { lock, fd };
    } catch (e) {
      if (e.code !== "EEXIST") return null;
      try { const st = fs.statSync(lock); if (Date.now() - st.mtimeMs > staleMs) { fs.unlinkSync(lock); continue; } } catch { /* released */ }
      if (Date.now() - start > timeoutMs) return null;
      sleepBusy(40);
    }
  }
}
function releaseWriteLock(h) {
  if (!h) return;
  try { fs.closeSync(h.fd); } catch { /* ignore */ }
  try { fs.unlinkSync(h.lock); } catch { /* ignore */ }
}

class SqlJsStatement {
  constructor(db, sql, wrapper) { this.db = db; this.sql = sql; this.wrapper = wrapper; }
  all(...params) {
    try {
      const stmt = this.db.prepare(this.sql);
      const flat = params.flat();
      if (flat.length > 0) stmt.bind(flat);
      const rows = [];
      while (stmt.step()) {
        const cols = stmt.getColumnNames(); const vals = stmt.get(); const row = {};
        for (let i = 0; i < cols.length; i += 1) row[cols[i]] = vals[i];
        rows.push(row);
      }
      stmt.free();
      return rows;
    } catch { return []; }
  }
  run(...params) { this.db.run(this.sql, params.flat()); this.wrapper.dirty = true; return { changes: this.db.getRowsModified() }; }
  get(...params) { return this.all(...params)[0] ?? null; }
}

class SqlJsWrapper {
  constructor(sqlJsDb, filePath, { lock = null, snapshot = null, sql = null } = {}) {
    this.db = sqlJsDb; this.filePath = filePath; this.readonly = false; this.dirty = false;
    this._lock = lock; this._snapshot = snapshot; this._sql = sql;
  }
  pragma(str) { try { this.db.run(`PRAGMA ${str}`); } catch { /* ignore */ } }
  prepare(sql) { return new SqlJsStatement(this.db, sql, this); }
  _verify(bytes) {
    try {
      if (!this._sql) return true;
      const probe = new this._sql.Database(bytes);
      const st = probe.prepare("SELECT count(*) FROM sqlite_master"); st.step(); st.free(); probe.close();
      return true;
    } catch { return false; }
  }
  close() {
    try {
      if (this.dirty && this.filePath && !this.readonly) {
        const data = Buffer.from(this.db.export());
        if (this._verify(data)) {
          const tmp = `${this.filePath}.tmp-${process.pid}`;
          fs.writeFileSync(tmp, data); fs.renameSync(tmp, this.filePath);   // 原子替換
        } else if (this._snapshot) {
          try { fs.writeFileSync(this.filePath, this._snapshot); } catch { /* ignore */ }  // 自癒還原
        }
      }
    } finally {
      try { this.db.close(); } catch { /* ignore */ }
      releaseWriteLock(this._lock);
    }
  }
  exec(sql) { this.db.run(sql); this.dirty = true; }
}

function ensureExists(dbPath, fileMustExist) {
  if (fileMustExist && !fs.existsSync(dbPath)) throw new Error(`Database not found: ${dbPath}`);
}

/** 同步開檔(首選 node:sqlite → better-sqlite3;皆無則丟錯,改用 openDb async 走 sql.js) */
export function openDbSync(dbPath, opts = {}) {
  const { readonly = false, fileMustExist = true } = opts;
  ensureExists(dbPath, fileMustExist);

  const NodeSqlite = tryNodeSqlite();
  if (NodeSqlite) {
    try { return new NodeSqliteWrapper(NodeSqlite.DatabaseSync, dbPath, { readonly }); }
    catch { nodeSqliteCache = false; }
  }
  const BetterSqlite3 = tryBetterSqlite3();
  if (BetterSqlite3) {
    try {
      const db = new BetterSqlite3(dbPath, { readonly, fileMustExist });
      if (!readonly) hardenPragmas((s) => db.pragma(s.replace(/^PRAGMA\s+/i, "")));
      return db;
    } catch { betterSqlite3Cache = false; }
  }
  throw new Error("無同步 SQLite 後端(node:sqlite/better-sqlite3 皆不可用);請用 openDb() 走 sql.js");
}

/** 非同步開檔:node:sqlite → better-sqlite3 → sql.js(WASM 後援) */
export async function openDb(dbPath, opts = {}) {
  const { readonly = false, fileMustExist = true } = opts;
  ensureExists(dbPath, fileMustExist);

  // 1) 首選:Node 內建(真 C SQLite,免編譯,WAL+檔鎖)
  const NodeSqlite = tryNodeSqlite();
  if (NodeSqlite) {
    try { return new NodeSqliteWrapper(NodeSqlite.DatabaseSync, dbPath, { readonly }); }
    catch { nodeSqliteCache = false; }
  }
  // 2) 原生 better-sqlite3
  const BetterSqlite3 = tryBetterSqlite3();
  if (BetterSqlite3) {
    try {
      const db = new BetterSqlite3(dbPath, { readonly, fileMustExist });
      if (!readonly) hardenPragmas((s) => db.pragma(s.replace(/^PRAGMA\s+/i, "")));
      return db;
    } catch { betterSqlite3Cache = false; }
  }
  // 3) sql.js WASM 後援(脆弱,已上寫鎖+原子寫+自驗)
  const SQL = await trySqlJs();
  if (!SQL) throw new Error("No SQLite backend available (node:sqlite/better-sqlite3/sql.js 皆不可用)");
  if (!warnedSqlJs && !readonly) {
    warnedSqlJs = true;
    try { console.warn("[sqlite-compat] 已落到 sql.js 後援(node:sqlite 與 better-sqlite3 皆不可用)。建議啟用 node:sqlite(Node22+,必要時加 --experimental-sqlite)。"); } catch { /* ignore */ }
  }
  const lock = readonly ? null : acquireWriteLock(dbPath);
  let snapshot = null, db;
  if (fs.existsSync(dbPath)) {
    const buf = fs.readFileSync(dbPath);
    snapshot = readonly ? null : Buffer.from(buf);
    db = new SQL.Database(buf);
  } else { db = new SQL.Database(); }
  const wrapper = new SqlJsWrapper(db, dbPath, { lock, snapshot, sql: SQL });
  wrapper.readonly = readonly;
  return wrapper;
}
