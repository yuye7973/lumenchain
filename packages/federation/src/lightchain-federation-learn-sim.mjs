import { scoreNode, recordOutcome, federationStats } from "./lightchain-federation.mjs";
// 4 節點,真實成功率差異大;flaky 硬體好但常失敗。看 B 用經驗收斂到真最佳、避真最差。
const nodes=[
 {name:"flaky", tier:"remote",vramGb:16,gpu:"x",caps:["x"],health:true,latencyMs:90},
 {name:"strong",tier:"remote",vramGb:16,gpu:"x",caps:["x"],health:true,latencyMs:120},
 {name:"ok",    tier:"remote",vramGb:8, caps:["x"],health:true,latencyMs:180},
 {name:"weak",  tier:"remote",vramGb:4, caps:["x"],health:true,latencyMs:300},
];
const trueRate={flaky:0.35,strong:0.96,ok:0.85,weak:0.75};
let seed=3; const rnd=()=>{seed=(seed*1103515245+12345)&0x7fffffff;return seed/0x7fffffff;};
const EPS=0.15; const picks=[];
for(let i=0;i<120;i++){
  const st=federationStats();
  const ranked=[...nodes].map(n=>({n,s:scoreNode(n,st)})).sort((a,b)=>b.s-a.s);
  // epsilon-greedy 探索,讓每個節點都有被試到的機會→學到真實能力
  const pick=(rnd()<EPS)?ranked[1+Math.floor(rnd()*(ranked.length-1))].n:ranked[0].n;
  picks.push(pick.name);
  recordOutcome(pick.name,{ok:rnd()<trueRate[pick.name],latencyMs:nodes.find(x=>x.name===pick.name).latencyMs,alpha:0.15});
}
const cnt=a=>a.reduce((m,x)=>(m[x]=(m[x]||0)+1,m),{});
console.log("前20輪:",JSON.stringify(cnt(picks.slice(0,20))));
console.log("後40輪:",JSON.stringify(cnt(picks.slice(-40))));
const st=federationStats();
console.log("學到成功率:",Object.fromEntries(Object.entries(st).map(([k,v])=>[k,v.successRate.toFixed(2)])));
const late=cnt(picks.slice(-40)); const strongShare=(late.strong||0)/40, flakyShare=(late.flaky||0)/40;
console.log((strongShare>=0.6 && flakyShare<=0.1)?"PASS:B 收斂到真最佳 strong("+(strongShare*100).toFixed(0)+"%)、避開真最差 flaky("+(flakyShare*100).toFixed(0)+"%)":"strong"+(strongShare*100).toFixed(0)+"% flaky"+(flakyShare*100).toFixed(0)+"%");
