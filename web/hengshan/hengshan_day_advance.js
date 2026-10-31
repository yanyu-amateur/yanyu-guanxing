/*
 * hengshan_day_advance.js — 连续升级推演扩展
 * 在官方 wasm 内核（advanceDay）之上做多日沙盒推演：
 *   - 推演天数留空：快进到下一节点（40/80 级）或 100 级满级；
 *   - 节点自动结算赠送天赋（advanceDay 返回的 milestones）；
 *   - 结果只落在页面沙盒，点"应用结果"才推进当前弟子。
 */
(function () {
    'use strict';

    var data = window.HENGSHAN_TALENT_DATA;
    var engine = window.HengshanStudentEngine;

    var countInput = document.getElementById('dayAdvanceCount');
    var runButton = document.getElementById('btnDaySimulate');
    var applyButton = document.getElementById('btnDayApply');
    var resultBox = document.getElementById('dayResult');

    var plan = null;

    function nameOf(id) {
        try { return engine.talentName(data, id); }
        catch (error) { return '未知天赋 ' + id; }
    }
    function namesOf(ids) {
        return (ids || []).map(nameOf).join('、') || '暂无';
    }

    function escapeHtml(value) {
        return String(value == null ? '' : value).replace(/[&<>'"]/g, function (character) {
            return ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[character];
        });
    }

    async function simulate() {
        plan = null;
        if (applyButton) applyButton.disabled = true;
        if (resultBox) resultBox.innerHTML = '<p>正在逐日推演，请稍候…</p>';
        var ops = window.HengshanDayOps;
        var current = ops && ops.get();
        if (!current) throw new Error('未选择可推演的恒山弟子。');
        if (window.WasmAlgorithmAPI) await window.WasmAlgorithmAPI.ready;

        var wanted = Math.max(0, Math.trunc(Number(countInput && countInput.value)) || 0);
        var targetLevel = wanted > 0 ? 100 : (current.level < 40 ? 40 : current.level < 80 ? 80 : 100);
        var cur = JSON.parse(JSON.stringify(current));
        var milestones = [];
        var baseLevel = cur.level;
        var maxDays = wanted > 0 ? wanted : 20000;
        var dayIndex = 0;

        for (; dayIndex < maxDays; dayIndex += 1) {
            var result = engine.advanceDay(data, cur);
            if (!result || !result.state) {
                throw new Error('升级推演失败：' + ((result && result.error) || '内核返回空响应'));
            }
            cur = Object.assign(cur, result.state);
            var action = result.action || {};
            if (action.milestones && action.milestones.length) {
                action.milestones.forEach(function (milestone) {
                    milestones.push(Object.assign({ __day: dayIndex + 1 }, milestone));
                });
            }
            if (cur.level >= targetLevel) break;
        }

        var reached = cur.level >= targetLevel;
        plan = { state: cur, days: dayIndex + 1, baseLevel: baseLevel, targetLevel: targetLevel, reached: reached, milestones: milestones };
        render();
        if (applyButton) applyButton.disabled = false;
    }

    function render() {
        if (!plan || !resultBox) return;
        var cur = plan.state;
        var lines = [];
        lines.push('<strong>推演 ' + plan.days + ' 天 · ' + plan.baseLevel + ' 级 → ' + cur.level + ' 级</strong>');
        lines.push('结束状态：经验 ' + Number(cur.exp).toLocaleString() + ' · 种子 ' + Number(cur.seed).toLocaleString()
            + ' · 天赋组合 ' + escapeHtml(namesOf(cur.talents)));
        if (plan.milestones.length) {
            lines.push('节点结算：<br>' + plan.milestones.map(function (milestone) {
                return '· 第 ' + milestone.__day + ' 天（' + milestone.level + ' 级）获得 ' + escapeHtml(nameOf(milestone.id));
            }).join('<br>'));
        }
        if (!plan.reached) lines.push('<em>已推满设定 ' + plan.days + ' 天，尚未到达目标等级。</em>');
        lines.push('<em>结果未写入存档；确认后点"应用结果"。</em>');
        resultBox.innerHTML = lines.map(function (line) { return '<p>' + line + '</p>'; }).join('');
    }

    function bind() {
        if (!runButton || !resultBox) return;
        runButton.addEventListener('click', function () {
            simulate().catch(function (error) {
                resultBox.innerHTML = '<p class="is-error">推演失败：' + escapeHtml(error && error.message ? error.message : String(error)) + '</p>';
            });
        });
        if (applyButton) {
            applyButton.addEventListener('click', function () {
                if (!plan) return;
                var ops = window.HengshanDayOps;
                if (ops && ops.apply) ops.apply(plan.state);
                plan = null;
                applyButton.disabled = true;
                resultBox.innerHTML = '';
            });
        }
    }

    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', bind);
    else bind();
})();
