// lib/spine/spine.mjs — 智能脊椎讀取器（P2）
// 讀能力宣告 manifest，路徑全經 resolve 解析（零寫死）。提供 list/get/discover/health/entryPath。
import { readFileSync, existsSync, statSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { dirname } from "node:path";
import { resolve, resolveSafe } from "./resolve.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));
const DEFAULT_MANIFEST = join(HERE, "..", "..", "..", "config", "spine", "capabilities.manifest.json");
const nulSafe = (b) => { const i = b.indexOf(0); return i > 0 ? b.subarray(0, i) : b; };

let _cache = null;
function load(manifestPath = DEFAULT_MANIFEST) {
  if (_cache && _cache.__path === manifestPath) return _cache;
  const j = JSON.parse(nulSafe(readFileSync(manifestPath)).toString("utf8"));
  const caps = Array.isArray(j.capabilities) ? j.capabilities : [];
  Object.defineProperty(caps, "__path", { value: manifestPath, enumerable: false });
  _cache = caps;
  return caps;
}

/** 把宣告的 {base(邏輯名), file} 解析成絕對路徑（脊椎核心：路徑來自 path-map，不寫死）。 */
function refToPath(ref) {
  if (!ref || !ref.base) return { ok: false, reason: "宣告缺 base 邏輯名" };
  const r = resolveSafe(ref.base);
  if (!r.ok) return r;
  return { ok: true, path: ref.file ? join(r.path, ref.file) : r.path };
}

export function list({ manifestPath } = {}) { return load(manifestPath).map((c) => c.name); }
export function get(name, { manifestPath } = {}) { return load(manifestPath).find((c) => c.name === name) || null; }
export function entryPath(name, opts) { const c = get(name, opts); return c ? refToPath(c.entry) : { ok: false, reason: "無此能力" }; }

/** 健康狀態：依宣告的 health（report 新鮮度）對齊實際。單能力容錯。 */
export function health({ manifestPath } = {}) {
  const out = [];
  for (const c of load(manifestPath)) {
    let status = "unknown", detail = "";
    try {
      if (c.health && c.health.type === "report") {
        const r = refToPath({ base: c.health.base, file: c.health.file });
        if (!r.ok) { status = "ref-broken"; detail = r.reason; }
        else if (!existsSync(r.path)) { status = "missing"; detail = r.path; }
        else { const ageMin = (Date.now() - statSync(r.path).mtimeMs) / 60000; status = ageMin <= (c.health.maxMin || 60) ? "alive" : "stale"; detail = ageMin.toFixed(0) + "min"; }
      } else status = "no-healthcheck";
    } catch (e) { status = "error"; detail = String(e.message).slice(0, 50); }
    const ep = entryPath(c.name, { manifestPath });
    out.push({ name: c.name, kind: c.kind, status, detail, entryOk: ep.ok, entry: ep.path || ep.reason });
  }
  return out;
}

/** 依能力種類/依賴探索（脊椎自省）。 */
export function discover({ kind, dep } = {}, opts) {
  return load(opts && opts.manifestPath).filter((c) =>
    (!kind || c.kind === kind) && (!dep || (c.deps || []).includes(dep))).map((c) => c.name);
}

export function clearCache() { _cache = null; }
