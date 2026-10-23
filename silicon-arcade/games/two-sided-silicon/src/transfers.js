import { levels, generateEndless } from './content.js';
import { evaluate, parseNode, edgeKey, cloneState } from './model.js';
import { SAVE_KEY, equipment, validateProfile } from './progress.js';

// Transfer envelopes are deliberately separate from forgiving local crash recovery.
// Imports either validate completely or leave the running game untouched.
export const GAME_ID = 'two-sided-silicon';
export const IMPORT_RECOVERY_KEY = `${SAVE_KEY}.before-import`;
const SCHEMA = 1;
const LIMIT = 4_000_000;
const gearIds = equipment.map(item => item.id);
const profileKeys = ['version','credits','completed','gear','drafts','best','settings','current','endless','recoveryNotice'];
const record = value => value !== null && typeof value === 'object' && !Array.isArray(value) &&
  [Object.prototype, null].includes(Object.getPrototypeOf(value));
const own = (value, key) => Object.prototype.hasOwnProperty.call(value, key);
const finite = (value, min = 0, max = 1_000_000) => typeof value === 'number' && Number.isFinite(value) && value >= min && value <= max;
const fail = message => { throw new Error(message); };
function keys(value, allowed, required = allowed) {
  return record(value) && Object.keys(value).every(key => allowed.includes(key)) && required.every(key => own(value,key));
}
function parsed(input) {
  if (typeof input === 'string') {
    if (input.length > LIMIT) fail('文件超过本游戏 4 MB 存档上限。');
    return JSON.parse(input);
  }
  // Limit object inputs as well; this also refuses cycles and non-JSON values.
  const serialized = JSON.stringify(input);
  if (typeof serialized !== 'string' || serialized.length > LIMIT) fail('文件超过本游戏存档上限或不是 JSON。');
  return JSON.parse(serialized);
}
function checksum(text) {
  let hash = 2166136261;
  for (let index = 0; index < text.length; index++) hash = Math.imul(hash ^ text.charCodeAt(index),16777619);
  return (hash >>> 0).toString(16).padStart(8,'0');
}
function canonical(value) {
  if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`;
  if (record(value)) return `{${Object.keys(value).sort().map(key => `${JSON.stringify(key)}:${canonical(value[key])}`).join(',')}}`;
  return JSON.stringify(value);
}

/** A compatibility fingerprint of the formal rules, never a claim of authenticity. */
export function levelSignature(level) {
  const text = canonical({ model: 'two-sided-grid-1', id:level.id, size:level.size,
    modules:level.modules.map(({id,node,current,slots,accessOptions})=>({id,node,current,slots,accessOptions})),
    nets:level.nets.map(({id,from,to,maxLength})=>({id,from,to,maxLength})), sources:level.sources,
    blockedFront:level.blockedFront, blockedBack:level.blockedBack, modes:level.modes,
    budgets:level.budgets, minVoltage:level.minVoltage, initial:level.initial,
    frontLocked:!!level.frontLocked, accessLocked:!!level.accessLocked });
  return `grid1-${checksum(text)}-${text.length}`;
}
function validatedGear(value) {
  if (!Array.isArray(value) || value.length > gearIds.length || new Set(value).size !== value.length || !value.every(id=>gearIds.includes(id))) fail('研发装备列表含未知项目或重复项目。');
  return [...value];
}
const immutableErrors = new Set(['front-locked','access-locked','gear-access','gear-width']);
const geometryErrors = new Set(['invalid-level','invalid-state','module-position','module-obstacle','module-overlap',
  'access-invalid','access-position','access-obstacle','access-type-conflict','unknown-module','unknown-access',
  'edge-invalid','signal-invalid','signal-duplicate','signal-obstacle','signal-module','signal-well','signal-conflict',
  'unknown-net','power-width','power-obstacle','source-obstacle']);

function validatePlan(level, input, gear, strictGeometry = false) {
  if (!keys(input,['positions','access','signal','power'])) fail('方案必须包含楼位、接入井、信号与电网四份完整资料。');
  const moduleIds = level.modules.map(m=>m.id), netIds = level.nets.map(n=>n.id);
  if (!keys(input.positions,moduleIds) || !keys(input.access,moduleIds) || !keys(input.signal,netIds) || !record(input.power)) fail('方案的模块或信号网与本订单不符。');
  const inGrid = node => { const p = parseNode(node); return p && p.x>=0 && p.y>=0 && p.x<level.size.w && p.y<level.size.h; };
  const validEdge = edge => {
    if (typeof edge !== 'string') return false;
    const [a,b,...extra] = edge.split('|'), p=parseNode(a),q=parseNode(b);
    return !extra.length && inGrid(a) && inGrid(b) && Math.abs(p.x-q.x)+Math.abs(p.y-q.y)===1 && edge===edgeKey(a,b);
  };
  for (const id of moduleIds) {
    if (!inGrid(input.positions[id])) fail(`模块 ${id} 的坐标超出本订单棋盘。`);
    const well = input.access[id];
    if (!keys(well,['node','type']) || !inGrid(well.node) || !['normal','underpass','highflow'].includes(well.type)) fail(`模块 ${id} 的井位或类型不合法。`);
  }
  for (const id of netIds) {
    const edges = input.signal[id];
    if (!Array.isArray(edges) || edges.length>4096 || !edges.every(validEdge) || new Set(edges).size!==edges.length) fail(`信号 ${id} 含越界、非相邻或重复线段。`);
  }
  if (Object.keys(input.power).length>4096) fail('电网线段数超过本游戏上限。');
  for (const [edge,width] of Object.entries(input.power)) if (!validEdge(edge) || ![1,2,3].includes(width)) fail('电网含越界线段或未知线宽。');
  const state = cloneState(input), result = evaluate(level,state,gear);
  const rejected = result.errors.find(error => immutableErrors.has(error.code) || (strictGeometry && geometryErrors.has(error.code)));
  if (rejected) fail(`方案不能导入：${rejected.message}`);
  return {state,result};
}

function profilePayload(input) {
  let data = input;
  if (own(data,'_checksum')) {
    const {_checksum,...payload} = data;
    if (typeof _checksum!=='string' || checksum(JSON.stringify(payload))!==_checksum) fail('旧存档校验码不匹配，文件可能已经损坏。');
    data = payload;
  }
  if (!keys(data,profileKeys,['version','credits','completed','gear','drafts','best','settings','endless']) || data.version!==2) fail('这不是受支持的《双面硅城》v2 存档。');
  if (!Number.isInteger(data.credits) || !finite(data.credits)) fail('研发点数必须是本游戏范围内的整数。');
  const gear = validatedGear(data.gear);
  if (!keys(data.settings,['sound','reducedMotion','contrast'],[]) || !Object.values(data.settings).every(value=>typeof value==='boolean')) fail('设置项必须使用本游戏支持的布尔值。');
  if (own(data,'recoveryNotice') && (typeof data.recoveryNotice!=='string' || data.recoveryNotice.length>1024)) fail('恢复提示格式不合法。');
  if (!keys(data.endless,['seed','round','bestRound','remaining','paused','finishedLevelId'],['seed','round','bestRound'])) fail('边境扩建资料不完整或含未知项目。');
  const endless=data.endless;
  if (typeof endless.seed!=='string' || !endless.seed.length || endless.seed.length>64 || /[\x00-\x1f\x7f]/.test(endless.seed) ||
      !Number.isSafeInteger(endless.round) || endless.round<1 || !Number.isSafeInteger(endless.bestRound) || endless.bestRound<0 ||
      (own(endless,'remaining') && !finite(endless.remaining,0,3600)) || (own(endless,'paused') && typeof endless.paused!=='boolean')) fail('边境种子、轮次或剩余时间不合法。');
  const cache = new Map(levels.map(level=>[level.id,level]));
  function resolve(id) {
    if (typeof id!=='string') fail('订单标识必须是文字。');
    if (cache.has(id)) return cache.get(id);
    const parts=/^endless-(.+)-([1-9]\d*)$/u.exec(id);
    const seed=parts?.[1],round=Number(parts?.[2]);
    if (!parts || seed.length>64 || /[\x00-\x1f\x7f]/.test(seed) || !Number.isSafeInteger(round) || round<1 || String(round)!==parts[2]) fail(`不认识订单 ${id.slice(0,80)}。`);
    const level=generateEndless(seed,round,gear);cache.set(id,level);return level;
  }
  function recordMap(map,name) {
    if (!record(map) || Object.keys(map).length>112 || Object.keys(map).filter(id=>id.startsWith('endless-')).length>64) fail(`${name}数量或格式超过本游戏上限。`);
    return Object.entries(map);
  }
  for (const [id,clear] of recordMap(data.completed,'交付记录')) {
    if (!levels.some(level=>level.id===id) || !keys(clear,['stars','cost','margin']) || !Number.isInteger(clear.stars) || clear.stars<1 || clear.stars>3 || !finite(clear.cost) || !finite(clear.margin,-1e-9,10)) fail('交付记录含未知战役订单或无效成绩。');
  }
  for (const [id,draft] of recordMap(data.drafts,'草稿')) validatePlan(resolve(id),draft,gear);
  for (const [id,best] of recordMap(data.best,'个人最佳')) {
    const level=resolve(id);
    if (!keys(best,['lean','stable'],[]) || !Object.keys(best).length) fail('个人最佳类型不合法。');
    for (const score of Object.values(best)) {
      if (!keys(score,['state','cost','margin']) || !finite(score.cost) || !finite(score.margin,0,10)) fail('个人最佳指标类型不合法。');
      const {result}=validatePlan(level,score.state,gear);
      if (!result.ok || Math.abs(result.cost-score.cost)>1e-7 || Math.abs(Math.max(0,result.margin)-score.margin)>1e-7) fail('个人最佳未通过本订单正式签核，或指标与方案不符。');
    }
  }
  if (own(data,'current')) {
    if (!keys(data.current,['mode','levelId']) || !['campaign','endless'].includes(data.current.mode)) fail('当前订单资料不合法。');
    const current=resolve(data.current.levelId);
    if ((data.current.mode==='campaign')!==(current.chapter>=0) || (data.current.mode==='endless' && current.id!==`endless-${endless.seed}-${endless.round}`)) fail('当前订单与战役/边境种子、轮次不一致。');
  }
  if (own(endless,'remaining') && endless.remaining>resolve(`endless-${endless.seed}-${endless.round}`).timeSeconds+1e-7) fail('边境剩余时间超过该订单的正式时限。');
  if (own(endless,'finishedLevelId')) {
    const id=`endless-${endless.seed}-${endless.round}`;
    if (endless.finishedLevelId!==id || !finite(endless.remaining,Number.MIN_VALUE,3600) ||
        !own(data.drafts,id) || !evaluate(resolve(id),data.drafts[id],gear).ok) fail('边境完成标记须对应当前种子与轮次、时限内已通过正式签核的完整草稿。');
  }
  const clean=validateProfile(data);
  if (!clean) fail('存档无法通过本游戏的数据校验。');
  return clean;
}

/** Returns a JSON-serializable envelope. Throws for malformed profiles. */
export function encodeProfile(profile) {
  return {game:GAME_ID,kind:'profile',schema:SCHEMA,payload:profilePayload(parsed(profile))};
}
/** Accepts typed exports and strictly recognized legacy v2 exports. */
export function decodeProfile(input) {
  try {
    let data=parsed(input);
    if (!record(data)) fail('存档根资料必须是对象。');
    if (own(data,'game') || own(data,'kind') || own(data,'schema') || own(data,'payload')) {
      if (!keys(data,['game','kind','schema','payload']) || data.game!==GAME_ID || data.kind!=='profile' || data.schema!==SCHEMA) fail('文件属于其他游戏、其他类型或不支持的存档版本。');
      data=data.payload;
    }
    if (!record(data)) fail('存档内容不合法。');
    return {ok:true,profile:profilePayload(data),message:'本游戏存档已完整验证。'};
  } catch(error) { return {ok:false,message:error instanceof SyntaxError?'文件不是有效的 JSON。':error.message||'存档校验失败。'}; }
}
function requiredGear(state) {
  return gearIds.filter(id=>id==='heavy'?Object.values(state.power).includes(3):Object.values(state.access).some(well=>well.type===id));
}
/** Blueprint transfers contain a plan only, never progress, rewards or a timer. */
export function encodeBlueprint(level,state,gear=[]) {
  validatedGear(gear);
  const plan=validatePlan(level,parsed(state),gear,true).state;
  return {game:GAME_ID,kind:'blueprint',schema:SCHEMA,level:{id:level.id,signature:levelSignature(level)},requires:requiredGear(plan),payload:plan};
}
export function decodeBlueprint(input,currentLevel,gear=[]) {
  try {
    const data=parsed(input),equipped=validatedGear(gear);
    if (!keys(data,['game','kind','schema','level','requires','payload']) || data.game!==GAME_ID || data.kind!=='blueprint' || data.schema!==SCHEMA) fail('文件不是本游戏支持的蓝图版本。');
    if (!keys(data.level,['id','signature']) || data.level.id!==currentLevel.id || data.level.signature!==levelSignature(currentLevel)) fail('蓝图对应其他订单或规则版本，请在完全相同的订单中加载。');
    const required=validatedGear(data.requires);
    if (required.some(id=>!equipped.includes(id))) fail('蓝图使用了尚未研发的器材。');
    const checked=validatePlan(currentLevel,data.payload,equipped,true);
    if (canonical(required.slice().sort())!==canonical(requiredGear(checked.state).sort())) fail('蓝图器材声明与施工内容不一致。');
    return {ok:true,...checked,message:checked.result.ok?'蓝图已通过正式签核；导入只恢复施工，提交后才记成绩。':'未完成蓝图已验证并恢复；仍需通过两面、预算与时限签核。'};
  } catch(error) { return {ok:false,message:error instanceof SyntaxError?'文件不是有效的 JSON。':error.message||'蓝图校验失败。'}; }
}

/** Only the dedicated own-game key is touched. Keep the snapshot until next successful import. */
export function preserveImportRecovery(storage,profile) {
  try {
    const serialized=JSON.stringify(encodeProfile(profile));
    storage.setItem(IMPORT_RECOVERY_KEY,serialized);
    return storage.getItem(IMPORT_RECOVERY_KEY)===serialized;
  } catch { return false; }
}
export function readImportRecovery(storage) {
  try { const result=decodeProfile(storage.getItem(IMPORT_RECOVERY_KEY));return result.ok?result.profile:null; }
  catch { return null; }
}
