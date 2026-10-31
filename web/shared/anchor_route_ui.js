// 作者：dz
(function () {
    'use strict';
    const $=id=>document.getElementById(id);
    const esc=s=>String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
    const name=id=>TALENT_DATA[String(id)]?.name||`#${id}`;
    let raw=null, purples=[], worker=null, workerBlobUrl=null, lastFingerprint='', routes=[], generation=0, lastPacket=null;
    const TARGET_PRIORITY=[250,249,248,271,272,268,269,267,276,266];
    const isAuto=()=>$('anchorMode').value==='auto';
    const sourceText=s=>s?`起点 #${s.no} ${name(s.id)}`:'置换起点';
    const sequenceLabel=r=>r.sequence?.fixedLuck?'欧气已固定的序列（n=0）':r.sequence?.basisZi===152?`二槽理论紫后第 ${r.pad} 条（n=${r.pad}）`:`实际槽位紫后第 ${r.pad} 条（n=${r.pad}）`;
    function preparationText(r) {
        if(r.sequence?.fixedLuck)return '沿用已固定的置换序列。';
        const first=r.steps.findIndex(a=>a.type==='exchange');
        const optimized=r.steps.slice(0,first).filter(a=>a.type==='wash'&&a.why?.startsWith('同序列'));
        if(optimized.length)return `序列 n=${r.pad}：分段洗 ${optimized.map(a=>a.count).join('＋')} 次，共 ${optimized.reduce((sum,a)=>sum+a.count,0)} 次。`;
        const padStep=r.steps.find(a=>a.type==='wash'&&a.why===`无限置换垫洗 n=${r.pad}`);
        if(padStep)return `序列 n=${r.pad}：锁定 ${padStep.keepIds.map(name).join('、')}，洗 ${padStep.count} 次后置换。`;
        return `序列 n=${r.pad}：捕获起点紫后直接置换。`;
    }
    function anchorPaths(r) {
        return selected().map((anchor,index)=>{
            const chain=[];
            for(const step of r.steps)for(const snap of [step.before,step.after]) {
                const pos=snap.origins.indexOf(index);
                if(pos>=0&&snap.state.talents[pos]!==chain[chain.length-1])chain.push(snap.state.talents[pos]);
            }
            return `锚点 #${anchor.no}${anchor.fromPity?'（保底）':''}：${chain.map(name).join(' → ')}`;
        });
    }
    function fingerprint(){
        const s=window.state||{}, snap=s.importSnapshot||{};
        return JSON.stringify([s.roleId,s.saveData?.CenterID,snap.seed,snap.born_talent_rc,snap.luck_seed,snap.luck_seed_inited,snap.tal_lucky,snap.talents,s.zizhi,s.vip,s.dlcMode,s.saveChannel,s.savePlatform,s.roleStats]);
    }
    function currentRaw() {
        const s=window.state||{};
        if(!s.saveData||!s.importSnapshot)throw new Error('请先在首页导入存档，再选择随从。');
        if(typeof isPreviewWashAlgo==='function'&&!isPreviewWashAlgo())throw new Error('第一版支持当前“最新”算法，请切换到最新算法。');
        if(s.dlcMode||/international|oversea|国际|國際/i.test([s.saveChannel,s.savePlatform].join(' ')))throw new Error('第一版暂未核对国际服／DLC 的锚点规划。');
        // 导入快照保留现有天赋；页面的洗脉、锁脉试算不会改变此次路线起点。
        return {...JSON.parse(JSON.stringify(s.importSnapshot)),zizhi:Number(s.zizhi),vip:Number(s.vip),role_stats:s.roleStats||{},global_vars:s.globalVars||s.saveData.globalVariable||{}};
    }
    function cancel(message) {
        generation++; if(worker)worker.terminate();worker=null;
        if(workerBlobUrl)URL.revokeObjectURL(workerBlobUrl);workerBlobUrl=null;
        $('anchorRun').disabled=!raw;$('anchorCancel').disabled=true;
        if(message&&lastPacket)render({...lastPacket,searching:false,stopped:true});
        if(message)$('anchorStatus').textContent=message;
    }
    function invalidate() {
        cancel();raw=null;purples=[];routes=[];lastPacket=null;
        $('anchorRun').disabled=true;$('anchorChoices').innerHTML='';$('anchorResults').innerHTML='';
        $('anchorSource').innerHTML='<option value="">请先读取原始紫</option>';
        $('anchorStatus').textContent='角色或起算条件已变化，请重新读取原始紫。';
    }
    function targets(){return [...$('anchorTargets').querySelectorAll('input:checked')].map(el=>Number(el.value));}
    function selected(){return [...$('anchorChoices').querySelectorAll('input:checked')].map(el=>purples[Number(el.value)]);}
    function syncRolePicker() {
        const select=$('anchorRoleSelect'), list=window.state?.saveRoles||[];
        if(!select||!list.length)return;
        const signature=list.map(e=>`${e.key}:${e.role?.Name||''}`).join('|');
        if(select.dataset.signature!==signature){
            select.innerHTML=list.map(e=>`<option value="${esc(e.key)}">${esc(e.tag+' · '+(e.role?.Name||'无名'))}</option>`).join('');
            select.dataset.signature=signature;
        }
        const current=list.find(e=>Number(e.role?.ID)===Number(window.state?.roleId));
        if(current&&select.value!==current.key)select.value=current.key;
    }
    function setPillBudget(value) {
        if(!raw)return;
        const n=Math.max(0,Math.min(20000,Number(value)||0));
        raw.bag_pills=n;raw.has_bag_pills=true;
        const input=$('anchorPillInput');
        if(input&&String(input.value)!==String(n))input.value=String(n);
        if(lastPacket)render(lastPacket);
    }
    function renderSources() {
        const picked=selected();
        const old=$('anchorSource').value;
        const usable=AnchorRoutePlanner.usableSources(raw,picked,purples);
        $('anchorSource').innerHTML=usable.map(a=>`<option value="${a.no-1}">#${a.no} ${esc(a.name)} · RC ${a.bornRC}</option>`).join('')||'<option value="">没有可用起点</option>';
        if(usable.some(a=>String(a.no-1)===old))$('anchorSource').value=old;
        $('anchorSelection').textContent=`已选 ${picked.length} 个锚点 / ${targets().length} 个目标`;
        $('anchorAutoSources').textContent=usable.length?`自动检查 ${usable.length} 个起点：${usable.map(a=>'#'+a.no+' '+a.name).join('、')}。`:'首个锚点及其之前暂无可用置换起点。';
    }
    function read() {
        try {
            cancel();raw=currentRaw();lastFingerprint=fingerprint();routes=[];lastPacket=null;$('anchorResults').innerHTML='';
            const e=AnchorRoutePlanner.engine(raw,raw.zizhi);
            const available=e.purpleIds.filter(id=>e.allowed.has(id)&&name(id)).sort((a,b)=>{
                const ai=TARGET_PRIORITY.indexOf(Number(a)), bi=TARGET_PRIORITY.indexOf(Number(b));
                return (ai<0?TARGET_PRIORITY.length:ai)-(bi<0?TARGET_PRIORITY.length:bi);
            });
            $('anchorTargets').innerHTML=available.map(id=>`<label class="anchor-chip"><input type="checkbox" value="${id}" ${[250,271,272,268].includes(id)?'checked':''}>${esc(name(id))}</label>`).join('');
            purples=AnchorRoutePlanner.scan(raw,12);
            $('anchorChoices').innerHTML=purples.map((a,i)=>`<label class="anchor-card"><input type="checkbox" value="${i}"><span><b>#${a.no} ${a.fromPity?'第 '+a.pityNo+' 次保底（参考：'+esc(a.name)+'）':esc(a.name)}</b><small>无锁第 ${a.wash} 洗 · RC ${a.bornRC} · 相隔 ${a.gap} 条${a.fromPity?' · 可作锚点，实际脉名及时间随操作变化':''}</small></span></label>`).join('');
            // 默认选第一组四个可置换紫，用户可手动调整；不把一心作为可置换锚点。
            let chosen=0;
            [...$('anchorChoices').querySelectorAll('input')].forEach((input,i)=>{
                const a=purples[i];
                if(!a.fromPity&&a.id!==251&&chosen<4){input.checked=true;chosen++;}
            });
            renderSources();$('anchorRun').disabled=false;
            const role=window.state.roleRaw?.Name||$('saveRoleSelect')?.selectedOptions[0]?.textContent||`角色 ${raw.role_id}`;
            $('anchorRole').textContent=`${role} · ${e.slotCount} 槽起算 · 导入时原样`;
            const pillInput=$('anchorPillInput');
            if(pillInput){pillInput.value=raw.has_bag_pills?Math.max(0,Math.min(20000,Number(raw.bag_pills)||0)):'';pillInput.disabled=false;}
            syncRolePicker();
            $('anchorStatus').textContent=isAuto()?'原始紫已读取。确认目标和锚点，点击自动找序列即可。':'原始紫已读取。确认目标、锚点、置换起点和 n，然后开始推演。';
        }catch(err){raw=null;$('anchorRun').disabled=true;$('anchorStatus').textContent=err.message;}
    }
    function parsePads(text) {
        const tokens=text.trim().split(/[,，、\s]+/).filter(Boolean), out=[];
        for(const token of tokens) {
            const m=/^(\d+)(?:-(\d+))?$/.exec(token);
            if(!m)throw new Error('n 请填写 44、31,44 或 0-10。');
            const a=Number(m[1]),b=m[2]?Number(m[2]):a;
            if(a>b||b>300)throw new Error('n 范围为 0 到 300，区间需从小到大。');
            for(let n=a;n<=b;n++)if(!out.includes(n))out.push(n);
        }
        if(!out.length||out.length>30)throw new Error('第一版每次最多比较 30 个 n，请缩小范围。');
        return out;
    }
    function lockText(ids,previous) {
        const unlocked=previous.filter(id=>!ids.includes(id));
        return `${ids.length?'锁定 '+ids.map(name).join('、'):'全部解锁'}${unlocked.length?'；解锁 '+unlocked.map(name).join('、'):''}`;
    }
    function describeSteps(route) {
        let locks=(raw.talents||[]).filter(t=>t.locked).map(t=>Number(t.id));
        const startingPills=raw.has_bag_pills?Number(raw.bag_pills):null;
        const slotLabel=Number(raw.zizhi)>=154?'四槽':Number(raw.zizhi)===153?'三槽':`${Number(raw.zizhi)-151}槽`;
        const rows=[];
        let pendingUpgrade=false;
        for(const [i,a] of route.steps.entries()) {
            let text='';
            if(a.type==='wash') {
                const lockSummary=i===0&&locks.length===0
                    ? `${slotLabel}开始，不锁任何脉`
                    : lockText(a.keepIds,locks);
                const stopNames=a.after.state.talents.filter(id=>!a.keepIds.includes(id)).map(name).join('、')||'当前锁定状态';
                text=`${lockSummary}；点 ${a.count} 下，停在 ${stopNames}`;
                if(a.why===`无限置换垫洗 n=${route.pad}`)text+=`（定位紫后第 ${route.pad} 条序列）`;
                if(a.why==='无锁洗到起点紫前最近可用冲突脉')text+='（下步锁最近冲突脉）';
                if(a.why==='洗到后续紫前最近可用冲突脉')text+='（下步锁最近冲突脉）';
                for(const ev of a.pityEvents||[])text+=`；保底${ev.no}：${name(ev.id)}`;
                locks=a.keepIds.slice();
            }else if(a.type==='exchange') {
                text=`${a.keepIds.length?'锁定 '+a.keepIds.map(name).join('、'):'不锁脉'}；${name(a.from)} → ${name(a.to)}`;
                locks=a.keepIds.filter(id=>id!==a.from);
            }else {
                if(rows.length) {
                    rows[rows.length-1].text+='；开启第4槽';
                    continue;
                }
                pendingUpgrade=true;
                continue;
            }
            if(pendingUpgrade) {
                text=`开启第4槽；${text}`;
                pendingUpgrade=false;
            }
            const remaining=startingPills==null?null:startingPills-Number(a.after.cost||0);
            rows.push({no:rows.length+1,text,cost:a.after.cost-a.before.cost,total:a.after.cost,remaining,after:a.after.state.talents.map(name).join(' · ')});
        }
        if(pendingUpgrade) rows.push({no:rows.length+1,text:'开启第4槽',cost:0,total:route.cost,remaining:startingPills==null?null:startingPills-route.cost,after:route.final.state.talents.map(name).join(' · ')});
        return rows;
    }
    function render(data) {
        routes=data.routes||[];
        const visibleRoutes=routes.slice(0,3);
        const reports=data.reports||[];
        const meta=data.meta||{},total=meta.expanded||0;
        const stages=meta.stages||[];
        const stateText=data.searching?'正在搜索':data.stopped?'已停止，本轮未全部完成':'本轮完成';
        $('anchorResults').innerHTML=`<div class="anchor-summary">${stateText} · 已处理 ${meta.checked||0} 组起点／序列 · 探索 ${total.toLocaleString()} 个状态 · 当前最优路线 ${routes.length?'已验证':'尚未找到'}</div>`+
            (visibleRoutes.length?visibleRoutes.map((r,i)=>{
                const diff=raw.has_bag_pills?r.cost-raw.bag_pills:null;
                const steps=describeSteps(r);
                const sameSequence=routes.slice(0,i).findIndex(other=>other.source?.no===r.source?.no&&other.pad===r.pad&&other.sequence?.seed===r.sequence?.seed);
                const slotText=r.steps.some(a=>a.type==='upgrade')?'需开启第4槽':'无需开槽';
                const b0=r.pad>0&&!r.sequence?.fixedLuck?`垫洗停点 b0：${r.sequence?.b0.map(name).join('、')||'空'}`:'起点后不额外垫洗';
                const remaining=raw.has_bag_pills?Number(raw.bag_pills)-Number(r.cost||0):null;
                const remainingText=remaining==null?'':` · 执行后剩余 ${remaining} 丹`;
                 return `<details class="anchor-route" ${i===0?'open':''}><summary><strong>${i===0?'已找到路线中最省丹':'备选路线'} · ${esc(sequenceLabel(r))}${r.variant?' · '+esc(r.variant):''} · ${r.cost} 丹</strong><span>${esc(sourceText(r.source))} · ${esc(b0)} · ${slotText}${sameSequence>=0?' · 与上方第 '+(sameSequence+1)+' 条为同一序列的不同洗法':''}</span><span>${r.washes} 次洗髓 / ${r.exchanges} 次手动置换 / ${r.pities||0} 次保底 / 紫池深度 ${r.depthUsed}${remainingText}</span></summary><p class="anchor-help" style="padding:0 14px">${esc(preparationText(r))}</p><p class="anchor-final">✓ 完整回放通过 · ${esc(r.final.state.talents.map(name).join(' / '))}</p><div class="anchor-help" style="padding:0 14px"><b>各锚点的实际去向</b><br>${anchorPaths(r).map(esc).join('<br>')}</div><button class="btn btn-wash-plain anchor-copy" data-index="${i}" type="button">导出 TXT 洗法</button><div class="anchor-table-wrap"><table class="anchor-step-table"><thead><tr><th>步</th><th>具体操作</th><th>剩余洗髓丹</th><th>完成后的场上脉</th></tr></thead><tbody>${steps.map(s=>`<tr><td>${s.no}</td><td>${esc(s.text)}</td><td>${s.remaining==null?'—':s.remaining}</td><td>${esc(s.after)}</td></tr>`).join('')}</tbody></table></div>${r.sequence?`<details class="anchor-reports"><summary>这条路线的置换紫池参考</summary><p>${r.pad>0&&!r.sequence.fixedLuck?'垫洗停点 b0':'首次置换前末槽参考'}：${esc(r.sequence.b0.map(name).join('、')||'空')}<br>${esc(r.sequence.pool.map(name).join(' → '))}<br>${r.sequence.basisZi===152?'这是二槽理论紫池；上面的操作步骤已按当前实际槽位完整回放。':'这是当前实际槽位紫池'}；手动置换与保底按场上已有脉跳过同名，深度从首次置换开始累计。开槽后按新资质核对。</p></details>`:''}</details>`;
            }).join(''):`<p class="anchor-empty">${data.searching?'还在寻找可执行路线；找到后会立即显示，随时可以停止。':'当前探索范围内未找到可执行路线。可以调整锚点或增加搜索强度；达到节点上限的序列仍有分支未检查。'}</p>`)+
            `<details class="anchor-reports"><summary>查看搜索范围与未找到原因</summary>${stages.map(s=>`<p>${meta.automatic?'第 '+(s.stage+1)+' 阶段 · n=0–'+(s.limit-1):'指定序列'} · 深度 ${s.depth}：已处理 ${s.checked}/${s.total} 组；初筛排除 ${s.filtered} 组，${s.found} 组找到路线，${s.bounded} 组达到节点上限，准备失败 ${s.failed} 组，欧气固定略过 ${s.fixedSkipped} 组。</p>`).join('')}<p>详情保留最近 60 组；排名仅限已回放验证的路线。${meta.automatic?'扩大深度时会重新检查前面的序列。':''}</p>${reports.map(r=>`<p>${esc(sourceText(r.source))} · n=${r.pad??'—'}：${esc(r.error||`${r.expanded} 个状态，深度上限 ${r.depth}，${r.filtered?'初筛排除':r.bounded?'达到节点上限，仍有分支未探索':'本轮有界探索结束'}。${r.reason}`)}</p>`).join('')}</details>`;
    }
    function progressText(d) {
        const automatic=d.meta?.automatic;
        const prefix=automatic?`第 ${d.stage+1} 阶段 · ${d.limit} 条 / 深度 ${d.depth}`:'指定序列推演';
        return `${prefix} · ${sourceText(d.source)} · n=${d.pad} · 本阶段已处理 ${d.meta?.stages[d.stage]?.checked||0}/${d.total} 组${d.expanded?' · 当前探索 '+d.expanded+' 个状态':''}`;
    }
    function run() {
        try {
            if(lastFingerprint!==fingerprint()){invalidate();return;}
            const anchors=selected(), targetIds=targets(), source=purples[Number($('anchorSource').value)];
            if(![3,4].includes(anchors.length)||anchors.length!==targetIds.length)throw new Error('锚点和目标都需选择 3 个或 4 个，数量相同。');
            const automatic=isAuto();
            if(automatic&&!AnchorRoutePlanner.usableSources(raw,anchors,purples).length)throw new Error('首个锚点及其之前没有可用置换起点，请调整锚点。');
            if(!automatic&&(!source||$('anchorSource').value===''))throw new Error('请选择可用的置换起点。');
            const pads=automatic?[]:parsePads($('anchorPads').value);
            cancel();const token=generation;
            routes=[];lastPacket=null;$('anchorResults').innerHTML='';$('anchorRun').disabled=true;$('anchorCancel').disabled=false;
            const url=new URL('anchor_route_worker.js',document.currentScript?.src||new URL('../shared/anchor_route_ui.js',location.href));
            if(window.AnchorRouteWorkerSource){
                workerBlobUrl=URL.createObjectURL(new Blob([window.AnchorRouteWorkerSource],{type:'text/javascript'}));
                worker=new Worker(workerBlobUrl);
            }else if(location.protocol==='file:')throw new Error('离线计算文件未加载，请刷新页面，或双击“启动锚点预览.cmd”打开。');
            else worker=new Worker(url);
            worker.onmessage=ev=>{
                if(token!==generation)return;
                const d=ev.data;
                if(d.type==='error'){cancel('推演未完成：'+d.message);return;}
                if(d.type==='progress'){
                    if(lastPacket)lastPacket.meta=d.meta;
                    $('anchorStatus').textContent=progressText(d);return;
                }
                lastPacket={...d,searching:d.type!=='done'};render(lastPacket);
                if(d.type==='candidate')$('anchorStatus').textContent=`${sourceText(d.source)} · n=${d.pad} 找到 ${d.candidate.cost} 丹路线；继续比较中，可随时停止查看。`;
                else if(d.type==='done'){
                    cancel();
                    const scope=d.meta.automatic?`完成 ${d.meta.stages.length} 个阶段、${d.meta.sourceCount} 个起点的有界搜索`:'指定序列推演完成';
                    $('anchorStatus').textContent=`${scope}：${routes.length?'当前最优路线 '+routes[0].cost+' 丹':'当前范围内未找到可执行路线'}。`;
                }else if(d.type==='stage')$('anchorStatus').textContent=`开始第 ${d.stage+1} 阶段：每个起点 ${d.limit} 条，深度 ${d.depth}。`;
                else if(d.type==='stageDone')$('anchorStatus').textContent=`第 ${d.stage+1} 阶段比较完成，当前最优路线已更新。`;
                else $('anchorStatus').textContent=progressText(d);
            };
            worker.onerror=()=>{cancel('计算未能启动，请双击 web 文件夹中的“启动锚点预览.cmd”打开后重试。');};
            worker.postMessage({mode:automatic?'auto':'manual',raw,anchors,purples,source,pads,options:{targets:targetIds,depth:Number($('anchorDepth').value),maxNodes:Number($('anchorStrength').value),sequenceBasis:$('anchorSequenceBasis').value,maxCost:50000,exhaustive:$('anchorSearchAll').checked}});
            $('anchorStatus').textContent=automatic?'开始自动找序列；无需填写起点或 n。可随时停止，已验证路线保留。':'开始推演；可随时停止，已完成的路线会保留。';
        }catch(err){cancel();$('anchorStatus').textContent=err.message;}
    }
    function filePart(value) {
        return String(value??'').replace(/[\\/:*?"<>|]/g,'_').replace(/\s+/g,'_').slice(0,80)||'洗法';
    }
    function exportTxt(index) {
        const r=routes[index];if(!r)return;
        const text=[`${$('anchorRole').textContent}`,`目标：${targets().map(name).join('、')}`,`锚点：${selected().map(a=>'#'+a.no+' '+(a.fromPity?'第 '+a.pityNo+' 次保底（无锁参考：'+a.name+'）':a.name+' (RC '+a.bornRC+')')).join('、')}`,`${sourceText(r.source)}；${sequenceLabel(r)}；${r.cost} 丹；${r.washes} 次洗髓；${r.exchanges} 次手动置换；${r.pities||0} 次保底`,preparationText(r),...anchorPaths(r),...describeSteps(r).map(s=>`${s.no}. ${s.text}（剩余 ${s.remaining==null?'未知':s.remaining} 丹）\n   场上：${s.after}`),'已从导入状态完整回放验证。请按步骤开启第4槽。'].join('\n');
        const role=String($('anchorRole').textContent||'角色').split(' · ')[0];
        const filename=`${filePart(role)}_${filePart(sequenceLabel(r))}_${r.cost}丹.txt`;
        const blob=new Blob([`\uFEFF${text}\n`],{type:'text/plain;charset=utf-8'});
        const url=URL.createObjectURL(blob),link=document.createElement('a');
        link.href=url;link.download=filename;link.style.display='none';document.body.appendChild(link);link.click();link.remove();
        setTimeout(()=>URL.revokeObjectURL(url),1000);
        $('anchorStatus').textContent=`TXT 洗法已导出：${filename}`;
    }
    function updateMode() {
        $('anchorManual').hidden=isAuto();$('anchorAutoInfo').hidden=!isAuto();
        $('anchorRun').textContent=isAuto()?'④ 自动找序列与洗法':'④ 推演可执行洗法';
    }
    function init() {
        // 自动洗脉独立放到「自动模拟」页签，洗髓页保留手动模拟界面，避免路线规划器挤占主操作区。
        const autoView = window.YYJH_SIMULATOR_VIEW === 'auto'
            || new URLSearchParams(window.location.search).get('view') === 'auto';
        if (!autoView) return;
        const panel=document.createElement('section');panel.className='anchor-panel';panel.id='anchorRoutePanel';
        panel.innerHTML=`
        <div class="anchor-heading"><div><span class="anchor-eyebrow">自动找序列 · 指定序列复核</span><h2>锚点洗脉路线</h2></div><div class="anchor-heading-actions"><label class="anchor-role-picker">当前角色<select id="anchorRoleSelect"><option value="">请先导入存档</option></select></label><button id="anchorRead" class="btn btn-wash-gold" type="button">读取当前角色原始紫</button></div></div>
        <p class="anchor-intro">选定目标和三／四个原始紫锚点，程序自动找置换起点与序列，比较丹耗，生成锁脉、洗脉、置换和开槽步骤。以导入状态起算。普通紫需要排在它前面的已锁低阶冲突脉，必须提前准备；紫后补冲突不能续换。不同神脉可互冲。三紫路线也可能需要开启第4槽。</p>
        <p class="anchor-help">结果中的“紫后第 7 条（n=7）”是按标准每洗一条推进得到的序列编号，与置换脉序查找对应。优化开槽和锁法后，实际垫洗次数可能减少，以生成步骤为准；手动置换次数另列。同一序列可以有不同洗法和丹耗。</p>
        <div class="anchor-role"><span id="anchorRole">请先选择存档角色，再读取原始紫。</span><label class="anchor-pill-budget">路线丹数<input id="anchorPillInput" type="number" min="0" max="20000" step="1" placeholder="当前背包"><span>丹</span></label></div>
        <div class="anchor-fields"><div><h3>① 目标紫脉</h3><div id="anchorTargets" class="anchor-chips"></div></div><div><h3>② 原始紫锚点</h3><p class="anchor-help">显示无锁参考位置，自然紫按具体出现事件追踪，同名紫分别选择。保底紫可作锚点，按导入后第几次保底追踪；它取当时置换池的下一个可用紫，实际脉名和时间会随操作变化。</p><div id="anchorChoices" class="anchor-grid"></div></div></div>
        <div class="anchor-toolbar"><label>③ 搜索方式<select id="anchorMode"><option value="auto" selected>自动找序列与洗法</option><option value="manual">指定序列推演</option></select></label><label>序列基准<select id="anchorSequenceBasis"><option value="theory2" selected>二槽理论筛选（实际回放）</option><option value="actual">实际槽位筛选</option></select></label><label>搜索强度<select id="anchorStrength"><option value="3000" selected>快速 · 主搜索 3 千状态</option><option value="10000">标准 · 主搜索 1 万状态</option><option value="30000">深入 · 主搜索 3 万状态</option></select></label></div><p class="anchor-help">二槽理论只用于确定紫池和 n；锁脉、点击次数、开槽、置换和最终结果都按当前角色实际槽位回放。</p>
        <p class="anchor-help">找到可行洗法后，会在同一置换序列内比较提前／晚锁冲突、少锁快洗及开第四槽的时机，重新推演后续步骤，只保留完整回放通过的省丹方案。</p>
        <div id="anchorAutoInfo" class="anchor-auto-info"><p id="anchorAutoSources" class="anchor-help">读取后自动确定可用起点。</p><p class="anchor-help">每个起点先查 100 条（n=0–99），深度 10；没找到则扩大到 200 条、深度 15，再到 300 条、深度 20。扩大深度时重新检查前面的序列。最多保留 3 条完整回放路线，找到 3 条后停止搜索。</p><label class="anchor-option"><input id="anchorSearchAll" type="checkbox">不足 3 条时仍搜索全部三个阶段，比较更多洗法（耗时更长）</label></div>
        <div id="anchorManual" class="anchor-toolbar" hidden><label>置换起点<select id="anchorSource"><option value="">请先读取原始紫</option></select></label><label>指定 n（标准垫洗编号）<input id="anchorPads" value="44" placeholder="44 或 31,44 或 0-10"></label><label>紫池深度<select id="anchorDepth"><option value="10">10</option><option value="15">15</option><option value="20" selected>20</option><option value="30">30</option></select></label><p class="anchor-help">n=44 是按标准每洗一条推进的序列编号；优化开槽与锁法后，实际垫洗次数可能减少。以生成步骤的次数为准。指定模式一次最多比较 30 个 n。</p></div>
        <p class="anchor-help">起点在首个锚点及其之前；一心不能作置换起点。保底后欧气固定，只能按固定序列处理。搜索可随时停止，已验证路线会保留。未找到不代表绝对无解。</p>
        <div class="anchor-actions"><span id="anchorSelection">未选择锚点和目标</span><button id="anchorRun" class="btn btn-wash-gold" type="button" disabled>④ 自动找序列与洗法</button><button id="anchorCancel" class="btn btn-wash-plain" type="button" disabled>停止搜索</button></div><p id="anchorStatus" class="anchor-status" role="status" aria-live="polite">先读取原始紫，选择目标和锚点。</p><div id="anchorResults"></div>`;
        // 自动模拟页的容器由页面结构负责提供；脚本可能比后续模块更早执行，
        // 因此等容器出现后再挂载，避免路线面板落到 main 顶部挤出页签。
        const mount = () => {
            const host = $('autoWashModePanel');
            if (!host) {
                setTimeout(mount, 0);
                return;
            }
            host.append(panel);
        };
        mount();
        $('anchorRead').addEventListener('click',read);$('anchorRoleSelect').addEventListener('change',ev=>{if(!ev.target.value)return;try{if(typeof selectRoleFromSave==='function')selectRoleFromSave(ev.target.value);read();}catch(err){$('anchorStatus').textContent=err.message;}});$('anchorPillInput').addEventListener('input',ev=>{if(Number(ev.target.value)>20000)ev.target.value='20000';});$('anchorPillInput').addEventListener('change',ev=>setPillBudget(ev.target.value));$('anchorRun').addEventListener('click',run);$('anchorCancel').addEventListener('click',()=>cancel('已停止推演；已完成的结果保留。'));
        $('anchorChoices').addEventListener('change',()=>{cancel();routes=[];lastPacket=null;$('anchorResults').innerHTML='';renderSources();});
        $('anchorTargets').addEventListener('change',()=>{cancel();routes=[];lastPacket=null;$('anchorResults').innerHTML='';renderSources();});
        ['anchorMode','anchorSequenceBasis','anchorSource','anchorPads','anchorDepth','anchorStrength','anchorSearchAll'].forEach(id=>$(id).addEventListener('change',()=>{cancel();routes=[];lastPacket=null;$('anchorResults').innerHTML='';updateMode();$('anchorStatus').textContent='参数已变化，请重新搜索。';}));
        $('anchorResults').addEventListener('click',ev=>{const b=ev.target.closest('.anchor-copy');if(b)exportTxt(Number(b.dataset.index));});
        setInterval(()=>{syncRolePicker();if(raw&&fingerprint()!==lastFingerprint)invalidate();},700);
    }
    if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',init);else init();
})();
