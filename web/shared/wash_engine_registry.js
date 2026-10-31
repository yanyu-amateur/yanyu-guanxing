/**
 * wash_engine_registry.js —— 可插拔洗脉引擎注册表
 * ------------------------------------------------------------------
 * 设计目标（用户诉求）：
 *   1. 把「选哪套洗脉算法」收敛到一个决策点（profile），而不是散落在
 *      simulator.js 各处的 `if (isPreviewWashAlgo())` 分支。
 *   2. 后续游戏改算法（哪怕保底公式 / 计数器步进 / 欧气种子初始化变了，
 *      不只是数据表变了），新增一个后端 / profile 即可，调用点零改动。
 *   3. 解决「哪天正式服也用先行服逻辑，wasm 就废了」的隐患：届时只需把
 *      `official` 指向 JS 后端，调用点不动。
 *
 * 后端契约 = 现有全局 `wasm*` 函数集 + AlgorithmWasmBridge 的无状态调用。
 * simulator.js 的所有调用点保持不变，可插拔完全在「后端选择」这一层实现。
 *
 * 加载顺序要求：必须在 international_wash.js 之后、simulator.js 之前执行，
 *   以便捕获 international_wash 的全局转发包装（官方后端直接复用它）。
 *
 * 内置后端：
 *   - official ：委托原生 wasm（经由 international_wash 的转发包装，非国际服自动走原生）。
 *   - preview  ：基于 WashSourceEngine.Engine 的「先行服新算法」有状态后端（JsWashBackend）。
 *   - international ：与 official 同一套转发包装（international_wash 按蛇类型内部再分流）。
 *
 * 扩展未来版本：
 *   WashEngineRegistry.registerBackend('future-v2', factoryReturningBackendObject);
 *   WashEngineRegistry.selectBackend('future-v2');
 *   若结构性算法变了，给 WashSourceEngine.Engine 传 hooks（见 wash_source_engine.js）。
 */
(function (root) {
    'use strict';

    // —— 全局名 ↔ 后端方法名 映射（后端实现这些方法，注册时安装到对应 wasm* 全局名）——
    const GLOBAL_METHODS = [
        'setState', 'getState', 'doWash', 'washMulti', 'washUntilGold',
        'washUntilTalentName', 'previewSequence', 'previewExchangePads',
        'exchangeTalent', 'previewTalentOccurrences', 'getAvailableTalents',
        // 首紫跳脉（不在原 wasm 全局包装里，preview 下必须显式覆盖，否则会静默调正式服 wasm 混用）
        'firstPityJumpCandidates', 'firstPityJumpSequence',
    ];
    function globalName(method) {
        return 'wasm' + method[0].toUpperCase() + method.slice(1);
    }

    const backends = Object.create(null);
    let currentName = null;
    let previewInstance = null;          // 当前 preview 后端实例（供 bridge 复用）

    function registerBackend(name, factory) {
        backends[name] = factory;
    }

    function installGlobals(backend) {
        if (!backend) return;
        for (const method of GLOBAL_METHODS) {
            const gname = globalName(method);
            if (typeof backend[method] === 'function') {
                root[gname] = backend[method].bind(backend);
            }
        }
    }

    function selectBackend(name) {
        const factory = backends[name];
        if (!factory) throw new Error('未注册的洗脉后端：' + name);
        const backend = factory();
        installGlobals(backend);
        if (name === 'preview') previewInstance = backend;
        currentName = name;
        return backend;
    }

    function currentBackend() { return currentName; }

    // 从「导入存档快照」起算推演原始脉序（仅 preview 后端有意义：JS 新算法）。
    // 显式调用 JsWashBackend，避免 buildPulseRecord 直接调全局 wasm* 而绕过插件层。
    function runPreviewSequence(snapshot, maxBars) {
        if (!previewInstance) {
            throw new Error('先行服预览后端未初始化（WashEngineRegistry 未加载或未选择 preview 后端）');
        }
        if (currentName !== 'preview') {
            throw new Error('当前后端不是先行服预览（实际：' + (currentName || '无') + '）');
        }
        previewInstance.setState(snapshot ? JSON.parse(JSON.stringify(snapshot)) : {});
        return previewInstance.previewSequence(Math.round(Number(maxBars) || 0));
    }

    // ═══════════════════ JsWashBackend：先行服新算法有状态后端 ═══════════════════
    // 把 WashSourceEngine.Engine（无状态：每次传 initialState 返回新 state）包装成
    // 与 wasm 完全一致的「有状态全局契约」+「bridge 无状态契约」。

    // 数值归一（与引擎内部 numeric 一致）
    function _num(value, fallback = 0) {
        const result = Number(value);
        return Number.isFinite(result) ? result : fallback;
    }

    // 从快照（wasm-like）抽取 keep 槽位（锁定索引）
    function _keepFromSnapshot(snake) {
        return (snake && snake.talents || []).map((t, i) => (t && t.locked) ? i : -1).filter(i => i >= 0);
    }

    class JsWashBackend {
        constructor() {
            this.engine = null;
            this.working = null;          // wasm-like 工作态（talents 为 [{id, locked}]）
        }

        // —— 从完整蛇（含 vip/role_id/salt/sex/zizhi 等）构造引擎 ——
        makeEngine(fullState, options) {
            const TALENT_DATA = root.TALENT_DATA;
            const ZZ_DATA = root.ZZ_DATA;
            if (!TALENT_DATA) throw new Error('TALENT_DATA 未加载');
            const zizhi = (fullState && fullState.zizhi != null) ? Number(fullState.zizhi)
                : (options && options.zizhi != null ? Number(options.zizhi) : 154);
            const zz = (ZZ_DATA && ZZ_DATA[String(zizhi)]) || (ZZ_DATA && ZZ_DATA['153']) || {};
            const source = {
                vip: Number(fullState && fullState.vip) || 0,
                role_id: Number(fullState && fullState.role_id) || 0,
                salt: Number(fullState && fullState.salt) || 0,
                sex: Number(fullState && fullState.sex) || 1,
                role_level: Number(fullState && fullState.role_level) || 90,
                role_stats: (fullState && fullState.role_stats) || {},
                global_vars: (fullState && fullState.global_vars) || {},
                save_channel: (fullState && fullState.save_channel) || (options && options.saveChannel) || '',
            };
            const WSE = root.WashSourceEngine;
            return new WSE.Engine(TALENT_DATA, source, {
                slotCount: Math.max(1, Number(zz.num_talent) || 0),
                pity: Number.isFinite(Number(zz.bd_zz)) ? Number(zz.bd_zz) : 900,
                eligibleZi: zizhi || 154,
                advancePerDraw: true,
                dlcMode: !!(options && options.dlcMode),
                international: false,
                saveChannel: source.save_channel,
                eat: Math.max(1, Number(zz.eat_xisui) || 5),
            });
        }

        // —— 把 wasm-like 蛇转成 Engine.initialState 接受的形状 ——
        toRaw(snake, keepPositions) {
            const bornRC = (snake.born_talent_rc != null) ? Number(snake.born_talent_rc)
                : ((typeof root.state !== 'undefined' && root.state && root.state.bornTalentRC) || 0);
            return {
                seed: Number(snake.seed) || 0,
                luck_seed_inited: !!snake.luck_seed_inited,
                luck_seed: snake.luck_seed_inited ? Number(snake.luck_seed) || 0 : null,
                born_talent_rc: bornRC,
                tal_lucky: Number(snake.tal_lucky) || 0,
                talents: (snake.talents || []).map(t => ({ id: t && t.id != null ? Number(t.id) : Number(t), locked: !!(t && t.locked) })),
            };
        }

        // —— 统计 working 中「紫脉」数量，用于计数推进（got_gold / 保底计数）——
        // 注意必须与引擎 wash() 的口径一致：引擎里 quality===4 即视为紫（含神脉 248/249/250），
        // 会 newPurple=true / pityActive=false / 可成为 pityPurpleId。
        // 之前这里额外排除了 isShenmai，导致洗出混元奇脉等神脉时 gained=0 → got_gold=false，
        // 「一键洗出紫 / 洗到出紫」会直接跳过所有神脉，且保底计数(pity_count/gold_count/
        // last_purple_total_pills)也不推进，与 previewSequence 的紫脉口径（含神脉）自相矛盾。
        _countPurple() {
            const WSE = root.WashSourceEngine;
            if (!WSE || !WSE.Engine || !this.engine) return 0;
            return (this.working.talents || []).filter(t => {
                const id = Number(t && t.id);
                return this.engine.quality(id) === 4;
            }).length;
        }

        // —— 把引擎返回的新 state 写回 wasm-like working（保持槽位顺序与锁定标记）——
        // 注意：引擎 engine.wash 返回 state.talents = [锁定脉(按 keep 顺序)..., 新抽脉...]，
        // 即锁定脉已排到最前（与游戏「锁定脉置顶」、正式服 wasm 行为一致）。
        // 因此「锁定标记」必须用「洗前锁定的天赋 id」回标，绝不能用「洗前旧槽位号」——
        // 否则锁定脉（已挪到 0 号槽）会丢锁、而下标处的随机新脉被错标「已锁定」。
        applyEngineState(engState, lockedIds) {
            this.working.seed = Number(engState.bornSeed) || 0;
            this.working.luck_seed = engState.luckSeed != null ? Number(engState.luckSeed) : 0;
            this.working.luck_seed_inited = engState.luckSeed != null;
            this.working.born_talent_rc = Number(engState.bornRC) || 0;
            this.working.tal_lucky = Number(engState.talLucky) || 0;
            // 直接以引擎返回的完整槽位状态重建（engine.wash 已保证填满 slotCount）；
            // 锁定标记按 id 匹配（引擎去重保证 id 唯一，与重排后的槽位顺序无关）。
            const locked = (lockedIds || []).map(Number);
            this.working.talents = (engState.talents || []).map(id => ({
                id: Number(id),
                locked: locked.indexOf(Number(id)) >= 0,
            }));
        }

        keepPositions() {
            return (this.working.talents || []).map((t, i) => (t && t.locked) ? i : -1).filter(i => i >= 0);
        }

        // —— 通用序列扫描：从 initialState 连洗 maxBars 次，收集每洗的「完整槽位天赋」与「新出紫脉」。
        // 与引擎 previewSequence 严格同构（含保底紫判定、排除锁定保留脉与神脉），并额外保留全槽位用于冲突注解。
        // engine 参数允许传入非当前 working 的引擎（首紫跳脉用 targetState 构造独立引擎时使用）。
        _scanSequence(engine, maxBars, raw, keep) {
            const limit = Math.max(0, Math.trunc(Number(maxBars) || 0));
            let st = engine.initialState(raw || {});
            const washes = [];
            const purples = [];
            for (let w = 1; w <= limit; w += 1) {
                const r = engine.wash(st, keep);
                st = r.state;
                const keptSet = new Set((r.keepIds || []).map(id => _num(id)));
                // 新洗出的紫脉（quality===4，排除锁定保留脉与神脉）；与引擎 previewSequence 一致（神脉也计入，供上层识别）
                const hits = (r.state.talents || []).filter(id => engine.quality(id) === 4 && !keptSet.has(_num(id)));
                const talents = (r.state.talents || []).map(id => _num(id));
                washes.push({ washNo: w, talents });
                if (hits.length) {
                    for (const id of hits) {
                        purples.push({
                            talent_id: _num(id),
                            talent_name: engine.name(id),
                            wash_times: w,
                            wash_no: w,
                            was_pity: r.pityPurpleId != null && _num(id) === _num(r.pityPurpleId),
                        });
                    }
                }
            }
            return { purples, washes };
        }

        // —— 有状态契约 ——
        setState(snake) {
            this.working = JSON.parse(JSON.stringify(snake || {}));
            if (this.working.talents == null) this.working.talents = [];
            // 初始化计数字段（快照可能缺失这些键），保证 getState 回读后字段存在、不致 undefined
            const z = (v) => (Number(v) || 0);
            this.working.total_wash = z(this.working.total_wash);
            this.working.total_pills = z(this.working.total_pills);
            this.working.total_talent_bars = z(this.working.total_talent_bars);
            this.working.gold_count = z(this.working.gold_count);
            this.working.pity_count = z(this.working.pity_count);
            this.working.last_purple_total_pills = z(this.working.last_purple_total_pills);
            this.working.exchange_count = z(this.working.exchange_count);
            this.engine = this.makeEngine(this.working, {});
            return this.working;
        }

        getState() {
            return JSON.parse(JSON.stringify(this.working || {}));
        }

        doWash() {
            if (!this.working) throw new Error('JsWashBackend：未初始化状态');
            const keep = this.keepPositions();
            // 洗前锁定脉的「天赋 id」列表：用于 applyEngineState 按 id 回标锁定标记（而非洗前旧槽位号）。
            const lockedIds = keep.map(i => Number(this.working.talents[i].id));
            // 洗前基准：必须在 applyEngineState 改写 working 之前捕获（born_talent_rc/RNG 状态、保底间隔基准、紫数基线）
            const prevRC = Number(this.working.born_talent_rc) || 0;
            const prevLastPurplePills = Number(this.working.last_purple_total_pills) || 0;
            const prevGoldCount = Number(this.working.gold_count) || 0;
            const r = this.engine.wash(this.engine.initialState(this.toRaw(this.working, keep)), keep);
            this.applyEngineState(r.state, lockedIds);
            // —— 计数推进：引擎零计数自维护，必须在包装层累加（与 wasm 回读字段对齐）——
            // total_wash：每次洗髓 +1；total_pills：累加本次真实丹耗（cost 随锁槽数变化）。
            // 「出紫」判定改用引擎原生的精确信号：出紫时保底计数 talLucky 会被清零
            //（defaultTalLuckyAfter: newPurple ? 0 : luckyBefore + need）。
            // 旧口径「场上紫数是否增加」有两个漏洞：
            //   1) 神脉（混元奇脉 248/249/250 等）曾被判非紫 → 洗出神脉不算出紫，一键洗出紫直接跳过；
            //   2) 场上带着未锁定紫时，新紫顶替旧紫 → 紫总数不变 → 同样不算出紫，会跳过紧随其后的紫。
            // generatedBars>0 守卫：全槽锁定时本洗不抽签，talLucky 保持原值（可能恰为 0），避免误判。
            const purpleDrawn = (Number(r.generatedBars) || 0) > 0
                && r.state && r.state.talLucky != null && (Number(r.state.talLucky) || 0) === 0;
            this.working.total_wash = (Number(this.working.total_wash) || 0) + 1;
            this.working.total_pills = (Number(this.working.total_pills) || 0) + (Number(r.cost) || 0);
            this.working.pity_count = (Number(this.working.pity_count) || 0) + (purpleDrawn ? 1 : 0);
            // total_talent_bars = 会话累计「天赋条数」：每洗 += 本次新增条数（空槽数），
            // 与正式服 wasm / international_wash.js 的 totalTalentBars 语义一致（修正原「只加紫数」的错标）。
            this.working.total_talent_bars = (Number(this.working.total_talent_bars) || 0) + Math.max(0, Number(r.generatedBars) || 0);
            if (purpleDrawn) {
                this.working.gold_count = (Number(this.working.gold_count) || 0) + 1;
                this.working.last_purple_total_pills = Number(this.working.total_pills) || 0;
            }
            // —— 组装 wasm 契约（snake_case），供 core_glue.convertWashResult 映射；纯推导、不动引擎/UI ——
            const gotGold = purpleDrawn;
            const totalPills = Number(this.working.total_pills) || 0;
            const talLucky = r.state.talLucky != null ? Number(r.state.talLucky) : 0;
            return {
                // wasm 契约字段
                wash_no: Number(this.working.total_wash) || 0,
                talents: this.working.talents,
                got_gold: gotGold,
                pills_used: r.cost,
                total_pills: totalPills,
                bag_pills: null,                                   // 后端不跟踪背包丹，渲染层 ?? 已容错
                was_pity: r.pityPurpleId != null,                  // 本次由保底触发的紫脉
                pity_armed: talLucky >= Number(this.engine.pity),  // 下一洗将强制保底
                tal_lucky: talLucky,
                purple_gap_pills: gotGold ? Math.max(0, totalPills - prevLastPurplePills) : null,
                is_first_purple: gotGold && prevGoldCount === 0,  // 首次紫（洗前 gold_count 基线=0）
                start_s: prevRC,                                  // 洗前 RNG 状态 BornTalent.S
                end_s: r.state.bornRC,                            // 洗后 RNG 状态
                luck_seed: r.state.luckSeed,
                role_id: this.working.role_id,
                // 引擎残留字段（向后兼容旧调用方）
                cost: r.cost,
                generatedBars: r.generatedBars,
                state: r.state,
                keepIds: r.keepIds,
                pityPurpleId: r.pityPurpleId,
            };
        }

        washMulti(times) {
            const count = Math.max(0, Math.floor(Number(times) || 0));
            const out = [];
            for (let i = 0; i < count; i += 1) {
                const r = this.doWash();
                if (!r) break;
                out.push(r);
            }
            return out;
        }

        washUntilTalentName(name, maxIterations) {
            const target = String(name || '');
            const max = Math.max(0, Math.floor(Number(maxIterations) || 5000));
            const out = [];
            for (let i = 0; i < max; i += 1) {
                const r = this.doWash();
                if (!r) break;
                out.push(r);
                if ((r.talents || []).some(slot => {
                    const t = root.TALENT_DATA && root.TALENT_DATA[String(slot.id)];
                    return t && t.name === target;
                })) break;
            }
            return out;
        }

        washUntilGold(maxIterations) {
            const max = Math.max(0, Math.floor(Number(maxIterations) || 10000));
            const out = [];
            for (let i = 0; i < max; i += 1) {
                const r = this.doWash();
                if (!r) break;
                out.push(r);
                // 停止条件 = 出紫（got_gold），与正式服 wasm 语义及 simulator.js:1434 对齐；
                // 旧逻辑误用 isShenmai（神脉，不参与槽位抽签）会永远停不到 → 退化跑满 max。
                if (r.got_gold) break;
            }
            return out;
        }

        previewSequence(maxBars) {
            if (!this.working) throw new Error('JsWashBackend：未初始化状态');
            const engine = this.engine;
            const keep = this.keepPositions();
            const keepCount = keep.length;
            // —— 正式服 wasm 契约（参照 international_wash.js internationalPreviewSequence）——
            // 双绝对坐标：
            //   wash_no  = 会话累计「天赋条数」坐标（每洗 += 本次新增条数），紫脉的 wash_no 即「它是第几条被洗出的天赋」；
            //   wash_times = 会话累计洗髓次数；
            //   earlier_conflict_* = 同类型「最近一次」出现（含场上初始脉 barNo=0/初始槽位），gap 为条数差。
            const bars0 = Number(this.working.total_talent_bars) || 0;
            const wash0 = Number(this.working.total_wash) || 0;
            const maxBarsN = Math.max(0, Math.trunc(Number(maxBars) || 0));
            // 场上初始脉播种「最近一次同类型」（barNo=0/washTimes=0），作为置换冲突候选（面板显示「初始槽位」）
            const lastByType = new Map(); // type -> {barNo, washTimes, isPurple, id, name}
            for (const t of (this.working.talents || [])) {
                const id = _num(t && t.id);
                if (!id || engine.isShenmai(id)) continue; // 神脉占位交给 simulator 的 shenmai 配对逻辑
                const type = engine.talentType(id);
                lastByType.set(type, { barNo: 0, washTimes: 0, isPurple: engine.quality(id) === 4, id, name: engine.name(id) });
            }
            let st = engine.initialState(this.toRaw(this.working, keep));
            const purples = [];
            let barsBefore = bars0;
            let w = 0;
            const MAX_ITER = 500000;
            while (w < MAX_ITER) {
                w += 1;
                // 首洗用原始 keep 锁定对应脉；其后锁定脉已被引擎排到最前(0..k-1)，用 [0..k-1] 锁定，
                // 否则 keep 索引漂移会错锁新洗出的随机脉。
                const useKeep = (w === 1) ? keep : Array.from({ length: keepCount }, (_, i) => i);
                const r = engine.wash(st, useKeep);
                st = r.state;
                const newTail = (r.state.talents || []).slice(keepCount); // 本次新抽天赋（排除锁定保留脉）
                const need = newTail.length;
                if (need === 0) break; // 全部锁定，无新条 → 终止
                for (let i = 0; i < need; i += 1) {
                    const id = _num(newTail[i]);
                    const type = engine.talentType(id);
                    const quality = engine.quality(id);
                    const isShen = engine.isShenmai(id);
                    const barNo = barsBefore + i + 1;
                    const washTimes = wash0 + w;
                    if (isShen) {
                        // 神脉占位（与旧 _annotatePurples 行为一致），留给 simulator 的 shenmai 配对逻辑
                        if (quality === 4) {
                            purples.push({
                                talent_id: id,
                                talent_name: engine.name(id),
                                wash_no: barNo,
                                wash_times: washTimes,
                                was_pity: (r.pityPurpleId != null && id === _num(r.pityPurpleId)),
                                earlier_conflict_name: '',
                                earlier_conflict_wash_no: 0,
                                earlier_conflict_wash_times: 0,
                                earlier_conflict_is_purple: false,
                                earlier_conflict_gap: null,
                                can_exchange: false,
                                block_reason: '',
                            });
                        }
                        continue;
                    }
                    // 捕获「最近一次」同类型（更新前），再覆盖为当前
                    const last = lastByType.get(type);
                    if (quality === 4) {
                        const isPity = (r.pityPurpleId != null && id === _num(r.pityPurpleId));
                        let earlier = null;
                        let can_exchange = false;
                        let block_reason = '';
                        if (isPity) {
                            block_reason = '保底脉，无法固定定向冲突';
                        } else if (last) {
                            earlier = { name: last.name, barNo: last.barNo, washTimes: last.washTimes, isPurple: last.isPurple };
                            if (last.isPurple) {
                                can_exchange = false;
                                block_reason = '前置同类也是紫脉';
                            } else {
                                can_exchange = true;
                                block_reason = '';
                            }
                        } else {
                            can_exchange = false;
                            block_reason = `下一紫「${engine.name(id)}」无同类冲突，无法置换`;
                        }
                        purples.push({
                            talent_id: id,
                            talent_name: engine.name(id),
                            wash_no: barNo,
                            wash_times: washTimes,
                            was_pity: isPity,
                            earlier_conflict_name: earlier ? earlier.name : '',
                            earlier_conflict_wash_no: earlier ? earlier.barNo : 0,
                            earlier_conflict_wash_times: earlier ? earlier.washTimes : 0,
                            earlier_conflict_is_purple: earlier ? earlier.isPurple : false,
                            earlier_conflict_gap: earlier ? Math.max(0, barNo - earlier.barNo) : null,
                            can_exchange,
                            block_reason,
                        });
                    }
                    // 更新「最近一次」同类型（普通脉，含普通紫）
                    lastByType.set(type, { barNo, washTimes, isPurple: quality === 4, id, name: engine.name(id) });
                }
                barsBefore += need;
                if (barsBefore - bars0 >= maxBarsN) break;
            }
            return { purples, luck_pool: [] };
        }

        exchangeTalent(index) {
            if (!this.working) throw new Error('JsWashBackend：未初始化状态');
            const keep = this.keepPositions();
            const lockedIds = (this.working.talents || []).filter(t => t.locked).map(t => Number(t.id));
            const r = this.engine.replace(this.engine.initialState(this.toRaw(this.working, keep)), Number(index), lockedIds);
            // 原内核实际是移除旧紫，再把新紫放到末尾；其余脉保持相对顺序和锁定状态。
            // 必须与规划引擎一致，否则提前准备的冲突脉会在手动页落到新紫后面。
            const added = r.addedId;
            const prevRC = Number(this.working.born_talent_rc) || 0;
            this.working.talents = this.working.talents.filter((t,i)=>i!==Number(index))
                .map(t=>({id:Number(t.id),locked:!!t.locked}));
            this.working.talents.push({id:Number(added),locked:false});
            this.working.tal_lucky = Number(r.state.talLucky) || 0;
            this.working.luck_seed = r.state.luckSeed != null ? Number(r.state.luckSeed) : this.working.luck_seed;
            this.working.luck_seed_inited = r.state.luckSeed != null;
            // 置换不耗丹、不推进主洗髓种子，但置换次数计数需推进（与 wasm 一致）
            this.working.exchange_count = (Number(this.working.exchange_count) || 0) + 1;
            // 置换加入的天赋是否为紫（quality===4 且非神脉）
            const addedIsPurple = this.engine.quality(added) === 4 && !this.engine.isShenmai(added);
            // —— 组装 wasm 契约（snake_case），供 core_glue.convertExchangeResult 映射 ——
            return {
                success: true,
                error: null,
                is_exchange: true,
                wash_no: Number(this.working.total_wash) || 0,
                exchange_no: Number(this.working.exchange_count) || 0,
                talents: this.working.talents,
                got_gold: addedIsPurple,
                exchanged_from: r.removedId,
                exchanged_to: added,
                pills_used: 0,                                    // 置换不耗丹
                total_pills: Number(this.working.total_pills) || 0,
                tal_lucky: Number(this.working.tal_lucky) || 0,
                was_pity: false,
                purple_gap_pills: null,
                is_first_purple: false,
                start_s: prevRC,
                end_s: (r.state && r.state.bornRC != null) ? Number(r.state.bornRC) : prevRC,
                luck_seed: this.working.luck_seed,
                role_id: this.working.role_id,
                bag_pills: null,
                pity_armed: Number(this.working.tal_lucky) >= Number(this.engine.pity),
            };
        }

        // —— 首紫跳脉 ——
        // 原理（与正式服 wasm 一致）：在 targetState 推演序列，定位「最近/首位保底紫(基线)」；
        // 遍历基线上出现的普通(quality<4、非神脉)脉，凡在序列里出现 ≥2 次（有「同名下一次」可供锁定吞掉）者，
        // 即为有效去重候选。锁定该槽位再洗，同名脉被吞掉→种子多走一格→改变基线保底紫的置换序列。
        firstPityJumpCandidates(targetState) {
            try {
                const engine = this.makeEngine(targetState || {}, {});
                const keep = _keepFromSnapshot(targetState);
                const raw = this.toRaw(targetState || {}, keep);
                const limit = Math.max(2000, Math.min(40000, Number(targetState && targetState.previewBars) || 20000));
                const { purples, washes } = this._scanSequence(engine, limit, raw, keep);
                const baseline = purples.find(p => p.was_pity) || purples[0];
                if (!baseline) {
                    return { available: false, reason: '当前序列未生成任何紫脉（扩大推演范围或检查种子）', slotCount: engine.slotCount, candidates: [], baselinePity: {} };
                }
                // 收集「基线上出现的普通脉」的同名出现序列表（扫描本地 washNo）
                const occMap = new Map(); // id -> [washNo,...]
                for (const w of washes) {
                    if (w.washNo > baseline.wash_no) break;
                    for (const id of w.talents) {
                        const tid = _num(id);
                        if (engine.quality(tid) >= 4 || engine.isShenmai(tid)) continue;
                        if (!occMap.has(tid)) occMap.set(tid, []);
                        occMap.get(tid).push(w.washNo);
                    }
                }
                const candidates = [];
                for (const [id, occ] of occMap) {
                    if (occ.length < 2) continue; // 需有「下一次同名」可被吞掉
                    const occurrenceWashTimes = occ[0];
                    const firstDuplicateWashTimes = occ[1];
                    candidates.push({
                        talentId: id,
                        name: engine.name(id),
                        quality: engine.quality(id),
                        occurrenceWashNo: occurrenceWashTimes,
                        occurrenceWashTimes,
                        firstDuplicateWashTimes,
                        fromCurrent: false,
                        pityWashNo: baseline.wash_no,
                        pityWashTimes: baseline.wash_no,
                        pityPurpleId: _num(baseline.talent_id),
                        pityPurpleName: baseline.talent_name,
                        pityGeneratedNames: washes[baseline.wash_no - 1] ? washes[baseline.wash_no - 1].talents.map(t => engine.name(t)) : [],
                        pityGeneratedIds: washes[baseline.wash_no - 1] ? washes[baseline.wash_no - 1].talents.map(t => _num(t)) : [],
                    });
                }
                // 按「下次同名洗数」升序，近的优先
                candidates.sort((a, b) => Number(a.firstDuplicateWashTimes) - Number(b.firstDuplicateWashTimes));
                return {
                    available: true,
                    reason: '',
                    slotCount: engine.slotCount,
                    candidates,
                    baselinePity: { washNo: baseline.wash_no, purpleName: baseline.talent_name, washTimes: baseline.wash_no },
                    targetIndex: 0,
                };
            } catch (err) {
                return { available: false, reason: err && err.message ? err.message : String(err), slotCount: (this.engine && this.engine.slotCount) || 0, candidates: [], baselinePity: {} };
            }
        }

        // 首紫跳脉序列：锁定候选槽位（吞掉同名）→ 重新推演，输出 baseline 之后 count 条置换紫脉。
        firstPityJumpSequence(targetState, candidate, count) {
            try {
                const engine = this.makeEngine(targetState || {}, {});
                const keep = _keepFromSnapshot(targetState);
                const raw = this.toRaw(targetState || {}, keep);
                const candId = _num(candidate && candidate.talentId);
                const occWash = _num(candidate && candidate.occurrenceWashTimes);
                let st = engine.initialState(raw);
                let locked = false;
                let lockIdx = -1;
                const outputs = [];
                let pity = { washTimes: 0, washNo: 0, generatedNames: [], generatedIds: [], purpleId: 0, purpleName: '' };
                let dupCount = 0;
                const need = Math.max(1, Math.floor(Number(count) || 1));
                const maxW = 100000;
                for (let w = 1; w <= maxW && outputs.length < need; w += 1) {
                    const keepNow = (locked && lockIdx >= 0) ? [lockIdx] : [];
                    const r = engine.wash(st, keepNow);
                    st = r.state;
                    if (!locked && w === occWash) {
                        const idx = (r.state.talents || []).indexOf(candId);
                        if (idx >= 0) { locked = true; lockIdx = idx; dupCount += 1; }
                    }
                    const hits = (r.state.talents || []).filter(id => engine.quality(id) === 4 && !engine.isShenmai(id));
                    for (const id of hits) {
                        const isPity = r.pityPurpleId != null && _num(id) === _num(r.pityPurpleId);
                        if (isPity && !pity.purpleId) {
                            pity = {
                                washTimes: w, washNo: w,
                                generatedNames: r.state.talents.map(t => engine.name(t)),
                                generatedIds: r.state.talents.map(t => _num(t)),
                                purpleId: _num(id), purpleName: engine.name(id),
                            };
                        } else if (pity.purpleId) {
                            outputs.push({ index: outputs.length + 1, talentId: _num(id), name: engine.name(id), sourceWashNo: w });
                        }
                    }
                }
                return { outputs, pity, duplicateCount: dupCount };
            } catch (err) {
                return { outputs: [], pity: {}, error: err && err.message ? err.message : String(err), duplicateCount: 0 };
            }
        }

        // —— 置换垫脉 ——
        // 对每条 pad(0..maxPad)：从当前工作态先垫洗 pad 次，再按 targets 顺序锁定冲突→洗出目标紫脉，
        // 产出与正式服 wasm 同构的节点结构（purple_name/conflict_name/chain/last_slot_name 等），供置换分析面板渲染。
        previewExchangePads(targets, maxPad) {
            const n = Math.max(0, Math.floor(Number(maxPad) || 0));
            const engine = this.engine;
            if (!engine || !this.working) {
                return Array.from({ length: n + 1 }, (_, p) => ({ pad: p, nodes: [], error: '先行服预览后端未就绪' }));
            }
            const raw = this.toRaw(this.working, []);
            const out = [];
            for (let p = 0; p <= n; p += 1) {
                out.push({ pad: p, nodes: this._simulateExchangeRoute(engine, targets || [], p, raw) });
            }
            return out;
        }

        _talentIdByName(engine, name) {
            const TD = root.TALENT_DATA;
            if (!TD || !name) return 0;
            for (const k of Object.keys(TD)) {
                if (TD[k] && TD[k].name === name) return _num(TD[k].id);
            }
            return 0;
        }

        _simulateExchangeRoute(engine, targets, pad, raw) {
            let st = engine.initialState(raw);
            // 垫洗 pad 次（无锁）
            for (let i = 0; i < pad; i += 1) { const r = engine.wash(st, []); st = r.state; }
            const nodes = [];
            for (const tg of (targets || [])) {
                const purpleId = this._talentIdByName(engine, tg && tg.purple_name);
                const conflictName = (tg && tg.conflict_name) || '';
                if (purpleId) {
                    // 洗到目标紫脉出现，再锁定它作为后续节点的固定点
                    let cap = 20000;
                    while (cap-- > 0) {
                        const r = engine.wash(st, []);
                        st = r.state;
                        if ((st.talents || []).some(id => _num(id) === purpleId)) break;
                    }
                }
                const lastSlot = engine.name((st.talents || [])[(st.talents || []).length - 1]) || '';
                nodes.push({
                    purple_name: (tg && tg.purple_name) || '',
                    conflict_name: conflictName,
                    last_slot_name: lastSlot,
                    chain: [(tg && tg.purple_name) || ''],
                    final_name: (tg && tg.purple_name) || '',
                    shenmai_forks: [],
                    chain_stop_alts: [],
                });
            }
            return nodes;
        }

        getAvailableTalents() {
            if (!this.engine) return [];
            return Array.from(this.engine.allowed);
        }

        previewTalentOccurrences(talentId, /* max */) {
            if (!this.working) return { occurrences: [] };
            const keep = this.keepPositions();
            const preview = this.engine.previewSequence(6000, this.toRaw(this.working, keep), keep);
            const id = Number(talentId) || 0;
            const occurrences = (preview.purples || [])
                .filter(p => Number(p.talent_id) === id)
                .map(p => ({ wash_times: Number(p.wash_times) || 0, wash_no: Number(p.wash_no) || 0 }));
            return { occurrences };
        }

        // —— 无状态契约（供 AlgorithmWasmBridge.call 使用）——
        statelessWashMany(input) {
            const { state, keepPositions, count, untilPurple } = input || {};
            const full = (input && input.initialState) || this.toFullFromNormalized(state);
            const engine = this.makeEngine(full, (input && input.options) || {});
            const raw = this.toRaw(full, keepPositions);
            const keep = keepPositions || [];
            let cur = engine.initialState(raw);
            const results = [];
            const n = Math.max(1, Math.trunc(Number(count) || 1));
            for (let i = 0; i < n; i += 1) {
                const r = engine.wash(cur, keep);
                results.push({ state: r.state, cost: r.cost, generatedBars: r.generatedBars, keepIds: r.keepIds });
                cur = r.state;
                if (untilPurple) {
                    const keptSet = new Set((r.keepIds || []).map(Number));
                    const hit = (r.state.talents || []).some(id => engine.quality(id) === 4 && !keptSet.has(Number(id)));
                    if (hit) break;
                }
            }
            return results;
        }

        statelessPreviewSequence(input) {
            const { state, keepPositions } = input || {};
            const full = (input && input.initialState) || this.toFullFromNormalized(state);
            const engine = this.makeEngine(full, (input && input.options) || {});
            const raw = this.toRaw(full, keepPositions);
            return engine.previewSequence(Math.max(0, Math.trunc(Number((input && input.maxBars) || 0))), raw, keepPositions || []);
        }

        toFullFromNormalized(state) {
            // bridge 传入的 state 是 jumpNormalize 形状（bornSeed/luckSeed/bornRC/talLucky/talents(ids)/zizhi）
            return {
                seed: Number(state.bornSeed) || 0,
                luck_seed_inited: state.luckSeed != null,
                luck_seed: state.luckSeed != null ? Number(state.luckSeed) || 0 : null,
                born_talent_rc: Number(state.bornRC) || 0,
                tal_lucky: Number(state.talLucky) || 0,
                talents: (state.talents || []).map(id => ({ id: Number(id), locked: false })),
                zizhi: Number(state.zizhi) || 153,
            };
        }
    }

    registerBackend('preview', () => new JsWashBackend());

    // ═══════════════════ 官方 / 国际服：复用 international_wash 的转发包装 ═══════════════════
    // international_wash.js 加载后会把全局 wasm* 覆盖为「非国际服→原生 wasm、国际服→国际算法」的
    // 转发包装。我们捕获这套包装作为 official/international 后端——它天然按蛇类型分流，零改动。
    function captureIntlBackend() {
        const backend = {};
        for (const method of GLOBAL_METHODS) {
            const gname = globalName(method);
            if (typeof root[gname] === 'function') backend[method] = root[gname];
        }
        return backend;
    }
    const intlBackend = captureIntlBackend();
    registerBackend('official', () => intlBackend);
    registerBackend('international', () => intlBackend);

    // ═══════════════════ 决策点：根据存档 / 开关选择后端 ═══════════════════
    function isInternationalSave() {
        const s = (typeof root.state !== 'undefined' && root.state) || {};
        const channel = String(s.saveChannel || '').trim().toLowerCase();
        const platform = String(s.savePlatform || '').trim().toLowerCase();
        if (platform === 'oversea' || platform === 'international') return true;
        return channel === '国际服' || channel === '國際服' || channel === 'oversea' || channel === 'international';
    }

    /**
     * 选择当前应使用的后端，并安装到全局 wasm*。
     * - 先行服（preview）：安装 JsWashBackend。
     * - 正式服 / 国际服：安装 international_wash 的转发包装（其内部再按蛇类型分流）。
     * 调用时机：导入存档后、切换算法开关后。
     */
    function selectForProfile() {
        if (isInternationalSave()) {
            selectBackend('international');
            return 'international';
        }
        const preview = (typeof root.isPreviewWashAlgo === 'function') ? root.isPreviewWashAlgo() : false;
        selectBackend(preview ? 'preview' : 'official');
        return preview ? 'preview' : 'official';
    }

    // ═══════════════════ 包装 AlgorithmWasmBridge：无状态调用也走可插拔 ═══════════════════
    // 仅 preview 模式下拦截 wash.washMany / wash.previewSequence 到 JsWashBackend（无状态）；
    // 其余模式与操作一律转发原 bridge（即 wasm）。仅覆盖 .call 方法，保留原 bridge 对象其余属性。
    if (root.AlgorithmWasmBridge && typeof root.AlgorithmWasmBridge.call === 'function') {
        const originalBridge = root.AlgorithmWasmBridge;
        const originalCall = originalBridge.call.bind(originalBridge);
        const STATELESS_OPS = { 'wash.washMany': 'statelessWashMany', 'wash.previewSequence': 'statelessPreviewSequence' };
        const interceptedCall = function (op, payload) {
            if (currentName === 'preview' && STATELESS_OPS[op] && previewInstance) {
                const handler = previewInstance[STATELESS_OPS[op]];
                if (typeof handler === 'function') return handler.call(previewInstance, (payload && payload.input) || payload);
            }
            return originalCall(op, payload);
        };
        // bridge 的 call 可能被页面内核以只读属性导出，直接赋值会抛 TypeError 并让整个
        // registry 初始化失败（browser 实测：Cannot assign to read only property 'call'）。
        // 改为「赋值 → defineProperty → 放弃拦截」逐级降级：拦截仅影响无状态调用分流，
        // 主推演路径 runPreviewSequence 不依赖它，绝不能因它失败而拖垮 registry。
        let patched = false;
        try { originalBridge.call = interceptedCall; patched = true; } catch (e) { /* 只读，降级 */ }
        if (!patched) {
            try {
                Object.defineProperty(originalBridge, 'call', {
                    value: interceptedCall, writable: true, configurable: true,
                });
                patched = true;
            } catch (e) { /* 不可配置，放弃拦截 */ }
        }
        if (!patched) {
            try { console.warn('[WashEngineRegistry] AlgorithmWasmBridge.call 为只读，跳过无状态拦截（不影响先行服推演）'); } catch (e2) { /* 忽略 */ }
        }
    }

    root.WashEngineRegistry = Object.freeze({
        registerBackend,
        selectBackend,
        selectForProfile,
        currentBackend,
        runPreviewSequence,
        GLOBAL_METHODS,
    });
})(typeof window !== 'undefined' ? window : globalThis);
