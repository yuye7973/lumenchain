import { spawnSync as _origSpawnSync } from "node:child_process";
/* zero-flash-exec-patched */ // 永久零閃窗（依 no-break-guardrails 零閃窗鐵則）
const spawnSync = (cmd, args, opts) => {
  if (args && !Array.isArray(args)) { opts = args; args = undefined; }
  return _origSpawnSync(cmd, args ?? [], { windowsHide: true, ...(opts ?? {}) });
};
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const entry = path.join(here, "a2a-server.ts");

const result = spawnSync(process.execPath, ["--import", "tsx", entry, ...process.argv.slice(2)], {
  stdio: "inherit",
  env: process.env,
});

if (result.error) {
  throw result.error;
}

process.exit(result.status ?? 1);
