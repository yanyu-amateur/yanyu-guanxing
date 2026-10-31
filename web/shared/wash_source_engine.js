(function (root) {
    'use strict';

    const MAX_RANDOM = 2047483645;
    const WHALE_MASK48 = (1n << 48n) - 1n;
    const WHALE_MULTIPLIER = 0x5deece66dn;
    const WHALE_INCREMENT = 0xbn;
    const QUALITY_WEIGHT = Object.freeze({ 1: 560, 2: 374, 3: 64, 4: 2 });
    const PITY = 900;
    const SLOT_COUNT = 4;

    const APK_TALENT_INSERTION_ORDER = Object.freeze([
        ...range(170, 211), ...range(230, 254), 400, 401, ...range(255, 280),
        ...range(281, 285), ...range(402, 420),
        290, 297, 298, 291, 299, 300, 292, 295, 296, 293, 301, 302, 294,
        ...range(303, 317), 332, ...range(318, 331), ...range(333, 370),
    ].map(String));

    function range(start, end) {
        const result = [];
        for (let value = start; value <= end; value++) result.push(value);
        return result;
    }

    function u32(value) {
        return value >>> 0;
    }

    function rol(value, bits) {
        return u32((value << bits) | (value >>> (32 - bits)));
    }

    function getU32(bytes, start) {
        return u32(bytes[start]
            | (bytes[start + 1] << 8)
            | (bytes[start + 2] << 16)
            | (bytes[start + 3] << 24));
    }

    function stringHash(text) {
        const bytes = new TextEncoder().encode(String(text));
        const length = bytes.length;
        let hash = length;
        let a;
        let b;
        if (length >= 4) {
            a = getU32(bytes, 0);
            hash = u32(hash ^ getU32(bytes, length - 4));
            b = getU32(bytes, (length >>> 1) - 2);
            hash = u32(hash ^ b);
            hash = u32(hash - rol(b, 14));
            b = u32(b + getU32(bytes, (length >>> 2) - 1));
        } else if (length > 0) {
            a = bytes[0];
            hash = u32(hash ^ bytes[length - 1]);
            b = bytes[length >>> 1];
            hash = u32(hash ^ b);
            hash = u32(hash - rol(b, 14));
        } else {
            return 0;
        }
        a = u32(a ^ hash);
        a = u32(a - rol(hash, 11));
        b = u32(b ^ a);
        b = u32(b - rol(a, 25));
        hash = u32(hash ^ b);
        hash = u32(hash - rol(b, 16));
        return hash;
    }

    class LuaNode {
        constructor() {
            this.key = null;
            this.value = false;
            this.next = null;
        }
    }

    class LuaTable {
        constructor() {
            this.nodes = [];
            this.freeTop = 0;
        }

        get mask() {
            return this.nodes.length ? this.nodes.length - 1 : 0;
        }

        main(key) {
            return stringHash(key) & this.mask;
        }

        resizeFor() {
            const keys = this.nodes.filter(node => node.value).map(node => node.key);
            const total = keys.length + 1;
            const bits = total === 1 ? 1 : Math.ceil(Math.log2(total));
            this.nodes = Array.from({ length: 1 << bits }, () => new LuaNode());
            this.freeTop = this.nodes.length;
            keys.forEach(key => this.insert(key));
        }

        insert(key) {
            if (!this.nodes.length) this.resizeFor();
            let index = this.main(key);
            let node = this.nodes[index];
            if (node.value) {
                while (true) {
                    if (this.freeTop === 0) {
                        this.resizeFor();
                        this.insert(key);
                        return;
                    }
                    this.freeTop -= 1;
                    if (this.nodes[this.freeTop].key === null) break;
                }
                const freeIndex = this.freeTop;
                const collideIndex = this.main(node.key);
                if (collideIndex !== index) {
                    let predecessor = collideIndex;
                    while (this.nodes[predecessor].next !== index) predecessor = this.nodes[predecessor].next;
                    this.nodes[predecessor].next = freeIndex;
                    const free = this.nodes[freeIndex];
                    free.value = node.value;
                    free.key = node.key;
                    free.next = node.next;
                    node.next = null;
                    node.value = false;
                    let cursor = freeIndex;
                    while (this.nodes[cursor].next !== null) {
                        const nextIndex = this.nodes[cursor].next;
                        if (this.nodes[nextIndex].value && this.main(this.nodes[nextIndex].key) === index) {
                            this.nodes[cursor].next = this.nodes[nextIndex].next;
                            this.nodes[nextIndex].next = node.next;
                            node.next = nextIndex;
                        } else {
                            cursor = nextIndex;
                        }
                    }
                } else {
                    const free = this.nodes[freeIndex];
                    free.next = node.next;
                    node.next = freeIndex;
                    index = freeIndex;
                    node = free;
                }
            }
            node.key = key;
            node.value = true;
        }

        pairs() {
            return this.nodes.filter(node => node.value).map(node => node.key);
        }
    }

    function apkPairsOrder() {
        const table = new LuaTable();
        APK_TALENT_INSERTION_ORDER.forEach(key => table.insert(key));
        return table.pairs();
    }

    function luaRandom(seed, upper) {
        const limit = BigInt(Math.trunc(Number(upper)));
        if (limit <= 0n) throw new Error('原生随机数上限必须大于 0');
        const seed32 = BigInt.asUintN(32, BigInt(Math.trunc(Number(seed))));
        let state = ((seed32 << 16n) | 0x330en) & WHALE_MASK48;
        state = (state * WHALE_MULTIPLIER + WHALE_INCREMENT) & WHALE_MASK48;
        const raw = state >> 17n;
        return Number(raw % limit) + 1;
    }

    function weightedDraw(seed, weights, roleId, salt) {
        const total = weights.reduce((sum, value) => sum + value, 0);
        const nextSeed = luaRandom(Number(seed) + total + Number(roleId) + Number(salt), MAX_RANDOM);
        const point = nextSeed % total + 1;
        let cumulative = 0;
        for (let index = 0; index < weights.length; index++) {
            cumulative += weights[index];
            if (point <= cumulative) return [index, nextSeed];
        }
        throw new Error('源码权重抽取越界');
    }

    function numeric(value, fallback = 0) {
        const result = Number(value);
        return Number.isFinite(result) ? result : fallback;
    }

    function normalizeLimit(config, name) {
        if (config && config.limits && Object.prototype.hasOwnProperty.call(config.limits, name)) {
            return config.limits[name];
        }
        return config ? config[name] : undefined;
    }

    function allowed(config, source, zi) {
        if (!numeric(config && config.weight)) return false;
        const vipLimit = normalizeLimit(config, 'vip_limit');
        if (vipLimit != null && numeric(vipLimit) > source.vip) return false;
        const charLimit = normalizeLimit(config, 'char_limit');
        if (charLimit != null
            && !(numeric(charLimit) === 101 && source.roleId === 1)
            && numeric(charLimit) !== source.roleId) return false;
        const sexLimit = normalizeLimit(config, 'sex_limit');
        if (sexLimit != null && numeric(sexLimit) !== source.sex) return false;
        const zzLimit = normalizeLimit(config, 'zz_limit');
        if (zzLimit != null) {
            if (Array.isArray(zzLimit)) {
                if (!zzLimit.slice(0, 4).map(Number).includes(zi)) return false;
            } else if (numeric(zzLimit) !== zi) return false;
        }
        const parLimit = normalizeLimit(config, 'par_limit');
        if (Array.isArray(parLimit) && source.globalVars[String(parLimit[0])] !== parLimit[1]) return false;
        const levelLimit = normalizeLimit(config, 'lv_limit');
        if (levelLimit != null && source.roleLevel > numeric(levelLimit)) return false;
        // 角色属性门槛（如 sx_limit: ["con", 60] = 根骨≥60）：不达标则排除，不抛错中断初始化
        const sxLimit = normalizeLimit(config, 'sx_limit');
        if (Array.isArray(sxLimit) && sxLimit.length >= 2) {
            const cur = numeric(source.roleStats ? source.roleStats[String(sxLimit[0])] : 0);
            if (cur < numeric(sxLimit[1])) return false;
        }
        return true;
    }

    // —— 默认结构性钩子（现行先行服/正式服算法）——
    // 未来版本若改变保底判定 / 欧气种子初始化 / 计数器步进 / 紫脉累加规则，
    // 只需传入对应 hook 覆盖默认实现，wash() 主体无需改动（可插拔核心）
    function defaultPityActive(ctx) { return ctx.pity > 0 && ctx.luckyBefore >= ctx.pity; }
    function defaultSeedLuck(state) { return state.luckSeed == null ? state.bornSeed : state.luckSeed; }
    function defaultSaltOffset(ctx) { return ctx.advance ? ctx.bornRC : 0; }
    function defaultAdvanceRc(ctx) { return ctx.advance ? ctx.bornRC + 1 : ctx.bornRC; }
    function defaultTalLuckyAfter(ctx) { return ctx.newPurple ? 0 : ctx.luckyBefore + ctx.need; }

    function cloneState(state) {
        return {
            bornSeed: numeric(state.bornSeed),
            luckSeed: state.luckSeed == null ? null : numeric(state.luckSeed),
            bornRC: numeric(state.bornRC),
            talLucky: numeric(state.talLucky),
            talents: (state.talents || []).map(Number),
        };
    }

    function stateKey(state) {
        return `${state.bornSeed}|${state.luckSeed == null ? '-' : state.luckSeed}|${numeric(state.bornRC)}|${state.talLucky}|${state.talents.join(',')}`;
    }

    class Engine {
        constructor(talentData, initialState, options = {}) {
            this.source = {
                vip: numeric(initialState.vip, 1),
                roleId: numeric(initialState.role_id),
                salt: numeric(initialState.salt) % 1000000,
                sex: numeric(initialState.sex, 1),
                roleLevel: numeric(initialState.role_level, 90),
                roleStats: initialState.role_stats || {},
                globalVars: initialState.global_vars || {},
            };
            const ordered = apkPairsOrder()
                .map(key => talentData[String(key)])
                .filter(item => item && numeric(item.weight));
            if (ordered.length !== 114) {
                throw new Error(`天赋数据快照不一致：预期 114 条，实际 ${ordered.length} 条`);
            }
            this.config = new Map(ordered.map(item => [numeric(item.id), item]));
            this.allIds = ordered.map(item => numeric(item.id));
            // qualityWeight 可覆盖：未来版本若改变「品质→权重」映射（如 1/2/3/4 的权重表变了），
            // 通过 options.qualityWeight 传入即可，无需改 wash() 主体
            this.qualityWeight = (options.qualityWeight && typeof options.qualityWeight === 'object')
                ? options.qualityWeight : QUALITY_WEIGHT;
            this.allWeights = ordered.map(item => Number(this.qualityWeight[numeric(item.weight)]) || numeric(item.weight));
            const purples = ordered.filter(item => numeric(item.weight) === 4);
            this.purpleIds = purples.map(item => numeric(item.id));
            this.purpleWeights = purples.map(() => 2);
            // —— 先行服（新算法）可选项 ——
            // 全部默认为「现状值」，不传则行为与改动前逐位一致（正式服零影响）。
            this.slotCount = Number.isFinite(Number(options.slotCount)) ? Number(options.slotCount) : SLOT_COUNT;
            this.pity = Number.isFinite(Number(options.pity)) ? Number(options.pity) : PITY;
            // 每洗丹耗基数：来自 ZZ_DATA[zizhi].eat_xisui（如 154→5、152→2、153→3）。
            // 不传则默认 5（=改动前写死值，对 154 资质逐位一致，正式服零回归）。
            this.eat = Number.isFinite(Number(options.eat)) ? Number(options.eat) : 5;
            this.eligibleZi = Number.isFinite(Number(options.eligibleZi)) ? Number(options.eligibleZi) : 154;
            this.advancePerDraw = !!options.advancePerDraw;
            const eligibleTalentIds = Array.isArray(options.eligibleTalentIds)
                ? options.eligibleTalentIds.map(Number).filter(id => id > 0)
                : null;
            this.allowed = eligibleTalentIds
                ? new Set(eligibleTalentIds.filter(id => this.config.has(id)))
                : new Set(ordered.filter(item => allowed(item, this.source, this.eligibleZi)).map(item => numeric(item.id)));
            // —— 结构性钩子：未来版本若改变保底判定 / 计数器步进 / 欧气种子初始化 / 累加规则，
            //    只需传入对应 hook 覆盖默认实现，wash() 主体无需改动（可插拔核心）——
            const hooks = (options.hooks && typeof options.hooks === 'object') ? options.hooks : {};
            this.hooks = {
                pityActive: hooks.pityActive || defaultPityActive,
                seedLuck: hooks.seedLuck || defaultSeedLuck,
                saltOffset: hooks.saltOffset || defaultSaltOffset,
                advanceRc: hooks.advanceRc || defaultAdvanceRc,
                talLuckyAfter: hooks.talLuckyAfter || defaultTalLuckyAfter,
            };
            this.dlcMode = !!options.dlcMode;
            const channel = String(options.saveChannel || initialState.save_channel || initialState.channel || '').trim().toLowerCase();
            this.international = options.international != null
                ? !!options.international
                : (channel === '国际服' || channel === '國際服' || channel === 'oversea' || channel === 'international');
        }

        initialState(raw) {
            return {
                bornSeed: numeric(raw.seed),
                luckSeed: raw.luck_seed_inited ? numeric(raw.luck_seed) : null,
                bornRC: numeric(raw.born_talent_rc != null ? raw.born_talent_rc : raw.bornTalentRC),
                talLucky: numeric(raw.tal_lucky),
                talents: (raw.talents || []).map(item => numeric(item && item.id != null ? item.id : item)).filter(id => id > 0).slice(0, this.slotCount),
            };
        }

        quality(id) {
            return numeric(this.config.get(numeric(id))?.weight);
        }

        talentType(id) {
            const item = this.config.get(numeric(id));
            return numeric(item && item.type, numeric(id));
        }

        isShenmai(id) {
            const talentId = numeric(id);
            return talentId === 248 || talentId === 249 || talentId === 250
                || this.talentType(talentId) === 248;
        }

        hasOrdinaryPurpleSuccessor(id) {
            const talentId = numeric(id);
            if (this.quality(talentId) === 4 || this.isShenmai(talentId)) return false;
            const type = this.talentType(talentId);
            return this.purpleIds.some(candidate => this.allowed.has(candidate)
                && !this.isShenmai(candidate) && this.talentType(candidate) === type);
        }

        name(id) {
            return this.config.get(numeric(id))?.name || `天赋 #${id}`;
        }

        draw(seed, purple, saltOffset = 0) {
            const ids = purple ? this.purpleIds : this.allIds;
            const weights = purple ? this.purpleWeights : this.allWeights;
            const [index, nextSeed] = weightedDraw(seed, weights, this.source.roleId, this.source.salt + numeric(saltOffset));
            return [ids[index], nextSeed];
        }

        wash(sourceState, keepPositions) {
            const state = cloneState(sourceState);
            // 锁定顺序由场上槽位决定，调用者不能通过倒序传索引把冲突移到紫前。
            const positions=[...new Set(keepPositions.map(Number))].sort((a,b)=>a-b);
            if(positions.some(index=>!Number.isInteger(index)||index<0||index>=state.talents.length)||positions.length>this.slotCount)
                throw new Error('锁定槽位无效');
            const kept = positions.map(index => state.talents[index]);
            const need = this.slotCount - kept.length;
            const talents = kept.slice();
            let born = state.bornSeed;
            let luck = state.luckSeed;
            let bornRC = numeric(state.bornRC);
            let luckyBefore = state.talLucky;
            if (this.dlcMode) luckyBefore += Math.max(1, 3 * kept.length);
            // pity<=0 表示「无保底机制」，不能当成「永远保底」；否则只抽紫脉、槽位永远填不满 → 未收敛
            const advance = this.international || this.advancePerDraw;
            let pityActive = !!this.hooks.pityActive({ luckyBefore, pity: this.pity });
            let newPurple = false;
            let draws = 0;
            let pityPurpleId = null;                 // 新增：本次洗髓里由保底触发的紫脉
            let purpleDraws = 0;
            const generatedEvents = []; // 记录实际接受的抽取，供锚点路线按出现事件识别同名紫脉。
            while (talents.length < this.slotCount) {
                let candidate;
                let fromPity = false;
                if (pityActive) {
                    if (luck == null) luck = born;
                    [candidate, luck] = this.draw(luck, true);
                    fromPity = true;
                } else {
                    [candidate, born] = this.draw(born, false, this.hooks.saltOffset({ advance, bornRC }));
                    bornRC = this.hooks.advanceRc({ advance, bornRC });
                }
                draws += 1;
                if (fromPity && this.allowed.has(candidate)) purpleDraws += 1;
                if (draws > 100000) throw new Error('源码洗脉抽取未收敛');
                if (!this.allowed.has(candidate) || talents.includes(candidate)) continue;
                if (this.quality(candidate) === 4 && newPurple) continue;
                talents.push(candidate);
                generatedEvents.push({ id: candidate, bornRC, fromPity, luckSeed: fromPity ? luck : null });
                if (this.quality(candidate) === 4) {
                    if (fromPity && pityPurpleId == null) pityPurpleId = candidate;
                    newPurple = true;
                    pityActive = false;
                }
            }
            return {
                state: {
                    bornSeed: born,
                    luckSeed: luck,
                    bornRC,
                    talLucky: this.hooks.talLuckyAfter({ newPurple, luckyBefore, need }),
                    talents,
                },
                cost: kept.length ? this.eat + 2 * kept.length - 1 : this.eat,
                draws,
                generatedBars: need,
                keepIds: kept,
                pityPurpleId,                        // 新增字段：既有调用方不使用，行为不变
                generatedEvents,
                purpleDraws,
            };
        }

        /**
         * 脉序推演（新算法用）：从初始状态连洗 maxWashes 次，收集出现过的紫脉。
         * 返回结构与 WASM 的 wasmPreviewSequence 一致，便于上层无缝替换。
         */
        previewSequence(maxWashes, initialRaw, keepPositions = []) {
            const limit = Math.max(0, Math.trunc(Number(maxWashes) || 0));
            let st = this.initialState(initialRaw || {});
            const purples = [];
            for (let w = 1; w <= limit; w++) {
                const r = this.wash(st, keepPositions);
                st = r.state;
                const pityId = r.pityPurpleId == null ? null : numeric(r.pityPurpleId);
                // 只报「本次新洗出」的紫脉；锁定保留的紫/神脉不算出现（否则全锁存档每洗重复报一条）
                const keptSet = new Set((r.keepIds || []).map(id => numeric(id)));
                const hits = (r.state.talents || []).filter(id => this.quality(id) === 4 && !keptSet.has(numeric(id)));
                if (!hits.length) continue;
                for (const id of hits) {
                    purples.push({
                        talent_id: numeric(id),
                        talent_name: this.name(id),
                        wash_times: w,
                        wash_no: w,
                        was_pity: pityId != null && numeric(id) === pityId,
                    });
                }
            }
            return { purples, luck_pool: [] };
        }

        replaceablePositions(state, lockedIds = []) {
            const locked = new Set((lockedIds || []).map(Number));
            const shenmaiPositions = state.talents
                .map((id, index) => ({ id, index }))
                .filter(item => this.isShenmai(item.id))
                .map(item => item.index);
            // 普通冲突脉须已锁定且排在紫脉之前，不能锁住紫脉后再补冲突脉续换。
            // 不同神脉互冲仍不受普通冲突脉顺序限制。
            const conflictByType = new Map();
            state.talents.forEach((id, index) => {
                if (this.isShenmai(id)) return;
                if (this.quality(id) >= 4) return;
                if (!locked.has(Number(id))) return;
                const typ = this.talentType(id);
                if (!conflictByType.has(typ)) conflictByType.set(typ, index);
            });
            const result = [];
            state.talents.forEach((id, index) => {
                if (this.isShenmai(id) && shenmaiPositions.some(other => other !== index && state.talents[other] !== id)) {
                    result.push(index);
                    return;
                }
                if (this.isShenmai(id) || this.quality(id) !== 4) return;
                const conflictIndex = conflictByType.get(this.talentType(id));
                if (conflictIndex != null && conflictIndex < index) result.push(index);
            });
            return result;
        }

        replace(sourceState, position, lockedIds = []) {
            const state = cloneState(sourceState);
            if (!this.replaceablePositions(state, lockedIds).includes(position)) {
                throw new Error('置换失败：普通紫脉需要在它之前有同类型、非紫且已锁定的冲突脉；后补冲突脉不能续换');
            }
            const talents = state.talents.slice();
            const removedId = talents.splice(position, 1)[0];
            let luck = this.hooks.seedLuck(state);
            let draws = 0;
            let purpleDraws = 0;
            while (true) {
                let candidate;
                [candidate, luck] = this.draw(luck, true);
                draws += 1;
                if (this.allowed.has(candidate)) purpleDraws += 1;
                if (draws > 100000) throw new Error('源码置换抽取未收敛');
                if (this.allowed.has(candidate) && !talents.includes(candidate)) {
                    talents.push(candidate);
                    return {
                        state: { bornSeed: state.bornSeed, luckSeed: luck, bornRC: numeric(state.bornRC), talLucky: 0, talents },
                        removedId,
                        addedId: candidate,
                        draws,
                        purpleDraws,
                    };
                }
            }
        }
    }

    root.WashSourceEngine = Object.freeze({
        APK_TALENT_INSERTION_ORDER,
        QUALITY_WEIGHT,
        PITY,
        SLOT_COUNT,
        apkPairsOrder,
        luaRandom,
        weightedDraw,
        cloneState,
        stateKey,
        Engine,
    });
})(typeof window !== 'undefined' ? window : globalThis);
