#!/usr/bin/env node
// openclaw-silent-drift-hunter.mjs — 靜默漂移獵人（哨兵每小時觸發）。唯讀掃 registry 中 report/heartbeat 型器官，找「登記為活但報告過期」的靜默漂移，寫報告。不改任何器官。
import { readFileSync, statSync, writeFileSync, mkdirSync, renameSync } from "node:fs";
import { join, resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = process.env.OPENCLAW_ROOT || resolve(dirname(fileURLToPath(import.meta.url)), "..");
const REGISTRY = join(ROOT, "config", "agent-registry.json");
const REPORT = join(ROOT, "reports", "silent-drift-report.json");

function ageMin(p) { try { return (Date.now() - statSync(p).mtimeMs) / 60000; } catch { return null; } }

function main() {
  const out = { schema: "openclaw.silent-drift.v1", ts: new Date().toISOString(), checked: 0, drift: [], missing: [] };
  let reg; try { reg = JSON.parse(readFileSync(REGISTRY, "utf8")); } catch { reg = { agents: [] }; }
  for (const a of reg.agents || []) {
    const c = a.check || {};
    if (c.type !== "report" && c.type !== "heartbeat") continue;
    out.checked += 1;
    const am = ageMin(join(ROOT, c.path || ""));
    const max = c.maxMin ?? 9999;
    if (am == null) { out.missing.push({ name: a.name, path: c.path }); continue; }
    if (am > max) out.drift.push({ name: a.name, ageMin: +am.toFixed(0), maxMin: max }); // 排程活著但產物殭屍
  }
  out.driftCount = out.drift.length;
  out.missingCount = out.missing.length;
  try { mkdirSync(dirname(REPORT), { recursive: true }); const tmp = REPORT + ".tmp"; writeFileSync(tmp, JSON.stringify(out, null, 2)); renameSync(tmp, REPORT); } catch {}
  console.log(JSON.stringify({ checked: out.checked, drift: out.driftCount, missing: out.missingCount }));
}
main();
