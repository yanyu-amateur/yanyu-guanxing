const COLOR_NAMES = (typeof EQUIP_DATA !== 'undefined' && EQUIP_DATA.colorNames) || {
    1: '白', 2: '绿', 3: '蓝', 4: '紫', 5: '橙', 6: '红',
};
const TYPE_NAMES = (typeof EQUIP_DATA !== 'undefined' && EQUIP_DATA.typeNames) || {
    1: '拳套', 2: '刀', 3: '剑', 4: '枪棍', 5: '腰带', 6: '护腕', 7: '内甲', 8: '戒指', 9: '挂坠',
    10: '时装', 11: '头饰', 12: '配饰',
};
const NJGQ_PROP_LEVEL = 93;
const INIT_MPBACK = 2;
const PROP_NAMES = (typeof EQUIP_DATA !== 'undefined' && EQUIP_DATA.propNames) || {};
const PZ_NAMES = { 1: '白', 2: '绿', 3: '蓝', 4: '紫' };
const SEX_NAMES = { 1: '男', 2: '女' };

const MENPAI_NAMES = {
    0: '无门派',
};

const GIFT_COEF = 0.00006;

let saveData = null;
let saveRoles = [];
let currentKey = '';

function escapeHtml(s) {
    return String(s).replace(/[&<>"']/g, c => ({
        '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
    })[c]);
}

function asRoleList(value) {
    if (!value) return [];
    if (Array.isArray(value)) return value;
    if (typeof value === 'object') return Object.values(value);
    return [];
}

function collectSaveRoles(data) {
    const out = [];
    const seen = new Set();
    function push(tag, role, prefix) {
        if (!role || typeof role !== 'object' || role.ID == null) return;
        const key = `${prefix}:${role.ID}`;
        if (seen.has(key)) return;
        seen.add(key);
        out.push({ key, tag, role });
    }
    push('主角', data.MainRole, 'main');
    asRoleList(data.Roles).forEach(r => push('随从', r, 'role'));
    asRoleList(data.Leavers).forEach(r => push('离队', r, 'leave'));
    return out;
}

function num(v, d = 0) {
    const n = Number(v);
    return Number.isFinite(n) ? n : d;
}

function adjustPoint(role, allocated, yiChu) {
    const limit = num(role.Level) + num(yiChu);
    const a = num(allocated);
    if (limit < a) {
        const excess = a - limit;
        return limit + (1 - 1.2 * excess / (100 + excess)) * excess;
    }
    return a;
}

function yiChuTotal(role, key, hedaoEffects) {
    const cap = key.charAt(0).toUpperCase() + key.slice(1);
    let y = num(role[`YiChu${cap}`]);
    const limitKey = `${key}_limit`;
    for (const e of hedaoEffects || []) {
        if (e.key === limitKey) y += num(e.value);
    }
    return y;
}

function baseAttr(role, key, extraOther = 0, useAdjust = true, yiChu) {
    const cap = key.charAt(0).toUpperCase() + key.slice(1);
    const allocated = num(role[cap]);
    const yi = yiChu != null ? num(yiChu) : num(role[`YiChu${cap}`]);
    const raw = useAdjust ? adjustPoint(role, allocated, yi) : allocated;
    const born = num(role[`Born${cap}`]);
    const gift = num(role[`${cap}Gift`]);
    return Math.floor((raw + born + num(extraOther)) * (1 + GIFT_COEF * gift));
}

function resolveNeiProp(neiSkill, cfgProp) {
    const p = num(cfgProp);
    if (p === 4) {
        const sp = neiSkill && neiSkill.SpecialProp;
        return sp != null && sp !== '' ? num(sp) : 3;
    }
    return p || 3;
}

function propLabel(key) {
    return PROP_NAMES[key] || key;
}

const PCT_PROPS = new Set([
    'blood', 'dmg_off', 'def_ign', 'atk_extend', 'xx_prob', 'xx_crit',
    'sword_add', 'blade_add', 'stick_add', 'unarmed_add',
    'po_parry', 'po_dodge', 'dmg_ref',
]);

function formatPropValue(prop, v) {
    if (typeof v !== 'number') return String(v);
    const asPct = PCT_PROPS.has(prop) || (Math.abs(v) > 0 && Math.abs(v) < 1);
    if (!asPct) return String(Math.floor(v * 1000 + 0.001) / 1000);
    if (Math.abs(v) < 0.1) {
        const n = Math.floor(v * 1000 + 0.001) / 10;
        return `${n}%`;
    }
    return `${Math.floor(v * 100 + 0.001)}%`;
}

function asPropList(raw) {
    if (!raw) return [];
    if (Array.isArray(raw)) return raw.filter(Boolean);
    if (typeof raw === 'object') {
        return Object.values(raw).filter(v => v && typeof v === 'object');
    }
    return [];
}

function collectEquipProps(eq) {
    const out = [];
    for (const list of [eq.EnMans, eq.EnExts, eq.EnSpecials, eq.exts]) {
        for (const e of asPropList(list)) {
            const prop = e.Key || e.prop || e.key;
            const value = e.Value != null ? e.Value : e.value;
            if (prop != null && value != null && !Number.isNaN(Number(value))) {
                out.push({ prop: String(prop), value: Number(value), source: 'ext' });
            }
        }
    }
    for (const s of asPropList(eq.EnStroys)) {
        if (typeof s.Buff === 'string' && s.Buff) {
            out.push({ prop: s.Buff, value: Number(s.Type || 0), source: 'story' });
        }
    }
    return out;
}

function kongfuData() {
    return typeof KONGFU_DATA !== 'undefined' ? KONGFU_DATA : null;
}

function kongfuRate(grade, chong, level) {
    const kd = kongfuData();
    if (!kd) return 0;
    const idx = (num(chong, 1) - 1) * 4 + num(level) + 1;
    const row = kd.rate[String(idx)];
    if (!row) return 0;
    const g = Math.min(5, Math.max(1, num(grade, 1)));
    return Math.min(num(row[`kf_${g}`]), 1);
}

function scaledKongfuStat(base, grade, chong, level) {
    const b = num(base);
    if (!(b > 0)) return 0;
    return Math.floor(b * kongfuRate(grade, chong, level));
}

function findActiveSkill(list) {
    if (!Array.isArray(list)) return null;
    return list.find(x => x && x.Active) || null;
}

function collectJingmaiProps(role) {
    const kd = kongfuData();
    if (!kd) return [];
    const maxXue = kd.jmIndexCount || 10;
    const out = [];
    for (const jm of asPropList(role.JingMais)) {
        const cfg = kd.jingmai[String(jm.ID)];
        if (!cfg) continue;
        const progress = Math.min(Math.max(num(jm.Index) - 1, 0), maxXue) / maxXue;
        if (cfg.z_xue1) out.push({ key: cfg.z_xue1[0], value: cfg.z_xue1[1] * progress });
        if (cfg.z_xue2) out.push({ key: cfg.z_xue2[0], value: cfg.z_xue2[1] * progress });
        if (num(jm.Index) > maxXue) {
            const fin = num(jm.Order) > 0 ? cfg.z_jm : cfg.n_jm;
            if (fin) out.push({ key: fin[0], value: fin[1] });
        }
    }
    return out;
}

function sumKeyProps(props, key) {
    let s = 0;
    for (const p of props) {
        if (p.key === key) s += num(p.value);
    }
    return s;
}

function skillWxxw(cfg, skill) {
    if (!cfg || !(cfg.wxxw > 0)) return 0;
    return Math.floor(cfg.wxxw * kongfuRate(cfg.grade, skill.Chong, skill.Level));
}

function getWXXW(role, kind) {
    const kd = kongfuData();
    let s = num(role[`WXXW${kind}`]);
    if (!kd) return Math.min(s, 1500);
    if (kind === 'ng') {
        for (const n of Array.isArray(role.Neis) ? role.Neis : []) {
            s += skillWxxw(kd.nei[String(n.ID)], n);
        }
    } else if (kind === 'qg') {
        for (const q of Array.isArray(role.Qings) ? role.Qings : []) {
            const cfg = kd.qing ? kd.qing[String(q.ID)] : null;
            s += skillWxxw(cfg, q);
        }
    } else {
        for (const t of Array.isArray(role.Taolus) ? role.Taolus : []) {
            const cfg = kd.taolu[String(t.ID)];
            if (cfg && cfg.type === kind) s += skillWxxw(cfg, t);
        }
    }
    return Math.min(s, 1500);
}

function getXWAdd(role, kind) {
    const giftMap = {
        1: 'QuanGift', 2: 'DaoGift', 3: 'JianGift', 4: 'GunGift',
        ng: 'NGGift', qg: 'QGGift',
    };
    const gift = num(role[giftMap[kind]], 1);
    return getWXXW(role, kind) * 0.025 * gift;
}

function activeNeiStats(role) {
    const kd = kongfuData();
    const nei = findActiveSkill(role.Neis);
    if (!kd || !nei) return { hp: 0, rawHp: 0, name: '', id: 0, prop: 0, classId: 0 };
    const cfg = kd.nei[String(nei.ID)];
    if (!cfg) return { hp: 0, rawHp: 0, name: `内功#${nei.ID}`, id: num(nei.ID), prop: 0, classId: 0 };
    let hp = scaledKongfuStat(cfg.hp, cfg.grade, nei.Chong, nei.Level);
    const classId = num(cfg.class);
    if (classId && classId !== num(role.MenPai)) hp = Math.floor(hp * 0.8);
    return {
        id: cfg.id,
        name: cfg.name,
        hp,
        rawHp: hp,
        prop: resolveNeiProp(nei, cfg.prop),
        classId,
    };
}

function collectTypeAdd(role, equips, typeKey, lifeEntries, talents, dims) {
    if (!typeKey) return 0;
    let s = sumEquipRatioProp(equips, typeKey);
    s += talentSumKey(talents, typeKey);
    for (const entry of lifeEntries) {
        for (const ef of lifeSkillEffects(entry)) {
            if (ef[0] === typeKey) s += Math.floor(entry.level / ef[1]) * ef[2];
        }
    }
    const ed = extraAttrData();
    const nei = findActiveSkill(role.Neis);
    if (ed && nei) {
        const chong = num(nei.Chong, 1);
        for (const z of Array.isArray(nei.Zhaos) ? nei.Zhaos : []) {
            const cfg = ed.zhao[String(z.ID)];
            if (!cfg || chong < cfg.layer_rel || cfg.req2 || cfg.zs_beidong) continue;
            const raw = cfg.props && cfg.props[typeKey];
            if (raw == null) continue;
            s += typeof raw === 'number' ? raw : convertZhaoValue(raw, dims);
        }
    }
    return s;
}

function activeQingStats(role) {
    const kd = kongfuData();
    const qg = findActiveSkill(role.Qings);
    if (!kd || !qg || !kd.qing) {
        return { dodge: 0, rawDodge: 0, speed: 0, rawSpeed: 0, name: '', id: 0, classId: 0 };
    }
    const cfg = kd.qing[String(qg.ID)];
    if (!cfg) {
        return { dodge: 0, rawDodge: 0, speed: 0, rawSpeed: 0, name: `轻功#${qg.ID}`, id: num(qg.ID), classId: 0 };
    }
    let dodge = scaledKongfuStat(cfg.dodge, cfg.grade, qg.Chong, qg.Level);
    let speed = scaledKongfuStat(cfg.speed, cfg.grade, qg.Chong, qg.Level);
    const classId = num(cfg.class);
    if (classId && classId !== num(role.MenPai)) {
        dodge = Math.floor(dodge * 0.8);
        speed = Math.floor(speed * 0.8);
    }
    return {
        id: cfg.id,
        name: cfg.name,
        classId,
        rawDodge: dodge,
        dodge,
        rawSpeed: speed,
        speed,
    };
}

function activeTaoluStats(role) {
    const kd = kongfuData();
    const tl = findActiveSkill(role.Taolus);
    if (!kd || !tl) {
        return { atk: 0, rawAtk: 0, hit: 0, parry: 0, def: 0, dodge: 0, speed: 0, name: '', id: 0, type: 0, classId: 0 };
    }
    const cfg = kd.taolu[String(tl.ID)];
    if (!cfg) {
        return { atk: 0, rawAtk: 0, hit: 0, parry: 0, def: 0, dodge: 0, speed: 0, name: `套路#${tl.ID}`, id: num(tl.ID), type: 0, classId: 0 };
    }
    let rawAtk = scaledKongfuStat(cfg.atk, cfg.grade, tl.Chong, tl.Level);
    const classId = num(cfg.class);
    if (classId && classId !== num(role.MenPai)) rawAtk = Math.floor(rawAtk * 0.8);
    return {
        id: cfg.id,
        name: cfg.name,
        type: cfg.type,
        classId,
        rawAtk,
        atk: rawAtk,
        hit: scaledKongfuStat(cfg.hit, cfg.grade, tl.Chong, tl.Level),
        parry: scaledKongfuStat(cfg.parry, cfg.grade, tl.Chong, tl.Level),
        def: scaledKongfuStat(cfg.def, cfg.grade, tl.Chong, tl.Level),
        dodge: scaledKongfuStat(cfg.dodge, cfg.grade, tl.Chong, tl.Level),
        speed: scaledKongfuStat(cfg.speed, cfg.grade, tl.Chong, tl.Level),
    };
}

function normalizeExts(raw) {
    return asPropList(raw).map(e => ({
        prop: e.Key || e.prop || e.key,
        value: e.Value != null ? e.Value : e.value,
    })).filter(e => e.prop != null);
}

function menpaiName(id) {
    const n = num(id);
    if (MENPAI_NAMES[n] != null) return MENPAI_NAMES[n];
    return `门派 #${n}`;
}

function zzName(id) {
    const zz = (typeof ZZ_DATA !== 'undefined' && ZZ_DATA[String(id)]) || null;
    return zz ? zz.name : `资质${id}`;
}

function talentLookup(id) {
    const key = String(id);
    if (typeof TALENT_DATA !== 'undefined' && TALENT_DATA[key]) return TALENT_DATA[key];
    if (typeof BORN_TALENT_DATA !== 'undefined' && BORN_TALENT_DATA[key]) return BORN_TALENT_DATA[key];
    return null;
}

function talentInfo(id) {
    const t = talentLookup(id);
    if (!t) return { name: `天赋${id}`, pinzhi: 0, desc: '', born: false, effects: [] };
    return {
        name: t.name || `天赋${id}`,
        pinzhi: t.pinzhi || 0,
        desc: t.desc || '',
        born: !!t.born,
        effects: Array.isArray(t.effects) ? t.effects : [],
    };
}

function equipCfg(id) {
    if (typeof EQUIP_DATA === 'undefined') return {};
    const key = String(id);
    return EQUIP_DATA.equipment[key] || EQUIP_DATA.fashion?.[key] || {};
}

function isFashionType(typ) {
    return typ >= 10 && typ <= 12;
}

function equipCombatStat(eq, baseField, keys) {
    const base = num(eq[baseField]);
    const lvProp = num(eq.LvProp);
    let v = Math.floor(base * (1 + lvProp / 1000));
    for (const p of collectEquipProps(eq)) {
        if (keys.includes(p.prop)) v += num(p.value);
    }
    if (baseField === 'Neijin' || baseField === 'Gangqi') {
    }
    return v;
}

function equipNeijin(eq) {
    let v = num(eq.Neijin) + num(eq.ExtraNeij);
    for (const p of collectEquipProps(eq)) {
        if (p.prop === 'neij' || p.prop === 'neijin') v += num(p.value);
    }
    return v;
}

function equipGangqi(eq) {
    let v = num(eq.Gangqi) + num(eq.ExtraGangqi);
    for (const p of collectEquipProps(eq)) {
        if (p.prop === 'gangqi' || p.prop === 'gq_base') v += num(p.value);
    }
    return v;
}

function sumEquipCombat(equips, baseField, keys) {
    let sum = 0;
    for (const eq of equips || []) sum += equipCombatStat(eq, baseField, keys);
    return sum;
}

function sumEquipRatioProp(equips, key) {
    let sum = 0;
    for (const eq of equips || []) {
        for (const p of collectEquipProps(eq)) {
            if (p.prop === key) sum += num(p.value);
        }
    }
    return sum;
}

function sumEquipFlatProp(equips, key) {
    return sumEquipRatioProp(equips, key);
}

function collectTalentEffects(role) {
    const effects = [];
    const ids = [];
    if (role.BornTalent && role.BornTalent.ID != null) {
        ids.push(num(role.BornTalent.ID));
    }
    for (const t of Array.isArray(role.Talents) ? role.Talents : []) {
        ids.push(num(t.ID != null ? t.ID : t.id));
    }
    for (const id of ids) {
        const td = talentLookup(id);
        if (!td || !Array.isArray(td.effects)) continue;
        for (const row of td.effects) {
            if (Array.isArray(row) && row.length >= 2) {
                effects.push({ key: row[0], value: Number(row[1]) || 0 });
            }
        }
    }
    return effects;
}

function talentModOnSub(effects, key, sub) {
    let add = 0;
    for (const e of effects) {
        if (e.key !== key) continue;
        add += Math.abs(e.value) > 1 ? e.value : Math.floor(sub * e.value);
    }
    return add;
}

function talentSumKey(effects, key) {
    let s = 0;
    for (const e of effects) {
        if (e.key === key) s += e.value;
    }
    return s;
}

function lifeHedaoData() {
    return typeof LIFE_HEDAO_DATA !== 'undefined' ? LIFE_HEDAO_DATA : null;
}

function skillCfg(id) {
    const d = lifeHedaoData();
    return d ? d.skills[String(id)] || null : null;
}

function hedaoCfg(id) {
    const d = lifeHedaoData();
    return d ? d.hedao[String(id)] || null : null;
}

function collectLifeEntries(role, taoluType) {
    const out = [];
    const menpai = num(role.MenPai);
    for (const raw of Array.isArray(role.LifeSkills) ? role.LifeSkills : []) {
        const cfg = skillCfg(raw.ID);
        if (!cfg || cfg.type !== 1) continue;
        out.push({ level: num(raw.Level), cfg, menpai });
    }
    for (const raw of Array.isArray(role.LifeProps) ? role.LifeProps : []) {
        const cfg = skillCfg(raw.ID);
        if (!cfg) continue;
        if (cfg.limit != null && cfg.limit !== taoluType) continue;
        out.push({ level: num(raw.Level), cfg, menpai });
    }
    return out;
}

function lifeSkillEffects(entry) {
    const { cfg, menpai } = entry;
    if (cfg.mp_sk == null || menpai === cfg.mp_sk) return cfg.effects || [];
    if (Array.isArray(cfg.slots) && cfg.slots.length) {
        const out = [];
        for (const slot of cfg.slots) {
            const row = slot.pan || slot.effect;
            if (row) out.push(row);
        }
        return out;
    }
    if (cfg.panEffects && cfg.panEffects.length) return cfg.panEffects;
    return cfg.effects || [];
}

function lifeModOnKey(entries, key, sub, flatDim) {
    let add = 0;
    for (const entry of entries) {
        for (const ef of lifeSkillEffects(entry)) {
            if (ef[0] !== key) continue;
            const steps = Math.floor(entry.level / ef[1]);
            if (flatDim) add += steps * ef[2];
            else add += Math.floor(sub * steps * ef[2]);
        }
    }
    return add;
}

function lifeRateSum(entries, key) {
    let s = 0;
    for (const entry of entries) {
        for (const ef of lifeSkillEffects(entry)) {
            if (ef[0] !== key) continue;
            s += Math.floor(entry.level / ef[1]) * ef[2];
        }
    }
    return s;
}

function sumEquipPropKey(equips, keys) {
    const set = new Set(Array.isArray(keys) ? keys : [keys]);
    let s = 0;
    for (const eq of equips || []) {
        for (const p of collectEquipProps(eq)) {
            if (set.has(p.prop)) s += num(p.value);
        }
        for (const k of set) {
            if (eq[k] != null) s += num(eq[k]);
        }
    }
    return s;
}

function collectHedaoEffects(role) {
    const effects = [];
    for (const raw of Array.isArray(role.HeDaoSkill) ? role.HeDaoSkill : asPropList(role.HeDaoSkill)) {
        const cfg = hedaoCfg(raw.ID);
        if (!cfg) continue;
        for (const row of cfg.effects) {
            effects.push({ key: row[0], value: row[1], name: cfg.name });
        }
    }
    return effects;
}

function collectTeamHpMaxRate(role, partyRoles) {
    let rate = 0;
    const list = [role, ...(partyRoles || [])];
    let selfIn = false;
    for (const r of list) {
        if (!r) continue;
        if (num(r.ID) === num(role.ID)) selfIn = true;
        for (const raw of Array.isArray(r.HeDaoSkill) ? r.HeDaoSkill : asPropList(r.HeDaoSkill)) {
            const cfg = hedaoCfg(raw.ID);
            if (!cfg) continue;
            for (const row of cfg.effects) {
                if (row[0] === 'team_hpmax') rate += Number(row[1]) || 0;
            }
        }
    }
    return selfIn ? rate : 0;
}

function hedaoModOnKey(effects, key, sub) {
    const keys = key === 'hp' ? ['hp', 'hp_max'] : (key === 'speed' ? ['speed', 'spd'] : [key]);
    let add = 0;
    for (const e of effects) {
        if (!keys.includes(e.key)) continue;
        if (String(e.key).startsWith('team_')) continue;
        add += Math.abs(e.value) > 1 ? e.value : Math.floor(sub * e.value);
    }
    return add;
}

function hedaoFlatKey(effects, key) {
    let s = 0;
    for (const e of effects) {
        if (e.key === key) s += Math.abs(e.value) > 1 ? e.value : 0;
    }
    return s;
}

function extraAttrData() {
    return typeof EXTRA_ATTR_DATA !== 'undefined' ? EXTRA_ATTR_DATA : null;
}

function convertZhaoValue(value, dims) {
    if (typeof value === 'number') {
        if (Math.abs(value) > 0 && Math.abs(value) < 1) return value;
        return Math.floor(value);
    }
    if (!Array.isArray(value) || value.length < 3) return 0;
    const base = Number(value[0]) || 0;
    const key = value[1];
    const factor = Number(value[2]) || 0;
    if (typeof key !== 'string') return Math.floor(base);
    const attr = dims[key];
    if (attr == null) return 0;
    let scale;
    if (key === 'curmp') scale = (factor - 1) * (3 * attr / (400 + attr)) + 1;
    else if (key === 'neij' || key === 'gangqi') scale = (factor - 1) * (3 * attr / (4000 + attr)) + 1;
    else scale = (factor - 1) * (2.2 * attr / (400 + attr)) + 1;
    const v = base * scale;
    return Math.abs(v) > 1 ? Math.floor(v + 1e-6) : v;
}

function findActiveWg(list) {
    return findActiveSkill(list);
}

function collectZhaoMore(skill, dims, age) {
    const ed = extraAttrData();
    const out = {
        hp: 0, atk: 0, def: 0, hit: 0, dodge: 0, parry: 0, speed: 0, renxing: 0,
        str: 0, con: 0, dex: 0, int: 0,
    };
    if (!ed || !skill) return out;
    const chong = num(skill.Chong, 1);
    const ageAdd = Math.max(0, Math.floor(num(age, 16) - 16));
    for (const z of Array.isArray(skill.Zhaos) ? skill.Zhaos : []) {
        const cfg = ed.zhao[String(z.ID)];
        if (!cfg) continue;
        if (chong < cfg.layer_rel) continue;
        if (cfg.req2 || cfg.zs_beidong) continue;
        for (const [k, raw] of Object.entries(cfg.props || {})) {
            if (out[k] == null) continue;
            if (k === 'atk' && cfg.pro !== 0) continue;
            if (k.endsWith('_add')) continue;
            out[k] += convertZhaoValue(raw, dims);
        }
        if (cfg.year_add && ageAdd > 0 && out[cfg.year_add[0]] != null) {
            out[cfg.year_add[0]] += cfg.year_add[1] * ageAdd;
        }
    }
    return out;
}

function collectJingjinBonus(skill, kind) {
    const ed = extraAttrData();
    const flat = { hp: 0, atk: 0, def: 0, hit: 0, dodge: 0, parry: 0, speed: 0, ren: 0 };
    const pct = { hp: 0, atk: 0, def: 0, hit: 0, dodge: 0, parry: 0, speed: 0, ren: 0 };
    if (!ed || !skill) return { flat, pct };
    const table = ed.jingjin[kind];
    if (!table) return { flat, pct };
    const ready = (num(skill.Chong) >= 10 && num(skill.Level) >= 3) || num(skill.Chong) > 10;
    if (!ready) return { flat, pct };
    for (const jj of Array.isArray(skill.Jingjins) ? skill.Jingjins : []) {
        const ch = num(jj.Chong);
        if (!(ch > 0)) continue;
        const cfg = table[String(jj.ID)];
        if (!cfg || !cfg.boost || !cfg.req1 || cfg.req1[0] !== 100) continue;
        let key = cfg.boost[0];
        if (key === 'hpmax') key = 'hp';
        if (key === 'renxing') key = 'ren';
        if (flat[key] == null) continue;
        const v = ch * cfg.boost[1];
        if (Math.abs(v) > 0 && Math.abs(v) < 1) pct[key] += v;
        else flat[key] += v;
    }
    return { flat, pct };
}

function collectFumoBonus(equips) {
    const ed = extraAttrData();
    const out = { atk: 0, hp: 0, def: 0, hit: 0, dodge: 0, parry: 0, speed: 0, ren: 0, mp_f: 0, neij: 0, xx: 0 };
    if (!ed) return out;
    const armorStones = [];
    const weaponStones = [];
    for (const eq of equips || []) {
        const typ = equipCfg(eq.ID).type;
        const stones = asPropList(eq.EnFumos).map(x => num(x.ID != null ? x.ID : x.id)).filter(Boolean);
        if (typ >= 5 && typ <= 9) armorStones.push(...stones);
        else if (typ >= 1 && typ <= 4) weaponStones.push(...stones);
    }
    let xx = 0;
    for (const row of ed.fumo.xx || []) {
        if (weaponStones.includes(row.stone)) {
            xx = num(row.ench_xx);
            break;
        }
    }
    out.xx = xx;
    const count = {};
    for (const id of armorStones) count[id] = (count[id] || 0) + 1;

    const query = (propName) => {
        let s = 0;
        for (const set of ed.fumo.sets || []) {
            const tiers = set.tiers.filter(t => t.prop === propName).sort((a, b) => b.tier - a.tier);
            for (const tier of tiers) {
                const ok = (tier.parts || []).every(([sid, need]) => (count[sid] || 0) >= need);
                if (!ok) continue;
                s += num(tier.power);
                break;
            }
        }
        return s;
    };
    const scale = (v) => v + v * xx;
    out.atk = scale(query('atk'));
    out.hp = scale(query('hp_max'));
    out.def = scale(query('def'));
    out.hit = scale(query('hit'));
    out.dodge = scale(query('dodge'));
    out.parry = scale(query('parry'));
    out.speed = scale(query('speed'));
    out.ren = scale(query('renxing'));
    const mpF = query('mp_f');
    out.mp_f = Math.floor(mpF) + Math.floor(mpF) * xx;
    out.neij = scale(query('neij'));
    return out;
}

function computeFinalStats(role, partyRoles) {
    const lv = num(role.Level);
    const age = num(role.Age, 16);
    const equips = Array.isArray(role.Equips) ? role.Equips : [];
    const talents = collectTalentEffects(role);
    const jmProps = collectJingmaiProps(role);
    const nei = activeNeiStats(role);
    const taolu = activeTaoluStats(role);
    const qing = activeQingStats(role);
    const lifeEntries = collectLifeEntries(role, taolu.type);
    const hedaoEffects = collectHedaoEffects(role);
    const activeNei = findActiveWg(role.Neis);
    const activeTaolu = findActiveWg(role.Taolus);
    const activeQing = findActiveWg(role.Qings);
    const fumo = collectFumoBonus(equips);

    const zhaoDimPre = (skill) => {
        const empty = { str: 0, con: 0, dex: 0, int: 0 };
        const ed = extraAttrData();
        if (!ed || !skill) return empty;
        const chong = num(skill.Chong, 1);
        const ageAdd = Math.max(0, Math.floor(age - 16));
        const out = { ...empty };
        for (const z of Array.isArray(skill.Zhaos) ? skill.Zhaos : []) {
            const cfg = ed.zhao[String(z.ID)];
            if (!cfg || chong < cfg.layer_rel || cfg.req2 || cfg.zs_beidong) continue;
            for (const k of ['str', 'con', 'dex', 'int']) {
                if (cfg.props && cfg.props[k] != null && typeof cfg.props[k] === 'number') {
                    out[k] += cfg.props[k];
                }
            }
            if (cfg.year_add && ageAdd > 0 && out[cfg.year_add[0]] != null) {
                out[cfg.year_add[0]] += cfg.year_add[1] * ageAdd;
            }
        }
        return out;
    };
    const zd = {
        str: 0, con: 0, dex: 0, int: 0,
    };
    for (const part of [zhaoDimPre(activeNei), zhaoDimPre(activeTaolu), zhaoDimPre(activeQing)]) {
        for (const k of ['str', 'con', 'dex', 'int']) zd[k] += part[k];
    }

    const jmFinal = (key) => {
        const kd = kongfuData();
        if (!kd) return 0;
        let s = 0;
        for (const jm of asPropList(role.JingMais)) {
            const cfg = kd.jingmai[String(jm.ID)];
            if (!cfg || num(jm.Index) <= (kd.jmIndexCount || 10)) continue;
            const fin = num(jm.Order) > 0 ? cfg.z_jm : cfg.n_jm;
            if (fin && fin[0] === key) s += num(fin[1]);
        }
        return s;
    };

    const dimExtra = {};
    for (const k of ['str', 'con', 'dex', 'int']) {
        dimExtra[k] = talentSumKey(talents, k)
            + sumEquipFlatProp(equips, k)
            + jmFinal(k)
            + lifeModOnKey(lifeEntries, k, 0, true)
            + hedaoFlatKey(hedaoEffects, k)
            + zd[k];
    }

    const yiMap = {
        str: yiChuTotal(role, 'str', hedaoEffects),
        con: yiChuTotal(role, 'con', hedaoEffects),
        dex: yiChuTotal(role, 'dex', hedaoEffects),
        int: yiChuTotal(role, 'int', hedaoEffects),
    };
    const str = baseAttr(role, 'str', dimExtra.str, false, yiMap.str);
    const con = baseAttr(role, 'con', dimExtra.con, false, yiMap.con);
    const dex = baseAttr(role, 'dex', dimExtra.dex, false, yiMap.dex);
    const intel = baseAttr(role, 'int', dimExtra.int, false, yiMap.int);
    const dims = { str, con, dex, int: intel };
    const dimsCombat = {
        str: baseAttr(role, 'str', dimExtra.str, true, yiMap.str),
        con: baseAttr(role, 'con', dimExtra.con, true, yiMap.con),
        dex: baseAttr(role, 'dex', dimExtra.dex, true, yiMap.dex),
        int: baseAttr(role, 'int', dimExtra.int, true, yiMap.int),
    };
    const dimsConv = dims;

    const typeAddKey = { 1: 'unarmed_add', 2: 'blade_add', 3: 'sword_add', 4: 'stick_add' }[taolu.type];
    const typeAdd = collectTypeAdd(role, equips, typeAddKey, lifeEntries, talents, dimsConv);
    const taoluAtk = Math.floor(taolu.rawAtk * (1 + typeAdd));

    const zhaoNei = collectZhaoMore(activeNei, dimsConv, age);
    const zhaoTaolu = collectZhaoMore(activeTaolu, dimsConv, age);
    const zhaoQing = collectZhaoMore(activeQing, dimsConv, age);
    const zhao = {
        hp: zhaoNei.hp + zhaoTaolu.hp + zhaoQing.hp,
        atk: zhaoNei.atk + zhaoTaolu.atk + zhaoQing.atk,
        def: zhaoNei.def + zhaoTaolu.def + zhaoQing.def,
        hit: zhaoNei.hit + zhaoTaolu.hit + zhaoQing.hit,
        dodge: zhaoNei.dodge + zhaoTaolu.dodge + zhaoQing.dodge,
        parry: zhaoNei.parry + zhaoTaolu.parry + zhaoQing.parry,
        speed: zhaoNei.speed + zhaoTaolu.speed + zhaoQing.speed,
        ren: zhaoNei.renxing + zhaoTaolu.renxing + zhaoQing.renxing,
    };
    const jjNei = collectJingjinBonus(activeNei, 'nei');
    const jjTaolu = collectJingjinBonus(activeTaolu, 'taolu');
    const jjQing = collectJingjinBonus(activeQing, 'qing');
    const jjFlat = (k) => (jjNei.flat[k] || 0) + (jjTaolu.flat[k] || 0) + (jjQing.flat[k] || 0);
    const jjPct = (k) => (jjNei.pct[k] || 0) + (jjTaolu.pct[k] || 0) + (jjQing.pct[k] || 0);

    const xwNg = getXWAdd(role, 'ng');
    const xwTl = taolu.type ? getXWAdd(role, taolu.type) : 0;
    const xwQg = getXWAdd(role, 'qg');
    const xiuwei = {
        hp: nei.rawHp * xwNg / 100,
        atk: taolu.rawAtk * xwTl / 100,
        parry: taolu.parry * xwTl / 100,
        dodge: qing.rawDodge * xwQg / 100,
        speed: qing.rawSpeed * xwQg / 100,
        mp_back: Math.floor(getWXXW(role, 'ng') / 1000),
    };

    const tlMore = talentSumKey(talents, 'taolu');
    const neiPropKey = nei.prop ? `nei_prop_${nei.prop}` : '';
    const neiPropRate = neiPropKey ? talentSumKey(talents, neiPropKey) : 0;
    let shenmaiRate = 0;
    for (const entry of lifeEntries) {
        for (const ef of lifeSkillEffects(entry)) {
            if (neiPropKey && ef[0] === neiPropKey) {
                shenmaiRate += Math.floor(entry.level / ef[1]) * ef[2];
            }
        }
    }
    const neiPropBonus = nei.rawHp * neiPropRate;
    const shenmaiBonus = nei.rawHp * shenmaiRate;

    const bodyAtk = num(role.StrAtk) * dimsCombat.str + Math.floor(lv * num(role.GrowAttack)) + 25 + num(role.ExtAttack);
    const bodyHp = num(role.ConHp) * dimsCombat.con + 56 + Math.floor(lv * num(role.GrowHp)) + num(role.ExtHp);
    const bodyDef = 12 + Math.floor(lv * num(role.GrowDefence)) + num(role.ExtDefence);
    const bodyHit = 90 + lv * num(role.GrowHit) + num(role.ExtHit);
    const bodyDodge = 10 + Math.floor(lv * num(role.GrowDodge) + dimsCombat.dex * num(role.DexDodge)) + num(role.ExtDodge);
    const bodyParry = Math.floor(lv * 1.2) + 30 + num(role.ExtParry);
    const bodySpeed = dimsCombat.dex * num(role.DexSpeed) + 100 + Math.floor(lv * num(role.GrowSpeed)) + num(role.ExtSpeed);
    const bodyRen = dimsCombat.con * num(role.ConRen) + num(role.ExtRen);
    const bodyMpFirstCombat = num(role.ExtMpFirst) + dimsCombat.int * num(role.IntMpFirst);

    let bodyGang = num(role.ExtGangqi);
    if (num(role.GrowGangqi) > 0 && lv >= NJGQ_PROP_LEVEL) {
        bodyGang += (lv - NJGQ_PROP_LEVEL + 1) * num(role.GrowGangqi);
    }
    let bodyNeij = num(role.ExtNeijin);
    if (num(role.GrowNeijin) > 0 && lv >= NJGQ_PROP_LEVEL) {
        bodyNeij = Math.max(0, bodyNeij + (lv - NJGQ_PROP_LEVEL + 3) * num(role.GrowNeijin));
    }

    let armorAtk = 0;
    let weaponAtk = 0;
    for (const eq of equips) {
        const typ = equipCfg(eq.ID).type;
        const v = equipCombatStat(eq, 'Atk', ['atk_add', 'atk']);
        if (typ >= 1 && typ <= 4) weaponAtk += v;
        else armorAtk += v;
    }
    let weaponLifePct = 0;
    const weaponTypeKey = { 1: 'weapon_unarmed', 2: 'weapon_blade', 3: 'weapon_sword', 4: 'weapon_stick' }[taolu.type];
    for (const entry of lifeEntries) {
        for (const ef of lifeSkillEffects(entry)) {
            if (ef[0] === 'weapon' || (weaponTypeKey && ef[0] === weaponTypeKey)) {
                weaponLifePct += Math.floor(entry.level / ef[1]) * ef[2];
            }
        }
    }
    const weaponTalentMore = talentSumKey(talents, 'weapon');
    const weaponMore = weaponTalentMore + weaponLifePct;
    const weaponFinal = weaponAtk ? weaponAtk + Math.floor(weaponAtk * weaponMore) : 0;
    let weaponHit = 0;
    for (const eq of equips) {
        const typ = equipCfg(eq.ID).type;
        if (!(typ >= 1 && typ <= 4)) continue;
        if (taolu.type && typ !== taolu.type && typ !== 1) continue;
        weaponHit += equipCombatStat(eq, 'Hit', ['hit_add', 'hit']);
    }
    if (weaponHit) weaponHit += Math.floor(weaponHit * weaponTalentMore);
    let armorHit = 0;
    for (const eq of equips) {
        const typ = equipCfg(eq.ID).type;
        if (typ >= 1 && typ <= 4) continue;
        armorHit += equipCombatStat(eq, 'Hit', ['hit_add', 'hit']);
    }
    const eqAtk = armorAtk + fumo.atk + weaponFinal;
    const eqHp = sumEquipCombat(equips, 'Hp', ['hp_add', 'hp']);
    const eqDef = sumEquipCombat(equips, 'Def', ['def_add', 'def']);
    const eqHit = armorHit + weaponHit;
    const eqDodge = sumEquipCombat(equips, 'Dodge', ['dodge_add', 'dodge']);
    const eqParry = sumEquipCombat(equips, 'Parry', ['parry_add', 'parry']);
    const eqSpeed = sumEquipCombat(equips, 'Speed', ['speed_add', 'speed']);
    const eqRen = sumEquipCombat(equips, 'RenXing', ['renxing']);
    const eqMpBack = sumEquipPropKey(equips, ['mp_back', 'MpBack']);
    const eqMpFirst = sumEquipPropKey(equips, ['mp_f', 'MpFirst', 'mp_first']);
    let eqGang = 0;
    let eqNeij = 0;
    for (const eq of equips) {
        eqGang += equipGangqi(eq);
        eqNeij += equipNeijin(eq);
    }
    eqNeij += fumo.neij;

    const jmAtk = sumKeyProps(jmProps, 'atk');
    const jmHp = sumKeyProps(jmProps, 'hp');
    const jmDef = sumKeyProps(jmProps, 'def');
    const jmHit = sumKeyProps(jmProps, 'hit');
    const jmDodge = sumKeyProps(jmProps, 'dodge');
    const jmParry = sumKeyProps(jmProps, 'parry');
    const jmSpeed = sumKeyProps(jmProps, 'speed');
    const jmRen = sumKeyProps(jmProps, 'renxing');

    const qingDodge = Math.floor(qing.dodge);
    const qingSpeed = qing.speed;

    const sub = {
        atk: bodyAtk + eqAtk + taoluAtk + zhao.atk + jjFlat('atk') + jmAtk + xiuwei.atk,
        hp: bodyHp + eqHp + fumo.hp + nei.hp + zhao.hp + jjFlat('hp') + jmHp + xiuwei.hp + neiPropBonus + shenmaiBonus,
        def: bodyDef + eqDef + fumo.def + taolu.def + zhao.def + jjFlat('def') + jmDef,
        hit: bodyHit + eqHit + fumo.hit + taolu.hit + zhao.hit + jjFlat('hit') + jmHit,
        dodge: bodyDodge + eqDodge + fumo.dodge + taolu.dodge + zhao.dodge + jjFlat('dodge') + qingDodge + jmDodge + xiuwei.dodge,
        parry: bodyParry + eqParry + fumo.parry + taolu.parry + zhao.parry + jjFlat('parry') + jmParry + xiuwei.parry,
        speed: bodySpeed + eqSpeed + fumo.speed + taolu.speed + zhao.speed + jjFlat('speed') + qingSpeed + jmSpeed + xiuwei.speed,
        ren: bodyRen + eqRen + fumo.ren + zhao.ren + jjFlat('ren'),
        gangqi: bodyGang + eqGang,
        neijin: bodyNeij + eqNeij,
    };

    const jjPctPart = {
        atk: Math.floor(sub.atk * jjPct('atk')),
        hp: Math.floor(sub.hp * jjPct('hp')),
        def: Math.floor(sub.def * jjPct('def')),
        hit: Math.floor(sub.hit * jjPct('hit')),
        dodge: Math.floor(sub.dodge * jjPct('dodge')),
        parry: Math.floor(sub.parry * jjPct('parry')),
        speed: Math.floor(sub.speed * jjPct('speed')),
    };
    const jj = {
        atk: jjFlat('atk') + jjPctPart.atk,
        hp: jjFlat('hp') + jjPctPart.hp,
        def: jjFlat('def') + jjPctPart.def,
        hit: jjFlat('hit') + jjPctPart.hit,
        dodge: jjFlat('dodge') + jjPctPart.dodge,
        parry: jjFlat('parry') + jjPctPart.parry,
        speed: jjFlat('speed') + jjPctPart.speed,
    };

    const renLifeRate = lifeRateSum(lifeEntries, 'renxing');
    const renTalentRate = talentSumKey(talents, 'renxing');
    const life = {
        atk: lifeModOnKey(lifeEntries, 'atk', sub.atk, false),
        hp: lifeModOnKey(lifeEntries, 'hp', sub.hp, false) + Math.floor(shenmaiBonus),
        def: lifeModOnKey(lifeEntries, 'def', sub.def, false),
        hit: lifeModOnKey(lifeEntries, 'hit', sub.hit, false),
        dodge: lifeModOnKey(lifeEntries, 'dodge', sub.dodge, false),
        parry: lifeModOnKey(lifeEntries, 'parry', sub.parry, false),
        speed: lifeModOnKey(lifeEntries, 'speed', sub.speed, false),
        ren: renLifeRate * sub.ren,
    };
    const lifeAdd = {
        atk: life.atk,
        hp: lifeModOnKey(lifeEntries, 'hp', sub.hp, false),
        def: life.def,
        hit: life.hit,
        dodge: life.dodge,
        parry: life.parry,
        speed: life.speed,
        ren: life.ren,
    };
    const hedaoPersonal = {
        atk: hedaoModOnKey(hedaoEffects, 'atk', sub.atk),
        hp: hedaoModOnKey(hedaoEffects, 'hp', sub.hp),
        def: hedaoModOnKey(hedaoEffects, 'def', sub.def),
        hit: hedaoModOnKey(hedaoEffects, 'hit', sub.hit),
        dodge: hedaoModOnKey(hedaoEffects, 'dodge', sub.dodge),
        parry: hedaoModOnKey(hedaoEffects, 'parry', sub.parry),
        speed: hedaoModOnKey(hedaoEffects, 'speed', sub.speed),
        ren: hedaoModOnKey(hedaoEffects, 'renxing', sub.ren),
        gangqi: hedaoModOnKey(hedaoEffects, 'gangqi', sub.gangqi),
    };
    const baseBeforeTeam = {
        hp: sub.hp + lifeAdd.hp + hedaoPersonal.hp + talentModOnSub(talents, 'hp', sub.hp) + jjPctPart.hp,
        atk: sub.atk + lifeAdd.atk + hedaoPersonal.atk + talentModOnSub(talents, 'atk', sub.atk) + jjPctPart.atk + Math.floor(taolu.rawAtk * tlMore),
    };
    const teamHpRate = collectTeamHpMaxRate(role, partyRoles);
    const teamHpAdd = baseBeforeTeam.hp * teamHpRate;
    const hedao = {
        ...hedaoPersonal,
        hp: hedaoPersonal.hp + teamHpAdd,
    };
    const tal = {
        atk: talentModOnSub(talents, 'atk', sub.atk) + Math.floor(taolu.rawAtk * tlMore),
        hp: talentModOnSub(talents, 'hp', sub.hp) + Math.floor(neiPropBonus),
        def: talentModOnSub(talents, 'def', sub.def),
        hit: talentModOnSub(talents, 'hit', sub.hit),
        dodge: talentModOnSub(talents, 'dodge', sub.dodge),
        parry: talentModOnSub(talents, 'parry', sub.parry) + taolu.parry * tlMore,
        speed: talentModOnSub(talents, 'speed', sub.speed),
        ren: renTalentRate * sub.ren,
    };
    const talAdd = {
        atk: talentModOnSub(talents, 'atk', sub.atk) + Math.floor(taolu.rawAtk * tlMore),
        hp: talentModOnSub(talents, 'hp', sub.hp),
        def: tal.def,
        hit: tal.hit,
        dodge: tal.dodge,
        parry: tal.parry,
        speed: tal.speed,
        ren: tal.ren,
    };

    let neiMpBack = 0;
    if (activeNei) {
        const ncfg = kongfuData() && kongfuData().nei[String(activeNei.ID)];
        if (ncfg) {
            neiMpBack = num(ncfg.mp_back);
            const classId = num(ncfg.class);
            if (classId && classId !== num(role.MenPai)) neiMpBack -= 1;
        }
        const ed = extraAttrData();
        if (ed) {
            const chong = num(activeNei.Chong, 1);
            for (const z of Array.isArray(activeNei.Zhaos) ? activeNei.Zhaos : []) {
                const cfg = ed.zhao[String(z.ID)];
                if (!cfg || chong < cfg.layer_rel || cfg.req2 || cfg.zs_beidong) continue;
                const raw = cfg.props && cfg.props.mp_back;
                if (raw != null) neiMpBack += convertZhaoValue(raw, dimsConv);
            }
        }
    }
    const jmMpBack = sumKeyProps(jmProps, 'mp_back');
    const lifeMpBack = lifeRateSum(lifeEntries, 'mp_back');
    const talMpBack = talentSumKey(talents, 'mp_back');
    const jjMpBackFlat = (() => {
        let s = 0;
        const ed = extraAttrData();
        if (!ed || !activeNei) return 0;
        const table = ed.jingjin.nei;
        const ready = (num(activeNei.Chong) >= 10 && num(activeNei.Level) >= 3) || num(activeNei.Chong) > 10;
        if (!ready || !table) return 0;
        for (const jj of Array.isArray(activeNei.Jingjins) ? activeNei.Jingjins : []) {
            const ch = num(jj.Chong);
            if (!(ch > 0)) continue;
            const cfg = table[String(jj.ID)];
            if (!cfg || !cfg.boost || !cfg.req1 || cfg.req1[0] !== 100) continue;
            if (cfg.boost[0] !== 'mp_back' && cfg.boost[0] !== 'mpback') continue;
            const v = ch * cfg.boost[1];
            s += Math.abs(v) < 1 ? (INIT_MPBACK + neiMpBack) * v : v;
        }
        return s;
    })();
    let hedaoMpBack = 0;
    let hedaoMpBackPct = 0;
    for (const e of hedaoEffects) {
        if (e.key !== 'mp_back') continue;
        if (Math.abs(e.value) < 1) hedaoMpBackPct += e.value;
        else hedaoMpBack += e.value;
    }
    const mpBackCore = INIT_MPBACK + neiMpBack + Math.floor(jjMpBackFlat) + jmMpBack + talMpBack
        + lifeMpBack + eqMpBack + xiuwei.mp_back;
    if (hedaoMpBackPct) {
        hedaoMpBack += (INIT_MPBACK + neiMpBack + Math.floor(jjMpBackFlat) + jmMpBack + talMpBack
            + lifeMpBack + eqMpBack + xiuwei.mp_back) * hedaoMpBackPct;
    }
    const mpBack = Math.floor(mpBackCore + hedaoMpBack + 0.0001);

    const bodyMpFirst = bodyMpFirstCombat;
    let zhaoMpFirst = 0;
    {
        const ed = extraAttrData();
        if (ed && activeNei) {
            const chong = num(activeNei.Chong, 1);
            for (const z of Array.isArray(activeNei.Zhaos) ? activeNei.Zhaos : []) {
                const cfg = ed.zhao[String(z.ID)];
                if (!cfg || chong < cfg.layer_rel || cfg.req2 || cfg.zs_beidong) continue;
                const raw = cfg.props && (cfg.props.mp_f || cfg.props.mp_first);
                if (raw != null) zhaoMpFirst += convertZhaoValue(raw, dimsConv);
            }
        }
    }
    const jmMpFirst = sumKeyProps(jmProps, 'mp_f');
    const lifeMpFirst = lifeRateSum(lifeEntries, 'mp_f');
    const talMpFirst = talentSumKey(talents, 'mp_f');
    let hedaoMpFirst = 0;
    for (const e of hedaoEffects) {
        if (e.key === 'mp_f') hedaoMpFirst += e.value;
    }
    const mpFirst = Math.floor(
        bodyMpFirst + zhaoMpFirst + eqMpFirst + fumo.mp_f + talMpFirst + jmMpFirst + lifeMpFirst + hedaoMpFirst + 0.0001
    );

    const lifeRatioKey = (key) => {
        let s = 0;
        for (const entry of lifeEntries) {
            for (const ef of lifeSkillEffects(entry)) {
                if (ef[0] !== key) continue;
                s += Math.floor(entry.level / ef[1]) * ef[2];
            }
        }
        return s;
    };
    const ratioParts = (key) => ({
        equip: sumEquipRatioProp(equips, key),
        talent: talentSumKey(talents, key),
        jm: sumKeyProps(jmProps, key),
        life: lifeRatioKey(key),
        hedao: (() => {
            let s = 0;
            for (const e of hedaoEffects) {
                if (e.key === key && Math.abs(e.value) <= 1) s += e.value;
            }
            return s;
        })(),
    });
    const bloodParts = ratioParts('blood');
    const dmgOffParts = ratioParts('dmg_off');
    const defIgnParts = ratioParts('def_ign');
    const sumParts = (p) => p.equip + p.talent + p.jm + p.life + p.hedao;
    const blood = sumParts(bloodParts);
    const dmgOff = sumParts(dmgOffParts);
    const defIgn = sumParts(defIgnParts);

    return {
        str, con, dex, int: intel,
        combat: dimsCombat,
        yiChu: yiMap,
        hp: Math.floor(sub.hp + lifeAdd.hp + hedao.hp + talAdd.hp + jjPctPart.hp),
        atk: Math.floor(sub.atk + lifeAdd.atk + hedao.atk + talAdd.atk + jjPctPart.atk),
        def: Math.floor(sub.def + lifeAdd.def + hedao.def + talAdd.def + jjPctPart.def),
        hit: Math.floor(sub.hit + lifeAdd.hit + hedao.hit + talAdd.hit + jjPctPart.hit),
        dodge: Math.floor(sub.dodge + lifeAdd.dodge + hedao.dodge + talAdd.dodge + jjPctPart.dodge),
        parry: Math.floor(sub.parry + lifeAdd.parry + hedao.parry + talAdd.parry + jjPctPart.parry),
        speed: Math.floor(sub.speed + lifeAdd.speed + hedao.speed + talAdd.speed + jjPctPart.speed),
        ren: Math.floor(sub.ren + jmRen + lifeAdd.ren + hedaoPersonal.ren + talAdd.ren + Math.floor(sub.ren * jjPct('ren'))),
        gangqi: Math.floor(sub.gangqi + hedao.gangqi),
        neijin: Math.floor(sub.neijin),
        mp_back: mpBack,
        mp_first: mpFirst,
        blood,
        dmg_off: dmgOff,
        def_ign: defIgn,
        ratio: { blood: bloodParts, dmg_off: dmgOffParts, def_ign: defIgnParts },
        body: {
            hp: Math.floor(bodyHp), atk: Math.floor(bodyAtk), def: Math.floor(bodyDef),
            hit: Math.floor(bodyHit), dodge: Math.floor(bodyDodge), parry: Math.floor(bodyParry),
            speed: Math.floor(bodySpeed), ren: Math.floor(bodyRen),
            gangqi: Math.floor(bodyGang), neijin: Math.floor(bodyNeij),
            mp_first: Math.floor(bodyMpFirst),
            mp_back: INIT_MPBACK,
        },
        equip: {
            hp: Math.floor(eqHp + fumo.hp), atk: Math.floor(eqAtk), def: Math.floor(eqDef + fumo.def),
            hit: Math.floor(eqHit + fumo.hit), dodge: Math.floor(eqDodge + fumo.dodge),
            parry: Math.floor(eqParry + fumo.parry), speed: Math.floor(eqSpeed + fumo.speed),
            ren: Math.floor(eqRen + fumo.ren),
            gangqi: Math.floor(eqGang), neijin: Math.floor(eqNeij),
            mp_back: Math.floor(eqMpBack),
            mp_first: Math.floor(eqMpFirst + fumo.mp_f),
        },
        fumo: {
            hp: Math.floor(fumo.hp), atk: Math.floor(fumo.atk), def: Math.floor(fumo.def),
            hit: Math.floor(fumo.hit), dodge: Math.floor(fumo.dodge), parry: Math.floor(fumo.parry),
            speed: Math.floor(fumo.speed), ren: Math.floor(fumo.ren), mp_f: Math.floor(fumo.mp_f), xx: fumo.xx,
        },
        xiuwei: {
            hp: Math.floor(xiuwei.hp), atk: Math.floor(xiuwei.atk),
            parry: Math.floor(xiuwei.parry), dodge: Math.floor(xiuwei.dodge), speed: Math.floor(xiuwei.speed),
            mp_back: xiuwei.mp_back,
            ng: xwNg, tl: xwTl, qg: xwQg,
            wxxw: {
                quan: getWXXW(role, 1), dao: getWXXW(role, 2), jian: getWXXW(role, 3), gun: getWXXW(role, 4),
                ng: getWXXW(role, 'ng'), qg: getWXXW(role, 'qg'),
            },
        },
        zhao: {
            hp: Math.floor(zhao.hp), atk: Math.floor(zhao.atk), def: Math.floor(zhao.def),
            hit: Math.floor(zhao.hit), dodge: Math.floor(zhao.dodge), parry: Math.floor(zhao.parry),
            speed: Math.floor(zhao.speed), ren: Math.floor(zhao.ren),
            hitNei: Math.floor(zhaoNei.hit), hitTaolu: Math.floor(zhaoTaolu.hit), hitQing: Math.floor(zhaoQing.hit),
            dodgeNei: Math.floor(zhaoNei.dodge), dodgeTaolu: Math.floor(zhaoTaolu.dodge), dodgeQing: Math.floor(zhaoQing.dodge),
            parryQing: Math.floor(zhaoQing.parry),
            speedNei: Math.floor(zhaoNei.speed), speedTaolu: Math.floor(zhaoTaolu.speed), speedQing: Math.floor(zhaoQing.speed),
        },
        jingjin: jj,
        jingjinPct: jjPctPart,
        skill: {
            neiHp: Math.floor(nei.hp + zhao.hp + jj.hp),
            neiName: nei.name,
            neiMpBack: Math.floor(neiMpBack + Math.floor(jjMpBackFlat)),
            taoluAtk: Math.floor(taoluAtk + zhao.atk + jj.atk),
            taoluParry: Math.floor(taolu.parry + zhaoTaolu.parry + jjTaolu.flat.parry + jjPctPart.parry),
            taoluHit: Math.floor(taolu.hit + zhaoTaolu.hit + jjTaolu.flat.hit),
            taoluName: taolu.name,
            qingDodge: Math.floor(qingDodge + zhaoQing.dodge + jjQing.flat.dodge + jjPctPart.dodge),
            qingSpeed: Math.floor(qingSpeed + zhaoQing.speed + jjQing.flat.speed + jjPctPart.speed),
            qingParry: Math.floor(zhaoQing.parry + jjQing.flat.parry),
            qingHit: Math.floor(zhaoQing.hit + jjQing.flat.hit),
            qingName: qing.name,
            neiHit: Math.floor(zhaoNei.hit + jjNei.flat.hit),
            neiDodge: Math.floor(zhaoNei.dodge + jjNei.flat.dodge),
            neiSpeed: Math.floor(zhaoNei.speed + jjNei.flat.speed),
            typeAdd,
            jmAtk: Math.floor(jmAtk),
            jmHp: Math.floor(jmHp),
            jmDef: Math.floor(jmDef),
            jmHit: Math.floor(jmHit),
            jmParry: Math.floor(jmParry),
            jmDodge: Math.floor(jmDodge),
            jmSpeed: Math.floor(jmSpeed),
            jmRen: Math.floor(jmRen),
            jmMpBack: Math.floor(jmMpBack),
            jmMpFirst: Math.floor(jmMpFirst),
        },
        life,
        hedao: { ...hedao, ren: hedaoPersonal.ren, mp_back: hedaoMpBack },
        talent: { ...tal, mp_back: talMpBack, mp_first: talMpFirst },
        mpBackDetail: {
            base: INIT_MPBACK,
            nei: Math.floor(neiMpBack + Math.floor(jjMpBackFlat)),
            xiuwei: xiuwei.mp_back,
            jm: Math.floor(jmMpBack),
            talent: talMpBack,
            life: lifeMpBack,
            equip: Math.floor(eqMpBack),
            hedao: hedaoMpBack,
        },
        mpFirstDetail: {
            body: Math.floor(bodyMpFirst),
            zhao: Math.floor(zhaoMpFirst),
            equip: Math.floor(eqMpFirst + fumo.mp_f),
            talent: talMpFirst,
            jm: Math.floor(jmMpFirst),
            life: lifeMpFirst,
            hedao: hedaoMpFirst,
        },
        lifeCount: lifeEntries.length,
        hedaoCount: (Array.isArray(role.HeDaoSkill) ? role.HeDaoSkill : asPropList(role.HeDaoSkill)).length,
        sources: (extraAttrData() && extraAttrData().sources) || null,
    };
}

function fmtPct(v) {
    if (!v) return '0%';
    if (Math.abs(v) < 0.1) return `${Math.floor(v * 1000 + 0.001) / 10}%`;
    return `${Math.floor(v * 100 + 0.001)}%`;
}

function tipRatio(parts) {
    if (!parts) return '';
    const bits = [];
    if (parts.equip) bits.push(`装${fmtPct(parts.equip)}`);
    if (parts.talent) bits.push(`天赋${fmtPct(parts.talent)}`);
    if (parts.jm) bits.push(`经脉${fmtPct(parts.jm)}`);
    if (parts.life) bits.push(`秘技${fmtPct(parts.life)}`);
    if (parts.hedao) bits.push(`合道${fmtPct(parts.hedao)}`);
    return bits.join('+') || '无加成';
}

function renderFinalStats(role, partyRoles) {
    const el = document.getElementById('roleFinal');
    if (!el) return;
    const f = computeFinalStats(role, partyRoles);
    const tipParts = (...parts) => parts.filter(p => p && !String(p).endsWith('+0') && p !== '天赋0').join('+');
    const tipAtk = tipParts(
        `人物${f.body.atk}`,
        `装备${f.equip.atk}`,
        f.skill.taoluAtk ? `套路${f.skill.taoluAtk}` : '',
        f.xiuwei && f.xiuwei.atk ? `修为${f.xiuwei.atk}` : '',
        f.skill.jmAtk ? `经脉${f.skill.jmAtk}` : '',
        f.talent.atk ? `天赋${Math.floor(f.talent.atk)}` : '',
        f.life.atk ? `秘技${Math.floor(f.life.atk)}` : '',
        f.hedao.atk ? `合道${Math.floor(f.hedao.atk)}` : '',
    );
    const tipHp = tipParts(
        `人物${f.body.hp}`,
        `装备${f.equip.hp}`,
        f.skill.neiHp ? `内功${f.skill.neiHp}` : '',
        f.xiuwei && f.xiuwei.hp ? `修为${f.xiuwei.hp}` : '',
        f.skill.jmHp ? `经脉${f.skill.jmHp}` : '',
        f.talent.hp ? `天赋${Math.floor(f.talent.hp)}` : '',
        f.life.hp ? `秘技${Math.floor(f.life.hp)}` : '',
        f.hedao.hp ? `合道${Math.floor(f.hedao.hp)}` : '',
    );
    const tipDef = tipParts(
        `人物${f.body.def}`,
        `装备${f.equip.def}`,
        f.skill.jmDef ? `经脉${f.skill.jmDef}` : '',
        f.life.def ? `秘技${Math.floor(f.life.def)}` : '',
        f.hedao.def ? `合道${Math.floor(f.hedao.def)}` : '',
        f.talent.def ? `天赋${Math.floor(f.talent.def)}` : '',
    );
    const tipHit = tipParts(
        `人物${f.body.hit}`,
        `装备${f.equip.hit}`,
        f.skill.taoluHit ? `套路${f.skill.taoluHit}` : '',
        f.skill.neiHit ? `内功${f.skill.neiHit}` : '',
        f.skill.qingHit ? `轻功${f.skill.qingHit}` : '',
        f.skill.jmHit ? `经脉${f.skill.jmHit}` : '',
        f.talent.hit ? `天赋${Math.floor(f.talent.hit)}` : '',
        f.life.hit ? `秘技${Math.floor(f.life.hit)}` : '',
        f.hedao.hit ? `合道${Math.floor(f.hedao.hit)}` : '',
    );
    const tipDodge = tipParts(
        `人物${f.body.dodge}`,
        `装备${f.equip.dodge}`,
        f.skill.taoluName && f.zhao.dodgeTaolu ? `套路${f.zhao.dodgeTaolu}` : '',
        f.skill.neiDodge ? `内功${f.skill.neiDodge}` : '',
        f.skill.qingDodge ? `轻功${f.skill.qingDodge}` : '',
        f.xiuwei && f.xiuwei.dodge ? `修为${f.xiuwei.dodge}` : '',
        f.skill.jmDodge ? `经脉${f.skill.jmDodge}` : '',
        f.talent.dodge ? `天赋${Math.floor(f.talent.dodge)}` : '',
        f.life.dodge ? `秘技${Math.floor(f.life.dodge)}` : '',
        f.hedao.dodge ? `合道${Math.floor(f.hedao.dodge)}` : '',
    );
    const tipParry = tipParts(
        `人物${f.body.parry}`,
        `装备${f.equip.parry}`,
        f.skill.taoluParry ? `套路${f.skill.taoluParry}` : '',
        f.xiuwei && f.xiuwei.parry ? `修为${f.xiuwei.parry}` : '',
        f.skill.qingParry ? `轻功${f.skill.qingParry}` : '',
        f.skill.jmParry ? `经脉${f.skill.jmParry}` : '',
        f.talent.parry ? `天赋${Math.floor(f.talent.parry)}` : '',
        f.life.parry ? `秘技${Math.floor(f.life.parry)}` : '',
        f.hedao.parry ? `合道${Math.floor(f.hedao.parry)}` : '',
    );
    const tipSpeed = tipParts(
        `人物${f.body.speed}`,
        `装备${f.equip.speed}`,
        f.zhao.speedTaolu ? `套路${f.zhao.speedTaolu}` : '',
        f.skill.neiSpeed ? `内功${f.skill.neiSpeed}` : '',
        f.skill.qingSpeed ? `轻功${f.skill.qingSpeed}` : '',
        f.xiuwei && f.xiuwei.speed ? `修为${f.xiuwei.speed}` : '',
        f.skill.jmSpeed ? `经脉${f.skill.jmSpeed}` : '',
        f.life.speed ? `秘技${Math.floor(f.life.speed)}` : '',
        f.hedao.speed ? `合道${Math.floor(f.hedao.speed)}` : '',
        f.talent.speed ? `天赋${Math.floor(f.talent.speed)}` : '',
    );
    const tipRen = tipParts(
        `人物${f.body.ren}`,
        `装备${f.equip.ren}`,
        f.zhao.ren ? `内功${f.zhao.ren}` : '',
        f.skill.jmRen ? `经脉${f.skill.jmRen}` : '',
        f.talent.ren ? `天赋${Math.floor(f.talent.ren)}` : '',
        f.life.ren ? `秘技${Math.floor(f.life.ren)}` : '',
        f.hedao.ren ? `合道${Math.floor(f.hedao.ren)}` : '',
    );
    const tipMpBack = tipParts(
        f.mpBackDetail.nei
            ? `内功${f.mpBackDetail.base + f.mpBackDetail.nei}`
            : `人物${f.mpBackDetail.base}`,
        f.mpBackDetail.xiuwei ? `修为${f.mpBackDetail.xiuwei}` : '',
        f.mpBackDetail.jm ? `经脉${f.mpBackDetail.jm}` : '',
        f.mpBackDetail.talent ? `天赋${f.mpBackDetail.talent}` : '',
        f.mpBackDetail.life ? `秘技${f.mpBackDetail.life}` : '',
        f.mpBackDetail.equip ? `装备${f.mpBackDetail.equip}` : '',
        f.mpBackDetail.hedao ? `合道${Math.floor(f.mpBackDetail.hedao)}` : '',
    );
    const tipMpFirst = tipParts(
        `人物${f.mpFirstDetail.body}`,
        f.mpFirstDetail.zhao ? `内功${f.mpFirstDetail.zhao}` : '',
        f.mpFirstDetail.equip ? `装备${f.mpFirstDetail.equip}` : '',
        f.mpFirstDetail.talent ? `天赋${f.mpFirstDetail.talent}` : '',
        f.mpFirstDetail.jm ? `经脉${f.mpFirstDetail.jm}` : '',
        f.mpFirstDetail.life ? `秘技${f.mpFirstDetail.life}` : '',
        f.mpFirstDetail.hedao ? `合道${f.mpFirstDetail.hedao}` : '',
    );
    const skillHint = [
        f.skill.neiName ? `内功 ${f.skill.neiName}` : '',
        f.skill.taoluName ? `套路 ${f.skill.taoluName}` : '',
        f.skill.qingName ? `轻功 ${f.skill.qingName}` : '',
        f.lifeCount ? `秘技×${f.lifeCount}` : '',
        f.hedaoCount ? `合道×${f.hedaoCount}` : '',
    ].filter(Boolean).join(' · ');
    const tipDim = (panel, adj, yi) => {
        if (panel === adj) return `溢出上限${num(role.Level) + num(yi)} · 无衰减`;
        return `溢出衰减${adj} · 上限${num(role.Level) + num(yi)}`;
    };
    const items = [
        ['臂力', String(f.str), tipDim(f.str, f.combat.str, f.yiChu.str)],
        ['根骨', String(f.con), tipDim(f.con, f.combat.con, f.yiChu.con)],
        ['身法', String(f.dex), tipDim(f.dex, f.combat.dex, f.yiChu.dex)],
        ['内息', String(f.int), tipDim(f.int, f.combat.int, f.yiChu.int)],
        ['气血', String(f.hp), tipHp],
        ['攻击', String(f.atk), tipAtk],
        ['防御', String(f.def), tipDef],
        ['命中', String(f.hit), tipHit],
        ['闪避', String(f.dodge), tipDodge],
        ['招架', String(f.parry), tipParry],
        ['速度', String(f.speed), tipSpeed],
        ['韧性', String(f.ren), tipRen],
        ['聚气', String(f.mp_back), tipMpBack],
        ['真元', String(f.mp_first), tipMpFirst],
        ['罡气', String(f.gangqi), `底${f.body.gangqi}+装${f.equip.gangqi}`],
        ['内劲', String(f.neijin), `底${f.body.neijin}+装${f.equip.neijin}`],
        ['吸血', fmtPct(f.blood), tipRatio(f.ratio.blood)],
        ['免伤', fmtPct(f.dmg_off), tipRatio(f.ratio.dmg_off)],
        ['穿甲', fmtPct(f.def_ign), tipRatio(f.ratio.def_ign)],
    ];
    el.innerHTML = (skillHint
        ? `<div class="final-skill-hint">${escapeHtml(skillHint)}</div>`
        : '') + items.map(([label, value, tip]) => `
        <div class="stat-cell final-cell">
            <span class="label">${escapeHtml(label)}</span>
            <span class="value accent">${escapeHtml(value)}</span>
            ${tip ? `<span class="sub">${escapeHtml(tip)}</span>` : ''}
        </div>
    `).join('');
}

function cell(label, value, accent = false) {
    return `<div class="stat-cell">
        <span class="label">${escapeHtml(label)}</span>
        <span class="value${accent ? ' accent' : ''}">${value}</span>
    </div>`;
}

function renderIdentity(role, tag) {
    const el = document.getElementById('roleIdentity');
    const items = [
        ['标签', escapeHtml(tag)],
        ['ID', escapeHtml(String(role.ID))],
        ['等级', `${num(role.Level)} / ${num(role.MaxLevel) || '—'}`],
        ['性别', SEX_NAMES[num(role.Sex)] || String(role.Sex ?? '—')],
        ['年龄', String(num(role.Age))],
        ['资质', `${escapeHtml(zzName(role.ZiZhi))}（${num(role.ZiZhi)}）`],
        ['资质经验', String(num(role.ZiZhiExp))],
        ['门派', escapeHtml(menpaiName(role.MenPai))],
        ['功力', String(num(role.GongLi))],
        ['修为点', `${num(role.Point)} / 累计 ${num(role.TotalPoint)}`],
        ['好感', String(num(role.Favour))],
        ['洗髓保底', `TalLucky ${num(role.TalLucky)}`],
    ];
    el.innerHTML = items.map(([k, v]) => cell(k, v)).join('');
}

function renderAttrs(role, partyRoles) {
    const el = document.getElementById('roleAttrs');
    const f = computeFinalStats(role, partyRoles);
    const rows = [
        { key: 'str', label: '臂力', panel: f.str, adj: f.combat.str, yi: f.yiChu.str },
        { key: 'con', label: '根骨', panel: f.con, adj: f.combat.con, yi: f.yiChu.con },
        { key: 'dex', label: '身法', panel: f.dex, adj: f.combat.dex, yi: f.yiChu.dex },
        { key: 'int', label: '内息', panel: f.int, adj: f.combat.int, yi: f.yiChu.int },
    ];
    el.innerHTML = `<table class="role-table">
        <thead>
            <tr>
                <th>属性</th><th>加点</th><th>出生</th><th>潜力</th><th>溢出上限</th><th>面板总值</th><th>溢出衰减</th>
            </tr>
        </thead>
        <tbody>
            ${rows.map(r => {
                const cap = r.key.charAt(0).toUpperCase() + r.key.slice(1);
                const raw = num(role[cap]);
                const born = num(role[`Born${cap}`]);
                const gift = num(role[`${cap}Gift`]);
                const limit = num(role.Level) + num(r.yi);
                const adjCls = r.panel !== r.adj ? ' est' : '';
                return `<tr>
                    <td>${r.label}</td>
                    <td class="num">${raw}</td>
                    <td class="num">${born}</td>
                    <td class="num">${gift}</td>
                    <td class="num">${limit}</td>
                    <td class="num est">${r.panel}</td>
                    <td class="num${adjCls}">${r.adj}</td>
                </tr>`;
            }).join('')}
        </tbody>
    </table>`;
}

function renderCombat(role) {
    const el = document.getElementById('roleCombat');
    const items = [
        ['气血附加', num(role.ExtHp), '叠进人物气血底数（根骨×系数+成长+此项）'],
        ['攻击附加', num(role.ExtAttack), '叠进人物攻击底数（臂力×系数+成长+此项）'],
        ['防御附加', num(role.ExtDefence), '叠进人物防御底数（等级成长+此项）'],
        ['命中附加', num(role.ExtHit), '叠进人物命中底数（90+等级成长+此项）'],
        ['闪避附加', num(role.ExtDodge), '叠进人物闪避底数（身法×系数+成长+此项）'],
        ['招架附加', num(role.ExtParry), '叠进人物招架底数（等级×1.2+30+此项）'],
        ['速度附加', num(role.ExtSpeed), '叠进人物速度底数（身法×系数+成长+此项）'],
        ['韧性附加', num(role.ExtRen), '叠进人物韧性底数（根骨×系数+此项）'],
        ['真元附加', num(role.ExtMpFirst), '叠进人物真元底数（内息×系数+此项）'],
        ['内劲附加', num(role.ExtNeijin), '永久增加内劲，参与内劲相关战斗判定'],
        ['罡气附加', num(role.ExtGangqi), '永久增加罡气，参与罡气相关战斗判定'],
    ];
    el.innerHTML = items.map(([k, v, tip]) => `
        <div class="stat-cell">
            <span class="label">${escapeHtml(k)}</span>
            <span class="value${v > 0 ? ' accent' : ''}">${v}</span>
            <span class="sub">${escapeHtml(tip)}</span>
        </div>
    `).join('');
}

function renderWeaponGifts(role) {
    const el = document.getElementById('roleWeaponGifts');
    const items = [
        ['拳脚', num(role.QuanGift)],
        ['刀法', num(role.DaoGift)],
        ['剑法', num(role.JianGift)],
        ['枪棍', num(role.GunGift)],
        ['内功', num(role.NGGift)],
        ['轻功', num(role.QGGift)],
    ];
    el.innerHTML = items.map(([k, v]) => cell(k, String(v))).join('');
}

function renderXiuwei(role) {
    const el = document.getElementById('roleXiuwei');
    if (!el) return;
    const rows = [
        { kind: 1, label: '拳脚', gift: 'QuanGift' },
        { kind: 2, label: '刀法', gift: 'DaoGift' },
        { kind: 3, label: '剑法', gift: 'JianGift' },
        { kind: 4, label: '枪棍', gift: 'GunGift' },
        { kind: 'ng', label: '内功', gift: 'NGGift' },
        { kind: 'qg', label: '轻功', gift: 'QGGift' },
    ];
    el.innerHTML = `<table class="role-table">
        <thead>
            <tr>
                <th>系</th><th>修为值</th><th>潜力</th><th>加成%</th>
            </tr>
        </thead>
        <tbody>
            ${rows.map(r => {
                const wxxw = getWXXW(role, r.kind);
                const gift = num(role[r.gift], 1);
                const add = getXWAdd(role, r.kind);
                return `<tr>
                    <td>${r.label}</td>
                    <td class="num">${wxxw}</td>
                    <td class="num">${gift}</td>
                    <td class="num est">${add.toFixed(3)}%</td>
                </tr>`;
            }).join('')}
        </tbody>
    </table>`;
}

function formatTalentEffectValue(v) {
    const n = Number(v);
    if (!Number.isFinite(n)) return String(v);
    if (Math.abs(n) > 0 && Math.abs(n) < 1) return `${Math.round(n * 100)}%`;
    return String(Math.floor(n * 1000 + 0.001) / 1000);
}

function formatTalentEffects(effects) {
    if (!Array.isArray(effects) || !effects.length) return '';
    return effects.map((row) => {
        if (!Array.isArray(row) || !row.length) return '';
        const [k, v, cap] = row;
        let s = `${k}+${formatTalentEffectValue(v)}`;
        if (cap != null && cap !== '') s += `(至多+${formatTalentEffectValue(cap)})`;
        return s;
    }).filter(Boolean).join(' · ');
}

const BATTLE_ATTR_NAMES = {
    con: '根骨', str: '臂力', dex: '身法', int: '内息',
    atk: '攻击', def: '防御', hit: '命中', speed: '速度',
    renxing: '韧性', mp: '真元',
    WXXW1: '拳修为', WXXW2: '刀修为', WXXW3: '剑修为', WXXW4: '枪修为',
    WXXWqg: '轻功修为', WXXWng: '内功修为',
};
const BATTLE_WEAPON_LIMIT = { 0: '无兵器限制', 1: '拳', 2: '刀', 3: '剑', 4: '枪棍' };

function resolveBattleEffectText(ef, role) {
    if (!Array.isArray(ef) || ef.length < 3) return '?';
    const [mode, attr, div] = ef;
    const f = computeFinalStats(role);
    const attrMap = {
        con: f.con, str: f.str, dex: f.dex, int: f.int,
        atk: f.atk, def: f.def, hit: f.hit, speed: f.speed,
        renxing: f.ren, mp: f.mp_first,
        WXXW1: num(role.WXXW1), WXXW2: num(role.WXXW2),
        WXXW3: num(role.WXXW3), WXXW4: num(role.WXXW4),
        WXXWqg: num(role.WXXWqg), WXXWng: num(role.WXXWng),
    };
    const base = attrMap[attr];
    if (base == null || div == null || div === 0) return '?';
    const m = Number(mode);
    const d = Number(div);
    if (m === -1 || m === 0) {
        const raw = Math.floor(base / d);
        return m === 0 ? `${raw}%` : String(raw);
    }
    const scaleKeys = ['atk', 'def', 'hit', 'speed', 'mp', 'renxing',
        'WXXW1', 'WXXW2', 'WXXW3', 'WXXW4', 'WXXWqg', 'WXXWng'];
    const scale = scaleKeys.includes(attr)
        ? (d * base + m) / m
        : (d - 1) * (2.2 * base / (400 + base)) + 1;
    const bonus = Math.floor(m * scale - m);
    const sign = bonus >= 0 ? '+' : '';
    if (m > -1 && m < 1) {
        return `${Math.round(m * 100)}%(${sign}${Math.round(bonus * 100)}%)`;
    }
    if (m === 1 || m === -1) return String(m + bonus);
    return `${m}(${sign}${bonus})`;
}

function formatBattleTalentEffects(cfg, role) {
    if (!cfg) return '';
    const parts = [];
    for (const key of ['effect1', 'effect2']) {
        const ef = cfg[key];
        if (!Array.isArray(ef) || ef.length < 3) continue;
        const [mode, attr, div] = ef;
        const attrName = BATTLE_ATTR_NAMES[attr] || attr;
        const resolved = role ? resolveBattleEffectText(ef, role) : '';
        const m = Number(mode);
        let meaning;
        if (m === -1) meaning = `描述{${key}}=${attrName}÷${div}`;
        else if (m === 0) meaning = `描述{${key}}=${attrName}÷${div}（百分比）`;
        else meaning = `描述{${key}}=基数${mode}×${attrName}成长(${div})`;
        parts.push(`${key}(${mode},${attr},${div}) ${meaning}${resolved ? `→${resolved}` : ''}`);
    }
    if (Array.isArray(cfg.sk1) && cfg.sk1.length) {
        parts.push(`sk1(${cfg.sk1.join(',')}) 战斗脚本/追击逻辑`);
    }
    if (cfg.limit != null && cfg.limit !== '') {
        const w = BATTLE_WEAPON_LIMIT[cfg.limit] || `类型${cfg.limit}`;
        parts.push(`limit+${cfg.limit} ※需装备${w}类兵器与武学`);
    }
    if (Array.isArray(cfg.req) && cfg.req.length) {
        parts.push(`req(${cfg.req.join(',')}) 关联招式#${cfg.req[0]}`);
    }
    return parts.join(' · ');
}

function resolveBattleDesc(cfg, role) {
    if (!cfg || !cfg.desc) return '';
    let desc = String(cfg.desc).replace(/\\n/g, '\n');
    for (const key of ['effect1', 'effect2']) {
        const token = `{${key}}`;
        if (!desc.includes(token)) continue;
        desc = desc.split(token).join(resolveBattleEffectText(cfg[key], role));
    }
    return desc;
}

function battleTalentInfo(id) {
    const cfg = (typeof BATTLE_TALENT_DATA !== 'undefined' && BATTLE_TALENT_DATA[String(id)]) || null;
    return cfg;
}

function talentRowHtml({ id, info, locked, tag, index, extraDesc, effectsText }) {
    const pz = info.pinzhi || 0;
    const pzTxt = tag === 'battle' ? '助战'
        : (PZ_NAMES[pz] || (tag === 'born' ? '先天' : '?'));
    const eff = effectsText != null ? effectsText : formatTalentEffects(info.effects);
    const lockTxt = tag === 'born' ? '先天'
        : (tag === 'battle' ? (info.canZhu ? '可助战' : '助战')
            : (locked ? '已锁定' : '未锁定'));
    const namePrefix = index != null ? `${index}. ` : '';
    const rowClass = tag === 'born' ? ' talent-born'
        : (tag === 'battle' ? ' talent-battle' : '');
    const pzClass = tag === 'battle' ? 'pz-battle'
        : (tag === 'born' ? 'pz-born' : `pz-${pz}`);
    return `<div class="talent-row${rowClass}">
        <span class="talent-pz ${pzClass}">${escapeHtml(pzTxt)}</span>
        <div>
            <div class="talent-name">${namePrefix}${escapeHtml(info.name)} <span class="wg-id">#${id}</span></div>
            <div class="talent-desc">${escapeHtml(extraDesc || info.desc || '—')}</div>
            ${eff ? `<div class="talent-effects">${escapeHtml(eff)}</div>` : ''}
        </div>
        <span class="talent-lock${locked || tag === 'born' || tag === 'battle' ? ' on' : ''}">${escapeHtml(lockTxt)}</span>
    </div>`;
}

function renderTalents(role) {
    const box = document.getElementById('roleTalents');
    const meta = document.getElementById('talentMeta');
    const list = Array.isArray(role.Talents) ? role.Talents : [];
    const zz = (typeof ZZ_DATA !== 'undefined' && ZZ_DATA[String(role.ZiZhi)]) || { num_talent: 0 };
    const born = role.BornTalent && role.BornTalent.ID != null ? role.BornTalent : null;
    const bornId = born ? num(born.ID) : 0;
    const bornInfo = bornId ? talentInfo(bornId) : null;
    const battle = bornId ? battleTalentInfo(bornId) : null;
    const canZhu = !!role.CanZhu;

    meta.textContent = [
        bornId ? `先天 1` : '无先天',
        battle ? `助战 1` : '无助战',
        `洗髓 ${list.length}/${zz.num_talent || 0}`,
        canZhu ? '可助战' : '',
    ].filter(Boolean).join(' · ');

    const parts = [];
    parts.push('<div class="talent-section-title">先天天赋</div>');
    if (bornId && bornInfo) {
        parts.push(talentRowHtml({
            id: bornId,
            info: { ...bornInfo, born: true },
            locked: !!(born.Lock),
            tag: 'born',
        }));
    } else {
        parts.push('<div class="role-empty talent-empty">无先天天赋</div>');
    }

    parts.push('<div class="talent-section-title">助战天赋</div>');
    if (battle) {
        parts.push(talentRowHtml({
            id: bornId,
            info: { name: battle.name, pinzhi: 0, desc: battle.desc, effects: [], canZhu },
            locked: false,
            tag: 'battle',
            extraDesc: resolveBattleDesc(battle, role),
            effectsText: '',
        }));
    } else {
        parts.push('<div class="role-empty talent-empty">无助战天赋（主角先天天赋通常无助战技）</div>');
    }

    parts.push('<div class="talent-section-title">洗髓天赋</div>');
    if (!list.length) {
        parts.push('<div class="role-empty talent-empty">无洗髓天赋</div>');
    } else {
        list.forEach((t, i) => {
            const id = num(t.ID != null ? t.ID : t.id);
            parts.push(talentRowHtml({
                id,
                info: talentInfo(id),
                locked: !!(t.Lock != null ? t.Lock : t.lock),
                tag: 'xisui',
                index: i + 1,
            }));
        });
    }
    box.innerHTML = parts.join('');
}

function equipMainStats(eq) {
    const rows = [
        ['攻击', equipCombatStat(eq, 'Atk', ['atk_add', 'atk'])],
        ['防御', equipCombatStat(eq, 'Def', ['def_add', 'def'])],
        ['命中', equipCombatStat(eq, 'Hit', ['hit_add', 'hit'])],
        ['气血', equipCombatStat(eq, 'Hp', ['hp_add', 'hp'])],
        ['速度', equipCombatStat(eq, 'Speed', ['speed_add', 'speed'])],
        ['闪避', equipCombatStat(eq, 'Dodge', ['dodge_add', 'dodge'])],
        ['招架', equipCombatStat(eq, 'Parry', ['parry_add', 'parry'])],
        ['韧性', equipCombatStat(eq, 'RenXing', ['renxing'])],
        ['内劲', equipNeijin(eq)],
        ['罡气', equipGangqi(eq)],
    ];
    const parts = rows.filter(([, v]) => v > 0).map(([label, v]) => `${label}${v}`);
    return parts.join(' / ') || '—';
}

function formatEquipExtraProps(eq) {
    const props = collectEquipProps(eq);
    if (!props.length) return '—';
    return props.map(p =>
        `<span class="prop-line">${escapeHtml(propLabel(p.prop))}+${escapeHtml(formatPropValue(p.prop, p.value))}</span>`
    ).join('');
}

function renderEquips(role) {
    const body = document.getElementById('roleEquips');
    const meta = document.getElementById('equipMeta');
    const list = Array.isArray(role.Equips) ? role.Equips : [];
    const gear = [];
    const fashion = [];
    for (const eq of list) {
        const cfg = equipCfg(eq.ID);
        if (isFashionType(cfg.type)) fashion.push(eq);
        else gear.push(eq);
    }
    meta.textContent = `装备 ${gear.length} · 服饰 ${fashion.length}`;
    if (!list.length) {
        body.innerHTML = '<tr><td colspan="6" class="empty-row">未穿戴</td></tr>';
        return;
    }
    const sorted = list.slice().sort((a, b) => {
        const ta = equipCfg(a.ID).type || 99;
        const tb = equipCfg(b.ID).type || 99;
        return ta - tb;
    });
    body.innerHTML = sorted.map(eq => {
        const cfg = equipCfg(eq.ID);
        const typ = TYPE_NAMES[cfg.type] || (cfg.type != null ? `部位${cfg.type}` : '未知');
        const name = cfg.name || `未知#${eq.ID}`;
        const isFash = isFashionType(cfg.type);
        const color = num(eq.Color, 1);
        const lvProp = num(eq.LvProp);
        const extTxt = isFash
            ? (cfg.origin_desc ? escapeHtml(cfg.origin_desc) : '外观')
            : formatEquipExtraProps(eq);
        const mainTxt = isFash ? '—' : escapeHtml(equipMainStats(eq));
        const colorTxt = isFash ? '外观' : (COLOR_NAMES[color] || color);
        const qhTxt = isFash ? '—' : `+${num(eq.Level)}${lvProp ? `(${lvProp})` : ''}`;
        return `<tr class="${isFash ? 'fashion-row' : ''}">
            <td>${escapeHtml(String(typ))}</td>
            <td class="${isFash ? '' : `color-${color}`}">${escapeHtml(name)}</td>
            <td class="${isFash ? 'fashion-tag' : `color-${color}`}">${escapeHtml(String(colorTxt))}</td>
            <td class="num">${escapeHtml(qhTxt)}</td>
            <td>${mainTxt}</td>
            <td>${extTxt}</td>
        </tr>`;
    }).join('');
}

function renderRole(entry) {
    if (!entry) {
        document.getElementById('roleEmpty').hidden = false;
        document.getElementById('rolePanel').hidden = true;
        return;
    }
    document.getElementById('roleEmpty').hidden = true;
    document.getElementById('rolePanel').hidden = false;
    const { role, tag } = entry;
    document.getElementById('roleName').textContent = role.Name || '无名';
    document.getElementById('roleTag').textContent = `${tag} · ID ${role.ID}`;
    renderIdentity(role, tag);
    let party = [role];
    if (saveData && saveData.Hezhao && Array.isArray(saveData.Hezhao.Roles)) {
        party = saveData.Hezhao.Roles;
    }
    renderFinalStats(role, party);
    renderAttrs(role, party);
    renderXiuwei(role);
    renderCombat(role);
    renderWeaponGifts(role);
    renderTalents(role);
    renderEquips(role);
}

function fillRoleSelect(filterText = '') {
    const sel = document.getElementById('roleSelect');
    const q = filterText.trim().toLowerCase();
    const prev = currentKey || sel.value;
    const list = saveRoles.filter(e => {
        if (!q) return true;
        const hay = `${e.tag} ${e.role.Name || ''} ${e.role.ID} ${e.key}`.toLowerCase();
        return hay.includes(q);
    });
    sel.innerHTML = '';
    if (!list.length) {
        sel.innerHTML = '<option value="">（无匹配角色）</option>';
        renderRole(null);
        return;
    }
    for (const e of list) {
        const opt = document.createElement('option');
        opt.value = e.key;
        const zz = zzName(e.role.ZiZhi);
        opt.textContent = `${e.tag} · ${e.role.Name || '无名'} · Lv${num(e.role.Level)} · ${zz}`;
        sel.appendChild(opt);
    }
    const pick = list.find(e => e.key === prev) || list[0];
    sel.value = pick.key;
    currentKey = pick.key;
    renderRole(pick);
}

function loadSaveData(json) {
    saveData = json;
    saveRoles = collectSaveRoles(json);
    if (!saveRoles.length) {
        throw new Error('存档中未找到角色（MainRole / Roles / Leavers）');
    }
    const nMain = saveRoles.filter(e => e.tag === '主角').length;
    const nRole = saveRoles.filter(e => e.tag === '随从').length;
    const nLeave = saveRoles.filter(e => e.tag === '离队').length;
    document.getElementById('saveStatus').textContent = '导入成功';
    if (typeof renderArchiveState === 'function') renderArchiveState(json);
    document.getElementById('roleSelectRow').hidden = false;
    document.getElementById('roleFilter').value = '';
    const preferred =
        saveRoles.find(e => e.tag === '主角') ||
        saveRoles[0];
    currentKey = preferred.key;
    fillRoleSelect('');
}

async function handleSaveFile(file) {
    if (typeof _importFeedback === 'function') _importFeedback(true);
    let json;
    try {
        if (typeof decryptSaveFile === 'function') {
            const r = await decryptSaveFile(file);
            json = r.data;
            if (typeof saveShareStore === 'function') {
                saveShareStore(json, {
                    version: r.version, platform: r.platform,
                    channel: r.channel || (String(r.platform || '').toLowerCase() === 'oversea' ? '国际服' : ''),
                    format: r.format || 'json', columns: r.columns || null, row: r.row || null,
                });
            }
        } else {
            const text = await file.text();
            const raw = JSON.parse(text.replace(/^\uFEFF/, '').trim());
            const entry = Array.isArray(raw) ? raw[0] : raw;
            if (entry && (entry.content || entry.encrypted)) {
                json = wasmDecryptSave(entry.content || entry.encrypted);
            } else {
                json = raw;
            }
        }
    } catch (e) {
        if (typeof _importFeedback === 'function') _importFeedback(false);
        throw new Error('存档解析失败: ' + (e.message || e));
    }
    if (typeof _importFeedback === 'function') _importFeedback(false);
    loadSaveData(json);
}

async function initApp() {
    if (typeof markNavTransition === 'function') {
        document.querySelectorAll('header a[href*=".html"]').forEach(a => {
            a.addEventListener('click', () => markNavTransition());
        });
    }

    const ok = await initWasm();
    if (!ok) {
        alert('WASM 加载失败：角色数值计算不可用（存档导入与解密不受影响）');
        return;
    }
    if (typeof loadShareStore === 'function') {
        const shared = loadShareStore();
        if (shared && shared.data) {
            try {
                loadSaveData(shared.data);
            } catch (e) {
                console.warn('自动加载共享存档失败:', e);
            }
        }
    }
    document.getElementById('roleSelect').addEventListener('change', (e) => {
        currentKey = e.target.value;
        const entry = saveRoles.find(r => r.key === currentKey);
        renderRole(entry || null);
    });
    document.getElementById('roleFilter').addEventListener('input', (e) => {
        fillRoleSelect(e.target.value);
    });
}

document.addEventListener('DOMContentLoaded', initApp);
setTimeout(function () { if (typeof prewarmSql === 'function') prewarmSql(); }, 200);
