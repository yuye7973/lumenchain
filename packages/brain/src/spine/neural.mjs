// lib/spine/neural.mjs — 智能脊椎神經四能力（P5＋共創升級）：優化/創造/修改/自癒
// 創造原則（2026-06-16 使用者拍板）：創造了就要①記得(寫共同記憶)②派給所有智能體共創(不獨佔)③留共創帳本。
import { readFileSync, writeFileSync, renameSync, existsSync, mkdirSync, appendFileSync } from "node:fs";
import { join } from "node:path";
import { resolve, resolveSafe } from "./resolve.mjs";
import { get, health } from "./spine.mjs";

const nulSafe = (b) => { const i = b.indexOf(0); return i > 0 ? b.subarray(0, i) : b; };
const rd = (p) => JSON.parse(nulSafe(readFileSync(p)).toString("utf8"));
const atomic = (p, o) => { mkdirSync(join(p, ".."), { recursive: true }); writeFileSync(p + ".tmp", JSON.stringify(o, null, 2) + "\n", "utf8"); renameSync(p + ".tmp", p); };
const stamp = () => new Date().toISOString().replace(/[-:T]/g, "").slice(0, 12);

/** 優化 optimize：讀模型遙測分析報告→建議。 */
export function optimize() {
  const r = resolveSafe("openclaw-reports");
  if (!r.ok) return { ok: false, reason: r.reason };
  const f = join(r.path, "model-telemetry-analysis-latest.json");
  if (!existsSync(f)) return { ok: true, suggestions: [], note: "尚無遙測分析報告" };
  try { const j = rd(f); return { ok: true, samples: j.samples, emergencyRatio: j.emergencyRatio, suggestions: j.suggestions || [] }; }
  catch (e) { return { ok: false, reason: String(e.message).slice(0, 60) }; }
}

/** 創造 create：共創管線——①工廠 intake ②記得(共同記憶) ③派給所有智能體(Codex工廠+共創帳本) ④不獨佔。 */
export function create({ slug, need, sources = ["codex", "hermes", "openhands", "crewai"] }) {
  if (!slug || !need) return { ok: false, reason: "需 slug 與 need" };
  const out = { slug, steps: [] };
  // ① 工廠 intake（Codex 主建造通道）
  try {
    const dir = join(resolve("openclaw-root"), ".planning", "factory", slug);
    mkdirSync(dir, { recursive: true });
    const intake = join(dir, "01-research.md");
    if (!existsSync(intake)) writeFileSync(intake, `# 01-research：${slug}（神經共創立項）\n\n## 需求\n${need}\n\n## 共創\n由智能脊椎 neural.create 立項，派給全艦隊(${sources.join("/")})共建，非單一AI獨佔。\n`, "utf8");
    out.steps.push("factory-intake");
  } catch (e) { out.steps.push("factory-fail:" + String(e.message).slice(0, 40)); }
  // ② 記得：寫共同記憶會話層（創造了就要記得）
  try {
    const mem = join(resolve("conversation-memory"), `spine_${stamp()}_共創立項_${slug}.md`);
    writeFileSync(mem, `# 共創立項：${slug}（${new Date().toISOString()}）\n\n## 需求\n${need}\n\n## 派給\n${sources.join("、")} 全艦隊共創。\n\n## 來源\n智能脊椎 neural.create——創造即記得、即共創。\n`, "utf8");
    out.steps.push("remembered");
  } catch (e) { out.steps.push("remember-fail:" + String(e.message).slice(0, 40)); }
  // ③ 共創帳本：留全艦隊可見的待共創清單 — 寫入前經驗證閘（防注入/投毒）
  try {
    const ledger = join(resolve("shared-memory"), "共創帳本.jsonl");
    const raw = String(need || "");
    const INJ = /ignore (all |any )?(previous|prior|above)|\b(override|bypass|disable)\b.{0,20}(guard|safety|oversight|rule)/i;
    if (INJ.test(raw) || raw.includes(String.fromCharCode(0))) {           // high risk → 拒寫(不靜默吞)
      out.steps.push("ledger-rejected:guard");
    } else {
      const entry = { ts: new Date().toISOString(), agentId: "neural.create", surface: "spine", slug, need: raw.slice(0, 200), sources, status: "open" };
      appendFileSync(ledger, JSON.stringify(entry) + "\n", "utf8");        // 簽章 + append-only 天生不互蓋
      out.steps.push("co-create-ledger");
    }
  } catch (e) { out.steps.push("ledger-fail:" + String(e.message).slice(0, 40)); }
  out.ok = out.steps.includes("factory-intake");
  return out;
}

/** 修改 modify：宣告式改 manifest。 */
export function modify(name, patch) {
  const MANIFEST = join(resolve("openclaw-config"), "spine", "capabilities.manifest.json");
  const man = rd(MANIFEST);
  const c = man.capabilities.find((x) => x.name === name);
  if (!c) return { ok: false, reason: `無此能力：${name}` };
  Object.assign(c, patch || {});
  man.updated = new Date().toISOString().slice(0, 10);
  atomic(MANIFEST, man);
  return { ok: true, modified: name, patch };
}

/** 自癒 self-heal：回報漂移＋是否接管。 */
export function selfHeal() {
  const flag = join(resolve("openclaw-state"), "flags", "spine-active.flag");
  const drift = health().filter((h) => h.status === "stale" || h.status === "missing");
  return { ok: true, active: existsSync(flag), driftCount: drift.length, drift: drift.map((d) => ({ name: d.name, status: d.status, reviveable: !!(get(d.name)?.lifecycle?.reviveable) })), note: existsSync(flag) ? "active：reconcile 接管復活" : "dry-run（建 spine-active.flag 才接管）" };
}

export const neural = { optimize, create, modify, selfHeal };
