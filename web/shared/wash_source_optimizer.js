(function (root) {
    'use strict';

    const SEARCH_LIMITS = Object.freeze({
        frontierLimit: 0,
        maxEventNodes: 400000,
        maxMainRawWashes: 2000000,
        maxTailRawWashes: 2000000,
        maxEventDepth: 96,
        estimatedTargetCost: 900,
        maxFinalTailExchangeDepth: 32,
        maxExchangePreviewDepth: 8,
        maxSparseTargetGap: 16,
        maxSparseRawDraws: 64,
        deferredInterleaveEvery: 24,
    });

    function numeric(value, fallback = 0) {
        const result = Number(value);
        return Number.isFinite(result) ? result : fallback;
    }

    function sleepTurn() {
        return new Promise(resolve => setTimeout(resolve, 0));
    }

    class MinHeap {
        constructor(compare) {
            this.items = [];
            this.compare = compare;
        }

        get size() {
            return this.items.length;
        }

        peek() {
            return this.items[0];
        }

        push(value) {
            const items = this.items;
            items.push(value);
            let index = items.length - 1;
            while (index > 0) {
                const parent = (index - 1) >> 1;
                if (this.compare(items[parent], value) <= 0) break;
                items[index] = items[parent];
                index = parent;
            }
            items[index] = value;
        }

        pop() {
            const items = this.items;
            if (!items.length) return null;
            const first = items[0];
            const last = items.pop();
            if (items.length) {
                let index = 0;
                while (true) {
                    const left = index * 2 + 1;
                    if (left >= items.length) break;
                    const right = left + 1;
                    let child = right < items.length && this.compare(items[right], items[left]) < 0 ? right : left;
                    if (this.compare(items[child], last) >= 0) break;
                    items[index] = items[child];
                    index = child;
                }
                items[index] = last;
            }
            return first;
        }

        rebuild(compare, keep = () => true) {
            this.compare = compare;
            this.items = this.items.filter(keep);
            const items = this.items;
            for (let index = (items.length >> 1) - 1; index >= 0; index -= 1) {
                const value = items[index];
                let cursor = index;
                while (true) {
                    const left = cursor * 2 + 1;
                    if (left >= items.length) break;
                    const right = left + 1;
                    const child = right < items.length && compare(items[right], items[left]) < 0 ? right : left;
                    if (compare(items[child], value) >= 0) break;
                    items[cursor] = items[child];
                    cursor = child;
                }
                items[cursor] = value;
            }
        }
    }

    function traceAppend(trace, action) {
        return { previous: trace || null, action };
    }

    function traceActions(trace) {
        const actions = [];
        for (let cursor = trace; cursor; cursor = cursor.previous) actions.push(cursor.action);
        actions.reverse();
        return actions;
    }

    function positionsForIds(state, ids) {
        const remaining = state.talents.map((id, index) => ({ id, index, used: false }));
        return ids.map(id => {
            const item = remaining.find(value => !value.used && value.id === id);
            if (!item) throw new Error(`锁脉回放失败：槽位中不存在天赋 ${id}`);
            item.used = true;
            return item.index;
        });
    }

    function idsInStateOrder(state, ids) {
        const wanted = new Set(ids);
        return state.talents.filter(id => wanted.has(id));
    }

    function targetsIn(state, targetSet) {
        return state.talents.filter(id => targetSet.has(id));
    }

    function containsTargets(state, targetSet) {
        for (const id of targetSet) if (!state.talents.includes(id)) return false;
        return true;
    }

    function actionWash(engine, state, keepIds, mode) {
        const result = engine.wash(state, positionsForIds(state, keepIds));
        return {
            state: result.state,
            action: {
                kind: 'wash',
                mode,
                keepIds: result.keepIds,
                cost: result.cost,
                draws: result.draws,
                generatedBars: result.generatedBars,
                after: result.state,
            },
        };
    }

    function actionReplace(engine, state, position, mode, lockedIds = []) {
        const orderedLocks = idsInStateOrder(state, lockedIds);
        const result = engine.replace(state, position, orderedLocks);
        return {
            state: result.state,
            action: {
                kind: 'exchange',
                mode,
                keepIds: orderedLocks,
                cost: 0,
                draws: result.draws,
                generatedBars: 0,
                removedId: result.removedId,
                addedId: result.addedId,
                after: result.state,
            },
        };
    }

    function actionUpgrade(engine, state) {
        const upgraded = typeof engine.upgradeToFour === 'function'
            ? engine.upgradeToFour(state)
            : { ...root.WashSourceEngine.cloneState(state), zizhi: 154 };
        return {
            state: upgraded,
            action: {
                kind: 'upgrade',
                mode: 'open-fourth-slot',
                keepIds: [],
                cost: 0,
                draws: 0,
                generatedBars: 0,
                after: upgraded,
            },
        };
    }

    function actionUnlock(state, releasedIds = []) {
        const sameState = root.WashSourceEngine.cloneState(state);
        return {
            state: sameState,
            action: {
                kind: 'unlock',
                mode: 'destroy-vein-release',
                keepIds: [],
                releasedIds: releasedIds.slice(),
                cost: 0,
                draws: 0,
                generatedBars: 0,
                after: sameState,
            },
        };
    }

    function sameNumbers(left, right) {
        return left.length === right.length && left.every((value, index) => value === right[index]);
    }

    function compactActions(actions) {
        const groups = [];
        for (const action of actions) {
            const last = groups[groups.length - 1];
            if (action.kind === 'wash' && last && last.kind === 'wash'
                && last.mode === action.mode && sameNumbers(last.keepIds, action.keepIds)) {
                last.count += 1;
                last.cost += action.cost;
                last.draws += action.draws;
                last.generatedBars += action.generatedBars;
                last.after = action.after;
                continue;
            }
            groups.push({ ...action, keepIds: action.keepIds.slice(), count: action.kind === 'wash' ? 1 : 0 });
        }
        return groups;
    }

    function stateTalentNames(engine, state, lockedIds = []) {
        const locked = new Set(lockedIds);
        return state.talents.map(id => ({ id, name: engine.name(id), locked: locked.has(id) }));
    }

    function replayNode(ctx, node, actions) {
        let state = root.WashSourceEngine.cloneState(ctx.startState);
        let pills = 0;
        for (const action of actions) {
            if (action.kind === 'wash') {
                const replayed = ctx.engine.wash(state, positionsForIds(state, action.keepIds));
                state = replayed.state;
                pills += replayed.cost;
            } else if (action.kind === 'exchange') {
                const position = state.talents.indexOf(action.removedId);
                if (position < 0) throw new Error(`路线回放失败：找不到待置换天赋 ${action.removedId}`);
                state = ctx.engine.replace(state, position, action.keepIds).state;
            } else if (action.kind === 'upgrade') {
                state = typeof ctx.engine.upgradeToFour === 'function'
                    ? ctx.engine.upgradeToFour(state)
                    : { ...root.WashSourceEngine.cloneState(state), zizhi: 154 };
            } else if (action.kind === 'unlock') {
                state = root.WashSourceEngine.cloneState(state);
            }
            if (root.WashSourceEngine.stateKey(state) !== root.WashSourceEngine.stateKey(action.after)) {
                throw new Error('路线回放失败：操作后状态与搜索状态不一致');
            }
        }
        if (pills !== node.cost || root.WashSourceEngine.stateKey(state) !== root.WashSourceEngine.stateKey(node.state)) {
            throw new Error('路线回放失败：累计丹耗或最终状态不一致');
        }
    }

    function stepLabel(group, engine) {
        if (group.kind === 'upgrade') return '开启第四脉';
        if (group.kind === 'unlock') return '毁脉：解除临时紫脉锁定';
        if (group.kind === 'exchange') return '置换冲突紫脉';
        if (group.mode === 'final-tail') return '锁定前三紫扫描尾脉';
        if (!group.keepIds.length) return '不锁脉推进';
        if (group.mode === 'scan-targets') return `锁定目标脉推进`;
        if (group.mode === 'seek-purple') return '锁前置冲突脉寻找紫脉';
        if (group.mode === 'pad-exchange') return '锁定冲突对垫洗';
        return `锁定 ${group.keepIds.map(id => engine.name(id)).join('、')} 推进`;
    }

    function stepDetail(group, engine) {
        if (group.kind === 'upgrade') return '在当前三脉状态开启第四脉；开槽本身不推进洗髓种子。';
        if (group.kind === 'unlock') {
            return `解除「${(group.releasedIds || []).map(id => engine.name(id)).join('、')}」的保护，作为毁脉临时支点继续洗；该动作本身不推进随机状态。`;
        }
        if (group.kind === 'exchange') {
            return `点击置换「${engine.name(group.removedId)}」，应得到「${engine.name(group.addedId)}」。`;
        }
        const locks = group.keepIds.length
            ? `锁定「${group.keepIds.map(id => engine.name(id)).join('、')}」`
            : '取消全部锁定';
        return `${locks}，连续洗脉 ${group.count} 次；以每次结果核对最后一组槽位。`;
    }

    function routeFromNode(ctx, node) {
        const actions = traceActions(node.trace);
        replayNode(ctx, node, actions);
        const groups = compactActions(actions);
        const steps = [];
        let cumulativePills = 0;
        let cumulativeWashes = 0;
        let cumulativeTalentBars = 0;
        const initialSlots = Math.max(0, Math.min(4, numeric(ctx.initialState.zizhi) - 150));
        const costBreakdown = {};
        for (const group of groups) {
            cumulativePills += group.cost;
            cumulativeWashes += group.kind === 'wash' ? group.count : 0;
            cumulativeTalentBars += group.generatedBars;
            if (group.kind === 'wash') {
                const slotCount = Math.max(0, Math.min(4, numeric(group.after?.zizhi, 154) - 150));
                const bucket = group.keepIds.length ? `lock${group.keepIds.length}`
                    : (slotCount === 3 ? 'threeUnlocked' : 'fourUnlocked');
                costBreakdown[bucket] = numeric(costBreakdown[bucket]) + group.cost;
            }
            steps.push({
                type: group.kind,
                label: stepLabel(group, ctx.engine),
                detail: stepDetail(group, ctx.engine),
                expectedName: group.kind === 'exchange' ? ctx.engine.name(group.addedId) : '',
                washes: group.kind === 'wash' ? group.count : 0,
                unitCost: group.kind === 'wash' ? group.cost / Math.max(1, group.count) : null,
                pills: group.cost,
                cumulativePills,
                cumulativeWashes,
                cumulativeTalentBars,
                after: { talents: stateTalentNames(ctx.engine, group.after, group.keepIds) },
            });
        }
        steps.push({
            type: 'verify', label: '核对最终目标',
            detail: `确认槽位同时包含：${ctx.targetIds.map(id => ctx.engine.name(id)).join('、')}。`,
            washes: 0, unitCost: null, pills: 0, cumulativePills, cumulativeWashes,
            cumulativeTalentBars, after: { talents: stateTalentNames(ctx.engine, node.state, ctx.targetIds) },
        });
        const available = ctx.hasBagPills ? ctx.bagPills : null;
        return {
            kind: 'source-bounded-tactical', verified: true, verifiedOptimal: false,
            branchId: `source-bounded-${node.serial}`,
            branchLabel: initialSlots === 4 ? '当前四槽起点' : `${initialSlots} 槽真实起手`,
            strategyLabel: groups.some(group => group.kind === 'unlock')
                ? '源码规则 · 毁脉临时支点 + 置换窗口 + 尾脉回放'
                : (groups.some(group => group.mode === 'final-tail')
                    ? '源码规则 · 最近冲突脉回溯 + 第四紫尾脉扫描'
                    : '源码规则 · 三槽前推 + 最近冲突脉回溯 + 完整置换窗口'),
            slotPath: [initialSlots, ...groups.filter(group => group.kind === 'upgrade').map(() => 4)]
                .filter((value, index, values) => index === 0 || value !== values[index - 1]),
            totalPills: node.cost, totalWashes: cumulativeWashes,
            totalTalentBars: cumulativeTalentBars,
            exchangeCount: groups.filter(group => group.kind === 'exchange').length,
            steps,
            finalTalents: stateTalentNames(ctx.engine, node.state, ctx.targetIds),
            finalState: {
                zizhi: numeric(node.state.zizhi, 154),
                seed: node.state.bornSeed,
                luck_seed: node.state.luckSeed,
                luck_seed_inited: node.state.luckSeed != null,
                born_talent_rc: numeric(node.state.bornRC),
                tal_lucky: node.state.talLucky,
                talents: stateTalentNames(ctx.engine, node.state, ctx.targetIds),
            },
            costBreakdown,
            inventory: {
                available,
                enough: available == null ? null : available >= node.cost,
                shortfall: available == null ? null : Math.max(0, node.cost - available),
                remaining: available == null ? null : available - node.cost,
            },
        };
    }

    async function searchWashRoutes(input) {
        if (!root.WashSourceEngine) throw new Error('源码洗脉状态机未加载');
        const talentData = input?.talentData || root.TALENT_DATA || {};
        const targetIds = Array.from(new Set((input?.targetIds || []).map(Number).filter(id => id > 0)));
        const targetSet = new Set(targetIds);
        const maxTotalPills = Math.max(0, Math.min(100000, Math.trunc(numeric(input?.options?.maxTotalPills, 3000))));
        const onProgress = typeof input?.onProgress === 'function' ? input.onProgress : () => {};
        const shouldCancel = typeof input?.shouldCancel === 'function' ? input.shouldCancel : () => false;
        const yieldControl = typeof input?.yieldControl === 'function' ? input.yieldControl : sleepTurn;
        if (!targetIds.length || targetIds.length > 4) {
            return { strength: '输入无效', routes: [], noResultReason: '请选择 1–4 条目标紫脉。' };
        }

        const engine = new root.WashSourceEngine.Engine(talentData, input.initialState || {}, {
            dlcMode: !!input.dlcMode,
            eligibleTalentIds: input.eligibleTalentIds,
            saveChannel: input.initialState?.save_channel || '',
        });
        const unavailable = targetIds.filter(id => !engine.allowed.has(id));
        if (unavailable.length) {
            return { strength: '输入无效', routes: [], noResultReason: `当前人物或四脉资质不可用目标：${unavailable.map(id => engine.name(id)).join('、')}` };
        }

        const startState = engine.initialState(input.initialState || {});
        const initialSlotCount = Math.max(0, Math.min(4, numeric(startState.zizhi, numeric(input.initialState?.zizhi, 154)) - 150));
        const {
            maxEventNodes,
            maxMainRawWashes,
            maxTailRawWashes,
            maxEventDepth,
            estimatedTargetCost,
            maxFinalTailExchangeDepth,
            maxExchangePreviewDepth,
            maxSparseTargetGap,
            maxSparseRawDraws,
            deferredInterleaveEvery,
        } = SEARCH_LIMITS;
        const scope = {
            algorithm: 'source-complete-window-destroy-tail-v025',
            implementationRevision: 'v0.2.5-complete-window-destroy',
            strategyGraph: '三槽真实起手、最近冲突脉反查、全部置换窗口保留、稀疏目标桥、毁脉临时支点、三四紫尾段独立预算',
            maxTotalPills,
            activePillCeiling: maxTotalPills,
            currentPillCost: 0,
            scanBound: 'max-total-pills',
            initialSlotCount,
            slotStagesChecked: initialSlotCount < 4 ? [initialSlotCount, 4] : [4],
            initialLuckSeedInited: startState.luckSeed != null,
            expandedNodes: 0,
            generatedNodes: 0,
            dominatedNodes: 0,
            prunedByPills: 0,
            frontierPeak: 1,
            unlockedWashesScanned: 0,
            lockedWashesScanned: 0,
            conflictAnchors: 0,
            nearestBlockerCheckpoints: 0,
            nearestBlockerReplays: 0,
            olderBlockersDiscarded: 0,
            nearestBlockerPurpleTriggers: 0,
            infiniteExchangeStarts: 0,
            targetSacrificeBranches: 0,
            targetSwapSuccesses: 0,
            maxTargetsHeld: targetsIn(startState, targetSet).length,
            targetCoverage: {},
            firstExchangePadsChecked: 0,
            exchangeWindowsScanned: 0,
            exchangeWindowsExpanded: 0,
            exchangeWindowsDeferred: 0,
            exchangeWindowsSkipped: 0,
            exchangePreviewTargetHits: 0,
            sparseExchangeWindowsDetected: 0,
            sparseExchangeWindowsExpanded: 0,
            sparseExchangeBestGap: null,
            exchangeAttempts: 0,
            exchangeSuccesses: 0,
            externalExchangeChains: 0,
            deferredTargetSacrificeNodes: 0,
            deferredNodesExpanded: 0,
            deferredInterleaves: 0,
            destroyVeinBranches: 0,
            destroyVeinExpanded: 0,
            finalTailStarts: 0,
            thirdTailCandidates: 0,
            finalTailWashes: 0,
            finalTailExchangeBranches: 0,
            upgradeBranches: 0,
            candidateCount: 0,
            frontierLimit: 0,
            maxEventNodes,
            maxMainRawWashes,
            maxTailRawWashes,
            maxRawWashes: maxMainRawWashes + maxTailRawWashes,
            maxEventDepth,
            deferredInterleaveEvery,
            rawWashesSimulated: 0,
            mainRawWashesSimulated: 0,
            tailRawWashesSimulated: 0,
            prunedByFrontier: 0,
            heuristicWeight: 1.15,
            exhaustiveWithinStrategyGraph: false,
            safetyLimitReached: false,
            mainSafetyLimitReached: false,
            tailSafetyLimitReached: false,
        };
        const ctx = {
            engine, targetIds, targetSet, initialState: input.initialState || {}, startState,
            hasBagPills: !!input.hasBagPills,
            bagPills: numeric(input.bagPills, numeric(input.initialState?.bag_pills)),
        };

        let serial = 0;
        let operations = 0;
        let lastProgressAt = 0;
        let mainNodesSinceDeferred = 0;
        const modePriority = Object.freeze({ milestone: 0, pad: 1, seek: 2, baseline: 3 });
        const priorityOf = node => {
            const held = targetsIn(node.state, targetSet).length;
            const missing = Math.max(0, targetIds.length - held);
            const tailBonus = targetIds.length >= 3 && held >= targetIds.length - 1 ? 3600 : 0;
            const firstPurpleBonus = held === 1 ? 900 : 0;
            const threeSlotBonus = numeric(node.state.zizhi, 154) === 153 && held === 0 ? 260 : 0;
            return node.cost + missing * estimatedTargetCost * scope.heuristicWeight
                - held * 520 - tailBonus - firstPurpleBonus - threeSlotBonus
                - numeric(node.importance, 0) + numeric(node.eventDepth, 0) * 3;
        };
        const costCompare = (left, right) => priorityOf(left) - priorityOf(right)
            || left.cost - right.cost
            || numeric(modePriority[left.mode], 9) - numeric(modePriority[right.mode], 9)
            || left.serial - right.serial;
        const queue = new MinHeap(costCompare);
        const deferredQueue = new MinHeap(costCompare);
        const distance = new Map();
        const candidateNodes = new Map();

        function slotCountOf(state) {
            if (typeof engine.slotCountFor === 'function') return engine.slotCountFor(numeric(state.zizhi, 154));
            return Math.max(1, Math.min(4, (state.talents || []).length || initialSlotCount || 4));
        }

        function candidateSignature(node) {
            const groups = compactActions(traceActions(node.trace));
            const route = groups.map(group => group.kind === 'wash'
                ? `w:${group.mode}:${group.keepIds.join('.')}:${group.count}`
                : (group.kind === 'exchange'
                    ? `x:${group.removedId}>${group.addedId}:${group.keepIds.join('.')}`
                    : (group.kind === 'unlock'
                        ? `r:${(group.releasedIds || []).join('.')}`
                        : 'u:4'))).join('|');
            return `${root.WashSourceEngine.stateKey(node.state)}|${route}`;
        }

        function recordCandidate(node) {
            const signature = candidateSignature(node);
            const previous = candidateNodes.get(signature);
            if (!previous || node.cost < previous.cost) candidateNodes.set(signature, node);
            scope.candidateCount = candidateNodes.size;
        }

        function report(message, force = false) {
            const now = Date.now();
            if (!force && now - lastProgressAt < 120) return;
            lastProgressAt = now;
            onProgress({
                phase: 'bounded-search',
                done: scope.expandedNodes,
                total: Math.max(1, scope.expandedNodes + queue.size + deferredQueue.size),
                expandedNodes: scope.expandedNodes,
                generatedNodes: scope.generatedNodes,
                rawWashesSimulated: scope.rawWashesSimulated,
                currentPillCost: scope.currentPillCost,
                activePillCeiling: maxTotalPills,
                maxTotalPills,
                candidateCount: scope.candidateCount,
                message,
            });
        }

        function nodeKey(state, mode, meta) {
            const protectedIds = (meta.protectedIds || []).slice();
            const carryLockedIds = (meta.carryLockedIds || []).slice();
            return [
                mode,
                protectedIds.join(','),
                carryLockedIds.join(','),
                meta.anchorKind || '-',
                meta.washedAfterAnchor ? 1 : 0,
                numeric(meta.anchorId, 0),
                numeric(meta.conflictId, 0),
                numeric(meta.destroyPivotId, 0),
                meta.deferred ? 'D' : 'P',
                root.WashSourceEngine.stateKey(state),
            ].join('|');
        }

        function enqueue(state, cost, trace, mode = 'milestone', meta = {}) {
            if (cost > maxTotalPills) {
                scope.prunedByPills += 1;
                return false;
            }
            const eventDepth = numeric(meta.eventDepth, 0);
            if (eventDepth > maxEventDepth) {
                scope.safetyLimitReached = true;
                return false;
            }
            const protectedIds = idsInStateOrder(state, meta.protectedIds || []);
            const carryLockedIds = idsInStateOrder(state, meta.carryLockedIds || []);
            const normalizedMeta = { ...meta, protectedIds, carryLockedIds, eventDepth };
            const key = nodeKey(state, mode, normalizedMeta);
            const node = {
                state, cost, trace, serial: ++serial, key, mode,
                ...normalizedMeta,
                importance: numeric(meta.importance, 0),
            };
            const heldTargets = targetsIn(state, targetSet).slice().sort((a, b) => a - b);
            scope.maxTargetsHeld = Math.max(scope.maxTargetsHeld, heldTargets.length);
            const coverageKey = heldTargets.join(',') || '-';
            const coverageCost = scope.targetCoverage[coverageKey];
            if (coverageCost == null || cost < coverageCost) scope.targetCoverage[coverageKey] = cost;

            // 完整候选先按「路线签名」收集，再做状态支配。
            // 这样不同操作序列即使抵达同一最终状态，也不会因为 distance 先命中而被静默吞掉。
            if (containsTargets(state, targetSet)) {
                scope.generatedNodes += 1;
                recordCandidate(node);
                report(`已记录 ${scope.candidateCount.toLocaleString()} 条完整候选，继续遍历其他分支`, true);
                return true;
            }

            const previous = distance.get(key);
            if (previous != null && previous <= cost) {
                scope.dominatedNodes += 1;
                return false;
            }
            distance.set(key, cost);
            scope.generatedNodes += 1;
            const destination = normalizedMeta.deferred ? deferredQueue : queue;
            destination.push(node);
            scope.frontierPeak = Math.max(scope.frontierPeak, queue.size + deferredQueue.size);
            if (normalizedMeta.deferred) scope.deferredTargetSacrificeNodes += 1;
            return true;
        }

        function noteWash(kind = 'main') {
            scope.rawWashesSimulated += 1;
            if (kind === 'tail') scope.tailRawWashesSimulated += 1;
            else scope.mainRawWashesSimulated += 1;
        }

        function mainWashBudgetAvailable() {
            return scope.mainRawWashesSimulated < maxMainRawWashes;
        }

        function tailWashBudgetAvailable() {
            return scope.tailRawWashesSimulated < maxTailRawWashes;
        }

        async function checkpoint(message, kind = 'main') {
            operations += 1;
            if (shouldCancel()) throw new Error('SEARCH_CANCELLED');
            if (kind === 'tail') {
                if (!tailWashBudgetAvailable()) {
                    scope.tailSafetyLimitReached = true;
                    scope.safetyLimitReached = true;
                    return false;
                }
            } else if (!mainWashBudgetAvailable()) {
                scope.mainSafetyLimitReached = true;
                scope.safetyLimitReached = true;
                throw new Error('SEARCH_MAIN_SAFETY_LIMIT');
            }
            if (operations % 256 === 0) {
                report(message);
                await yieldControl();
            }
            return true;
        }

        function canWash(state, lockedIds) {
            return idsInStateOrder(state, lockedIds).length < slotCountOf(state);
        }

        function canContinueAt(cost) {
            return cost <= maxTotalPills;
        }

        function targetGainImportance(state, previousCount, extra = 0) {
            const gain = Math.max(0, targetsIn(state, targetSet).length - previousCount);
            return gain * 2400 + extra;
        }

        function previewSparseLuckTargets(state) {
            const missing = targetIds.filter(id => !state.talents.includes(id));
            if (!missing.length || typeof engine.draw !== 'function') {
                return { hit: false, nearestGap: null, targetIds: [], rawDraws: 0 };
            }
            const missingSet = new Set(missing);
            const occupied = new Set(state.talents || []);
            let luck = state.luckSeed == null ? state.bornSeed : state.luckSeed;
            let rawDraws = 0;
            let visibleGap = 0;
            const hits = [];
            const seenTargets = new Set();

            // 这里只用于优先级/保留判断，不直接生成路线。
            // 按当前状态近似预览未来 Luck 紫序：允许非目标紫夹在目标之间。
            // 真正能否跨过中间紫，仍由后续真实 wash + replace() 状态机验证。
            while (rawDraws < maxSparseRawDraws && visibleGap < maxSparseTargetGap) {
                let candidate;
                [candidate, luck] = engine.draw(luck, true);
                rawDraws += 1;
                if (typeof engine.isAllowedAt === 'function' && !engine.isAllowedAt(candidate, state.zizhi)) continue;
                // 当前已占用同名紫在真实 replace() 中会被内部跳过，不计入“可见置换脉序”距离。
                if (occupied.has(candidate)) continue;
                visibleGap += 1;
                if (missingSet.has(candidate) && !seenTargets.has(candidate)) {
                    seenTargets.add(candidate);
                    hits.push({ id: candidate, gap: visibleGap, rawDraws });
                }
            }
            const nearest = hits.reduce((best, item) => !best || item.gap < best.gap ? item : best, null);
            return {
                hit: !!nearest,
                nearestGap: nearest ? nearest.gap : null,
                targetIds: hits.map(item => item.id),
                hits,
                rawDraws,
            };
        }

        function previewExchangeChainForTarget(state, lockedIds, depth = maxExchangePreviewDepth, visited = new Set()) {
            if (depth <= 0) return false;
            const orderedLocks = idsInStateOrder(state, lockedIds || []);
            const visitKey = `${root.WashSourceEngine.stateKey(state)}|${orderedLocks.join(',')}|${depth}`;
            if (visited.has(visitKey)) return false;
            visited.add(visitKey);
            const positions = engine.replaceablePositions(state, orderedLocks);
            for (const position of positions) {
                const removedId = state.talents[position];
                let exchanged;
                try {
                    exchanged = actionReplace(engine, state, position, 'preview-exchange', orderedLocks);
                } catch (_) {
                    continue;
                }
                if (targetSet.has(exchanged.action.addedId)) return true;
                const nextLocks = orderedLocks.filter(id => id !== removedId && exchanged.state.talents.includes(id));
                if (previewExchangeChainForTarget(exchanged.state, nextLocks, depth - 1, visited)) return true;
            }
            return false;
        }

        function classifyExchangeWindow(beforeState, exchanged, lockedIds) {
            const beforeTargetCount = targetsIn(beforeState, targetSet).length;
            const afterTargetCount = targetsIn(exchanged.state, targetSet).length;
            const addedTarget = targetSet.has(exchanged.action.addedId);
            const removedTarget = targetSet.has(exchanged.action.removedId);
            const nextLocks = idsInStateOrder(exchanged.state,
                (lockedIds || []).filter(id => id !== exchanged.action.removedId));
            const chainCanReachTarget = previewExchangeChainForTarget(exchanged.state, nextLocks);
            if (chainCanReachTarget) scope.exchangePreviewTargetHits += 1;

            // v0.2.4：目标紫在 Luck/置换脉序中不要求相邻。
            // 例如「混元 → 不灭 → 神力 → 拳脚 → 顶天」：中间三紫没有即时目标收益，
            // 但只要固定 Luck 序列在近距离仍存在缺失目标，就不能把这些中继状态一律降级成垃圾分支。
            const sparse = previewSparseLuckTargets(exchanged.state);
            const immediateProductive = addedTarget || afterTargetCount > beforeTargetCount || chainCanReachTarget;
            const sparseProductive = !immediateProductive && sparse.hit;
            if (sparseProductive) {
                scope.sparseExchangeWindowsDetected += 1;
                if (scope.sparseExchangeBestGap == null || sparse.nearestGap < scope.sparseExchangeBestGap) {
                    scope.sparseExchangeBestGap = sparse.nearestGap;
                }
            }
            return {
                addedTarget,
                removedTarget,
                afterTargetCount,
                productive: immediateProductive || sparseProductive,
                immediateProductive,
                sparseProductive,
                sparseTargetGap: sparse.nearestGap,
                sparseTargetIds: sparse.targetIds,
                chainCanReachTarget,
                nextLocks,
            };
        }

        function directExchangeBranches(state, cost, trace, lockedIds, meta = {}) {
            const orderedLocks = idsInStateOrder(state, lockedIds || []);
            const positions = engine.replaceablePositions(state, orderedLocks);
            if (!positions.length) return 0;
            let generated = 0;
            for (const position of positions) {
                scope.exchangeAttempts += 1;
                const exchanged = actionReplace(engine, state, position, 'direct-exchange', orderedLocks);
                scope.exchangeSuccesses += 1;
                const window = classifyExchangeWindow(state, exchanged, orderedLocks);
                if (window.removedTarget) scope.targetSacrificeBranches += 1;
                if (window.removedTarget && window.addedTarget) scope.targetSwapSuccesses += 1;
                if (meta.fromExchange) scope.externalExchangeChains += 1;

                // v0.2.3：先处理能直接取得目标、或当前置换链继续可达目标的窗口。
                // 仅改变 TalLucky / Luck 而暂时没有目标价值的置换不删除，而是放进延后队列，
                // 避免它们在低成本主线尚未跑完前吃掉全局 wash 安全预算。
                const deferred = !window.productive;
                const sparseBonus = window.sparseProductive
                    ? Math.max(650, 2300 - numeric(window.sparseTargetGap, maxSparseTargetGap) * 210)
                    : 0;
                if (window.sparseProductive) scope.sparseExchangeWindowsExpanded += 1;
                enqueue(exchanged.state, cost, traceAppend(trace, exchanged.action), 'milestone', {
                    eventDepth: numeric(meta.eventDepth, 0) + 1,
                    importance: window.addedTarget ? 3200
                        : (window.immediateProductive ? 2300 : (window.sparseProductive ? sparseBonus : 180)),
                    carryLockedIds: window.nextLocks,
                    fromExchange: true,
                    deferred,
                    sparseBridgeTargetIds: window.sparseTargetIds,
                    sparseBridgeGap: window.sparseTargetGap,
                });
                generated += 1;
            }
            return generated;
        }

        function seekOpportunity(state, node, washedAfterAnchor) {
            if (!state.talents.includes(node.anchorId)
                || node.protectedIds.some(id => !state.talents.includes(id))) return null;
            const anchorPosition = state.talents.indexOf(node.anchorId);
            const lockedIds = idsInStateOrder(state, [...node.protectedIds, node.anchorId]);
            if (lockedIds.length >= slotCountOf(state)) return null;
            const replaceable = engine.replaceablePositions(state, lockedIds);
            let sourcePosition = -1;
            let conflictId = null;
            if (node.anchorKind === 'ordinary' && washedAfterAnchor) {
                sourcePosition = replaceable.find(position => position > anchorPosition
                    && engine.quality(state.talents[position]) === 4
                    && !engine.isShenmai(state.talents[position])
                    && engine.talentType(state.talents[position]) === engine.talentType(node.anchorId)) ?? -1;
                conflictId = node.anchorId;
            } else if (node.anchorKind === 'shenmai' && replaceable.includes(anchorPosition)) {
                sourcePosition = anchorPosition;
                conflictId = state.talents.find((id, index) => index !== anchorPosition && engine.isShenmai(id));
            }
            return { lockedIds, sourcePosition, conflictId };
        }

        function enqueuePadOpportunity(state, cost, trace, node, washedAfterAnchor, importance = 420) {
            const opportunity = seekOpportunity(state, node, washedAfterAnchor);
            if (!opportunity || opportunity.sourcePosition < 0) return false;
            const sourceId = state.talents[opportunity.sourcePosition];
            scope.conflictAnchors += 1;
            if (node.protectedIds.length === 1) scope.infiniteExchangeStarts += 1;
            if (targetSet.has(sourceId)) scope.targetSacrificeBranches += 1;
            enqueue(state, cost, trace, 'pad', {
                protectedIds: node.protectedIds,
                anchorId: sourceId,
                conflictId: opportunity.conflictId,
                anchorKind: node.anchorKind,
                eventDepth: node.eventDepth,
                importance: importance + (targetSet.has(sourceId) ? 1100 : 0),
            });
            return true;
        }

        function generatedPurpleIds(state, keepIds) {
            const kept = new Set((keepIds || []).map(Number));
            return state.talents.filter(id => !kept.has(id) && engine.quality(id) === 4);
        }

        function rememberNearestBlockers(nearestByType, state, cost, trace, protectedIds, scanStep) {
            const orderedProtected = idsInStateOrder(state, protectedIds || []);
            if (orderedProtected.length + 1 >= slotCountOf(state)) return;
            const byType = new Map();
            for (const anchorId of state.talents) {
                if (orderedProtected.includes(anchorId)) continue;
                if (!engine.hasOrdinaryPurpleSuccessor(anchorId)) continue;
                const type = engine.talentType(anchorId);
                if (!byType.has(type)) byType.set(type, []);
                byType.get(type).push(anchorId);
            }
            for (const [type, anchorIds] of byType.entries()) {
                const previous = nearestByType.get(type);
                if (previous && previous.scanStep < scanStep) {
                    scope.olderBlockersDiscarded += previous.anchors.length;
                }
                nearestByType.set(type, {
                    scanStep,
                    anchors: anchorIds.map(anchorId => ({
                        state: root.WashSourceEngine.cloneState(state),
                        cost,
                        trace,
                        protectedIds: orderedProtected.slice(),
                        anchorId,
                    })),
                });
                scope.nearestBlockerCheckpoints += anchorIds.length;
            }
        }

        function enqueueNearestBlockerReplays(nearestByType, generatedPurples, scanStep, eventDepth) {
            let generated = 0;
            for (const purpleId of generatedPurples) {
                if (engine.isShenmai(purpleId)) continue;
                const nearest = nearestByType.get(engine.talentType(purpleId));
                if (!nearest || nearest.scanStep >= scanStep) continue;
                scope.nearestBlockerPurpleTriggers += 1;
                const gap = Math.max(1, scanStep - nearest.scanStep);
                for (const checkpoint of nearest.anchors) {
                    const enqueued = enqueue(checkpoint.state, checkpoint.cost, checkpoint.trace, 'seek', {
                        protectedIds: checkpoint.protectedIds,
                        anchorId: checkpoint.anchorId,
                        anchorKind: 'ordinary',
                        washedAfterAnchor: false,
                        eventDepth,
                        importance: 900 + (targetSet.has(purpleId) ? 900 : 0) + Math.max(0, 240 - gap * 12),
                        triggerPurpleId: purpleId,
                        triggerGap: gap,
                    });
                    if (enqueued) {
                        scope.nearestBlockerReplays += 1;
                        generated += 1;
                    }
                }
            }
            return generated;
        }

        function enqueueFinalTailExchangeBranches(state, cost, trace, lockedTargetIds, node) {
            const orderedLocks = idsInStateOrder(state, lockedTargetIds || []);
            const lockedSet = new Set(orderedLocks);
            const positions = engine.replaceablePositions(state, orderedLocks)
                // 尾脉专用分支固定保留前三紫；只允许置换第四个活动槽。
                .filter(position => !lockedSet.has(state.talents[position]));
            if (!positions.length) return 0;
            let generated = 0;
            for (const position of positions) {
                if (numeric(node.eventDepth, 0) >= maxFinalTailExchangeDepth) {
                    scope.safetyLimitReached = true;
                    break;
                }
                scope.exchangeAttempts += 1;
                scope.finalTailExchangeBranches += 1;
                const exchanged = actionReplace(engine, state, position, 'final-tail-exchange', orderedLocks);
                scope.exchangeSuccesses += 1;
                const nextTrace = traceAppend(trace, exchanged.action);
                enqueue(exchanged.state, cost, nextTrace, 'milestone', {
                    eventDepth: numeric(node.eventDepth, 0) + 1,
                    importance: targetSet.has(exchanged.action.addedId) ? 5200 : 3600,
                    carryLockedIds: orderedLocks,
                    fromExchange: true,
                    finalTailOrigin: true,
                });
                generated += 1;
            }
            return generated;
        }

        async function processFinalTail(node) {
            scope.finalTailStarts += 1;
            let state = node.state;
            let cost = node.cost;
            let trace = node.trace;
            let lockedTargets = idsInStateOrder(state, targetsIn(state, targetSet));

            // 三槽已经锁满三条目标时，第四紫必然先开第四槽；开槽本身不推进 RNG。
            if (slotCountOf(state) < 4) {
                const upgraded = actionUpgrade(engine, state);
                scope.upgradeBranches += 1;
                trace = traceAppend(trace, upgraded.action);
                state = upgraded.state;
                lockedTargets = idsInStateOrder(state, lockedTargets);
            }

            // 当前活动槽如果已经形成天然神脉冲突，先把「置换 / 不置换」都保留下来。
            enqueueFinalTailExchangeBranches(state, cost, trace, lockedTargets, node);

            while (true) {
                if (!canWash(state, lockedTargets)) break;
                if (!tailWashBudgetAvailable()) {
                    scope.tailSafetyLimitReached = true;
                    scope.safetyLimitReached = true;
                    break;
                }
                const next = actionWash(engine, state, lockedTargets, 'final-tail');
                if (!canContinueAt(cost + next.action.cost)) {
                    scope.prunedByPills += 1;
                    break;
                }
                cost += next.action.cost;
                noteWash('tail');
                scope.finalTailWashes += 1;
                scope.lockedWashesScanned += 1;
                trace = traceAppend(trace, next.action);
                state = next.state;

                if (containsTargets(state, targetSet)) {
                    enqueue(state, cost, trace, 'milestone', {
                        eventDepth: numeric(node.eventDepth, 0) + 1,
                        importance: 6200,
                        carryLockedIds: lockedTargets,
                        finalTailOrigin: true,
                    });
                    // 同一条「前三紫固定、完全不置换」直线在第一次命中第四紫后，
                    // 再故意洗掉目标只会得到严格更贵的同类路线，因此本直线到此结束。
                    break;
                }

                // 第四槽可能通过九阴/玄阳/混元互冲形成合法置换入口；
                // 每个真实 landing 会进入 milestone，下一轮可选择继续置换或停止后再洗。
                enqueueFinalTailExchangeBranches(state, cost, trace, lockedTargets, node);
                if (!(await checkpoint('正在锁定前三紫完整扫描第四紫尾脉与天然置换入口', 'tail'))) break;
            }
        }

        async function processNode(node) {
            if (node.mode === 'milestone') {
                const currentTargets = targetsIn(node.state, targetSet);
                const carryLocks = node.carryLockedIds || [];
                directExchangeBranches(node.state, node.cost, node.trace,
                    carryLocks.length ? carryLocks : currentTargets,
                    { eventDepth: node.eventDepth, fromExchange: !!node.fromExchange });

                // 四紫模式在已经固定三条目标后切到专用尾脉扫描。
                // 这一阶段不再建立普通 blocker 搜索，因为三条紫锁定后只剩一个活动槽；
                // 仍保留原始紫直接命中、神脉天然冲突、Xraw 重复内跳与外部连续置换。
                if (targetIds.length === 4 && currentTargets.length === 3) {
                    await processFinalTail(node);
                    return;
                }

                const currentZiZhi = numeric(node.state.zizhi, 154);
                if (currentZiZhi < 153) {
                    const upgraded = actionUpgrade(engine, node.state);
                    scope.upgradeBranches += 1;
                    enqueue(upgraded.state, node.cost, traceAppend(node.trace, upgraded.action), 'milestone', {
                        eventDepth: node.eventDepth + 1,
                        importance: 2200,
                    });
                    return;
                }
                if (currentZiZhi === 153 && currentTargets.length) {
                    const upgraded = actionUpgrade(engine, node.state);
                    scope.upgradeBranches += 1;
                    enqueue(upgraded.state, node.cost, traceAppend(node.trace, upgraded.action), 'milestone', {
                        eventDepth: node.eventDepth + 1,
                        importance: 1900 + currentTargets.length * 400,
                    });
                }

                if (node.fromExchange && currentTargets.length === 1 && node.state.luckSeed != null) {
                    const releasedId = currentTargets[0];
                    const unlocked = actionUnlock(node.state, [releasedId]);
                    scope.destroyVeinBranches += 1;
                    if (enqueue(unlocked.state, node.cost, traceAppend(node.trace, unlocked.action), 'baseline', {
                        protectedIds: [],
                        eventDepth: node.eventDepth + 1,
                        importance: 520,
                        deferred: true,
                        destroyPivotId: releasedId,
                    })) {
                        scope.destroyVeinExpanded += 1;
                    }
                }

                enqueue(node.state, node.cost, node.trace, 'baseline', {
                    protectedIds: currentTargets,
                    eventDepth: node.eventDepth,
                    importance: node.importance,
                });
                return;
            }

            if (node.mode === 'baseline') {
                let state = node.state;
                let cost = node.cost;
                let trace = node.trace;
                let scanStep = 0;
                const startingTargetCount = node.protectedIds.length;
                const nearestBlockers = new Map();

                // 里程碑本身可能是「目标紫 + 有价值冲突脉」同屏；先把当前槽面作为第 0 步检查点。
                rememberNearestBlockers(nearestBlockers, state, cost, trace, node.protectedIds, scanStep);

                while (true) {
                    if (node.protectedIds.some(id => !state.talents.includes(id))) break;
                    if (!canWash(state, node.protectedIds)) break;
                    const next = actionWash(engine, state, node.protectedIds,
                        node.protectedIds.length ? 'scan-targets' : 'scan-unlocked');
                    if (!canContinueAt(cost + next.action.cost)) {
                        scope.prunedByPills += 1;
                        break;
                    }
                    cost += next.action.cost;
                    noteWash('main');
                    trace = traceAppend(trace, next.action);
                    state = next.state;
                    scanStep += 1;
                    if (node.protectedIds.length) scope.lockedWashesScanned += 1;
                    else scope.unlockedWashesScanned += 1;

                    const generatedPurples = generatedPurpleIds(state, next.action.keepIds);
                    // 先用「之前最近一次」的 blocker 反查当前紫；本次同屏 blocker 不能倒序用于当前紫。
                    enqueueNearestBlockerReplays(nearestBlockers, generatedPurples, scanStep, node.eventDepth);

                    const nextTargets = targetsIn(state, targetSet);
                    if (nextTargets.length > startingTargetCount) {
                        if (targetIds.length === 4 && startingTargetCount === 2 && nextTargets.length === 3) {
                            // 第三紫每一次真实出现都立即独立验证第四紫；尾段验证结束后，本锁二主线继续向后扫描。
                            scope.thirdTailCandidates += 1;
                            await processFinalTail({
                                state,
                                cost,
                                trace,
                                eventDepth: node.eventDepth + 1,
                            });
                        } else {
                            enqueue(state, cost, trace, 'milestone', {
                                eventDepth: node.eventDepth + 1,
                                importance: targetGainImportance(state, startingTargetCount, 900),
                            });
                        }
                    }

                    directExchangeBranches(state, cost, trace,
                        nextTargets.length > startingTargetCount ? nextTargets : node.protectedIds,
                        { eventDepth: node.eventDepth, fromExchange: false });

                    // 当前洗脉结束后再更新最近 blocker，供下一次及更后的紫脉事件使用。
                    rememberNearestBlockers(nearestBlockers, state, cost, trace, node.protectedIds, scanStep);

                    await checkpoint(nextTargets.length >= targetIds.length - 1 && targetIds.length >= 3
                        ? '正在保留第三紫各出现点并验证第四紫尾脉'
                        : '正在前推原始脉序并反查最近合法冲突脉');
                }
                return;
            }

            if (node.mode === 'seek') {
                let state = node.state;
                let cost = node.cost;
                let trace = node.trace;
                let washedAfterAnchor = !!node.washedAfterAnchor;
                const startingTargetCount = targetsIn(node.state, targetSet).length;
                while (true) {
                    const opportunity = seekOpportunity(state, node, washedAfterAnchor);
                    if (!opportunity) break;
                    if (enqueuePadOpportunity(state, cost, trace, node, washedAfterAnchor)) break;
                    if (!canWash(state, opportunity.lockedIds)) break;
                    const next = actionWash(engine, state, opportunity.lockedIds, 'seek-purple');
                    if (!canContinueAt(cost + next.action.cost)) {
                        scope.prunedByPills += 1;
                        break;
                    }
                    cost += next.action.cost;
                    noteWash('main');
                    scope.lockedWashesScanned += 1;
                    trace = traceAppend(trace, next.action);
                    state = next.state;
                    washedAfterAnchor = true;
                    const currentTargetCount = targetsIn(state, targetSet).length;
                    if (currentTargetCount > startingTargetCount) {
                        enqueue(state, cost, trace, 'milestone', {
                            eventDepth: node.eventDepth + 1,
                            importance: targetGainImportance(state, startingTargetCount, 800),
                        });
                    }
                    directExchangeBranches(state, cost, trace, opportunity.lockedIds, {
                        eventDepth: node.eventDepth,
                        fromExchange: false,
                    });
                    await checkpoint('正在锁住最近冲突脉寻找待置换紫脉');
                }
                return;
            }

            if (node.mode === 'pad') {
                let state = node.state;
                let cost = node.cost;
                let trace = node.trace;
                const startingTargetCount = targetsIn(node.state, targetSet).length;
                while (true) {
                    const keepIds = idsInStateOrder(state, [...node.protectedIds, node.conflictId, node.anchorId]);
                    const position = state.talents.indexOf(node.anchorId);
                    if (keepIds.some(id => !state.talents.includes(id))) break;
                    if (position >= 0 && engine.replaceablePositions(state, keepIds).includes(position)) {
                        scope.exchangeAttempts += 1;
                        scope.exchangeWindowsScanned += 1;
                        const exchanged = actionReplace(engine, state, position, 'conflict-exchange', keepIds);
                        scope.exchangeSuccesses += 1;
                        const window = classifyExchangeWindow(state, exchanged, keepIds);
                        if (window.removedTarget) scope.targetSacrificeBranches += 1;
                        if (window.removedTarget && window.addedTarget) scope.targetSwapSuccesses += 1;

                        const deferred = !window.productive;
                        if (deferred) scope.exchangeWindowsDeferred += 1;
                        const sparseBonus = window.sparseProductive
                            ? Math.max(700, 3000 - numeric(window.sparseTargetGap, maxSparseTargetGap) * 150)
                            : 0;
                        if (window.sparseProductive) scope.sparseExchangeWindowsExpanded += 1;
                        const enqueued = enqueue(exchanged.state, cost, traceAppend(trace, exchanged.action), 'milestone', {
                            eventDepth: node.eventDepth + 1,
                            importance: window.addedTarget ? 3600
                                : (window.immediateProductive ? 2700
                                    : (window.sparseProductive ? sparseBonus
                                        : (window.removedTarget ? 420 : 260))),
                            carryLockedIds: window.nextLocks,
                            fromExchange: true,
                            deferred,
                            sparseBridgeTargetIds: window.sparseTargetIds,
                            sparseBridgeGap: window.sparseTargetGap,
                        });
                        if (enqueued) scope.exchangeWindowsExpanded += 1;
                    }
                    if (!canWash(state, keepIds)) break;
                    const next = actionWash(engine, state, keepIds, 'pad-exchange');
                    if (!canContinueAt(cost + next.action.cost)) {
                        scope.prunedByPills += 1;
                        break;
                    }
                    cost += next.action.cost;
                    noteWash('main');
                    scope.lockedWashesScanned += 1;
                    scope.firstExchangePadsChecked += 1;
                    trace = traceAppend(trace, next.action);
                    state = next.state;
                    const currentTargetCount = targetsIn(state, targetSet).length;
                    if (currentTargetCount > startingTargetCount) {
                        enqueue(state, cost, trace, 'milestone', {
                            eventDepth: node.eventDepth + 1,
                            importance: targetGainImportance(state, startingTargetCount, 750),
                        });
                    }
                    await checkpoint('正在扫描无穷置换窗口；所有合法窗口均保留，目标窗口优先展开');
                }
            }
        }

        function buildResult() {
            const routes = Array.from(candidateNodes.values())
                .map(node => routeFromNode(ctx, node))
                .sort((left, right) => left.totalPills - right.totalPills
                    || left.totalWashes - right.totalWashes
                    || left.exchangeCount - right.exchangeCount
                    || left.steps.length - right.steps.length
                    || String(left.branchId).localeCompare(String(right.branchId)));

            return {
                strength: routes.length
                    ? (scope.exhaustiveWithinStrategyGraph ? '源码精确回放候选（v0.2.5 战术图已遍历完成）' : '源码精确回放候选（v0.2.5 扩展安全上限内）')
                    : (scope.exhaustiveWithinStrategyGraph ? 'v0.2.5 战术图完整遍历未找到路线' : 'v0.2.5 战术图扩展安全上限搜索'),
                objective: ['total_pills', 'total_washes', 'exchange_count', 'step_count'],
                targetIds,
                targetNames: targetIds.map(id => engine.name(id)),
                searchScope: scope,
                routes,
                noResultReason: routes.length ? ''
                    : `在不超过 ${maxTotalPills.toLocaleString()} 丹的 v0.2.5 战术图内未找到完整路线${scope.safetyLimitReached ? '；搜索触及主搜索/尾脉/状态深度安全上限，结果不是完整穷尽。' : '。'}`,
            };
        }

        try {
            onProgress({ phase: 'worker-start', done: 0, total: 1, message: '正在初始化三槽/四槽源码一致洗脉状态机' });
            enqueue(startState, 0, null, 'milestone');
            report(`最大耗丹 ${maxTotalPills.toLocaleString()}：从当前 ${initialSlotCount} 槽状态开始完整前推`, true);
            while ((queue.size || deferredQueue.size) && scope.expandedNodes < maxEventNodes) {
                let fromDeferred = false;
                if (!queue.size) {
                    fromDeferred = true;
                } else if (deferredQueue.size) {
                    const mainNode = queue.peek();
                    const rescueNode = deferredQueue.peek();
                    const rescueCompetitive = priorityOf(rescueNode) <= priorityOf(mainNode) + 450;
                    const rescueWaited = mainNodesSinceDeferred >= deferredInterleaveEvery;
                    fromDeferred = rescueCompetitive || rescueWaited;
                }
                const activeQueue = fromDeferred ? deferredQueue : queue;
                const node = activeQueue.pop();
                if (fromDeferred) {
                    mainNodesSinceDeferred = 0;
                    scope.deferredInterleaves += 1;
                } else {
                    mainNodesSinceDeferred += 1;
                }
                if (distance.get(node.key) !== node.cost) continue;
                if (node.cost > maxTotalPills) continue;
                scope.currentPillCost = node.cost;
                scope.expandedNodes += 1;
                if (fromDeferred) scope.deferredNodesExpanded += 1;
                await processNode(node);
                report(`关键状态 ${scope.expandedNodes.toLocaleString()}，模拟洗脉 ${scope.rawWashesSimulated.toLocaleString()}（主 ${scope.mainRawWashesSimulated.toLocaleString()} / 尾 ${scope.tailRawWashesSimulated.toLocaleString()}），主队列 ${queue.size.toLocaleString()}，救援 ${deferredQueue.size.toLocaleString()}，毁脉 ${scope.destroyVeinExpanded.toLocaleString()}，稀疏桥 ${scope.sparseExchangeWindowsDetected.toLocaleString()}，完整候选 ${scope.candidateCount.toLocaleString()}`);
                await checkpoint('正在继续遍历其余可达路线');
            }
            if (queue.size || deferredQueue.size) scope.safetyLimitReached = true;
            scope.exhaustiveWithinStrategyGraph = !queue.size && !deferredQueue.size && !scope.safetyLimitReached;
            return buildResult();
        } catch (error) {
            if (error && error.message === 'SEARCH_CANCELLED') return { cancelled: true, routes: [], searchScope: scope };
            if (error && error.message === 'SEARCH_MAIN_SAFETY_LIMIT') {
                scope.mainSafetyLimitReached = true;
                scope.safetyLimitReached = true;
                scope.exhaustiveWithinStrategyGraph = false;
                return buildResult();
            }
            throw error;
        }
    }

    root.WashSourceOptimizer = Object.freeze({ searchWashRoutes, MinHeap, compactActions });
})(typeof window !== 'undefined' ? window : globalThis);
