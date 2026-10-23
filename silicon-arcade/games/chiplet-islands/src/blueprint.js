import {evaluate} from './model.js';
import {GAME_ID,validAssignment,validateGear} from './save.js';

export const BLUEPRINT_VERSION=1;
export const MAX_BLUEPRINT_BYTES=64_000;
const obj=x=>x!==null&&typeof x==='object'&&!Array.isArray(x);
const fail=message=>{throw new Error(message);};
function canonical(value){
  if(Array.isArray(value))return value.map(canonical);
  if(obj(value))return Object.fromEntries(Object.keys(value).sort().map(k=>[k,canonical(value[k])]));
  return value;
}
/** 绑定实际规则内容；同 id 的规则更新后不误载旧方案。不是安全签名。 */
export function levelFingerprint(level){
  const rule={};for(const k of ['id','islands','modules','nets','initial','limits','contracts'])rule[k]=level[k]??null;
  const text=JSON.stringify(canonical(rule));let hash=2166136261;
  for(let i=0;i<text.length;i++)hash=Math.imul(hash^text.charCodeAt(i),16777619)>>>0;
  return 'ci1-'+hash.toString(16).padStart(8,'0');
}
function checked(level,assignment,rawGear){
  if(!validAssignment(level,assignment))fail('蓝图模块归属不完整或包含未知模块/岛屿');
  const gear=validateGear(rawGear,level),r=evaluate(level,assignment,gear);
  if(!r.passed)fail('蓝图未通过本关正式验收：'+r.violations[0]);
  return {assignment:Object.fromEntries(level.modules.map(m=>[m.id,assignment[m.id]])),gear,metrics:{cut:r.cut,moves:r.moves,migration:r.migration}};
}
export function createBlueprint(level,assignment,gear={}){
  const plan=checked(level,assignment,gear);
  return {game:GAME_ID,type:'blueprint',version:BLUEPRINT_VERSION,level:{id:level.id,signature:levelFingerprint(level)},...plan};
}
export function parseBlueprint(raw,currentLevel){
  let text,data;
  try{text=typeof raw==='string'?raw:JSON.stringify(raw);}catch{fail('蓝图不是有效 JSON');}
  if(typeof text!=='string'||text.length>MAX_BLUEPRINT_BYTES||new TextEncoder().encode(text).length>MAX_BLUEPRINT_BYTES)fail('蓝图文件过大');
  try{data=JSON.parse(text);}catch{fail('蓝图不是有效 JSON');}
  if(!obj(data)||Object.keys(data).length>32||data.game!==GAME_ID||data.type!=='blueprint'||data.version!==BLUEPRINT_VERSION)fail('这不是受支持的芯粒群岛蓝图');
  if(Object.keys(data).some(k=>!['game','type','version','level','assignment','gear','metrics'].includes(k)))fail('蓝图包含不支持的额外数据');
  if(['save','credits','owned','completed','best','drafts','settings'].some(k=>Object.prototype.hasOwnProperty.call(data,k)))fail('蓝图不能包含存档或研究点');
  if(!obj(data.level)||Object.keys(data.level).some(k=>!['id','signature'].includes(k))||data.level.id!==currentLevel?.id||data.level.signature!==levelFingerprint(currentLevel))fail('蓝图只能载入相同关卡及相同规则版本');
  if(!obj(data.gear)||!Array.isArray(data.gear.equipped)||!Object.prototype.hasOwnProperty.call(data.gear,'target')||Object.keys(data.gear).some(k=>!['equipped','target'].includes(k)))fail('蓝图缺少完整工具配置或包含额外数据');
  const plan=checked(currentLevel,data.assignment,data.gear);
  if(!obj(data.metrics)||Object.keys(data.metrics).some(k=>!['cut','moves','migration'].includes(k))||!['cut','moves','migration'].every(k=>typeof data.metrics[k]==='number'&&Number.isFinite(data.metrics[k])&&data.metrics[k]===plan.metrics[k]))fail('蓝图指标与正式计算不一致');
  return {...plan,levelId:currentLevel.id};
}
