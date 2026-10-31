const COLOR_NAMES = (typeof EQUIP_DATA !== 'undefined' && EQUIP_DATA.colorNames) || {
    1: '白', 2: '绿', 3: '蓝', 4: '紫', 5: '橙', 6: '红',
};
const PROP_NAMES = (typeof EQUIP_DATA !== 'undefined' && EQUIP_DATA.propNames) || {};
const TYPE_NAMES = (typeof EQUIP_DATA !== 'undefined' && EQUIP_DATA.typeNames) || {};

let makeRndSnapshot = null;
let saveLoaded = false;
let logLines = [];
let saveMeta = null;
let saveEquips = [];
let saveEquipsSnapshot = [];
let equipRuntime = {};
let equipRuntimeSnapshot = {};
let currentTab = 'make';
let craftedSeq = 900000000;
let makeAdvanceNotice = null;

const PREVIEW_MAX = 5000;
const XILIAN_MAX = 1000;
const MANGJING_MAX = 500;
const MANGJING_DEFAULT = 30;
const DEFAULT_MAKE_COLOR_FILTER = '4';   // 「预测序列」后默认只看紫装（4 = 紫）
const LOG_PAGE_SIZE = 40;
const PATH_PAGE_SIZE = 12;
const CRAFTED_MJ_SEED_PAPER_MULTIPLIER = 198;
const SPECIAL_MATERIAL_PART_OVERRIDES = Object.freeze({
    6884: Object.freeze([7]),
});
const JIANWANG_SWORD_IDS = new Set([5707, 5708, 5709, 5710, 5711, 5712, 5713, 5714, 5715, 5716, 5717]);
const JIANWANG_LEVEL_100_IDS = new Set([5714, 5715, 5716, 5717]);
const JIANWANG_LEVEL_90_IDS = new Set([5710, 5711, 5712, 5713]);
const JIANWANG_GROW_TARGETS = Object.freeze({
    5707: Object.freeze([5708]),
    5708: Object.freeze([5709]),
    5709: Object.freeze([5710, 5711, 5712, 5713]),
});
const JIANWANG_LEVEL_100_TARGETS = Object.freeze({ 5710: 5714, 5711: 5715, 5712: 5716, 5713: 5717 });
const JIANWANG_EXT_PROP_ORDER = Object.freeze([
    'atk_add', 'hit_add', 'def_add', 'hp_add', 'speed_add', 'dodge_add', 'parry_add', 'def_ign',
    'unarmed_add', 'sword_add', 'blade_add', 'stick_add', 'hp_back', 'mp_back', 'mp_f', 'dmg_off',
    'dmg_ref', 'blood', 'renxing', 'po_parry', 'po_dodge', 'atk_extend', 'xx_prob', 'xx_crit',
]);
const JIANWANG_BASE_PROP_ORDER = Object.freeze(['atk', 'def', 'hit', 'hp', 'speed', 'dodge', 'parry', 'neijin', 'gq_base']);
const JIANWANG_COLOR_ROLL_WEIGHTS = Object.freeze([74, 20, 5, 1]);
const JIANWANG_REFORGE_COSTS = Object.freeze([
    Object.freeze([2, 3]), Object.freeze([3, 4]), Object.freeze([4, 4]),
    Object.freeze([6, 5]), Object.freeze([6, 6]),
]);
const JIANWANG_REFORGE_LIMIT = 10;
const JIANWANG_BLANK_ID = 5707;
const JIANWANG_REDSEED_DRAW_MAX = 99999999;
const JIANWANG_REDSEED_MJ_MULTIPLIER = 123;
const JIANWANG_REDSEED_CZ_MULTIPLIER = 321;
const JIANWANG_SHATTER_ROUTE_IDS = Object.freeze({
    5710: 5710, 5711: 5711, 5712: 5712, 5713: 5713,
    5714: 5710, 5715: 5711, 5716: 5712, 5717: 5713,
});
const JIANWANG_SHATTER_90 = 'shatter:90';
const JIANWANG_SHATTER_100 = 'shatter:100';

let tablePager = {
    mode: null,
    page: 1,
    makeItems: [],
    specialAttachItems: [],
    xilianEntries: [],
    strongItems: [],
    jianwangItems: [],
    jianwangKind: '',
    jianwangCyclePages: [],
    strongMinSet: null,
    strongBestSet: null,
};
let jianwangReforgeCounts = {};
let jianwangReforgeCountsSnapshot = {};
let jianwangRedSeed = null;
let jianwangRedSeedSnapshot = null;
let jianwangVirtualFirstSword = null;
let jianwangRuleDetection = Object.freeze({
    rule: 'patched',
    confidence: 'fallback',
    reason: '没有足够的实物批次 S 可判断，保持二号补丁规则',
});
let logPage = 1;
let pathPages = { min: 1, max: 1 };

function propLabel(key) {
    return PROP_NAMES[key] || key;
}

function formatPropValue(prop, v) {
    if (typeof v !== 'number') return String(v);
    const asPct = v < 1 || prop === 'atk_extend';
    if (!asPct) return String(v);
    if (v < 0.1) {
        const n = Math.floor(v * 1000 + 0.001) / 10;
        return `${n}%`;
    }
    return `${Math.floor(v * 100 + 0.001)}%`;
}

/** 判断是否按百分比格式展示（与 shared/simulator.js 的 equipAutoUsesPercentFormat 同规则） */
function mangjingUsesPercentFormat(prop, value) {
    const number = Number(value);
    return Number.isFinite(number) && (number < 1 || prop === 'atk_extend');
}

/** 百分比 → 百分比点（0.055 → 5.5），与 shared/simulator.js 的 equipAutoPercentagePoints 同规则。
 *  装备自动模拟的「盲晶筛选」就是这么比对的，打造页保持同一套，避免两处行为不一致。 */
function mangjingPercentagePoints(value) {
    const number = Number(value);
    if (!Number.isFinite(number)) return 0;
    if (Math.abs(number) < 0.1) return Math.floor(number * 1000 + 0.001) / 10;
    return Math.floor(number * 100 + 0.001);
}

/** 盲晶「显示数值」：武器是百分比小数（0.055 → 5.5），防具是原始点数（16 → 16）。
 *  「盲晶≥」按用户看到的显示值输入，避免武器要输 0.055 这种反直觉操作。 */
function mangjingDisplayValue(prop, v) {
    const num = Number(v);
    if (!Number.isFinite(num)) return NaN;
    return mangjingUsesPercentFormat(prop, num) ? mangjingPercentagePoints(num) : num;
}

function formatProps(list) {
    if (!list || !list.length) return '—';
    return list.map(p => {
        const shown = formatPropValue(p.prop, p.value);
        return `<span class="prop-line">${propLabel(p.prop)}+${shown}</span>`;
    }).join('');
}

function formatBase(base) {
    if (!base || !Object.keys(base).length) return '—';
    const order = ['atk', 'def', 'hit', 'hp', 'speed', 'dodge', 'parry'];
    const parts = [];
    for (const k of order) {
        if (base[k] != null) parts.push(`${propLabel(k)}${base[k]}`);
    }
    for (const [k, v] of Object.entries(base)) {
        if (!order.includes(k)) parts.push(`${propLabel(k)}${v}`);
    }
    return parts.join(' / ');
}

function escapeHtml(s) {
    return String(s).replace(/[&<>"']/g, c => ({
        '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
    })[c]);
}

function getPreviewPageSize() {
    return Number(document.getElementById('previewPageSize')?.value) || 20;
}

function updatePreviewPager(total) {
    const bar = document.getElementById('previewPager');
    const info = document.getElementById('previewPagerInfo');
    if (!bar || !info) return;
    const pagerSize = document.getElementById('previewPageSizeWrap');
    if (pagerSize) pagerSize.hidden = false;
    const pageSize = getPreviewPageSize();
    const pages = Math.max(1, Math.ceil(total / pageSize) || 1);
    if (tablePager.page > pages) tablePager.page = pages;
    if (tablePager.page < 1) tablePager.page = 1;
    bar.hidden = total <= 0;
    info.textContent = total
        ? `第 ${tablePager.page}/${pages} 页 · 预览 ${total} 条`
        : '—';
    const prev = document.getElementById('btnPreviewPrev');
    const next = document.getElementById('btnPreviewNext');
    if (prev) prev.disabled = tablePager.page <= 1;
    if (next) next.disabled = tablePager.page >= pages;
}

function updateJianwangCyclePager(totalPages, swordIndex) {
    const bar = document.getElementById('previewPager');
    const info = document.getElementById('previewPagerInfo');
    if (!bar || !info) return;
    const pages = Math.max(1, Number(totalPages) || 1);
    if (tablePager.page > pages) tablePager.page = pages;
    if (tablePager.page < 1) tablePager.page = 1;
    bar.hidden = totalPages <= 0;
    const pagerSize = document.getElementById('previewPageSizeWrap');
    if (pagerSize) pagerSize.hidden = true;
    info.textContent = totalPages
        ? `第 ${tablePager.page}/${pages} 页 · 第 ${swordIndex || tablePager.page} 把剑`
        : '—';
    const prev = document.getElementById('btnPreviewPrev');
    const next = document.getElementById('btnPreviewNext');
    if (prev) prev.disabled = tablePager.page <= 1;
    if (next) next.disabled = tablePager.page >= pages;
}

function hidePreviewPager() {
    const bar = document.getElementById('previewPager');
    if (bar) bar.hidden = true;
    tablePager.mode = null;
    tablePager.page = 1;
}

function renderCurrentPreviewPage() {
    if (tablePager.mode === 'make') renderMakePage();
    else if (tablePager.mode === 'specialAttach') renderSpecialAttachPage();
    else if (tablePager.mode === 'xilian') renderXilianPage();
    else if (tablePager.mode === 'strong') renderStrongPage();
    else if (tablePager.mode === 'jianwang') renderJianwangPage();
}

function updateLogPager() {
    const bar = document.getElementById('logPager');
    const info = document.getElementById('logPagerInfo');
    if (!bar || !info) return;
    const total = logLines.length;
    const pages = Math.max(1, Math.ceil(total / LOG_PAGE_SIZE) || 1);
    if (logPage > pages) logPage = pages;
    if (logPage < 1) logPage = 1;
    bar.hidden = total <= LOG_PAGE_SIZE;
    info.textContent = total
        ? `第 ${logPage}/${pages} 页 · 共 ${total} 条`
        : '—';
    const prev = document.getElementById('btnLogPrev');
    const next = document.getElementById('btnLogNext');
    if (prev) prev.disabled = logPage <= 1;
    if (next) next.disabled = logPage >= pages;
}

function renderLogPage() {
    const el = document.getElementById('makeLog');
    if (!el) return;
    if (!logLines.length) {
        el.textContent = '';
        updateLogPager();
        return;
    }
    const start = (logPage - 1) * LOG_PAGE_SIZE;
    el.textContent = logLines.slice(start, start + LOG_PAGE_SIZE).join('\n');
    updateLogPager();
}

function appendLog(line) {
    logLines.push(line);
    if (logLines.length > 20000) logLines.splice(0, logLines.length - 20000);
    logPage = Math.max(1, Math.ceil(logLines.length / LOG_PAGE_SIZE));
    renderLogPage();
}

function normalizeExts(raw) {
    if (!raw) return [];
    if (Array.isArray(raw)) {
        return raw.filter(Boolean).map(e => ({
            prop: e.Key || e.prop || e.key,
            value: e.Value != null ? e.Value : e.value,
        })).filter(e => e.prop);
    }
    return [];
}

function normalizeJianwangExts(raw) {
    if (!raw) return [];
    if (Array.isArray(raw)) {
        return raw.filter(Boolean).map(e => ({
            prop: e.Key || e.prop || e.key,
            value: e.Value != null ? e.Value : e.value,
            S: e.S != null ? e.S : (e.s || 0),
            propCheck: e.PropCheck || e.propCheck || '',
        })).filter(e => e.prop);
    }
    return [];
}

function parseXilianMarks(raw) {
    const data = raw?.ExtsXilianData;
    if (!data || typeof data !== 'object') return [];
    return Object.keys(data)
        .filter(k => data[k])
        .map(Number)
        .filter(n => n >= 1 && n <= 3)
        .sort((a, b) => a - b);
}

function toEquipInstance(raw, source, equipped) {
    const id = raw.ID || raw.id;
    const cfg = EQUIP_DATA.equipment[String(id)] || {};
    const marks = parseXilianMarks(raw);
    return {
        id,
        only_id: raw.OnlyID || raw.only_id || 0,
        name: cfg.name || String(id),
        need_lv: cfg.lv || 0,
        typ: cfg.type || 0,
        color: raw.Color != null ? raw.Color : (raw.color || 1),
        level: raw.Level != null ? raw.Level : (raw.level || 0),
        lv_prop: raw.LvProp != null ? raw.LvProp : (raw.lv_prop || 0),
        S: raw.S != null ? raw.S : (raw.s || 0),
        MJSeed: raw.MJSeed != null ? raw.MJSeed : (raw.mj_seed || 0),
        CZSeed: raw.CZSeed != null ? raw.CZSeed : (raw.cz_seed || 0),
        XLLevel: raw.XLLevel != null ? raw.XLLevel : (raw.xl_level || 0),
        XLNumber: raw.XLNumber != null ? raw.XLNumber : (raw.xl_number || 0),
        exp: raw.Exp != null ? raw.Exp : (raw.exp || 0),
        base: {
            atk: raw.Atk != null ? raw.Atk : (raw.atk || 0),
            def: raw.Def != null ? raw.Def : (raw.def || 0),
            hit: raw.Hit != null ? raw.Hit : (raw.hit || 0),
            hp: raw.Hp != null ? raw.Hp : (raw.hp || 0),
            speed: raw.Speed != null ? raw.Speed : (raw.speed || 0),
            dodge: raw.Dodge != null ? raw.Dodge : (raw.dodge || 0),
            parry: raw.Parry != null ? raw.Parry : (raw.parry || 0),
            neijin: raw.Neijin != null ? raw.Neijin : (raw.neijin || 0),
            gq_base: raw.Gangqi != null ? raw.Gangqi : (raw.gq_base || 0),
        },
        exts: JIANWANG_SWORD_IDS.has(Number(id))
            ? normalizeJianwangExts(raw.EnExts || raw.exts)
            : normalizeExts(raw.EnExts || raw.exts),
        specials: normalizeExts(raw.EnSpecials || raw.specials),
        // 装备提供的「角色基础属性」（臂力 / 根骨 / 身法 / 内息）单独存在 EnMans，
        // 游戏界面把它和附加属性排在一起显示，所以这里也一起展示。
        mans: normalizeExts(raw.EnMans || raw.en_mans || raw.mans),
        xilian_marks: marks,
        xilian_accepted: marks.length,
        _source: source,
        _equipped: !!equipped,
        _crafted: false,
        _mark: '',
    };
}

function canXilian(e) {
    return e.need_lv > 90 && e.color > 1 && e.color < 5 && e.exts.length > 0;
}

function canStrong(e) {
    return e.typ >= 1 && e.typ <= 4 && e.level < 15;
}

function canShengLian(e) {
    if (!e || e.need_lv !== 90 || e.color >= 5) return false;
    const cfg = EQUIP_DATA.equipment[String(e.id)] || {};
    const nextId = cfg.equ_next || 0;
    return nextId > 0 && !!EQUIP_DATA.equipment[String(nextId)];
}

function nextCraftedOnlyId() {
    craftedSeq += 1;
    return craftedSeq;
}

function getSourceFilter(which) {
    const id = which === 'strong'
        ? 'strongSourceFilter'
        : (which === 'shenglian' ? 'shenglianSourceFilter' : 'xilianSourceFilter');
    return document.getElementById(id)?.value || 'all';
}

function getTextFilter(which) {
    const id = which === 'strong'
        ? 'strongTextFilter'
        : (which === 'shenglian' ? 'shenglianTextFilter' : 'xilianTextFilter');
    return (document.getElementById(id)?.value || '').trim().toLowerCase();
}

function passEquipListFilter(e, which) {
    const source = getSourceFilter(which);
    if (source === 'equipped' && !e._equipped) return false;
    if (source === 'unequipped' && (e._equipped || e._crafted)) return false;
    if (source === 'crafted' && !e._crafted) return false;
    // 升炼只对蓝、紫有实际价值：真实装备（身上穿的 / 背包仓库里的）白绿直接过滤；模拟装备不过滤
    if (which === 'shenglian' && source !== 'crafted' && !e._crafted
        && e.color !== 3 && e.color !== 4) return false;

    const q = getTextFilter(which);
    if (!q) return true;
    const hay = [
        e.name,
        e._mark,
        e._source,
        String(e.only_id || ''),
        COLOR_NAMES[e.color] || e.color,
        TYPE_NAMES[e.typ] || e.typ,
        `${e.need_lv}级`,
        e._crafted ? '模拟打造' : '',
        e._equipped ? '已装备' : '未装备',
    ].join(' ').toLowerCase();
    return hay.includes(q);
}

function getDefaultMakeMark() {
    return (document.getElementById('makeDefaultMark')?.value || '').trim();
}

function craftedMJSeedFromMakeResult(result, paperId) {
    const czSeed = result?.CZSeed != null ? result.CZSeed : result?.cz_seed;
    if (!Number.isSafeInteger(paperId) || paperId <= 0) {
        throw new TypeError(`打造图纸 ID 必须是正安全整数，实际为 ${String(paperId)}`);
    }
    const offset = paperId * CRAFTED_MJ_SEED_PAPER_MULTIPLIER;
    if (!Number.isSafeInteger(czSeed) || czSeed <= offset) {
        throw new TypeError(`打造结果 CZSeed 必须是大于图纸偏移 ${offset} 的安全整数，实际为 ${String(czSeed)}`);
    }
    return czSeed - offset;
}

function addCraftedFromMakeResult(r, mark, paperId, npcId) {
    if (!r || r.error || !r.equip_id) return null;
    const cfg = EQUIP_DATA.equipment[String(r.equip_id)] || {};
    const onlyId = nextCraftedOnlyId();
    const markText = (mark != null ? String(mark) : getDefaultMakeMark()).trim();
    const czSeed = r.CZSeed != null ? r.CZSeed : r.cz_seed;
    const eq = {
        id: r.equip_id,
        only_id: onlyId,
        name: r.name || cfg.name || String(r.equip_id),
        need_lv: cfg.lv || 0,
        typ: cfg.type || 0,
        color: r.color || 1,
        level: 0,
        lv_prop: 0,
        S: r.S != null ? r.S : (r.s || 0),
        MJSeed: craftedMJSeedFromMakeResult(r, paperId),
        CZSeed: czSeed,
        XLLevel: 0,
        XLNumber: 0,
        exts: (r.exts || []).map(p => ({ prop: p.prop, value: p.value })),
        specials: (r.special || []).map(p => ({ prop: p.prop, value: p.value })),
        xilian_marks: [],
        xilian_accepted: 0,
        _source: '模拟打造',
        _equipped: false,
        _crafted: true,
        _mark: markText,
        _make_base: r.base || {},
        _make_region: r.region || [],
        _make_special: r.special || [],
        _make_index: r.index || 0,
        _make_pity: !!r.pity,                       // 打造那一刻是否保底（快照，供详情显示）
        _make_seedKind: r.seed_kind || 'normal',    // normal / lucky
        _make_npcId: npcId || null,   // 打造时选的工匠，供成品背包显示地点
    };
    saveEquips.push(eq);
    const k = runtimeKey(eq);
    const full = { ...eq, ...toWasmEquip(eq), xilian_marks: [] };
    equipRuntime[k] = JSON.parse(JSON.stringify(full));
    updateCraftedBagHint();
    renderCraftedBagList();
    return eq;
}

function setCraftedMark(onlyId, mark) {
    const text = String(mark || '').trim().slice(0, 40);
    const eq = saveEquips.find(e => e.only_id === onlyId);
    if (eq) {
        eq._mark = text;
        const k = runtimeKey(eq);
        if (equipRuntime[k]) equipRuntime[k]._mark = text;
    }
    fillEquipSelects();
    renderCraftedBagList();
}

function removeCraftedEquip(onlyId) {
    const idx = saveEquips.findIndex(e => e.only_id === onlyId && e._crafted);
    if (idx < 0) return;
    const eq = saveEquips[idx];
    const k = runtimeKey(eq);
    saveEquips.splice(idx, 1);
    delete equipRuntime[k];
    updateCraftedBagHint();
    renderCraftedBagList();
    fillEquipSelects();
}

function renderCraftedBagList() {
    const box = document.getElementById('craftedBagList');
    if (!box) return;
    const list = saveEquips.filter(e => e._crafted);
    if (!list.length) {
        box.classList.add('empty');
        box.textContent = '暂无模拟打造装备';
        return;
    }
    box.classList.remove('empty');
    box.innerHTML = list.map(e => {
        const color = COLOR_NAMES[e.color] || e.color;
        const typ = TYPE_NAMES[e.typ] || e.typ;
        const mark = e._mark || '';
        return `<div class="crafted-bag-row" data-only-id="${e.only_id}">
            <div class="bag-meta">${escapeHtml(e.name)} · ${e.need_lv}级 · ${escapeHtml(String(color))} · ${escapeHtml(String(typ))} · #${e.only_id}</div>
            <input type="text" class="crafted-mark-input" maxlength="40" value="${escapeHtml(mark)}" placeholder="输入标记">
            <div class="bag-actions">
                <button type="button" class="btn btn-reset btn-row-action" data-act="remove">移除</button>
            </div>
        </div>`;
    }).join('');
}

function calcShengLianCost(eq) {
    const cfg = EQUIP_DATA.equipment[String(eq.id)] || {};
    const nextCfg = EQUIP_DATA.equipment[String(cfg.equ_next)] || {};
    const isArmor = eq.typ >= 5 && eq.typ <= 7;
    const matId = isArmor ? 3036 : 3026;
    const matName = isArmor ? '青蝉翼' : '昆吾石';
    const price = nextCfg.price > 0 ? nextCfg.price : (cfg.price || 10000);
    const silver = Math.floor(price * 6);
    return [
        { id: 8801, name: '连金泥', n: 10 },
        { id: matId, name: matName, n: 120 },
        { id: 3001, name: '银两', n: silver },
    ];
}

function applyShengLian(key) {
    const idx = saveEquips.findIndex(e => runtimeKey(e) === key);
    if (idx < 0) return { error: '未找到装备' };
    const cur = saveEquips[idx];
    if (!canShengLian(cur)) return { error: '该装备不可升炼（需 90 级且有下一档）' };
    const cfg = EQUIP_DATA.equipment[String(cur.id)] || {};
    const nextId = cfg.equ_next;
    const nextCfg = EQUIP_DATA.equipment[String(nextId)];
    if (!nextCfg) return { error: `缺少下一档装备 ${nextId}` };

    if (!cur.only_id) cur.only_id = nextCraftedOnlyId();
    const stableKey = runtimeKey(cur);
    const rt = getRuntimeEquip(stableKey) || getRuntimeEquip(key);

    const oldName = cur.name;
    const oldLv = cur.need_lv;
    cur.id = nextId;
    cur.name = nextCfg.name || String(nextId);
    cur.need_lv = nextCfg.lv || 100;
    cur.typ = nextCfg.type || cur.typ;

    if (rt) {
        rt.id = cur.id;
        rt.name = cur.name;
        rt.need_lv = cur.need_lv;
        rt.typ = cur.typ;
        rt.only_id = cur.only_id;
        const newKey = runtimeKey(cur);
        if (key !== newKey) delete equipRuntime[key];
        if (stableKey !== newKey) delete equipRuntime[stableKey];
        equipRuntime[newKey] = { ...rt, ...toWasmEquip(rt), xilian_marks: [...(rt.xilian_marks || [])] };
    }
    return {
        ok: true,
        key: runtimeKey(cur),
        from: `${oldName}(${oldLv})`,
        to: `${cur.name}(${cur.need_lv})`,
        equip: cur,
    };
}

function updateCraftedBagHint() {
    const el = document.getElementById('craftedBagHint');
    if (!el) return;
    const n = saveEquips.filter(e => e._crafted).length;
    const marked = saveEquips.filter(e => e._crafted && e._mark).length;
    const canSl = saveEquips.filter(e => e._crafted && canShengLian(e)).length;
    const canXl = saveEquips.filter(e => e._crafted && canXilian(e)).length;
    const canSt = saveEquips.filter(e => e._crafted && canStrong(e)).length;
    // 只显示统计：没有模拟打造装备时不显示任何文字，也不占位置
    el.textContent = n
        ? `模拟背包：打造 ${n} 件（已标记 ${marked}）· 可升炼 ${canSl} · 可精炼 ${canXl} · 可淬炼 ${canSt}`
        : '';
    el.style.display = n ? '' : 'none';
}

function toWasmEquip(eq) {
    const marks = eq.xilian_marks || [];
    return {
        id: eq.id,
        only_id: eq.only_id,
        name: eq.name,
        color: eq.color,
        level: eq.level,
        lv_prop: eq.lv_prop,
        S: eq.S,
        CZSeed: eq.CZSeed,
        MJSeed: eq.MJSeed,
        XLLevel: eq.XLLevel,
        XLNumber: eq.XLNumber,
        exp: eq.exp || 0,
        base: eq.base || {},
        exts: eq.exts,
        xilian_accepted: marks.length || eq.xilian_accepted || 0,
        xilian_marks: marks,
        need_lv: eq.need_lv || 0,
        typ: eq.typ || 0,
    };
}


function xilianCostMult(marksCount) {
    return [1, 2, 4, 8][Math.min(3, Math.max(0, marksCount))] || 8;
}

function formatSilver(wen) {
    const liang = Math.floor(wen / 1000);
    const rest = wen % 1000;
    let s = '';
    if (liang > 0) s += `${liang}两`;
    if (rest > 0 || !s) s += `${rest}文`;
    return s;
}

function calcXilianCost(eq) {
    const marks = (eq.xilian_marks || []).length;
    const mult = xilianCostMult(marks);
    const cfg = EQUIP_DATA.equipment[String(eq.id)] || {};
    const isArmor = eq.typ >= 5 && eq.typ <= 7;
    const matId = isArmor ? 3036 : 3026;
    const matName = isArmor ? '青蝉翼' : '昆吾石';
    const price = cfg.price > 0 ? cfg.price : 10000;
    const silver = Math.floor(price * 1.5);
    return {
        mult,
        mats: [
            { id: matId, name: matName, n: 5 * mult },
            { id: 8801, name: '连金泥', n: mult },
            { id: 3001, name: '银两', n: silver },
        ],
    };
}

function formatCostList(mats) {
    return mats.map(m => {
        if (m.id === 3001) return `${m.name}${formatSilver(m.n)}`;
        return `${m.name}×${m.n}`;
    }).join(' · ');
}

function xlMainBonus(xlLevel, kind) {
    const tiers = kind === 'gq_base'
        ? [[0, 10, 1], [10, 20, 1.5], [20, 30, 2], [30, 40, 2.5], [40, 50, 3],
           [50, 60, 2.5], [60, 70, 2], [70, 80, 1.5], [80, 200, 1]]
        : [[0, 10, 1], [10, 20, 2], [20, 30, 3], [30, 40, 4], [40, 50, 5],
           [50, 60, 4], [60, 70, 3], [70, 80, 2], [80, 300, 1]];
    if (xlLevel <= 0) return 0;
    let sum = 0;
    for (const [lo, hi, rate] of tiers) {
        if (xlLevel >= hi) sum += (hi - lo) * rate;
        else {
            sum += (xlLevel - lo) * rate;
            break;
        }
    }
    return Math.floor(sum);
}

function mainPropDisplay(eq, xlLevel) {
    const cfg = EQUIP_DATA.equipment[String(eq.id)] || {};
    const base = cfg.base || {};
    const out = [];
    if (base.gq_base > 0) {
        const bonus = xlMainBonus(xlLevel, 'gq_base');
        const v = Math.min(200, Math.floor(base.gq_base + bonus));
        out.push({ key: 'gq_base', label: '罡气', base: base.gq_base, value: v, bonus });
    }
    if (base.neijin > 0) {
        const bonus = xlMainBonus(xlLevel, 'neijin');
        const v = Math.min(300, Math.floor(base.neijin + bonus));
        out.push({ key: 'neijin', label: '内劲', base: base.neijin, value: v, bonus });
    }
    return out;
}

let xilianAcceptFlags = [];
let xilianPlanEquipKey = null;
let xilianPlanItems = [];

/* ── 成品背包 ─────────────────────────────────────────── */
const REFINED_BAG_KEY = 'yyjh_refined_bag_v1';   // localStorage 兜底键
const REFINED_BAG_DB = 'yyjh_refined_bag_db';    // IndexedDB 库名（容量远大于 localStorage）
const REFINED_BAG_STORE = 'bag';                 // IndexedDB 对象仓库
const REFINED_BAG_DB_KEY = 'list';               // IndexedDB 记录键
let refinedBag = [];            // [{id, title, baseTitle, mark, equipName, npcPlace, regionText, color, extText, costText, mjText, xl, keepN, at}]
let lastXilianPlan = null;      // refreshXilianPlan 算好的精炼规划快照（含 equipKey，标明是对哪件装备算的）
let lastMangjingResult = null;  // 最近一次「芒晶序列」结果 {materialName, prop, value, index, count, equipKey}

let strongPlanCache = null;

const STONE_NAMES = { 3027: '白炼石', 3028: '绿炼石', 3029: '蓝炼石', 3030: '紫炼石' };
const STONE_WEIGHT = { 3027: 1, 3028: 1e4, 3029: 1e8, 3030: 1e12 };

function resetXilianSession() {
    xilianAcceptFlags = [];
    xilianPlanEquipKey = null;
    xilianPlanItems = [];
    // 这两份快照的消费者是「加入成品背包」，切换装备/重置时一并清掉，
    // 否则会把上一件装备的词条、花费、盲晶信息错记到当前选中的装备名下。
    lastXilianPlan = null;
    lastMangjingResult = null;
    const box = document.getElementById('xilianPlanSummary');
    if (box) {
        box.classList.add('empty');
        box.innerHTML = '预测后勾选「保留」查看总花费与最终属性';
    }
    const bar = document.getElementById('xilianFilterBar');
    if (bar) bar.hidden = true;
}

function qianghuaEqTier(needLv) {
    return Math.min(11, Math.max(1, Math.floor((needLv || 90) / 10) + 1));
}

function strongAttemptCost(needLv, fromLevel) {
    const target = fromLevel + 1;
    const qh = EQUIP_DATA.qianghua?.[String(target)];
    if (!qh) return null;
    const tier = qianghuaEqTier(needLv);
    const row = qh.costs?.[tier] || qh.costs?.[String(tier)];
    if (!row) return null;
    return { mat: row.mat, num: row.num, silver: row.silver, qhcd: qh.qhcd };
}

function costScore(bag) {
    let s = (bag.silver || 0);
    for (const [id, n] of Object.entries(bag.stones || {})) {
        s += (STONE_WEIGHT[id] || 1) * n;
    }
    return s;
}

function formatStoneBag(bag) {
    const parts = [];
    for (const id of [3027, 3028, 3029, 3030]) {
        const n = bag.stones?.[id] || 0;
        if (n) parts.push(`${STONE_NAMES[id]}×${n}`);
    }
    if (bag.silver) parts.push(`银两${formatSilver(bag.silver)}`);
    return parts.join(' · ') || '—';
}

function planStrongPath(grades, startLevel, targetLevel, minGrade, needLv) {
    const need = targetLevel - startLevel;
    if (need <= 0) return { minCost: { ok: false, reason: '已达期望层数' }, maxValue: { ok: false, reason: '已达期望层数' } };
    const n = grades.length;

    const better = (a, b, mode) => {
        if (!a) return true;
        if (mode === 'maxValue') {
            if (b.value !== a.value) return b.value > a.value;
            return b.score < a.score;
        }
        if (b.score !== a.score) return b.score < a.score;
        return b.value > a.value;
    };

    const run = (mode) => {
        const d = Array.from({ length: n + 1 }, () => Array(need + 1).fill(null));
        d[0][0] = { score: 0, value: 0, bag: { stones: {}, silver: 0 }, from: null };

        for (let i = 0; i < n; i++) {
            for (let k = 0; k <= need; k++) {
                const cur = d[i][k];
                if (!cur) continue;

                if (k === need) {
                    const stay = { score: cur.score, value: cur.value, bag: cur.bag, from: { i, k, action: 'done', seq: i } };
                    if (better(d[i + 1][k], stay, mode)) d[i + 1][k] = stay;
                    continue;
                }

                const level = startLevel + k;
                if (level >= 15) continue;
                const c = strongAttemptCost(needLv, level);
                if (!c) continue;

                const nextBag = {
                    stones: { ...cur.bag.stones, [c.mat]: (cur.bag.stones[c.mat] || 0) + c.num },
                    silver: cur.bag.silver + c.silver,
                };
                const sc = costScore(nextBag);
                const grade = grades[i];
                const add = Math.floor([0, 600, 700, 800, 1000][grade] * c.qhcd);

                const skipSt = {
                    score: sc, value: cur.value, bag: nextBag,
                    from: { i, k, action: 'skip', seq: i, level, grade, add },
                };
                if (better(d[i + 1][k], skipSt, mode)) d[i + 1][k] = skipSt;

                if (grade >= minGrade) {
                    const accSt = {
                        score: sc, value: cur.value + add, bag: nextBag,
                        from: { i, k, action: 'accept', seq: i, level, grade, add },
                    };
                    if (better(d[i + 1][k + 1], accSt, mode)) d[i + 1][k + 1] = accSt;
                }
            }
        }

        let best = null;
        let bestI = -1;
        for (let i = 0; i <= n; i++) {
            const st = d[i][need];
            if (!st) continue;
            if (better(best, st, mode)) {
                best = st;
                bestI = i;
            }
        }
        if (!best) {
            let maxK = -1;
            for (let i = 0; i <= n; i++) {
                for (let k = 0; k <= need; k++) {
                    if (d[i][k] && k > maxK) maxK = k;
                }
            }
            return {
                ok: false,
                reason: maxK < 0 ? '无可行路径' : `序列内最多升至 +${startLevel + maxK}（期望 +${targetLevel}），请加长序列或降低档位`,
                reached: startLevel + Math.max(0, maxK),
            };
        }

        const accepts = new Set();
        const steps = [];
        let i = bestI;
        let k = need;
        while (i > 0 || k > 0) {
            const st = d[i][k];
            if (!st || !st.from) break;
            const f = st.from;
            if (f.action === 'accept') {
                accepts.add(f.seq + 1);
                steps.push({ index: f.seq + 1, action: '接受', level: f.level, grade: f.grade, add: f.add });
                i = f.i;
                k = f.k;
            } else if (f.action === 'skip') {
                steps.push({ index: f.seq + 1, action: '取消', level: f.level, grade: f.grade, add: f.add });
                i = f.i;
                k = f.k;
            } else {
                i = f.i;
                k = f.k;
            }
        }
        steps.reverse();
        return {
            ok: true,
            mode,
            accepts,
            steps,
            bag: best.bag,
            value: best.value,
            reached: targetLevel,
            attempts: steps.filter(s => s.action !== 'done').length,
        };
    };

    return { minCost: run('minCost'), maxValue: run('maxValue') };
}

function collectEquipsFromSave(data) {
    const root = Array.isArray(data) ? data[0] : data;
    const out = [];
    const seen = new Set();

    const pushList = (list, src, equipped) => {
        if (!list) return;
        const arr = Array.isArray(list) ? list : Object.values(list);
        for (const raw of arr) {
            if (!raw || (raw.ID == null && raw.id == null)) continue;
            const id = raw.ID ?? raw.id;
            if (!EQUIP_DATA.equipment[String(id)]) continue;
            if (raw.CZSeed == null && raw.S == null && !raw.EnExts && raw.Color == null) continue;
            const inst = toEquipInstance(raw, src, equipped);
            const key = inst.only_id || `${src}:${inst.id}:${inst.CZSeed}`;
            if (seen.has(key)) continue;
            seen.add(key);
            out.push(inst);
        }
    };

    const asRoleList = (v) => {
        if (!v) return [];
        if (Array.isArray(v)) return v;
        if (typeof v === 'object') return Object.values(v);
        return [];
    };

    pushList(root.MainRole?.Equips, '主角装备', true);
    asRoleList(root.Roles).forEach((r, i) => {
        const name = r.Name || r.name || `随从${i + 1}`;
        pushList(r.Equips, name, true);
    });
    asRoleList(root.Leavers).forEach((r, i) => {
        const name = r.Name || r.name || `离队${i + 1}`;
        pushList(r.Equips, name, true);
    });
    pushList(root.Equips, '背包', false);
    const depots = root.EncryptDepots || root.Depots || {};
    for (const [depotId, depot] of Object.entries(depots)) {
        const list = depot?.Depots || depot?.Items || depot;
        const label = depot?.Name || depot?.name || `仓库:${depotId}`;
        pushList(list, label, false);
    }

    return out;
}

function runtimeKey(eq) {
    return String(eq.only_id || `${eq.id}_${eq.CZSeed}_${eq.S}`);
}

function findEquipByRuntimeKey(selectId) {
    const real = saveEquips.find(e => runtimeKey(e) === selectId);
    if (real) return real;
    if (jianwangVirtualFirstSword && runtimeKey(jianwangVirtualFirstSword) === selectId) {
        return jianwangVirtualFirstSword;
    }
    return null;
}

function getRuntimeEquip(selectId) {
    const base = findEquipByRuntimeKey(selectId);
    if (!base) return null;
    return equipRuntime[selectId] || JSON.parse(JSON.stringify(toWasmEquip(base)));
}

function setRuntimeEquip(selectId, eq) {
    equipRuntime[selectId] = eq;
}


function sortedCraftsmen() {
    return Object.values(EQUIP_DATA.craftsman).sort((a, b) => {
        const pa = a.place || a.name;
        const pb = b.place || b.name;
        if (pa !== pb) return pa.localeCompare(pb, 'zh');
        return a.id - b.id;
    });
}

function papersForNpc(npcId) {
    const cm = EQUIP_DATA.craftsman[String(npcId)];
    if (!cm) return [];
    const list = [];
    const seen = new Set();
    for (const pid of cm.pf || []) {
        const paper = EQUIP_DATA.papers[String(pid)];
        if (!paper) continue;
        const eq = EQUIP_DATA.equipment[String(paper.dz_equip)];
        if (!eq) continue;
        seen.add(paper.id);
        list.push({
            selectId: paper.id,
            equipId: paper.dz_equip,
            label: `${eq.name}（免图纸·${eq.lv}级）`,
            paper,
            equip: eq,
        });
    }
    const zhi = cm.zhi || 'dazao';
    const allow = zhi === 'fengzhi' ? new Set([5, 6, 7]) : new Set([1, 2, 3, 4, 8, 9]);
    for (const paper of Object.values(EQUIP_DATA.papers)) {
        if (seen.has(paper.id)) continue;
        const eq = EQUIP_DATA.equipment[String(paper.dz_equip)];
        if (!eq || !allow.has(eq.type)) continue;
        list.push({
            selectId: paper.id,
            equipId: paper.dz_equip,
            label: `${eq.name}（${paper.name}·${eq.lv}级）`,
            paper,
            equip: eq,
        });
    }
    list.sort((a, b) => (b.equip.lv - a.equip.lv) || a.label.localeCompare(b.label, 'zh'));
    return list;
}

function fillNpcSelect() {
    const sel = document.getElementById('npcSelect');
    sel.innerHTML = '';
    for (const cm of sortedCraftsmen()) {
        const opt = document.createElement('option');
        opt.value = cm.id;
        opt.textContent = `${cm.place || cm.name} · ${cm.name}（${cm.zhi === 'fengzhi' ? '绣' : '铁'}）`;
        sel.appendChild(opt);
    }
    for (const id of ['40520', '32180', '31230', '32256']) {
        if (EQUIP_DATA.craftsman[id]) { sel.value = id; break; }
    }
}

/* ── 工匠地点分类筛选（铁匠 / 绣庄 / 全部） ───────────────── */
const NPC_CATEGORY_TIE = [
    { place: '铸剑山庄',   name: '紫金熔炉', isDefault: true },
    { place: '剑王阁',     name: '石老' },
    { place: '洛阳铁匠铺', name: '李铁匠' },
    { place: '南阳渡铁匠铺', name: '胡铁匠' },
    { place: '无双城铁匠铺', name: '赵小炉' },
    { place: '恒山派',     name: '金锐' },
];
const NPC_CATEGORY_XIU = [
    { place: '泠月宫',     name: '月绣', isDefault: true },
    { place: '洛阳绣庄',   name: '红萝' },
    { place: '南阳渡绣庄', name: '陈三娘' },
    { place: '塞北绣庄',   name: '贝奇娅' },
    { place: '无双城衣服店', name: '穆老板' },
];

function findCraftsmanByPlaceName(place, name) {
    for (const id in EQUIP_DATA.craftsman) {
        const cm = EQUIP_DATA.craftsman[id];
        if ((cm.place || cm.name) === place && cm.name === name) return cm;
    }
    return null;
}

/** 按分类填工匠下拉（铁匠/绣庄）；"全部" 走旧 fillNpcSelect */
function fillNpcSelectByCategory(category) {
    const sel = document.getElementById('npcSelect');
    if (!sel) return;
    const list = category === 'tie' ? NPC_CATEGORY_TIE : NPC_CATEGORY_XIU;
    sel.innerHTML = '';
    let firstCm = null;
    for (const item of list) {
        const cm = findCraftsmanByPlaceName(item.place, item.name);
        if (!cm) continue;
        if (!firstCm) firstCm = cm;
        const opt = document.createElement('option');
        opt.value = cm.id;
        opt.textContent = `${cm.place || cm.name} · ${cm.name}（${cm.zhi === 'fengzhi' ? '绣' : '铁'}）`;
        sel.appendChild(opt);
    }
    if (!firstCm) {
        sel.innerHTML = '<option value="">（未找到匹配工匠）</option>';
        return;
    }
    const def = list.find(it => it.isDefault);
    const target = def ? findCraftsmanByPlaceName(def.place, def.name) : firstCm;
    if (target && [...sel.options].some(o => Number(o.value) === Number(target.id))) {
        sel.value = target.id;
    } else {
        sel.value = firstCm.id;
    }
}

/** 应用分类：同步筛选下拉值 + 重建工匠下拉 */
function applyNpcCategory(category) {
    const filterSel = document.getElementById('npcCategoryFilter');
    if (filterSel) filterSel.value = category || 'all';
    if (category === 'tie' || category === 'xiu') {
        fillNpcSelectByCategory(category);
    } else {
        fillNpcSelect();
    }
}

/* ── 目标装备分类（铁匠 12 武器 / 绣庄 6 防具） ────────────── */
const PAPER_CATEGORY_TIE_NAMES = [
    '青云戒', '苏布宝戒', '青云坠', '其木格坠',
    '碎月重刀', '掠影刀', '万仞重剑', '巽风剑',
    '破军指套', '撼岳掌套', '碎虚枪', '贪狼棍',
];
const PAPER_CATEGORY_XIU_NAMES = [
    '呼如木甲', '乌蚕宝甲', '乌斯护腕', '紫薇护腕',
    '玉衡护腰', '吉达护腰',
];

/** paper 是否在任意工匠的 pf 列表里（即"免图纸"类） */
function isFreePaper(paperId) {
    for (const cid in EQUIP_DATA.craftsman) {
        if ((EQUIP_DATA.craftsman[cid].pf || []).includes(paperId)) return true;
    }
    return false;
}

/** 全局按装备名（默认 90 级）找 paper；不限制当前工匠，确保 12/6 件齐 */
function findPaperByEquipName(name, lv) {
    if (lv == null) lv = 90;
    for (const eid in EQUIP_DATA.equipment) {
        const eq = EQUIP_DATA.equipment[eid];
        if (eq.name !== name || eq.lv !== lv) continue;
        for (const pid in EQUIP_DATA.papers) {
            const p = EQUIP_DATA.papers[pid];
            if (Number(p.dz_equip) !== Number(eid)) continue;
            const free = isFreePaper(p.id);
            return {
                selectId: p.id,
                equipId: Number(eid),
                minColor: p.min_color || 0,
                maxColor: p.max_color || 0,
                label: `${eq.name}（${free ? '免图纸' : p.name}·${eq.lv}级）`,
            };
        }
    }
    return null;
}

/** 按分类填 paperSelect：tie→12 铁匠武器，xiu→6 绣庄防具，all→旧逻辑
 *  全局找 paper，不受当前工匠限制（确保 12/6 件齐） */
function fillPaperSelectByCategory(category) {
    if (category === 'all' || !category) {
        fillPaperSelect();
        return;
    }
    const sel = document.getElementById('paperSelect');
    if (!sel) return;
    const filter = (document.getElementById('paperFilter')?.value || '').trim().toLowerCase();
    const allowed = category === 'tie' ? PAPER_CATEGORY_TIE_NAMES : PAPER_CATEGORY_XIU_NAMES;
    const prev = sel.value;
    sel.innerHTML = '';
    const items = [];
    for (const name of allowed) {
        const paper = findPaperByEquipName(name);
        if (!paper) {
            // 数据里找不到对应 paper —— 占位但禁选，一眼看出哪件缺失
            items.push({ missing: true, name });
            continue;
        }
        if (filter) {
            const hay = `${paper.label} ${name}`.toLowerCase();
            if (!hay.includes(filter)) continue;
        }
        items.push(paper);
    }
    let matched = 0;
    for (const it of items) {
        const opt = document.createElement('option');
        if (it.missing) {
            opt.value = '';
            opt.textContent = `— ${it.name}（未在数据中找到对应 paper）—`;
            opt.disabled = true;
            sel.appendChild(opt);
            continue;
        }
        opt.value = JSON.stringify({
            selectId: it.selectId,
            equipId: it.equipId,
            minColor: it.minColor,
            maxColor: it.maxColor,
        });
        opt.textContent = it.label;
        sel.appendChild(opt);
        matched++;
    }
    if (!matched) {
        sel.innerHTML = '<option value="">（该分类下无匹配装备）</option>';
    } else if (prev && [...sel.options].some(o => o.value === prev)) {
        sel.value = prev;
    }
    fillSpecialSelect();
    updateMakeHints();
}

/** 同步两个分类下拉 + 重建工匠/paper 下拉（双向联动的核心） */
function syncMakeCategory(category) {
    const cat = category || 'all';
    const npcCat   = document.getElementById('npcCategoryFilter');
    const paperCat = document.getElementById('paperCategoryFilter');
    if (npcCat)   npcCat.value = cat;
    if (paperCat) paperCat.value = cat;
    if (cat === 'tie' || cat === 'xiu') {
        fillNpcSelectByCategory(cat);
    } else {
        fillNpcSelect();
    }
    fillPaperSelectByCategory(cat);
}

function fillPaperSelect() {
    const npcId = Number(document.getElementById('npcSelect').value);
    const sel = document.getElementById('paperSelect');
    const filter = (document.getElementById('paperFilter')?.value || '').trim().toLowerCase();
    const prev = sel.value;
    sel.innerHTML = '';
    let matched = 0;
    for (const it of papersForNpc(npcId)) {
        if (filter) {
            const hay = `${it.label} ${it.equip?.name || ''}`.toLowerCase();
            if (!hay.includes(filter)) continue;
        }
        const opt = document.createElement('option');
        opt.value = JSON.stringify({
            selectId: it.selectId,
            equipId: it.equipId,
            minColor: it.paper.min_color,
            maxColor: it.paper.max_color,
        });
        opt.textContent = it.label;
        sel.appendChild(opt);
        matched++;
    }
    if (!matched) {
        sel.innerHTML = '<option value="">（无匹配装备）</option>';
    } else if (prev) {
        const still = [...sel.options].some(o => o.value === prev);
        if (still) sel.value = prev;
    }
    fillSpecialSelect();
    autoSelectMangjingDefault();   // 必须在 fillSpecialSelect 之后，specialSelect 才有 options
    updateMakeHints();
}

function fillSpecialSelect() {
    const sel = document.getElementById('specialSelect');
    if (!sel) return;
    const previous = sel.value;
    let meta = null;
    try { meta = JSON.parse(document.getElementById('paperSelect')?.value || ''); }
    catch { }
    const equip = meta ? EQUIP_DATA.equipment[String(meta.equipId)] : null;
    sel.innerHTML = '<option value="0">不加特殊材料</option>';
    const materials = equip ? specialMaterialsForEquip(equip) : [];
    for (const sp of materials) {
        const opt = document.createElement('option');
        opt.value = sp.id;
        opt.textContent = sp.name || String(sp.id);
        sel.appendChild(opt);
    }
    // 恢复上次的用户选择（仍在选项里；previous='0' 即"不加"不算恢复，走默认）
    if (previous && previous !== '0' && [...sel.options].some(option => option.value === previous)) {
        sel.value = previous;
    } else {
        // 首次或上次选的不再可用 → 按装备类型默认选龙骨(2021)/紫玉髓(2023)，别再卡在「不加特殊材料」
        const typ = equip ? Number(equip.type || 0) : 0;
        const isArmor = typ >= 5 && typ <= 7;
        const defaultId = isArmor ? 2023 : 2021;
        if ([...sel.options].some(option => Number(option.value) === defaultId)) {
            sel.value = String(defaultId);
        }
    }
}

/* ── 打造页表单记忆（工匠地点 + 图纸）─────────────────────────
   重置网页会清掉 sessionStorage 里所有 yyjh_ 前缀的键，
   这里刻意用不带前缀的键，使「地点 + 图纸」能在重置/刷新后存活，
   其余配置（预览次数、特殊材料等）照常回到默认。 */
const EQUIP_FORM_KEY = 'equip_make_form_v1';

function saveMakeFormState() {
    try {
        const npc = document.getElementById('npcSelect')?.value || '';
        const paper = document.getElementById('paperSelect')?.value || '';
        const filter = document.getElementById('paperFilter')?.value || '';
        const category = document.getElementById('npcCategoryFilter')?.value || '';
        if (npc || paper || filter || category) {
            sessionStorage.setItem(EQUIP_FORM_KEY, JSON.stringify({ npc, paper, filter, category }));
        }
    } catch (e) { /* 忽略 */ }
}

/** 恢复上次的「工匠地点 + 图纸」；选项不存在时跳过，避免选中无效值 */
function restoreMakeFormState() {
    let saved = null;
    try {
        const raw = sessionStorage.getItem(EQUIP_FORM_KEY);
        if (raw) saved = JSON.parse(raw);
    } catch (e) { saved = null; }

    const npcSel = document.getElementById('npcSelect');
    const paperSel = document.getElementById('paperSelect');
    const filter = document.getElementById('paperFilter');

    if (saved && saved.npc && npcSel) {
        if ([...npcSel.options].some(o => o.value === saved.npc)) npcSel.value = saved.npc;
    }
    // 两个分类下拉同步（默认 'tie'）
    syncMakeCategory(saved?.category || 'tie');

    if (saved && saved.filter && filter) filter.value = saved.filter;

    // 必须按「已恢复的工匠 + 分类 + 筛选」重建图纸列表（用分类版，否则会退回旧逻辑全部）
    const paperCat = document.getElementById('paperCategoryFilter')?.value || 'all';
    fillPaperSelectByCategory(paperCat);

    if (saved && saved.paper && paperSel) {
        if ([...paperSel.options].some(o => o.value === saved.paper)) paperSel.value = saved.paper;
    }
    if (typeof fillSpecialSelect === 'function') fillSpecialSelect();
    if (typeof updateMakeHints === 'function') updateMakeHints();
}

function currentMakeRequest() {
    const npcId = Number(document.getElementById('npcSelect').value);
    let meta;
    try { meta = JSON.parse(document.getElementById('paperSelect').value); }
    catch { return null; }
    return {
        npc_id: npcId,
        select_id: meta.selectId,
        equip_id: meta.equipId,
        special_id: Number(document.getElementById('specialSelect').value) || 0,
        min_color: meta.minColor,
        max_color: meta.maxColor,
    };
}

function makeRequestValidationError(req) {
    if (!req) return '请选择目标装备';
    const equip = EQUIP_DATA.equipment[String(req.equip_id)];
    if (!equip) return `目标装备 ${req.equip_id} 不存在`;
    if (!req.special_id) return '';
    const material = EQUIP_DATA.special[String(req.special_id)];
    if (!material) return `特殊材料 ${req.special_id} 不存在`;
    if (!specialMaterialSupportsEquip(material, equip)) {
        return `特殊材料「${material.name || material.id}」不适用于装备「${equip.name || equip.id}」`;
    }
    return '';
}

function requireCurrentMakeRequest() {
    const req = currentMakeRequest();
    const error = makeRequestValidationError(req);
    if (error) {
        alert(error);
        return null;
    }
    return req;
}

function updateMakeHints() {
    const costEl = document.getElementById('costHint');
    const luckyEl = document.getElementById('luckyHint');
    // 这两行小字提示（消耗估算 / 保底种子）已按需求从页面移除。
    // 元素不在时直接返回，避免后面写入空引用报错（本函数只服务这两行提示）。
    if (!costEl || !luckyEl) return;
    const req = currentMakeRequest();
    if (!req) {
        costEl.textContent = '请选择目标装备';
        luckyEl.textContent = '';
        return;
    }
    const paper = EQUIP_DATA.papers[String(req.select_id)];
    const cm = EQUIP_DATA.craftsman[String(req.npc_id)];
    const eq = EQUIP_DATA.equipment[String(req.equip_id)];
    const matName = paper && EQUIP_DATA.itemNames[String(paper.dz_mat)]
        ? EQUIP_DATA.itemNames[String(paper.dz_mat)]
        : (paper ? `材料${paper.dz_mat}` : '');
    const silver = (cm?.cost || 0) + (paper?.cost || 0);
    const freePaper = !!(cm && (cm.pf || []).map(Number).includes(Number(req.select_id)));
    if (paper) {
        const parts = [];
        if (!freePaper) parts.push(`图纸「${paper.name}」×1`);
        parts.push(`${matName}×${paper.dz_num}`);
        const special = req.special_id ? EQUIP_DATA.special[String(req.special_id)] : null;
        if (special) parts.push(`特殊材料「${special.name || special.id}」×1`);
        parts.push(`银两约 ${silver}`);
        costEl.textContent = `若执行将消耗：${parts.join('、')}（仅提示）`;
    } else {
        costEl.textContent = '消耗未知';
    }

    if (!saveLoaded) {
        luckyEl.textContent = '尚未导入存档种子';
        luckyEl.classList.remove('pity');
        return;
    }
    const st = wasmMakeGetState();
    const lucky = st?.MakeLucky?.[String(req.equip_id)]?.value ?? 0;
    const tier = Math.floor((eq?.lv || 0) / 10);
    const bucket = st?.Seeds?.[String(eq?.type)];
    const hasSeed = !!(bucket && typeof bucket === 'object' && bucket[String(tier)] != null);
    if (!hasSeed && (eq?.lv || 0) < 100) {
        luckyEl.textContent = `警告：存档无 Seeds[${eq?.type}][${tier}]，无法预测`;
        luckyEl.classList.add('pity');
    } else if (lucky >= 10) {
        luckyEl.textContent = `保底已触发（MakeLucky=${lucky}）：下一次强制紫装`;
        luckyEl.classList.add('pity');
    } else {
        luckyEl.textContent = `保底 MakeLucky=${lucky}/10 · Seeds[${eq?.type}][${tier}]`;
        luckyEl.classList.remove('pity');
    }
}

function setMakeHead() {
    setPreviewTableKind('make');
    document.getElementById('previewHead').innerHTML = `<tr>
        <th>#</th><th>品质</th><th>基础</th><th>蓝词条</th><th>地区附加</th><th>盲晶最高</th><th>红词条</th><th>种子</th><th>标记</th><th>选</th><th>操作</th>
    </tr>`;
}

function setSpecialAttachHead() {
    setPreviewTableKind('special-attach');
    document.getElementById('previewHead').innerHTML = `<tr>
        <th>#</th><th>装备</th><th>材料</th><th>预测红词条</th><th>数值倍率</th><th>MJSeed（前 → 后）</th>
    </tr>`;
}

function setPreviewTableKind(kind) {
    const table = document.getElementById('previewTable');
    if (!table) return;
    table.classList.toggle('jianwang-state-table', kind === 'jianwang-state');
}

function makeSeedKind(it) {
    if (it.pity) return 'pity';
    if (it.seed_kind === 'lucky') return 'lucky';
    return 'normal';
}

function fillMakePropFilter(items) {
    const sel = document.getElementById('makeFilterProp');
    if (!sel) return;
    const prev = sel.value;
    const keys = new Set();
    for (const it of items || []) {
        for (const list of [it.exts, it.region, it.special]) {
            for (const p of list || []) {
                if (p?.prop) keys.add(p.prop);
            }
        }
    }
    const sorted = [...keys].sort((a, b) => propLabel(a).localeCompare(propLabel(b), 'zh'));
    sel.innerHTML = '<option value="">全部</option>'
        + sorted.map(k => `<option value="${escapeHtml(k)}">${escapeHtml(propLabel(k))}</option>`).join('');
    if (prev && keys.has(prev)) sel.value = prev;
}

function makeFilterMatch(it) {
    const color = document.getElementById('makeFilterColor')?.value || '';
    const seed = document.getElementById('makeFilterSeed')?.value || '';
    const prop = document.getElementById('makeFilterProp')?.value || '';
    const mjMin = document.getElementById('makeFilterMangjing')?.value || '';
    if (color && String(it.color) !== color) return false;
    if (seed && makeSeedKind(it) !== seed) return false;
    if (prop) {
        const has = [...(it.exts || []), ...(it.region || []), ...(it.special || [])]
            .some(p => p?.prop === prop);
        if (!has) return false;
    }
    if (mjMin) {
        const best = it.mangjingBest;
        if (!best) return false;
        // 盲晶值不统一（武器百分比 0~1 / 防具原始点数 1~30），
        // 统一换算成「用户看到的显示值」再比较：武器 0.055 → 5.5（输 5.5 即可），防具 16 → 16。
        const disp = mangjingDisplayValue(best.prop, best.value);
        if (!(disp >= Number(mjMin))) return false;
    }
    return true;
}

function applyMakeFilter(resetPage = false) {
    const all = tablePager.makeAllItems || [];
    tablePager.makeItems = all.filter(makeFilterMatch);
    if (resetPage) tablePager.page = 1;
    const metaFilter = document.getElementById('makeFilterMeta');
    if (metaFilter) metaFilter.textContent = `显示 ${tablePager.makeItems.length} / ${all.length} 条`;
    renderMakePage();
}

function renderMakePage() {
    const body = document.getElementById('previewBody');
    if (!body) return;
    const items = tablePager.makeItems || [];
    const pageSize = getPreviewPageSize();
    const start = (tablePager.page - 1) * pageSize;
    const slice = items.slice(start, start + pageSize);
    const defaultMark = escapeHtml(getDefaultMakeMark());
    if (!slice.length) {
        body.innerHTML = `<tr><td colspan="11" class="empty-row">无匹配记录</td></tr>`;
        updatePreviewPager(items.length);
        updateMakeBatchButton();
        return;
    }
    body.innerHTML = slice.map(it => {
        const seedTxt = it.pity ? '保底' : (it.seed_kind === 'lucky' ? '幸运' : '普通');
        const seedCls = it.seed_kind === 'lucky' || it.pity ? 'seed-tag lucky' : 'seed-tag';
        return `<tr data-make-index="${it.index}">
            <td>${it.index}</td>
            <td class="color-${it.color}">${COLOR_NAMES[it.color] || it.color}</td>
            <td>${formatBase(it.base)}</td>
            <td>${formatProps(it.exts)}</td>
            <td>${formatProps(it.region)}</td>
            <td>${mangjingBestText(it)}</td>
            <td>${formatProps(it.special)}</td>
            <td><span class="${seedCls}">${seedTxt}</span></td>
            <td><input type="text" class="mark-input make-row-mark" maxlength="40" value="${defaultMark}" placeholder="标记"></td>
            <td><input type="checkbox" class="make-row-check" data-index="${it.index}" data-color="${it.color}" title="勾选后可用「一键推进」批量推进"></td>
            <td><button type="button" class="btn btn-wash btn-row-action btn-make-advance" data-index="${it.index}">推进到此</button></td>
        </tr>`;
    }).join('');
    updatePreviewPager(items.length);
    updateMakeBatchButton();
    // 渲染后立即校验：标记里的品质名与行的实际品质是否一致
    document.querySelectorAll('#previewBody .make-row-mark').forEach(flagMarkMismatch);
}

/* ── 打造预测结果：逐件跑盲晶 ─────────────────────────────── */

/** 当前预览的目标装备类型（同一次预测所有件都是同一件装备） */
function currentMakeEquipType() {
    try {
        const meta = JSON.parse(document.getElementById('paperSelect')?.value || '');
        const eq = EQUIP_DATA.equipment[String(meta.equipId)];
        return eq ? Number(eq.type || 0) : 0;
    } catch (e) { return 0; }
}

/** 当前预览选中的图纸 ID（算 MJSeed 需要：MJSeed = CZSeed - paperId * 198） */
function currentMakePaperId() {
    try {
        const meta = JSON.parse(document.getElementById('paperSelect')?.value || '');
        return Number(meta?.selectId);
    } catch (e) { return 0; }
}

/** 盲晶材料默认：用户没选特殊材料(id=0)时，按装备类型自动选龙骨(2021)/紫玉髓(2023)
 *  用户已选了非零材料就不动 */
function autoSelectMangjingDefault() {
    const sel = document.getElementById('specialSelect');
    if (!sel) return;
    if (Number(sel.value) > 0) return;   // 用户已选，不动
    const typ = currentMakeEquipType();
    const isArmor = typ >= 5 && typ <= 7;
    const defaultId = isArmor ? 2023 : 2021;
    const m = EQUIP_DATA.special[String(defaultId)];
    if (m && [...sel.options].some(o => Number(o.value) === defaultId)) {
        sel.value = String(defaultId);
    }
}

/** 盲晶材料：优先「特殊材料」下拉（需与装备匹配），否则武器=龙骨(2021)、防具=紫玉髓(2023) */
function pickMangjingMaterial(equipType, equip) {
    const sel = document.getElementById('specialSelect');
    const id = sel ? Number(sel.value) : 0;
    if (id > 0 && equip) {
        const m = EQUIP_DATA.special[String(id)];
        if (m) {
            let ok = false;
            try {
                ok = typeof specialMaterialSupportsEquip === 'function'
                    ? specialMaterialSupportsEquip(m, equip) : false;
            } catch (e) { ok = false; }
            if (ok) return m;
        }
    }
    const isArmor = equipType >= 5 && equipType <= 7;
    return EQUIP_DATA.special[String(isArmor ? 2023 : 2021)] || null;
}

/** 造一个能跑盲晶的 equip，并复刻自动页的「先升炼到 100 级」步骤。
 *  自动页 L5954 用的是 specialAttachEquips（升炼后 100 级）的 equip，
 *  所以材料数值查 lvs['lv100']；直接用 90 级会查 lv90，紫玉髓等材料没有该档 → 抛错。
 *  MJSeed 在升炼中不变（upgradeEquip 是 ...clone(equip)），只改 id/name/need_lv/typ。 */
function buildMangjingEquip(it, equipType) {
    let meta;
    try { meta = JSON.parse(document.getElementById('paperSelect')?.value || ''); } catch (e) { meta = null; }
    const equipId = meta ? meta.equipId : 0;
    const cfg = EQUIP_DATA.equipment[String(equipId)];
    if (!cfg) return null;
    const equip = {
        id: Number(equipId),
        name: cfg.name || ('item_' + it.index),
        need_lv: Number(cfg.lv) || 90,
        typ: Number(cfg.type) || equipType,
        color: Number(it.color) || 0,
        MJSeed: it.MJSeed,
    };
    // 复刻 canUpgrade + upgradeEquip：90 级、非橙红、有下一档 → 升到 100 级
    if (equip.need_lv === 90 && equip.color < 5) {
        const nextId = Number(cfg.equ_next) || 0;
        const cfgNext = nextId ? EQUIP_DATA.equipment[String(nextId)] : null;
        if (cfgNext) {
            equip.id = nextId;
            equip.name = cfgNext.name || String(nextId);
            equip.need_lv = Number(cfgNext.lv) || 100;
            equip.typ = Number(cfgNext.type) || equip.typ;
        }
    }
    return equip;
}

/** 逐件跑盲晶，把「最高那次」挂到 item.mangjingBest（同值取第一次） */
function computeMangjingForItems(items, count) {
    const equipType = currentMakeEquipType();
    const paperId = currentMakePaperId();
    const validCount = Math.max(1, Math.min(MANGJING_MAX, Number(count) || MANGJING_DEFAULT));
    for (const it of items || []) {
        it.mangjingBest = null;
        if (!it) continue;
        // make 预览项自带 CZSeed，据此算出盲晶必需的 MJSeed
        if (Number.isSafeInteger(paperId) && paperId > 0) {
            try {
                it.MJSeed = craftedMJSeedFromMakeResult(it, paperId);
            } catch (e) {
                console.warn('[盲晶] MJSeed 算不出来，preview 项可能没有 CZSeed。paperId=' + paperId + ', item keys=' + Object.keys(it).join(','));
                it.MJSeed = 0;
            }
        }
        if (!Number.isSafeInteger(it.MJSeed) || it.MJSeed <= 0) continue;
        // 构造可跑盲晶的 equip（含升炼到 100 级），预览项本身缺 typ/need_lv/name
        const mjEquip = buildMangjingEquip(it, equipType);
        if (!mjEquip) continue;
        let material = pickMangjingMaterial(mjEquip.typ, mjEquip);
        if (!material) continue;
        let arr = [];
        try {
            const result = runSpecialAttachPredict(mjEquip, material, validCount);
            arr = Array.isArray(result) ? result : (Array.isArray(result?.items) ? result.items : []);
        } catch (e) {
            // 选定材料与装备不匹配 → 回退按类型默认材料再试一次
            material = pickMangjingMaterial(mjEquip.typ, null);
            if (!material) continue;
            try {
                const result = runSpecialAttachPredict(mjEquip, material, validCount);
                arr = Array.isArray(result) ? result : (Array.isArray(result?.items) ? result.items : []);
            } catch (e2) { continue; }
        }
        let best = null;
        for (const r of arr) {
            const v = Number(r?.value);
            if (!Number.isFinite(v)) continue;
            if (!best || v > Number(best.value)) best = r;
        }
        if (best) it.mangjingBest = best;
    }
}

/** 盲晶预测单元格：两行结构，主值加粗 + 第 N 次小灰字，无则「—」 */
function mangjingBestText(it) {
    const best = it?.mangjingBest;
    if (!best) return '—';
    const valTxt = `${escapeHtml(propLabel(best.prop))}+${escapeHtml(formatPropValue(best.prop, best.value))}`;
    // index 缺失/非法时省略「第 N 次」，避免显示「第 NaN 次」
    const idxNum = Number(best.index);
    const idxTxt = Number.isFinite(idxNum) ? `第 ${idxNum} 次` : '';
    return idxTxt
        ? `<span class="mj-val">${valTxt}</span><span class="mj-idx">· ${idxTxt}</span>`
        : `<span class="mj-val">${valTxt}</span>`;
}

function renderMakePreview(resp) {
    setMakeHead();
    const body = document.getElementById('previewBody');
    const meta = document.getElementById('previewMeta');
    const seqNotice = document.getElementById('makeSeqNotice');
    const filterBar = document.getElementById('makeFilterBar');
    const xlFilter = document.getElementById('xilianFilterBar');
    if (xlFilter) xlFilter.hidden = true;
    renderMakeAdvanceNotice();
    if (resp.error && (!resp.items || !resp.items.length)) {
        body.innerHTML = `<tr><td colspan="11" class="empty-row">${escapeHtml(resp.error)}</td></tr>`;
        meta.textContent = '';
        if (seqNotice) seqNotice.hidden = true;
        if (filterBar) filterBar.hidden = true;
        hidePreviewPager();
        return;
    }
    const items = resp.items || [];
    const purple = items.filter(i => i.color === 4).length;
    const sequenceTip = makeAdvanceNotice ? ' · 下表从推进后的下一件重新编号' : '';
    // 内核已换回含「打造后状态推进修正」的 core_glue（MAKE_SLOT_ADVANCE_BOUND=98999999，
    // 保底件改走 LuckySeeds），多件序列与游戏一致，不再提示偏移。
    if (seqNotice) seqNotice.hidden = true;
    const seqWarn = '';
    meta.textContent = `共 ${items.length} 件 · 紫装 ${purple} · 可点「推进到此」直达${sequenceTip}${seqWarn}` + (resp.error ? ` · ${resp.error}` : '');
    tablePager.mode = 'make';
    tablePager.page = 1;
    tablePager.makeAllItems = items;
    if (filterBar) {
        filterBar.hidden = false;
        // 默认只筛紫装；用户仍可在下拉里改成其他品质或「全部」
        document.getElementById('makeFilterColor').value = DEFAULT_MAKE_COLOR_FILTER;
        document.getElementById('makeFilterSeed').value = '';
        fillMakePropFilter(items);
        document.getElementById('makeFilterProp').value = '';
        document.getElementById('makeFilterMangjing').value = '';
    }
    // 逐件跑盲晶（默认全跑），取最高那次用于展示 + 筛选
    computeMangjingForItems(items, Number(document.getElementById('mangjingCount')?.value) || MANGJING_DEFAULT);
    applyMakeFilter(true);
}

const SPECIAL_QUALITY_WEIGHTS = [5000, 500, 50, 5, 1];
const SPECIAL_QUALITY_RANGES = [[85, 95], [95, 105], [105, 115], [115, 125], [125, 150]];
const WHALE_MULTIPLIER = 245109059551232n;
const WHALE_INCREMENT = 48083817484545n;
const WHALE_MASK = 2147483647n;
const WHALE_REDUCTION_LIMIT = 2047483645n;

function requirePositiveInteger(value, field) {
    if (!Number.isSafeInteger(value) || value < 1) {
        throw new TypeError(`${field}必须是正整数，实际为 ${String(value)}`);
    }
    return value;
}

function drawWhaleInt(seed, maximum) {
    const validSeed = requirePositiveInteger(seed, '随机种子');
    const validMaximum = requirePositiveInteger(maximum, '随机上限');
    const mixed = BigInt.asUintN(
        64,
        (BigInt(validSeed) + BigInt(validMaximum)) * WHALE_MULTIPLIER + WHALE_INCREMENT,
    );
    const raw = (mixed >> 17n) & WHALE_MASK;
    const nextSeed = Number((raw < WHALE_REDUCTION_LIMIT ? raw : raw - WHALE_REDUCTION_LIMIT) + 1n);
    return { seed: nextSeed, value: nextSeed % validMaximum + 1 };
}

function drawWeightedIndex(seed, weights, context) {
    if (!Array.isArray(weights) || !weights.length) {
        throw new TypeError(`${context}权重不能为空`);
    }
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
    const index = validWeights.findIndex((weight) => {
        cumulative += weight;
        return draw.value <= cumulative;
    });
    if (index < 0) throw new RangeError(`${context}随机值 ${draw.value} 超出总权重 ${total}`);
    return { seed: draw.seed, index };
}

function drawJianwangBetween(seed, minimum, maximum, context) {
    if (!Number.isSafeInteger(minimum) || !Number.isSafeInteger(maximum) || maximum < minimum) {
        throw new TypeError(`${context}区间无效：${minimum}–${maximum}`);
    }
    const draw = drawWhaleInt(seed, maximum - minimum + 1);
    return { seed: draw.seed, value: draw.value - 1 + minimum };
}

const JIANWANG_RULE_PATCHED = 'patched';
const JIANWANG_RULE_STANDARD = 'standard';

function classifyJianwangExtSeedBatch(equip) {
    if (!equip || !isJianwangSword(equip) || !Array.isArray(equip.exts)) return null;
    const seeds = equip.exts.map(ext => Number(ext?.S || 0));
    if (seeds.length < 2 || seeds.some(seed => !Number.isSafeInteger(seed) || seed <= 0)) return null;

    // 游戏保留词条时只覆盖下一批的一号位，不会让新生成词条顺延。
    // 因此 3 条以上时用第 2..N 位判断“本轮新生成批次”；一号位允许保留旧 S。
    const generatedBatch = seeds.length >= 3 ? seeds.slice(1) : seeds;
    if (new Set(generatedBatch).size === 1) return JIANWANG_RULE_PATCHED;

    // 当前已经确认的无保留 70→80 实物中，原项目规则会让两条新词出现不同 S。
    // 2 槽装备无法安全剔除一号位，所以两条不同才作为原项目规则证据。
    if (seeds.length === 2) return JIANWANG_RULE_STANDARD;
    return null;
}

function detectJianwangRuleFromEquips(equips) {
    const evidence = (Array.isArray(equips) ? equips : [])
        .filter(isJianwangSword)
        .map(equip => ({ equip, rule: classifyJianwangExtSeedBatch(equip) }))
        .filter(item => item.rule);
    const patchedCount = evidence.filter(item => item.rule === JIANWANG_RULE_PATCHED).length;
    const standardCount = evidence.filter(item => item.rule === JIANWANG_RULE_STANDARD).length;

    if (standardCount > 0 && patchedCount === 0) {
        return Object.freeze({
            rule: JIANWANG_RULE_STANDARD,
            confidence: standardCount > 1 ? 'batch-consensus' : 'batch-evidence',
            reason: `${standardCount} 把实物的可判定新生成批次的 EnExts.S 不一致，使用原项目规则`,
        });
    }
    if (patchedCount > 0 && standardCount === 0) {
        return Object.freeze({
            rule: JIANWANG_RULE_PATCHED,
            confidence: patchedCount > 1 ? 'batch-consensus' : 'batch-evidence',
            reason: `${patchedCount} 把实物的可判定新生成批次共用 EnExts.S，使用二号补丁规则`,
        });
    }
    if (standardCount > patchedCount) {
        return Object.freeze({
            rule: JIANWANG_RULE_STANDARD,
            confidence: 'batch-majority',
            reason: `实物批次 S 证据冲突（原项目 ${standardCount} / 二号补丁 ${patchedCount}），按多数使用原项目规则`,
        });
    }
    if (patchedCount > standardCount) {
        return Object.freeze({
            rule: JIANWANG_RULE_PATCHED,
            confidence: 'batch-majority',
            reason: `实物批次 S 证据冲突（二号补丁 ${patchedCount} / 原项目 ${standardCount}），按多数使用二号补丁规则`,
        });
    }
    return Object.freeze({
        rule: JIANWANG_RULE_PATCHED,
        confidence: evidence.length ? 'conflict-fallback' : 'fallback',
        reason: evidence.length
            ? '实物批次 S 证据数量相同且互相冲突，保持二号补丁规则'
            : '没有至少两条且带有效 EnExts.S 的剑王阁实物，保持二号补丁规则',
    });
}

function currentJianwangRule() {
    return jianwangRuleDetection?.rule === JIANWANG_RULE_STANDARD
        ? JIANWANG_RULE_STANDARD
        : JIANWANG_RULE_PATCHED;
}

function generateJianwangEquip(targetId, startSeed, rule = JIANWANG_RULE_PATCHED) {
    const cfg = EQUIP_DATA.equipment[String(targetId)];
    if (!cfg || !JIANWANG_SWORD_IDS.has(Number(targetId))) {
        throw new RangeError(`无效的剑王阁目标装备：${targetId}`);
    }
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
    const candidateWeights = candidates.map(prop => Math.max(0, Math.floor(Number(cfg.exts[prop][1]) || 0)));
    const slotCount = Math.max(0, Math.floor(((Number(cfg.lv) || 60) - 60) / 10) + 1);
    const exts = [];
    for (let slot = 0; slot < slotCount; slot++) {
        const propDraw = drawWeightedIndex(seed, candidateWeights, '剑王阁副属性');
        seed = propDraw.seed;
        const prop = candidates[propDraw.index];
        exts.push({
            prop,
            value: Number(cfg.exts[prop][0]),
        });
        if (standard) candidateWeights[propDraw.index] = 0;
    }
    return { id: Number(targetId), seedAfter: seed, base, exts };
}

function validJianwangRedSeed(value) {
    const seed = Number(value);
    return Number.isSafeInteger(seed) && seed > 0;
}

function createJianwangBlankFromRedSeed(redSeed, swordIndex = null) {
    const sourceRedSeed = requirePositiveInteger(Number(redSeed), 'RedSeeds[5707]');
    const sequenceIndex = swordIndex == null ? null : requirePositiveInteger(Number(swordIndex), '模拟背包剑序号');
    const baseSeed = Math.floor(sourceRedSeed / 10);
    const MJSeed = baseSeed + JIANWANG_BLANK_ID * JIANWANG_REDSEED_MJ_MULTIPLIER;
    const CZSeed = baseSeed + JIANWANG_BLANK_ID * JIANWANG_REDSEED_CZ_MULTIPLIER;
    requirePositiveInteger(MJSeed, '新剑胚 MJSeed');
    requirePositiveInteger(CZSeed, '新剑胚 CZSeed');
    const generated = generateJianwangEquip(JIANWANG_BLANK_ID, sourceRedSeed, JIANWANG_RULE_STANDARD);
    const nextRedSeed = drawWhaleInt(sourceRedSeed, JIANWANG_REDSEED_DRAW_MAX).seed;
    const cfg = EQUIP_DATA.equipment[String(JIANWANG_BLANK_ID)] || {};
    const equip = {
        id: JIANWANG_BLANK_ID,
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
        exts: generated.exts.map(item => ({ prop: item.prop, value: item.value })),
        specials: [],
        xilian_marks: [],
        xilian_accepted: 0,
        _source: sequenceIndex ? '模拟背包' : '网页碎剑重铸',
        _equipped: false,
        _crafted: false,
        _mark: '',
        _jianwangRebuilt: true,
        _jianwangSwordIndex: sequenceIndex,
    };
    return {
        redSeedBefore: sourceRedSeed,
        redSeedAfter: nextRedSeed,
        baseSeed,
        MJSeed,
        CZSeed,
        S: generated.seedAfter,
        swordIndex: sequenceIndex,
        base: generated.base,
        exts: generated.exts.map(item => ({ prop: item.prop, value: item.value })),
        equip,
    };
}

function createJianwangVirtualFirstSword(redSeed) {
    const created = createJianwangBlankFromRedSeed(redSeed, 1);
    return {
        ...created,
        equip: {
            ...created.equip,
            _source: '虛擬劍胚',
            _jianwangRebuilt: false,
            _jianwangVirtualFirst: true,
            _jianwangSwordIndex: 1,
            _jianwangNextRedSeed: created.redSeedAfter,
        },
    };
}

function refreshJianwangVirtualFirstSword() {
    if (jianwangVirtualFirstSword) delete equipRuntime[runtimeKey(jianwangVirtualFirstSword)];
    jianwangVirtualFirstSword = null;
    if (saveEquips.some(isJianwangSword) || !validJianwangRedSeed(jianwangRedSeed)) return;
    const created = createJianwangVirtualFirstSword(jianwangRedSeed);
    jianwangVirtualFirstSword = created.equip;
    const key = runtimeKey(jianwangVirtualFirstSword);
    const full = {
        ...jianwangVirtualFirstSword,
        ...toWasmEquip(jianwangVirtualFirstSword),
        xilian_marks: [...(jianwangVirtualFirstSword.xilian_marks || [])],
    };
    equipRuntime[key] = JSON.parse(JSON.stringify(full));
}

function jianwangNextRedSeedForEquip(equip) {
    const virtualNext = Number(equip?._jianwangNextRedSeed);
    return validJianwangRedSeed(virtualNext) ? virtualNext : jianwangRedSeed;
}

function predictJianwangFutureBlanks(startRedSeed, count = 1) {
    const total = Number(count);
    if (!Number.isSafeInteger(total) || total < 1 || total > PREVIEW_MAX) {
        throw new RangeError(`预览把数必须是 1–${PREVIEW_MAX} 的整数`);
    }
    let redSeed = requirePositiveInteger(Number(startRedSeed), 'RedSeeds[5707]');
    const rows = [];
    for (let index = 1; index <= total; index++) {
        const created = createJianwangBlankFromRedSeed(redSeed);
        rows.push({ index, ...created });
        redSeed = created.redSeedAfter;
    }
    return rows;
}

function jianwangShatterRouteId(equip) {
    const routeId = JIANWANG_SHATTER_ROUTE_IDS[Number(equip?.id)];
    if (!routeId) throw new TypeError('只有90级专武或100级神兵可以碎剑重铸');
    return routeId;
}

function predictJianwangShatterRebuild(equip, action, redSeed) {
    if (!equip || !isJianwangSword(equip)) throw new TypeError('请选择剑王阁实物或虛擬劍胚');
    const id = Number(equip.id);
    const isNinety = action === JIANWANG_SHATTER_90 && JIANWANG_LEVEL_90_IDS.has(id);
    const isHundred = action === JIANWANG_SHATTER_100 && JIANWANG_LEVEL_100_IDS.has(id);
    if (!isNinety && !isHundred) {
        throw new RangeError(action === JIANWANG_SHATTER_90
            ? '90级碎剑只能用于5710～5713'
            : '100级碎神兵只能用于5714～5717');
    }
    const nextSwordIndex = Math.max(0, Math.floor(Number(equip._jianwangSwordIndex) || 0)) + 1;
    const created = createJianwangBlankFromRedSeed(redSeed, nextSwordIndex);
    const fromStage = jianwangStageName(equip);
    return {
        index: 1,
        action,
        routeId: jianwangShatterRouteId(equip),
        fromId: id,
        toId: JIANWANG_BLANK_ID,
        fromName: fromStage,
        toName: jianwangStageName(created.equip),
        shatterLabel: isNinety ? '90级碎剑' : '100级碎神兵',
        cost: '碎剑返还：剑胚6518×1、雪银3024×200、紫金3025×300、青金石2000×10、陨铁2020×2、贡献-500、碎剑计数+1；重新锻造：剑胚6518×1、雪银3024×200、青金石2000×10、贡献-500',
        ...created,
    };
}

function resolveJianwangCycleRouteId(equip, requestedRouteId = null) {
    if (!equip || !isJianwangSword(equip)) throw new TypeError('请选择剑王阁剑胚或专武');
    const id = Number(equip.id);
    const fixedRouteId = JIANWANG_SHATTER_ROUTE_IDS[id];
    if (fixedRouteId) return fixedRouteId;
    if (![5707, 5708, 5709].includes(id)) throw new TypeError('当前剑王阁装备不能进入碎剑预览');
    const routeId = Number(requestedRouteId);
    if (!JIANWANG_LEVEL_90_IDS.has(routeId)) throw new TypeError('请选择90级专武路线');
    return routeId;
}

function prepareJianwangCycleStart(equip, routeId, rule = currentJianwangRule()) {
    let current = JSON.parse(JSON.stringify(equip));
    const rows = [];
    const targets = [];
    if (Number(current.id) === 5707) targets.push(5708, 5709, routeId);
    else if (Number(current.id) === 5708) targets.push(5709, routeId);
    else if (Number(current.id) === 5709) targets.push(routeId);
    for (const targetId of targets) {
        const row = predictJianwangStateSequence(current, `grow:${targetId}`, 1, 0, 0, rule)[0];
        current = JSON.parse(JSON.stringify(row.equip));
        rows.push({ ...row, index: rows.length + 1 });
    }
    return { equip: current, rows };
}

function predictJianwangShatterCycle(equip, startRedSeed, count = 1, rule = currentJianwangRule(), requestedRouteId = null) {
    if (!equip || !isJianwangSword(equip)) {
        throw new TypeError('碎剑预览只能从剑王阁5707～5717实物或虛擬劍胚开始');
    }
    const total = Number(count);
    if (!Number.isSafeInteger(total) || total < 1 || total > PREVIEW_MAX) {
        throw new RangeError(`循环次数必须是 1–${PREVIEW_MAX} 的整数`);
    }
    const initial = JSON.parse(JSON.stringify(equip));
    const routeId = resolveJianwangCycleRouteId(initial, requestedRouteId);
    const prepared = prepareJianwangCycleStart(initial, routeId, rule);
    let current = prepared.equip;
    let redSeed = requirePositiveInteger(Number(startRedSeed), 'RedSeeds[5707]');
    const initialId = Number(initial.id);
    const entryNote = JIANWANG_LEVEL_100_IDS.has(initialId)
        ? `${jianwangStageName(initial)}直接碎神兵进入第1轮`
        : prepared.rows.length
            ? `${jianwangStageName(initial)}先无保留升至${jianwangStageName(current)}后碎剑进入第1轮`
            : `${jianwangStageName(initial)}直接碎剑进入第1轮`;
    const pages = [];
    for (let cycle = 1; cycle <= total; cycle++) {
        const shatterAction = JIANWANG_LEVEL_100_IDS.has(Number(current.id))
            ? JIANWANG_SHATTER_100
            : JIANWANG_SHATTER_90;
        const shatter = predictJianwangShatterRebuild(current, shatterAction, redSeed);
        let stage = JSON.parse(JSON.stringify(shatter.equip));
        const rows = [{
            index: 1,
            action: 'blank',
            fromId: Number(current.id),
            toId: JIANWANG_BLANK_ID,
            fromName: jianwangStageName(current),
            toName: jianwangStageName(stage),
            seedBefore: Number(stage.CZSeed),
            seedAfter: Number(stage.CZSeed),
            base: stage.base || {},
            exts: stage.exts || [],
            kept: null,
            cost: shatter.cost,
            shatterLabel: shatter.shatterLabel,
            equip: JSON.parse(JSON.stringify(stage)),
            redSeedBefore: shatter.redSeedBefore,
            redSeedAfter: shatter.redSeedAfter,
        }];
        const growActions = ['grow:5708', 'grow:5709', `grow:${routeId}`];
        for (const action of growActions) {
            const row = predictJianwangStateSequence(stage, action, 1, 0, 0, rule)[0];
            stage = JSON.parse(JSON.stringify(row.equip));
            rows.push({ ...row, index: rows.length + 1 });
        }
        const reforges = predictJianwangStateSequence(stage, 'reforge', JIANWANG_REFORGE_LIMIT, 0, 0, rule);
        for (const row of reforges) {
            stage = JSON.parse(JSON.stringify(row.equip));
            rows.push({ ...row, index: rows.length + 1 });
        }
        pages.push({
            cycle,
            swordIndex: Number(shatter.equip._jianwangSwordIndex) || cycle,
            routeId,
            name: shatter.equip.name,
            entryNote: cycle === 1 ? entryNote : '',
            initialPreparation: cycle === 1 ? prepared.rows : [],
            shatterLabel: shatter.shatterLabel,
            blank: JSON.parse(JSON.stringify(shatter.equip)),
            finalEquip: JSON.parse(JSON.stringify(stage)),
            redSeedBefore: shatter.redSeedBefore,
            redSeedAfter: shatter.redSeedAfter,
            rows,
        });
        current = stage;
        redSeed = shatter.redSeedAfter;
    }
    return pages;
}

function requireJianwangKeepIndex(equip, action, keepIndex) {
    const index = Number(keepIndex) || 0;
    const limit = jianwangKeepLimit(equip, action);
    if (!Number.isSafeInteger(index) || index < 0 || index > limit) {
        throw new RangeError(`保留槽位必须是 0–${limit} 的整数`);
    }
    return index;
}

function predictJianwangGrow(equip, targetId, keepIndex = 0, rule = currentJianwangRule()) {
    if (!equip || !isJianwangSword(equip)) throw new TypeError('请选择剑王阁实物或虛擬劍胚');
    if (!validJianwangCZSeed(equip)) throw new TypeError('所选实物缺少有效 CZSeed');
    const fromId = Number(equip.id);
    const target = Number(targetId);
    const action = target === fromId ? 'reforge' : `grow:${target}`;
    const allowed = target === fromId
        ? JIANWANG_LEVEL_90_IDS.has(fromId)
        : (JIANWANG_GROW_TARGETS[fromId] || []).includes(target);
    if (!allowed) throw new RangeError(`不允许从 ${fromId} 成长到 ${target}`);
    const index = requireJianwangKeepIndex(equip, action, keepIndex);
    const generated = generateJianwangEquip(target, Number(equip.CZSeed), rule);
    const exts = generated.exts.map(item => ({ prop: item.prop, value: item.value }));
    if (index > 0) {
        const kept = equip.exts[index - 1];
        exts.splice(0, 1);
        exts.unshift({ prop: kept.prop, value: kept.value });
    }
    const cfg = EQUIP_DATA.equipment[String(target)];
    return {
        ...JSON.parse(JSON.stringify(equip)),
        id: target,
        name: cfg.name,
        need_lv: cfg.lv,
        typ: cfg.type,
        color: 6,
        exp: target === fromId ? Number(equip.exp) || 0 : 0,
        base: generated.base,
        exts,
        CZSeed: generated.seedAfter,
    };
}

function predictJianwangAscend(equip, targetId) {
    if (!equip || !JIANWANG_LEVEL_90_IDS.has(Number(equip.id))) {
        throw new TypeError('只有存档中的90级剑王阁专武可以铸为100级神兵');
    }
    const target = Number(targetId);
    if (JIANWANG_LEVEL_100_TARGETS[Number(equip.id)] !== target) {
        throw new RangeError(`90级专武 ${equip.id} 不能转换为 ${target}`);
    }
    const cfg = EQUIP_DATA.equipment[String(target)];
    return {
        ...JSON.parse(JSON.stringify(equip)),
        id: target,
        name: cfg.name,
        need_lv: cfg.lv,
        typ: cfg.type,
        color: 6,
        exp: 0,
        base: { ...(cfg.base || {}) },
        exts: (equip.exts || []).slice(0, 6).map(item => ({ prop: item.prop, value: item.value })),
        CZSeed: equip.CZSeed,
    };
}

function predictJianwangStateSequence(equip, action, count = 1, keepIndex = 0, completedReforges = 0, rule = currentJianwangRule()) {
    if (!equip) throw new TypeError('请选择剑王阁实物或虛擬劍胚');
    const total = action === 'reforge' ? Number(count) : 1;
    if (!Number.isSafeInteger(total) || total < 1 || total > PREVIEW_MAX) {
        throw new RangeError(`预测次数必须是 1–${PREVIEW_MAX} 的整数`);
    }
    if (action === 'reforge') {
        const completed = Math.max(0, Math.floor(Number(completedReforges) || 0));
        const remaining = Math.max(0, JIANWANG_REFORGE_LIMIT - completed);
        if (total > remaining) {
            throw new RangeError(remaining > 0
                ? `此流派已重铸 ${completed} 次，仅剩 ${remaining} 次可预览`
                : `此流派已重铸 ${completed} 次，已达 ${JIANWANG_REFORGE_LIMIT} 次上限`);
        }
    }
    let current = JSON.parse(JSON.stringify(equip));
    const rows = [];
    for (let index = 1; index <= total; index++) {
        const before = current;
        if (action === 'reforge') {
            current = predictJianwangGrow(current, current.id, keepIndex, rule);
        } else if (action.startsWith('grow:')) {
            current = predictJianwangGrow(current, Number(action.split(':')[1]), keepIndex, rule);
        } else if (action.startsWith('ascend:')) {
            current = predictJianwangAscend(current, Number(action.split(':')[1]));
        } else {
            throw new RangeError(`不支持的剑王阁流程：${action}`);
        }
        const kept = Number(keepIndex) > 0 ? before.exts?.[Number(keepIndex) - 1] : null;
        rows.push({
            index,
            action,
            fromId: Number(before.id),
            toId: Number(current.id),
            fromName: jianwangStageName(before),
            toName: jianwangStageName(current),
            seedBefore: Number(before.CZSeed),
            seedAfter: Number(current.CZSeed),
            base: current.base || {},
            exts: current.exts || [],
            kept: kept ? { prop: kept.prop, value: kept.value } : null,
            cost: action === 'reforge'
                ? jianwangReforgeCost(Number(completedReforges) + index)
                : jianwangCostText(before, action, index),
            equip: JSON.parse(JSON.stringify(current)),
        });
    }
    return rows;
}

function requireSpecialMaterial(material, equip) {
    if (!material || typeof material !== 'object' || Array.isArray(material)) {
        throw new TypeError('特殊材料必须是对象');
    }
    if (!Number.isSafeInteger(material.id) || typeof material.name !== 'string' || !material.name) {
        throw new TypeError('特殊材料缺少有效的 id 或名称');
    }
    if (!specialMaterialSupportsEquip(material, equip)) {
        throw new RangeError(`特殊材料「${material.name}」不适用于装备「${equip.name}」`);
    }
    if (!Array.isArray(material.prop) || !material.prop.length) {
        throw new TypeError(`特殊材料「${material.name}」缺少属性权重`);
    }
    if (!material.lvs || typeof material.lvs !== 'object' || Array.isArray(material.lvs)) {
        throw new TypeError(`特殊材料「${material.name}」缺少等级数值`);
    }
    return material;
}

function specialMaterialParts(material) {
    if (!Array.isArray(material.part)) {
        throw new TypeError(`特殊材料「${material.name}」的适用部位格式无效`);
    }
    if (material.part.length) return material.part;
    return SPECIAL_MATERIAL_PART_OVERRIDES[String(material.id)] || [];
}

function specialMaterialSupportsEquip(material, equip) {
    const equipType = equip && (equip.typ != null ? equip.typ : equip.type);
    return specialMaterialParts(material).includes(equipType);
}

function clearMakeAdvanceNotice() {
    makeAdvanceNotice = null;
    renderMakeAdvanceNotice();
}

function setMakeAdvanceNotice(result, crafted, advancedCount) {
    const n = Math.max(1, Math.floor(Number(advancedCount) || 1));
    const rawColor = Number(result?.color);
    const color = Number.isSafeInteger(rawColor) && rawColor >= 1 && rawColor <= 6 ? rawColor : 1;
    const rawOnlyId = Number(crafted?.only_id);
    makeAdvanceNotice = {
        advancedCount: n,
        result: {
            name: result?.name || String(result?.equip_id || '装备'),
            color,
            base: result?.base || {},
            exts: result?.exts || [],
            region: result?.region || [],
            special: result?.special || [],
            seed_kind: result?.seed_kind || 'normal',
            pity: !!result?.pity,
        },
        onlyId: Number.isSafeInteger(rawOnlyId) && rawOnlyId > 0 ? rawOnlyId : null,
        mark: crafted?._mark || '',
    };
    renderMakeAdvanceNotice();
}

function renderMakeAdvanceNotice() {
    const box = document.getElementById('makeAdvanceNotice');
    if (!box) return;
    if (!makeAdvanceNotice || currentTab !== 'make') {
        box.hidden = true;
        box.innerHTML = '';
        return;
    }
    const { advancedCount: n, result, onlyId, mark } = makeAdvanceNotice;
    const color = COLOR_NAMES[result.color] || result.color;
    const seed = result.pity ? '保底' : (result.seed_kind === 'lucky' ? '幸运' : '普通');
    const middle = n > 1 ? `前 ${n - 1} 件只推进、未加入背包；` : '';
    const bag = onlyId ? `已加入模拟背包 #${onlyId}` : '已完成推进';
    const markText = mark ? ` · 标记「${escapeHtml(mark)}」` : '';
    box.innerHTML = `<div class="make-advance-notice-head">
        <span class="make-advance-notice-title">本次推进结果：${escapeHtml(result.name)} · <span class="color-${result.color}">${escapeHtml(String(color))}</span> · ${escapeHtml(seed)}${markText}</span>
        <span class="make-advance-notice-sequence">${middle}第 ${n} 件${bag}；下表从下一件重新编号</span>
    </div>
    <div class="make-advance-notice-details">
        <div class="make-advance-notice-detail"><strong>基础属性</strong>${formatBase(result.base)}</div>
        <div class="make-advance-notice-detail"><strong>蓝/紫词条</strong>${formatProps(result.exts)}</div>
        <div class="make-advance-notice-detail"><strong>地区附加</strong>${formatProps(result.region)}</div>
        <div class="make-advance-notice-detail"><strong>特殊材料</strong>${formatProps(result.special)}</div>
    </div>`;
    box.hidden = false;
}

function specialMaterialProperties(material) {
    return material.prop.map((entry, index) => {
        if (!Array.isArray(entry) || entry.length < 2 || typeof entry[0] !== 'string' || !entry[0]) {
            throw new TypeError(`特殊材料「${material.name}」第 ${index + 1} 项属性格式无效`);
        }
        if (!Number.isSafeInteger(entry[1]) || entry[1] < 0) {
            throw new TypeError(`特殊材料「${material.name}」第 ${index + 1} 项属性权重无效`);
        }
        return { prop: entry[0], weight: entry[1] };
    });
}

function specialMaterialBaseValue(material, equipLevel, propertyIndex) {
    const level = requirePositiveInteger(equipLevel, '装备等级');
    const raw = material.lvs[`lv${level}`];
    if (raw === undefined) {
        throw new RangeError(`特殊材料「${material.name}」没有 lv${level} 数值`);
    }
    const value = Array.isArray(raw) ? raw[propertyIndex] : raw;
    if (typeof value !== 'number' || !Number.isFinite(value) || value <= 0) {
        throw new TypeError(`特殊材料「${material.name}」的 lv${level} 第 ${propertyIndex + 1} 项数值无效`);
    }
    return value;
}

function scaleSpecialMaterialValue(baseValue, factor) {
    if (baseValue < 1) return baseValue * factor / 100;
    return Math.max(1, Math.floor(baseValue * factor / 100));
}

function predictSpecialAttachSequence(equip, material, count) {
    if (!equip || typeof equip !== 'object' || Array.isArray(equip)) {
        throw new TypeError('目标装备必须是对象');
    }
    const validCount = requirePositiveInteger(count, '预测次数');
    const validMaterial = requireSpecialMaterial(material, equip);
    const properties = specialMaterialProperties(validMaterial);
    let seed = requirePositiveInteger(equip.MJSeed, `装备「${equip.name}」的 MJSeed`);
    const items = [];
    for (let index = 1; index <= validCount; index += 1) {
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
        const baseValue = specialMaterialBaseValue(validMaterial, equip.need_lv, propertyDraw.index);
        items.push({
            index,
            equipName: equip.name,
            materialName: validMaterial.name,
            prop: selected.prop,
            value: scaleSpecialMaterialValue(baseValue, factor),
            factor,
            factorMin: range[0],
            factorMax: range[1],
            seedBefore,
            seedAfter: seed,
        });
    }
    const maxValue = Math.max(...items.map(item => item.value));
    return items.map(item => ({ ...item, isBest: item.value === maxValue }));
}

function renderSpecialAttachPage() {
    const body = document.getElementById('previewBody');
    if (!body) return;
    const items = tablePager.specialAttachItems || [];
    const pageSize = getPreviewPageSize();
    const start = (tablePager.page - 1) * pageSize;
    const slice = items.slice(start, start + pageSize);
    if (!slice.length) {
        body.innerHTML = '<tr><td colspan="6" class="empty-row">无预测记录</td></tr>';
        updatePreviewPager(items.length);
        return;
    }
    body.innerHTML = slice.map(item => `<tr class="${item.isBest ? 'special-attach-best' : ''}">
        <td>${item.index}</td>
        <td>${escapeHtml(item.equipName)}</td>
        <td>${escapeHtml(item.materialName)}</td>
        <td class="special-attach-value">${escapeHtml(propLabel(item.prop))}+${formatPropValue(item.prop, item.value)}</td>
        <td>${item.factor}% · 区间 ${item.factorMin}–${item.factorMax}%${item.isBest ? ' · 最高' : ''}</td>
        <td>${item.seedBefore} → ${item.seedAfter}</td>
    </tr>`).join('');
    updatePreviewPager(items.length);
}

function renderSpecialAttachPreview(items) {
    setSpecialAttachHead();
    const meta = document.getElementById('previewMeta');
    const makeFilter = document.getElementById('makeFilterBar');
    const xilianFilter = document.getElementById('xilianFilterBar');
    if (makeFilter) makeFilter.hidden = true;
    if (xilianFilter) xilianFilter.hidden = true;
    const bestIndexes = items.filter(item => item.isBest).map(item => item.index).join('、');
    tablePager.mode = 'specialAttach';
    tablePager.page = 1;
    tablePager.specialAttachItems = items;
    if (meta) meta.textContent = `连续附加 ${items.length} 次 · 最高值位于第 ${bestIndexes} 次 · 只读预测，不推进 MJSeed`;
    renderSpecialAttachPage();
}

function setJianwangCycleHead() {
    setPreviewTableKind('jianwang-state');
    document.getElementById('previewHead').innerHTML = `<tr>
        <th>#</th><th>结果</th><th>基础属性</th><th>副属性</th><th>种子 / 消耗</th>
    </tr>`;
}

function renderJianwangCyclePage() {
    const body = document.getElementById('previewBody');
    const meta = document.getElementById('previewMeta');
    const pages = tablePager.jianwangCyclePages || [];
    if (!body) return;
    const page = pages[tablePager.page - 1];
    if (!page) {
        body.innerHTML = '<tr><td colspan="5" class="empty-row">无碎剑循环记录</td></tr>';
        if (meta) meta.textContent = '';
        updateJianwangCyclePager(0, 0);
        return;
    }
    setJianwangCycleHead();
    const blankName = page.blank?.name || '剑胚';
    if (meta) {
        const entryText = page.entryNote ? ` · ${page.entryNote}` : '';
        meta.textContent = `模拟背包 · ${blankName} · 第 ${page.swordIndex} 把剑 · 碎剑预览${entryText} · 本页含60→90与10次不保留重铸 · 预览不推进状态`;
    }
    body.innerHTML = page.rows.map((item, rowIndex) => {
        const blank = item.action === 'blank';
        const fromCfg = EQUIP_DATA.equipment[String(item.fromId)] || {};
        const toCfg = EQUIP_DATA.equipment[String(item.toId)] || {};
        const fromLevel = Number(fromCfg.lv) || '?';
        const toLevel = Number(toCfg.lv) || '?';
        const resultName = escapeHtml(toCfg.name || item.toName || item.equip?.name || '剑胚');
        let resultLabel;
        if (blank) {
            resultLabel = `${item.shatterLabel || '碎剑'} → ${toLevel}级 · ${resultName}`;
        } else if (item.action === 'reforge') {
            const reforgeIndex = rowIndex - 3;
            resultLabel = `${toLevel}级重铸 第${reforgeIndex}次 · ${resultName}`;
        } else {
            resultLabel = `${fromLevel}→${toLevel} · ${resultName}`;
        }
        const base = escapeHtml(formatBase(item.base || item.equip?.base || {}));
        const props = (item.exts || item.equip?.exts || []).length
            ? (item.exts || item.equip.exts).map(prop => `<span class="jianwang-prop-token">${escapeHtml(propLabel(prop.prop))}+${formatPropValue(prop.prop, prop.value)}</span>`).join('')
            : '<span class="muted">无</span>';
        const seedText = blank
            ? `RedSeed ${item.redSeedBefore} → ${item.redSeedAfter}<br>CZSeed ${item.seedAfter}`
            : `CZSeed ${item.seedBefore} → ${item.seedAfter}${item.seedBefore === item.seedAfter ? ' · 不推进' : ''}`;
        const costs = String(item.cost || '—').split(/[、；]/)
            .filter(Boolean)
            .map(cost => `<span class="jianwang-cost-token">${escapeHtml(cost)}</span>`).join('');
        return `<tr>
            <td>${item.index}</td>
            <td class="jianwang-result-cell"><strong>${resultLabel}</strong></td>
            <td>${base}</td>
            <td><div class="jianwang-token-list">${props}</div></td>
            <td class="jianwang-result-cell"><span class="jianwang-seed">${seedText}</span><div class="jianwang-token-list jianwang-cost-list">${costs}</div></td>
        </tr>`;
    }).join('');
    updateJianwangCyclePager(pages.length, page.swordIndex);
}

function renderJianwangCyclePreview(pages) {
    const makeFilter = document.getElementById('makeFilterBar');
    const xilianFilter = document.getElementById('xilianFilterBar');
    if (makeFilter) makeFilter.hidden = true;
    if (xilianFilter) xilianFilter.hidden = true;
    tablePager.mode = 'jianwang';
    tablePager.page = 1;
    tablePager.jianwangKind = 'cycle';
    tablePager.jianwangItems = [];
    tablePager.jianwangCyclePages = Array.isArray(pages) ? pages : [];
    renderJianwangCyclePage();
}

function renderJianwangPage() {
    if (tablePager.jianwangKind === 'cycle') {
        renderJianwangCyclePage();
        return;
    }
    const body = document.getElementById('previewBody');
    if (!body) return;
    const items = tablePager.jianwangItems || [];
    const pageSize = getPreviewPageSize();
    const start = (tablePager.page - 1) * pageSize;
    const slice = items.slice(start, start + pageSize);
    const blankKind = tablePager.jianwangKind === 'blanks' || tablePager.jianwangKind === 'shatter';
    if (!slice.length) {
        const columns = tablePager.jianwangKind === 'mangjing' ? 6 : (blankKind ? 6 : 4);
        body.innerHTML = `<tr><td colspan="${columns}" class="empty-row">无专武序列记录</td></tr>`;
        updatePreviewPager(items.length);
        return;
    }
    if (tablePager.jianwangKind === 'mangjing') {
        body.innerHTML = slice.map(item => `<tr class="${item.isBest ? 'jianwang-best' : ''}">
            <td>${item.index}</td>
            <td>${escapeHtml(item.equipName)}</td>
            <td>${escapeHtml(item.materialName)}</td>
            <td class="special-attach-value">${escapeHtml(propLabel(item.prop))}+${formatPropValue(item.prop, item.value)}</td>
            <td>${item.factor}% · 区间 ${item.factorMin}–${item.factorMax}%${item.isBest ? ' · 最高' : ''}</td>
            <td>${item.seedBefore} → ${item.seedAfter}</td>
        </tr>`).join('');
    } else if (blankKind) {
        body.innerHTML = slice.map(item => {
            const resultLabel = item.shatterLabel
                ? `${escapeHtml(item.shatterLabel)} → 60级剑胚`
                : `第 ${item.index} 把后续60级剑胚`;
            const base = escapeHtml(formatBase(item.base));
            const props = (item.exts || []).length
                ? item.exts.map(prop => `<span class="jianwang-prop-token">${escapeHtml(propLabel(prop.prop))}+${formatPropValue(prop.prop, prop.value)}</span>`).join('')
                : '<span class="muted">无</span>';
            const seeds = `CZSeed ${item.CZSeed}<br>MJSeed ${item.MJSeed}<br>S ${item.S}`;
            const redSeed = `${item.redSeedBefore} → ${item.redSeedAfter}`;
            const resources = item.cost
                ? String(item.cost).split('；').map(part => `<span class="jianwang-cost-token">${escapeHtml(part)}</span>`).join('')
                : '<span class="muted">只读预览</span>';
            return `<tr>
                <td>${item.index}</td>
                <td class="jianwang-result-cell"><strong>${resultLabel}</strong><span class="jianwang-seed">${item.shatterLabel ? escapeHtml(item.fromName) : '源码首次生成规则'}</span></td>
                <td>${base}</td>
                <td><div class="jianwang-token-list">${props}</div></td>
                <td class="jianwang-result-cell"><span class="jianwang-seed">${seeds}</span></td>
                <td class="jianwang-result-cell"><span class="jianwang-seed">RedSeed ${redSeed}</span><div class="jianwang-token-list jianwang-cost-list">${resources}</div></td>
            </tr>`;
        }).join('');
    } else {
        body.innerHTML = slice.map(item => {
            const kept = item.kept
                ? `保留 ${propLabel(item.kept.prop)}+${formatPropValue(item.kept.prop, item.kept.value)}`
                : (item.action.startsWith('ascend:') ? '固定保留现有六条' : '不保留旧词条');
            const fromCfg = EQUIP_DATA.equipment[String(item.fromId)] || {};
            const toCfg = EQUIP_DATA.equipment[String(item.toId)] || {};
            const fromLevel = Number(fromCfg.lv) || '?';
            const toLevel = Number(toCfg.lv) || '?';
            const resultName = escapeHtml(toCfg.name || item.toName);
            const resultLabel = item.action === 'reforge'
                ? `${toLevel}级重铸 · ${resultName}`
                : `${fromLevel}→${toLevel} · ${resultName}`;
            const seedStatus = item.seedBefore === item.seedAfter ? ' · 不推进' : '';
            const props = (item.exts || []).length
                ? item.exts.map(prop => `<span class="jianwang-prop-token">${escapeHtml(propLabel(prop.prop))}+${formatPropValue(prop.prop, prop.value)}</span>`).join('')
                : '<span class="muted">无</span>';
            const costs = String(item.cost || '—').split('、')
                .map(cost => `<span class="jianwang-cost-token">${escapeHtml(cost)}</span>`).join('');
            return `<tr>
                <td>${item.index}</td>
                <td class="jianwang-result-cell"><strong>${resultLabel}</strong><span class="jianwang-seed">CZSeed ${item.seedBefore} → ${item.seedAfter}${seedStatus}</span></td>
                <td><div class="jianwang-token-list">${props}</div></td>
                <td><span class="jianwang-keep">${escapeHtml(kept)}</span><div class="jianwang-token-list jianwang-cost-list">${costs}</div></td>
            </tr>`;
        }).join('');
    }
    updatePreviewPager(items.length);
}

function setJianwangStateHead() {
    setPreviewTableKind('jianwang-state');
    document.getElementById('previewHead').innerHTML = `<tr>
        <th>#</th><th>结果</th><th>副属性</th><th>选择与消耗</th>
    </tr>`;
}

function setJianwangBlankHead() {
    setPreviewTableKind('jianwang-state');
    document.getElementById('previewHead').innerHTML = `<tr>
        <th>#</th><th>结果</th><th>基础属性</th><th>副属性</th><th>实例种子</th><th>RedSeed / 资源</th>
    </tr>`;
}

function renderJianwangPreview(items, kind = 'state') {
    if (kind === 'mangjing') setSpecialAttachHead();
    else if (kind === 'blanks' || kind === 'shatter') setJianwangBlankHead();
    else setJianwangStateHead();
    const meta = document.getElementById('previewMeta');
    const makeFilter = document.getElementById('makeFilterBar');
    const xilianFilter = document.getElementById('xilianFilterBar');
    if (makeFilter) makeFilter.hidden = true;
    if (xilianFilter) xilianFilter.hidden = true;
    tablePager.mode = 'jianwang';
    tablePager.page = 1;
    tablePager.jianwangItems = items;
    tablePager.jianwangKind = kind;
    if (meta) {
        if (kind === 'mangjing') {
            const bestIndexes = items.filter(item => item.isBest).map(item => item.index).join('、');
            meta.textContent = `剑王阁芒晶洗练 ${items.length} 次 · 最高值位于第 ${bestIndexes} 次 · 每次芒晶×10 · 只读预测`;
        } else if (kind === 'blanks') {
            meta.textContent = `后续60级剑胚 ${items.length} 把 · 从当前 RedSeeds[5707] 顺序推演 · 预览不推进页面内状态`;
        } else if (kind === 'shatter') {
            meta.textContent = `${items[0]?.shatterLabel || '碎剑'} → 重铸下一把60级剑胚 · 预览不推进页面内状态`;
        } else {
            meta.textContent = `从所选剑王阁起点起步 · ${items.length} 步 · 预览不推进页面内状态`;
        }
    }
    renderJianwangPage();
}


/* 词条列表 → 纯文本（「闪避+114 招架+59」），给详情标签用 */
function equipPropText(list) {
    if (!list || !list.length) return '';
    return list
        .map(p => `${propLabel(p.prop)}+${formatPropValue(p.prop, p.value)}`)
        .join(' ');
}

/*
 * 「打造信息」标签行：把打造页表格那一行的信息（第几件 / 品质 / 基础 / 蓝词条 / 地区附加 / 红词条 / 种子）
 * 带到"选装备"的地方，方便直接挑。
 * 没有的项一律不输出（没附加就不写、不是保底就不写）。
 * 注意：_make_* 字段只有「模拟打造」的装备才有；已装备 / 存档里的装备只有 exts / specials。
 */
function equipMakeDetailHtml(e) {
    if (!e) return '';
    const chips = [];
    if (e._make_index) chips.push(`第 ${e._make_index} 件`);
    const color = COLOR_NAMES[e.color] || e.color;
    if (color) chips.push(String(color));
    const baseText = formatBase(e._make_base);
    if (baseText !== '—') chips.push(`基础 ${baseText}`);
    const extText = equipPropText(e.exts);
    if (extText) chips.push(`蓝词条 ${extText}`);
    // 角色基础属性（臂力 / 根骨 / 身法 / 内息）来自 EnMans，单独成组，不跟附加属性混在一起
    const mansText = equipPropText(e.mans);
    if (mansText) chips.push(`属性 ${mansText}`);
    const regionText = equipPropText(e._make_region);
    if (regionText) chips.push(`（${regionText}）`);
    const specialList = (Array.isArray(e.specials) && e.specials.length) ? e.specials : e._make_special;
    const specialText = equipPropText(specialList);
    if (specialText) chips.push(`红词条 ${specialText}`);
    if (e._make_pity) chips.push('保底');
    else if (e._make_seedKind === 'lucky') chips.push('幸运');
    if (!chips.length) return '';
    return `<div class="make-detail">${chips
        .map(c => `<span class="md-chip">${escapeHtml(c)}</span>`)
        .join('')}</div>`;
}

function equipOptionLabel(e, mode) {
    // 带上"所属"：已装备的显示穿在谁身上（主角 / 随从名），未装备的显示它在哪（背包 / 仓库）
    const owner = e._source || '';
    const wear = e._crafted
        ? '模拟打造'
        : (e._equipped ? `已装备 · ${owner || '未知'}` : (owner || '未装备'));
    const color = COLOR_NAMES[e.color] || e.color;
    const mark = e._mark ? `「${e._mark}」` : '';
    if (mode === 'strong') {
        return `${mark}${e.name} · 淬炼${e.level} · LvProp${e.lv_prop} · ${wear}`;
    }
    if (mode === 'shenglian') {
        const cfg = EQUIP_DATA.equipment[String(e.id)] || {};
        const next = EQUIP_DATA.equipment[String(cfg.equ_next)] || {};
        const typ = TYPE_NAMES[e.typ] || e.typ;
        return `${mark}${e.name} · ${e.need_lv}→${next.lv || 100} · ${color} · ${typ} · ${wear}`;
    }
    return `${mark}${e.name} · ${e.need_lv}级 · ${color} · 词条${e.exts.length} · ${wear}`;
}

function canPredictSpecialAttach(equip) {
    return Number.isSafeInteger(equip.MJSeed)
        && equip.MJSeed > 0
        && Object.values(EQUIP_DATA.special).some(material => specialMaterialSupportsEquip(material, equip));
}

function specialAttachEquipLabel(equip) {
    const source = equip._crafted ? '模拟打造' : (equip._equipped ? equip._source : '未装备');
    const base = equip.exts.length
        ? equip.exts.map(item => `${propLabel(item.prop)}+${formatPropValue(item.prop, item.value)}`).join(' / ')
        : '无基础词条';
    const current = equip.specials.length
        ? equip.specials.map(item => `${propLabel(item.prop)}+${formatPropValue(item.prop, item.value)}`).join(' / ')
        : '当前无红词条';
    return `${source} · ${equip.name} · ${base} · ${current} · #${equip.only_id}`;
}

function specialMaterialsForEquip(equip) {
    return Object.values(EQUIP_DATA.special)
        .filter(material => specialMaterialSupportsEquip(material, equip))
        .sort((left, right) => left.id - right.id);
}

function fillSpecialAttachMaterialSelect(preserveSelection) {
    const equipSelect = document.getElementById('specialAttachEquipSelect');
    const materialSelect = document.getElementById('specialAttachMaterialSelect');
    if (!equipSelect || !materialSelect) return;
    const previous = preserveSelection ? materialSelect.value : '';
    const equip = saveEquips.find(item => runtimeKey(item) === equipSelect.value);
    materialSelect.innerHTML = '';
    if (!equip) {
        materialSelect.innerHTML = '<option value="">（请先选择可预测装备）</option>';
        return;
    }
    const materials = specialMaterialsForEquip(equip);
    for (const material of materials) {
        const option = document.createElement('option');
        option.value = String(material.id);
        option.textContent = material.name;
        materialSelect.appendChild(option);
    }
    if (previous && [...materialSelect.options].some(option => option.value === previous)) {
        materialSelect.value = previous;
    }
}

function fillSpecialAttachEquipSelect(preserveSelection) {
    const select = document.getElementById('specialAttachEquipSelect');
    if (!select) return;
    const previous = preserveSelection ? select.value : '';
    const equips = saveEquips.filter(canPredictSpecialAttach);
    select.innerHTML = '';
    if (!equips.length) {
        select.innerHTML = '<option value="">（没有带有效 MJSeed 的适用装备）</option>';
    } else {
        for (const equip of equips) {
            const option = document.createElement('option');
            option.value = runtimeKey(equip);
            option.textContent = specialAttachEquipLabel(equip);
            select.appendChild(option);
        }
        if (previous && [...select.options].some(option => option.value === previous)) {
            select.value = previous;
        }
    }
    fillSpecialAttachMaterialSelect(preserveSelection);
    updateSpecialAttachHint();
}

function updateSpecialAttachHint() {
    const hint = document.getElementById('specialAttachHint');
    const equipSelect = document.getElementById('specialAttachEquipSelect');
    const materialSelect = document.getElementById('specialAttachMaterialSelect');
    if (!hint || !equipSelect || !materialSelect) return;
    const equip = saveEquips.find(item => runtimeKey(item) === equipSelect.value);
    const material = EQUIP_DATA.special[String(materialSelect.value)];
    if (!equip || !material) {
        hint.textContent = '导入存档后选择同一件装备和材料，预测连续覆盖红词条的结果';
        return;
    }
    const current = equip.specials.length
        ? equip.specials.map(item => `${propLabel(item.prop)}+${formatPropValue(item.prop, item.value)}`).join(' / ')
        : '无';
    hint.textContent = `当前红词条：${current} · 起始 MJSeed=${equip.MJSeed} · 预测不会修改存档或种子`;
}

function isJianwangSword(equip) {
    return !!equip && JIANWANG_SWORD_IDS.has(Number(equip.id));
}

function collectJianwangSwords() {
    return saveEquips
        .filter(isJianwangSword)
        .sort((a, b) => Number(a.id) - Number(b.id) || String(a._source).localeCompare(String(b._source), 'zh'));
}

function validJianwangCZSeed(equip) {
    return isJianwangSword(equip)
        && Number.isSafeInteger(Number(equip.CZSeed))
        && Number(equip.CZSeed) > 0;
}

function canPredictJianwangMangjing(equip) {
    return isJianwangSword(equip)
        && JIANWANG_LEVEL_100_IDS.has(Number(equip.id))
        && Number(equip.color) === 6
        && Array.isArray(equip.specials)
        && equip.specials.length > 0
        && Number.isSafeInteger(equip.MJSeed)
        && equip.MJSeed > 0;
}

function jianwangStageName(equip) {
    const cfg = EQUIP_DATA.equipment[String(equip?.id)] || {};
    const lv = Number(cfg.lv) || Number(equip?.need_lv) || 0;
    if (Number(equip?.id) === 5707) return '60级剑胚';
    if (Number(equip?.id) === 5708) return '70级剑胚';
    if (Number(equip?.id) === 5709) return '80级剑胚';
    if (JIANWANG_LEVEL_90_IDS.has(Number(equip?.id))) return `90级专武 · ${cfg.name || equip.name}`;
    if (JIANWANG_LEVEL_100_IDS.has(Number(equip?.id))) return `100级神兵 · ${cfg.name || equip.name}`;
    return `${lv}级`;
}

function jianwangSwordLabel(equip) {
    const key = runtimeKey(equip);
    const current = getRuntimeEquip(key) || equip;
    const seed = JIANWANG_LEVEL_100_IDS.has(Number(current.id))
        ? `MJSeed ${current.MJSeed || '无效'}`
        : `CZSeed ${current.CZSeed || '无效'}`;
    if (current._jianwangVirtualFirst) {
        const name = current.name || EQUIP_DATA.equipment[String(current.id)]?.name || jianwangStageName(current);
        return `虛擬劍胚 · ${name} · 初始劍胚 · ${seed}`;
    }
    if (current._jianwangRebuilt) {
        const swordIndex = Math.max(1, Math.floor(Number(current._jianwangSwordIndex) || 1));
        const name = current.name || EQUIP_DATA.equipment[String(current.id)]?.name || jianwangStageName(current);
        return `模拟背包 · ${name} · 第 ${swordIndex} 把剑`;
    }
    return `${current._source || equip._source || '未知来源'} · ${jianwangStageName(current)} · #${equip.only_id || '无OnlyID'} · ${seed}`;
}

function jianwangActionOptions(equip) {
    if (!equip) return [];
    const id = Number(equip.id);
    if (JIANWANG_GROW_TARGETS[id]) {
        return JIANWANG_GROW_TARGETS[id].map(targetId => ({
            value: `grow:${targetId}`,
            label: `${jianwangStageName(equip)} → ${jianwangStageName({ id: targetId })}`,
        }));
    }
    if (JIANWANG_LEVEL_90_IDS.has(id)) {
        return [
            { value: 'reforge', label: `重铸 ${jianwangStageName(equip)}` },
            { value: `ascend:${JIANWANG_LEVEL_100_TARGETS[id]}`, label: `铸为100级神兵（固定保留六条）` },
            { value: JIANWANG_SHATTER_90, label: '90级碎剑 → 重铸下一把60级剑胚' },
        ];
    }
    if (JIANWANG_LEVEL_100_IDS.has(id)) {
        return [
            { value: 'mangjing', label: '查看芒晶洗练序列' },
            { value: JIANWANG_SHATTER_100, label: '100级碎神兵 → 重铸下一把60级剑胚' },
        ];
    }
    return [];
}

function jianwangKeepLimit(equip, action) {
    if (!equip || !action) return 0;
    if (action === 'reforge') return Math.min(4, equip.exts?.length || 0);
    if (action.startsWith('grow:')) {
        const byId = { 5707: 1, 5708: 2, 5709: 3 };
        return Math.min(byId[Number(equip.id)] || 0, equip.exts?.length || 0);
    }
    return 0;
}

function fillJianwangActionSelect(preserveSelection = true) {
    const equipSelect = document.getElementById('jianwangEquipSelect');
    const actionSelect = document.getElementById('jianwangActionSelect');
    if (!equipSelect || !actionSelect) return;
    const previous = preserveSelection ? actionSelect.value : '';
    const base = findEquipByRuntimeKey(equipSelect.value);
    const equip = base ? (getRuntimeEquip(runtimeKey(base)) || base) : null;
    const actions = jianwangActionOptions(equip);
    actionSelect.innerHTML = '';
    if (!actions.length) {
        actionSelect.innerHTML = '<option value="">（当前起点没有可用流程）</option>';
    } else {
        for (const action of actions) {
            const option = document.createElement('option');
            option.value = action.value;
            option.textContent = action.label;
            actionSelect.appendChild(option);
        }
        if (previous && [...actionSelect.options].some(option => option.value === previous)) {
            actionSelect.value = previous;
        }
    }
    fillJianwangKeepSelect(preserveSelection);
    fillJianwangMaterialSelect(preserveSelection);
    updateJianwangControls();
}

function fillJianwangCycleRouteSelect(preserveSelection = true) {
    const routeSelect = document.getElementById('jianwangCycleRouteSelect');
    const equipSelect = document.getElementById('jianwangEquipSelect');
    if (!routeSelect || !equipSelect) return;
    const previous = preserveSelection ? routeSelect.value : '';
    const base = findEquipByRuntimeKey(equipSelect.value);
    const equip = base ? (getRuntimeEquip(runtimeKey(base)) || base) : null;
    const fixedRouteId = equip ? JIANWANG_SHATTER_ROUTE_IDS[Number(equip.id)] : null;
    routeSelect.innerHTML = '';
    if (!equip) {
        routeSelect.innerHTML = '<option value="">（请先选择剑王阁起点）</option>';
        routeSelect.disabled = true;
        return;
    }
    if (fixedRouteId) {
        const option = document.createElement('option');
        option.value = String(fixedRouteId);
        option.textContent = jianwangStageName({ id: fixedRouteId });
        routeSelect.appendChild(option);
        routeSelect.disabled = true;
        return;
    }
    const placeholder = document.createElement('option');
    placeholder.value = '';
    placeholder.textContent = '请选择90级专武路线';
    routeSelect.appendChild(placeholder);
    for (const routeId of JIANWANG_GROW_TARGETS[5709]) {
        const option = document.createElement('option');
        option.value = String(routeId);
        option.textContent = jianwangStageName({ id: routeId });
        routeSelect.appendChild(option);
    }
    routeSelect.disabled = false;
    if (previous && [...routeSelect.options].some(option => option.value === previous)) {
        routeSelect.value = previous;
    }
}

function fillJianwangKeepSelect(preserveSelection = true) {
    const equipSelect = document.getElementById('jianwangEquipSelect');
    const actionSelect = document.getElementById('jianwangActionSelect');
    const keepSelect = document.getElementById('jianwangKeepSelect');
    if (!equipSelect || !actionSelect || !keepSelect) return;
    const previous = preserveSelection ? keepSelect.value : '';
    const base = findEquipByRuntimeKey(equipSelect.value);
    const equip = base ? (getRuntimeEquip(runtimeKey(base)) || base) : null;
    const limit = jianwangKeepLimit(equip, actionSelect.value);
    keepSelect.innerHTML = '<option value="0">不保留</option>';
    for (let i = 0; i < limit; i++) {
        const prop = equip.exts[i];
        const option = document.createElement('option');
        option.value = String(i + 1);
        option.textContent = `槽 ${i + 1} · ${propLabel(prop.prop)}+${formatPropValue(prop.prop, prop.value)}`;
        keepSelect.appendChild(option);
    }
    if (previous && [...keepSelect.options].some(option => option.value === previous)) keepSelect.value = previous;
}

function jianwangMaterialsForEquip(equip) {
    const materials = specialMaterialsForEquip(equip);
    const currentProps = new Set((equip?.specials || []).map(item => item.prop));
    const matched = materials.filter(material => material.prop.some(entry => currentProps.has(entry[0])));
    return matched.length ? matched : materials;
}

function fillJianwangMaterialSelect(preserveSelection = true) {
    const equipSelect = document.getElementById('jianwangEquipSelect');
    const materialSelect = document.getElementById('jianwangMaterialSelect');
    if (!equipSelect || !materialSelect) return;
    const previous = preserveSelection ? materialSelect.value : '';
    const base = findEquipByRuntimeKey(equipSelect.value);
    const equip = base ? (getRuntimeEquip(runtimeKey(base)) || base) : null;
    materialSelect.innerHTML = '';
    if (!equip) {
        materialSelect.innerHTML = '<option value="">（请先选择已铸进专武）</option>';
        return;
    }
    for (const material of jianwangMaterialsForEquip(equip)) {
        const option = document.createElement('option');
        option.value = String(material.id);
        option.textContent = `${material.name} · ${material.prop.map(entry => propLabel(entry[0])).join('/')}`;
        materialSelect.appendChild(option);
    }
    if (previous && [...materialSelect.options].some(option => option.value === previous)) {
        materialSelect.value = previous;
    }
}

function fillJianwangEquipSelect(preserveSelection = true) {
    const select = document.getElementById('jianwangEquipSelect');
    if (!select) return;
    const previous = preserveSelection ? select.value : '';
    const realSwords = collectJianwangSwords();
    const swords = realSwords.length
        ? realSwords
        : (jianwangVirtualFirstSword ? [jianwangVirtualFirstSword] : []);
    select.innerHTML = '';
    if (!swords.length) {
        select.innerHTML = '<option value="">（无剑王阁实物，且缺少可推演首剑的 RedSeed）</option>';
    } else {
        for (const sword of swords) {
            const option = document.createElement('option');
            option.value = runtimeKey(sword);
            option.textContent = jianwangSwordLabel(sword);
            select.appendChild(option);
        }
        if (previous && [...select.options].some(option => option.value === previous)) {
            select.value = previous;
        }
    }
    fillJianwangActionSelect(preserveSelection);
    fillJianwangCycleRouteSelect(preserveSelection);
    updateJianwangHint();
    updateJianwangCycleHint();
}

function updateJianwangControls() {
    const equipSelect = document.getElementById('jianwangEquipSelect');
    const action = document.getElementById('jianwangActionSelect')?.value || '';
    const base = findEquipByRuntimeKey(equipSelect?.value);
    const equip = base ? (getRuntimeEquip(runtimeKey(base)) || base) : null;
    const nextRedSeed = jianwangNextRedSeedForEquip(equip);
    const keepGroup = document.getElementById('jianwangKeepGroup');
    const countGroup = document.getElementById('jianwangCountGroup');
    const materialGroup = document.getElementById('jianwangMaterialGroup');
    const countInput = document.getElementById('jianwangCount');
    if (keepGroup) keepGroup.hidden = !(action === 'reforge' || action.startsWith('grow:'));
    if (countGroup) countGroup.hidden = !(action === 'reforge' || action === 'mangjing');
    if (materialGroup) materialGroup.hidden = action !== 'mangjing';
    const completedReforges = Math.max(0, Math.floor(Number(
        jianwangReforgeCounts[String(Number(equip?.id))],
    ) || 0));
    const remainingReforges = Math.max(0, JIANWANG_REFORGE_LIMIT - completedReforges);
    const reforgeExhausted = action === 'reforge' && remainingReforges === 0;
    if (countInput) {
        countInput.disabled = reforgeExhausted;
        countInput.min = '1';
        countInput.max = String(action === 'reforge' ? remainingReforges : PREVIEW_MAX);
        if (action === 'reforge') {
            const current = Number(countInput.value);
            if (!Number.isSafeInteger(current) || current < 1 || current > remainingReforges) {
                countInput.value = '1';
            }
        }
    }
    const previewButton = document.getElementById('btnJianwangPreview');
    if (previewButton) {
        const shatter = action === JIANWANG_SHATTER_90 || action === JIANWANG_SHATTER_100;
        previewButton.disabled = reforgeExhausted || (shatter && !validJianwangRedSeed(nextRedSeed));
    }
    const applyButton = document.getElementById('btnJianwangApply');
    if (applyButton) {
        const shatter = action === JIANWANG_SHATTER_90 || action === JIANWANG_SHATTER_100;
        const deterministic = action === 'reforge' || action.startsWith('grow:') || action.startsWith('ascend:') || shatter;
        applyButton.disabled = !equip || !deterministic || reforgeExhausted
            || (shatter ? !validJianwangRedSeed(nextRedSeed)
                : (action !== '' && !action.startsWith('ascend:') && !validJianwangCZSeed(equip)));
    }
}

function findSaveScalar(root, wantedKey) {
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
            const found = unwrap(value[wantedKey]);
            if (found != null) return found;
        }
        for (const child of Object.values(value)) {
            const found = walk(child);
            if (found != null) return found;
        }
        return null;
    };
    return walk(root);
}

function jianwangReforgeCost(attemptNumber) {
    const index = Math.min(JIANWANG_REFORGE_COSTS.length - 1, Math.max(0, Number(attemptNumber) - 1));
    const [coreA, coreB] = JIANWANG_REFORGE_COSTS[index];
    return `真气×500、剑芯6516×${coreA}、剑芯6517×${coreB}`;
}

function jianwangCostText(equip, action, sequenceIndex = 1) {
    if (!equip) return '';
    const id = Number(equip.id);
    if (action === 'reforge') {
        const completed = Number(jianwangReforgeCounts[String(Number(equip.id))]) || 0;
        return jianwangReforgeCost(completed + sequenceIndex);
    }
    if (action === 'grow:5708') return '剑意150、雪银×400、青金石×20、贡献×1200';
    if (action === 'grow:5709') return '剑意300、紫金×200、陨铁×1、贡献×2000';
    if (action.startsWith('grow:') && id === 5709) return '剑意600、紫金×400、陨铁×2、贡献×4000';
    if (action.startsWith('ascend:')) return '昆吾石×100、陨铁×2、连金泥×10、内力×1000、铸炼进度×10';
    if (action === 'mangjing') return '芒晶×10 / 次';
    if (action === JIANWANG_SHATTER_90) return '90级碎剑后重新锻造60级剑胚';
    if (action === JIANWANG_SHATTER_100) return '100级碎神兵后重新锻造60级剑胚';
    return '';
}

function updateJianwangHint() {
    const hint = document.getElementById('jianwangHint');
    const equipSelect = document.getElementById('jianwangEquipSelect');
    const materialSelect = document.getElementById('jianwangMaterialSelect');
    if (!hint || !equipSelect || !materialSelect) return;
    const base = findEquipByRuntimeKey(equipSelect.value);
    const equip = base ? (getRuntimeEquip(runtimeKey(base)) || base) : null;
    const nextRedSeed = jianwangNextRedSeedForEquip(equip);
    const action = document.getElementById('jianwangActionSelect')?.value || '';
    const material = EQUIP_DATA.special[String(materialSelect.value)];
    if (!equip) {
        hint.textContent = saveLoaded
            ? '当前存档没有剑王阁实物，且缺少有效 MakeRnd.RedSeeds[5707]，无法推演首剑序列'
            : '导入存档后自动扫描剑王阁实物；无实物时可用 RedSeeds[5707] 推演虛擬劍胚';
        return;
    }
    if (action === 'mangjing') {
        if (!canPredictJianwangMangjing(equip)) {
            hint.textContent = `${equip._source || base?._source || '存档'} · ${jianwangStageName(equip)} 已列出，但缺少有效 MJSeed 或已铸进特殊词条，不能伪造芒晶序列`;
            return;
        }
        const materialText = material ? `按「${material.name}」属性池` : '请选择游戏中实际铸进的材料';
        hint.textContent = `${equip._source || base?._source || '存档'} · ${materialText} · 起始 MJSeed=${equip.MJSeed} · ${jianwangCostText(equip, action)}`;
        return;
    }
    if (action === JIANWANG_SHATTER_90 || action === JIANWANG_SHATTER_100) {
        if (!validJianwangRedSeed(nextRedSeed)) {
            hint.textContent = `${jianwangStageName(equip)} · 存档缺少有效 MakeRnd.RedSeeds[5707]，不能预测下一把60级剑胚`;
            return;
        }
        const next = createJianwangBlankFromRedSeed(nextRedSeed);
        const actionLabel = action === JIANWANG_SHATTER_90 ? '90级碎剑' : '100级碎神兵';
        hint.textContent = `${actionLabel} · RedSeed ${next.redSeedBefore} → ${next.redSeedAfter} · 新60级剑胚 CZSeed=${next.CZSeed} · MJSeed=${next.MJSeed} · 仅网页模拟`;
        return;
    }
    if ((action === 'reforge' || action.startsWith('grow:')) && !validJianwangCZSeed(equip)) {
        hint.textContent = `${base?._source || '存档'} · ${jianwangStageName(equip)} 已列出，但 CZSeed 无效，不能生成替代序列`;
        return;
    }
    if (action === 'reforge') {
        const completed = Math.max(0, Math.floor(Number(
            jianwangReforgeCounts[String(Number(equip.id))],
        ) || 0));
        const remaining = Math.max(0, JIANWANG_REFORGE_LIMIT - completed);
        if (remaining === 0) {
            hint.textContent = `${base?._source || '存档'} · ${jianwangStageName(equip)} · 已重铸 ${completed} 次，已达 ${JIANWANG_REFORGE_LIMIT} 次上限`;
            return;
        }
        hint.textContent = `${base?._source || '存档'} · ${jianwangStageName(equip)} · 起始 CZSeed=${equip.CZSeed} · 已重铸 ${completed}/${JIANWANG_REFORGE_LIMIT} 次，剩余 ${remaining} 次 · ${jianwangCostText(equip, action)}`;
        return;
    }
    const seedText = action.startsWith('ascend:') ? `CZSeed=${equip.CZSeed}（固定转换不推进）` : `起始 CZSeed=${equip.CZSeed}`;
    hint.textContent = `${base?._source || '存档'} · ${jianwangStageName(equip)} · ${seedText} · ${jianwangCostText(equip, action)}`;
}

function updateJianwangCycleHint() {
    const hint = document.getElementById('jianwangCycleHint');
    const button = document.getElementById('btnJianwangCyclePreview');
    const equipSelect = document.getElementById('jianwangEquipSelect');
    const routeSelect = document.getElementById('jianwangCycleRouteSelect');
    const base = findEquipByRuntimeKey(equipSelect?.value);
    const equip = base ? (getRuntimeEquip(runtimeKey(base)) || base) : null;
    const nextRedSeed = jianwangNextRedSeedForEquip(equip);
    if (!hint) return;
    const id = Number(equip?.id);
    const needsRoute = [5707, 5708, 5709].includes(id);
    const routeId = Number(routeSelect?.value);
    const routeReady = !needsRoute || JIANWANG_LEVEL_90_IDS.has(routeId);
    const startSeedReady = !needsRoute || validJianwangCZSeed(equip);
    const available = saveLoaded && !!equip && isJianwangSword(equip)
        && routeReady && startSeedReady && validJianwangRedSeed(nextRedSeed);
    if (button) button.disabled = !available;
    if (!saveLoaded) {
        hint.textContent = '导入存档后可从实物或虛擬劍胚起跑，按每把新剑一页预览完整循环';
    } else if (!equip || !isJianwangSword(equip)) {
        hint.textContent = '当前存档既没有剑王阁实物，也没有可用于首剑推演的 RedSeeds[5707]';
    } else if (!validJianwangRedSeed(nextRedSeed)) {
        hint.textContent = '存档缺少有效 MakeRnd.RedSeeds[5707]，无法进行碎剑预览';
    } else if (needsRoute && !validJianwangCZSeed(equip)) {
        hint.textContent = `${jianwangStageName(equip)}缺少有效 CZSeed，无法先推到90级`;
    } else if (needsRoute && !routeReady) {
        hint.textContent = `${jianwangStageName(equip)}尚未到90级，请先选择最终90级专武路线`;
    } else if (JIANWANG_LEVEL_100_IDS.has(id)) {
        hint.textContent = '当前100级神兵会直接碎神兵进入第1轮；之后每把新剑按60→70→80→90→10次重铸循环';
    } else if (equip._jianwangVirtualFirst) {
        hint.textContent = '当前为由存档 RedSeeds[5707] 推演出的虛擬劍胚；先按所选路线升至90级，再从下一把剑开始碎剑循环';
    } else if (needsRoute) {
        hint.textContent = `${jianwangStageName(equip)}会先无保留推到所选90级路线再碎剑；之后每把新剑独立一页`;
    } else {
        hint.textContent = '当前90级专武直接碎剑进入第1轮；每把新剑独立一页并预览60→90与10次不保留重铸';
    }
}

function emptyEquipTip(which) {
    const source = getSourceFilter(which);
    if (which === 'shenglian') {
        if (source === 'crafted') return '（没有可升炼的模拟打造装备；可改来源或文本筛选）';
        if (source === 'unequipped') return '（背包仓库里没有可升炼的蓝紫装备）';
        return '（已装备里没有可升炼的蓝紫装备）';
    }
    if (source === 'crafted') return '（无匹配的模拟打造装备；可改来源或文本筛选）';
    if (source === 'unequipped') return '（背包仓库里无匹配项）';
    if (source === 'equipped') return '（无已装备匹配项；可改来源或文本筛选）';
    if (which === 'strong') return '（无可淬炼武器）';
    return '（无 100 级可精炼装备；90 级请先升炼）';
}

function fillEquipSelects(preserveSelection = true) {
    const configs = [
        { which: 'xilian', selId: 'xilianEquipSelect', pred: canXilian },
        { which: 'strong', selId: 'strongEquipSelect', pred: canStrong },
        { which: 'shenglian', selId: 'shenglianEquipSelect', pred: canShengLian },
    ];
    for (const { which, selId, pred } of configs) {
        const sel = document.getElementById(selId);
        if (!sel) continue;
        const prev = preserveSelection ? sel.value : '';
        const list = saveEquips.filter(e => pred(e) && passEquipListFilter(e, which));
        sel.innerHTML = '';
        if (!list.length) {
            sel.innerHTML = `<option value="">${emptyEquipTip(which)}</option>`;
        } else {
            for (const e of list) {
                const opt = document.createElement('option');
                opt.value = runtimeKey(e);
                opt.textContent = equipOptionLabel(e, which);
                sel.appendChild(opt);
            }
            if (prev && [...sel.options].some(o => o.value === prev)) sel.value = prev;
        }
    }
    fillSpecialAttachEquipSelect(preserveSelection);
    fillJianwangEquipSelect(preserveSelection);
    updateXilianHint();
    updateStrongHint();
    updateShenglianHint();
    updateJianwangHint();
    updateCraftedBagHint();
}

function updateShenglianHint() {
    const el = document.getElementById('shenglianHint');
    const box = document.getElementById('shenglianPreview');
    const sel = document.getElementById('shenglianEquipSelect');
    if (!el || !sel) return;
    const key = sel.value;
    const base = key ? saveEquips.find(e => runtimeKey(e) === key) : null;
    if (!base) {
        el.textContent = '90 级非橙红装且存在下一档（equ_next）可升炼至 100 级，之后才能精炼';
        if (box) {
            box.classList.add('empty');
            box.textContent = '选择装备后显示 90→100 对照';
        }
        return;
    }
    const cost = calcShengLianCost(base);
    el.textContent = `消耗提示：${formatCostList(cost)}（仅提示，不扣背包）`;
    if (box) {
        box.classList.remove('empty');
        // 只保留「打造信息」标签行：品质 / 蓝词条 / 地区附加 / 红词条 / 保底（没有的项不输出）
        box.innerHTML = equipMakeDetailHtml(base);
    }
}

function updateXilianHint() {
    const el = document.getElementById('xilianHint');
    const detail = document.getElementById('xilianMakeDetail');
    const key = document.getElementById('xilianEquipSelect').value;
    const eq = key ? getRuntimeEquip(key) : null;
    if (!eq) {
        if (el) {
            el.hidden = false;
            el.textContent = '仅 100 级绿/蓝/紫装可精炼；90 级请先升炼；来源可选「仅模拟打造」，支持按标记筛选';
        }
        if (detail) {
            detail.innerHTML = '';
            detail.hidden = true;
        }
        return;
    }
    // 选中装备后只展示它的底子（品质 / 基础 / 词条），不再堆 CZSeed、下次消耗那串数字
    if (el) el.hidden = true;
    if (detail) {
        const html = equipMakeDetailHtml(eq);
        detail.innerHTML = html;
        detail.hidden = !html;
    }
}

function updateStrongHint() {
    const el = document.getElementById('strongHint');
    const key = document.getElementById('strongEquipSelect').value;
    const eq = key ? getRuntimeEquip(key) : null;
    if (!eq) {
        el.textContent = '仅武器可淬炼；来源选「仅模拟打造」可专看打造武器，支持按标记筛选';
        return;
    }
    fillStrongTargetLevels(eq);
    const next = eq.level + 1;
    const c = strongAttemptCost(eq.need_lv || 90, eq.level);
    const stone = c ? `${STONE_NAMES[c.mat] || c.mat}×${c.num}` : '?';
    const baseEq = saveEquips.find(e => runtimeKey(e) === key);
    const userMark = baseEq?._mark ? ` · 标记「${baseEq._mark}」` : '';
    el.textContent = `S=${eq.S} · 当前 +${eq.level}/15 · 下一级消耗 ${stone} · LvProp=${eq.lv_prop}${userMark}`;
}

function setXilianHead() {
    setPreviewTableKind('xilian');
    document.getElementById('previewHead').innerHTML = `<tr>
        <th>保留</th><th>#</th><th>槽</th><th>原→新</th><th>倍率</th><th>XLLevel</th>
    </tr>`;
}

function fillXilianPropFilter(items) {
    const sel = document.getElementById('xilianFilterProp');
    if (!sel) return;
    const prev = sel.value;
    const props = [...new Set((items || []).map(it => it.prop?.prop).filter(Boolean))].sort((a, b) => {
        return propLabel(a).localeCompare(propLabel(b), 'zh');
    });
    sel.innerHTML = '<option value="">全部</option>' + props.map(p =>
        `<option value="${escapeHtml(p)}">${escapeHtml(propLabel(p))}</option>`
    ).join('');
    if (prev && props.includes(prev)) sel.value = prev;
}

function xilianFilterMatch(it) {
    const slot = document.getElementById('xilianFilterSlot')?.value || '';
    const prop = document.getElementById('xilianFilterProp')?.value || '';
    if (slot && String(it.slot) !== slot) return false;
    if (prop && it.prop?.prop !== prop) return false;
    return true;
}

function bindXilianKeepChecks() {
    document.querySelectorAll('#previewBody input.xl-keep').forEach(cb => {
        cb.addEventListener('change', () => {
            const idx = Number(cb.dataset.idx);
            if (Number.isFinite(idx)) xilianAcceptFlags[idx] = cb.checked;
            refreshXilianPlan();
        });
    });
}

function buildXilianEntries(items) {
    const out = [];
    (items || []).forEach((it, idx) => {
        if (xilianFilterMatch(it)) out.push({ it, idx });
    });
    return out;
}

/* 「聚气」这类固定小数值词条不存在「最大值」概念，不参与计算 */
const XILIAN_MAX_SKIP = new Set(['mp_back']);

/** 每行（含）为止累积消耗的连金泥数：不锁每次 1，洗出的词条勾「保留」后消耗翻倍（1→2→4→8） */
function xilianCumMud(items) {
    const list = items || [];
    const out = new Array(list.length);
    let cum = 0;
    for (let i = 0; i < list.length; i++) {
        const mult = Number(list[i] && list[i].cost_mult);
        cum += Number.isFinite(mult) && mult > 0 ? mult : 1;
        out[i] = cum;
    }
    return out;
}

/**
 * 词条「预计最大值」的数值文本（不含括号，取不到返回空串）。
 * 算法：这次洗出的显示数值 ÷ 所在档位系数。
 * 档位按累积泥消耗（装备的 XLLevel，含此前洗过的历史）分：
 *   1~20 → 0.6、21~40 → 0.7、41~60 → 0.8、61~80 → 0.9。
 * 累积过 80 之后系数为 1（洗出来就是满值，没有提升空间），故一律不显示 ——
 * 洗过很久的装备就属于这种，它显示的原值本身就是最大值。
 * 整除则显示整数，否则四舍五入保留 2 位小数。
 */
function xilianMaxValueText(prop, value, cumMud) {
    if (!(cumMud >= 1 && cumMud <= 80)) return '';
    if (XILIAN_MAX_SKIP.has(prop)) return '';
    const coef = cumMud <= 20 ? 0.6 : cumMud <= 40 ? 0.7 : cumMud <= 60 ? 0.8 : 0.9;
    const shown = mangjingDisplayValue(prop, value);
    if (!Number.isFinite(shown) || !shown) return '';
    const max = shown / coef;
    const text = Math.abs(max - Math.round(max)) < 1e-6
        ? String(Math.round(max))
        : (Math.round(max * 100) / 100).toFixed(2);
    return `${text}${mangjingUsesPercentFormat(prop, value) ? '%' : ''}`;
}

/** 精炼预测表那一列用的带括号版本 */
function xilianMaxText(prop, value, seqNo) {
    const t = xilianMaxValueText(prop, value, seqNo);
    return t ? `(最大值 ${t})` : '';
}

/**
 * 粗估"洗到目标要花多少连金泥"。
 * 只用于"有词条落在第 80 次之前"的情况 —— 实战必须提前锁槽把泥消耗顶过 80 才能吃满，
 * 而序列里的累加值是按勾选状态算的、不含这部分，会明显偏小，所以按理论下限重估：
 *   前段固定 80 泥（刚好卡到满值线），之后每刀按"需要的锁数"对应的倍率算。
 * 锁数由第一个目标的位次决定：≤13 三锁也不够 80（做不到）、14~22 三锁、23~41 双锁、≥42 单锁。
 */
function estimateXilianLianjin(seqNos) {
    // 口径与共享优化器完全一致，优先复用它那份实现，避免两处各写一份以后走偏
    if (typeof EquipmentAutoOptimizer !== 'undefined' && EquipmentAutoOptimizer
        && typeof EquipmentAutoOptimizer.estimateRefinementLianjin === 'function') {
        return EquipmentAutoOptimizer.estimateRefinementLianjin(seqNos);
    }
    const list = (seqNos || []).filter(n => Number.isFinite(n)).sort((a, b) => a - b);
    if (!list.length) return null;
    const first = list[0];
    if (first <= 13) return null; // 三锁也够不到 80
    let locks = first <= 22 ? 3 : first <= 41 ? 2 : 1;
    let mud = 80;            // 前段：把累积顶过满值线
    let from = first;        // 从第一个目标那一刀开始算
    for (let i = 0; i < list.length; i++) {
        const isLast = i === list.length - 1;
        const to = isLast ? list[i] : list[i + 1];
        mud += (to - from + 1) * (1 << Math.min(3, locks));
        if (isLast) break;
        // 靠前的目标若已被"凑 80 用的锁"覆盖，就不会新增；否则要新锁一个。
        // 最后一个目标留到收工再锁，所以不参与翻倍。
        if (i + 1 >= locks) locks = Math.min(3, locks + 1);
        from = to + 1;
    }
    return mud;
}

function renderXilianPage() {
    const body = document.getElementById('previewBody');
    const metaFilter = document.getElementById('xilianFilterMeta');
    if (!body) return;
    const entries = tablePager.xilianEntries || [];
    const accepts = xilianAcceptFlags;
    const pageSize = getPreviewPageSize();
    const start = (tablePager.page - 1) * pageSize;
    const slice = entries.slice(start, start + pageSize);
    if (!slice.length) {
        body.innerHTML = `<tr><td colspan="6" class="empty-row">无匹配记录</td></tr>`;
    } else {
        body.innerHTML = slice.map(({ it, idx }) => {
            const oldTxt = it.old_prop
                ? `${propLabel(it.old_prop.prop)}+${formatPropValue(it.old_prop.prop, it.old_prop.value)}`
                : '—';
            /* 勾了「保留」才显示这一行的最大值。档位看"这一刀结束时的累积泥"（XLLevel）：
               装备之前洗过的话它早就过 80，洗出来本身就是满值，没有提升空间，会自然不显示 */
            const maxTxt = accepts[idx] ? xilianMaxText(it.prop.prop, it.prop.value, it.xl_level) : '';
            const newTxt = `${propLabel(it.prop.prop)}+${formatPropValue(it.prop.prop, it.prop.value)}`
                + (maxTxt ? `<span class="xl-max">${maxTxt}</span>` : '');
            const kept = !!accepts[idx];
            return `<tr class="${kept ? 'row-keep' : ''}" data-idx="${idx}">
                <td><input type="checkbox" class="xl-keep" data-idx="${idx}" ${kept ? 'checked' : ''}></td>
                <td>${it.index}</td>
                <td>槽 ${it.slot}</td>
                <td>${oldTxt} → ${newTxt}</td>
                <td>×${it.cost_mult}</td>
                <td>${it.xl_level_before}→${it.xl_level}</td>
            </tr>`;
        }).join('');
        bindXilianKeepChecks();
    }
    if (metaFilter) {
        metaFilter.textContent = `显示 ${entries.length} / ${(xilianPlanItems || []).length} 条`;
    }
    updatePreviewPager(entries.length);
}

function renderXilianRows(items, accepts, resetPage = false) {
    tablePager.mode = 'xilian';
    if (resetPage) tablePager.page = 1;
    tablePager.xilianEntries = buildXilianEntries(items);
    void accepts;
    renderXilianPage();
}

function sumXilianCosts(eq, items, untilIdx) {
    const end = untilIdx == null ? items.length - 1 : untilIdx;
    const total = {};
    const isArmor = eq.typ >= 5 && eq.typ <= 7;
    const matName = isArmor ? '青蝉翼' : '昆吾石';
    const price = (EQUIP_DATA.equipment[String(eq.id)]?.price) || 10000;
    const silverOnce = Math.floor(price * 1.5);
    for (let i = 0; i <= end && i < items.length; i++) {
        const mult = items[i].cost_mult;
        total[matName] = (total[matName] || 0) + 5 * mult;
        total['连金泥'] = (total['连金泥'] || 0) + mult;
        total['银两'] = (total['银两'] || 0) + silverOnce;
    }
    return total;
}

function formatXilianCostText(total) {
    return Object.entries(total).map(([name, n]) => {
        if (name === '银两') return `${name}${formatSilver(n)}`;
        return `${name}×${n}`;
    }).join(' · ') || '—';
}

function refreshXilianPlan() {
    const key = document.getElementById('xilianEquipSelect').value;
    const eq = getRuntimeEquip(key);
    const box = document.getElementById('xilianPlanSummary');
    if (!eq || !xilianAcceptFlags.length) {
        if (box) {
            box.classList.add('empty');
            box.innerHTML = '预测后勾选「保留」查看总花费与最终属性';
        }
        return;
    }
    const accepts = xilianAcceptFlags.slice();
    const plan = wasmXilianPlan(toWasmEquip(eq), accepts);
    if (plan.error && !plan.items?.length) {
        box.classList.remove('empty');
        box.textContent = plan.error;
        return;
    }

    xilianPlanItems = plan.items || [];

    let marks = new Set(eq.xilian_marks || []);
    let simMarks = marks.size;
    for (const it of xilianPlanItems) {
        if (it.accepted) {
            marks.add(it.slot);
            simMarks = marks.size;
        }
    }

    const total = sumXilianCosts(eq, xilianPlanItems);
    const keepN = accepts.filter(Boolean).length;
    let lastKeepIdx = -1;
    for (let i = accepts.length - 1; i >= 0; i--) {
        if (accepts[i]) {
            lastKeepIdx = i;
            break;
        }
    }
    const lastKeepNo = lastKeepIdx >= 0
        ? (xilianPlanItems[lastKeepIdx]?.index ?? lastKeepIdx + 1)
        : 0;

    const finalEq = plan.equip || eq;
    const xl = finalEq.XLLevel ?? finalEq.xl_level ?? 0;
    const exts = finalEq.exts || [];

    // 每个槽位最后一次被「保留」的精炼序号：附加项要标明"第几次洗出来的"，
    // 并据此算理论最大值；slotLastIndex 同时供「加入成品背包」复用。
    const slotLastIndex = {};
    const slotLastCum = {};
    const keepSeqNos = [];
    const keepCums = [];
    for (let i = 0; i < xilianPlanItems.length; i++) {
        if (!accepts[i]) continue;
        const it = xilianPlanItems[i];
        slotLastIndex[it.slot] = it.index ?? (i + 1);
        slotLastCum[it.slot] = it.xl_level ?? 0;
        keepSeqNos.push(it.index ?? (i + 1));
        keepCums.push(it.xl_level ?? 0);
    }
    // 准确与否要看累积泥（含装备洗过的历史）：都过 80 → 早就在满值区，序列累加即真实花费；
    // 有落在 80 及以内的，实战得提前锁槽把泥顶过 80，只能按理论下限估算。
    const costExact = keepN > 0 && keepCums.every(c => c >= 81);
    const estLianjin = costExact ? null : estimateXilianLianjin(keepSeqNos);

    let cutoffTotal = lastKeepIdx >= 0
        ? sumXilianCosts(eq, xilianPlanItems, lastKeepIdx)
        : null;
    if (cutoffTotal && !costExact && estLianjin != null) {
        // 用理论下限替换连金泥；主材料与连金泥 5:1 同步；银两按"每次固定"计，不随倍率变
        cutoffTotal['连金泥'] = estLianjin;
        for (const k of Object.keys(cutoffTotal)) {
            if (k !== '连金泥' && k !== '银两') cutoffTotal[k] = 5 * estLianjin;
        }
    }

    const cutoffTxt = cutoffTotal ? formatXilianCostText(cutoffTotal) : '';

    const extTxt = exts.length
        ? exts.map((p, i) => {
            const mk = (finalEq.xilian_marks || []).includes(i + 1) || (finalEq.xilian_marks || []).includes(String(i + 1));
            const at = slotLastIndex[i + 1];
            const cum = slotLastCum[i + 1];
            /* 第 81 次之后系数为 1（洗出来就是满值），不再标注；
               最大值按「累积连金泥」cum 算，不能用工序序号 at，否则档位系数会错 */
            const mv = at ? xilianMaxValueText(p.prop, p.value, cum) : '';
            return `${i + 1}.${propLabel(p.prop)}+${formatPropValue(p.prop, p.value)}`
                + (at ? `（第${at}次${mv ? '，最大值 ' + mv : ''}）` : '')
                + (mk ? '🔒' : '');
        }).join(' · ')
        : '—';

    const cutoffLine = cutoffTotal
        ? `<div><strong>${costExact ? '截止花费' : '估算花费'}</strong>：${cutoffTxt}</div>`
        : '';
    const costWarn = costExact
        ? ''
        : '<div class="cost-warn">⚠ 当所选词条出现在 80 次之前，当前估算的消耗仅供参考。</div>';

    box.classList.remove('empty');
    // 顺序：警告在上、估算花费在中、最终附加在下（花费与附加之间空一行）
    box.innerHTML = `
        ${costWarn}
        ${cutoffLine}
        <div class="plan-gap"></div>
        <div class="swap-line"><strong>最终附加</strong>：${extTxt}</div>
        <div class="warn">※ 每次精炼均消耗；仅勾选「保留」的结果会替换对应槽并标记（后续消耗翻倍）。勾选后「截止花费」按最后一条保留记录统计。</div>
    `;

    lastXilianPlan = {
        equipKey: xilianPlanEquipKey,
        exts,                 // 最终附加 [{prop, value}]
        slotLastIndex,        // {槽位: 精炼序号}
        slotLastCum,          // {槽位: 累积连金泥}（算最大值用，不能用序号）
        costTotal: total,
        costCutoff: cutoffTotal,
        costText: formatXilianCostText(total),
        cutoffText: cutoffTotal ? formatXilianCostText(cutoffTotal) : '',
        xl,
        keepN,
        lastKeepNo,
        simMarks,
        accepts: accepts.slice(),
    };

    fillXilianPropFilter(xilianPlanItems);
    renderXilianRows(xilianPlanItems, accepts, false);
}

function renderXilianPreview(n) {
    setXilianHead();
    const body = document.getElementById('previewBody');
    const meta = document.getElementById('previewMeta');
    const key = document.getElementById('xilianEquipSelect').value;
    const eq = getRuntimeEquip(key);
    const filterBar = document.getElementById('xilianFilterBar');
    const makeFilter = document.getElementById('makeFilterBar');
    if (makeFilter) makeFilter.hidden = true;
    if (!eq) {
        body.innerHTML = `<tr><td colspan="6" class="empty-row">请选择装备</td></tr>`;
        if (filterBar) filterBar.hidden = true;
        hidePreviewPager();
        return;
    }
    xilianPlanEquipKey = key;
    xilianAcceptFlags = Array(n).fill(false);
    const plan = wasmXilianPlan(toWasmEquip(eq), xilianAcceptFlags);
    if (plan.error && !plan.items?.length) {
        body.innerHTML = `<tr><td colspan="6" class="empty-row">${escapeHtml(plan.error)}</td></tr>`;
        meta.textContent = '';
        if (filterBar) filterBar.hidden = true;
        hidePreviewPager();
        return;
    }
    xilianPlanItems = plan.items || [];
    meta.textContent = `预览 ${xilianPlanItems.length} 条序列 · 勾选「保留」后自动统计花费与最终属性`;
    if (filterBar) {
        filterBar.hidden = false;
        document.getElementById('xilianFilterSlot').value = '';
        fillXilianPropFilter(xilianPlanItems);
        document.getElementById('xilianFilterProp').value = '';
    }
    tablePager.page = 1;
    refreshXilianPlan();
}

function setStrongHead() {
    setPreviewTableKind('strong');
    document.getElementById('previewHead').innerHTML = `<tr>
        <th>#</th><th>档位</th><th>淬炼度</th><th>消耗最少</th><th>数值最优</th>
    </tr>`;
}

function strongMinGrade() {
    return Number(document.getElementById('strongMinGrade')?.value) || 3;
}

function fillStrongTargetLevels(eq) {
    const sel = document.getElementById('strongTargetLevel');
    if (!sel) return;
    const cur = eq?.level || 0;
    const prev = Number(sel.value) || 0;
    sel.innerHTML = '';
    for (let lv = cur + 1; lv <= 15; lv++) {
        const opt = document.createElement('option');
        opt.value = lv;
        opt.textContent = `+${lv}`;
        sel.appendChild(opt);
    }
    if (!sel.options.length) {
        sel.innerHTML = '<option value="">已满 +15</option>';
        return;
    }
    const prefer = prev > cur ? prev : 15;
    sel.value = String(prefer);
}

function formatCostChips(bag) {
    const chips = [];
    for (const id of [3027, 3028, 3029, 3030]) {
        const n = bag?.stones?.[id] || 0;
        if (n) chips.push(`<span class="cost-chip">${STONE_NAMES[id]}×${n}</span>`);
    }
    if (bag?.silver) chips.push(`<span class="cost-chip">银两${formatSilver(bag.silver)}</span>`);
    return chips.join('') || '<span class="cost-chip">—</span>';
}

function renderPathChipsHtml(accepts, names, which) {
    const total = accepts.length;
    if (!total) return '<div class="advice-path">—</div>';
    const pages = Math.max(1, Math.ceil(total / PATH_PAGE_SIZE));
    let page = pathPages[which] || 1;
    if (page > pages) page = pages;
    if (page < 1) page = 1;
    pathPages[which] = page;
    const start = (page - 1) * PATH_PAGE_SIZE;
    const slice = accepts.slice(start, start + PATH_PAGE_SIZE);
    const path = slice.map(st => {
        const nextLv = (st.level || 0) + 1;
        return `<span class="path-chip">
            <span class="lv">+${st.level}→+${nextLv}</span>
            <span class="idx">#${st.index}</span>
            <span class="grade-${st.grade}">${names[st.grade] || ''}</span>
        </span>`;
    }).join('');
    const pager = total > PATH_PAGE_SIZE
        ? `<div class="path-pager" data-which="${which}">
            <button type="button" class="btn btn-reset path-prev" ${page <= 1 ? 'disabled' : ''}>上一页</button>
            <span>第 ${page}/${pages} 页 · 共 ${total} 次</span>
            <button type="button" class="btn btn-reset path-next" ${page >= pages ? 'disabled' : ''}>下一页</button>
           </div>`
        : '';
    return `<div class="advice-path">${path}</div>${pager}`;
}

function formatPlanCard(title, plan, names, tag, which) {
    if (!plan?.ok) {
        return `<article class="advice-card fail">
            <div class="advice-card-head"><h3>${title}</h3></div>
            <div>${escapeHtml(plan?.reason || '不可用')}</div>
        </article>`;
    }
    const deg = plan.value / 2;
    const atk = (plan.value / 10).toFixed(1);
    const accepts = plan.steps.filter(s => s.action === '接受');
    plan._acceptSteps = accepts;
    plan._names = names;
    return `<article class="advice-card" data-plan="${which}">
        <div class="advice-card-head">
            <h3>${title}</h3>
            <span class="tag">${tag}</span>
        </div>
        <div class="advice-metrics">
            <div class="advice-metric"><span class="v">${plan.attempts}</span><span class="k">尝试次数</span></div>
            <div class="advice-metric"><span class="v">+${deg}%</span><span class="k">淬炼度</span></div>
            <div class="advice-metric"><span class="v">+${atk}%</span><span class="k">约属性</span></div>
        </div>
        <div class="advice-costs">${formatCostChips(plan.bag)}</div>
        <div class="advice-path-label">接受路径（共 ${accepts.length} 次升层）</div>
        <div class="advice-path-wrap">${renderPathChipsHtml(accepts, names, which)}</div>
    </article>`;
}

function bindPathPagers() {
    document.querySelectorAll('.path-pager').forEach(bar => {
        const which = bar.dataset.which;
        bar.querySelector('.path-prev')?.addEventListener('click', () => {
            pathPages[which] = (pathPages[which] || 1) - 1;
            refreshPathSection(which);
        });
        bar.querySelector('.path-next')?.addEventListener('click', () => {
            pathPages[which] = (pathPages[which] || 1) + 1;
            refreshPathSection(which);
        });
    });
}

function refreshPathSection(which) {
    if (!strongPlanCache) return;
    const plan = which === 'min' ? strongPlanCache.minCost : strongPlanCache.maxValue;
    const card = document.querySelector(`.advice-card[data-plan="${which}"]`);
    const wrap = card?.querySelector('.advice-path-wrap');
    if (!wrap || !plan?._acceptSteps) return;
    wrap.innerHTML = renderPathChipsHtml(plan._acceptSteps, plan._names || {}, which);
    bindPathPagers();
}

function highlightStrongPlan(which) {
    if (!strongPlanCache) return;
    const plan = which === 'min' ? strongPlanCache.minCost : strongPlanCache.maxValue;
    const set = plan?.ok ? plan.accepts : new Set();
    document.querySelectorAll('#previewBody tr[data-idx]').forEach(tr => {
        const idx = Number(tr.dataset.idx);
        tr.classList.toggle('row-keep', set.has(idx));
    });
}

function renderStrongPage() {
    const body = document.getElementById('previewBody');
    if (!body) return;
    const items = tablePager.strongItems || [];
    const minSet = tablePager.strongMinSet || new Set();
    const bestSet = tablePager.strongBestSet || new Set();
    const pageSize = getPreviewPageSize();
    const start = (tablePager.page - 1) * pageSize;
    const slice = items.slice(start, start + pageSize);
    if (!slice.length) {
        body.innerHTML = `<tr><td colspan="5" class="empty-row">无数据</td></tr>`;
    } else {
        body.innerHTML = slice.map(it => {
            const deg = it.add_lv_prop / 2;
            return `<tr data-idx="${it.index}">
                <td>${it.index}</td>
                <td class="grade-${it.grade}">${it.grade_name}</td>
                <td>+${deg}%（同层参考）</td>
                <td class="${minSet.has(it.index) ? 'advice-yes' : 'advice-no'}">${minSet.has(it.index) ? '接受' : '—'}</td>
                <td class="${bestSet.has(it.index) ? 'advice-yes' : 'advice-no'}">${bestSet.has(it.index) ? '接受' : '—'}</td>
            </tr>`;
        }).join('');
    }
    updatePreviewPager(items.length);
}

function renderStrongPreview(resp, eq) {
    setStrongHead();
    const body = document.getElementById('previewBody');
    const meta = document.getElementById('previewMeta');
    const advice = document.getElementById('strongAdvice');
    const xlFilter = document.getElementById('xilianFilterBar');
    if (xlFilter) xlFilter.hidden = true;
    const makeFilter = document.getElementById('makeFilterBar');
    if (makeFilter) makeFilter.hidden = true;
    if (resp.error && (!resp.items || !resp.items.length)) {
        body.innerHTML = `<tr><td colspan="5" class="empty-row">${escapeHtml(resp.error)}</td></tr>`;
        meta.textContent = '';
        if (advice) advice.innerHTML = '';
        strongPlanCache = null;
        hidePreviewPager();
        return;
    }
    const items = resp.items || [];
    const grades = items.map(i => i.grade);
    const startLevel = eq.level || 0;
    const target = Number(document.getElementById('strongTargetLevel')?.value) || Math.min(15, startLevel + 3);
    const minG = strongMinGrade();
    const names = { 1: '一般', 2: '良好', 3: '优秀', 4: '完美' };

    const plans = planStrongPath(grades, startLevel, target, minG, eq.need_lv || 90);
    strongPlanCache = plans;
    strongPlanCache.items = items;
    pathPages = { min: 1, max: 1 };

    const perfect = items.filter(i => i.grade === 4).length;
    meta.textContent = `序列 ${items.length} · 完美 ${perfect} · 当前 +${startLevel} → 期望 +${target} · 最低 ${names[minG]}`;

    advice.innerHTML = [
        formatPlanCard('消耗最少', plans.minCost, names, '优先省稀有炼石', 'min'),
        formatPlanCard('数值最优', plans.maxValue, names, '优先高淬炼度', 'max'),
        '<div class="advice-note">※ 取消也耗炼石；同结果尽量把尝试留在更便宜的层。稀有度：紫＞蓝＞绿＞白。点下方按钮可高亮对应接受行。</div>',
    ].join('');
    bindPathPagers();

    const minSet = plans.minCost?.ok ? plans.minCost.accepts : new Set();
    const bestSet = plans.maxValue?.ok ? plans.maxValue.accepts : new Set();

    tablePager.mode = 'strong';
    tablePager.page = 1;
    tablePager.strongItems = items;
    tablePager.strongMinSet = minSet;
    tablePager.strongBestSet = bestSet;
    renderStrongPage();
}


function extractMakeRnd(data) {
    if (!data) return null;
    if (data.MakeRnd) return data.MakeRnd;
    if (Array.isArray(data) && data[0]?.MakeRnd) return data[0].MakeRnd;
    if (data.Seeds || data.LuckySeeds) return data;
    return null;
}

function loadSaveData(json) {
    const makeRnd = extractMakeRnd(json);
    if (!makeRnd) throw new Error('存档中未找到 MakeRnd');
    const state = {
        Seeds: makeRnd.Seeds || {},
        LuckySeeds: makeRnd.LuckySeeds || {},
        IDSeeds: makeRnd.IDSeeds || {},
        MakeLucky: makeRnd.MakeLucky || {},
    };
    if (!wasmMakeSetState(state)) throw new Error('MakeRnd 注入失败');
    makeRndSnapshot = JSON.parse(JSON.stringify(state));

    saveEquips = collectEquipsFromSave(json);
    saveEquipsSnapshot = JSON.parse(JSON.stringify(saveEquips));
    equipRuntime = {};
    equipRuntimeSnapshot = {};
    jianwangRuleDetection = detectJianwangRuleFromEquips(saveEquips);
    jianwangRedSeed = validJianwangRedSeed(makeRnd.RedSeeds?.[String(JIANWANG_BLANK_ID)])
        ? Number(makeRnd.RedSeeds[String(JIANWANG_BLANK_ID)])
        : null;
    jianwangRedSeedSnapshot = jianwangRedSeed;
    jianwangReforgeCounts = {};
    const saveRoot = Array.isArray(json) ? json[0] : json;
    for (const id of JIANWANG_LEVEL_90_IDS) {
        const savedCount = findSaveScalar(saveRoot, `again_${id}`);
        jianwangReforgeCounts[String(id)] = Math.max(0, Math.floor(Number(savedCount) || 0));
    }
    for (const e of saveEquips) {
        const k = runtimeKey(e);
        const full = { ...e, ...toWasmEquip(e), xilian_marks: [...(e.xilian_marks || [])] };
        equipRuntime[k] = JSON.parse(JSON.stringify(full));
        equipRuntimeSnapshot[k] = JSON.parse(JSON.stringify(full));
    }
    refreshJianwangVirtualFirstSword();
    jianwangReforgeCountsSnapshot = { ...jianwangReforgeCounts };

    saveLoaded = true;
    clearMakeAdvanceNotice();
    resetXilianSession();
    document.getElementById('saveStatus').textContent = '导入成功';
    if (typeof renderArchiveState === 'function') renderArchiveState(json);
    fillEquipSelects();
    renderCraftedBagList();
    updateMakeHints();
    updateCraftedBagHint();
    updateJianwangCycleHint();
}

async function handleSaveFile(file) {
    if (typeof _importFeedback === 'function') _importFeedback(true);
    let json;
    try {
        if (typeof decryptSaveFile === 'function') {
            const r = await decryptSaveFile(file);
            json = r.data;
            saveMeta = {
                version: r.version || '',
                platform: r.platform || '',
                columns: r.columns || null,
                row: r.row || null,
            };
            if (typeof saveShareStore === 'function') {
                saveShareStore(json, {
                    version: r.version, platform: r.platform,
                    channel: r.channel || (String(r.platform || '').toLowerCase() === 'oversea' ? '国际服' : ''),
                    format: r.format || 'json', columns: r.columns || null, row: r.row || null,
                });
            }
        } else {
            const text = await file.text();
            const raw = JSON.parse(text);
            const entry = Array.isArray(raw) ? raw[0] : raw;
            if (entry && (entry.content || entry.encrypted)) {
                json = wasmDecryptSave(entry.content || entry.encrypted);
            } else {
                json = raw;
            }
        }
    } catch (e) {
        if (typeof _importFeedback === 'function') _importFeedback(false);
        throw new Error('存档解析失败: ' + e.message);
    }
    if (typeof _importFeedback === 'function') _importFeedback(false);
    loadSaveData(json);
}

function switchTab(tab) {
    currentTab = tab;
    document.querySelectorAll('.tab-btn').forEach(b => {
        b.classList.toggle('active', b.dataset.tab === tab);
    });
    document.getElementById('panelMake').hidden = tab !== 'make';
    const sl = document.getElementById('panelShenglian');
    if (sl) sl.hidden = tab !== 'shenglian';
    document.getElementById('panelXilian').hidden = tab !== 'xilian';
    document.getElementById('panelStrong').hidden = tab !== 'strong';
    const jwg = document.getElementById('panelJianwang');
    if (jwg) jwg.hidden = tab !== 'jianwang';
    renderMakeAdvanceNotice();
    if (tab === 'shenglian') {
        fillEquipSelects();
        updateShenglianHint();
        clearPreview('升炼无需预测序列，选择装备后点击「执行升炼」');
    } else if (tab === 'jianwang') {
        fillJianwangEquipSelect(true);
        updateJianwangHint();
        clearPreview('选择剑王阁实物或虛擬劍胚和流程后，点击「预览当前流程」');
    } else if (tab === 'xilian') {
        fillXilianMangjingMaterials();
        clearPreview('点击预测查看结果');
    } else {
        clearPreview('点击预测查看结果');
    }
}

function doMakePreview() {
    if (!saveLoaded) { alert('请先导入存档'); return; }
    const req = requireCurrentMakeRequest();
    if (!req) return;
    const n = Math.max(1, Math.min(PREVIEW_MAX, Number(document.getElementById('previewCount').value) || 100));
    renderMakePreview(wasmMakePreview(req, n));
    updateMakeHints();
}

function doSpecialAttachPreview() {
    if (!saveLoaded) { alert('请先导入存档'); return; }
    const equipKey = document.getElementById('specialAttachEquipSelect')?.value || '';
    const materialId = document.getElementById('specialAttachMaterialSelect')?.value || '';
    const equip = saveEquips.find(item => runtimeKey(item) === equipKey);
    const material = EQUIP_DATA.special[String(materialId)];
    if (!equip) { alert('请选择要连续附加材料的装备'); return; }
    if (!material) { alert('请选择要重复附加的特殊材料'); return; }
    const count = Number(document.getElementById('specialAttachCount')?.value);
    try {
        if (!Number.isSafeInteger(count) || count < 1 || count > PREVIEW_MAX) {
            throw new RangeError(`预测次数必须是 1–${PREVIEW_MAX} 的整数`);
        }
        renderSpecialAttachPreview(predictSpecialAttachSequence(equip, material, count));
    } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        clearPreview(`连续附加预测失败：${message}`);
        alert(`连续附加预测失败：${message}`);
    }
}

/* ── 精炼页 · 芒晶洗练序列 ─────────────────────────────── */
/** 按装备部位选择默认芒晶材料：武器类→龙骨(2021)、防具类→紫玉髓(2023) */
function defaultMangjingMaterialForEquip(equip) {
    const typ = Number(equip?.typ);
    // 武器类：拳套/刀/剑/枪棍/戒指/挂坠 → 龙骨（穿甲）
    if ([1, 2, 3, 4, 8, 9].includes(typ)) return 2021;
    // 防具类：腰带/护腕/内甲 → 紫玉髓（真元）
    if ([5, 6, 7].includes(typ)) return 2023;
    return null;
}

/** 填充芒晶材料下拉（只列适用于当前精炼装备的材料），并按部位自动选默认 */
function fillXilianMangjingMaterials() {
    const sel = document.getElementById('xilianMangjingMaterial');
    if (!sel) return;
    const previous = sel.value;
    const equipKey = document.getElementById('xilianEquipSelect')?.value || '';
    const equip = saveEquips.find(item => runtimeKey(item) === equipKey);
    sel.innerHTML = '';
    if (!equip) {
        sel.innerHTML = '<option value="">请先选择装备</option>';
        return;
    }
    const materials = specialMaterialsForEquip(equip);
    if (!materials.length) {
        sel.innerHTML = '<option value="">该装备无适用材料</option>';
        return;
    }
    for (const m of materials) {
        const opt = document.createElement('option');
        opt.value = String(m.id);
        opt.textContent = m.name || String(m.id);
        sel.appendChild(opt);
    }
    // 优先保留用户上次选择；否则按部位自动选默认
    if (previous && materials.some(m => String(m.id) === previous)) {
        sel.value = previous;
    } else {
        const defId = defaultMangjingMaterialForEquip(equip);
        const def = defId ? materials.find(m => Number(m.id) === defId) : null;
        if (def) sel.value = String(def.id);
    }
}

/** 渲染芒晶序列：头部最高值 + 逐次结果列表 */
function renderXilianMangjing(result, material, equip) {
    const box = document.getElementById('xilianMangjingResult');
    if (!box) return;
    // wasm 的 predictSpecialAttachSequence 直接返回数组；EquipmentAutoOptimizer 版返回 {items}
    const items = Array.isArray(result) ? result : (Array.isArray(result?.items) ? result.items : []);
    if (!items.length) {
        box.classList.add('empty');
        const err = result?.error ? ` · error: ${result.error}` : '';
        box.innerHTML = `芒晶序列无结果（items 为空）${escapeHtml(err)}
            <pre style="text-align:left;font-size:0.7rem;opacity:.7;margin-top:.5rem;max-height:8rem;overflow:auto;background:rgba(0,0,0,.2);padding:.4rem;border-radius:4px">${escapeHtml(JSON.stringify(result, null, 2).slice(0, 1500))}</pre>
            <small style="opacity:.6">F12 Console 搜 [mangjing] 看完整入参</small>`;
        return;
    }
    box.classList.remove('empty');
    let best = items[0];
    for (const it of items) {
        if (Number(it.value) > Number(best.value)) best = it;
    }
    const levelText = Number(equip?.need_lv) > 0 ? ` · ${Number(equip.need_lv)}级` : '';
    const head = `<div class="mangjing-head">
        <strong>芒晶洗练 · ${escapeHtml(material.name || String(material.id))}${escapeHtml(levelText)}</strong>
        <span class="mangjing-peak">最高 ${escapeHtml(propLabel(best.prop))} ${escapeHtml(formatPropValue(best.prop, best.value))} · 第 ${Number(best.index)} 次</span>
        <span class="mangjing-cost">消耗 芒晶×${Number(best.index)}</span>
        <button type="button" class="mangjing-toggle" aria-expanded="false">展开 ${items.length} 次序列</button>
    </div>`;
    const seq = `<ol class="mangjing-sequence" hidden>${items.map(it => {
        const isBest = it === best;
        return `<li class="mangjing-item${isBest ? ' is-best' : ''}">
            <span class="mangjing-idx">第 ${Number(it.index)} 次</span>
            <span class="mangjing-prop">${escapeHtml(propLabel(it.prop))}</span>
            <span class="mangjing-val">${escapeHtml(formatPropValue(it.prop, it.value))}</span>
        </li>`;
    }).join('')}</ol>`;
    box.innerHTML = head + seq;
    // 折叠/展开 序列
    const toggleBtn = box.querySelector('.mangjing-toggle');
    const seqEl = box.querySelector('.mangjing-sequence');
    if (toggleBtn && seqEl) {
        toggleBtn.addEventListener('click', () => {
            const open = seqEl.hasAttribute('hidden');
            if (open) {
                seqEl.removeAttribute('hidden');
                toggleBtn.textContent = `折叠序列`;
                toggleBtn.setAttribute('aria-expanded', 'true');
            } else {
                seqEl.setAttribute('hidden', '');
                toggleBtn.textContent = `展开 ${items.length} 次序列`;
                toggleBtn.setAttribute('aria-expanded', 'false');
            }
        });
    }
}

/** 芒晶序列预测：优先用全局函数，回退到 EquipmentAutoOptimizer（两种挂载方式都兼容） */
function runSpecialAttachPredict(equip, material, count) {
    if (typeof predictSpecialAttachSequence === 'function') {
        return predictSpecialAttachSequence(equip, material, count);
    }
    const fn = (typeof EquipmentAutoOptimizer !== 'undefined')
        ? EquipmentAutoOptimizer?.predictSpecialAttachSequence
        : null;
    if (typeof fn === 'function') return fn(equip, material, count);
    throw new Error('芒晶序列预测函数不可用（页面资源未加载完整，请刷新重试）');
}

/* ── 成品背包：入包 / 渲染 / 持久化 / 导出 ─────────────── */
/** 本地下载实现（equip 页不依赖 simulator.js，triggerFileDownload 不存在） */
function equipDownloadFile(filename, text) {
    const blob = new Blob([text], { type: 'text/plain;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    a.style.display = 'none';
    document.body.appendChild(a);
    a.click();
    setTimeout(() => { document.body.removeChild(a); URL.revokeObjectURL(url); }, 100);
    return true;
}

/** 序列化装备的「最终附加」行：1.攻击+129（第70次，最大值 143.33）· 2.攻击+115 · 3.攻击+73
 *  与「保留规划」那行用同一个 xilianMaxValueText，入包后也能看到理论上限。
 *  不再合计：词条可能是 攻击+吸血 之类不同维度，合计无意义。
 *  slotLastCum 是「累积连金泥」映射（算最大值用），缺失时回退用序号，避免入参为空时报错。 */
function buildExtLines(exts, slotLastIndex, slotLastCum) {
    const parts = [];
    (exts || []).forEach((p, i) => {
        const slot = i + 1;
        const at = slotLastIndex?.[slot];
        const cum = slotLastCum?.[slot] ?? at;
        // 档位按这一刀所处的精炼阶段（累积泥）算；过 80 后系数为 1，此时 xilianMaxValueText 返回空串，不标注
        const mv = at ? xilianMaxValueText(p.prop, p.value, cum) : '';
        parts.push(`${slot}.${propLabel(p.prop)}+${formatPropValue(p.prop, p.value)}`
            + (at ? `（第${at}次${mv ? '，最大值 ' + mv : ''}）` : ''));
    });
    return { extText: parts.join(' · ') };
}

/** 生成标题：标记 + 装备名；同标记+同名已存在则自动加 (n) 后缀 */
function buildBagTitle(mark, equipName) {
    const base = [mark, equipName].filter(Boolean).join(' ');
    const same = refinedBag.filter(e => e.baseTitle === base).length;
    return { baseTitle: base, title: `${base} (${same + 1})` };
}

/** 「加入成品背包」：汇总当前精炼规划 + 最近一次芒晶结果 */
function addRefinedToBag() {
    if (!saveLoaded) { alert('请先导入存档'); return; }
    const equipKey = document.getElementById('xilianEquipSelect')?.value || '';
    const equip = saveEquips.find(item => runtimeKey(item) === equipKey);
    if (!equip) { alert('请先选择一件精炼装备'); return; }

    const plan = lastXilianPlan;
    const mj = lastMangjingResult;

    /*
     * 这两份快照都是「上次对某一件装备」算出来的。若中途在下拉框换了装备却没重新预测，
     * 直接加背包就会把 A 的精炼词条/花费/盲晶记到 B 的名字下（名字取当前选中、属性取快照）。
     * 所以必须核对装备标识，不一致就拦下来。
     */
    if (plan && plan.equipKey && plan.equipKey !== equipKey) {
        alert('这件装备和上次「预测序列」的装备对不上（中途换过装备，或它升炼后编号变了）。\n请先对当前这件重新点一次「预测序列」，再点「加入成品背包」。');
        return;
    }
    if (mj && mj.equipKey && mj.equipKey !== equipKey) {
        alert('这件装备和上次「芒晶序列」的装备对不上（中途换过装备，或它升炼后编号变了）。\n请先对当前这件重新跑一次「芒晶序列」，再点「加入成品背包」。');
        return;
    }

    const anyAccepted = plan ? plan.accepts.some(Boolean) : false;

    // 校验：未勾保留 / 未跑芒晶 都给警告，用户可强行加入
    if (!anyAccepted) {
        if (!confirm('当前没有勾选任何「保留」项，最终附加为空。\n仍要加入成品背包吗？')) return;
    }
    if (!mj) {
        if (!confirm('尚未运行「芒晶序列」，盲晶信息会为空。\n仍要加入成品背包吗？')) return;
    }

    const mark = String(equip._mark || '').trim();
    const equipName = equip.name || String(equip.id || '装备');
    const { baseTitle, title } = buildBagTitle(mark, equipName);
    const { extText } = buildExtLines(plan?.exts || [], plan?.slotLastIndex, plan?.slotLastCum);
    const costText = plan ? (plan.cutoffText || plan.costText) : '';
    // 打造工匠地点（仅新打造的装备有 _make_npcId；老数据/已装备装备为空）
    let npcPlace = '';
    if (equip._make_npcId) {
        const cm = EQUIP_DATA.craftsman[String(equip._make_npcId)];
        if (cm) {
            npcPlace = `${cm.place || cm.name} · ${cm.name}（${cm.zhi === 'fengzhi' ? '绣' : '铁'}）`;
        }
    }
    // 地区附加（仅模拟打造装备有 _make_region；老数据/已装备装备为空 → 不显示）
    let regionText = '';
    if (Array.isArray(equip._make_region) && equip._make_region.length) {
        regionText = equip._make_region
            .map(p => `${propLabel(p.prop)}+${formatPropValue(p.prop, p.value)}`)
            .join(' · ');
    }
    const mjText = mj
        ? `盲晶 ${mj.materialName} · 最高 ${propLabel(mj.prop)} ${formatPropValue(mj.prop, mj.value)} · 第 ${mj.index} 次`
        : '盲晶 —（未运行芒晶序列）';

    refinedBag.push({
        id: `rb_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
        title,
        baseTitle,
        mark,
        equipName,
        npcPlace,
        regionText,
        color: equip.color,
        extText: extText || '未勾选保留',
        costText: costText || '—',
        mjText,
        xl: plan?.xl ?? 0,
        keepN: plan?.keepN ?? 0,
        note: '',
        at: Date.now(),
    });
    saveRefinedBag();
    renderRefinedBag();
}

/** 把文本切成「文字 / 数字」片段：只有数字部分允许编辑（序号 1. 之类不受影响） */
function splitEditableNumbers(text) {
    const s = String(text ?? '');
    const parts = [];
    const re = /(?<![\d.])\d+(?:\.\d+)?(?![\d.])/g;
    let last = 0;
    let m;
    while ((m = re.exec(s)) !== null) {
        if (m.index > last) parts.push({ num: false, v: s.slice(last, m.index) });
        parts.push({ num: true, v: m[0] });
        last = m.index + m[0].length;
    }
    if (last < s.length) parts.push({ num: false, v: s.slice(last) });
    return parts;
}

/** 渲染成品背包的一行：文字原样输出，数字换成可编辑输入框 */
function renderRefinedBagLine(label, text, field) {
    const body = splitEditableNumbers(text).map(p => {
        if (!p.num) return escapeHtml(p.v);
        return `<input type="text" inputmode="decimal" class="rb-num" data-field="${field}" size="${Math.max(2, p.v.length)}" value="${escapeHtml(p.v)}">`;
    }).join('');
    return `<div class="refined-bag-line"><span>${label}</span><div class="rb-line-body">${body}</div></div>`;
}

/** 用输入框里的新值，按原文本的数字位置重新拼回字符串 */
function rebuildRefinedBagField(originalText, values) {
    let i = 0;
    return splitEditableNumbers(originalText)
        .map(p => (p.num ? (values[i++] ?? p.v) : p.v))
        .join('');
}

/** 数字输入变化：重拼该行文本并持久化（不重渲染，避免打断输入） */
function onRefinedBagNumberChange(input) {
    const card = input.closest('.refined-bag-card');
    if (!card) return;
    const rec = refinedBag.find(x => x.id === card.dataset.id);
    if (!rec) return;
    const field = input.dataset.field;
    if (!field) return;
    const inputs = Array.from(card.querySelectorAll(`.rb-num[data-field="${field}"]`));
    const originals = splitEditableNumbers(rec[field]).filter(p => p.num).map(p => p.v);
    const values = inputs.map((el, i) => {
        const v = String(el.value).trim();
        if (/^-?\d+(?:\.\d+)?$/.test(v)) return v;
        alert('这里只能填数字，已还原为原值。');
        el.value = originals[i] ?? '';
        return originals[i] ?? '';
    });
    rec[field] = rebuildRefinedBagField(rec[field], values);
    saveRefinedBag();
}

/** 渲染成品背包卡片列表 */
function renderRefinedBag() {
    const box = document.getElementById('refinedBagList');
    const meta = document.getElementById('refinedBagMeta');
    if (!box) return;
    if (meta) meta.textContent = refinedBag.length ? `共 ${refinedBag.length} 件` : '';
    if (!refinedBag.length) {
        box.classList.add('empty');
        box.textContent = '暂无成品装备。先「预测序列」勾选保留 → 跑「芒晶序列」→ 点「加入成品背包」';
        return;
    }
    box.classList.remove('empty');
    box.innerHTML = refinedBag.map(e => {
        const note = typeof e.note === 'string' ? e.note : '';
        return `<div class="refined-bag-card" data-id="${escapeHtml(e.id)}">
            <div class="refined-bag-head">
                <strong class="color-${Number(e.color) || 1}">${escapeHtml(e.title)}</strong>
                ${e.regionText ? `<span class="refined-bag-region">${escapeHtml(e.regionText)}</span>` : ''}
                <button type="button" class="btn btn-reset btn-row-action refined-bag-del" data-id="${escapeHtml(e.id)}">移除</button>
            </div>
            ${renderRefinedBagLine('最终附加', e.extText, 'extText')}
            ${renderRefinedBagLine('消耗', e.costText, 'costText')}
            ${renderRefinedBagLine('盲晶', e.mjText, 'mjText')}
            <div class="refined-bag-line refined-bag-note-line">
                <span>备注</span>
                <input type="text" class="rb-note" maxlength="100" placeholder="选填，最多 100 字" value="${escapeHtml(note)}">
                <em class="rb-note-count">${note.length}/100</em>
            </div>
        </div>`;
    }).join('');
}

/* ── 成品背包持久化：IndexedDB 为主（容量大），localStorage 兜底 ────────── */
let refinedBagDBPromise = null;
let refinedBagIdbTimer = null;
let refinedBagSaveWarned = false;

function openRefinedBagDB() {
    if (refinedBagDBPromise) return refinedBagDBPromise;
    refinedBagDBPromise = new Promise((resolve, reject) => {
        if (typeof indexedDB === 'undefined') { reject(new Error('indexedDB 不可用')); return; }
        let req;
        try { req = indexedDB.open(REFINED_BAG_DB, 1); } catch (e) { reject(e); return; }
        req.onupgradeneeded = () => {
            const db = req.result;
            if (!db.objectStoreNames.contains(REFINED_BAG_STORE)) db.createObjectStore(REFINED_BAG_STORE);
        };
        req.onsuccess = () => resolve(req.result);
        req.onerror = () => reject(req.error || new Error('打开 IndexedDB 失败'));
        req.onblocked = () => reject(new Error('IndexedDB 被其它标签页占用'));
    }).catch(err => {
        refinedBagDBPromise = null;   // 失败后允许下次重试
        throw err;
    });
    return refinedBagDBPromise;
}

async function idbSaveRefinedBag() {
    try {
        const db = await openRefinedBagDB();
        await new Promise((resolve, reject) => {
            const tx = db.transaction(REFINED_BAG_STORE, 'readwrite');
            tx.objectStore(REFINED_BAG_STORE).put(refinedBag, REFINED_BAG_DB_KEY);
            tx.oncomplete = () => resolve();
            tx.onerror = () => reject(tx.error);
            tx.onabort = () => reject(tx.error);
        });
        return true;
    } catch (e) {
        console.warn('[成品背包] IndexedDB 写入失败：', e);
        return false;
    }
}

async function idbLoadRefinedBag() {
    try {
        const db = await openRefinedBagDB();
        const value = await new Promise((resolve, reject) => {
            const tx = db.transaction(REFINED_BAG_STORE, 'readonly');
            const req = tx.objectStore(REFINED_BAG_STORE).get(REFINED_BAG_DB_KEY);
            req.onsuccess = () => resolve(req.result);
            req.onerror = () => reject(req.error);
        });
        return Array.isArray(value) ? value : null;
    } catch (e) {
        console.warn('[成品背包] IndexedDB 读取失败：', e);
        return null;
    }
}

function readRefinedBagLocal() {
    try {
        const raw = localStorage.getItem(REFINED_BAG_KEY);
        if (!raw) return null;
        const arr = JSON.parse(raw);
        return Array.isArray(arr) ? arr : null;
    } catch (e) {
        return null;
    }
}

function normalizeRefinedBag(list) {
    return (list || []).map(e => ({ ...e, note: typeof e.note === 'string' ? e.note : '' }));
}

/** 恢复成品背包：优先 IndexedDB，其次 localStorage（旧数据自动迁移过去） */
async function loadRefinedBag() {
    let list = await idbLoadRefinedBag();
    if (!list) {
        list = readRefinedBagLocal();
        if (list && list.length) {
            refinedBag = normalizeRefinedBag(list);
            idbSaveRefinedBag();   // 迁移到 IndexedDB
            return refinedBag;
        }
    }
    refinedBag = list ? normalizeRefinedBag(list) : [];
    return refinedBag;
}

/** 保存成品背包：localStorage 同步写（即时），IndexedDB 异步写（大容量兜底） */
function saveRefinedBag() {
    let localOk = false;
    try {
        localStorage.setItem(REFINED_BAG_KEY, JSON.stringify(refinedBag));
        localOk = true;
    } catch (e) {
        console.error('[成品背包] localStorage 写入失败：', e);
    }
    // IndexedDB 合并写入，避免备注连续输入时频繁开事务
    clearTimeout(refinedBagIdbTimer);
    refinedBagIdbTimer = setTimeout(() => {
        idbSaveRefinedBag().then(idbOk => {
            if (!localOk && !idbOk && !refinedBagSaveWarned) {
                refinedBagSaveWarned = true;
                alert('成品背包保存失败：浏览器本地存储不可用或空间已满。\n本次改动刷新后可能丢失，请先「导出 txt」备份。');
            }
            if (localOk || idbOk) refinedBagSaveWarned = false;
        });
    }, 150);
    return localOk;
}

/** 导出 txt：每件 4 行（备注非空时追加 1 行），装备间用虚线分隔 */
function exportRefinedBagTxt() {
    try {
        if (!refinedBag.length) { alert('成品背包为空，没有可导出的装备。'); return; }
        const lines = [];
        const sep = '- - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - -';
        refinedBag.forEach((e, i) => {
            if (i > 0) {
                lines.push('');   // 装备之间上方空行
                lines.push(sep);  // 虚线分隔
                lines.push('');   // 装备之间下方空行
            }
            let head = e.npcPlace ? `${e.title}（${e.npcPlace}）` : e.title;
            if (e.regionText) head += ` ${e.regionText}`;
            lines.push(head);
            lines.push(`最终附加：${e.extText}`);
            lines.push(`消耗 ${e.costText}`);
            lines.push(e.mjText);
            const note = String(e.note || '').trim();
            if (note) lines.push(`备注：${note}`);   // 备注为空则不输出
        });
        const d = new Date();
        const p = v => String(v).padStart(2, '0');
        const stamp = `${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}-${p(d.getHours())}${p(d.getMinutes())}`;
        // 文件名：角色名 + 成品背包 + 时间戳。角色名取当前存档主角；拿不到时退回不带前缀
        const roleName = String(document.getElementById('archiveMainRole')?.textContent || '').trim();
        const prefix = roleName && roleName !== '—' ? `${roleName}_` : '';
        const filename = `${prefix}成品背包_${stamp}.txt`;
        const text = lines.join('\n');
        console.log('[导出成品背包] filename=', filename, 'bytes=', text.length, 'lines=', lines.length);
        equipDownloadFile(filename, text);
        console.log('[导出成品背包] 调用完毕');
    } catch (e) {
        console.error('[导出成品背包] 失败:', e);
        alert('导出失败：' + (e?.message || String(e)));
    }
}

/** 从芒晶序列结果里提取「最高那次」摘要（供成品背包记录） */
function buildMangjingSummary(result, material, count, equipKey) {
    const items = Array.isArray(result) ? result : (Array.isArray(result?.items) ? result.items : []);
    if (!items.length) return null;
    let best = items[0];
    for (const it of items) {
        if (Number(it.value) > Number(best.value)) best = it;
    }
    return {
        materialId: material?.id,
        materialName: material?.name || String(material?.id || ''),
        prop: best.prop,
        value: best.value,
        index: Number(best.index),
        count: items.length || count,
        equipKey: equipKey || null,   // 记下是对哪件装备算的，供「加入成品背包」核对
    };
}

/** 精炼页「芒晶序列」：只读预测 N 次芒晶洗练，不推进 MJSeed */
function doXilianMangjing() {
    if (!saveLoaded) { alert('请先导入存档'); return; }
    const panel = document.getElementById('xilianMangjingPanel');
    const box = document.getElementById('xilianMangjingResult');
    if (!box) return;
    const equipKey = document.getElementById('xilianEquipSelect')?.value || '';
    const equip = saveEquips.find(item => runtimeKey(item) === equipKey);
    if (!equip) { alert('请选择要模拟芒晶洗练的装备'); return; }
    const materialId = document.getElementById('xilianMangjingMaterial')?.value || '';
    const material = EQUIP_DATA.special[String(materialId)];
    if (!material) { alert('请选择芒晶材料（下拉为空说明该装备无适用材料）'); return; }
    const count = Number(document.getElementById('xilianMangjingCount')?.value) || 30;
    try {
        if (!Number.isSafeInteger(count) || count < 1 || count > PREVIEW_MAX) {
            throw new RangeError(`预测次数必须是 1–${PREVIEW_MAX} 的整数`);
        }
        const result = runSpecialAttachPredict(equip, material, count);
        lastMangjingResult = buildMangjingSummary(result, material, count, equipKey);
        renderXilianMangjing(result, material, equip);
        if (panel) panel.hidden = false;
    } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        box.classList.add('empty');
        box.textContent = `芒晶序列预测失败：${message}`;
        if (panel) panel.hidden = false;
    }
}

function doMakeOnce() {
    if (!saveLoaded) { alert('请先导入存档'); return; }
    const req = requireCurrentMakeRequest();
    if (!req) return;
    const r = wasmMakeOnce(req);
    if (r.error) { alert(r.error); return; }
    r.index = 1;
    const mark = getDefaultMakeMark();
    const crafted = addCraftedFromMakeResult(r, mark, req.select_id, req.npc_id);
    setMakeAdvanceNotice(r, crafted, 1);
    const markTip = crafted?._mark ? ` · 标记「${crafted._mark}」` : '';
    const bagTip = crafted
        ? ` · 已入模拟背包(#${crafted.only_id})${markTip}`
        : '';
    appendLog(`[打造] ${r.name} · ${COLOR_NAMES[r.color] || r.color} · ${r.pity ? '保底' : r.seed_kind}${bagTip} · S=${r.S ?? r.s ?? '?'} · CZSeed=${r.CZSeed ?? r.cz_seed ?? '?'}`);
    fillEquipSelects();
    updateMakeHints();
    doMakePreview();
}

function doMakeAdvanceTo(targetIndex, mark) {
    if (!saveLoaded) { alert('请先导入存档'); return; }
    const req = requireCurrentMakeRequest();
    if (!req) return;
    const n = Math.floor(Number(targetIndex));
    if (!(n >= 1 && n <= PREVIEW_MAX)) {
        alert(`目标序号无效（1–${PREVIEW_MAX}）`);
        return;
    }
    let last = null;
    for (let i = 1; i <= n; i++) {
        const r = wasmMakeOnce(req);
        if (r.error) {
            alert(`推进至第 ${i} 次失败：${r.error}`);
            updateMakeHints();
            return;
        }
        r.index = i;
        last = r;
    }
    const crafted = addCraftedFromMakeResult(last, mark != null ? mark : getDefaultMakeMark(), req.select_id, req.npc_id);
    setMakeAdvanceNotice(last, crafted, n);
    const markTip = crafted?._mark ? ` · 标记「${crafted._mark}」` : '';
    appendLog(`[打造·推进到#${n}] ${last.name} · ${COLOR_NAMES[last.color] || last.color} · ${last.pity ? '保底' : last.seed_kind} · 入包#${crafted?.only_id || '?'}${markTip}`);
    fillEquipSelects();
    updateMakeHints();
    doMakePreview();
}

/* ── 一键推进（勾选批量） ───────────────────────────────── */
/** 收集当前页勾选的行 → [{idx, mark}]，mark 未填时兜底为「紫 23」这种「品质+序号」 */
function collectMakeCheckedTargets() {
    const checked = Array.from(document.querySelectorAll('#previewBody .make-row-check:checked'));
    return checked.map(cb => {
        const tr = cb.closest('tr');
        const idx = Number(cb.dataset.index);
        const rawColor = Number(cb.dataset.color);
        const colorName = COLOR_NAMES[rawColor] || String(rawColor || '');
        const userMark = (tr?.querySelector('.make-row-mark')?.value || '').trim();
        return { idx, mark: userMark || `${colorName} ${idx}`, colorName, userMark };
    })
        .filter(t => Number.isFinite(t.idx) && t.idx >= 1)
        .sort((a, b) => a.idx - b.idx);
}

/** 从标记文本里取开头的品质名（如「紫 31」→ 紫；「备选5」→ 空） */
function markColorName(mark) {
    const m = /^(白|绿|蓝|紫|橙|红)/.exec(String(mark || '').trim());
    return m ? m[1] : '';
}

/** 标记输入框实时校验：标记里的品质名 ≠ 行的实际品质 → 红框警告 */
function flagMarkMismatch(input) {
    const tr = input?.closest('tr');
    if (!tr) return;
    const cb = tr.querySelector('.make-row-check');
    const rawColor = Number(cb?.dataset.color);
    const colorName = COLOR_NAMES[rawColor] || '';
    const name = markColorName(input.value);
    const bad = !!(name && colorName && name !== colorName);
    input.classList.toggle('is-mismatch', bad);
    input.title = bad ? `标记写的是「${name}」，但这件实际是「${colorName}」` : '';
}

/** 刷新「一键推进勾选 N 件」按钮文案与可用状态 */
function updateMakeBatchButton() {
    const btn = document.getElementById('btnMakeBatchAdvance');
    if (!btn) return;
    const n = document.querySelectorAll('#previewBody .make-row-check:checked').length;
    const total = document.querySelectorAll('#previewBody .make-row-check').length;
    btn.textContent = n ? `一键推进勾选 ${n} 件` : '一键推进勾选';
    btn.disabled = n === 0;
    btn.classList.toggle('btn-batch-armed', n > 0);
    // 全选复选框三态：全勾=勾，部分勾=半勾（indeterminate），全不勾=不勾
    const all = document.getElementById('makeCheckAll');
    if (all) {
        all.checked = total > 0 && n === total;
        all.indeterminate = n > 0 && n < total;
        all.disabled = total === 0;
    }
}

/** 一键推进：把当前页勾选的行按序号升序串行推进到模拟背包 */
async function batchAdvanceChecked() {
    if (!saveLoaded) { alert('请先导入存档'); return; }
    const targets = collectMakeCheckedTargets();
    if (!targets.length) { alert('请先勾选要推进的装备（仅当前页可见行）。'); return; }

    // ① 校验：标记里的品质名是否跟装备实际品质一致（如标记「紫 14」但实际是蓝）
    const bad = targets.filter(t => {
        const name = markColorName(t.mark);
        return name && name !== t.colorName;
    });
    if (bad.length) {
        const list = bad.slice(0, 15)
            .map(t => `· #${t.idx}　标记「${t.mark}」　实际 ${t.colorName}`)
            .join('\n');
        const more = bad.length > 15 ? `\n…等共 ${bad.length} 件` : '';
        if (confirm(
            `⚠ 检测到 ${bad.length} 件的「标记」与装备实际品质不一致：\n${list}${more}\n\n`
            + `【确定】= 自动把标记改成实际品质（如「紫 14」→「蓝 14」）后推进\n`
            + `【取消】= 保留你填的原标记继续推进`
        )) {
            for (const t of bad) t.mark = `${t.colorName} ${t.idx}`;
        }
    }

    const totalSteps = targets.reduce((s, t) => s + t.idx, 0);
    const summary = targets.map(t => `· #${t.idx}　${t.mark}`).join('\n');
    if (!confirm(
        `将批量推进 ${targets.length} 件到模拟背包：\n${summary}\n\n`
        + `每件都从「当前存档种子状态」独立起跑，入包的正是本表对应的那件\n`
        + `（wasm 状态不会累积，与手动逐个点「推进到此」不同）`
    )) return;

    // ② 推进前快照 wasm 种子状态；每件推进前恢复，保证第 2 件起仍是本表预测的那件
    let snapshot = null;
    try { snapshot = JSON.parse(JSON.stringify(wasmMakeGetState() || null)); } catch { snapshot = null; }

    for (let i = 0; i < targets.length; i++) {
        if (!saveLoaded) { alert('存档状态已丢失，批量推进中止。'); return; }
        const t = targets[i];
        if (snapshot) {
            try { wasmMakeSetState(snapshot); } catch { /* 恢复失败则沿用当前状态 */ }
        }
        doMakeAdvanceTo(t.idx, t.mark);
        if (i < targets.length - 1) await new Promise(r => setTimeout(r, 30));   // 让 UI 重绘
    }
}

function doShengLianAll() {
    if (!saveLoaded) { alert('请先导入存档'); return; }

    // 范围：当前来源下所有可升炼装备（忽略文本筛选）
    const source = getSourceFilter('shenglian');
    const isCrafted  = source === 'crafted';
    const isEquipped = source === 'equipped';
    const isUnequipped = source === 'unequipped';
    const targets = saveEquips.filter(e => {
        if (!canShengLian(e)) return false;
        if (isCrafted  && !e._crafted)  return false;
        if (isEquipped && !e._equipped) return false;
        if (isUnequipped && (e._equipped || e._crafted)) return false;
        // 与列表口径一致：真实装备只升炼蓝紫
        if (!isCrafted && !e._crafted && e.color !== 3 && e.color !== 4) return false;
        return true;
    });
    if (!targets.length) { alert('当前来源下没有可升炼装备'); return; }

    let firstUpgraded = null;
    let success = 0, fail = 0;
    for (const eq of targets) {
        const result = applyShengLian(runtimeKey(eq));
        if (result.error) { fail++; continue; }
        success++;
        const markTip = result.equip?._mark ? ` · 标记「${result.equip._mark}」` : '';
        appendLog(`[升炼] ${result.from} → ${result.to}${markTip}`);
        if (!firstUpgraded) firstUpgraded = result.equip;
    }

    fillEquipSelects();
    renderCraftedBagList();
    updateShenglianHint();

    // 升炼完成：切到精炼页并预选第一件（不是最后一件）
    if (firstUpgraded && canXilian(firstUpgraded)) {
        switchTab('xilian');
        const xl  = document.getElementById('xilianEquipSelect');
        const src = document.getElementById('xilianSourceFilter');
        if (firstUpgraded._crafted && src) {
            src.value = 'crafted';
            fillEquipSelects(false);
        }
        const nk = runtimeKey(firstUpgraded);
        if (xl && [...xl.options].some(o => o.value === nk)) xl.value = nk;
        // L4338 只改了 xilianEquipSelect 的选中值，但 fillXilianMangjingMaterials 在 switchTab 时
        // 已经用旧值（升炼前的 prev）跑过一次了，必须再调一次才能让芒晶材料下拉跟着新选中刷新
        fillXilianMangjingMaterials();
        clearPreview(`批量升炼完成：成功 ${success} / 失败 ${fail}，已切到精炼页（第一件：${firstUpgraded.name}）`);
    } else {
        clearPreview(`批量升炼完成：成功 ${success} / 失败 ${fail}`);
    }
}

/** 只升炼下拉里当前选中的那一件（与「一键升炼」共用 applyShengLian） */
function doShengLianOne() {
    if (!saveLoaded) { alert('请先导入存档'); return; }
    const key = document.getElementById('shenglianEquipSelect')?.value || '';
    const eq = key ? saveEquips.find(e => runtimeKey(e) === key) : null;
    if (!eq) { alert('请先在上面的「可升炼装备」里选一件'); return; }
    const costTxt = formatCostList(calcShengLianCost(eq));
    if (!confirm(`升炼「${eq.name}」到 100 级？\n消耗：${costTxt}（仅提示，不扣背包）`)) return;

    const result = applyShengLian(key);
    if (result.error) { alert(result.error); return; }

    const markTip = result.equip?._mark ? ` · 标记「${result.equip._mark}」` : '';
    appendLog(`[升炼] ${result.from} → ${result.to}${markTip}`);
    fillEquipSelects();
    renderCraftedBagList();
    updateShenglianHint();
    // 单件升炼不自动跳页，方便接着升下一件
    clearPreview(`已升炼：${result.from} → ${result.to}`);
}

/** 下拉里没有可升炼装备时，把两个升炼按钮禁用掉 */
function updateShenglianButtons() {
    const sel = document.getElementById('shenglianEquipSelect');
    const one = document.getElementById('btnShenglianOne');
    if (one) one.disabled = !(sel && sel.value);
}

function doXilianPreview() {
    if (!saveLoaded) { alert('请先导入存档'); return; }
    const key = document.getElementById('xilianEquipSelect').value;
    const eq = getRuntimeEquip(key);
    if (!eq) { alert('请选择装备'); return; }
    const n = Math.max(1, Math.min(XILIAN_MAX, Number(document.getElementById('xilianCount').value) || 600));
    renderXilianPreview(n);
    updateXilianHint();
}

function doStrongPreview() {
    if (!saveLoaded) { alert('请先导入存档'); return; }
    const key = document.getElementById('strongEquipSelect').value;
    const eq = getRuntimeEquip(key);
    if (!eq) { alert('请选择装备'); return; }
    fillStrongTargetLevels(eq);
    const n = Math.max(5, Math.min(PREVIEW_MAX, Number(document.getElementById('strongCount').value) || 80));
    renderStrongPreview(wasmStrongPreview(toWasmEquip(eq), n), eq);
    updateStrongHint();
}

function clearPreview(msg) {
    const body = document.getElementById('previewBody');
    const meta = document.getElementById('previewMeta');
    const head = document.getElementById('previewHead');
    if (head) head.innerHTML = '';
    if (meta) meta.textContent = '';
    if (body) {
        body.innerHTML = `<tr><td class="empty-row">${escapeHtml(msg || '点击预测查看结果')}</td></tr>`;
    }
    const advice = document.getElementById('strongAdvice');
    if (advice) advice.innerHTML = '';
    const xlFilter = document.getElementById('xilianFilterBar');
    if (xlFilter) xlFilter.hidden = true;
    const makeFilter = document.getElementById('makeFilterBar');
    if (makeFilter) makeFilter.hidden = true;
    xilianPlanItems = [];
    tablePager.makeAllItems = [];
    tablePager.makeItems = [];
    tablePager.jianwangCyclePages = [];
    strongPlanCache = null;
    hidePreviewPager();
}

function resetAll() {
    if (!saveLoaded) { alert('请先导入存档'); return; }
    if (makeRndSnapshot) wasmMakeSetState(makeRndSnapshot);
    saveEquips = JSON.parse(JSON.stringify(saveEquipsSnapshot));
    equipRuntime = JSON.parse(JSON.stringify(equipRuntimeSnapshot));
    jianwangReforgeCounts = { ...jianwangReforgeCountsSnapshot };
    jianwangRedSeed = jianwangRedSeedSnapshot;
    refreshJianwangVirtualFirstSword();
    craftedSeq = 900000000;
    resetXilianSession();
    strongPlanCache = null;
    fillEquipSelects();
    renderCraftedBagList();
    clearMakeAdvanceNotice();
    clearPreview('已重置，请重新点击预测');
    updateMakeHints();
    updateXilianHint();
    updateStrongHint();
    updateShenglianHint();
    updateCraftedBagHint();
    updateJianwangCycleHint();
    appendLog('— 已重置为导入时状态（模拟背包已清空，升炼/精炼/淬炼进度已回滚）—');
}

function doJianwangCyclePreview() {
    if (!saveLoaded) { alert('请先导入存档'); return; }
    const equipKey = document.getElementById('jianwangEquipSelect')?.value || '';
    const base = findEquipByRuntimeKey(equipKey);
    const equip = base ? (getRuntimeEquip(equipKey) || base) : null;
    try {
        if (!equip || !isJianwangSword(equip)) {
            throw new TypeError('请选择剑王阁实物或虛擬劍胚');
        }
        const nextRedSeed = jianwangNextRedSeedForEquip(equip);
        if (!validJianwangRedSeed(nextRedSeed)) {
            throw new TypeError('存档缺少有效 MakeRnd.RedSeeds[5707]');
        }
        const count = Number(document.getElementById('jianwangCycleCount')?.value);
        const routeId = Number(document.getElementById('jianwangCycleRouteSelect')?.value || 0);
        renderJianwangCyclePreview(predictJianwangShatterCycle(
            equip,
            nextRedSeed,
            count,
            currentJianwangRule(),
            routeId || null,
        ));
    } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        clearPreview(`碎剑预览失败：${message}`);
        alert(`碎剑预览失败：${message}`);
    }
}

function doJianwangPreview() {
    if (!saveLoaded) { alert('请先导入存档'); return; }
    const equipKey = document.getElementById('jianwangEquipSelect')?.value || '';
    const action = document.getElementById('jianwangActionSelect')?.value || '';
    const materialId = document.getElementById('jianwangMaterialSelect')?.value || '';
    const base = findEquipByRuntimeKey(equipKey);
    const equip = base ? (getRuntimeEquip(equipKey) || base) : null;
    const material = EQUIP_DATA.special[String(materialId)];
    if (!equip || !action) {
        alert('请选择剑王阁实物或虛擬劍胚');
        return;
    }
    try {
        const count = Number(document.getElementById('jianwangCount')?.value);
        if (!Number.isSafeInteger(count) || count < 1 || count > PREVIEW_MAX) {
            throw new RangeError(`预测次数必须是 1–${PREVIEW_MAX} 的整数`);
        }
        if (action === 'mangjing') {
            if (!canPredictJianwangMangjing(equip)) {
                throw new TypeError('所选100级实物缺少有效 MJSeed 或已铸进特殊词条');
            }
            if (!material) throw new TypeError('请选择游戏中实际铸进的特殊材料');
            renderJianwangPreview(predictSpecialAttachSequence(equip, material, count), 'mangjing');
            return;
        }
        if (action === JIANWANG_SHATTER_90 || action === JIANWANG_SHATTER_100) {
            renderJianwangPreview([predictJianwangShatterRebuild(equip, action, jianwangNextRedSeedForEquip(equip))], 'shatter');
            return;
        }
        const keepIndex = Number(document.getElementById('jianwangKeepSelect')?.value || 0);
        const rows = predictJianwangStateSequence(
            equip,
            action,
            count,
            keepIndex,
            Number(jianwangReforgeCounts[String(Number(equip.id))]) || 0,
        );
        renderJianwangPreview(rows, 'state');
    } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        clearPreview(`剑王阁专武序列预测失败：${message}`);
        alert(`剑王阁专武序列预测失败：${message}`);
    }
}

function doJianwangApplyOnce() {
    if (!saveLoaded) { alert('请先导入存档'); return; }
    const equipKey = document.getElementById('jianwangEquipSelect')?.value || '';
    const action = document.getElementById('jianwangActionSelect')?.value || '';
    const base = findEquipByRuntimeKey(equipKey);
    const equip = base ? (getRuntimeEquip(equipKey) || base) : null;
    if (!equip || !action) { alert('请选择剑王阁实物或虛擬劍胚'); return; }
    if (action === 'mangjing') { alert('芒晶序列只读，不在网页内推进 MJSeed'); return; }
    try {
        if (action === JIANWANG_SHATTER_90 || action === JIANWANG_SHATTER_100) {
            const result = predictJianwangShatterRebuild(equip, action, jianwangNextRedSeedForEquip(equip));
            setRuntimeEquip(equipKey, result.equip);
            jianwangRedSeed = result.redSeedAfter;
            jianwangReforgeCounts[String(result.routeId)] = 0;
            appendLog(`[剑王阁·${result.shatterLabel}] ${result.fromName} → ${result.toName} · RedSeed ${result.redSeedBefore}→${result.redSeedAfter} · 新CZSeed ${result.CZSeed}`);
            fillJianwangEquipSelect(true);
            renderJianwangPreview([result], 'shatter');
            updateJianwangHint();
            updateJianwangCycleHint();
            return;
        }
        const keepIndex = Number(document.getElementById('jianwangKeepSelect')?.value || 0);
        const rows = predictJianwangStateSequence(
            equip,
            action,
            1,
            keepIndex,
            Number(jianwangReforgeCounts[String(Number(equip.id))]) || 0,
        );
        const result = rows[0];
        setRuntimeEquip(equipKey, result.equip);
        if (action === 'reforge') {
            const idKey = String(Number(equip.id));
            jianwangReforgeCounts[idKey] = (Number(jianwangReforgeCounts[idKey]) || 0) + 1;
        }
        appendLog(`[剑王阁·${action === 'reforge' ? '重铸' : (action.startsWith('ascend:') ? '神兵' : '成长')}] ${result.fromName} → ${result.toName} · CZSeed ${result.seedBefore}→${result.seedAfter}`);
        fillJianwangEquipSelect(true);
        renderJianwangPreview(rows, 'state');
        updateJianwangHint();
    } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        alert(`剑王阁专武执行失败：${message}`);
    }
}

async function initApp() {
    // 成品背包先恢复显示：不依赖 wasm / 存档，避免初始化异常导致「看起来丢了」
    loadRefinedBag().then(renderRefinedBag).catch(err => {
        console.error('[成品背包] 恢复失败：', err);
        renderRefinedBag();
    });

    if (typeof markNavTransition === 'function') {
        document.querySelectorAll('header a[href*=".html"]').forEach(a => {
            a.addEventListener('click', () => markNavTransition());
        });
    }

    const ok = await initWasm();
    if (!ok) { alert('WASM 加载失败：装备模拟不可用（存档导入与解密不受影响）'); return; }
    if (!wasmMakeInitTables(EQUIP_DATA)) { alert('装备表注入失败'); return; }

    if (typeof loadShareStore === 'function') {
        const shared = loadShareStore();
        if (shared && shared.data) {
            try {
                saveMeta = {
                    version: (shared.meta && shared.meta.version) || '',
                    platform: (shared.meta && shared.meta.platform) || '',
                    columns: (shared.meta && shared.meta.columns) || null,
                    row: (shared.meta && shared.meta.row) || null,
                };
                loadSaveData(shared.data);
            } catch (e) {
                console.warn('自动加载共享存档失败:', e);
            }
        }
    }

    fillNpcSelect();
    restoreMakeFormState();   // 内部会调用 fillPaperSelect()，并恢复上次的地点 + 图纸
    renderCraftedBagList();

    // 「重置进度」：把模拟打造 / 升炼 / 精炼 / 淬炼 / 剑王阁回滚到刚导入存档时的状态。
    // 注意别和右上角那个「重置网页」（清浏览器存储 + 刷新页面，由 archive_state.js 绑定）搞混。
    document.getElementById('btnResetProgress')?.addEventListener('click', resetAll);

    document.getElementById('tabBar').addEventListener('click', (e) => {
        const btn = e.target.closest('.tab-btn');
        if (btn) switchTab(btn.dataset.tab);
    });

    document.getElementById('npcSelect').addEventListener('change', () => {
        const filter = document.getElementById('paperFilter');
        if (filter) filter.value = '';
        const cat = document.getElementById('paperCategoryFilter')?.value || 'all';
        fillPaperSelectByCategory(cat);
        saveMakeFormState();
        clearPreview('目标已变更，请点击「预测序列」');
    });
    document.getElementById('npcCategoryFilter')?.addEventListener('change', (e) => {
        syncMakeCategory(e.target.value);
        const filter = document.getElementById('paperFilter');
        if (filter) filter.value = '';
        saveMakeFormState();
        clearPreview('目标已变更，请点击「预测序列」');
    });
    document.getElementById('paperCategoryFilter')?.addEventListener('change', (e) => {
        syncMakeCategory(e.target.value);
        const filter = document.getElementById('paperFilter');
        if (filter) filter.value = '';
        saveMakeFormState();
        clearPreview('目标已变更，请点击「预测序列」');
    });
    document.getElementById('paperFilter')?.addEventListener('input', () => {
        const cat = document.getElementById('paperCategoryFilter')?.value || 'all';
        fillPaperSelectByCategory(cat);
        saveMakeFormState();
    });
    document.getElementById('paperSelect').addEventListener('change', () => {
        fillSpecialSelect();
        updateMakeHints();
        saveMakeFormState();
        clearPreview('目标已变更，请点击「预测序列」');
    });
    document.getElementById('specialSelect').addEventListener('change', () => {
        updateMakeHints();
        clearPreview('材料已变更，请点击「预测序列」');
    });
    document.getElementById('specialAttachEquipSelect')?.addEventListener('change', () => {
        fillSpecialAttachMaterialSelect(false);
        updateSpecialAttachHint();
        clearPreview('目标装备已变更，请点击「预测连续附加」');
    });
    document.getElementById('specialAttachMaterialSelect')?.addEventListener('change', () => {
        updateSpecialAttachHint();
        clearPreview('附加材料已变更，请点击「预测连续附加」');
    });
    document.getElementById('btnJianwangCyclePreview')?.addEventListener('click', doJianwangCyclePreview);
    document.getElementById('jianwangCycleCount')?.addEventListener('change', () => {
        clearPreview('循环次数已变更，请重新进行碎剑预览');
    });
    document.getElementById('jianwangCycleRouteSelect')?.addEventListener('change', () => {
        updateJianwangCycleHint();
        clearPreview('90级路线已变更，请重新进行碎剑预览');
    });
    document.getElementById('jianwangEquipSelect')?.addEventListener('change', () => {
        fillJianwangActionSelect(false);
        fillJianwangCycleRouteSelect(false);
        updateJianwangHint();
        updateJianwangCycleHint();
        clearPreview('剑王阁起点已变更，请点击「预览当前流程」');
    });
    document.getElementById('jianwangActionSelect')?.addEventListener('change', () => {
        fillJianwangKeepSelect(false);
        fillJianwangMaterialSelect(false);
        updateJianwangControls();
        updateJianwangHint();
        clearPreview('流程已变更，请点击「预览当前流程」');
    });
    document.getElementById('jianwangKeepSelect')?.addEventListener('change', () => {
        updateJianwangHint();
        clearPreview('保留槽位已变更，请重新预览');
    });
    document.getElementById('jianwangMaterialSelect')?.addEventListener('change', () => {
        updateJianwangHint();
        clearPreview('铸进材料已变更，请点击「查看专武序列」');
    });
    document.getElementById('xilianEquipSelect').addEventListener('change', () => {
        resetXilianSession();
        updateXilianHint();
        fillXilianMangjingMaterials();
        document.getElementById('xilianMangjingPanel').hidden = true;
        clearPreview('装备已变更，请点击「预测序列」');
    });
    document.getElementById('btnXilianMangjing')?.addEventListener('click', doXilianMangjing);
    document.getElementById('btnAddRefinedToBag')?.addEventListener('click', addRefinedToBag);
    document.getElementById('btnExportRefinedBag')?.addEventListener('click', exportRefinedBagTxt);
    document.getElementById('refinedBagList')?.addEventListener('click', (e) => {
        const btn = e.target.closest('.refined-bag-del');
        if (!btn) return;
        const id = btn.dataset.id;
        refinedBag = refinedBag.filter(x => x.id !== id);
        saveRefinedBag();
        renderRefinedBag();
    });
    // 成品背包：数字失焦保存；备注实时保存并更新字数
    document.getElementById('refinedBagList')?.addEventListener('change', (e) => {
        const input = e.target.closest('.rb-num');
        if (input) onRefinedBagNumberChange(input);
    });
    document.getElementById('refinedBagList')?.addEventListener('keydown', (e) => {
        if (e.key === 'Enter' && e.target.closest('.rb-num, .rb-note')) {
            e.preventDefault();
            e.target.blur();
        }
    });
    // 聚焦数字时自动全选，直接输入即可覆盖
    document.getElementById('refinedBagList')?.addEventListener('focusin', (e) => {
        const numEl = e.target.closest('.rb-num');
        if (!numEl) return;
        requestAnimationFrame(() => { if (document.activeElement === numEl) numEl.select(); });
    });
    document.getElementById('refinedBagList')?.addEventListener('input', (e) => {
        // 数字输入时同步宽度，避免长数字被截断
        const numEl = e.target.closest('.rb-num');
        if (numEl) { numEl.size = Math.max(2, numEl.value.length); return; }
        const noteEl = e.target.closest('.rb-note');
        if (!noteEl) return;
        const card = noteEl.closest('.refined-bag-card');
        const rec = refinedBag.find(x => x.id === card?.dataset.id);
        if (!rec) return;
        rec.note = noteEl.value.slice(0, 100);
        const counter = card.querySelector('.rb-note-count');
        if (counter) counter.textContent = `${rec.note.length}/100`;
        saveRefinedBag();
    });
    document.getElementById('strongEquipSelect').addEventListener('change', () => {
        strongPlanCache = null;
        updateStrongHint();
        clearPreview('装备已变更，请点击「预测并生成建议」');
    });
    document.getElementById('shenglianEquipSelect')?.addEventListener('change', () => {
        updateShenglianHint();
    });
    const onEquipFilterChange = () => fillEquipSelects(true);
    document.getElementById('xilianSourceFilter')?.addEventListener('change', onEquipFilterChange);
    document.getElementById('strongSourceFilter')?.addEventListener('change', onEquipFilterChange);
    document.getElementById('shenglianSourceFilter')?.addEventListener('change', onEquipFilterChange);
    document.getElementById('xilianTextFilter')?.addEventListener('input', onEquipFilterChange);
    document.getElementById('strongTextFilter')?.addEventListener('input', onEquipFilterChange);
    document.getElementById('shenglianTextFilter')?.addEventListener('input', onEquipFilterChange);
    document.getElementById('strongMinGrade')?.addEventListener('change', () => {
        clearPreview('条件已变更，请重新点击「预测并生成建议」');
        updateStrongHint();
    });
    document.getElementById('strongTargetLevel')?.addEventListener('change', () => {
        clearPreview('期望层数已变更，请重新点击「预测并生成建议」');
        updateStrongHint();
    });

    document.getElementById('btnPreview').addEventListener('click', doMakePreview);
    document.getElementById('btnSpecialAttachPreview')?.addEventListener('click', doSpecialAttachPreview);
    document.getElementById('btnJianwangPreview')?.addEventListener('click', doJianwangPreview);
    document.getElementById('btnJianwangApply')?.addEventListener('click', doJianwangApplyOnce);
    document.getElementById('btnMakeOnce').addEventListener('click', doMakeOnce);

    document.getElementById('previewBody')?.addEventListener('click', (e) => {
        const btn = e.target.closest('.btn-make-advance');
        if (!btn || tablePager.mode !== 'make') return;
        const idx = Number(btn.dataset.index);
        const row = btn.closest('tr');
        const mark = row?.querySelector('.make-row-mark')?.value ?? getDefaultMakeMark();
        if (!confirm(`将连续推进 ${idx} 次，并把第 ${idx} 件加入模拟背包？\n（中间结果只推进种子，不入包）`)) return;
        doMakeAdvanceTo(idx, mark);
    });

    // 勾选框变化 → 刷新「一键推进勾选 N 件」按钮
    document.getElementById('previewBody')?.addEventListener('change', (e) => {
        if (e.target.classList?.contains('make-row-check')) updateMakeBatchButton();
        if (e.target.classList?.contains('make-row-mark')) flagMarkMismatch(e.target);
    });
    // 输入标记时实时校验品质是否一致
    document.getElementById('previewBody')?.addEventListener('input', (e) => {
        if (e.target.classList?.contains('make-row-mark')) flagMarkMismatch(e.target);
    });

    // 全选当前页
    document.getElementById('makeCheckAll')?.addEventListener('change', (e) => {
        const on = e.target.checked;
        document.querySelectorAll('#previewBody .make-row-check').forEach(cb => { cb.checked = on; });
        updateMakeBatchButton();
    });

    // 一键推进勾选
    document.getElementById('btnMakeBatchAdvance')?.addEventListener('click', () => { batchAdvanceChecked(); });

    document.getElementById('craftedBagList')?.addEventListener('change', (e) => {
        const input = e.target.closest('.crafted-mark-input');
        if (!input) return;
        const row = input.closest('[data-only-id]');
        const onlyId = Number(row?.dataset.onlyId);
        if (onlyId) setCraftedMark(onlyId, input.value);
    });
    document.getElementById('craftedBagList')?.addEventListener('click', (e) => {
        const btn = e.target.closest('[data-act="remove"]');
        if (!btn) return;
        const row = btn.closest('[data-only-id]');
        const onlyId = Number(row?.dataset.onlyId);
        if (!onlyId) return;
        if (!confirm('从模拟背包移除该打造装备？')) return;
        removeCraftedEquip(onlyId);
    });
    document.getElementById('btnShenglianOne')?.addEventListener('click', doShengLianOne);
    document.getElementById('btnShenglianOnce')?.addEventListener('click', doShengLianAll);
    document.getElementById('btnXilianPreview').addEventListener('click', doXilianPreview);
    document.getElementById('btnStrongPreview').addEventListener('click', doStrongPreview);
    document.getElementById('btnStrongShowMin')?.addEventListener('click', () => highlightStrongPlan('min'));
    document.getElementById('btnStrongShowBest')?.addEventListener('click', () => highlightStrongPlan('best'));
    document.getElementById('xilianFilterSlot')?.addEventListener('change', () => {
        if (xilianPlanItems.length) renderXilianRows(xilianPlanItems, xilianAcceptFlags, true);
    });
    document.getElementById('xilianFilterProp')?.addEventListener('change', () => {
        if (xilianPlanItems.length) renderXilianRows(xilianPlanItems, xilianAcceptFlags, true);
    });
    const onMakeFilterChange = () => {
        if ((tablePager.makeAllItems || []).length) applyMakeFilter(true);
    };
    document.getElementById('makeFilterColor')?.addEventListener('change', onMakeFilterChange);
    document.getElementById('makeFilterSeed')?.addEventListener('change', onMakeFilterChange);
    document.getElementById('makeFilterProp')?.addEventListener('change', onMakeFilterChange);
    document.getElementById('makeFilterMangjing')?.addEventListener('input', onMakeFilterChange);
    // 改盲晶次数 → 只对已预测结果重算盲晶，不用重跑打造预测
    document.getElementById('mangjingCount')?.addEventListener('change', () => {
        if (tablePager.mode !== 'make' || !tablePager.makeAllItems?.length) return;
        computeMangjingForItems(
            tablePager.makeAllItems,
            Number(document.getElementById('mangjingCount').value) || MANGJING_DEFAULT,
        );
        applyMakeFilter(false);
    });
    document.getElementById('btnPreviewPrev')?.addEventListener('click', () => {
        if (tablePager.page > 1) {
            tablePager.page -= 1;
            renderCurrentPreviewPage();
        }
    });
    document.getElementById('btnPreviewNext')?.addEventListener('click', () => {
        tablePager.page += 1;
        renderCurrentPreviewPage();
    });
    document.getElementById('previewPageSize')?.addEventListener('change', () => {
        tablePager.page = 1;
        renderCurrentPreviewPage();
    });
    document.getElementById('btnLogPrev')?.addEventListener('click', () => {
        if (logPage > 1) {
            logPage -= 1;
            renderLogPage();
        }
    });
    document.getElementById('btnLogNext')?.addEventListener('click', () => {
        logPage += 1;
        renderLogPage();
    });
    document.getElementById('btnClearLog').addEventListener('click', () => {
        logLines = [];
        logPage = 1;
        renderLogPage();
    });
}

document.addEventListener('DOMContentLoaded', initApp);
setTimeout(function () { if (typeof prewarmSql === 'function') prewarmSql(); }, 200);
