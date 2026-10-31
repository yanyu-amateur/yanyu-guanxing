/*
 * hengshan_auto_sim.js — 弟子自动模拟（v1）
 * 玩法：给候选弟子设定"目标天赋规则 + 最多洗几次"，沿 1→100 升级主线逐日推演，
 *       输出每个弟子在"第几天 / 几级 / 洗哪个槽"能集齐目标的指令卡；凑不齐的直接淘汰。
 * 原理：洗与节点赠都由官方内核(advanceDay / replacementChain)推进种子；
 *       玩家回档 SL 的行为等价于"未命中的试洗不计入预算"，因此本模块只在
 *       某天某槽洗后带来新目标时才会落地该次洗（消耗一次预算）并沿新种子继续检索。
 * 加载顺序：须在 wasm 内核管线与 hengshan.js 之后（页面底部即可）。
 */
(function () {
    'use strict';

    var DATA = window.HENGSHAN_TALENT_DATA;
    var E = window.HengshanStudentEngine;

    /* 最近一次扫描的命中名单（导出 / 重新展示用） */
    var lastScan = { rule: null, hits: [], total: 0 };

    /* 最近一次扫描因满级被跳过的弟子数（buildUI 内写入，用于汇总展示） */
    var lastSkippedMax = 0;

    /*
     * 「清障 / 换运」这一步允许出现在方案的前几天（0 = 只允许第一步）。
     *
     * 这一步抽到的不是目标，但它必须被认账、要花掉一次洗脉额度，作用是：
     *   · 清障：把与目标同组、把目标挡在抽签池外的旧天赋挪走（见 isBlocker）；
     *   · 换运：目标没被挡，但当前这颗种子等不到目标，先随便洗一次换一组新结果。
     * 回档(SL)对这一步没用——回档的话种子又回去了，所以它只能真花一次额度。
     *
     * 窗口越宽，能救回的弟子越多，但搜索分支也越多。实测（16 个 50/60 级弟子、
     * 目标「胆小鬼Ⅰ + 天生福星Ⅰ」）：只算挡路 命中 2/16、0.05 秒；
     * 前 15 天 15/16、1.24 秒；前 30 天 16/16、1.83 秒；前 60 天 仍是 16/16 但 2.7 秒。
     * 而且窗口变大不影响默认模式（不开开关、3 个必出目标时都是 1.4 秒/人），故取前 30 天。
     */
    var CLEAR_WINDOW_DAYS = 29;

    /* 四类天赋分组（与社区整理一致，id 对应 HENGSHAN_TALENT_DATA.candidates 的 66 条） */
    var CATEGORIES = [
        { key: 'battle', name: '战斗类', ids: [408, 88, 306, 324, 405, 342, 327, 360, 363, 312, 330, 309, 417, 411, 333, 396, 393, 390, 387, 381, 375, 378, 366, 414, 357, 336, 345, 315, 303, 372, 348, 351, 321, 300, 318, 384, 339] },
        { key: 'send', name: '派遣类', ids: [4, 10, 22, 16, 94, 28, 205, 1, 7, 13, 25, 19, 208, 34, 181, 103, 31, 202] },
        { key: 'commission', name: '委托类', ids: [58, 85, 70] },
        { key: 'function', name: '功能类', ids: [100, 76, 37, 55, 199, 166, 184, 178] }
    ];

    /*
     * 来源只有两类：
     *   · 在册  = 已经在队伍里的弟子；
     *   · 其余（游戏里当前就有的候选 / 今天刷新后会出现的 / 引擎推算的那一批）
     *          全都是"商店里会出现的人"，一律显示成商店候选。
     * 不能再把它们混叫"在册"——玩家会去自己队伍里找一个根本不存在的人。
     */
    function isShopSource(src) {
        return src === 'shop' || src === 'shop-preview' || src === 'backpack';
    }

    function shortName(id) {
        try {
            return String(E && E.talentName ? E.talentName(DATA, id) : ('天赋 ' + id)).replace(/[ⅠⅡⅢⅣⅤ]$/, '');
        } catch (error) {
            return '天赋 ' + id;
        }
    }

    function categoryOf(id) {
        for (var i = 0; i < CATEGORIES.length; i += 1) {
            if (CATEGORIES[i].ids.indexOf(id) >= 0) return CATEGORIES[i];
        }
        return null;
    }

    function asSet(ids) {
        var set = new Set();
        (ids || []).forEach(function (id) { if (Number(id) > 0) set.add(Number(id)); });
        return set;
    }

    function countHits(talents, set) {
        var count = 0;
        (talents || []).forEach(function (id) { if (set.has(Number(id))) count += 1; });
        return count;
    }

    function isMet(talents, mustSet, pickSet, pickN) {
        var list = (talents || []).map(Number);
        var miss = 0;
        mustSet.forEach(function (id) { if (list.indexOf(id) < 0) miss += 1; });
        return miss === 0 && countHits(list, pickSet) >= pickN;
    }

    /* 洗后新增的目标：必出里的新天赋，或备选池中尚可计入的新天赋（备选未满 N） */
    function gainedTargetIds(prevTalents, nextTalents, mustSet, pickSet, pickN) {
        var prev = (prevTalents || []).map(Number);
        var next = (nextTalents || []).map(Number);
        var gained = [];
        next.forEach(function (id) {
            if (prev.indexOf(id) >= 0) return;
            if (mustSet.has(id)) { gained.push(id); return; }
            if (pickSet.has(id) && countHits(prev, pickSet) < pickN) gained.push(id);
        });
        return gained;
    }

    /* 天赋索引：DATA 是常量，建一次复用 */
    var TALENT_INDEX = null;
    function talentIndex() {
        if (!TALENT_INDEX || !TALENT_INDEX.size) {
            TALENT_INDEX = E && typeof E.buildTalentIndex === 'function'
                ? E.buildTalentIndex(DATA)
                : new Map((DATA && DATA.talents || []).map(function (t) { return [Number(t.id), t]; }));
        }
        return TALENT_INDEX;
    }

    /*
     * 「挡路」判定：这一步要洗掉的天赋，是否与某个「还没拿到的目标」同组(class)。
     *
     * 洗脉抽签池会排除与「身上保留的天赋」同组的候选，所以只要同组的天赋还留在场上，
     * 目标就永远抽不到——必须先把挡路的那个挪走。
     * 而挪走它的那一次洗抽到的是别的天赋（不是目标），但它必须被认账、占一次额度：
     * 回档的话障碍就回来了。这就是「清障洗」，gainedTargetIds 只认命中，识别不出这类必做的一步。
     */
    function isBlocker(oldId, talents, mustSet, pickSet, pickN) {
        var talent = talentIndex().get(Number(oldId));
        if (!talent || talent.class === undefined || talent.class === null) return false;
        var held = Object.create(null);
        (talents || []).forEach(function (id) { held[Number(id)] = true; });
        var missing = [];
        mustSet.forEach(function (id) { if (!held[id]) missing.push(id); });
        if (countHits(talents, pickSet) < pickN) {
            pickSet.forEach(function (id) { if (!held[id]) missing.push(id); });
        }
        for (var i = 0; i < missing.length; i += 1) {
            var target = talentIndex().get(Number(missing[i]));
            if (!target || target.class === undefined || target.class === null) continue;
            if (Number(target.class) === Number(talent.class)) return true;
        }
        return false;
    }

    /* 规则自检：返回人话提示（无问题返回空串） */
    function validateRule(rule) {
        var must = rule && rule.must || [];
        var pick = rule && rule.pick || [];
        var pickN = Number(rule && rule.pickN) || 0;
        var washes = Number(rule && rule.maxWashes);
        if (must.length === 0 && (pick.length === 0 || pickN <= 0)) return '请至少设置一个必出天赋，或一组 M 选 N 备选天赋。';
        if (!(washes >= 1 && washes <= 10)) return '最多洗次数需在 1~10 之间。';
        if (pickN < 0 || pickN > pick.length) return '备选命中数 N 需在 0~' + pick.length + ' 之间。';
        if (must.length + pickN > 3) return '必出 ' + must.length + ' 个 + 备选再中 ' + pickN + ' 个 = ' + (must.length + pickN) + ' 个目标，3 个天赋槽装不下。';
        /* 互斥提示：同 origin/class 的目标不可能共存（引擎洗池会排除），给玩家提个醒 */
        if (DATA && DATA.talents) {
            var byId = new Map();
            DATA.talents.forEach(function (t) { byId.set(Number(t.id), t); });
            var groups = [['必出', must], ['备选', pick]];
            var hint = [];
            groups.forEach(function (pair) {
                var label = pair[0], ids = pair[1];
                for (var i = 0; i < ids.length; i += 1) {
                    for (var j = i + 1; j < ids.length; j += 1) {
                        var a = byId.get(Number(ids[i]));
                        var b = byId.get(Number(ids[j]));
                        if (!a || !b) continue;
                        if (a.origin !== undefined && a.origin === b.origin) hint.push('【' + label + '】「' + shortName(a.id) + '」与「' + shortName(b.id) + '」同源(' + a.origin + ')，无法同时拥有');
                        if (a.class !== undefined && a.class === b.class) hint.push('【' + label + '】「' + shortName(a.id) + '」与「' + shortName(b.id) + '」同组(' + a.class + ')，无法同时拥有');
                    }
                }
            });
            if (hint.length) return hint.join('；') + '。这类目标本身不可共存，即使洗到也不会计入。';
        }
        return '';
    }

    /* 目标规则预检：现有天赋里已含哪些目标 */
    function existingTargets(talents, rule) {
        var list = (talents || []).map(Number);
        var mustSet = asSet(rule.must);
        var pickSet = asSet(rule.pick);
        return {
            mustHeld: rule.must.length ? list.filter(function (id) { return mustSet.has(id); }) : [],
            pickHeld: pickSet.size ? list.filter(function (id) { return pickSet.has(id); }) : []
        };
    }

    /*
     * 核心检索：为单个弟子规划洗点
     * @returns { ok, reason, washes, day, endState, events, ... }
     */
    function planStudent(student, rule, options) {
        /*
         * options.allowSwap：是否允许「纯换运」这一步（不为挡路、只为换一组洗脉结果）。
         * 它救人很有效（实测同一批弟子 2/16 → 16/16），但会明显放大搜索量：
         * 换运点 = 窗口天数 × 槽数，每个都是一棵新子树的起点；目标越多、等级越低，
         * 这条链越长，实测"3 个必出 + 1 级弟子"会慢 10 倍以上。
         * 所以由页面开关控制、默认关闭，只做"挡路清障"（那种是必须做的，几乎不加开销）。
         */
        var allowSwap = !!(options && options.allowSwap);
        var maxDays = (options && options.maxDays) || 1500;
        /*
         * 搜索节点上限：纯粹的安全阀，正常扫描根本摸不到它。
         * 因为只有「命中」或「清障」的洗才入队，分支被剪得很狠；加上弟子满级(100)后
         * 种子不再变化、状态会自然收敛，队列总是自己跑空。
         * 实测三档上限（6 万 / 30 万 / 200 万）跑同一批弟子，结果与耗时完全一致。
         * 这里放宽到 20 万只是留点余量——真正的搜索广度由清障时机(CLEAR_WINDOW_DAYS)决定。
         */
        var maxStates = (options && options.maxStates) || 200000;
        if (!E || !DATA) return { ok: false, reason: '恒山引擎未就绪。' };

        var clean = validateRule(rule);
        if (clean) return { ok: false, reason: clean };

        var mustSet = asSet(rule.must);
        var pickSet = asSet(rule.pick);
        var pickN = Number(rule.pickN) || 0;
        var maxWashes = Math.max(1, Math.min(10, Number(rule.maxWashes) || 3));

        /*
         * 商店候选尚未招募，其 seed 是「占位值」（每天刷新时统一赋予，当天所有候选共用），
         * 直接拿它推演洗脉毫无意义——实测 5 人 0/5 命中、200 组公式对照全落空。
         * 必须先走一次 prepareRecruit，换算成「招募进队伍之后」的真实状态，
         * 洗脉预测才成立（实测 3 人转换前后种子完全吻合）。
         */
        var base = student;
        var srcTag = String(student && student.source);
        /* shop-preview = 引擎推算的「刷新后」候选，同样需要 prepareRecruit */
        if ((srcTag === 'shop' || srcTag === 'shop-preview') && typeof E.prepareRecruit === 'function') {
            try {
                var prepared = E.prepareRecruit(student);
                if (prepared && prepared.state) {
                    base = Object.assign({}, student, prepared.state);
                    base.name = student.name;
                    base.source = student.source;
                }
            } catch (error) { base = student; }
        }

        var normalized = E.normalizeState(base);
        var start = Object.assign({}, base, normalized);
        start.talents = (start.talents || []).slice();

        var initial = { state: start, day: 0, washes: 0, events: [] };
        if (isMet(initial.state.talents, mustSet, pickSet, pickN)) {
            return {
                ok: true, reason: '', washes: 0, day: 0,
                endState: initial.state, events: [], early: true,
                /* 卡片末行要读这两项，缺了会渲染成「完成等级 undefined · 最终组合：（空）」 */
                endTalents: (initial.state.talents || []).slice(),
                endLevel: initial.state.level,
                note: '当前天赋已满足目标规则，无需洗。'
            };
        }

        /* 优先级：落地洗次数少者优先；同次数时达成更早者优先 */
        var queue = [initial];
        var visited = new Map();   // key -> 达到该状态所需最少落地洗
        var expansions = 0;

        function keyOf(state) {
            return [state.seed, state.level, state.exp, (state.talents || []).join('.')].join('|');
        }

        /*
         * 洗脉结果只由「种子 + 等级 + 身上留下来的两个天赋 + 洗哪个槽」决定，跟 exp 无关
         * （内核 replacementChain 内部就是 normalizeState 之后抽签，exp 不参与计算）。
         * 而搜索里同一个组合会被反复问到——最典型的是"过了天"和"没过了天"两种情况：
         * 只要当天没升级，种子/等级/天赋全一样，洗出来必然相同（实测每个节点要洗 6 次，
         * 其中一半是这种重复）。所以这里缓存一份，纯省时间，不改任何判断。
         */
        var washCache = new Map();
        function washOf(state, slot) {
            var cacheKey = state.seed + '|' + state.level + '|' + (state.talents || []).join('.') + '|' + slot;
            if (washCache.has(cacheKey)) return washCache.get(cacheKey);
            var step = null;
            try {
                var chain = E.replacementChain(DATA, state, slot, 1);
                step = (chain && chain.steps && chain.steps[0]) || null;
            } catch (error) { step = null; }
            washCache.set(cacheKey, step);
            return step;
        }
        function enqueue(node) {
            if (node.day > maxDays) return;
            var key = keyOf(node.state);
            var best = visited.get(key);
            if (best !== undefined && best <= node.washes) return;
            visited.set(key, node.washes);
            queue.push(node);
        }
        function popBest() {
            var bestIndex = -1;
            var bestNode = null;
            for (var i = 0; i < queue.length; i += 1) {
                var node = queue[i];
                if (!bestNode || node.washes < bestNode.washes || (node.washes === bestNode.washes && node.day < bestNode.day)) {
                    bestNode = node;
                    bestIndex = i;
                }
            }
            if (bestIndex >= 0) queue.splice(bestIndex, 1);
            return bestNode;
        }
        function markMet(node) {
            return {
                ok: true, reason: '', washes: node.washes, day: node.day,
                endState: node.state, events: node.events,
                endTalents: (node.state.talents || []).slice(),
                endLevel: node.state.level,
                clears: (node.events || []).filter(function (ev) { return ev.clear && ev.blocking; }).length,
                swaps: (node.events || []).filter(function (ev) { return ev.clear && !ev.blocking; }).length
            };
        }

        enqueue(initial);

        while (queue.length) {
            var node = popBest();
            expansions += 1;
            if (expansions > maxStates) {
                return { ok: false, reason: '搜索节点超限（' + maxStates + '），规则过于苛刻或引擎异常。', washes: node.washes, day: node.day };
            }

            if (isMet(node.state.talents, mustSet, pickSet, pickN)) return markMet(node);

            var canAdvance = Number(node.state.level) < 100;

            if (canAdvance) {
                /* —— 走一天（修炼 / 升级 / 40·80 节点赠礼） —— */
                var dayState = Object.assign({}, node.state);
                var result;
                try { result = E.advanceDay(DATA, dayState); }
                catch (error) { continue; }
                if (!result || !result.state) continue;
                Object.assign(dayState, result.state);

                var eventList = node.events;
                var milestones = (result.action && result.action.milestones) || [];
                milestones.forEach(function (m) {
                    var id = Number(m && (m.id !== undefined ? m.id : m.talentId));
                    if (!id) return;
                    /* hit = 该赠礼真的带来一个尚缺的目标天赋 */
                    var gained = gainedTargetIds((node.state.talents || []), (node.state.talents || []).concat(id), mustSet, pickSet, pickN);
                    eventList = eventList.concat([{
                        day: node.day + 1,
                        level: dayState.level,
                        type: 'grant',
                        drawnId: id,
                        hit: gained.indexOf(id) >= 0
                    }]);
                });

                var noWash = { state: dayState, day: node.day + 1, washes: node.washes, events: eventList };
                enqueue(noWash);

                /* —— 同一天落地一次洗（只能选一个槽） —— */
                if (node.washes < maxWashes) {
                    var slots = (dayState.talents || []).length;
                    for (var slot = 0; slot < slots; slot += 1) {
                        var step = washOf(dayState, slot);
                        if (!step) continue;
                        var nextTalents = (step.talents || []).slice();
                        var gained = gainedTargetIds((dayState.talents || []), nextTalents, mustSet, pickSet, pickN);
                        if (!gained.length) continue;   // 没带来新目标 → SL 不计预算
                        var washState = Object.assign({}, dayState, {
                            seed: step.nextSeed,
                            talents: nextTalents
                        });
                        var washNode = {
                            state: washState,
                            day: node.day + 1,
                            washes: node.washes + 1,
                            events: eventList.concat([{
                                day: node.day + 1,
                                level: dayState.level,
                                type: 'wash',
                                slot: slot,
                                oldId: Number(dayState.talents[slot]),
                                drawnId: step.id,
                                hit: true,
                                gainedIds: gained
                            }])
                        };
                        enqueue(washNode);
                    }
                }
            }

            /*
             * 原地洗：不推进天数，直接在当前等级洗。
             * 玩家招募后可以直接洗（不必先过一天），所以这条分支对未满级弟子同样有效，
             * 不能只在满级时启用。冷却够不够由玩家自己判断，本模块不做裁决。
             *
             * 例外：清障 / 换运（见 CLEAR_WINDOW_DAYS）。它抽到的不是目标，但必须认账、
             * 占一次额度。为了不把搜索分支炸开，只允许它出现在方案开头那几天里
             * （哪天做都等价，所以窗口不必很大，取值依据见 CLEAR_WINDOW_DAYS 的注释）。
             */
            if (node.washes < maxWashes) {
                var slots2 = (node.state.talents || []).length;
                for (var slot2 = 0; slot2 < slots2; slot2 += 1) {
                    var step2 = washOf(node.state, slot2);
                    if (!step2) continue;
                    var next2 = (step2.talents || []).slice();
                    var gained2 = gainedTargetIds((node.state.talents || []), next2, mustSet, pickSet, pickN);
                    var clear2 = false;
                    var blocking2 = false;
                    if (!gained2.length) {
                        /* 只要还在开头的窗口内就放行（不必"挡路"）——多数弟子卡住不是因为挡路，
                           而是这颗种子本身等不到目标，先洗一次换个种子序列就通了 */
                        if (!(node.washes === 0 && node.day <= CLEAR_WINDOW_DAYS)) continue;
                        clear2 = true;
                        blocking2 = isBlocker(node.state.talents[slot2], node.state.talents, mustSet, pickSet, pickN);
                        /* 没开开关时只做"挡路清障"：纯换运能救人但代价大，交给玩家自己决定 */
                        if (!blocking2 && !allowSwap) continue;
                    }
                    var washState2 = Object.assign({}, node.state, { seed: step2.nextSeed, talents: next2 });
                    enqueue({
                        state: washState2,
                        day: node.day + 1,
                        washes: node.washes + 1,
                        events: node.events.concat([{
                            day: node.day + 1,
                            level: node.state.level,
                            type: 'wash',
                            slot: slot2,
                            oldId: Number(node.state.talents[slot2]),
                            drawnId: step2.id,
                            hit: !clear2,
                            clear: clear2,
                            blocking: blocking2,
                            gainedIds: gained2
                        }])
                    });
                }
            }
        }

        return { ok: false, reason: '该弟子在 1~100 级、最多 ' + maxWashes + ' 次洗的范围内凑不齐目标规则。', washes: -1, day: -1 };
    }

    /* —— 以下为页面 UI —— */
    function buildUI() {
        var el = function (id) { return document.getElementById(id); };
        var root = el('autoSimPanel');
        if (!root || !DATA || !E) return;

        var maxWashInput = el('asMaxWashes');
        var mustChips = el('asMustChips');
        var pickChips = el('asPickChips');
        var pickNInput = el('asPickN');
        var mustCountEl = el('asMustCount');
        var pickCountEl = el('asPickCount');
        var modeMustBtn = el('asModeMust');
        var modePickBtn = el('asModePick');
        var gridRoot = el('asTalentGrid');
        var filterInput = el('asFilter');
        var scopeSelect = el('asScope');
        var skipMaxInput = el('asSkipMax');
        var allowSwapInput = el('asAllowSwap');
        var runBtn = el('btnAutoSimRun');
        var resetBtn = el('btnAutoSimReset');
        var progressEl = el('asProgress');
        var resultsEl = el('asResults');
        var summaryEl = el('asRuleSummary');
        var validateEl = el('asValidate');

        var mode = 'must';       // 当前点击行为：must | pick
        var must = [];           // 必出列表
        var pick = [];           // 备选列表

        function nameOf(id) { return shortName(id); }

        function toggle(arr, id) {
            var idx = arr.indexOf(id);
            if (idx >= 0) arr.splice(idx, 1);
            else if (arr.length < 20) arr.push(id);
            return idx < 0;
        }

        function renderSummary() {
            var mCount = must.length;
            var pCount = pick.length;
            var n = clampN();
            if (mustCountEl) mustCountEl.textContent = String(mCount);
            if (pickCountEl) pickCountEl.textContent = pCount + ' 选 ' + n;
            renderChips(mustChips, must, '必出');
            renderChips(pickChips, pick, '备选');
            if (summaryEl) {
                var total = mCount + n;
                summaryEl.textContent = '目标合计 ' + total + ' 槽' + (total > 3 ? '（超出 3 槽，不可达成）' : '') + ' · 最多洗 ' + (Number(maxWashInput && maxWashInput.value) || 3) + ' 次';
            }
            if (validateEl) {
                var msg = validateRule(collectRule());
                validateEl.textContent = msg || '';
                validateEl.classList.toggle('is-error', !!msg);
            }
            if (runBtn) runBtn.disabled = !!msg;
        }

        function clampN() {
            var n = Math.max(0, Math.min(3, Math.trunc(Number(pickNInput && pickNInput.value) || 0)));
            if (pickNInput) pickNInput.value = String(n);
            return n;
        }

        function renderChips(container, arr, kind) {
            if (!container) return;
            if (!arr.length) { container.innerHTML = '<span class="as-chip-empty">未选</span>'; return; }
            container.innerHTML = arr.map(function (id) {
                return '<span class="as-chip as-chip-' + kind.toLowerCase() + '">' + nameOf(id)
                    + '<button type="button" data-remove="' + id + '" title="移除">×</button></span>';
            }).join('');
        }

        function collectRule() {
            var rule = {
                must: must.slice(),
                pick: pick.slice(),
                pickN: Number(pickNInput && pickNInput.value) || 0,
                maxWashes: Number(maxWashInput && maxWashInput.value) || 3
            };
            if (!rule.must.length && rule.pick.length && !rule.pickN) rule.pickN = 1;
            return rule;
        }

        function buildGrid() {
            if (!gridRoot) return;
            gridRoot.innerHTML = CATEGORIES.map(function (cat) {
                var items = cat.ids.map(function (id) {
                    var inMust = must.indexOf(id) >= 0;
                    var inPick = pick.indexOf(id) >= 0;
                    var cls = inMust ? ' is-in-must' : (inPick ? ' is-in-pick' : '');
                    var mark = inMust ? '①' : (inPick ? '②' : '');
                    return '<button type="button" class="as-talent' + cls + '" data-id="' + id + '">' + mark + nameOf(id) + '</button>';
                }).join('');
                return '<details class="as-cat" open><summary>' + cat.name
                    + '<span class="as-cat-count">' + cat.ids.length + '</span></summary>'
                    + '<div class="as-talent-grid">' + items + '</div></details>';
            }).join('');
        }

        function filterGrid(keyword) {
            if (!gridRoot) return;
            var k = String(keyword || '').trim();
            var detailsList = gridRoot.querySelectorAll('details.as-cat');
            for (var d = 0; d < detailsList.length; d += 1) {
                var cat = detailsList[d];
                var buttons = cat.querySelectorAll('.as-talent');
                var visible = 0;
                for (var b = 0; b < buttons.length; b += 1) {
                    var text = buttons[b].textContent;
                    var show = !k || text.indexOf(k) >= 0;
                    buttons[b].style.display = show ? '' : 'none';
                    if (show) visible += 1;
                }
                cat.style.display = visible ? '' : 'none';
            }
        }

        /* 满级(≥100)弟子默认跳过：他们只能原地洗，多数是早已评估过的老弟子 */
        function applySkipMax(list) {
            lastSkippedMax = 0;
            if (!skipMaxInput || !skipMaxInput.checked) return list;
            return list.filter(function (s) {
                var lvl = Number(s && s.level);
                if (Number.isFinite(lvl) && lvl >= 100) { lastSkippedMax += 1; return false; }
                return true;
            });
        }

        function shopPool() {
            try {
                if (window.HengshanShopView && typeof window.HengshanShopView.getShopScanStudents === 'function') {
                    return window.HengshanShopView.getShopScanStudents() || [];
                }
            } catch (error) { /* 回退到按 source 过滤 */ }
            return [];
        }

        function getStudents() {
            var scope = scopeSelect && scopeSelect.value || 'shop';
            var list = [];
            try {
                if (window.HengshanPageState && typeof window.HengshanPageState.getSimulationStudents === 'function') {
                    list = window.HengshanPageState.getSimulationStudents() || [];
                }
            } catch (error) { list = []; }
            if (!list.length) {
                var select = el('studentSelect');
                if (select && select.value && select.options.length > 1) {
                    var chosen = select.options[select.selectedIndex];
                    list = [{ key: chosen.value, name: chosen.text, source: '当前选中' }];
                }
            }

            if (scope === 'shop') {
                var pool = shopPool();
                if (pool.length) return applySkipMax(pool);
                return applySkipMax(list.filter(function (s) { return isShopSource(String(s.source)); }));
            }

            if (scope === 'enrolled') {
                /* 与卡片上的来源标注保持同一口径：在册 = 非商店来源 */
                return applySkipMax(list.filter(function (s) { return !isShopSource(String(s.source)); }));
            }

            /* 全部弟子：存档全量 + 推算刷新批（按 key 去重） */
            var merged = list.slice();
            var seen = Object.create(null);
            merged.forEach(function (s) { seen[String(s.key)] = true; });
            shopPool().forEach(function (s) {
                if (!seen[String(s.key)]) { seen[String(s.key)] = true; merged.push(s); }
            });
            return applySkipMax(merged);
        }

        function studentLabel(s) {
            var src = s && s.source;
            /* 商店候选的 seed 是占位值，预测的是「招募进队伍之后」的路线，标注清楚免误解 */
            var sourceName = isShopSource(src) ? '商店候选 · 按招募后推演' : '在册';
            var level = s && s.level ? s.level + '级' : '—';
            var current = (s && s.talents || []).map(nameOf).join('、') || '暂无';
            return { sourceName: sourceName, level: level, current: current, raw: s };
        }

        function escapeHtml(value) {
            return String(value == null ? '' : value).replace(/[&<>"']/g, function (c) {
                return ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c];
            });
        }

        function renderResult(student, plan) {
            var label = studentLabel(student);
            var head;
            var body;
            if (plan && plan.ok) {
                var finalNames = (plan.endTalents || []).map(nameOf);
                head = '<div class="as-card-head"><strong class="as-card-name">' + escapeHtml(label.raw.name || '未命名')
                    + '</strong><span class="as-badge as-ok">✓ ' + plan.washes + ' 次洗可达成</span></div>';
                var lines = [];
                if (plan.events.length) {
                    plan.events.forEach(function (ev) {
                        if (ev.type === 'grant') {
                            var hitMark = ev.hit ? '<em class="as-hit">★命中目标</em>' : '';
                            lines.push('<li>升到 <b>' + ev.level + ' 级</b>：节点自动获得「' + nameOf(ev.drawnId) + '」' + hitMark + '</li>');
                        } else {
                            var replaced = ev.oldId ? '（替换「' + nameOf(ev.oldId) + '」）' : '';
                            /* 清障/换运这一步抽到什么都得认账，不是"锁定目标"，标清楚免得玩家以为必须抽到它 */
                            var mark;
                            if (ev.clear) {
                                mark = '<em class="as-clear">' + (ev.blocking ? '清障' : '换运')
                                    + ' · 抽到什么都行（占 1 次额度）</em>';
                            } else {
                                mark = '<em class="as-hit">★锁定</em>';
                            }
                            lines.push('<li><b>' + ev.level + ' 级</b> · 洗 <b>槽位' + (ev.slot + 1) + '</b>' + replaced + ' → 抽中「' + nameOf(ev.drawnId) + '」' + mark + '</li>');
                        }
                    });
                } else {
                    lines.push('<li>' + (plan.note || '无需洗。') + '</li>');
                }
                body = '<p class="as-card-sub">' + label.sourceName + ' · 当前 ' + label.level + ' · 现有：' + escapeHtml(label.current) + '</p>'
                    + '<ol class="as-plan-list">' + lines.join('') + '</ol>'
                    + '<p class="as-card-end">完成等级 ' + plan.endLevel + ' · 共洗 ' + plan.washes + ' 次'
                    + (plan.clears || plan.swaps
                        ? '（含 ' + [
                            plan.clears ? plan.clears + ' 次清障' : '',
                            plan.swaps ? plan.swaps + ' 次换运' : ''
                        ].filter(Boolean).join(' + ') + '）'
                        : '')
                    + ' · 最终组合：' + finalNames.join('、') + '</p>';
            } else {
                var reason = plan && plan.reason || '未知原因';
                head = '<div class="as-card-head"><strong class="as-card-name">' + escapeHtml(label.raw.name || '未命名')
                    + '</strong><span class="as-badge as-fail">✗ 淘汰</span></div>';
                body = '<p class="as-card-sub">' + label.sourceName + ' · 当前 ' + label.level + ' · 现有：' + escapeHtml(label.current) + '</p>'
                    + '<p class="as-card-fail">' + escapeHtml(reason) + '</p>';
            }
            return '<article class="as-card">' + head + body + '</article>';
        }

        async function runScan() {
            var rule = collectRule();
            var check = validateRule(rule);
            if (check) { if (validateEl) validateEl.textContent = check; return; }
            var allowSwap = !!(allowSwapInput && allowSwapInput.checked);
            var students = getStudents();
            if (!students.length) {
                if (progressEl) progressEl.innerHTML = '<p class="is-error">没有可扫描的弟子。请先在首页导入含恒山弟子的存档，或先到上方选择一名弟子。</p>';
                return;
            }
            if (runBtn) runBtn.disabled = true;
            if (resultsEl) resultsEl.innerHTML = '';
            var started = Date.now();
            var total = students.length;
            var hits = [];
            var eliminated = 0;
            if (progressEl) progressEl.innerHTML = '<p>正在扫描 ' + total + ' 名弟子…</p>';
            for (var i = 0; i < students.length; i += 1) {
                var student = students[i];
                var plan;
                try { plan = planStudent(student, rule, { allowSwap: allowSwap }); }
                catch (err) { plan = { ok: false, reason: '推演异常：' + (err && err.message ? err.message : err) }; }
                if (plan && plan.ok) hits.push({ student: student, plan: plan });
                else eliminated += 1;
                if (progressEl) progressEl.textContent = '进度 ' + (i + 1) + ' / ' + total + '（命中 ' + hits.length + ' 名）…';
                await new Promise(function (resolve) { setTimeout(resolve, 0); });
            }
            lastScan = { rule: rule, hits: hits, total: total };
            var cost = ((Date.now() - started) / 1000).toFixed(1);
            if (resultsEl) {
                var header = '<div class="as-result-head">'
                    + '<span class="as-result-count">命中 <strong>' + hits.length + '</strong> / ' + total + ' 名</span>'
                    + (eliminated ? '<span class="as-result-skip">' + eliminated + ' 名未达成目标，已直接跳过不展示</span>' : '')
                    + (lastSkippedMax ? '<span class="as-result-skip">已跳过 ' + lastSkippedMax + ' 名满级弟子</span>' : '')
                    + '</div>';
                resultsEl.innerHTML = header
                    + (hits.length
                        ? hits.map(function (item) { return renderResult(item.student, item.plan); }).join('')
                        : '<p class="as-result-empty">没有弟子能在最多 ' + rule.maxWashes + ' 次洗内达成目标规则。'
                            + (allowSwap ? '' : '可勾选上方「允许清障 / 换运」再扫一次——它会额外花一次洗的额度去换一组新结果，能明显多救回一些弟子。')
                            + '也可放宽条件，或等明天商店刷新后重新扫描。</p>');
            }
            if (progressEl) progressEl.innerHTML = '<p>完成：扫描 ' + total + ' 名弟子，命中 ' + hits.length
                + ' 名，淘汰 ' + eliminated + ' 名'
                + (lastSkippedMax ? '，跳过满级 ' + lastSkippedMax + ' 名' : '')
                + '，耗时 ' + cost + 's。'
                + (hits.length ? '照着卡片到对应等级洗即可；标「清障 / 换运」的那一步要真洗、占 1 次额度，其余没命中的试洗不用真落地（SL 不消耗预算）。' : '')
                + ((!allowSwap && eliminated) ? '想多救回几个，可勾选上方「允许清障 / 换运」再扫一次（会更慢）。' : '')
                + '</p>';
            if (runBtn) runBtn.disabled = false;
        }

        /* 事件绑定 */
        if (modeMustBtn) modeMustBtn.addEventListener('click', function () {
            mode = 'must';
            modeMustBtn.classList.add('is-active');
            if (modePickBtn) modePickBtn.classList.remove('is-active');
        });
        if (modePickBtn) modePickBtn.addEventListener('click', function () {
            mode = 'pick';
            modePickBtn.classList.add('is-active');
            if (modeMustBtn) modeMustBtn.classList.remove('is-active');
        });
        if (gridRoot) gridRoot.addEventListener('click', function (e) {
            var btn = e.target.closest && e.target.closest('.as-talent');
            if (!btn) return;
            var id = Number(btn.dataset.id);
            var inMust = must.indexOf(id) >= 0;
            var inPick = pick.indexOf(id) >= 0;
            if (mode === 'must') {
                if (inPick) pick.splice(pick.indexOf(id), 1);
                toggle(must, id);
            } else {
                if (inMust) must.splice(must.indexOf(id), 1);
                toggle(pick, id);
            }
            buildGrid();
            renderSummary();
            filterGrid(filterInput && filterInput.value);
        });
        /* 移除已选天赋后重建网格，必须保留当前搜索词，否则玩家要重搜一遍 */
        if (mustChips) mustChips.addEventListener('click', function (e) {
            var btn = e.target.closest && e.target.closest('[data-remove]');
            if (!btn) return;
            var id = Number(btn.dataset.remove);
            var idx = must.indexOf(id);
            if (idx >= 0) must.splice(idx, 1);
            buildGrid();
            renderSummary();
            filterGrid(filterInput && filterInput.value);
        });
        if (pickChips) pickChips.addEventListener('click', function (e) {
            var btn = e.target.closest && e.target.closest('[data-remove]');
            if (!btn) return;
            var id = Number(btn.dataset.remove);
            var idx = pick.indexOf(id);
            if (idx >= 0) pick.splice(idx, 1);
            buildGrid();
            renderSummary();
            filterGrid(filterInput && filterInput.value);
        });
        if (maxWashInput) maxWashInput.addEventListener('change', function () {
            var v = Math.max(1, Math.min(10, Math.trunc(Number(maxWashInput.value) || 3)));
            maxWashInput.value = String(v);
            renderSummary();
        });
        if (pickNInput) pickNInput.addEventListener('change', renderSummary);
        if (filterInput) filterInput.addEventListener('input', function () { filterGrid(filterInput.value); });
        if (resetBtn) resetBtn.addEventListener('click', function () {
            must = [];
            pick = [];
            if (pickNInput) pickNInput.value = '1';
            if (maxWashInput) maxWashInput.value = '3';
            lastScan = { rule: null, hits: [], total: 0 };
            if (resultsEl) resultsEl.innerHTML = '';
            if (progressEl) progressEl.innerHTML = '';
            if (validateEl) validateEl.textContent = '';
            buildGrid();
            renderSummary();
            filterGrid('');
        });
        if (runBtn) runBtn.addEventListener('click', function () {
            runScan().catch(function (err) {
                if (progressEl) progressEl.innerHTML = '<p class="is-error">扫描失败：' + escapeHtml(err && err.message ? err.message : err) + '</p>';
                if (runBtn) runBtn.disabled = false;
            });
        });

        buildGrid();
        renderSummary();
    }

    /* 导出命中名单（页面顶部"导出表格"在自动推演页签调用） */
    function exportHengshanAutoTable() {
        var hits = (lastScan && lastScan.hits) || [];
        if (!window.YYJHTableExport || !window.YYJHTableExport.download) {
            window.alert('导出功能暂不可用。');
            return;
        }
        if (!hits.length) {
            window.alert('暂无命中名单，请先运行一次自动推演。');
            return;
        }
        var rows = hits.map(function (item) {
            var s = item.student || {};
            var plan = item.plan || {};
            var src = String(s.source);
            var srcName = isShopSource(src) ? '商店候选' : '在册';
            var actions = (plan.events || []).map(function (ev) {
                if (ev.type === 'grant') {
                    return '第' + ev.day + '天升' + ev.level + '级赠「' + shortName(ev.drawnId) + '」' + (ev.hit ? '命中' : '');
                }
                if (ev.clear) {
                    return '第' + ev.day + '天' + ev.level + '级洗槽' + (ev.slot + 1) + '→'
                        + (ev.blocking ? '清障' : '换运') + '（抽到什么都行，占 1 次额度）';
                }
                return '第' + ev.day + '天' + ev.level + '级洗槽' + (ev.slot + 1) + '→「' + shortName(ev.drawnId) + '」锁定';
            }).join('；');
            return [
                String(s.name || ''),
                srcName,
                (s.level || 1) + '级',
                ((s.talents || []).map(shortName).join('、') || '暂无'),
                plan.washes + ' 次 / ' + plan.day + ' 天',
                actions,
                ((plan.endTalents || []).map(shortName).join('、') || '')
            ];
        });
        window.YYJHTableExport.download({
            headers: ['弟子', '来源', '当前等级', '现有天赋', '达成（次数/天）', '操作序列', '最终组合'],
            rows: rows,
            filename: '恒山自动推演命中_' + (window.YYJHTableExport.timestamp ? window.YYJHTableExport.timestamp() : Date.now()),
            emptyMessage: '暂无命中名单'
        });
    }
    window.exportHengshanAutoTable = exportHengshanAutoTable;

    /* 核心逻辑暴露（页面 / 无头冒烟共用） */
    window.HengshanAutoSimCore = Object.freeze({
        CATEGORIES: CATEGORIES,
        shortName: shortName,
        validateRule: validateRule,
        planStudent: planStudent,
        isMet: isMet
    });

    /*
     * 入口：必须等内核就绪再建界面。
     * 天赋名要靠内核翻译（talentName 会走 wasm），内核没就绪时它会抛「算法 WASM 尚未加载」，
     * 于是网格里的名字会全部退化成「天赋 408」这种编号；而网格只建这一次、之后不会自动重建，
     * 玩家就会一直盯着编号看（点一下天赋会触发重建，所以现象是"点一下名字就正常了"）。
     * 内核加载失败时也要把界面建出来（否则整页空白），所以 reject 分支同样调 buildUI。
     */
    function boot() {
        var ready = window.WasmAlgorithmAPI && window.WasmAlgorithmAPI.ready;
        if (ready && typeof ready.then === 'function') ready.then(buildUI, buildUI);
        else buildUI();
    }

    if (typeof document !== 'undefined') {
        if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot);
        else boot();
    }
})();
