// lib/spine/resolve.mjs — 智能脊椎路徑解析器（P1 地基）
// 鐵則：所有路徑經此取得，禁寫死。找不到→明確錯誤；可選驗實際存在。NUL 容錯、單一事實來源。
import { readFileSync, existsSync } from "node:fs";

// path-map 位置本身也不寫死層級：相對本檔回推 config/spine/path-map.json
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
const HERE = dirname(fileURLToPath(import.meta.url));
const DEFAULT_MAP = join(HERE, "..", "..", "..", "config", "spine", "path-map.json"); // scripts/lib/spine → repo root

const nulSafe = (b) => { const i = b.indexOf(0); return i > 0 ? b.subarray(0, i) : b; };

let _cache = null;
function loadMap(mapPath = DEFAULT_MAP) {
  if (_cache && _cache.__path === mapPath) return _cache;
  const raw = nulSafe(readFileSync(mapPath)).toString("utf8");
  const j = JSON.parse(raw);
  const paths = j.paths || {};
  Object.defineProperty(paths, "__path", { value: mapPath, enumerable: false });
  _cache = paths;
  return paths;
}

/** 解析邏輯名→絕對路徑。找不到拋明確錯（呼叫端該知道名字打錯）。 */
export function resolve(name, { mapPath } = {}) {
  const paths = loadMap(mapPath);
  const p = paths[name];
  if (typeof p !== "string") {
    throw new Error(`[spine.resolve] 未知邏輯名「${name}」。可用：${Object.keys(paths).join(", ")}`);
  }
  return p;
}

/** 軟解析：回 {ok, path, reason}，不拋——給容錯流程用（找不到優雅降級）。 */
export function resolveSafe(name, opts) {
  try { return { ok: true, path: resolve(name, opts) }; }
  catch (e) { return { ok: false, path: null, reason: String(e.message) }; }
}

/** 解析且驗實際存在：找不到名字或路徑不存在都回 {ok:false,reason}。 */
export function resolveExisting(name, opts) {
  const r = resolveSafe(name, opts);
  if (!r.ok) return r;
  if (!existsSync(r.path)) return { ok: false, path: r.path, reason: `路徑不存在（可能未掛載/未補junction）：${r.path}` };
  return r;
}

/** 列出所有邏輯名（脊椎自省用）。 */
export function listNames({ mapPath } = {}) { return Object.keys(loadMap(mapPath)); }

export function clearCache() { _cache = null; }
