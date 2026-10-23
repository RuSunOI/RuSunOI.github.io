import {equipment} from './model.js';
export const SAVE_KEY='chiplet-islands.v1';
export const BACKUP_KEY=SAVE_KEY+'.backup';
export const emptySave=()=>({version:1,completed:{},best:{},drafts:{},credits:0,owned:[],equipped:[],target:'i1',settings:{sound:true,motion:true},endless:{seed:260607,round:1,record:0},lastLevel:1});
const obj=x=>x&&typeof x==='object'&&!Array.isArray(x);
export function sanitize(raw){
 if(!obj(raw)||raw.version!==1)throw new Error('存档版本不受支持');
 const s=emptySave();
 if(obj(raw.completed))s.completed=Object.fromEntries(Object.entries(raw.completed).filter(([k,v])=>/^(?:[1-9]|[1-3][0-9]|4[0-8])$/.test(k)&&v===true));
 if(obj(raw.drafts))s.drafts=raw.drafts;
 if(obj(raw.best))for(const [id,records] of Object.entries(raw.best)){
  if(!/^(?:[1-9]|[1-3][0-9]|4[0-8])$/.test(id)||!obj(records))continue;
  const clean={};
  for(const key of ['cut','moves','migration']){const r=records[key];if(!obj(r)||!Array.isArray(r.score)||r.score.length!==3||r.score.some(n=>!Number.isFinite(n)||n<0)||!obj(r.assignment)||Object.values(r.assignment).some(v=>typeof v!=='string'))continue;
   clean[key]={score:[...r.score],assignment:{...r.assignment},gear:{equipped:Array.isArray(r.gear?.equipped)?r.gear.equipped.filter(g=>equipment.some(x=>x.id===g)):[],target:typeof r.gear?.target==='string'?r.gear.target:'i1'}};
  }if(Object.keys(clean).length)s.best[id]=clean;
 }

 s.credits=Number.isInteger(raw.credits)&&raw.credits>=0&&raw.credits<100000?raw.credits:0;
 s.owned=Array.isArray(raw.owned)?[...new Set(raw.owned.filter(x=>equipment.some(item=>item.id===x)))].slice(0,20):[];
 let slots=0;s.equipped=Array.isArray(raw.equipped)?[...new Set(raw.equipped.filter(x=>s.owned.includes(x)))].filter(id=>{slots+=equipment.find(x=>x.id===id).slots;return slots<=2;}):[];
 s.target=typeof raw.target==='string'?raw.target:'i1';
 s.settings={sound:raw.settings?.sound!==false,motion:raw.settings?.motion!==false};
 s.lastLevel=Number.isInteger(raw.lastLevel)&&raw.lastLevel>=1&&raw.lastLevel<=48?raw.lastLevel:1;
 if(obj(raw.endless))s.endless={seed:Number.isInteger(raw.endless.seed)?raw.endless.seed:260607,round:Number.isInteger(raw.endless.round)&&raw.endless.round>0?Math.min(999,raw.endless.round):1,record:Math.max(0,Math.min(999,Number(raw.endless.record)||0))};
 return s;
}
export function readSave(storage){
 let recovered=false;
 for(const key of [SAVE_KEY,BACKUP_KEY]){
 try{const value=storage.getItem(key);if(value){const save=sanitize(JSON.parse(value));return {save,recovered:recovered||key===BACKUP_KEY};}}catch{recovered=true;}
 }
 return {save:emptySave(),recovered};
}
export function writeSave(storage,save){
 const text=JSON.stringify(sanitize(save));
 try{const current=storage.getItem(SAVE_KEY);if(current){try{sanitize(JSON.parse(current));storage.setItem(BACKUP_KEY,current);}catch{}}storage.setItem(SAVE_KEY,text);return true;}catch{return false;}
}
export function validAssignment(level,a){return obj(a)&&Object.keys(a).length===level.modules.length&&level.modules.every(m=>level.islands.some(i=>i.id===a[m.id]));}
export function recordClear(save,level,a,result,reward=true){
 if(!result.passed)return {first:false,newBest:false};
 const first=!save.completed[level.id];
 if(reward&&first){save.completed[level.id]=true;save.credits+=Number.isFinite(level.reward)?level.reward:6;}
 const all=save.best[level.id]||{};let newBest=false;
 for(const [key,tuple] of Object.entries({cut:[result.cut,result.moves,result.migration],moves:[result.moves,result.migration,result.cut],migration:[result.migration,result.cut,result.moves]})){
 const old=all[key];const wins=!old||!Array.isArray(old.score)||old.score.length!==3||tuple.some((x,i)=>x<old.score[i]&&tuple.slice(0,i).every((y,j)=>y===old.score[j]));
 if(wins){all[key]={score:tuple,assignment:{...a},gear:{equipped:[...save.equipped],target:save.target}};newBest=true;}
 }
 save.best[level.id]=all;return {first:reward&&first,newBest};
}
export function purchase(save,item){if(!item||!Number.isInteger(item.cost)||item.cost<0)return false;if(item.unlockAt&&item.unlockAt>1&&!save.completed[item.unlockAt-1])return false;if(save.owned.includes(item.id))return false;if(save.credits<item.cost)return false;save.credits-=item.cost;save.owned.push(item.id);return true;}
export function refund(save,item){if(!item||!Number.isInteger(item.cost)||item.cost<0)return false;if(!save.owned.includes(item.id))return false;save.owned=save.owned.filter(x=>x!==item.id);save.equipped=save.equipped.filter(x=>x!==item.id);save.credits+=item.cost;return true;}
