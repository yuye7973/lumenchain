#!/usr/bin/env node
// 能量律：先知自身能量→量能量載體(宇宙=host RAM/VRAM/CPU)→最小能量做最大事→才聚合光點、生光鏈。
// 載體感知接既有 resource-governor(不重造)；核心=ROI 背包排程(value/cost 比貪婪≈最佳解)，永不超載。
import fs from "node:fs";
import path from "node:path";
const GOV = path.resolve("reports/hermes-agent/state/openclaw-resource-governor-latest.json");
const CAT = path.resolve("config/model-orchestrator-catalog.json");
function readJson(p,d){try{return JSON.parse(fs.readFileSync(p,"utf8"));}catch{return d;}}
// 量能量載體(宇宙)：RAM/VRAM/CPU 總量+餘量+governor 級別與硬閘
export function senseCarrier(){
  const g=readJson(GOV,null); const cat=readJson(CAT,{gpu:{}});
  // governor 鍵名：ram.freeGB/totalGB、gpu.totalMiB/usedMiB（MiB）
  const vramTotal = g?.gpu?.totalMiB ? +(g.gpu.totalMiB/1024).toFixed(2) : (cat.gpu?.totalVramGb ?? 0);
  const vramFree  = g?.gpu?.totalMiB ? +((g.gpu.totalMiB-(g.gpu.usedMiB??0))/1024).toFixed(2) : (cat.gpu?.availableForLlmGb ?? 0);
  return {
    level: g?.level ?? "unknown",
    ramTotalGb: g?.ram?.totalGB ?? 0, ramFreeGb: g?.ram?.freeGB ?? 0,
    vramTotalGb: vramTotal, vramFreeGb: vramFree,
    cpuFreePct: 100-(g?.cpu?.loadPct ?? 0),
    gates: { canOpenChain: g?.canOpenChain!==false, canStartResident: g?.canStartResident!==false, canStartHeavy: g?.canStartHeavy!==false },
    shouldShed: g?.shouldShed===true,
  };
}
// 純函數能量評估(可測)：給 governor 物件+catalog → 完整本地能量體自評
export function assessEnergy(g, cat={gpu:{},policy:{}}, {maxStaleMin=5}={}){
  const pol=cat.policy||{}; const ramReserve=pol.minFreeRamGb??6, vramReserve=pol.minFreeVramGb??2;
  const ramTotal=g?.ram?.totalGB??0, ramFree=g?.ram?.freeGB??0;
  const vramTotal=g?.gpu?.totalMiB?+(g.gpu.totalMiB/1024).toFixed(2):(cat.gpu?.totalVramGb??0);
  const vramFree =g?.gpu?.totalMiB?+((g.gpu.totalMiB-(g.gpu.usedMiB??0))/1024).toFixed(2):(cat.gpu?.availableForLlmGb??0);
  const cpuFreePct=100-(g?.cpu?.loadPct??0);
  const ts=g?.ts?Date.parse(g.ts):NaN;
  const ageMin=Number.isFinite(ts)?+((Date.now()-ts)/60000).toFixed(1):Infinity;
  const fresh=ageMin<=maxStaleMin;
  const confidence=!g?0.2:(fresh?0.95:Math.max(0.3,+(0.95-(ageMin-maxStaleMin)*0.05).toFixed(2)));
  const usableRam=+Math.max(0,ramFree-ramReserve).toFixed(2);
  const usableVram=+Math.max(0,vramFree-vramReserve).toFixed(2);
  const dims=[{k:"ram",ratio:ramTotal?usableRam/ramTotal:0},{k:"vram",ratio:vramTotal?usableVram/vramTotal:0},{k:"cpu",ratio:cpuFreePct/100}];
  const bottleneck=dims.reduce((m,d)=>d.ratio<m.ratio?d:m,dims[0]);
  const score=+Math.max(0,Math.min(1,bottleneck.ratio)).toFixed(2);
  const level=(g&&g.level&&g.level!=="unknown")?g.level:(score>0.4?"safe":score>0.15?"warn":"critical");
  const shed=g?.shouldShed===true;
  const share=fresh?0.7:0.4;                                   // 資料舊→保守取量
  const hardCapGb=+Math.min(usableRam,usableVram).toFixed(2);  // 瓶頸 GB 硬上限(已扣保留)
  const budgetGb=+(hardCapGb*share).toFixed(2);
  return { score, level, confidence, fresh, ageMin, bottleneck:bottleneck.k,
    headroom:{ramGb:usableRam,vramGb:usableVram,cpuPct:cpuFreePct}, reserves:{ramGb:ramReserve,vramGb:vramReserve},
    budgetGb, hardCapGb,
    allows:{ openChain:(g?.canOpenChain!==false)&&!shed&&level!=="critical"&&(fresh||confidence>=0.4),
             wakeHeavy:(g?.canStartHeavy!==false)&&level==="safe"&&fresh,        // 重動作須新鮮資料,不信過期safe
             wakeResident:(g?.canStartResident!==false)&&level!=="critical",
             aggregate:!shed&&score>0.1 },
    source:g?(fresh?"governor-fresh":"governor-stale"):"fallback-catalog" };
}
// 本地能量體：讀檔→assessEnergy
export function localEnergyBody(opts={}){ return assessEnergy(readJson(GOV,null), readJson(CAT,{gpu:{},policy:{}}), opts); }
// 自身能量：本任務可動用預算(預設=載體餘量×share，留安全餘裕)。最小能量原則→預設只取部分。
export function selfEnergy({hardCapGb=Infinity}={}){ return Math.min(hardCapGb, localEnergyBody().budgetGb); }
// 最小能量做最大事：ROI 背包(按 value/costGb 比貪婪)。回傳選中動作+總值+總耗+效率。永不超 budget。
export function planMinEnergyMaxWork(actions, budgetGb){
  const ranked=[...actions].map(a=>({...a, roi:a.value/Math.max(1e-9,a.costGb)})).sort((x,y)=>y.roi-x.roi);
  const chosen=[]; let used=0, value=0;
  for(const a of ranked){ if(used+a.costGb<=budgetGb){chosen.push(a.id); used+=a.costGb; value+=a.value;} }
  return { chosen, totalValue:+value.toFixed(2), totalCostGb:+used.toFixed(2), budgetGb,
    efficiency:+(value/Math.max(1e-9,used)).toFixed(2), overflow: used>budgetGb };
}
// 聚合/生鏈/喚醒前的能量閘：硬閘(governor)+預算雙重把關
export function energyGate(kind, carrier=senseCarrier()){
  if(carrier.shouldShed) return {ok:false,reason:"shed_mode"};
  if(kind==="open-chain" && !carrier.gates.canOpenChain) return {ok:false,reason:"gov_no_open_chain"};
  if(kind==="wake-heavy" && !carrier.gates.canStartHeavy) return {ok:false,reason:"gov_no_heavy"};
  if(kind==="wake-resident" && !carrier.gates.canStartResident) return {ok:false,reason:"gov_no_resident"};
  return {ok:true};
}
if(process.argv[1] && import.meta.url===new URL(`file://${process.argv[1]}`).href){
  const c=senseCarrier(); console.log("載體(宇宙):",JSON.stringify(c)); console.log("自身能量預算Gb:",selfEnergy({carrier:c}));
}
