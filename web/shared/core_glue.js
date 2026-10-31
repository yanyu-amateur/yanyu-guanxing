let wasmExports = null;
let wasmReady = false;
let wasmMakeTables = null;


let cachedDataViewMemory0 = null;
let cachedUint8ArrayMemory0 = null;
let WASM_VECTOR_LEN = 0;

let cachedTextDecoder = new TextDecoder('utf-8', { ignoreBOM: true, fatal: true });
cachedTextDecoder.decode();
const MAX_SAFARI_DECODE_BYTES = 2146435072;
let numBytesDecoded = 0;

const cachedTextEncoder = new TextEncoder();
if (!('encodeInto' in cachedTextEncoder)) {
    cachedTextEncoder.encodeInto = function (arg, view) {
        const buf = cachedTextEncoder.encode(arg);
        view.set(buf);
        return { read: arg.length, written: buf.length };
    };
}

function getDataViewMemory0() {
    if (cachedDataViewMemory0 === null || cachedDataViewMemory0.buffer.detached === true ||
        (cachedDataViewMemory0.buffer.detached === undefined && cachedDataViewMemory0.buffer !== wasmExports.memory.buffer)) {
        cachedDataViewMemory0 = new DataView(wasmExports.memory.buffer);
    }
    return cachedDataViewMemory0;
}

function getUint8ArrayMemory0() {
    if (cachedUint8ArrayMemory0 === null || cachedUint8ArrayMemory0.byteLength === 0) {
        cachedUint8ArrayMemory0 = new Uint8Array(wasmExports.memory.buffer);
    }
    return cachedUint8ArrayMemory0;
}

function decodeText(ptr, len) {
    numBytesDecoded += len;
    if (numBytesDecoded >= MAX_SAFARI_DECODE_BYTES) {
        cachedTextDecoder = new TextDecoder('utf-8', { ignoreBOM: true, fatal: true });
        cachedTextDecoder.decode();
        numBytesDecoded = len;
    }
    return cachedTextDecoder.decode(getUint8ArrayMemory0().subarray(ptr, ptr + len));
}

function getStringFromWasm0(ptr, len) {
    return decodeText(ptr >>> 0, len);
}

function passStringToWasm0(arg, malloc, realloc) {
    if (realloc === undefined) {
        const buf = cachedTextEncoder.encode(arg);
        const ptr = malloc(buf.length, 1) >>> 0;
        getUint8ArrayMemory0().subarray(ptr, ptr + buf.length).set(buf);
        WASM_VECTOR_LEN = buf.length;
        return ptr;
    }

    let len = arg.length;
    let ptr = malloc(len, 1) >>> 0;
    const mem = getUint8ArrayMemory0();
    let offset = 0;

    for (; offset < len; offset++) {
        const code = arg.charCodeAt(offset);
        if (code > 0x7F) break;
        mem[ptr + offset] = code;
    }
    if (offset !== len) {
        if (offset !== 0) arg = arg.slice(offset);
        ptr = realloc(ptr, len, len = offset + arg.length * 3, 1) >>> 0;
        const view = getUint8ArrayMemory0().subarray(ptr + offset, ptr + len);
        const ret = cachedTextEncoder.encodeInto(arg, view);
        offset += ret.written;
        ptr = realloc(ptr, len, offset, 1) >>> 0;
    }

    WASM_VECTOR_LEN = offset;
    return ptr;
}

function base64ToUint8Array(b64) {
    const binary = atob(b64);
    const len = binary.length;
    const bytes = new Uint8Array(len);
    for (let i = 0; i < len; i++) {
        bytes[i] = binary.charCodeAt(i);
    }
    return bytes;
}

function isWasmBinary(bytes) {
    const view = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
    return view.length >= 4 &&
        view[0] === 0x00 && view[1] === 0x61 &&
        view[2] === 0x73 && view[3] === 0x6d;
}


async function initWasm() {
    try {
        const imports = {
            './wasm_core_bg.js': {
                __wbg_random_95ef1cd58b1a3d73: function() {
                    return Math.random();
                },
            },
        };

        let bytes = null;

        if (location.protocol !== 'file:') {
            try {
                const response = await fetch('pkg/wasm_core_bg.wasm');
                if (response.ok) {
                    const fetchedBytes = await response.arrayBuffer();
                    if (isWasmBinary(fetchedBytes)) {
                        bytes = fetchedBytes;
                    } else {
                        console.warn('HTTP 返回的 WASM 数据无效，降级使用内嵌 Base64。');
                    }
                }
            } catch (e) {
                console.warn('HTTP fetch WASM 失败，降级使用内嵌 Base64:', e);
            }
        }

        if (!bytes && typeof EMBEDDED_WASM_B64 !== 'undefined' && EMBEDDED_WASM_B64) {
            bytes = base64ToUint8Array(EMBEDDED_WASM_B64);
        }

        if (!bytes) {
            throw new Error('无法获取 WASM 模块数据。请检查 WASM 文件或内嵌数据是否完整。');
        }

        const { instance } = await WebAssembly.instantiate(bytes, imports);

        wasmExports = instance.exports;
        cachedDataViewMemory0 = null;
        cachedUint8ArrayMemory0 = null;
        wasmReady = true;
        return true;
    } catch (e) {
        console.error('WASM 加载失败:', e);
        return false;
    }
}


function _callStringReturn(fn) {
    let d0, d1;
    try {
        const retptr = wasmExports.__wbindgen_add_to_stack_pointer(-16);
        fn(retptr);
        const r0 = getDataViewMemory0().getInt32(retptr + 0, true);
        const r1 = getDataViewMemory0().getInt32(retptr + 4, true);
        d0 = r0; d1 = r1;
        return getStringFromWasm0(r0, r1);
    } finally {
        wasmExports.__wbindgen_add_to_stack_pointer(16);
        wasmExports.__wbindgen_export3(d0, d1, 1);
    }
}

function wasmInitEngine(talentData, zzData) {
    if (!wasmReady) return false;
    const tj = JSON.stringify(talentData);
    const zj = JSON.stringify(zzData);
    const ptr0 = passStringToWasm0(tj, wasmExports.__wbindgen_export, wasmExports.__wbindgen_export2);
    const len0 = WASM_VECTOR_LEN;
    const ptr1 = passStringToWasm0(zj, wasmExports.__wbindgen_export, wasmExports.__wbindgen_export2);
    const len1 = WASM_VECTOR_LEN;
    return wasmExports.init_engine(ptr0, len0, ptr1, len1) !== 0;
}

function wasmSetState(stateObj) {
    if (!wasmReady) return false;
    const json = JSON.stringify(stateObj);
    const ptr = passStringToWasm0(json, wasmExports.__wbindgen_export, wasmExports.__wbindgen_export2);
    const len = WASM_VECTOR_LEN;
    return wasmExports.set_state(ptr, len) !== 0;
}

function wasmGetState() {
    if (!wasmReady) return null;
    try {
        return JSON.parse(_callStringReturn(r => wasmExports.get_state(r)));
    } catch { return null; }
}

function wasmDoWash() {
    if (!wasmReady) return null;
    try {
        const json = _callStringReturn(r => wasmExports.do_wash(r));
        return json === 'null' ? null : JSON.parse(json);
    } catch { return null; }
}

function wasmWashMulti(times) {
    if (!wasmReady) return [];
    try {
        let d0, d1;
        const retptr = wasmExports.__wbindgen_add_to_stack_pointer(-16);
        try {
            wasmExports.wash_multi(retptr, times);
            const r0 = getDataViewMemory0().getInt32(retptr + 0, true);
            const r1 = getDataViewMemory0().getInt32(retptr + 4, true);
            d0 = r0; d1 = r1;
            return JSON.parse(getStringFromWasm0(r0, r1));
        } finally {
            wasmExports.__wbindgen_add_to_stack_pointer(16);
            wasmExports.__wbindgen_export3(d0, d1, 1);
        }
    } catch { return []; }
}

function wasmWashUntilGold(maxIterations) {
    if (!wasmReady) return [];
    try {
        let d0, d1;
        const retptr = wasmExports.__wbindgen_add_to_stack_pointer(-16);
        try {
            wasmExports.wash_until_gold(retptr, maxIterations);
            const r0 = getDataViewMemory0().getInt32(retptr + 0, true);
            const r1 = getDataViewMemory0().getInt32(retptr + 4, true);
            d0 = r0; d1 = r1;
            return JSON.parse(getStringFromWasm0(r0, r1));
        } finally {
            wasmExports.__wbindgen_add_to_stack_pointer(16);
            wasmExports.__wbindgen_export3(d0, d1, 1);
        }
    } catch { return []; }
}

function wasmWashUntilTalentName(name, maxIterations) {
    if (!wasmReady) return [];
    try {
        let d0, d1;
        const retptr = wasmExports.__wbindgen_add_to_stack_pointer(-16);
        try {
            const ptr = passStringToWasm0(String(name || ''), wasmExports.__wbindgen_export, wasmExports.__wbindgen_export2);
            const len = WASM_VECTOR_LEN;
            wasmExports.wash_until_talent_name(retptr, ptr, len, maxIterations >>> 0);
            const r0 = getDataViewMemory0().getInt32(retptr + 0, true);
            const r1 = getDataViewMemory0().getInt32(retptr + 4, true);
            d0 = r0; d1 = r1;
            return JSON.parse(getStringFromWasm0(r0, r1));
        } finally {
            wasmExports.__wbindgen_add_to_stack_pointer(16);
            wasmExports.__wbindgen_export3(d0, d1, 1);
        }
    } catch (e) {
        console.error('wash_until_talent_name failed', e);
        return [];
    }
}

function wasmPreviewSequence(maxWashes) {
    if (!wasmReady) return [];
    try {
        let d0, d1;
        const retptr = wasmExports.__wbindgen_add_to_stack_pointer(-16);
        try {
            wasmExports.preview_sequence(retptr, maxWashes);
            const r0 = getDataViewMemory0().getInt32(retptr + 0, true);
            const r1 = getDataViewMemory0().getInt32(retptr + 4, true);
            d0 = r0; d1 = r1;
            return JSON.parse(getStringFromWasm0(r0, r1));
        } finally {
            wasmExports.__wbindgen_add_to_stack_pointer(16);
            wasmExports.__wbindgen_export3(d0, d1, 1);
        }
    } catch { return []; }
}

function wasmPreviewExchangePads(targets, maxPad) {
    if (!wasmReady) return [];
    try {
        let d0, d1;
        const retptr = wasmExports.__wbindgen_add_to_stack_pointer(-16);
        try {
            const json = JSON.stringify(targets || []);
            const ptr = passStringToWasm0(json, wasmExports.__wbindgen_export, wasmExports.__wbindgen_export2);
            const len = WASM_VECTOR_LEN;
            wasmExports.preview_exchange_pads(retptr, ptr, len, maxPad >>> 0);
            const r0 = getDataViewMemory0().getInt32(retptr + 0, true);
            const r1 = getDataViewMemory0().getInt32(retptr + 4, true);
            d0 = r0; d1 = r1;
            return JSON.parse(getStringFromWasm0(r0, r1));
        } finally {
            wasmExports.__wbindgen_add_to_stack_pointer(16);
            wasmExports.__wbindgen_export3(d0, d1, 1);
        }
    } catch (e) {
        console.error('preview_exchange_pads failed', e);
        return [];
    }
}

function wasmExchangeTalent(index) {
    if (!wasmReady) return null;
    try {
        let d0, d1;
        const retptr = wasmExports.__wbindgen_add_to_stack_pointer(-16);
        try {
            wasmExports.exchange_talent(retptr, index);
            const r0 = getDataViewMemory0().getInt32(retptr + 0, true);
            const r1 = getDataViewMemory0().getInt32(retptr + 4, true);
            d0 = r0; d1 = r1;
            return JSON.parse(getStringFromWasm0(r0, r1));
        } finally {
            wasmExports.__wbindgen_add_to_stack_pointer(16);
            wasmExports.__wbindgen_export3(d0, d1, 1);
        }
    } catch { return null; }
}

function wasmDecryptSave(b64Text) {
    if (!wasmReady) throw new Error('WASM 未加载');
    let d0, d1;
    const retptr = wasmExports.__wbindgen_add_to_stack_pointer(-16);
    try {
        const ptr = passStringToWasm0(b64Text, wasmExports.__wbindgen_export, wasmExports.__wbindgen_export2);
        const len = WASM_VECTOR_LEN;
        wasmExports.decrypt_save(retptr, ptr, len);
        const r0 = getDataViewMemory0().getInt32(retptr + 0, true);
        const r1 = getDataViewMemory0().getInt32(retptr + 4, true);
        d0 = r0; d1 = r1;
        const result = getStringFromWasm0(r0, r1);
        const parsed = JSON.parse(result);
        if (parsed && parsed.error) throw new Error(parsed.error);
        return parsed;
    } finally {
        wasmExports.__wbindgen_add_to_stack_pointer(16);
        wasmExports.__wbindgen_export3(d0, d1, 1);
    }
}

function wasmGetAvailableTalents() {
    if (!wasmReady) return [];
    try {
        return JSON.parse(_callStringReturn(r => wasmExports.get_available_talents(r)));
    } catch { return []; }
}

function wasmGetConflicts() {
    if (!wasmReady) return [];
    try {
        return JSON.parse(_callStringReturn(r => wasmExports.get_conflicts(r)));
    } catch { return []; }
}


const FIXED_ORANGE_EXT_PROP_ORDER = Object.freeze([
    'atk_add', 'hit_add', 'def_add', 'hp_add', 'speed_add', 'dodge_add', 'parry_add',
    'def_ign', 'unarmed_add', 'sword_add', 'blade_add', 'stick_add', 'hp_back',
    'mp_back', 'mp_f', 'dmg_off', 'dmg_ref', 'blood', 'renxing', 'po_parry',
    'po_dodge', 'atk_extend', 'xx_prob', 'xx_crit', 'gangqi', 'neij',
]);
const FIXED_ORANGE_EXT_SLOT_COUNT = 3;

function correctFixedOrangeExtsFromSource(req, result) {
    if (!req || !result || Number(req.min_color) !== 5 || Number(req.max_color) !== 5 || Number(result.color) !== 5) {
        return result;
    }
    const equip = wasmMakeTables?.equipment?.[String(req.equip_id)];
    const configured = equip?.exts;
    if (!configured || typeof configured !== 'object') return result;

    const ordered = FIXED_ORANGE_EXT_PROP_ORDER
        .filter(prop => Object.prototype.hasOwnProperty.call(configured, prop))
        .map(prop => ({ prop, value: Array.isArray(configured[prop]) ? configured[prop][0] : configured[prop] }))
        .filter(item => typeof item.value === 'number' && Number.isFinite(item.value));
    result.exts = ordered.slice(0, FIXED_ORANGE_EXT_SLOT_COUNT);
    return result;
}

const MAKE_RNG_MULTIPLIER = 245109059551232n;
const MAKE_RNG_INCREMENT = 48083817484545n;
const MAKE_RNG_MASK = 2147483647n;
const MAKE_RNG_REDUCTION_LIMIT = 2047483645;

function _makeWhaleDraw(seed, max) {
    const bound = Math.max(1, Math.floor(Number(max) || 1));
    const mixed = BigInt.asUintN(
        64,
        (BigInt(Math.floor(Number(seed) || 0) + bound) * MAKE_RNG_MULTIPLIER) + MAKE_RNG_INCREMENT,
    );
    const raw = Number((mixed >> 17n) & MAKE_RNG_MASK);
    const next = (raw < MAKE_RNG_REDUCTION_LIMIT ? raw : raw - MAKE_RNG_REDUCTION_LIMIT) + 1;
    return { seed: next, value: (next % bound) + 1 };
}

/* 真机在打完一件后：普通件把 Seeds[类型][等级档] 推进一次（bound 98999999），
   保底件改用 LuckySeeds[装备] 打造、不推进槽位种子，只推进幸运种子。
   wasm 内部把推进用的 bound 写死成 99999999，会让第 2 件起整体漂移，这里在 JS 层纠正。 */
const MAKE_SLOT_ADVANCE_BOUND = 98999999;
const MAKE_LUCKY_LIMIT = 10;

function _makeAdvanceTarget(req) {
    const equip = wasmMakeTables?.equipment?.[String(req?.equip_id)];
    if (!equip || Number(equip.lv) >= 100) return null;
    if (equip.type == null) return null;
    return {
        type: String(equip.type),
        tier: String(Math.floor(Number(equip.lv) / 10)),
        equipId: String(req.equip_id),
    };
}

function _makeLuckyProgress(state, equipId) {
    const count = Number(state?.MakeLucky?.[equipId]?.count);
    return Number.isFinite(count) ? count : 0;
}

/* 打一件并返回结果，同时把被 wasm 推错的状态改回真机行为 */
function _wasmMakeOnceCorrected(req) {
    const target = _makeAdvanceTarget(req);
    if (!target) return _wasmMakeOnceRaw(req);
    const before = wasmMakeGetState();
    if (!before) return _wasmMakeOnceRaw(req);

    const bucket = before.Seeds?.[target.type];
    const origSlot = bucket ? Number(bucket[target.tier]) : NaN;
    const luckyBefore = Number(before.LuckySeeds?.[target.equipId]);
    const pity = Number.isFinite(luckyBefore) && _makeLuckyProgress(before, target.equipId) >= MAKE_LUCKY_LIMIT;
    if (pity && bucket) {
        // 保底件用幸运种子打造（wasm 无论读 Seeds 还是 LuckySeeds，都保证一致）
        bucket[target.tier] = luckyBefore;
        wasmMakeSetState(before);
    }

    const result = _wasmMakeOnceRaw(req);

    const after = wasmMakeGetState();
    if (after) {
        if (pity) {
            if (!after.LuckySeeds) after.LuckySeeds = {};
            after.LuckySeeds[target.equipId] = _makeWhaleDraw(luckyBefore, MAKE_SLOT_ADVANCE_BOUND).seed;
            if (Number.isFinite(origSlot)) {
                if (!after.Seeds) after.Seeds = {};
                if (!after.Seeds[target.type]) after.Seeds[target.type] = {};
                after.Seeds[target.type][target.tier] = origSlot;
            }
        } else if (Number.isFinite(origSlot)) {
            if (!after.Seeds) after.Seeds = {};
            if (!after.Seeds[target.type]) after.Seeds[target.type] = {};
            after.Seeds[target.type][target.tier] = _makeWhaleDraw(origSlot, MAKE_SLOT_ADVANCE_BOUND).seed;
        }
        wasmMakeSetState(after);
    }
    return result;
}

function _fixedOrangeNormalSeedBefore(req, stateBefore, result) {
    if (result?.seed_kind !== 'normal' || result?.pity) return null;
    const equip = wasmMakeTables?.equipment?.[String(req?.equip_id)];
    if (!equip || Number(equip.lv) >= 100) return null;
    const tier = Math.floor(Number(equip.lv) / 10);
    const seed = stateBefore?.Seeds?.[String(equip.type)]?.[String(tier)];
    return Number.isSafeInteger(Number(seed)) ? Number(seed) : null;
}

function _fixedOrangeRegionEntries(craftsman, tier) {
    if (Array.isArray(craftsman?.tx) && craftsman.tx.length) {
        return craftsman.tx.map(entry => ({
            prop: String(entry?.[0] || ''),
            value: Number(entry?.[1]) || 0,
            weight: Math.max(0, Number(entry?.[2]) || 0),
        })).filter(entry => entry.prop && entry.weight > 0);
    }
    if (Array.isArray(craftsman?.tx2) && craftsman.tx2.length) {
        return craftsman.tx2.map(entry => ({
            prop: String(entry?.[0] || ''),
            value: (Number(entry?.[1]) || 0) + tier * (Number(entry?.[2]) || 0),
            weight: Math.max(0, Number(entry?.[3]) || 0),
        })).filter(entry => entry.prop && entry.weight > 0);
    }
    return [];
}

function correctFixedOrangeRegionFromSource(req, result, stateBefore) {
    if (!req || !result) return result;
    if (Number(req.min_color) !== 5 || Number(req.max_color) !== 5 || Number(result.color) !== 5) return result;

    const equip = wasmMakeTables?.equipment?.[String(req.equip_id)];
    const craftsman = wasmMakeTables?.craftsman?.[String(req.npc_id)];
    if (!equip || !craftsman || Number(equip.lv) >= 100) return result;
    const tier = Math.floor(Number(equip.lv) / 10);
    const regionEntries = _fixedOrangeRegionEntries(craftsman, tier);
    if (!regionEntries.length) return result;

    const sourceSeed = _fixedOrangeNormalSeedBefore(req, stateBefore, result);
    if (sourceSeed == null) return result;

    let seed = sourceSeed + Number(req.select_id || 0) - 3;
    seed = _makeWhaleDraw(seed, 3).seed;

    for (const _ of Object.keys(equip.base || {})) {
        seed = _makeWhaleDraw(seed, 1).seed;
    }

    let extWeight = 0;
    for (const configured of Object.values(equip.exts || {})) {
        if (Array.isArray(configured) && Number(configured[1]) > 0) extWeight += Number(configured[1]);
    }
    if (extWeight <= 0) extWeight = 1;
    for (let slot = 0; slot < FIXED_ORANGE_EXT_SLOT_COUNT; slot++) {
        seed = _makeWhaleDraw(seed, extWeight).seed;
    }

    const regionDraw = _makeWhaleDraw(seed, 100);
    seed = regionDraw.seed;
    let cursor = regionDraw.value;
    let region = [];
    for (const entry of regionEntries) {
        if (cursor <= entry.weight) {
            region = [{ prop: entry.prop, value: entry.value }];
            break;
        }
        cursor -= entry.weight;
    }
    result.region = region;
    result.S = seed;
    return result;
}

function _needsFixedOrangeSourceCorrection(req) {
    if (!req) return false;
    if (Number(req.min_color) !== 5 || Number(req.max_color) !== 5) return false;
    const equip = wasmMakeTables?.equipment?.[String(req.equip_id)];
    const craftsman = wasmMakeTables?.craftsman?.[String(req.npc_id)];
    return !!equip && Number(equip.lv) < 100 && _fixedOrangeRegionEntries(craftsman, Math.floor(Number(equip.lv) / 10)).length > 0;
}

function correctMakeResultFromSource(req, response, stateBefore) {
    if (Array.isArray(response?.items)) {
        for (const item of response.items) correctFixedOrangeExtsFromSource(req, item);
        return response;
    }
    correctFixedOrangeExtsFromSource(req, response);
    return correctFixedOrangeRegionFromSource(req, response, stateBefore);
}

function wasmMakeInitTables(tablesObj) {
    if (!wasmReady) return false;
    wasmMakeTables = null;
    try {
        const json = JSON.stringify(tablesObj);
        const ptr = passStringToWasm0(json, wasmExports.__wbindgen_export, wasmExports.__wbindgen_export2);
        const len = WASM_VECTOR_LEN;
        const initialized = wasmExports.make_init_tables(ptr, len) !== 0;
        if (initialized) wasmMakeTables = tablesObj;
        return initialized;
    } catch (e) {
        console.error('make_init_tables failed', e);
        return false;
    }
}

function wasmMakeSetState(stateObj) {
    if (!wasmReady) return false;
    try {
        const json = JSON.stringify(stateObj);
        const ptr = passStringToWasm0(json, wasmExports.__wbindgen_export, wasmExports.__wbindgen_export2);
        const len = WASM_VECTOR_LEN;
        return wasmExports.make_set_state(ptr, len) !== 0;
    } catch (e) {
        console.error('make_set_state failed', e);
        return false;
    }
}

function wasmMakeGetState() {
    if (!wasmReady) return null;
    try {
        return JSON.parse(_callStringReturn(r => wasmExports.make_get_state(r)));
    } catch { return null; }
}

function _wasmMakeOnceRaw(req) {
    let d0, d1;
    const retptr = wasmExports.__wbindgen_add_to_stack_pointer(-16);
    try {
        const json = JSON.stringify(req || {});
        const ptr = passStringToWasm0(json, wasmExports.__wbindgen_export, wasmExports.__wbindgen_export2);
        const len = WASM_VECTOR_LEN;
        wasmExports.make_once(retptr, ptr, len);
        const r0 = getDataViewMemory0().getInt32(retptr + 0, true);
        const r1 = getDataViewMemory0().getInt32(retptr + 4, true);
        d0 = r0; d1 = r1;
        return JSON.parse(getStringFromWasm0(r0, r1));
    } finally {
        wasmExports.__wbindgen_add_to_stack_pointer(16);
        wasmExports.__wbindgen_export3(d0, d1, 1);
    }
}

function wasmMakePreview(req, n) {
    if (!wasmReady) return { items: [], error: 'WASM 未加载' };
    try {
        const originalState = wasmMakeGetState();
        if (!originalState) return { items: [], error: '无法读取打造状态' };
        const needsOrange = _needsFixedOrangeSourceCorrection(req);
        const items = [];
        try {
            for (let i = 0; i < (n >>> 0); i++) {
                const stateBefore = needsOrange ? wasmMakeGetState() : null;
                const item = correctMakeResultFromSource(req, _wasmMakeOnceCorrected(req), stateBefore);
                item.index = i + 1;
                items.push(item);
            }
        } finally {
            wasmMakeSetState(originalState);
        }
        return { items };
    } catch (e) {
        console.error('make_preview failed', e);
        return { items: [], error: String(e) };
    }
}

function wasmMakeOnce(req) {
    if (!wasmReady) return { error: 'WASM 未加载' };
    try {
        const stateBefore = _needsFixedOrangeSourceCorrection(req) ? wasmMakeGetState() : null;
        return correctMakeResultFromSource(req, _wasmMakeOnceCorrected(req), stateBefore);
    } catch (e) {
        console.error('make_once failed', e);
        return { error: String(e) };
    }
}

function _callJsonInOut(fnName, obj, extraArg) {
    if (!wasmReady) return { error: 'WASM 未加载' };
    try {
        let d0, d1;
        const retptr = wasmExports.__wbindgen_add_to_stack_pointer(-16);
        try {
            const json = JSON.stringify(obj || {});
            const ptr = passStringToWasm0(json, wasmExports.__wbindgen_export, wasmExports.__wbindgen_export2);
            const len = WASM_VECTOR_LEN;
            if (extraArg === undefined) {
                wasmExports[fnName](retptr, ptr, len);
            } else {
                wasmExports[fnName](retptr, ptr, len, extraArg >>> 0);
            }
            const r0 = getDataViewMemory0().getInt32(retptr + 0, true);
            const r1 = getDataViewMemory0().getInt32(retptr + 4, true);
            d0 = r0; d1 = r1;
            return JSON.parse(getStringFromWasm0(r0, r1));
        } finally {
            wasmExports.__wbindgen_add_to_stack_pointer(16);
            wasmExports.__wbindgen_export3(d0, d1, 1);
        }
    } catch (e) {
        console.error(fnName + ' failed', e);
        return { error: String(e) };
    }
}

function wasmXilianPreview(equip, n) {
    return _callJsonInOut('xilian_preview', equip, n);
}

function wasmXilianOnce(equip) {
    return _callJsonInOut('xilian_once', equip);
}

function wasmXilianPlan(equip, accepts) {
    if (!wasmReady) return { error: 'WASM 未加载' };
    try {
        let d0, d1;
        const retptr = wasmExports.__wbindgen_add_to_stack_pointer(-16);
        try {
            const j0 = JSON.stringify(equip || {});
            const p0 = passStringToWasm0(j0, wasmExports.__wbindgen_export, wasmExports.__wbindgen_export2);
            const l0 = WASM_VECTOR_LEN;
            const j1 = JSON.stringify(accepts || []);
            const p1 = passStringToWasm0(j1, wasmExports.__wbindgen_export, wasmExports.__wbindgen_export2);
            const l1 = WASM_VECTOR_LEN;
            wasmExports.xilian_plan(retptr, p0, l0, p1, l1);
            const r0 = getDataViewMemory0().getInt32(retptr + 0, true);
            const r1 = getDataViewMemory0().getInt32(retptr + 4, true);
            d0 = r0; d1 = r1;
            return JSON.parse(getStringFromWasm0(r0, r1));
        } finally {
            wasmExports.__wbindgen_add_to_stack_pointer(16);
            wasmExports.__wbindgen_export3(d0, d1, 1);
        }
    } catch (e) {
        console.error('xilian_plan failed', e);
        return { error: String(e) };
    }
}

function wasmStrongPreview(equip, n) {
    return _callJsonInOut('strong_preview', equip, n);
}

function wasmStrongOnce(equip) {
    return _callJsonInOut('strong_once', equip);
}


function syncStateToWasm(jsState) {
    const ws = {
        mode: jsState.mode,
        zizhi: jsState.zizhi,
        sex: jsState.sex,
        vip: jsState.vip,
        seed: jsState.seed,
        luck_seed: jsState.luckSeed,
        luck_seed_inited: jsState.luckSeedInited,
        role_id: jsState.roleId,
        salt: jsState.salt,
        talents: jsState.talents,
        tal_lucky: jsState.talLucky,
        total_wash: jsState.totalWash,
        total_talent_bars: jsState.totalTalentBars || 0,
        total_pills: jsState.totalPills,
        bag_pills: jsState.bagPills,
        has_bag_pills: jsState.hasBagPills,
        gold_count: jsState.goldCount,
        pity_count: jsState.pityCount,
        quality_counts: jsState.qualityCounts,
        last_purple_total_pills: jsState.lastPurpleTotalPills,
        exchange_count: jsState.exchangeCount,
        str_gift: jsState.strGift,
        con_gift: jsState.conGift,
        dex_gift: jsState.dexGift,
        int_gift: jsState.intGift,
        role_level: jsState.roleLevel,
        role_stats: jsState.roleStats || { str_val: 0, dex: 0, con: 0, int_val: 0 },
        global_vars: jsState.globalVars || {},
        born_talent_rc: Number(jsState.bornTalentRC) || 0,
        save_channel: jsState.saveChannel || '',
    };
    return wasmSetState(ws);
}

function syncStateFromWasm(jsState) {
    const ws = wasmGetState();
    if (!ws) return;
    jsState.mode = ws.mode;
    jsState.zizhi = ws.zizhi;
    jsState.sex = ws.sex;
    jsState.vip = ws.vip;
    jsState.seed = ws.seed;
    jsState.luckSeed = ws.luck_seed;
    jsState.luckSeedInited = ws.luck_seed_inited;
    jsState.roleId = ws.role_id;
    jsState.salt = ws.salt;
    jsState.talents = ws.talents;
    jsState.talLucky = ws.tal_lucky;
    jsState.totalWash = ws.total_wash;
    jsState.totalTalentBars = ws.total_talent_bars || 0;
    jsState.totalPills = ws.total_pills;
    jsState.bagPills = ws.bag_pills;
    jsState.hasBagPills = ws.has_bag_pills;
    jsState.goldCount = ws.gold_count;
    jsState.pityCount = ws.pity_count;
    jsState.qualityCounts = ws.quality_counts;
    jsState.lastPurpleTotalPills = ws.last_purple_total_pills;
    jsState.exchangeCount = ws.exchange_count;
    jsState.strGift = ws.str_gift;
    jsState.conGift = ws.con_gift;
    jsState.dexGift = ws.dex_gift;
    jsState.intGift = ws.int_gift;
    jsState.roleLevel = ws.role_level;
    if (ws.born_talent_rc !== undefined) jsState.bornTalentRC = Number(ws.born_talent_rc) || 0;
    if (ws.save_channel !== undefined) jsState.saveChannel = String(ws.save_channel || '');
}

function convertWashResult(wr) {
    if (!wr) return null;
    return {
        washNo: wr.wash_no,
        talents: wr.talents,
        gotGold: wr.got_gold,
        pillsUsed: wr.pills_used,
        totalPills: wr.total_pills,
        bagPills: wr.bag_pills,
        wasPity: wr.was_pity,
        pityArmed: wr.pity_armed,
        talLucky: wr.tal_lucky,
        purpleGapPills: wr.purple_gap_pills,
        isFirstPurple: wr.is_first_purple,
        startS: wr.start_s,
        endS: wr.end_s,
        luckSeed: wr.luck_seed,
        roleId: wr.role_id,
    };
}

function convertExchangeResult(er) {
    if (!er) return null;
    return {
        success: er.success,
        error: er.error,
        washNo: er.wash_no,
        exchangeNo: er.exchange_no,
        talents: er.talents,
        gotGold: er.got_gold,
        isExchange: er.is_exchange,
        exchangedFrom: er.exchanged_from,
        exchangedTo: er.exchanged_to,
        pillsUsed: er.pills_used,
        totalPills: er.total_pills,
        bagPills: er.bag_pills,
        wasPity: er.was_pity,
        pityArmed: er.pity_armed,
        talLucky: er.tal_lucky,
        purpleGapPills: er.purple_gap_pills,
        isFirstPurple: er.is_first_purple,
        startS: er.start_s,
        endS: er.end_s,
        luckSeed: er.luck_seed,
        roleId: er.role_id,
    };
}
