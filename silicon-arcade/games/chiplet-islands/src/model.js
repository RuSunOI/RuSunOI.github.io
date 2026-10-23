/** 芯粒群岛的唯一正式判定器。数值是游戏单位，不代表工业签核。 */
export const equipment = [
  { id:'cooling', name:'潮汐冷却', cost:4, slots:1, unlockAt:9, description:'指定岛功耗容量 +3，面积容量 −2。把热模块搬到冷却岛。' },
  { id:'land', name:'浮台扩展', cost:4, slots:1, unlockAt:9, description:'指定岛面积容量 +3，功耗容量 −2。为低功耗大模块腾出位置。' },
  { id:'dense', name:'叠层缓存', cost:6, slots:1, unlockAt:17, description:'每个缓存模块面积 −1（最低 1），功耗 +1。' },
  { id:'cargo', name:'轻载渡轮', cost:5, slots:1, unlockAt:17, description:'每个迁移模块搬运费 −1（最低 1）；每条切开的总线费用 +1。' },
  { id:'trunk', name:'共享海缆', cost:8, slots:2, unlockAt:25, description:'至少三端点总线权重 −1（最低 1）；每个使用岛多占 1 港口。' },
  { id:'express', name:'关键快船', cost:7, slots:1, unlockAt:33, description:'关键总线的切开附加费 −2（最低 0）；每个迁移模块搬运费 +1。' },
];
export const tagNames = ['算力','缓存','接口','控制'];
const finite = n => typeof n === 'number' && Number.isFinite(n) && n >= 0;
const signed = n => typeof n === 'number' && Number.isFinite(n);
const safeId = id => typeof id==='string' && /^[a-zA-Z0-9_-]+$/.test(id) && !['__proto__','constructor','prototype'].includes(id);
const object = x => x !== null && typeof x === 'object' && !Array.isArray(x);
const own = (x,k) => Object.prototype.hasOwnProperty.call(x,k);
const sum = xs => xs.reduce((a,b) => a+b,0);

/** 界面卡片和正式判定共用的本岛有效负载，基础数值只用于对照。 */
export function effectiveModuleLoad(module,island,gear={}) {
  let area=module.area,power=module.power;
  const modifier=island.modifiers?.[module.tag];
  if(modifier){area=Math.max(1,area+(modifier.area||0));power=Math.max(0,power+(modifier.power||0));}
  if(gear.equipped?.includes('dense')&&module.tag==='缓存'){area=Math.max(1,area-1);power++;}
  return {area,power,adjusted:area!==module.area||power!==module.power};
}

/** 一条超边的正式计费；同岛成员不展开为两两连线。 */
export function netCharge(net,islandIds,gear={}) {
  const islands=[...new Set(islandIds)],crossings=Math.max(0,islands.length-1),equipped=gear.equipped||[];
  const weight=equipped.includes('trunk')&&net.members.length>=3?Math.max(1,net.weight-1):net.weight;
  const penalty=equipped.includes('express')?Math.max(0,(net.critical||0)-2):(net.critical||0);
  const base=weight*crossings,critical=crossings?penalty:0,tax=crossings&&equipped.includes('cargo')?1:0;
  return {islands,crossings,weight,base,critical,tax,cost:base+critical+tax,portUnits:equipped.includes('trunk')&&net.members.length>=3?2:1};
}

export function evaluate(level, assignment, gear={}) {
  const violations=[];
  const result={valid:false,passed:false,cut:0,moves:0,migration:0,loads:Object.create(null),netCosts:[],violations};
  const fail = message => violations.push(message);
  if(!object(level) || !Array.isArray(level.islands) || !level.islands.length || !Array.isArray(level.modules) || !level.modules.length || !Array.isArray(level.nets) || !object(level.initial) || !object(level.limits) || (level.contracts!==undefined&&!Array.isArray(level.contracts))) {
    fail('关卡数据不完整'); return result;
  }
  if(!object(assignment)) { fail('方案必须是模块到岛屿的完整映射'); return result; }
  const islands=new Map(), modules=new Map(), nets=new Set();
  for(const i of level.islands) {
    if(!object(i) || !safeId(i.id) || islands.has(i.id) || !finite(i.area) || !finite(i.power) || (i.ports!==undefined&&!finite(i.ports)) || (i.migrationTax!==undefined&&!finite(i.migrationTax)) || (i.accept!==undefined&&(!Array.isArray(i.accept)||!i.accept.length||Array.from(i.accept).some(t=>typeof t!=='string'))) || (i.modifiers!==undefined&&(!object(i.modifiers)||Object.values(i.modifiers).some(m=>!object(m)||(m.area!==undefined&&!signed(m.area))||(m.power!==undefined&&!signed(m.power)))))) { fail('岛屿定义无效或重复'); return result; }
    islands.set(i.id,i);
  }
  for(const m of level.modules) {
    if(!object(m) || !safeId(m.id) || modules.has(m.id) || !finite(m.area) || !finite(m.power) || (m.tag!==undefined&&typeof m.tag!=='string') || (m.bind!==undefined&&(typeof m.bind!=='string'||!m.bind)) || (m.fixed!==undefined&&typeof m.fixed!=='boolean'&&!islands.has(m.fixed)) || (m.migration!==undefined&&!finite(m.migration)) || (m.allowed!==undefined&&(!Array.isArray(m.allowed)||!m.allowed.length||Array.from(m.allowed).some(i=>!islands.has(i)))) || !own(level.initial,m.id) || !islands.has(level.initial[m.id])) { fail('模块定义或初始归属无效'); return result; }
    modules.set(m.id,m);
  }
  for(const n of level.nets) {
    if(!object(n)||!safeId(n.id)||nets.has(n.id)||!Array.isArray(n.members)||n.members.length<2||new Set(n.members).size!==n.members.length||Array.from(n.members).some(m=>!modules.has(m))||!finite(n.weight)||(n.critical!==undefined&&!finite(n.critical))) { fail('总线定义无效或重复'); return result; }
    nets.add(n.id);
  }
  for(const key of ['cut','moves','migration']) if(!finite(level.limits[key])) {fail('资源预算无效');return result;}
  if(!object(gear)|| (gear.equipped!==undefined&&!Array.isArray(gear.equipped))) {fail('装备配置无效');return result;}
  const equipped=Array.from(gear.equipped || []), ids=new Set(equipped), gearDefs=equipped.map(id=>equipment.find(e=>e.id===id));
  if(ids.size!==equipped.length||gearDefs.some(x=>!x)||sum(gearDefs.filter(Boolean).map(x=>x.slots))>2) {fail('装备重复、未知，或超过 2 个配置槽');return result;}
  const has=id=>ids.has(id);
  const target=gear.target || level.islands[0].id;
  if(!islands.has(target)) {fail('装备目标岛不存在');return result;}
  for(const i of level.islands) {
    const capacity={area:i.area,power:i.power,ports:i.ports??9999};
    if(i.id===target) {
      if(has('cooling')) {capacity.area-=2;capacity.power+=3;}
      if(has('land')) {capacity.area+=3;capacity.power-=2;}
    }
    if(capacity.area<0||capacity.power<0) fail(`${i.name}的装备配置使容量为负`);
    result.loads[i.id]={area:0,power:0,ports:0,capacity,moduleIds:[]};
  }
  for(const key of Object.keys(assignment)) if(!modules.has(key)) fail(`方案含未知模块 ${key}`);
  const bindings=new Map();
  for(const m of level.modules) {
    const destination=assignment[m.id], i=islands.get(destination);
    if(!own(assignment,m.id)||!i) { fail(`${m.name}没有有效归属岛`);continue; }
    const moved=destination!==level.initial[m.id];
    if(moved) {
      result.moves++;
      let cost=m.migration??m.area;
      if(has('cargo')) cost=Math.max(1,cost-1);
      if(has('express')) cost++;
      result.migration+=cost+(i.migrationTax||0);
    }
    if(m.fixed && destination!==(typeof m.fixed==='string'?m.fixed:level.initial[m.id])) fail(`${m.name}为固定模块`);
    if(m.allowed&&!m.allowed.includes(destination)) fail(`${m.name}不能驻留${i.name}`);
    if(i.accept&&!i.accept.includes(m.tag)) fail(`${i.name}不接受${m.tag||'此类'}模块`);
    if(m.bind) {
      if(bindings.has(m.bind)&&bindings.get(m.bind)!==destination) fail(`绑定组 ${m.bind} 必须同岛`);
      bindings.set(m.bind,destination);
    }
    const {area,power}=effectiveModuleLoad(m,i,gear);
    const load=result.loads[destination];
    load.area+=area;load.power+=power;load.moduleIds.push(m.id);
  }
  for(const n of level.nets) {
    const occupied=[...new Set(n.members.map(m=>assignment[m]).filter(i=>islands.has(i)))];
    const charge=netCharge(n,occupied,gear);
    result.netCosts.push({id:n.id,name:n.name,...charge,members:n.members});
    result.cut+=charge.cost;
    if(charge.crossings) for(const id of occupied) result.loads[id].ports+=charge.portUnits;
  }
  for(const i of level.islands) {
    const l=result.loads[i.id];
    if(l.area>l.capacity.area) fail(`${i.name}面积 ${l.area}/${l.capacity.area} 超限`);
    if(l.power>l.capacity.power) fail(`${i.name}功耗 ${l.power}/${l.capacity.power} 超限`);
    if(l.ports>l.capacity.ports) fail(`${i.name}港口 ${l.ports}/${l.capacity.ports} 超限`);
  }
  for(const c of level.contracts||[]) {
    if(!object(c)||typeof c.label!=='string') {fail('迁移合同格式无效');continue;}
    const members=c.members||[];
    if(!Array.isArray(members)||Array.from(members).some(m=>!modules.has(m))) {fail(`合同“${c.label}”含未知模块`);continue;}
    const locations=members.map(m=>assignment[m]);
    let ok=false;
    switch(c.type) {
      case 'together':ok=members.length>1&&new Set(locations).size===1;break;
      case 'separate':ok=members.length>1&&new Set(locations).size===members.length;break;
      case 'residents':ok=islands.has(c.island)&&finite(c.min??0)&&finite(c.max??9999)&&level.modules.filter(m=>assignment[m.id]===c.island&&(!c.tag||m.tag===c.tag)&&(!members.length||members.includes(m.id))).length>=(c.min??0)&&level.modules.filter(m=>assignment[m.id]===c.island&&(!c.tag||m.tag===c.tag)&&(!members.length||members.includes(m.id))).length<=(c.max??9999);break;
      case 'moved':ok=finite(c.max)&&level.modules.filter(m=>(!c.tag||m.tag===c.tag)&&(!members.length||members.includes(m.id))&&assignment[m.id]!==level.initial[m.id]).length<=c.max;break;
      case 'netBudget':ok=Array.isArray(c.netIds)&&Array.from(c.netIds).every(n=>nets.has(n))&&finite(c.max)&&sum(result.netCosts.filter(n=>c.netIds.includes(n.id)).map(n=>n.cost))<=c.max;break;
      default:fail(`未知合同类型 ${c.type}`);continue;
    }
    if(!ok) fail(`合同：${c.label}`);
  }
  result.valid=violations.length===0;
  if(result.cut>level.limits.cut) fail(`通信费用 ${result.cut}/${level.limits.cut} 超预算`);
  if(result.moves>level.limits.moves) fail(`迁移模块 ${result.moves}/${level.limits.moves} 超预算`);
  if(result.migration>level.limits.migration) fail(`搬运费 ${result.migration}/${level.limits.migration} 超预算`);
  result.passed=violations.length===0;
  return result;
}

/** 确定种子生成。先建立见证，再打乱；正式判定任何失败都重试。 */
export function generateEndless(seed,round=1,gear={}) {
  if(!['string','number','bigint','boolean'].includes(typeof seed)) seed='群岛';
  seed=String(seed).slice(0,128);
  let numericRound;try{numericRound=Number(round);}catch{numericRound=1;}
  round=Number.isFinite(numericRound)?Math.max(1,Math.min(999,Math.floor(numericRound))):1;
  let hash=2166136261;
  for(const c of `${seed}:${round}`) hash=Math.imul(hash^c.charCodeAt(0),16777619)>>>0;
  const random=()=>{hash+=0x6D2B79F5;let t=hash;t=Math.imul(t^(t>>>15),t|1);t^=t+Math.imul(t^(t>>>7),t|61);return ((t^(t>>>14))>>>0)/4294967296;};
  const count=Math.min(5,2+Math.floor((round-1)/3)), per=Math.min(5,3+Math.floor((round-1)/4));
  if(object(gear)&&typeof gear.target==='string'&&/^i[1-5]$/.test(gear.target)&&Number(gear.target.slice(1))>count) gear={...gear,target:'i1'};
  for(let attempt=0;attempt<30;attempt++) {
    const islands=[],modules=[],nets=[],reference={},initial={};
    for(let i=0;i<count;i++) {
      const id=`i${i+1}`, island={id,name:['晨曦礁','星屿','琥珀湾','深蓝港','翡翠环'][i],area:1000,power:1000,ports:1000,trait:'远航标准岛'};
      if(round>=4&&round%5===0) {island.modifiers=i%2?{'缓存':{area:-1,power:1}}:{'算力':{power:-1}};island.trait=i%2?'缓存面积 −1，功耗 +1':'算力功耗 −1';}
      if(round>=4&&round%5===2&&i%2) {island.migrationTax=1+Math.floor(round/15);island.trait=`每个迁入模块税 +${island.migrationTax}`;}
      islands.push(island);
      const members=[];
      for(let j=0;j<per;j++) {
        const mid=`m${modules.length+1}`,area=1+Math.floor(random()*3),power=1+Math.floor(random()*3);
        modules.push({id:mid,name:`${['导航','算阵','缓冲','译码','采样'][j]} ${i+1}`,area,power,tag:tagNames[(j+i)%4],migration:1+Math.floor(random()*3)});
        reference[mid]=id;initial[mid]=id;members.push(mid);
      }
      nets.push({id:`n${nets.length+1}`,name:`${i+1} 号簇总线`,members,weight:3+Math.floor(random()*4),critical:round>=5?2:0});
      if(per>=4) nets.push({id:`n${nets.length+1}`,name:`${i+1} 号快线`,members:[members[0],members[per-1]],weight:2});
    }
    for(let i=0;i<count;i++) {
      const a=`m${i*per+1}`,b=`m${((i+1)%count)*per+1}`;
      nets.push({id:`n${nets.length+1}`,name:`岛间同步 ${i+1}`,members:[a,b],weight:1});
    }
    if(round>=8) nets.push({id:`n${nets.length+1}`,name:'全岛共享校验',members:Array.from({length:count},(_,i)=>`m${i*per+per}`),weight:1,critical:round>=10?2:0});
    // 每轮打乱更多模块。相同工作簇没有随机删除，玩家能读出目标结构。
    const changes=Math.min(per-1,1+Math.floor((round-1)/2));
    for(let j=0;j<changes;j++) for(let i=0;i<count;i++) initial[`m${i*per+j+1}`]=`i${((i+1)%count)+1}`;
    if(round>=4) for(let i=0;i<count;i++) modules[i*per+per-1].fixed=true;
    if(round>=7) for(let i=0;i<count;i++) {modules[i*per].bind=`船队${i+1}`;modules[i*per+1].bind=`船队${i+1}`;}
    const contracts=[];
    if(round>=6&&round%5===1) contracts.push({type:'netBudget',netIds:[nets[0].id],max:0,label:'一号工作簇必须完全岛内'});
    if(round>=6&&round%5===3) contracts.push({type:'separate',members:Array.from({length:count},(_,i)=>`m${i*per+per}`),label:'各岛固定导航锚点必须分居'});
    if(round>=6&&round%5===4) contracts.push({type:'residents',island:'i1',min:per,label:`晨曦礁至少保留 ${per} 个驻留模块`});
    const level={id:`endless-${seed}-${round}`,title:`远航 ${round} · ${count} 岛会合`,chapter:0,brief:'恢复工作簇，守住每轮的通信、搬运与容量预算。进入航线即开始计时，暂停会遮住地图。',lesson:'规模、扰动、固定与绑定逐轮升级；每五轮轮换异构岛、迁入税、专线、隔离与驻留合同。',hints:['先找高权重工作簇。','固定模块是工作簇的锚点，成组回迁比孤立搬运更清楚。','完整参考航线可通过提示界面逐步查看。'],islands,modules,nets,initial,reference,contracts,limits:{cut:99999,moves:99999,migration:99999},reward:0,seconds:Math.max(150,360-12*Math.min(round-1,15)),seed,round};
    // 按当前装备计算见证容量，装备代价也进入地图，不假设加装备必然更好。
    const probe=evaluate(level,reference,gear);
    if(probe.violations.some(v=>/装备/.test(v))) throw new Error('远航装备配置无效');
    for(const i of islands) {
      const l=probe.loads[i.id];
      const areaDelta=l.capacity.area-i.area,powerDelta=l.capacity.power-i.power;
      i.area=Math.max(1,l.area-areaDelta+(round<4?1:0));i.power=Math.max(1,l.power-powerDelta+(round<4?1:0));i.ports=l.ports+(round>=6&&round%5===1?0:Math.max(1,3-Math.floor(round/4)));
    }
    const witness=evaluate(level,reference,gear);
    level.limits={cut:witness.cut+Math.max(0,3-Math.floor(round/3)),moves:witness.moves,migration:witness.migration};
    level.par={cut:witness.cut,moves:witness.moves};
    if(evaluate(level,reference,gear).passed&&!evaluate(level,initial,gear).passed) return level;
  }
  throw new Error('航线生成验证失败，请更换种子');
}
