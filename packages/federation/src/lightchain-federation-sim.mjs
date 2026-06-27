// 3層路由模擬：注入節點集+能量級別，驗證 tier1本機→tier2聯邦→tier3廣播 正確回退、永不崩。
import { route3tier } from "./lightchain-federation.mjs";
const E=l=>({level:l});
const local=t=>({name:"local",tier:"local",caps:["inference","embedding"],health:true});
const NODES={
  獨機:        [local()],
  獨機加聯邦:  [local(), {name:"peerA",tier:"remote",caps:["inference","fundamental"],health:true}, {name:"peerB",tier:"remote",caps:["inference"],health:true}],
  聯邦但全掛:  [local(), {name:"peerA",tier:"remote",caps:["inference"],health:false}],
};
const cases=[
 ["本機+能量safe+inference", "inference", "獨機加聯邦", "safe"],
 ["本機+能量緊+inference→聯邦","inference","獨機加聯邦","warn"],
 ["本機沒此能力→聯邦",        "fundamental","獨機加聯邦","safe"],
 ["本機沒+聯邦也沒→廣播/缺口","coding","獨機加聯邦","safe"],
 ["緊+只有本機→本機降級",     "inference","獨機","warn"],
 ["緊+聯邦全掛→本機降級",     "inference","聯邦但全掛","warn"],
];
for(const [name,cap,nset,lvl] of cases){
  const r=await route3tier(cap,{nodes:NODES[nset],energy:E(lvl)});
  console.log(name.padEnd(26)+" → tier"+r.tier+" "+String(r.route).padEnd(15)+(r.node?("node="+r.node):(r.candidates?("候選="+r.candidates):""))+"  ("+r.reason+")");
}
