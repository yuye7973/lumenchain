#!/usr/bin/env node
// lib/safe-write.mjs — 真原子寫入：停在任何一刻都不留半截/截斷壞檔。
// tmp 寫入 → fsync(file 資料落地) → rename(原子替換) → fsync(dir 讓 rename 持久化)。
// 這是今天根治「掛載截斷/強殺留 NUL」的標準件。所有關鍵狀態寫入都該用它。
import { openSync, writeSync, fsyncSync, closeSync, renameSync, mkdirSync, unlinkSync } from "node:fs";
import { dirname } from "node:path";

export function safeWriteFileSync(filePath, data) {
  const buf = typeof data === "string" ? Buffer.from(data, "utf8") : data;
  try { mkdirSync(dirname(filePath), { recursive: true }); } catch {}
  const tmp = filePath + ".tmp-" + process.pid + "-" + Date.now();
  const fd = openSync(tmp, "w");
  try {
    let off = 0;
    while (off < buf.length) off += writeSync(fd, buf, off, buf.length - off, off);
    fsyncSync(fd); // 強制資料落地（防停電/強殺留半截）
  } finally { closeSync(fd); }
  // 原子替換（讀者永遠看到完整舊檔或完整新檔，不會看到半截）。
  // Windows 目標被佔用(EPERM/EBUSY/EACCES)時 rename 會拋 → 短退避重試；仍敗則清 tmp 不留孤兒（根治 .tmp- 殘檔洩漏）。
  let renamed = false, lastErr;
  for (let i = 0; i < 5 && !renamed; i++) {
    try { renameSync(tmp, filePath); renamed = true; }
    catch (e) {
      lastErr = e;
      if (i < 4) { try { Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 20 * (i + 1)); } catch {} } // 同步退避 20/40/60/80ms
    }
  }
  if (!renamed) { try { unlinkSync(tmp); } catch {} throw lastErr; } // 永久失敗：先清暫存再拋，絕不留半截/孤兒
  // 刷目錄讓 rename 持久化（Linux 需要；Windows 不支援 dir fsync → 忽略）
  try { const dfd = openSync(dirname(filePath), "r"); try { fsyncSync(dfd); } finally { closeSync(dfd); } } catch {}
}

// JSON 便利版
export function safeWriteJsonSync(filePath, obj) { safeWriteFileSync(filePath, JSON.stringify(obj, null, 2)); }
