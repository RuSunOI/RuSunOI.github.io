import {evaluate,equipment,netCharge,effectiveModuleLoad} from './model.js';
import {coupling,constraintSummary} from './insights.js';
const e=s=>String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const btn=(s,a,extra='')=>'<button class="secondary small-button" data-action="'+a+'" '+extra+'>'+s+'</button>';
export function highlightInfo(c){
 const explicit=c.hoverNet||(!c.hoverModule&&!c.selected.length?c.focusNet:null);
 if(explicit){const n=c.level.nets.find(n=>n.id===explicit);return {strong:n?[n.id]:[],incident:n?[n.id]:[],members:n?.members||[],summary:n?'整条超边：'+n.name+'；'+n.members.length+'个成员共同计费。':'选择模块或账本总线查看关联。'};}
 const seeds=c.hoverModule?[c.hoverModule]:c.selected;
 const h=coupling(c.level,seeds,c.gear);
 const names=h.strong.map(id=>c.level.nets.find(n=>n.id===id)?.name).join('、');
 return {...h,summary:seeds.length?'★ 最强关联总线：'+names+'；首次切开参考费用 '+h.firstCut+'。整组端点已标记，实际费用仍按占岛数计算。':'选择或悬停模块：自动突出最强关联总线和整组端点；点击账本可固定查看。'};
}
export function warningPanel(c){
 const d=constraintSummary(c.level,c.result);if(!d.issues.length)return '';
 const target=d.issues.some(x=>x.kind==='cut')?d.contributing[0]:c.result.netCosts.find(n=>d.portNets.includes(n.id));
 return '<section class="constraint-alert" role="status" aria-live="polite"><strong>⚠ '+e(d.issues[0].text)+'</strong>'+d.issues.slice(1,4).map(x=>'<span>'+e(x.text)+'</span>').join('')+(d.issues.length>4?'<span>另有 '+(d.issues.length-4)+' 项资源超限，详见右侧。</span>':'')+'<p>通信按切分费用计；港口是跨岛总线名额。红色标记表示费用贡献或涉及超限港口。</p>'+(target?btn('定位总线：'+e(target.name)+' · 费用 '+target.cost,'net','data-id="'+target.id+'"'):'')+'</section>';
}
export function mapChart(c,palette){
 const {level,result}=c,n=level.islands.length,points=level.islands.map((i,j)=>[80+j*640/Math.max(1,n-1),j%2?91:112]);
 const d=constraintSummary(level,result),feeOver=result.cut>level.limits.cut;
 const groups=level.nets.map((net,k)=>{
  const charge=result.netCosts.find(x=>x.id===net.id);if(!charge)return '';
  const pts=charge.islands.map(id=>points[level.islands.findIndex(i=>i.id===id)]).filter(Boolean);if(!pts.length)return '';
  const hub=[pts.reduce((s,p)=>s+p[0],0)/pts.length,25+(k%3)*13],warn=feeOver&&charge.cost>0||d.portNets.includes(net.id);
  return '<g class="hypernet '+(warn?'route-warning':'')+'" data-net-id="'+net.id+'"><title>'+e(net.name)+'：'+charge.islands.length+'岛，费用'+charge.cost+'</title>'+pts.map(p=>'<path d="M'+p[0]+' '+p[1]+' Q'+p[0]+' '+hub[1]+' '+hub[0]+' '+hub[1]+'"/>').join('')+'<circle cx="'+hub[0]+'" cy="'+hub[1]+'" r="3"/><text class="net-label" x="'+hub[0]+'" y="'+(hub[1]-7)+'" text-anchor="middle">'+e(net.name)+' · '+charge.cost+'</text>'+(warn?'<text class="route-warning-icon" x="'+(hub[0]+7)+'" y="'+(hub[1]+5)+'">!</text>':'')+'</g>';
 }).join('');
 return '<svg class="island-chart review-chart" viewBox="0 0 800 185" role="img" aria-label="完整超边共同枢纽示意，感叹号表示费用贡献或港口超限"><rect width="800" height="185" fill="#132e37"/>'+groups+points.map(([x,y],j)=>{const id=level.islands[j].id,load=result.loads[id],over=load&&load.ports>load.capacity.ports;return '<g transform="translate('+x+' '+y+')"><path d="m-38 0 19-22h38l19 22-19 22h-38Z" fill="#1b3e47" stroke="'+(over?'#ffab91':palette[j])+'"/><text text-anchor="middle" y="5" fill="'+palette[j]+'" font-size="13">'+e(level.islands[j].name)+'</text><text y="43" text-anchor="middle" fill="'+(over?'#ffb29b':'#9cbbb3')+'" font-size="11">'+(over?'⚠ 港口超出 '+(load.ports-load.capacity.ports):'港口 '+(load?.ports||0)+' / '+(load?.capacity.ports||0))+'</text></g>';}).join('')+'<text x="15" y="16" fill="#8db9ad" font-size="10">超边整组显示 · 不是两两带宽流量图</text></svg>';
}
export function paintHighlights(c){
 const h=highlightInfo(c),strong=new Set(h.strong),related=new Set(h.incident),members=new Set(h.members);
 document.querySelectorAll('[data-action="module"]').forEach(el=>{const on=members.has(el.dataset.id);el.classList.toggle('related',on);el.classList.toggle('strong-related',on&&!c.selected.includes(el.dataset.id));});
 document.querySelectorAll('[data-net-id]').forEach(el=>{el.classList.toggle('is-strong',strong.has(el.dataset.netId));el.classList.toggle('is-related',related.has(el.dataset.netId));});
 document.querySelectorAll('[data-action="net"]').forEach(el=>{el.classList.toggle('focused',strong.has(el.dataset.id));el.classList.toggle('related-net',related.has(el.dataset.id));});
 const desc=document.querySelector('#coupling-description');if(desc&&desc.textContent!==h.summary)desc.textContent=h.summary;
}
export function comparison(c,previous){
 const rows=[['cut','通信费用'],['moves','最终迁移'],['migration','迁移材料']];
 const initial=evaluate(c.level,c.level.initial,c.gear);
 return '<div class="comparison"><p>均来自正式判定；三类最佳可能来自不同完整方案。</p><table><thead><tr><th>指标</th><th>初始</th><th>本方案</th><th>'+(previous?'本次前最佳':'个人最佳')+'</th></tr></thead><tbody>'+rows.map(([key,label])=>{const record=(previous||c.best)?.[key];let best='—';if(record){const checked=evaluate(c.level,record.assignment,record.gear||{});if(checked.passed)best=checked[key];}return '<tr><th>'+label+'</th><td>'+initial[key]+'</td><td>'+c.result[key]+'</td><td>'+best+'</td></tr>';}).join('')+'</tbody></table><small>越低越省；初始布局不一定满足合同。没有全球排名或击败百分比。</small></div>';
}
export function shortcutDialog(){return '<div class="overlay review-overlay"><section class="dialog review-dialog" role="dialog" aria-modal="true" aria-label="快捷键速查"><h2>快捷键速查</h2><dl class="shortcut-grid"><dt>1–5</dt><dd>所选模块编排到对应岛</dd><dt>X</dt><dd>两个岛的所选模块整组互换</dd><dt>Enter</dt><dd>空白焦点执行草案；按钮上保持原生激活</dd><dt>Ctrl / Cmd + Z</dt><dd>撤销布局；不退还时间或重复领取奖励</dd><dt>Ctrl / Cmd + Shift + Z / Y</dt><dd>重做布局</dd><dt>S / H</dt><dd>验收 / 下一层提示</dd><dt>Esc / ?</dt><dd>关闭当前浮层，或暂停 / 快捷键速查</dd><dt>Tab</dt><dd>保留原生键盘焦点导航</dd></dl><p>输入框内不触发游戏快捷键。速查、原理卡和分享浮层会暂停远航计时并遮住地图。</p>'+btn('返回游戏','review-close')+'</section></div>';}
const terms=[
 ['切分费用不是带宽','本游戏是静态划分谜题，没有逐岛对的Gbps带宽、数据包排队或动态拥塞仿真。目标是满足通信费用与各岛资源合同。','费用过高时，先查看账本中代价最大的总线；港口超限时，查看该岛参与了多少条跨岛总线。'],
 ['超边：一条总线，一组伙伴','权重4的三端总线：成员同岛费用0；占两岛费用4；占三岛费用8。关键附加费只在切开时另收一次。','高亮会保留整组成员和共同枢纽。不能把三端总线任意展开成三条两两连线计费。'],
 ['港口与强关联','一条跨岛总线在每个涉及岛占一个港口，不按同岛端点数重复收费。共享海缆装备改变港口用量。','最强关联按这条完整总线的首次切开参考费用排序；这只是看图辅助，不保证把它合并就能解决所有合同。'],
 ['最终差异与有效负载','迁移数与材料按最终布局相对初始布局计算；试错和撤销不永久耗费材料。岛特性和装备会改变有效面积/功耗，卡片可悬停对照基础值。','先编排整组航线，再执行，最后验收。撤销恢复布局和工具配置，不恢复已走过的远航时间；首次奖励不会重复发放。']
];
export function termsDialog(index){const t=terms[index];return '<div class="overlay review-overlay"><section class="dialog review-dialog" role="dialog" aria-modal="true" aria-label="原理微引导"><p class="eyebrow">原理卡 '+(index+1)+' / '+terms.length+' · 可跳过、随时回看</p><h2>'+t[0]+'</h2><p>'+t[1]+'</p><p class="term-tip">'+t[2]+'</p><p class="muted">本游戏采用确定的简化超图模型，数值是游戏单位，不代表工业签核。</p><div class="dialog-actions">'+btn('上一张','term-prev',index===0?'disabled':'')+btn('下一张','term-next',index===terms.length-1?'disabled':'')+btn('跳过 / 返回','review-close')+'</div></section></div>';}
export function blueprintDialog(c,text){const can=c.result.passed&&!c.plan;return '<div class="overlay review-overlay"><section class="dialog review-dialog wide-dialog" role="dialog" aria-modal="true" aria-label="蓝图分享"><h2>分享当前关蓝图</h2><p>只含本关布局、工具和正式指标，不含进度或研究点。只载入同关、正式达标的蓝图；工具必须已经拥有。</p><div class="dialog-actions">'+btn('导出蓝图 JSON','blueprint-export',can?'':'disabled')+btn('导出铭牌 PNG','blueprint-png',can?'':'disabled')+'</div>'+(!can?'<p class="term-tip">完成草案执行并满足全部合同后，即可导出。</p>':'')+'<label for="blueprint-json">粘贴本关蓝图 JSON</label><textarea id="blueprint-json" rows="8" spellcheck="false">'+e(text)+'</textarea><label class="file-label" tabindex="0" role="button">选择蓝图文件<input id="blueprint-file" type="file" accept="application/json,.json"></label><div class="dialog-actions">'+btn('载入当前关蓝图','blueprint-load')+btn('返回游戏','review-close')+'</div></section></div>';}
export async function downloadBlueprintPng(c){
 const r=evaluate(c.level,c.assignment,c.gear);if(!r.passed||c.plan)throw Error('请先执行并完成本关全部合同');
 const W=1600,n=c.level.islands.length,maxModules=Math.max(...c.level.islands.map(i=>c.level.modules.filter(m=>c.assignment[m.id]===i.id).length)),boardBottom=290+maxModules*64;
 const H=Math.max(1000,boardBottom+140+c.level.nets.length*44),canvas=document.createElement('canvas');canvas.width=W;canvas.height=H;const x=canvas.getContext('2d');if(!x)throw Error('此浏览器不支持PNG绘制');
 x.fillStyle='#112630';x.fillRect(0,0,W,H);x.textBaseline='top';
 const text=(s,px,py,size=22,color='#d6e9df',width)=>{x.font=size+'px "Microsoft YaHei",sans-serif';x.fillStyle=color;x.fillText(String(s),px,py,width);};
 text('芯粒群岛 · 蓝图铭牌',50,35,36,'#f2c182');text(c.level.title,50,98,28);text('通信 '+r.cut+'/'+c.level.limits.cut+'   最终迁移 '+r.moves+'/'+c.level.limits.moves+'   材料 '+r.migration+'/'+c.level.limits.migration,50,150,24);text('工具：'+(c.gear.equipped?.map(id=>equipment.find(g=>g.id===id)?.name).join(' / ')||'基础船队'),50,195,18,'#a3c9ba');
 const col=(W-100)/n;
 for(let j=0;j<n;j++){const i=c.level.islands[j],left=50+j*col,load=r.loads[i.id];x.fillStyle='#1b3d45';x.fillRect(left,245,col-15,boardBottom-220);text(i.name,left+12,258,23,'#7fddc4',col-35);text('面 '+load.area+'/'+load.capacity.area+' 电 '+load.power+'/'+load.capacity.power+' 港 '+load.ports+'/'+load.capacity.ports,left+12,295,16,'#c4d4b7',col-35);let y=334;for(const m of c.level.modules.filter(m=>c.assignment[m.id]===i.id)){const effective=effectiveModuleLoad(m,i,c.gear);text((m.fixed?'⚑ ':'')+m.name,left+12,y,21,'#e4eee4',col-35);text('有效 '+effective.area+'面 / '+effective.power+'电  搬运 '+(m.migration??m.area),left+12,y+27,14,'#8eb5a8',col-35);y+=64;}}
 let y=boardBottom+38;text('超边账本 · 同一总线按不同占岛数计算',50,y,24,'#f2c182');y+=45;
 for(const net of c.level.nets){const charge=r.netCosts.find(v=>v.id===net.id);text(net.name,50,y,18,'#cfe4d8',720);text(charge.weight+' × ('+charge.islands.length+'−1) + '+charge.critical+'附加 + '+charge.tax+'工具费 = '+charge.cost,820,y,17,'#a9c6b4',720);y+=44;}
 text('简化静态划分模型 · 费用与港口名额不是Gbps带宽 · 蓝图不含存档或货币',50,H-42,17,'#95b5aa');
 const blob=await new Promise(resolve=>canvas.toBlob(resolve,'image/png'));if(!blob)throw Error('PNG导出失败');const url=URL.createObjectURL(blob),a=document.createElement('a');a.href=url;a.download='chiplet-islands-blueprint-'+c.level.id+'.png';a.click();setTimeout(()=>URL.revokeObjectURL(url),1500);
}
