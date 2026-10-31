// 作者：dz
(function (root) {
    'use strict';
    const MAX_DIVERGENCE_BRANCHES = 3;
    function divergenceBranches(variants) {
        const selected = variants.slice(0, MAX_DIVERGENCE_BRANCHES);
        const fourSlot = variants.find(node => node.zi === 154);
        if (fourSlot && !selected.some(node => node.zi === 154)) {
            selected[selected.length - 1] = fourSlot;
        }
        return selected;
    }
    const clone = s => root.WashSourceEngine.cloneState(s);
    function engine(raw, zi, options={}) {
        const zz = root.ZZ_DATA[String(zi)];
        if (!zz || (zz.num_talent < 3 && !(options.allowTwoSlot && Number(zi)===152))) throw new Error('第一版需要三槽或四槽资质。');
        return new root.WashSourceEngine.Engine(root.TALENT_DATA, raw, {
            slotCount: zz.num_talent, pity: zz.bd_zz, eat: zz.eat_xisui,
            eligibleZi: zi, advancePerDraw: true, international: false,
        });
    }
    // 保底锚点代表导入状态之后第几次保底，不绑定无锁预览的名字或种子。
    const eventKey = e => e.fromPity ? `p:${e.pityNo}` : `r:${e.bornRC}:${e.id}`;
    function scan(raw, count = 12) {
        const e = engine(raw, raw.zizhi);
        let s = e.initialState(raw), previousRC = s.bornRC, pityNo = 0;
        const items = [];
        for (let w = 1; w <= 12000 && items.length < count; w++) {
            const r = e.wash(s, []); s = r.state;
            for (const ev of r.generatedEvents) if (e.quality(ev.id) === 4) {
                if (ev.fromPity) ev.pityNo = ++pityNo;
                items.push({ ...ev, key: eventKey(ev), no: items.length + 1, wash: w,
                    name: e.name(ev.id), gap: ev.bornRC - previousRC });
                previousRC = ev.bornRC;
            }
        }
        return items;
    }
    function snapshot(n) { return { state: clone(n.s), zi: n.zi, origins: n.o.slice(), seen: n.seen, cost: n.cost,
        pityCount: n.pityCount, poolStarted: n.poolStarted, draws: n.draws, poolDraws: n.poolDraws }; }
    function makeContext(raw, anchors) {
        const cache = new Map();
        return { raw, anchors, byKey: new Map(anchors.map((a,i) => [a.key, i])),
            e(zi) { if (!cache.has(zi)) cache.set(zi, engine(raw, zi)); return cache.get(zi); } };
    }
    function start(ctx) {
        const s=ctx.e(ctx.raw.zizhi).initialState(ctx.raw);
        return { s, zi: Number(ctx.raw.zizhi),
            o: s.talents.map(() => -1), seen: 0, cost: 0, draws: 0, poolDraws: 0, poolStarted: false,
            pityCount: 0, pityEvents: [], exchanges: 0, washes: 0, trace: null };
    }
    function washOne(ctx, n, keep) {
        const r = ctx.e(n.zi).wash(n.s, keep);
        const o = keep.map(i => n.o[i]);
        let seen = n.seen, pityCount = n.pityCount, pityEvents = n.pityEvents;
        for (const ev of r.generatedEvents) {
            if (ev.fromPity) {
                ev.pityNo = ++pityCount;
                pityEvents = [...pityEvents, { no: pityCount, id: ev.id, wash: n.washes + 1,
                    bornRC: ev.bornRC, purpleDraws: r.purpleDraws }];
            }
            const origin = ctx.byKey.has(eventKey(ev)) ? ctx.byKey.get(eventKey(ev)) : -1;
            o.push(origin);
            if (origin >= 0) seen |= 1 << origin;
        }
        return { ...n, s: r.state, o, seen, pityCount, pityEvents, cost: n.cost + r.cost, washes: n.washes + 1,
            poolDraws: n.poolDraws + (r.purpleDraws || 0), draws: n.draws + (n.poolStarted ? r.purpleDraws || 0 : 0) };
    }
    function missed(ctx, n) {
        return ctx.anchors.some((a,i) => (n.seen & (1 << i)) ? !n.o.includes(i)
            : a.fromPity ? n.pityCount >= a.pityNo : n.s.bornRC >= a.bornRC);
    }
    function record(before, after, action) {
        if (action.type === 'wash') action = { ...action, pityEvents: after.pityEvents.slice(before.pityCount) };
        after.trace = { prev: before.trace, action: { ...action, before: snapshot(before), after: snapshot(after) } };
        return after;
    }
    function keepIds(n, keep) { return keep.map(i => n.s.talents[i]); }
    function macro(ctx, n, keep, count, why) {
        const ids = keepIds(n, keep);
        let x = n;
        for (let i = 0; i < count; i++) {
            const k = ids.map(id => x.s.talents.indexOf(id));
            if (k.some(v => v < 0)) throw new Error('锁定脉丢失');
            if (x.o.some((v,j) => v>=0 && !k.includes(j))) throw new Error('垫洗将洗掉已捕获的锚点，请减少 n。');
            x = washOne(ctx, x, k);
            if (missed(ctx, x)) throw new Error('准备步骤已越过所选锚点');
        }
        return count ? record(n, x, { type: 'wash', keepIds: ids, count, why }) : n;
    }
    function prepareSource(ctx, source) {
        const initial = start(ctx), e = ctx.e(initial.zi);
        const conflicts = e.allIds.filter(id => e.allowed.has(id) && (e.isShenmai(source.id)
            ? e.isShenmai(id) && id !== source.id
            : e.quality(id) < 4 && e.talentType(id) === e.talentType(source.id)));
        if (!conflicts.length) throw new Error('这个起点没有可用冲突脉（如一心两用），无法初始化置换。');
        // 无锁预读至起点，按出现事件从近到远尝试，不能按脉名寻找最早的同名脉。
        // 锁脉会改变去重和保底，最近一次未必能捕获指定 RC；必须实际重演准备过程。
        const candidates = initial.s.talents.filter(id => conflicts.includes(id))
            .map(id => ({ id, node: initial, captured: false }));
        let scan = initial;
        for (let w=0; w<12000 && scan.s.bornRC<source.bornRC; w++) {
            const r=e.wash(scan.s,[]);
            scan=washOne(ctx,scan,[]);
            const captured=r.generatedEvents.some(ev=>eventKey(ev)===source.key);
            if (!missed(ctx,scan)) for (const ev of r.generatedEvents) {
                if (!conflicts.includes(ev.id) || ev.bornRC>=source.bornRC) continue;
                candidates.push({id:ev.id,node:scan,captured});
            }
            if (captured || missed(ctx,scan)) break;
        }
        for (let i=candidates.length-1; i>=0; i--) {
            const candidate=candidates[i], conflict=candidate.id;
            let n={...candidate.node}, found=candidate.captured, loops=0;
            if (n.washes) n=record(initial,n,{type:'wash',keepIds:[],count:n.washes,why:'无锁洗到起点紫前最近可用冲突脉'});
            const beforeSource=n;
            while (!found && loops<12000 && n.s.bornRC<source.bornRC) {
                const k=[n.s.talents.indexOf(conflict)];
                if (n.o.some((v,j)=>v>=0 && !k.includes(j))) break;
                const r=e.wash(n.s,k);
                n=washOne(ctx,n,k);loops++;
                found=r.generatedEvents.some(ev=>eventKey(ev)===source.key);
                if (missed(ctx,n)) break;
            }
            const pos=n.s.talents.indexOf(source.id);
            if (!found || missed(ctx,n) || !e.replaceablePositions(n.s,[conflict]).includes(pos)) continue;
            if (loops) n=record(beforeSource,n,{type:'wash',keepIds:[conflict],count:loops,why:`捕获原始紫 #${source.no}`});
            return {n,conflict};
        }
        throw new Error('起点紫之前未找到能捕获指定原始紫并置换的前置冲突脉。');
    }
    function initialize(ctx, source, pad) {
        let {n,conflict}=prepareSource(ctx,source);
        const e=ctx.e(n.zi);
        let keep = n.s.talents.map((id,i) => id === conflict || id === source.id ? i : -1).filter(i => i >= 0);
        if (e.slotCount === 4) {
            const pos = n.s.talents.findIndex((id,i) => !keep.includes(i) && e.quality(id) < 4);
            if (pos < 0) throw new Error('四槽起点未找到可用于垫洗的第三条锁脉。');
            keep.push(pos); keep.sort((a,b) => a-b);
        }
        if (n.s.luckSeed != null && pad > 0)
            throw new Error('此前已触发保底或欧气已固定，只能使用 n=0 的固定序列。');
        n = macro(ctx, n, keep, pad, `无限置换垫洗 n=${pad}`);
        if (pad > 0 && n.s.luckSeed != null)
            throw new Error('垫洗中触发保底，欧气已固定；此 n 不能当作重新初始化的无限置换序列。');
        const pos = n.s.talents.indexOf(source.id);
        const r = e.replace(n.s, pos, [conflict]);
        const o = n.o.slice(); const origin = o.splice(pos,1)[0]; o.push(origin);
        const next = { ...n, s:r.state, o, poolStarted:true, draws:n.draws+r.purpleDraws,
            poolDraws:n.poolDraws+r.purpleDraws, exchanges:n.exchanges+1 };
        return record(n, next, { type:'exchange', position:pos, keepIds:[conflict], from:r.removedId, to:r.addedId });
    }
    function actions(n) {
        const out = [];
        for (let t = n.trace; t; t=t.prev) out.push(t.action);
        return out.reverse();
    }
    function exchangeNode(ctx, n, pos, locks) {
        const r=ctx.e(n.zi).replace(n.s,pos,locks),o=n.o.slice(),origin=o.splice(pos,1)[0];o.push(origin);
        return record(n,{...n,s:r.state,o,poolStarted:true,draws:n.draws+r.purpleDraws,
            poolDraws:n.poolDraws+r.purpleDraws,exchanges:n.exchanges+1},
            {type:'exchange',position:pos,keepIds:locks,from:r.removedId,to:r.addedId});
    }
    // n 保留标准单条垫洗的编号。改变开槽和锁法时，必须回到同一个自然种子停点，
    // 不能把新的点击次数当成另一条序列，也不能让保底偷偷初始化欧气。
    function padVariants(ctx, initial, source, sequence, targets, captured=null) {
        const first=initial.trace.action,steps=actions(initial),padStep=steps.findIndex(a=>a.why?.startsWith('无限置换垫洗 n='));
        if(padStep<0)return [];
        const base=captured||prefixNode(ctx,steps.slice(0,padStep)),end=first.before.state;
        if(base.s.luckSeed!=null||end.luckSeed!=null)return [];
        const required=steps[padStep].keepIds.filter(id=>id===source.id||first.keepIds.includes(id)||base.o[base.s.talents.indexOf(id)]>=0);
        if(required.some(id=>!base.s.talents.includes(id)))return [];
        const usefulTypes=new Set(sequence.pool.filter(id=>!targets.includes(id)).map(id=>ctx.e(154).talentType(id)));
        const variants=[],keys=new Set();
        function finish(n) {
            if(n.s.bornRC!==end.bornRC||n.s.bornSeed!==end.bornSeed||n.s.luckSeed!=null||missed(ctx,n)||n.pityCount!==base.pityCount)return;
            const e=ctx.e(n.zi),pos=n.s.talents.indexOf(source.id),locks=n.s.talents.filter(id=>e.quality(id)<4||first.keepIds.includes(id));
            if(!e.replaceablePositions(n.s,locks).includes(pos))return;
            const next=exchangeNode(ctx,n,pos,locks);
            // 保持首手和首手后的欧气种子一致；同名跳过变化不能冒充原序列洗法。
            if(next.s.talents.at(-1)!==first.to||next.s.luckSeed!==initial.s.luckSeed)return;
            const key=[next.zi,root.WashSourceEngine.stateKey(next.s),next.o.join(',')].join('|');
            if(!keys.has(key)){keys.add(key);variants.push(next);}
        }
        for(const zi of base.zi===153?[153,154]:[base.zi]) {
            const ready=zi===base.zi?base:record(base,{...base,zi},{type:'upgrade',toZi:zi}),e=ctx.e(zi);
            if(required.length>=e.slotCount)continue;
            let scan=ready,w=0;
            const candidates=[];
            function remember(n,count) {
                for(const id of n.s.talents)if(!required.includes(id)&&e.quality(id)<4)
                    candidates.push({id,node:n,count,useful:usefulTypes.has(e.talentType(id))});
            }
            remember(scan,0);
            while(w<12000&&scan.s.bornRC<end.bornRC&&scan.s.luckSeed==null) {
                scan=washOne(ctx,scan,required.map(id=>scan.s.talents.indexOf(id)));w++;
                if(missed(ctx,scan))break;
                remember(scan,w);
                if(scan.s.bornRC===end.bornRC)finish(record(ready,{...scan},{type:'wash',keepIds:required,count:w,why:'同序列少锁快洗到置换停点'}));
            }
            // 最近的事件先比较；同名冲突每次出现的种子不同，不能按名字去重。
            const shortlisted=candidates.filter((a,i)=>a.useful||i>=candidates.length-8).reverse().slice(0,80);
            for(const c of shortlisted) {
                const ids=[...required,c.id];if(ids.length>=e.slotCount)continue;
                const before=c.count?record(ready,{...c.node},{type:'wash',keepIds:required,count:c.count,why:'同序列少锁快洗，准备提前冲突'}):ready;
                let n=before,count=0;
                while(count<12000&&n.s.bornRC<end.bornRC&&n.s.luckSeed==null) {
                    n=washOne(ctx,n,ids.map(id=>n.s.talents.indexOf(id)));count++;
                    if(missed(ctx,n))break;
                }
                if(count)finish(record(before,n,{type:'wash',keepIds:ids,count,why:'同序列提前锁冲突，精确到置换停点'}));
            }
        }
        // 不同前置冲突都保留少量候选，避免最便宜停点缺少后续操作空间。
        const groups=new Map();
        variants.sort((a,b)=>a.cost-b.cost||a.exchanges-b.exchanges||a.washes-b.washes);
        for(const n of variants) {
            const e=ctx.e(n.zi),key=n.s.talents.filter(id=>e.quality(id)<4&&usefulTypes.has(e.talentType(id))).map(id=>e.talentType(id)).sort().join(',');
            const group=groups.get(key)||[];if(group.length<2)group.push(n);groups.set(key,group);
        }
        return [...groups.values()].flat().sort((a,b)=>a.cost-b.cost).slice(0,12);
    }
    function usableSources(raw, anchors, purples) {
        const limit=anchors.length?Math.min(...anchors.map(a=>a.bornRC)):Infinity;
        const e=engine(raw,raw.zizhi);
        return purples.filter(a=>!a.fromPity&&a.bornRC<=limit&&e.allIds.some(id=>e.allowed.has(id)&&
            (e.isShenmai(a.id)?e.isShenmai(id)&&id!==a.id:e.quality(id)<4&&e.talentType(id)===e.talentType(a.id))));
    }
    // 沿已验证的置换链先做一次有限的直接推演，避免简单的连续置换
    // 被大量“刷另一条冲突”的分支挤掉。没有完成就仍交给原搜索。
    function guidedShortcut(ctx, node, guide, targets, depth, maxCost) {
        let n=node;
        const valid=x=>!missed(ctx,x)&&x.cost<maxCost&&x.draws<=depth;
        const required=(x,changing=-1)=>{
            const e=ctx.e(x.zi),keep=x.o.map((v,i)=>v>=0?i:-1).filter(i=>i>=0);
            for(const pos of keep.slice())if((pos===changing||!targets.includes(x.s.talents[pos]))&&!e.isShenmai(x.s.talents[pos])) {
                const conflict=x.s.talents.findIndex((id,i)=>i<pos&&e.quality(id)<4&&e.talentType(id)===e.talentType(x.s.talents[pos]));
                if(conflict<0)return null;if(!keep.includes(conflict))keep.push(conflict);
            }
            return keep.sort((a,b)=>a-b).map(i=>x.s.talents[i]);
        };
        const segment=(base,end,ids,count,why)=>count?record(base,{...end},{type:'wash',keepIds:ids,count,why}):base;
        for(let action=n.exchanges;action<guide.length;action++) {
            const next=guide[action],e=ctx.e(n.zi);
            let pos=n.o.findIndex((v,i)=>v===next.origin&&n.s.talents[i]===next.from);
            if(pos<0) {
                if(next.origin<0||n.o.includes(next.origin))return null;
                const ids=required(n);if(!ids||ids.length>=e.slotCount)return null;
                const before=n,candidates=[];let scan=n;
                const needs=id=>e.quality(id)<4&&e.talentType(id)===e.talentType(next.from);
                const remember=(x,count)=>{
                    for(const id of x.s.talents)if(needs(id))candidates.push({node:x,id,count});
                };
                remember(scan,0);
                for(let w=1;w<=12000;w++) {
                    scan=washOne(ctx,scan,ids.map(id=>scan.s.talents.indexOf(id)));
                    if(!valid(scan))break;
                    if(scan.o.includes(next.origin)||scan.pityCount!==before.pityCount)break;
                    remember(scan,w);
                }
                // 神脉无需普通前置冲突，直接捕获；普通紫比较最近的准备事件。
                if(e.isShenmai(next.from)) {
                    let x=before,w=0;
                    while(!x.o.includes(next.origin)&&w<12000&&valid(x)) {
                        x=washOne(ctx,x,ids.map(id=>x.s.talents.indexOf(id)));w++;
                    }
                    if(!valid(x)||!x.o.includes(next.origin))return null;
                    n=segment(before,x,ids,w,'同序列少锁捕获神脉锚点');
                } else {
                    let cheapest=null;
                    for(const c of candidates.slice(-8).reverse()) {
                        const ready=segment(before,c.node,ids,c.count,'同序列晚锁，准备后续紫前冲突');
                        const locks=[...ids.filter(id=>id!==c.id),c.id];
                        if(locks.length>=e.slotCount)continue;
                        let x=ready,w=0;
                        while(!x.o.includes(next.origin)&&w<12000&&valid(x)) {
                            x=washOne(ctx,x,locks.map(id=>x.s.talents.indexOf(id)));w++;
                        }
                        const at=x.o.indexOf(next.origin);
                        if(!valid(x)||at<0||x.s.talents[at]!==next.from||
                            !e.replaceablePositions(x.s,locks).includes(at))continue;
                        if(!cheapest||x.cost<cheapest.cost)
                            cheapest=segment(ready,x,locks,w,'同序列锁好前置冲突，捕获紫脉锚点');
                    }
                    if(!cheapest)return null;n=cheapest;
                }
                pos=n.o.indexOf(next.origin);
            }
            if(n.s.talents[pos]!==next.from)return null;
            // 新紫追加到末尾。若它还要继续换，先备好它的冲突再按下置换。
            if(!targets.includes(next.to)&&!e.isShenmai(next.to)&&
                !n.s.talents.some(id=>e.quality(id)<4&&e.talentType(id)===e.talentType(next.to))) {
                const ids=required(n,pos);if(!ids||ids.length>=e.slotCount)return null;
                const before=n;let x=n,w=0;
                while(w<12000&&valid(x)) {
                    x=washOne(ctx,x,ids.map(id=>x.s.talents.indexOf(id)));w++;
                    if(!valid(x)||x.pityCount!==before.pityCount)return null;
                    if(x.s.talents.some(id=>e.quality(id)<4&&e.talentType(id)===e.talentType(next.to)))break;
                }
                if(!x.s.talents.some(id=>e.quality(id)<4&&e.talentType(id)===e.talentType(next.to)))return null;
                n=segment(before,x,ids,w,'同序列提前准备下一紫的冲突');pos=n.o.indexOf(next.origin);
            }
            const locks=n.s.talents.filter(id=>e.quality(id)<4);
            if(!e.replaceablePositions(n.s,locks).includes(pos))return null;
            const changed=exchangeNode(ctx,n,pos,locks);
            if(changed.s.talents.at(-1)!==next.to||!valid(changed))return null;n=changed;
        }
        return complete(n,targets,ctx.anchors.length)?n:null;
    }
    function sequenceInfo(ctx, initial, depth, basisZi=null) {
        const base=initial.trace.action.before.state, sequenceZi=Number(basisZi)||initial.zi,
            pe=sequenceZi===152?engine(ctx.raw,152,{allowTwoSlot:true}):ctx.e(sequenceZi), pool=[];
        let luck=base.luckSeed==null?base.bornSeed:base.luckSeed;
        for(let i=0;i<10000&&pool.length<depth;i++) {
            let id;[id,luck]=pe.draw(luck,true);
            if(pe.allowed.has(id))pool.push(id);
        }
        return {pool,seed:base.luckSeed==null?base.bornSeed:base.luckSeed,fixedLuck:base.luckSeed!=null,
            basisZi:sequenceZi,basisSlotCount:pe.slotCount,
            b0:initial.trace.action.before.cost>0?[base.talents[base.talents.length-1]]:[]};
    }
    // 初筛只回答“这条理论紫池有没有机会进入实际搜索”，不把它当作成功证明。
    // 一心两用没有冲突脉，出现后会直接占掉一个可用槽位；因此它能否出现，
    // 取决于置换起点到第一个锚点之间还有多少个原始紫可以被消化。
    function prefilterSequence(ctx, initial, anchors, source, sequence, targets) {
        const e=ctx.e(initial.zi), targetIds=targets.map(Number);
        const anchorIds=new Set(anchors.map(a=>Number(a.id)));
        const required=targetIds.filter(id=>!anchorIds.has(id));
        const pool=Array.isArray(sequence.pool)?sequence.pool.map(Number):[];
        const possible=new Set([...anchorIds,...pool,
            ...initial.s.talents.filter((id,i)=>initial.o[i]>=0).map(Number)]);
        const missing=required.filter(id=>!possible.has(id));
        if(missing.length)return {ok:false,missing,reason:`锚点及本段置换紫池缺少目标：${missing.map(id=>e.name(id)).join('、')}。`};
        // 所有目标都已由锚点保留时，不需要从紫池中寻找“第一个目标”，
        // 也就没有一心占槽的前缀约束。
        if(!required.length)return {ok:true,required,oneMind:0,maxOneMind:0,distance:0};
        const firstTarget=pool.findIndex(id=>required.includes(id));
        const prefix=firstTarget<0?pool:pool.slice(0,firstTarget);
        const oneMind=prefix.reduce((n,id)=>n+(id===251?1:0),0);
        const ordered=anchors.slice().sort((a,b)=>Number(a.bornRC)-Number(b.bornRC));
        const firstAnchor=ordered[0];
        const sourceNo=Number(source&&source.no),anchorNo=Number(firstAnchor&&firstAnchor.no);
        // scan() 给出的 no 是自然紫顺序；没有 no 的旧调用按 0 处理，
        // 仍保留目标存在性筛选，不误杀旧存档。
        const distance=Number.isFinite(sourceNo)&&Number.isFinite(anchorNo)
            ?Math.max(0,anchorNo-sourceNo):0;
        const maxOneMind=distance;
        if(oneMind>maxOneMind)return {ok:false,missing:[],oneMind,maxOneMind,distance,
            reason:`一心两用在首个目标前出现 ${oneMind} 次，起点到首个锚点仅允许 ${maxOneMind} 次。`};
        return {ok:true,required,oneMind,maxOneMind,distance};
    }
    function replay(raw, anchors, route, targets) {
        const ctx = makeContext(raw, anchors);
        let n = start(ctx);
        for (const a of route) {
            if (JSON.stringify(snapshot(n)) !== JSON.stringify(a.before)) throw new Error('回放起点不一致');
            if (a.type === 'wash') {
                for (let i=0; i<a.count; i++) {
                    const k = a.keepIds.map(id => n.s.talents.indexOf(id));
                    if (k.some(v => v<0)) throw new Error('回放锁脉不存在');
                    if (n.o.some((v,i) => v>=0 && !k.includes(i))) throw new Error('回放洗掉了锚点');
                    n = washOne(ctx,n,k);
                    if (missed(ctx,n)) throw new Error('回放错过锚点');
                }
            } else if (a.type === 'exchange') {
                const r=ctx.e(n.zi).replace(n.s,a.position,a.keepIds);
                if (r.removedId !== a.from || r.addedId !== a.to) throw new Error('回放置换结果不符');
                const o=n.o.slice(), v=o.splice(a.position,1)[0];o.push(v);
                n={...n,s:r.state,o,poolStarted:true,draws:n.draws+r.purpleDraws,
                    poolDraws:n.poolDraws+r.purpleDraws,exchanges:n.exchanges+1};
            } else if (a.type === 'upgrade') {
                if (n.zi !== 153 || a.toZi !== 154) throw new Error('回放开槽不符');
                n={...n,zi:154};
            } else throw new Error('未知动作');
            if (a.type === 'wash' && JSON.stringify(n.pityEvents.slice(a.before.pityCount)) !== JSON.stringify(a.pityEvents))
                throw new Error('回放保底结果不一致');
            if (JSON.stringify(snapshot(n)) !== JSON.stringify(a.after)) throw new Error('回放状态或丹耗不一致');
        }
        if (!complete(n, targets, anchors.length)) throw new Error('回放没有达成目标和锚点要求');
        return { verified:true, cost:n.cost, washes:n.washes, exchanges:n.exchanges, pities:n.pityCount, final:snapshot(n) };
    }
    function complete(n, targets, count) {
        return targets.every(id => n.s.talents.includes(id)) && new Set(n.o.filter(v => v>=0)).size === count
            && n.o.every((v,i) => v<0 || targets.includes(n.s.talents[i]));
    }
    function prefixNode(ctx, steps) {
        let n=start(ctx);
        for(const a of steps) {
            const before=n;
            if(a.type==='wash') {
                for(let w=0;w<a.count;w++) n=washOne(ctx,n,a.keepIds.map(id=>n.s.talents.indexOf(id)));
            } else if(a.type==='upgrade') n={...n,zi:a.toZi};
            else {
                const r=ctx.e(n.zi).replace(n.s,a.position,a.keepIds),o=n.o.slice(),v=o.splice(a.position,1)[0];o.push(v);
                n={...n,s:r.state,o,poolStarted:true,draws:n.draws+r.purpleDraws,
                    poolDraws:n.poolDraws+r.purpleDraws,exchanges:n.exchanges+1};
            }
            n=record(before,n,a.type==='wash'?{type:'wash',keepIds:a.keepIds,count:a.count,why:a.why}:a.type==='upgrade'?{type:'upgrade',toZi:a.toZi}:
                {type:'exchange',position:a.position,keepIds:a.keepIds,from:a.from,to:a.to});
        }
        return n;
    }
    function firstLockBranch(ctx, reference) {
        const steps=reference.steps||[];
        for(let i=0;i<steps.length;i++) {
            const a=steps[i];
            if(a.type!=='wash'||!a.keepIds?.length||a.before.seen!==0)continue;
            // 首次锁脉可能发生在第一次手动置换之前：这是捕获第一个原始紫的
            // 准备段，必须把它也作为“保留三槽／立即开四槽”的共同快照。
            const e=ctx.e(a.before.zi),hasConflict=a.keepIds.some(id=>e.quality(id)<4);
            if(!hasConflict)continue;
            const base=prefixNode(ctx,steps.slice(0,i));
            if(base.zi!==153)return {index:i,base,action:a};
            const four=record(base,{...base,zi:154},{type:'upgrade',toZi:154});
            return {index:i,base,four,action:a};
        }
        return null;
    }
    function prepareFirstLock(ctx, node, action, source) {
        // 起点可以在锚点前，此时 origin 为 -1。必须按原始紫出现事件捕获，
        // 不能用“新增锚点”判断是否已经洗到无限置换起点。
        const keepIds=action.keepIds.slice();
        if(keepIds.some(id=>!node.s.talents.includes(id)))return null;
        let n=node,count=0,found=false;
        while(!found&&n.s.bornRC<source.bornRC&&count<12000) {
            const keep=keepIds.map(id=>n.s.talents.indexOf(id));
            if(keep.some(v=>v<0))return null;
            const r=ctx.e(n.zi).wash(n.s,keep);
            n=washOne(ctx,n,keep);count++;
            found=r.generatedEvents.some(ev=>eventKey(ev)===source.key);
            if(missed(ctx,n))return null;
        }
        if(!found||n.s.luckSeed!=null||!ctx.e(n.zi).replaceablePositions(n.s,keepIds).includes(n.s.talents.indexOf(source.id)))return null;
        return record(node,n,{type:'wash',keepIds,count,why:'首次锁冲突脉，捕获置换起点紫'});
    }
    // 同一序列内沿已验证路线的“捕获锚点／置换”检查点做有限推演。
    // 仅跟置换链会漏掉暂时不置换的锚点（例如小雪的阳脉），也会把
    // “紫前多锁一个冲突”的分支按眼前丹耗剪掉，错过后面的连续置换。
    function milestoneVariants(ctx, nodes, reference, targets, depth, maxCost) {
        const stages=[];
        let exchange=0;
        for(const a of reference.steps) {
            if(a.type==='exchange')stages.push({kind:'exchange',index:exchange++,origin:a.before.origins[a.position],from:a.from,to:a.to});
            else if(a.type==='wash'&&a.before.seen!==a.after.seen) {
                for(const origin of a.after.origins.filter(v=>v>=0&&!(a.before.seen&(1<<v))))
                    stages.push({kind:'capture',origin,id:a.after.state.talents[a.after.origins.indexOf(origin)]});
            }
        }
        const rank=(a,b)=>a.cost-b.cost||a.exchanges-b.exchanges||a.washes-b.washes;
        const valid=n=>!missed(ctx,n)&&n.cost<maxCost&&n.draws<=depth;
        const segment=(a,b,ids,count,why)=>count?record(a,{...b},{type:'wash',keepIds:ids,count,why}):a;
        const mandatory=n=>n.o.map((v,i)=>v>=0?n.s.talents[i]:null).filter(v=>v!=null);
        function support(n, ids, index) {
            const e=ctx.e(n.zi);ids=ids.slice();
            for(const id of ids.slice())if(e.quality(id)===4&&!e.isShenmai(id)) {
                const pos=n.s.talents.indexOf(id),origin=n.o[pos];
                const changing=stages.slice(index).some(s=>s.kind==='exchange'&&s.origin===origin&&s.from===id);
                if(targets.includes(id)&&!changing)continue;
                const low=n.s.talents.find((v,i)=>i<pos&&e.quality(v)<4&&e.talentType(v)===e.talentType(id));
                if(low==null)return null;
                if(!ids.includes(low))ids.push(low);
            }
            return n.s.talents.filter(id=>ids.includes(id));
        }
        function select(candidates, next) {
            candidates.sort(rank);
            const groups=new Map(),seen=new Set(),unique=[];
            for(const n of candidates) {
                const state=[n.zi,root.WashSourceEngine.stateKey(n.s),n.o.join(','),n.seen,n.draws,n.pityCount].join('|');
                if(seen.has(state))continue;seen.add(state);unique.push(n);
                const e=ctx.e(n.zi),type=next?.kind==='exchange'?e.talentType(next.to):null;
                const ready=type!=null&&n.s.talents.some(id=>e.quality(id)<4&&e.talentType(id)===type);
                const key=[n.zi,ready].join('|');
                if(!groups.has(key))groups.set(key,n);
            }
            const result=[...groups.values()].slice(0,MAX_DIVERGENCE_BRANCHES);
            for(const n of unique)if(result.length<MAX_DIVERGENCE_BRANCHES&&!result.includes(n))result.push(n);
            return result;
        }
        function capture(base, step, index) {
            if(base.o.includes(step.origin))return [base];
            const e=ctx.e(base.zi),ids=support(base,mandatory(base),index);
            if(!ids)return [];
            const needed=targets.includes(step.id)||e.isShenmai(step.id)?[]:[e.talentType(step.id)];
            const next=stages[index+1];
            const optional=next?.kind==='exchange'&&next.origin===step.origin&&!targets.includes(next.to)&&!e.isShenmai(next.to)
                ?[e.talentType(next.to)]:[];
            const variants=[];
            function attempt(ready, locks) {
                if(locks.length>=e.slotCount)return;
                let x=ready,w=0;
                while(!x.o.includes(step.origin)&&w<12000&&valid(x)) {
                    x=washOne(ctx,x,locks.map(id=>x.s.talents.indexOf(id)));w++;
                }
                const pos=x.o.indexOf(step.origin);
                if(!valid(x)||pos<0||x.s.talents[pos]!==step.id)return;
                if(needed.length&&!e.replaceablePositions(x.s,locks).includes(pos))return;
                variants.push(segment(ready,x,locks,w,'同序列捕获紫脉锚点'));
            }
            function prepare(base, locks, types) {
                if(!types.length){attempt(base,locks);return;}
                const type=types[0];
                if(locks.some(id=>e.quality(id)<4&&e.talentType(id)===type)) {
                    prepare(base,locks,types.slice(1));return;
                }
                if(locks.length>=e.slotCount-1)return;
                const candidates=[];
                const remember=(n,count)=>{
                    for(const id of n.s.talents)if(e.quality(id)<4&&e.talentType(id)===type&&!locks.includes(id))
                        candidates.push({id,node:n,count});
                };
                let scan=base;remember(scan,0);
                for(let w=1;w<=12000&&valid(scan);w++) {
                    scan=washOne(ctx,scan,locks.map(id=>scan.s.talents.indexOf(id)));
                    if(!valid(scan)||scan.seen!==base.seen||scan.pityCount!==base.pityCount)break;
                    remember(scan,w);
                }
                // 每种准备顺序只比较紫前最近的有限个停点。
                for(const candidate of candidates.slice(-8).reverse()) {
                    const ready=segment(base,candidate.node,locks,candidate.count,'同序列快洗到前置冲突');
                    const keep=ready.s.talents.filter(id=>locks.includes(id)||id===candidate.id);
                    if(keep.length<e.slotCount)prepare(ready,keep,types.slice(1));
                }
            }
            prepare(base,ids,needed);
            if(optional.length) {
                prepare(base,ids,[...optional,...needed]);
                prepare(base,ids,[...needed,...optional]);
            }
            return select(variants,next);
        }
        function exchangeStep(base, step, index) {
            const e=ctx.e(base.zi),pos=base.o.findIndex((v,i)=>v===step.origin&&base.s.talents[i]===step.from);
            if(pos<0)return [];
            const ids=support(base,[...mandatory(base),step.from],index);
            if(!ids)return [];
            const result=[];
            function attempt(n) {
                const locks=n.s.talents.filter(id=>e.quality(id)<4);
                const at=n.o.findIndex((v,i)=>v===step.origin&&n.s.talents[i]===step.from);
                if(!e.replaceablePositions(n.s,locks).includes(at))return;
                const x=exchangeNode(ctx,n,at,locks);
                if(x.s.talents.at(-1)===step.to&&valid(x))result.push(x);
            }
            if(targets.includes(step.to)||e.isShenmai(step.to)||base.s.talents.some(id=>e.quality(id)<4&&e.talentType(id)===e.talentType(step.to)))
                attempt(base);
            else {
                if(ids.length>=e.slotCount)return [];
                let n=base;
                for(let w=1;w<=12000&&valid(n);w++) {
                    n=washOne(ctx,n,ids.map(id=>n.s.talents.indexOf(id)));
                    if(!valid(n)||n.seen!==base.seen||n.pityCount!==base.pityCount)break;
                    if(n.s.talents.some(id=>e.quality(id)<4&&e.talentType(id)===e.talentType(step.to))) {
                        attempt(segment(base,n,ids,w,'同序列提前准备连续置换冲突'));break;
                    }
                }
            }
            return result;
        }
        for(let i=0;i<stages.length&&nodes.length;i++) {
            const step=stages[i];
            nodes=select(nodes.flatMap(n=>step.kind==='exchange'&&n.exchanges>step.index?[n]
                :step.kind==='capture'?capture(n,step,i):exchangeStep(n,step,i)),stages[i+1]);
        }
        return nodes.filter(n=>complete(n,targets,ctx.anchors.length));
    }
    function lateCapture(ctx, steps, index) {
        const capture=steps[index];
        // 起点及 n 垫洗已单独准备，不能绕过首次置换重新解释序列编号。
        if(!capture.before.poolStarted)return null;
        const origin=capture.after.origins.find(v=>v>=0&&!(capture.before.seen&(1<<v)));
        if(origin==null)return null;
        const id=capture.after.state.talents[capture.after.origins.indexOf(origin)];
        const e=ctx.e(capture.before.zi),typ=e.talentType(id);
        if(e.isShenmai(id))return null;
        const conflicts=capture.keepIds.filter(v=>e.quality(v)<4&&e.talentType(v)===typ);
        if(!conflicts.length)return null;
        // 从前一个非洗髓动作之后开始重排准备，保留本段其他锁脉和已捕获锚点。
        // 不解锁仍需使用的前置冲突，不跨过置换或开槽去套用同一原始流。
        let begin=index;
        while(begin>0&&steps[begin-1].type==='wash')begin--;
        const base=prefixNode(ctx,steps.slice(0,begin));
        const fixed=capture.keepIds.filter(v=>!conflicts.includes(v));
        if(fixed.some(v=>!base.s.talents.includes(v))||base.o.some((v,i)=>v>=0&&!fixed.includes(base.s.talents[i])))return null;
        const candidates=base.s.talents.filter(v=>e.quality(v)<4&&e.talentType(v)===typ).map(v=>({id:v,node:base,count:0}));
        let scan=base;
        for(let w=1;w<=12000&&scan.cost<capture.after.cost;w++) {
            const r=e.wash(scan.s,fixed.map(v=>scan.s.talents.indexOf(v)));
            scan=washOne(ctx,scan,fixed.map(v=>scan.s.talents.indexOf(v)));
            if(!missed(ctx,scan))for(const ev of r.generatedEvents) {
                if(e.quality(ev.id)<4&&e.talentType(ev.id)===typ)candidates.push({id:ev.id,node:scan,count:w});
            }
            if(missed(ctx,scan)||scan.seen!==base.seen||scan.pityCount!==base.pityCount)break;
        }
        // 按具体出现事件从近到远验证。保底名、去重、自然锚点与排列都以重算为准。
        for(let c=candidates.length-1;c>=0;c--) {
            const candidate=candidates[c],keep=[...fixed,candidate.id];
            if(keep.length>=e.slotCount)continue;
            let n=candidate.count?record(base,{...candidate.node},{type:'wash',keepIds:fixed,count:candidate.count,why:'洗到后续紫前最近可用冲突脉'}):base;
            const ready=n;
            let w=0;
            while(!n.o.includes(origin)&&w<12000&&n.cost<capture.after.cost) {
                n=washOne(ctx,n,keep.map(v=>n.s.talents.indexOf(v)));w++;
                if(missed(ctx,n)||((n.seen!==base.seen||n.pityCount!==base.pityCount)&&!n.o.includes(origin)))break;
            }
            const pos=n.o.indexOf(origin);
            if(pos<0||missed(ctx,n)||n.s.talents[pos]!==id||!e.replaceablePositions(n.s,[candidate.id]).includes(pos)||n.cost>=capture.after.cost)continue;
            if(w)n=record(ready,n,{type:'wash',keepIds:keep,count:w,why:'延后锁冲突后捕获紫脉锚点'});
            return n;
        }
        return null;
    }
    class Heap {
        constructor(){this.a=[];}
        push(v){const a=this.a;let i=a.length;a.push(v);while(i){const p=(i-1)>>1;if(a[p].priority<=v.priority)break;a[i]=a[p];i=p;}a[i]=v;}
        pop(){const a=this.a,first=a[0],v=a.pop();if(a.length){let i=0;while(i*2+1<a.length){let c=i*2+1;if(c+1<a.length&&a[c+1].priority<a[c].priority)c++;if(a[c].priority>=v.priority)break;a[i]=a[c];i=c;}a[i]=v;}return first;}
        get size(){return this.a.length;}
    }
    function search(raw, anchors, source, pad, opts={}, progress=()=>{}, prepared=null) {
        if (anchors.some(a => a.fromPity && (!Number.isInteger(a.pityNo) || a.pityNo < 1 || a.key !== eventKey(a))))
            throw new Error('保底锚点信息已过期，请重新读取原始紫。');
        if (source.fromPity) throw new Error('保底紫可以作为锚点；它已固定欧气，不能用来初始化新的无限置换序列。请选更早的自然紫起点。');
        if (!anchors.length || anchors.length !== opts.targets.length || ![3,4].includes(anchors.length)) throw new Error('请选取数量相同的三／四个目标和原始紫锚点。');
        if (new Set(anchors.map(a=>a.key)).size !== anchors.length || new Set(opts.targets).size!==anchors.length) throw new Error('锚点和目标不能重复。');
        if (source.bornRC > Math.min(...anchors.map(a=>a.bornRC))) throw new Error('第一版的置换起点需在首个锚点或它之前。');
        const ctx=prepared?prepared.ctx:makeContext(raw,anchors), targets=opts.targets.map(Number), initial=prepared?prepared.node:initialize(ctx,source,pad);
        const heap=new Heap(), visited=new Map(), routes=[];
        const maxNodes=Math.min(60000,Math.max(prepared?1:500,Number(opts.maxNodes)||10000));
        const depth=Math.min(40,Math.max(1,Number(opts.depth)||20));
        const sequence=prepared?prepared.sequence:sequenceInfo(ctx,initial,depth,opts.sequenceBasis==='theory2'?152:null);
        const guide=prepared?.guide;
        if(pad===0)sequence.b0=[];
        // 只有开槽前后紫池资格相同，才能用这一段池安全排除缺目标的序列。
        // 一心、冲突和操作时序仍交给真实状态搜索，不用目标排列充当成功证明。
        const pe=ctx.e(initial.zi), later=ctx.e(initial.zi===153?154:initial.zi);
        const samePool=pe.purpleIds.every(id=>pe.allowed.has(id)===later.allowed.has(id));
        const prefilter=opts.prefilter!==false&&samePool
            ?prefilterSequence(ctx,initial,anchors,source,sequence,targets):{ok:true};
        if(!prefilter.ok) return {routes:[],expanded:0,bounded:false,
            filtered:true,pad,depth,maxNodes,sequence,prefilter,
            reason:prefilter.reason};
        const maxCost=Math.max(1,Number(opts.maxCost)||50000), full=(1<<anchors.length)-1;
        const lastRC=Math.max(-Infinity,...anchors.filter(a=>!a.fromPity).map(a=>a.bornRC));
        const lastPity=Math.max(0,...anchors.filter(a=>a.fromPity).map(a=>a.pityNo));
        let expanded=0, bounded=false;
        function accept(n) {
            const route=actions(n), checked=replay(raw,anchors,route,targets);
            routes.push({...checked,steps:route,pad,depthUsed:n.draws,source:{no:source.no,id:source.id,key:source.key,bornRC:source.bornRC},sequence,
                variant:prepared?.variant||null});
            routes.sort((a,b)=>a.cost-b.cost||a.exchanges-b.exchanges||a.pad-b.pad||a.washes-b.washes);routes.splice(3);
            progress({expanded,queued:heap.size,pad,found:routes.length,candidate:routes[0]});
        }
        function push(n) {
            if (missed(ctx,n) || n.draws>depth || n.cost>maxCost) return;
            // 非目标普通紫若已没有在前的低阶冲突，锚点又不能洗掉，就永久无法改变。
            // 在这里拒绝，避免搜索花大量时间尝试紫后补冲突的死路。
            const e=ctx.e(n.zi), low=n.s.talents.filter(id=>e.quality(id)<4);
            const replaceable=new Set(e.replaceablePositions(n.s,low));
            if(n.o.some((v,i)=>v>=0&&!targets.includes(n.s.talents[i])&&!e.isShenmai(n.s.talents[i])&&!replaceable.has(i)))return;
            if (routes.length && n.cost >= routes[0].cost) return;
            const key=[n.zi,root.WashSourceEngine.stateKey(n.s),n.o.join(','),n.seen,n.draws,n.pityCount].join('|');
            if ((visited.get(key) ?? Infinity)<=n.cost) return;
            visited.set(key,n.cost);
            // 已生成完整路线立即回放，避免高丹耗的保底收尾被留在队列中直到节点预算耗尽。
            if (complete(n,targets,anchors.length)) { accept(n); return; }
            const matched=n.s.talents.filter((id,i)=>n.o[i]>=0&&targets.includes(id)).length;
            const captured=n.o.filter(v=>v>=0).length;
            // 有界启发式探索；排序结果只代表已经验证的路线，不作全局最优保证。
            // 同名中间紫也会推进序列，给这类合法进展一点优先级，避免全预算耗在起点附近。
            n.priority=n.cost+(targets.length-matched)*1500+(anchors.length-captured)*3000-Math.min(depth,n.draws)*500;
            if(guide)n.priority=n.cost+(guide.length-n.exchanges)*3000+(anchors.length-captured)*1500;
            heap.push(n);
        }
        push(initial);
        while(heap.size && expanded<maxNodes) {
            const n=heap.pop();expanded++;
            // 已找到更省丹的路线后，这些状态的后续洗法也不会更省丹。
            if(routes.length && n.cost>=routes[0].cost)continue;
            if (expanded%200===0) progress({expanded,queued:heap.size,pad,found:routes.length});
            const e=ctx.e(n.zi);
            const locks=n.s.talents.filter(id=>e.quality(id)<4);
            const upcomingTypes=new Set();
            for (const pos of e.replaceablePositions(n.s,locks)) {
                const r=e.replace(n.s,pos,locks), o=n.o.slice(), v=o.splice(pos,1)[0];o.push(v);
                if(guide) {
                    const next=guide[n.exchanges];
                    if(!next||next.origin!==v||next.from!==r.removedId||next.to!==r.addedId)continue;
                }
                // 下一次置换的新紫排到末尾：先锁好它的冲突脉，才能再继续换。
                if(!e.isShenmai(r.addedId))upcomingTypes.add(e.talentType(r.addedId));
                push(record(n,{...n,s:r.state,o,poolStarted:true,draws:n.draws+r.purpleDraws,
                    poolDraws:n.poolDraws+r.purpleDraws,exchanges:n.exchanges+1},
                    {type:'exchange',position:pos,keepIds:locks,from:r.removedId,to:r.addedId}));
            }
            // 三紫也可能需要第四槽提前准备后续紫脉的冲突脉。
            if(n.zi===153) push(record(n,{...n,zi:154},{type:'upgrade',toZi:154}));
            // 收齐锚点后，若还有空余槽，仍可洗冲突脉／神脉支点。
            // 所有锚点继续强制锁定，不能借洗掉锚点换取操作空间。
            const mandatory=n.o.map((v,i)=>v>=0?i:-1).filter(i=>i>=0);
            const optional=n.s.talents.map((id,i)=>!mandatory.includes(i)?i:-1).filter(i=>i>=0);
            for(let mask=0;mask<(1<<optional.length);mask++) {
                const keep=[...mandatory,...optional.filter((v,i)=>mask&(1<<i))].sort((a,b)=>a-b);
                if(keep.length>=e.slotCount)continue;
                // 洗掉非目标普通锚点的前置冲突会把它永久锁死，直接跳过整段垫洗。
                if(mandatory.some(pos=>!targets.includes(n.s.talents[pos])&&!e.isShenmai(n.s.talents[pos])&&
                    !keep.some(i=>i<pos&&e.quality(n.s.talents[i])<4&&e.talentType(n.s.talents[i])===e.talentType(n.s.talents[pos]))))continue;
                const ids=keepIds(n,keep);
                const retained=ids.filter(id=>e.quality(id)===4);
                // 只为后续到场的紫准备普通冲突；已保留的普通紫不能借后补冲突续换。
                const types=new Set(upcomingTypes);
                if(guide)for(const next of guide.slice(n.exchanges,n.exchanges+3))
                    if(!e.isShenmai(next.to))types.add(e.talentType(next.to));
                ctx.anchors.forEach((a,i)=>{
                    if(!(n.seen&(1<<i))&&!a.fromPity&&!e.isShenmai(a.id))types.add(e.talentType(a.id));
                });
                // 未捕获的保底锚点会接当前紫池下一条，名字不能沿用无锁扫描的参考值。
                if(ctx.anchors.some((a,i)=>a.fromPity&&!(n.seen&(1<<i)))){
                    let luck=e.hooks.seedLuck(n.s);
                    for(let d=0;d<10000;d++){
                        const next=e.draw(luck,true);luck=next[1];
                        if(!e.allowed.has(next[0])||ids.includes(next[0]))continue;
                        if(!e.isShenmai(next[0]))types.add(e.talentType(next[0]));
                        break;
                    }
                }
                const preparationIds=new Set(e.allIds.filter(id=>e.allowed.has(id)&&e.quality(id)<4&&types.has(e.talentType(id))&&!ids.includes(id)));
                const shenSupport=retained.some(v=>e.isShenmai(v));
                if(n.seen===full&&!preparationIds.size&&!shenSupport)continue;
                let x=n, w=0;
                const emitted=new Set();
                const lateEvents=new Map(),guideStop=guide?.[n.exchanges]?.rc??Infinity;
                while(w<12000 && (n.seen===full || x.s.bornRC<=lastRC || x.pityCount<lastPity) &&
                    x.cost<Math.min(maxCost,routes.length?routes[0].cost:Infinity) && x.draws<=depth && x.s.bornRC<guideStop) {
                    const k=ids.map(id=>x.s.talents.indexOf(id));
                    const oldSeen=x.seen, oldPity=x.pityCount;
                    x=washOne(ctx,x,k);w++;
                    if(missed(ctx,x))break;
                    const capture=x.seen!==oldSeen;
                    const interesting=x.s.talents.filter((id,i)=>i>=ids.length &&
                        (preparationIds.has(id) ||
                         (e.isShenmai(id) && retained.some(v=>e.isShenmai(v)&&v!==id))));
                    const fresh=interesting.some(id=>!emitted.has(id));
                    const pity=x.pityCount!==oldPity;
                    // 紫到场之后的低阶脉不能覆盖此前的准备停点；否则最后一次
                    // 合法前置冲突会被紫后补冲突的死路吞掉（尤其是保底整洗）。
                    if(guide&&!capture&&!pity&&x.s.bornRC<=guideStop)
                        for(const id of interesting)lateEvents.set(id,{node:{...x},count:w});
                    if(capture||fresh||pity) {
                        push(record(n,{...x},{type:'wash',keepIds:ids,count:w,why:capture?'捕获紫脉锚点':pity?'保底推进置换紫池':'准备冲突脉／神脉支点'}));
                        interesting.forEach(id=>emitted.add(id));
                    }
                    if(capture||pity)break;
                }
                if(guide)for(const candidate of lateEvents.values())push(record(n,candidate.node,
                    {type:'wash',keepIds:ids,count:candidate.count,why:'同序列比较较晚的冲突准备'}));
            }
        }
        bounded=heap.size>0;
        let refinementExpanded=0,lockExpanded=0,firstLockOptimization=null;
        // 开槽分歧需要重新探索后续锁法；深入模式不能仍被固定的6000节点截断。
        let lockBudget=Math.min(maxNodes*2,6000);
        if(!prepared&&opts.optimizeLocks!==false&&!routes.length) {
            const e=ctx.e(initial.zi),locks=initial.s.talents.filter(id=>e.quality(id)<4),replaceable=new Set(e.replaceablePositions(initial.s,locks));
            const needsPreparation=initial.o.some((v,i)=>v>=0&&!targets.includes(initial.s.talents[i])&&!e.isShenmai(initial.s.talents[i])&&!replaceable.has(i));
            if(needsPreparation) {
                const variants=padVariants(ctx,initial,source,sequence,targets).filter(n=>{
                    const ve=ctx.e(n.zi),legal=new Set(ve.replaceablePositions(n.s,n.s.talents.filter(id=>ve.quality(id)<4)));
                    return n.o.every((v,i)=>v<0||targets.includes(n.s.talents[i])||ve.isShenmai(n.s.talents[i])||legal.has(i));
                });
                for(const node of divergenceBranches(variants)) {
                    if(lockBudget<=0)break;
                    const r=search(raw,anchors,source,pad,{...opts,prefilter:false,maxNodes:Math.min(maxNodes,lockBudget,3000)},()=>{}, {ctx,node,sequence});
                    lockBudget-=r.expanded;lockExpanded+=r.expanded;expanded+=r.expanded;bounded=bounded||r.bounded;
                    if(r.routes.length) {
                        routes.push(...r.routes);routes.sort((a,b)=>a.cost-b.cost||a.exchanges-b.exchanges||a.pad-b.pad||a.washes-b.washes);routes.splice(3);
                        progress({expanded,queued:0,pad,found:routes.length,candidate:routes[0]});
                    }
                }
            }
        }
        if(!prepared&&routes.length) {
            // 先保证找到原有路线，再从其晚锁捕获状态继续精确推演；不让新增停点
            // 挤占主搜索预算，也不沿用已经改变的收尾洗次。只接纳完整回放且更省丹的结果。
            const refined=new Set();
            let remaining=Math.min(maxNodes,1500);
            for(let pass=0;pass<anchors.length;pass++) {
                const best=routes[0];let improved=false;
                for(let i=0;i<best.steps.length;i++) {
                    if(remaining<=0)break;
                    const a=best.steps[i];
                    if(a.type!=='wash'||a.before.seen===a.after.seen)continue;
                    const node=lateCapture(ctx,best.steps,i);
                    if(!node)continue;
                    const key=[node.zi,root.WashSourceEngine.stateKey(node.s),node.o.join(','),node.seen,node.draws,node.pityCount].join('|');
                    if(refined.has(key))continue;refined.add(key);
                    const r=search(raw,anchors,source,pad,{...opts,prefilter:false,maxNodes:remaining,maxCost:Math.min(maxCost,best.cost-1)},()=>{}, {ctx,node,sequence});
                    remaining-=r.expanded;refinementExpanded+=r.expanded;
                    expanded+=r.expanded;bounded=bounded||r.bounded;
                    if(r.routes.length) {
                        routes.push(...r.routes);routes.sort((a,b)=>a.cost-b.cost||a.exchanges-b.exchanges||a.pad-b.pad||a.washes-b.washes);routes.splice(3);
                        improved=routes[0].cost<best.cost;
                        progress({expanded,queued:0,pad,found:routes.length,candidate:routes[0]});
                    }
                }
                if(!improved||remaining<=0)break;
            }
        }
        if(!prepared&&routes.length&&opts.optimizeLocks!==false) {
            // 固定已证实的置换顺序及锚点去向，再比较提前冲突、少锁推进、开槽时机。
            // 只有收尾的完整回放更便宜才替换原路线；未成功仍保留原结果。
            const reference=routes[0],guide=reference.steps.filter(a=>a.type==='exchange')
                .map(a=>({origin:a.before.origins[a.position],from:a.from,to:a.to,rc:a.before.state.bornRC}));
            const nextType=ctx.e(154).talentType(guide[1]?.to);
            const pads=padVariants(ctx,initial,source,sequence,targets).sort((a,b)=>{
                const useful=n=>n.s.talents.some(id=>ctx.e(n.zi).quality(id)<4&&ctx.e(n.zi).talentType(id)===nextType);
                return Number(useful(b))-Number(useful(a))||a.cost-b.cost;
            });
            // 用户关心的第一个锁脉点单独比较：两个分支必须从同一实际快照开始，
            // 3 槽沿原置换链回放，4 槽从同一快照开槽后重新搜索锁法。
            const firstBranch=firstLockBranch(ctx,reference);
            if(firstBranch?.four) {
                const captured=prepareFirstLock(ctx,firstBranch.four,firstBranch.action,source);
                // 先捕获源紫，再回到原 n 的 bornSeed/RC；不能从刚出紫的状态
                // 直接置换并贴上旧 n。捕获节点可以不是锚点。
                const aligned=captured?padVariants(ctx,initial,source,sequence,targets,captured):[];
                const completed=milestoneVariants(ctx,divergenceBranches(aligned),reference,targets,depth,Math.min(maxCost,reference.cost));
                firstLockOptimization={captured:!!captured,aligned:aligned.length,verified:completed.length};
                for(const node of completed)accept(node);
            }
            // 每个洗脉段都可能是开槽分歧点。旧逻辑只取“置换后第一段洗脉”，
            // 会漏掉“先锁枪棍好手，再洗到枪棍绝伦，随后立即开4槽”的等序列分支。
            // 这里保留每个洗脉动作的起点，guidedShortcut 会从该节点继续回放同一置换链，
            // 最终以真实槽位和丹耗验证，而不是把理论点击次数直接当成结果。
            const variantBases=[...pads,...reference.steps.map((a,i)=>({a,i})).filter(({a})=>a.type==='wash'&&(
                a.before.poolStarted
                || a.before.state.talents.some(id=>ctx.e(a.before.zi).quality(id)===4)
                || a.after.state.talents.some(id=>ctx.e(a.after.zi).quality(id)===4)
            ))
                .reverse().map(({i})=>prefixNode(ctx,reference.steps.slice(0,i))),
                initial];
            const variants=[];
            for(const node of variantBases) {
                // 首换前的所有分支由 padVariants 精确定位；未定位的快照不能
                // 交给后续搜索，否则会改成另一条置换序列。
                if(!node.poolStarted)continue;
                variants.push(node);
                // guidedShortcut 只复用置换链，不会在节点内部主动插入开槽动作；
                // 显式加入同一节点的4槽快照，才能比较“枪棍紫出现后立即开4槽”。
                if(node.zi===153) variants.push(record(node,{...node,zi:154},{type:'upgrade',toZi:154}));
            }
            const sourceType=ctx.e(154).talentType(source.id);
            const isFreshFourSlot=node=>node.zi===154&&!node.poolStarted&&node.s.talents.some(id=>
                ctx.e(node.zi).quality(id)<4&&ctx.e(node.zi).talentType(id)===sourceType);
            variants.sort((a,b)=>Number(isFreshFourSlot(b))-Number(isFreshFourSlot(a)));
            let remaining=lockBudget;
            for(let i=0;i<variants.length&&remaining>0;i++) {
                const node=variants[i];
                const shortcut=guidedShortcut(ctx,node,guide,targets,depth,Math.min(maxCost,routes[0].cost));
                if(shortcut)accept(shortcut);
                // 已完成首次开槽分支时，继续按检查点比较其他快照，避免又把
                // 预算耗在不保留中间锚点的无约束搜索上。
                if(firstLockOptimization?.verified) {
                    for(const end of milestoneVariants(ctx,[node],reference,targets,depth,Math.min(maxCost,routes[0].cost)))accept(end);
                    continue;
                }
                // 首个原始紫尚未置换、且刚在紫脉段后开4槽时，后续锁法可能
                // 与原3槽路线不同；这里做一次不带旧 guide 的完整分支搜索。
                const freshFourSlot = node.zi===154 && !node.poolStarted && node.s.talents.includes(source.id);
                const budget=Math.min(remaining,freshFourSlot?6000:(i===0?2000:1000));
                const best=routes[0],preparedSearch=freshFourSlot?{ctx,node,sequence}:{ctx,node,sequence,guide};
                const r=search(raw,anchors,source,pad,{...opts,prefilter:false,maxNodes:budget,maxCost:Math.min(maxCost,best.cost-1)},()=>{},preparedSearch);
                remaining-=r.expanded;lockExpanded+=r.expanded;expanded+=r.expanded;bounded=bounded||r.bounded;
                if(r.routes.length) {
                    routes.push(...r.routes);routes.sort((a,b)=>a.cost-b.cost||a.exchanges-b.exchanges||a.pad-b.pad||a.washes-b.washes);routes.splice(3);
                    progress({expanded,queued:0,pad,found:routes.length,candidate:routes[0]});
                }
            }
        }
        return { routes, expanded, refinementExpanded, lockExpanded, firstLockOptimization, bounded, pad, depth, maxNodes, sequence,
            reason:routes.length?'所有展示路线均已从导入状态回放验证。':'在所设深度和节点范围内未找到可回放路线；这不等于绝对无解。' };
    }
    root.AnchorRoutePlanner=Object.freeze({engine,scan,search,replay,eventKey,usableSources,prefilterSequence});
})(typeof window!=='undefined'?window:globalThis);
