#!/usr/bin/env node
// B：私有信任節點聯邦(進化自 Hyperspace 架構,無加密/無公開P2P/無自我替換)。
// 3層路由(學自其 local→DHT→gossip)：tier1 本機 → tier2 信任聯邦 → tier3 廣播詢問。能量ROI選點。
import fs from "node:fs"; import path from "node:path";
import { localEnergyBody } from "./lightchain-energy.mjs";
const CFG = path.resolve("config/federation-peers.json");
const STATS = path.resolve(".openclaw/memory/federation-stats.json");
function loadStats(){ try{return JSON.parse(fs.readFileSync(STATS,"utf8"));}catch{return {};} }
function saveStats(s){ try{fs.mkdirSync(path.dirname(STATS),{recursive:true});const t=STATS+".tmp";fs.writeFileSync(t,JSON.stringify(s,null,2));fs.renameSync(t,STATS);}catch{} }
// 記錄一次呼叫結果:EWMA 平滑成功率與延遲(α=0.3)。B 越用越懂哪個節點可靠→自我進化。
export function recordOutcome(name,{ok,latencyMs=200,alpha=0.3}={}){
  const s=loadStats(); const r=s[name]||{calls:0,successRate:0.9,ewmaLatency:200};
  r.calls++; r.successRate=+( (1-alpha)*r.successRate + alpha*(ok?1:0) ).toFixed(3);
  r.ewmaLatency=Math.round((1-alpha)*r.ewmaLatency + alpha*latencyMs); r.lastSeen=new Date().toISOString();
  s[name]=r; saveStats(s); return r;
}
export { loadStats as federationStats };
function readJson(p,d){try{return JSON.parse(fs.readFileSync(p,"utf8"));}catch{return d;}}
async function reachable(baseURL){ try{const r=await fetch(baseURL+"/v1/models",{signal:AbortSignal.timeout(1500)});return r.ok;}catch{return false;} }
// 感知聯邦：self + peers，標健康(本機免測,假設在)
export async function senseFederation({probe=true}={}){
  const c=readJson(CFG,{self:{},peers:[]});
  // 合併動態發現的節點(別人電腦的算力),快取 10 分內有效
  let discovered=[]; try{ const dc=readJson(path.resolve(".openclaw/memory/discovered-peers.json"),null); if(dc && (Date.now()-Date.parse(dc.ts))<600000) discovered=dc.peers||[]; }catch{}
  const seen=new Set([c.self?.baseURL, ...(c.peers||[]).map(p=>p.baseURL)]);
  const nodes=[{...c.self,health:true}, ...((c.peers||[]).map(p=>({...p}))), ...discovered.filter(d=>!seen.has(d.baseURL))];
  if(probe) for(const n of nodes.slice(1)) n.health=await reachable(n.baseURL);
  return nodes;
}
// 節點評分(學自 Hyperspace P2P-1-Score):用硬體/歷史特徵預測吞吐×成功率,分數越高越優先
export function scoreNode(n,stats=null){
  const st=(stats||{})[n.name]||{};
  const tierW={local:1.0,realnet:0.9,remote:0.8}[n.tier]??0.7;
  const vram=Number(n.vramGb??n.vram??8);
  const gpu=n.gpu||n.gpuName?1.0:0.5;
  const success=Number(st.successRate ?? n.successRate ?? 0.9);   // 真實歷史優先,無則先驗0.9
  const latency=Number(st.ewmaLatency ?? n.latencyMs ?? 200);
  const latencyPenalty=Math.min(0.5,latency/2000);
  return +((tierW*0.3 + Math.min(1,vram/16)*0.3 + gpu*0.2 + success*0.2) - latencyPenalty).toFixed(3);
}
// 3層路由：依能力挑節點。tier1 本機優先(能量夠)；本機點不亮/能量緊→tier2 健康聯邦；無→tier3 廣播(回傳候選讓上層詢問)
export async function route3tier(capability, { nodes=null, energy=null }={}){
  nodes = nodes || await senseFederation();
  const e = energy || localEnergyBody();
  const has = n => (n.caps||[]).includes(capability) && n.health!==false;
  const local = nodes.find(n=>n.tier==="local" && has(n));
  // tier1：本機有能力且能量充裕→本機
  if(local && e.level==="safe") return { tier:1, route:"local", node:local.name, baseURL:local.baseURL, reason:"local_energy_safe" };
  // tier2：能量緊或本機無→挑健康的信任聯邦節點(就近/低延遲優先)
  const st=loadStats(); const epsilon=Number(process.env.LC_EPSILON ?? 0.1);
  const peers = nodes.filter(n=>n.tier!=="local" && has(n)).map(n=>({n,score:scoreNode(n,st)})).sort((a,b)=>b.score-a.score);
  if(peers.length){
    // epsilon-greedy:小機率探索非最佳(發現被低估的好節點),否則選最高分(利用)
    const pick = (peers.length>1 && Math.random()<epsilon) ? peers[1+Math.floor(Math.random()*(peers.length-1))] : peers[0];
    const explored = pick!==peers[0];
    return { tier:2, route:"federation", node:pick.n.name, baseURL:pick.n.baseURL, score:pick.score, explored, reason: local?"energy_tight_offload_best_node":"local_cannot_serve_best_node" };
  }
  // tier1 退路：本機有能力(即使能量緊)→本機降級
  if(local) return { tier:1, route:"local-degraded", node:local.name, baseURL:local.baseURL, reason:"no_peer_local_fallback" };
  // tier3：廣播詢問(回傳全候選；無人有此能力→gap)
  const candidates = nodes.filter(n=>n.health!==false).map(n=>n.name);
  return candidates.length ? { tier:3, route:"broadcast", candidates, reason:"ask_all_no_direct_cap" }
                           : { tier:3, route:"gap", reason:"no_capable_node" };
}
if(process.argv[1] && import.meta.url===new URL(`file://${process.argv[1]}`).href){
  const cap=process.argv[2]||"inference";
  senseFederation().then(async n=>{ console.log("聯邦節點:",JSON.stringify(n)); console.log("路由["+cap+"]:",JSON.stringify(await route3tier(cap,{nodes:n}))); });
}
