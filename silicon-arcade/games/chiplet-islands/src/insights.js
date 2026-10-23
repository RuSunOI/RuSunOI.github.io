import {netCharge} from './model.js';
/** 关联只保留原始超边；排序量是首次切开一条总线的费用，不是两两带宽。 */
export function coupling(level,moduleIds,gear={}){
 const seeds=new Set(moduleIds),two=level.islands.slice(0,2).map(i=>i.id);
 const incident=level.nets.filter(n=>n.members.some(id=>seeds.has(id))).map(n=>({net:n,firstCut:netCharge(n,two,gear).cost}));
 const strongest=Math.max(0,...incident.map(x=>x.firstCut));
 const strong=incident.filter(x=>x.firstCut===strongest);
 return {incident:incident.map(x=>x.net.id),strong:strong.map(x=>x.net.id),members:[...new Set(strong.flatMap(x=>x.net.members))],firstCut:strongest};
}
export function constraintSummary(level,result){
 const issues=[];
 for(const i of level.islands){const l=result.loads[i.id];if(!l)continue;for(const k of ['ports','area','power'])if(l[k]>l.capacity[k])issues.push({kind:k,island:i.id,excess:l[k]-l.capacity[k],current:l[k],limit:l.capacity[k],text:i.name+({ports:'港口',area:'面积',power:'功耗'}[k])+'超出 '+(l[k]-l.capacity[k])+'（'+l[k]+' / '+l.capacity[k]+'）'});}
 for(const [key,label,limitKey] of [['cut','通信费用','cut'],['moves','最终迁移数','moves'],['migration','迁移材料','migration']])if(result[key]>level.limits[limitKey])issues.push({kind:key,excess:result[key]-level.limits[limitKey],current:result[key],limit:level.limits[limitKey],text:label+'超出 '+(result[key]-level.limits[limitKey])+'（'+result[key]+' / '+level.limits[limitKey]+'）'});
 const contributing=result.netCosts.filter(n=>n.cost>0).sort((a,b)=>b.cost-a.cost||a.id.localeCompare(b.id));
 const overloaded=new Set(issues.filter(x=>x.kind==='ports').map(x=>x.island));
 const portNets=result.netCosts.filter(n=>n.crossings&&n.islands.some(i=>overloaded.has(i))).map(n=>n.id);
 return {issues,contributing,portNets};
}
