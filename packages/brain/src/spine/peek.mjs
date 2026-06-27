// lib/spine/peek.mjs — 結構感知檔案速覽（採 jcode「agent grep」理念:回結構不回整檔，省 context/token）。
// 給「只需知道檔裡有什麼」的場景:回 匯出/函式/類別/常數/標題 + 行號，而非整檔內容。stdlib regex，零依賴(Ponytail最小可行)。
import { readFileSync, statSync } from "node:fs";
const nul = (b) => { const i = b.indexOf(0); return i > 0 ? b.subarray(0, i) : b; };

/** 回傳檔案結構速覽 {file, lines, bytes, structure[], peekChars, fullChars, savedPercent}。 */
export function peek(path) {
  let txt = ""; try { txt = nul(readFileSync(path)).toString("utf8"); } catch { return { error: "讀取失敗" }; }
  const lines = txt.split("\n");
  const ext = (path.match(/\.(\w+)$/) || [, ""])[1].toLowerCase();
  const out = [];
  const md = ext === "md";
  for (let i = 0; i < lines.length; i++) {
    const l = lines[i]; let m;
    if (md) { if (/^#{1,4}\s/.test(l)) out.push(`${i + 1}: ${l.trim().slice(0, 80)}`); continue; }
    // 程式碼:匯出/函式/類別/頂層常數/箭頭函式
    if ((m = l.match(/^\s*(export\s+)?(async\s+)?function\s+(\w+)/))) out.push(`${i + 1}: function ${m[3]}`);
    else if ((m = l.match(/^\s*(export\s+)?class\s+(\w+)/))) out.push(`${i + 1}: class ${m[2]}`);
    else if ((m = l.match(/^\s*export\s+(const|let|var)\s+(\w+)/))) out.push(`${i + 1}: export ${m[2]}`);
    else if ((m = l.match(/^(const|let)\s+(\w+)\s*=\s*(async\s*)?\(.*=>/))) out.push(`${i + 1}: fn ${m[2]}`);
    else if (/^\s*\/\/\s?(==|##|──)/.test(l)) out.push(`${i + 1}: ${l.trim().slice(0, 60)}`); // 區段註解
  }
  const peekStr = out.join("\n");
  const fullChars = txt.length, peekChars = peekStr.length;
  return { file: path.split(/[\\/]/).pop(), lines: lines.length, structure: out, peekChars, fullChars, savedPercent: fullChars ? Math.round((1 - peekChars / fullChars) * 100) : 0 };
}

// CLI：任何 agent/surface 探索程式時用 `node scripts/lib/spine/peek.mjs <file>` 取代讀整檔（省 97-99% context）。
import { fileURLToPath } from "node:url";
if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1].replace(/\//g, "\\")) {
  const p = peek(process.argv[2] || "");
  if (p.error) { console.log(p.error); process.exit(1); }
  console.log(`# ${p.file}（${p.lines}行；速覽省 ${p.savedPercent}% context）\n${p.structure.join("\n")}`);
}

