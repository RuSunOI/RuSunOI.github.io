import {equipment,evaluate,generateEndless} from './model.js';
import {levels} from './levels.js';

export const GAME_ID='chiplet-islands';
export const SAVE_KEY='chiplet-islands.v1';
export const BACKUP_KEY=SAVE_KEY+'.backup';
export const IMPORT_BACKUP_KEY=SAVE_KEY+'.import-backup';
export const MAX_SAVE_BYTES=2_000_000;
const MAX_RECOVERY_BYTES=MAX_SAVE_BYTES*4+1024;
export const emptySave=()=>({version:1,completed:{},best:{},drafts:{},credits:0,owned:[],equipped:[],target:'i1',settings:{sound:true,motion:true},endless:{seed:260607,round:1,record:0},lastLevel:1});
const obj=x=>x!==null&&typeof x==='object'&&!Array.isArray(x);
const own=(x,k)=>Object.prototype.hasOwnProperty.call(x,k);
const integer=(n,min,max)=>Number.isSafeInteger(n)&&n>=min&&n<=max;
const finite=n=>typeof n==='number'&&Number.isFinite(n)&&n>=0;
const levelId=id=>typeof id==='string'&&/^(?:[1-9]|[1-3][0-9]|4[0-8])$/.test(id);
const islandId=id=>typeof id==='string'&&/^i[1-5]$/.test(id);
const required=['completed','best','drafts','credits','owned','equipped','target','settings','endless','lastLevel'];
const error=message=>{throw new Error(message);};
function bounded(x,max,label){if(!obj(x)||Object.keys(x).length>max)error(label+'格式错误或条目过多');return x;}
function jsonInput(raw,max=MAX_SAVE_BYTES){
  let text;
  try{text=typeof raw==='string'?raw:JSON.stringify(raw);}catch{error('数据不是有效 JSON');}
  if(typeof text!=='string'||text.length>max||new TextEncoder().encode(text).length>max)error('文件过大或数据格式错误');
  try{return JSON.parse(text);}catch{error('文件不是有效 JSON');}
}
function attempt(fn,strict){try{return fn();}catch(e){if(strict)throw e;return undefined;}}
function requireLegacyShape(raw){if(!obj(raw)||raw.version!==1||required.some(k=>!own(raw,k)))error('缺少芯粒群岛旧存档身份字段');return raw;}
function requireCompleteGear(raw){if(!obj(raw)||!Array.isArray(raw.equipped)||!own(raw,'target'))error('工具配置必须包含装备列表和目标岛');}

/** 不要求容量/预算合法：编辑中的已执行草案可完整恢复。 */
export function validAssignment(level,a){
  if(!obj(a)||!Array.isArray(level?.modules)||!Array.isArray(level?.islands)||level.modules.length>25||Object.keys(a).length!==level.modules.length)return false;
  const ids=new Set(level.modules.map(m=>m.id)),islands=new Set(level.islands.map(i=>i.id));
  return Object.keys(a).every(k=>ids.has(k))&&level.modules.every(m=>own(a,m.id)&&typeof a[m.id]==='string'&&islands.has(a[m.id]));
}
export function validateGear(raw={},level=null,owned=null){
  bounded(raw,16,'工具配置');
  const equipped=raw.equipped===undefined?[]:raw.equipped,target=raw.target===undefined?(level?.islands[0]?.id||'i1'):raw.target;
  if(!Array.isArray(equipped)||equipped.length>2||new Set(equipped).size!==equipped.length||!islandId(target))error('工具配置或目标岛无效');
  let slots=0;
  for(const id of equipped){const e=equipment.find(x=>x.id===id);if(!e||(owned&&!owned.includes(id)))error('工具未知或尚未拥有');slots+=e.slots;}
  if(slots>2||(level&&!level.islands.some(i=>i.id===target)))error('工具超出两配置槽或目标岛不存在');
  return {equipped:[...equipped],target};
}
const effectiveGear=(gear,level)=>({...gear,target:level.islands.some(i=>i.id===gear.target)?gear.target:level.islands[0].id});
const tuples=r=>({cut:[r.cut,r.moves,r.migration],moves:[r.moves,r.migration,r.cut],migration:[r.migration,r.cut,r.moves]});
const assignmentCopy=(l,a)=>Object.fromEntries(l.modules.map(m=>[m.id,a[m.id]]));
let endlessCache=null;
function currentEndless(s){
  const key=JSON.stringify([s.endless.seed,s.endless.round,s.equipped,s.target]);
  if(endlessCache?.key!==key)endlessCache={key,level:generateEndless(s.endless.seed,s.endless.round,{equipped:s.equipped,target:s.target})};
  return endlessCache.level;
}

/** 本机旧存档逐项清洗；外部导入使用 strict，坏已知字段立即拒绝。 */
export function sanitize(raw,options={}){
  const strict=options.strict===true;
  bounded(raw,64,'存档');
  if(raw.version!==1)error('存档版本不受支持');
  if(strict&&required.some(k=>!own(raw,k)))error('缺少芯粒群岛存档字段，不能导入其他应用的 JSON');
  const s=emptySave();
  if(strict&&(!obj(raw.completed)||!obj(raw.best)||!obj(raw.drafts)||!Array.isArray(raw.owned)||!Array.isArray(raw.equipped)||!obj(raw.settings)||!obj(raw.endless)))error('存档属性类型错误');
  if(obj(raw.completed)){
    bounded(raw.completed,48,'战役进度');
    for(const [id,value] of Object.entries(raw.completed)){
      if(!levelId(id)||typeof value!=='boolean'){if(strict)error('战役关卡编号或完成状态无效');continue;}
      if(value)s.completed[id]=true;
    }
  }
  if(!integer(raw.credits,0,99999)){if(strict)error('研究点必须是有限非负整数');}else s.credits=raw.credits;
  if(Array.isArray(raw.owned)){
    if(raw.owned.length>20)error('已研发工具条目过多');
    for(const id of raw.owned){if(!equipment.some(e=>e.id===id)||s.owned.includes(id)){if(strict)error('已研发工具未知或重复');continue;}s.owned.push(id);}
  }
  if(strict){const g=validateGear({equipped:raw.equipped,target:raw.target},null,s.owned);s.equipped=g.equipped;s.target=g.target;}
  else {
    let slots=0;
    for(const id of Array.isArray(raw.equipped)?raw.equipped.slice(0,20):[]){const e=equipment.find(x=>x.id===id);if(!e||!s.owned.includes(id)||s.equipped.includes(id)||slots+e.slots>2)continue;slots+=e.slots;s.equipped.push(id);}
    s.target=islandId(raw.target)?raw.target:'i1';
  }
  if(obj(raw.settings)){
    bounded(raw.settings,16,'设置');
    if(strict&&(typeof raw.settings.sound!=='boolean'||typeof raw.settings.motion!=='boolean'))error('声音与动画设置必须为布尔值');
    s.settings={sound:typeof raw.settings.sound==='boolean'?raw.settings.sound:true,motion:typeof raw.settings.motion==='boolean'?raw.settings.motion:true};
  }
  if(integer(raw.lastLevel,1,48))s.lastLevel=raw.lastLevel;else if(strict)error('最近关卡编号无效');
  if(obj(raw.endless)){
    bounded(raw.endless,16,'远航状态');
    for(const [key,min,max] of [['seed',1,2147483647],['round',1,999],['record',0,999]]){
      if(integer(raw.endless[key],min,max))s.endless[key]=raw.endless[key];else if(strict)error('远航'+key+'必须是范围内有限整数');
    }
  }
  if(obj(raw.best)){
    bounded(raw.best,48,'个人最佳');
    for(const [id,records] of Object.entries(raw.best)){
      if(!levelId(id)||!obj(records)){if(strict)error('个人最佳关卡编号或类型无效');continue;}
      const l=levels[Number(id)-1],clean={};bounded(records,16,'成绩类别');
      for(const key of ['cut','moves','migration'])if(own(records,key)){
        const record=attempt(()=>{
          const r=bounded(records[key],16,'成绩');
          if(!Array.isArray(r.score)||r.score.length!==3||Array.from(r.score).some(n=>!finite(n))||!validAssignment(l,r.assignment))error('个人最佳成绩或模块归属无效');
          if(strict)requireCompleteGear(r.gear);
          const gear=validateGear(r.gear===undefined?{}:r.gear,l,s.owned),result=evaluate(l,r.assignment,gear);
          if(!result.passed)error('个人最佳未通过正式验收');
          const score=tuples(result)[key];
          if(strict&&score.some((n,j)=>n!==r.score[j]))error('个人最佳成绩与正式计算不一致');
          return {score,assignment:assignmentCopy(l,r.assignment),gear};
        },strict);
        if(record)clean[key]=record;
      }
      if(Object.keys(clean).length)s.best[id]=clean;
    }
  }
  if(obj(raw.drafts)){
    bounded(raw.drafts,1000,'已执行布局');
    const currentKey='endless-'+s.endless.seed+'-'+s.endless.round;
    for(const [key,value] of Object.entries(raw.drafts)){
      let l;
      if(levelId(key))l=levels[Number(key)-1];
      else if(/^trial-(?:[1-9]|[1-3][0-9]|4[0-8])$/.test(key))l=levels[Number(key.slice(6))-1];
      else if(/^endless-\d{1,10}-\d{1,3}$/.test(key)){
        const match=/^endless-(\d+)-(\d+)$/.exec(key);
        if(!integer(Number(match[1]),1,2147483647)||!integer(Number(match[2]),1,999)){if(strict)error('远航布局种子或轮次无效');continue;}
        // 老版累积的历史远航布局不保留，也不为它们批量生成地图。
        if(key!==currentKey)continue;
        l=currentEndless(s);
      }else {if(strict)error('已执行布局包含未知关卡');continue;}
      const draft=attempt(()=>{
        const d=bounded(value,16,'已执行布局');
        if(!validAssignment(l,d.assignment)||!finite(d.remaining)||(l.seconds!==undefined?d.remaining>l.seconds:d.remaining>360))error('已执行布局归属或剩余时间无效');
        if(strict)requireCompleteGear(d.gear);
        const fallback=effectiveGear({equipped:s.equipped,target:s.target},l);
        const gear=strict?validateGear(d.gear===undefined?fallback:d.gear,l,s.owned):(attempt(()=>validateGear(d.gear===undefined?fallback:d.gear,l,s.owned),false)||fallback);
        if(l.seconds!==undefined){
          const current=effectiveGear({equipped:s.equipped,target:s.target},l);
          if(gear.target!==current.target||gear.equipped.length!==current.equipped.length||gear.equipped.some(id=>!current.equipped.includes(id)))return undefined;
          if(!evaluate(l,l.reference,current).passed)error('远航当前配置未通过生成见证');
        }
        return {assignment:assignmentCopy(l,d.assignment),remaining:d.remaining,gear};
      },strict);
      if(draft)s.drafts[key]=draft;
    }
  }
  return s;
}

export function parseSaveImport(raw){
  const envelope=jsonInput(raw);bounded(envelope,64,'导入文件');
  if(own(envelope,'game')||own(envelope,'type')||own(envelope,'save')){
    if(envelope.game!==GAME_ID||envelope.type!=='save'||envelope.version!==1||!obj(envelope.save))error('这不是受支持的芯粒群岛存档');
    return sanitize(envelope.save,{strict:true});
  }
  return sanitize(envelope,{strict:true});
}
export function exportSave(save){return JSON.stringify({game:GAME_ID,type:'save',version:1,save:sanitize(save,{strict:true})},null,2);}
export function readSave(storage){
  let recovered=false;
  for(const key of [SAVE_KEY,BACKUP_KEY]){
    try{const value=storage.getItem(key);if(value){const raw=jsonInput(value),save=own(raw,'game')?parseSaveImport(raw):sanitize(requireLegacyShape(raw));return {save,recovered:recovered||key===BACKUP_KEY};}}catch{recovered=true;}
  }
  return {save:emptySave(),recovered};
}
export function writeSave(storage,save){
  try{
    const text=JSON.stringify(sanitize(save)),current=storage.getItem(SAVE_KEY);
    if(current){try{const raw=jsonInput(current);if(own(raw,'game'))parseSaveImport(raw);else sanitize(requireLegacyShape(raw));storage.setItem(BACKUP_KEY,current);}catch{}}
    storage.setItem(SAVE_KEY,text);return true;
  }catch{return false;}
}
const setRaw=(storage,key,value)=>value===null?storage.removeItem(key):storage.setItem(key,value);
export function importSave(storage,raw){
  const save=parseSaveImport(raw),text=JSON.stringify(save);
  const previous={primary:storage.getItem(SAVE_KEY),backup:storage.getItem(BACKUP_KEY)},oldRecovery=storage.getItem(IMPORT_BACKUP_KEY);
  if(Object.values(previous).some(value=>value!==null&&(typeof value!=='string'||value.length>MAX_SAVE_BYTES||new TextEncoder().encode(value).length>MAX_SAVE_BYTES)))error('原存档过大，无法安全保留导入前恢复点');
  const recovery=JSON.stringify({game:GAME_ID,type:'import-backup',version:1,...previous});
  // 控制字符的 JSON 转义可膨胀六倍；确保写下的快照一定处于恢复器大小上限内。
  if(recovery.length>MAX_RECOVERY_BYTES||new TextEncoder().encode(recovery).length>MAX_RECOVERY_BYTES)error('导入前恢复点过大，原存档保留');
  try{storage.setItem(IMPORT_BACKUP_KEY,recovery);storage.setItem(SAVE_KEY,text);}
  catch{try{setRaw(storage,SAVE_KEY,previous.primary);setRaw(storage,IMPORT_BACKUP_KEY,oldRecovery);}catch{}error('导入未完成：无法写入本机存储，原存档保留');}
  return {save,restorable:true};
}
export function restoreImport(storage){
  const value=storage.getItem(IMPORT_BACKUP_KEY);if(!value)error('没有可恢复的导入前存档');
  const snapshot=jsonInput(value,MAX_RECOVERY_BYTES);bounded(snapshot,8,'恢复备份');
  if(snapshot.game!==GAME_ID||snapshot.type!=='import-backup'||snapshot.version!==1||!['primary','backup'].every(k=>snapshot[k]===null||(typeof snapshot[k]==='string'&&snapshot[k].length<=MAX_SAVE_BYTES&&new TextEncoder().encode(snapshot[k]).length<=MAX_SAVE_BYTES)))error('导入恢复备份损坏');
  const current={primary:storage.getItem(SAVE_KEY),backup:storage.getItem(BACKUP_KEY)};
  try{setRaw(storage,SAVE_KEY,snapshot.primary);setRaw(storage,BACKUP_KEY,snapshot.backup);}
  catch{try{setRaw(storage,SAVE_KEY,current.primary);setRaw(storage,BACKUP_KEY,current.backup);}catch{}error('恢复未完成：无法写入本机存储');}
  return {...readSave(storage),restored:true};
}

export function recordClear(save,level,a,result,reward=true){
  const l=levels.find(x=>x.id===level?.id);
  if(!l||!result?.passed||!validAssignment(l,a))return {first:false,newBest:false};
  const gear=attempt(()=>validateGear(effectiveGear({equipped:save.equipped,target:save.target},l),l,save.owned),false);
  if(!gear)return {first:false,newBest:false};
  const actual=evaluate(l,a,gear);if(!actual.passed)return {first:false,newBest:false};
  const first=!save.completed[l.id];
  if(reward&&first){save.completed[l.id]=true;save.credits+=l.reward;}
  const all=save.best[l.id]||{};let newBest=false;
  for(const [key,tuple] of Object.entries(tuples(actual))){
    const old=all[key];const wins=!old||!Array.isArray(old.score)||old.score.length!==3||tuple.some((x,i)=>x<old.score[i]&&tuple.slice(0,i).every((y,j)=>y===old.score[j]));
    if(wins){all[key]={score:tuple,assignment:assignmentCopy(l,a),gear:{equipped:[...gear.equipped],target:gear.target}};newBest=true;}
  }
  save.best[l.id]=all;return {first:reward&&first,newBest};
}
function canonicalItem(item){const known=equipment.find(e=>e.id===item?.id);return known&&item.cost===known.cost?known:null;}
export function purchase(save,item){
  const known=canonicalItem(item);if(!known||!integer(save.credits,0,99999))return false;
  if(known.unlockAt>1&&!save.completed[known.unlockAt-1])return false;
  if(save.owned.includes(known.id)||save.credits<known.cost)return false;
  save.credits-=known.cost;save.owned.push(known.id);return true;
}
export function refund(save,item){
  const known=canonicalItem(item);if(!known||!integer(save.credits,0,99999)||!save.owned.includes(known.id)||save.credits+known.cost>99999)return false;
  save.owned=save.owned.filter(x=>x!==known.id);save.equipped=save.equipped.filter(x=>x!==known.id);save.credits+=known.cost;
  for(const [id,records] of Object.entries(save.best)){
    for(const key of ['cut','moves','migration'])if(records[key]?.gear?.equipped?.includes(known.id))delete records[key];
    if(!Object.keys(records).length)delete save.best[id];
  }
  // writeSave 只写清洗副本；同步修正活跃内存，保证退款后立即导出也能通过严格校验。
  for(const [key,draft] of Object.entries(save.drafts))if(draft.gear?.equipped?.includes(known.id)){
    if(key.startsWith('endless-'))delete save.drafts[key];
    else draft.gear={equipped:draft.gear.equipped.filter(id=>save.owned.includes(id)),target:draft.gear.target};
  }
  return true;
}
