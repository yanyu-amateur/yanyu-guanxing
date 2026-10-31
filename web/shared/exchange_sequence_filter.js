/**
 * 置换序列筛选
 *
 * 原本是 txt-filter.html 的独立页面：得先在「置换脉序查找」里下载 txt，再把文件拖进去。
 * 现在把它抽成共享模块，对话框里生成完序列可以直接在内存里筛，两边共用同一套解析与判定。
 *
 * 文本格式（与 simulator.js 的 formatExchangeSequenceTxt 对应）：
 *   （原始脉） n=次数 保底紫1 保底紫2 ...
 * 同时兼容老格式的 `n=` 行与「置换序列：」行。
 */
(function (root) {
    'use strict';

    /* 可选紫脉名单；外部可用 window.EXCHANGE_SEQUENCE_PURPLES 覆盖 */
    var DEFAULT_PURPLE_NAMES = [
        '九阴鬼脉', '玄阳神脉', '混元奇脉', '一心两用',
        '拳脚无双', '剑术无双', '刀法绝伦', '枪棍绝伦',
        '术绍岐黄', '天人合一', '天生神力', '飘忽若神',
        '鹤骨龙筋', '转世金仙', '岿然顶天', '不灭肉身',
    ];

    /* 实际游戏中最受欢迎的紫脉，UI 展示时置顶（顺序即排位，靠前者更热门） */
    var POPULAR_PURPLE_NAMES = [
        '混元奇脉', '玄阳神脉', '九阴鬼脉', '转世金仙', '岿然顶天',
        '天生神力', '飘忽若神', '天人合一', '术绍岐黄',
    ];

    var STEP_TYPES = [
        { value: 'one', label: '全部包含' },
        { value: 'exclude', label: '排除' },
    ];

    function purpleNames() {
        var custom = root.EXCHANGE_SEQUENCE_PURPLES;
        return Array.isArray(custom) && custom.length ? custom.slice() : DEFAULT_PURPLE_NAMES.slice();
    }

    /**
     * 展示用排序：热门紫脉置顶（保持 POPULAR_PURPLE_NAMES 内的相对顺序），其余按入参原序排在后面。
     * 只影响 UI 展示顺序，不参与任何判定。
     */
    function sortPurplesForDisplay(names) {
        var list = (names || []).slice();
        var head = POPULAR_PURPLE_NAMES.filter(function (n) { return list.indexOf(n) !== -1; });
        var tail = list.filter(function (n) { return POPULAR_PURPLE_NAMES.indexOf(n) === -1; });
        return head.concat(tail);
    }

    function stepTypeLabel(type) {
        var found = STEP_TYPES.filter(function (item) { return item.value === type; })[0];
        return found ? found.label : type;
    }

    /**
     * 解析一行。
     * @param {string} line    当前行
     * @param {string} prevLine 上一行（「置换序列：」格式靠它取步骤号）
     * @param {number} fallbackNo 兜底递增序号
     */
    function parseLine(line, prevLine, fallbackNo) {
        if (line.trim().charAt(0) === '#') return null;
        var s = line.trim();
        if (!s) return null;

        // 新格式：置换序列：xxxx   或   置换序列：重复N
        var ps = s.match(/^置换序列[：:]\s*(.*)$/);
        if (ps) {
            var rest = String(ps[1] || '').trim();
            var dup = rest.match(/^重复\s*(\d+)$/);
            if (dup) return { n: null, names: [], isDup: true, dupRef: Number(dup[1]) };
            var pm = /^(\d+)\s*[，,]/.exec(String(prevLine || '').trim());
            var n = pm ? Number(pm[1]) : fallbackNo;
            var first = rest.match(/（([^）]*)）/);
            var names = [];
            if (first) {
                if (first[1] && first[1] !== '空') names.push(first[1]);
                rest = rest.replace(/（[^）]*）/, ' ');
            }
            names = names.concat(rest.split(/\s+/).filter(function (t) { return t && !t.match(/^n=/); }));
            return { n: n, names: names, isDup: false };
        }

        // 下载格式 / 老格式：含 n= 的行
        var m = s.match(/n=(\d+)/);
        var n2 = m ? Number(m[1]) : null;
        var names2 = [];
        var first2 = s.match(/（([^）]*)）/);
        if (first2) {
            if (first2[1] && first2[1] !== '空') names2.push(first2[1]);
            s = s.replace(/（[^）]*）/, ' ');
        }
        names2 = names2.concat(s.split(/\s+/).filter(function (t) { return t && !t.match(/^n=/); }));
        return { n: n2, names: names2, isDup: false };
    }

    /**
     * 解析整段文本。
     * @returns {{records: Array<{n:number, names:string[]}>, dupCount:number}}
     */
    function parseText(text) {
        var lines = String(text || '').split('\n');
        var records = [];
        var dupCount = 0;
        var seqNo = 0;
        lines.forEach(function (line, idx) {
            var p = parseLine(line, idx > 0 ? lines[idx - 1] : '', seqNo + 1);
            if (!p) return;
            if (p.isDup) { dupCount++; return; }
            if (p.n === null || p.n === undefined || !p.names.length) return;
            seqNo++;
            records.push({ n: p.n, names: p.names });
        });
        return { records: records, dupCount: dupCount };
    }

    /** 单步判定 */
    function matchStep(names, step) {
        var i;
        if (!step || !step.purples || !step.purples.length) return true;
        if (step.type === 'exclude') {
            for (i = 0; i < step.purples.length; i++) {
                if (names.indexOf(step.purples[i]) !== -1) return false;
            }
            return true;
        }
        if (step.type === 'one') {
            for (i = 0; i < step.purples.length; i++) {
                if (names.indexOf(step.purples[i]) === -1) return false;
            }
            return true;
        }
        return true;
    }

    function stepDescription(step) {
        return step.type === 'exclude' ? ('排除：' + step.purples.join('、'))
            : ('全部包含：' + step.purples.join('、'));
    }

    /** 某一步是否有效（有效的才参与漏斗，空步骤直接跳过） */
    function stepEffective(step) {
        return !!(step && step.purples && step.purples.length);
    }

    /**
     * 跑漏斗。
     * @returns {{funnel: Array<{desc:string, count:number, base?:boolean}>, hits: Array<{n:number, names:string[]}>}}
     */
    function runFunnel(records, steps, dupCount) {
        var current = (records || []).slice();
        var funnel = [{
            desc: '全部序列' + (dupCount ? '（已跳过 ' + dupCount + ' 条重复）' : ''),
            count: current.length,
            base: true,
        }];
        (steps || []).forEach(function (step) {
            if (!stepEffective(step)) return;
            current = current.filter(function (rec) { return matchStep(rec.names, step); });
            funnel.push({ desc: stepDescription(step), count: current.length });
        });
        return { funnel: funnel, hits: current };
    }

    root.ExchangeSequenceFilter = Object.freeze({
        DEFAULT_PURPLE_NAMES: DEFAULT_PURPLE_NAMES,
        POPULAR_PURPLE_NAMES: POPULAR_PURPLE_NAMES,
        STEP_TYPES: STEP_TYPES,
        purpleNames: purpleNames,
        sortPurplesForDisplay: sortPurplesForDisplay,
        stepTypeLabel: stepTypeLabel,
        stepDescription: stepDescription,
        stepEffective: stepEffective,
        parseLine: parseLine,
        parseText: parseText,
        matchStep: matchStep,
        runFunnel: runFunnel,
    });
})(typeof window !== 'undefined' ? window : globalThis);
