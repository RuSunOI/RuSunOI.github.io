import {cloneState,edgeKey,parseNode} from './model.js';

export function formatRemaining(seconds){const value=Math.max(0,Math.ceil(Number.isFinite(seconds)?seconds:0));return `${Math.floor(value/60)}:${String(value%60).padStart(2,'0')}`;}

// Recover damaged data without treating an unfinished or rule-breaking design as
// corrupt. Geometry that can safely be drawn remains for the player to repair.
export function restoreDraft(level,draft){
 const initial=cloneState(level.initial),state=cloneState(initial),notes=[];
 const record=v=>v&&typeof v==='object'&&!Array.isArray(v);
 const inGrid=n=>{const p=parseNode(n);return p&&p.x>=0&&p.y>=0&&p.x<level.size.w&&p.y<level.size.h;};
 const validEdge=e=>{if(typeof e!=='string')return false;const a=e.split('|');if(a.length!==2||!inGrid(a[0])||!inGrid(a[1]))return false;const p=parseNode(a[0]),q=parseNode(a[1]);return Math.abs(p.x-q.x)+Math.abs(p.y-q.y)===1&&e===edgeKey(a[0],a[1]);};
 if(draft===undefined)return {state,repaired:false,message:''};
 if(!record(draft))return {state,repaired:true,message:'草稿数据损坏，已恢复这张订单的初始方案。'};
 for(const m of level.modules){
  const n=draft.positions?.[m.id];
  if(inGrid(n)&&m.slots.includes(n))state.positions[m.id]=n;else notes.push('楼位');
  const a=draft.access?.[m.id];
  if(record(a)&&inGrid(a.node)&&['normal','underpass','highflow'].includes(a.type))state.access[m.id]={node:a.node,type:a.type};else notes.push('接入井');
 }
 for(const net of level.nets){
  const edges=draft.signal?.[net.id];
  if(Array.isArray(edges)){state.signal[net.id]=[...new Set(edges.filter(validEdge))];if(state.signal[net.id].length!==edges.length)notes.push('信号线');}else notes.push('信号网');
 }
 if(record(draft.power)){state.power={};for(const [e,w]of Object.entries(draft.power)){if(validEdge(e)&&[1,2,3].includes(w))state.power[e]=w;else notes.push('铜线');}}else notes.push('电网');
 for(const k of ['positions','access','signal'])if(record(draft[k])&&Object.keys(draft[k]).some(id=>!Object.hasOwn(state[k],id)))notes.push('未知对象');
 const repaired=notes.length>0;
 return {state,repaired,message:repaired?'草稿中缺损的楼位、井位或线路已安全恢复；其余施工保留，请重新签核。':''};
}

export function nextEndlessIdentity(seed,round){
 if(Number.isSafeInteger(round)&&round<Number.MAX_SAFE_INTEGER)return {seed,round:round+1};
 const nonce=globalThis.crypto?.randomUUID?.()||`${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`;
 return {seed:`${String(seed).slice(0,20)}·${nonce}`,round:1};
}
