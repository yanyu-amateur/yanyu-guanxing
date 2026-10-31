/* 家园派遣 页面逻辑（自研，第四版 · 按次数推演）
 * 引擎实测结论（node 探针验证，勿改回旧假设）：
 * - 拴马桩只有 2 个（home_youli_id01/02），且「哪个桩」不影响产出（对调实测完全相同）
 * - 产出 = f(派谁, 第几次派遣)；每天最多 3 人次（home_majiu_day 为已派遣数）
 * - 池 2（手记）只由「第几次」决定，与随从无关 → 手记不做选人打分，改为次数日历
 * - 池 0/池 1 随随从不同，是选人唯一能影响的池；空抽（p0、p1 均空）不推进序号
 * - roles 最多 2 个；roleIndex=(step-1)%roles.length 仅为轮转下标
 */
(function () {
    'use strict';

    var SAVE = null;
    var ROLE_LIST = [];      // [{id,name}]
    var ROLE_MAP = {};
    var COUNT = 3;            // 推演的派遣次数（默认=今日剩余）
    var MAX_STEPS = 20;       // 单条链条长度
    var CHAIN = {};           // roleId -> [[p0,p1,p2], ...] 索引 0 = 从现在起第 1 次派遣
    var NOTE_SEQ = [];        // 池2 手记序列（第 k 次 -> 手记名），与随从无关
    var CATALOG = { 0: {}, 1: {} }; // pool -> {name:true}  其他物品（动态枚举）
    var CACHE = {};           // "ids_count" -> value
    var HORSES = [];          // 马厩游历收获 [{status, rewards:[{name,quantity}]}]，与随从无关
    var RIDER_MAP = {};        // id -> name（含 Leavers 离队名单，拴马桩上游历的随从在这里）
    var STEP_ITEMS = {};      // step(第几次) -> {name:true}  每次独立保存的目标物品（小保存，互不覆盖）
    var CUR_STEP = 1;         // 当前正在编辑/查看的第几次（1..R）

    var POOL_NAMES = ['药材丹药', '珍材树苗', '手记'];

    var $ = function (id) { return document.getElementById(id); };

    function gv(save, key) {
        var P = save.globalVariable || save.GlobalVariable || save.P || {};
        var v = (P && typeof P === 'object') ? (Array.isArray(P) ? (P.find ? P.find(function (x) { return x && String(x.ID) === String(key); }) : null) : P[key]) : null;
        if (v == null) return null;
        if (typeof v === 'object') { var w = v.value != null ? v.value : (v.Value != null ? v.Value : (v.val != null ? v.val : v.Val)); return w == null ? null : Number(w); }
        return Number(v);
    }
    // 今天已派遣次数：主信号 home_majiu_day；兜底统计 2 个拴马桩（home_youli_id01/02，实测无 03）
    function dispatchedToday() {
        var s = Array.isArray(SAVE) ? SAVE[0] : SAVE;
        if (!s) return 0;
        var d = gv(s, 'home_majiu_day');
        var n = (d == null ? 0 : Number(d)) || 0;
        if (!(n > 0)) {
            var rec = 0;
            for (var i = 1; i <= 2; i++) { if (gv(s, 'home_youli_id0' + i)) rec++; }
            n = rec;
        }
        return Math.max(0, Math.min(3, n));
    }
    function remainingToday() { return Math.max(0, 3 - dispatchedToday()); }
    // 当前可查看的派遣次数上限 R（受次数输入框 COUNT 与链条长度 MAX_STEPS 约束）
    function curR() { return Math.max(0, Math.min(COUNT, MAX_STEPS)); }
    // 某手记在 20 次链条里出现的所有次数（用于「不可达」提示）
    function noteAllSteps(name) {
        var out = [];
        NOTE_SEQ.forEach(function (n, i) { if (n === name) out.push(i + 1); });
        return out;
    }
    function mainRoleName(save) {
        var s = Array.isArray(save) ? save[0] : save;
        var role = s && s.MainRole;
        return (role && typeof role.Name === 'string' && role.Name.trim()) || '—';
    }
    function collectRoles(save) {
        var s = Array.isArray(save) ? save[0] : save;
        var list = [], seen = {};
        ['Roles', 'linSui'].forEach(function (key) {
            var obj = s[key];
            if (!obj) return;
            Object.keys(obj).forEach(function (k) {
                var r = obj[k];
                if (!r || r.ID == null) return;
                if (seen[r.ID]) return;
                seen[r.ID] = true;
                list.push({ id: Number(r.ID), name: r.name || r.Name || ('随从' + r.ID) });
            });
        });
        return list.sort(function (a, b) { return a.id - b.id; });
    }
    function setMessage(el, text, isError) {
        if (!el) return;
        el.textContent = text || '';
        el.classList.toggle('is-error', !!isError);
    }
    function roleName(id) { return ROLE_MAP[id] || ('随从' + id); }

    function buildInput(roleIds, count) {
        var s = Array.isArray(SAVE) ? SAVE[0] : SAVE;
        var Rnds = s.Rnds || {}, Sds = Rnds.Sds || {};
        var seeds = {};
        ['home_travel01_keyroll', 'home_travel02_keyroll', 'home_travel03_keyroll'].forEach(function (k) {
            if (Sds[k] != null) seeds[k] = Number(Sds[k]);
        });
        return {
            seeds: seeds,
            defaultRand: Rnds.DefaultRand != null ? Number(Rnds.DefaultRand) : null,
            experience: gv(s, 'home_majiu_lv'),
            roles: roleIds,
            count: count,
            notebooks: [8270, 8271, 8272].map(function (id) { return gv(s, 'buyshop_' + id); }),
            horses: ['one', 'two'].map(function (n, i) {
                return {
                    state: gv(s, 'horse_at_home0' + (i + 1)) || 0,
                    rewards: [1, 2, 3].map(function (j) { return [gv(s, n + '_travel_reward0' + j) || 0, gv(s, n + '_travel_sl0' + j) || 0]; })
                };
            })
        };
    }

    function predict(roleIds, count) {
        var key = roleIds.join(',') + '_' + count;
        if (CACHE[key]) return Promise.resolve(CACHE[key]);
        return HomesteadEngine.homePredict(buildInput(roleIds, count)).then(function (res) {
            if (!res || res.ok === false) throw new Error((res && res.error) || '引擎返回错误');
            var val = res.value != null ? res.value : res;
            CACHE[key] = val;
            return val;
        });
    }

    function onImport(e) {
        var file = e.target.files && e.target.files[0];
        if (!file) return;
        if (typeof decryptSaveFile !== 'function') { setMessage($('importMessage'), '存档解密模块未加载', true); return; }
        decryptSaveFile(file).then(function (data) {
            SAVE = data;
            if (typeof saveShareStore === 'function') saveShareStore(data, { source: file.name });
            if (typeof renderArchiveState === 'function') renderArchiveState(data);
            setMessage($('importMessage'), '已导入：' + mainRoleName(data) + '（' + file.name + '）', false);
            prepare(data);
        }).catch(function (err) {
            setMessage($('importMessage'), '导入失败：' + (err && err.message ? err.message : err), true);
        });
    }

    // 拴马桩上游历的随从可能不在 Roles/linSui，而在 Leavers（离队名单），单独收集 id->name
    function collectRiders(save) {
        var s = Array.isArray(save) ? save[0] : save;
        var map = {};
        ['Roles', 'linSui', 'Leavers'].forEach(function (key) {
            var obj = s[key];
            if (!obj) return;
            var list = Array.isArray(obj) ? obj : Object.keys(obj).map(function (k) { return obj[k]; });
            list.forEach(function (r) {
                if (!r || r.ID == null) return;
                var id = Number(r.ID);
                if (!map[id]) map[id] = r.name || r.Name || ('随从' + id);
            });
        });
        return map;
    }

    function prepare(data) {
        ROLE_LIST = collectRoles(data);
        ROLE_MAP = {};
        RIDER_MAP = collectRiders(data);
        ROLE_LIST.forEach(function (r) { ROLE_MAP[r.id] = r.name; });
        if (!ROLE_LIST.length) { setMessage($('predictStatus'), '存档中未找到任何随从', true); }
        $('configPanel').hidden = false;
        $('dispatchEmpty').hidden = true;
        populateSelect();
        $('btnView').disabled = ROLE_LIST.length === 0;
        // 次数默认值 = 今天剩余派遣次数（已派遣 0→3，2→1，全部→0）
        var remain = remainingToday();
        var ci = $('countInput'); if (ci) ci.value = String(remain);
        COUNT = remain;
        STEP_ITEMS = {};
        CUR_STEP = 1;
        setMessage($('predictStatus'), '正在推演各随从第 1~20 次派遣的产出链…', false);
        HomesteadEngine.ensure().then(function () {
            return buildChains();
        }).then(function () {
            renderItemPanel();
            renderStepResults();
            renderBookCalendar();
            renderHorseCard();
            setMessage($('predictStatus'), '就绪：上方选「第几次」，再点选目标物品，下方实时显示每次该派谁', false);
        }).catch(function (err) {
            setMessage($('predictStatus'), '引擎加载/计算失败：' + (err && err.message ? err.message : err) + '（建议经本地服务打开）', true);
        });
    }

    function populateSelect() {
        var sel = $('roleSelect');
        sel.innerHTML = '';
        ROLE_LIST.forEach(function (r) {
            var o = document.createElement('option');
            o.value = String(r.id);
            o.textContent = r.name;
            sel.appendChild(o);
        });
    }

    // 每个随从一次 count=20 调用，得到「第 1~20 次派遣」的完整链条；同时汇总物品清单与手记日历
    function buildChains() {
        CHAIN = {};
        NOTE_SEQ = [];
        CATALOG = { 0: {}, 1: {}, 2: {} };
        var seq = Promise.resolve();
        ROLE_LIST.forEach(function (r) {
            seq = seq.then(function () {
                return predict([r.id], MAX_STEPS).then(function (val) {
                    if (!HORSES.length) HORSES = val.horses || [];
                    var rows = val.rows || [];
                    CHAIN[r.id] = rows.map(function (row) {
                        var out = [null, null, null];
                        (row.rewards || []).forEach(function (rw) {
                            var p = rw.pool != null ? rw.pool : 0;
                            if (p >= 0 && p <= 2 && rw.item && rw.item.name) {
                                out[p] = rw.item.name;
                                CATALOG[p][rw.item.name] = true;
                            }
                        });
                        return out;
                    });
                    // 手记序列与随从无关：用第一个成功随从的池 2 结果作为日历
                    if (!NOTE_SEQ.length) {
                        NOTE_SEQ = rows.map(function (row) {
                            var hit = null;
                            (row.rewards || []).forEach(function (rw) { if (rw.pool === 2 && rw.item && rw.item.name) hit = rw.item.name; });
                            return hit;
                        });
                    }
                }).catch(function () { CHAIN[r.id] = []; });
            });
        });
        return seq;
    }

    // 目标物品筛选面板：顶部「第几次」次标签栏（切 CUR_STEP）+ 下方共享物品 chips（高亮读 STEP_ITEMS[CUR_STEP]）
    function renderItemPanel() {
        var box = $('itemPanel');
        if (!box) return;
        var R = curR();
        // 次标签栏：第 1 … 第 R 次，当前次高亮；R<=0 时不显示
        var tabs = '';
        if (R > 0) {
            var tabArr = [];
            for (var s = 1; s <= R; s++) {
                var on = (s === CUR_STEP) ? ' step-tab-on' : '';
                tabArr.push('<span class="step-tab' + on + '" data-step="' + s + '" role="button" tabindex="0">第 ' + s + ' 次</span>');
            }
            tabs = '<div class="step-tabs"><span class="step-tabs-label">编辑：</span>' + tabArr.join('') + '</div>';
        }
        var groups = [
            { title: '药材丹药', pool: 0 },
            { title: '珍材树苗', pool: 1 }
        ];
        var curSel = STEP_ITEMS[CUR_STEP] || {};
        var html = '<div class="item-panel-head">目标物品 · 给「第 ' + (R > 0 ? CUR_STEP : '?') + ' 次」选想带回的东西' +
            '<span class="item-panel-hint">可多选，命中其一即可；切上方次数各自保存</span></div>' + tabs;
        groups.forEach(function (g) {
            var names = Object.keys(CATALOG[g.pool] || {}).sort();
            var chips = names.map(function (n) {
                var on = curSel[n] ? ' item-chip-on' : '';
                return '<span class="item-chip' + on + '" data-name="' + n + '" role="button" tabindex="0">' + n + '</span>';
            }).join('');
            html += '<div class="item-group"><div class="item-group-title">' + g.title + '</div>' +
                '<div class="item-list">' + (chips || '<span class="item-empty">—</span>') + '</div></div>';
        });
        box.innerHTML = html;
        Array.prototype.forEach.call(box.querySelectorAll('.step-tab'), function (el) {
            function go() {
                CUR_STEP = Number(el.getAttribute('data-step'));
                renderItemPanel();
                renderStepResults();
            }
            el.addEventListener('click', go);
            el.addEventListener('keydown', function (e) { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); go(); } });
        });
        // 物品 chip 切换：只改当前次的选择，不影响其他次
        Array.prototype.forEach.call(box.querySelectorAll('.item-chip'), function (el) {
            function toggle() {
                var n = el.getAttribute('data-name');
                if (!STEP_ITEMS[CUR_STEP]) STEP_ITEMS[CUR_STEP] = {};
                if (STEP_ITEMS[CUR_STEP][n]) delete STEP_ITEMS[CUR_STEP][n]; else STEP_ITEMS[CUR_STEP][n] = true;
                el.classList.toggle('item-chip-on');
                renderStepResults();
            }
            el.addEventListener('click', toggle);
            el.addEventListener('keydown', function (e) { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); toggle(); } });
        });
    }

    // 实时渲染各次候选：第 1…R 次，每次列出「该次」能带回 STEP_ITEMS[step] 物品的随从；切筛选即刷新
    function renderStepResults() {
        var box = $('autoResult');
        if (!box) return;
        var R = curR();
        if (R <= 0) {
            box.innerHTML = '<div class="role-empty">今日派遣已全部完成（剩余 0 次）。把次数调到 1 以上可推演后续派遣</div>';
            return;
        }
        var day = dispatchedToday();
        var ids = ROLE_LIST.map(function (r) { return r.id; });
        var blocks = [];
        for (var step = 1; step <= R; step++) {
            var sel = Object.keys(STEP_ITEMS[step] || {});
            var k = day + step - 1;
            var cands = [];
            ids.forEach(function (rid) {
                var cells = (CHAIN[rid] || [])[k] || [null, null, null];
                var hits = [];
                for (var p = 0; p < 3; p++) {
                    var n = cells[p];
                    if (n && sel.indexOf(n) >= 0) hits.push({ pool: p, name: n });
                }
                if (hits.length) cands.push({ rid: rid, hits: hits });
            });
            cands.sort(function (a, b) { return b.hits.length - a.hits.length; });
            var crossDay = k > day + remainingToday() ? ' <span class="plan-cross">跨日推演 · 仅供参考</span>' : '';
            var inner;
            if (!sel.length) {
                inner = '<div class="role-empty">未选目标物品（点上方「第 ' + step + ' 次」后选物品）</div>';
            } else if (!cands.length) {
                inner = '<div class="role-empty">无随从在该次命中所选目标</div>';
            } else {
                inner = cands.map(function (c) {
                    var items = c.hits.map(function (h) { return POOL_NAMES[h.pool] + '：' + h.name; }).join(' · ');
                    return '<div class="plan-row" data-k="' + k + '" data-rid="' + c.rid + '" role="button" tabindex="0"' +
                        ' title="点击查看' + roleName(c.rid) + ' 第 ' + k + ' 次派遣的完整产出">' +
                        '<span class="plan-role">' + roleName(c.rid) + '</span>' +
                        '<span class="plan-items">' + items + '</span></div>';
                }).join('');
            }
            blocks.push('<div class="plan-group"><div class="plan-group-head">第 ' + step + ' 次' + crossDay +
                (sel.length ? ' <span class="plan-target">目标：' + sel.join('、') + '</span>' : '') + '</div>' + inner + '</div>');
        }
        box.innerHTML = blocks.join('');
        Array.prototype.forEach.call(box.querySelectorAll('.plan-row[data-k]'), function (el) {
            el.addEventListener('click', function () { showStepDetail(Number(el.dataset.k), Number(el.dataset.rid)); });
            el.addEventListener('keydown', function (e) { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); showStepDetail(Number(el.dataset.k), Number(el.dataset.rid)); } });
        });
    }

    // 手记日历：从当前存档起、只显示「剩余几次」的格子（与派谁无关）；点击格子看该次派遣的完整产出
    function renderBookCalendar() {
        var box = $('bookCalendar');
        if (!box) return;
        if (!NOTE_SEQ.length) { box.innerHTML = ''; box.hidden = true; return; }
        var start = dispatchedToday();
        var windowSeq = NOTE_SEQ.slice(start, start + COUNT);
        if (!windowSeq.length) { box.hidden = true; box.innerHTML = ''; return; }
        box.hidden = false;
        var cells = windowSeq.map(function (name, i) {
            var k = start + i + 1;
            var short = name ? name.replace('手记', '') : '—';
            return '<div class="cal-cell cal-in-window" data-k="' + k + '" role="button" tabindex="0"' +
                ' title="点击查看第 ' + k + ' 次派遣的产出">' +
                '<span class="cal-step">第 ' + (k - start) + ' 次</span><span class="cal-name">' + short + '</span></div>';
        }).join('');
        box.innerHTML = '<div class="cal-head">每次派遣出的手记（<b>与派谁无关</b>，只由第几次决定）' +
            '<span class="cal-legend">点次数看那次的完整产出；把「次数」调大可看后续跨日推演</span></div>' +
            '<div class="cal-cells">' + cells + '</div>';
        Array.prototype.forEach.call(box.querySelectorAll('.cal-cell'), function (el) {
            el.addEventListener('click', function () { showStepDetail(Number(el.dataset.k)); });
            el.addEventListener('keydown', function (e) { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); showStepDetail(Number(el.dataset.k)); } });
        });
    }

    // 点击日历格子/筛选结果：弹窗显示第 k 次派遣的三池产出（药材/珍材随随从，手记与派谁无关）
    // rid 可选：筛选结果点击时直接指定随从；日历点击时用下拉框当前选中的
    function showStepDetail(k, rid) {
        var id = Number(rid || $('roleSelect').value);
        var body = $('dispatchModalBody');
        if (!id) { setMessage($('predictStatus'), '先在上方选择随从，再看该次派遣的药材/珍材产出', true); return; }
        var cells = (CHAIN[id] || [])[k - 1];
        if (!cells) {
            body.innerHTML = '<div class="role-empty">推演不到第 ' + k + ' 次派遣（链条共 ' + MAX_STEPS + ' 次）</div>';
        } else {
            var lines = POOL_NAMES.map(function (pn, i) {
                return poolLine(pn, i === 2, cells[i] || '', { isBook: i === 2 });
            }).join('');
            var crossDay = k > dispatchedToday() + remainingToday() ? '（跨日推演，种子可能重播，仅供参考）' : '';
            body.innerHTML = '<div class="modal-sub">第 ' + k + ' 次派遣' + crossDay + '</div>' +
                (lines || '<div class="role-empty">本次派遣无可推演的产出</div>');
        }
        $('dispatchModalRole').textContent = roleName(id) + ' · 第 ' + k + ' 次派遣产出';
        $('dispatchModal').hidden = false;
    }

    // 单个池行的渲染；空池（itemsHtml 为空）直接返回 ''，让调用方不显示该行
    function poolLine(pn, isBook, itemsHtml, opts) {
        opts = opts || {};
        if (itemsHtml == null || itemsHtml === '') return '';
        var cls = 'pool-line' + (isBook ? ' pool-book' : '') +
            (opts.mark ? ' ' + opts.mark : '') + (opts.focus ? ' cal-focus' : '');
        return '<div class="' + cls + '">' +
            '<span class="pool-tag">' + pn + '</span>' +
            '<span class="pool-items">' + itemsHtml + '</span></div>';
    }

    // 马厩游历收获：读取引擎返回的 val.horses；每匹马都显示（无产出显示"空闲/为空"），不整卡隐藏
    function renderHorseCard() {
        var box = $('horseCard');
        if (!box) {
            // 兜底：旧缓存的 index.html 可能没有该容器，动态补插（避免卡片静默消失）
            var anchor = $('bookCalendar');
            if (!anchor || !anchor.parentNode) return;
            box = document.createElement('div');
            box.id = 'horseCard';
            box.className = 'horse-card';
            box.hidden = true;
            anchor.parentNode.insertBefore(box, anchor.nextSibling);
        }
        if (!HORSES || !HORSES.length) {
            box.hidden = false;
            box.innerHTML = '<div class="horse-head">马厩游历收获</div><div class="role-empty">马厩为空（存档中无马匹数据）</div>';
            return;
        }
        var lines = HORSES.map(function (h, idx) {
            // 马 i ↔ 拴马桩 i：游历中的马由桩上随从带出，标注随从名
            var rider = '';
            var s = Array.isArray(SAVE) ? SAVE[0] : SAVE;
            var rid = s ? gv(s, 'home_youli_id0' + (idx + 1)) : null;
            if (rid) rider = RIDER_MAP[Number(rid)] || ('随从' + rid);
            var items = (h.rewards || []).map(function (rw) {
                return rw.name + (rw.quantity != null && rw.quantity > 1 ? '×' + rw.quantity : '');
            }).join('、');
            return '<div class="horse-line"><span class="horse-idx">马 ' + (idx + 1) + (rider ? '（' + rider + '）' : '') + '</span>' +
                '<span class="horse-status">' + (h.status || '未知') + '</span>' +
                '<span class="horse-items">' + (items || '<span class="horse-empty">为空（空闲，出发后才生成收获）</span>') + '</span></div>';
        }).filter(Boolean);
        box.hidden = false;
        box.innerHTML = '<div class="horse-head">马厩游历收获（回厩即带回，<b>与派谁无关</b>，只由马自身状态决定）</div>' +
            (lines.length ? lines.join('') : '<div class="role-empty">马厩为空（无马匹在栏）</div>');
    }

    // 调试接口：浏览器控制台诊断用（验证马匹游历收获数据、容器状态）
    window.HomesteadDebug = {
        state: function () {
            var b = document.getElementById('horseCard');
            return {
                hasHorseCardDom: !!b,
                horseCardHidden: b ? b.hidden : null,
                horses: HORSES,
                dispatchedToday: dispatchedToday(),
                count: COUNT,
                noteSeqLen: NOTE_SEQ.length
            };
        }
    };

    function closeDispatchModal() {
        var m = $('dispatchModal');
        if (m) m.hidden = true;
    }

    // 下次派遣奖励弹窗：只显示该随从下一次派遣（全局第 k 次）能推演出的产出，空池不显示
    function onView() {
        var id = Number($('roleSelect').value);
        if (!id) { setMessage($('predictStatus'), '请先选择随从', true); return; }
        var body = $('dispatchModalBody');
        if (!body) return;
        var day = dispatchedToday();
        var k = day + 1;
        var cells = (CHAIN[id] || [])[day];
        if (!cells) {
            body.innerHTML = '<div class="role-empty">推演不到第 ' + k + ' 次派遣（链条共 ' + MAX_STEPS + ' 次）</div>';
        } else {
            var lines = POOL_NAMES.map(function (pn, i) {
                return poolLine(pn, i === 2, cells[i] || '', { isBook: i === 2 });
            }).join('');
            var crossDay = k > day + remainingToday() ? '（跨日推演，种子可能重播，仅供参考）' : '';
            body.innerHTML = '<div class="modal-sub">第 ' + k + ' 次派遣' + crossDay + '</div>' +
                (lines || '<div class="role-empty">本次派遣无可推演的产出</div>');
        }
        $('dispatchModalRole').textContent = roleName(id) + ' · 下次派遣奖励';
        $('dispatchModal').hidden = false;
    }

    function init() {
        var importBtn = $('archiveImportButton');
        if (importBtn) importBtn.addEventListener('change', onImport); // 本页已移除导入按钮，判空兜底
        $('btnView').addEventListener('click', onView);
        $('dispatchModalClose').addEventListener('click', closeDispatchModal);
        $('dispatchModal').addEventListener('click', function (e) { if (e.target === this) closeDispatchModal(); });
        document.addEventListener('keydown', function (e) { if (e.key === 'Escape') closeDispatchModal(); });

        var ci = $('countInput');
        function clampCount() {
            var n = parseInt(ci.value, 10);
            if (isNaN(n)) n = remainingToday();
            n = Math.max(0, Math.min(MAX_STEPS, n));
            ci.value = String(n); COUNT = n;
            // 次数变化后，当前编辑次不能超过新上限
            if (CUR_STEP > curR()) CUR_STEP = Math.max(1, curR());
            // 次标签栏、各次候选、日历窗口都随次数变化重算
            renderItemPanel();
            renderStepResults();
            renderBookCalendar();
        }
        ci.addEventListener('change', clampCount);
        $('countMinus').addEventListener('click', function () { ci.value = String(Math.max(0, (parseInt(ci.value, 10) || 0) - 1)); clampCount(); });
        $('countPlus').addEventListener('click', function () { ci.value = String(Math.min(20, (parseInt(ci.value, 10) || 0) + 1)); clampCount(); });

        if (typeof loadShareStore === 'function') {
            var shared = loadShareStore();
            if (shared && shared.data) {
                SAVE = shared.data;
                if (typeof renderArchiveState === 'function') renderArchiveState(SAVE);
                setMessage($('importMessage'), '已载入上次导入的存档：' + mainRoleName(SAVE), false);
                prepare(SAVE);
            }
        }
    }

    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
    else init();
})();
