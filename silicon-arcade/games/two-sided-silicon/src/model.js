// The one formal judge used by campaign, endless generation and the editor.
// All currents and voltages use the same normalized units: source V = 1.
const VIA = { normal: .025, underpass: .025, highflow: .006 };
const WELL_COST = { normal: 3, underpass: 7, highflow: 6 };
const CAPACITY = { normal: 2.5, underpass: 2.5, highflow: 6 };
const EPS = 1e-9;
const ownObject = value => value !== null && typeof value === 'object' && !Array.isArray(value);
const finite = value => typeof value === 'number' && Number.isFinite(value);

export function parseNode(node) {
  if (typeof node !== 'string' || !/^-?\d+,-?\d+$/.test(node)) return null;
  const [x, y] = node.split(',').map(Number);
  if (!Number.isSafeInteger(x) || !Number.isSafeInteger(y) || `${x},${y}` !== node) return null;
  return { x, y };
}

export function edgeKey(a, b) { return String(a) < String(b) ? `${a}|${b}` : `${b}|${a}`; }

export function neighbors(node, sizeOrLevel, height) {
  const p = parseNode(node);
  const size = typeof sizeOrLevel === 'number' ? { w: sizeOrLevel, h: height } : sizeOrLevel?.size || sizeOrLevel;
  if (!p || !size || !Number.isInteger(size.w) || !Number.isInteger(size.h)) return [];
  return [[p.x - 1, p.y], [p.x + 1, p.y], [p.x, p.y - 1], [p.x, p.y + 1]]
    .filter(([x, y]) => x >= 0 && y >= 0 && x < size.w && y < size.h).map(([x, y]) => `${x},${y}`);
}

export function cloneState(state) {
  try { return structuredClone(state); } catch { /* Corrupt imported data must remain recoverable. */ }
  return {
    positions: ownObject(state?.positions) ? { ...state.positions } : {},
    access: ownObject(state?.access) ? Object.fromEntries(Object.entries(state.access).map(([id, a]) => [id, ownObject(a) ? { ...a } : a])) : {},
    signal: ownObject(state?.signal) ? Object.fromEntries(Object.entries(state.signal).map(([id, edges]) => [id, Array.isArray(edges) ? [...edges] : edges])) : {},
    power: ownObject(state?.power) ? { ...state.power } : {}
  };
}

export function emptyState(level) {
  const state = { positions: {}, access: {}, signal: {}, power: {} };
  for (const mod of Array.isArray(level?.modules) ? level.modules : []) {
    state.positions[mod.id] = mod.node;
    const options = Array.isArray(mod.accessOptions) ? mod.accessOptions : [mod.node];
    const node = options.includes(mod.node) ? mod.node : options.find(n => distance(n, mod.node) <= 2) || options[0] || mod.node;
    state.access[mod.id] = { node, type: 'normal' };
  }
  for (const net of Array.isArray(level?.nets) ? level.nets : []) state.signal[net.id] = [];
  return state;
}

function distance(a, b) {
  const p = parseNode(a), q = parseNode(b);
  return p && q ? Math.abs(p.x - q.x) + Math.abs(p.y - q.y) : Infinity;
}

function arraySet(value) { return new Set(Array.isArray(value) ? value : []); }
function record(value) { return ownObject(value) ? value : {}; }
function symmetricCount(a, b) {
  let count = 0;
  for (const x of a) if (!b.has(x)) count++;
  for (const x of b) if (!a.has(x)) count++;
  return count;
}
function accessEqual(a, b) { return a?.node === b?.node && a?.type === b?.type; }
function positionDifference(a, b) {
  a = record(a); b = record(b);
  return [...new Set([...Object.keys(a), ...Object.keys(b)])].filter(id => a[id] !== b[id]).length;
}
function accessDifference(a, b) {
  a = record(a); b = record(b);
  return [...new Set([...Object.keys(a), ...Object.keys(b)])].filter(id => !accessEqual(a[id], b[id])).length;
}
function signalDifference(a, b) {
  a = record(a); b = record(b);
  return [...new Set([...Object.keys(a), ...Object.keys(b)])].reduce((n, id) => n + symmetricCount(arraySet(a[id]), arraySet(b[id])), 0);
}

// Either (initialState, finalState) or (level, finalState). Final edits count once;
// repainting an edge back to its initial width consumes no repair allowance.
export function stateDifference(initialOrLevel, state) {
  const initial = initialOrLevel?.size ? initialOrLevel.initial || emptyState(initialOrLevel) : initialOrLevel;
  const a = record(initial), b = record(state), ap = record(a.power), bp = record(b.power);
  const powerDiff = [...new Set([...Object.keys(ap), ...Object.keys(bp)])].filter(key => ap[key] !== bp[key]).length;
  return positionDifference(a.positions, b.positions) + accessDifference(a.access, b.access) + signalDifference(a.signal, b.signal) + powerDiff;
}

function addEdge(graph, a, b, conductance = 1) {
  if (!graph.has(a)) graph.set(a, new Map());
  if (!graph.has(b)) graph.set(b, new Map());
  graph.get(a).set(b, (graph.get(a).get(b) || 0) + conductance);
  graph.get(b).set(a, (graph.get(b).get(a) || 0) + conductance);
}

function reachable(graph, starts) {
  const visited = new Set(starts), queue = [...visited];
  for (let i = 0; i < queue.length; i++) for (const node of graph.get(queue[i])?.keys() || []) if (!visited.has(node)) { visited.add(node); queue.push(node); }
  return visited;
}

function shortestPath(graph, from, to) {
  if (from === to && from) return [from];
  if (!from || !to) return [];
  const visited = new Set([from]), queue = [from], prev = new Map();
  for (let i = 0; i < queue.length; i++) for (const node of graph.get(queue[i])?.keys() || []) {
    if (visited.has(node)) continue;
    visited.add(node); prev.set(node, queue[i]); queue.push(node);
    if (node === to) {
      const path = [to];
      while (path[0] !== from) path.unshift(prev.get(path[0]));
      return path;
    }
  }
  return [];
}

// Preconditioned conjugate gradient solves the grounded resistor Laplacian.
// Solving droop d = 1 - V gives A d = I and avoids subtracting boundary terms.
// This is actual KCL (parallel paths and loops therefore change the result).
function solveDroop(graph, connected, sources, loads) {
  const nodes = [...connected].filter(node => !sources.has(node)), index = new Map(nodes.map((n, i) => [n, i])), n = nodes.length;
  if (!n) return new Map();
  const diag = new Float64Array(n), rhs = new Float64Array(n), links = nodes.map(() => []);
  for (let i = 0; i < n; i++) {
    rhs[i] = loads.get(nodes[i]) || 0;
    for (const [next, g] of graph.get(nodes[i]) || []) {
      diag[i] += g;
      if (index.has(next)) links[i].push([index.get(next), g]);
    }
  }
  const multiply = vector => {
    const result = new Float64Array(n);
    for (let i = 0; i < n; i++) { result[i] = diag[i] * vector[i]; for (const [j, g] of links[i]) result[i] -= g * vector[j]; }
    return result;
  };
  const dot = (a, b) => { let sum = 0; for (let i = 0; i < n; i++) sum += a[i] * b[i]; return sum; };
  const x = new Float64Array(n), r = new Float64Array(rhs), z = Float64Array.from(r, (v, i) => v / diag[i]), p = new Float64Array(z);
  let rz = dot(r, z);
  const tolerance = Math.max(1e-24, dot(rhs, rhs) * 1e-22);
  for (let step = 0; dot(r, r) > tolerance && step < Math.max(100, n * 8); step++) {
    const ap = multiply(p), denominator = dot(p, ap);
    if (!(denominator > 0) || !Number.isFinite(denominator)) break;
    const alpha = rz / denominator;
    for (let i = 0; i < n; i++) { x[i] += alpha * p[i]; r[i] -= alpha * ap[i]; z[i] = r[i] / diag[i]; }
    const nextRz = dot(r, z), beta = rz === 0 ? 0 : nextRz / rz;
    for (let i = 0; i < n; i++) p[i] = z[i] + beta * p[i];
    rz = nextRz;
  }
  const ax = multiply(x);
  let residual = 0;
  for (let i = 0; i < n; i++) residual = Math.max(residual, Math.abs(ax[i] - rhs[i]));
  if (!Number.isFinite(residual) || residual > 1e-7) return null;
  return new Map(nodes.map((node, i) => [node, x[i]]));
}

export function evaluate(level, inputState, gear = ['underpass', 'heavy', 'highflow']) {
  const errors = [], layers = new Set();
  const add = (code, message, layer = 'both', details = {}) => {
    if (errors.length < 100) errors.push({ code, message, ...details });
    if (layer === 'both') { layers.add('front'); layers.add('back'); } else layers.add(layer);
  };
  const base = { ok: false, errors, cost: 0, signalLength: 0, powerLength: 0, wells: 0, diff: 0, signalResults: [], powerResults: [], voltages: {}, minVoltage: 0, margin: 0, frontOk: false, backOk: false, budgetOk: false };
  if (!ownObject(level) || !ownObject(level.size) || !Number.isInteger(level.size.w) || !Number.isInteger(level.size.h) || level.size.w < 1 || level.size.h < 1 || level.size.w * level.size.h > 4096 || !Array.isArray(level.modules) || !Array.isArray(level.nets) || !Array.isArray(level.sources)) {
    add('invalid-level', '订单网格或模块资料损坏。'); return base;
  }
  const state = record(inputState), positions = record(state.positions), access = record(state.access), signal = record(state.signal), power = record(state.power);
  for (const key of ['positions', 'access', 'signal', 'power']) if (!ownObject(state[key])) add('invalid-state', `方案中的 ${key} 数据格式不正确。`);
  const inGrid = node => { const p = parseNode(node); return !!p && p.x >= 0 && p.y >= 0 && p.x < level.size.w && p.y < level.size.h; };
  const frontBlocked = new Set(level.blockedFront || []), backBlocked = new Set(level.blockedBack || []), equipped = new Set(Array.isArray(gear) ? gear : []);
  const modules = new Map(), occupied = new Map(), wellGroups = new Map(), badAccess = new Set();
  for (const mod of level.modules) {
    if (!ownObject(mod) || typeof mod.id !== 'string' || modules.has(mod.id)) { add('invalid-level', '模块标识重复或损坏。'); continue; }
    modules.set(mod.id, mod);
    const node = positions[mod.id];
    if (!inGrid(node) || !Array.isArray(mod.slots) || !mod.slots.includes(node)) add('module-position', `${mod.name || mod.id} 必须放在指定的楼位。`, 'front', { nodes: typeof node === 'string' ? [node] : [] });
    if (frontBlocked.has(node)) add('module-obstacle', `${mod.name || mod.id} 占用了正面禁布区。`, 'front', { nodes: [node] });
    if (occupied.has(node)) add('module-overlap', '两个模块不能占用同一楼位。', 'front', { nodes: [node] });
    else if (inGrid(node)) occupied.set(node, mod.id);
    if (!finite(mod.current) || mod.current < 0) { add('invalid-level', `${mod.name || mod.id} 的负载数值损坏。`); badAccess.add(mod.id); }
    const well = access[mod.id];
    if (!ownObject(well) || !inGrid(well.node) || !Object.hasOwn(VIA, well.type)) { add('access-invalid', `${mod.name || mod.id} 的接入井不合法。`, 'both'); badAccess.add(mod.id); continue; }
    if (!Array.isArray(mod.accessOptions) || !mod.accessOptions.includes(well.node) || distance(well.node, node) > 2) { add('access-position', `${mod.name || mod.id} 的接入井必须位于许可位置，且距楼位不超过 2 格。`, 'both', { nodes: [well.node] }); badAccess.add(mod.id); }
    if (backBlocked.has(well.node)) { add('access-obstacle', `${mod.name || mod.id} 的接入井占用了背面禁布区。`, 'back', { nodes: [well.node] }); badAccess.add(mod.id); }
    if (well.type !== 'normal' && !equipped.has(well.type)) { add('gear-access', `尚未装备${well.type === 'underpass' ? '隧道井' : '高流井'}。`, 'both', { nodes: [well.node] }); badAccess.add(mod.id); }
    if (!wellGroups.has(well.node)) wellGroups.set(well.node, { type: well.type, modules: [] });
    const group = wellGroups.get(well.node);
    if (group.type !== well.type) { add('access-type-conflict', '共享接入点必须使用同一种接入井。', 'both', { nodes: [well.node] }); for (const id of [...group.modules, mod.id]) badAccess.add(id); }
    group.modules.push(mod.id);
  }
  for (const id of Object.keys(positions)) if (!modules.has(id)) add('unknown-module', `方案含未知模块 ${id}。`, 'front');
  for (const id of Object.keys(access)) if (!modules.has(id)) add('unknown-access', `方案含未知接入 ${id}。`, 'back');

  const parseEdge = (key, layer) => {
    if (typeof key !== 'string') { add('edge-invalid', '线路必须是网格边。', layer); return null; }
    const parts = key.split('|');
    if (parts.length !== 2 || !inGrid(parts[0]) || !inGrid(parts[1]) || distance(parts[0], parts[1]) !== 1 || key !== edgeKey(parts[0], parts[1])) { add('edge-invalid', '线路只能连接相邻的网格点。', layer, { edges: [key] }); return null; }
    return parts;
  };
  const signalResults = [], netIds = new Set(), netNodes = new Map();
  let signalLength = 0;
  for (const net of level.nets) {
    if (!ownObject(net) || typeof net.id !== 'string' || netIds.has(net.id) || !modules.has(net.from) || !modules.has(net.to)) { add('invalid-level', '信号端点或标识损坏。', 'front'); continue; }
    netIds.add(net.id);
    const graph = new Map(), nodes = new Set(), route = signal[net.id], before = errors.length;
    if (!Array.isArray(route)) add('signal-invalid', `${net.name || net.id} 的线路资料损坏。`, 'front');
    const edgeSet = arraySet(route);
    signalLength += edgeSet.size;
    if (Array.isArray(route) && route.length !== edgeSet.size) add('signal-duplicate', `${net.name || net.id} 含重复线段。`, 'front');
    for (const key of edgeSet) {
      const edge = parseEdge(key, 'front');
      if (!edge) continue;
      addEdge(graph, ...edge);
      for (const node of edge) {
        nodes.add(node);
        if (frontBlocked.has(node)) add('signal-obstacle', `${net.name || net.id} 经过正面禁布区。`, 'front', { nodes: [node], edges: [key] });
        const owner = occupied.get(node);
        if (owner && owner !== net.from && owner !== net.to) add('signal-module', `${net.name || net.id} 不能穿过其他模块。`, 'front', { nodes: [node], edges: [key] });
        const well = wellGroups.get(node);
        const ownEndpoint = well?.modules.some(id => (id === net.from || id === net.to) && positions[id] === node);
        if (well && well.type !== 'underpass' && !ownEndpoint) add('signal-well', `${net.name || net.id} 被接入井截断；移动接入位置或使用隧道井。`, 'front', { nodes: [node], edges: [key] });
      }
    }
    const from = positions[net.from], to = positions[net.to], path = shortestPath(graph, from, to), connected = path.length > 0;
    const attached = reachable(graph, typeof from === 'string' ? [from] : []), drafts = [...nodes].filter(node => !attached.has(node));
    if (drafts.length) add('signal-draft', `${net.name || net.id} 含未接入主通路的孤立线段。`, 'front', { nodes: drafts });
    if (inGrid(from)) nodes.add(from);
    if (inGrid(to)) nodes.add(to);
    const length = connected ? path.length - 1 : Infinity;
    if (!connected) add('signal-disconnected', `${net.name || net.id} 尚未连通两端。`, 'front', { nodes: [from, to].filter(n => typeof n === 'string') });
    if (!finite(net.maxLength) || net.maxLength < 0) add('invalid-level', `${net.name || net.id} 的长度限制损坏。`, 'front');
    else if (connected && length > net.maxLength + EPS) add('signal-length', `${net.name || net.id} 最短通路为 ${length} 格，超过 ${net.maxLength} 格限制。`, 'front', { nodes: path });
    signalResults.push({ id: net.id, name: net.name || net.id, connected, length, ok: errors.length === before, path });
    netNodes.set(net.id, { net, nodes });
  }
  for (const id of Object.keys(signal)) if (!netIds.has(id)) add('unknown-net', `方案含未知信号网 ${id}。`, 'front');
  const nodeNets = new Map();
  for (const [id, item] of netNodes) for (const node of item.nodes) {
    for (const otherId of nodeNets.get(node) || []) {
      const other = netNodes.get(otherId).net, modId = occupied.get(node);
      const commonEndpoint = modId && [item.net.from, item.net.to].includes(modId) && [other.from, other.to].includes(modId);
      if (!commonEndpoint) {
        add('signal-conflict', `${item.net.name || id} 与 ${other.name || otherId} 在同一网格点相遇。`, 'front', { nodes: [node] });
        for (const result of signalResults) if (result.id === id || result.id === otherId) result.ok = false;
      }
    }
    if (!nodeNets.has(node)) nodeNets.set(node, []);
    nodeNets.get(node).push(id);
  }

  const powerGraph = new Map();
  let powerLength = 0, powerCost = 0;
  for (const [key, width] of Object.entries(power)) {
    powerLength++;
    if (![1, 2, 3].includes(width)) { add('power-width', '电轨宽度必须为 1、2 或 3。', 'back', { edges: [key] }); continue; }
    powerCost += width * 1.5;
    if (width === 3 && !equipped.has('heavy')) add('gear-width', '尚未装备三倍宽电轨。', 'back', { edges: [key] });
    const edge = parseEdge(key, 'back');
    if (!edge) continue;
    addEdge(powerGraph, ...edge, width / .018);
    for (const node of edge) if (backBlocked.has(node)) add('power-obstacle', '电轨经过背面禁布区。', 'back', { nodes: [node], edges: [key] });
  }
  const allSources = new Set(level.sources.filter(inGrid));
  if (allSources.size !== level.sources.length || !allSources.size) add('invalid-level', '订单必须包含合法且不重复的供电源。', 'back');
  for (const node of allSources) if (backBlocked.has(node)) add('source-obstacle', '供电源占用了背面禁布区。', 'back', { nodes: [node] });
  for (const node of wellGroups.keys()) if (!powerGraph.has(node)) powerGraph.set(node, new Map());
  const modes = Array.isArray(level.modes) && level.modes.length ? level.modes : [{ name: '常态', loads: {} }];
  const powerResults = [...modules.values()].map(mod => ({ id: mod.id, name: mod.name || mod.id, voltage: Infinity, worstMode: '', connected: true, ok: !badAccess.has(mod.id) }));
  const voltages = {};
  let minVoltage = 1;
  const threshold = finite(level.minVoltage) ? level.minVoltage : 0;
  if (!finite(level.minVoltage) || level.minVoltage < 0 || level.minVoltage > 1) add('invalid-level', '最低工作电压限制损坏。', 'back');
  for (let modeIndex = 0; modeIndex < modes.length; modeIndex++) {
    const mode = record(modes[modeIndex]), modeName = typeof mode.name === 'string' ? mode.name : `工况 ${modeIndex + 1}`, modeLoads = record(mode.loads);
    const disabled = new Set(Array.isArray(mode.disabledSources) ? mode.disabledSources : []), sources = new Set([...allSources].filter(n => !disabled.has(n))), connected = reachable(powerGraph, sources), loads = new Map(), currents = new Map();
    for (const node of disabled) if (!allSources.has(node)) add('invalid-level', `${modeName} 停用了不存在的电源。`, 'back', { nodes: [node] });
    for (const [id, value] of Object.entries(modeLoads)) if (!modules.has(id) || !finite(value) || value < 0) add('invalid-level', `${modeName} 的负载倍率损坏。`, 'back');
    for (const mod of modules.values()) {
      const multiplier = Object.hasOwn(modeLoads, mod.id) && finite(modeLoads[mod.id]) && modeLoads[mod.id] >= 0 ? modeLoads[mod.id] : 1;
      const current = finite(mod.current) && mod.current >= 0 ? mod.current * multiplier : 0;
      currents.set(mod.id, current);
      const well = access[mod.id];
      if (ownObject(well) && inGrid(well.node)) loads.set(well.node, (loads.get(well.node) || 0) + current);
    }
    for (const [node, group] of wellGroups) {
      const total = group.modules.reduce((sum, id) => sum + currents.get(id), 0);
      if (total > CAPACITY[group.type] + EPS) {
        add('well-capacity', `${modeName}：共享接入井承载 ${Number(total.toFixed(3))}，超过 ${CAPACITY[group.type]} 的容量。`, 'back', { nodes: [node] });
        for (const result of powerResults) if (group.modules.includes(result.id)) result.ok = false;
      }
    }
    const disconnectedDrafts = [...powerGraph.keys()].filter(node => !connected.has(node));
    if (disconnectedDrafts.length) add('power-disconnected', `${modeName}：有电轨或接入井未连接到工作的电源。`, 'back', { nodes: disconnectedDrafts });
    const droop = solveDroop(powerGraph, connected, sources, loads);
    if (!droop) add('solver-failed', `${modeName} 的电网数值求解未收敛。`, 'back');
    const modeVoltages = new Map([...connected].map(node => [node, sources.has(node) ? 1 : 1 - (droop?.get(node) ?? 1)]));
    for (const node of powerGraph.keys()) {
      const voltage = modeVoltages.get(node) ?? 0;
      voltages[node] = Object.hasOwn(voltages, node) ? Math.min(voltages[node], voltage) : voltage;
    }
    for (const node of allSources) {
      const voltage = modeVoltages.get(node) ?? 0;
      voltages[node] = Object.hasOwn(voltages, node) ? Math.min(voltages[node], voltage) : voltage;
    }
    for (const result of powerResults) {
      const well = access[result.id], validWell = ownObject(well) && Object.hasOwn(VIA, well.type), isConnected = validWell && connected.has(well.node);
      const voltage = isConnected ? (modeVoltages.get(well.node) ?? 0) - currents.get(result.id) * VIA[well.type] : 0;
      if (voltage < result.voltage) { result.voltage = voltage; result.worstMode = modeName; }
      result.connected = result.connected && !!isConnected;
      if (!isConnected || !finite(voltage) || voltage + EPS < threshold) {
        result.ok = false;
        if (isConnected) add('voltage', `${modeName}：${result.name} 电压 ${voltage.toFixed(3)}，低于 ${threshold.toFixed(3)}。`, 'back', { nodes: [well.node] });
      }
      minVoltage = Math.min(minVoltage, voltage);
    }
  }
  for (const result of powerResults) if (!finite(result.voltage)) { result.voltage = 0; result.connected = result.ok = false; }
  const wells = wellGroups.size, wellCost = [...wellGroups.values()].reduce((sum, group) => sum + WELL_COST[group.type], 0), cost = signalLength + powerCost + wellCost;
  const initial = ownObject(level.initial) ? level.initial : emptyState(level), diff = stateDifference(initial, state), budgets = record(level.budgets);
  for (const [key, value, label] of [['cost', cost, '建设点'], ['signal', signalLength, '信号线'], ['power', powerLength, '电轨'], ['wells', wells, '接入井']]) {
    if (!finite(budgets[key]) || budgets[key] < 0) add('invalid-level', `${label}预算损坏。`, 'budget');
    else if (value > budgets[key] + EPS) add(`${key}-budget`, `${label}使用 ${Number(value.toFixed(2))}，超过预算 ${budgets[key]}。`, 'budget');
  }
  if (Object.hasOwn(budgets, 'diff')) {
    if (!finite(budgets.diff) || budgets.diff < 0) add('invalid-level', '改造额度损坏。', 'budget');
    else if (diff > budgets.diff) add('diff-budget', `最终改动 ${diff} 项，超过改造额度 ${budgets.diff}。`, 'budget');
  }
  if (level.frontLocked && (positionDifference(initial.positions, positions) || signalDifference(initial.signal, signal))) add('front-locked', '本订单正面已封装，楼位和信号线路必须保持原样。', 'front');
  if (level.accessLocked && accessDifference(initial.access, access)) add('access-locked', '本订单接入井已固定，不能改变接入位置或类型。', 'both');
  return { ok: errors.length === 0, errors, cost, signalLength, powerLength, wells, diff, signalResults, powerResults, voltages, minVoltage, margin: minVoltage - (finite(level.minVoltage) ? level.minVoltage : 0), frontOk: !layers.has('front'), backOk: !layers.has('back'), budgetOk: !layers.has('budget') };
}
