#!/usr/bin/env node
// openclaw-agent-drift-check.mjs — 登記制點名（秒級，取代手動盤點）
// 比對 agent-registry.json 宣告 vs 實際狀態；並掃出「在跑卻沒登記」的漂移者
import { readFileSync, existsSync, statSync, readdirSync } from "node:fs";
import { dirname, join, resolve, isAbsolute } from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync as _origSpawnSync} from "node:child_process";
/* zero-flash-patched */ // 永久零閃窗（依 no-break-guardrails 零閃窗鐵則）
const spawnSync = (cmd, args = [], opts = {}) => _origSpawnSync(cmd, args, { windowsHide: true, ...opts });

export const ROOT = process.env.OPENCLAW_ROOT || resolve(dirname(fileURLToPath(import.meta.url)), "..");
const PORT_HTTP_OK = 0;
const PORT_HTTP_BAD_STATUS = 10;
const PORT_HTTP_TIMEOUT = 20;
const PORT_HTTP_ERROR = 30;

export const mins = (p, root = ROOT) => {
  try {
    // 絕對路徑直接用（跨 junction 防遷移）；相對路徑才 join(root)——修 junction 下 ../ 解析錯誤誤判死亡
    const fp = isAbsolute(p) ? p : join(root, p);
    return existsSync(fp)
      ? Math.round((Date.now() - statSync(fp).mtimeMs) / 60000)
      : Infinity;
  } catch {
    return Infinity;
  }
};

export const ps = (pat, runner = spawnSync) => {
  try {
    return Number(
      (
        runner(
          "powershell",
          [
            "-NoProfile",
            "-Command",
            `@(Get-CimInstance Win32_Process | Where-Object { $_.CommandLine -match '${pat}' }).Count`,
          ],
          { encoding: "utf8", timeout: 12000 },
        ).stdout ?? "0"
      ).trim(),
    );
  } catch {
    return -1;
  }
};

export const portListenerUp = (url, runner = spawnSync) => {
  try {
    const parsed = new URL(url);
    const port = Number(parsed.port || (parsed.protocol === "https:" ? 443 : 80));
    const result = runner(
      "powershell",
      [
        "-NoProfile",
        "-Command",
        `@(Get-NetTCPConnection -LocalPort ${port} -State Listen -ErrorAction SilentlyContinue).Count`,
      ],
      { encoding: "utf8", timeout: 12000 },
    );
    return Number((result.stdout ?? "0").trim()) > 0;
  } catch {
    return false;
  }
};

// status<500 即視為活（404=服務在聽只是無該路由；connection refused 才是死）——與哨兵語義一致，2026-06-05
// 若 health timeout 但 listener 仍存在，視為活但可能退化，避免把慢回應誤判成 dead。
export const portUp = (url, runner = spawnSync) => {
  const result = runner(
    process.execPath,
    [
      "-e",
      `
      fetch(${JSON.stringify(url)}, { signal: AbortSignal.timeout(4000) })
        .then((response) => process.exit(response.status < 500 ? ${PORT_HTTP_OK} : ${PORT_HTTP_BAD_STATUS}))
        .catch((error) => {
          const isTimeout = error?.name === "TimeoutError" || error?.name === "AbortError";
          console.error(isTimeout ? "FETCH_TIMEOUT" : "FETCH_ERROR");
          process.exit(isTimeout ? ${PORT_HTTP_TIMEOUT} : ${PORT_HTTP_ERROR});
        });
      `,
    ],
    { encoding: "utf8", timeout: 8000 },
  );

  if (result.status === PORT_HTTP_OK) {
    return true;
  }
  if (result.status === PORT_HTTP_TIMEOUT) {
    return portListenerUp(url, runner);
  }
  return false;
};

export function runDriftCheck(root = ROOT, runner = spawnSync) {
  const reg = JSON.parse(readFileSync(join(root, "config", "agent-registry.json"), "utf8"));
  const alive = [];
  const dead = [];
  const disabled = []; // 人為停用（disableFlag 存在）：可見但不當死亡告警

  for (const a of reg.agents) {
    if (a.disableFlag && existsSync(join(root, a.disableFlag))) { disabled.push(a.name); continue; }
    const c = a.check;
    let ok = false;
    if (c.type === "ps") ok = ps(c.pattern, runner) > 0;
    else if (c.type === "heartbeat" || c.type === "report") ok = mins(c.path, root) <= c.maxMin;
    else if (c.type === "port") ok = portUp(c.url, runner);
    else if (c.type === "files") {
      try {
        ok =
          readdirSync(join(root, c.glob.replace(/\/[^/]+$/, ""))).filter((f) =>
            /^factory-.*\.md$/.test(f),
          ).length >= c.expect;
      } catch {
        ok = false;
      }
    } else if (c.type === "script") {
      const result = runner("cmd", ["/c", c.cmd], { cwd: root, timeout: 60000 });
      ok = result.status === 0;
    } else ok = true; // ssot/data 類人工維護
    (ok ? alive : dead).push(a.name);
  }

  return {
    ts: new Date().toISOString(),
    registered: reg.agents.length,
    alive: alive.length,
    dead,
    disabled,
    retired: reg.retired.map((r) => r.name),
  };
}

if (import.meta.main) {
  const result = runDriftCheck(process.env.OPENCLAW_ROOT || ROOT);
  console.log(JSON.stringify(result, null, 2));
  process.exit(result.dead.length === 0 ? 0 : 1);
}
