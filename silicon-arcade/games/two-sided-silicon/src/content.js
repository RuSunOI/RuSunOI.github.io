import { evaluate, edgeKey, stateDifference } from './model.js';

// Every city below has an authored, explicit two-face witness. Budgets and
// voltage limits are derived from that witness by the same evaluator as play.
const copy = value => JSON.parse(JSON.stringify(value));
const node = (x, y) => `${x},${y}`;
const xy = point => point.split(',').map(Number);
function walk(...points) {
  const result = [points[0]];
  for (let i = 1; i < points.length; i++) {
    let [x, y] = xy(result.at(-1));
    const [tx, ty] = xy(points[i]);
    if (x !== tx && y !== ty) throw new Error(`Authored diagonal ${result.at(-1)} → ${points[i]}`);
    while (x !== tx || y !== ty) {
      x += Math.sign(tx - x); y += Math.sign(ty - y);
      result.push(node(x, y));
    }
  }
  return result;
}
function route(...points) {
  const vertices = walk(...points);
  return vertices.slice(1).map((v, i) => edgeKey(vertices[i], v));
}
const M = (id, name, at, current = .65, options = [], slots = []) => ({
  id, name, node: at, current, accessOptions: [...new Set([at, ...options])], slots: [...new Set([at, ...slots])],
});
const N = (id, from, to, points, slack = 2) => ({ id, from, to, points, slack });
const P = (width, ...points) => ({ width, points });
const colors = ['#51e4cf', '#f5bd64', '#d18bff', '#75bfff', '#ff91ac', '#aff075'];

export const chapters = [
  { id: 0, name: '一 · 点亮街区', description: '先接通正面信号，再亲手补好背面电路。认识会挡路的接入井。' },
  { id: 1, name: '二 · 走廊争夺', description: '两种网络共用一张城市轮廓，狭窄走廊须留给真正需要它的人。' },
  { id: 2, name: '三 · 搬迁事务所', description: '模块可以搬到标记槽位。短信号与近电源之间，需要找折中。' },
  { id: 3, name: '四 · 主干加固', description: '加宽导线改变真实电压。识别公共瓶颈，避免把金属花在末梢。' },
  { id: 4, name: '五 · 接入公约', description: '共用井节省材料，却有电流上限；不同负载模式改变最坏情况。' },
  { id: 5, name: '六 · 双入口时代', description: '预告一座电源停机。建立能应付每一种工况的供电网络。' },
  { id: 6, name: '七 · 城市改造局', description: '正面已经投产。以有限最终差异改好背面，试错与撤销免费。' },
  { id: 7, name: '八 · 整城签核', description: '把搬迁、通道、电流、工作模式和故障合并，完成完整城市订单。' },
];

function make(spec, index) {
  const chapter = Math.floor(index / 6);
  const reference = { positions: {}, access: {}, signal: {}, power: {} };
  for (const m of spec.modules) {
    reference.positions[m.id] = spec.positions?.[m.id] || m.node;
    reference.access[m.id] = { node: spec.access?.[m.id] || reference.positions[m.id], type: 'normal' };
  }
  const nets = spec.nets.map((n, i) => {
    reference.signal[n.id] = route(...n.points);
    return { id: n.id, name: n.name || `链路 ${i + 1}`, from: n.from, to: n.to, maxLength: reference.signal[n.id].length + n.slack, color: colors[i % colors.length] };
  });
  for (const p of spec.back) for (const edge of route(...p.points)) reference.power[edge] = Math.max(reference.power[edge] || 0, p.width);
  const initial = copy(reference);
  if (spec.start === 'district') {
    for (const n of nets) initial.signal[n.id] = reference.signal[n.id].slice(0, Math.ceil(reference.signal[n.id].length * .62));
    Object.keys(initial.power).forEach((e, i) => { if (i % 5 === 3) delete initial.power[e]; });
  } else if (spec.start === 'weak') {
    Object.keys(initial.power).forEach(e => { initial.power[e] = 1; });
  } else if (!spec.frontLocked && !spec.startAccess && !spec.startPositions) {
    const n = nets.at(-1);
    initial.signal[n.id] = initial.signal[n.id].slice(0, -Math.min(spec.missingSignal || 1, initial.signal[n.id].length));
  }
  for (const [id, at] of Object.entries(spec.startAccess || {})) initial.access[id] = { node: at, type: 'normal' };
  for (const [id, at] of Object.entries(spec.startPositions || {})) initial.positions[id] = at;
  if(spec.missingSignal&&(spec.startAccess||spec.startPositions)){
    const last=nets.at(-1);initial.signal[last.id]=initial.signal[last.id].slice(0,-spec.missingSignal);
  }
  for (const e of spec.removePower || []) delete initial.power[edgeKey(e[0], e[1])];
  // Construction is genuinely a two-face build. Placement teaching keeps
  // short entrance stubs; advanced commissions provide no solved front route.
  // Protected retrofit orders instead preserve every already-running signal.
  if (index >= 12 && !spec.frontLocked) {
    for (const n of nets) initial.signal[n.id] = index < 18
      ? reference.signal[n.id].slice(0, Math.max(1, Math.floor(reference.signal[n.id].length * .35)))
      : [];
    const keys = Object.keys(reference.power);
    initial.power = Object.fromEntries(keys.slice(0, Math.max(1, Math.floor(keys.length * .52))).map(e => [e,reference.power[e]]));
  }
  const level = {
    id: spec.id || `silicon-${String(index + 1).padStart(2, '0')}`, chapter, title: spec.title,
    subtitle: spec.subtitle, brief: spec.brief, size: { w: spec.w, h: spec.h },
    modules: spec.modules, nets, sources: spec.sources, blockedFront: spec.front || [], blockedBack: spec.backBlocks || [],
    budgets: { cost: 100000, signal: 100000, power: 100000, wells: 100 }, minVoltage: 0,
    modes: spec.modes || [{ name: '日常运行', loads: {} }], initial, reference,
    hints: spec.hints, reward: 35 + chapter * 12 + (index % 6) * 3,
    frontLocked: !!spec.frontLocked, accessLocked: !!spec.accessLocked,
    tags: [...new Set([...(spec.tags || []),
      ...(index >= 12 && !spec.frontLocked ? ['construction'] : []),
      ...(spec.modes?.length > 1 ? ['modes'] : []),
      ...(spec.modes?.some(m => m.disabledSources?.length) ? ['source-fault'] : []),
      ...(spec.diff !== undefined ? ['retrofit'] : []),
    ])], parCost: 0,
  };
  const measured = evaluate(level, reference, []);
  if (!measured.ok) throw new Error(`${level.id} witness geometry: ${JSON.stringify(measured.errors)}`);
  if (measured.minVoltage < .54) throw new Error(`${level.id} witness voltage too low: ${measured.minVoltage}`);
  level.minVoltage = Math.max(.52, Math.min(.96, Math.floor((measured.minVoltage - (spec.voltageSlack ?? .028)) * 1000) / 1000));
  level.parCost = measured.cost;
  level.budgets = {
    cost: Math.ceil(measured.cost + (spec.costSlack ?? Math.max(4, measured.cost * .075))),
    signal: measured.signalLength + (spec.signalSlack ?? Math.max(2, nets.length)),
    power: measured.powerLength + (spec.powerSlack ?? 3),
    wells: measured.wells + (spec.wellSlack ?? 0),
  };
  if (spec.diff !== undefined) level.budgets.diff = stateDifference(reference, initial) + spec.diff;
  if (evaluate(level, initial, []).ok) throw new Error(`${level.id} initial city already passes`);
  const signed = evaluate(level, reference, []);
  if (!signed.ok) throw new Error(`${level.id} witness signoff: ${JSON.stringify(signed.errors)}`);
  return level;
}

const orders = [
  {
    title: '最后一格', subtitle: '信号入门 · 背面已投产', w: 6, h: 5,
    brief: '青色链路只差最后一格。选“信号”，从正面 (3,2) 接到计算站 (4,2)，然后签核。背面与接入已经准备好。',
    modules: [M('a','输入港','1,2',.35),M('b','计算站','4,2',.35)],
    nets: [N('a','a','b',['1,2','4,2'],0)], sources:['0,4'],
    back:[P(1,'0,4','4,4','4,2'),P(1,'1,4','1,2')], accessLocked:true,
    hints:['两面状态分别列出，先看正面缺少哪条连接。','青色线已到 (3,2)，终点在右边一格。','选信号链路 1，点击 (3,2) 再点击 (4,2)；背面不用改。'],tags:['tutorial','one-edge','prebuilt-back'],costSlack:2,signalSlack:0,
  },
  {
    title:'绕过雕像',subtitle:'信号入门 · 禁布点',w:5,h:5,
    brief:'中央黑色格不可走线。青色链路已绕过上方，补上 (3,1)→(3,2)→(4,2) 两格。正面信号必须真正连通。',
    modules:[M('a','邮局','0,2',.35),M('b','档案室','4,2',.35)],nets:[N('a','a','b',['0,2','1,2','1,1','3,1','3,2','4,2'],0)],front:['2,2'],
    sources:['0,4'],back:[P(1,'0,4','4,4','4,2'),P(1,'0,4','0,2')],missingSignal:2,accessLocked:true,
    hints:['禁布点会切断最短直线，黑格不能穿越。','上方的绕行已完成，注意右端两格缺口。','补 (3,1) 到 (3,2)，再接到 (4,2)。'],tags:['tutorial','obstacle'],signalSlack:0,
  },
  {
    title:'翻到背面',subtitle:'供电入门 · 正面保护',w:6,h:5,
    brief:'正面已经锁定。选“铜线 1×”，在背面补上 (4,3) 到 (4,2) 一格；橙色电源就能抵达档案室。接入井连接两面。',
    modules:[M('a','输入港','1,1',.4),M('b','档案室','4,1',.4)],nets:[N('a','a','b',['1,1','4,1'],0)],sources:['0,3'],
    back:[P(1,'0,3','4,3','4,1'),P(1,'1,3','1,1')],frontLocked:true,accessLocked:true,removePower:[['4,3','4,2']],diff:0,
    hints:['青色连通不等于整城合格，背面仍有一个缺口。','档案室的供电支路在 (4,3) 和 (4,2) 之间断开。','选铜线 1×，在背面点击 (4,3) 再点击 (4,2)。'],tags:['tutorial','front-locked','one-edge'],
  },
  {
    title:'井口让行',subtitle:'两面耦合 · 接入位置',w:6,h:5,
    brief:'输入港的井口正压在青色直路上。把它挪到允许的 (1,3)，信号走廊会立即释放，背面支路也已在那里等候。',
    modules:[M('a','输入港','1,2',.55,['1,3','2,2']),M('b','工坊','4,2',.55,['4,3'])],nets:[N('a','a','b',['1,2','4,2'],0)],sources:['0,4'],
    access:{a:'1,3',b:'4,3'},startAccess:{a:'2,2'},back:[P(1,'0,4','4,4','4,3'),P(1,'1,4','1,3')],
    hints:['井口会占掉正面同坐标。供电与信号的地图并非互不相干。','当前输入港接入在 (2,2)，它堵住了青色线。','选输入港，用接入工具选择 (1,3)。该井不再压住横向信号线。'],tags:['access-conflict','two-face'],signalSlack:0,
  },
  {
    title:'同一口井',subtitle:'共享接入 · 一口井预算',w:5,h:5,
    brief:'两座轻负载建筑可以共用 (1,1) 的井。订单只支付一口井；分别在建筑上打井会超预算，也接不上现成电源。',
    modules:[M('a','解码室','1,2',.7,['1,1']),M('b','缓存室','2,1',.8,['1,1'])],nets:[N('a','a','b',['1,2','2,2','2,1'],0)],sources:['0,0'],
    access:{a:'1,1',b:'1,1'},startAccess:{a:'1,2',b:'2,1'},back:[P(1,'0,0','1,0','1,1')],
    hints:['井数按不同坐标计数，两座建筑可以共享一个接入点。','两座建筑的共同候选点是 (1,1)，总电流没有超过 2.5。','分别选择解码室和缓存室，把接入都设在 (1,1)。'],tags:['shared-well','well-budget'],costSlack:1,signalSlack:0,powerSlack:1,
  },
  {
    title:'小街区开张',subtitle:'第一张完整联动订单',w:7,h:5,
    brief:'三座建筑共享中央处理站的信号端点。井口放在街道外侧，再补好通往显示站的末段。两条不同链路可以共用同一建筑端点。',
    modules:[M('a','输入港','1,1',.5,['1,0']),M('b','处理站','3,2',.6,['3,3','4,2']),M('c','显示站','5,1',.45,['5,0'])],
    nets:[N('a','a','b',['1,1','1,2','3,2']),N('b','b','c',['3,2','4,2','4,1','5,1'])],sources:['3,4'],
    access:{a:'1,0',b:'3,3',c:'5,0'},startAccess:{b:'4,2'},missingSignal:1,back:[P(1,'3,4','3,3'),P(1,'3,4','1,4','1,0'),P(1,'3,4','5,4','5,0')],
    hints:['中央井堵在显示链路上，显示站前也有一格缺口；两项都要修。','处理站可以接入 (3,3)，这里已连到背面电源。','把处理站井口移到 (3,3)，再选链路 2 补上 (4,1)→(5,1)，检查两条链路均连通。'],tags:['shared-endpoint','access-conflict','chapter-finale'],
  },
  {
    title:'天桥下的分流',subtitle:'长路留给可绕行的链路',w:7,h:7,
    brief:'南北链路只能走中央，东西链路需从北侧绕行。不同链路不能交叉成短路；井口也必须离开两条走廊。',
    modules:[M('a','西港','0,2',.4,['0,3']),M('b','东港','6,2',.4,['6,3']),M('c','北库','3,1',.4,['2,1']),M('d','南库','3,5',.4,['2,5'])],
    nets:[N('a','a','b',['0,2','0,0','6,0','6,2'],0),N('b','c','d',['3,1','3,5'],0)],sources:['0,6','6,6'],
    access:{a:'0,3',b:'6,3',c:'2,1',d:'2,5'},back:[P(1,'0,6','6,6'),P(1,'0,6','0,3'),P(1,'6,6','6,3'),P(1,'2,6','2,1')],front:['1,2','2,2','4,2','5,2'],start:'district',
    hints:['黄色南北线的长度上限没有给绕路空间。','青色链路可走 y=0 的外环，避免经过黄色链路的节点。','先完成中央 (3,1)→(3,5)，再让西港经 (0,0) 和 (6,0) 绕到东港。'],tags:['crossing-priority','two-nets'],
  },
  {
    title:'窄门两用',subtitle:'接入井释放唯一出口',w:7,h:5,
    brief:'设备区把可用正面压成一条弯巷。南侧井口堵住唯一出口，把井移到建筑自己的端点上，再完成折线路径。',
    modules:[M('a','调度室','1,1',.7,['1,2']),M('b','南工厂','5,3',.7,['4,3'])],nets:[N('a','a','b',['1,1','3,1','3,3','5,3'],0)],sources:['0,4','6,4'],
    startAccess:{b:'4,3'},back:[P(2,'0,4','6,4'),P(1,'1,4','1,1'),P(1,'5,4','5,3')],front:['2,2','4,2','4,1','2,3'],
    hints:['转角通道已经很短，再绕会超过链路限长。','南工厂的候选接入 (4,3) 正好是最后一段通道。','把南工厂接入改为它自己的 (5,3)，就能接通 (3,3)→(5,3)。'],tags:['access-conflict','narrow-door'],signalSlack:0,
  },
  {
    title:'双岸货运',subtitle:'背面禁布与正面禁布各自生效',w:8,h:6,
    brief:'正面货运走北岸，电源走南岸。背面中间有施工区，不能照抄正面路线；两条背面支路都要接上。',
    modules:[M('a','西仓','1,1',.6,['1,2']),M('b','东仓','6,1',.6,['6,2']),M('c','维修站','4,4',.5,['4,5'])],nets:[N('a','a','b',['1,1','6,1']),N('b','b','c',['6,1','7,1','7,4','4,4'])],
    access:{a:'1,2',b:'6,2',c:'4,5'},sources:['0,5','7,5'],back:[P(1,'0,5','7,5'),P(1,'1,5','1,2'),P(1,'6,5','6,2')],backBlocks:['2,2','3,2','4,2','5,2','3,3'],front:['3,3','4,3'],start:'district',
    hints:['黑格的面不同：正面禁布不自动等于背面禁布。','背面施工区堵在 y=2 中段，南侧 y=5 保持开放。','从两侧电源连通南岸主干，再沿 x=1 与 x=6 分别向上供电。'],tags:['asymmetric-obstacles','branch-route'],
  },
  {
    title:'内环邮路',subtitle:'绕井的信号闭环形街区',w:7,h:7,
    brief:'中央园区挡住直线。两条信号分别从左右外侧进入园区端点，背面接入统一放在南侧。',
    modules:[M('a','西站','1,1',.55,['1,2']),M('b','园区','3,5',.8,['3,6']),M('c','东站','5,1',.55,['5,2'])],
    nets:[N('a','a','b',['1,1','0,1','0,5','3,5'],0),N('b','c','b',['5,1','6,1','6,5','3,5'],0)],access:{a:'1,2',b:'3,6',c:'5,2'},sources:['3,6'],
    back:[P(2,'3,6','1,6','1,2'),P(2,'3,6','5,6','5,2')],front:['2,2','3,2','4,2','2,3','3,3','4,3','2,4','3,4','4,4'],start:'district',
    hints:['两条链路都能到园区，但不能在园区外共用节点。','中央黑格迫使链路分别沿 x=0 和 x=6 走外环。','左站走 (0,1)→(0,5)，右站走 (6,1)→(6,5)，都在园区端点汇合。'],tags:['obstacle-island','shared-endpoint'],signalSlack:0,
  },
  {
    title:'短路街的住户',subtitle:'模块本体也是正面占用',w:8,h:5,
    brief:'中间变电室没有信号任务，却仍占用正面格子。货运信号需走上方，不能穿过它的建筑或井口。',
    modules:[M('a','西港','1,2',.45,['1,3']),M('b','东港','6,2',.45,['6,3']),M('c','变电室','3,2',.9,['3,3'])],nets:[N('a','a','b',['1,2','1,1','6,1','6,2'],0)],sources:['3,4'],
    access:{a:'1,3',b:'6,3',c:'3,3'},back:[P(2,'3,4','1,4','1,3'),P(2,'3,4','6,4','6,3'),P(1,'3,4','3,3')],front:['3,0','4,0'],start:'district',
    hints:['即使建筑没有青色线，它也不能被别人的信号穿过。','上方 y=1 的整条街能避开变电室及三口井。','西港先上到 (1,1)，走到 (6,1)，再向下接东港。'],tags:['module-obstacle','non-signal-load'],
  },
  {
    title:'双面通道审计',subtitle:'两网两门 · 第一章综合',w:9,h:7,
    brief:'两条互不相交的货运线穿过不同门，背面主干从左右供电。检查井位、禁布点和所有预算，完成通道审计。',
    modules:[M('a','左上港','1,1',.6,['1,0']),M('b','右上港','7,1',.6,['7,0']),M('c','左下港','1,5',.6,['1,6']),M('d','右下港','7,5',.6,['7,6'])],
    nets:[N('a','a','b',['1,1','1,2','7,2','7,1']),N('b','c','d',['1,5','1,4','7,4','7,5'])],access:{a:'1,0',b:'7,0',c:'1,6',d:'7,6'},sources:['0,3','8,3'],
    back:[P(2,'0,3','8,3'),P(1,'1,3','1,0'),P(1,'7,3','7,0'),P(1,'1,3','1,6'),P(1,'7,3','7,6')],front:['3,1','4,1','5,1','3,5','4,5','5,5'],backBlocks:['4,2','4,4'],start:'district',
    hints:['两条链路分别有一条开放横街，不必争抢中线。','正面用 y=2 与 y=4；背面电源主干使用 y=3。','四口井留在 y=0 和 y=6，给正面两条横街留出连续通道。'],tags:['two-nets','asymmetric-obstacles','chapter-finale'],
  },
  {
    title:'缓存搬家',subtitle:'槽位教学 · 短路也要能供电',w:7,h:5,
    brief:'缓存室可从 (5,2) 搬到 (3,2)。旧位置超过这张订单的信号限长；近处的供电井在 (3,3)，搬迁后要重新映射接入。',
    modules:[M('a','计算站','1,2',.8,['1,3']),M('b','缓存室','5,2',.65,['3,3','5,3'],['3,2'])],positions:{b:'3,2'},access:{a:'1,3',b:'3,3'},startPositions:{b:'5,2'},startAccess:{b:'5,3'},
    nets:[N('a','a','b',['1,2','3,2'],0)],sources:['0,4'],back:[P(2,'0,4','3,4','3,3'),P(1,'1,4','1,3')],
    hints:['虚线标记的槽位才允许摆放模块，任意空格不能搬入。','缓存室在 (3,2) 时，距计算站只有两格。','把缓存室搬到 (3,2)，再把它的接入改成 (3,3)。'],tags:['placement','short-signal'],signalSlack:0,
  },
  {
    title:'电源边的取舍',subtitle:'信号近端与电源近端',w:8,h:6,
    brief:'把运算室放在极右虽靠近电源，却拉长货运线。中间槽位兼顾三格信号与南侧电源分支。',
    modules:[M('a','输入港','1,2',.5,['1,3']),M('b','运算室','6,2',1.15,['4,3','6,3'],['4,2','3,2'])],positions:{b:'4,2'},access:{a:'1,3',b:'4,3'},startPositions:{b:'6,2'},startAccess:{b:'6,3'},
    nets:[N('a','a','b',['1,2','4,2'],0)],sources:['7,5'],back:[P(2,'7,5','1,5','1,3'),P(2,'4,5','4,3')],front:['2,1','3,1','4,1'],
    hints:['只看电源距离会错过正面限长。两个面的硬条件都要合格。','(4,2) 留有连续直线，并且 (4,3) 可接近南侧主干。','运算室移至 (4,2)，接入选 (4,3)，补好对应背面支路。'],tags:['placement','signal-power-tradeoff'],
  },
  {
    title:'把门让出来',subtitle:'搬迁释放另一条链路',w:7,h:7,
    brief:'维修站占住中央南北门。把它搬到右上槽位，东西货运绕北侧，南北货运才有四格直路。',
    modules:[M('a','西港','0,2',.35,['0,3']),M('b','东港','6,2',.35,['6,3']),M('c','北库','3,1',.4,['2,1']),M('d','南库','3,5',.4,['2,5']),M('e','维修站','3,3',.5,['5,3','5,4'],['5,3'])],
    positions:{e:'5,3'},startPositions:{e:'3,3'},startAccess:{e:'3,3'},access:{a:'0,3',b:'6,3',c:'2,1',d:'2,5',e:'5,4'},
    nets:[N('a','a','b',['0,2','0,0','6,0','6,2'],0),N('b','c','d',['3,1','3,5'],0)],sources:['0,6','6,6'],back:[P(2,'0,6','6,6'),P(1,'0,6','0,3'),P(1,'6,6','6,3'),P(1,'2,6','2,1'),P(1,'5,6','5,4')],front:['1,2','2,2','4,2','5,2'],
    hints:['维修站没有信号任务，仍会挡住南北货运。','它有一个右侧槽位 (5,3)，不在两条参考走廊上。','把维修站搬到 (5,3)，接入 (5,4)，南北线就能贯通 x=3。'],tags:['placement','module-obstacle','crossing-priority'],
  },
  {
    title:'两座工坊换班',subtitle:'双模块摆位 · 避开井口',w:8,h:6,
    brief:'两座工坊都有两处槽位。北工坊应留在上街，南工坊放到下街；把接入留在各自街道外侧，避免井口阻断跨街联络。',
    modules:[M('a','调度室','1,2',.55,['1,3']),M('b','北工坊','5,3',.65,['5,0','5,4'],['5,1']),M('c','南工坊','3,1',.65,['3,0','3,4'],['3,3'])],
    positions:{b:'5,1',c:'3,3'},startPositions:{b:'5,3',c:'3,1'},startAccess:{b:'5,4',c:'3,0'},access:{a:'1,3',b:'5,0',c:'3,4'},
    nets:[N('a','a','b',['1,2','1,1','5,1']),N('b','a','c',['1,2','2,2','2,3','3,3'])],sources:['7,5','0,5'],back:[P(2,'0,5','7,5'),P(1,'1,5','1,3'),P(1,'3,5','3,4'),P(2,'5,5','5,0')],front:['4,2','5,2','6,2'],
    hints:['两个模块位置都合法，但它们的链路并非通向旧槽位。','北工坊选 (5,1)，南工坊选 (3,3)，两条线从调度室分开。','搬好两座工坊后，把北工坊井设为 (5,0)，南工坊井设为 (3,4)。'],tags:['placement','two-moves','shared-endpoint'],
  },
  {
    title:'有电的空位',subtitle:'背面施工区约束搬迁',w:9,h:6,
    brief:'最靠近调度室的槽位背后是施工区，井口缺少供电空间。中间槽位仍满足信号限长，又能接上东侧电源。',
    modules:[M('a','调度室','1,2',.6,['1,3']),M('b','加速器','7,2',1,['3,3','5,3','7,3'],['3,2','5,2'])],positions:{b:'5,2'},startPositions:{b:'7,2'},startAccess:{b:'7,3'},access:{a:'1,3',b:'5,3'},
    nets:[N('a','a','b',['1,2','5,2'],0)],sources:['8,5'],back:[P(2,'8,5','1,5','1,3'),P(2,'5,5','5,3')],backBlocks:['3,3','3,4','2,3','4,3'],
    hints:['可摆放的正面槽位不保证它的背面接入候选都能铺电源。','(3,3) 在背面禁布区，而 (5,3) 有南侧开放通路。','加速器选择 (5,2)，接入 (5,3)，从 (5,5) 向上接入。'],tags:['placement','asymmetric-obstacles','false-nearest'],
  },
  {
    title:'新区总搬迁',subtitle:'三条链路与两处分叉',w:10,h:7,
    brief:'新区用三个空槽重新组织计算、缓存和输出。共享建筑端点合法，共享其他路口会短路；布局改变后，三个井也要跟着重新安排。',
    modules:[M('a','输入港','1,3',.5,['1,4']),M('b','计算站','7,2',.9,['4,1','7,1'],['4,2']),M('c','缓存室','7,4',.7,['4,5','7,5'],['4,4']),M('d','输出港','8,3',.5,['8,4'])],
    positions:{b:'4,2',c:'4,4'},startPositions:{b:'7,2',c:'7,4'},startAccess:{b:'7,1',c:'7,5'},access:{a:'1,4',b:'4,1',c:'4,5',d:'8,4'},
    nets:[N('a','a','b',['1,3','2,3','2,2','4,2'],0),N('b','b','c',['4,2','4,4'],0),N('c','c','d',['4,4','5,4','5,3','8,3'],0)],sources:['0,6','9,0'],
    back:[P(2,'0,6','8,6','8,4'),P(1,'1,6','1,4'),P(1,'4,6','4,5'),P(2,'9,0','4,0','4,1')],front:['3,3','6,2','6,4'],
    hints:['计算和缓存都移向中央，三个短链路才同时成立。','中央纵街连接计算与缓存，左侧和右侧各留独立支路。','计算搬到 (4,2)，缓存搬到 (4,4)；井口分别放 (4,1) 和 (4,5)。'],tags:['placement','three-nets','chapter-finale'],
  },
  {
    title:'细线撑不住',subtitle:'线宽教学 · 加宽公共主干',w:7,h:5,
    brief:'两座工坊都有电，但细主干造成欠压。选“铜线 2×”，沿已有背面主干加宽；加宽只替换线宽，不会重复收费。',
    modules:[M('a','工坊甲','3,1',.9,['3,2']),M('b','工坊乙','5,1',.9,['5,2'])],nets:[N('a','a','b',['3,1','5,1'])],access:{a:'3,2',b:'5,2'},sources:['0,3'],
    back:[P(2,'0,3','5,3'),P(1,'3,3','3,2'),P(1,'5,3','5,2')],start:'weak',frontLocked:true,accessLocked:true,voltageSlack:.018,
    hints:['电压足够是独立硬条件：连通的电路仍可能欠压。','从电源到分叉前的公共段同时承载两座工坊。','用宽线覆盖背面 (0,3)→(5,3)，保留两条竖向末梢细线。'],tags:['width','shared-trunk','front-locked'],
  },
  {
    title:'末梢与主干',subtitle:'把金属花在同时受益的地方',w:8,h:6,
    brief:'三座建筑共用西侧主干。只加粗最远的末梢救不了近处负载；沿共用横街加宽，能同时改善全部电压。',
    modules:[M('a','译码室','3,1',.55,['3,2']),M('b','计算室','5,1',.95,['5,2']),M('c','输出室','6,4',.65,['6,5'])],nets:[N('a','a','b',['3,1','5,1']),N('b','b','c',['5,1','7,1','7,4','6,4'])],
    access:{a:'3,2',b:'5,2',c:'6,5'},sources:['0,3'],back:[P(2,'0,3','6,3'),P(1,'3,3','3,2'),P(1,'5,3','5,2'),P(1,'6,3','6,5')],start:'weak',frontLocked:true,accessLocked:true,voltageSlack:.022,
    hints:['比较最坏电压时，留意多座建筑是否一起变好。','西侧 (0,3)→(3,3) 是所有电流必经处。','先加宽背面横向公共主干，再按欠压位置决定是否加宽剩余横段。'],tags:['width','shared-trunk','three-loads'],
  },
  {
    title:'两边同时送电',subtitle:'并联路线替代全线加宽',w:8,h:5,
    brief:'左、右两个入口一起供电。把它们连成横向主干，远端电流会从两边分担；预算不支持把全部支路都加到最宽。',
    modules:[M('a','中工厂','3,1',1.1,['3,2']),M('b','东工厂','6,1',.85,['6,2'])],nets:[N('a','a','b',['3,1','6,1'])],access:{a:'3,2',b:'6,2'},sources:['0,3','7,3'],
    back:[P(1,'0,3','7,3'),P(1,'3,3','3,2'),P(1,'6,3','6,2')],frontLocked:true,accessLocked:true,removePower:[['6,3','7,3']],voltageSlack:.015,
    hints:['有两个电源时，不一定要把每段线加宽。','右侧电源只差 (6,3)→(7,3) 就能分担主干电流。','补上右侧入口到主干的最后一格，再看两座工厂的最低电压。'],tags:['parallel-source','width-alternative'],costSlack:2,
  },
  {
    title:'短井长巷',subtitle:'移动接入节省背面电阻',w:8,h:6,
    brief:'加速器的井离电源多绕两格，还占住正面备用出口。把井移到南侧候选点，缩短背面路线，再加宽少量主干。',
    modules:[M('a','调度室','1,2',.5,['1,3']),M('b','加速器','6,2',1.35,['6,3','6,1'])],nets:[N('a','a','b',['1,2','6,2'])],access:{a:'1,3',b:'6,3'},startAccess:{b:'6,1'},sources:['7,5'],
    back:[P(2,'7,5','1,5','1,3'),P(2,'6,5','6,3')],front:['3,1','4,1'],voltageSlack:.025,
    hints:['位置选择和加宽都是供电解法，价格不同。','加速器井在南侧 (6,3) 时，距主干只有两格。','先选 (6,3) 的井位，沿南侧已有宽主干接电；别向北新增长支路。'],tags:['access-power-tradeoff','width'],
  },
  {
    title:'午后生产高峰',subtitle:'模式教学 · 同时检查两种负载',w:9,h:6,
    brief:'白天计算站忙，夜间输出港忙。签核会逐个求解两种电流负载，必须都达到最低电压；只照顾当前热图是不够的。',
    modules:[M('a','计算站','3,1',.7,['3,2']),M('b','缓存室','5,1',.6,['5,2']),M('c','输出港','7,4',.7,['7,5'])],nets:[N('a','a','b',['3,1','5,1']),N('b','b','c',['5,1','8,1','8,4','7,4'])],access:{a:'3,2',b:'5,2',c:'7,5'},sources:['0,3','8,3'],
    back:[P(2,'0,3','8,3'),P(1,'3,3','3,2'),P(1,'5,3','5,2'),P(1,'7,3','7,5')],modes:[{name:'白天计算',loads:{a:1.8,b:1.3,c:.6}},{name:'夜间发送',loads:{a:.6,b:1,c:2}}],start:'weak',frontLocked:true,accessLocked:true,voltageSlack:.012,
    hints:['电压表的“最坏模式”告诉你是哪种工况在限制这座建筑。','左右两侧的高峰不同，需要同时保留两边送电通路。','加宽横向主干，并检查白天计算和夜间发送都通过。'],tags:['modes','width','peak-load'],
  },
  {
    title:'工业带加固',subtitle:'四负载与背面绕行',w:10,h:7,
    brief:'工业带中部背面禁布，四座厂分成南北两支。加宽各支公共段；支路末端保持细线，在预算内通过生产高峰。',
    modules:[M('a','北厂甲','2,1',.7,['2,2']),M('b','北厂乙','7,1',.7,['7,2']),M('c','南厂甲','2,5',.7,['2,4']),M('d','南厂乙','7,5',.7,['7,4'])],
    nets:[N('a','a','b',['2,1','7,1']),N('b','c','d',['2,5','7,5'])],access:{a:'2,2',b:'7,2',c:'2,4',d:'7,4'},sources:['0,3','9,3'],
    back:[P(2,'0,3','0,2','9,2','9,3'),P(2,'0,3','0,4','9,4','9,3')],backBlocks:['3,3','4,3','5,3','6,3'],modes:[{name:'北侧高峰',loads:{a:1.7,b:1.7,c:.7,d:.7}},{name:'南侧高峰',loads:{a:.7,b:.7,c:1.7,d:1.7}}],start:'weak',frontLocked:true,accessLocked:true,voltageSlack:.015,
    hints:['中央施工区不能用直线穿过，供电需要分成南北支路。','每条水平支路同时服务两座厂，优先加宽这些公共段。','沿 y=2 与 y=4 加宽横向电源线，保留东西两端与入口的连接。'],tags:['width','asymmetric-obstacles','modes','chapter-finale'],
  },
  {
    title:'轻载合井',subtitle:'共享井节省三份材料',w:7,h:5,
    brief:'相邻译码与缓存能共用一口井，合计峰值低于 2.5。井数预算只有两口，第三口必须合并。',
    modules:[M('a','译码室','2,1',.65,['2,2']),M('b','缓存室','3,2',.65,['2,2']),M('c','显示站','5,1',.5,['5,2'])],
    nets:[N('a','a','b',['2,1','3,1','3,2']),N('b','b','c',['3,2','4,2','4,1','5,1'])],access:{a:'2,2',b:'2,2',c:'5,2'},startAccess:{a:'2,1',b:'3,2'},sources:['0,4','6,4'],back:[P(2,'0,4','6,4'),P(1,'2,4','2,2'),P(1,'5,4','5,2')],
    modes:[{name:'同时读取',loads:{a:1.6,b:1.6,c:1}}],hints:['共享井既省成本也省井数，但共享电流有上限。','译码和缓存共有候选 (2,2)，峰值总和是 2.08。','把译码与缓存的接入都设为 (2,2)，显示站保留 (5,2)。'],tags:['shared-well','modes','well-budget'],costSlack:2,
  },
  {
    title:'高峰必须分流',subtitle:'共享井电流硬上限',w:8,h:6,
    brief:'两座工坊平时可共井，生产高峰合计超过普通井 2.5 上限。把它们分到左右两口井，接入费仍在订单预算内。',
    modules:[M('a','工坊甲','3,2',.9,['2,2','3,3']),M('b','工坊乙','4,3',.9,['3,3','5,3'])],nets:[N('a','a','b',['3,2','4,2','4,3'])],access:{a:'2,2',b:'5,3'},startAccess:{a:'3,3',b:'3,3'},sources:['0,5','7,5'],
    back:[P(2,'0,5','7,5'),P(1,'2,5','2,2'),P(1,'5,5','5,3')],modes:[{name:'日常',loads:{}},{name:'同时生产',loads:{a:1.6,b:1.6}}],
    hints:['共用普通井的总电流不能超过 2.5，与电压是否充足无关。','生产高峰合计 2.88，必须分井或者选研究后的大流量井。','基准解把甲接到 (2,2)，乙接到 (5,3)，两边分别供电。'],tags:['well-capacity','modes','split-access'],
  },
  {
    title:'错开班次也不行',subtitle:'不同模式的共享电流',w:8,h:7,
    brief:'白天甲忙，夜间乙忙，看似能合井；但检修测试要求同时全开。四种工况都会被检查，保留两个井才能全部签核。',
    modules:[M('a','车间甲','2,2',1,['2,3','3,2']),M('b','车间乙','4,2',1,['4,3','3,2']),M('c','监督站','3,5',.5,['3,6'])],nets:[N('a','a','b',['2,2','2,1','4,1','4,2']),N('b','b','c',['4,2','5,2','5,5','3,5'])],
    access:{a:'2,3',b:'4,3',c:'3,6'},startAccess:{a:'3,2',b:'3,2'},sources:['0,4','7,4'],back:[P(2,'0,4','7,4'),P(1,'2,4','2,3'),P(1,'4,4','4,3'),P(1,'3,4','3,6')],
    modes:[{name:'日班',loads:{a:1.8,b:.3}},{name:'夜班',loads:{a:.3,b:1.8}},{name:'交班',loads:{a:1,b:1}},{name:'全开检修',loads:{a:1.4,b:1.4}}],
    hints:['签核是全部模式合取，不能只看日班或夜班的轻负载。','全开检修把共享井推到 2.8；两个独立井各自只承载 1.4。','甲用 (2,3)，乙用 (4,3)，监督站用 (3,6)。'],tags:['well-capacity','four-modes','split-access'],
  },
  {
    title:'共井不共街',subtitle:'共享井避开第三方信号',w:9,h:6,
    brief:'两个轻载仓库可共井，但内侧候选点正是调度线经过的街角。选择外侧共同井，节省接入而不牺牲货运通道。',
    modules:[M('a','仓甲','2,1',.55,['2,2','3,1']),M('b','仓乙','3,2',.55,['2,2','3,1']),M('c','西调度','0,3',.5,['0,4']),M('d','东调度','7,3',.5,['7,4'])],
    nets:[N('a','a','b',['2,1','3,1','3,2']),N('b','c','d',['0,3','7,3'],0)],access:{a:'2,2',b:'2,2',c:'0,4',d:'7,4'},startAccess:{a:'3,1',b:'3,1'},sources:['0,5','8,5'],
    back:[P(2,'0,5','8,5'),P(1,'2,5','2,2'),P(1,'7,5','7,4'),P(1,'0,5','0,4')],
    hints:['共享井仍占用正面格，不能把省钱变成堵路。','(3,1) 会堵住仓甲到仓乙的链路中段；(2,2) 在侧面。','两座仓库都选 (2,2)，两座调度站保留南侧井位。'],tags:['shared-well','access-conflict','two-nets'],
  },
  {
    title:'四户两口井',subtitle:'分组共享 · 井数与峰值',w:9,h:7,
    brief:'四座建筑分成左右两个共享组，预算只容两口井。按每组最坏模式电流分配，不能把四户全塞到中央井。',
    modules:[M('a','西计算','2,1',.65,['2,2','3,2']),M('b','西缓存','3,2',.55,['2,2','3,2']),M('c','东计算','6,1',.65,['6,2','5,2']),M('d','东缓存','5,2',.55,['6,2','5,2'])],
    nets:[N('a','a','b',['2,1','3,1','3,2']),N('b','c','d',['6,1','5,1','5,2'])],access:{a:'2,2',b:'2,2',c:'6,2',d:'6,2'},startAccess:{a:'2,1',b:'3,2',c:'6,1',d:'5,2'},sources:['0,5','8,5'],
    back:[P(2,'0,5','8,5'),P(2,'2,5','2,2'),P(2,'6,5','6,2')],modes:[{name:'西侧计算',loads:{a:2,b:1.4,c:.7,d:1}},{name:'东侧计算',loads:{a:.7,b:1,c:2,d:1.4}}],
    hints:['井数最多两口，每组共享电流也必须分别合格。','左右一组计算加缓存，峰值共享电流是 2.07。','西组都接 (2,2)，东组都接 (6,2)，主干从南侧两端送电。'],tags:['shared-well','grouping','modes'],costSlack:3,
  },
  {
    title:'接入公约签署',subtitle:'大电流与两条正面走廊',w:10,h:8,
    brief:'轻载双库共井，大电流工坊独井。正面两条链路有严格走廊，背面按三种高峰同时检验；预算只支付三口井。',
    modules:[M('a','库甲','2,1',.5,['2,2']),M('b','库乙','3,2',.5,['2,2']),M('c','重工坊','7,1',1.1,['7,2']),M('d','输出港','7,6',.65,['7,7'])],
    nets:[N('a','a','b',['2,1','3,1','3,2']),N('b','c','d',['7,1','8,1','8,6','7,6'])],access:{a:'2,2',b:'2,2',c:'7,2',d:'7,7'},startAccess:{a:'2,1',b:'3,2'},sources:['0,4','9,4'],
    back:[P(2,'0,4','9,4'),P(2,'2,4','2,2'),P(2,'7,4','7,2'),P(1,'7,4','7,7')],front:['4,1','4,2','4,3','4,5','4,6'],
    modes:[{name:'仓库高峰',loads:{a:2,b:2,c:.7}},{name:'工坊高峰',loads:{a:.7,b:.7,c:1.8}},{name:'夜间发送',loads:{d:2,a:1,b:1,c:1}}],
    hints:['按轻重负载分配共享井，比所有建筑一律独井更省料。','双库的合计高峰是 2，重工坊独井峰值是 1.98。','双库合在 (2,2)，工坊接 (7,2)，输出接 (7,7)，最后检查全部三种工况。'],tags:['shared-well','high-current','modes','chapter-finale'],
  },
  {
    title:'西门停电演习',subtitle:'冗余教学 · 单入口故障',w:8,h:5,
    brief:'西门将在演习中停电。把东西电源连成主干，两个工坊必须在日常和西门故障两种模式都获得足够电压。',
    modules:[M('a','工坊甲','2,1',.65,['2,2']),M('b','工坊乙','5,1',.65,['5,2'])],nets:[N('a','a','b',['2,1','5,1'])],access:{a:'2,2',b:'5,2'},sources:['0,3','7,3'],
    back:[P(2,'0,3','7,3'),P(1,'2,3','2,2'),P(1,'5,3','5,2')],modes:[{name:'日常双门',loads:{}},{name:'西门故障',loads:{},disabledSources:['0,3']}],frontLocked:true,accessLocked:true,removePower:[['6,3','7,3']],
    hints:['日常双电源合格，不能保证一个电源关闭后仍合格。','西门故障时，右侧入口必须通过整条主干送电。','补背面 (6,3) 到 (7,3)，让东门接入主干，并检查故障模式。'],tags:['source-fault','front-locked'],
  },
  {
    title:'任意一门可修',subtitle:'两个故障模式同时签核',w:9,h:6,
    brief:'两座入口轮流检修，任何一次都只能靠另一座供电。保持主干连通，按最远工厂加固长段，而不是只看双门日常。',
    modules:[M('a','西厂','2,1',.65,['2,2']),M('b','中厂','4,1',.65,['4,2']),M('c','东厂','6,1',.65,['6,2'])],nets:[N('a','a','b',['2,1','4,1']),N('b','b','c',['4,1','6,1'])],access:{a:'2,2',b:'4,2',c:'6,2'},sources:['0,4','8,4'],
    back:[P(2,'0,4','8,4'),P(1,'2,4','2,2'),P(1,'4,4','4,2'),P(1,'6,4','6,2')],modes:[{name:'双门日常',loads:{}},{name:'西门检修',loads:{},disabledSources:['0,4']},{name:'东门检修',loads:{},disabledSources:['8,4']}],start:'weak',frontLocked:true,accessLocked:true,
    hints:['最坏模式可能来自不同入口停机，不是某个固定日班。','两端入口到中央的长主干都必须有足够导通能力。','加宽背面 y=4 的主干，三条接入支路保留细线再观察最远端。'],tags:['source-fault','symmetric-redundancy','width'],
  },
  {
    title:'绕开检修围栏',subtitle:'故障与背面禁布',w:10,h:7,
    brief:'主街正在检修，电源从北、南两条支路绕过围栏。一座入口停机后，另一座仍要能接到上下工坊。',
    modules:[M('a','北工坊','3,1',.75,['3,2']),M('b','南工坊','6,5',.75,['6,4'])],nets:[N('a','a','b',['3,1','8,1','8,5','6,5'])],access:{a:'3,2',b:'6,4'},sources:['0,3','9,3'],
    back:[P(2,'0,3','0,2','9,2','9,3'),P(2,'0,3','0,4','9,4','9,3')],backBlocks:['2,3','3,3','4,3','5,3','6,3','7,3'],modes:[{name:'西门检修',loads:{},disabledSources:['0,3']},{name:'东门检修',loads:{},disabledSources:['9,3']}],frontLocked:true,accessLocked:true,removePower:[['8,2','9,2'],['0,3','0,4']],diff:2,
    hints:['背面中央围栏不能穿越；两个绕行支路都必须连接至少一个可用电源。','右上与左下各缺一格，导致不同停机工况分别断电。','补 (8,2)→(9,2) 和 (0,3)→(0,4)，最后同时检查两种检修。'],tags:['source-fault','asymmetric-obstacles','retrofit'],
  },
  {
    title:'共享井的备用路',subtitle:'大分流点的故障保护',w:9,h:7,
    brief:'双库共享井，停机时总电流会集中到剩余主干。两边宽线把共同井接到两个入口，独立输出支路保留。',
    modules:[M('a','库甲','3,1',.6,['3,2']),M('b','库乙','4,2',.6,['3,2']),M('c','输出站','6,5',.7,['6,4'])],nets:[N('a','a','b',['3,1','4,1','4,2']),N('b','b','c',['4,2','5,2','5,5','6,5'])],access:{a:'3,2',b:'3,2',c:'6,4'},sources:['0,3','8,3'],
    back:[P(2,'0,3','8,3'),P(2,'3,3','3,2'),P(1,'6,3','6,4')],modes:[{name:'西门故障读库',loads:{a:1.6,b:1.6,c:.6},disabledSources:['0,3']},{name:'东门故障发送',loads:{a:.8,b:.8,c:1.8},disabledSources:['8,3']}],start:'weak',frontLocked:true,accessLocked:true,
    hints:['共享井电流上限仍按两户总和，故障不会放宽这个限制。','共井支路承载两份电流，比输出末梢更值得优先加宽。','把 y=3 主干和 (3,3)→(3,2) 共井支路设为宽线。'],tags:['source-fault','shared-well','modes'],
  },
  {
    title:'避开单向死巷',subtitle:'模块搬迁与故障距离',w:10,h:7,
    brief:'加速器的边缘槽位很靠近西门，西门检修后却形成长供电死巷。移到中央槽位，短信号与故障电压才能同时合格。',
    modules:[M('a','调度室','3,2',.5,['3,3']),M('b','加速器','1,4',1,['1,5','5,5'],['5,4']),M('c','输出港','7,4',.5,['7,5'])],positions:{b:'5,4'},startPositions:{b:'1,4'},startAccess:{b:'1,5'},access:{a:'3,3',b:'5,5',c:'7,5'},
    nets:[N('a','a','b',['3,2','5,2','5,4']),N('b','b','c',['5,4','7,4'],0)],sources:['0,6','9,6'],back:[P(2,'0,6','9,6'),P(1,'3,6','3,3'),P(2,'5,6','5,5'),P(1,'7,6','7,5')],modes:[{name:'西门检修',loads:{},disabledSources:['0,6']},{name:'东门检修',loads:{},disabledSources:['9,6']}],front:['3,4','4,4'],
    hints:['布局既改变正面长度，也改变停机时背面最长送电距离。','中央槽位 (5,4) 对两个电源都比较近，并能接到输出港。','加速器搬至 (5,4)，接入 (5,5)，从中央宽支路获得供电。'],tags:['source-fault','placement','signal-power-tradeoff'],
  },
  {
    title:'全天候港区',subtitle:'双故障与四工况综合',w:11,h:8,
    brief:'港区四座厂必须应付白天、夜间和东西入口各自停机。上下独立货运通道不许短接，背面用宽主干分担四路电流。',
    modules:[M('a','西北厂','2,1',.65,['2,2']),M('b','东北厂','8,1',.65,['8,2']),M('c','西南厂','2,6',.65,['2,5']),M('d','东南厂','8,6',.65,['8,5'])],
    nets:[N('a','a','b',['2,1','8,1']),N('b','c','d',['2,6','8,6'])],access:{a:'2,2',b:'8,2',c:'2,5',d:'8,5'},sources:['0,3','10,3'],back:[P(2,'0,3','10,3'),P(2,'2,3','2,5'),P(1,'2,3','2,2'),P(2,'8,3','8,5'),P(1,'8,3','8,2')],
    modes:[{name:'白天',loads:{a:1.5,b:1.5,c:.7,d:.7}},{name:'夜間',loads:{a:.7,b:.7,c:1.5,d:1.5}},{name:'西门停机',loads:{},disabledSources:['0,3']},{name:'东门停机',loads:{},disabledSources:['10,3']}],start:'district',front:['4,2','5,2','6,2','4,5','5,5','6,5'],
    hints:['四种工况必须全部通过，先建连通网络再处理最低电压。','两条货运线留在上下街，背面主干横跨 y=3。','四座厂井选内侧 (2,2)、(8,2)、(2,5)、(8,5)，主干与较长南支用宽线。'],tags:['source-fault','four-modes','two-nets','chapter-finale'],
  },
  {
    title:'只准修背面',subtitle:'最终差异教学 · 正面投产',w:7,h:5,
    brief:'正面与井位锁定。只补背面一格缺口，差异预算为参考修复量加少量余量。撤销与反复试线不永久消耗改造额度。',
    modules:[M('a','译码室','2,1',.6,['2,2']),M('b','缓存室','5,1',.6,['5,2'])],nets:[N('a','a','b',['2,1','5,1'])],access:{a:'2,2',b:'5,2'},sources:['0,3','6,3'],back:[P(1,'0,3','6,3'),P(1,'2,3','2,2'),P(1,'5,3','5,2')],frontLocked:true,accessLocked:true,removePower:[['5,3','5,2']],diff:0,
    hints:['改造额度比较初始与最终方案，不数鼠标点击次数。','原城市只有 (5,3)→(5,2) 的背面接入支路缺口。','用细线补这一格即可，不需要拆改正面或井位。'],tags:['retrofit','front-locked','final-diff'],
  },
  {
    title:'主干换宽',subtitle:'改线宽也算一个最终差异',w:8,h:6,
    brief:'工厂的正面线路不许动。背面细主干换成宽线，以最少改变的段数修复欠压；每条改宽的单位边计一个差异。',
    modules:[M('a','厂甲','3,1',.9,['3,2']),M('b','厂乙','6,1',.9,['6,2'])],nets:[N('a','a','b',['3,1','6,1'])],access:{a:'3,2',b:'6,2'},sources:['0,4'],back:[P(2,'0,4','6,4'),P(1,'3,4','3,2'),P(1,'6,4','6,2')],frontLocked:true,accessLocked:true,start:'weak',diff:1,voltageSlack:.018,
    hints:['改宽一格与新增一格都占一份最终差异，宽度数值本身不乘倍。','只在公共横主干上加宽，避免动两条长末梢。','把背面 (0,4)→(6,4) 换成宽线，正面保持原样。'],tags:['retrofit','width','final-diff'],
  },
  {
    title:'电源换侧',subtitle:'锁定前街 · 恢复备用入口',w:9,h:6,
    brief:'旧城未来要关闭西电源。右侧入口只差两格，有限差异足够接回备用主干；两端检修模式都必须通过。',
    modules:[M('a','西站','2,1',.65,['2,2']),M('b','东站','6,1',.65,['6,2'])],nets:[N('a','a','b',['2,1','6,1'])],access:{a:'2,2',b:'6,2'},sources:['0,4','8,4'],back:[P(2,'0,4','8,4'),P(1,'2,4','2,2'),P(1,'6,4','6,2')],frontLocked:true,accessLocked:true,removePower:[['6,4','7,4'],['7,4','8,4']],diff:1,
    modes:[{name:'西入口退役',loads:{},disabledSources:['0,4']},{name:'东入口维护',loads:{},disabledSources:['8,4']}],
    hints:['日常仍能供电，但退役西源后会失去唯一活电源。','右侧主干最后两格不存在，有限差异足够恢复它们。','宽线补 (6,4)→(7,4)→(8,4)，让东西检修模式均连通。'],tags:['retrofit','source-fault','final-diff'],
  },
  {
    title:'旧井重新分配',subtitle:'正面锁定但接入可改',w:9,h:7,
    brief:'货运线路已经投产。两座工坊的新生产模式超出旧共享井容量；井位允许改，把它们拆分到外侧现成支路。',
    modules:[M('a','工坊甲','3,2',.95,['2,2','3,3']),M('b','工坊乙','4,3',.95,['3,3','5,3']),M('c','监督站','6,5',.5,['6,6'])],nets:[N('a','a','b',['3,2','4,2','4,3']),N('b','b','c',['4,3','4,5','6,5'])],access:{a:'2,2',b:'5,3',c:'6,6'},startAccess:{a:'3,3',b:'3,3'},sources:['0,6','8,6'],
    back:[P(2,'0,6','8,6'),P(1,'2,6','2,2'),P(1,'5,6','5,3')],frontLocked:true,modes:[{name:'生产升级',loads:{a:1.5,b:1.5,c:1}}],diff:1,
    hints:['正面锁定不代表本订单井位也锁定；井位变化会计入改造差异。','新模式共享电流达 2.85，普通井硬上限只有 2.5。','工坊甲改接 (2,2)，乙改接 (5,3)，两口井已有背面支路可用。'],tags:['retrofit','well-capacity','split-access','final-diff'],
  },
  {
    title:'围栏后的补丁',subtitle:'局部补线 · 双端电源',w:10,h:8,
    brief:'正面完全保留，背面两条供电绕围栏的路径各断一格。只有小幅改造额度，精准修好缺口就能恢复双故障保护。',
    modules:[M('a','北厂','3,1',.8,['3,2']),M('b','南厂','6,6',.8,['6,5']),M('c','巡检站','8,3',.45,['7,4'])],nets:[N('a','a','b',['3,1','1,1','1,6','6,6']),N('b','b','c',['6,6','8,6','8,3'])],access:{a:'3,2',b:'6,5',c:'7,4'},sources:['0,4','9,4'],
    back:[P(2,'0,4','0,2','9,2','9,4'),P(2,'0,4','0,5','9,5','9,4'),P(1,'7,5','7,4')],backBlocks:['2,4','3,4','4,4','5,4','6,4'],frontLocked:true,accessLocked:true,removePower:[['2,2','3,2'],['7,5','8,5']],diff:0,
    modes:[{name:'西门故障',loads:{},disabledSources:['0,4']},{name:'东门故障',loads:{},disabledSources:['9,4']}],
    hints:['初始图大部分完好，拆掉再重铺会超出差异额度。','缺口位于北路 (2,2)→(3,2) 和南路 (7,5)→(8,5)。','两处缺口都使用宽线补回，其余结构保持即可。'],tags:['retrofit','asymmetric-obstacles','source-fault','final-diff'],
  },
  {
    title:'不停产改造',subtitle:'六负载 · 正面完整保护',w:12,h:8,
    brief:'两组三厂不能停产，正面及井位保持。把旧细主干加宽，并恢复左右两处缺口，在四种工况和有限差异内签核。',
    modules:[M('a','北甲','2,1',.5,['2,2']),M('b','北乙','5,1',.5,['5,2']),M('c','北丙','9,1',.5,['9,2']),M('d','南甲','2,6',.5,['2,5']),M('e','南乙','5,6',.5,['5,5']),M('f','南丙','9,6',.5,['9,5'])],
    nets:[N('a','a','b',['2,1','5,1']),N('b','b','c',['5,1','9,1']),N('c','d','e',['2,6','5,6']),N('d','e','f',['5,6','9,6'])],access:{a:'2,2',b:'5,2',c:'9,2',d:'2,5',e:'5,5',f:'9,5'},sources:['0,3','11,3'],
    back:[P(2,'0,3','11,3'),P(1,'2,3','2,2'),P(1,'5,3','5,2'),P(1,'9,3','9,2'),P(1,'2,3','2,5'),P(1,'5,3','5,5'),P(1,'9,3','9,5')],frontLocked:true,accessLocked:true,start:'weak',removePower:[['0,3','1,3'],['10,3','11,3']],diff:2,
    modes:[{name:'北班',loads:{a:1.4,b:1.4,c:1.4,d:.7,e:.7,f:.7}},{name:'南班',loads:{a:.7,b:.7,c:.7,d:1.4,e:1.4,f:1.4}},{name:'西门维护',loads:{},disabledSources:['0,3']},{name:'东门维护',loads:{},disabledSources:['11,3']}],
    hints:['大量建筑不等于大量必须改动，供电公共主干是核心。','横向 y=3 承载六座厂；两端分别有一个缺口。','两端补宽线，横主干整体加宽，末梢细线保持；确认四模式同时通过。'],tags:['retrofit','six-loads','four-modes','final-diff','chapter-finale'],
  },
  {
    title:'海港新城',subtitle:'整城建设 · 三条联络',w:11,h:8,
    brief:'重新布局中央计算与缓存，给两侧联络各留一条通道。井位在街外，背面连接东西电源，兼顾昼夜高峰。',
    modules:[M('a','西港','1,3',.55,['1,4']),M('b','计算楼','7,2',.8,['4,1','7,1'],['4,2']),M('c','缓存楼','7,5',.65,['4,6','7,6'],['4,5']),M('d','东港','9,3',.55,['9,4'])],positions:{b:'4,2',c:'4,5'},startPositions:{b:'7,2',c:'7,5'},startAccess:{b:'7,1',c:'7,6'},access:{a:'1,4',b:'4,1',c:'4,6',d:'9,4'},
    nets:[N('a','a','b',['1,3','2,3','2,2','4,2']),N('b','b','c',['4,2','4,5']),N('c','c','d',['4,5','6,5','6,3','9,3'])],sources:['0,7','10,0'],
    back:[P(2,'0,7','9,7','9,4'),P(1,'1,7','1,4'),P(1,'4,7','4,6'),P(2,'10,0','4,0','4,1')],front:['3,3','3,4','7,4'],modes:[{name:'计算高峰',loads:{b:1.8,c:1.2}},{name:'输出高峰',loads:{d:1.8,a:1.4,b:.8}}],
    hints:['先确定中央两座楼的槽位，避免铺好线后再次重布。','计算 (4,2)、缓存 (4,5) 形成中央纵街，左右联络各从不同路口进入。','计算井放 (4,1)，缓存井放 (4,6)，西港与东港井留在南侧。'],tags:['integrated','placement','modes','three-nets'],
  },
  {
    title:'空中花园街区',subtitle:'共享接入与绕行的组合',w:11,h:9,
    brief:'四座轻载园区可分为两个共井组，中央重计算独井。园林禁布区切开正面，联络沿外侧街道绕行；背面走中腰主干。',
    modules:[M('a','西库甲','2,1',.45,['2,2']),M('b','西库乙','3,2',.45,['2,2']),M('c','东库甲','8,1',.45,['8,2']),M('d','东库乙','7,2',.45,['8,2']),M('e','计算楼','5,7',1.15,['5,6'])],
    nets:[N('a','a','b',['2,1','3,1','3,2']),N('b','c','d',['8,1','7,1','7,2']),N('c','b','e',['3,2','4,2','4,7','5,7']),N('d','d','e',['7,2','6,2','6,7','5,7'])],access:{a:'2,2',b:'2,2',c:'8,2',d:'8,2',e:'5,6'},startAccess:{a:'2,1',b:'3,2',c:'8,1',d:'7,2'},sources:['0,4','10,4'],
    back:[P(2,'0,4','10,4'),P(2,'2,4','2,2'),P(2,'8,4','8,2'),P(2,'5,4','5,6')],front:['5,1','5,2','5,3','5,4','5,5'],modes:[{name:'双库读取',loads:{a:2,b:2,c:2,d:2,e:.8}},{name:'计算高峰',loads:{e:1.8,a:1,b:1,c:1,d:1}}],
    hints:['五栋建筑只需三口井，轻载成组，重载独立。','中央园林不能穿越；左右链路分别沿 x=4 和 x=6 下行。','双库井选 (2,2) 与 (8,2)，计算井选 (5,6)，两条联络在计算楼端点汇合。'],tags:['integrated','shared-well','high-current','four-nets'],
  },
  {
    title:'夜航保障',subtitle:'故障中高峰 · 五座建筑',w:12,h:9,
    brief:'夜航把负载集中到南端，同时西门可能停机。五座建筑共用宽主干，东西各留备用通路；正面三条联络不能交叉。',
    modules:[M('a','北西站','2,1',.55,['2,2']),M('b','北东站','9,1',.55,['9,2']),M('c','南西站','2,7',.55,['2,6']),M('d','南东站','9,7',.55,['9,6']),M('e','调度塔','5,4',.6,['5,5'])],
    nets:[N('a','a','b',['2,1','9,1']),N('b','c','d',['2,7','9,7']),N('c','b','e',['9,1','10,1','10,4','5,4'])],access:{a:'2,2',b:'9,2',c:'2,6',d:'9,6',e:'5,5'},sources:['0,3','11,3'],back:[P(2,'0,3','11,3'),P(1,'2,3','2,2'),P(1,'9,3','9,2'),P(2,'2,3','2,6'),P(2,'9,3','9,6'),P(1,'5,3','5,5')],
    modes:[{name:'日航',loads:{a:1.3,b:1.3,c:.6,d:.6}},{name:'夜航西门故障',loads:{a:.5,b:.5,c:1.3,d:1.3,e:1},disabledSources:['0,3']},{name:'夜航东门故障',loads:{a:.5,b:.5,c:1.3,d:1.3,e:1},disabledSources:['11,3']}],start:'district',front:['4,2','5,2','6,2','7,2','4,6','5,6','6,6','7,6'],
    hints:['后两种模式把负载和电源停机同时改变，最坏情况不能分开检查。','南支路比北支路长，夜航又让南端更忙，需要宽线。','建立 y=3 双端宽主干，南侧 x=2 和 x=9 的长支路加宽，北侧短支路细线。'],tags:['integrated','source-fault','modes','five-loads'],
  },
  {
    title:'旧城与新区',subtitle:'限额整城改造 · 六建筑',w:12,h:10,
    brief:'旧城正面投产，背面按昼夜分区供电。北南两支各有缺口，并需恢复备用入口。最终改造额度足够精准补丁，拆城重建会超额。',
    modules:[M('a','北甲','2,1',.55,['2,2']),M('b','北乙','5,1',.55,['5,2']),M('c','北丙','9,1',.55,['9,2']),M('d','南甲','2,8',.55,['2,7']),M('e','南乙','5,8',.55,['5,7']),M('f','南丙','9,8',.55,['9,7'])],
    nets:[N('a','a','b',['2,1','5,1']),N('b','b','c',['5,1','9,1']),N('c','d','e',['2,8','5,8']),N('d','e','f',['5,8','9,8'])],access:{a:'2,2',b:'5,2',c:'9,2',d:'2,7',e:'5,7',f:'9,7'},sources:['0,4','11,4'],
    back:[P(2,'0,4','11,4'),P(2,'2,4','2,7'),P(2,'5,4','5,7'),P(2,'9,4','9,7'),P(1,'2,4','2,2'),P(1,'5,4','5,2'),P(1,'9,4','9,2')],frontLocked:true,accessLocked:true,removePower:[['2,3','2,4'],['5,6','5,7'],['10,4','11,4']],diff:2,
    modes:[{name:'北城高峰',loads:{a:1.6,b:1.6,c:1.6,d:.6,e:.6,f:.6}},{name:'南城高峰',loads:{a:.6,b:.6,c:.6,d:1.6,e:1.6,f:1.6}},{name:'西门停机',loads:{},disabledSources:['0,4']},{name:'东门停机',loads:{},disabledSources:['11,4']}],
    hints:['井位和正面都锁定，缺口与线宽是本订单可修改的对象。','缺口在西北支路、中南支路和东电源入口。','补 (2,3)→(2,4)、(5,6)→(5,7)、(10,4)→(11,4)，宽度沿用原支路。'],tags:['integrated','retrofit','six-loads','source-fault','final-diff'],
  },
  {
    title:'硅城联合会',subtitle:'七建筑 · 共井、搬迁、双门',w:13,h:10,
    brief:'双库共井，计算楼搬到中央，北南货运线保持独立。七座建筑要应付日夜高峰和双入口轮流检修，资源预算禁止无限加宽。',
    modules:[M('a','西库甲','2,1',.4,['2,2']),M('b','西库乙','3,2',.4,['2,2']),M('c','东库甲','10,1',.4,['10,2']),M('d','东库乙','9,2',.4,['10,2']),M('e','计算楼','8,6',.8,['6,7','8,7'],['6,6']),M('f','南西港','2,8',.45,['2,7']),M('g','南东港','10,8',.45,['10,7'])],
    positions:{e:'6,6'},startPositions:{e:'8,6'},startAccess:{e:'8,7',a:'2,1',b:'3,2'},access:{a:'2,2',b:'2,2',c:'10,2',d:'10,2',e:'6,7',f:'2,7',g:'10,7'},
    nets:[N('a','a','b',['2,1','3,1','3,2']),N('b','c','d',['10,1','9,1','9,2']),N('c','b','e',['3,2','4,2','4,6','6,6']),N('d','d','e',['9,2','8,2','8,6','6,6']),N('e','f','g',['2,8','10,8'])],sources:['0,4','12,4'],
    back:[P(2,'0,4','12,4'),P(2,'2,4','2,2'),P(2,'10,4','10,2'),P(2,'2,4','2,7'),P(2,'10,4','10,7'),P(2,'6,4','6,7')],front:['5,2','6,2','7,2','6,3','6,4','6,5'],
    modes:[{name:'日班读库',loads:{a:1.5,b:1.5,c:1.5,d:1.5,e:.8,f:.6,g:.6}},{name:'夜班计算',loads:{e:1.6,a:.5,b:.5,c:.5,d:.5,f:1.3,g:1.3}},{name:'西门检修',loads:{},disabledSources:['0,4']},{name:'东门检修',loads:{},disabledSources:['12,4']}],
    hints:['先做布局和井分组，后铺信号与电源，避免线路反复拆改。','计算楼中央槽位 (6,6) 对两个园区对称，两条联络在它自己的端点相会。','计算楼搬到 (6,6)、井设 (6,7)，双库分别合井 (2,2) 与 (10,2)，南港各独井。'],tags:['integrated','placement','shared-well','seven-loads','five-nets'],
  },
  {
    title:'双面硅城',subtitle:'终章 · 整城建设与全天候签核',w:13,h:11,
    brief:'八建筑、六条联络、六口井，完成最终城市。中央双工坊分井，左右仓库各共井；搬好两座工坊，建立双源宽主干，再逐个检查五种工况。',
    modules:[M('a','西库甲','2,1',.35,['2,2']),M('b','西库乙','3,2',.35,['2,2']),M('c','东库甲','10,1',.35,['10,2']),M('d','东库乙','9,2',.35,['10,2']),M('e','北工坊','8,5',.65,['6,4','8,4'],['6,5']),M('f','南工坊','8,7',.65,['6,8','8,8'],['6,7']),M('g','南西港','2,9',.4,['2,8']),M('h','南东港','10,9',.4,['10,8'])],
    positions:{e:'6,5',f:'6,7'},startPositions:{e:'8,5',f:'8,7'},startAccess:{a:'2,1',b:'3,2',c:'10,1',d:'9,2',e:'8,4',f:'8,8'},access:{a:'2,2',b:'2,2',c:'10,2',d:'10,2',e:'6,4',f:'6,8',g:'2,8',h:'10,8'},
    nets:[N('a','a','b',['2,1','3,1','3,2']),N('b','c','d',['10,1','9,1','9,2']),N('c','b','e',['3,2','4,2','4,5','6,5']),N('d','d','e',['9,2','8,2','8,5','6,5']),N('e','e','f',['6,5','6,7']),N('f','g','h',['2,9','10,9'])],sources:['0,6','12,6'],
    back:[P(2,'0,6','12,6'),P(2,'2,6','2,2'),P(2,'10,6','10,2'),P(2,'2,6','2,8'),P(2,'10,6','10,8'),P(2,'6,6','6,4'),P(2,'6,6','6,8')],front:['5,2','6,2','7,2','5,3','6,3','7,3','4,7','8,7','5,8','7,8'],
    modes:[{name:'全城日常',loads:{}},{name:'北工坊高峰',loads:{e:2,f:.5,a:1.4,b:1.4}},{name:'南工坊高峰',loads:{e:.5,f:2,g:1.4,h:1.4}},{name:'西门故障',loads:{},disabledSources:['0,6']},{name:'东门故障',loads:{},disabledSources:['12,6']}],
    hints:['五种工况、正面几何与所有预算必须同时合格，先完成两座工坊搬迁。','北工坊选 (6,5)、南工坊选 (6,7)；井留在 (6,4) 与 (6,8)，不堵中央联络。','左右双库共井 (2,2)/(10,2)，南港独井 (2,8)/(10,8)，背面 y=6 为双源宽主干。'],tags:['integrated','placement','shared-well','source-fault','eight-loads','six-nets','campaign-finale'],
  },
];

export const levels = orders.map(make);

function hash(seed) {
  let n = 2166136261;
  for (const c of String(seed)) n = Math.imul(n ^ c.charCodeAt(0), 16777619);
  return n >>> 0;
}
function rng(seed) {
  let n = hash(seed);
  return () => { n += 0x6D2B79F5; let t = n; t = Math.imul(t ^ t >>> 15, t | 1); t ^= t + Math.imul(t ^ t >>> 7, t | 61); return ((t ^ t >>> 14) >>> 0) / 4294967296; };
}

// Endless uses a constructed witness, not a random score or an unchecked
// campaign shuffle. Districts grow from 2 to 4 independent pairs; demands,
// gate detours, well choices, power modes and source redundancy are seeded.
export function generateEndless(seed = '硅城', round = 1, gear = []) {
  const orderRound = Math.max(1, Math.min(Number.MAX_SAFE_INTEGER, Math.floor(Number(round) || 1)));
  const stage = Math.min(999, orderRound);
  const random = rng(`${seed}:${orderRound}`);
  const pairCount = Math.min(4, 2 + Math.floor((stage - 1) / 3));
  const width = Math.min(13, 7 + Math.floor((stage - 1) / 4));
  const height = 3 * pairCount + 1;
  const modules = [], nets = [], back = [], front = [], backBlocks = [], access = {};
  const sources = ['0,0',node(width - 1,0)];
  const column = width - 2;
  back.push(P(2,'0,0',node(width - 1,0)));
  back.push(P(2,'0,0',node(0,height - 1)));
  back.push(P(2,node(width - 1,0),node(width - 1,height - 1)));
  for (let i = 0; i < pairCount; i++) {
    const row = i * 3 + 1;
    const left = `a${i}`, right = `b${i}`;
    const current = Math.round((.28 + random() * .28) * 100) / 100;
    modules.push(M(left,`西 ${i + 1} 区`,node(1,row),current,[node(1,row + 1)]));
    modules.push(M(right,`东 ${i + 1} 区`,node(column,row),current,[node(column,row + 1)]));
    access[left] = node(1,row + 1); access[right] = node(column,row + 1);
    const gate = 2 + Math.floor(random() * Math.max(1,width - 4));
    const detour = random() < .45;
    let points = [node(1,row),node(column,row)];
    if (detour) {
      front.push(node(gate,row));
      points = [node(1,row),node(1,row - 1),node(column,row - 1),node(column,row)];
    }
    nets.push(N(`n${i}`,left,right,points,stage < 4 ? 2 : 1));
    back.push(P(1,node(0,row + 1),node(1,row + 1)));
    back.push(P(1,node(width - 1,row + 1),node(column,row + 1)));
    // Rungs provide a connected ladder, so a disabled top source still reaches
    // every district. Each rung is a new independent alternate supply choice.
    back.push(P(2,node(0,row + 2),node(width - 1,row + 2)));
    if (random() < .5) backBlocks.push(node(gate,row + 1));
  }
  const peakLeft = Object.fromEntries(modules.filter(m => m.id.startsWith('a')).map(m => [m.id,1.35]));
  const peakRight = Object.fromEntries(modules.filter(m => m.id.startsWith('b')).map(m => [m.id,1.35]));
  const modes = [{ name:'西区高峰',loads:peakLeft },{ name:'东区高峰',loads:peakRight }];
  if (stage >= 7) modes.push({ name:'西门维护',loads:{},disabledSources:['0,0'] });
  if (stage >= 10) modes.push({ name:'东门维护',loads:{},disabledSources:[node(width - 1,0)] });
  const spec = {
    id:`endless-${String(seed)}-${orderRound}`,title:`轮值城市 · 第 ${orderRound} 单`,subtitle:`种子 ${String(seed)} · ${pairCount} 街区`,
    brief:`在时限内完成 ${pairCount} 条信号与两面供电。每区可选择本体井或外侧井，障碍、负载和高峰由固定种子生成；相同种子与轮次可重试。`,
    w:width,h:height,modules,nets,sources,access,back,front,backBlocks,modes,start:'district',
    hints:['先完成有障碍街区的绕行，再接好缺失的背面梯形主干。','井留在建筑下一格，正面同一街区的连线就保持开放。','梯形电网的两侧竖主干与横向连接使用宽线，末梢接入保持细线。'],
    tags:['endless','witness-generated',stage >= 7 ? 'source-fault' : 'modes'],
    voltageSlack:Math.max(.015,.04 - stage * .0015),costSlack:Math.max(5,16 - Math.floor(stage / 2)),signalSlack:Math.max(2,7 - Math.floor(stage / 3)),powerSlack:Math.max(2,7 - Math.floor(stage / 4)),
  };
  // Keep fixed-current loads physically meaningful even at the capped size.
  // The solve verifies each candidate, and demand scaling is the deterministic
  // fallback rather than ever returning an impossible order.
  let level;
  for (let attempt = 0; attempt < 7; attempt++) {
    try { level = make(spec,Math.min(47,12 + stage)); break; }
    catch (error) {
      if (!String(error.message).includes('voltage too low') || attempt === 6) throw error;
      spec.modules.forEach(m => { m.current = Math.round(m.current * .86 * 10000) / 10000; });
    }
  }
  level.chapter = -1; level.reward = 0;
  level.timeSeconds = Math.max(180,Math.round(140 + pairCount * 52 - Math.min(stage,35) * 2));
  const verified = evaluate(level,level.reference,gear);
  if (!verified.ok) throw new Error(`Endless witness rejected: ${JSON.stringify(verified.errors)}`);
  return level;
}
