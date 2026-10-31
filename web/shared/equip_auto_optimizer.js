(function (root) {
    'use strict';

    const DEFAULT_OPTIONS = Object.freeze({
        craftCount: 100,
        refineCount: 200,
        attachCount: 50,
        maxCraftCount: 5000,
        maxRefineCount: 1000,
        maxCraftWork: 100000,
        maxRefineWork: 2000000,
        resultLimit: 30,
    });
    const TARGET_PROPERTIES = Object.freeze([
        'atk_add', 'dmg_off', 'def_ign', 'atk_extend',
        'sword_add', 'unarmed_add', 'blade_add', 'stick_add',
        'hp_add', 'def_add', 'speed_add', 'hit_add',
        'blood', 'neij', 'gangqi', 'mp_back', 'mp_f',
        'dodge_add', 'parry_add', 'renxing', 'po_parry',
        'po_dodge', 'hp_back', 'dmg_ref',
    ]);
    const AUTO_PAPER_IDS = Object.freeze([
        2581, 2584, 2580, 3461, 3439, 3449, 3460, 2586, 2585,
        2587, 2583, 2582, 3458, 3454, 3429, 3456, 3409, 3419,
    ]);
    const SPECIAL_MATERIAL_PART_OVERRIDES = Object.freeze({
        6884: Object.freeze([7]),
    });
    const SPECIAL_QUALITY_WEIGHTS = Object.freeze([5000, 500, 50, 5, 1]);
    const SPECIAL_QUALITY_RANGES = Object.freeze([[85, 95], [95, 105], [105, 115], [115, 125], [125, 150]]);
    const SPECIAL_QUALITY_MIN_FACTOR = 85;
    const SPECIAL_QUALITY_MAX_FACTOR = 150;
    const WHALE_MULTIPLIER = 245109059551232n;
    const WHALE_INCREMENT = 48083817484545n;
    const WHALE_MASK = 2147483647n;
    const WHALE_REDUCTION_LIMIT = 2047483645n;
    const CRAFTED_MJ_SEED_PAPER_MULTIPLIER = 198;
    const REFINEMENT_THEORETICAL_MAX_MULTIPLIER = 1.25;
    const REFINEMENT_SLOT_MULTIPLIERS = Object.freeze([1, 0.75, 0.5]);

    function clone(value) {
        return value == null ? value : JSON.parse(JSON.stringify(value));
    }

    function finiteNumber(value, fallback = 0) {
        const number = Number(value);
        return Number.isFinite(number) ? number : fallback;
    }

    function integerInRange(value, min, max, fallback) {
        const number = Math.trunc(finiteNumber(value, fallback));
        return Math.max(min, Math.min(max, number));
    }

    function normalizeOptions(options) {
        const raw = { ...DEFAULT_OPTIONS, ...(options || {}) };
        return {
            craftCount: integerInRange(raw.craftCount, 1, raw.maxCraftCount, DEFAULT_OPTIONS.craftCount),
            refineCount: integerInRange(raw.refineCount, 1, raw.maxRefineCount, DEFAULT_OPTIONS.refineCount),
            attachCount: integerInRange(raw.attachCount, 1, 5000, DEFAULT_OPTIONS.attachCount),
            maxCraftCount: integerInRange(raw.maxCraftCount, 1, 5000, DEFAULT_OPTIONS.maxCraftCount),
            maxRefineCount: integerInRange(raw.maxRefineCount, 1, 1000, DEFAULT_OPTIONS.maxRefineCount),
            maxCraftWork: integerInRange(raw.maxCraftWork, 1, 500000, DEFAULT_OPTIONS.maxCraftWork),
            maxRefineWork: integerInRange(raw.maxRefineWork, 1, 10000000, DEFAULT_OPTIONS.maxRefineWork),
            resultLimit: integerInRange(raw.resultLimit, 1, 100, DEFAULT_OPTIONS.resultLimit),
        };
    }

    function requireData(data) {
        if (!data || !data.equipment || !data.papers || !data.craftsman) {
            throw new TypeError('装备数据表未加载完整');
        }
        return data;
    }

    function sortedCraftsmen(data) {
        requireData(data);
        return Object.values(data.craftsman).slice().sort((a, b) => {
            const placeA = a.place || a.name || '';
            const placeB = b.place || b.name || '';
            if (placeA !== placeB) return placeA.localeCompare(placeB, 'zh');
            return finiteNumber(a.id) - finiteNumber(b.id);
        });
    }

    function papersForCraftsman(data, craftsmanId) {
        requireData(data);
        const craftsman = data.craftsman[String(craftsmanId)];
        if (!craftsman) return [];
        const freePapers = new Set((craftsman.pf || []).map(Number));
        const allowedTypes = craftsman.zhi === 'fengzhi'
            ? new Set([5, 6, 7])
            : new Set([1, 2, 3, 4, 8, 9]);
        return Object.values(data.papers)
            .map(paper => ({
                paper,
                equip: data.equipment[String(paper.dz_equip)],
                isFreePaper: freePapers.has(Number(paper.id)),
            }))
            .filter(item => item.equip && allowedTypes.has(Number(item.equip.type)))
            .sort((a, b) => (finiteNumber(b.equip.lv) - finiteNumber(a.equip.lv))
                || String(a.equip.name || '').localeCompare(String(b.equip.name || ''), 'zh'));
    }

    function specialMaterialParts(material) {
        if (!material || !Array.isArray(material.part)) return [];
        if (material.part.length) return material.part.map(Number);
        return SPECIAL_MATERIAL_PART_OVERRIDES[String(material.id)] || [];
    }

    function specialMaterialSupportsEquip(material, equip) {
        const equipType = finiteNumber(equip && (equip.typ != null ? equip.typ : equip.type));
        return specialMaterialParts(material).includes(equipType);
    }

    function specialMaterialsForEquip(data, equip) {
        return Object.values((data && data.special) || {})
            .filter(material => specialMaterialSupportsEquip(material, equip))
            .sort((a, b) => String(a.name || '').localeCompare(String(b.name || ''), 'zh'));
    }

    function supportedTargetProperties(equip, data, targetProps) {
        const available = new Set(Object.keys(equip && equip.exts || {}));
        const next = equip && finiteNumber(equip.equ_next)
            ? data && data.equipment && data.equipment[String(equip.equ_next)]
            : null;
        Object.keys(next && next.exts || {}).forEach(prop => available.add(prop));
        return Array.from(new Set(targetProps || [])).filter(prop => TARGET_PROPERTIES.includes(prop) && available.has(prop));
    }

    function theoreticalRefinementSlotMaximum(equip, prop, slot = 1) {
        const extConfig = equip && equip.exts && equip.exts[prop];
        const baseValue = Number(Array.isArray(extConfig) ? extConfig[0] : NaN);
        const slotMultiplier = REFINEMENT_SLOT_MULTIPLIERS[Math.trunc(Number(slot)) - 1];
        if (!Number.isFinite(baseValue) || baseValue <= 0 || !slotMultiplier) return 0;
        const maximum = baseValue * REFINEMENT_THEORETICAL_MAX_MULTIPLIER * slotMultiplier;
        return baseValue >= 1 ? Math.floor(maximum) : maximum;
    }

    function theoreticalRefinementReference(equip, targetProps = Object.keys(equip && equip.exts || {})) {
        return Array.from(new Set(targetProps || [])).reduce((reference, prop) => {
            const maximum = REFINEMENT_SLOT_MULTIPLIERS.reduce((sum, _, index) => (
                sum + theoreticalRefinementSlotMaximum(equip, prop, index + 1)
            ), 0);
            if (maximum > 0) reference[prop] = maximum;
            return reference;
        }, {});
    }

    function craftedMJSeedFromMakeResult(result, paperId) {
        const czSeed = result && (result.CZSeed != null ? result.CZSeed : result.cz_seed);
        if (!Number.isSafeInteger(paperId) || paperId <= 0) {
            throw new TypeError(`打造图纸 ID 必须是正安全整数，实际为 ${String(paperId)}`);
        }
        const offset = paperId * CRAFTED_MJ_SEED_PAPER_MULTIPLIER;
        if (!Number.isSafeInteger(czSeed) || czSeed <= offset) {
            throw new TypeError(`打造结果 CZSeed 必须是大于图纸偏移 ${offset} 的安全整数，实际为 ${String(czSeed)}`);
        }
        return czSeed - offset;
    }

    function normalizePropertyList(list) {
        return (Array.isArray(list) ? list : []).map(item => ({
            prop: item && (item.prop || item.Key || item.key),
            value: item && (item.value != null ? item.value : item.Value),
        })).filter(item => item.prop);
    }

    function makeResultToEquip(result, data, paperId) {
        const equipId = finiteNumber(result && (result.equip_id || result.id));
        const config = data.equipment[String(equipId)] || {};
        const czSeed = result && (result.CZSeed != null ? result.CZSeed : result.cz_seed);
        return {
            id: equipId,
            only_id: finiteNumber(result && (result.only_id || result.OnlyID)),
            name: result && result.name || config.name || String(equipId),
            need_lv: finiteNumber(config.lv),
            typ: finiteNumber(config.type),
            color: finiteNumber(result && result.color, 1),
            level: 0,
            lv_prop: 0,
            S: finiteNumber(result && (result.S != null ? result.S : result.s)),
            MJSeed: craftedMJSeedFromMakeResult(result, paperId),
            CZSeed: finiteNumber(czSeed),
            XLLevel: 0,
            XLNumber: 0,
            exts: normalizePropertyList(result && result.exts),
            specials: normalizePropertyList(result && result.special),
            xilian_marks: [],
            xilian_accepted: 0,
        };
    }

    function canUpgrade(equip, data) {
        const config = data.equipment[String(equip && equip.id)] || {};
        return finiteNumber(equip && equip.need_lv) === 90
            && finiteNumber(equip && equip.color) < 5
            && finiteNumber(config.equ_next) > 0
            && !!data.equipment[String(config.equ_next)];
    }

    function upgradeEquip(equip, data) {
        if (!canUpgrade(equip, data)) return { equip: clone(equip), cost: null, upgraded: false };
        const current = data.equipment[String(equip.id)] || {};
        const next = data.equipment[String(current.equ_next)] || {};
        const isArmor = finiteNumber(equip.typ) >= 5 && finiteNumber(equip.typ) <= 7;
        const mainMaterial = isArmor
            ? { id: 3036, name: '青蝉翼', amount: 120 }
            : { id: 3026, name: '昆吾石', amount: 120 };
        const price = finiteNumber(next.price) > 0 ? finiteNumber(next.price) : (finiteNumber(current.price) || 10000);
        return {
            equip: {
                ...clone(equip),
                id: finiteNumber(current.equ_next),
                name: next.name || String(current.equ_next),
                need_lv: finiteNumber(next.lv, 100),
                typ: finiteNumber(next.type, equip.typ),
            },
            upgraded: true,
            cost: {
                materials: [
                    { id: 8801, name: '连金泥', amount: 10 },
                    mainMaterial,
                ],
                silver: Math.floor(price * 6),
            },
        };
    }

    function toWasmEquip(equip) {
        return {
            id: equip.id,
            only_id: equip.only_id || 0,
            name: equip.name,
            color: equip.color,
            level: equip.level || 0,
            lv_prop: equip.lv_prop || 0,
            S: equip.S || 0,
            CZSeed: equip.CZSeed,
            XLLevel: equip.XLLevel || 0,
            XLNumber: equip.XLNumber || 0,
            exts: clone(equip.exts || []),
            xilian_accepted: (equip.xilian_marks || []).length,
            xilian_marks: clone(equip.xilian_marks || []),
            need_lv: equip.need_lv || 0,
            typ: equip.typ || 0,
        };
    }

    function refinementPreviewItems(bridge, equip, count) {
        const response = bridge.xilianPlan(toWasmEquip(equip), Array(count).fill(false));
        if (response && response.error && !(response.items || []).length) throw new Error(response.error);
        return (response && response.items || []).slice(0, count);
    }

    /**
     * 这一刀能到达的「理论最大值」= 洗出的值 ÷ 它所在档位的系数。
     * 档位按该次的累积泥消耗（xl_level）分，与精炼页「最大值」口径一致：
     *   1~20 → 0.6、21~40 → 0.7、41~60 → 0.8、61~80 → 0.9；过 80 或拿不到档位信息 → 系数按 1。
     * 保留原始精度（不取整），因为它是用来比较大小的。
     */
    function refinementTheoreticalValue(value, cumMud) {
        const v = finiteNumber(value, 0);
        if (!(v > 0)) return v;
        const n = finiteNumber(cumMud, 0);
        if (!(n >= 1 && n <= 80)) return v;
        const coef = n <= 20 ? 0.6 : n <= 40 ? 0.7 : n <= 60 ? 0.8 : 0.9;
        return v / coef;
    }

    function collectSlotMaxima(items, targetProp) {
        const maxima = { 1: null, 2: null, 3: null };
        items.forEach((item, zeroIndex) => {
            const slot = finiteNumber(item && item.slot);
            const prop = item && item.prop;
            if (slot < 1 || slot > 3 || !prop || prop.prop !== targetProp) return;
            const value = finiteNumber(prop.value, Number.NEGATIVE_INFINITY);
            if (!Number.isFinite(value)) return;
            // 比较用「理论最大值」而不是原始值：81 之前的低系数机会，除以系数后可能一样到顶
            const cumMud = finiteNumber(item && item.xl_level, 0);
            const theoretical = refinementTheoreticalValue(value, cumMud);
            const occurrence = {
                index: finiteNumber(item.index, zeroIndex + 1), slot, value, cumMud, theoretical,
            };
            if (!maxima[slot] || theoretical > maxima[slot].theoretical) {
                maxima[slot] = { slot, value, theoretical, occurrences: [occurrence] };
            } else if (theoretical === maxima[slot].theoretical) {
                maxima[slot].occurrences.push(occurrence);
            }
        });
        return maxima;
    }

    function initialSlotMaxima(equip, targetProp) {
        const maxima = { 1: null, 2: null, 3: null };
        (Array.isArray(equip && equip.exts) ? equip.exts : []).slice(0, 3).forEach((prop, index) => {
            const property = prop && (prop.prop || prop.Key || prop.key);
            if (property !== targetProp) return;
            const value = finiteNumber(prop && (prop.value != null ? prop.value : prop.Value), Number.NEGATIVE_INFINITY);
            if (!Number.isFinite(value)) return;
            const slot = index + 1;
            const occurrence = { index: 0, slot, value, source: 'original' };
            // 装备上已有的词条已经是到手的东西，它的"理论最大值"就是它本身
            maxima[slot] = { slot, value, theoretical: value, occurrences: [occurrence], source: 'original' };
        });
        return maxima;
    }

    function cartesianOccurrenceChoices(groups, visit, depth = 0, selected = []) {
        if (depth >= groups.length) {
            visit(selected.slice());
            return;
        }
        groups[depth].forEach(item => {
            selected.push(item);
            cartesianOccurrenceChoices(groups, visit, depth + 1, selected);
            selected.pop();
        });
    }

    function multiplierWorkUntil(indices) {
        const sorted = indices.slice().sort((a, b) => a - b);
        let previous = 0;
        let accepted = 0;
        let work = 0;
        sorted.forEach(index => {
            work += (index - previous) * [1, 2, 4, 8][Math.min(accepted, 3)];
            previous = index;
            accepted += 1;
        });
        return { multiplierWork: work, cutoff: sorted[sorted.length - 1] || 0, sorted };
    }

    function selectCheapestMaxima(maxima) {
        const groups = [1, 2, 3].map(slot => maxima[slot]).filter(Boolean).map(item => item.occurrences);
        if (!groups.length) return null;
        let best = null;
        cartesianOccurrenceChoices(groups, choice => {
            const work = multiplierWorkUntil(choice.map(item => item.index));
            const signature = work.sorted.join(',');
            const candidate = { ...work, occurrences: choice.slice(), signature };
            if (!best
                || candidate.multiplierWork < best.multiplierWork
                || (candidate.multiplierWork === best.multiplierWork && candidate.cutoff < best.cutoff)
                || (candidate.multiplierWork === best.multiplierWork && candidate.cutoff === best.cutoff && candidate.signature < best.signature)) {
                best = candidate;
            }
        });
        return best;
    }

    /**
     * 连金泥消耗的「理论下限」估算（与精炼页 `estimateXilianLianjin` 同一套口径）。
     *
     * 逐刀累加 `cost_mult` 得到的是「顺其自然」的消耗，不含「为了吃满值而提前保留槽位」那部分，
     * 所以要按「前段 + 后段按倍率」重估。倍率 = 1 / 2 / 4 / 8，锁一个槽翻一档。
     *
     * 前段分两种情况（关键：前段只是为了让最早那个目标吃到满值）：
     *   - 最早目标在第 80 次之后 → 不锁也早就攒够 80 了，前段就是自然累加 = first
     *   - 最早目标在第 80 次之前 → 不够，得靠提前锁槽硬顶过线，前段按满值线下限 80 计
     * 只有后一种情况才需要「提前锁」，锁数由最早目标的位次决定；
     * ≤13 时三锁也够不到 80（返回 null，表示纯靠锁也吃不满）。
     *
     * @param {number[]} acceptIndices 每次保留（锁槽）所在的位次
     * @returns {number|null} 估算的连金泥数；null 表示这套估算不适用，应退回逐刀累加
     */
    function estimateRefinementLianjin(acceptIndices) {
        const list = (acceptIndices || [])
            .map(value => finiteNumber(value, 0))
            .filter(value => value > 0)
            .sort((a, b) => a - b);
        if (!list.length) return null;
        const first = list[0];
        if (first <= 13) return null; // 三锁也够不到 80

        const needsBoost = first - 1 < 80;
        // 锁数：要凑 80 时是「前段提前锁的个数」（最早目标自己也算在内）；不用凑则只需在最早目标那一刀锁它
        let locks = needsBoost ? (first <= 22 ? 3 : first <= 41 ? 2 : 1) : 1;
        let mud = needsBoost ? 80 : first;
        // 凑 80 时那 80 是「第 first-1 次结束」的数，第 first 次那一刀另算 → 从 first 开始；
        // 不用凑时前段就是第 1~first 次的自然累加，第 first 次已含在内 → 从 first+1 开始。
        let from = needsBoost ? first : first + 1;
        for (let i = 0; i < list.length; i++) {
            const isLast = i === list.length - 1;
            const to = isLast ? list[i] : list[i + 1];
            mud += Math.max(0, to - from + 1) * (1 << Math.min(3, locks));
            if (isLast) break;
            // 靠前的目标若已被「凑 80 用的锁」覆盖，就不会新增；否则要新锁一个。
            // 最后一个目标留到收工再锁，所以不参与翻倍。
            if (i + 1 >= locks) locks = Math.min(3, locks + 1);
            from = to + 1;
        }
        return mud;
    }

    /** 这一刀动手之前，累积泥是否已经 ≥ 80（决定它是不是满值），用于判断能否跳过估算 */
    function refinementItemPastLine(item) {
        const before = item && item.xl_level_before;
        if (before != null && Number.isFinite(Number(before))) return Number(before) >= 80;
        return finiteNumber(item && item.xl_level, 0) >= 81;
    }

    function refinementCost(equip, planItems, cutoff, data, acceptIndices) {
        if (!cutoff) return { mainMaterial: null, mainAmount: 0, lianjin: 0, silver: 0, multiplierWork: 0 };
        const isArmor = finiteNumber(equip.typ) >= 5 && finiteNumber(equip.typ) <= 7;
        const mainMaterial = isArmor
            ? { id: 3036, name: '青蝉翼' }
            : { id: 3026, name: '昆吾石' };
        const price = finiteNumber(data.equipment[String(equip.id)] && data.equipment[String(equip.id)].price) || 10000;
        const segment = planItems.slice(0, cutoff);
        const exact = segment.reduce((sum, item) => sum + Math.max(1, finiteNumber(item.cost_mult, 1)), 0);
        // 目标全在满值区（每一刀动手前累积泥已 ≥ 80）→ 逐刀累加就是真实花费，不必估算
        const allPastLine = segment.length > 0 && segment.every(refinementItemPastLine);
        const estimated = allPastLine ? null : estimateRefinementLianjin(acceptIndices);
        const lianjin = estimated != null ? estimated : exact;
        return {
            mainMaterial,
            mainAmount: 5 * lianjin,
            lianjin,
            silver: Math.floor(price * 1.5) * cutoff,
            multiplierWork: lianjin,
            estimated: estimated != null,
        };
    }

    function nextStatefulMaximum(items, targetProp, settledSlots, currentMaxima) {
        const maxima = collectSlotMaxima(items, targetProp);
        const choices = [1, 2, 3]
            .filter(slot => !settledSlots.has(slot) && maxima[slot]
                && (!currentMaxima[slot] || maxima[slot].theoretical > currentMaxima[slot].theoretical))
            .flatMap(slot => maxima[slot].occurrences);
        choices.sort((a, b) => a.index - b.index || a.slot - b.slot);
        return choices[0] || null;
    }

    function analyzeRefinement(bridge, equip, targetProp, count, data) {
        const maxima = initialSlotMaxima(equip, targetProp);
        const settledSlots = new Set((equip.xilian_marks || []).map(Number));
        const accepted = [];
        const plannedItems = [];
        let currentEquip = clone(equip);
        let remaining = count;
        let consumed = 0;

        while (remaining > 0 && settledSlots.size < 3) {
            const previewItems = refinementPreviewItems(bridge, currentEquip, remaining);
            const next = nextStatefulMaximum(previewItems, targetProp, settledSlots, maxima);
            if (!next) break;

            const localCutoff = next.index;
            const flags = Array(localCutoff).fill(false);
            flags[localCutoff - 1] = true;
            const planned = bridge.xilianPlan(toWasmEquip(currentEquip), flags);
            if (planned && planned.error && !(planned.items || []).length) throw new Error(planned.error);
            const segment = (planned && planned.items || []).slice(0, localCutoff);
            const acceptedItem = segment[localCutoff - 1];
            const actualSlot = finiteNumber(acceptedItem && acceptedItem.slot);
            const actualProp = acceptedItem && acceptedItem.prop;
            if (!acceptedItem || !acceptedItem.accepted || actualSlot !== next.slot
                || !actualProp || actualProp.prop !== targetProp) {
                throw new Error('精炼状态回放与预览不一致，请缩小范围后重试');
            }

            segment.forEach((item, index) => {
                plannedItems.push({
                    ...item,
                    index: consumed + finiteNumber(item && item.index, index + 1),
                });
            });
            const occurrenceValue = finiteNumber(actualProp.value);
            const occurrenceCumMud = finiteNumber(acceptedItem && acceptedItem.xl_level, 0);
            const occurrence = {
                index: consumed + finiteNumber(acceptedItem.index, localCutoff),
                slot: actualSlot,
                value: occurrenceValue,
                cumMud: occurrenceCumMud,
                theoretical: refinementTheoreticalValue(occurrenceValue, occurrenceCumMud),
            };
            maxima[actualSlot] = {
                slot: actualSlot,
                value: occurrence.value,
                theoretical: occurrence.theoretical,
                occurrences: [occurrence],
            };
            accepted.push({ ...occurrence, prop: targetProp });
            settledSlots.add(actualSlot);
            consumed += localCutoff;
            remaining -= localCutoff;

            if (remaining > 0) {
                if (!planned.equip) throw new Error('精炼状态回放缺少接受后的装备状态');
                currentEquip = clone(planned.equip);
            }
        }

        // 总分按「理论最大值」累加：这样 81 之前那些除以系数后一样到顶的机会才算得进来
        const total = [1, 2, 3].reduce((sum, slot) => sum + (maxima[slot] ? maxima[slot].theoretical : 0), 0);
        if (!accepted.length) return { prop: targetProp, maxima, total, plan: null, previewCount: count };
        const cutoff = accepted[accepted.length - 1].index;
        const cost = refinementCost(equip, plannedItems, cutoff, data, accepted.map(item => item.index));
        return {
            prop: targetProp,
            maxima,
            total,
            plan: {
                accepts: accepted,
                accepted,
                cutoff,
                cost,
            },
            previewCount: count,
        };
    }

    function requirePositiveInteger(value, field) {
        if (!Number.isSafeInteger(value) || value < 1) {
            throw new TypeError(`${field}必须是正整数，实际为 ${String(value)}`);
        }
        return value;
    }

    function drawWhaleInt(seed, maximum) {
        const validSeed = requirePositiveInteger(seed, '随机种子');
        const validMaximum = requirePositiveInteger(maximum, '随机上限');
        const mixed = BigInt.asUintN(64, (BigInt(validSeed) + BigInt(validMaximum)) * WHALE_MULTIPLIER + WHALE_INCREMENT);
        const raw = (mixed >> 17n) & WHALE_MASK;
        const nextSeed = Number((raw < WHALE_REDUCTION_LIMIT ? raw : raw - WHALE_REDUCTION_LIMIT) + 1n);
        return { seed: nextSeed, value: nextSeed % validMaximum + 1 };
    }

    function drawWeightedIndex(seed, weights, context) {
        const validWeights = (weights || []).map((weight, index) => {
            if (!Number.isSafeInteger(weight) || weight < 0) throw new TypeError(`${context}第 ${index + 1} 项权重无效`);
            return weight;
        });
        const total = validWeights.reduce((sum, value) => sum + value, 0);
        requirePositiveInteger(total, `${context}总权重`);
        const draw = drawWhaleInt(seed, total);
        let cumulative = 0;
        const index = validWeights.findIndex(weight => {
            cumulative += weight;
            return draw.value <= cumulative;
        });
        if (index < 0) throw new RangeError(`${context}抽取失败`);
        return { seed: draw.seed, index };
    }

    function specialMaterialProperties(material) {
        return (material.prop || []).map((entry, index) => {
            if (!Array.isArray(entry) || typeof entry[0] !== 'string' || !Number.isSafeInteger(entry[1])) {
                throw new TypeError(`特殊材料「${material.name}」第 ${index + 1} 项属性无效`);
            }
            return { prop: entry[0], weight: entry[1] };
        });
    }

    function specialMaterialBaseValue(material, equipLevel, propertyIndex) {
        const raw = material.lvs && material.lvs[`lv${requirePositiveInteger(equipLevel, '装备等级')}`];
        const value = Array.isArray(raw) ? raw[propertyIndex] : raw;
        if (typeof value !== 'number' || !Number.isFinite(value) || value <= 0) {
            throw new TypeError(`特殊材料「${material.name}」缺少当前等级数值`);
        }
        return value;
    }

    function scaleSpecialMaterialValue(baseValue, factor) {
        return baseValue < 1 ? baseValue * factor / 100 : Math.max(1, Math.floor(baseValue * factor / 100));
    }

    function specialMaterialValueRange(material, equipLevel, propertyIndex) {
        const baseValue = specialMaterialBaseValue(material, equipLevel, propertyIndex);
        return {
            minimum: scaleSpecialMaterialValue(baseValue, SPECIAL_QUALITY_MIN_FACTOR),
            maximum: scaleSpecialMaterialValue(baseValue, SPECIAL_QUALITY_MAX_FACTOR),
        };
    }

    function predictSpecialAttachSequence(equip, material, count) {
        if (!specialMaterialSupportsEquip(material, equip)) {
            throw new RangeError(`特殊材料「${material && material.name || material && material.id}」不适用于装备「${equip && equip.name}」`);
        }
        const properties = specialMaterialProperties(material);
        let seed = requirePositiveInteger(equip.MJSeed, `装备「${equip.name}」的 MJSeed`);
        const items = [];
        for (let index = 1; index <= requirePositiveInteger(count, '附加次数'); index += 1) {
            const seedBefore = seed;
            const propertyDraw = drawWeightedIndex(seed, properties.map(item => item.weight), '材料属性');
            seed = propertyDraw.seed;
            const qualityDraw = drawWeightedIndex(seed, SPECIAL_QUALITY_WEIGHTS, '材料品质');
            seed = qualityDraw.seed;
            const range = SPECIAL_QUALITY_RANGES[qualityDraw.index];
            const factorDraw = drawWhaleInt(seed, range[1] - range[0] + 1);
            seed = factorDraw.seed;
            const factor = range[0] + factorDraw.value - 1;
            const selected = properties[propertyDraw.index];
            const baseValue = specialMaterialBaseValue(material, equip.need_lv, propertyDraw.index);
            const valueRange = specialMaterialValueRange(material, equip.need_lv, propertyDraw.index);
            items.push({
                index,
                prop: selected.prop,
                value: scaleSpecialMaterialValue(baseValue, factor),
                valueMinimum: valueRange.minimum,
                valueMaximum: valueRange.maximum,
                factor,
                seedBefore,
                seedAfter: seed,
            });
        }
        const bestFactor = Math.max(...items.map(item => item.factor));
        const maxima = properties.map(({ prop }) => {
            const propertyItems = items.filter(item => item.prop === prop);
            if (!propertyItems.length) return { prop, value: null, indexes: [], recommendedIndex: null };
            const value = Math.max(...propertyItems.map(item => item.value));
            const indexes = propertyItems.filter(item => item.value === value).map(item => item.index);
            return { prop, value, indexes, recommendedIndex: indexes[0] };
        });
        return {
            materialId: material.id,
            materialName: material.name,
            items,
            maxima,
            bestFactor,
            bestIndexes: items.filter(item => item.factor === bestFactor).map(item => item.index),
            recommendedIndex: items.find(item => item.factor === bestFactor).index,
        };
    }

    function specialAttachEquipContext(equip) {
        return {
            id: finiteNumber(equip && equip.id),
            name: String(equip && equip.name || ''),
            need_lv: finiteNumber(equip && equip.need_lv),
            typ: finiteNumber(equip && equip.typ),
            MJSeed: finiteNumber(equip && equip.MJSeed),
        };
    }

    function validateBranch(branch, data) {
        const craftsman = data.craftsman[String(branch.npcId)];
        const paper = data.papers[String(branch.paperId)];
        const equip = paper && data.equipment[String(paper.dz_equip)];
        if (!craftsman) throw new Error(`未找到打造地点 ${branch.npcId}`);
        if (!paper || !equip) throw new Error(`未找到图纸 ${branch.paperId}`);
        const available = papersForCraftsman(data, craftsman.id).some(item => Number(item.paper.id) === Number(paper.id));
        if (!available) throw new Error(`「${craftsman.place || craftsman.name}」不能打造「${paper.name}」`);
        const specialId = finiteNumber(branch.specialId);
        if (specialId) {
            const material = data.special[String(specialId)];
            if (!material || !specialMaterialSupportsEquip(material, equip)) {
                throw new Error(`打造材料 ${specialId} 不适用于「${equip.name}」`);
            }
        }
        return { craftsman, paper, equip };
    }

    function buildMakeRequest(branch, data) {
        const { paper } = validateBranch(branch, data);
        return {
            npc_id: finiteNumber(branch.npcId),
            select_id: finiteNumber(paper.id),
            equip_id: finiteNumber(paper.dz_equip),
            special_id: finiteNumber(branch.specialId),
            min_color: finiteNumber(paper.min_color, 1),
            max_color: finiteNumber(paper.max_color, 4),
        };
    }

    function craftCost(branch, craftNumber, data) {
        const { craftsman, paper } = validateBranch(branch, data);
        const count = Math.max(0, Math.trunc(finiteNumber(craftNumber)));
        const freePaper = (craftsman.pf || []).map(Number).includes(Number(paper.id));
        const materials = [];
        if (!freePaper) materials.push({ id: paper.id, name: paper.name, amount: count });
        materials.push({
            id: paper.dz_mat,
            name: data.itemNames && data.itemNames[String(paper.dz_mat)] || `材料${paper.dz_mat}`,
            amount: finiteNumber(paper.dz_num) * count,
        });
        if (finiteNumber(branch.specialId)) {
            const special = data.special[String(branch.specialId)];
            materials.push({ id: special.id, name: special.name, amount: count });
        }
        return {
            materials,
            silver: (finiteNumber(craftsman.cost) + finiteNumber(paper.cost)) * count,
        };
    }

    function compareCandidates(a, b) {
        return (a.craftIndex - b.craftIndex)
            || String(a.location).localeCompare(String(b.location), 'zh')
            || String(a.paperName).localeCompare(String(b.paperName), 'zh')
            || (b.score - a.score)
            || (b.regionHits - a.regionHits)
            || (a.refineWork - b.refineWork);
    }

    function selectDisplayCandidates(candidates, limit) {
        if (candidates.length <= limit) return candidates.slice();
        const selectedLocations = new Set();
        const selected = [];
        for (const candidate of candidates) {
            if (selectedLocations.has(candidate.location)) continue;
            selectedLocations.add(candidate.location);
            selected.push(candidate);
            if (selected.length >= limit) return selected.sort(compareCandidates);
        }
        for (const candidate of candidates) {
            if (selected.includes(candidate)) continue;
            selected.push(candidate);
            if (selected.length >= limit) break;
        }
        return selected.sort(compareCandidates);
    }

    function makeBranchKey(branch) {
        return `${branch.npcId}:${branch.paperId}:${finiteNumber(branch.specialId)}`;
    }

    async function simulateEquipmentRoutes(input) {
        const data = requireData(input && input.data);
        const bridge = input && input.bridge;
        if (!bridge || typeof bridge.getMakeState !== 'function' || typeof bridge.setMakeState !== 'function'
            || typeof bridge.makePreview !== 'function' || typeof bridge.xilianPlan !== 'function') {
            throw new TypeError('装备模拟桥接接口不完整');
        }
        const options = normalizeOptions(input.options);
        const requestedBranches = (input.branches || []).map(branch => ({ ...branch, key: makeBranchKey(branch) }));
        const targetProps = Array.from(new Set((input.targetProps || []).filter(prop => TARGET_PROPERTIES.includes(prop))));
        if (!requestedBranches.length) throw new Error('请至少选择一个地点和一张可打造图纸');
        if (!targetProps.length) throw new Error('请至少选择一个目标属性');
        const branchPlans = requestedBranches.map(branch => {
            const meta = validateBranch(branch, data);
            const compatibleTargetProps = supportedTargetProperties(meta.equip, data, targetProps);
            return {
                branch,
                meta,
                compatibleTargetProps,
                unsupportedTargetProps: targetProps.filter(prop => !compatibleTargetProps.includes(prop)),
            };
        });
        const activeBranchPlans = branchPlans.filter(plan => plan.compatibleTargetProps.length > 0);
        const skippedBranches = branchPlans.filter(plan => plan.compatibleTargetProps.length === 0).map(plan => ({
            key: plan.branch.key,
            npcId: plan.meta.craftsman.id,
            location: plan.meta.craftsman.place || plan.meta.craftsman.name,
            paperId: plan.meta.paper.id,
            paperName: plan.meta.paper.name,
            equipId: plan.meta.equip.id,
            equipName: plan.meta.equip.name,
            targetProps: targetProps.slice(),
            reason: '该装备的数据属性池不会出现任何所选目标属性',
        }));
        if (activeBranchPlans.length * options.craftCount > options.maxCraftWork) {
            throw new Error(`组合过大：共需预测 ${(activeBranchPlans.length * options.craftCount).toLocaleString()} 次打造，请减少地点、图纸或打造次数`);
        }
        const initialMakeState = clone(input.initialMakeState || bridge.getMakeState());
        if (!initialMakeState) throw new Error('存档中没有可用的 MakeRnd 打造状态');
        const shouldCancel = typeof input.shouldCancel === 'function' ? input.shouldCancel : () => false;
        const onProgress = typeof input.onProgress === 'function' ? input.onProgress : () => {};
        const yieldControl = typeof input.yieldControl === 'function'
            ? input.yieldControl
            : () => new Promise(resolve => setTimeout(resolve, 0));
        const branchResults = [];
        const candidates = [];
        let totalPurple = 0;
        const startedAt = Date.now();

        try {
            for (let branchIndex = 0; branchIndex < activeBranchPlans.length; branchIndex += 1) {
                if (shouldCancel()) return { cancelled: true, branches: branchResults, skippedBranches, candidates: [] };
                const plan = activeBranchPlans[branchIndex];
                const branch = plan.branch;
                const meta = plan.meta;
                bridge.setMakeState(clone(initialMakeState));
                onProgress({
                    phase: 'craft', done: branchIndex, total: activeBranchPlans.length,
                    message: `从原始存档开始：${meta.craftsman.place || meta.craftsman.name} · ${meta.paper.name}`,
                });
                const response = bridge.makePreview(buildMakeRequest(branch, data), options.craftCount);
                if (response && response.error && !(response.items || []).length) throw new Error(response.error);
                const items = (response && response.items || []).slice(0, options.craftCount);
                bridge.setMakeState(clone(initialMakeState));
                const purpleItems = items.filter(item => finiteNumber(item.color) === 4);
                totalPurple += purpleItems.length;
                const branchResult = {
                    key: branch.key,
                    npcId: meta.craftsman.id,
                    location: meta.craftsman.place || meta.craftsman.name,
                    craftsmanName: meta.craftsman.name,
                    paperId: meta.paper.id,
                    paperName: meta.paper.name,
                    equipId: meta.equip.id,
                    equipName: meta.equip.name,
                    specialId: finiteNumber(branch.specialId),
                    targetProps: plan.compatibleTargetProps.slice(),
                    unsupportedTargetProps: plan.unsupportedTargetProps.slice(),
                    craftCount: items.length,
                    purpleCount: purpleItems.length,
                    purpleRate: items.length ? purpleItems.length / items.length : 0,
                    searchCost: craftCost(branch, items.length, data),
                };
                branchResults.push(branchResult);
                for (const item of purpleItems) {
                    candidates.push({ branch, branchResult, item });
                }
                await yieldControl();
            }

            const refineWork = candidates.reduce((sum, source) => (
                sum + source.branchResult.targetProps.length * options.refineCount
            ), 0);
            if (refineWork > options.maxRefineWork) {
                throw new Error(`紫装较多：精炼分析需约 ${refineWork.toLocaleString()} 步，请减少图纸、属性或精炼次数`);
            }

            const detailed = [];
            for (let candidateIndex = 0; candidateIndex < candidates.length; candidateIndex += 1) {
                if (shouldCancel()) return { cancelled: true, branches: branchResults, skippedBranches, candidates: [] };
                const source = candidates[candidateIndex];
                const rawEquip = makeResultToEquip(source.item, data, source.branch.paperId);
                const upgrade = upgradeEquip(rawEquip, data);
                const equip = upgrade.equip;
                const craftSpecialId = finiteNumber(source.branch.specialId);
                const craftSpecialMaterial = craftSpecialId ? data.special[String(craftSpecialId)] : null;
                const craftSpecialItems = normalizePropertyList(source.item.special);
                const canSimulateSpecialAttach = !!(craftSpecialMaterial && craftSpecialItems.length);
                onProgress({
                    phase: 'refine', done: candidateIndex, total: candidates.length,
                    message: `分析紫装 ${candidateIndex + 1}/${candidates.length}：${source.branchResult.equipName} · 第 ${source.item.index} 次`,
                });
                const refinements = source.branchResult.targetProps.map(prop => analyzeRefinement(
                    bridge, equip, prop, options.refineCount, data,
                ));
                const refinementRatingReference = theoreticalRefinementReference(
                    data.equipment[String(equip.id)],
                );
                const region = normalizePropertyList(source.item.region);
                const regionHits = region.filter(item => source.branchResult.targetProps.includes(item.prop)).length;
                const score = refinements.reduce((sum, item) => sum + finiteNumber(item.total), 0);
                const refineMultiplierWork = refinements.reduce((sum, item) => sum + finiteNumber(item.plan && item.plan.cost.multiplierWork), 0);
                detailed.push({
                    id: `${source.branch.key}:${source.item.index}`,
                    branchKey: source.branch.key,
                    location: source.branchResult.location,
                    craftsmanName: source.branchResult.craftsmanName,
                    paperId: source.branchResult.paperId,
                    paperName: source.branchResult.paperName,
                    equipId: equip.id,
                    equipName: equip.name,
                    originalEquipName: rawEquip.name,
                    craftIndex: finiteNumber(source.item.index),
                    color: finiteNumber(source.item.color),
                    base: clone(source.item.base || {}),
                    exts: normalizePropertyList(source.item.exts),
                    region,
                    special: craftSpecialItems,
                    craftSpecialId,
                    craftSpecialName: craftSpecialMaterial && craftSpecialMaterial.name || '',
                    craftSpecialStage: craftSpecialId ? 'before' : null,
                    craftSpecialEquipLevel: craftSpecialId ? rawEquip.need_lv : null,
                    canSimulateSpecialAttach,
                    specialAttachEquips: canSimulateSpecialAttach ? {
                        before: specialAttachEquipContext(rawEquip),
                        after: specialAttachEquipContext(equip),
                    } : null,
                    seedKind: source.item.pity ? '保底' : (source.item.seed_kind || '普通'),
                    S: rawEquip.S,
                    CZSeed: rawEquip.CZSeed,
                    MJSeed: rawEquip.MJSeed,
                    upgraded: upgrade.upgraded,
                    upgradeCost: upgrade.cost,
                    craftCost: craftCost(source.branch, finiteNumber(source.item.index), data),
                    refinements,
                    refinementRatingReference,
                    unsupportedTargetProps: source.branchResult.unsupportedTargetProps.slice(),
                    score,
                    regionHits,
                    refineWork: refineMultiplierWork,
                });
                if ((candidateIndex + 1) % 4 === 0) await yieldControl();
            }

            detailed.sort(compareCandidates);
            const displayCandidates = selectDisplayCandidates(detailed, options.resultLimit);
            return {
                strength: '当前输入范围内按打造次数排序',
                objective: ['craft_index', 'location', 'paper', 'target_total', 'region_hits', 'refine_cost'],
                targetProps,
                options,
                branches: branchResults,
                skippedBranches,
                candidates: detailed,
                bestCandidates: displayCandidates,
                summary: {
                    requestedBranchCount: requestedBranches.length,
                    branchCount: activeBranchPlans.length,
                    skippedBranchCount: skippedBranches.length,
                    totalCrafts: branchResults.reduce((sum, item) => sum + item.craftCount, 0),
                    totalPurple,
                    candidateCount: detailed.length,
                    elapsedMs: Date.now() - startedAt,
                },
            };
        } finally {
            bridge.setMakeState(clone(initialMakeState));
        }
    }

    root.EquipmentAutoOptimizer = Object.freeze({
        DEFAULT_OPTIONS,
        TARGET_PROPERTIES,
        AUTO_PAPER_IDS,
        REFINEMENT_THEORETICAL_MAX_MULTIPLIER,
        REFINEMENT_SLOT_MULTIPLIERS,
        normalizeOptions,
        sortedCraftsmen,
        papersForCraftsman,
        specialMaterialSupportsEquip,
        specialMaterialsForEquip,
        supportedTargetProperties,
        theoreticalRefinementSlotMaximum,
        theoreticalRefinementReference,
        craftedMJSeedFromMakeResult,
        makeResultToEquip,
        canUpgrade,
        upgradeEquip,
        collectSlotMaxima,
        initialSlotMaxima,
        selectCheapestMaxima,
        analyzeRefinement,
        refinementTheoreticalValue,
        estimateRefinementLianjin,
        specialMaterialValueRange,
        predictSpecialAttachSequence,
        buildMakeRequest,
        craftCost,
        compareCandidates,
        simulateEquipmentRoutes,
    });
})(typeof window !== 'undefined' ? window : globalThis);
