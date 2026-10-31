var state = {
    mode: 'seed',
    zizhi: 153,
    sex: 1,
    vip: 1,
    seed: 2000548318,
    luckSeed: 0,
    luckSeedInited: false,
    roleId: 10044,
    salt: 278440,
    talents: [],
    talLucky: 0,
    dlcMode: false,
    totalWash: 0,
    totalTalentBars: 0,
    totalPills: 0,
    bagPills: 0,
    hasBagPills: false,
    goldCount: 0,
    pityCount: 0,
    qualityCounts: { 1: 0, 2: 0, 3: 0, 4: 0 },
    washHistory: [],
    lastPurpleTotalPills: null,
    exchangeCount: 0,
    saveData: null,
    strGift: 0,
    conGift: 0,
    dexGift: 0,
    intGift: 0,
    roleLevel: 90,
    roleRaw: null,
    saveRoles: [],
    roleStats: { str_val: 0, dex: 0, con: 0, int_val: 0 },
    globalVars: {},
    saveChannel: '',
    bornTalentRC: 0,
};


/* ── 操作日志录制器（复现手动洗脉过程） ─────────────────────────── */
/* ── 操作日志录制器 ─────────────────────────────────────────── */
// 日志 = 动作平铺序列；每个动作 1:1 对应你的一次点击
// 动作：{type:'wash',count} | {type:'lock',name} | {type:'unlock',name}
let opRecorder = {
    active: false,
    paused: false,  // 用户手动暂停记录（不影响 state，只跳过日志写入）
    steps: [],      // 已完成步骤 [{actions:[], seq:null}]
    current: null,  // 进行中的步骤
};
/** 进度存档槽（默认显示 3 个，可点「添加存档」逐行增加，最多 10 个）
 *  [{state, recorder, savedAt, desc} | null, ...]
 *  存档 = 同时快照「游戏状态 + 操作日志」；回档 = 两者一起回滚 */
const OP_SNAPSHOT_MAX_SLOTS = 10;
let opSnapshots = new Array(OP_SNAPSHOT_MAX_SLOTS).fill(null);

function opRecordStatus() {
    const el = document.getElementById('opRecordStatus');
    if (!el) return;
    const stepCount = opRecorder.steps.length + (opRecorder.current?.actions?.length ? 1 : 0);
    const actCount = opRecorder.current?.actions?.length || 0;
    let tag = '';
    if (opRecorder.active && opRecorder.paused) tag = ' · 【已暂停，操作不记录】';
    el.textContent = opRecorder.active
        ? `记录中 · 第 ${stepCount} 步 · 本步 ${actCount} 动作${tag}`
        : (stepCount ? `已停止 · 共 ${stepCount} 步` : '未开始');
    // 暂停按钮文案切换
    const btnP = document.getElementById('btnOpRecordPause');
    if (btnP) {
        btnP.textContent = opRecorder.paused ? '继续记录' : '暂停记录';
        btnP.classList.toggle('btn-pause-active', !!opRecorder.paused);
    }
}

/** 切换暂停状态（不影响游戏引擎，只暂停日志记录） */
function opRecordTogglePause() {
    if (!opRecorder.active) return;
    opRecorder.paused = !opRecorder.paused;
    opRecordStatus();
}

function opRecordStart() {
    opRecorder.active = true;
    opRecorder.steps = [];
    opRecorder.current = { actions: [], seq: null };
    const s = document.getElementById('btnOpRecordStart');
    const t = document.getElementById('btnOpRecordStop');
    const p = document.getElementById('btnOpRecordPause');
    const w = document.getElementById('btnOpRecordWriteSeq');
    const d = document.getElementById('btnOpRecordDownload');
    if (s) s.disabled = true;
    if (t) t.disabled = false;
    if (p) p.disabled = false;
    if (w) w.disabled = false;
    if (d) d.disabled = true;
    opRecorder.paused = false;   // 开始时强制未暂停
    opRecordStatus();
}

function opRecordStop() {
    if (opRecorder.current && opRecorder.current.actions.length) {
        opRecorder.steps.push(opRecorder.current);
        opRecorder.current = null;
    }
    opRecorder.active = false;
    const s = document.getElementById('btnOpRecordStart');
    const t = document.getElementById('btnOpRecordStop');
    const p = document.getElementById('btnOpRecordPause');
    const w = document.getElementById('btnOpRecordWriteSeq');
    const d = document.getElementById('btnOpRecordDownload');
    if (s) s.disabled = false;
    if (t) t.disabled = true;
    if (p) p.disabled = true;
    if (w) w.disabled = true;
    if (d) d.disabled = opRecorder.steps.length === 0;
    opRecorder.paused = false;   // 结束时清清
    opRecordStatus();
}

/** 连续洗髓合并成一个动作 */
function opRecordWash(count) {
    if (!opRecorder.active) return;
    if (!opRecorder.current) opRecorder.current = { actions: [], seq: null };
    const n = Math.max(0, Math.trunc(Number(count) || 0));
    if (n <= 0) return;
    const last = opRecorder.current.actions[opRecorder.current.actions.length - 1];
    if (last && last.type === 'wash') last.count += n;
    else opRecorder.current.actions.push({ type: 'wash', count: n });
    opRecordStatus();
}

/** nowLocked = 切换后状态（true 锁定 / false 解锁） */
function opRecordToggle(index, nowLocked) {
    if (!opRecorder.active || opRecorder.paused) return;
    if (!opRecorder.current) opRecorder.current = { actions: [], seq: null };
    const t = state.talents[index];
    if (!t) return;
    const td = TALENT_DATA[String(t.id)];
    opRecorder.current.actions.push({
        type: nowLocked ? 'lock' : 'unlock',
        name: td?.name || '未知天赋',
        slot: index + 1,
    });
    opRecordStatus();
}

/** 单步 → 文本（动作平铺，逗号分隔；天赋用原名，不加「脉」后缀） */
function opRecordStepText(s) {
    return (s.actions || []).map(a => {
        if (a.type === 'wash') return `洗髓${a.count}次`;
        if (a.type === 'exchange') {
            const tag = `置换槽位${a.slot}`;
            return (a.from && a.to) ? `${tag}(${a.from}→${a.to})` : tag;
        }
        const nm = String(a.name || '');
        if (a.type === 'lock') return `锁定${nm}`;
        return `取消锁定${nm}`;
    }).join('，');
}

/** 日志里的天赋名 → TALENT_DATA 真实名（兼容带「脉」后缀的旧日志） */
function opResolveTalentName(raw) {
    const s = String(raw || '').trim();
    if (!s) return s;
    const hit = (n) => {
        for (const key of Object.keys(TALENT_DATA || {})) {
            if (TALENT_DATA[key] && TALENT_DATA[key].name === n) return n;
        }
        return null;
    };
    const exact = hit(s);
    if (exact) return exact;
    if (s.endsWith('脉')) {
        const stripped = s.slice(0, -1);
        const sHit = hit(stripped);
        if (sHit) return sHit;
    }
    return s;
}

function opRecordSeqCount() {
    const el = document.getElementById('opRecordSeqCount');
    let n = Math.trunc(Number(el?.value ?? 15));
    if (!Number.isFinite(n)) n = 15;
    return Math.max(1, Math.min(50, n));
}

/** 当前位置往后 N 条「保底紫」。
 *  数据源 = 紫脉脉序与置换推演表格用的 cachedPurpleData（同一份，保证与界面一致）。
 *  只取 was_pity 为真的条目（与表里「保底」标记同源）。不够时自动 loadMoreSequence 扩展。 */
function opRecordPurpleNames(count) {
    const cleanName = p => String((p && p.talent_name) || '').trim();
    const isPity = p => !!(p && (p.was_pity === true || Number(p.was_pity) === 1));
    const collect = () => {
        const curBars = Number(state.totalTalentBars) || 0;
        return (cachedPurpleData.purples || [])
            .filter(p => Number(p.wash_no) > curBars && isPity(p))
            .slice(0, count)
            .map(cleanName)
            .filter(Boolean);
    };

    ensurePurpleSequenceCache();
    let names = collect();
    // 保底紫约每 850 洗一条，缓存可能不够；同步扩展（每次 +3000，最多 8 轮）
    // 注意：不能直接调 loadMoreSequence()，它内部走 requestAnimationFrame，同步循环里拿不到新缓存
    let guard = 0;
    while (names.length < count && guard < 8) {
        guard += 1;
        currentMaxWashes += 3000;
        ensurePurpleSequenceCache({ force: true });
        names = collect();
    }
    if (names.length < count) {
        console.warn(`[op-record] 只取到 ${names.length}/${count} 条保底紫（已扩展至 ${currentMaxWashes} 洗）`);
    }
    return names;
}

/**「写入置换序列」= 结束当前步 + 抓取序列 + 自动开新步 */
function opRecordWriteSeq() {
    if (!opRecorder.active) { alert('请先点「开始记录」。'); return; }
    const names = opRecordPurpleNames(opRecordSeqCount());
    if (!names.length) {
        alert('当前位置往后未取到保底紫序列，请先洗髓或检查存档状态。');
        return;
    }
    let dupIndex = 0;
    for (let i = 0; i < opRecorder.steps.length; i++) {
        const w = opRecorder.steps[i].seq;
        if (w && w.isNew && w.names.length === names.length && w.names.every((n, k) => n === names[k])) {
            dupIndex = i + 1;
            break;
        }
    }
    const seq = { isNew: !dupIndex, dupIndex, names };
    if (opRecorder.current && opRecorder.current.actions.length) {
        opRecorder.current.seq = seq;
        opRecorder.steps.push(opRecorder.current);
    } else {
        opRecorder.steps.push({ actions: [], seq });
    }
    opRecorder.current = { actions: [], seq: null };
    opRecordStatus();
}

function buildOpRecordText() {
    const lines = [];
    const all = opRecorder.steps.slice();
    if (opRecorder.current && opRecorder.current.actions.length) all.push(opRecorder.current);
    all.forEach((s, i) => {
        lines.push(`${i + 1}，${opRecordStepText(s)}；`);
        if (s.seq) {
            lines.push(s.seq.isNew ? `置换序列：${s.seq.names.join(' ')}` : `置换序列：重复${s.seq.dupIndex}`);
        }
    });
    return lines.join('\n');
}

/* ── 进度存档 / 回档（3 槽，类似单机游戏多存档） ─────────────── */
/** 存档：同时快照「游戏状态 + 操作日志」 */
function opSaveSnapshotSlot(slot) {
    const i = Number(slot);
    if (!(i >= 0 && i < OP_SNAPSHOT_MAX_SLOTS)) return;
    const descEl = document.getElementById(`opSnapshotDesc${i}`);
    const desc = String(descEl?.textContent || '').replace(/\s+/g, ' ').trim().slice(0, 100);
    try {
        opSnapshots[i] = {
            state: JSON.parse(JSON.stringify(state)),
            recorder: JSON.parse(JSON.stringify({
                active: opRecorder.active,
                steps: opRecorder.steps,
                current: opRecorder.current,
                startPills: opRecorder.startPills,
            })),
            savedAt: `洗 ${state.totalWash} 次 · 脉序 #${state.totalTalentBars}`,
            desc,
        };
    } catch (e) {
        alert('存档失败：' + (e?.message || '状态序列化错误'));
        return;
    }
    renderOpSnapshotSlots();
}

/** 回档：游戏状态 + 操作日志一起回滚到存档那一刻，之后可继续记录 */
function opRestoreSnapshotSlot(slot) {
    const i = Number(slot);
    if (!(i >= 0 && i < OP_SNAPSHOT_MAX_SLOTS)) return;
    const snap = opSnapshots[i];
    if (!snap) { alert('该存档为空，请先点「存档」。'); return; }

    // 回档二次确认：点「取消」则完全不回滚，给误点一次反悔的机会
    const restoreTip = `确定回档到 存档${i + 1}（${snap.savedAt}${snap.desc ? ' · ' + snap.desc : ''}）？\n回档会同时回滚游戏状态与操作日志，且不可撤销。`;
    if (!confirm(restoreTip)) return;

    // ① 回滚游戏状态
    const saved = JSON.parse(JSON.stringify(snap.state));
    Object.keys(state).forEach(k => { delete state[k]; });
    Object.assign(state, saved);

    // ② 回滚操作日志（含 startPills，保证「本次记录消耗」一致）
    const rec = JSON.parse(JSON.stringify(snap.recorder));
    opRecorder.active = rec.active;
    opRecorder.steps = rec.steps || [];
    opRecorder.current = rec.current || null;
    opRecorder.startPills = rec.startPills || 0;

    // ③ 同步引擎与界面
    try { pushStateToWasm(); } catch (_) {}
    try { if (typeof invalidatePurpleCache === 'function') invalidatePurpleCache(); } catch (_) {}
    try { if (typeof renderHistoryPage === 'function') renderHistoryPage(); } catch (_) {}
    try { updateAll(); } catch (_) {}
    opRecordStatus();
    alert(`已回档到：${snap.savedAt}${snap.desc ? '\n' + snap.desc : ''}`);
}

/** 描述框（contenteditable div）行为：限 100 字、粘贴纯文本、禁回车换行 */
function initOpSnapshotDesc() {
    for (let i = 0; i < OP_SNAPSHOT_MAX_SLOTS; i++) {
        const el = document.getElementById(`opSnapshotDesc${i}`);
        if (!el) continue;
        const max = Number(el.dataset.maxlength) || 100;
        // 输入前：已达上限且未选中文本 → 阻止
        el.addEventListener('beforeinput', (e) => {
            if (!e.data) return;
            const sel = window.getSelection();
            const hasSel = sel && String(sel).length > 0;
            if (el.textContent.length >= max && !hasSel) e.preventDefault();
        });
        // 粘贴：只取纯文本并截断到剩余额度
        el.addEventListener('paste', (e) => {
            e.preventDefault();
            const text = (e.clipboardData || window.clipboardData)?.getData('text') || '';
            const room = Math.max(0, max - el.textContent.length);
            if (room > 0) document.execCommand('insertText', false, text.slice(0, room));
        });
        // 回车不换行（保持单行语义）
        el.addEventListener('keydown', (e) => {
            if (e.key === 'Enter') e.preventDefault();
        });
    }
}

/** 面板内真实的存档槽行（排除「添加存档」按钮行） */
function opSnapshotSlotRows() {
    const panel = document.getElementById('opSnapshotPanel');
    if (!panel) return [];
    return Array.prototype.slice.call(
        panel.querySelectorAll('.op-snapshot-slot:not(.op-snapshot-add-row)')
    );
}

/** 显示下一行存档槽（默认 3 行，最多 10 行） */
function opAddSnapshotSlot() {
    const rows = opSnapshotSlotRows();
    const next = rows.find(r => r.style.display === 'none');
    if (!next) {
        alert(`最多只能有 ${OP_SNAPSHOT_MAX_SLOTS} 个进度存档。`);
        return;
    }
    next.style.display = '';
    renderOpSnapshotSlots();
}

/** 删除某个存档槽：清空存档与描述；若删的是添加出来的行，则连同尾部空行一起收起（与「添加」对称） */
function opDeleteSnapshotSlot(slot) {
    const i = Number(slot);
    if (!(i >= 0 && i < OP_SNAPSHOT_MAX_SLOTS)) return;
    const snap = opSnapshots[i];
    if (snap) {
        const tip = `确定删除 存档${i + 1}（${snap.savedAt}${snap.desc ? ' · ' + snap.desc : ''}）？`;
        if (!confirm(tip)) return;
    }
    opSnapshots[i] = null;
    const descEl = document.getElementById(`opSnapshotDesc${i}`);
    if (descEl) descEl.textContent = '';

    // 只收起「第 4 行起且尾部连续为空」的已显示行，避免中间断档（前 3 行常显）
    if (i >= 3) {
        const rows = opSnapshotSlotRows();
        for (let j = rows.length - 1; j >= 3; j--) {
            if (opSnapshots[j]) break;
            if (rows[j]) rows[j].style.display = 'none';
        }
    }
    renderOpSnapshotSlots();
}

function renderOpSnapshotSlots() {
    for (let i = 0; i < OP_SNAPSHOT_MAX_SLOTS; i++) {
        const snap = opSnapshots[i];
        const st = document.getElementById(`opSnapshotStatus${i}`);
        if (st) {
            st.textContent = snap
                ? `${snap.savedAt}${snap.desc ? ' · ' + snap.desc : ''}`
                : '空';
        }
        const rb = document.querySelector(`.btn-op-snapshot-restore[data-slot="${i}"]`);
        if (rb) rb.disabled = !snap;
    }
    // 「添加存档」按钮状态：已达上限则禁用
    const rows = opSnapshotSlotRows();
    const visibleCount = rows.filter(r => r.style.display !== 'none').length;
    const addBtn = document.getElementById('btnOpSnapshotAdd');
    if (addBtn) addBtn.disabled = visibleCount >= rows.length;
    const hint = document.getElementById('opSnapshotAddHint');
    if (hint) {
        hint.textContent = visibleCount >= rows.length
            ? `已达上限 ${rows.length} / ${OP_SNAPSHOT_MAX_SLOTS}`
            : `已显示 ${visibleCount} / ${OP_SNAPSHOT_MAX_SLOTS}`;
    }
}

/* ── 日志回放（先内置固定日志验证机制） ─────────────────────────── */
const OP_REPLAY_LOG = `1，洗髓0次，锁定初生牛犊，洗髓3次，取消锁定初生牛犊；
2，洗髓3次，锁定皮糙肉厚，洗髓2次，取消锁定皮糙肉厚；
3，洗髓7次，锁定孔武有力，洗髓3次，取消锁定孔武有力；
4，洗髓1次，锁定初生牛犊，洗髓2次，取消锁定初生牛犊；
5，洗髓0次，锁定根骨略优，洗髓3次，取消锁定根骨略优；
6，洗髓6次，锁定义冲云霄，洗髓1次，取消锁定义冲云霄；
7，洗髓0次，锁定初生牛犊，洗髓2次，取消锁定初生牛犊；
8，洗髓0次，锁定虎背熊腰，洗髓3次，取消锁定虎背熊腰；
9，洗髓1次，锁定猫眼，洗髓3次，取消锁定猫眼；
10，洗髓8次，锁定身轻如燕，洗髓3次，取消锁定身轻如燕；
11，洗髓2次，锁定洞若观火，洗髓4次，取消锁定洞若观火；
12，洗髓3次，锁定健步如飞，洗髓1次，取消锁定健步如飞；
13，洗髓0次，锁定浑身是胆，洗髓1次，取消锁定浑身是胆；
14，洗髓5次，锁定枪棍高手，洗髓2次，取消锁定枪棍高手；
15，洗髓0次，锁定味同鸡肋，洗髓2次，取消锁定味同鸡肋；`;

/** 解析日志文本 → {baseline:[], steps:[{no, wash1, lockNames[], wash2, unlock}]}
 *  支持：①「常锁：A，B」基线 ②一步多锁 ③末尾有「取消锁定」才解锁（没有=保持锁定） */
function opReplayParse(text) {
    const steps = [];
    for (const raw of String(text || '').split(/\r?\n/)) {
        const line = String(raw || '').trim();
        const m = /^(\d+)，(.+)；$/.exec(line);
        if (!m) continue;
        const actions = [];
        for (const part of String(m[2]).split('，')) {
            const t = String(part || '').trim();
            let mm;
            if ((mm = /^洗髓(\d+)次$/.exec(t))) actions.push({ type: 'wash', count: Number(mm[1]) });
            else if ((mm = /^取消锁定(.+)$/.exec(t))) actions.push({ type: 'unlock', name: opResolveTalentName(mm[1]) });
            else if ((mm = /^锁定(.+)$/.exec(t))) actions.push({ type: 'lock', name: opResolveTalentName(mm[1]) });
            else if ((mm = /^置换槽位(\d+)(?:\((.+?)→(.+?)\))?$/.exec(t))) actions.push({ type: 'exchange', slot: Number(mm[1]), from: mm[2] || '', to: mm[3] || '' });
        }
        steps.push({ no: Number(m[1]), actions });
    }
    return steps;
}

/** 执行到第 targetStep 步（从当前状态继续，不重置） */
/** 导入的日志文本；null = 用内置 OP_REPLAY_LOG（兼容旧测试） */
let opReplaySource = null;

function opReplayRun(targetStep) {
    const steps = opReplayParse(opReplaySource || OP_REPLAY_LOG);
    if (!steps.length) { alert('日志解析失败：未识别到任何步骤。'); return; }
    let n = Math.trunc(Number(targetStep));
    if (!Number.isFinite(n)) n = steps.length;
    n = Math.max(1, Math.min(steps.length, n));

    const done = [];
    const warns = [];
    for (let i = 0; i < n; i++) {
        const s = steps[i];
        for (const a of s.actions) {
            if (a.type === 'wash') {
                if (a.count > 0) washMulti(a.count);
            } else if (a.type === 'exchange') {
                // 置换：先校验槽位当前天赋是否与日志记录的「置换前」一致，避免误换
                const exIdx = Number(a.slot) - 1;
                if (!(exIdx >= 0 && exIdx < state.talents.length)) {
                    warns.push(`步骤${s.no}：置换槽位 ${a.slot} 越界`);
                    continue;
                }
                const curTd = TALENT_DATA[String(state.talents[exIdx]?.id)];
                const curName = curTd?.name || '';
                if (a.from && curName && curName !== a.from) {
                    warns.push(`步骤${s.no}：槽位${a.slot}当前是「${curName}」，日志记为「${a.from}」，跳过置换`);
                    continue;
                }
                exchangeTalent(exIdx);
            } else {
                const idx = findTalentSlotIndexByName(a.name);
                if (idx < 0) { warns.push(`步骤${s.no}：槽内无「${a.name}」`); continue; }
                const locked = !!state.talents[idx].locked;
                if (a.type === 'lock' && !locked) toggleLock(idx);
                else if (a.type === 'unlock' && locked) toggleLock(idx);
            }
        }
        done.push(`步骤${s.no}：${opRecordStepText({ actions: s.actions })}`);
    }
    updateAll();
    console.log('[op-replay] 完成', done);
    if (warns.length) console.warn('[op-replay] 警告', warns);
    const el = document.getElementById('opRecordStatus');
    if (el) {
        el.textContent = `已回放至步骤 ${n}/${steps.length}`
            + (warns.length ? ` · ${warns.length} 处跳过（详见 Console）` : '');
    }
}

function downloadOpRecord() {
    const all = opRecorder.steps.slice();
    if (opRecorder.current && opRecorder.current.actions.length) all.push(opRecorder.current);
    if (!all.length) { alert('暂无操作记录，请先点「开始记录」。'); return; }
    const d = new Date();
    const p = v => String(v).padStart(2, '0');
    const stamp = `${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}-${p(d.getHours())}${p(d.getMinutes())}`;
    triggerFileDownload(`操作日志_${stamp}.txt`, buildOpRecordText());
}

function pushStateToWasm() {
    syncStateToWasm(state);
}

/** 拍摄「导入存档那一刻」的 wasm 形状快照（角色成型/重置时调用），供「原始脉序」固定起点用 */
function captureImportSnapshot() {
    state.importSnapshot = {
        mode: state.mode,
        zizhi: state.zizhi,
        sex: state.sex,
        vip: state.vip,
        seed: state.seed,
        luck_seed: state.luckSeed,
        luck_seed_inited: state.luckSeedInited,
        role_id: state.roleId,
        salt: state.salt,
        talents: JSON.parse(JSON.stringify(state.talents || [])),
        tal_lucky: state.talLucky,
        total_wash: 0,
        total_talent_bars: 0,
        total_pills: 0,
        bag_pills: state.bagPills,
        has_bag_pills: state.hasBagPills,
        gold_count: 0,
        pity_count: 0,
        quality_counts: { 1: 0, 2: 0, 3: 0, 4: 0 },
        last_purple_total_pills: null,
        exchange_count: 0,
        str_gift: state.strGift,
        con_gift: state.conGift,
        dex_gift: state.dexGift,
        int_gift: state.intGift,
        role_level: state.roleLevel,
        role_stats: state.roleStats || { str_val: 0, dex: 0, con: 0, int_val: 0 },
        global_vars: state.globalVars || {},
        born_talent_rc: Number(state.bornTalentRC) || 0,
        save_channel: state.saveChannel || '',
    };
}

function pullStateFromWasm() {
    const bagPills = state.bagPills;
    const hasBagPills = state.hasBagPills;
    syncStateFromWasm(state);
    state.bagPills = bagPills;
    state.hasBagPills = hasBagPills;
}

function computeRoleStats() {
    const role = state.roleRaw;
    if (!role) {
        state.roleStats = { str_val: 0, dex: 0, con: 0, int_val: 0 };
        return;
    }
    const GIFT_COEF = 0.00006;
    function baseAttr(key) {
        const cap = key.charAt(0).toUpperCase() + key.slice(1);
        const raw = Number(role[cap === 'Str' ? 'Str' : cap] || 0);
        const born = Number(role[`Born${cap}`] || 0);
        const gift = Number(role[`${cap}Gift`] || 0);
        return Math.floor((raw + born) * (1.0 + GIFT_COEF * gift));
    }
    state.roleStats = {
        str_val: baseAttr('str'),
        dex: baseAttr('dex'),
        con: baseAttr('con'),
        int_val: baseAttr('int'),
    };
}

function extractGlobalVars() {
    const gv = state.saveData && state.saveData.globalVariable;
    state.globalVars = gv || {};
}

function getZZConfig() {
    const zz = ZZ_DATA[String(state.zizhi)] || ZZ_DATA["153"];
    if (state.dlcMode) return { ...zz, zz_name: zz.zz_name || zz.name, bd_zz: 300 };
    return { ...zz, zz_name: zz.zz_name || zz.name };
}


function _buildZZDataForWasm() {
    if (!state.dlcMode) return ZZ_DATA;
    const out = {};
    for (const k of Object.keys(ZZ_DATA)) {
        out[k] = { ...ZZ_DATA[k], bd_zz: 300 };
    }
    return out;
}

function applyDlcMode(checked) {
    state.dlcMode = !!checked;
    if (typeof wasmInitEngine === 'function') {
        wasmInitEngine(TALENT_DATA, _buildZZDataForWasm());
        if (typeof pushStateToWasm === 'function') pushStateToWasm();
    }
    if (typeof invalidatePurpleCache === 'function') invalidatePurpleCache();
    renderPityBar();
    renderCostInfo();
}

function normalizeSaveChannel(channel, platform) {
    const resolved = String(channel || '').trim();
    if (resolved) return resolved;
    return String(platform || '').trim().toLowerCase() === 'oversea' ? '国际服' : '';
}

function _applyDlcByPlatform(platform) {
    const isTest = platform === 'test';
    const row = document.getElementById('dlcRow');
    const check = document.getElementById('dlcModeCheck');
    if (row) row.style.display = isTest ? '' : 'none';
    if (check) check.checked = isTest;
    applyDlcMode(isTest);
}

function _dlcLuckyBonus() {
    if (!state.dlcMode) return 0;
    const locked = state.talents.filter(t => t.locked).length;
    return Math.max(1, 3 * locked);
}

function doWash() {
    const zzConfig = getZZConfig();
    if (zzConfig.num_talent === 0) return null;

    const lockedCount = state.talents.filter(t => t.locked).length;
    if (zzConfig.num_talent <= lockedCount) return null;

    const dlcBonus = _dlcLuckyBonus();
    if (dlcBonus > 0) state.talLucky += dlcBonus;

    pushStateToWasm();

    const raw = wasmDoWash();
    if (!raw) return null;

    pullStateFromWasm();

    return convertWashResult(raw);
}

function exchangeTalent(index) {
    pushStateToWasm();

    // 记录置换前的天赋名（用于操作日志回放校验）
    const beforeTd = TALENT_DATA[String(state.talents?.[index]?.id)];
    const beforeName = beforeTd?.name || '';

    const raw = wasmExchangeTalent(index);
    if (!raw) return;

    const result = convertExchangeResult(raw);
    if (!result.success) {
        alert(result.error || '置换失败');
        return;
    }

    pullStateFromWasm();
    opRecordExchange(index, beforeName);
    addLogEntry(result);
    updateAll();
}

/** 记录置换动作：槽位 + 置换前后天赋名 */
function opRecordExchange(index, beforeName) {
    if (!opRecorder.active || opRecorder.paused) return;
    if (!opRecorder.current) opRecorder.current = { actions: [], seq: null };
    const t = state.talents[index];
    const td = t ? TALENT_DATA[String(t.id)] : null;
    opRecorder.current.actions.push({
        type: 'exchange',
        slot: index + 1,
        from: String(beforeName || '').trim(),
        to: td?.name || '',
    });
    opRecordStatus();
}


function getQualityClass(weight) {
    return `q${weight}`;
}

function isShenmaiTalentData(talent) {
    if (!talent) return false;
    const id = Number(talent.id);
    return id === 248 || id === 249 || id === 250 || Number(talent.type) === 248;
}

function analyzeTalentConflicts() {
    const shenmaiEntries = [];
    state.talents.forEach((slot, index) => {
        const talent = TALENT_DATA[String(slot.id)];
        if (isShenmaiTalentData(talent)) shenmaiEntries.push({ index, id: Number(slot.id) });
    });
    // 神脉互冲：场上至少存在两条「不同 id」的神脉（混元/玄阳/九阴 互冲），
    // 两条同名神脉（如同名九阴鬼脉）不算互冲、也不给置换按钮。
    const distinctShenmaiIds = new Set(shenmaiEntries.map(e => e.id));
    const multiShenmai = distinctShenmaiIds.size >= 2;

    const seenType = {};
    const conflicts = [];

    // 普通冲突脉必须提前准备并排在紫脉之前，与搜索／回放内核保持一致。
    const findLockedConflict = (selfIndex, typ) => {
        for (let k = 0; k < selfIndex; k += 1) {
            const otherSlot = state.talents[k];
            const other = TALENT_DATA[String(otherSlot.id)];
            if (!other || Number(other.type) !== Number(typ)) continue;
            if (isShenmaiTalentData(other)) continue;
            if (other.weight >= 4 || other.pinzhi >= 4) continue;
            if (!otherSlot.locked) continue;
            return { index: k, name: other.name };
        }
        return null;
    };

    state.talents.forEach((slot, index) => {
        const talent = TALENT_DATA[String(slot.id)];
        if (!talent || talent.type == null) {
            conflicts.push(null);
            return;
        }
        const typ = talent.type;
        const isPurple = (talent.weight >= 4 || talent.pinzhi >= 4);

        if (isShenmaiTalentData(talent) && multiShenmai) {
            // 只与「不同 id」的神脉配对，避免同名神脉互相误判为互冲
            const partner = shenmaiEntries.find(e => e.index !== index && e.id !== Number(slot.id));
            if (partner) {
                const partnerTalent = TALENT_DATA[String(state.talents[partner.index].id)];
                conflicts.push({
                    index,
                    earlierIndex: partner.index,
                    earlierName: partnerTalent ? partnerTalent.name : '神脉',
                    canExchange: true,
                    shenmaiMutual: true,
                });
                if (seenType[typ] === undefined) seenType[typ] = index;
                return;
            }
            // 找不到不同名神脉伙伴（如场上只有同名神脉）：按无冲突处理，但仍登记其类型
            seenType[typ] = index;
            conflicts.push(null);
            return;
        }

        // 普通紫脉只借前面同类型、非紫、已锁定的脉置换。
        if (isPurple && !isShenmaiTalentData(talent)) {
            const partner = findLockedConflict(index, typ);
            if (partner) {
                conflicts.push({
                    index,
                    earlierIndex: partner.index,
                    earlierName: partner.name,
                    canExchange: true,
                    shenmaiMutual: false,
                });
                if (seenType[typ] === undefined) seenType[typ] = index;
                return;
            }
        }

        if (seenType[typ] !== undefined) {
            const earlier = seenType[typ];
            const earlierTalent = TALENT_DATA[String(state.talents[earlier].id)];
            const earlierIsPurple = earlierTalent
                ? (earlierTalent.weight >= 4 || earlierTalent.pinzhi >= 4)
                : false;
            const earlierLocked = !!state.talents[earlier]?.locked;
            const canExchange = isPurple
                && (isShenmaiTalentData(talent) || (!earlierIsPurple && earlierLocked));
            conflicts.push({
                index,
                earlierIndex: earlier,
                earlierName: earlierTalent ? earlierTalent.name : '未知',
                canExchange,
                shenmaiMutual: false,
            });
        } else {
            seenType[typ] = index;
            conflicts.push(null);
        }
    });
    return conflicts;
}

function renderTalents() {
    const container = document.getElementById('talentSlots');
    const zzConfig = getZZConfig();
    const maxSlots = zzConfig.num_talent;

    if (maxSlots === 0) {
        container.innerHTML = '<div class="talent-card empty"><span style="color:var(--text-muted)">此资质无天赋槽位</span></div>';
        return;
    }

    const shown = state.talents.slice(0, maxSlots);
    const conflicts = analyzeTalentConflicts();

    // 计算每洗一次的洗髓丹消耗（与 renderCostInfo 同步）
    const lockedCount = (state.talents || []).filter(t => t && t.locked).length;
    let costPerWash = Number(zzConfig.eat_xisui) || 3;
    if (lockedCount > 0) costPerWash = costPerWash + 2 * lockedCount - 1;

    // 用 wasm 的 firstPityJumpCandidates 一次性推演：candidates[].firstDuplicateWashTimes
    // = 「再点 X 次洗髓可吞掉」（与「置换脉序查找」里显示的是同一份数据）。
    const nextDupWashes = {}; // index → 下次同名间隔（洗数），0 表示本条暂无后续同名
    try {
        if (typeof wasmFirstPityJumpCandidates === 'function') {
            const snapshot = {
                mode: 'seed',
                zizhi: Number(state.zizhi) || 153,
                sex: Number(state.sex) || 1,
                vip: Number(state.vip) || 0,
                seed: Number(state.seed) || 0,
                luck_seed: Number(state.luckSeed) || 0,
                luck_seed_inited: !!state.luckSeedInited,
                role_id: Number(state.roleId) || 0,
                salt: Number(state.saveData?.CenterID || state.salt || 278440) % 1000000,
                talents: (state.talents || []).map(t => ({
                    id: Number(t?.id) || 0,
                    locked: !!t?.locked,
                })).filter(t => t.id > 0),
                tal_lucky: Number(state.talLucky) || 0,
                total_wash: Number(state.totalWash) || 0,
                total_talent_bars: Number(state.totalTalentBars) || 0,
                total_pills: Number(state.totalPills) || 0,
                bag_pills: Number(state.bagPills) || 0,
                has_bag_pills: !!state.hasBagPills,
                gold_count: Number(state.goldCount) || 0,
                pity_count: Number(state.pityCount) || 0,
                quality_counts: state.qualityCounts || { 1: 0, 2: 0, 3: 0, 4: 0 },
                last_purple_total_pills: state.lastPurpleTotalPills ?? null,
                exchange_count: Number(state.exchangeCount) || 0,
                str_gift: Number(state.strGift) || 0,
                con_gift: Number(state.conGift) || 0,
                dex_gift: Number(state.dexGift) || 0,
                int_gift: Number(state.intGift) || 0,
                role_level: Number(state.roleLevel) || 90,
                role_stats: state.roleStats || {},
                global_vars: state.globalVars || state.saveData?.globalVariable || {},
                born_talent_rc: Number(state.bornTalentRC) || 0,
                save_channel: state.saveChannel || '',
            };
            const analysis = wasmFirstPityJumpCandidates(snapshot);
            const candidates = (analysis && analysis.candidates) || [];
            // 调试日志已移除（避免 Console 刷屏）
            for (let i = 0; i < shown.length; i++) {
                const t = shown[i];
                if (!t || !t.id) continue;
                const td = TALENT_DATA[String(t.id)];
                if (!td) continue;
                const quality = Number(td?.weight ?? td?.pinzhi) || 0;
                if (quality >= 4) continue; // 紫脉/神脉不参与统计
                const hit = candidates.find(c => Number(c.talentId) === Number(t.id));
                if (hit) {
                    // 间隔 = 两次同名脉出现之间的洗数（不是从当前状态算的"剩余距离"）
                    const occurrence = Math.max(0, Number(hit.occurrenceWashTimes) || 0);
                    const firstDup = Math.max(0, Number(hit.firstDuplicateWashTimes) || 0);
                    nextDupWashes[i] = Math.max(0, firstDup - occurrence);
                }
            }
        }
    } catch (err) {
        console.warn('[talent-next-dup] firstPityJumpCandidates 抛错：', err);
    }

    let html = '';

    for (let i = 0; i < shown.length; i++) {
        const t = shown[i];
        const talent = TALENT_DATA[String(t.id)];
        const qClass = talent ? getQualityClass(talent.weight) : 'q1';
        const lockedClass = t.locked ? 'locked' : '';
        const lockBtnClass = t.locked ? 'locked' : '';
        const lockText = t.locked ? '已锁定' : '锁定';
        const name = talent ? talent.name : '未知天赋';
        const desc = talent ? talent.desc : '数据表中无此天赋';
        const conflict = conflicts[i];
        const conflictClass = conflict ? ' conflict' : '';

        let conflictHtml = '';
        if (conflict) {
            if (conflict.shenmaiMutual) {
                conflictHtml = `<span class="talent-conflict" title="多神脉互冲：槽内每条神脉都可置换">互冲 · 另有${conflict.earlierName}</span>`;
            } else {
                conflictHtml = `<span class="talent-conflict" title="与「${conflict.earlierName}」同类型，本条不生效">冲突 · 前有${conflict.earlierName}</span>`;
            }
        }

        let exchangeBtn = '';
        if (conflict && conflict.canExchange && state.mode === 'seed') {
            exchangeBtn = `<button class="talent-exchange-btn" type="button" onclick="exchangeTalent(${i})">置换</button>`;
        }

        // 「下一同名脉间隔」描述：基于当前锁定状态估算总丹耗
        let nextDupHtml = '';
        const washes = nextDupWashes[i];
        if (washes && washes > 0) {
            const dan = washes * costPerWash;
            nextDupHtml = `<div class="talent-next-dup" title="基于当前锁定数估算：${washes} 洗 × ${costPerWash} 丹/洗">相邻两次同名间隔 ≈ ${dan} 丹（≈ ${washes} 次洗）</div>`;
        } else if (nextDupWashes[i] === 0) {
            // 0 = wasm 已查询但当前推演范围内未出现同名脉；显示一行简短提示便于排查
            nextDupHtml = `<div class="talent-next-dup talent-next-dup-empty" title="预览推演范围内未出现同名脉">下一同名 · 推演暂无数据</div>`;
        }

        html += `
            <div class="talent-card ${qClass} ${lockedClass}${conflictClass} animate-in" style="animation-delay: ${i * 0.08}s">
                <div class="talent-main">
                    <span class="talent-name ${qClass}">${name}${conflict ? '<i class="talent-bang">!</i>' : ''}</span>
                    ${conflictHtml}
                    <span class="talent-desc">${desc}</span>
                    ${nextDupHtml}
                </div>
                <div class="talent-actions">
                    ${exchangeBtn}
                    <button class="talent-lock-btn ${lockBtnClass}" type="button" onclick="toggleLock(${i})">${lockText}</button>
                </div>
            </div>
        `;
    }

    for (let i = shown.length; i < maxSlots; i++) {
        html += '<div class="talent-card empty">空槽位</div>';
    }

    container.innerHTML = html;
}

function renderAptitudePanel() {
    document.getElementById('zzStr').textContent = state.strGift.toLocaleString();
    document.getElementById('zzCon').textContent = state.conGift.toLocaleString();
    document.getElementById('zzDex').textContent = state.dexGift.toLocaleString();
    document.getElementById('zzInt').textContent = state.intGift.toLocaleString();

    const total = state.strGift + state.conGift + state.dexGift + state.intGift;
    document.getElementById('zzTotal').textContent = total.toLocaleString();

    const upgradeBtn = document.getElementById('btnUpgradeZiZhi');
    const zzConfig = getZZConfig();
    
    if (state.zizhi >= 154) {
        upgradeBtn.textContent = '资质已满';
        upgradeBtn.disabled = true;
    } else {
        const nextId = state.zizhi + 1;
        const nextConfig = ZZ_DATA[String(nextId)] || { num_talent: 4 };
        upgradeBtn.textContent = `提升资质（${nextConfig.num_talent} 槽）`;
        upgradeBtn.disabled = false;
    }
}

function renderStats() {
    document.getElementById('statTotalWash').textContent = state.totalWash.toLocaleString();
    document.getElementById('statTotalPills').textContent = state.totalPills.toLocaleString();
    document.getElementById('statGoldCount').textContent = state.goldCount.toLocaleString();
    document.getElementById('statPityCount').textContent = state.pityCount.toLocaleString();

    const totalTalents = Object.values(state.qualityCounts).reduce((a, b) => a + b, 0);
    for (let q = 1; q <= 4; q++) {
        const count = state.qualityCounts[q] || 0;
        const pct = totalTalents > 0 ? (count / totalTalents * 100) : 0;
        document.getElementById(`barQ${q}`).style.width = `${pct}%`;
        document.getElementById(`countQ${q}`).textContent = `${count} (${pct.toFixed(1)}%)`;
    }

    if (state.mode === 'seed') {
        document.getElementById('seedInput').value = state.seed;
    }

    if (state.hasBagPills) {
        document.getElementById('bagPillDisplay').textContent = `${state.bagPills.toLocaleString()} 颗`;
        const autoPills = document.getElementById('autoWashBagPillDisplay');
        if (autoPills) autoPills.textContent = `${state.bagPills.toLocaleString()} 颗`;
        syncPulsePillsInput();   // 原始脉序的丹数默认跟随背包
    }
}

/** 手动刷新背包洗髓丹：= 初始库存 - 已消耗（不防负，扣成负数也允许） */
function syncBagPillByConsume() {
    if (!state.hasBagPills) { alert('请先导入存档'); return; }
    const init = Number(state.initialBagPills || 0);
    const used = Number(state.totalPills || 0);
    state.bagPills = init - used;
    renderStats();
}

function renderPityBar() {
    const zzConfig = getZZConfig();
    const threshold = zzConfig.bd_zz;
    const pct = threshold > 0 ? Math.min(100, state.talLucky / threshold * 100) : 0;
    
    document.getElementById('pityFill').style.width = `${pct}%`;
    document.getElementById('pityText').textContent = `${state.talLucky} / ${threshold}`;
}

function renderCostInfo() {
    const zzConfig = getZZConfig();
    const lockedCount = state.talents.filter(t => t.locked).length;
    let eatCount = zzConfig.eat_xisui;
    if (lockedCount > 0) {
        eatCount = eatCount + 2 * lockedCount - 1;
    }
    let text = `当前资质：${zzConfig.zz_name || zzConfig.name}（${zzConfig.num_talent} 槽） · 每次消耗洗髓丹 ×${eatCount}`;
    if (lockedCount > 0) {
        text += `（锁定加价 ${lockedCount}）`;
    }
    document.getElementById('costInfo').textContent = text;
}

let historyPage = 1;

function getHistoryPageSize() {
    return Number(document.getElementById('historyPageSize')?.value) || 50;
}

function recordWash(result) {
    const names = [];
    const ids = [];
    for (const t of result.talents) {
        ids.push(Number(t.id));
        const talent = TALENT_DATA[String(t.id)];
        names.push(talent ? talent.name : '未知');
    }
    state.washHistory.push({
        ...result,
        talentIds: ids,
        talentNames: names,
    });
}

function buildLogEntryEl(result) {
    const entry = document.createElement('div');
    entry.className = 'log-entry'
        + (result.gotGold || result.isExchange ? ' log-purple' : '')
        + (result.wasPity && !result.isExchange ? ' log-pity-hit' : '')
        + (result.isExchange ? ' log-exchange' : '');

    let talentsHtml = '';
    for (const t of result.talents) {
        const talent = TALENT_DATA[String(t.id)];
        const name = talent ? talent.name : '未知';
        const qClass = talent ? getQualityClass(talent.weight) : 'q1';
        const lockMark = t.locked ? '[锁]' : '';
        talentsHtml += `<span class="log-talent ${qClass}">${lockMark}${name}</span>`;
    }

    const tags = [];
    if (result.isExchange) {
        tags.push('<span class="log-tag pity">置换</span>');
        if (result.exchangedFrom && result.exchangedTo) {
            tags.push(`<span class="log-tag gap">${result.exchangedFrom}→${result.exchangedTo}</span>`);
        }
    } else if (result.wasPity) {
        tags.push('<span class="log-tag pity">保底</span>');
    } else if (result.gotGold) {
        tags.push('<span class="log-tag purple">出紫</span>');
    }

    if (result.gotGold && !result.isExchange) {
        // 兜底：任何来源漏发 purpleGapPills（含旧缓存的 core_glue.js）时，首紫用累计总丹、其余用 0，绝不显示 null
        const gapVal = (result.purpleGapPills != null) ? result.purpleGapPills : (result.isFirstPurple ? (result.totalPills || 0) : 0);
        if (result.isFirstPurple) {
            tags.push(`<span class="log-tag gap">首次 · 累计${gapVal}丹</span>`);
        } else {
            tags.push(`<span class="log-tag gap">间隔${gapVal}丹</span>`);
        }
    }

    if (!result.isExchange) {
        tags.push(`<span class="log-tag meta">×${result.pillsUsed}</span>`);
    }
    tags.push(`<span class="log-tag meta">累${result.totalPills}</span>`);

    const numLabel = result.isExchange ? `换${result.exchangeNo || ''}` : `#${result.washNo}`;
    entry.innerHTML = `
        <span class="log-num">${numLabel}</span>
        <span class="log-talents">${talentsHtml}</span>
        <span class="log-tags">${tags.join('')}</span>
    `;
    return entry;
}

function updateHistoryPager(total) {
    const bar = document.getElementById('historyPager');
    const info = document.getElementById('historyPagerInfo');
    if (!bar || !info) return;
    const pageSize = getHistoryPageSize();
    const pages = Math.max(1, Math.ceil(total / pageSize) || 1);
    if (historyPage > pages) historyPage = pages;
    if (historyPage < 1) historyPage = 1;
    bar.hidden = total <= 0;
    info.textContent = total
        ? `第 ${historyPage}/${pages} 页 · 共 ${total} 条`
        : '—';
    const prev = document.getElementById('btnHistoryPrev');
    const next = document.getElementById('btnHistoryNext');
    if (prev) prev.disabled = historyPage <= 1;
    if (next) next.disabled = historyPage >= pages;
}

function renderHistoryPage() {
    const log = document.getElementById('historyLog');
    if (!log) return;
    const hist = state.washHistory;
    const total = hist.length;
    if (!total) {
        log.innerHTML = '<div class="log-empty">尚未开始洗髓</div>';
        updateHistoryPager(0);
        return;
    }
    const pageSize = getHistoryPageSize();
    const pages = Math.max(1, Math.ceil(total / pageSize));
    if (historyPage > pages) historyPage = pages;
    const end = total - (historyPage - 1) * pageSize;
    const start = Math.max(0, end - pageSize);
    const slice = hist.slice(start, end);
    const frag = document.createDocumentFragment();
    for (let i = slice.length - 1; i >= 0; i--) {
        frag.appendChild(buildLogEntryEl(slice[i]));
    }
    log.innerHTML = '';
    log.appendChild(frag);
    updateHistoryPager(total);
}

function addLogEntries(results) {
    if (!results || !results.length) return;
    for (const r of results) recordWash(r);
    historyPage = 1;
    renderHistoryPage();
}

function addLogEntry(result) {
    addLogEntries([result]);
}

function clearWashHistory() {
    state.washHistory = [];
    historyPage = 1;
    renderHistoryPage();
}

function exportWashHistory() {
    if (!state.washHistory.length) {
        alert('暂无洗髓记录');
        return;
    }
    const lines = state.washHistory.map(r => {
        const names = (r.talentNames || []).join('+');
        let flag = '-';
        if (r.isExchange) flag = '置换';
        else if (r.wasPity) flag = '保底';
        else if (r.gotGold) flag = '出紫';
        let gap = '';
        if (r.isExchange) {
            gap = `${r.exchangedFrom || ''}→${r.exchangedTo || ''}`;
        } else if (r.gotGold) {
            const gv = r.purpleGapPills != null ? r.purpleGapPills : (r.isFirstPurple ? (r.totalPills || 0) : 0);
            gap = r.isFirstPurple ? `首次(${gv})` : String(gv ?? '');
        }
        return [
            r.isExchange ? `换` : r.washNo,
            flag,
            names,
            r.pillsUsed,
            r.totalPills,
            gap,
            r.talLucky,
        ].join('\t');
    });
    const header = ['序号', '标记', '天赋', '本次丹', '累计丹', '紫脉间隔/置换', '保底进度'].join('\t');
    const text = header + '\n' + lines.join('\n');
    const blob = new Blob([text], { type: 'text/plain;charset=utf-8' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `洗髓记录_${state.washHistory.length}次.txt`;
    a.click();
    URL.revokeObjectURL(a.href);
}

function updateAll(result) {
    invalidatePurpleCache();
    renderTalents();
    renderAptitudePanel();
    renderStats();
    renderPityBar();
    renderCostInfo();
    if (result) addLogEntry(result);
}


function asRoleList(value) {
    if (!value) return [];
    if (Array.isArray(value)) return value;
    if (typeof value === 'object') return Object.values(value);
    return [];
}

function collectSaveRoles(saveData) {
    const out = [];
    const seen = new Set();

    function push(tag, role, keyPrefix) {
        if (!role || typeof role !== 'object' || role.ID == null) return;
        const key = `${keyPrefix}:${role.ID}`;
        if (seen.has(key)) return;
        seen.add(key);
        out.push({ key, tag, role });
    }

    push('主角', saveData.MainRole, 'main');
    asRoleList(saveData.Roles).forEach(r => push('随从', r, 'role'));
    asRoleList(saveData.Leavers).forEach(r => push('离队', r, 'leave'));
    return out;
}

function selectRoleFromSave(roleKey) {
    const list = state.saveRoles || [];
    let entry = list.find(e => e.key === String(roleKey));
    if (!entry && roleKey !== undefined && roleKey !== null && roleKey !== '') {
        const id = Number(roleKey);
        entry = list.find(e => e.role.ID === id);
    }
    if (!entry) return;

    const role = entry.role;
    const bt = role.BornTalent || {};

    state.seed = bt.S !== undefined ? Number(bt.S) : 0;
    state.bornTalentRC = bt.RC !== undefined && bt.RC !== null ? (Number(bt.RC) || 0) : 0;
    const lt = role.LuckTalent || {};
    if (lt.S !== undefined && lt.S !== null) {
        state.luckSeed = Number(lt.S);
        state.luckSeedInited = true;
    } else {
        state.luckSeed = 0;
        state.luckSeedInited = false;
    }
    state.roleId = Number(role.ID) || 0;
    state.talLucky = Number(role.TalLucky) || 0;
    state.zizhi = Number(role.ZiZhi) || 153;
    state.sex = Number(role.Sex) || 1;
    state.roleLevel = Number(role.Level) || 90;
    state.roleRaw = role;

    const rawTalents = Array.isArray(role.Talents) ? role.Talents : [];
    state.talents = rawTalents.map(t => ({
        id: Number(t.ID != null ? t.ID : t.id),
        locked: !!(t.Lock != null ? t.Lock : t.lock)
    })).filter(t => Number.isFinite(t.id) && t.id > 0);

    state.strGift = Number(role.StrGift) || 0;
    state.conGift = Number(role.ConGift) || 0;
    state.dexGift = Number(role.DexGift) || 0;
    state.intGift = Number(role.IntGift) || 0;

    computeRoleStats();
    extractGlobalVars();

    state.totalWash = 0;
    state.totalTalentBars = 0;
    state.totalPills = 0;
    state.goldCount = 0;
    state.pityCount = 0;
    state.qualityCounts = { 1: 0, 2: 0, 3: 0, 4: 0 };
    state.lastPurpleTotalPills = null;
    state.exchangeCount = 0;
    invalidatePurpleCache();
    clearWashHistory();

    const zizhiEl = document.getElementById('zizhiSelect');
    const sexEl = document.getElementById('sexSelect');
    const seedEl = document.getElementById('seedInput');
    const luckEl = document.getElementById('luckSeedInput');
    const roleEl = document.getElementById('roleIdInput');
    if (zizhiEl) zizhiEl.value = String(state.zizhi);
    if (sexEl) sexEl.value = String(state.sex);
    if (seedEl) seedEl.value = String(state.seed);
    if (luckEl) luckEl.value = state.luckSeedInited ? String(state.luckSeed) : '';
    if (roleEl) roleEl.value = String(state.roleId);

    const roleSelect = document.getElementById('saveRoleSelect');
    if (roleSelect && entry.key) roleSelect.value = entry.key;

    if (typeof invalidateInternationalWashContext === 'function') invalidateInternationalWashContext();
    captureImportSnapshot();
    pushStateToWasm();
    updateAll();
    renderAiTalentChoices();
    renderAutoWashSaveGate();
}

/** 把当前角色还原为存档中的初始状态（天赋/种子/资质全清，原存档文件不动） */
function resetCurrentRole() {
    if (!state.saveData) { alert('未导入存档，无法重置。'); return; }
    const list = state.saveRoles || [];
    const curId = Number(state.roleId) || 0;
    const entry = list.find(e => e.role && Number(e.role.ID) === curId);
    if (!entry) { alert('找不到当前角色（' + curId + '）的存档数据。'); return; }
    const name = entry.role?.Name || entry.role?.ID || '当前角色';
    // 复用 selectRoleFromSave：从存档重新读取初始数据
    selectRoleFromSave(entry.key);
    try { pushStateToWasm(); } catch (_) {}
    try { if (typeof invalidatePurpleCache === 'function') invalidatePurpleCache(); } catch (_) {}
    try { if (typeof renderHistoryPage === 'function') renderHistoryPage(); } catch (_) {}
    updateAll();
    const st = document.getElementById('opRecordStatus');
    if (st) st.textContent = '已重置「' + name + '」到存档初始状态';
}

function loadParsedSaveData(saveData, silent) {
    state.saveData = saveData;
    // 存档平台/渠道在调用本函数前已由导入入口写入 state.savePlatform / state.saveChannel
    autoSelectWashAlgoForSave();
    state.bagPills = 0;
    state.hasBagPills = false;
    autoWashSelectedRoleKey = '';
    aiSelectedTalentIds = [];
    invalidateAiPrediction();

    const saveRoles = collectSaveRoles(saveData);
    state.saveRoles = saveRoles;
    if (saveRoles.length === 0) {
        alert("存档中未找到角色数据（MainRole / Roles / Leavers）！");
        return;
    }

    const items = Array.isArray(saveData.Items)
        ? saveData.Items
        : (saveData.Items && typeof saveData.Items === 'object' ? Object.values(saveData.Items) : []);
    let pillCount = 0;
    for (const item of items) {
        if (item.ID === 2601) {
            pillCount += (item.Num || 0);
        }
    }
    state.bagPills = pillCount;
    state.hasBagPills = true;
    state.initialBagPills = pillCount;   // 初始库存，供「↻ 刷新背包」用

    if (saveData.CenterID) {
        state.salt = Number(saveData.CenterID) % 1000000;
        const saltEl = document.getElementById('saltInput');
        if (saltEl) saltEl.value = state.salt;
    }

    // 顶部的存档角色下拉框是洗髓页专有的，别的页面（如置换序列筛选）没有，缺了要能跳过
    const roleSelect = document.getElementById('saveRoleSelect');
    const preferred =
        saveRoles.find(e => e.role.ID === 10044) ||
        saveRoles.find(e => e.tag === '主角') ||
        saveRoles[0];
    if (roleSelect) {
        roleSelect.innerHTML = '';
        saveRoles.forEach(entry => {
            const role = entry.role;
            const opt = document.createElement('option');
            opt.value = entry.key;
            opt.textContent = `${entry.tag} · ${role.Name || '无名'}`;
            roleSelect.appendChild(opt);
        });
        roleSelect.value = preferred.key;
    }

    const roleRow = document.getElementById('saveRoleRow');
    if (roleRow) {
        roleRow.hidden = false;
        roleRow.style.display = 'flex';
    }
    const bagPillDisplay = document.getElementById('bagPillDisplay');
    if (bagPillDisplay) bagPillDisplay.textContent = `${pillCount.toLocaleString()} 颗`;

    state.mode = 'seed';
    const modeSelect = document.getElementById('modeSelect');
    if (modeSelect) modeSelect.value = 'seed';

    selectRoleFromSave(preferred.key);
    renderAutoWashSaveGate();

    const nMain = saveRoles.filter(e => e.tag === '主角').length;
    const nRole = saveRoles.filter(e => e.tag === '随从').length;
    const nLeave = saveRoles.filter(e => e.tag === '离队').length;
    const saveStatus = document.getElementById('saveStatus');
    if (saveStatus) {
        saveStatus.textContent = '导入成功';
    }
    if (typeof renderArchiveState === 'function') renderArchiveState(saveData);
    if (typeof invalidateEquipAutoPrediction === 'function') {
        invalidateEquipAutoPrediction('已载入新的原始存档，可开始装备自动模拟。');
    }
    if (typeof invalidateJianwangAutoPrediction === 'function') {
        invalidateJianwangAutoPrediction('已载入新的原始存档，可开始剑王阁自动模拟。');
        refreshJianwangAutoSwords(false);
    }
    if (!silent) {
        alert(
            `成功载入存档！\n` +
            `- 主角 ${nMain} / 随从 ${nRole} / 离队 ${nLeave}\n` +
            `- 背包洗髓丹: ${pillCount.toLocaleString()} 颗`
        );
    }
}

function handleSaveFileImport(file) {
    (async () => {
        if (typeof _importFeedback === 'function') _importFeedback(true);
        try {
            let json;
            if (typeof decryptSaveFile === 'function') {
                const r = await decryptSaveFile(file);
                json = r.data;
                state.saveVersion = r.version;
                state.savePlatform = r.platform;
                state.saveChannel = normalizeSaveChannel(r.channel, r.platform);
                if (typeof _applyDlcByPlatform === 'function') _applyDlcByPlatform(r.platform);
                state.saveFormat = r.format || 'json';
                state.saveColumns = r.columns || null;
                state.saveRow = r.row || null;
                if (typeof saveShareStore === 'function') {
                    saveShareStore(json, {
                        version: r.version, platform: r.platform, channel: state.saveChannel,
                        format: r.format || 'json', columns: r.columns || null, row: r.row || null,
                    });
                }
            } else {
                const text = await file.text();
                const obj = JSON.parse(text.replace(/^\uFEFF/, '').trim());
                const entry = Array.isArray(obj) ? obj[0] : obj;
                const b64 = entry && (entry.content || entry.encrypted);
                if (b64) json = wasmDecryptSave(b64);
                else json = obj;
            }
            if (typeof _importFeedback === 'function') _importFeedback(false);
            loadParsedSaveData(json);
        } catch (err) {
            console.error(err);
            alert("读取存档失败: " + (err.message || err));
        } finally {
            if (typeof _importFeedback === 'function') _importFeedback(false);
        }
    })();
}

function upgradeZiZhi() {
    if (state.zizhi >= 154) {
        alert("资质已达到最高阶段【空前绝后】，已解锁全部 4 个天赋槽！");
        return;
    }

    state.zizhi += 1;
    const zzConfig = getZZConfig();
    document.getElementById('zizhiSelect').value = String(state.zizhi);

    state.strGift += 100;
    state.conGift += 100;

    updateAll();
    refreshPulseIfBuilt();
    alert(`资质提升至【${zzConfig.zz_name}】！成功开启 ${zzConfig.num_talent} 个天赋槽位！`);
}


function toggleLock(index) {
    if (index >= 0 && index < state.talents.length) {
        state.talents[index].locked = !state.talents[index].locked;
        opRecordToggle(index, state.talents[index].locked);
        invalidatePurpleCache();
        renderTalents();
        renderCostInfo();
    }
}

window.exchangeTalent = exchangeTalent;
window.toggleLock = toggleLock;
// 暴露纯函数供离线验证脚本（node）调用；浏览器中本就是全局函数，此处不影响运行逻辑
window.analyzeTalentConflicts = analyzeTalentConflicts;
window.pulseStartState = pulseStartState;
// 仅在 node（离线验证）下挂载：允许测试脚本注入 state；浏览器中 module 未定义，本段不执行
if (typeof module !== 'undefined' && module.exports) {
    window.setSimStateForTest = function (s) { state = s; };
}

function washOnce() {
    const result = doWash();
    if (result) { opRecordWash(1); updateAll(result); }
}

function washMulti(times) {
    const zzConfig = getZZConfig();
    if (zzConfig.num_talent === 0) return;
    const lockedCount = state.talents.filter(t => t.locked).length;
    if (zzConfig.num_talent <= lockedCount) return;

    if (state.dlcMode) {
        const batch = [];
        for (let i = 0; i < times; i++) {
            const r = doWash();
            if (!r) break;
            batch.push(r);
        }
        if (!batch.length) return;
        addLogEntries(batch);
        opRecordWash(batch.length);
        updateAll();
        return;
    }

    pushStateToWasm();
    const rawBatch = wasmWashMulti(times);
    if (!rawBatch || !rawBatch.length) return;
    pullStateFromWasm();

    const batch = rawBatch.map(convertWashResult);
    addLogEntries(batch);
    opRecordWash(batch.length);
    updateAll();
}

function washUntilGold() {
    const zzConfig = getZZConfig();
    if (zzConfig.num_talent === 0) return;
    const lockedCount = state.talents.filter(t => t.locked).length;
    if (zzConfig.num_talent <= lockedCount) return;

    if (state.dlcMode) {
        const batch = [];
        for (let i = 0; i < 10000; i++) {
            const r = doWash();
            if (!r) break;
            batch.push(r);
            if (r.wasPity || (r.talents || []).some(t => t.weight === 4)) break;
        }
        if (!batch.length) return;
        addLogEntries(batch);
        opRecordWash(batch.length);
        updateAll();
        return;
    }

    pushStateToWasm();
    const rawBatch = wasmWashUntilGold(10000);
    if (!rawBatch || !rawBatch.length) return;
    pullStateFromWasm();

    const batch = rawBatch.map(convertWashResult);
    addLogEntries(batch);
    opRecordWash(batch.length);
    updateAll();
}

/** 「洗到出紫前 N 次」：找到下一保底紫，洗到 (purple.wash_times - N) 次（与 washUntilGold 共享 wasm state 推送）。 */
function washUntilGoldMinusN() {
    const zzConfig = getZZConfig();
    if (zzConfig.num_talent === 0) return;
    const lockedCount = state.talents.filter(t => t.locked).length;
    if (zzConfig.num_talent <= lockedCount) return;

    const inputEl = document.getElementById('washUntilGoldMinusNInput');
    let n = Math.trunc(Number(inputEl?.value ?? 5));
    if (!Number.isFinite(n)) n = 5;
    n = Math.max(0, Math.min(50, n));

    ensurePurpleSequenceCache();
    const item = findNextPurpleAfter(state.totalTalentBars || 0);
    if (!item) {
        if (typeof alert === 'function') {
            alert('未找到下一个保底紫（请先打开「紫脉脉序与置换推演」加载更多脉序）。');
        }
        return;
    }

    const purpleWashTimes = Number(item.wash_times) || 0;
    const curWash = Number(state.totalWash) || 0;
    const target = purpleWashTimes - n;
    const remaining = target - curWash;

    if (remaining <= 0) {
        const gap = Math.max(0, purpleWashTimes - curWash);
        if (typeof alert === 'function') {
            alert(`下一紫「${item.talent_name}」还剩 ${gap} 洗，不足以 ${n} 次前置距离。请先洗髓或调小 N。`);
        }
        return;
    }

    washMulti(remaining);
}

function onModeChange() {
    state.mode = document.getElementById('modeSelect').value;
    invalidatePurpleCache();
    renderTalents();
    renderCostInfo();
}

function onSeedChange() {
    state.seed = Number(document.getElementById('seedInput').value) || 0;
    invalidatePurpleCache();
    renderCostInfo();
}

function onLuckSeedChange() {
    const el = document.getElementById('luckSeedInput');
    if (!el) return;
    const raw = String(el.value || '').trim();
    if (raw === '') {
        state.luckSeedInited = false;
        state.luckSeed = 0;
        invalidatePurpleCache();
        return;
    }
    state.luckSeed = Number(raw) || 0;
    state.luckSeedInited = true;
    invalidatePurpleCache();
}

function onRoleIdChange() {
    state.roleId = Number(document.getElementById('roleIdInput').value) || 10044;
    invalidatePurpleCache();
}

function onSaltChange() {
    state.salt = Number(document.getElementById('saltInput').value) || 278440;
    invalidatePurpleCache();
}

function onZizhiChange() {
    state.zizhi = parseInt(document.getElementById('zizhiSelect').value);
    invalidatePurpleCache();
    renderTalents();
    renderAptitudePanel();
    renderPityBar();
    renderCostInfo();
    renderAiTalentChoices();
    refreshPulseIfBuilt();
}

function onSexChange() {
    state.sex = parseInt(document.getElementById('sexSelect').value);
    invalidatePurpleCache();
    renderAiTalentChoices();
}

function normalizeVipLevel(value) {
    const vip = parseInt(value, 10);
    if (!Number.isFinite(vip) || vip <= 0) return 0;
    return vip >= 2 ? 2 : 1;
}

function vipImpactText(value) {
    const vip = normalizeVipLevel(value);
    if (vip === 0) {
        return '无 VIP：排除全部 VIP 限定脉；VIP 不改变丹耗或保底。';
    }
    if (vip === 1) {
        return 'VIP 1+：开放九阴鬼脉、玄阳神脉、混元奇脉、一心两用等；仍需满足角色类别、资质等其他条件；VIP 不改变丹耗或保底。';
    }
    return 'VIP 2+：包含 VIP 1+ 候选，并额外开放赴汤蹈火；仍需满足角色类别、资质等其他条件；VIP 不改变丹耗或保底。';
}

function syncVipControls() {
    ['vipSelect', 'autoWashVipSelect'].forEach(id => {
        const control = document.getElementById(id);
        if (control) control.value = String(state.vip);
    });
    const impact = vipImpactText(state.vip);
    ['vipImpactHint', 'autoWashVipImpactHint'].forEach(id => {
        const hint = document.getElementById(id);
        if (hint) hint.textContent = impact;
    });
}

function onVipChange(event) {
    const value = event?.target?.value ?? document.getElementById('vipSelect')?.value ?? state.vip;
    state.vip = normalizeVipLevel(value);
    syncVipControls();
    invalidatePurpleCache();
    invalidateAiPrediction();
    renderAiTalentChoices();
    renderAutoWashSaveGate();
}

function clearLog() {
    clearWashHistory();
}

function washCustom() {
    const input = document.getElementById('customWashInput');
    let count = parseInt(input ? input.value : 500);
    if (isNaN(count) || count < 1) count = 1;
    if (count > 1000) {
        count = 1000;
        if (input) input.value = 1000;
    }
    washMulti(count);
}

const EXCHANGE_SEQUENCE_SHENMAI_IDS = new Set([248, 249, 250]);
const EXCHANGE_SEQUENCE_YIXIN_IDS = new Set([251]); // 一心两用：玩家常当作「非保底」跳过，真正的首紫保底是其后的保底紫
const EXCHANGE_SEQUENCE_SHENMAI_MAX_GAP = 850;
/** 置换序列「生成项数」上限（与 wash/index.html #exchangeSequenceCountInput max=25 对齐） */
const EXCHANGE_SEQUENCE_COUNT_MAX = 30;
/** 置换序列「紫后第n条置换序列」上限（与 #exchangeSequencePadInput max=300 对齐） */
const EXCHANGE_SEQUENCE_PAD_MAX = 300;
const JUMP_TARGET_PURPLE_LIMIT = 8; // 锚点紫下拉最多列出前 N 个紫
const EXCHANGE_SEQUENCE_PRIOR_PITY_MESSAGE = '此前存在过保底紫，该处序列固定，只依赖于之前所锁定的序列';
const EXCHANGE_SEQUENCE_DIRECT_PITY_MESSAGE = '首个紫脉为保底紫，仅可选择该保底位置';

let exchangeSequenceDataset = { roles: [], globalVars: {} };
let exchangeSequenceCandidateLoadToken = 0;
let exchangeSequenceRunning = false;

function cloneExchangeSequenceValue(value) {
    return JSON.parse(JSON.stringify(value));
}

function exchangeSequenceTalentByName(name) {
    return Object.values(TALENT_DATA).find(item => item.name === name);
}

function exchangeSequenceRoleStats(role) {
    const coefficient = 0.00006;
    function attribute(name) {
        const raw = Number(role[name] || 0);
        const born = Number(role[`Born${name}`] || 0);
        const gift = Number(role[`${name}Gift`] || 0);
        return Math.floor((raw + born) * (1 + coefficient * gift));
    }
    return {
        str_val: attribute('Str'),
        dex: attribute('Dex'),
        con: attribute('Con'),
        int_val: attribute('Int'),
    };
}

function buildExchangeSequenceWasmState(role) {
    const born = role.BornTalent || {};
    const luck = role.LuckTalent || {};
    const luckInited = luck.S !== undefined && luck.S !== null;
    const effectiveZizhi = Math.max(Number(role.ZiZhi) || 153, 153);
    return {
        mode: 'seed',
        zizhi: effectiveZizhi,
        sex: Number(role.Sex) || 1,
        vip: normalizeVipLevel(state.vip),
        seed: born.S !== undefined ? Number(born.S) : 0,
        luck_seed: luckInited ? Number(luck.S) : 0,
        luck_seed_inited: luckInited,
        role_id: Number(role.ID) || 0,
        salt: Number(state.saveData?.CenterID || state.salt || 278440) % 1000000,
        talents: asRoleList(role.Talents)
            .map(talent => ({
                id: Number(talent.ID != null ? talent.ID : talent.id),
                locked: !!(talent.Lock != null ? talent.Lock : talent.lock),
            }))
            .filter(talent => Number.isFinite(talent.id) && talent.id > 0),
        tal_lucky: Number(role.TalLucky) || 0,
        total_wash: 0,
        total_talent_bars: 0,
        total_pills: 0,
        bag_pills: Number(state.bagPills) || 0,
        has_bag_pills: true,
        gold_count: 0,
        pity_count: 0,
        quality_counts: { 1: 0, 2: 0, 3: 0, 4: 0 },
        last_purple_total_pills: null,
        exchange_count: 0,
        str_gift: Number(role.StrGift) || 0,
        con_gift: Number(role.ConGift) || 0,
        dex_gift: Number(role.DexGift) || 0,
        int_gift: Number(role.IntGift) || 0,
        role_level: Number(role.Level) || 90,
        role_stats: exchangeSequenceRoleStats(role),
        global_vars: state.saveData?.globalVariable || {},
        born_talent_rc: born.RC !== undefined && born.RC !== null ? (Number(born.RC) || 0) : 0,
        save_channel: state.saveChannel || '',
    };
}

function buildExchangeSequenceDataset() {
    const roles = (state.saveRoles || []).map(entry => {
        const wasmState = buildExchangeSequenceWasmState(entry.role);
        const slotInfo = ZZ_DATA[String(wasmState.zizhi)] || {};
        const slotCount = Number(slotInfo.num_talent || 0);
        return {
            key: entry.key,
            roleName: entry.role.Name || '无名',
            roleKind: entry.tag,
            seedStatus: wasmState.luck_seed_inited ? 'fixed_luck_seed' : 'mutable_born_seed',
            currentSeed: wasmState.luck_seed_inited ? wasmState.luck_seed : wasmState.seed,
            slotCount,
            candidates: [],
            candidatesReady: slotCount < 3,
            directPitySequence: false,
            jumpAnalysis: null,
            jumpCandidatesReady: false,
            jumpDirectPityReady: false,
            wasmState,
        };
    });
    return {
        roles,
        globalVars: state.saveData?.globalVariable || {},
    };
}

function selectedExchangeSequenceRole() {
    const select = document.getElementById('exchangeSequenceRoleSelect');
    if (!select || select.value === '') return null;
    return exchangeSequenceDataset.roles.find(role => role.key === select.value) || null;
}

function selectedExchangeSequenceCandidate(role = selectedExchangeSequenceRole()) {
    const select = document.getElementById('exchangeSequencePurpleSelect');
    if (!role || !select || select.value === '') return null;
    return role.candidates[Number(select.value)] || null;
}

function isExchangeSequenceFourSlotRole(role) {
    return Number(role?.slotCount) >= 4;
}

function activeExchangeSequencePadInput(role) {
    return document.getElementById('exchangeSequencePadInput');
}

function readExchangeSequencePadValue(role) {
    const input = activeExchangeSequencePadInput(role);
    const fallback = isExchangeSequenceFourSlotRole(role) ? 0 : 1;
    const raw = Number(input?.value);
    const value = Number.isFinite(raw) ? Math.trunc(raw) : fallback;
    const normalized = Math.max(0, Math.min(EXCHANGE_SEQUENCE_PAD_MAX, value));
    if (input) input.value = String(normalized);
    return normalized;
}

function setExchangeSequenceSlotPanels(role) {
    const panel = document.getElementById('exchangeSequenceModePanel');
    const hasRole = !!role;
    const directPity = !!role?.directPitySequence;
    const fourSlot = hasRole && isExchangeSequenceFourSlotRole(role);
    if (!panel) return;
    if (isFirstPityJumpMode()) {
        panel.hidden = true;
        return;
    }
    panel.hidden = !hasRole;
    if (!hasRole) {
        panel.textContent = '';
    } else if (isOwnedPurpleMode()) {
        panel.innerHTML = '<strong>自带置换紫</strong>：直接用存档里已经锁好的那条紫脉做无限置换，不再洗髓去找；'
            + '三槽剩 1 格，四槽再锁紫脉下方最近的普通脉，之后每点一次洗髓推进 1 条原始脉。';
    } else if (isShenmaiSwapMode()) {
        panel.innerHTML = '<strong>神脉互冲</strong>：先锁「先锁」那条神脉当冲突脉，洗到「后锁」那条再锁住；'
            + '三槽剩 1 格，四槽再锁紫脉下方最近的普通脉，之后每点一次洗髓推进 1 条原始脉。';
    } else if (isExchangeSequenceTheoryMode() && !directPity) {
        panel.innerHTML = '<strong>理论定位</strong>：先按二槽锁冲突脉洗出首紫，再切到三槽记录普通脉坐标；'
            + '这里只用于查序列，实际操作仍按当前三槽或四槽状态卡位。';
    } else if (directPity) {
        panel.innerHTML = '<strong>首位保底紫</strong>：当前欧气种子已由该保底位置固定，无需设置置换次数。';
    } else if (fourSlot) {
        panel.innerHTML = '<strong>四脉状态</strong>：先锁「冲突脉 + 首紫 + 首紫下方最近的那条普通脉」共 3 条，只留 1 个槽；之后每点一次洗髓只推进 1 条原始脉，对应一条新的置换序列（与三脉一致）。';
    } else {
        panel.innerHTML = '<strong>三脉状态</strong>：所选首紫及其后续每一条脉对应一个置换种子，置换次数同时等于额外刷新次数。';
    }
}

function clearExchangeSequenceResults(message = '等待选择参数') {
    const grid = document.getElementById('exchangeSequenceGrid');
    const empty = document.getElementById('exchangeSequenceEmpty');
    const meta = document.getElementById('exchangeSequenceResultMeta');
    const seed = document.getElementById('exchangeSequenceInitialSeed');
    const summary = document.getElementById('exchangeSequenceJumpSummary');
    if (summary) {
        summary.innerHTML = '';
        summary.hidden = true;
    }
    if (grid) {
        grid.innerHTML = '';
        grid.hidden = true;
    }
    if (empty) {
        empty.hidden = false;
        empty.textContent = message;
    }
    if (meta) meta.textContent = '尚未生成';
    const basePulse = document.getElementById('exchangeSequenceBasePulse');
    if (basePulse) {
        basePulse.textContent = '';
        basePulse.hidden = true;
    }
    if (seed) seed.textContent = '等待生成';
}

function appendExchangeSequenceOption(select, value, text, { disabled = false, className = '' } = {}) {
    if (!select) return;
    const option = document.createElement('option');
    option.value = String(value);
    option.textContent = text;
    option.disabled = disabled;
    option.className = className;
    select.appendChild(option);
}

function isExchangeSequenceShenmaiRecord(record) {
    return EXCHANGE_SEQUENCE_SHENMAI_IDS.has(Number(record?.talent_id));
}

function exchangeSequenceHasPriorPity(record) {
    return !!(record && (record.has_prior_pity || record.shenmai_has_prior_pity));
}

function isExchangeSequenceOrdinaryTargetWithoutPriorPity(record) {
    return !!record?.can_exchange && !!record?.earlier_conflict_name
        && !record?.was_pity && !isExchangeSequenceShenmaiRecord(record);
}

function isExchangeSequenceShenmaiTargetWithoutPriorPity(record) {
    const gap = Number(record?.shenmai_gap);
    return isExchangeSequenceShenmaiRecord(record)
        && !record?.was_pity
        && !!record?.shenmai_conflict_name
        && Number.isFinite(gap)
        && gap >= 0
        && gap <= EXCHANGE_SEQUENCE_SHENMAI_MAX_GAP;
}

function exchangeSequenceCandidateUnavailableReason(record) {
    if (record?.was_pity) return '保底脉，无法固定定向冲突';
    if (isExchangeSequenceShenmaiRecord(record) && !isExchangeSequenceShenmaiTargetWithoutPriorPity(record)) {
        return '无法冲突';
    }
    if (!isExchangeSequenceShenmaiRecord(record)) {
        if (!record?.earlier_conflict_name) return '无冲突脉可进行置换';
        if (!record?.can_exchange) return record?.block_reason || '当前无法按锁冲突流程置换';
    }
    if (exchangeSequenceHasPriorPity(record)) return EXCHANGE_SEQUENCE_PRIOR_PITY_MESSAGE;
    return '当前紫脉不适用置换初始化';
}

function exchangeSequenceCandidateDisplayReason(record, showPriorPityNotice = true) {
    if (record?.was_pity) return '保底脉，无法固定定向冲突';
    if (isExchangeSequenceShenmaiRecord(record) && isExchangeSequenceShenmaiTargetWithoutPriorPity(record)) {
        const conflict = `神脉冲突：${record.shenmai_conflict_name}`;
        return showPriorPityNotice && exchangeSequenceHasPriorPity(record)
            ? `${conflict}；${EXCHANGE_SEQUENCE_PRIOR_PITY_MESSAGE}`
            : conflict;
    }
    if (!isExchangeSequenceShenmaiRecord(record) && record?.can_exchange && record?.earlier_conflict_name) {
        const conflict = `首紫冲突：${record.earlier_conflict_name}`;
        return showPriorPityNotice && exchangeSequenceHasPriorPity(record)
            ? `${conflict}；${EXCHANGE_SEQUENCE_PRIOR_PITY_MESSAGE}`
            : conflict;
    }
    return exchangeSequenceCandidateUnavailableReason(record);
}

function annotateExchangeSequenceShenmaiPairs(purples, initialTalents) {
    const history = asRoleList(initialTalents)
        .map((slot, index) => {
            const talent = TALENT_DATA[String(slot?.id)];
            if (!talent || !EXCHANGE_SEQUENCE_SHENMAI_IDS.has(Number(talent.id))) return null;
            return {
                talent_id: Number(talent.id),
                talent_name: talent.name,
                wash_no: 0,
                wash_times: 0,
                initial_index: index,
                is_initial: true,
            };
        })
        .filter(Boolean);
    const ordered = purples
        .map((item, index) => ({ item, index }))
        .sort((left, right) => Number(left.item.wash_no) - Number(right.item.wash_no) || left.index - right.index);
    let hasPriorPity = false;

    for (const { item } of ordered) {
        item.has_prior_pity = hasPriorPity;
        if (isExchangeSequenceShenmaiRecord(item)) {
            const partner = [...history].reverse().find(previous =>
                String(previous.talent_name) !== String(item.talent_name));
            const gap = partner ? Number(item.wash_no) - Number(partner.wash_no) : NaN;
            item.shenmai_conflict_name = partner ? partner.talent_name : '';
            item.shenmai_conflict_wash_no = partner ? Number(partner.wash_no) : 0;
            item.shenmai_conflict_wash_times = partner
                ? (Number.isFinite(Number(partner.wash_times)) ? Number(partner.wash_times) : Number(partner.wash_no))
                : 0;
            item.shenmai_gap = Number.isFinite(gap) ? gap : null;
            item.shenmai_has_prior_pity = hasPriorPity;

            const duplicateInitial = Number(item.wash_no) === 0 && history.some(previous =>
                previous.is_initial && Number(previous.talent_id) === Number(item.talent_id));
            if (!duplicateInitial) history.push(item);
        }
        if (item.was_pity) hasPriorPity = true;
    }
}

function runExchangeSequenceWasmSandbox(callback) {
    // 「最新」(preview) 后端是纯 JS（WashSourceEngine），推演不依赖 wasm。
    // 若仍强制要求 wasmInitEngine 成功，wasm 未就绪（wasmReady=false）时它会返回 false
    // → 这里抛错 → 候选永远算不出来 → 置换首紫下拉为空（正式服因 wasm 已就绪故正常）。
    // 因此：preview 后端下跳过这道 wasm 门槛；官方/国际服后端仍按原样校验。
    const isJsBackend = typeof WashEngineRegistry !== 'undefined'
        && typeof WashEngineRegistry.currentBackend === 'function'
        && WashEngineRegistry.currentBackend() === 'preview';
    try {
        if (!isJsBackend && !wasmInitEngine(TALENT_DATA, ZZ_DATA)) {
            throw new Error('置换脉序引擎初始化失败');
        }
        return callback();
    } finally {
        wasmInitEngine(TALENT_DATA, _buildZZDataForWasm());
        pushStateToWasm();
    }
}

function analyzeExchangeSequenceCandidates(role) {
    // TODO(诊断): 临时排查「置换首紫下拉为空」，确认后删除
    try {
        console.log('[置换诊断] analyze 调用', {
            role: role?.roleName, slotCount: role?.slotCount, candidatesReady: role?.candidatesReady,
        });
    } catch (e) { /* 诊断日志不影响主流程 */ }
    if (!role || role.candidatesReady !== false) return;
    runExchangeSequenceWasmSandbox(() => {
        const source = cloneExchangeSequenceValue(role.wasmState);
        source.global_vars = exchangeSequenceDataset.globalVars;
        source.talents = (source.talents || []).map(talent => ({ ...talent, locked: false }));
        if (!wasmSetState(source)) throw new Error(`角色「${role.roleName}」的种子状态写入失败`);
        const preview = wasmPreviewSequence(10000) || {};
        const purples = Array.isArray(preview.purples) ? preview.purples : [];
        // TODO(诊断): 临时排查「置换首紫下拉为空」，确认后删除
        try {
            console.log('[置换诊断] 结果', {
                role: role.roleName,
                backend: (typeof WashEngineRegistry !== 'undefined' && WashEngineRegistry.currentBackend)
                    ? WashEngineRegistry.currentBackend() : 'unknown',
                wasmReady: (typeof wasmReady !== 'undefined') ? wasmReady : 'n/a',
                zizhi: source.zizhi, seed: source.seed,
                luck_seed_inited: source.luck_seed_inited, luck_seed: source.luck_seed,
                talents: source.talents,
                previewIsArray: Array.isArray(preview),
                previewKeys: preview && typeof preview === 'object' ? Object.keys(preview) : null,
                purplesLen: purples.length,
                firstPurples: purples.slice(0, 3),
            });
        } catch (e) { /* 诊断日志不影响主流程 */ }
        annotateExchangeSequenceShenmaiPairs(purples, source.talents);
        const ordered = purples
            .map((item, index) => ({ item, index }))
            .sort((left, right) => Number(left.item.wash_no) - Number(right.item.wash_no) || left.index - right.index);
        const firstPurple = ordered[0]?.item;
        const directPity = !!(firstPurple && firstPurple.was_pity);
        role.directPitySequence = directPity;
        role.candidates = ordered.map(({ item }) => {
            const isShenmai = isExchangeSequenceShenmaiRecord(item);
            const isDirectPity = directPity && item === firstPurple;
            const normalAvailable = isShenmai
                ? isExchangeSequenceShenmaiTargetWithoutPriorPity(item) && !exchangeSequenceHasPriorPity(item)
                : isExchangeSequenceOrdinaryTargetWithoutPriorPity(item) && !exchangeSequenceHasPriorPity(item);
            const canInitialize = directPity ? isDirectPity : normalAvailable;
            return {
                name: item.talent_name,
                talentId: Number(item.talent_id),
                washNo: Number(item.wash_no),
                conflictName: isShenmai ? item.shenmai_conflict_name : item.earlier_conflict_name,
                conflictWashNo: isShenmai
                    ? Number(item.shenmai_conflict_wash_no || 0)
                    : Number(item.earlier_conflict_wash_no || 0),
                conflictWashTimes: isShenmai
                    ? Number(item.shenmai_conflict_wash_times || 0)
                    : Number(item.earlier_conflict_wash_times || 0),
                isShenmai,
                hasPriorPity: !!item.has_prior_pity,
                shenmaiGap: isShenmai ? item.shenmai_gap : null,
                wasPity: !!item.was_pity,
                isDirectPity,
                canInitialize,
                unavailableReason: canInitialize
                    ? ''
                    : (directPity ? EXCHANGE_SEQUENCE_DIRECT_PITY_MESSAGE : exchangeSequenceCandidateUnavailableReason(item)),
                displayReason: isDirectPity
                    ? '首位保底紫：当前种子已固定'
                    : exchangeSequenceCandidateDisplayReason(item, !directPity),
            };
        });
        role.candidatesReady = true;
    });
}

function updateExchangeSequenceGenerateButton(role = selectedExchangeSequenceRole(), candidate = selectedExchangeSequenceCandidate(role)) {
    const button = document.getElementById('btnGenerateExchangeSequence');
    const downloadButton = document.getElementById('btnDownloadExchangeSequence');
    const filterButton = document.getElementById('btnFilterExchangeSequence');
    const shenmai = isShenmaiSwapMode();
    const owned = isOwnedPurpleMode();
    const pair = shenmai ? selectedExchangeSequenceShenmaiPair(role) : null;
    const ownedEntry = owned ? selectedExchangeSequenceOwnedPurple(role) : null;
    let ready;
    if (owned) {
        ready = !exchangeSequenceRunning && !state.dlcMode && !!role && !!ownedEntry;
    } else if (shenmai) {
        ready = !exchangeSequenceRunning && !state.dlcMode && !!role && !exchangeSequenceShenmaiPairError(pair);
    } else {
        ready = !isFirstPityJumpMode() && !exchangeSequenceRunning && !state.dlcMode && !!role && !!candidate?.canInitialize;
    }
    if (button) button.disabled = !ready;
    if (downloadButton) downloadButton.disabled = !ready;
    if (filterButton) filterButton.disabled = !ready;
    syncExchangeFilterRunButton();
}

/* ── 首紫跳脉（wash.firstPityJump*）────────────────────────────────
 * 原理：锁定一条与「最近保底紫之前」同 ID 的普通脉，洗髓时该同名词条会被吞掉，
 *       种子因此多走一格，从而改变首位保底紫的置换序列。
 * 内核接口：wasmFirstPityJumpCandidates / wasmFirstPityJumpSequence
 * 全部只计算临时状态，不修改当前洗脉进度。
 * ---------------------------------------------------------------- */

function exchangeSequenceQueryMode() {
    const value = document.getElementById('exchangeSequenceQueryMode')?.value;
    if (value === 'jump') return 'jump';
    if (value === 'shenmai') return 'shenmai';
    if (value === 'owned') return 'owned';
    if (value === 'normal_theory') return 'normal_theory';
    return 'normal';
}

function isNormalExchangeSequenceMode() {
    const mode = exchangeSequenceQueryMode();
    return mode === 'normal' || mode === 'normal_theory';
}

/** 普通置换的序列坐标基准：理论模式先按二槽定位首紫。 */
function exchangeSequenceTheoryMode() {
    return exchangeSequenceQueryMode() === 'normal_theory' ? 'theory2' : 'current';
}

function isExchangeSequenceTheoryMode() {
    return exchangeSequenceTheoryMode() === 'theory2';
}

function isFirstPityJumpMode() {
    return exchangeSequenceQueryMode() === 'jump';
}

/** 神脉置换模式：手动指定互冲的两条神脉（混元 / 玄阳 / 九阴） */
function isShenmaiSwapMode() {
    return exchangeSequenceQueryMode() === 'shenmai';
}

/** 自带置换紫序列模式：直接用存档里已经锁好的那条紫脉，不再洗髓去找 */
function isOwnedPurpleMode() {
    return exchangeSequenceQueryMode() === 'owned';
}

function setFirstPityJumpPanelVisible(visible) {
    const panel = document.getElementById('exchangeSequenceJumpPanel');
    if (panel) panel.hidden = !visible;
}

/** 按查询模式统一控制各控件显隐：普通/神脉模式保留「置换次数」与「生成置换序列」 */
function applyExchangeSequenceModeControls() {
    const mode = exchangeSequenceQueryMode();
    const normal = isNormalExchangeSequenceMode();
    const shenmai = mode === 'shenmai';
    const owned = mode === 'owned';
    setFirstPityJumpPanelVisible(mode === 'jump');
    const shenmaiPanel = document.getElementById('exchangeSequenceShenmaiPanel');
    if (shenmaiPanel) shenmaiPanel.hidden = !shenmai;
    const ownedPanel = document.getElementById('exchangeSequenceOwnedPanel');
    if (ownedPanel) ownedPanel.hidden = !owned;
    const toggle = (id, visible) => {
        const el = document.getElementById(id);
        if (el) el.hidden = !visible;
    };
    toggle('exchangeSequencePurpleGroup', normal);
    toggle('exchangeSequenceIndexGroup', normal);
    toggle('exchangeSequencePadGroup', normal || shenmai || owned);
    toggle('btnGenerateExchangeSequence', normal || shenmai || owned);
    toggle('btnDownloadExchangeSequence', normal || shenmai || owned);
    toggle('btnFilterExchangeSequence', normal || shenmai || owned);
}

/* ── 神脉置换 ────────────────────────────────────────────────────────
 * 神脉（248 九阴鬼脉 / 249 玄阳神脉 / 250 混元奇脉）同属 type 248，互为冲突脉，
 * 同屏两条不同神脉时都能点置换。脉序前两个紫都是神脉这类极端情况下，自动判定
 * 挑不出想要的那一对，所以这个模式让「先锁哪条（当冲突脉）+ 后锁哪条（被置换）」
 * 都由玩家自己指定；后续推演与生成完全复用普通置换那套流程。
 * ------------------------------------------------------------------ */

const EXCHANGE_SEQUENCE_SHENMAI_LIMIT = 8;

/** 列出该角色「可达的神脉」：存档里已有的（脉序 0）+ 脉序前若干个紫里的神脉 */
function listExchangeSequenceShenmaiTargets(role) {
    const list = [];
    const seen = new Set();
    const push = (id, name, washNo, washTimes, inSave) => {
        const key = `${washNo}-${id}`;
        if (seen.has(key)) return;
        seen.add(key);
        list.push({ id: Number(id), name: name || (TALENT_DATA[String(id)]?.name || `#${id}`), washNo, washTimes, inSave });
    };
    (role?.wasmState?.talents || []).forEach(slot => {
        const id = Number(slot?.id);
        if (EXCHANGE_SEQUENCE_SHENMAI_IDS.has(id)) push(id, TALENT_DATA[String(id)]?.name, 0, 0, true);
    });
    const source = cloneExchangeSequenceValue(role?.wasmState || {});
    source.global_vars = exchangeSequenceDataset.globalVars;
    source.talents = (source.talents || []).map(item => ({ ...item, locked: false }));
    try {
        runExchangeSequenceWasmSandbox(() => {
            if (!wasmSetState(source)) return;
            const preview = wasmPreviewSequence(10000) || {};
            const purples = Array.isArray(preview.purples) ? preview.purples : [];
            purples.forEach(item => {
                const id = Number(item.talent_id);
                if (!EXCHANGE_SEQUENCE_SHENMAI_IDS.has(id)) return;
                push(id, item.talent_name, Number(item.wash_no) || 0, Number(item.wash_times) || 0, false);
            });
        });
    } catch (_) { /* 扫描失败时只保留存档里已有的神脉 */ }
    return list.slice(0, EXCHANGE_SEQUENCE_SHENMAI_LIMIT);
}

function exchangeSequenceShenmaiLabel(item) {
    return item.inSave
        ? `${item.name} · 存档已有`
        : `#${item.washNo} ${item.name} · 第 ${item.washTimes} 洗`;
}

function populateExchangeSequenceShenmaiSelects(role) {
    const first = document.getElementById('exchangeSequenceShenmaiFirstSelect');
    const second = document.getElementById('exchangeSequenceShenmaiSecondSelect');
    if (!first || !second) return;
    if (role) role.shenmaiTargets = listExchangeSequenceShenmaiTargets(role);
    const targets = role?.shenmaiTargets || [];
    [first, second].forEach(select => {
        select.innerHTML = '';
        if (!targets.length) {
            appendExchangeSequenceOption(select, '', '该角色暂无可达神脉');
            select.disabled = true;
            return;
        }
        select.disabled = false;
        targets.forEach((item, index) => appendExchangeSequenceOption(select, String(index), exchangeSequenceShenmaiLabel(item)));
    });
    if (targets.length) {
        const firstIdx = 0;
        const secondIdx = targets.findIndex(item => item.id !== targets[firstIdx].id);
        first.value = String(firstIdx);
        second.value = String(secondIdx >= 0 ? secondIdx : 0);
    }
}

function selectedExchangeSequenceShenmaiPair(role = selectedExchangeSequenceRole()) {
    const first = document.getElementById('exchangeSequenceShenmaiFirstSelect');
    const second = document.getElementById('exchangeSequenceShenmaiSecondSelect');
    const targets = role?.shenmaiTargets || [];
    if (!first || !second || !targets.length) return null;
    const a = targets[Number(first.value)];
    const b = targets[Number(second.value)];
    return (a && b) ? { first: a, second: b } : null;
}

function exchangeSequenceShenmaiPairError(pair) {
    if (!pair) return '请先选择两条神脉';
    if (pair.first.name === pair.second.name) return '神脉互冲需要两条不同的神脉（混元 / 玄阳 / 九阴）';
    if (pair.second.washNo && (!pair.first.washNo || pair.second.washNo < pair.first.washNo)) {
        return '后锁的神脉出现在先锁的神脉之前，请对调';
    }
    return '';
}

/* ── 自带置换紫序列 ──────────────────────────────────────────────────
 * 玩家在更新前「卡」出来的现成状态：冲突脉与紫脉已经锁在场上，天然能无限置换。
 * 这个模式直接读存档槽位，找出「现在就能点置换的那条紫」，不用再洗髓去找。
 * 判定口径与内核 replaceablePositions 一致：
 *   · 普通紫：紫脉之前存在「同 type、品质 < 4、且已锁定」的冲突脉；
 *   · 神脉：场上另有不同名的神脉（混元 / 玄阳 / 九阴互冲）。
 * 找到之后走的还是普通置换那套推演：三槽 2 把锁、四槽再锁紫脉下方最近的普通脉。
 * ------------------------------------------------------------------ */

function detectOwnedExchangePurples(role) {
    const talents = role?.wasmState?.talents || [];
    const found = [];
    const isPurple = id => talentQuality(id) >= 4;
    const isShenmai = id => EXCHANGE_SEQUENCE_SHENMAI_IDS.has(Number(id));
    const nameOf = id => TALENT_DATA[String(id)]?.name || `#${id}`;
    const typeOf = id => Number(TALENT_DATA[String(id)]?.type || id);
    talents.forEach((slot, index) => {
        const id = Number(slot?.id);
        if (!id || !isPurple(id)) return;
        if (isShenmai(id)) {
            // 神脉互冲：场上另有不同名的神脉即可，不要求已锁
            const partner = talents.find(other => isShenmai(Number(other?.id)) && Number(other?.id) !== id);
            if (!partner) return;
            found.push({
                id, name: nameOf(id), conflictId: Number(partner.id), conflictName: nameOf(partner.id),
                isShenmai: true, index, locked: !!slot.locked,
            });
            return;
        }
        // 不能用紫脉之后补出来的普通冲突脉。
        for (let i = 0; i < index; i += 1) {
            const other = Number(talents[i]?.id);
            if (!other || isPurple(other) || isShenmai(other)) continue;
            if (!talents[i]?.locked) continue; // 冲突脉必须已锁，否则点不出置换
            if (typeOf(other) !== typeOf(id)) continue;
            found.push({
                id, name: nameOf(id), conflictId: other, conflictName: nameOf(other),
                isShenmai: false, index, locked: !!slot.locked,
            });
            break;
        }
    });
    return found;
}

function ownedPurpleLabel(entry) {
    return `${entry.name}（冲突 ${entry.conflictName}）${entry.locked ? '' : ' · 紫脉未锁'}`;
}

function populateExchangeSequenceOwnedSelect(role) {
    const select = document.getElementById('exchangeSequenceOwnedSelect');
    if (!select) return;
    if (role) role.ownedPurples = detectOwnedExchangePurples(role);
    const list = role?.ownedPurples || [];
    select.innerHTML = '';
    if (!list.length) {
        appendExchangeSequenceOption(select, '', '当前存档没有可直接置换的紫脉');
        select.disabled = true;
        return;
    }
    select.disabled = false;
    list.forEach((entry, index) => appendExchangeSequenceOption(select, String(index), ownedPurpleLabel(entry)));
    // 玩家锁了哪条就默认用哪条
    const lockedIdx = list.findIndex(entry => entry.locked);
    select.value = String(lockedIdx >= 0 ? lockedIdx : 0);
}

function selectedExchangeSequenceOwnedPurple(role = selectedExchangeSequenceRole()) {
    const select = document.getElementById('exchangeSequenceOwnedSelect');
    const list = role?.ownedPurples || [];
    if (!select || !list.length) return null;
    return list[Number(select.value)] || null;
}

/** 把场上这条紫包装成普通置换用的候选：紫脉当首紫，它前面已锁的同类脉当冲突脉 */
function buildOwnedPurpleCandidate(entry) {
    return {
        name: entry.name,
        talentId: entry.id,
        washNo: 0,
        conflictName: entry.conflictName,
        conflictWashTimes: 0, // 冲突脉已在场，不需要洗髓去找
        isShenmai: !!entry.isShenmai,
        isDirectPity: false,
        wasPity: false,
        canInitialize: true,
        unavailableReason: '',
    };
}

/** 自带置换紫序列模式：直接用存档里已锁好的那条紫，走与普通置换完全相同的推演与渲染 */
function generateOwnedPurpleSequence() {
    if (exchangeSequenceRunning || state.dlcMode) return;
    const role = selectedExchangeSequenceRole();
    const entry = selectedExchangeSequenceOwnedPurple(role);
    const status = document.getElementById('exchangeSequenceStatus');
    const countInput = document.getElementById('exchangeSequenceCountInput');
    if (!role || !entry) {
        if (status) {
            status.className = 'exchange-sequence-status is-error';
            status.textContent = '当前存档没有可直接置换的紫脉：需要「紫脉在场 + 它前面有一条已锁定的同类低阶冲突脉」。';
        }
        return;
    }
    const pad = readExchangeSequencePadValue(role);
    const count = Math.max(1, Math.min(EXCHANGE_SEQUENCE_COUNT_MAX, Math.trunc(Number(countInput?.value) || 10)));
    if (countInput) countInput.value = String(count);
    const candidate = buildOwnedPurpleCandidate(entry);
    exchangeSequenceRunning = true;
    updateExchangeSequenceGenerateButton(role, null);
    clearExchangeSequenceResults('正在生成自带置换紫序列…');
    if (status) {
        status.className = 'exchange-sequence-status';
        status.textContent = `正在推演「${entry.name}（冲突 ${entry.conflictName}）」的置换序列…`;
    }
    requestAnimationFrame(() => {
        let result;
        try {
            result = runExchangeSequenceWasmSandbox(() => buildExchangeSequence(role, candidate, pad, count));
        } catch (error) {
            if (status) {
                status.className = 'exchange-sequence-status is-error';
                status.textContent = error?.message || String(error);
            }
            clearExchangeSequenceResults('自带置换紫序列生成失败');
            exchangeSequenceRunning = false;
            updateExchangeSequenceGenerateButton();
            return;
        }
        renderExchangeSequence(role, candidate, pad, result);
        if (status) status.textContent = '';
        exchangeSequenceRunning = false;
        updateExchangeSequenceGenerateButton();
    });
}

/** 把选中的两条神脉包装成普通置换用的候选：后锁那条当首紫，先锁那条当冲突脉 */
function buildShenmaiSwapCandidate(pair) {
    return {
        name: pair.second.name,
        talentId: pair.second.id,
        washNo: pair.second.washNo,
        conflictName: pair.first.name,
        conflictWashTimes: pair.first.washTimes,
        isShenmai: true,
        isDirectPity: false,
        wasPity: false,
        canInitialize: true,
        unavailableReason: '',
    };
}

function firstPityJumpQualityName(quality) {
    return ['', '白', '绿', '蓝'][Number(quality) || 0] || '';
}

function talentQuality(talentId) {
    const info = TALENT_DATA[String(talentId)];
    return Number(info?.weight ?? info?.pinzhi) || 0;
}

/** 把天赋名渲染成带品质配色的 chip */
function talentChipHtml(talentId, fallbackName) {
    const info = TALENT_DATA[String(talentId)];
    const name = info?.name || fallbackName || String(talentId);
    const quality = talentQuality(talentId);
    return `<span class="talent-name q${quality}">${escapeAiHtml(name)}</span>`;
}

/**
 * 保底那一洗「紫脉下方」的普通原始脉。
 * 内核 pityGeneratedNames 的第一位是保底紫，其后是同一次洗髓里生成的普通脉，
 * 也就是玩家在洗髓界面会看到的、压在紫脉下面的那几条。
 */
function firstPityJumpUnderChips(generatedNames, generatedIds) {
    if (!Array.isArray(generatedNames) || generatedNames.length <= 1) return '';
    const ids = Array.isArray(generatedIds) ? generatedIds : [];
    return generatedNames.slice(1)
        .map((name, offset) => talentChipHtml(ids[offset + 1], name))
        .join('');
}

/**
 * 槽位数覆写。
 * 内核按 zizhi 推导槽位数（153 → 3 槽、154 → 4 槽）。开槽后无法回退，
 * 所以这里只给 3 / 4 两档，默认「跟随存档」用角色自己的资质。
 * 切档时天赋数组也要同步截断，否则 3 槽下带着 4 条天赋会自相矛盾。
 */
const FIRST_PITY_JUMP_SLOT_ZIZHI = { 3: 153, 4: 154 };

function firstPityJumpSlotOverride() {
    const raw = Number(document.getElementById('exchangeSequenceJumpSlots')?.value);
    return raw === 3 || raw === 4 ? raw : 0;
}

function applyFirstPityJumpSlotOverride(wasmState) {
    const state = cloneExchangeSequenceValue(wasmState);
    const slots = firstPityJumpSlotOverride();
    if (!slots) return state;
    state.zizhi = FIRST_PITY_JUMP_SLOT_ZIZHI[slots];
    if (Array.isArray(state.talents)) state.talents = state.talents.slice(0, slots);
    return state;
}

/* ── 首紫跳脉 · 渐进去重 ─────────────────────────────────────────
 * 「去重一次」= 锁住候选脉 → 恰好洗到下一个同 ID 被吞 → 停。
 * 每次去重后候选列表按新状态整表重算，可以反复挑下一个普通脉继续去重。
 * 全程只读，不碰真实洗脉进度；角色上挂 jumpWorkingState / jumpSteps 支持回退。
 * ---------------------------------------------------------------- */

function jumpLockedPositions(st) {
    return (st.talents || []).map((t, i) => (t && t.locked ? i : -1)).filter(i => i >= 0);
}

function jumpNormalize(st) {
    return {
        bornSeed: Number(st.seed) || 0,
        luckSeed: st.luck_seed_inited ? Number(st.luck_seed) || 0 : null,
        bornRC: Number(st.born_talent_rc) || 0,
        talLucky: Number(st.tal_lucky) || 0,
        zizhi: Number(st.zizhi) || 153,
        talents: (st.talents || []).map(t => Number(t && t.id != null ? t.id : t)).filter(Boolean),
    };
}

function jumpOptions() {
    return { saveChannel: state.saveChannel || '', international: false, dlcMode: !!state.dlcMode };
}

/** 在某状态上查：该脉下一个同名出现的洗髓次数（相对当前状态）。没有更多同名时返回 0 */
function jumpNextDedupDelta(st, talentId) {
    // wasm 注册的 wash.previewTalentOccurrences 会忽略 input.initialState，
    // 强制使用全局 wasm state T。因此先 pushStateToWasm 把当前 JS 状态推上去，
    // 再调全局包装函数 wasmPreviewTalentOccurrences(talentId, null)。
    const wrapper = (typeof wasmPreviewTalentOccurrences !== 'undefined')
        ? wasmPreviewTalentOccurrences
        : (typeof window !== 'undefined' ? window.wasmPreviewTalentOccurrences : null);
    if (typeof wrapper !== 'function') return 0;
    try {
        if (typeof pushStateToWasm === 'function') pushStateToWasm();
    } catch (_) { /* 推送失败时仍尝试用现有 wasm 状态 */ }
    let occ;
    try {
        occ = wrapper(Number(talentId) || 0, null);
    } catch (_) {
        return 0;
    }
    const list = (occ && occ.occurrences) || [];
    const times = list.map(o => Number(o.wash_times) || 0).filter(t => t > 0).sort((a, b) => a - b);
    return times.length ? times[0] : 0;
}

/** 从某状态一路洗到出紫，返回保底紫与其下普通脉。锁脉状态全程保留 */
function jumpPityAfter(startState, maxWashes, onCost) {
    const results = AlgorithmWasmBridge.call('wash.washMany', {
        input: {
            initialState: startState,
            state: jumpNormalize(startState),
            options: jumpOptions(),
            keepPositions: jumpLockedPositions(startState),
            count: Math.max(1, maxWashes),
            untilPurple: true,
            targetId: 0,
        },
    });
    const list = Array.isArray(results) ? results : [];
    if (!list.length) throw new Error('洗到出紫失败：无推演结果');
    const last = list[list.length - 1];
    const pills = list.reduce((s, r) => s + (Number(r.cost) || 0), 0);
    const washes = list.length;
    if (onCost) onCost(pills, washes);
    const next = jumpStateAfter(startState, last);
    const keepIds = new Set((last.keepIds || []).map(Number));
    const qualityOf = id => Number(TALENT_DATA[String(id)]?.weight ?? TALENT_DATA[String(id)]?.pinzhi) || 0;
    const unlockedIds = (next.talents || []).map(t => Number(t.id)).filter(id => !keepIds.has(id));
    const purpleId = unlockedIds.find(id => qualityOf(id) >= 4) || 0;
    const underNames = unlockedIds.filter(id => id !== purpleId)
        .map(id => TALENT_DATA[String(id)]?.name || String(id));
    return {
        state: next,
        purpleId,
        purpleName: purpleId ? (TALENT_DATA[String(purpleId)]?.name || String(purpleId)) : '（未找到保底紫）',
        underNames,
        pills, washes,
    };
}

/** 保底紫出现后的置换序列（欧气种子已固定，取后续前 count 个紫脉） */
function jumpSequenceAfter(state, count) {
    const preview = AlgorithmWasmBridge.call('wash.previewSequence', {
        input: {
            initialState: state,
            state: jumpNormalize(state),
            options: jumpOptions(),
            keepPositions: jumpLockedPositions(state),
            maxBars: Math.max(300, count * 60),
            totalBars: Number(state.total_talent_bars) || 0,
            totalWash: Number(state.total_wash) || 0,
        },
    });
    const purples = (preview && Array.isArray(preview.purples)) ? preview.purples : [];
    return purples.slice(0, Math.max(1, count)).map(p => ({
        name: p.talent_name,
        id: Number(p.talent_id) || 0,
        washNo: Number(p.wash_no) || 0,
        washTimes: Number(p.wash_times) || 0,
    }));
}

function jumpWashMany(st, count) {
    // 与 wasm_algorithm_api 一致：payload 必须包在 input 里，否则内核报「缺少洗脉状态」
    const results = AlgorithmWasmBridge.call('wash.washMany', {
        input: {
            initialState: st,
            state: jumpNormalize(st),
            options: jumpOptions(),
            keepPositions: jumpLockedPositions(st),
            count: Math.max(1, Math.trunc(count) || 1),
            untilPurple: false,
            targetId: 0,
        },
    });
    return Array.isArray(results) ? results : [];
}

function jumpStateAfter(prev, last) {
    const keepIds = new Set((last.keepIds || []).map(Number));
    const next = cloneExchangeSequenceValue(prev);
    next.seed = Number(last.state.bornSeed) || 0;
    next.luck_seed = last.state.luckSeed != null ? Number(last.state.luckSeed) : 0;
    next.luck_seed_inited = last.state.luckSeed != null;
    next.born_talent_rc = Number(last.state.bornRC) || 0;
    next.tal_lucky = Number(last.state.talLucky) || 0;
    next.talents = (last.state.talents || []).map(id => ({
        id: Number(id),
        locked: keepIds.has(Number(id)),
    }));
    return next;
}

function jumpWashCost(st, extraLocked = 0) {
    const zz = ZZ_DATA[String(Number(st.zizhi) || 153)] || {};
    const base = Number(zz.eat_xisui) || 0;
    const locked = (st.talents || []).filter(t => t.locked).length + extraLocked;
    return locked > 0 ? base + 2 * locked - 1 : base;
}

function jumpWorkingStateOf(role) {
    if (role?.jumpWorkingState) return cloneExchangeSequenceValue(role.jumpWorkingState);
    return applyFirstPityJumpSlotOverride(role?.wasmState);
}

/** 「去重一次」的总丹耗：出现前按未锁价，锁定后按多锁一条的价 */
function jumpDedupCost(role, candidate) {
    const st = jumpWorkingStateOf(role);
    const unlockedCost = jumpWashCost(st);
    const lockedCost = jumpWashCost(st, 1);
    const occurrence = Math.max(0, Math.trunc(Number(candidate.occurrenceWashTimes) || 0));
    const firstDup = Math.max(0, Math.trunc(Number(candidate.firstDuplicateWashTimes) || 0));
    return occurrence * unlockedCost + Math.max(0, firstDup - occurrence) * lockedCost;
}

function jumpProgressTextOf(role) {
    const count = role?.jumpAnalysis?.candidates?.length || 0;
    const base = count ? `已分析 ${count} 个候选普通脉` : '尚未分析';
    const origin = role?.jumpOriginTotalWash;
    const cur = role?.jumpWorkingState ? Number(role.jumpWorkingState.total_wash) || 0 : (origin || 0);
    const adv = origin != null ? Math.max(0, cur - origin) : 0;
    return adv > 0 ? `${base} · 累计推进 ${adv} 次洗髓` : base;
}

/** 高亮阈值：下一个同名在 N 次洗髓内就算「近」，用户可手输，默认 5 */
function jumpNearThreshold() {
    const raw = Math.trunc(Number(document.getElementById('jumpNearInput')?.value));
    if (!Number.isFinite(raw) || raw < 1) return 5;
    return Math.min(2000, raw);
}

/* ── 首紫跳脉 · 锚点紫选择 ───────────────────────────────────────
 * 列表当前角色前 N 个紫（含一心/神脉/保底），供用户挑「以哪个紫为锚点」。
 * 若首紫是一心两用 / 神脉（玩家会跳过），其后第一个保底才是真正首紫保底，
 * 选它即可让候选分析针对那个保底紫，而非自动定位的「最近保底」。
 * 全部只读，不碰真实洗脉进度。
 * ---------------------------------------------------------------- */

/** 列出角色前 JUMP_TARGET_PURPLE_LIMIT 个紫，含类型与位置信息 */
function listJumpTargetPurples(role) {
    const source = jumpWorkingStateOf(role);
    source.global_vars = exchangeSequenceDataset.globalVars;
    let preview;
    try {
        preview = AlgorithmWasmBridge.call('wash.previewSequence', {
            input: {
                initialState: source,
                state: jumpNormalize(source),
                options: jumpOptions(),
                keepPositions: jumpLockedPositions(source),
                maxBars: 10000,
                totalBars: Number(source.total_talent_bars) || 0,
                totalWash: Number(source.total_wash) || 0,
            },
        });
    } catch (error) {
        return [];
    }
    const purples = (preview && Array.isArray(preview.purples)) ? preview.purples : [];
    return purples.slice(0, JUMP_TARGET_PURPLE_LIMIT).map((p, index) => {
        const id = Number(p.talent_id) || 0;
        return {
            index,
            name: p.talent_name || String(id),
            talentId: id,
            washNo: Number(p.wash_no) || 0,
            washTimes: Number(p.wash_times) || 0,
            isPity: !!p.was_pity,
            isShenmai: EXCHANGE_SEQUENCE_SHENMAI_IDS.has(id),
            isYixin: EXCHANGE_SEQUENCE_YIXIN_IDS.has(id),
            quality: talentQuality(id),
        };
    });
}

/** 填充「锚点紫」下拉框；默认选中第一个保底紫（无保底则选第 1 个紫） */
function populateExchangeSequenceJumpPurpleSelect(role) {
    const select = document.getElementById('exchangeSequenceJumpPurpleSelect');
    if (!select) return;
    select.innerHTML = '';
    const purples = role?.jumpTargetPurples || [];
    if (!purples.length) {
        appendExchangeSequenceOption(select, '', '该角色暂无可分析紫');
        select.disabled = true;
        return;
    }
    // ── 首脉规则（首脉优化）──────────────────────────────────────────────
    // 首次紫脉 = 一心两用 → 直接跳过（开头可连续跳过多个）
    // 首次紫脉 = 神脉   → 优先走神脉置换（规划器已支持「神脉 source + 另一条不同名神脉
    //                     conflict」，见 anchor_route_planner.js 的 prepareSource）；
    //                     若脉序里没有另一条不同名神脉可互冲，则按开关决定「保留」或「跳过」，
    //                     默认保留。开关存放于 localStorage: yyjh_first_shenmai_keep（'0' = 跳过）
    let firstStart = 0;
    while (firstStart < purples.length && purples[firstStart].isYixin) {
        purples[firstStart].skippedReason = '一心两用';
        firstStart += 1;
    }
    const firstRealPurple = purples[firstStart];
    if (firstRealPurple && firstRealPurple.isShenmai) {
        const partner = purples.some((p, i) => i !== firstStart && p.isShenmai && p.talentId !== firstRealPurple.talentId);
        firstRealPurple.shenmaiPartner = partner;
        if (!partner) {
            let keep = true;
            try { keep = localStorage.getItem('yyjh_first_shenmai_keep') !== '0'; } catch (e) { /* 无存储环境按保留 */ }
            firstRealPurple.shenmaiKeep = keep;
            if (!keep) {
                firstRealPurple.skippedReason = '神脉（无可置换，按设置跳过）';
                firstStart += 1;
            }
        }
    }
    purples.forEach(purple => {
        const type = purple.isPity ? '保底' : (purple.isShenmai ? '神脉' : (purple.isYixin ? '一心' : '普通'));
        const skipNote = purple.skippedReason ? ` · ${purple.skippedReason}（已跳过）` : '';
        const label = `第 ${purple.index + 1} 个紫 · ${purple.name} · ${type}${skipNote} · #${purple.washNo} · 第 ${purple.washTimes} 洗`;
        appendExchangeSequenceOption(select, String(purple.index), label, {
            className: (purple.isPity ? 'pity-purple-option' : (purple.isYixin ? 'yixin-purple-option' : ''))
                + (purple.skippedReason ? ' first-purple-skipped' : ''),
        });
    });
    const defaultIdx = (() => {
        const pity = purples.findIndex((p, i) => p.isPity && i >= firstStart);
        return pity >= 0 ? pity : firstStart;
    })();
    let selected = (role?.jumpTargetIndex != null && role.jumpTargetIndex >= 0)
        ? Math.min(role.jumpTargetIndex, purples.length - 1)
        : (defaultIdx >= 0 ? defaultIdx : 0);
    select.value = String(selected);
    select.disabled = purples.length <= 1;
    role.jumpTargetIndex = selected;
    role.firstPurpleStart = firstStart;
    role.firstPurpleSkipped = purples.slice(0, firstStart).map(p => p.name);
}

/** 从 baseState 一路洗到「第 targetIndex 个紫出现之前」的状态。
 *  targetIndex=0 表示不跳（直接用 baseState，也就是内核自动定位的首紫保底）。 */
function jumpSkipToPurpleState(baseState, targetIndex) {
    if (!targetIndex || targetIndex <= 0) return cloneExchangeSequenceValue(baseState);
    let st = cloneExchangeSequenceValue(baseState);
    let totalWash = Number(st.total_wash) || 0;
    let totalPills = Number(st.total_pills) || 0;
    for (let i = 0; i < targetIndex; i += 1) {
        let res;
        try {
            res = AlgorithmWasmBridge.call('wash.washMany', {
                input: {
                    initialState: st,
                    state: jumpNormalize(st),
                    options: jumpOptions(),
                    keepPositions: jumpLockedPositions(st),
                    count: 1e7,
                    untilPurple: true,
                    targetId: 0,
                },
            });
        } catch (error) {
            break;
        }
        const list = Array.isArray(res) ? res : [];
        if (!list.length) break;
        totalWash += list.length;
        totalPills += list.reduce((sum, r) => sum + (Number(r.cost) || 0), 0);
        const last = list[list.length - 1];
        const next = cloneExchangeSequenceValue(st);
        next.seed = Number(last.state.bornSeed) || 0;
        next.luck_seed = last.state.luckSeed != null ? Number(last.state.luckSeed) : 0;
        next.luck_seed_inited = last.state.luckSeed != null;
        next.born_talent_rc = Number(last.state.bornRC) || 0;
        next.tal_lucky = Number(last.state.talLucky) || 0;
        const keepIds = new Set((last.keepIds || []).map(Number));
        next.talents = (last.state.talents || []).map(id => ({ id: Number(id), locked: keepIds.has(Number(id)) }));
        next.total_wash = totalWash;
        next.total_pills = totalPills;
        next.total_talent_bars = Number(st.total_talent_bars) || 0;
        next.global_vars = st.global_vars;
        st = next;
    }
    return st;
}

/** 当前角色「用于分析的基础状态」：在没有去重推进时就是槽位覆盖后的存档；去重推进后则是去重后的状态 */
function jumpBaseStateOf(role) {
    return jumpWorkingStateOf(role);
}

/** 锚点状态 = 基础状态再跳到「第 jumpTargetIndex 个紫之前」。候选与推演都以此为准，避免重复跳紫 */
function jumpTargetStateOf(role) {
    const base = jumpBaseStateOf(role);
    return jumpSkipToPurpleState(base, role.jumpTargetIndex || 0);
}

/** 把一段 washMany 原始结果累积进 prevState，返回推进后的 wasm 状态（累计洗髓/丹耗/脉数） */
function jumpAdvanceState(prevState, washList, startTotalWash, startTotalPills, startTotalBars) {
    let totalWash = startTotalWash;
    let totalPills = startTotalPills;
    let totalBars = startTotalBars;
    let last = null;
    for (const r of (Array.isArray(washList) ? washList : [])) {
        totalWash += 1;
        totalPills += Math.max(0, Math.trunc(Number(r.cost) || 0));
        totalBars += Math.max(0, Math.trunc(Number(r.generatedBars) || 0));
        last = r;
    }
    if (!last || !last.state) return null;
    const next = cloneExchangeSequenceValue(prevState);
    next.seed = Number(last.state.bornSeed) || 0;
    next.luck_seed = last.state.luckSeed != null ? Number(last.state.luckSeed) : 0;
    next.luck_seed_inited = last.state.luckSeed != null;
    next.born_talent_rc = Number(last.state.bornRC) || 0;
    next.tal_lucky = Number(last.state.talLucky) || 0;
    const keepIds = new Set((last.keepIds || []).map(Number));
    next.talents = (last.state.talents || []).map(id => ({ id: Number(id), locked: keepIds.has(Number(id)) }));
    next.total_wash = totalWash;
    next.total_pills = totalPills;
    next.total_talent_bars = totalBars;
    next.global_vars = prevState.global_vars;
    return next;
}

/** 模拟「去重」一次：锁定候选原始脉 → 洗到它再次出现（吞掉）→ 返回去重后的状态。
 *  分两段 washMany：先无锁洗到出现位置确定槽位，再从出现位置锁该槽位洗到重名脉，
 *  这样与内核 firstPityJumpSequence 的「出现才锁定」语义一致，避免从起点锁导致序列走偏。 */
function jumpDedupStepState(baseState, candidate) {
    const occTimes = Math.max(1, Math.trunc(Number(candidate.occurrenceWashTimes) || 1));
    const dupTimes = Math.max(occTimes, Math.trunc(Number(candidate.firstDuplicateWashTimes) || occTimes));
    const gap = Math.max(1, dupTimes - occTimes);
    const baseWash = Number(baseState.total_wash) || 0;
    const basePills = Number(baseState.total_pills) || 0;
    const baseBars = Number(baseState.total_talent_bars) || 0;

    // 第一段：无锁洗到候选原始脉出现，定位它所在的槽位
    let res = AlgorithmWasmBridge.call('wash.washMany', {
        input: {
            initialState: baseState,
            state: jumpNormalize(baseState),
            options: jumpOptions(),
            keepPositions: jumpLockedPositions(baseState),
            count: occTimes,
            untilPurple: false,
            targetId: 0,
        },
    });
    const occList = Array.isArray(res) ? res : [];
    const occ = occList[occList.length - 1];
    if (!occ || !occ.state) return null;
    // talentId 可能未在候选里返回，按名字兜底查，避免锁定槽位找不到导致整段 return null、状态不前进
    const targetTalentId = Number(candidate.talentId)
        || Number(exchangeSequenceTalentByName(candidate.name)?.id)
        || 0;
    const lockPos = (occ.state.talents || []).findIndex(id => Number(id) === targetTalentId);
    if (lockPos < 0) return null;
    const occState = jumpAdvanceState(baseState, occList, baseWash, basePills, baseBars);
    if (!occState) return null;

    // 第二段：从出现位置锁住该槽位，洗到重名脉（吞掉）
    res = AlgorithmWasmBridge.call('wash.washMany', {
        input: {
            initialState: occState,
            state: jumpNormalize(occState),
            options: jumpOptions(),
            keepPositions: [...jumpLockedPositions(occState), lockPos],
            count: gap,
            untilPurple: false,
            targetId: 0,
        },
    });
    const dupList = Array.isArray(res) ? res : [];
    const postState = jumpAdvanceState(occState, dupList, occState.total_wash, occState.total_pills, occState.total_talent_bars);
    // 吞掉后该槽位不再锁定（被同 ID 去重消耗），避免下一轮分析把它当作永久锁
    if (postState && postState.talents[lockPos]) postState.talents[lockPos].locked = false;
    return postState;
}

function clearFirstPityJumpCandidates(message = '正在分析普通脉候选…') {
    setFirstPityJumpPanelVisible(true);
    const pity = document.getElementById('exchangeSequenceJumpPity');
    const meta = document.getElementById('exchangeSequenceJumpMeta');
    const empty = document.getElementById('exchangeSequenceJumpEmpty');
    const list = document.getElementById('exchangeSequenceJumpCandidates');
    if (pity) pity.textContent = '正在定位最近保底紫…';
    if (meta) meta.textContent = '尚未分析';
    if (empty) {
        empty.hidden = false;
        empty.textContent = message;
    }
    if (list) {
        list.innerHTML = '';
        list.hidden = true;
    }
}

function setFirstPityJumpSimulationButtonState(index = -1, state = 'idle') {
    document.querySelectorAll('.btn-first-pity-jump-simulate').forEach(button => {
        const active = Number(button.dataset.index) === Number(index);
        const running = active && state === 'running';
        const simulated = active && state === 'simulated';
        button.classList.toggle('is-running', running);
        button.classList.toggle('is-simulated', simulated);
        button.textContent = running ? '推演中…' : (simulated ? '推演完成' : '推演');
        button.setAttribute('aria-pressed', String(simulated));
    });
}

function renderFirstPityJumpCandidates(role) {
    const analysis = role?.jumpAnalysis;
    const progressEl = document.getElementById('jumpProgressText');
    if (progressEl) progressEl.textContent = jumpProgressTextOf(role);
    const pity = document.getElementById('exchangeSequenceJumpPity');
    const meta = document.getElementById('exchangeSequenceJumpMeta');
    const empty = document.getElementById('exchangeSequenceJumpEmpty');
    const list = document.getElementById('exchangeSequenceJumpCandidates');

    setFirstPityJumpPanelVisible(true);

    if (!analysis?.available) {
        if (pity) pity.textContent = analysis?.reason || '当前状态无法进行首紫跳脉';
        if (meta) meta.textContent = `${Number(analysis?.slotCount) || 0} 槽状态`;
        const nearCountEl = document.getElementById('jumpNearCount');
        if (nearCountEl) nearCountEl.textContent = '';
        if (empty) {
            empty.hidden = false;
            empty.textContent = analysis?.reason || '没有可用候选';
        }
        if (list) list.hidden = true;
        return;
    }

    const baseline = analysis.baselinePity || {};
    if (pity) {
        pity.textContent = `#${baseline.washNo || 0} ${baseline.purpleName || '未知紫脉'} · 第 ${baseline.washTimes || 0} 次洗髓`;
    }

    const candidates = analysis.candidates || [];
    const slotText = Number(analysis.slotCount) ? ` · 按 ${analysis.slotCount} 槽计算` : '';
    const anchorIndex = Number(analysis.targetIndex) || 0;
    const anchorPurple = (role?.jumpTargetPurples || [])[anchorIndex];
    const anchorLabel = anchorPurple
        ? `锚点：第 ${anchorIndex + 1} 个紫 · ${anchorPurple.name}${anchorPurple.isYixin ? '（一心，已跳过）' : ''}`
        : `锚点：第 ${anchorIndex + 1} 个紫`;
    const origin = role?.jumpOriginTotalWash;
    const cur = role?.jumpWorkingState ? Number(role.jumpWorkingState.total_wash) || 0 : (origin || 0);
    const adv = origin != null ? Math.max(0, cur - origin) : 0;
    if (meta) meta.textContent = `${anchorLabel} · 已分析 ${candidates.length} 个候选普通脉位置${slotText}${adv > 0 ? ` · 累计推进 ${adv} 次洗髓` : ''}`;

    if (!candidates.length) {
        if (empty) {
            empty.hidden = false;
            empty.textContent = '该锚点保底前没有可用的普通脉候选';
        }
        if (list) list.hidden = true;
        return;
    }

    if (empty) empty.hidden = true;
    if (list) {
        const nearLimit = jumpNearThreshold();
        let nearCount = 0;
        list.innerHTML = candidates.map((candidate, index) => {
            const quality = Number(candidate.quality) || 0;
            const position = candidate.fromCurrent
                ? '当前槽位'
                : `#${candidate.occurrenceWashNo} · 第 ${candidate.occurrenceWashTimes} 次洗髓后`;
            const firstDup = Math.max(0, Math.trunc(Number(candidate.firstDuplicateWashTimes) || 0));
            const isNear = firstDup <= nearLimit;
            if (isNear) nearCount += 1;
            return `
            <article class="exchange-sequence-jump-candidate${isNear ? ' is-near' : ''}">
                <div class="exchange-sequence-jump-talent">
                    <span class="log-talent q${quality}">${firstPityJumpQualityName(quality)}</span>
                    <strong>${escapeAiHtml(candidate.name)}</strong>
                    ${isNear ? '<b class="jump-near-tag">近</b>' : ''}
                </div>
                <div><span>出现位置</span><b>${position}</b></div>
                <div><span>吞完保底</span><b>#${candidate.pityWashNo} ${talentChipHtml(candidate.pityPurpleId, candidate.pityPurpleName)} · 第 ${candidate.pityWashTimes} 洗</b></div>
                <div><span>紫下普通脉</span><b class="jump-under">${firstPityJumpUnderChips(candidate.pityGeneratedNames, candidate.pityGeneratedIds) || '（无）'}</b></div>
                <div><span>同 ID 去重</span><b>再点 ${firstDup} 次洗髓可吞掉</b></div>
                <div class="jump-actions">
                    <button type="button" class="btn btn-wash-plain btn-first-pity-jump-simulate" data-index="${index}" aria-pressed="false">推演保底紫序列</button>
                    <button type="button" class="btn btn-wash-plain btn-first-pity-jump-dedup" data-index="${index}">去重 · 吞掉</button>
                </div>
            </article>`;
        }).join('');
        list.hidden = false;
        list.querySelectorAll('.btn-first-pity-jump-simulate').forEach(button => {
            button.addEventListener('click', () => generateFirstPityJumpSequence(Number(button.dataset.index)));
        });
        list.querySelectorAll('.btn-first-pity-jump-dedup').forEach(button => {
            button.addEventListener('click', () => generateFirstPityJumpDedup(Number(button.dataset.index)));
        });
        const nearCountEl = document.getElementById('jumpNearCount');
        if (nearCountEl) nearCountEl.textContent = `${nearCount} / ${candidates.length} 条在 ${nearLimit} 次内`;
    }
}

async function populateFirstPityJumpCandidates(token, role, statusEl) {
    clearFirstPityJumpCandidates();
    setExchangeSequenceSlotPanels(null);
    updateExchangeSequenceGenerateButton(null, null);

    if (!role) {
        setFirstPityJumpPanelVisible(false);
        return;
    }

    // 列出前 N 个紫供「锚点紫」下拉选择（只算一次，槽位变化时会重置缓存）
    if (!role.jumpTargetPurplesReady) {
        try {
            role.jumpTargetPurples = listJumpTargetPurples(role);
        } catch (error) {
            role.jumpTargetPurples = [];
        }
        role.jumpTargetPurplesReady = true;
    }
    // 下拉框每次都按当前角色重填（角色/槽位切换后要同步显示）
    populateExchangeSequenceJumpPurpleSelect(role);

    if (state.dlcMode) {
        role.jumpAnalysis = {
            available: false,
            reason: '测试服额外保底规则暂不支持首紫跳脉',
            slotCount: role.slotCount,
            candidates: [],
        };
        role.jumpCandidatesReady = true;
        renderFirstPityJumpCandidates(role);
        if (statusEl) {
            statusEl.className = 'exchange-sequence-status is-error';
            statusEl.textContent = role.jumpAnalysis.reason;
        }
        return;
    }

    if (!role.jumpCandidatesReady) {
        if (statusEl) {
            statusEl.className = 'exchange-sequence-status';
            statusEl.textContent = `正在分析「${role.roleName}」最近保底前的有效去重普通脉…`;
        }
        await new Promise(resolve => requestAnimationFrame(() => setTimeout(resolve, 0)));
        if (token !== exchangeSequenceCandidateLoadToken || role !== selectedExchangeSequenceRole() || !isFirstPityJumpMode()) return;
        // 记录初始洗髓进度（仅在还没去重、尚未记录时），用于「累计推进」展示
        if (role.jumpOriginTotalWash == null && role.jumpWorkingState == null) {
            role.jumpOriginTotalWash = Number(role.wasmState?.total_wash) || 0;
        }
        try {
            const targetState = jumpTargetStateOf(role);
            targetState.global_vars = exchangeSequenceDataset.globalVars;
            role.jumpAnalysis = wasmFirstPityJumpCandidates(targetState);
            role.jumpAnalysis.targetIndex = role.jumpTargetIndex || 0;
            role.jumpCandidatesReady = true;
        } catch (error) {
            role.jumpAnalysis = {
                available: false,
                reason: error?.message || String(error),
                slotCount: role.slotCount,
                candidates: [],
            };
            role.jumpCandidatesReady = true;
        }
    }

    if (token !== exchangeSequenceCandidateLoadToken || role !== selectedExchangeSequenceRole() || !isFirstPityJumpMode()) return;

    renderFirstPityJumpCandidates(role);
    updateJumpDedupControls(role);
    if (statusEl) {
        const count = role.jumpAnalysis?.candidates?.length || 0;
        const action = role.jumpLastAction ? role.jumpLastAction + ' · ' : '';
        statusEl.className = role.jumpAnalysis?.available ? 'exchange-sequence-status' : 'exchange-sequence-status is-error';
        statusEl.textContent = role.jumpAnalysis?.available
            ? `${action}已筛选完成：${count} 个普通脉位置能以同 ID 去重改变首位保底置换序列。`
            : (role.jumpAnalysis?.reason || '当前状态无法进行首紫跳脉。');
    }
}

function buildFirstPityJumpSequence(role, candidate, count) {
    const targetState = jumpTargetStateOf(role);
    targetState.global_vars = exchangeSequenceDataset.globalVars;
    return wasmFirstPityJumpSequence(targetState, candidate, count);
}

function renderFirstPityJumpSequence(role, candidate, sequence) {
    const initialSeed = document.getElementById('exchangeSequenceInitialSeed');
    const grid = document.getElementById('exchangeSequenceGrid');
    const empty = document.getElementById('exchangeSequenceEmpty');
    const meta = document.getElementById('exchangeSequenceResultMeta');
    const tableWrap = document.getElementById('exchangeSequenceTableWrap');
    const summary = document.getElementById('exchangeSequenceJumpSummary');
    const outputs = Array.isArray(sequence?.outputs) ? sequence.outputs : [];
    const pity = sequence?.pity || {};
    const generatedNames = Array.isArray(pity.generatedNames) ? pity.generatedNames : [];
    const purpleId = Array.isArray(pity.generatedIds) ? pity.generatedIds[0] : pity.purpleId;
    const purpleName = generatedNames[0] || pity.purpleName || '—';
    const underChips = firstPityJumpUnderChips(generatedNames, pity.generatedIds);

    if (initialSeed) initialSeed.textContent = '已验证去重并生成跳脉序列';
    if (empty) empty.hidden = true;
    if (tableWrap) tableWrap.hidden = true;

    // 保底那一洗的完整构成：紫脉 + 压在它下面的普通原始脉（手动操作时按这个找）
    if (summary) {
        summary.innerHTML = `
            <div class="jump-summary-row"><span>保底那一洗</span><b>第 ${pity.washTimes || 0} 次洗髓 · 脉序 #${pity.washNo || 0}</b></div>
            <div class="jump-summary-row"><span>保底紫脉</span><b>${talentChipHtml(purpleId, purpleName)}</b></div>
            <div class="jump-summary-row"><span>紫下普通脉</span><b>${underChips || '（该洗只有紫脉）'}</b></div>
            <div class="jump-summary-row"><span>本次锁定</span><b>${talentChipHtml(candidate.talentId, candidate.name)} · 同 ID 去重 ${sequence.duplicateCount} 次</b></div>`;
        summary.hidden = false;
    }

    if (grid) {
        grid.innerHTML = outputs.map(item => (
            `<li data-index="${item.index}" data-source-wash-no="${item.sourceWashNo ?? ''}"`
            + ` title="第 ${item.index} 条置换紫脉（源自脉序 #${item.sourceWashNo ?? '—'}）">`
            + `${talentChipHtml(item.talentId, item.name)}</li>`
        )).join('');
        grid.hidden = false;
    }
    if (meta) {
        meta.innerHTML = `${escapeAiHtml(role.roleName)} · 锁定 <b>${escapeAiHtml(candidate.name)}</b>`
            + ` · 同 ID 去重 ${sequence.duplicateCount} 次 · 置换紫脉前 ${outputs.length} 条`;
    }
}

function generateFirstPityJumpSequence(index) {
    if (exchangeSequenceRunning || state.dlcMode || !isFirstPityJumpMode()) return;
    const role = selectedExchangeSequenceRole();
    const candidate = role?.jumpAnalysis?.candidates?.[index];
    const statusEl = document.getElementById('exchangeSequenceStatus');
    const countInput = document.getElementById('exchangeSequenceCountInput');
    if (!role || !candidate) {
        if (statusEl) {
            statusEl.className = 'exchange-sequence-status is-error';
            statusEl.textContent = '首紫跳脉候选已经变化，请重新分析。';
        }
        return;
    }
    const count = Math.max(1, Math.min(200, Math.trunc(Number(countInput?.value) || 20)));
    if (countInput) countInput.value = String(count);

    exchangeSequenceRunning = true;
    updateExchangeSequenceGenerateButton(role, null);
    setFirstPityJumpSimulationButtonState(index, 'running');
    document.querySelectorAll('.btn-first-pity-jump-simulate').forEach(button => { button.disabled = true; });
    clearExchangeSequenceResults('正在模拟锁定、去重与首位保底…');
    if (statusEl) {
        statusEl.className = 'exchange-sequence-status';
        statusEl.textContent = `正在推演锁定「${candidate.name}」后的首紫跳脉…`;
    }

    requestAnimationFrame(() => {
        try {
            const sequence = buildFirstPityJumpSequence(role, candidate, count);
            renderFirstPityJumpSequence(role, candidate, sequence);
            setFirstPityJumpSimulationButtonState(index, 'simulated');
            if (statusEl) {
                statusEl.textContent = `推演完成，第 ${sequence.firstDuplicateWashTimes} 洗发生同 ID 去重，首位保底后置换序列已列出。`;
            }
        } catch (error) {
            setFirstPityJumpSimulationButtonState();
            if (statusEl) {
                statusEl.className = 'exchange-sequence-status is-error';
                statusEl.textContent = error?.message || String(error);
            }
            clearExchangeSequenceResults('首紫跳脉推演失败');
        } finally {
            exchangeSequenceRunning = false;
            updateExchangeSequenceGenerateButton();
            document.querySelectorAll('.btn-first-pity-jump-simulate').forEach(button => { button.disabled = false; });
        }
    });
}

/** 更新回退/重置按钮可用状态与「已去重 N 步」状态条 */
function updateJumpDedupControls(role) {
    const undoBtn = document.getElementById('exchangeSequenceJumpDedupUndo');
    const resetBtn = document.getElementById('exchangeSequenceJumpDedupReset');
    const statusEl = document.getElementById('exchangeSequenceJumpDedupStatus');
    const stack = (role && role.jumpDedupStack) || [];
    if (undoBtn) undoBtn.disabled = stack.length === 0 || !isFirstPityJumpMode();
    if (resetBtn) resetBtn.disabled = stack.length === 0 || !isFirstPityJumpMode();
    if (statusEl) {
        statusEl.textContent = stack.length
            ? `已去重 ${stack.length} 步：${stack.map(step => step.candidate?.name || '?').join(' → ')}`
            : '尚未进行去重';
    }
}

/** 去重一次：锁定候选原始脉并吞掉其重名脉，展示新保底紫与置换脉序，并把候选列表刷新到去重后的新保底 */
function generateFirstPityJumpDedup(index) {
    if (exchangeSequenceRunning || !isFirstPityJumpMode()) return;
    const role = selectedExchangeSequenceRole();
    const candidate = role?.jumpAnalysis?.candidates?.[index];
    const statusEl = document.getElementById('exchangeSequenceStatus');
    if (!role || !candidate) {
        if (statusEl) {
            statusEl.className = 'exchange-sequence-status is-error';
            statusEl.textContent = '首紫跳脉候选已经变化，请重新分析。';
        }
        return;
    }
    const countInput = document.getElementById('exchangeSequenceCountInput');
    const count = Math.max(1, Math.min(200, Math.trunc(Number(countInput?.value) || 20)));
    if (countInput) countInput.value = String(count);

    const baseState = jumpBaseStateOf(role);
    const preBaseState = cloneExchangeSequenceValue(baseState);
    const preTargetIndex = role.jumpTargetIndex || 0;

    exchangeSequenceRunning = true;
    updateJumpDedupControls(role);
    document.querySelectorAll('.btn-first-pity-jump-dedup').forEach(button => { button.disabled = true; });
    if (statusEl) {
        statusEl.className = 'exchange-sequence-status';
        statusEl.textContent = `正在去重「${candidate.name}」并推演置换脉序…`;
    }

    requestAnimationFrame(() => {
        try {
            // 展示该次去重后的新保底紫 + 置换脉序
            const sequence = buildFirstPityJumpSequence(role, candidate, count);
            renderFirstPityJumpSequence(role, candidate, sequence);
            // 推进到去重后的状态（吞掉重名脉之后）
            const targetState = jumpTargetStateOf(role);
            const postState = jumpDedupStepState(targetState, candidate);
            role.jumpDedupStack = role.jumpDedupStack || [];
            role.jumpDedupStack.push({
                candidate: cloneExchangeSequenceValue(candidate),
                preBaseState,
                preTargetIndex,
                sequence,
                pityName: candidate.pityPurpleName,
            });
            if (postState) {
                postState.global_vars = exchangeSequenceDataset.globalVars;
                role.jumpWorkingState = postState;
            }
            // 锚点回到去重后的「第一个保底」，候选列表刷新（被吞掉/过掉的原始脉不再出现）
            role.jumpTargetIndex = 0;
            role.jumpCandidatesReady = false;
            role.jumpTargetPurplesReady = false;
            if (statusEl) {
                statusEl.className = 'exchange-sequence-status';
                statusEl.textContent = `已去重「${candidate.name}」，新保底「${candidate.pityPurpleName}」已列出；可继续挑选下一条原始脉或回退。`;
            }
            void populateFirstPityJumpCandidates(++exchangeSequenceCandidateLoadToken, role, statusEl);
        } catch (error) {
            if (statusEl) {
                statusEl.className = 'exchange-sequence-status is-error';
                statusEl.textContent = error?.message || String(error);
            }
        } finally {
            exchangeSequenceRunning = false;
            updateJumpDedupControls(role);
            document.querySelectorAll('.btn-first-pity-jump-dedup').forEach(button => { button.disabled = false; });
        }
    });
}

/** 回退一步：恢复到上一次去重之前的状态 */
function jumpDedupUndo() {
    const role = selectedExchangeSequenceRole();
    if (!role?.jumpDedupStack?.length || exchangeSequenceRunning || !isFirstPityJumpMode()) return;
    const step = role.jumpDedupStack.pop();
    role.jumpWorkingState = step.preBaseState ? cloneExchangeSequenceValue(step.preBaseState) : null;
    role.jumpTargetIndex = step.preTargetIndex || 0;
    role.jumpCandidatesReady = false;
    role.jumpTargetPurplesReady = false;
    updateJumpDedupControls(role);
    const statusEl = document.getElementById('exchangeSequenceStatus');
    void populateFirstPityJumpCandidates(++exchangeSequenceCandidateLoadToken, role, statusEl);
}

/** 重置：回到最原始情况（清掉所有去重、锚点回到用户最初选择） */
function jumpDedupReset() {
    const role = selectedExchangeSequenceRole();
    if (!role || exchangeSequenceRunning || !isFirstPityJumpMode()) return;
    const originalIndex = role.jumpDedupStack?.[0]?.preTargetIndex || 0;
    role.jumpDedupStack = [];
    role.jumpWorkingState = null;
    role.jumpOriginTotalWash = null;
    role.jumpTargetIndex = originalIndex;
    role.jumpCandidatesReady = false;
    role.jumpTargetPurplesReady = false;
    updateJumpDedupControls(role);
    const statusEl = document.getElementById('exchangeSequenceStatus');
    void populateFirstPityJumpCandidates(++exchangeSequenceCandidateLoadToken, role, statusEl);
}

function updateExchangeSequenceSelection() {
    const role = selectedExchangeSequenceRole();
    const candidate = selectedExchangeSequenceCandidate(role);
    const seedSource = document.getElementById('exchangeSequenceSeedSource');
    const selectedLabel = document.getElementById('exchangeSequenceSelectedPurpleLabel');
    const selectedPurple = document.getElementById('exchangeSequenceSelectedPurple');
    const initialLabel = document.getElementById('exchangeSequenceInitialSeedLabel');
    setExchangeSequenceSlotPanels(role);
    updateExchangeSequenceGenerateButton(role, candidate);
    if (!role) {
        if (seedSource) seedSource.textContent = '—';
        if (selectedPurple) selectedPurple.textContent = '—';
        return;
    }
    const fixed = role.seedStatus === 'fixed_luck_seed';
    if (seedSource) {
        seedSource.innerHTML = `<code>${role.currentSeed}</code> · ${fixed ? '欧气种子已固定' : '洗髓种子未固定'}`;
    }
    if (isOwnedPurpleMode()) {
        const entry = selectedExchangeSequenceOwnedPurple(role);
        if (selectedLabel) selectedLabel.textContent = '自带置换紫';
        if (initialLabel) initialLabel.textContent = '初始化欧气种子';
        if (selectedPurple) {
            selectedPurple.textContent = entry
                ? `${entry.name} · 冲突 ${entry.conflictName}`
                : '当前没有可直接置换的紫脉';
        }
        return;
    }
    if (isShenmaiSwapMode()) {
        const pair = selectedExchangeSequenceShenmaiPair(role);
        if (selectedLabel) selectedLabel.textContent = '所选置换神脉';
        if (initialLabel) initialLabel.textContent = '初始化欧气种子';
        if (selectedPurple) {
            selectedPurple.textContent = pair
                ? `${exchangeSequenceShenmaiLabel(pair.second)} · 冲突 ${pair.first.name}`
                : '未选择神脉';
        }
        return;
    }
    if (selectedLabel) selectedLabel.textContent = role.directPitySequence ? '所选首位保底紫' : '所选置换首紫';
    if (initialLabel) initialLabel.textContent = role.directPitySequence ? '当前种子' : '初始化欧气种子';
    if (selectedPurple) selectedPurple.textContent = candidate ? `#${candidate.washNo} ${candidate.name}` : '无可选首紫';
}

function renderExchangeSequencePurpleOptions(role) {
    const select = document.getElementById('exchangeSequencePurpleSelect');
    if (!select) return;
    select.innerHTML = '';
    if (role?.candidates.length) {
        role.candidates.forEach((candidate, index) => {
            appendExchangeSequenceOption(
                select,
                index,
                `#${candidate.washNo} ${candidate.name}（${candidate.displayReason || candidate.unavailableReason}）`,
                { disabled: !candidate.canInitialize, className: candidate.wasPity ? 'pity-purple-option' : '' },
            );
        });
        const firstAvailable = role.candidates.findIndex(candidate => candidate.canInitialize);
        if (firstAvailable >= 0) select.value = String(firstAvailable);
        select.disabled = firstAvailable < 0;
    } else {
        appendExchangeSequenceOption(select, '', '该角色当前没有可初始化的首紫');
        select.disabled = true;
    }
    syncExchangeSequencePurpleIndexInput(role);
    updateExchangeSequenceSelection();
}

// 同步「第几个脉」数字输入框：显示当前选中候选的 1-based 序号
function syncExchangeSequencePurpleIndexInput(role) {
    const input = document.getElementById('exchangeSequencePurpleIndexInput');
    if (!input) return;
    const select = document.getElementById('exchangeSequencePurpleSelect');
    const count = role?.candidates?.length || 0;
    const selected = Number(select?.value);
    if (count > 0) {
        input.disabled = false;
        input.max = String(count);
        input.value = String(Number.isFinite(selected) && selected >= 0 ? selected + 1 : 1);
    } else {
        input.disabled = true;
        input.max = '1';
        input.value = '1';
    }
}

async function populateExchangeSequencePurples() {
    const token = ++exchangeSequenceCandidateLoadToken;
    const role = selectedExchangeSequenceRole();
    const select = document.getElementById('exchangeSequencePurpleSelect');
    const status = document.getElementById('exchangeSequenceStatus');
    clearExchangeSequenceResults();
    setExchangeSequenceSlotPanels(role);
    applyExchangeSequenceModeControls();

    if (isFirstPityJumpMode()) {
        await populateFirstPityJumpCandidates(token, role, status);
        return;
    }
    if (isOwnedPurpleMode()) {
        populateExchangeSequenceOwnedSelect(role);
        updateExchangeSequenceSelection();
        if (status) {
            status.className = 'exchange-sequence-status';
            status.textContent = (role?.ownedPurples || []).length
                ? ''
                : '当前存档没有可直接置换的紫脉：需要「紫脉在场 + 它前面有一条已锁定的同类低阶冲突脉」。';
        }
        return;
    }
    if (isShenmaiSwapMode()) {
        populateExchangeSequenceShenmaiSelects(role);
        updateExchangeSequenceSelection();
        if (status) {
            status.className = 'exchange-sequence-status';
            status.textContent = (role?.shenmaiTargets || []).length ? '' : '该角色当前没有可达的神脉。';
        }
        return;
    }
    setFirstPityJumpPanelVisible(false);

    if (!role || !select) return;
    if (state.dlcMode) {
        select.innerHTML = '';
        appendExchangeSequenceOption(select, '', '测试服暂不支持');
        select.disabled = true;
        if (status) {
            status.className = 'exchange-sequence-status is-error';
            status.textContent = '测试服含额外保底累计规则，当前暂不支持置换脉序生成。';
        }
        updateExchangeSequenceGenerateButton(role, null);
        return;
    }
    if (role.candidatesReady === false) {
        select.innerHTML = '';
        appendExchangeSequenceOption(select, '', '正在分析置换首紫…');
        select.disabled = true;
        updateExchangeSequenceGenerateButton(role, null);
        if (status) {
            status.className = 'exchange-sequence-status';
            status.textContent = `正在分析「${role.roleName}」的置换首紫…`;
        }
        await new Promise(resolve => requestAnimationFrame(() => setTimeout(resolve, 0)));
        if (token !== exchangeSequenceCandidateLoadToken || role !== selectedExchangeSequenceRole()) return;
        try {
            analyzeExchangeSequenceCandidates(role);
        } catch (error) {
            if (status) {
                status.className = 'exchange-sequence-status is-error';
                status.textContent = error?.message || String(error);
            }
            return;
        }
        if (token !== exchangeSequenceCandidateLoadToken || role !== selectedExchangeSequenceRole()) return;
    }
    renderExchangeSequencePurpleOptions(role);
    if (status) {
        status.className = 'exchange-sequence-status';
        status.textContent = role.candidates.length ? '' : '该角色当前没有可初始化的置换首紫。';
    }
}

function populateExchangeSequenceRoles() {
    const select = document.getElementById('exchangeSequenceRoleSelect');
    const purpleSelect = document.getElementById('exchangeSequencePurpleSelect');
    const status = document.getElementById('exchangeSequenceStatus');
    if (!select || !purpleSelect) return;
    const previousKey = select.value;
    select.innerHTML = '';
    if (!exchangeSequenceDataset.roles.length) {
        appendExchangeSequenceOption(select, '', '请先导入共享存档');
        select.disabled = true;
        purpleSelect.innerHTML = '';
        appendExchangeSequenceOption(purpleSelect, '', '请先导入共享存档');
        purpleSelect.disabled = true;
        setExchangeSequenceSlotPanels(null);
        applyExchangeSequenceModeControls();
        updateExchangeSequenceGenerateButton(null, null);
        clearExchangeSequenceResults('请先导入共享存档');
        if (status) {
            status.className = 'exchange-sequence-status is-error';
            status.textContent = '请先在首页导入存档，再生成置换脉序。';
        }
        updateExchangeSequenceSelection();
        return;
    }
    select.disabled = false;
    const currentRoleKey = document.getElementById('saveRoleSelect')?.value;
    const list = exchangeSequenceDataset.roles;
    list.forEach(role => {
        appendExchangeSequenceOption(select, role.key, `${role.roleKind} · ${role.roleName}`);
    });
    const preferred = list.find(role => role.key === previousKey)
        || list.find(role => role.key === window.exchangeSequenceLastRoleKey)
        || list.find(role => role.key === currentRoleKey)
        || list.find(role => role.roleKind === '主角')
        || list[0];
    select.value = preferred.key;
    void populateExchangeSequencePurples();
}

function openExchangeSequenceFinderModal() {
    const modal = document.getElementById('exchangeSequenceModal');
    if (!modal) return;
    modal.hidden = false;
    updateModalOpenState();
    exchangeSequenceDataset = buildExchangeSequenceDataset();
    exchangeSequenceCandidateLoadToken += 1;
    exchangeSequenceRunning = false;
    clearExchangeSequenceResults();
    populateExchangeSequenceRoles();
}

function closeExchangeSequenceFinderModal() {
    const modal = document.getElementById('exchangeSequenceModal');
    if (modal) modal.hidden = true;
    exchangeSequenceCandidateLoadToken += 1;
    updateModalOpenState();
    pushStateToWasm();
}

/* 多个弹窗叠加时，统一维护 body 滚动锁：任一弹窗可见即锁，全关才释放，
 * 避免关闭上层筛选弹窗时误删主弹窗的滚动锁。 */
function updateModalOpenState() {
    const a = document.getElementById('exchangeSequenceModal');
    const b = document.getElementById('exchangeFilterModal');
    const anyOpen = (a && !a.hidden) || (b && !b.hidden);
    document.body?.classList.toggle('modal-open', !!anyOpen);
}

function openExchangeFilterModal() {
    const modal = document.getElementById('exchangeFilterModal');
    if (!modal) return;
    modal.hidden = false;
    updateModalOpenState();
    syncExchangeFilterRunButton();
}

function closeExchangeFilterModal() {
    const modal = document.getElementById('exchangeFilterModal');
    if (modal) modal.hidden = true;
    updateModalOpenState();
}

function initializeExchangeSequenceSeed(role, candidate, n) {
    if (!candidate?.canInitialize) throw new Error(candidate?.unavailableReason || '所选紫脉不可进行置换');
    const directPity = !!candidate.isDirectPity;
    const theoryMode = isExchangeSequenceTheoryMode() && !directPity;
    const base = cloneExchangeSequenceValue(role.wasmState);
    base.global_vars = exchangeSequenceDataset.globalVars;
    base.talents = (base.talents || []).map(item => ({ ...item, locked: false }));
    // 理论定位先模拟二槽洗出首紫；首紫锁定后再切到三槽，取普通脉坐标。
    if (theoryMode) base.zizhi = 152;
    base.bag_pills = 999999999;
    base.has_bag_pills = true;
    let fixedLuckSeed = null;
    if (base.luck_seed_inited) {
        const luckSeed = Number(base.luck_seed);
        if (!Number.isFinite(luckSeed)) throw new Error('无法读取当前欧气种子');
        fixedLuckSeed = luckSeed;
    }
    if (!wasmSetState(base)) throw new Error('真实种子初始化状态写入失败');

    const hasTalent = name => {
        const target = exchangeSequenceTalentByName(name);
        const current = wasmGetState();
        return !!(target && current && current.talents.some(item => Number(item.id) === Number(target.id)));
    };
    const targetTalent = exchangeSequenceTalentByName(candidate.name);
    const targetId = Number(candidate.talentId || targetTalent?.id);
    const isTargetTalent = slot => Number(slot?.id) === targetId;
    if (!Number.isFinite(targetId)) throw new Error(`未找到所选首紫「${candidate.name}」的数据`);

    const lockTalent = name => {
        const target = exchangeSequenceTalentByName(name);
        const current = wasmGetState();
        const slot = target && current?.talents.find(item => Number(item.id) === Number(target.id));
        if (!slot) throw new Error(`洗脉结果中未找到「${name}」`);
        slot.locked = true;
        current.bag_pills = 999999999;
        current.has_bag_pills = true;
        if (!wasmSetState(current)) throw new Error(`锁定「${name}」失败`);
    };

    const findTargetPurpleSnapshot = maxWashes => {
        let remaining = maxWashes;
        while (remaining > 0) {
            const beforeBatch = cloneExchangeSequenceValue(wasmGetState());
            const batchSize = Math.min(128, remaining);
            const batch = wasmWashMulti(batchSize) || [];
            const targetIndex = batch.findIndex(row => (row.talents || []).some(isTargetTalent));
            if (targetIndex >= 0) {
                if (!wasmSetState(beforeBatch)) throw new Error('紫脉定位前状态恢复失败');
                if (targetIndex > 0 && (wasmWashMulti(targetIndex) || []).length !== targetIndex) {
                    throw new Error('紫脉定位前刷新未完整重放');
                }
                const beforeTarget = cloneExchangeSequenceValue(wasmGetState());
                const targetWash = wasmDoWash();
                const targetState = wasmGetState();
                if (!targetWash || !targetState?.talents.some(isTargetTalent)) {
                    throw new Error(`未洗到所选首紫「${candidate.name}」`);
                }
                return { beforeTarget, targetState, targetWash };
            }
            if (batch.length !== batchSize) break;
            remaining -= batchSize;
        }
        throw new Error(`未洗到所选首紫「${candidate.name}」`);
    };

    if (directPity) {
        const { targetState, targetWash } = findTargetPurpleSnapshot(20000);
        if (!targetWash.was_pity) throw new Error('首位保底紫定位结果不是保底脉');
        const luckSeed = Number(targetState?.luck_seed);
        if (!targetState?.luck_seed_inited || !Number.isFinite(luckSeed)) {
            throw new Error('无法读取首位保底紫触发后留存的欧气种子');
        }
        return { base, luckSeed, fixed: false, directPity: true };
    }


    /**
     * 四槽：锁住首紫之后再锁一条普通脉，凑满 3 把锁、只留 1 个槽。
     * 玩家实际操作就是「洗到出紫 → 锁紫 → 再锁紫脉下方最近的那条原始脉」；
     * 这样每次洗髓只生成 1 条新脉（内核：need = 槽位数 − 有效保留脉数 = 4 − 3 = 1），
     * 与三槽「点一次洗髓推进 1 条原始脉」完全一致。
     * 紫脉下方没有可用普通脉时（紫脉在最后一格），回退到当前这页离紫脉最近的普通脉。
     */
    const lockFourSlotPurpleNeighbor = () => {
        const state = wasmGetState();
        const talents = state?.talents || [];
        const targetIdx = talents.findIndex(isTargetTalent);
        if (targetIdx < 0) throw new Error(`未找到所选首紫「${candidate.name}」所在的槽位`);
        const candidates = [];
        for (let i = targetIdx + 1; i < talents.length; i += 1) candidates.push(i); // 紫脉下方优先
        for (let i = targetIdx - 1; i >= 0; i -= 1) candidates.push(i);             // 兜底：紫脉上方
        const pickIdx = candidates.find(index => {
            const slot = talents[index];
            return !slot.locked
                && Number(slot.id) > 0
                && Number(slot.id) !== targetId
                && talentQuality(slot.id) < 4;
        });
        if (pickIdx === undefined) throw new Error('四脉未能找到可锁定的普通脉，请重试');
        const next = cloneExchangeSequenceValue(state);
        next.talents[pickIdx].locked = true;
        next.bag_pills = 999999999;
        next.has_bag_pills = true;
        if (!wasmSetState(next)) throw new Error('四脉普通脉锁定状态写入失败');
        const lockedId = Number(talents[pickIdx].id);
        const lockedName = TALENT_DATA[String(lockedId)]?.name || `#${lockedId}`;
        return { extraLockName: lockedName, padLockedCount: 3 };
    };

    // 洗到首紫出现并锁定（首紫若已与冲突脉同屏则直接锁，不额外洗）——与三槽完全同一套动作
    const lockTargetPurpleIfNeeded = () => {
        if (!hasTalent(candidate.name)) wasmWashUntilTalentName(candidate.name, 20000);
        if (!hasTalent(candidate.name)) throw new Error(`未洗到所选首紫「${candidate.name}」`);
        lockTalent(candidate.name);
    };

    const conflictLimit = Math.max(200, Number(candidate.conflictWashTimes || 0) + 100);
    if (!hasTalent(candidate.conflictName)) wasmWashUntilTalentName(candidate.conflictName, conflictLimit);
    if (!hasTalent(candidate.conflictName)) throw new Error(`未洗到首紫冲突脉「${candidate.conflictName}」`);
    lockTalent(candidate.conflictName);
    const fourSlot = !theoryMode && isExchangeSequenceFourSlotRole(role);
    let extraLockName = null;
    let padLockedCount = null;
    let targetPosition = null;
    if (fourSlot) {
        // 四槽：锁紫之后再锁一条普通脉 → 共 3 把锁，只留 1 个槽，每次洗髓推进 1 条原始脉
        lockTargetPurpleIfNeeded();
        ({ extraLockName, padLockedCount } = lockFourSlotPurpleNeighbor());
    } else {
        // 三槽（含神脉互冲）：锁冲突脉 + 锁紫 共 2 把锁，剩 1 个槽每次推进 1 条原始脉
        lockTargetPurpleIfNeeded();
    }
    if (theoryMode) {
        // 二槽阶段已经得到首紫；升到三槽后，锁定的冲突脉和首紫之间保留一个普通脉槽。
        const upgraded = cloneExchangeSequenceValue(wasmGetState());
        upgraded.zizhi = 153;
        if (!wasmSetState(upgraded)) throw new Error('理论定位切换三槽失败');
        base.zizhi = 153;
    }
    const padState = wasmGetState();
    const expectedLocks = fourSlot ? 3 : 2;
    const actualLocks = padState?.talents.filter(item => item.locked).length || 0;
    if (actualLocks !== expectedLocks) throw new Error(`首紫定位前锁定数错误：需要 ${expectedLocks}，实际 ${actualLocks}`);
    // 缓存「锁好首紫、未洗 n 次」的状态，供 n 循环复用，避免每个 n 都重新洗冲突脉/洗首紫
    exchangeSequenceLockedBase = cloneExchangeSequenceValue(padState);
    if (n > 0 && (wasmWashMulti(n) || []).length !== n) throw new Error(`首紫锁定后未完成 ${n} 次刷新`);
    const initializedState = wasmGetState();
    const luckSeed = fixedLuckSeed != null ? fixedLuckSeed : Number(initializedState?.seed);
    if (!Number.isFinite(luckSeed)) throw new Error('无法读取该首紫与 n 对应的欧气种子');
    return {
        base,
        luckSeed,
        fixed: fixedLuckSeed != null,
        extraLockName,
        padLockedCount: padLockedCount || actualLocks,
        targetPosition,
    };
}

function previewExchangeSequence(base, luckSeed, count) {
    const previewState = cloneExchangeSequenceValue(base);
    previewState.seed = luckSeed;
    previewState.luck_seed = luckSeed;
    previewState.luck_seed_inited = true;
    previewState.talents = (previewState.talents || []).map(item => ({ ...item, locked: false }));
    previewState.total_wash = 0;
    previewState.total_talent_bars = 0;
    previewState.total_pills = 0;
    previewState.pity_count = 0;
    previewState.last_purple_total_pills = null;
    previewState.exchange_count = 0;
    previewState.bag_pills = 999999999;
    previewState.has_bag_pills = true;
    previewState.global_vars = exchangeSequenceDataset.globalVars;
    if (!wasmSetState(previewState)) throw new Error('置换序列状态写入失败');
    // 保底约 855 丹出一个紫，按 count*1000 条脉估算扫描量，留足余量；不够时倍增重试
    let scanLimit = Math.max(20000, count * 1000);
    let pityRows = [];
    for (let attempt = 0; attempt < 6; attempt += 1) {
        const preview = wasmPreviewSequence(scanLimit) || {};
        pityRows = (Array.isArray(preview.purples) ? preview.purples : []).filter(item => item.was_pity);
        if (pityRows.length >= count) break;
        scanLimit = Math.ceil(scanLimit * 1.75);
    }
    if (pityRows.length < count) throw new Error(`只生成 ${pityRows.length}/${count} 条保底紫脉，请减少生成项数`);
    return pityRows.slice(0, count).map((item, index) => ({
        index: index + 1,
        name: item.talent_name,
        talentId: Number(item.talent_id),
        sourceWashNo: Number(item.wash_no),
    }));
}

// 计算无限置换序列的 b0：记录「首紫正下方第 n 条原始脉」的颜色与 ID。
// n=0 时记录为空（紫脉下方无原始脉）；n>0 时记录第 n 条原始脉。
// 需在 initializeExchangeSequenceSeed 之后调用（此时 WASM 状态为「锁冲突 + 锁首紫 + 洗 n 次」）。
function exchangeSequenceFirstPurple(candidate, n) {
    const targetId = Number(candidate?.talentId);
    const state = wasmGetState();
    const targetIdx = (state?.talents || []).findIndex(item => Number(item.id) === targetId);
    if (targetIdx < 0) throw new Error('无法定位首紫槽位');
    if (n === 0) {
        return {
            index: 0,
            name: '空',
            talentId: 0,
            quality: 0,
            isEmpty: true,
            isFirstPurple: true,
        };
    }
    // 取离首紫最近的非锁定脉（即紫脉下方的原始脉）
    // 槽位顺序：3 槽下首紫位置后剩余槽；4 槽下首紫前后的非锁定槽
    const talents = state.talents || [];
    const neighbors = [];
    for (let i = 0; i < talents.length; i++) {
        if (i === targetIdx) continue;
        if (talents[i].locked) continue;
        neighbors.push({ idx: i, talent: talents[i] });
    }
    // n>neighbors.length 时也取最后一个（紫脉下方的最后一条）
    const pickIdx = Math.max(0, Math.min(neighbors.length - 1, n - 1));
    const picked = neighbors[pickIdx];
    if (!picked) return { index: 0, name: '空', talentId: 0, quality: 0, isEmpty: true, isFirstPurple: true };
    const talentInfo = TALENT_DATA[String(picked.talent.id)];
    const quality = Number(talentInfo?.weight || 1);
    const name = talentInfo?.name || `#${picked.talent.id}`;
    return {
        index: 0,
        name,
        talentId: picked.talent.id,
        quality,
        position: pickIdx + 1,
        isFirstPurple: true,
    };
}

function buildExchangeSequence(role, candidate, n, count) {
    const initialized = initializeExchangeSequenceSeed(role, candidate, n);
    if (initialized.directPity) {
        // 首位保底紫：不补 b0，直接输出保底紫序列
        const pity = previewExchangeSequence(initialized.base, initialized.luckSeed, count);
        return {
            outputs: pity,
            luckSeed: initialized.luckSeed,
            fixed: true,
            directPity: true,
            extraLockName: initialized.extraLockName || null,
            padLockedCount: initialized.padLockedCount || null,
        };
    }
    const first = exchangeSequenceFirstPurple(candidate, n);
    const pity = previewExchangeSequence(initialized.base, initialized.luckSeed, count);
    return {
        outputs: [first, ...pity],
        luckSeed: initialized.luckSeed,
        fixed: initialized.fixed,
        directPity: false,
        extraLockName: initialized.extraLockName || null,
        padLockedCount: initialized.padLockedCount || null,
    };
}

let exchangeSequenceLockedBase = null;

// 枚举 n=0..maxPad，为每个 n 生成一条置换序列（b0 + 后续保底紫）。
// 复用「锁好首紫」的快照，避免每个 n 都重新洗冲突脉/洗首紫。
function buildAllExchangePadsSequence(role, candidate, maxPad, count) {
    const out = [];
    for (let n = 0; n <= maxPad; n++) {
        if (n === 0) {
            out.push({ pad: 0, ...buildExchangeSequence(role, candidate, 0, count) });
        } else {
            out.push({ pad: n, ...buildExchangeSequenceFromLockedBase(role, candidate, n, count) });
        }
    }
    return out;
}

// 从缓存的「锁好首紫」快照出发，只额外洗 n 次，避免重复洗冲突脉/洗首紫。
function buildExchangeSequenceFromLockedBase(role, candidate, n, count) {
    if (!exchangeSequenceLockedBase) throw new Error('置换序列基准状态缺失，请重试');
    const lockedState = cloneExchangeSequenceValue(exchangeSequenceLockedBase);
    if (!wasmSetState(lockedState)) throw new Error('置换序列基准状态恢复失败');
    if (n > 0 && (wasmWashMulti(n) || []).length !== n) throw new Error(`首紫锁定后未完成 ${n} 次刷新`);
    const initializedState = wasmGetState();
    const luckSeed = Number(initializedState?.seed);
    if (!Number.isFinite(luckSeed)) throw new Error('无法读取该首紫与 n 对应的欧气种子');
    const first = exchangeSequenceFirstPurple(candidate, n);
    const pity = previewExchangeSequence(lockedState, luckSeed, Math.max(0, count - 1));
    return {
        outputs: [first, ...pity],
        luckSeed,
        fixed: false,
        directPity: false,
        extraLockName: null,
        padLockedCount: null,
    };
}

function renderExchangeSequence(role, candidate, maxPad, results) {
    const initialSeed = document.getElementById('exchangeSequenceInitialSeed');
    const grid = document.getElementById('exchangeSequenceGrid');
    const empty = document.getElementById('exchangeSequenceEmpty');
    const meta = document.getElementById('exchangeSequenceResultMeta');
    const tableWrap = document.getElementById('exchangeSequenceTableWrap');
    const summary = document.getElementById('exchangeSequenceJumpSummary');
    if (summary) summary.hidden = true;
    const isArray = Array.isArray(results);
    const single = isArray ? null : results;
    if (initialSeed) {
        const r0 = isArray ? (results.find(x => x?.pad === 0) || results[0]) : results;
        if (r0) {
            initialSeed.innerHTML = r0.directPity
                ? `<code>${r0.luckSeed}</code>（当前种子已固定）`
                : `<code>${r0.luckSeed}</code>${r0.fixed ? '（已固定，n 不改变种子）' : ''}`;
        }
    }
    // 平铺编号网格：把所有序列的紫脉按顺序连续编号铺成一个网格（不再按 n 分组）
    const flatOutputs = [];
    if (isArray) {
        results.forEach(row => (row.outputs || []).forEach(item => flatOutputs.push(item)));
    } else if (single) {
        (single.outputs || []).forEach(item => flatOutputs.push(item));
    }
    if (tableWrap) tableWrap.hidden = true;
    if (grid) {
        // b0 原始脉不进网格占号：只在结果头 meta 灰字里展示名字；网格只排保底紫 1..N
        grid.innerHTML = flatOutputs.filter(item => !item.isFirstPurple).map(item => {
            const content = item.isEmpty ? '空' : talentChipHtml(item.talentId, item.name);
            return `<li data-index="${item.index}" title="保底紫脉">${content}</li>`;
        }).join('');
        grid.hidden = false;
    }
    if (empty) empty.hidden = true;
    // b0 参照原始脉：标题右侧灰字（directPity 无 b0、multi-n 不展示）
    const basePulse = document.getElementById('exchangeSequenceBasePulse');
    if (basePulse) {
        const firstOut = single && !single.directPity
            ? (single.outputs || []).find(item => item.isFirstPurple)
            : null;
        if (firstOut) {
            basePulse.textContent = `原始脉：${firstOut.isEmpty ? '空（n=0）' : firstOut.name}`;
            basePulse.hidden = false;
        } else {
            basePulse.textContent = '';
            basePulse.hidden = true;
        }
    }
    if (meta) {
        if (single?.directPity) {
            meta.textContent = `${role.roleName} · 首位保底紫 ${candidate.name} · 当前种子已固定 · 前 ${single.outputs.length} 条`;
        } else if (single) {
            meta.textContent = `${role.roleName} · 置换首紫 ${candidate.name} · 置换次数 ${maxPad}`;
        } else {
            meta.textContent = `${role.roleName} · 置换首紫 ${candidate.name} · n=0..${maxPad} 各一条置换序列（每条 ${results[0]?.outputs?.length || 0} 紫）`;
        }
    }
}

/** 神脉置换模式：用两个下拉选出的神脉对，走与普通置换完全相同的推演与渲染 */
function generateShenmaiSwapSequence() {
    if (exchangeSequenceRunning || state.dlcMode) return;
    const role = selectedExchangeSequenceRole();
    const pair = selectedExchangeSequenceShenmaiPair(role);
    const status = document.getElementById('exchangeSequenceStatus');
    const countInput = document.getElementById('exchangeSequenceCountInput');
    const pairError = exchangeSequenceShenmaiPairError(pair);
    if (!role || pairError) {
        if (status) {
            status.className = 'exchange-sequence-status is-error';
            status.textContent = pairError || '请先导入共享存档并选择角色。';
        }
        return;
    }
    const pad = readExchangeSequencePadValue(role);
    const count = Math.max(1, Math.min(EXCHANGE_SEQUENCE_COUNT_MAX, Math.trunc(Number(countInput?.value) || 10)));
    if (countInput) countInput.value = String(count);
    const candidate = buildShenmaiSwapCandidate(pair);
    exchangeSequenceRunning = true;
    updateExchangeSequenceGenerateButton(role, null);
    clearExchangeSequenceResults('正在生成神脉互冲置换脉序…');
    if (status) {
        status.className = 'exchange-sequence-status';
        status.textContent = `正在推演「${pair.first.name} + ${pair.second.name}」互冲置换…`;
    }
    requestAnimationFrame(() => {
        let result;
        try {
            result = runExchangeSequenceWasmSandbox(() => buildExchangeSequence(role, candidate, pad, count));
        } catch (error) {
            if (status) {
                status.className = 'exchange-sequence-status is-error';
                status.textContent = error?.message || String(error);
            }
            clearExchangeSequenceResults('神脉互冲置换脉序生成失败');
            exchangeSequenceRunning = false;
            updateExchangeSequenceGenerateButton();
            return;
        }
        renderExchangeSequence(role, candidate, pad, result);
        if (status) status.textContent = '';
        exchangeSequenceRunning = false;
        updateExchangeSequenceGenerateButton();
    });
}

/** 按当前查询模式取「生成 / 下载全部序列 / 在线筛选」共用的置换候选 */
function activeExchangeSequenceCandidate(role = selectedExchangeSequenceRole()) {
    if (isOwnedPurpleMode()) {
        const entry = selectedExchangeSequenceOwnedPurple(role);
        return entry ? buildOwnedPurpleCandidate(entry) : null;
    }
    if (isShenmaiSwapMode()) {
        const pair = selectedExchangeSequenceShenmaiPair(role);
        return (pair && !exchangeSequenceShenmaiPairError(pair)) ? buildShenmaiSwapCandidate(pair) : null;
    }
    return selectedExchangeSequenceCandidate(role);
}

function generateExchangeSequence() {
    if (exchangeSequenceRunning || state.dlcMode) return;
    if (isOwnedPurpleMode()) {
        generateOwnedPurpleSequence();
        return;
    }
    if (isShenmaiSwapMode()) {
        generateShenmaiSwapSequence();
        return;
    }
    const role = selectedExchangeSequenceRole();
    const candidate = selectedExchangeSequenceCandidate(role);
    const status = document.getElementById('exchangeSequenceStatus');
    const countInput = document.getElementById('exchangeSequenceCountInput');
    if (!role || !candidate?.canInitialize) {
        if (status) {
            status.className = 'exchange-sequence-status is-error';
            status.textContent = candidate?.unavailableReason || '请先选择可初始化的置换首紫。';
        }
        return;
    }
    const pad = candidate.isDirectPity ? 0 : readExchangeSequencePadValue(role);
    const rawCount = Math.trunc(Number(countInput?.value) || 10);
    if (rawCount > 30) {
        if (countInput) countInput.value = '30';
        if (status) {
            status.className = 'exchange-sequence-status is-error';
            status.textContent = '看多少次最大支持 30 次，已自动调整。';
        }
        return;
    }
    const count = Math.max(1, Math.min(EXCHANGE_SEQUENCE_COUNT_MAX, rawCount || 10));
    if (countInput) countInput.value = String(count);
    exchangeSequenceRunning = true;
    updateExchangeSequenceGenerateButton(role, candidate);
    clearExchangeSequenceResults('正在生成置换脉序…');
    if (status) {
        status.className = 'exchange-sequence-status';
        status.textContent = candidate.isDirectPity
            ? '正在生成固定种子序列…'
            : `正在生成第 ${pad} 次置换的序列…`;
    }
    requestAnimationFrame(() => {
        let result;
        try {
            result = runExchangeSequenceWasmSandbox(() => buildExchangeSequence(role, candidate, pad, count));
        } catch (error) {
            if (status) {
                status.className = 'exchange-sequence-status is-error';
                status.textContent = error?.message || String(error);
            }
            clearExchangeSequenceResults('置换脉序生成失败');
            exchangeSequenceRunning = false;
            updateExchangeSequenceGenerateButton();
            return;
        }
        renderExchangeSequence(role, candidate, pad, result);
        if (status) status.textContent = '';
        exchangeSequenceRunning = false;
        updateExchangeSequenceGenerateButton();
    });
}

// 下载 n=0..maxPad 全部置换序列为 txt 文件（异步分批 + 进度条）
function downloadExchangeSequenceAll() {
    if (exchangeSequenceRunning || state.dlcMode) return;
    const role = selectedExchangeSequenceRole();
    const candidate = activeExchangeSequenceCandidate(role);
    const status = document.getElementById('exchangeSequenceStatus');
    const countInput = document.getElementById('exchangeSequenceCountInput');
    const progress = document.getElementById('exchangeSequenceProgress');
    const progressText = document.getElementById('exchangeSequenceProgressText');
    const progressPercent = document.getElementById('exchangeSequenceProgressPercent');
    const progressFill = document.getElementById('exchangeSequenceProgressFill');
    if (!role || !candidate?.canInitialize) {
        if (status) {
            status.className = 'exchange-sequence-status is-error';
            status.textContent = candidate?.unavailableReason || '请先选择可初始化的置换首紫。';
        }
        return;
    }
    const maxPad = candidate.isDirectPity ? 0 : readExchangeSequencePadValue(role);
    const count = Math.max(1, Math.min(EXCHANGE_SEQUENCE_COUNT_MAX, Math.trunc(Number(countInput?.value) || 10)));
    const total = maxPad + 1;
    exchangeSequenceRunning = true;
    updateExchangeSequenceGenerateButton();
    // 显示进度条
    if (progress) progress.hidden = false;
    const setProgress = (done) => {
        const pct = Math.min(100, Math.round((done / total) * 100));
        if (progressText) progressText.textContent = `正在生成 n=0..${maxPad}（${done}/${total}）`;
        if (progressPercent) progressPercent.textContent = `${pct}%`;
        if (progressFill) progressFill.style.width = `${pct}%`;
    };
    setProgress(0);
    if (status) {
        status.className = 'exchange-sequence-status';
        status.textContent = '正在生成置换序列并打包下载，请稍候…';
    }

    buildAllExchangeSequenceText(role, candidate, maxPad, count, {
        onProgress: setProgress,
        onDone: (text, results) => {
            triggerFileDownload(`${role.roleName}_置换序列_n0-${maxPad}.txt`, text);
            if (progress) progress.hidden = true;
            if (status) {
                status.className = 'exchange-sequence-status';
                status.textContent = `已下载 ${results.length} 条序列到本地。`;
            }
            exchangeSequenceRunning = false;
            updateExchangeSequenceGenerateButton();
        },
        onError: (error) => {
            if (progress) progress.hidden = true;
            if (status) {
                status.className = 'exchange-sequence-status is-error';
                status.textContent = error?.message || String(error);
            }
            exchangeSequenceRunning = false;
            updateExchangeSequenceGenerateButton();
        },
    });
}

/**
 * 分批生成 n=0..maxPad 的全部置换序列，完成后把 txt 文本交给 onDone（不落盘）。
 * 「下载全部序列」与「在线筛选」共用这一份生成逻辑，避免两边跑偏。
 */
function buildAllExchangeSequenceText(role, candidate, maxPad, count, hooks = {}) {
    const total = maxPad + 1;
    const results = [];
    // 分批：每批处理若干个 n，批间 setTimeout 让出主线程，避免 UI 卡死
    const BATCH_SIZE = 20;
    let current = 0;
    const runBatch = () => {
        const start = current;
        const end = Math.min(total, start + BATCH_SIZE);
        try {
            // 每批在独立 sandbox 内完成；n=0 完整初始化并缓存「锁好首紫」快照，n>0 复用快照减少重复洗脉
            runExchangeSequenceWasmSandbox(() => {
                for (let n = start; n < end; n++) {
                    const built = n === 0
                        ? buildExchangeSequence(role, candidate, 0, count)
                        : buildExchangeSequenceFromLockedBase(role, candidate, n, count);
                    results.push({ pad: n, ...built });
                }
            });
        } catch (error) {
            if (hooks.onError) hooks.onError(error);
            return;
        }
        current = end;
        if (hooks.onProgress) hooks.onProgress(current, total);
        if (current >= total) {
            if (hooks.onDone) hooks.onDone(formatExchangeSequenceTxt(role, candidate, results, maxPad, count), results);
            return;
        }
        setTimeout(runBatch, 20);
    };
    requestAnimationFrame(runBatch);
}

// 将置换序列格式化为 txt：每条序列一行，紫脉之间一个空格，序列之间空 2 行
function formatExchangeSequenceTxt(role, candidate, results, maxPad, count) {
    const lines = [];
    lines.push(`# ${role.roleName} · 置换首紫：${candidate.name}`);
    lines.push(`# 置换次数：0..${maxPad}（共 ${results.length} 条）· 每条 ${count} 个保底紫`);
    lines.push(`# 格式：（原始脉） n=次数 保底紫1 保底紫2 ...（紫脉之间一个空格分隔，序列之间空两行）`);
    lines.push('');
    results.forEach((row, idx) => {
        const items = row.outputs || [];
        const first = items[0];
        const firstText = first ? `（${first.name}）` : '（空）';
        const rest = items.slice(1).map(item => item.name);
        lines.push(`${firstText} n=${row.pad} ${rest.join(' ')}`);
        lines.push('');
        lines.push('');
    });
    return lines.join('\n');
}

function triggerFileDownload(filename, text) {
    const blob = new Blob([text], { type: 'text/plain;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    setTimeout(() => URL.revokeObjectURL(url), 2000);
}

/* ── 在线筛选 ──────────────────────────────────────────────────────
 * 生成 n=0..maxPad 的全部序列后不落盘，直接在内存里跑「排除 / 全部包含 / n选m连续」漏斗，
 * 结果显示在对话框下方的筛选面板里，免去「下载 txt 再拖进去」两步。
 * 解析与判定复用 shared/exchange_sequence_filter.js，与独立页面同一套口径。
 * ---------------------------------------------------------------- */

/** 已生成的序列文本缓存：同一套参数不必反复跑 wasm */
let exchangeFilterCache = { key: '', text: '' };

function exchangeFilterApi() {
    return (typeof ExchangeSequenceFilter !== 'undefined' && ExchangeSequenceFilter) || null;
}

/** 渲染两张固定筛选卡片（全部包含=紫卡 / 排除=红卡）的紫脉点选网格 */
let exchangeFilterMode = 'include'; // 'include' | 'exclude'

function setExchangeFilterMode(mode) {
    exchangeFilterMode = mode;
    const inc = document.getElementById('exchangeFilterModeInclude');
    const exc = document.getElementById('exchangeFilterModeExclude');
    if (inc) inc.classList.toggle('is-active', mode === 'include');
    if (exc) exc.classList.toggle('is-active', mode === 'exclude');
}

function applyExchangeFilterChip(chip) {
    const modeClass = exchangeFilterMode === 'include' ? 'is-include' : 'is-exclude';
    if (chip.classList.contains(modeClass)) {
        chip.classList.remove(modeClass);
    } else {
        chip.classList.remove('is-include', 'is-exclude');
        chip.classList.add(modeClass);
    }
    syncExchangeFilterCount();
}

function syncExchangeFilterCount() {
    const chips = document.getElementById('exchangeFilterChips');
    const count = document.getElementById('exchangeFilterCount');
    if (!chips || !count) return;
    const includes = chips.querySelectorAll('.exchange-filter-chip.is-include').length;
    const excludes = chips.querySelectorAll('.exchange-filter-chip.is-exclude').length;
    const total = includes + excludes;
    count.textContent = `已选 ${total} 条（${includes} 包含 / ${excludes} 排除）`;
    count.classList.toggle('is-empty', total === 0);
}

function renderExchangeFilterCards() {
    const api = exchangeFilterApi();
    const names = api ? api.sortPurplesForDisplay(api.purpleNames()) : [];
    const popular = api ? api.POPULAR_PURPLE_NAMES : [];
    const chips = document.getElementById('exchangeFilterChips');
    if (!chips) return;
    chips.innerHTML = '';
    names.forEach(name => {
        const chip = document.createElement('button');
        chip.type = 'button';
        chip.className = 'exchange-filter-chip';
        chip.textContent = name;
        chip.dataset.name = name;
        if (popular.indexOf(name) !== -1) chip.classList.add('is-popular');
        chip.addEventListener('click', () => applyExchangeFilterChip(chip));
        chips.appendChild(chip);
    });
    setExchangeFilterMode('include');
    syncExchangeFilterCount();
}

/** 读取单网格 → 引擎步骤：全部包含在前，排除在后；空组跳过 */
function readExchangeFilterSteps() {
    const collect = (cls) => {
        const box = document.getElementById('exchangeFilterChips');
        if (!box) return [];
        const names = [];
        box.querySelectorAll(`button.exchange-filter-chip.${cls}`).forEach(chip => {
            const name = chip.dataset.name;
            if (name && names.indexOf(name) === -1) names.push(name);
        });
        return names;
    };
    const steps = [];
    const include = collect('is-include');
    if (include.length) steps.push({ type: 'one', purples: include });
    const exclude = collect('is-exclude');
    if (exclude.length) steps.push({ type: 'exclude', purples: exclude });
    return steps;
}

function syncExchangeFilterRunButton() {
    const role = selectedExchangeSequenceRole();
    const candidate = activeExchangeSequenceCandidate(role);
    const ready = !exchangeSequenceRunning && !state.dlcMode && !!role && !!candidate?.canInitialize;
    const button = document.getElementById('btnRunExchangeFilter');
    if (button) button.disabled = !ready;
}

function clearExchangeFilterResult() {
    const box = document.getElementById('exchangeFilterResult');
    if (box) box.hidden = true;
    ['exchangeFilterHits', 'exchangeFilterSummary'].forEach(id => {
        const el = document.getElementById(id);
        if (el) el.innerHTML = '';
    });
    const meta = document.getElementById('exchangeSequenceFilterMeta');
    if (meta) meta.textContent = '尚未筛选';
}

function renderExchangeFilterResult(result, steps) {
    const api = exchangeFilterApi();
    const box = document.getElementById('exchangeFilterResult');
    const hitsBox = document.getElementById('exchangeFilterHits');
    const summaryBox = document.getElementById('exchangeFilterSummary');
    const meta = document.getElementById('exchangeSequenceFilterMeta');
    if (!box || !hitsBox || !summaryBox) return;

    box.hidden = false;

    const hitCount = result.hits.length;
    const totalCount = (result.funnel.find(row => row.base) || {}).count || hitCount;
    const effective = api ? steps.filter(step => api.stepEffective(step)).length : 0;
    if (meta) meta.textContent = `命中 ${hitCount} 条 · 有效步骤 ${effective} 个`;
    /* 漏斗不再单独展示：总数与命中并成一行摘要 */
    summaryBox.innerHTML = `全部序列 ${totalCount} → 最终命中 <strong>${hitCount}</strong> 条`;
    if (!hitCount) {
        hitsBox.innerHTML = '<li class="exchange-filter-empty">无匹配结果</li>';
        return;
    }
    hitsBox.innerHTML = result.hits.map(item =>
        `<li><span class="exchange-filter-badge">n=${escapeAiHtml(String(item.n))}</span>${escapeAiHtml(item.names.join(' · '))}</li>`
    ).join('');
}

function exchangeFilterFeedbackEls() {
    const popup = document.getElementById('exchangeFilterModal');
    if (popup && !popup.hidden) {
        return {
            status: document.getElementById('exchangeFilterStatus'),
            progress: document.getElementById('exchangeFilterProgress'),
            progressText: document.getElementById('exchangeFilterProgressText'),
            progressPercent: document.getElementById('exchangeFilterProgressPercent'),
            progressFill: document.getElementById('exchangeFilterProgressFill'),
        };
    }
    return {
        status: document.getElementById('exchangeSequenceStatus'),
        progress: document.getElementById('exchangeSequenceProgress'),
        progressText: document.getElementById('exchangeSequenceProgressText'),
        progressPercent: document.getElementById('exchangeSequenceProgressPercent'),
        progressFill: document.getElementById('exchangeSequenceProgressFill'),
    };
}

function runExchangeSequenceFilter() {
    const api = exchangeFilterApi();
    const { status, progress, progressText, progressPercent, progressFill } = exchangeFilterFeedbackEls();
    if (!api) {
        if (status) {
            status.className = 'exchange-sequence-status is-error';
            status.textContent = '筛选模块未加载，请刷新页面重试。';
        }
        return;
    }
    if (exchangeSequenceRunning || state.dlcMode) return;
    const role = selectedExchangeSequenceRole();
    const candidate = activeExchangeSequenceCandidate(role);
    if (!role || !candidate?.canInitialize) {
        if (status) {
            status.className = 'exchange-sequence-status is-error';
            status.textContent = candidate?.unavailableReason || '请先选择可初始化的置换首紫。';
        }
        return;
    }

    const maxPad = candidate.isDirectPity ? 0 : readExchangeSequencePadValue(role);
    const count = Math.max(1, Math.min(EXCHANGE_SEQUENCE_COUNT_MAX, Math.trunc(Number(document.getElementById('exchangeSequenceCountInput')?.value) || 10)));
    const steps = readExchangeFilterSteps();
    const cacheKey = [exchangeSequenceQueryMode(), exchangeSequenceTheoryMode(), role.roleName, candidate.name, maxPad, count].join('|');

    const applyText = (text) => {
        const parsed = api.parseText(text);
        renderExchangeFilterResult(api.runFunnel(parsed.records, steps, parsed.dupCount), steps);
        if (status) {
            status.className = 'exchange-sequence-status';
            status.textContent = `已筛选 ${parsed.records.length} 条序列（n=0..${maxPad}）。`;
        }
        document.getElementById('exchangeSequenceFilterPanel')?.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
    };

    // 同一套参数直接复用上次生成的结果，避免反复跑 wasm
    if (exchangeFilterCache.key === cacheKey && exchangeFilterCache.text) {
        applyText(exchangeFilterCache.text);
        return;
    }

    exchangeSequenceRunning = true;
    updateExchangeSequenceGenerateButton();
    if (progress) progress.hidden = false;
    const total = maxPad + 1;
    const setProgress = (done) => {
        const pct = Math.min(100, Math.round((done / total) * 100));
        if (progressText) progressText.textContent = `正在生成 n=0..${maxPad}（${done}/${total}）`;
        if (progressPercent) progressPercent.textContent = `${pct}%`;
        if (progressFill) progressFill.style.width = `${pct}%`;
    };
    setProgress(0);
    if (status) {
        status.className = 'exchange-sequence-status';
        status.textContent = '正在生成全部序列并筛选，请稍候…';
    }

    buildAllExchangeSequenceText(role, candidate, maxPad, count, {
        onProgress: setProgress,
        onDone: (text) => {
            exchangeFilterCache = { key: cacheKey, text };
            if (progress) progress.hidden = true;
            exchangeSequenceRunning = false;
            updateExchangeSequenceGenerateButton();
            applyText(text);
        },
        onError: (error) => {
            if (progress) progress.hidden = true;
            if (status) {
                status.className = 'exchange-sequence-status is-error';
                status.textContent = error?.message || String(error);
            }
            exchangeSequenceRunning = false;
            updateExchangeSequenceGenerateButton();
        },
    });
}


let cachedPurpleData = { purples: [], luck_pool: [] };
let cachedPurpleKey = '';
let currentMaxWashes = 3000;
let routeWashNos = [];
let routePadCount = 0;

function washPredictionStateSnapshot() {
    return {
        dlcMode: state.dlcMode,
        mode: state.mode,
        zizhi: state.zizhi,
        sex: state.sex,
        vip: state.vip,
        seed: state.seed,
        luckSeed: state.luckSeed,
        luckSeedInited: state.luckSeedInited,
        roleId: state.roleId,
        salt: state.salt,
        talents: state.talents.map(t => ({ id: t.id, locked: !!t.locked })),
        talLucky: state.talLucky,
        totalWash: state.totalWash,
        totalTalentBars: state.totalTalentBars,
        totalPills: state.totalPills,
        bagPills: state.bagPills,
        hasBagPills: state.hasBagPills,
        goldCount: state.goldCount,
        pityCount: state.pityCount,
        qualityCounts: state.qualityCounts,
        lastPurpleTotalPills: state.lastPurpleTotalPills,
        exchangeCount: state.exchangeCount,
        gifts: [state.strGift, state.conGift, state.dexGift, state.intGift],
        roleLevel: state.roleLevel,
        roleStats: state.roleStats,
        globalVars: state.globalVars,
        saveChannel: state.saveChannel,
        bornTalentRC: state.bornTalentRC,
    };
}

function purpleCacheKey() {
    return JSON.stringify({
        max: currentMaxWashes,
        state: washPredictionStateSnapshot(),
    });
}

function invalidatePurpleCache() {
    cachedPurpleKey = '';
    cachedPurpleData = { purples: [], luck_pool: [] };
    cachedExchangePadKey = '';
    cachedExchangePadResults = null;
    if (typeof invalidateAiPrediction === 'function') invalidateAiPrediction();
}

function ensurePurpleSequenceCache({ force = false } = {}) {
    const key = purpleCacheKey();
    if (!force && cachedPurpleKey === key && cachedPurpleData.purples) {
        return cachedPurpleData;
    }
    pushStateToWasm();
    const rawRes = wasmPreviewSequence(currentMaxWashes);
    cachedPurpleData = rawRes || { purples: [], luck_pool: [] };
    cachedPurpleKey = key;
    return cachedPurpleData;
}

let purpleReaderRunning = false;

function openPurpleAnalysisModal() {
    const modal = document.getElementById('purpleModal');
    if (modal) {
        modal.hidden = false;
        document.body?.classList.add('modal-open');
    }
    generatePurpleReaderSequence();
}

/** 后续保底紫直读：以洗髓页当前状态为起点（丹药管够继续洗），预览紧接着的 N 个保底紫 */
function generatePurpleReaderSequence() {
    if (purpleReaderRunning) return;
    const countInput = document.getElementById('purpleModalCountInput');
    const statusEl = document.getElementById('purpleModalStatus');
    const base = wasmGetState();
    if (!base) {
        if (statusEl) {
            statusEl.className = 'exchange-sequence-status is-error';
            statusEl.textContent = '算法内核尚未就绪或当前没有洗髓状态，请先导入存档。';
        }
        const gridEl = document.getElementById('purpleModalGrid');
        if (gridEl) gridEl.innerHTML = '';
        return;
    }
    const count = Math.max(1, Math.min(30, Math.trunc(Number(countInput?.value) || 10)));
    if (countInput) countInput.value = String(count);
    if (statusEl) {
        statusEl.className = 'exchange-sequence-status';
        statusEl.textContent = `正在推演置换序列（${count} 条）…`;
    }
    purpleReaderRunning = true;
    requestAnimationFrame(() => {
        try {
            const rows = runExchangeSequenceWasmSandbox(() => previewUpcomingPityPurples(base, count));
            renderPurpleReaderSequence(rows, base.luck_seed_inited ? base.luck_seed : base.seed);
            if (statusEl) statusEl.textContent = '';
        } catch (error) {
            if (statusEl) {
                statusEl.className = 'exchange-sequence-status is-error';
                statusEl.textContent = error?.message || String(error);
            }
            const gridEl = document.getElementById('purpleModalGrid');
            if (gridEl) gridEl.innerHTML = '';
        } finally {
            purpleReaderRunning = false;
        }
    });
}

/** 与 previewExchangeSequence 同源，但完整保留当前状态（锁定/保底进度/种子不重置），仅把丹药设为管够 */
function previewUpcomingPityPurples(base, count) {
    // 选哪套算法已下沉到「后端选择」层（WashEngineRegistry）：全局 wasm* 在先行服下已路由到 JsWashBackend，
    // 此处统一「写满丹药→推演→筛保底紫」即可，先行服/正式服/国际服共用一套，调用点零分支。
    const previewState = cloneExchangeSequenceValue(base);
    // wasm 的 get_state 不返回 born_talent_rc，回退到导入存档解析的 BornTalent.RC（同「原始脉序」修复）
    if (previewState.born_talent_rc == null) previewState.born_talent_rc = Number(state.bornTalentRC) || 0;
    previewState.bag_pills = 999999999;
    previewState.has_bag_pills = true;
    if (typeof wasmSetState === 'function' && !wasmSetState(previewState)) throw new Error('当前状态写入模拟内核失败');
    const countN = Math.max(1, Math.min(30, Math.trunc(Number(count) || 10)));
    let scanLimit = Math.max(20000, countN * 1000);
    let pityRows = [];
    for (let attempt = 0; attempt < 6; attempt += 1) {
        const preview = wasmPreviewSequence(scanLimit) || {};
        pityRows = (Array.isArray(preview.purples) ? preview.purples : []).filter(item => item.was_pity);
        if (pityRows.length >= countN) break;
        scanLimit = Math.ceil(scanLimit * 1.75);
    }
    if (pityRows.length < countN) throw new Error(`只推演出 ${pityRows.length}/${countN} 条保底紫，请减少条数`);
    return pityRows.slice(0, countN).map((item, index) => ({
        index: index + 1,
        name: item.talent_name,
        talentId: Number(item.talent_id),
        sourceWashNo: Number(item.wash_no),
    }));
}

function renderPurpleReaderSequence(rows, seedLabel) {
    const metaEl = document.getElementById('purpleModalMeta');
    const gridEl = document.getElementById('purpleModalGrid');
    if (gridEl) {
        const chips = (rows || []).map(item => {
            const quality = Number(TALENT_DATA[String(item.talentId)]?.weight || 1);
            const cls = ['exchange-seq-chip', 'is-pity'];
            if (quality) cls.push('talent-name', `q${quality}`);
            const label = `${item.index}. ${item.name}`;
            const tip = `自当前状态起第 ${item.sourceWashNo} 次洗髓触发保底`;
            return `<span class="${cls.join(' ')}" data-index="${item.index}" title="${tip}"><strong>${escapeAiHtml(label)}</strong></span>`;
        }).join('');
        gridEl.innerHTML = `<div class="exchange-seq-card"><div class="exchange-seq-card-head"><span>后续保底紫</span></div><div class="exchange-seq-grid">${chips}</div></div>`;
    }
    if (metaEl) {
        const seedText = (seedLabel === undefined || seedLabel === null || seedLabel === '') ? '' : ` · 当前种子 ${seedLabel}`;
        metaEl.textContent = `共 ${rows?.length || 0} 条 · 以当前页面状态为起点（洗髓丹管够、继续连洗）${seedText}`;
    }
}

function closePurpleAnalysisModal() {
    const modal = document.getElementById('purpleModal');
    if (modal) modal.hidden = true;
    document.body?.classList.remove('modal-open');
}

function loadMoreSequence() {
    currentMaxWashes += 3000;
    const tbody = document.getElementById('purpleTableBody');
    if (tbody) tbody.innerHTML = `<tr><td colspan="6" class="loading-td">正在扩展脉序至 ${currentMaxWashes}...</td></tr>`;
    requestAnimationFrame(() => {
        ensurePurpleSequenceCache({ force: true });
        paintPurpleForecastTable();
        renderExchangeAnalysisBlock();
    });
}

function renderPurpleForecastTable() {
    ensurePurpleSequenceCache();
    paintPurpleForecastTable();
    renderExchangeAnalysisBlock();
}

function paintPurpleForecastTable() {
    const tbody = document.getElementById('purpleTableBody');
    if (!tbody) return;

    const purples = cachedPurpleData.purples || [];

    const searchKeyword = (document.getElementById('purpleSearchInput')?.value || '').trim().toLowerCase();
    const exchangeOnly = document.getElementById('filterExchangeOnly')?.checked || false;
    const pityOnly = document.getElementById('filterPityOnly')?.checked || false;

    let filtered = purples.filter(item => {
        if (exchangeOnly && !item.can_exchange) return false;
        if (pityOnly && !item.was_pity) return false;
        if (searchKeyword) {
            const nameMatch = item.talent_name.toLowerCase().includes(searchKeyword);
            const conflictMatch = (item.earlier_conflict_name || '').toLowerCase().includes(searchKeyword);
            if (!nameMatch && !conflictMatch) return false;
        }
        return true;
    });

    const totalPurples = purples.length;
    const exchangeableTotal = purples.filter(i => i.can_exchange).length;

    const elMax = document.getElementById('currentMaxWashesDisplay');
    const elTotal = document.getElementById('purpleCount');
    const elEx = document.getElementById('exchangeableCount');
    if (elMax) elMax.textContent = currentMaxWashes;
    if (elTotal) elTotal.textContent = totalPurples;
    if (elEx) elEx.textContent = exchangeableTotal;

    if (!filtered.length) {
        tbody.innerHTML = `<tr><td colspan="6" class="loading-td">未找到符合条件的紫脉（已预测 ${currentMaxWashes} 次洗髓 / 脉序按天赋条数）</td></tr>`;
        return;
    }

    let html = '';
    filtered.forEach((item, idx) => {
        const pityTag = item.was_pity
            ? '<span class="tag-pity" title="未锁定连洗下的保底预测；中途锁脉后保底紫可能换成别的（与游戏一致）">保底</span>'
            : '-';

        let conflictText = '-';
        if (item.earlier_conflict_name) {
            const prevWashStr = item.earlier_conflict_wash_no === 0 ? '初始槽位' : `#${item.earlier_conflict_wash_no}`;
            const gapStr = item.earlier_conflict_gap != null ? `相距 ${item.earlier_conflict_gap} 条` : '';
            const purpleTag = item.earlier_conflict_is_purple ? ' · 紫' : '';
            conflictText = `<span class="conflict-cell">前有「${item.earlier_conflict_name}」<span class="conflict-wash-no">(${prevWashStr}，${gapStr}${purpleTag})</span></span>`;
        } else if (item.block_reason) {
            conflictText = `<span class="text-muted">${item.block_reason}</span>`;
        }

        let actionBtn = '-';
        if (item.can_exchange) {
            const isSelected = routeWashNos.includes(item.wash_no);
            actionBtn = `
                <button class="btn-select-exchange ${isSelected ? 'active' : ''}" data-washno="${item.wash_no}">
                    ${isSelected ? '已选推演' : '选择推演'}
                </button>
            `;
        }

        html += `
            <tr data-washno="${item.wash_no}">
                <td>#${idx + 1}</td>
                <td><b>#${item.wash_no}</b><div class="conflict-wash-no">洗${item.wash_times || '-'}次</div></td>
                <td><b class="purple-bright">${item.talent_name}</b></td>
                <td>${pityTag}</td>
                <td>${conflictText}</td>
                <td>${actionBtn}</td>
            </tr>
        `;
    });

    tbody.innerHTML = html;

    tbody.querySelectorAll('.btn-select-exchange').forEach(btn => {
        btn.addEventListener('click', (e) => {
            const washNo = parseInt(e.target.getAttribute('data-washno'));
            const idx = routeWashNos.indexOf(washNo);
            if (idx >= 0) {
                routeWashNos.splice(idx, 1);
            } else {
                routeWashNos.push(washNo);
                routeWashNos.sort((a, b) => a - b);
            }
            cachedExchangePadKey = '';
            const maxPad = getRouteMaxPad();
            if (routePadCount > maxPad) routePadCount = maxPad;
            paintPurpleForecastTable();
            renderExchangeAnalysisBlock();
        });
    });
}

function findNextPurpleAfter(afterSeq) {
    const purples = cachedPurpleData.purples || [];
    const after = Math.max(0, Number(afterSeq) || 0);
    return purples.find(p => p.wash_no > after) || null;
}

function hasLockableNonPurpleConflict(item) {
    return !!(item && item.can_exchange && item.earlier_conflict_name && !item.earlier_conflict_is_purple);
}

function highlightPurpleRow(washNo, { conflict = false } = {}) {
    const tbody = document.getElementById('purpleTableBody');
    if (!tbody) return;
    tbody.querySelectorAll('tr.row-highlight').forEach(tr => {
        tr.classList.remove('row-highlight', 'row-highlight-conflict');
    });
    const row = tbody.querySelector(`tr[data-washno="${washNo}"]`);
    if (!row) return;
    row.classList.add('row-highlight');
    if (conflict) row.classList.add('row-highlight-conflict');
    row.scrollIntoView({ block: 'center', behavior: 'smooth' });
}

function findTalentSlotIndexByName(name) {
    if (!name) return -1;
    return state.talents.findIndex(t => {
        const td = TALENT_DATA[String(t.id)];
        return td && td.name === name;
    });
}

function lockTalentByName(name) {
    const idx = findTalentSlotIndexByName(name);
    if (idx < 0) return false;
    state.talents[idx].locked = true;
    return true;
}

function canContinueWash() {
    const zzConfig = getZZConfig();
    if (zzConfig.num_talent === 0) return false;
    const lockedCount = state.talents.filter(t => t.locked).length;
    return zzConfig.num_talent > lockedCount;
}

function batchWashTimes(times) {
    if (times <= 0 || !canContinueWash()) return 0;
    if (state.dlcMode) {
        const batch = [];
        for (let i = 0; i < times; i++) {
            const result = doWash();
            if (!result) break;
            batch.push(result);
        }
        if (batch.length) addLogEntries(batch);
        return batch.length;
    }
    pushStateToWasm();
    const rawBatch = wasmWashMulti(times);
    if (!rawBatch || !rawBatch.length) return 0;
    pullStateFromWasm();
    addLogEntries(rawBatch.map(convertWashResult));
    return rawBatch.length;
}

function batchWashUntilName(name, maxWashes = 5000) {
    if (!name) return { washed: 0, found: false };
    if (findTalentSlotIndexByName(name) >= 0) return { washed: 0, found: true };
    if (!canContinueWash()) return { washed: 0, found: false };
    if (state.dlcMode) {
        const batch = [];
        let found = false;
        for (let i = 0; i < maxWashes; i++) {
            const result = doWash();
            if (!result) break;
            batch.push(result);
            found = findTalentSlotIndexByName(name) >= 0;
            if (found) break;
        }
        if (batch.length) addLogEntries(batch);
        return { washed: batch.length, found };
    }
    pushStateToWasm();
    const rawBatch = wasmWashUntilTalentName(name, maxWashes);
    if (!rawBatch || !rawBatch.length) {
        pullStateFromWasm();
        return { washed: 0, found: findTalentSlotIndexByName(name) >= 0 };
    }
    pullStateFromWasm();
    addLogEntries(rawBatch.map(convertWashResult));
    return { washed: rawBatch.length, found: findTalentSlotIndexByName(name) >= 0 };
}

function washToConflictAndLock(item) {
    if (!item || !item.earlier_conflict_name) {
        alert('该紫脉没有可锁定的前置冲突脉');
        return;
    }
    if (item.earlier_conflict_is_purple) {
        alert(`冲突「${item.earlier_conflict_name}」为紫脉/神脉，请改在「紫脉脉序与置换推演」中操作神脉互冲`);
        return;
    }
    const conflictTimes = item.earlier_conflict_wash_times || 0;
    const conflictSeq = item.earlier_conflict_wash_no || 0;
    if (conflictTimes > 0 && state.totalWash > conflictTimes) {
        alert(`当前已洗 ${state.totalWash} 次（超过冲突脉洗髓次数 ${conflictTimes}，脉序 #${conflictSeq}）。请回首页重新导入存档后再试。`);
        return;
    }
    if (conflictTimes > state.totalWash) {
        const need = conflictTimes - state.totalWash;
        const n = batchWashTimes(need);
        if (n < need && state.totalWash < conflictTimes) {
            updateAll();
            alert('未能洗到冲突脉');
            return;
        }
    }
    if (findTalentSlotIndexByName(item.earlier_conflict_name) < 0) {
        const r = batchWashUntilName(item.earlier_conflict_name, 80);
        if (!r.found) {
            updateAll();
            alert(`脉序 #${conflictSeq || '-'}（洗${conflictTimes || state.totalWash}次）附近未出现「${item.earlier_conflict_name}」`);
            return;
        }
    }
    lockTalentByName(item.earlier_conflict_name);
    updateAll();
    findAndShowNextConflict(state.totalTalentBars);
}

function washToPurpleTalent(item) {
    if (!item) return;
    if (findTalentSlotIndexByName(item.talent_name) >= 0) {
        updateAll();
        findAndShowNextConflict(state.totalTalentBars);
        return;
    }
    const r = batchWashUntilName(item.talent_name, 5000);
    updateAll();
    if (!r.found) {
        alert(r.washed > 0
            ? `连洗 ${r.washed} 次仍未出现「${item.talent_name}」，请确认已锁定冲突脉`
            : '未能洗到紫脉');
    }
    findAndShowNextConflict(state.totalTalentBars);
}

function washConflictThenPurple(item) {
    washToConflictAndLock(item);
    if (findTalentSlotIndexByName(item.earlier_conflict_name) < 0) return;
    washToPurpleTalent(item);
}

function findAndShowNextConflict(afterSeq) {
    const box = document.getElementById('nextConflictResult');
    const afterEl = document.getElementById('nextConflictAfterWash');
    const after = afterSeq != null ? afterSeq : (state.totalTalentBars || 0);
    if (afterEl) afterEl.value = String(after);

    ensurePurpleSequenceCache();

    const item = findNextPurpleAfter(after);
    if (!box) return item;

    if (!item) {
        box.innerHTML = `<span class="text-muted">脉序 #${after} 之后未找到紫脉（可先打开「紫脉脉序与置换推演」加载更多；脉序=天赋条数）</span>`;
        return null;
    }

    if (!hasLockableNonPurpleConflict(item)) {
        const reason = item.block_reason
            || (!item.earlier_conflict_name
                ? `下一紫「${item.talent_name}」无同类冲突，无法置换`
                : (item.earlier_conflict_is_purple
                    ? `下一紫「${item.talent_name}」冲突为紫脉/神脉「${item.earlier_conflict_name}」，无非紫脉冲突可锁定（神脉可在脉序推演中互冲）`
                    : `下一紫「${item.talent_name}」不可按锁冲突流程置换`));
        box.innerHTML = `
            <div class="nc-steps" style="color:var(--red)">查询不到可锁定的非紫冲突脉</div>
            <div>下一紫：<b class="purple-bright">#${item.wash_no} ${item.talent_name}</b>${item.was_pity ? ' · 保底' : ''}</div>
            <div class="nc-steps">${reason}</div>
            <div class="nc-actions">
                <button type="button" class="btn btn-wash-custom" id="btnNcFindAfter" data-after="${item.wash_no}">再查其后下一紫</button>
            </div>
        `;
        const afterBtn = box.querySelector('#btnNcFindAfter');
        if (afterBtn) {
            afterBtn.addEventListener('click', () => {
                findAndShowNextConflict(parseInt(afterBtn.getAttribute('data-after'), 10));
            });
        }
        return null;
    }

    const curBars = state.totalTalentBars || 0;
    const curWash = state.totalWash || 0;
    const conflictSeq = item.earlier_conflict_wash_no || 0;
    const conflictTimes = item.earlier_conflict_wash_times || 0;
    const prevWashStr = conflictSeq === 0 ? '初始槽位' : `#${conflictSeq}`;
    const gapStr = item.earlier_conflict_gap != null ? `相距 ${item.earlier_conflict_gap} 条` : '';
    const pity = item.was_pity ? ' · 保底' : '';

    const toConflictWash = conflictTimes > curWash ? conflictTimes - curWash : 0;
    const toPurpleWash = (item.wash_times || 0) > curWash ? (item.wash_times - curWash) : 0;
    const hasConflictNow = findTalentSlotIndexByName(item.earlier_conflict_name) >= 0;
    const conflictLocked = hasConflictNow && state.talents[findTalentSlotIndexByName(item.earlier_conflict_name)]?.locked;
    const hasPurpleNow = findTalentSlotIndexByName(item.talent_name) >= 0;

    let statusHtml = `<div class="nc-steps">当前：脉序 <b>#${curBars}</b>（已洗 ${curWash} 次）`;
    if (hasPurpleNow) {
        statusHtml += ` · 已刷出「${item.talent_name}」，可直接置换`;
    } else if (conflictLocked) {
        statusHtml += ` · 已锁定「${item.earlier_conflict_name}」，约再洗 <b>${toPurpleWash}</b> 次到紫`;
    } else if (hasConflictNow) {
        statusHtml += ` · 槽内已有「${item.earlier_conflict_name}」，请锁定后继续洗`;
    } else if (conflictTimes > 0 && curWash < conflictTimes) {
        statusHtml += ` · 约再洗 <b>${toConflictWash}</b> 次到冲突，再到紫约 <b>${toPurpleWash}</b> 次`;
    } else if (conflictTimes > 0 && curWash > conflictTimes) {
        statusHtml += ` · 已过冲突洗髓次数 ${conflictTimes}（脉序 #${conflictSeq}），此条需回档/重置`;
    }
    statusHtml += '</div>';

    const stepsHtml = `
        <div class="nc-steps">
            洗脉步骤：洗到 <b>${prevWashStr}</b> 锁定「<b>${item.earlier_conflict_name}</b>」
            → 继续洗到「<b class="purple-bright">${item.talent_name}</b>」（脉序 #${item.wash_no}）后点置换
            ${gapStr ? `（${gapStr}）` : ''}
        </div>
    `;

    const pastConflict = conflictTimes > 0 && curWash > conflictTimes && !hasConflictNow;
    box.innerHTML = `
        <div>
            下一紫：<b class="purple-bright">#${item.wash_no} ${item.talent_name}</b>${pity}
            <span class="text-muted">（洗髓第 ${item.wash_times || '-'} 次）</span>
        </div>
        <div>
            最近冲突脉：
            「<b style="color:var(--red)">${item.earlier_conflict_name}</b>」(${prevWashStr}${gapStr ? '，' + gapStr : ''})
        </div>
        ${statusHtml}
        ${stepsHtml}
        <div class="nc-actions">
            ${!pastConflict ? `
                <button type="button" class="btn btn-wash-gold" id="btnNcWashLock">洗到冲突并锁定</button>
                <button type="button" class="btn btn-wash-custom" id="btnNcWashPurple">继续洗到紫脉</button>
                <button type="button" class="btn btn-wash" id="btnNcWashAll">一键锁冲突洗到紫</button>
            ` : ''}
            ${hasConflictNow && !conflictLocked ? `
                <button type="button" class="btn btn-wash-gold" id="btnNcLockOnly">锁定「${item.earlier_conflict_name}」</button>
            ` : ''}
            <button type="button" class="btn btn-wash-custom" id="btnNcFindAfter" data-after="${item.wash_no}">再查其后下一紫</button>
        </div>
    `;

    const btnLockWash = box.querySelector('#btnNcWashLock');
    if (btnLockWash) btnLockWash.addEventListener('click', () => washToConflictAndLock(item));
    const btnPurple = box.querySelector('#btnNcWashPurple');
    if (btnPurple) btnPurple.addEventListener('click', () => washToPurpleTalent(item));
    const btnAll = box.querySelector('#btnNcWashAll');
    if (btnAll) btnAll.addEventListener('click', () => washConflictThenPurple(item));
    const btnLockOnly = box.querySelector('#btnNcLockOnly');
    if (btnLockOnly) {
        btnLockOnly.addEventListener('click', () => {
            lockTalentByName(item.earlier_conflict_name);
            updateAll();
            findAndShowNextConflict(state.totalTalentBars);
        });
    }
    const afterBtn = box.querySelector('#btnNcFindAfter');
    if (afterBtn) {
        afterBtn.addEventListener('click', () => {
            findAndShowNextConflict(parseInt(afterBtn.getAttribute('data-after'), 10));
        });
    }

    return item;
}

function formatExchangeChainHtml(chain) {
    if (!chain || !chain.length) return '<span class="text-muted">-</span>';
    if (chain.length === 1) {
        const only = chain[0];
        if (/跳过|锁留/.test(only)) return `<span class="text-muted">${only}</span>`;
        return `<b class="purple-bright">${only}</b>`;
    }
    const head = chain.slice(0, -1).map(n => `${n}<span class="reconflict-tag">(再冲突)</span>`).join(' ➔ ');
    return `${head} ➔ <b class="purple-bright">${chain[chain.length - 1]}</b>`;
}

function formatShenmaiForkLine(fork) {
    if (!fork) return '';
    const from = fork.exchange_from || '?';
    const chain = fork.chain || [];
    const rolls = Number(fork.pity_rolls_first) || 0;
    const seedHint = rolls > 0
        ? `<span class="shenmai-roll-hint">首抽${rolls}次→seed ${fork.luck_seed_after_first}</span>`
        : '';
    if (!chain.length) {
        return `<div class="shenmai-fork"><span class="text-muted">换「${from}」</span> ➔ - ${seedHint}</div>`;
    }
    if (/失败/.test(chain[0] || '')) {
        return `<div class="shenmai-fork"><span class="text-muted">换「${from}」</span> ➔ <span class="text-muted">${chain[0]}</span></div>`;
    }
    return `<div class="shenmai-fork"><span class="text-muted">换「${from}」</span> ➔ ${formatExchangeChainHtml(chain)} ${seedHint}</div>`;
}

function formatShenmaiForkNote(forks) {
    const finals = forks.map(f => f.final_name || '');
    const finalsSame = finals.every(n => n && n === finals[0]);
    const afterSeeds = forks.map(f => String(f.luck_seed_after_first ?? ''));
    const seedsSame = afterSeeds.every(s => s === afterSeeds[0]);
    const rolls = forks.map(f => Number(f.pity_rolls_first) || 0);
    const rollsSame = rolls.every(r => r === rolls[0]);
    const chainsSame = forks.every(f => JSON.stringify(f.chain || []) === JSON.stringify(forks[0].chain || []));

    if (!finalsSame) {
        return `<div class="shenmai-fork-note text-muted">换不同神脉结果不同（欧气跳过仍持有的神脉 ID，首抽序列会分叉）</div>`;
    }
    if (chainsSame && seedsSame && rollsSame) {
        return `<div class="shenmai-fork-note text-muted">本步路径相同：首次欧气接受的不是「对方神脉 ID」，换哪条都走同一抽序 → 结果必然一样</div>`;
    }
    return `<div class="shenmai-fork-note text-muted">终局碰巧相同：首抽链/欧气抽次已分叉（见各行「首抽N次→seed」），不是「换哪条都必然一样」</div>`;
}

function formatFollowingNodesBrief(following) {
    if (!following || !following.length) return '<span class="text-muted">（无后续目标）</span>';
    return following.map(n => {
        const name = n.purple_name || '?';
        if (n.shenmai_forks && n.shenmai_forks.length >= 2) {
            const forks = n.shenmai_forks.map(f => `换${f.exchange_from}→${f.final_name || '?'}`).join('；');
            return `<span class="chain-follow-item"><b>${name}</b>：${forks}</span>`;
        }
        const c0 = (n.chain && n.chain[0]) || n.final_name || '-';
        if (/跳过|锁留/.test(c0)) {
            return `<span class="chain-follow-item"><b>${name}</b>：${c0}</span>`;
        }
        const fin = n.final_name || c0;
        const mid = (n.chain && n.chain.length > 1)
            ? `${n.chain.slice(0, -1).join('→')}→${fin}`
            : fin;
        return `<span class="chain-follow-item"><b>${name}</b>→${mid}</span>`;
    }).join('<span class="text-muted"> ｜ </span>');
}

function formatChainStopAltsHtml(node) {
    const alts = node.chain_stop_alts || [];
    if (alts.length < 2) return '';
    const rows = alts.map(alt => {
        const tag = alt.is_full_chain
            ? '<span class="reconflict-tag">打满</span>'
            : `<span class="reconflict-tag">第${Number(alt.stop_at) + 1}环停</span>`;
        return `<div class="chain-stop-row">
            保留「<b class="purple-bright">${alt.keep_name}</b>」${tag}
            → 后续 ${formatFollowingNodesBrief(alt.following_nodes)}
        </div>`;
    }).join('');
    return `
        <details class="chain-stop-alts">
            <summary>展开：中途保留时后续脉结果（${alts.length} 种停法）</summary>
            <div class="chain-stop-body">${rows}</div>
        </details>
    `;
}

function formatNodeExchangeResult(node) {
    if (!node) return '<span class="text-muted">-</span>';
    const forks = node.shenmai_forks || [];
    if (forks.length >= 2) {
        return `<div class="shenmai-forks">${forks.map(formatShenmaiForkLine).join('')}${formatShenmaiForkNote(forks)}</div>`;
    }
    const chain = node.chain || [];
    if (!chain.length) return '<span class="text-muted">-</span>';
    if (/跳过|锁留/.test(chain[0] || '')) return formatExchangeChainHtml(chain);
    const from = node.purple_name || '';
    const conf = node.conflict_name && node.conflict_name !== '—'
        ? `<span class="reconflict-tag">←${node.conflict_name}</span>`
        : '';
    let main;
    if (chain.length === 1 && from && chain[0] !== from) {
        main = `<span class="text-muted">置换「${from}」${conf}</span> ➔ <b class="purple-bright">${chain[0]}</b>`;
    } else {
        main = `<span class="text-muted">置换「${from}」${conf}</span> ➔ ${formatExchangeChainHtml(chain)}`;
    }
    return `${main}${formatChainStopAltsHtml(node)}`;
}

function getRouteMaxPad() {
    if (routeWashNos.length >= 2) {
        const gap = routeWashNos[1] - routeWashNos[0];
        return Math.max(0, Math.min(200, Math.max(0, gap - 1)));
    }
    return 30;
}

function isShenmaiTalentId(id) {
    return id === 248 || id === 249 || id === 250;
}

function buildExchangeRouteTargets() {
    const purples = cachedPurpleData.purples || [];
    return routeWashNos.map((wn, idx) => {
        const item = purples.find(p => p.wash_no === wn);
        if (!item) return null;
        const shenmai = isShenmaiTalentId(item.talent_id);
        if (!item.earlier_conflict_name && !shenmai) return null;
        const lockOnly = shenmai && !item.earlier_conflict_name;
        return {
            purple_name: item.talent_name,
            conflict_name: item.earlier_conflict_name || '',
            conflict_wash_no: (!lockOnly && idx === 0) ? (item.earlier_conflict_wash_times || 0) : 0,
            lock_only: lockOnly,
        };
    }).filter(Boolean);
}

let cachedExchangePadResults = null;
let cachedExchangePadKey = '';

function getExchangePadResults(maxPad) {
    const targets = buildExchangeRouteTargets();
    const key = JSON.stringify({
        targets,
        maxPad,
        washNos: routeWashNos.slice(),
        state: washPredictionStateSnapshot(),
    });
    if (cachedExchangePadKey === key && cachedExchangePadResults) {
        return cachedExchangePadResults;
    }
    pushStateToWasm();
    const results = wasmPreviewExchangePads(targets, maxPad) || [];
    cachedExchangePadKey = key;
    cachedExchangePadResults = results;
    return results;
}

function renderExchangeAnalysisBlock() {
    const container = document.getElementById('exchangeBlockContent');
    if (!container) return;

    const purples = cachedPurpleData.purples || [];

    if (!routeWashNos.length) {
        container.innerHTML = `<div class="block-empty">尚未选择可置换紫脉。请在上方表格点击「选择推演」（建议选 2~3 条，共同推演置换脉序）</div>`;
        return;
    }

    const routeItems = routeWashNos.map(wn => purples.find(p => p.wash_no === wn)).filter(Boolean);
    if (!routeItems.length) {
        container.innerHTML = `<div class="block-empty">所选脉序已不在当前预测范围内，请重新选择</div>`;
        return;
    }
    if (routeItems.some(i => !i.earlier_conflict_name && !isShenmaiTalentId(i.talent_id))) {
        container.innerHTML = `<div class="block-empty">所选紫脉缺少冲突脉信息，无法推演置换</div>`;
        return;
    }

    const maxPad = getRouteMaxPad();
    if (routePadCount > maxPad) routePadCount = maxPad;
    if (routePadCount < 0) routePadCount = 0;

    const previewPads = Math.min(maxPad, Math.max(8, routePadCount + 3));
    const padResults = getExchangePadResults(previewPads);
    const selected = padResults.find(r => r.pad === routePadCount) || padResults[0];

    const luckInited = !!state.luckSeedInited;
    const mechTip = luckInited
        ? '当前欧气种子已初始化（存档已有 LuckTalent 或已置换过）：垫洗不再改变首紫置换起点，下表主要反映已固定的欧气序列。'
        : '欧气种子尚未初始化：锁冲突→开≥3 槽→洗出首紫后，每多洗 1 次再置换 = 新置换脉序（首次置换时用当时的主种子初始化欧气池）。首紫锁定后，后续紫脉置换结果固定。';

    let nodesSummaryHtml = routeItems.map((item, idx) => {
        const nodeSim = selected && selected.nodes ? selected.nodes[idx] : null;
        const resultHtml = nodeSim ? formatNodeExchangeResult(nodeSim) : '-';
        const lastHint = nodeSim && nodeSim.last_slot_name
            ? `<span class="card-last-slot">末格：${nodeSim.last_slot_name}</span>`
            : '';
        const roleLabel = idx === 0 ? '首紫（可垫洗）' : `第${idx + 1}紫（锁定后固定）`;
        let conflictHtml;
        if (nodeSim && nodeSim.conflict_name) {
            conflictHtml = `冲突：${nodeSim.conflict_name}`;
        } else if (item.earlier_conflict_name) {
            const prevWashStr = item.earlier_conflict_wash_no === 0 ? '初始槽位' : `#${item.earlier_conflict_wash_no}`;
            const gapStr = item.earlier_conflict_gap != null ? `相距 ${item.earlier_conflict_gap} 条` : '';
            conflictHtml = `冲突：「${item.earlier_conflict_name}」(${prevWashStr}${gapStr ? '，' + gapStr : ''})`;
        } else if (isShenmaiTalentId(item.talent_id)) {
            conflictHtml = '冲突：锁留（前序若已有神脉则自动互冲置换）';
        } else {
            conflictHtml = '冲突：-';
        }
        return `
            <div class="selected-exchange-card ${idx === 0 ? '' : 'fixed-node'}">
                <div class="card-header">
                    <span class="card-title">#${idx + 1} ${roleLabel}：<b>#${item.wash_no} ${item.talent_name}</b></span>
                    <span class="card-conflict">${conflictHtml}</span>
                    ${lastHint}
                    <button class="btn-remove-route-item btn-reset-role" data-washno="${item.wash_no}">移除</button>
                </div>
                <div class="exchange-stepper">
                    <span class="step-result">置换结果：${resultHtml}</span>
                </div>
            </div>
        `;
    }).join('');

    let tableHead = '<th>置换脉序</th><th>垫洗</th><th>末格</th>';
    routeItems.forEach((item, idx) => {
        tableHead += `<th>#${item.wash_no} ${item.talent_name}${idx === 0 ? '' : ' <span class="th-fixed">固定</span>'}</th>`;
    });

    let tableBody = '';
    for (let pad = 0; pad <= previewPads; pad++) {
        const row = padResults.find(r => r.pad === pad) || { nodes: [], error: '无数据' };
        const isSel = pad === routePadCount;
        const lastSlot = row.nodes && row.nodes[0] ? (row.nodes[0].last_slot_name || '-') : '-';
        let cells = '';
        if (row.error && (!row.nodes || !row.nodes.length)) {
            cells = `<td colspan="${routeItems.length}" class="loading-td">${row.error}</td>`;
        } else {
            for (let i = 0; i < routeItems.length; i++) {
                const n = row.nodes[i];
                cells += `<td>${n ? formatNodeExchangeResult(n) : '-'}</td>`;
            }
        }
        const padLabel = pad === 0 ? '直接置换' : `锁紫再洗 ${pad} 次`;
        tableBody += `
            <tr class="route-pad-row ${isSel ? 'current-step' : ''}" data-pad="${pad}">
                <td><b>第 ${pad + 1} 条</b></td>
                <td>${padLabel}</td>
                <td>${lastSlot}</td>
                ${cells}
            </tr>
        `;
    }
    if (maxPad > previewPads) {
        tableBody += `<tr><td colspan="${3 + routeItems.length}" class="loading-td">… 另有更靠后的脉序，用上方跳转加载（每次最多模拟到当前选中附近）</td></tr>`;
    }

    const errBanner = selected && selected.error
        ? `<p class="modal-tip" style="color:var(--red)">推演警告：${selected.error}</p>`
        : '';

    container.innerHTML = `
        <div class="route-joint-panel">
            <p class="modal-tip"><b>真实路径推演</b>：${mechTip}</p>
            ${errBanner}

            <div class="exchange-stepper route-pad-stepper">
                <span>当前置换脉序：</span>
                <button class="step-btn" id="btnRoutePadMinus" type="button">-</button>
                <span class="step-val">第 ${routePadCount + 1} 条</span>
                <button class="step-btn" id="btnRoutePadPlus" type="button">+</button>
                <span class="pad-jump">
                    跳转垫洗
                    <input type="number" id="routePadInput" min="0" max="${maxPad}" value="${routePadCount}" />
                    发
                </span>
                <span class="step-result">（${routePadCount === 0 ? '直接置换' : '锁紫再洗 ' + routePadCount + ' 次'}）</span>
            </div>

            <div class="route-nodes-summary">${nodesSummaryHtml}</div>

            <div class="multi-exchange-section">
                <p class="modal-tip">点击下表切换脉序。末格为置换前最后一格天赋（社区常用来标记序列）。多环再冲突时可「展开」查看<b>中途保留某一环</b>时后续目标紫的置换结果（默认主列为打满再冲突）。神脉并存时列出各神脉置换；前序已获同名显示「跳过」。</p>
                <div class="route-pad-table-wrap">
                    <table class="route-pad-table">
                        <thead><tr>${tableHead}</tr></thead>
                        <tbody>${tableBody}</tbody>
                    </table>
                </div>
            </div>
        </div>
    `;

    container.querySelectorAll('.btn-remove-route-item').forEach(btn => {
        btn.addEventListener('click', (e) => {
            const washNo = parseInt(e.currentTarget.getAttribute('data-washno'));
            const idx = routeWashNos.indexOf(washNo);
            if (idx >= 0) routeWashNos.splice(idx, 1);
            cachedExchangePadKey = '';
            const newMax = getRouteMaxPad();
            if (routePadCount > newMax) routePadCount = newMax;
            renderPurpleForecastTable();
        });
    });

    const minusBtn = container.querySelector('#btnRoutePadMinus');
    const plusBtn = container.querySelector('#btnRoutePadPlus');
    const padInput = container.querySelector('#routePadInput');

    if (minusBtn) {
        minusBtn.addEventListener('click', () => {
            if (routePadCount > 0) {
                routePadCount--;
                renderExchangeAnalysisBlock();
            }
        });
    }
    if (plusBtn) {
        plusBtn.addEventListener('click', () => {
            if (routePadCount < maxPad) {
                routePadCount++;
                renderExchangeAnalysisBlock();
            }
        });
    }
    if (padInput) {
        padInput.addEventListener('change', () => {
            let v = parseInt(padInput.value, 10);
            if (Number.isNaN(v)) v = 0;
            routePadCount = Math.max(0, Math.min(maxPad, v));
            renderExchangeAnalysisBlock();
        });
    }

    container.querySelectorAll('.route-pad-row').forEach(row => {
        row.addEventListener('click', () => {
            const pad = parseInt(row.getAttribute('data-pad'), 10);
            if (!Number.isNaN(pad)) {
                routePadCount = pad;
                renderExchangeAnalysisBlock();
            }
        });
    });
    container.querySelectorAll('.chain-stop-alts').forEach(el => {
        el.addEventListener('click', (e) => e.stopPropagation());
    });
}

let aiSelectedTalentIds = [];
let aiAvailableTalentIds = [];
let aiSearchToken = 0;
let aiCancelRequested = false;
let aiSearchRunning = false;
let aiLastPrediction = null;
let autoWashSelectedRoleKey = '';
let aiSearchWorkerControl = null;

function finishAiSearchWorker(control, result, error) {
    if (!control || control.settled) return;
    control.settled = true;
    if (aiSearchWorkerControl === control) aiSearchWorkerControl = null;
    control.worker.onmessage = null;
    control.worker.onerror = null;
    control.worker.terminate();
    if (error) control.reject(error);
    else control.resolve(result);
}

function stopAiSearchWorker(reason = 'cancelled') {
    const control = aiSearchWorkerControl;
    if (!control) return false;
    finishAiSearchWorker(control, { cancelled: true, reason }, null);
    return true;
}

function startAiSearchWorker(input, onProgress, onCandidate) {
    if (typeof Worker !== 'function') {
        return Promise.reject(new Error('当前浏览器不支持后台计算线程，请通过网站或 HTTP 服务使用自动洗脉。'));
    }
    stopAiSearchWorker('replaced');
    return new Promise((resolve, reject) => {
        let worker;
        try {
            const workerUrl = new URL('../shared/wash_route_worker.js', window.location.href);
            worker = new Worker(workerUrl);
        } catch (error) {
            reject(new Error(`后台计算线程创建失败：${error && error.message ? error.message : error}`));
            return;
        }
        const requestId = `wash-${Date.now()}-${Math.random().toString(36).slice(2)}`;
        const control = { worker, requestId, resolve, reject, settled: false };
        aiSearchWorkerControl = control;
        worker.onmessage = event => {
            const message = event && event.data || {};
            if (message.requestId !== requestId || control.settled) return;
            if (message.type === 'progress') {
                if (typeof onProgress === 'function') onProgress(message.progress || {});
                return;
            }
            if (message.type === 'candidate') {
                if (typeof onCandidate === 'function') onCandidate(message.result || { routes: [] });
                return;
            }
            if (message.type === 'result') {
                finishAiSearchWorker(control, message.result || { routes: [] }, null);
                return;
            }
            if (message.type === 'error') {
                finishAiSearchWorker(control, null, new Error(message.error || '后台搜索失败'));
            }
        };
        worker.onerror = event => {
            if (event && typeof event.preventDefault === 'function') event.preventDefault();
            const detail = event && (event.message || event.error && event.error.message);
            finishAiSearchWorker(control, null, new Error(`后台计算线程加载失败${detail ? `：${detail}` : '，请通过网站或 HTTP 服务使用自动洗脉。'}`));
        };
        try {
            worker.postMessage({ type: 'start', requestId, input });
        } catch (error) {
            finishAiSearchWorker(control, null, new Error(`后台搜索参数发送失败：${error && error.message ? error.message : error}`));
        }
    });
}

function isAutoSimulatorView() {
    return document.documentElement.classList.contains('auto-simulator-view');
}

function selectedAutoWashRoleEntry() {
    if (!autoWashSelectedRoleKey) return null;
    return (state.saveRoles || []).find(entry => entry.key === autoWashSelectedRoleKey) || null;
}

function renderAutoWashSaveGate() {
    const select = document.getElementById('autoWashRoleSelect');
    const vipSelect = document.getElementById('autoWashVipSelect');
    const status = document.getElementById('autoWashSaveStatus');
    const pills = document.getElementById('autoWashBagPillDisplay');
    const summary = document.getElementById('autoWashRoleSummary');
    if (!select && !vipSelect && !status && !pills && !summary) return;

    const roles = state.saveRoles || [];
    const hasSave = !!state.saveData && roles.length > 0;
    const selected = selectedAutoWashRoleEntry();
    if (select) {
        const placeholder = hasSave ? '请选择人物' : '暂无可选人物';
        select.innerHTML = `<option value="">${placeholder}</option>` + roles.map(entry => (
            `<option value="${escapeAiHtml(entry.key)}">${escapeAiHtml(`${entry.tag} · ${entry.role.Name || '无名'}`)}</option>`
        )).join('');
        select.disabled = !hasSave;
        select.value = selected ? selected.key : '';
    }
    if (vipSelect) vipSelect.value = String(normalizeVipLevel(state.vip));
    if (status) {
        status.textContent = !hasSave
            ? '尚未导入存档'
            : (selected ? `已选择 · ${selected.tag} · ${selected.role.Name || '无名'}` : `已导入 ${roles.length} 名人物，请继续选择`);
    }
    if (pills) pills.textContent = state.hasBagPills ? `${state.bagPills.toLocaleString()} 颗` : '--';
    if (summary) {
        if (!hasSave) {
            summary.textContent = '请先使用导出工具取得存档并导入；自动洗脉不接受手动种子。';
        } else if (!selected) {
            summary.textContent = '存档已导入。必须明确选择一名人物，才能读取其资质、天赋和洗脉状态。';
        } else {
            const zz = ZZ_DATA[String(state.zizhi)] || {};
            const zeroSlotPlan = Number(state.zizhi) === 150
                ? ' · 自动模拟将从 0 槽逐级开槽，并在每一级比较继续洗脉'
                : '';
            summary.textContent = `${selected.role.Name || '无名'} · ${zz.zz_name || zz.name || `资质 ${state.zizhi}`}（${Number(zz.num_talent || 0)} 槽） · 当前 ${state.talents.length} 条天赋${zeroSlotPlan}`;
        }
    }
}

function selectAutoWashRole(roleKey) {
    const key = String(roleKey || '');
    autoWashSelectedRoleKey = (state.saveRoles || []).some(entry => entry.key === key) ? key : '';
    aiSelectedTalentIds = [];
    invalidateAiPrediction();
    if (autoWashSelectedRoleKey) {
        state.mode = 'seed';
        const mode = document.getElementById('modeSelect');
        if (mode) mode.value = 'seed';
        selectRoleFromSave(autoWashSelectedRoleKey);
    } else {
        aiAvailableTalentIds = [];
        renderAiTalentChoices();
        renderAutoWashSaveGate();
    }
}

// ═══════════════════ 原始脉序（速查：剩余丹数内能出哪些紫脉）═══════════════════
/** 读不到背包洗髓丹时用的兜底丹数 */
const PULSE_FALLBACK_PILLS = 10000;
/** 本次渲染用的起始总丹数（首行的间隔以它为起算点） */
let pulseRecordTotal = PULSE_FALLBACK_PILLS;
/** 用户是否手动改过丹数输入框 */
let pulsePillsEdited = false;
/** 原始脉序是否已生成过（用于资质变化时自动重算） */
let pulseBuiltOnce = false;

// 资质等级变化后，若原始脉序已生成过，自动按新槽数重算（改下拉/点「提升资质」无需再手动点按钮）
function refreshPulseIfBuilt() {
    if (pulseBuiltOnce && state.saveData) {
        try { buildPulseRecord(); } catch (e) { console.warn('[原始脉序] 自动刷新失败：', e); }
    }
}

/** 丹数默认值：优先取「背包洗髓丹」 */
function pulseDefaultPills() {
    const bag = Number(state.bagPills);
    if (Number.isFinite(bag) && bag > 0) return bag;
    return PULSE_FALLBACK_PILLS;
}

/** 未手动修改时，输入框跟随背包丹数刷新 */
function syncPulsePillsInput(force) {
    const el = document.getElementById('pulsePillsInput');
    if (!el) return;
    if (force) pulsePillsEdited = false;
    if (pulsePillsEdited && !force) return;
    el.value = String(pulseDefaultPills());
}

/** 读取输入框里的丹数；为空/非法时用默认值并写回 */
function pulsePillsInputValue() {
    const el = document.getElementById('pulsePillsInput');
    const value = el ? parseInt(el.value, 10) : NaN;
    if (Number.isFinite(value) && value > 0) return value;
    const fallback = pulseDefaultPills();
    if (el) el.value = String(fallback);
    return fallback;
}

// ═══════════════════ 洗脉算法开关（仅「最新」算法）═══════════════════
/**
 * 当前只对外暴露「最新」算法（preview 后端，实测验证：与玩家真实脉序 6/6 吻合）。
 * 打开页面即走最新算法；导入存档后也统一为最新算法。正式服入口已隐藏，不再可切换。
 * key 升到 v2：丢弃旧版本持久化的 'official'，统一锁定 preview。
 */
const WASH_ALGO_KEY = 'yyjh_wash_algo_v2';
// 仅对外暴露「最新」算法（preview 后端）；正式服入口已隐藏，不再可切换。
let washAlgoMode = 'preview';                  // 仅 'preview'

function loadWashAlgoMode() {
    // 旧版本可能持久化过 'official'，此处强制忽略，统一锁定为 preview（最新算法）。
    return 'preview';
}
function saveWashAlgoMode(mode) {
    try { localStorage.setItem(WASH_ALGO_KEY, 'preview'); } catch (e) { }
}
function isPreviewWashAlgo() { return washAlgoMode === 'preview'; }

/**
 * 当前只对外暴露「最新」洗脉算法（preview 后端）；正式服入口已隐藏。
 * 此函数仍保留可调用性，但一律锁定为 preview，按钮仅作当前算法标识展示。
 * 所有洗脉功能（洗髓 / 洗到出紫 / 连洗 / 置换 / 原始脉序 / 保底进度 / 背包丹 / 日志回放）
 * 都跟随 WashEngineRegistry.selectForProfile 选中的 preview 后端。
 */
let channelBtnBound = false;
function setWashAlgoMode(mode, opts) {
    // 强制锁定 preview（最新算法）：任何传参都被归一为 preview，正式服分支不再启用。
    washAlgoMode = 'preview';
    saveWashAlgoMode(washAlgoMode);
    // 联动：原始脉序区域的下拉（已隐藏切换能力，仅同步显示）
    const sel = document.getElementById('washAlgoSelect');
    if (sel) sel.value = washAlgoMode;
    // 联动：存档状态栏的渠道按钮（仅展示当前算法「最新」）
    const btn = document.getElementById('btnChannelSwitch');
    if (btn) {
        btn.textContent = '渠道：最新';
        btn.dataset.mode = washAlgoMode;
    }
    // 切换后端（核心：让全部洗脉功能跟随）
    if (typeof WashEngineRegistry !== 'undefined') WashEngineRegistry.selectForProfile();
    // 清理旧的原始脉序结果，避免误看上一次的数据（导入存档 caller 已自行处理，可保留）
    if (!(opts && opts.keepPulse)) {
        const wrap = document.getElementById('pulseTableWrap');
        const summary = document.getElementById('pulseSummary');
        if (wrap) wrap.hidden = true;
        if (summary) { summary.hidden = true; summary.textContent = ''; }
    }
}

/** 开关 UI 同步（读本地存储 → 写回下拉与状态栏按钮；并挂监听，只挂一次） */
let washAlgoSwitchBound = false;
function syncWashAlgoSwitch() {
    washAlgoMode = loadWashAlgoMode();
    // 同步下拉 + 状态栏按钮 + 选后端（keepPulse 避免初始化/导入时误清空结果）
    setWashAlgoMode(washAlgoMode, { keepPulse: true });
    // 【2026-09-30】正式服入口已隐藏：不再绑定「原始脉序下拉 change」与「状态栏按钮 click」切换事件。
    // 仅保留展示同步（按钮文案已在 setWashAlgoMode 中锁定为「渠道：最新」）。
    // 如需恢复双渠道切换，取消下方两段的注释即可。
    // const sel = document.getElementById('washAlgoSelect');
    // if (sel && !washAlgoSwitchBound) {
    //     washAlgoSwitchBound = true;
    //     sel.addEventListener('change', () => setWashAlgoMode(sel.value));
    // }
    // const btn = document.getElementById('btnChannelSwitch');
    // if (btn && !channelBtnBound) {
    //     channelBtnBound = true;
    //     btn.addEventListener('click', () => setWashAlgoMode(washAlgoMode === 'preview' ? 'official' : 'preview'));
    // }
}
if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', syncWashAlgoSwitch);
} else {
    syncWashAlgoSwitch();
}

/** 根据存档平台/渠道判断是否为先行服/体验服（走新算法） */
function detectPreviewServer() {
    const platform = String(state.savePlatform || '').trim().toLowerCase();
    const channel = String(state.saveChannel || '').trim().toLowerCase();
    if (platform === 'test') return true;
    if (!channel) return false;
    return channel === 'test' || channel === 'ljpre' || channel.includes('pre')
        || channel.includes('体验') || channel.includes('先行') || channel.includes('test');
}

/** 导入存档时按服务器自动选定洗脉算法：当前仅对外暴露「最新」算法，一律锁定 preview。 */
function autoSelectWashAlgoForSave() {
    if (!state.saveData) return;
    // 【2026-09-30】正式服入口已隐藏，导入存档不再区分服务器，永远走最新算法（preview）。
    setWashAlgoMode('preview', { keepPulse: true });
}

/** 当前资质对应的每次洗髓丹耗 / 槽数 */
function pulseZizhiInfo() {
    const zz = ZZ_DATA[String(state.zizhi)] || ZZ_DATA['153'] || {};
    return {
        eat: Math.max(1, Number(zz.eat_xisui) || 3),
        numTalent: Number(zz.num_talent) || 0,
        name: zz.zz_name || zz.name || '',
    };
}

/** 原始脉序的统一「起点」。
 *  口径：只取存档的确定性输入 + 模拟器当前资质（决定槽数），且 固定无脉、无锁。
 *  这样「锁了哪几槽 / 当前有几条脉」在结构上就进不了推演，而不必依赖下游把 kept 算空来丢弃。
 *  来源优先级：导入快照（保持 F14「起点=导入原样」语义）→ 回退当前 state。 */
function pulseStartState() {
    const snap = state.importSnapshot;
    const src = (snap && Object.keys(snap).length) ? snap : state;
    const pick = (a, b) => (a != null ? a : b);
    return {
        // —— 确定性输入（seed 链 / 角色身份 / 权限过滤）——
        seed: Number(src.seed) || 0,
        luck_seed: pick(src.luck_seed, pick(src.luckSeed, null)),
        luck_seed_inited: !!pick(src.luck_seed_inited, src.luckSeedInited),
        born_talent_rc: Number(pick(src.born_talent_rc, src.bornTalentRC)) || 0,
        tal_lucky: Number(pick(src.tal_lucky, src.talLucky)) || 0,
        role_id: Number(pick(src.role_id, src.roleId)) || 0,
        salt: Number(src.salt) || 0,
        sex: Number(src.sex) || 1,
        vip: Number(src.vip) || 0,
        role_level: Number(pick(src.role_level, src.roleLevel)) || 0,
        role_stats: pick(src.role_stats, pick(src.roleStats, {})),
        global_vars: pick(src.global_vars, pick(src.globalVars, {})),
        save_channel: pick(src.save_channel, pick(src.saveChannel, '')),
        // —— 模拟器当前资质：决定槽数 / 丹耗 / 保底 / 可用紫脉池 ——
        zizhi: (state && state.zizhi != null) ? Number(state.zizhi) : Number(src.zizhi),
        mode: pick(src.mode, state.mode),
        // —— 计数归零（起点 = 尚未开始洗）——
        total_wash: 0,
        total_talent_bars: 0,
        total_pills: 0,
        gold_count: 0,
        pity_count: 0,
        exchange_count: 0,
        last_purple_total_pills: null,
        quality_counts: { 1: 0, 2: 0, 3: 0, 4: 0 },
        // —— 关键：一律无脉、无锁 ——
        talents: [],
    };
}

function buildPulseRecord() {
    const wrap = document.getElementById('pulseTableWrap');
    const tbody = document.getElementById('pulseTableBody');
    const hint = document.getElementById('pulseEmptyHint');
    const summary = document.getElementById('pulseSummary');
    if (!wrap || !tbody) {
        alert('页面元素缺失：请按 Ctrl+F5 强制刷新后再试。');
        return;
    }
    if (!state.saveData) {
        alert('请先在首页导入存档，再查看原始脉序。');
        return;
    }
    pulseBuiltOnce = true;

    const { eat, numTalent, name } = pulseZizhiInfo();
    const total = pulsePillsInputValue();

    // —— 0 槽资质（资质平平 num_talent=0）：没有可洗的槽位，如实显示无紫脉 ——
    // 必须在 UI 层短路：registry.makeEngine 内部是 slotCount: Math.max(1, Number(zz.num_talent) || 0)，
    // 若不短路，0 槽会被静默抬成 1 槽并出一张「1 槽脉序」的表，与「选几槽就是几槽」矛盾。
    if (!(numTalent > 0)) {
        pulseRecordTotal = total;
        wrap.hidden = true;
        if (summary) summary.hidden = true;
        if (hint) {
            hint.hidden = false;
            hint.textContent = `${name || '该资质'}（0 槽）：没有可洗的脉槽位，无法推算紫脉。`
                + '请先在模拟器把「资质等级」提升到至少 1 槽。';
        }
        return;
    }

    // —— 推演口径 ——
    // 原始脉序只由「模拟器当前资质等级」决定：选 1 槽按 1 槽推、2 槽按 2 槽……（槽数/丹耗取自 pulseZizhiInfo）。
    // 完全无视锁：起点统一由 pulseStartState() 构造成「无脉、无锁」，
    // 存档里锁了哪几槽、模拟器中锁了哪几槽、当前场上已有几条脉都不参与。
    const costPerWash = eat;

    // —— 后端选择对齐（核心修复点）——
    // 先行服开关打开 → 必须从「导入存档快照」起算 + 走 JS 新算法（WashEngineRegistry.preview 后端）。
    //   若 registry 未加载/未选 preview，明确报错，绝不静默回退 wasm 冒充先行服。
    // 正式服/国际服开关 → 从当前操作状态起算 + 走 wasm（行为保持原样，零改动）。
    const wantPreview = (typeof isPreviewWashAlgo === 'function') ? isPreviewWashAlgo() : false;
    const registryReady = (typeof WashEngineRegistry !== 'undefined')
        && WashEngineRegistry.currentBackend() === 'preview';
    if (wantPreview && !registryReady) {
        wrap.hidden = true;
        if (summary) summary.hidden = true;
        if (hint) {
            hint.hidden = false;
            hint.textContent = '最新洗脉引擎（WashEngineRegistry）未加载或未启用，无法用「新算法」推演原始脉序。'
                + '请按 Ctrl+F5 强制刷新页面；若仍出现，请检查 shared/wash_engine_registry.js 是否正常加载（见控制台资源诊断）。';
        }
        return;
    }
    // preview：起点=导入快照（JS 引擎已把 wash_times 叠加基线 total_talent_bars，故用导入快照的已出紫数作 delta 起点）；
    // 正式服：起点=当前状态已洗次数。
    const previewFromSnapshot = registryReady && !!(state.importSnapshot);
    const startWash = previewFromSnapshot
        ? (Number((state.importSnapshot || {}).totalTalentBars) || 0)
        : (Number(state.totalWash) || 0);
    pulseRecordTotal = total;

    // 不再做「全锁快照守卫」：原始脉序一律以模拟器当前状态为唯一基准——
    // 槽数取「资质等级」下拉（选几槽按几槽），并一律全解锁推演；
    // 存档里角色实际开了几槽、哪些槽锁着都不参与判定，故不存在「全锁无法推演」的情形
    // （preview 路径起点由 pulseStartState() 构造成「无脉、无锁」，wasm 路径同样会先临时解锁再推）。
    // 真实推演异常仍由下方 try/catch 以「推演失败：…」兜底。

    // 引擎的推演窗口单位=洗髓次数；按真实每洗丹耗放大（锁定会拉长窗口），并自适应再推一次。
    const baseWashes = Math.ceil(total / costPerWash);
    const step = Math.max(2, numTalent + 2);
    const horizons = [baseWashes * step + 500, baseWashes * step * 4 + 2000];

    let preview = null;
    let previewErr = '';
    let rawPurples = [];
    let maxWashSeen = 0;
    try {
        for (const horizon of horizons) {
            let res;
            if (previewFromSnapshot) {
                // 显式走 JS 先行服引擎（WashEngineRegistry.preview 后端），不依赖全局 wasm* 覆盖。
                // 起点用 pulseStartState() 显式构造（而非复制快照再改字段）：
                //   · zizhi 取模拟器下拉 → 槽数/丹耗/保底/紫脉池都跟着走（选几槽按几槽）；
                //   · talents 恒为 [] 且无锁 → 「锁/现有脉」在结构上就无法泄漏进推演。
                res = WashEngineRegistry.runPreviewSequence(pulseStartState(), horizon);
            } else {
                // 正式服/国际服：从当前操作状态起算，走 wasm（起点语义保持原样，行为零变化）。
                // 口径同样是「无视锁」：临时把当前槽位全部解锁推给 wasm，推完还原。
                // 用 finally 保证还原（容错：pushStateToWasm() 抛错时也不会把解锁态残留在 state 上）。
                if (typeof pushStateToWasm === 'function') {
                    const saved = (state.talents || []).map(t => t.locked);
                    try {
                        (state.talents || []).forEach(t => { t.locked = false; });
                        pushStateToWasm();
                    } finally {
                        (state.talents || []).forEach((t, i) => { t.locked = saved[i]; });
                    }
                }
                if (typeof wasmPreviewSequence !== 'function') throw new Error('wasmPreviewSequence 未定义');
                res = wasmPreviewSequence(Math.round(horizon));
            }
            preview = res;
            const list = (res && res.purples) || [];
            let deep = 0;
            for (const item of list) {
                const at = Number(item.wash_times);
                if (Number.isFinite(at)) deep = Math.max(deep, at);
            }
            if (deep > maxWashSeen) {
                maxWashSeen = deep;
                rawPurples = list;
            }
            // 已经推演到预算的 90% 之外，说明窗口够大了
            if (rawPurples.length && maxWashSeen * costPerWash >= total * 0.9) break;
        }
    } catch (e) {
        previewErr = (e && e.message) ? e.message : String(e);
    }
    if (previewErr) {
        wrap.hidden = true;
        if (hint) { hint.hidden = false; hint.textContent = '推演失败：' + previewErr; }
        return;
    }

    // 逐条换算。不用 break（引擎返回顺序与洗髓次数不保证一致），
    // 缺失 wash_times 时退回用脉序条数 wash_no 估算。
    const collected = [];
    for (const item of rawPurples) {
        const washTimes = Number(item.wash_times);
        const washNo = Number(item.wash_no);
        if (Number.isFinite(washTimes)) maxWashSeen = Math.max(maxWashSeen, washTimes);
        const at = (Number.isFinite(washTimes) && washTimes > 0) ? washTimes : washNo;
        if (!Number.isFinite(at)) continue;
        const delta = at - startWash;
        if (delta < 0) continue;
        const used = delta * costPerWash;
        if (used > total) continue;
        collected.push({ used, pills: total - used, name: item.talent_name || '' });
    }
    collected.sort((a, b) => a.used - b.used);
    const rows = collected;

    if (!rows.length) {
        wrap.hidden = true;
        if (summary) summary.hidden = true;
        if (hint) {
            hint.hidden = false;
            const shape = Array.isArray(preview)
                ? `数组(${preview.length})`
                : (preview ? (Object.keys(preview).join(',') || '空对象') : String(preview));
            hint.textContent = rawPurples.length
                ? `引擎推演出 ${rawPurples.length} 个紫脉，但在 ${total.toLocaleString()} 丹预算内一个都换不出来，请把这条信息发给作者。`
                : `${total.toLocaleString()} 丹（${numTalent} 槽 · 每次 ${eat} 丹）内没有可推算的紫脉。引擎返回：${shape}`;
        }
        return;
    }

    if (hint) hint.hidden = true;
    wrap.hidden = false;
    if (summary) {
        summary.hidden = false;
        // 明确标注槽数来源（模拟器资质下拉 state.zizhi）与「已忽略锁定」，
        // 让用户一眼确认「原始脉序只看开了几槽、锁不锁无所谓」（F25 诊断/确认）。
        summary.textContent = `按 ${total.toLocaleString()} 丹 · ${name}`
            + `（资质 ${state.zizhi} → ${numTalent} 槽 · 每次 ${costPerWash} 丹 · 已忽略锁定）`
            + ` · 共 ${rows.length} 个紫脉`;
    }
    renderPulseRecord(rows);
}

function renderPulseRecord(rows) {
    const tbody = document.getElementById('pulseTableBody');
    if (!tbody) return;

    const names = [];
    rows.forEach(row => { if (row.name && !names.includes(row.name)) names.push(row.name); });
    names.sort((a, b) => String(a).localeCompare(String(b), 'zh-Hans-CN'));

    tbody.innerHTML = rows.map(row => {
        const list = names.includes(row.name) ? names : [row.name].concat(names);
        const options = list.map(n =>
            `<option value="${escapeAiHtml(n)}"${n === row.name ? ' selected' : ''}>${escapeAiHtml(n)}</option>`
        ).join('');
        return `<tr>`
            + `<td class="pulse-pills-cell"><input type="number" class="pulse-pills" step="1" value="${row.pills}"></td>`
            + `<td class="pulse-talent-cell"><select class="pulse-talent">${options}</select></td>`
            + `<td class="pulse-gap-cell"><span class="pulse-gap">—</span></td>`
            + `</tr>`;
    }).join('');

    updatePulseGaps();
    tbody.querySelectorAll('.pulse-pills').forEach(input =>
        input.addEventListener('input', updatePulseGaps));
}

/** 间隔 = 上一行丹数 − 本行丹数（首行从总丹数起算） */
function updatePulseGaps() {
    const tbody = document.getElementById('pulseTableBody');
    if (!tbody) return;
    const inputs = Array.from(tbody.querySelectorAll('.pulse-pills'));
    const gaps = Array.from(tbody.querySelectorAll('.pulse-gap'));
    let prev = pulseRecordTotal;
    inputs.forEach((input, index) => {
        const value = parseInt(input.value, 10);
        if (gaps[index]) gaps[index].textContent = Number.isFinite(value) ? String(prev - value) : '—';
        if (Number.isFinite(value)) prev = value;
    });
}

function escapeAiHtml(value) {
    return String(value == null ? '' : value)
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#39;');
}

function clampAiNumber(id, min, max, fallback) {
    const el = document.getElementById(id);
    let value = parseInt(el?.value || String(fallback), 10);
    if (Number.isNaN(value)) value = fallback;
    value = Math.max(min, Math.min(max, value));
    if (el) el.value = String(value);
    return value;
}

const AI_COST_BUCKET_LABELS = Object.freeze({
    oneUnlocked: '一脉未锁',
    twoUnlocked: '二脉未锁',
    threeUnlocked: '三脉未锁',
    fourUnlocked: '四脉未锁',
    lock1: '锁 1',
    lock2: '锁 2',
    lock3: '锁 3',
});

function validateAiTargetSet(targetIds, talentData, slotCount = 4) {
    const ids = Array.from(new Set((targetIds || []).map(Number).filter(id => id > 0)));
    const errors = [];
    if (!ids.length) errors.push('请至少选择一条目标紫脉');
    if (ids.length > slotCount) errors.push(`目标脉数量不能超过 ${slotCount} 条`);
    const seenTypes = new Map();
    for (const id of ids) {
        const item = talentData?.[String(id)];
        if (!item) {
            errors.push(`未找到天赋 ID ${id}`);
            continue;
        }
        if (Number(item.pinzhi ?? item.weight) !== 4) errors.push(`「${item.name}」不是紫脉`);
        if (item.type == null) continue;
        const type = String(item.type);
        if (seenTypes.has(type)) {
            errors.push(`「${seenTypes.get(type)}」与「${item.name}」同类型，不能作为最终有效脉同时保留`);
        } else {
            seenTypes.set(type, item.name);
        }
    }
    return { valid: errors.length === 0, errors, ids };
}

function formatAiRouteMarkdown(result, route, rank = 1) {
    if (!route) return '';
    const lines = [
        `# 自动模拟洗脉路线 #${rank}`,
        '',
        `- 结论：${result?.strength || '候选路线'}`,
        `- 目标脉：${result?.targetNames?.join('、') || ''}`,
        `- 路线：${route.branchLabel} · ${route.strategyLabel}`,
        `- 槽位路径：${(route.slotPath || []).join('→')} 槽`,
        `- 总丹耗：${route.totalPills} 颗`,
        `- 总洗髓次数：${route.totalWashes} 次`,
        `- 天赋条数脉序：${route.totalTalentBars} 条`,
        `- 置换：${route.exchangeCount} 次`,
    ];
    if (route.inventory?.available != null) {
        lines.push(`- 背包：${route.inventory.available} 颗；${route.inventory.enough
            ? `执行后剩余 ${route.inventory.remaining} 颗`
            : `还缺 ${route.inventory.shortfall} 颗`}`);
    }
    lines.push('', '## 详细操作', '');
    (route.steps || []).forEach((step, index) => {
        const cost = step.pills > 0 ? `本步 ${step.pills} 丹，累计 ${step.cumulativePills} 丹` : '本步 0 丹';
        const wash = step.washes > 0 ? `，洗 ${step.washes} 次` : '';
        lines.push(`${index + 1}. **${step.label}**：${step.detail}${wash}；${cost}；累计脉序 ${step.cumulativeTalentBars} 条。`);
    });
    lines.push('', `最终槽位：${(route.finalTalents || []).map(item => `${item.name}${item.locked ? '（锁）' : ''}`).join('、')}`);
    return lines.join('\n');
}

function invalidateAiPrediction() {
    if (aiSearchRunning) {
        aiCancelRequested = true;
        stopAiSearchWorker('state-changed');
        aiLastPrediction = null;
        const predict = document.getElementById('btnAiPredict');
        const cancel = document.getElementById('btnAiCancel');
        const results = document.getElementById('aiPredictionResults');
        if (predict) {
            predict.disabled = true;
            predict.textContent = '正在停止当前搜索…';
        }
        if (cancel) {
            cancel.hidden = false;
            cancel.disabled = true;
            cancel.textContent = '正在停止…';
        }
        if (results) {
            results.dataset.hasResult = 'false';
            results.innerHTML = '<div class="ai-result-empty">当前洗脉状态已变化，正在停止当前搜索并恢复状态…</div>';
        }
        return;
    }

    aiSearchToken += 1;
    aiCancelRequested = true;
    aiLastPrediction = null;
    const predict = document.getElementById('btnAiPredict');
    const cancel = document.getElementById('btnAiCancel');
    const progress = document.getElementById('aiSearchProgress');
    if (predict) {
        predict.disabled = false;
        predict.textContent = '开始筛选最佳路线';
    }
    if (cancel) cancel.hidden = true;
    if (progress) progress.hidden = true;
    const results = document.getElementById('aiPredictionResults');
    if (results && results.dataset.hasResult === 'true') {
        results.dataset.hasResult = 'false';
        results.innerHTML = '<div class="ai-result-empty">当前洗脉状态已变化，请重新预测路线。</div>';
    }
}

function getAiAvailablePurpleIds() {
    if (!window.WashSourceEngine || typeof wasmGetState !== 'function') return [];
    pushStateToWasm();
    const original = wasmGetState();
    if (!original) return [];
    const planning = JSON.parse(JSON.stringify(original));
    planning.zizhi = 154;
    planning.role_stats = state.roleStats || {};   // 让 sx_limit 能读到真实根骨等属性
    const engine = new WashSourceEngine.Engine(TALENT_DATA, planning, { dlcMode: state.dlcMode });
    return engine.purpleIds.filter(id => engine.allowed.has(id));
}

function validateAiTargetSelection({ showMessage = true } = {}) {
    const message = document.getElementById('aiSelectionMessage');
    const prerequisiteErrors = [];
    if (isAutoSimulatorView()) {
        if (!state.saveData || !(state.saveRoles || []).length) prerequisiteErrors.push('请选择人物');
        else if (!selectedAutoWashRoleEntry()) prerequisiteErrors.push('请选择人物');
    }
    if (selectedAutoWashRoleEntry() && ![150, 151, 152, 153, 154].includes(Number(state.zizhi))) {
        prerequisiteErrors.push('自动洗脉仅支持 0–4 槽资质');
    }
    if (prerequisiteErrors.length) {
        if (showMessage && message) {
            message.textContent = prerequisiteErrors[0];
            message.classList.add('is-error');
        }
        return { valid: false, errors: prerequisiteErrors, ids: [] };
    }
    if (!window.WashSourceEngine) {
        const error = '源码洗脉状态机未加载';
        if (showMessage && message) {
            message.textContent = error;
            message.classList.add('is-error');
        }
        return { valid: false, errors: [error], ids: [] };
    }
    const result = validateAiTargetSet(aiSelectedTalentIds, TALENT_DATA, 4);
    const unavailable = result.ids.filter(id => !aiAvailableTalentIds.includes(id));
    if (unavailable.length) {
        result.valid = false;
        result.errors.push(`当前角色或四脉资质不可用：${unavailable.map(id => TALENT_DATA[String(id)]?.name || id).join('、')}`);
    }
    if (showMessage && message) {
        message.classList.toggle('is-error', !result.valid);
        message.textContent = result.valid
            ? `将筛选最终同时包含「${result.ids.map(id => TALENT_DATA[String(id)].name).join('、')}」的路线。`
            : (result.errors[0] || '请选择目标紫脉');
    }
    return result;
}

function updateAiTargetChoiceState() {
    const count = document.getElementById('aiTargetCount');
    if (count) count.textContent = `已选 ${aiSelectedTalentIds.length} / 4`;
    document.querySelectorAll('#aiTalentChoices .ai-talent-choice').forEach(label => {
        const id = Number(label.dataset.talentId);
        const checked = aiSelectedTalentIds.includes(id);
        label.classList.toggle('is-selected', checked);
        const input = label.querySelector('input');
        if (input) input.checked = checked;
    });
    validateAiTargetSelection();
}

function filterAiTalentChoices() {
    const keyword = (document.getElementById('aiTalentSearch')?.value || '').trim().toLowerCase();
    document.querySelectorAll('#aiTalentChoices .ai-talent-choice').forEach(label => {
        const name = (label.dataset.talentName || '').toLowerCase();
        label.classList.toggle('is-hidden', !!keyword && !name.includes(keyword));
    });
}

function renderAiTalentChoices() {
    const container = document.getElementById('aiTalentChoices');
    if (!container || !wasmReady) return;
    if (isAutoSimulatorView() && !selectedAutoWashRoleEntry()) {
        aiAvailableTalentIds = [];
        aiSelectedTalentIds = [];
        container.innerHTML = '<span class="text-muted">选择人物后，才会显示该人物可用的目标紫脉。</span>';
        updateAiTargetChoiceState();
        return;
    }
    aiAvailableTalentIds = getAiAvailablePurpleIds().sort((a, b) => {
        const an = TALENT_DATA[String(a)]?.name || '';
        const bn = TALENT_DATA[String(b)]?.name || '';
        return an.localeCompare(bn, 'zh-CN');
    });
    aiSelectedTalentIds = aiSelectedTalentIds.filter(id => aiAvailableTalentIds.includes(id));
    if (!aiAvailableTalentIds.length) {
        container.innerHTML = '<span class="text-muted">当前角色状态下没有可选紫脉，请检查资质、角色条件和 VIP。</span>';
        updateAiTargetChoiceState();
        return;
    }
    container.innerHTML = aiAvailableTalentIds.map(id => {
        const name = TALENT_DATA[String(id)]?.name || `天赋 #${id}`;
        return `<label class="ai-talent-choice" data-talent-id="${id}" data-talent-name="${escapeAiHtml(name)}">
            <input type="checkbox" value="${id}">
            <span>${escapeAiHtml(name)}</span>
        </label>`;
    }).join('');
    container.querySelectorAll('.ai-talent-choice').forEach(label => {
        label.addEventListener('click', event => {
            event.preventDefault();
            if (aiSearchRunning) {
                const message = document.getElementById('aiSelectionMessage');
                if (message) {
                    message.textContent = '路线搜索进行中；如需修改目标，请先取消搜索。';
                    message.classList.add('is-error');
                }
                return;
            }
            const id = Number(label.dataset.talentId);
            const index = aiSelectedTalentIds.indexOf(id);
            if (index >= 0) {
                aiSelectedTalentIds.splice(index, 1);
            } else if (aiSelectedTalentIds.length >= 4) {
                const message = document.getElementById('aiSelectionMessage');
                if (message) {
                    message.textContent = '最终最多只能选择 4 条目标脉。';
                    message.classList.add('is-error');
                }
                return;
            } else {
                aiSelectedTalentIds.push(id);
            }
            aiLastPrediction = null;
            const results = document.getElementById('aiPredictionResults');
            if (results) {
                results.dataset.hasResult = 'false';
                results.innerHTML = '<div class="ai-result-empty">目标已更新，点击“开始筛选最佳路线”。</div>';
            }
            updateAiTargetChoiceState();
        });
    });
    updateAiTargetChoiceState();
    filterAiTalentChoices();
}

function aiProgressPercent(progress) {
    if (progress.phase === 'complete') return 100;
    if (progress.phase === 'bounded-search') {
        const ceiling = Math.max(1, Number(progress.activePillCeiling || progress.maxTotalPills || 1));
        return Math.max(3, Math.min(96, Math.round(Number(progress.currentPillCost || 0) / ceiling * 96)));
    }
    return 0;
}

function renderAiSearchProgress(progress) {
    const box = document.getElementById('aiSearchProgress');
    const text = document.getElementById('aiProgressText');
    const percent = document.getElementById('aiProgressPercent');
    const fill = document.getElementById('aiProgressFill');
    const rawValue = aiProgressPercent(progress || {});
    if (box && progress?.phase === 'worker-start') {
        box.dataset.progressValue = '0';
    }
    const previousValue = Number(box?.dataset.progressValue || 0);
    const value = progress?.phase === 'complete' ? 100 : Math.max(previousValue, rawValue);
    if (box) {
        box.hidden = false;
        box.dataset.progressValue = String(value);
    }
    if (text) text.textContent = progress?.message || '正在搜索…';
    if (percent) percent.textContent = progress?.phase === 'worker-start'
        ? '后台线程'
        : (progress?.phase === 'bounded-search'
            ? `当前分支 ${Number(progress.currentPillCost || 0).toLocaleString()} / ${Number(progress.activePillCeiling || progress.maxTotalPills || 0).toLocaleString()} 丹 · 关键事件 ${Number(progress.expandedNodes || 0).toLocaleString()} · 模拟洗脉 ${Number(progress.rawWashesSimulated || 0).toLocaleString()}`
            : (progress?.phase === 'complete' ? '完成' : '正在初始化'));
    if (fill) fill.style.width = `${value}%`;
}

function aiCostBreakdownHtml(route) {
    const labels = AI_COST_BUCKET_LABELS;
    const entries = Object.entries(route.costBreakdown || {}).filter(([, value]) => Number(value) > 0);
    if (!entries.length) return '<div class="ai-result-empty">本路线不需要消耗洗髓丹</div>';
    const total = Math.max(1, Number(route.totalPills) || 1);
    const segments = entries.map(([key, value]) => {
        const width = Math.max(4, Number(value) / total * 100);
        return `<div class="ai-cost-segment" style="flex-basis:${width}%" title="${escapeAiHtml(labels[key] || key)}：${Number(value).toLocaleString()} 丹">
            ${escapeAiHtml(labels[key] || key)} ${Number(value).toLocaleString()}
        </div>`;
    }).join('');
    const legend = entries.map(([key, value]) => `<span>${escapeAiHtml(labels[key] || key)}：<b>${Number(value).toLocaleString()}</b> 丹</span>`).join('');
    return `<div class="ai-cost-bar" role="img" aria-label="丹耗分解：${escapeAiHtml(entries.map(([key, value]) => `${labels[key] || key}${value}丹`).join('，'))}">${segments}</div>
        <div class="ai-cost-legend">${legend}<span>开四脉 / 置换：<b>0</b> 丹</span></div>`;
}

function aiRouteTimelineHtml(route) {
    return `<div class="ai-route-timeline" role="list" aria-label="路线操作时间轴">${(route.steps || []).map((step, index) => {
        const detail = step.washes > 0
            ? `洗 ${step.washes} 次 · 本步 ${step.pills} 丹`
            : `本步 ${step.pills} 丹`;
        return `<div class="ai-route-step-node is-${escapeAiHtml(step.type)}" role="listitem">
            <b>${index + 1}. ${escapeAiHtml(step.label)}</b>
            <span>${escapeAiHtml(detail)}</span>
            <span class="ai-route-step-cost">累计 ${Number(step.cumulativePills).toLocaleString()} 丹</span>
        </div>`;
    }).join('')}</div>`;
}

function aiOperationTableHtml(route) {
    const rows = (route.steps || []).map((step, index) => {
        const afterNames = (step.after?.talents || []).map(t => `${t.name}${t.locked ? '（锁）' : ''}`).join('、');
        const verify = step.type === 'verify' ? '最终目标已回放验证' : (step.expectedName ? `应出现「${step.expectedName}」` : afterNames);
        return `<tr>
            <td>${index + 1}</td>
            <td><b>${escapeAiHtml(step.label)}</b></td>
            <td>${escapeAiHtml(step.detail)}</td>
            <td>${Number(step.washes).toLocaleString()}</td>
            <td>${step.unitCost == null ? '—' : Number(step.unitCost).toLocaleString()}</td>
            <td>${Number(step.pills).toLocaleString()}</td>
            <td>${Number(step.cumulativePills).toLocaleString()}</td>
            <td>${Number(step.cumulativeWashes).toLocaleString()}</td>
            <td>${Number(step.cumulativeTalentBars).toLocaleString()}</td>
            <td class="ai-operation-verify">${escapeAiHtml(verify || '状态已记录')}</td>
        </tr>`;
    }).join('');
    return `<div class="ai-operation-wrap"><table class="ai-operation-table">
        <thead><tr><th>#</th><th>操作</th><th>玩家照做步骤</th><th>洗数</th><th>单次丹</th><th>本步丹</th><th>累计丹</th><th>累计洗</th><th>脉序(条)</th><th>操作后验证</th></tr></thead>
        <tbody>${rows}</tbody>
    </table></div>`;
}

function aiRouteResultHtml(route, index) {
    const inventory = route.inventory || {};
    const inventoryLabel = inventory.available == null
        ? '库存未读取'
        : (inventory.enough ? `余 ${Number(inventory.remaining).toLocaleString()} 丹` : `缺 ${Number(inventory.shortfall).toLocaleString()} 丹`);
    const upgradeLabel = Array.isArray(route.slotPath) && route.slotPath.length
        ? `${route.slotPath.join('→')} 槽`
        : '保持当前槽位';
    const finalNames = (route.finalTalents || []).map(item => `${item.name}${item.locked ? '（锁）' : ''}`).join('、');
    return `<details class="ai-route-result" ${index === 0 ? 'open' : ''}>
        <summary>
            <span class="ai-route-rank">${index + 1}</span>
            <span class="ai-route-name"><b>${escapeAiHtml(route.branchLabel)} · ${escapeAiHtml(route.strategyLabel)}</b><span>${escapeAiHtml(finalNames)}</span></span>
            <span class="ai-route-total">${Number(route.totalPills).toLocaleString()} 丹<small>${Number(route.totalWashes).toLocaleString()} 次洗脉</small></span>
        </summary>
        <div class="ai-route-body">
            <div class="ai-route-metrics">
                <div class="ai-route-metric"><b>${Number(route.totalPills).toLocaleString()}</b><span>总丹耗</span></div>
                <div class="ai-route-metric"><b>${Number(route.totalWashes).toLocaleString()}</b><span>洗髓次数</span></div>
                <div class="ai-route-metric"><b>${Number(route.totalTalentBars).toLocaleString()}</b><span>天赋条数脉序</span></div>
                <div class="ai-route-metric"><b>${Number(route.exchangeCount).toLocaleString()}</b><span>置换次数</span></div>
                <div class="ai-route-metric ${inventory.enough === false ? 'is-short' : ''}"><b>${escapeAiHtml(inventoryLabel)}</b><span>背包可执行性</span></div>
            </div>
            <p class="ai-visual-heading">路线图 · ${escapeAiHtml(upgradeLabel)}</p>
            ${aiRouteTimelineHtml(route)}
            <p class="ai-visual-heading">洗髓丹消耗分解 · 合计 ${Number(route.totalPills).toLocaleString()} 丹</p>
            ${aiCostBreakdownHtml(route)}
            <p class="ai-visual-heading">详细路线与操作</p>
            ${aiOperationTableHtml(route)}
            <div class="ai-route-footer">
                <span class="ai-final-talents">最终槽位：${escapeAiHtml(finalNames)}</span>
                <button type="button" class="btn btn-reset ai-copy-route" data-route-index="${index}">复制 Markdown 路线</button>
            </div>
        </div>
    </details>`;
}

function renderAiPrediction(result) {
    const container = document.getElementById('aiPredictionResults');
    if (!container) return;
    aiLastPrediction = result;
    container.dataset.hasResult = 'true';
    if (!result || !result.routes || !result.routes.length) {
        container.innerHTML = `<div class="ai-result-error">${escapeAiHtml(result?.noResultReason || '搜索范围内没有找到可回放路线，请扩大范围或调整目标脉。')}</div>`;
        return;
    }
    const maxPills = Math.max(...result.routes.map(route => Number(route.totalPills) || 0), 1);
    const comparison = result.routes.map((route, index) => `<div class="ai-compare-row">
        <span>路线 ${index + 1}</span>
        <span class="ai-compare-track"><span class="ai-compare-bar" style="display:block;width:${Math.max(2, route.totalPills / maxPills * 100)}%"></span></span>
        <span class="ai-compare-value">${Number(route.totalPills).toLocaleString()} 丹</span>
    </div>`).join('');
    const scope = result.searchScope || {};
    container.innerHTML = `<div class="ai-result-summary">
        <span class="ai-route-strength">${escapeAiHtml(result.strength)}</span>
        <span>目标：<strong>${escapeAiHtml((result.targetNames || []).join('、'))}</strong></span>
        <span>关键事件 A*：展开 <strong>${Number(scope.expandedNodes || 0).toLocaleString()}</strong> · 模拟洗脉 <strong>${Number(scope.rawWashesSimulated || 0).toLocaleString()}</strong> · 生成事件 <strong>${Number(scope.generatedNodes || 0).toLocaleString()}</strong></span>
        <span>队列峰值 <strong>${Number(scope.frontierPeak || 0).toLocaleString()}</strong> / ${Number(scope.frontierLimit || 0).toLocaleString()} · 权重剪枝 <strong>${Number(scope.prunedByFrontier || 0).toLocaleString()}</strong> · 支配剪枝 <strong>${Number(scope.dominatedNodes || 0).toLocaleString()}</strong></span>
        <span>冲突入口 <strong>${Number(scope.conflictAnchors || 0).toLocaleString()}</strong> · 目标暂时置换 <strong>${Number(scope.targetSacrificeBranches || 0).toLocaleString()}</strong> 个 · 首次置换垫洗 <strong>${Number(scope.firstExchangePadsChecked || 0).toLocaleString()}</strong> 个</span>
        <span>丹耗超限剪枝 <strong>${Number(scope.prunedByPills || 0).toLocaleString()}</strong> 个</span>
        <span>整条路线 ≤ ${Number(scope.maxTotalPills || 0).toLocaleString()} 丹 · 找到路线后继续搜索更低丹耗分支</span>
        ${scope.initialLuckSeedInited ? '<span>欧气种子已初始化：首次置换垫洗不会改变既有序列</span>' : ''}
        <span>结论仅覆盖：${escapeAiHtml(scope.strategyGraph || '固定四槽战术动作图')}</span>
    </div>
    <div class="ai-route-comparison" role="img" aria-label="前三条路线总丹耗对比">
        <h3>候选路线总丹耗对比</h3>${comparison}
    </div>
    ${result.routes.map(aiRouteResultHtml).join('')}`;

    container.querySelectorAll('.ai-copy-route').forEach(button => {
        button.addEventListener('click', async () => {
            const index = Number(button.dataset.routeIndex);
            const route = result.routes[index];
            const markdown = formatAiRouteMarkdown(result, route, index + 1);
            try {
                if (navigator.clipboard?.writeText) {
                    await navigator.clipboard.writeText(markdown);
                } else {
                    const textarea = document.createElement('textarea');
                    textarea.value = markdown;
                    textarea.style.position = 'fixed';
                    textarea.style.opacity = '0';
                    document.body.appendChild(textarea);
                    textarea.select();
                    document.execCommand('copy');
                    textarea.remove();
                }
                button.textContent = '已复制';
                setTimeout(() => { button.textContent = '复制 Markdown 路线'; }, 1600);
            } catch (error) {
                alert('复制失败，请展开详细操作后手动复制。');
            }
        });
    });
}

async function runAiPrediction() {
    if (aiSearchRunning) return;
    const validation = validateAiTargetSelection();
    if (!validation.valid) return;

    aiCancelRequested = false;
    aiSearchRunning = true;
    const runToken = ++aiSearchToken;
    const predict = document.getElementById('btnAiPredict');
    const cancel = document.getElementById('btnAiCancel');
    const results = document.getElementById('aiPredictionResults');
    if (predict) {
        predict.disabled = true;
        predict.textContent = '正在筛选路线…';
    }
    if (cancel) {
        cancel.hidden = false;
        cancel.disabled = false;
        cancel.textContent = '取消搜索';
    }
    if (results) {
        results.dataset.hasResult = 'false';
        results.innerHTML = '<div class="ai-result-empty">后台线程正在搜索并回放候选路线；计算期间页面可以正常滚动和操作。</div>';
    }
    renderAiSearchProgress({ phase: 'worker-start', done: 0, total: 1, message: '正在保存当前状态并建立固定四槽搜索副本' });

    pushStateToWasm();
    const initialState = wasmGetState();
    // 状态机需要角色根骨来判定 sx_limit(如天赋 239 五蕴皆空要求 Con ≥ 60,移植自 v2.1.6)
    if (initialState && state.roleRaw) {
        initialState.con = Number(state.roleRaw.Con) || 0;
    }
    // wasm 的 state 结构里没有 save_channel / born_talent_rc —— set_state 收下,
    // get_state 不回吐(实测 get_state 只返回 32 个键,这两个不在其中;字段表见
    // wasm_data.js 内嵌 wasm 里的 serde 串)。而洗脉状态机正是靠它们决定
    // 「盐值要不要加 bornRC 偏移、偏移从几开始」:两个都丢了的话
    // international 恒为 false 且 bornRC 恒为 0,整条脉序从第一抽就歪。
    // 和上面的 con 一样,在 JS 侧补回去(wasm 不认识这两个键,补了不会影响它)。
    // ——移植自「观星-洗脉修正」的 runAiPrediction,这是 B 侧脉序不准的直接原因。
    if (initialState) {
        initialState.save_channel = state.saveChannel || '';
        initialState.born_talent_rc = Number(state.bornTalentRC) || 0;
    }
    const eligibleTalentIds = typeof isInternationalSave === 'function' && isInternationalSave(state)
        ? (wasmGetAvailableTalents() || []).map(item => Number(item && typeof item === 'object' ? item.id : item)).filter(id => id > 0)
        : null;
    try {
        const result = await startAiSearchWorker({
            initialState,
            targetIds: validation.ids,
            dlcMode: state.dlcMode,
            eligibleTalentIds,
            bagPills: state.bagPills,
            hasBagPills: state.hasBagPills,
            options: {
                maxTotalPills: clampAiNumber('aiMaxTotalPills', 0, 100000, 3000),
            },
        }, progress => {
            if (runToken === aiSearchToken) renderAiSearchProgress(progress);
        }, candidate => {
            if (runToken !== aiSearchToken) return;
            renderAiPrediction(candidate);
        });
        if (runToken !== aiSearchToken) return;
        if (result.cancelled) {
            if (results && result.reason !== 'state-changed' && !(aiLastPrediction?.routes || []).length) {
                results.innerHTML = '<div class="ai-result-empty">搜索已取消，当前模拟状态未改变。</div>';
            }
            if ((aiLastPrediction?.routes || []).length) {
                renderAiSearchProgress({ phase: 'complete', done: 1, total: 1, message: '已停止继续搜索，保留当前最低候选路线' });
            }
            return;
        }
        renderAiSearchProgress({ phase: 'complete', done: 1, total: 1, message: '关键事件加权 A* 搜索完成' });
        renderAiPrediction(result);
    } catch (error) {
        console.error('自动模拟洗脉路线失败:', error);
        if (runToken === aiSearchToken && results) {
            results.dataset.hasResult = 'true';
            results.innerHTML = `<div class="ai-result-error">预测失败：${escapeAiHtml(error?.message || error)}</div>`;
        }
    } finally {
        pushStateToWasm();
        if (runToken === aiSearchToken) {
            aiSearchRunning = false;
            if (predict) {
                predict.disabled = false;
                predict.textContent = '重新筛选最佳路线';
            }
            if (cancel) cancel.hidden = true;
        }
    }
}

function cancelAiPrediction() {
    if (!aiSearchRunning) return;
    aiCancelRequested = true;
    stopAiSearchWorker('user');
    const cancel = document.getElementById('btnAiCancel');
    const text = document.getElementById('aiProgressText');
    if (cancel) {
        cancel.disabled = true;
        cancel.textContent = '正在停止…';
    }
    if (text) text.textContent = '后台计算线程已终止，正在恢复界面…';
}

const EQUIP_AUTO_ALLOWED_PAPER_IDS = new Set(
    typeof EquipmentAutoOptimizer !== 'undefined' ? EquipmentAutoOptimizer.AUTO_PAPER_IDS : [],
);
const EQUIP_AUTO_PROPERTY_LABELS = Object.freeze({ hp_add: '气血' });
const EQUIP_AUTO_LOCATION_WHITELIST = Object.freeze({
    blacksmith: [40520, 40800, 30430, 30200, 52007],
    embroidery: [31230, 35902, 30480, 30210],
});
const EQUIP_AUTO_RESULT_PAGE_SIZES = Object.freeze([10, 30, 50, 100]);
let autoSimulatorMode = 'equip';
let equipAutoSelectedLocations = new Set();
let equipAutoLocationFilter = 'blacksmith';
let equipAutoPaperConfigs = new Map();
let equipAutoSelectedProperties = new Set();
let equipAutoRunning = false;
let equipAutoCancelRequested = false;
let equipAutoRunToken = 0;
let equipAutoLastResult = null;
let equipAutoResultPage = 1;
let equipAutoResultPageSize = 30;
let equipAutoResultLocationFilter = '';
let equipAutoResultPaperFilter = '';
let equipAutoResultQualityFilter = '';
let equipAutoResultAttachFilter = '';
let equipAutoResultAttachOnly = false;
let equipAutoManualAttachStates = new Map();
let jianwangAutoRunning = false;
let jianwangAutoCancelRequested = false;
let jianwangAutoRunToken = 0;
let jianwangAutoSwords = [];
let jianwangAutoLastResult = null;
let jianwangAutoResultPage = 1;
const JIANWANG_AUTO_RESULT_PAGE_SIZE = 10;

function setAutoSimulatorMode(mode) {
    autoSimulatorMode = mode === 'jianwang' ? 'jianwang' : mode === 'wash' ? 'wash' : 'equip';
    const isEquip = autoSimulatorMode === 'equip';
    const isJianwang = autoSimulatorMode === 'jianwang';
    const isWash = autoSimulatorMode === 'wash';
    const equipButton = document.getElementById('btnAutoEquipMode');
    const jianwangButton = document.getElementById('btnAutoJianwangMode');
    const washButton = document.getElementById('btnAutoWashMode');
    const equipPanel = document.getElementById('autoEquipModePanel');
    const jianwangPanel = document.getElementById('autoJianwangModePanel');
    const washPanel = document.getElementById('autoWashModePanel');
    const title = document.getElementById('aiPredictionTitle');
    const intro = document.querySelector('#aiPredictionPanel > .ai-prediction-intro');
    [[equipButton, isEquip], [jianwangButton, isJianwang], [washButton, isWash]].forEach(([button, active]) => {
        if (!button) return;
        button.classList.toggle('is-active', active);
        button.setAttribute('aria-selected', String(active));
    });
    if (equipPanel) equipPanel.hidden = !isEquip;
    if (jianwangPanel) jianwangPanel.hidden = !isJianwang;
    if (washPanel) washPanel.hidden = !isWash;
    if (title) {
        title.textContent = isEquip ? '自动模拟 · 装备批量预测' : isJianwang ? '自动模拟 · 剑王阁同词条' : '自动模拟 · 洗脉路线';
    }
    if (intro) {
        intro.textContent = isEquip
            ? '选择地点、图纸、属性和首次打造材料。系统将每个材料分支从同一份存档快照独立起跑，筛选紫装并分析精炼；后续芒晶洗练在单件装备详情中手动模拟。'
            : isJianwang
                ? '选择存档中的起始剑、90级镇派路线和一个目标词条，可筛选词条2/3/4相同或任意3个词条相同。系统会自动保留已有目标词条，并搜索符合条件的成品。'
                : '从原始紫锚点和目标紫脉开始搜索可执行路线，按实际背包丹数显示每一步完成后的剩余数量。';
    }
    const kicker = document.querySelector('#aiPredictionPanel .ai-kicker');
    if (kicker) kicker.textContent = isEquip ? 'LOCAL EQUIPMENT OPTIMIZER' : isJianwang ? 'LOCAL JIANWANG OPTIMIZER' : 'LOCAL WASH ROUTE PLANNER';
    if (isJianwang) refreshJianwangAutoSwords(true);
}

function invalidateEquipAutoPrediction(message) {
    equipAutoLastResult = null;
    equipAutoResultPage = 1;
    equipAutoResultLocationFilter = '';
    equipAutoResultPaperFilter = '';
    equipAutoResultQualityFilter = '';
    equipAutoResultAttachFilter = '';
    equipAutoManualAttachStates = new Map();
    if (equipAutoRunning) equipAutoCancelRequested = true;
    const results = document.getElementById('autoEquipResults');
    if (results) {
        results.dataset.hasResult = 'false';
        results.innerHTML = `<div class="ai-result-empty">${escapeAiHtml(message || '配置已变化，请重新开始装备自动模拟。')}</div>`;
    }
    if (!equipAutoRunning) {
        const progress = document.getElementById('autoEquipProgress');
        if (progress) progress.hidden = true;
    }
}

function extractEquipMakeRnd(saveData) {
    if (!saveData) return null;
    const makeRnd = saveData.MakeRnd
        || (Array.isArray(saveData) && saveData[0] && saveData[0].MakeRnd)
        || ((saveData.Seeds || saveData.LuckySeeds) ? saveData : null);
    if (!makeRnd) return null;
    return {
        Seeds: makeRnd.Seeds || {},
        LuckySeeds: makeRnd.LuckySeeds || {},
        IDSeeds: makeRnd.IDSeeds || {},
        MakeLucky: makeRnd.MakeLucky || {},
    };
}

function selectedEquipAutoLocationIds() {
    return Array.from(equipAutoSelectedLocations).map(Number).filter(Number.isFinite);
}

function equipAutoAvailablePaperMap() {
    const map = new Map();
    if (typeof EquipmentAutoOptimizer === 'undefined' || typeof EQUIP_DATA === 'undefined') return map;
    selectedEquipAutoLocationIds().forEach(npcId => {
        EquipmentAutoOptimizer.papersForCraftsman(EQUIP_DATA, npcId).forEach(item => {
            if (!EQUIP_AUTO_ALLOWED_PAPER_IDS.has(Number(item.paper.id))) return;
            const minColor = Number(item.paper.min_color || 1);
            const maxColor = Number(item.paper.max_color || 4);
            if (Number(item.equip.lv || 0) < 90 || minColor > 4 || maxColor < 4) return;
            const key = String(item.paper.id);
            const entry = map.get(key) || { ...item, npcIds: [] };
            entry.npcIds.push(npcId);
            map.set(key, entry);
        });
    });
    return map;
}

function renderEquipAutoLocations() {
    const container = document.getElementById('autoEquipLocationChoices');
    if (!container || typeof EquipmentAutoOptimizer === 'undefined' || typeof EQUIP_DATA === 'undefined') return;
    const craftsmen = EquipmentAutoOptimizer.sortedCraftsmen(EQUIP_DATA);
    let visible = craftsmen;
    if (equipAutoLocationFilter === 'blacksmith') {
        visible = craftsmen.filter(craftsman => EQUIP_AUTO_LOCATION_WHITELIST.blacksmith.includes(Number(craftsman.id)));
    } else if (equipAutoLocationFilter === 'embroidery') {
        visible = craftsmen.filter(craftsman => EQUIP_AUTO_LOCATION_WHITELIST.embroidery.includes(Number(craftsman.id)));
    }
    // 精简视图按白名单数组顺序排列
    if (equipAutoLocationFilter === 'blacksmith' || equipAutoLocationFilter === 'embroidery') {
        const order = EQUIP_AUTO_LOCATION_WHITELIST[equipAutoLocationFilter];
        const orderMap = new Map(order.map((id, index) => [id, index]));
        visible.sort((a, b) => (orderMap.get(Number(a.id)) ?? Infinity) - (orderMap.get(Number(b.id)) ?? Infinity));
    }
    // 'all' 不裁剪，保留旧的全部地点
    if (!visible.length) {
        container.innerHTML = '<span class="text-muted">当前分类下没有可用打造地点</span>';
    } else {
        container.innerHTML = visible.map(craftsman => {
            const id = Number(craftsman.id);
            const selected = equipAutoSelectedLocations.has(id);
            const label = `${craftsman.place || craftsman.name} · ${craftsman.name}`;
            return `<label class="equip-auto-choice ${selected ? 'is-selected' : ''}" data-location-id="${id}">
                <input type="checkbox" value="${id}" ${selected ? 'checked' : ''}>
                <span>${escapeAiHtml(label)}（${craftsman.zhi === 'fengzhi' ? '绣' : '铁'}）</span>
            </label>`;
        }).join('');
    }
    const count = document.getElementById('autoEquipLocationCount');
    if (count) count.textContent = `已选 ${equipAutoSelectedLocations.size}`;
    const filterSelect = document.getElementById('autoEquipLocationFilter');
    if (filterSelect && filterSelect.value !== equipAutoLocationFilter) filterSelect.value = equipAutoLocationFilter;
}

function handleEquipAutoLocationFilterChange(event) {
    equipAutoLocationFilter = event.target.value;
    renderEquipAutoLocations();
}

function equipAutoAttachPickerHtml(equip, selectedIds) {
    const materials = EquipmentAutoOptimizer.specialMaterialsForEquip(EQUIP_DATA, equip);
    const selectedSet = new Set((selectedIds || []).map(Number));
    const buttons = materials.map(material => {
        const selected = selectedSet.has(Number(material.id));
        const action = selected ? 'remove' : 'add';
        const state = selected ? '已选' : '选择';
        return `<button class="equip-auto-attach-option ${selected ? 'is-selected' : 'is-available'}" type="button" data-attach-action="${action}" data-material-id="${material.id}" aria-pressed="${selected}" aria-label="${state}附加材料 ${escapeAiHtml(material.name)}">
            <span>${escapeAiHtml(material.name)}</span><small>${state}</small>
        </button>`;
    }).join('');
    return `<div class="equip-auto-attach-field">
        <span class="equip-auto-field-label">首次打造附加材料（可多选，分别计算）</span>
        <div class="equip-auto-attach-picker" role="group" aria-label="首次打造附加材料多选">
            <div class="equip-auto-attach-options">${buttons || '<span class="equip-auto-attach-empty">当前装备没有可用附加材料</span>'}</div>
        </div>
    </div>`;
}

function updateEquipAutoAttachMaterialSelection(config, materialId, shouldSelect) {
    if (!config) return false;
    const id = Number(materialId);
    if (!Number.isFinite(id) || id <= 0) return false;
    const current = Array.from(new Set((config.craftMaterialIds || []).map(Number).filter(value => value > 0)));
    const exists = current.includes(id);
    if (shouldSelect && !exists) current.push(id);
    if (!shouldSelect && exists) current.splice(current.indexOf(id), 1);
    config.craftMaterialIds = current;
    return shouldSelect ? !exists : exists;
}

function renderEquipAutoPapers() {
    const container = document.getElementById('autoEquipPaperChoices');
    if (!container) return;
    const available = equipAutoAvailablePaperMap();
    for (const paperId of Array.from(equipAutoPaperConfigs.keys())) {
        if (!available.has(String(paperId))) equipAutoPaperConfigs.delete(String(paperId));
    }
    if (!available.size) {
        container.innerHTML = '<span class="text-muted">先选择至少一个打造地点；这里只显示可出紫且可升炼/精炼的 90～100 级图纸。</span>';
        const count = document.getElementById('autoEquipPaperCount');
        if (count) count.textContent = '已选 0';
        return;
    }
    const rows = Array.from(available.values()).sort((a, b) => (Number(b.equip.lv) - Number(a.equip.lv))
        || String(a.equip.name).localeCompare(String(b.equip.name), 'zh'));
    container.innerHTML = rows.map(item => {
        const paperId = String(item.paper.id);
        const config = equipAutoPaperConfigs.get(paperId);
        const selected = !!config;
        const attachIds = config && config.craftMaterialIds || [];
        const supportedProps = EquipmentAutoOptimizer.supportedTargetProperties(item.equip, EQUIP_DATA, EquipmentAutoOptimizer.TARGET_PROPERTIES);
        const compatibleSelected = supportedProps.filter(prop => equipAutoSelectedProperties.has(prop));
        const isIncompatible = equipAutoSelectedProperties.size > 0 && compatibleSelected.length === 0;
        const supportedLabels = supportedProps.map(equipAutoPropertyLabel).join('、');
        return `<div class="equip-auto-paper-card ${selected ? 'is-selected' : ''} ${isIncompatible ? 'is-incompatible' : ''}" data-paper-id="${paperId}" data-search="${escapeAiHtml(`${item.equip.name} ${item.paper.name}`.toLowerCase())}">
            <label class="equip-auto-paper-check">
                <input class="equip-auto-paper-toggle" type="checkbox" value="${paperId}" ${selected ? 'checked' : ''}>
                <strong>${escapeAiHtml(item.equip.name)} · ${Number(item.equip.lv)}级${item.equip.lv === 90 ? '（自动升炼）' : ''}</strong>
                <span>${escapeAiHtml(item.paper.name)} · ${escapeAiHtml(EQUIP_DATA.typeNames[String(item.equip.type)] || item.equip.type)} · 可在 ${item.npcIds.length} 个已选地点打造</span>
                <span class="equip-auto-paper-props">可精炼：${escapeAiHtml(supportedLabels || '无目标属性')}${isIncompatible ? ' · 与当前选择不兼容，将跳过' : ''}</span>
            </label>
            <div class="equip-auto-paper-config" ${selected ? '' : 'hidden'}>
                ${equipAutoAttachPickerHtml(item.equip, attachIds)}
            </div>
        </div>`;
    }).join('');
    filterEquipAutoPapers();
    const count = document.getElementById('autoEquipPaperCount');
    if (count) count.textContent = `已选 ${equipAutoPaperConfigs.size}`;
}

function filterEquipAutoPapers() {
    const query = String(document.getElementById('autoEquipPaperSearch')?.value || '').trim().toLowerCase();
    document.querySelectorAll('#autoEquipPaperChoices .equip-auto-paper-card').forEach(card => {
        card.classList.toggle('is-hidden', !!query && !String(card.dataset.search || '').includes(query));
    });
}

function renderEquipAutoProperties() {
    const container = document.getElementById('autoEquipPropertyChoices');
    if (!container || typeof EquipmentAutoOptimizer === 'undefined' || typeof EQUIP_DATA === 'undefined') return;
    container.innerHTML = EquipmentAutoOptimizer.TARGET_PROPERTIES.map(prop => {
        const selected = equipAutoSelectedProperties.has(prop);
        return `<label class="equip-auto-choice ${selected ? 'is-selected' : ''}" data-property="${prop}">
            <input type="checkbox" value="${prop}" ${selected ? 'checked' : ''}>
            <span>${escapeAiHtml(equipAutoPropertyLabel(prop))}</span>
        </label>`;
    }).join('');
    const count = document.getElementById('autoEquipPropertyCount');
    if (count) count.textContent = `已选 ${equipAutoSelectedProperties.size}`;
}

function initializeEquipAutoControls() {
    if (typeof EquipmentAutoOptimizer === 'undefined' || typeof EQUIP_DATA === 'undefined') return;
    const filterSelect = document.getElementById('autoEquipLocationFilter');
    if (filterSelect) {
        filterSelect.value = equipAutoLocationFilter;
        filterSelect.addEventListener('change', handleEquipAutoLocationFilterChange);
    }
    renderEquipAutoLocations();
    renderEquipAutoPapers();
    renderEquipAutoProperties();
}

function handleEquipAutoLocationClick(event) {
    if (!event.target.matches('input[type="checkbox"]')) return;
    const label = event.target.closest('.equip-auto-choice[data-location-id]');
    if (!label) return;
    const id = Number(label.dataset.locationId);
    const checkbox = event.target;
    if (checkbox.checked) equipAutoSelectedLocations.add(id);
    else equipAutoSelectedLocations.delete(id);
    renderEquipAutoLocations();
    renderEquipAutoPapers();
    invalidateEquipAutoPrediction('地点已变化，请重新开始装备自动模拟。');
}

function handleEquipAutoPaperChange(event) {
    const card = event.target.closest('.equip-auto-paper-card');
    if (!card) return;
    const paperId = String(card.dataset.paperId);
    if (event.target.classList.contains('equip-auto-paper-toggle')) {
        if (event.target.checked) {
            equipAutoPaperConfigs.set(paperId, { craftMaterialIds: [] });
        } else {
            equipAutoPaperConfigs.delete(paperId);
        }
        renderEquipAutoPapers();
    }
    invalidateEquipAutoPrediction('图纸或附加材料已变化，请重新开始装备自动模拟。');
}

function handleEquipAutoPaperClick(event) {
    const button = event.target.closest('.equip-auto-attach-option[data-attach-action][data-material-id]');
    if (!button) return;
    const card = button.closest('.equip-auto-paper-card');
    if (!card) return;
    const config = equipAutoPaperConfigs.get(String(card.dataset.paperId));
    const shouldSelect = button.dataset.attachAction === 'add';
    if (!updateEquipAutoAttachMaterialSelection(config, button.dataset.materialId, shouldSelect)) return;
    const list = document.getElementById('autoEquipPaperChoices');
    const scrollTop = list ? list.scrollTop : 0;
    renderEquipAutoPapers();
    if (list) list.scrollTop = scrollTop;
    invalidateEquipAutoPrediction('附加材料已变化，请重新开始装备自动模拟。');
}

function handleEquipAutoPropertyClick(event) {
    if (!event.target.matches('input[type="checkbox"]')) return;
    const label = event.target.closest('.equip-auto-choice[data-property]');
    if (!label) return;
    const prop = label.dataset.property;
    const checkbox = event.target;
    if (checkbox.checked) equipAutoSelectedProperties.add(prop);
    else equipAutoSelectedProperties.delete(prop);
    renderEquipAutoProperties();
    renderEquipAutoPapers();
    invalidateEquipAutoPrediction('目标属性已变化，请重新开始装备自动模拟。');
}

function buildEquipAutoBranches() {
    const branches = [];
    const availableByNpc = new Map();
    selectedEquipAutoLocationIds().forEach(npcId => {
        availableByNpc.set(npcId, new Set(
            EquipmentAutoOptimizer.papersForCraftsman(EQUIP_DATA, npcId).map(item => String(item.paper.id)),
        ));
    });
    selectedEquipAutoLocationIds().forEach(npcId => {
        equipAutoPaperConfigs.forEach((config, paperId) => {
            if (!availableByNpc.get(npcId)?.has(String(paperId))) return;
            const specialIds = Array.from(new Set((config.craftMaterialIds || []).map(Number).filter(id => id > 0)));
            (specialIds.length ? specialIds : [0]).forEach(specialId => {
                branches.push({
                    npcId,
                    paperId: Number(paperId),
                    specialId,
                });
            });
        });
    });
    return branches;
}

function clampEquipAutoNumber(id, min, max, fallback) {
    const element = document.getElementById(id);
    let value = parseInt(element?.value || String(fallback), 10);
    if (Number.isNaN(value)) value = fallback;
    value = Math.max(min, Math.min(max, value));
    if (element) element.value = String(value);
    return value;
}

function validateEquipAutoSelection() {
    const errors = [];
    const makeRnd = extractEquipMakeRnd(state.saveData);
    const branches = buildEquipAutoBranches();
    if (!makeRnd) errors.push('请先导入包含打造状态的有效存档');
    if (!equipAutoSelectedLocations.size) errors.push('请至少选择一个打造地点');
    if (!equipAutoPaperConfigs.size) errors.push('请至少选择一张图纸');
    if (!branches.length && equipAutoPaperConfigs.size) errors.push('当前地点与图纸没有可打造组合');
    if (!equipAutoSelectedProperties.size) errors.push('请至少选择一个目标属性');
    const targetProps = Array.from(equipAutoSelectedProperties);
    const compatibleBranches = branches.filter(branch => {
        const paper = EQUIP_DATA.papers[String(branch.paperId)];
        const equip = paper && EQUIP_DATA.equipment[String(paper.dz_equip)];
        return equip && EquipmentAutoOptimizer.supportedTargetProperties(equip, EQUIP_DATA, targetProps).length > 0;
    });
    const skippedBranchCount = branches.length - compatibleBranches.length;
    if (branches.length && targetProps.length && !compatibleBranches.length) {
        errors.push('所选图纸均不会出现当前目标属性，请更换图纸或属性');
    }
    const message = document.getElementById('autoEquipSelectionMessage');
    if (message) {
        message.textContent = errors.length
            ? errors.join('；')
            : (skippedBranchCount ? `将运行 ${compatibleBranches.length} 个兼容分支，跳过 ${skippedBranchCount} 个不可能出现目标属性的分支。` : '图纸与目标属性兼容，可以开始模拟。');
        message.classList.toggle('is-error', errors.length > 0);
    }
    return { valid: errors.length === 0, errors, makeRnd, branches, compatibleBranches, skippedBranchCount };
}

function renderEquipAutoProgress(progress) {
    const panel = document.getElementById('autoEquipProgress');
    const text = document.getElementById('autoEquipProgressText');
    const percent = document.getElementById('autoEquipProgressPercent');
    const fill = document.getElementById('autoEquipProgressFill');
    if (!panel) return;
    const ratio = progress.total > 0 ? Math.max(0, Math.min(1, progress.done / progress.total)) : 0;
    const value = progress.phase === 'refine' ? 45 + ratio * 55 : ratio * 45;
    panel.hidden = false;
    if (text) text.textContent = progress.message || '正在计算…';
    if (percent) percent.textContent = `${Math.round(value)}%`;
    if (fill) fill.style.width = `${value}%`;
}

function equipAutoUsesPercentFormat(prop, value) {
    const number = Number(value);
    return Number.isFinite(number) && (number < 1 || prop === 'atk_extend');
}

function equipAutoPercentagePoints(value) {
    const number = Number(value);
    if (!Number.isFinite(number)) return 0;
    if (Math.abs(number) < 0.1) return Math.floor(number * 1000 + 0.001) / 10;
    return Math.floor(number * 100 + 0.001);
}

function equipAutoFormatPercentagePoints(value) {
    const number = Number(Number(value).toFixed(1));
    return Number.isInteger(number) ? String(number) : number.toFixed(1);
}

function equipAutoFormatPropValue(prop, value) {
    const number = Number(value);
    if (!Number.isFinite(number)) return String(value);
    if (equipAutoUsesPercentFormat(prop, number)) return `${equipAutoFormatPercentagePoints(equipAutoPercentagePoints(number))}%`;
    return Number.isInteger(number) ? String(number) : number.toFixed(2);
}

/**
 * 精炼结果的「对外展示数值」。
 * 用理论最大值（洗出的值 ÷ 系数）而不是洗出来的原始值 —— 80 泥之前洗出来的并非满值，
 * 拿原始值展示会低估这个槽最终能到多少。没有理论值时退回原始值。
 */
function equipAutoRefinementShownValue(maximum) {
    if (!maximum) return NaN;
    const theoretical = Number(maximum.theoretical);
    if (Number.isFinite(theoretical)) return theoretical;
    return Number(maximum.value);
}

function equipAutoFormatRefinementTotal(refinement) {
    const total = Number(refinement && refinement.total);
    if (!Number.isFinite(total) || !equipAutoUsesPercentFormat(refinement && refinement.prop, total)) {
        return equipAutoFormatPropValue(refinement && refinement.prop, refinement && refinement.total);
    }
    const slotValues = [1, 2, 3]
        .map(slot => equipAutoRefinementShownValue(refinement && refinement.maxima && refinement.maxima[slot]))
        .filter(Number.isFinite);
    if (!slotValues.length) return equipAutoFormatPropValue(refinement.prop, total);
    const displayedTotal = slotValues.reduce((sum, value) => sum + equipAutoPercentagePoints(value), 0);
    return `${equipAutoFormatPercentagePoints(displayedTotal)}%`;
}

function equipAutoPropertyLabel(prop) {
    return EQUIP_AUTO_PROPERTY_LABELS[prop] || EQUIP_DATA.propNames[prop] || prop;
}

function equipAutoFormatProps(items) {
    if (!items || !items.length) return '无';
    return items.map(item => `${escapeAiHtml(equipAutoPropertyLabel(item.prop))}+${escapeAiHtml(equipAutoFormatPropValue(item.prop, item.value))}`).join('、');
}

function equipAutoFormatBase(base) {
    const entries = Object.entries(base || {});
    if (!entries.length) return '无';
    return entries.map(([prop, value]) => `${escapeAiHtml(EQUIP_DATA.propNames[prop] || prop)}+${escapeAiHtml(equipAutoFormatPropValue(prop, value))}`).join('、');
}

function equipAutoFormatSilver(value) {
    const amount = Math.max(0, Math.trunc(Number(value) || 0));
    const liang = Math.floor(amount / 1000);
    const wen = amount % 1000;
    return `${liang ? `${liang.toLocaleString()}两` : ''}${wen || !liang ? `${wen}文` : ''}`;
}

function equipAutoFormatCost(cost) {
    if (!cost) return '无';
    const parts = (cost.materials || []).filter(item => Number(item.amount) > 0)
        .map(item => `${escapeAiHtml(item.name)}×${Number(item.amount).toLocaleString()}`);
    if (cost.mainMaterial && cost.mainAmount) parts.push(`${escapeAiHtml(cost.mainMaterial.name)}×${Number(cost.mainAmount).toLocaleString()}`);
    if (cost.lianjin) parts.push(`连金泥×${Number(cost.lianjin).toLocaleString()}`);
    if (cost.silver) parts.push(`银两${equipAutoFormatSilver(cost.silver)}`);
    return parts.join(' · ') || '无';
}

function mergeEquipAutoCosts(...costs) {
    const materials = new Map();
    let silver = 0;
    const addMaterial = (material, amount) => {
        const value = Math.max(0, Number(amount) || 0);
        if (!material || !value) return;
        const name = String(material.name || material.id || '材料');
        const key = `${material.id ?? ''}:${name}`;
        const current = materials.get(key) || { id: material.id, name, amount: 0 };
        current.amount += value;
        materials.set(key, current);
    };
    costs.filter(Boolean).forEach(cost => {
        (cost.materials || []).forEach(item => addMaterial(item, item.amount));
        addMaterial(cost.mainMaterial, cost.mainAmount);
        if (cost.lianjin) addMaterial({ id: 8801, name: '连金泥' }, cost.lianjin);
        silver += Math.max(0, Number(cost.silver) || 0);
    });
    return {
        materials: Array.from(materials.values()).sort((a, b) => Number(a.name === '连金泥') - Number(b.name === '连金泥')),
        silver,
    };
}

function equipAutoRefinementHtml(refinement, upgradeCost = null) {
    const label = equipAutoPropertyLabel(refinement.prop);
    const slots = [1, 2, 3].map(slot => {
        const maximum = refinement.maxima[slot];
        if (!maximum) return `<span>槽位 ${slot}：无</span>`;
        const occurrences = maximum.occurrences.map(item => item.source === 'original' ? '原有' : `#${item.index}`).join('、');
        // 洗出来的原始值照实显示，理论上限（值÷系数）放括号里；两者一样就不重复
        const rawTxt = equipAutoFormatPropValue(refinement.prop, maximum.value);
        const theoreticalTxt = equipAutoFormatPropValue(refinement.prop, equipAutoRefinementShownValue(maximum));
        const slotTxt = rawTxt === theoreticalTxt ? rawTxt : `${rawTxt}（理论 ${theoreticalTxt}）`;
        return `<span>槽位 ${slot}：${escapeAiHtml(slotTxt)}<small>（${occurrences}）</small></span>`;
    }).join('');
    const plan = refinement.plan;
    const accepts = plan ? plan.accepts.map(item => `#${item.index}（槽${item.slot}）`).join(' → ') : '无';
    const totalCost = mergeEquipAutoCosts(upgradeCost, plan && plan.cost);
    return `<div class="equip-auto-refine-card">
        <div class="equip-auto-refine-title"><strong>精炼 · ${escapeAiHtml(label)}</strong><span class="equip-auto-max-value">最高${escapeAiHtml(label)} ${escapeAiHtml(equipAutoFormatRefinementTotal(refinement))}</span></div>
        <div class="equip-auto-slot-list">${slots}</div>
        <div>状态回放：${accepts}${plan ? `，做到第 ${plan.cutoff} 次为止` : ''}</div>
        <div class="equip-auto-cost-line">消耗（精炼消耗）：${plan ? equipAutoFormatCost(plan.cost) : '无'}</div>
        <div class="equip-auto-total-cost-line">总消耗（升炼 + 精炼）：${equipAutoFormatCost(totalCost)}</div>
    </div>`;
}

function equipAutoAttachmentHtml(attachment) {
    const stageText = attachment.stage === 'before' ? '升炼前' : '升炼后';
    const levelText = Number(attachment.equipLevel) > 0 ? ` · ${Number(attachment.equipLevel)}级` : '';
    const stageHtml = `<span class="equip-auto-attachment-stage">${stageText}${levelText}</span>`;
    if (attachment.unavailable) {
        return `<div class="equip-auto-attach-card"><strong>附加 · ${escapeAiHtml(attachment.materialName)} ${stageHtml}</strong><div class="ai-result-error">附加不可用</div></div>`;
    }
    const maxima = (attachment.maxima || []).filter(item => item.recommendedIndex != null);
    const maximumSummary = maxima.map(maximum => `最高${escapeAiHtml(equipAutoPropertyLabel(maximum.prop))} ${escapeAiHtml(equipAutoFormatPropValue(maximum.prop, maximum.value))} · 第 ${maximum.indexes.join('、')} 次`).join('；');
    const sequenceItems = attachment.items || [];
    const showProperty = new Set(sequenceItems.map(item => item.prop)).size > 1;
    const maximumIndexes = new Set(maxima.flatMap(maximum => maximum.indexes || []).map(Number));
    const sequence = sequenceItems.map(item => {
        const value = equipAutoFormatPropValue(item.prop, item.value);
        const property = showProperty ? `<span class="equip-auto-attach-sequence-prop">${escapeAiHtml(equipAutoPropertyLabel(item.prop))}</span>` : '';
        const isMaximum = maximumIndexes.has(Number(item.index));
        const ratingKey = equipAutoAttachmentRatingKey(item);
        return `<li class="equip-auto-attach-sequence-item${ratingKey ? ` is-rating-${ratingKey}` : ''}${isMaximum ? ' is-maximum' : ''}">
            <span class="equip-auto-attach-sequence-index">第 ${Number(item.index)} 次</span>
            ${property}
            <strong class="equip-auto-attach-sequence-value">${escapeAiHtml(value)}</strong>
            ${isMaximum ? '<span class="equip-auto-attach-sequence-badge">最高</span>' : ''}
        </li>`;
    }).join('');
    return `<div class="equip-auto-attach-card">
        <div class="equip-auto-refine-title"><strong>芒晶洗练 · ${escapeAiHtml(attachment.materialName)} ${stageHtml}</strong><span class="equip-auto-attachment-value">${maximumSummary || '预测范围内未出现可用属性'}</span></div>
        <div class="equip-auto-attachment-maxima">${maxima.map(maximum => `<div class="equip-auto-attachment-maximum">
            <span>${escapeAiHtml(equipAutoPropertyLabel(maximum.prop))}</span>
            <span class="equip-auto-cost-line">消耗：芒晶×${maximum.recommendedIndex}</span>
        </div>`).join('')}</div>
        ${sequence ? `<ol class="equip-auto-attach-sequence" aria-label="芒晶洗练逐次结果">${sequence}</ol>` : ''}
    </div>`;
}

const EQUIP_AUTO_ATTACHMENT_RATING_KEYS = Object.freeze(['white', 'green', 'blue', 'purple', 'gold', 'red']);

function equipAutoAttachmentRatingKey(item) {
    const value = Number(item && item.value);
    const minimum = Number(item && item.valueMinimum);
    const maximum = Number(item && item.valueMaximum);
    if (![value, minimum, maximum].every(Number.isFinite) || maximum < minimum) return '';
    if (maximum === minimum) return 'red';
    const ratio = Math.min(1, Math.max(0, (value - minimum) / (maximum - minimum)));
    const index = ratio >= 1
        ? EQUIP_AUTO_ATTACHMENT_RATING_KEYS.length - 1
        : Math.floor(ratio * EQUIP_AUTO_ATTACHMENT_RATING_KEYS.length);
    return EQUIP_AUTO_ATTACHMENT_RATING_KEYS[index];
}

function equipAutoManualAttachState(candidate) {
    const key = String(candidate && candidate.id || '');
    let current = equipAutoManualAttachStates.get(key);
    if (!current) {
        current = { stage: 'after', count: equipAutoAttachCount(), result: null, error: '' };
        equipAutoManualAttachStates.set(key, current);
    }
    return current;
}

function equipAutoAttachCount() {
    return clampEquipAutoNumber('autoEquipAttachCount', 1, 5000, 50);
}

// 候选装备盲晶洗练的「全局最高值」摘要：取升炼后 N 次中 value 最大的那次（含词条、数值、第几次）
function equipAutoAttachPeak(candidate) {
    const state = equipAutoManualAttachState(candidate);
    const items = Array.isArray(state.result && state.result.items) ? state.result.items : [];
    if (!items.length) return null;
    let best = items[0];
    for (const item of items) {
        if (item.value > best.value) best = item;
    }
    return best;
}

function equipAutoManualAttachHtml(candidate) {
    const candidateId = String(candidate && candidate.id || '');
    const firstStage = Number(candidate && candidate.craftSpecialEquipLevel) > 0
        ? `升炼前 · ${Number(candidate.craftSpecialEquipLevel)}级`
        : '升炼前';
    if (!candidate || !candidate.canSimulateSpecialAttach || !candidate.specialAttachEquips || !candidate.craftSpecialId) {
        return `<div class="equip-auto-manual-attach is-unavailable" data-candidate-id="${escapeAiHtml(candidateId)}">
            <p class="ai-visual-heading">附加属性</p>
            <div class="equip-auto-attach-card"><strong>未进行首次打造附加</strong><p>图纸未选择附加材料，无法使用芒晶模拟。</p></div>
        </div>`;
    }
    const state = equipAutoManualAttachState(candidate);
    const stage = state.stage === 'after' ? 'after' : 'before';
    const result = state.result ? equipAutoAttachmentHtml(state.result) : '';
    return `<div class="equip-auto-manual-attach" data-candidate-id="${escapeAiHtml(candidateId)}">
        <p class="ai-visual-heading">附加属性</p>
        <div class="equip-auto-attach-card equip-auto-crafted-special">
            <div class="equip-auto-refine-title"><strong>首次打造附加 · ${escapeAiHtml(candidate.craftSpecialName)}</strong><span class="equip-auto-attachment-stage">${firstStage}</span></div>
            <div class="equip-auto-crafted-special-value">${equipAutoFormatProps(candidate.special)}</div>
        </div>
        <div class="equip-auto-manual-attach-controls" aria-label="后续芒晶洗练设置">
            <div class="equip-auto-manual-stage" role="group" aria-label="芒晶洗练阶段">
                <button type="button" data-manual-attach-action="stage" data-stage="before" class="${stage === 'before' ? 'is-active' : ''}" aria-pressed="${stage === 'before'}">升炼前</button>
                <button type="button" data-manual-attach-action="stage" data-stage="after" class="${stage === 'after' ? 'is-active' : ''}" aria-pressed="${stage === 'after'}">升炼后</button>
            </div>
            <label>模拟次数<input class="equip-auto-manual-attach-count" type="number" min="1" max="5000" value="${state.count}"><span>次</span></label>
            <button class="btn equip-auto-manual-attach-button" type="button" data-manual-attach-action="simulate">模拟芒晶洗练</button>
        </div>
        <p class="equip-auto-manual-attach-hint">沿用首次打造材料「${escapeAiHtml(candidate.craftSpecialName)}」的属性池；只读预测，不推进 MJSeed。</p>
        ${state.error ? `<div class="ai-result-error">${escapeAiHtml(state.error)}</div>` : result}
    </div>`;
}

function equipAutoCandidateCostHtml(candidate) {
    const cost = candidate.craftCost || {};
    const parts = (cost.materials || []).filter(item => Number(item.amount) > 0).map(item => {
        const isPaper = Number(item.id) === Number(candidate.paperId)
            || String(item.name || '') === String(candidate.paperName || '');
        return isPaper ? '图纸×1' : `${escapeAiHtml(item.name)}×${Number(item.amount).toLocaleString()}`;
    });
    if (cost.mainMaterial && cost.mainAmount) parts.push(`${escapeAiHtml(cost.mainMaterial.name)}×${Number(cost.mainAmount).toLocaleString()}`);
    if (cost.lianjin) parts.push(`连金泥×${Number(cost.lianjin).toLocaleString()}`);
    if (cost.silver) parts.push(`银两${equipAutoFormatSilver(cost.silver)}`);
    const items = parts.length ? parts.map(part => `<span>${part}</span>`).join('') : '<span>无</span>';
    return `<div class="equip-auto-cost-items">${items}</div>`;
}

const EQUIP_AUTO_RATING_LEVELS = Object.freeze([
    { min: 96, key: 'red', label: '神器' },
    { min: 91, key: 'gold', label: '极品' },
    { min: 81, key: 'purple', label: '极佳' },
    { min: 71, key: 'blue', label: '优秀' },
    { min: 51, key: 'green', label: '良好' },
    { min: 0, key: 'white', label: '劣质' },
]);
const EQUIP_AUTO_REFINEMENT_THEORETICAL_MAX_MULTIPLIER = 1.25;
const EQUIP_AUTO_REFINEMENT_SLOT_MULTIPLIERS = Object.freeze([1, 0.75, 0.5]);

function equipAutoRefinementTotal(refinement) {
    const slotValues = [1, 2, 3].map(slot => equipAutoRefinementShownValue(refinement && refinement.maxima && refinement.maxima[slot]))
        .filter(Number.isFinite);
    if (slotValues.length) return slotValues.reduce((sum, value) => sum + value, 0);
    return Math.max(0, Number(refinement && refinement.total) || 0);
}

function equipAutoTheoreticalSlotMaximum(candidate, prop, slot = 1) {
    const config = typeof EQUIP_DATA !== 'undefined'
        ? EQUIP_DATA.equipment && EQUIP_DATA.equipment[String(candidate && candidate.equipId)]
        : null;
    const extConfig = config && config.exts && config.exts[prop];
    if (typeof EquipmentAutoOptimizer !== 'undefined'
        && typeof EquipmentAutoOptimizer.theoreticalRefinementSlotMaximum === 'function') {
        return EquipmentAutoOptimizer.theoreticalRefinementSlotMaximum(config, prop, slot);
    }
    const baseValue = Number(Array.isArray(extConfig) ? extConfig[0] : NaN);
    const slotMultiplier = EQUIP_AUTO_REFINEMENT_SLOT_MULTIPLIERS[Math.trunc(Number(slot)) - 1];
    if (!Number.isFinite(baseValue) || baseValue <= 0 || !slotMultiplier) return 0;
    const maximum = baseValue * EQUIP_AUTO_REFINEMENT_THEORETICAL_MAX_MULTIPLIER * slotMultiplier;
    return baseValue >= 1 ? Math.floor(maximum) : maximum;
}

function equipAutoRatingReference(candidate) {
    const reference = {};
    const embedded = candidate && candidate.refinementRatingReference;
    (candidate && candidate.refinements || []).forEach(refinement => {
        const prop = String(refinement.prop || '');
        if (!prop) return;
        const candidateMaximum = Number(embedded && embedded[prop]);
        reference[prop] = Number.isFinite(candidateMaximum) && candidateMaximum > 0
            ? candidateMaximum
            : EQUIP_AUTO_REFINEMENT_SLOT_MULTIPLIERS.reduce((sum, _, index) => (
                sum + equipAutoTheoreticalSlotMaximum(candidate, prop, index + 1)
            ), 0);
    });
    return reference;
}

function equipAutoRatingForPercent(percent) {
    const normalizedPercent = Math.min(100, Math.max(0, Number(percent) || 0));
    const roundedPercent = Math.round(normalizedPercent);
    const level = EQUIP_AUTO_RATING_LEVELS.find(item => roundedPercent >= item.min) || EQUIP_AUTO_RATING_LEVELS[EQUIP_AUTO_RATING_LEVELS.length - 1];
    return { ...level, percent: normalizedPercent, roundedPercent };
}

function equipAutoRefinementRating(candidate, refinement, reference = equipAutoRatingReference(candidate)) {
    const maximum = Number(reference && reference[refinement && refinement.prop]) || 0;
    const percent = maximum > 0 ? equipAutoRefinementTotal(refinement) / maximum * 100 : 0;
    return equipAutoRatingForPercent(percent);
}

function equipAutoCandidateRating(candidate, reference = equipAutoRatingReference(candidate)) {
    const ratings = (candidate.refinements || []).map(refinement => equipAutoRefinementRating(candidate, refinement, reference));
    return equipAutoRatingForPercent(ratings.length ? Math.max(...ratings.map(item => item.percent)) : 0);
}

function equipAutoCandidateHtml(candidate) {
    const ratingReference = equipAutoRatingReference(candidate);
    const rating = equipAutoCandidateRating(candidate, ratingReference);
    const targetSummary = candidate.refinements.map(refinement => {
        const refinementRating = equipAutoRefinementRating(candidate, refinement, ratingReference);
        return `<span class="equip-auto-max-summary" title="${escapeAiHtml(equipAutoPropertyLabel(refinement.prop))}品质：${refinementRating.label} ${refinementRating.roundedPercent}%"><span>最高${escapeAiHtml(equipAutoPropertyLabel(refinement.prop))}</span><strong class="is-${refinementRating.key}">${escapeAiHtml(equipAutoFormatRefinementTotal(refinement))}</strong></span>`;
    }).join('<span class="equip-auto-summary-separator">·</span>');
    const locationSummary = candidate.location ? `<span class="equip-auto-summary-separator">·</span><span class="equip-auto-location-summary">${escapeAiHtml(candidate.location)}</span>` : '';
    const regionSummary = candidate.region.length
        ? `<span class="equip-auto-region-summary"><span>地区附加</span><strong>${equipAutoFormatProps(candidate.region)}</strong></span>`
        : '<span class="equip-auto-region-summary is-empty">无地区附加</span>';
    const attachPeak = equipAutoAttachPeak(candidate);
    const attachPeakSummary = attachPeak
        ? `<span class="equip-auto-attach-peak-summary" title="盲晶洗练 ${equipAutoAttachCount()} 次全局最高值"><span>盲晶最高</span><strong>${escapeAiHtml(equipAutoPropertyLabel(attachPeak.prop))} ${escapeAiHtml(equipAutoFormatPropValue(attachPeak.prop, attachPeak.value))}</strong><small>第 ${Number(attachPeak.index)} 次</small></span>`
        : '';
    return `<details class="equip-auto-candidate">
        <summary>
            <span class="equip-auto-rating is-${rating.key}" title="精炼评级：${rating.label} ${rating.roundedPercent}%（按三槽理论满值）"><strong>${rating.label}</strong><small>${rating.roundedPercent}%</small></span>
            <span class="equip-auto-candidate-title"><b>${escapeAiHtml(candidate.paperName)} · 第 ${candidate.craftIndex} 次</b><span class="equip-auto-candidate-meta"><span class="equip-auto-equip-summary">${escapeAiHtml(candidate.equipName)}</span>${locationSummary}${targetSummary ? `<span class="equip-auto-summary-separator">·</span>${targetSummary}` : ''}<span class="equip-auto-summary-separator">·</span>${regionSummary}${attachPeakSummary ? `<span class="equip-auto-summary-separator">·</span>${attachPeakSummary}` : ''}</span></span>
        </summary>
        <div class="equip-auto-candidate-body">
            <div class="equip-auto-detail-grid">
                <div class="equip-auto-detail-card"><strong>基础属性</strong>${equipAutoFormatBase(candidate.base)}</div>
                <div class="equip-auto-detail-card"><strong>蓝/紫词条</strong>${equipAutoFormatProps(candidate.exts)}</div>
                <div class="equip-auto-detail-card equip-auto-region-card"><strong>地区附加</strong>${equipAutoFormatProps(candidate.region)}</div>
                <div class="equip-auto-detail-card equip-auto-material-cost"><strong>打造消耗</strong>${equipAutoCandidateCostHtml(candidate)}</div>
            </div>
            <p class="ai-visual-heading">精炼属性</p>
            ${candidate.refinements.map(refinement => equipAutoRefinementHtml(refinement, candidate.upgradeCost)).join('')}
            ${equipAutoManualAttachHtml(candidate)}
        </div>
    </details>`;
}

function equipAutoCandidateListHtml(candidates) {
    const sorted = [...(candidates || [])].sort((a, b) => String(a.location).localeCompare(String(b.location), 'zh')
        || String(a.paperName).localeCompare(String(b.paperName), 'zh')
        || (a.craftIndex - b.craftIndex));
    return `<div class="equip-auto-candidate-list">${sorted.map(candidate => equipAutoCandidateHtml(candidate)).join('')}</div>`;
}

function equipAutoResultPaperKey(candidate) {
    return String(candidate && candidate.paperId != null ? candidate.paperId : candidate && candidate.paperName || '');
}

function equipAutoFilteredCandidates(candidates) {
    const attachThreshold = equipAutoResultAttachFilter === '' ? null : Number(equipAutoResultAttachFilter);
    return (Array.isArray(candidates) ? candidates : []).filter(candidate => {
        if (equipAutoResultLocationFilter && String(candidate.location || '') !== equipAutoResultLocationFilter) return false;
        if (equipAutoResultPaperFilter && equipAutoResultPaperKey(candidate) !== equipAutoResultPaperFilter) return false;
        if (equipAutoResultQualityFilter && equipAutoCandidateRating(candidate).key !== equipAutoResultQualityFilter) return false;
        if (equipAutoResultAttachOnly && !(candidate.region && candidate.region.length)) return false;
        if (attachThreshold != null && Number.isFinite(attachThreshold)) {
            const peak = equipAutoAttachPeak(candidate);
            if (!peak) return false;
            // 百分比属性按「百分比点」比较（如穿甲 5% = 5），绝对值属性按原值比较
            const peakValue = equipAutoUsesPercentFormat(peak.prop, peak.value)
                ? equipAutoPercentagePoints(peak.value)
                : Number(peak.value);
            if (!(peakValue >= attachThreshold)) return false;
        }
        return true;
    });
}

function equipAutoResultFilterOptionsHtml(candidates) {
    const locations = Array.from(new Set((candidates || []).map(candidate => String(candidate.location || '')).filter(Boolean)))
        .sort((a, b) => a.localeCompare(b, 'zh'));
    const papers = new Map();
    (candidates || []).forEach(candidate => {
        const key = equipAutoResultPaperKey(candidate);
        if (key && !papers.has(key)) papers.set(key, String(candidate.paperName || key));
    });
    const paperEntries = Array.from(papers.entries()).sort((a, b) => a[1].localeCompare(b[1], 'zh'));
    return `<div class="equip-auto-result-filters" aria-label="装备候选筛选">
        <label for="equipAutoResultLocationFilter"><span>地点筛选</span>
            <select id="equipAutoResultLocationFilter">
                <option value="">全部地点</option>
                ${locations.map(location => `<option value="${escapeAiHtml(location)}">${escapeAiHtml(location)}</option>`).join('')}
            </select>
        </label>
        <label for="equipAutoResultPaperFilter"><span>图纸筛选</span>
            <select id="equipAutoResultPaperFilter">
                <option value="">全部图纸</option>
                ${paperEntries.map(([key, name]) => `<option value="${escapeAiHtml(key)}">${escapeAiHtml(name)}</option>`).join('')}
            </select>
        </label>
        <label class="equip-auto-quality-filter" for="equipAutoResultQualityFilter"><span>品质筛选</span>
            <select id="equipAutoResultQualityFilter">
                <option value="">全部品质</option>
                ${[...EQUIP_AUTO_RATING_LEVELS].reverse().map(level => `<option value="${level.key}">${level.label}</option>`).join('')}
            </select>
        </label>
        <label class="equip-auto-attach-filter" for="equipAutoResultAttachFilter"><span>盲晶筛选</span>
            <input type="number" class="equip-auto-attach-input" id="equipAutoResultAttachFilter" min="0" step="any" placeholder="盲晶最高值≥">
        </label>
        <label class="equip-auto-attach-only-filter" for="equipAutoResultAttachOnlyFilter">
            <input type="checkbox" id="equipAutoResultAttachOnlyFilter" ${equipAutoResultAttachOnly ? 'checked' : ''}>
            <span>仅附加装备</span>
        </label>
    </div>`;
}

function equipAutoResultPageData(candidates, requestedPage, requestedPageSize) {
    const items = Array.isArray(candidates) ? candidates : [];
    const parsedPageSize = Number(requestedPageSize);
    const pageSize = EQUIP_AUTO_RESULT_PAGE_SIZES.includes(parsedPageSize) ? parsedPageSize : 30;
    const pageCount = Math.max(1, Math.ceil(items.length / pageSize));
    const page = Math.min(pageCount, Math.max(1, Number.parseInt(requestedPage, 10) || 1));
    const start = (page - 1) * pageSize;
    const end = Math.min(start + pageSize, items.length);
    return { page, pageSize, pageCount, start, end, items: items.slice(start, end) };
}

function renderEquipAutoResultPage() {
    if (!equipAutoLastResult || !Array.isArray(equipAutoLastResult.candidates)) return;
    const filteredCandidates = equipAutoFilteredCandidates(equipAutoLastResult.candidates);
    const pageData = equipAutoResultPageData(
        filteredCandidates,
        equipAutoResultPage,
        equipAutoResultPageSize,
    );
    equipAutoResultPage = pageData.page;
    equipAutoResultPageSize = pageData.pageSize;

    const pageInfo = document.getElementById('equipAutoCandidatePageInfo');
    const pageSize = document.getElementById('equipAutoResultPageSize');
    const previous = document.getElementById('btnEquipAutoResultPrev');
    const next = document.getElementById('btnEquipAutoResultNext');
    const heading = document.getElementById('equipAutoCandidatePageHeading');
    const page = document.getElementById('equipAutoCandidatePage');
    const locationFilter = document.getElementById('equipAutoResultLocationFilter');
    const paperFilter = document.getElementById('equipAutoResultPaperFilter');
    const qualityFilter = document.getElementById('equipAutoResultQualityFilter');
    const range = pageData.items.length ? `${pageData.start + 1}–${pageData.end}` : '0';
    const totalSuffix = filteredCandidates.length === equipAutoLastResult.candidates.length
        ? ''
        : `（全部 ${equipAutoLastResult.candidates.length} 件）`;

    if (pageInfo) pageInfo.textContent = `第 ${pageData.page}/${pageData.pageCount} 页 · 显示 ${range} / ${filteredCandidates.length} 件${totalSuffix}`;
    if (pageSize) pageSize.value = String(pageData.pageSize);
    if (locationFilter) locationFilter.value = equipAutoResultLocationFilter;
    if (paperFilter) paperFilter.value = equipAutoResultPaperFilter;
    if (qualityFilter) qualityFilter.value = equipAutoResultQualityFilter;
    const attachOnly = document.getElementById('equipAutoResultAttachOnlyFilter');
    if (attachOnly) attachOnly.checked = equipAutoResultAttachOnly;
    if (previous) previous.disabled = pageData.page <= 1;
    if (next) next.disabled = pageData.page >= pageData.pageCount;
    if (heading) heading.textContent = `筛选结果：${filteredCandidates.length} 件，本页 ${pageData.items.length} 件`;
    if (page) {
        page.innerHTML = pageData.items.length
            ? equipAutoCandidateListHtml(pageData.items)
            : '<div class="ai-result-empty">当前筛选条件下没有候选装备。</div>';
    }
}

function equipAutoCandidateById(candidateId) {
    return (equipAutoLastResult && equipAutoLastResult.candidates || [])
        .find(candidate => String(candidate.id) === String(candidateId));
}

function rerenderEquipAutoManualAttach(candidate, currentElement) {
    if (!candidate || !currentElement) return;
    currentElement.outerHTML = equipAutoManualAttachHtml(candidate);
}

function handleEquipAutoResultClick(event) {
    if (!equipAutoLastResult) return;
    const action = event.target.closest?.('[data-manual-attach-action]');
    if (action) {
        const container = action.closest('.equip-auto-manual-attach[data-candidate-id]');
        const candidate = equipAutoCandidateById(container && container.dataset.candidateId);
        if (!candidate || !candidate.canSimulateSpecialAttach) return;
        const state = equipAutoManualAttachState(candidate);
        if (action.dataset.manualAttachAction === 'stage') {
            state.stage = action.dataset.stage === 'after' ? 'after' : 'before';
            state.result = null;
            state.error = '';
            rerenderEquipAutoManualAttach(candidate, container);
            return;
        }
        if (action.dataset.manualAttachAction === 'simulate') {
            const countInput = container.querySelector('.equip-auto-manual-attach-count');
            let count = Number.parseInt(countInput && countInput.value || String(state.count), 10);
            if (!Number.isFinite(count)) count = 20;
            state.count = Math.max(1, Math.min(5000, count));
            state.error = '';
            try {
                const equip = candidate.specialAttachEquips[state.stage];
                const material = EQUIP_DATA.special[String(candidate.craftSpecialId)];
                state.result = {
                    ...EquipmentAutoOptimizer.predictSpecialAttachSequence(equip, material, state.count),
                    stage: state.stage,
                    equipLevel: equip.need_lv,
                };
            } catch (error) {
                state.result = null;
                state.error = `模拟失败：${error?.message || error}`;
            }
            rerenderEquipAutoManualAttach(candidate, container);
            return;
        }
    }
    if (event.target.id === 'btnEquipAutoResultPrev') equipAutoResultPage -= 1;
    else if (event.target.id === 'btnEquipAutoResultNext') equipAutoResultPage += 1;
    else return;
    renderEquipAutoResultPage();
}

function handleEquipAutoResultControlChange(event) {
    if (event.target.classList?.contains('equip-auto-manual-attach-count')) {
        const container = event.target.closest('.equip-auto-manual-attach[data-candidate-id]');
        const candidate = equipAutoCandidateById(container && container.dataset.candidateId);
        if (!candidate) return;
        const state = equipAutoManualAttachState(candidate);
        let count = Number.parseInt(event.target.value, 10);
        if (!Number.isFinite(count)) count = 20;
        state.count = Math.max(1, Math.min(5000, count));
        state.result = null;
        state.error = '';
        rerenderEquipAutoManualAttach(candidate, container);
        return;
    }
    if (event.target.id === 'equipAutoResultPageSize') {
        equipAutoResultPageSize = Number(event.target.value);
    } else if (event.target.id === 'equipAutoResultLocationFilter') {
        equipAutoResultLocationFilter = String(event.target.value || '');
    } else if (event.target.id === 'equipAutoResultPaperFilter') {
        equipAutoResultPaperFilter = String(event.target.value || '');
    } else if (event.target.id === 'equipAutoResultQualityFilter') {
        equipAutoResultQualityFilter = String(event.target.value || '');
    } else if (event.target.id === 'equipAutoResultAttachFilter') {
        equipAutoResultAttachFilter = String(event.target.value || '');
    } else if (event.target.id === 'equipAutoResultAttachOnlyFilter') {
        equipAutoResultAttachOnly = event.target.checked;
    } else {
        return;
    }
    equipAutoResultPage = 1;
    renderEquipAutoResultPage();
}

function handleEquipAutoResultInput(event) {
    if (event.target && event.target.id === 'equipAutoResultAttachFilter') {
        equipAutoResultAttachFilter = String(event.target.value || '');
        equipAutoResultPage = 1;
        renderEquipAutoResultPage();
    }
}

function precomputeEquipAutoAttachments(result) {
    if (!result || !Array.isArray(result.candidates)) return;
    const count = equipAutoAttachCount();
    result.candidates.forEach(candidate => {
        if (!candidate || !candidate.canSimulateSpecialAttach || !candidate.specialAttachEquips || !candidate.craftSpecialId) return;
        const state = equipAutoManualAttachState(candidate);
        state.stage = 'after';
        state.count = count;
        state.error = '';
        try {
            const equip = candidate.specialAttachEquips.after;
            const material = EQUIP_DATA.special[String(candidate.craftSpecialId)];
            state.result = {
                ...EquipmentAutoOptimizer.predictSpecialAttachSequence(equip, material, state.count),
                stage: state.stage,
                equipLevel: equip.need_lv,
            };
        } catch (error) {
            state.result = null;
            state.error = `模拟失败：${error?.message || error}`;
        }
    });
}

function renderEquipAutoResults(result) {
    const container = document.getElementById('autoEquipResults');
    if (!container) return;
    equipAutoLastResult = result;
    equipAutoResultPage = 1;
    equipAutoResultLocationFilter = '';
    equipAutoResultPaperFilter = '';
    equipAutoResultQualityFilter = '';
    equipAutoResultAttachFilter = '';
    equipAutoResultAttachOnly = false;
    equipAutoManualAttachStates = new Map();
    precomputeEquipAutoAttachments(result);
    container.dataset.hasResult = 'true';
    if (!result || !result.candidates || !result.candidates.length) {
        const skipped = Number(result && result.summary && result.summary.skippedBranchCount || 0);
        container.innerHTML = `<div class="ai-result-error">当前兼容范围没有打造出紫装，请增加打造次数或调整地点、图纸与材料。${skipped ? ` 已跳过 ${skipped} 个属性不兼容分支。` : ''}</div>`;
        return;
    }
    container.innerHTML = `${(result.skippedBranches || []).length ? `<details class="equip-auto-skipped-branches"><summary>查看跳过的 ${result.skippedBranches.length} 个分支</summary>${result.skippedBranches.map(branch => `<div>${escapeAiHtml(branch.location)} · ${escapeAiHtml(branch.paperName)}：${escapeAiHtml(branch.reason)}</div>`).join('')}</details>` : ''}
    <div class="equip-auto-result-toolbar" aria-label="装备候选筛选与数量">
        ${equipAutoResultFilterOptionsHtml(result.candidates)}
        <p id="equipAutoCandidatePageHeading" class="equip-auto-result-count"></p>
    </div>
    <div id="equipAutoCandidatePage"></div>
    <div class="pager-bar equip-auto-result-pager" aria-label="装备候选分页">
        <div class="equip-auto-pager-controls">
            <span id="equipAutoCandidatePageInfo" class="meta-text"></span>
            <button id="btnEquipAutoResultPrev" class="btn equip-auto-pager-button" type="button">上一页</button>
            <button id="btnEquipAutoResultNext" class="btn equip-auto-pager-button" type="button">下一页</button>
            <label class="pager-size" for="equipAutoResultPageSize">每页
                <select id="equipAutoResultPageSize">
                    ${EQUIP_AUTO_RESULT_PAGE_SIZES.map(size => `<option value="${size}" ${size === equipAutoResultPageSize ? 'selected' : ''}>${size}</option>`).join('')}
                </select>
                件
            </label>
        </div>
    </div>`;
    renderEquipAutoResultPage();
}

function setEquipAutoInputsDisabled(disabled) {
    document.querySelectorAll('#autoEquipModePanel input, #autoEquipModePanel select').forEach(element => {
        element.disabled = !!disabled;
    });
}

async function runEquipAutoSimulation() {
    if (equipAutoRunning) return;
    const validation = validateEquipAutoSelection();
    if (!validation.valid) return;
    equipAutoRunning = true;
    equipAutoCancelRequested = false;
    setEquipAutoInputsDisabled(true);
    const runToken = ++equipAutoRunToken;
    const predict = document.getElementById('btnAutoEquipPredict');
    const cancel = document.getElementById('btnAutoEquipCancel');
    const results = document.getElementById('autoEquipResults');
    if (predict) {
        predict.disabled = true;
        predict.textContent = '正在计算装备路线…';
    }
    if (cancel) {
        cancel.hidden = false;
        cancel.disabled = false;
        cancel.textContent = '取消计算';
    }
    if (results) results.innerHTML = '<div class="ai-result-empty">正在按独立存档分支计算打造与精炼结果…</div>';
    renderEquipAutoProgress({ phase: 'craft', done: 0, total: validation.branches.length, message: '正在保存原始打造状态' });
    try {
        const result = await EquipmentAutoOptimizer.simulateEquipmentRoutes({
            data: EQUIP_DATA,
            initialMakeState: validation.makeRnd,
            branches: validation.branches,
            targetProps: Array.from(equipAutoSelectedProperties),
            options: {
                craftCount: clampEquipAutoNumber('autoEquipCraftCount', 1, 5000, 100),
                refineCount: clampEquipAutoNumber('autoEquipRefineCount', 1, 1000, 500),
                attachCount: clampEquipAutoNumber('autoEquipAttachCount', 1, 5000, 50),
            },
            bridge: {
                getMakeState: () => wasmMakeGetState(),
                setMakeState: next => {
                    if (!wasmMakeSetState(next)) throw new Error('原始打造状态恢复失败');
                    return true;
                },
                makePreview: (request, count) => wasmMakePreview(request, count),
                xilianPlan: (equip, accepts) => wasmXilianPlan(equip, accepts),
            },
            shouldCancel: () => equipAutoCancelRequested || runToken !== equipAutoRunToken,
            onProgress: progress => {
                if (runToken === equipAutoRunToken) renderEquipAutoProgress(progress);
            },
        });
        if (runToken !== equipAutoRunToken) return;
        if (result.cancelled) {
            if (results) results.innerHTML = '<div class="ai-result-empty">装备计算已取消，原始打造状态已恢复，页面模拟状态未改变。</div>';
            const progress = document.getElementById('autoEquipProgress');
            if (progress) progress.hidden = true;
            return;
        }
        renderEquipAutoProgress({ phase: 'refine', done: 1, total: 1, message: '打造与精炼分析完成' });
        renderEquipAutoResults(result);
    } catch (error) {
        console.error('装备自动模拟失败:', error);
        if (runToken === equipAutoRunToken && results) {
            results.innerHTML = `<div class="ai-result-error">计算失败：${escapeAiHtml(error?.message || error)}</div>`;
        }
        const progress = document.getElementById('autoEquipProgress');
        if (progress) progress.hidden = true;
    } finally {
        if (runToken === equipAutoRunToken) {
            equipAutoRunning = false;
            setEquipAutoInputsDisabled(false);
            if (predict) {
                predict.disabled = false;
                predict.textContent = '重新装备自动模拟';
            }
            if (cancel) cancel.hidden = true;
        }
    }
}

function cancelEquipAutoSimulation() {
    if (!equipAutoRunning) return;
    equipAutoCancelRequested = true;
    const button = document.getElementById('btnAutoEquipCancel');
    const text = document.getElementById('autoEquipProgressText');
    if (button) {
        button.disabled = true;
        button.textContent = '正在停止…';
    }
    if (text) text.textContent = '当前批次结束后停止并恢复原始打造状态…';
}

function jianwangAutoModule() {
    return typeof JianwangAutoOptimizer !== 'undefined' ? JianwangAutoOptimizer : null;
}

function jianwangAutoRouteForId(id) {
    const value = Number(id);
    if (value >= 5710 && value <= 5713) return value;
    if (value >= 5714 && value <= 5717) return value - 4;
    return 0;
}

function jianwangAutoSelectedSword() {
    const select = document.getElementById('autoJianwangStartSword');
    if (!select || !select.value || select.value === '__provider__') return null;
    return jianwangAutoSwords.find(sword => sword.key === select.value) || null;
}

function invalidateJianwangAutoPrediction(message) {
    jianwangAutoLastResult = null;
    jianwangAutoResultPage = 1;
    if (jianwangAutoRunning) jianwangAutoCancelRequested = true;
    const results = document.getElementById('autoJianwangResults');
    if (results) results.innerHTML = `<div class="ai-result-empty">${escapeAiHtml(message || '配置已变化，请重新开始剑王阁自动模拟。')}</div>`;
    if (!jianwangAutoRunning) {
        const progress = document.getElementById('autoJianwangProgress');
        if (progress) progress.hidden = true;
    }
}

function refreshJianwangAutoTargetProps(preserveSelection = true) {
    const optimizer = jianwangAutoModule();
    const routeSelect = document.getElementById('autoJianwangRoute');
    const propSelect = document.getElementById('autoJianwangTargetProp');
    if (!optimizer || !routeSelect || !propSelect || typeof EQUIP_DATA === 'undefined') return;
    const previous = preserveSelection ? propSelect.value : '';
    const props = optimizer.targetPropertiesForRoute(EQUIP_DATA, Number(routeSelect.value));
    propSelect.innerHTML = '';
    if (!props.length) {
        propSelect.appendChild(new Option('先选择镇派路线', ''));
        propSelect.disabled = true;
        return;
    }
    props.forEach(prop => propSelect.appendChild(new Option(EQUIP_DATA.propNames?.[prop] || prop, prop)));
    propSelect.disabled = false;
    propSelect.value = props.includes(previous) ? previous : props[0];
}

function updateJianwangAutoStartHint() {
    const hint = document.getElementById('autoJianwangStartHint');
    const message = document.getElementById('autoJianwangSelectionMessage');
    const routeId = Number(document.getElementById('autoJianwangRoute')?.value || 0);
    const optimizer = jianwangAutoModule();
    if (!hint || !optimizer) return;
    const sword = jianwangAutoSelectedSword();
    const startSelect = document.getElementById('autoJianwangStartSword');
    if (!sword) {
        if (startSelect?.value === '__provider__' && optimizer.hasFirstSwordProvider()) {
            hint.textContent = '当前存档没有剑王阁实物；将直接用 MakeRnd.RedSeeds[5707] 推演虚拟首把60级剑，再接续同一套升阶、保留、重铸与碎剑搜索。';
            if (message) {
                message.textContent = '';
                message.classList.remove('is-error');
            }
            return;
        }
        hint.textContent = '当前没有可用的剑王阁实物，且存档缺少有效 MakeRnd.RedSeeds[5707]，无法推演首剑序列。';
        if (message) {
            message.textContent = '当前存档没有可用的剑王阁起始状态。';
            message.classList.add('is-error');
        }
        return;
    }
    if (message) {
        message.textContent = '';
        message.classList.remove('is-error');
    }
    const id = Number(sword.id);
    if (id <= 5709) {
        hint.textContent = `从${optimizer.stageName(EQUIP_DATA, sword)}开始，按所选路线逐级升至90级；每一步已有目标词条时都会自动保留。`;
        return;
    }
    if (id >= 5714 && id <= 5717) {
        hint.textContent = '起始实物为100级神兵：直接碎神兵并生成下一把60级剑胚，再按所选路线进入搜索。';
        return;
    }
    const currentRoute = jianwangAutoRouteForId(id);
    if (routeId && currentRoute === routeId) {
        const counts = optimizer.extractReforgeCounts(state.saveData || {});
        const used = Number(counts[String(routeId)] || 0);
        hint.textContent = `起始实物与所选路线一致：先从当前进度继续剩余 ${Math.max(0, optimizer.JIANWANG_REFORGE_LIMIT - used)} 次90级重铸；仍未达成才碎剑进入下一把。`;
    } else {
        hint.textContent = '起始90级实物与所选路线不同：不会消耗这把剑的重铸次数，直接碎剑后从下一把60级剑胚进入所选路线。';
    }
}

function configureJianwangAutoFirstSwordProvider() {
    const optimizer = jianwangAutoModule();
    if (!optimizer) return;
    const redSeed = optimizer.extractRedSeed(state.saveData);
    const available = Number.isSafeInteger(Number(redSeed)) && Number(redSeed) > 0;
    optimizer.setFirstSwordProvider(available ? optimizer.redSeedFirstSwordProvider : null);
}

function refreshJianwangAutoSwords(preserveSelection = true) {
    const optimizer = jianwangAutoModule();
    const select = document.getElementById('autoJianwangStartSword');
    if (!optimizer || !select || typeof EQUIP_DATA === 'undefined') return;
    configureJianwangAutoFirstSwordProvider();
    const previous = preserveSelection ? select.value : '';
    jianwangAutoSwords = optimizer.collectSwords(state.saveData, EQUIP_DATA);
    select.innerHTML = '';
    if (jianwangAutoSwords.length) {
        jianwangAutoSwords.forEach(sword => select.appendChild(new Option(optimizer.swordLabel(EQUIP_DATA, sword), sword.key)));
        select.disabled = false;
        select.value = jianwangAutoSwords.some(sword => sword.key === previous) ? previous : jianwangAutoSwords[0].key;
    } else if (optimizer.hasFirstSwordProvider()) {
        select.appendChild(new Option('虛擬劍胚 · 由存档 RedSeeds[5707] 推演', '__provider__'));
        select.disabled = false;
        select.value = '__provider__';
    } else {
        select.appendChild(new Option('暂无剑王阁实物', ''));
        select.disabled = true;
    }
    updateJianwangAutoStartHint();
}

function initializeJianwangAutoControls() {
    const optimizer = jianwangAutoModule();
    const routeSelect = document.getElementById('autoJianwangRoute');
    if (!optimizer || !routeSelect || typeof EQUIP_DATA === 'undefined') return;
    routeSelect.innerHTML = '';
    optimizer.routeOptions(EQUIP_DATA).forEach(route => routeSelect.appendChild(new Option(route.name, String(route.id))));
    if (routeSelect.options.length) routeSelect.value = routeSelect.options[0].value;
    refreshJianwangAutoTargetProps(false);
    refreshJianwangAutoSwords(false);
}

function setJianwangAutoInputsDisabled(disabled) {
    ['autoJianwangStartSword', 'autoJianwangRoute', 'autoJianwangTargetProp', 'autoJianwangTargetCount', 'autoJianwangMaxSwords'].forEach(id => {
        const element = document.getElementById(id);
        if (element) element.disabled = !!disabled || (id === 'autoJianwangStartSword' && !jianwangAutoSwords.length && !jianwangAutoModule()?.hasFirstSwordProvider());
    });
}

function renderJianwangAutoProgress(progress) {
    const panel = document.getElementById('autoJianwangProgress');
    const text = document.getElementById('autoJianwangProgressText');
    const percent = document.getElementById('autoJianwangProgressPercent');
    const fill = document.getElementById('autoJianwangProgressFill');
    if (!panel) return;
    const total = Math.max(1, Number(progress?.total || 1));
    const done = Math.max(0, Number(progress?.done || 0));
    const value = Math.max(0, Math.min(100, Math.round(done / total * 100)));
    panel.hidden = false;
    if (text) text.textContent = progress?.message || '正在搜索…';
    if (percent) percent.textContent = `${value}%`;
    if (fill) fill.style.width = `${value}%`;
}

function jianwangAutoFormatExt(ext) {
    if (!ext) return '';
    const label = EQUIP_DATA?.propNames?.[ext.prop] || ext.prop || '未知词条';
    return `${escapeAiHtml(label)}+${escapeAiHtml(equipAutoFormatPropValue(ext.prop, ext.value))}`;
}

function jianwangAutoFormatExts(exts) {
    if (!Array.isArray(exts) || !exts.length) return '无';
    return exts.slice(0, 4).map(jianwangAutoFormatExt).join('、');
}

function jianwangAutoStepLabel(step) {
    if (step.type === 'blank') return `碎剑后生成${step.toName || '60级剑胚'}`;
    if (step.type === 'reforge') return `第 ${Number(step.reforgeAttempt || 0)} 次重铸`;
    return `${step.fromName || step.fromId} → ${step.toName || step.toId}`;
}

function jianwangAutoResourceName(itemId) {
    const optimizer = jianwangAutoModule();
    const key = String(itemId);
    return optimizer?.JIANWANG_RESOURCE_NAMES?.[key] || EQUIP_DATA?.itemNames?.[key] || `材料${key}`;
}

function jianwangAutoResourceRows(resources) {
    const net = resources?.netMaterials || {};
    const positive = [];
    const negative = [];
    Object.entries(net)
        .sort((a, b) => Number(a[0]) - Number(b[0]))
        .forEach(([itemId, raw]) => {
            const amount = Number(raw) || 0;
            if (!amount) return;
            const text = `${jianwangAutoResourceName(itemId)}×${Math.abs(amount).toLocaleString()}`;
            if (amount > 0) positive.push(text);
            else negative.push(text);
        });
    return { positive, negative };
}

function jianwangAutoShatterCount(metrics) {
    if (Number.isFinite(Number(metrics?.shatters))) return Number(metrics.shatters) || 0;
    return (Number(metrics?.shatter90) || 0) + (Number(metrics?.shatter100) || 0);
}

function jianwangAutoRenderResources(metrics, resources, compact = false) {
    const rows = jianwangAutoResourceRows(resources);
    const metricsHtml = `<div class="jianwang-auto-metrics${compact ? ' is-compact' : ''}">
        <div><b>${jianwangAutoShatterCount(metrics).toLocaleString()}</b><span>碎剑次数</span></div>
        <div><b>${Number(resources?.contribution || 0).toLocaleString()}</b><span>贡献消耗</span></div>
        <div><b>${Number(resources?.swordIntent || 0).toLocaleString()}</b><span>剑意消耗</span></div>
        <div><b>${Number(resources?.qi || 0).toLocaleString()}</b><span>真气消耗</span></div>
    </div>`;
    const needText = rows.positive.length ? rows.positive.join('、') : '无额外材料净需求';
    const returnText = rows.negative.length ? rows.negative.join('、') : '无材料净返还';
    return `${metricsHtml}<div class="jianwang-auto-resource-summary${compact ? ' is-compact' : ''}">
        <div><strong>材料净需求</strong><span>${escapeAiHtml(needText)}</span></div>
        <div><strong>碎剑净返还</strong><span>${escapeAiHtml(returnText)}</span></div>
    </div>`;
}

function jianwangAutoTargetSummary(result) {
    const targetMode = result?.targetMode || (Number(result?.targetCount || 4) === 3 ? 'tail3' : 'all4');
    const names = Array.isArray(result?.targetNames) && result.targetNames.length
        ? result.targetNames
        : String(result?.targetName || '').split(' / ').filter(Boolean);
    const label = targetMode === 'any3'
        ? '任意3个词条相同'
        : targetMode === 'all4'
            ? '4条相同（词条1/2/3/4）'
            : '后3词条相同（词条2/3/4）';
    return `${label}${names.length ? ` · ${names.join(' / ')}` : ''}`;
}

function jianwangAutoSwordResultLabel(result) {
    if (result?.startedFromCurrent) {
        if (result?.startSword?._jianwangVirtualFirst) {
            return `第 ${Math.max(1, Number(result.swordOrdinal || 1)).toLocaleString()} 把虛擬劍胚`;
        }
        return '当前起始剑';
    }
    return `第 ${Number(result?.swordOrdinal || 0).toLocaleString()} 把新剑`;
}

function jianwangAutoRenderPath(path) {
    if (!Array.isArray(path) || !path.length) return '';
    return `<ol class="jianwang-auto-path">${path.map((step, index) => {
        const keepText = step.kept ? `保留 ${jianwangAutoFormatExt(step.kept)}` : '不保留';
        const seedText = step.type === 'blank'
            ? `RedSeed ${Number(step.redSeedBefore || 0)} → ${Number(step.redSeedAfter || 0)} · 初始 CZSeed ${Number(step.seedAfter || 0)}`
            : `CZSeed ${Number(step.seedBefore || 0)} → ${Number(step.seedAfter || 0)}`;
        return `<li class="jianwang-auto-path-step">
            <div class="jianwang-auto-step-head"><b>${index + 1}. ${escapeAiHtml(jianwangAutoStepLabel(step))}</b><span>${keepText}</span></div>
            <div class="jianwang-auto-step-meta">${escapeAiHtml(seedText)}</div>
            <div class="jianwang-auto-step-exts">${jianwangAutoFormatExts(step.exts)}</div>
        </li>`;
    }).join('')}</ol>`;
}

function bindJianwangAutoResultPager(pageCount) {
    const previous = document.getElementById('btnJianwangAutoResultPrev');
    const next = document.getElementById('btnJianwangAutoResultNext');
    previous?.addEventListener('click', () => {
        if (jianwangAutoResultPage <= 1 || !jianwangAutoLastResult) return;
        jianwangAutoResultPage -= 1;
        renderJianwangAutoResult(jianwangAutoLastResult);
    });
    next?.addEventListener('click', () => {
        if (jianwangAutoResultPage >= pageCount || !jianwangAutoLastResult) return;
        jianwangAutoResultPage += 1;
        renderJianwangAutoResult(jianwangAutoLastResult);
    });
}

function renderJianwangAutoResult(result) {
    const container = document.getElementById('autoJianwangResults');
    if (!container) return;
    if (!result) {
        container.innerHTML = '<div class="ai-result-empty">暂无结果。</div>';
        return;
    }
    const metrics = result.metrics || {};
    const resources = result.resources || {};
    const matches = Array.isArray(result.matches) ? result.matches : [];
    const cancelledWithMatches = result.status === 'cancelled' && matches.length > 0;
    if (result.status === 'cancelled' && !cancelledWithMatches) {
        container.innerHTML = `<div class="jianwang-auto-summary is-limit"><strong>已取消计算</strong><span>${escapeAiHtml(result.reason || '')}</span></div>${jianwangAutoRenderResources(metrics, resources)}`;
        return;
    }
    if (result.status === 'unreachable') {
        container.innerHTML = `<div class="ai-result-error">${escapeAiHtml(result.reason || '当前序列无法达成所选目标。')}</div>`;
        return;
    }
    if (result.status === 'multi-success' || cancelledWithMatches) {
        const totalPages = Math.max(1, Math.ceil(matches.length / JIANWANG_AUTO_RESULT_PAGE_SIZE));
        jianwangAutoResultPage = Math.max(1, Math.min(totalPages, Number(jianwangAutoResultPage) || 1));
        const startIndex = (jianwangAutoResultPage - 1) * JIANWANG_AUTO_RESULT_PAGE_SIZE;
        const pageMatches = matches.slice(startIndex, startIndex + JIANWANG_AUTO_RESULT_PAGE_SIZE);
        const cards = pageMatches.map((match, localIndex) => {
            const globalIndex = startIndex + localIndex;
            const swordText = jianwangAutoSwordResultLabel(match);
            const pathHtml = jianwangAutoRenderPath(match.path);
            const detailsBody = pathHtml
                ? `<div class="jianwang-auto-path-wrap"><h3>命中流程</h3>${pathHtml}</div>`
                : '<p class="jianwang-auto-compact-note">双词条筛选为长程扫描，仅保存命中状态与达成时累计资源，不保存每一把剑的完整中间路径。</p>';
            return `<details class="jianwang-auto-path-wrap" ${localIndex === 0 ? 'open' : ''}>
                <summary><strong>第 ${globalIndex + 1} 笔命中</strong> · ${escapeAiHtml(swordText)} · ${escapeAiHtml(match.finalAction || '')}</summary>
                <div class="jianwang-auto-final"><strong>词条</strong><span>${jianwangAutoFormatExts(match.finalEquip?.exts || [])}</span></div>
                ${jianwangAutoRenderResources(match.metrics || {}, match.resources || {}, true)}
                ${detailsBody}
            </details>`;
        }).join('');
        const pager = totalPages > 1 ? `<div class="pager-bar equip-auto-result-pager jianwang-auto-result-pager">
            <div class="equip-auto-pager-controls">
                <button id="btnJianwangAutoResultPrev" class="btn equip-auto-pager-button" type="button" ${jianwangAutoResultPage <= 1 ? 'disabled' : ''}>上一页</button>
                <span class="meta-text">第 ${jianwangAutoResultPage}/${totalPages} 页 · 共 ${matches.length.toLocaleString()} 笔</span>
                <button id="btnJianwangAutoResultNext" class="btn equip-auto-pager-button" type="button" ${jianwangAutoResultPage >= totalPages ? 'disabled' : ''}>下一页</button>
                <span class="pager-size">每页最多 ${JIANWANG_AUTO_RESULT_PAGE_SIZE} 笔</span>
            </div>
        </div>` : '';
        const reason = result.status === 'cancelled'
            ? `已取消计算；取消前共找到 ${matches.length.toLocaleString()} 笔命中结果。`
            : (result.reason || `找到 ${matches.length} 笔命中结果`);
        container.innerHTML = `<div class="jianwang-auto-summary${result.status === 'cancelled' ? ' is-limit' : ''}">
            <div><span class="ai-route-strength">命中结果</span><strong>${escapeAiHtml(result.routeName || '')} · ${escapeAiHtml(jianwangAutoTargetSummary(result))}</strong></div>
            <p>${escapeAiHtml(reason)}</p>
            <p class="jianwang-auto-start-line">起点：${escapeAiHtml(result.startSwordLabel || '')}</p>
        </div>
        ${jianwangAutoRenderResources(metrics, resources)}
        <div class="jianwang-auto-path-wrap"><h3>命中记录</h3></div>
        ${cards}${pager}`;
        bindJianwangAutoResultPager(totalPages);
        return;
    }
    if (result.status === 'limit') {
        container.innerHTML = `<div class="jianwang-auto-summary is-limit">
            <strong>${escapeAiHtml(result.reason || '已达到最大模拟次数')}</strong>
            <span>${escapeAiHtml(jianwangAutoTargetSummary(result))}</span>
        </div>${jianwangAutoRenderResources(metrics, resources)}`;
        return;
    }
    if (result.status !== 'success') {
        container.innerHTML = `<div class="ai-result-error">${escapeAiHtml(result.reason || '计算未返回可用结果。')}</div>`;
        return;
    }
    const swordText = jianwangAutoSwordResultLabel(result);
    const finalExts = jianwangAutoFormatExts(result.finalEquip?.exts || []);
    const pathHtml = jianwangAutoRenderPath(result.path);
    container.innerHTML = `<div class="jianwang-auto-summary">
        <div><span class="ai-route-strength">找到结果</span><strong>${escapeAiHtml(result.routeName || '')} · ${escapeAiHtml(jianwangAutoTargetSummary(result))}</strong></div>
        <p>${escapeAiHtml(swordText)}达成 · ${escapeAiHtml(result.finalAction || '')}</p>
        <p class="jianwang-auto-start-line">起点：${escapeAiHtml(result.startSwordLabel || '')}</p>
    </div>
    ${jianwangAutoRenderResources(metrics, resources)}
    <div class="jianwang-auto-final"><strong>最终词条</strong><span>${finalExts}</span></div>
    ${pathHtml ? `<div class="jianwang-auto-path-wrap"><h3>成功剑详细流程</h3>${pathHtml}</div>` : ''}`;
}

function validateJianwangAutoSelection() {
    const optimizer = jianwangAutoModule();
    if (!optimizer) throw new Error('剑王阁自动模拟模块未加载');
    if (!state.saveData) throw new Error('请先导入存档');
    const routeId = Number(document.getElementById('autoJianwangRoute')?.value || 0);
    const targetProp = String(document.getElementById('autoJianwangTargetProp')?.value || '');
    const targetProps = [targetProp].filter(Boolean);
    const targetMode = String(document.getElementById('autoJianwangTargetCount')?.value || 'tail3');
    const maxSwords = clampAiNumber('autoJianwangMaxSwords', 1, optimizer.MAX_SIMULATED_SWORDS, 500);
    if (!routeId) throw new Error('请选择90级镇派路线');
    if (!targetProp) throw new Error('请选择词条');
    if (targetMode !== 'tail3' && targetMode !== 'any3') throw new Error('请选择有效的筛选目标');
    const select = document.getElementById('autoJianwangStartSword');
    if (!select?.value && !optimizer.hasFirstSwordProvider()) throw new Error('请选择起始剑');
    return {
        saveData: state.saveData,
        equipData: EQUIP_DATA,
        startSwordKey: select?.value === '__provider__' ? null : select?.value,
        routeId,
        targetProp: targetProps[0],
        targetProps,
        targetCount: 3,
        targetMode,
        maxSwords,
    };
}

async function runJianwangAutoSimulation() {
    if (jianwangAutoRunning) return;
    const message = document.getElementById('autoJianwangSelectionMessage');
    const predict = document.getElementById('btnAutoJianwangPredict');
    const cancel = document.getElementById('btnAutoJianwangCancel');
    let input;
    try {
        input = validateJianwangAutoSelection();
    } catch (error) {
        if (message) {
            message.textContent = error?.message || String(error);
            message.classList.add('is-error');
        }
        return;
    }
    if (message) {
        message.textContent = '';
        message.classList.remove('is-error');
    }
    jianwangAutoRunning = true;
    jianwangAutoCancelRequested = false;
    jianwangAutoResultPage = 1;
    const runToken = ++jianwangAutoRunToken;
    setJianwangAutoInputsDisabled(true);
    if (predict) {
        predict.disabled = true;
        predict.textContent = '正在搜索…';
    }
    if (cancel) {
        cancel.hidden = false;
        cancel.disabled = false;
        cancel.textContent = '取消计算';
    }
    renderJianwangAutoProgress({ done: 0, total: input.maxSwords, message: '正在检查起始剑并准备搜索…' });
    const results = document.getElementById('autoJianwangResults');
    if (results) results.innerHTML = '<div class="ai-result-empty">正在本地推演，失败剑只累计次数，不会全部保存在页面中。</div>';
    try {
        const result = await JianwangAutoOptimizer.searchAsync({
            ...input,
            batchSize: 40,
            shouldCancel: () => jianwangAutoCancelRequested || runToken !== jianwangAutoRunToken,
            onProgress: progress => {
                if (runToken === jianwangAutoRunToken) renderJianwangAutoProgress(progress);
            },
        });
        if (runToken !== jianwangAutoRunToken) return;
        jianwangAutoLastResult = result;
        renderJianwangAutoResult(result);
        const progress = document.getElementById('autoJianwangProgress');
        if (progress && result.status !== 'limit') progress.hidden = true;
    } catch (error) {
        console.error('剑王阁自动模拟失败:', error);
        if (runToken === jianwangAutoRunToken && results) {
            results.innerHTML = `<div class="ai-result-error">计算失败：${escapeAiHtml(error?.message || error)}</div>`;
        }
        const progress = document.getElementById('autoJianwangProgress');
        if (progress) progress.hidden = true;
    } finally {
        if (runToken === jianwangAutoRunToken) {
            jianwangAutoRunning = false;
            setJianwangAutoInputsDisabled(false);
            if (predict) {
                predict.disabled = false;
                predict.textContent = '重新剑王阁自动模拟';
            }
            if (cancel) {
                cancel.hidden = true;
                cancel.disabled = false;
                cancel.textContent = '取消计算';
            }
        }
    }
}

function cancelJianwangAutoSimulation() {
    if (!jianwangAutoRunning) return;
    jianwangAutoCancelRequested = true;
    const button = document.getElementById('btnAutoJianwangCancel');
    const text = document.getElementById('autoJianwangProgressText');
    if (button) {
        button.disabled = true;
        button.textContent = '正在停止…';
    }
    if (text) text.textContent = '当前剑计算结束后停止…';
}

window.refreshJianwangAutoStartSwords = refreshJianwangAutoSwords;

function applySimulatorView() {
    const isAutoView = window.YYJH_SIMULATOR_VIEW === 'auto'
        || new URLSearchParams(window.location.search).get('view') === 'auto';
    const root = document.documentElement;
    const pageTitle = document.getElementById('simulatorPageTitle');
    const pageSubtitle = document.getElementById('simulatorPageSubtitle');
    const washNav = document.getElementById('navWashSimulator');
    const autoNav = document.getElementById('navAutoSimulator');

    root.classList.toggle('auto-simulator-view', isAutoView);
    if (pageTitle) pageTitle.textContent = isAutoView ? '自动模拟' : '洗髓模拟器';
    if (pageSubtitle) pageSubtitle.textContent = isAutoView ? '烟雨江湖 · 本地存档模拟' : '烟雨江湖 · 天赋洗炼';
    document.title = isAutoView ? '烟雨江湖 · 自动模拟' : '烟雨江湖 · 洗髓模拟器';

    [washNav, autoNav].forEach(link => {
        if (!link) return;
        link.classList.remove('active');
        link.removeAttribute('aria-current');
    });
    const activeNav = isAutoView ? autoNav : washNav;
    if (activeNav) {
        activeNav.classList.add('active');
        activeNav.setAttribute('aria-current', 'page');
    }
    return isAutoView;
}

/**
 * 装备 / 剑王阁相关初始化。
 * 洗脉页只加载 wash 内核，equipment / jianwang 模块并不存在，
 * 因此这里全部按「尽力而为」处理：任何一步失败都只记录警告，绝不能中断洗脉主流程。
 */
function initEquipExtrasBestEffort() {
    if (typeof EQUIP_DATA === 'undefined') return;

    try {
        if (!wasmMakeInitTables(EQUIP_DATA)) {
            console.warn('装备表注入失败，装备自动模拟不可用');
        }
    } catch (error) {
        console.warn('装备表注入跳过（当前仅加载洗脉内核）：', error?.message || error);
        const message = document.getElementById('autoEquipSelectionMessage');
        if (message) {
            message.textContent = '当前只加载洗脉内核，装备自动模拟不可用。';
            message.classList.add('is-error');
        }
        return;
    }

    try {
        initializeEquipAutoControls();
    } catch (error) {
        console.warn('装备自动控件初始化跳过：', error?.message || error);
    }
    try {
        initializeJianwangAutoControls();
    } catch (error) {
        console.warn('剑王阁自动控件初始化跳过：', error?.message || error);
    }
}

async function initApp() {
    applySimulatorView();

    const impEl = document.getElementById('saveFileInput');
    if (impEl) impEl.addEventListener('change', (e) => {
        if (e.target.files && e.target.files[0]) {
            handleSaveFileImport(e.target.files[0]);
        }
    });

    if (typeof markNavTransition === 'function') {
        document.querySelectorAll('header a[href*=".html"]').forEach(a => {
            a.addEventListener('click', () => markNavTransition());
        });
    }

    console.log('[洗脉内核诊断]', {
        RuntimeAssetLoader: typeof RuntimeAssetLoader,
        AlgorithmWasmBridge: typeof AlgorithmWasmBridge,
        wasmFirstPityJumpCandidates: typeof (typeof wasmFirstPityJumpCandidates !== 'undefined' ? wasmFirstPityJumpCandidates : undefined),
        WASH_ENGINE_WASM_B64: typeof window.WASH_ENGINE_WASM_B64,
        b64长度: (window.WASH_ENGINE_WASM_B64 || '').length,
        YYJH_WASM_MODULES: window.YYJH_WASM_MODULES,
        CORE_VERSION: window.CORE_VERSION,
        TALENT_DATA: typeof (typeof TALENT_DATA !== 'undefined' ? TALENT_DATA : undefined),
    });

    // 存档加载不依赖 wasm，所以放在内核初始化之前：内核起不来也不影响角色列表
    // （只有洗髓/预测才需要内核；依赖角色列表的页面不该被内核拖住）。
    if (typeof loadShareStore === 'function') {
        const shared = loadShareStore();
        if (shared && shared.data) {
            try {
                state.saveVersion = shared.meta.version || '';
                state.savePlatform = shared.meta.platform || '';
                state.saveChannel = normalizeSaveChannel(shared.meta.channel, shared.meta.platform);
                state.saveFormat = shared.meta.format || 'json';
                state.saveColumns = shared.meta.columns || null;
                state.saveRow = shared.meta.row || null;
                if (typeof _applyDlcByPlatform === 'function') _applyDlcByPlatform(shared.meta.platform);
                loadParsedSaveData(shared.data, true);
            } catch (e) {
                console.warn('自动加载共享存档失败:', e);
            }
        }
    }

    let ok = false;
    try {
        ok = await initWasm();
    } catch (error) {
        ok = false;
        console.error('[initWasm] 洗脉内核初始化异常：', error);
        alert('洗脉内核初始化失败：' + (error?.message || error));
    }
    if (!ok) {
        console.error('[initApp] 洗脉内核未就绪，跳过 wasm 相关初始化，其余功能继续。');
        alert('WebAssembly 模块加载失败：洗髓/预测功能不可用（存档与角色列表不受影响）');
    } else {
        try {
            wasmInitEngine(TALENT_DATA, _buildZZDataForWasm());
            initEquipExtrasBestEffort();
        } catch (error) {
            console.error('[initApp] 内核引擎初始化失败，其余功能继续：', error);
        }
    }

    const dlcCheck = document.getElementById('dlcModeCheck');
    if (dlcCheck) {
        dlcCheck.checked = !!state.dlcMode;
        dlcCheck.addEventListener('change', () => applyDlcMode(dlcCheck.checked));
    }

    document.getElementById('btnWashOnce')?.addEventListener('click', washOnce);
    document.getElementById('btnWash10')?.addEventListener('click', () => washMulti(10));
    document.getElementById('btnWash100')?.addEventListener('click', () => washMulti(100));
    document.getElementById('btnWashUntilGold')?.addEventListener('click', washUntilGold);
    const btnWashUntilGoldMinusN = document.getElementById('btnWashUntilGoldMinusN');
    if (btnWashUntilGoldMinusN) {
        btnWashUntilGoldMinusN.addEventListener('click', (event) => {
            // 点击内嵌的 N 输入框时不触发主按钮
            if (event.target && event.target.id === 'washUntilGoldMinusNInput') return;
            washUntilGoldMinusN();
        });
    }
    const washMinusNInput = document.getElementById('washUntilGoldMinusNInput');
    if (washMinusNInput) {
        washMinusNInput.addEventListener('click', (e) => e.stopPropagation());
        washMinusNInput.addEventListener('keydown', (e) => {
            if (e.key === 'Enter') { e.preventDefault(); washUntilGoldMinusN(); }
        });
    }
    const btnOpStart = document.getElementById('btnOpRecordStart');
    if (btnOpStart) btnOpStart.addEventListener('click', opRecordStart);
    const btnOpStop = document.getElementById('btnOpRecordStop');
    if (btnOpStop) btnOpStop.addEventListener('click', opRecordStop);
    const btnOpPause = document.getElementById('btnOpRecordPause');
    if (btnOpPause) btnOpPause.addEventListener('click', opRecordTogglePause);
    const btnOpWriteSeq = document.getElementById('btnOpRecordWriteSeq');
    if (btnOpWriteSeq) btnOpWriteSeq.addEventListener('click', opRecordWriteSeq);
    document.querySelectorAll('.btn-op-snapshot-save').forEach(b => {
        b.addEventListener('click', () => opSaveSnapshotSlot(b.dataset.slot));
    });
    document.querySelectorAll('.btn-op-snapshot-restore').forEach(b => {
        b.addEventListener('click', () => opRestoreSnapshotSlot(b.dataset.slot));
    });
    const btnOpSnapshotAdd = document.getElementById('btnOpSnapshotAdd');
    if (btnOpSnapshotAdd) btnOpSnapshotAdd.addEventListener('click', opAddSnapshotSlot);
    document.querySelectorAll('.btn-op-snapshot-delete').forEach(b => {
        b.addEventListener('click', () => opDeleteSnapshotSlot(b.dataset.slot));
    });
    initOpSnapshotDesc();
    renderOpSnapshotSlots();
    // 存档面板标题点击 → 展开/折叠（默认折叠）
    const opSnapHeader = document.querySelector('.op-snapshot-header');
    if (opSnapHeader) {
        opSnapHeader.addEventListener('click', () => {
            const panel = document.getElementById('opSnapshotPanel');
            if (panel) panel.classList.toggle('is-collapsed');
        });
    }
    const btnOpDl = document.getElementById('btnOpRecordDownload');
    if (btnOpDl) btnOpDl.addEventListener('click', downloadOpRecord);
    const btnOpReplay = document.getElementById('btnOpReplay');
    if (btnOpReplay) {
        btnOpReplay.addEventListener('click', () => {
            const el = document.getElementById('opReplayStep');
            let n = Math.trunc(Number(el?.value ?? 15));
            if (!Number.isFinite(n)) n = 15;
            opReplayRun(n);
        });
    }
    const btnResetRole = document.getElementById('btnResetCurrentRole');
    if (btnResetRole) btnResetRole.addEventListener('click', resetCurrentRole);
    const btnSyncPill = document.getElementById('btnSyncBagPill');
    if (btnSyncPill) btnSyncPill.addEventListener('click', syncBagPillByConsume);
    // 导入 TXT 日志：解析后显示总步数，并把「到步骤」上限/默认值设为总步数
    const opReplayFile = document.getElementById('opReplayFile');
    if (opReplayFile) {
        opReplayFile.addEventListener('change', (e) => {
            const f = e.target.files && e.target.files[0];
            if (!f) return;
            const reader = new FileReader();
            reader.onload = () => {
                opReplaySource = String(reader.result || '');
                const parsed = opReplayParse(opReplaySource);
                const total = parsed.length;
                const stepInput = document.getElementById('opReplayStep');
                if (stepInput) {
                    stepInput.max = String(Math.max(1, total));
                    if (!Number(stepInput.value) || Number(stepInput.value) > total) {
                        stepInput.value = String(Math.max(1, total));
                    }
                }
                const st = document.getElementById('opRecordStatus');
                if (st) {
                    st.textContent = total
                        ? `已导入「${f.name}」· 共 ${total} 步 · 选步骤后点「执行日志」`
                        : `「${f.name}」未解析到步骤，请确认是操作日志 TXT`;
                }
                if (!total) console.warn('[op-replay] 导入文件无有效步骤：', opReplaySource.slice(0, 300));
            };
            reader.onerror = () => {
                const st = document.getElementById('opRecordStatus');
                if (st) st.textContent = '文件读取失败';
            };
            reader.readAsText(f, 'utf-8');
        });
    }
    document.getElementById('btnClearLog')?.addEventListener('click', clearLog);
    const btnExport = document.getElementById('btnExportLog');
    if (btnExport) btnExport.addEventListener('click', exportWashHistory);

    document.getElementById('btnHistoryPrev')?.addEventListener('click', () => {
        if (historyPage > 1) {
            historyPage -= 1;
            renderHistoryPage();
        }
    });
    document.getElementById('btnHistoryNext')?.addEventListener('click', () => {
        historyPage += 1;
        renderHistoryPage();
    });
    document.getElementById('historyPageSize')?.addEventListener('change', () => {
        historyPage = 1;
        renderHistoryPage();
    });

    const btnWashCustom = document.getElementById('btnWashCustom');
    if (btnWashCustom) btnWashCustom.addEventListener('click', washCustom);

    const customWashInput = document.getElementById('customWashInput');
    if (customWashInput) {
        customWashInput.addEventListener('input', (e) => {
            const numSpan = document.getElementById('customWashNum');
            if (numSpan) numSpan.textContent = e.target.value || '500';
        });
    }

    const btnExchangeSequenceFinder = document.getElementById('btnExchangeSequenceFinder');
    if (btnExchangeSequenceFinder) btnExchangeSequenceFinder.addEventListener('click', openExchangeSequenceFinderModal);

    const btnCloseExchangeSequenceModal = document.getElementById('btnCloseExchangeSequenceModal');
    if (btnCloseExchangeSequenceModal) btnCloseExchangeSequenceModal.addEventListener('click', closeExchangeSequenceFinderModal);

    const exchangeSequenceModal = document.getElementById('exchangeSequenceModal');
    if (exchangeSequenceModal) {
        exchangeSequenceModal.addEventListener('click', (event) => {
            if (event.target === exchangeSequenceModal) closeExchangeSequenceFinderModal();
        });
    }

    document.getElementById('exchangeSequenceRoleSelect')?.addEventListener('change', () => {
        window.exchangeSequenceLastRoleKey = document.getElementById('exchangeSequenceRoleSelect')?.value || '';
        void populateExchangeSequencePurples();
    });
    document.getElementById('exchangeSequenceQueryMode')?.addEventListener('change', () => {
        setFirstPityJumpSimulationButtonState();
        populateExchangeSequenceRoles();
    });
    ['exchangeSequenceShenmaiFirstSelect', 'exchangeSequenceShenmaiSecondSelect', 'exchangeSequenceOwnedSelect'].forEach(id => {
        document.getElementById(id)?.addEventListener('change', () => {
            clearExchangeSequenceResults();
            updateExchangeSequenceSelection();
        });
    });
    document.getElementById('exchangeSequenceJumpSlots')?.addEventListener('change', () => {
        // 槽位数变了，所有角色的跳脉缓存、锚点列表与去重进度全部作废重算
        (exchangeSequenceDataset.roles || []).forEach(role => {
            role.jumpAnalysis = null;
            role.jumpCandidatesReady = false;
            role.jumpWorkingState = null;
            role.jumpSteps = [];
            role.jumpPills = 0;
            role.jumpDedups = 0;
            role.jumpDedupStack = [];
            role.jumpTargetPurples = [];
            role.jumpTargetPurplesReady = false;
            role.jumpTargetIndex = 0;
        });
        updateJumpDedupControls(selectedExchangeSequenceRole());
        setFirstPityJumpSimulationButtonState();
        void populateExchangeSequencePurples();
    });

    document.getElementById('exchangeSequenceJumpPurpleSelect')?.addEventListener('change', () => {
        const role = selectedExchangeSequenceRole();
        if (!role) return;
        role.jumpTargetIndex = Math.max(0, Math.trunc(Number(document.getElementById('exchangeSequenceJumpPurpleSelect')?.value) || 0));
        // 切换锚点 = 一次全新分析，清掉之前的去重进度（避免两套种子混淆）
        role.jumpCandidatesReady = false;
        role.jumpWorkingState = null;
        role.jumpSteps = [];
        role.jumpPills = 0;
        role.jumpDedups = 0;
        role.jumpDedupStack = [];
        updateJumpDedupControls(role);
        const token = ++exchangeSequenceCandidateLoadToken;
        void populateFirstPityJumpCandidates(token, role, document.getElementById('exchangeSequenceStatus'));
    });

    document.getElementById('exchangeSequenceJumpDedupUndo')?.addEventListener('click', jumpDedupUndo);
    document.getElementById('exchangeSequenceJumpDedupReset')?.addEventListener('click', jumpDedupReset);

    document.getElementById('exchangeSequencePurpleSelect')?.addEventListener('change', () => {
        clearExchangeSequenceResults();
        syncExchangeSequencePurpleIndexInput(selectedExchangeSequenceRole());
        updateExchangeSequenceSelection();
    });
    // 「紫后第n条置换序列」：点击输入框自动 +1（默认 0 起，步进箭头已用 CSS 隐藏）
    const exchangePadInput = document.getElementById('exchangeSequencePadInput');
    if (exchangePadInput) {
        exchangePadInput.addEventListener('click', () => {
            const cur = Math.trunc(Number(exchangePadInput.value));
            const next = Math.max(0, Math.min(EXCHANGE_SEQUENCE_PAD_MAX, (Number.isFinite(cur) ? cur : 0) + 1));
            exchangePadInput.value = String(next);
        });
    }
    document.getElementById('exchangeSequencePurpleIndexInput')?.addEventListener('change', () => {
        const select = document.getElementById('exchangeSequencePurpleSelect');
        const input = document.getElementById('exchangeSequencePurpleIndexInput');
        const role = selectedExchangeSequenceRole();
        if (!select || !input || !role?.candidates?.length) return;
        let idx = Math.trunc(Number(input.value)) - 1;
        idx = Math.max(0, Math.min(role.candidates.length - 1, idx));
        select.value = String(idx);
        input.value = String(idx + 1);
        clearExchangeSequenceResults();
        updateExchangeSequenceSelection();
    });
    document.getElementById('btnGenerateExchangeSequence')?.addEventListener('click', generateExchangeSequence);
    document.getElementById('btnDownloadExchangeSequence')?.addEventListener('click', downloadExchangeSequenceAll);
    document.getElementById('btnFilterExchangeSequence')?.addEventListener('click', openExchangeFilterModal);
    document.getElementById('btnRunExchangeFilter')?.addEventListener('click', runExchangeSequenceFilter);
    renderExchangeFilterCards();
    document.getElementById('exchangeFilterModeInclude')?.addEventListener('click', () => setExchangeFilterMode('include'));
    document.getElementById('exchangeFilterModeExclude')?.addEventListener('click', () => setExchangeFilterMode('exclude'));
    document.getElementById('btnClearExchangeFilter')?.addEventListener('click', clearExchangeFilterResult);

    const btnCloseExchangeFilterModal = document.getElementById('btnCloseExchangeFilterModal');
    if (btnCloseExchangeFilterModal) btnCloseExchangeFilterModal.addEventListener('click', closeExchangeFilterModal);
    const exchangeFilterModal = document.getElementById('exchangeFilterModal');
    if (exchangeFilterModal) {
        exchangeFilterModal.addEventListener('click', (event) => {
            if (event.target === exchangeFilterModal) closeExchangeFilterModal();
        });
    }

    document.addEventListener('keydown', (event) => {
        if (event.key === 'Escape') {
            const filterModal = document.getElementById('exchangeFilterModal');
            if (filterModal && !filterModal.hidden) {
                closeExchangeFilterModal();
                return;
            }
            if (exchangeSequenceModal && !exchangeSequenceModal.hidden) {
                closeExchangeSequenceFinderModal();
            }
        }
    });

    const btnAnalyzePurple = document.getElementById('btnAnalyzePurple');
    if (btnAnalyzePurple) btnAnalyzePurple.addEventListener('click', openPurpleAnalysisModal);

    const btnBuildPulseRecord = document.getElementById('btnBuildPulseRecord');
    if (btnBuildPulseRecord) btnBuildPulseRecord.addEventListener('click', buildPulseRecord);

    const pulsePillsInput = document.getElementById('pulsePillsInput');
    if (pulsePillsInput) {
        pulsePillsInput.addEventListener('input', () => { pulsePillsEdited = true; });
        syncPulsePillsInput();
    }

    const btnClosePurpleModal = document.getElementById('btnClosePurpleModal');
    if (btnClosePurpleModal) btnClosePurpleModal.addEventListener('click', closePurpleAnalysisModal);

    const purpleModal = document.getElementById('purpleModal');
    if (purpleModal) {
        purpleModal.addEventListener('click', (e) => {
            if (e.target === purpleModal) closePurpleAnalysisModal();
        });
    }

    const purpleModalCountInput = document.getElementById('purpleModalCountInput');
    if (purpleModalCountInput) purpleModalCountInput.addEventListener('change', generatePurpleReaderSequence);

    const btnRefreshPurpleModal = document.getElementById('btnRefreshPurpleModal');
    if (btnRefreshPurpleModal) btnRefreshPurpleModal.addEventListener('click', generatePurpleReaderSequence);

    const btnFindNextConflict = document.getElementById('btnFindNextConflict');
    if (btnFindNextConflict) {
        btnFindNextConflict.addEventListener('click', () => {
            const after = parseInt(document.getElementById('nextConflictAfterWash')?.value || '0', 10);
            findAndShowNextConflict(Number.isNaN(after) ? 0 : after);
        });
    }
    const btnNextFromCurrent = document.getElementById('btnNextConflictFromCurrent');
    if (btnNextFromCurrent) {
        btnNextFromCurrent.addEventListener('click', () => {
            findAndShowNextConflict(state.totalTalentBars || 0);
        });
    }

    document.getElementById('aiTalentSearch')?.addEventListener('input', filterAiTalentChoices);
    document.getElementById('autoWashRoleSelect')?.addEventListener('change', event => selectAutoWashRole(event.target.value));
    document.getElementById('autoWashVipSelect')?.addEventListener('change', onVipChange);
    document.getElementById('btnAiPredict')?.addEventListener('click', runAiPrediction);
    document.getElementById('btnAiCancel')?.addEventListener('click', cancelAiPrediction);
    document.getElementById('btnAutoEquipMode')?.addEventListener('click', () => setAutoSimulatorMode('equip'));
    document.getElementById('btnAutoJianwangMode')?.addEventListener('click', () => setAutoSimulatorMode('jianwang'));
    document.getElementById('btnAutoWashMode')?.addEventListener('click', () => setAutoSimulatorMode('wash'));
    document.getElementById('autoJianwangStartSword')?.addEventListener('change', () => {
        invalidateJianwangAutoPrediction('起始剑已变化，请重新开始剑王阁自动模拟。');
        updateJianwangAutoStartHint();
    });
    document.getElementById('autoJianwangRoute')?.addEventListener('change', () => {
        refreshJianwangAutoTargetProps(false);
        invalidateJianwangAutoPrediction('镇派路线已变化，请重新开始剑王阁自动模拟。');
        updateJianwangAutoStartHint();
    });
    document.getElementById('autoJianwangTargetProp')?.addEventListener('change', () => {
        invalidateJianwangAutoPrediction('词条已变化，请重新开始剑王阁自动模拟。');
    });
    document.getElementById('autoJianwangTargetCount')?.addEventListener('change', () => invalidateJianwangAutoPrediction('筛选目标已变化，请重新开始剑王阁自动模拟。'));
    document.getElementById('autoJianwangMaxSwords')?.addEventListener('change', () => invalidateJianwangAutoPrediction('最大模拟次数已变化，请重新开始剑王阁自动模拟。'));
    document.getElementById('btnAutoJianwangPredict')?.addEventListener('click', runJianwangAutoSimulation);
    document.getElementById('btnAutoJianwangCancel')?.addEventListener('click', cancelJianwangAutoSimulation);
    document.getElementById('autoEquipLocationChoices')?.addEventListener('change', handleEquipAutoLocationClick);
    document.getElementById('autoEquipPaperChoices')?.addEventListener('change', handleEquipAutoPaperChange);
    document.getElementById('autoEquipPaperChoices')?.addEventListener('click', handleEquipAutoPaperClick);
    document.getElementById('autoEquipPaperSearch')?.addEventListener('input', filterEquipAutoPapers);
    document.getElementById('autoEquipPropertyChoices')?.addEventListener('change', handleEquipAutoPropertyClick);
    document.getElementById('btnAutoEquipPredict')?.addEventListener('click', runEquipAutoSimulation);
    document.getElementById('btnAutoEquipCancel')?.addEventListener('click', cancelEquipAutoSimulation);
    document.getElementById('autoEquipResults')?.addEventListener('click', handleEquipAutoResultClick);
    document.getElementById('autoEquipResults')?.addEventListener('change', handleEquipAutoResultControlChange);
    document.getElementById('autoEquipResults')?.addEventListener('input', handleEquipAutoResultInput);
    ['autoEquipCraftCount', 'autoEquipRefineCount', 'autoEquipAttachCount'].forEach(id => {
        document.getElementById(id)?.addEventListener('change', () => invalidateEquipAutoPrediction('模拟次数已变化，请重新开始装备自动模拟。'));
    });

    document.getElementById('modeSelect')?.addEventListener('change', onModeChange);
    document.getElementById('seedInput')?.addEventListener('change', onSeedChange);
    const luckSeedEl = document.getElementById('luckSeedInput');
    if (luckSeedEl) luckSeedEl.addEventListener('change', onLuckSeedChange);
    document.getElementById('roleIdInput')?.addEventListener('change', onRoleIdChange);
    document.getElementById('saltInput')?.addEventListener('change', onSaltChange);

    document.getElementById('saveRoleSelect')?.addEventListener('change', (e) => {
        selectRoleFromSave(e.target.value);
    });

    document.getElementById('zizhiSelect')?.addEventListener('change', onZizhiChange);
    document.getElementById('sexSelect')?.addEventListener('change', onSexChange);
    document.getElementById('vipSelect')?.addEventListener('change', onVipChange);
    document.getElementById('btnUpgradeZiZhi')?.addEventListener('click', upgradeZiZhi);

    // 这些是纯展示刷新，各函数内部对元素是否存在的兜底程度不一。
    // 逐个包一层，缺元素的页面（例如只用置换序列生成的工具页）不会因此中断初始化。
    [renderTalents, renderAptitudePanel, renderStats, renderPityBar, renderCostInfo,
        syncVipControls, renderAiTalentChoices, renderAutoWashSaveGate].forEach(render => {
        try { render(); } catch (error) { console.warn('[initApp] 跳过渲染：', render.name, error); }
    });
}

function dismissWasmLoadingOverlay() {
    const dialog = document.getElementById('wasmLoadingDialog');
    if (dialog) dialog.remove();
    document.documentElement.classList.remove('wasm-loading-active');
}

document.addEventListener('DOMContentLoaded', () => {
    initApp().catch(error => {
        console.error('[initApp] 页面初始化失败：', error);
        dismissWasmLoadingOverlay();
        alert('页面初始化失败：' + (error?.message || error));
    });
});
setTimeout(function () { if (typeof prewarmSql === 'function') prewarmSql(); }, 200);
