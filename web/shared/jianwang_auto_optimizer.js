(function (root) {
    'use strict';

    const JIANWANG_SWORD_IDS = new Set([5707, 5708, 5709, 5710, 5711, 5712, 5713, 5714, 5715, 5716, 5717]);
    const JIANWANG_LEVEL_90_IDS = new Set([5710, 5711, 5712, 5713]);
    const JIANWANG_LEVEL_100_IDS = new Set([5714, 5715, 5716, 5717]);
    const JIANWANG_GROW_TARGETS = Object.freeze({
        5707: Object.freeze([5708]),
        5708: Object.freeze([5709]),
        5709: Object.freeze([5710, 5711, 5712, 5713]),
    });
    const JIANWANG_SHATTER_ROUTE_IDS = Object.freeze({
        5710: 5710, 5711: 5711, 5712: 5712, 5713: 5713,
        5714: 5710, 5715: 5711, 5716: 5712, 5717: 5713,
    });
    const JIANWANG_EXT_PROP_ORDER = Object.freeze([
        'atk_add', 'hit_add', 'def_add', 'hp_add', 'speed_add', 'dodge_add', 'parry_add', 'def_ign',
        'unarmed_add', 'sword_add', 'blade_add', 'stick_add', 'hp_back', 'mp_back', 'mp_f', 'dmg_off',
        'dmg_ref', 'blood', 'renxing', 'po_parry', 'po_dodge', 'atk_extend', 'xx_prob', 'xx_crit',
    ]);
    const JIANWANG_BASE_PROP_ORDER = Object.freeze(['atk', 'def', 'hit', 'hp', 'speed', 'dodge', 'parry', 'neijin', 'gq_base']);
    const JIANWANG_COLOR_ROLL_WEIGHTS = Object.freeze([74, 20, 5, 1]);
    const JIANWANG_RULE_PATCHED = 'patched';
    const JIANWANG_RULE_STANDARD = 'standard';
    const JIANWANG_REFORGE_LIMIT = 10;
    const JIANWANG_REFORGE_COSTS = Object.freeze([
        Object.freeze([2, 3]), Object.freeze([3, 4]), Object.freeze([4, 4]),
        Object.freeze([6, 5]), Object.freeze([6, 6]),
    ]);
    const JIANWANG_RESOURCE_NAMES = Object.freeze({
        2000: '青金石', 2020: '陨铁', 3024: '雪银', 3025: '紫金',
        6516: '剑芯6516', 6517: '剑芯6517', 6518: '剑胚6518',
    });
    const JIANWANG_TARGET_COUNTS = new Set([3, 4]);
    const THREE_TARGET_SUCCESS_LIMIT = 10;
    const JIANWANG_BLANK_ID = 5707;
    const JIANWANG_REDSEED_DRAW_MAX = 99999999;
    const JIANWANG_REDSEED_MJ_MULTIPLIER = 123;
    const JIANWANG_REDSEED_CZ_MULTIPLIER = 321;
    const MAX_SIMULATED_SWORDS = 100000;
    const DEFAULT_BATCH_SIZE = 40;
    const WHALE_MULTIPLIER = 245109059551232n;
    const WHALE_INCREMENT = 48083817484545n;
    const WHALE_MASK = 2147483647n;
    const WHALE_REDUCTION_LIMIT = 2047483645n;

    let firstSwordProvider = null;

    function clone(value) {
        return value == null ? value : JSON.parse(JSON.stringify(value));
    }

    function requirePositiveInteger(value, field) {
        if (!Number.isSafeInteger(value) || value < 1) {
            throw new TypeError(`${field}必须是正整数，实际为 ${String(value)}`);
        }
        return value;
    }

    function drawWhaleInt(seed, maximum) {
        const validSeed = requirePositiveInteger(Number(seed), '随机种子');
        const validMaximum = requirePositiveInteger(Number(maximum), '随机上限');
        const mixed = BigInt.asUintN(
            64,
            (BigInt(validSeed) + BigInt(validMaximum)) * WHALE_MULTIPLIER + WHALE_INCREMENT,
        );
        const raw = (mixed >> 17n) & WHALE_MASK;
        const nextSeed = Number((raw < WHALE_REDUCTION_LIMIT ? raw : raw - WHALE_REDUCTION_LIMIT) + 1n);
        return { seed: nextSeed, value: nextSeed % validMaximum + 1 };
    }

    function drawWeightedIndex(seed, weights, context) {
        if (!Array.isArray(weights) || !weights.length) throw new TypeError(`${context}权重不能为空`);
        const validWeights = weights.map((weight, index) => {
            if (!Number.isSafeInteger(weight) || weight < 0) {
                throw new TypeError(`${context}第 ${index + 1} 项权重必须是非负整数`);
            }
            return weight;
        });
        const total = validWeights.reduce((sum, weight) => sum + weight, 0);
        requirePositiveInteger(total, `${context}总权重`);
        const draw = drawWhaleInt(seed, total);
        let cumulative = 0;
        const index = validWeights.findIndex(weight => {
            cumulative += weight;
            return draw.value <= cumulative;
        });
        if (index < 0) throw new RangeError(`${context}随机值超出总权重`);
        return { seed: draw.seed, index };
    }

    function drawJianwangBetween(seed, minimum, maximum, context) {
        if (!Number.isSafeInteger(minimum) || !Number.isSafeInteger(maximum) || maximum < minimum) {
            throw new TypeError(`${context}区间无效：${minimum}–${maximum}`);
        }
        const draw = drawWhaleInt(seed, maximum - minimum + 1);
        return { seed: draw.seed, value: draw.value - 1 + minimum };
    }

    function normalizeExts(raw) {
        if (!Array.isArray(raw)) return [];
        return raw.filter(Boolean).map(item => ({
            prop: item.Key || item.prop || item.key,
            value: item.Value != null ? item.Value : item.value,
            S: item.S != null ? item.S : (item.s || 0),
            propCheck: item.PropCheck || item.propCheck || '',
        })).filter(item => item.prop);
    }

    function toSwordInstance(raw, source, equipped, equipData) {
        const id = Number(raw && (raw.ID ?? raw.id));
        const cfg = equipData?.equipment?.[String(id)] || {};
        return {
            id,
            only_id: Number(raw?.OnlyID ?? raw?.only_id ?? 0),
            name: cfg.name || raw?.name || String(id),
            need_lv: Number(cfg.lv || raw?.need_lv || 0),
            typ: Number(cfg.type || raw?.typ || 3),
            color: Number(raw?.Color ?? raw?.color ?? 6),
            level: Number(raw?.Level ?? raw?.level ?? 0),
            lv_prop: Number(raw?.LvProp ?? raw?.lv_prop ?? 0),
            S: Number(raw?.S ?? raw?.s ?? 0),
            MJSeed: Number(raw?.MJSeed ?? raw?.mj_seed ?? 0),
            CZSeed: Number(raw?.CZSeed ?? raw?.cz_seed ?? 0),
            XLLevel: Number(raw?.XLLevel ?? raw?.xl_level ?? 0),
            XLNumber: Number(raw?.XLNumber ?? raw?.xl_number ?? 0),
            exp: Number(raw?.Exp ?? raw?.exp ?? 0),
            base: {
                atk: Number(raw?.Atk ?? raw?.atk ?? 0),
                def: Number(raw?.Def ?? raw?.def ?? 0),
                hit: Number(raw?.Hit ?? raw?.hit ?? 0),
                hp: Number(raw?.Hp ?? raw?.hp ?? 0),
                speed: Number(raw?.Speed ?? raw?.speed ?? 0),
                dodge: Number(raw?.Dodge ?? raw?.dodge ?? 0),
                parry: Number(raw?.Parry ?? raw?.parry ?? 0),
                neijin: Number(raw?.Neijin ?? raw?.neijin ?? 0),
                gq_base: Number(raw?.Gangqi ?? raw?.gq_base ?? 0),
            },
            exts: normalizeExts(raw?.EnExts || raw?.exts),
            specials: normalizeExts(raw?.EnSpecials || raw?.specials),
            _source: source,
            _equipped: !!equipped,
            _provider: false,
        };
    }

    function swordKey(sword) {
        return String(sword?.only_id || `${sword?._source || '存档'}:${sword?.id || 0}:${sword?.CZSeed || 0}:${sword?.S || 0}`);
    }

    function collectSwords(saveData, equipData) {
        const rootSave = Array.isArray(saveData) ? saveData[0] : saveData;
        if (!rootSave || !equipData?.equipment) return [];
        const out = [];
        const seen = new Set();
        const pushList = (list, source, equipped) => {
            if (!list) return;
            const items = Array.isArray(list) ? list : Object.values(list);
            for (const raw of items) {
                const id = Number(raw && (raw.ID ?? raw.id));
                if (!JIANWANG_SWORD_IDS.has(id) || !equipData.equipment[String(id)]) continue;
                if (raw?.CZSeed == null && raw?.cz_seed == null && raw?.S == null && raw?.s == null
                    && raw?.EnExts == null && raw?.exts == null && raw?.Color == null && raw?.color == null) continue;
                const sword = toSwordInstance(raw, source, equipped, equipData);
                const key = swordKey(sword);
                if (seen.has(key)) continue;
                seen.add(key);
                sword.key = key;
                out.push(sword);
            }
        };
        const roleList = value => {
            if (!value) return [];
            if (Array.isArray(value)) return value;
            if (typeof value === 'object') return Object.values(value);
            return [];
        };
        pushList(rootSave.MainRole?.Equips, '主角装备', true);
        roleList(rootSave.Roles).forEach((role, index) => {
            pushList(role?.Equips, role?.Name || role?.name || `随从${index + 1}`, true);
        });
        roleList(rootSave.Leavers).forEach((role, index) => {
            pushList(role?.Equips, role?.Name || role?.name || `离队${index + 1}`, true);
        });
        pushList(rootSave.Equips, '背包', false);
        const depots = rootSave.EncryptDepots || rootSave.Depots || {};
        for (const [depotId, depot] of Object.entries(depots)) {
            const list = depot?.Depots || depot?.Items || depot;
            pushList(list, depot?.Name || depot?.name || `仓库:${depotId}`, false);
        }
        return out.sort((a, b) => Number(a.id) - Number(b.id)
            || String(a._source).localeCompare(String(b._source), 'zh')
            || Number(a.only_id) - Number(b.only_id));
    }

    function classifyExtSeedBatch(sword) {
        if (!sword || !JIANWANG_SWORD_IDS.has(Number(sword.id)) || !Array.isArray(sword.exts)) return null;
        const seeds = sword.exts.map(ext => Number(ext?.S || 0));
        if (seeds.length < 2 || seeds.some(seed => !Number.isSafeInteger(seed) || seed <= 0)) return null;
        const generatedBatch = seeds.length >= 3 ? seeds.slice(1) : seeds;
        if (new Set(generatedBatch).size === 1) return JIANWANG_RULE_PATCHED;
        if (seeds.length === 2) return JIANWANG_RULE_STANDARD;
        return null;
    }

    function detectRuleFromSwords(swords) {
        const evidence = (Array.isArray(swords) ? swords : [])
            .map(sword => classifyExtSeedBatch(sword))
            .filter(Boolean);
        const patchedCount = evidence.filter(rule => rule === JIANWANG_RULE_PATCHED).length;
        const standardCount = evidence.filter(rule => rule === JIANWANG_RULE_STANDARD).length;
        if (standardCount > patchedCount) return { rule: JIANWANG_RULE_STANDARD, evidence: evidence.length };
        return { rule: JIANWANG_RULE_PATCHED, evidence: evidence.length };
    }

    function generateEquip(equipData, targetId, startSeed, rule = JIANWANG_RULE_PATCHED) {
        const cfg = equipData?.equipment?.[String(targetId)];
        if (!cfg || !JIANWANG_SWORD_IDS.has(Number(targetId))) throw new RangeError(`无效的剑王阁目标装备：${targetId}`);
        const standard = rule === JIANWANG_RULE_STANDARD;
        let seed = requirePositiveInteger(Number(startSeed), 'CZSeed');
        seed = drawWeightedIndex(seed, JIANWANG_COLOR_ROLL_WEIGHTS, '剑王阁品质占位').seed;
        const base = {};
        for (const prop of JIANWANG_BASE_PROP_ORDER) {
            const raw = Number(cfg.base?.[prop]) || 0;
            if (raw <= 0) continue;
            if (!standard) {
                base[prop] = raw;
                continue;
            }
            const draw = drawJianwangBetween(seed, 100, 100, `剑王阁${prop}`);
            seed = draw.seed;
            base[prop] = Math.floor(raw * draw.value / 100);
        }
        const candidates = JIANWANG_EXT_PROP_ORDER.filter(prop => Number(cfg.exts?.[prop]?.[0]) > 0);
        const weights = candidates.map(prop => Math.max(0, Math.floor(Number(cfg.exts[prop][1]) || 0)));
        const slotCount = Math.max(0, Math.floor(((Number(cfg.lv) || 60) - 60) / 10) + 1);
        const exts = [];
        for (let slot = 0; slot < slotCount; slot++) {
            const draw = drawWeightedIndex(seed, weights, '剑王阁副属性');
            seed = draw.seed;
            const prop = candidates[draw.index];
            exts.push({ prop, value: Number(cfg.exts[prop][0]) });
            if (standard) weights[draw.index] = 0;
        }
        return { id: Number(targetId), seedAfter: seed, base, exts };
    }

    function createBlankFromRedSeed(equipData, redSeed, swordIndex = null) {
        const sourceRedSeed = requirePositiveInteger(Number(redSeed), 'RedSeeds[5707]');
        const baseSeed = Math.floor(sourceRedSeed / 10);
        const MJSeed = baseSeed + JIANWANG_BLANK_ID * JIANWANG_REDSEED_MJ_MULTIPLIER;
        const CZSeed = baseSeed + JIANWANG_BLANK_ID * JIANWANG_REDSEED_CZ_MULTIPLIER;
        requirePositiveInteger(MJSeed, '新剑胚 MJSeed');
        requirePositiveInteger(CZSeed, '新剑胚 CZSeed');
        const generated = generateEquip(equipData, JIANWANG_BLANK_ID, sourceRedSeed, JIANWANG_RULE_STANDARD);
        const nextRedSeed = drawWhaleInt(sourceRedSeed, JIANWANG_REDSEED_DRAW_MAX).seed;
        const cfg = equipData.equipment[String(JIANWANG_BLANK_ID)] || {};
        return {
            redSeedBefore: sourceRedSeed,
            redSeedAfter: nextRedSeed,
            equip: {
                id: JIANWANG_BLANK_ID,
                only_id: 0,
                name: cfg.name || '剑胚',
                need_lv: Number(cfg.lv) || 60,
                typ: Number(cfg.type) || 3,
                color: 6,
                level: 0,
                lv_prop: 0,
                S: generated.seedAfter,
                MJSeed,
                CZSeed,
                XLLevel: 0,
                XLNumber: 0,
                exp: 0,
                base: generated.base,
                exts: generated.exts.map(item => ({ ...item })),
                specials: [],
                _source: '自动模拟',
                _equipped: false,
                _provider: false,
                _jianwangRebuilt: true,
                _jianwangSwordIndex: swordIndex,
            },
        };
    }

    function keepLimit(sword, action) {
        if (!sword || !action) return 0;
        if (action === 'reforge') return Math.min(4, sword.exts?.length || 0);
        if (action === 'grow') {
            const byId = { 5707: 1, 5708: 2, 5709: 3 };
            return Math.min(byId[Number(sword.id)] || 0, sword.exts?.length || 0);
        }
        return 0;
    }

    function normalizeTargetProps(value) {
        const source = Array.isArray(value) ? value : [value];
        const props = [];
        for (const item of source) {
            const prop = String(item || '').trim();
            if (prop && !props.includes(prop)) props.push(prop);
        }
        if (props.length !== 1) throw new RangeError('必须且只能选择1个词条');
        return props;
    }

    function targetMinimumValueForRoute(equipData, routeId, targetProp) {
        const raw = equipData?.equipment?.[String(Number(routeId))]?.exts?.[targetProp]?.[0];
        const value = Number(raw);
        return Number.isFinite(value) ? value : null;
    }

    function targetMinimumValuesForRoute(equipData, routeId, targetProps) {
        return Object.fromEntries(normalizeTargetProps(targetProps).map(prop => [prop, targetMinimumValueForRoute(equipData, routeId, prop)]));
    }

    function targetExtMeetsMinimum(ext, targetProp, minimumValue) {
        if (ext?.prop !== targetProp) return false;
        if (!Number.isFinite(minimumValue)) return true;
        const value = Number(ext?.value);
        return Number.isFinite(value) && value + 1e-12 >= minimumValue;
    }

    function targetExtMatchesAny(ext, targetProps, minimumValues = null) {
        const props = normalizeTargetProps(targetProps);
        if (!props.includes(ext?.prop)) return false;
        if (!minimumValues) return true;
        return targetExtMeetsMinimum(ext, ext.prop, minimumValues[ext.prop]);
    }

    function targetKeepIndices(sword, targetProps, action, minimumValues = null) {
        const props = normalizeTargetProps(targetProps);
        const limit = keepLimit(sword, action);
        const collect = predicate => {
            const indices = [];
            const seen = new Set();
            for (let index = 0; index < limit; index++) {
                const ext = sword.exts?.[index];
                if (!predicate(ext)) continue;
                const key = `${ext?.prop || ''}\u0000${String(ext?.value)}`;
                if (seen.has(key)) continue;
                seen.add(key);
                indices.push(index + 1);
            }
            return indices;
        };
        if (action === 'reforge' && minimumValues) {
            const qualified = collect(ext => targetExtMatchesAny(ext, props, minimumValues));
            if (qualified.length) return qualified;
        }
        return collect(ext => props.includes(ext?.prop));
    }

    function targetKeepIndex(sword, targetProps, action, minimumValues = null) {
        return targetKeepIndices(sword, targetProps, action, minimumValues)[0] || 0;
    }

    function buildGrownSword(equipData, sword, target, generated, keepIndex) {
        const exts = generated.exts.map(item => ({ ...item }));
        let kept = null;
        if (keepIndex > 0) {
            kept = clone(sword.exts[keepIndex - 1]);
            exts.splice(0, 1);
            exts.unshift({ prop: kept.prop, value: kept.value });
        }
        const cfg = equipData.equipment[String(target)] || {};
        return {
            equip: {
                ...clone(sword),
                id: target,
                name: cfg.name || sword.name,
                need_lv: Number(cfg.lv) || sword.need_lv,
                typ: Number(cfg.type) || sword.typ,
                color: 6,
                exp: target === Number(sword.id) ? Number(sword.exp) || 0 : 0,
                base: generated.base,
                exts,
                CZSeed: generated.seedAfter,
            },
            keepIndex,
            kept,
        };
    }

    function growSwordVariants(equipData, sword, targetId, targetProps, rule) {
        if (!sword || !JIANWANG_SWORD_IDS.has(Number(sword.id))) throw new TypeError('起始剑无效');
        const fromId = Number(sword.id);
        const target = Number(targetId);
        const allowed = target === fromId
            ? JIANWANG_LEVEL_90_IDS.has(fromId)
            : (JIANWANG_GROW_TARGETS[fromId] || []).includes(target);
        if (!allowed) throw new RangeError(`不允许从 ${fromId} 成长到 ${target}`);
        const action = target === fromId ? 'reforge' : 'grow';
        const props = normalizeTargetProps(targetProps);
        const minimumValues = action === 'reforge'
            ? targetMinimumValuesForRoute(equipData, target, props)
            : null;
        const candidates = targetKeepIndices(sword, props, action, minimumValues);
        const keepIndices = props.length > 1 ? candidates : candidates.slice(0, 1);
        const generated = generateEquip(equipData, target, Number(sword.CZSeed), rule);
        return (keepIndices.length ? keepIndices : [0])
            .map(keepIndex => buildGrownSword(equipData, sword, target, generated, keepIndex));
    }

    function growSword(equipData, sword, targetId, targetProps, rule) {
        return growSwordVariants(equipData, sword, targetId, targetProps, rule)[0];
    }

    function normalizeTargetCount(value) {
        const count = Number(value == null ? 4 : value);
        if (!JIANWANG_TARGET_COUNTS.has(count)) throw new RangeError('指定词条目标只能选择后3词条相同或4x');
        return count;
    }

    function normalizeTargetMode(value, targetCount = 4) {
        if (value === 'tail3' || value === 'any3' || value === 'all4') return value;
        return normalizeTargetCount(targetCount) === 3 ? 'tail3' : 'all4';
    }

    function targetModeCount(targetMode) {
        return targetMode === 'all4' ? 4 : 3;
    }

    function targetModeLabel(targetMode) {
        if (targetMode === 'any3') return '任意3个词条相同';
        if (targetMode === 'all4') return '4条相同（词条1/2/3/4）';
        return '后3词条相同（词条2/3/4）';
    }

    function targetSlots(sword, targetMode) {
        if (!Array.isArray(sword?.exts) || sword.exts.length < 4) return [];
        return targetMode === 'tail3' ? sword.exts.slice(1, 4) : sword.exts.slice(0, 4);
    }

    function isTargetReached(sword, targetProps, targetCount = 4, targetMode = null) {
        const mode = normalizeTargetMode(targetMode, targetCount);
        const count = targetModeCount(mode);
        const props = normalizeTargetProps(targetProps);
        return targetSlots(sword, mode).filter(ext => props.includes(ext?.prop)).length >= count;
    }

    function isTargetReachedForRoute(equipData, routeId, sword, targetProps, targetCount = 4, targetMode = null) {
        const mode = normalizeTargetMode(targetMode, targetCount);
        const count = targetModeCount(mode);
        const props = normalizeTargetProps(targetProps);
        const minimumValues = targetMinimumValuesForRoute(equipData, routeId, props);
        if (Object.values(minimumValues).some(value => !Number.isFinite(value))) return false;
        return targetSlots(sword, mode)
            .filter(ext => targetExtMatchesAny(ext, props, minimumValues)).length >= count;
    }

    function isFourTarget(sword, targetProps) {
        return isTargetReached(sword, targetProps, 4);
    }

    function routeForSword(sword) {
        return Number(JIANWANG_SHATTER_ROUTE_IDS[Number(sword?.id)] || 0);
    }

    function routeTargetsFromSword(sword, routeId) {
        const id = Number(sword?.id);
        if (id === 5707) return [5708, 5709, routeId];
        if (id === 5708) return [5709, routeId];
        if (id === 5709) return [routeId];
        return [];
    }

    function routeOptions(equipData) {
        return Array.from(JIANWANG_LEVEL_90_IDS).map(id => ({
            id,
            name: equipData?.equipment?.[String(id)]?.name || String(id),
        }));
    }

    function targetPropertiesForRoute(equipData, routeId) {
        const cfg = equipData?.equipment?.[String(Number(routeId))];
        if (!cfg || !JIANWANG_LEVEL_90_IDS.has(Number(routeId))) return [];
        return JIANWANG_EXT_PROP_ORDER.filter(prop => Number(cfg.exts?.[prop]?.[0]) > 0 && Number(cfg.exts?.[prop]?.[1]) > 0);
    }

    function findSaveScalar(rootSave, wantedKey) {
        const seen = new Set();
        const unwrap = value => {
            if (typeof value === 'number' && Number.isFinite(value)) return value;
            if (typeof value === 'string' && value.trim() !== '' && Number.isFinite(Number(value))) return Number(value);
            if (value && typeof value === 'object') {
                for (const key of ['Value', 'value', 'V', 'v', 'Number', 'number']) {
                    if (Object.prototype.hasOwnProperty.call(value, key)) {
                        const parsed = unwrap(value[key]);
                        if (parsed != null) return parsed;
                    }
                }
            }
            return null;
        };
        const walk = value => {
            if (!value || typeof value !== 'object' || seen.has(value)) return null;
            seen.add(value);
            if (Object.prototype.hasOwnProperty.call(value, wantedKey)) {
                const direct = unwrap(value[wantedKey]);
                if (direct != null) return direct;
            }
            const items = Array.isArray(value) ? value : Object.values(value);
            for (const item of items) {
                const found = walk(item);
                if (found != null) return found;
            }
            return null;
        };
        return walk(rootSave);
    }

    function extractRedSeed(saveData) {
        const rootSave = Array.isArray(saveData) ? saveData[0] : saveData;
        const makeRnd = rootSave?.MakeRnd || saveData?.MakeRnd || (Array.isArray(saveData) ? saveData[0]?.MakeRnd : null);
        const value = Number(makeRnd?.RedSeeds?.[String(JIANWANG_BLANK_ID)] || 0);
        return Number.isSafeInteger(value) && value > 0 ? value : null;
    }

    function extractReforgeCounts(saveData) {
        const rootSave = Array.isArray(saveData) ? saveData[0] : saveData;
        const counts = {};
        for (const id of JIANWANG_LEVEL_90_IDS) {
            const value = findSaveScalar(rootSave, `again_${id}`);
            counts[String(id)] = Math.max(0, Math.min(JIANWANG_REFORGE_LIMIT, Math.floor(Number(value) || 0)));
        }
        return counts;
    }

    function normalizeMaxSwords(value) {
        const count = Math.floor(Number(value));
        if (!Number.isSafeInteger(count) || count < 1 || count > MAX_SIMULATED_SWORDS) {
            throw new RangeError(`最大模拟次数必须是 1–${MAX_SIMULATED_SWORDS} 的整数`);
        }
        return count;
    }

    function propName(equipData, prop) {
        return equipData?.propNames?.[prop] || prop;
    }

    function stageName(equipData, sword) {
        const id = Number(sword?.id);
        const cfg = equipData?.equipment?.[String(id)] || {};
        if (id === 5707) return '60级剑胚';
        if (id === 5708) return '70级剑胚';
        if (id === 5709) return '80级剑胚';
        if (JIANWANG_LEVEL_90_IDS.has(id)) return `90级专武 · ${cfg.name || sword?.name || id}`;
        if (JIANWANG_LEVEL_100_IDS.has(id)) return `100级神兵 · ${cfg.name || sword?.name || id}`;
        return cfg.name || sword?.name || String(id);
    }

    function swordLabel(equipData, sword) {
        const source = sword?._source || '存档';
        const onlyId = Number(sword?.only_id || 0);
        return `${source} · ${stageName(equipData, sword)} · ${onlyId > 0 ? `#${onlyId}` : '无OnlyID'}`;
    }

    function redSeedFirstSwordProvider({ equipData, redSeed }) {
        const sourceRedSeed = Number(redSeed);
        if (!Number.isSafeInteger(sourceRedSeed) || sourceRedSeed <= 0) return null;
        const created = createBlankFromRedSeed(equipData, sourceRedSeed, 1);
        return {
            sword: {
                ...created.equip,
                _source: '虚拟首剑',
                _provider: true,
                _jianwangVirtualFirst: true,
                _jianwangSwordIndex: 1,
            },
            redSeed: created.redSeedAfter,
            initialBuild: true,
        };
    }

    function setFirstSwordProvider(provider) {
        if (provider != null && typeof provider !== 'function') throw new TypeError('首剑生成 provider 必须是函数或 null');
        firstSwordProvider = provider || null;
    }

    function hasFirstSwordProvider() {
        return typeof firstSwordProvider === 'function';
    }

    function resolveProviderStart(input, state) {
        if (!hasFirstSwordProvider()) return null;
        const provided = firstSwordProvider({
            saveData: input.saveData,
            equipData: input.equipData,
            routeId: input.routeId,
            targetProp: state.targetProp,
            targetProps: clone(state.targetProps),
            targetCount: state.targetCount,
            targetMode: state.targetMode,
            redSeed: state.redSeed,
            reforgeCounts: clone(state.reforgeCounts),
        });
        if (!provided) return null;
        const sword = clone(provided.sword || provided.equip || provided);
        if (!sword || !JIANWANG_SWORD_IDS.has(Number(sword.id))) {
            throw new TypeError('首剑生成 provider 未返回有效的 5707～5717 起始剑');
        }
        sword._source = sword._source || '首剑生成接口';
        sword._provider = true;
        if (provided.redSeed != null) state.redSeed = Number(provided.redSeed) || null;
        if (provided.reforgeCounts) state.reforgeCounts = { ...state.reforgeCounts, ...clone(provided.reforgeCounts) };
        if (provided.rule === JIANWANG_RULE_STANDARD || provided.rule === JIANWANG_RULE_PATCHED) state.rule = provided.rule;
        if (provided.initialBuild === true) {
            state.providerStartConsumesSwordQuota = true;
            state.metrics.newSwords += 1;
            state.metrics.actions += 1;
            addInitialBuildResources(state.resources);
        }
        return sword;
    }

    function makeMetrics() {
        return { newSwords: 0, shatters: 0, shatter90: 0, shatter100: 0, grows: 0, reforges: 0, keeps: 0, actions: 0 };
    }

    function makeResources() {
        return { contribution: 0, swordIntent: 0, qi: 0, spent: {}, returned: {} };
    }

    function addMaterial(resources, bucket, itemId, count) {
        const amount = Number(count) || 0;
        if (!amount) return;
        const key = String(itemId);
        resources[bucket][key] = (Number(resources[bucket][key]) || 0) + amount;
    }

    function addGrowthResources(resources, fromId, targetId) {
        const from = Number(fromId);
        const target = Number(targetId);
        if (from === 5707 && target === 5708) {
            resources.swordIntent += 150;
            resources.contribution += 1200;
            addMaterial(resources, 'spent', 3024, 400);
            addMaterial(resources, 'spent', 2000, 20);
        } else if (from === 5708 && target === 5709) {
            resources.swordIntent += 300;
            resources.contribution += 2000;
            addMaterial(resources, 'spent', 3025, 200);
            addMaterial(resources, 'spent', 2020, 1);
        } else if (from === 5709 && JIANWANG_LEVEL_90_IDS.has(target)) {
            resources.swordIntent += 600;
            resources.contribution += 4000;
            addMaterial(resources, 'spent', 3025, 400);
            addMaterial(resources, 'spent', 2020, 2);
        }
    }

    function addReforgeResources(resources, attemptNumber) {
        const index = Math.min(JIANWANG_REFORGE_COSTS.length - 1, Math.max(0, Number(attemptNumber) - 1));
        const [coreA, coreB] = JIANWANG_REFORGE_COSTS[index];
        resources.qi += 500;
        addMaterial(resources, 'spent', 6516, coreA);
        addMaterial(resources, 'spent', 6517, coreB);
    }

    function addInitialBuildResources(resources) {
        resources.contribution += 500;
        addMaterial(resources, 'spent', 6518, 1);
        addMaterial(resources, 'spent', 3024, 200);
        addMaterial(resources, 'spent', 2000, 10);
    }

    function addShatterRebuildResources(resources) {
        resources.contribution += 1000;
        addMaterial(resources, 'returned', 6518, 1);
        addMaterial(resources, 'returned', 3024, 200);
        addMaterial(resources, 'returned', 3025, 300);
        addMaterial(resources, 'returned', 2000, 10);
        addMaterial(resources, 'returned', 2020, 2);
        addMaterial(resources, 'spent', 6518, 1);
        addMaterial(resources, 'spent', 3024, 200);
        addMaterial(resources, 'spent', 2000, 10);
    }

    function snapshotResources(resources) {
        const spent = clone(resources?.spent || {});
        const returned = clone(resources?.returned || {});
        const keys = new Set([...Object.keys(spent), ...Object.keys(returned)]);
        const netMaterials = {};
        for (const key of keys) {
            const net = (Number(spent[key]) || 0) - (Number(returned[key]) || 0);
            if (net) netMaterials[key] = net;
        }
        return {
            contribution: Number(resources?.contribution || 0),
            swordIntent: Number(resources?.swordIntent || 0),
            qi: Number(resources?.qi || 0),
            spent,
            returned,
            netMaterials,
        };
    }

    function makeStep(equipData, before, after, type, targetProps, kept, extra = {}) {
        const props = normalizeTargetProps(targetProps);
        return {
            type,
            fromId: Number(before?.id || 0),
            toId: Number(after?.id || 0),
            fromName: before ? stageName(equipData, before) : '',
            toName: after ? stageName(equipData, after) : '',
            seedBefore: Number(before?.CZSeed || 0),
            seedAfter: Number(after?.CZSeed || 0),
            kept: kept ? { prop: kept.prop, value: kept.value } : null,
            targetProp: props[0],
            targetProps: props,
            exts: clone(after?.exts || []),
            ...extra,
        };
    }

    function applyGrowStep(state, sword, targetId, path, type, reforgeAttempt = 0) {
        const before = clone(sword);
        const result = growSword(state.equipData, sword, targetId, state.targetProps, state.rule);
        const isReforge = targetId === Number(sword.id);
        state.metrics.grows += isReforge ? 0 : 1;
        state.metrics.reforges += isReforge ? 1 : 0;
        state.metrics.actions += 1;
        if (result.keepIndex > 0) state.metrics.keeps += 1;
        if (isReforge) addReforgeResources(state.resources, reforgeAttempt);
        else addGrowthResources(state.resources, Number(sword.id), targetId);
        path.push(makeStep(state.equipData, before, result.equip, type, state.targetProps, result.kept, {
            keepIndex: result.keepIndex,
            reforgeAttempt: isReforge ? Number(reforgeAttempt) || 0 : 0,
        }));
        return result.equip;
    }

    function dualBranchKey(branch) {
        const sword = branch?.sword || {};
        const exts = Array.isArray(sword.exts)
            ? sword.exts.map(ext => `${ext?.prop || ''}:${String(ext?.value)}`).join('|')
            : '';
        return `${Number(sword.id) || 0}:${Number(sword.CZSeed) || 0}:${exts}`;
    }

    function dedupeDualBranches(branches) {
        const seen = new Set();
        const unique = [];
        for (const branch of branches) {
            const key = dualBranchKey(branch);
            if (seen.has(key)) continue;
            seen.add(key);
            unique.push(branch);
        }
        return unique;
    }

    function advanceDualBranches(state, branches, targetId, type, reforgeAttempt = 0) {
        const isReforge = Number(targetId) === Number(branches[0]?.sword?.id);
        state.metrics.grows += isReforge ? 0 : 1;
        state.metrics.reforges += isReforge ? 1 : 0;
        state.metrics.actions += 1;
        if (isReforge) addReforgeResources(state.resources, reforgeAttempt);
        else addGrowthResources(state.resources, Number(branches[0]?.sword?.id), targetId);
        const nextBranches = [];
        let keptInAction = false;
        for (const branch of branches) {
            const before = clone(branch.sword);
            const variants = growSwordVariants(state.equipData, branch.sword, targetId, state.targetProps, state.rule);
            for (const result of variants) {
                if (result.keepIndex > 0) keptInAction = true;
                const path = clone(branch.path || []);
                path.push(makeStep(state.equipData, before, result.equip, type, state.targetProps, result.kept, {
                    keepIndex: result.keepIndex,
                    reforgeAttempt: isReforge ? Number(reforgeAttempt) || 0 : 0,
                }));
                nextBranches.push({ sword: result.equip, path });
            }
        }
        if (keptInAction) state.metrics.keeps += 1;
        return dedupeDualBranches(nextBranches);
    }

    function targetNames(state) {
        return state.targetProps.map(prop => propName(state.equipData, prop));
    }

    function successResult(state, sword, path, swordOrdinal, finalAction, startedFromCurrent) {
        if (state.dualTarget) {
            const resources = snapshotResources(state.resources);
            return {
                status: 'success',
                swordOrdinal,
                startedFromCurrent: !!startedFromCurrent,
                finalAction,
                finalEquip: {
                    id: Number(sword?.id || 0),
                    name: sword?.name || '',
                    CZSeed: Number(sword?.CZSeed || 0),
                    exts: clone(sword?.exts || []),
                },
                path: [],
                metrics: { shatters: Number(state.metrics.shatters || 0) },
                resources: {
                    contribution: resources.contribution,
                    swordIntent: resources.swordIntent,
                    qi: resources.qi,
                    netMaterials: resources.netMaterials,
                },
            };
        }
        const names = targetNames(state);
        return {
            status: 'success',
            targetProp: state.targetProp,
            targetProps: clone(state.targetProps),
            targetName: names.join(' / '),
            targetNames: names,
            dualTarget: false,
            targetCount: state.targetCount,
            targetMode: state.targetMode,
            routeId: state.routeId,
            routeName: state.equipData?.equipment?.[String(state.routeId)]?.name || String(state.routeId),
            swordOrdinal,
            startedFromCurrent: !!startedFromCurrent,
            finalAction,
            finalEquip: clone(sword),
            path: clone(path),
            metrics: clone(state.metrics),
            resources: snapshotResources(state.resources),
            maxSwords: state.maxSwords,
            startSword: clone(state.startSword),
            startSwordLabel: state.startSword ? swordLabel(state.equipData, state.startSword) : '首剑生成接口',
        };
    }

    function multiSuccessResult(state, reason, stopReason) {
        const names = targetNames(state);
        return {
            status: 'multi-success',
            reason,
            stopReason,
            targetProp: state.targetProp,
            targetProps: clone(state.targetProps),
            targetName: names.join(' / '),
            targetNames: names,
            dualTarget: state.dualTarget,
            targetCount: state.targetCount,
            targetMode: state.targetMode,
            routeId: state.routeId,
            routeName: state.equipData?.equipment?.[String(state.routeId)]?.name || String(state.routeId),
            successCount: state.matches.length,
            successLimit: state.dualTarget ? null : (state.targetCount === 3 ? THREE_TARGET_SUCCESS_LIMIT : null),
            matches: clone(state.matches),
            metrics: clone(state.metrics),
            resources: snapshotResources(state.resources),
            maxSwords: state.maxSwords,
            startSword: clone(state.startSword),
            startSwordLabel: state.startSword ? swordLabel(state.equipData, state.startSword) : '首剑生成接口',
        };
    }

    function collectTargetHit(state, sword, path, swordOrdinal, finalAction, startedFromCurrent) {
        if (!isTargetReachedForRoute(state.equipData, state.routeId, sword, state.targetProps, state.targetCount, state.targetMode)) return null;
        const result = successResult(state, sword, path, swordOrdinal, finalAction, startedFromCurrent);
        if (state.dualTarget) {
            state.matches.push(result);
            return { success: null, threeLimitReached: false };
        }
        if (state.targetCount === 4) return { success: result, threeLimitReached: false };
        state.matches.push(result);
        return { success: null, threeLimitReached: state.matches.length >= THREE_TARGET_SUCCESS_LIMIT };
    }

    function simulateCandidateSwordLinear(state, startSword, reforgeCompleted, swordOrdinal, startedFromCurrent) {
        let sword = clone(startSword);
        const path = [];
        const routeTargets = routeTargetsFromSword(sword, state.routeId);
        for (const targetId of routeTargets) {
            sword = applyGrowStep(state, sword, targetId, path, 'grow');
            const hit = collectTargetHit(state, sword, path, swordOrdinal, `升至${stageName(state.equipData, sword)}`, startedFromCurrent);
            if (hit?.success) return { success: hit.success, sword };
            if (hit?.threeLimitReached) return { success: null, threeLimitReached: true, sword, path };
        }
        if (!JIANWANG_LEVEL_90_IDS.has(Number(sword.id)) || Number(sword.id) !== state.routeId) {
            throw new RangeError('候选剑未能进入所选90级路线');
        }
        if (!routeTargets.length) {
            const hit = collectTargetHit(state, sword, path, swordOrdinal, '当前90级状态', startedFromCurrent);
            if (hit?.success) return { success: hit.success, sword };
            if (hit?.threeLimitReached) return { success: null, threeLimitReached: true, sword, path };
        }
        const completed = Math.max(0, Math.min(JIANWANG_REFORGE_LIMIT, Math.floor(Number(reforgeCompleted) || 0)));
        for (let attempt = completed + 1; attempt <= JIANWANG_REFORGE_LIMIT; attempt++) {
            sword = applyGrowStep(state, sword, Number(sword.id), path, 'reforge', attempt);
            const hit = collectTargetHit(state, sword, path, swordOrdinal, `第${attempt}次重铸`, startedFromCurrent);
            if (hit?.success) return { success: hit.success, sword };
            if (hit?.threeLimitReached) return { success: null, threeLimitReached: true, sword, path };
        }
        return { success: null, threeLimitReached: false, sword, path };
    }

    function collectDualBranchHits(state, branches, swordOrdinal, finalAction, startedFromCurrent) {
        for (const branch of branches) {
            collectTargetHit(state, branch.sword, branch.path, swordOrdinal, finalAction, startedFromCurrent);
        }
    }

    function simulateCandidateSwordDual(state, startSword, reforgeCompleted, swordOrdinal, startedFromCurrent) {
        let branches = [{ sword: clone(startSword), path: [] }];
        const routeTargets = routeTargetsFromSword(startSword, state.routeId);
        for (const targetId of routeTargets) {
            branches = advanceDualBranches(state, branches, targetId, 'grow');
            collectDualBranchHits(state, branches, swordOrdinal, `升至${stageName(state.equipData, branches[0].sword)}`, startedFromCurrent);
        }
        const routeSword = branches[0]?.sword;
        if (!JIANWANG_LEVEL_90_IDS.has(Number(routeSword?.id)) || Number(routeSword?.id) !== state.routeId) {
            throw new RangeError('候选剑未能进入所选90级路线');
        }
        if (!routeTargets.length) {
            collectDualBranchHits(state, branches, swordOrdinal, '当前90级状态', startedFromCurrent);
        }
        const completed = Math.max(0, Math.min(JIANWANG_REFORGE_LIMIT, Math.floor(Number(reforgeCompleted) || 0)));
        for (let attempt = completed + 1; attempt <= JIANWANG_REFORGE_LIMIT; attempt++) {
            branches = advanceDualBranches(state, branches, Number(routeSword.id), 'reforge', attempt);
            collectDualBranchHits(state, branches, swordOrdinal, `第${attempt}次重铸`, startedFromCurrent);
        }
        const representative = branches[0];
        return {
            success: null,
            threeLimitReached: false,
            sword: representative.sword,
            path: representative.path,
        };
    }

    function simulateCandidateSword(state, startSword, reforgeCompleted, swordOrdinal, startedFromCurrent) {
        if (state.dualTarget) {
            return simulateCandidateSwordDual(state, startSword, reforgeCompleted, swordOrdinal, startedFromCurrent);
        }
        return simulateCandidateSwordLinear(state, startSword, reforgeCompleted, swordOrdinal, startedFromCurrent);
    }

    function buildState(input) {
        const equipData = input.equipData;
        if (!equipData?.equipment) throw new TypeError('缺少装备数据');
        const routeId = Number(input.routeId);
        if (!JIANWANG_LEVEL_90_IDS.has(routeId)) throw new TypeError('请选择90级镇派路线');
        const targetProps = normalizeTargetProps(input.targetProps?.length ? input.targetProps : input.targetProp);
        const allowedProps = targetPropertiesForRoute(equipData, routeId);
        if (targetProps.some(prop => !allowedProps.includes(prop))) throw new TypeError('所选词条不属于该90级路线');
        const targetMode = normalizeTargetMode(input.targetMode, input.targetCount);
        const targetCount = targetModeCount(targetMode);
        const swords = collectSwords(input.saveData, equipData);
        const detection = detectRuleFromSwords(swords);
        const state = {
            equipData,
            saveData: input.saveData,
            routeId,
            targetProp: targetProps[0],
            targetProps,
            dualTarget: false,
            targetCount,
            targetMode,
            maxSwords: normalizeMaxSwords(input.maxSwords),
            swords,
            rule: detection.rule,
            redSeed: input.redSeed != null ? Number(input.redSeed) : extractRedSeed(input.saveData),
            reforgeCounts: input.reforgeCounts ? clone(input.reforgeCounts) : extractReforgeCounts(input.saveData),
            metrics: makeMetrics(),
            resources: makeResources(),
            matches: [],
            startSword: null,
            currentForShatter: null,
            providerStartConsumesSwordQuota: false,
        };
        let startSword = input.startSword ? clone(input.startSword) : null;
        if (!startSword && input.startSwordKey) startSword = clone(swords.find(sword => sword.key === String(input.startSwordKey)) || null);
        if (!startSword && swords.length === 1 && input.startSwordKey == null) startSword = clone(swords[0]);
        if (!startSword && swords.length === 0) startSword = resolveProviderStart(input, state);
        if (!startSword) {
            const error = new Error(swords.length ? '请选择起始剑' : '当前存档没有剑王阁实物，且缺少可用于推演首剑的 RedSeeds[5707]');
            error.code = swords.length ? 'START_SWORD_REQUIRED' : 'NO_SWORD_PROVIDER';
            throw error;
        }
        if (!JIANWANG_SWORD_IDS.has(Number(startSword.id))) throw new TypeError('起始剑必须是5707～5717剑王阁装备');
        state.startSword = clone(startSword);
        return state;
    }

    function prepareInitial(state) {
        const start = clone(state.startSword);
        const id = Number(start.id);
        const route = routeForSword(start);
        if (state.rule === JIANWANG_RULE_STANDARD && !state.dualTarget) {
            if (JIANWANG_LEVEL_90_IDS.has(id) && route === state.routeId
                && isTargetReachedForRoute(state.equipData, state.routeId, start, state.targetProps, state.targetCount, state.targetMode)) {
                const current = successResult(state, start, [], 0, '当前90级状态', true);
                if (state.targetCount === 4) return current;
                state.matches.push(current);
                return multiSuccessResult(state, `当前起始剑已满足${targetModeLabel(state.targetMode)}；后续序列无法继续产生新的同词结果`, 'unreachable');
            }
            const names = targetNames(state);
            return {
                status: 'unreachable',
                reason: `当前序列下无法产生${targetModeLabel(state.targetMode)}的新词条`,
                targetProp: state.targetProp,
                targetProps: clone(state.targetProps),
                targetName: names.join(' / '),
                targetNames: names,
                dualTarget: false,
                targetCount: state.targetCount,
                targetMode: state.targetMode,
                routeId: state.routeId,
                metrics: clone(state.metrics),
                resources: snapshotResources(state.resources),
                maxSwords: state.maxSwords,
            };
        }
        if (JIANWANG_LEVEL_100_IDS.has(id)) {
            state.currentForShatter = start;
            return null;
        }
        if (JIANWANG_LEVEL_90_IDS.has(id) && route !== state.routeId) {
            state.currentForShatter = start;
            return null;
        }
        const completed = Math.max(0, Math.floor(Number(state.reforgeCounts[String(state.routeId)]) || 0));
        const startOrdinal = state.providerStartConsumesSwordQuota ? 1 : 0;
        const candidate = simulateCandidateSword(state, start, completed, startOrdinal, true);
        if (candidate.success) return candidate.success;
        if (candidate.threeLimitReached) {
            return multiSuccessResult(state, `已找到 ${THREE_TARGET_SUCCESS_LIMIT} 次${targetModeLabel(state.targetMode)}结果，提前停止`, 'success-limit');
        }
        state.currentForShatter = candidate.sword;
        return null;
    }

    function generateNextCandidate(state, ordinal) {
        if (!state.currentForShatter) throw new Error('缺少可碎剑状态');
        const fromId = Number(state.currentForShatter.id);
        if (!JIANWANG_LEVEL_90_IDS.has(fromId) && !JIANWANG_LEVEL_100_IDS.has(fromId)) {
            throw new Error('只有90级专武或100级神兵可以进入下一把剑');
        }
        if (!Number.isSafeInteger(Number(state.redSeed)) || Number(state.redSeed) <= 0) {
            const error = new Error('存档缺少有效 MakeRnd.RedSeeds[5707]，无法生成下一把60级剑胚');
            error.code = 'MISSING_REDSEED';
            throw error;
        }
        state.metrics.shatters += 1;
        if (JIANWANG_LEVEL_100_IDS.has(fromId)) state.metrics.shatter100 += 1;
        else state.metrics.shatter90 += 1;
        addShatterRebuildResources(state.resources);
        const created = createBlankFromRedSeed(state.equipData, state.redSeed, ordinal);
        state.redSeed = created.redSeedAfter;
        state.metrics.newSwords += 1;
        state.metrics.actions += 1;
        const matchesBefore = state.matches.length;
        const candidate = simulateCandidateSword(state, created.equip, 0, ordinal, false);
        const blankStep = {
            type: 'blank',
            fromId: fromId,
            toId: JIANWANG_BLANK_ID,
            fromName: stageName(state.equipData, state.currentForShatter),
            toName: stageName(state.equipData, created.equip),
            redSeedBefore: created.redSeedBefore,
            redSeedAfter: created.redSeedAfter,
            seedBefore: 0,
            seedAfter: Number(created.equip.CZSeed || 0),
            kept: null,
            targetProp: state.targetProp,
            targetProps: clone(state.targetProps),
            exts: clone(created.equip.exts || []),
            swordOrdinal: ordinal,
        };
        if (candidate.success) {
            candidate.success.path.unshift(blankStep);
            return candidate.success;
        }
        if (!state.dualTarget && state.targetCount === 3 && state.matches.length > matchesBefore) {
            for (let index = matchesBefore; index < state.matches.length; index++) {
                state.matches[index].path.unshift(clone(blankStep));
            }
        }
        if (candidate.threeLimitReached) {
            return multiSuccessResult(state, `已找到 ${THREE_TARGET_SUCCESS_LIMIT} 次${targetModeLabel(state.targetMode)}结果，提前停止`, 'success-limit');
        }
        state.currentForShatter = candidate.sword;
        return null;
    }

    function terminalLimitResult(state) {
        const names = targetNames(state);
        if (state.matches.length && (state.dualTarget || state.targetCount === 3)) {
            return multiSuccessResult(
                state,
                `已完成 ${state.metrics.shatters} 次碎剑循环，找到 ${state.matches.length} 笔${targetModeLabel(state.targetMode)}结果`,
                'max-swords',
            );
        }
        return {
            status: 'limit',
            reason: `已完成 ${state.metrics.shatters} 次碎剑循环，未找到${targetModeLabel(state.targetMode)}结果`,
            targetProp: state.targetProp,
            targetProps: clone(state.targetProps),
            targetName: names.join(' / '),
            targetNames: names,
            dualTarget: state.dualTarget,
            targetCount: state.targetCount,
            targetMode: state.targetMode,
            routeId: state.routeId,
            routeName: state.equipData?.equipment?.[String(state.routeId)]?.name || String(state.routeId),
            metrics: clone(state.metrics),
            resources: snapshotResources(state.resources),
            maxSwords: state.maxSwords,
            startSword: clone(state.startSword),
            startSwordLabel: swordLabel(state.equipData, state.startSword),
        };
    }

    function search(input) {
        const state = buildState(input);
        const initial = prepareInitial(state);
        if (initial) return initial;
        for (let ordinal = state.metrics.newSwords + 1; ordinal <= state.maxSwords; ordinal++) {
            const success = generateNextCandidate(state, ordinal);
            if (success) return success;
        }
        return terminalLimitResult(state);
    }

    async function searchAsync(input) {
        const state = buildState(input);
        const initial = prepareInitial(state);
        if (initial) return initial;
        const batchSize = Math.max(1, Math.min(500, Math.floor(Number(input.batchSize) || DEFAULT_BATCH_SIZE)));
        const onProgress = typeof input.onProgress === 'function' ? input.onProgress : null;
        const shouldCancel = typeof input.shouldCancel === 'function' ? input.shouldCancel : () => false;
        const yieldControl = typeof input.yieldControl === 'function'
            ? input.yieldControl
            : () => new Promise(resolve => setTimeout(resolve, 0));
        for (let ordinal = state.metrics.newSwords + 1; ordinal <= state.maxSwords; ordinal++) {
            if (shouldCancel()) {
                return {
                    status: 'cancelled',
                    reason: '用户取消',
                    targetProp: state.targetProp,
                    targetProps: clone(state.targetProps),
                    targetName: targetNames(state).join(' / '),
                    targetNames: targetNames(state),
                    dualTarget: state.dualTarget,
                    targetCount: state.targetCount,
                    targetMode: state.targetMode,
                    routeId: state.routeId,
                    routeName: state.equipData?.equipment?.[String(state.routeId)]?.name || String(state.routeId),
                    successCount: state.matches.length,
                    matches: clone(state.matches),
                    metrics: clone(state.metrics),
                    resources: snapshotResources(state.resources),
                    maxSwords: state.maxSwords,
                    startSword: clone(state.startSword),
                    startSwordLabel: state.startSword ? swordLabel(state.equipData, state.startSword) : '首剑生成接口',
                };
            }
            const success = generateNextCandidate(state, ordinal);
            if (success) {
                if (onProgress) {
                    const message = !state.dualTarget && state.targetCount === 3
                        ? `已找到 ${state.matches.length}/${THREE_TARGET_SUCCESS_LIMIT} 次${targetModeLabel(state.targetMode)}结果`
                        : `第 ${ordinal} 把新剑找到结果`;
                    onProgress({ done: ordinal, total: state.maxSwords, metrics: clone(state.metrics), matches: state.matches.length, message });
                }
                return success;
            }
            if (onProgress && (ordinal === 1 || ordinal % batchSize === 0 || ordinal === state.maxSwords)) {
                let matchText = '';
                if (state.dualTarget) matchText = ` · 命中 ${state.matches.length}`;
                else if (state.targetCount === 3) matchText = ` · ${targetModeLabel(state.targetMode)} ${state.matches.length}/${THREE_TARGET_SUCCESS_LIMIT}`;
                onProgress({
                    done: ordinal,
                    total: state.maxSwords,
                    metrics: clone(state.metrics),
                    matches: state.matches.length,
                    message: `已完成 ${state.metrics.shatters} 次碎剑循环${matchText}`,
                });
            }
            if (ordinal % batchSize === 0) await yieldControl();
        }
        return terminalLimitResult(state);
    }

    root.JianwangAutoOptimizer = Object.freeze({
        JIANWANG_RULE_PATCHED,
        JIANWANG_RULE_STANDARD,
        JIANWANG_REFORGE_LIMIT,
        JIANWANG_RESOURCE_NAMES,
        THREE_TARGET_SUCCESS_LIMIT,
        MAX_SIMULATED_SWORDS,
        collectSwords,
        swordKey,
        swordLabel,
        stageName,
        classifyExtSeedBatch,
        detectRuleFromSwords,
        routeOptions,
        targetPropertiesForRoute,
        normalizeTargetProps,
        targetMinimumValueForRoute,
        targetMinimumValuesForRoute,
        extractRedSeed,
        extractReforgeCounts,
        generateEquip,
        createBlankFromRedSeed,
        growSword,
        isTargetReached,
        isTargetReachedForRoute,
        isFourTarget,
        targetKeepIndex,
        redSeedFirstSwordProvider,
        setFirstSwordProvider,
        hasFirstSwordProvider,
        search,
        searchAsync,
    });
})(typeof window !== 'undefined' ? window : globalThis);
