(function (root) {
    'use strict';

    var MASK48 = (1n << 48n) - 1n;
    var MULTIPLIER = 0x5deece66dn;
    var INCREMENT = 0xbn;
    var RANDOM_MAX = 2047483645;
    var UNLOCK_LEVELS = Object.freeze([40, 80]);

    function asFiniteInteger(value, fallback) {
        var number = Number(value);
        return Number.isFinite(number) ? Math.trunc(number) : fallback;
    }

    function firstDefined(source, keys) {
        if (!source || typeof source !== 'object') return undefined;
        for (var index = 0; index < keys.length; index += 1) {
            if (source[keys[index]] !== undefined && source[keys[index]] !== null) return source[keys[index]];
        }
        return undefined;
    }

    function talentId(value) {
        if (value && typeof value === 'object') {
            return asFiniteInteger(firstDefined(value, ['ID', 'id', 'TalentID', 'talentId', 'SPID']), 0);
        }
        return asFiniteInteger(value, 0);
    }

    function orderedObjectValues(value) {
        return Object.keys(value || {}).sort(function (left, right) {
            var leftNumber = Number(left);
            var rightNumber = Number(right);
            if (Number.isFinite(leftNumber) && Number.isFinite(rightNumber)) return leftNumber - rightNumber;
            return left.localeCompare(right);
        }).map(function (key) { return value[key]; });
    }

    function normalizeTalentList(value, depth) {
        var currentDepth = depth || 0;
        if (currentDepth > 3 || value == null) return [];
        if (Array.isArray(value)) return value.map(talentId).filter(function (id) { return id > 0; }).slice(0, 3);
        if (typeof value !== 'object') {
            var single = talentId(value);
            return single > 0 ? [single] : [];
        }
        var nested = firstDefined(value, ['Talents', 'talents', 'List', 'list', 'Data', 'data', 'SPData']);
        if (nested !== undefined && nested !== value) return normalizeTalentList(nested, currentDepth + 1);
        return orderedObjectValues(value).map(talentId).filter(function (id) { return id > 0; }).slice(0, 3);
    }

    function isStudentShape(value) {
        if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
        var seed = firstDefined(value, ['S', 'Seed', 'seed']);
        return Number.isFinite(Number(seed)) && value.SPData !== undefined;
    }

    function valueAtPath(source, path) {
        var value = source;
        for (var index = 0; index < path.length; index += 1) {
            if (!value || typeof value !== 'object') return undefined;
            value = value[path[index]];
        }
        return value;
    }

    function appendCollection(results, seen, collection, path) {
        var values;
        if (Array.isArray(collection)) values = collection;
        else if (isStudentShape(collection)) values = [collection];
        else if (collection && typeof collection === 'object') values = orderedObjectValues(collection);
        else return;
        values.forEach(function (value, index) {
            if (!isStudentShape(value) || seen.has(value)) return;
            seen.add(value);
            results.push({ raw: value, path: path + '[' + index + ']' });
        });
    }

    function collectBySignature(source, maxDepth, results, seen) {
        var visited = new Set();
        function walk(value, path, depth) {
            if (!value || typeof value !== 'object' || visited.has(value) || depth > maxDepth) return;
            visited.add(value);
            if (isStudentShape(value) && !seen.has(value)) {
                seen.add(value);
                results.push({ raw: value, path: path });
                return;
            }
            if (Array.isArray(value)) {
                value.forEach(function (child, index) { walk(child, path + '[' + index + ']', depth + 1); });
                return;
            }
            Object.keys(value).forEach(function (key) { walk(value[key], path + '.' + key, depth + 1); });
        }
        walk(source, '$', 0);
    }

    function normalizeStudent(entry, index) {
        var raw = entry.raw;
        var id = firstDefined(raw, ['ID', 'Id', 'id', 'UID', 'StudentID']);
        var name = String(firstDefined(raw, ['Name', 'name', 'Nick', 'nick']) || '').trim();
        var talents = normalizeTalentList(raw.SPData);
        return {
            key: String(entry.path || (id !== undefined ? id : index)),
            id: id !== undefined ? id : null,
            name: name || ('恒山弟子 ' + (index + 1)),
            level: Math.max(1, asFiniteInteger(firstDefined(raw, ['Level', 'Lv', 'level', 'lv']), 1)),
            exp: Math.max(0, asFiniteInteger(firstDefined(raw, ['Exp', 'EXP', 'exp']), 0)),
            seed: asFiniteInteger(firstDefined(raw, ['S', 'Seed', 'seed']), 0),
            talents: talents,
            path: entry.path,
            raw: raw
        };
    }

    function collectStudents(saveData) {
        var source = Array.isArray(saveData) ? saveData[0] : saveData;
        if (!source || typeof source !== 'object') return [];
        var paths = [
            ['HengshanStudents'], ['HengShanStudents'], ['Students'], ['Student'],
            ['Hengshan', 'Students'], ['Hengshan', 'Student'],
            ['HengShan', 'Students'], ['HengShan', 'Student'],
            ['Sect', 'HengshanStudents'], ['Sect', 'Students'],
            ['SectData', 'HengshanStudents'], ['HengshanData', 'Students']
        ];
        var results = [];
        var seen = new Set();
        paths.forEach(function (path) {
            appendCollection(results, seen, valueAtPath(source, path), '$.' + path.join('.'));
        });
        if (!results.length) collectBySignature(source, 5, results, seen);
        return results.map(normalizeStudent).filter(function (student) {
            return student.seed > 0 && student.talents.length > 0;
        });
    }

    function buildTalentIndex(data) {
        var map = new Map();
        (data && data.talents || []).forEach(function (talent) { map.set(Number(talent.id), talent); });
        return map;
    }

    function lrand48First(seed) {
        var seed32 = BigInt.asUintN(32, BigInt(asFiniteInteger(seed, 0)));
        var state = ((seed32 << 16n) | 0x330en) & MASK48;
        state = (MULTIPLIER * state + INCREMENT) & MASK48;
        return Number(state >> 17n);
    }

    function buildPool(data, keep, gettag) {
        var byId = buildTalentIndex(data);
        var origins = new Set();
        var classes = new Set();
        (keep || []).forEach(function (id) {
            var talent = byId.get(Number(id));
            if (!talent) return;
            if (talent.origin !== undefined) origins.add(Number(talent.origin));
            if (talent.class !== undefined) classes.add(Number(talent.class));
        });
        var ids = [];
        var prefix = [];
        var excluded = [];
        var total = 0;
        (data && data.candidates || []).forEach(function (candidateId) {
            var id = Number(candidateId);
            var talent = byId.get(id);
            if (!talent || Number(talent.qz) <= 0) return;
            var tag = talent.gettag == null ? 0 : Number(talent.gettag);
            if (gettag != null && tag !== 0 && tag !== Number(gettag)) return;
            if (talent.origin !== undefined && origins.has(Number(talent.origin))) {
                excluded.push(id);
                return;
            }
            if (talent.class !== undefined && classes.has(Number(talent.class))) {
                excluded.push(id);
                return;
            }
            total += Number(talent.qz);
            ids.push(id);
            prefix.push(total);
        });
        return { ids: ids, prefix: prefix, total: total, excluded: excluded };
    }

    function draw(seed, pool) {
        if (!pool || !pool.ids.length || pool.total <= 0) throw new Error('当前保留天赋下没有可抽取候选');
        var nextSeed = (lrand48First(asFiniteInteger(seed, 0) + pool.total) % RANDOM_MAX) + 1;
        var roll = (nextSeed % pool.total) + 1;
        var index = 0;
        while (index < pool.prefix.length - 1 && pool.prefix[index] < roll) index += 1;
        return {
            id: pool.ids[index], seed: asFiniteInteger(seed, 0), nextSeed: nextSeed,
            roll: roll, index: index + 1, poolTotal: pool.total
        };
    }

    function normalizeState(student) {
        return {
            seed: asFiniteInteger(student && student.seed, 0),
            talents: normalizeTalentList(student && student.talents),
            level: Math.max(1, asFiniteInteger(student && student.level, 1)),
            exp: Math.max(0, asFiniteInteger(student && student.exp, 0))
        };
    }

    function replacementChain(data, student, slotIndex, count) {
        var state = normalizeState(student);
        var slot = asFiniteInteger(slotIndex, -1);
        var total = Math.max(0, asFiniteInteger(count, 0));
        if (slot < 0 || slot >= state.talents.length) throw new Error('请选择有效的天赋槽位');
        var keep = state.talents.filter(function (_, index) { return index !== slot; });
        var pool = buildPool(data, keep, null);
        var seed = state.seed;
        var steps = [];
        for (var index = 0; index < total; index += 1) {
            var result = draw(seed, pool);
            steps.push(Object.assign({ n: index + 1, talents: keep.concat(result.id) }, result));
            seed = result.nextSeed;
        }
        return { keep: keep, pool: pool, steps: steps, endSeed: seed };
    }

    function nextUnlockLevels(level) {
        var current = asFiniteInteger(level, 1);
        return UNLOCK_LEVELS.filter(function (unlockLevel) { return unlockLevel > current; });
    }

    function unlockPreview(data, student) {
        var state = normalizeState(student);
        var seed = state.seed;
        var talents = state.talents.slice();
        var steps = [];
        nextUnlockLevels(state.level).forEach(function (level) {
            if (talents.length >= 3) return;
            var tag = level === 40 ? 2 : 3;
            var pool = buildPool(data, talents, tag);
            var result = draw(seed, pool);
            talents.push(result.id);
            steps.push(Object.assign({ level: level, gettag: tag, talents: talents.slice() }, result));
            seed = result.nextSeed;
        });
        return { steps: steps, endSeed: seed, talents: talents, evidence: 'reference-threshold-only' };
    }

    function talentName(data, id) {
        var talent = buildTalentIndex(data).get(Number(id));
        return talent ? talent.name : ('未知天赋 ' + id);
    }

    root.HengshanStudentEngine = Object.freeze({
        RANDOM_MAX: RANDOM_MAX,
        UNLOCK_LEVELS: UNLOCK_LEVELS,
        talentId: talentId,
        normalizeTalentList: normalizeTalentList,
        normalizeStudent: normalizeStudent,
        collectStudents: collectStudents,
        buildTalentIndex: buildTalentIndex,
        lrand48First: lrand48First,
        buildPool: buildPool,
        draw: draw,
        normalizeState: normalizeState,
        replacementChain: replacementChain,
        nextUnlockLevels: nextUnlockLevels,
        unlockPreview: unlockPreview,
        talentName: talentName
    });
})(typeof globalThis !== 'undefined' ? globalThis : window);
