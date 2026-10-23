/** Offline progression. All mutations return new profiles; no global storage is used. */
export const SAVE_KEY = 'two-sided-silicon.save.v2';
export const BACKUP_KEY = `${SAVE_KEY}.backup`;
export const equipment = Object.freeze([
  Object.freeze({ id: 'underpass', name: '隧道接入井', cost: 260, description: '信号可穿过接入点；每口井耗材 7，容量仍为 2.5。' }),
  Object.freeze({ id: 'heavy', name: '三倍宽铜线', cost: 650, description: '开放三档线宽：电阻更低，每条背面边耗材 4.5。' }),
  Object.freeze({ id: 'highflow', name: '高流接入井', cost: 1200, description: '容量提高到 6，接入压降更小；每口井耗材 6，仍占正面位置。' }),
]);

const CAMPAIGN_LENGTH = 48;
const MAX_CREDITS = 1_000_000;
const MAX_MAP_ENTRIES = 256;
const MAX_ENDLESS_RECORDS = 64;
const EPSILON = 1e-9;
const own = (object, key) => Object.prototype.hasOwnProperty.call(object, key);
const record = value => value !== null && typeof value === 'object' && !Array.isArray(value) &&
  (Object.getPrototypeOf(value) === Object.prototype || Object.getPrototypeOf(value) === null);
const safeId = value => typeof value === 'string' && /^[\p{L}\p{N}_:.\-]{1,128}$/u.test(value) &&
  !['__proto__', 'prototype', 'constructor'].includes(value);
const safeLevelId = value => typeof value === 'string' && value.length > 0 && value.length <= 256 &&
  !/[\x00-\x1f\x7f]/.test(value) && !['__proto__', 'prototype', 'constructor'].includes(value);
const finite = (value, min = 0, max = MAX_CREDITS) => typeof value === 'number' && Number.isFinite(value) && value >= min && value <= max;
const campaignNumber = id => {
  const match = typeof id === 'string' && /^silicon-(\d{2})$/.exec(id);
  const number = match ? Number(match[1]) : 0;
  return number >= 1 && number <= CAMPAIGN_LENGTH ? number : 0;
};
const node = value => {
  if (typeof value !== 'string' || !/^(0|[1-9]\d{0,2}),(0|[1-9]\d{0,2})$/.test(value)) return null;
  const coordinates = value.split(',').map(Number);
  return coordinates.every(number => number <= 127) ? coordinates : null;
};
const edge = value => {
  if (typeof value !== 'string') return false;
  const parts = value.split('|');
  if (parts.length !== 2 || parts[0] >= parts[1]) return false;
  const a = node(parts[0]);
  const b = node(parts[1]);
  return Boolean(a && b && Math.abs(a[0] - b[0]) + Math.abs(a[1] - b[1]) === 1);
};

/** Returns a bounded independent State, or null. Invalid runtime inputs never throw. */
export function sanitizeState(value) {
  try {
    if (!record(value) || !record(value.positions) || !record(value.access) || !record(value.signal) || !record(value.power)) return null;
    const result = { positions: {}, access: {}, signal: {}, power: {} };
    if (Object.keys(value.positions).length > 128 || Object.keys(value.access).length > 128 ||
        Object.keys(value.signal).length > 128 || Object.keys(value.power).length > 4096) return null;
    for (const [id, position] of Object.entries(value.positions)) {
      if (!safeId(id) || !node(position)) return null;
      result.positions[id] = position;
    }
    for (const [id, access] of Object.entries(value.access)) {
      if (!safeId(id) || !record(access) || !node(access.node) || !['normal', 'underpass', 'highflow'].includes(access.type)) return null;
      result.access[id] = { node: access.node, type: access.type };
    }
    for (const [id, edges] of Object.entries(value.signal)) {
      if (!safeId(id) || !Array.isArray(edges) || edges.length > 4096 || !edges.every(edge)) return null;
      result.signal[id] = [...new Set(edges)];
    }
    for (const [key, width] of Object.entries(value.power)) {
      if (!edge(key) || ![1, 2, 3].includes(width)) return null;
      result.power[key] = width;
    }
    return result;
  } catch {
    return null;
  }
}

/** Creates a fresh profile. Basic gear can solve every campaign reference. */
export function newProfile() {
  return {
    version: 2, credits: 0, completed: {}, gear: [], drafts: {}, best: {},
    settings: { sound: true, reducedMotion: false, contrast: false },
    current: { mode: 'campaign', levelId: 'silicon-01' },
    endless: { seed: 'silicon-city', round: 1, bestRound: 0 },
  };
}

function trimRecords(map) {
  const campaign = Object.entries(map).filter(([id]) => campaignNumber(id));
  const other = Object.entries(map).filter(([id]) => !campaignNumber(id)).slice(-MAX_ENDLESS_RECORDS);
  return Object.fromEntries([...campaign, ...other]);
}

function sanitizeScore(value) {
  if (!record(value) || !finite(value.cost) || !finite(value.margin, -EPSILON, 10)) return null;
  const state = sanitizeState(value.state);
  return state ? { state, cost: value.cost, margin: Math.max(0, value.margin) } : null;
}

/** Returns a sanitized profile or null for a bad root/version. Damaged nested records are dropped. */
export function validateProfile(data) {
  try {
    if (!record(data) || data.version !== 2 || !finite(data.credits) || !Number.isInteger(data.credits) ||
        !record(data.completed) || !Array.isArray(data.gear) || !record(data.drafts) || !record(data.best) ||
        !record(data.settings) || !record(data.endless)) return null;
    const result = newProfile();
    result.credits = data.credits;
    result.gear = [...new Set(data.gear.filter(id => equipment.some(item => item.id === id)))];
    for (const [id, clear] of Object.entries(data.completed).slice(0, MAX_MAP_ENTRIES)) {
      if (!campaignNumber(id) || !record(clear) || !Number.isInteger(clear.stars) || clear.stars < 1 || clear.stars > 3 ||
          !finite(clear.cost) || !finite(clear.margin, -EPSILON, 10)) continue;
      result.completed[id] = { stars: clear.stars, cost: clear.cost, margin: Math.max(0, clear.margin) };
    }
    for (const [id, draft] of Object.entries(data.drafts).slice(-MAX_MAP_ENTRIES)) {
      const state = safeLevelId(id) ? sanitizeState(draft) : null;
      if (state) result.drafts[id] = state;
    }
    for (const [id, best] of Object.entries(data.best).slice(-MAX_MAP_ENTRIES)) {
      if (!safeLevelId(id) || !record(best)) continue;
      const lean = sanitizeScore(best.lean);
      const stable = sanitizeScore(best.stable);
      if (lean || stable) result.best[id] = { ...(lean ? { lean } : {}), ...(stable ? { stable } : {}) };
    }
    result.drafts = trimRecords(result.drafts);
    result.best = trimRecords(result.best);
    for (const key of Object.keys(result.settings)) {
      if (typeof data.settings[key] === 'boolean') result.settings[key] = data.settings[key];
    }
    if (record(data.current) && safeLevelId(data.current.levelId) &&
        ((data.current.mode === 'campaign' && campaignNumber(data.current.levelId)) ||
         (data.current.mode === 'endless' && data.current.levelId.startsWith('endless-')))) {
      result.current = { mode: data.current.mode, levelId: data.current.levelId };
    }
    if (typeof data.endless.seed === 'string' && data.endless.seed.length > 0 && data.endless.seed.length <= 64 && !/[\x00-\x1f\x7f]/.test(data.endless.seed)) {
      result.endless.seed = data.endless.seed;
    }
    if (Number.isSafeInteger(data.endless.round) && data.endless.round >= 1) result.endless.round = data.endless.round;
    if (Number.isSafeInteger(data.endless.bestRound) && data.endless.bestRound >= 0) result.endless.bestRound = data.endless.bestRound;
    // Zero means expired; absence means a new construction timer. Never conflate the two.
    if (finite(data.endless.remaining, 0, 3600)) result.endless.remaining = data.endless.remaining;
    if(typeof data.endless.paused==='boolean')result.endless.paused=data.endless.paused;
    return result;
  } catch {
    return null;
  }
}

function checksum(text) {
  let hash = 2166136261;
  for (let index = 0; index < text.length; index++) {
    hash ^= text.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0).toString(16).padStart(8, '0');
}

function parseSave(text) {
  try {
    if (typeof text !== 'string' || text.length > 4_000_000) return null;
    const data = JSON.parse(text);
    if (!record(data)) return null;
    if (own(data, '_checksum')) {
      const { _checksum, ...payload } = data;
      if (typeof _checksum !== 'string' || checksum(JSON.stringify(payload)) !== _checksum) return null;
      return validateProfile(payload);
    }
    // Unchecksummed v2 JSON remains importable; future writes add integrity verification.
    return validateProfile(data);
  } catch {
    return null;
  }
}

function getStored(storage, key) {
  try { return { text: storage.getItem(key), failed: false }; }
  catch { return { text: null, failed: true }; }
}

/** readProfile(Storage) -> Profile, with recoveryNotice when recovery was required. */
export function readProfile(storage) {
  const primary = getStored(storage, SAVE_KEY);
  const profile = parseSave(primary.text);
  if (profile) return profile;
  const backup = getStored(storage, BACKUP_KEY);
  const recovered = parseSave(backup.text);
  if (recovered) return { ...recovered, recoveryNotice: '主存档损坏或缺失，已从备用存档恢复。' };
  const empty = newProfile();
  if (primary.failed || backup.failed) empty.recoveryNotice = '本地存档暂时不可用；请保留当前窗口，避免丢失进度。';
  else if (primary.text !== null || backup.text !== null) empty.recoveryNotice = '存档无法恢复，已建立新档。原存档内容尚未覆盖。';
  return empty;
}

/** writeProfile(Storage, Profile) -> boolean. Both copies must survive read-back verification. */
export function writeProfile(storage, profile) {
  try {
    const clean = validateProfile(profile);
    if (!clean) return false;
    const payload = JSON.stringify(clean);
    const serialized = JSON.stringify({ ...clean, _checksum: checksum(payload) });
    // Backup first: a failed primary write still leaves a complete recoverable snapshot.
    storage.setItem(BACKUP_KEY, serialized);
    if (storage.getItem(BACKUP_KEY) !== serialized || !parseSave(serialized)) return false;
    storage.setItem(SAVE_KEY, serialized);
    return storage.getItem(SAVE_KEY) === serialized && Boolean(parseSave(serialized));
  } catch {
    return false;
  }
}

function cloneProfile(profile) {
  const clean = validateProfile(profile) || newProfile();
  try {
    if (typeof profile?.recoveryNotice === 'string') clean.recoveryNotice = profile.recoveryNotice;
  } catch { /* A hostile input cannot prevent falling back to a fresh profile. */ }
  return clean;
}

/** Sequential campaign unlocking uses the consecutive silicon-01 ... silicon-48 clears. */
export function unlockedLevel(profile, index) {
  if (!Number.isInteger(index) || index < 0 || index >= CAMPAIGN_LENGTH) return false;
  try {
    // Map rendering asks this 48 times; avoid cloning every full plan for each card.
    const completed = record(profile?.completed) ? profile.completed : {};
    for (let number = 1; number <= index; number++) {
      const id = `silicon-${String(number).padStart(2, '0')}`;
      const clear = own(completed, id) && completed[id];
      if (!record(clear) || !Number.isInteger(clear.stars) || clear.stars < 1 || clear.stars > 3 ||
          !finite(clear.cost) || !finite(clear.margin, -EPSILON, 10)) return false;
    }
    return true;
  } catch {
    return index === 0;
  }
}

/** saveDraft(Profile, levelId, State) -> Profile. Illegal geometry can be edited but never corrupts saves. */
export function saveDraft(profile, id, state) {
  const next = cloneProfile(profile);
  const draft = safeLevelId(id) ? sanitizeState(state) : null;
  if (draft) next.drafts = trimRecords({ ...next.drafts, [id]: draft });
  return next;
}

/** saveBest(Profile, levelId, official Result, State) -> Profile. Saves lean and stable independently. */
export function saveBest(profile, id, result, state) {
  const next = cloneProfile(profile);
  if (!safeLevelId(id) || result?.ok !== true || !finite(result.cost) || !finite(result.margin, -EPSILON, 10)) return next;
  const cleanState = sanitizeState(state);
  if (!cleanState) return next;
  const score = { state: cleanState, cost: result.cost, margin: Math.max(0, result.margin) };
  const previous = next.best[id] || {};
  const lean = !previous.lean || score.cost < previous.lean.cost - EPSILON ||
    (Math.abs(score.cost - previous.lean.cost) <= EPSILON && score.margin > previous.lean.margin + EPSILON);
  const stable = !previous.stable || score.margin > previous.stable.margin + EPSILON ||
    (Math.abs(score.margin - previous.stable.margin) <= EPSILON && score.cost < previous.stable.cost - EPSILON);
  next.best = trimRecords({ ...next.best, [id]: {
    lean: lean ? { ...score, state: sanitizeState(cleanState) } : previous.lean,
    stable: stable ? { ...score, state: sanitizeState(cleanState) } : previous.stable,
  } });
  return next;
}

/** awardClear(Profile, Level, official Result, State) -> Profile. No replay or endless currency farming. */
export function awardClear(profile, level, result, state) {
  let next = cloneProfile(profile);
  if (!level || !campaignNumber(level.id) || result?.ok !== true || !finite(result.cost) ||
      !finite(result.margin, -EPSILON, 10) || !sanitizeState(state)) return next;
  const previous = next.completed[level.id];
  const stars = 1 + (finite(level.parCost) && result.cost <= level.parCost + EPSILON ? 1 : 0) + (result.margin >= 0.035 - EPSILON ? 1 : 0);
  const maximumStars = Math.max(previous?.stars || 0, stars);
  const baseReward = !previous && finite(level.reward, 0, 10_000) ? Math.floor(level.reward) : 0;
  const improvementReward = previous ? Math.max(0, maximumStars - previous.stars) * 5 : 0;
  next.credits = Math.min(MAX_CREDITS, next.credits + baseReward + improvementReward);
  next.completed[level.id] = {
    stars: maximumStars,
    cost: Math.min(previous?.cost ?? Infinity, result.cost),
    margin: Math.max(previous?.margin ?? 0, result.margin),
  };
  next = saveBest(next, level.id, result, state);
  return next;
}

/** purchase(Profile, equipmentId) -> { profile, ok, message }. Equipment is permanent and optional. */
export function purchase(profile, id) {
  const next = cloneProfile(profile);
  const item = equipment.find(candidate => candidate.id === id);
  if (!item) return { profile: next, ok: false, message: '没有这个研发项目。' };
  if (next.gear.includes(id)) return { profile: next, ok: false, message: '这项装备已经研发完成。' };
  if (next.credits < item.cost) return { profile: next, ok: false, message: `资金不足，还需 ${item.cost - next.credits}。` };
  next.credits -= item.cost;
  next.gear.push(id);
  return { profile: next, ok: true, message: `${item.name}研发完成！基础装备仍可完成所有订单。` };
}
