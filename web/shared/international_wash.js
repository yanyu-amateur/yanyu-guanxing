(function (global) {
    'use strict';

    const RAW_ORDER = [401,418,408,264,192,245,400,267,193,207,407,244,189,190,406,243,188,206,191,278,178,268,405,242,196,404,260,179,241,258,263,197,240,412,259,230,262,413,256,195,274,231,209,257,210,410,183,419,275,208,211,182,254,176,276,174,416,255,232,201,234,277,177,198,417,280,199,270,170,248,269,414,236,253,185,204,181,171,415,271,249,411,186,250,200,194,237,180,252,272,203,403,279,172,266,251,175,202,238,205,187,273,173,233,402,247,235,184,261,420,265,409,246,239];
    const CLASS_WEIGHT = Object.freeze({ 1: 560, 2: 374, 3: 64, 4: 2 });
    const U64_MASK = (1n << 64n) - 1n;

    let pools = null;
    let eligibilityCache = null;
    let exchangePreviewCache = null;

    function n(v, d = 0) {
        const x = Number(v);
        return Number.isFinite(x) ? x : d;
    }
    function clone(v) {
        return v == null ? v : JSON.parse(JSON.stringify(v));
    }
    function talent(id) {
        return global.TALENT_DATA && global.TALENT_DATA[String(id)] || null;
    }
    function quality(id) {
        const t = talent(id);
        return t ? n(t.weight != null ? t.weight : t.pinzhi, 1) : 1;
    }
    function isPurple(id) { return quality(id) >= 4; }
    function isShenmai(t) {
        if (!t) return false;
        const id = n(t.id);
        return id === 248 || id === 249 || id === 250 || n(t.type) === 248;
    }

    function isInternationalSave(s) {
        const channel = String(s && (s.saveChannel || s.savePlatform) || '').trim().toLowerCase();
        return channel === '国际服' || channel === '國際服' || channel === 'oversea' || channel === 'international';
    }

    function invalidateInternationalWashContext() {
        eligibilityCache = null;
        exchangePreviewCache = null;
    }

    function buildPools() {
        if (pools) return pools;
        const all = [];
        const purple = [];
        let allTotal = 0;
        let purpleTotal = 0;
        for (const id of RAW_ORDER) {
            const t = talent(id);
            if (!t) continue;
            const w = CLASS_WEIGHT[n(t.weight, 1)] || 0;
            if (w <= 0) continue;
            allTotal += w;
            all.push({ id, cumulative: allTotal });
            if (n(t.weight, 1) === 4) {
                purpleTotal += w;
                purple.push({ id, cumulative: purpleTotal });
            }
        }
        pools = { all, allTotal, purple, purpleTotal };
        return pools;
    }

    function nextRand(seed, maxWeight, roleId, salt) {
        const max = Math.max(1, n(maxWeight, 1));
        let y = (BigInt(n(seed)) + BigInt(max) + BigInt(n(roleId)) + BigInt(n(salt))) & U64_MASK;
        y = (y * 245109059551232n) & U64_MASK;
        y = (y + 48083817484545n) & U64_MASK;
        const x = Number((y >> 17n) & 0x7fffffffn);
        const newSeed = x < 2047483645 ? x + 1 : x - 2047483644;
        return { seed: newSeed, roll: (newSeed % max) + 1 };
    }

    function rawDraw(seed, pool, total, roleId, salt) {
        const r = nextRand(seed, total, roleId, salt);
        const roll = r.roll;
        for (let i = 0; i < pool.length; i++) {
            if (roll <= pool[i].cumulative) {
                return { id: pool[i].id, seed: r.seed, roll };
            }
        }
        return { id: pool[pool.length - 1].id, seed: r.seed, roll };
    }

    function eligibilitySignature(s) {
        return [
            n(s.zizhi), n(s.sex), n(s.vip), n(s.roleId), n(s.roleLevel, 90),
            n(s.strGift), n(s.conGift), n(s.dexGift), n(s.intGift),
            n(s.roleStats && s.roleStats.str_val), n(s.roleStats && s.roleStats.dex),
            n(s.roleStats && s.roleStats.con), n(s.roleStats && s.roleStats.int_val),
            JSON.stringify(s.globalVars || {})
        ].join('|');
    }

    function getEligibility(s) {
        const sig = eligibilitySignature(s);
        if (eligibilityCache && eligibilityCache.sig === sig && eligibilityCache.saveDataRef === s.saveData && eligibilityCache.roleRawRef === s.roleRaw) {
            return eligibilityCache.ids;
        }
        let ids = new Set();
        let resolved = false;
        if (typeof global.__intlGetEligibleIds === 'function') {
            resolved = true;
            const av = global.__intlGetEligibleIds(s) || [];
            ids = new Set(av.map(x => n(x && typeof x === 'object' ? x.id : x)).filter(x => x > 0));
        } else if (typeof global.syncStateToWasm === 'function' && typeof global.wasmGetAvailableTalents === 'function') {
            resolved = true;
            global.syncStateToWasm(s);
            const av = global.wasmGetAvailableTalents() || [];
            ids = new Set(av.map(x => n(x && typeof x === 'object' ? x.id : x)).filter(x => x > 0));
        }
        if (!resolved) {
            Object.keys(global.TALENT_DATA || {}).forEach(k => ids.add(n(k)));
        }
        eligibilityCache = { sig, ids, saveDataRef: s.saveData, roleRawRef: s.roleRaw };
        return ids;
    }

    function washCost(s, lockedCount) {
        const zz = global.ZZ_DATA && (global.ZZ_DATA[String(s.zizhi)] || global.ZZ_DATA['153']) || {};
        let cost = n(zz.eat_xisui);
        if (lockedCount > 0) cost += 2 * lockedCount - 1;
        return cost;
    }

    function copyOperationalState(s) {
        return {
            mode: s.mode,
            zizhi: n(s.zizhi, 153), sex: n(s.sex, 1), vip: n(s.vip, 1),
            seed: n(s.seed), luckSeed: n(s.luckSeed), luckSeedInited: !!s.luckSeedInited,
            roleId: n(s.roleId), salt: n(s.salt),
            talents: clone(s.talents || []), talLucky: n(s.talLucky),
            totalWash: n(s.totalWash), totalTalentBars: n(s.totalTalentBars), totalPills: n(s.totalPills),
            bagPills: n(s.bagPills), hasBagPills: !!s.hasBagPills,
            goldCount: n(s.goldCount), pityCount: n(s.pityCount),
            qualityCounts: clone(s.qualityCounts || { 1: 0, 2: 0, 3: 0, 4: 0 }),
            lastPurpleTotalPills: s.lastPurpleTotalPills == null ? null : n(s.lastPurpleTotalPills),
            exchangeCount: n(s.exchangeCount),
            strGift: n(s.strGift), conGift: n(s.conGift), dexGift: n(s.dexGift), intGift: n(s.intGift),
            roleLevel: n(s.roleLevel, 90), roleStats: s.roleStats || {}, globalVars: s.globalVars || {},
            saveData: s.saveData || null, roleRaw: s.roleRaw || null,
            saveChannel: s.saveChannel || '',
            bornTalentRC: n(s.bornTalentRC)
        };
    }

    function commitOperationalState(dst, src) {
        dst.seed = src.seed;
        dst.luckSeed = src.luckSeed;
        dst.luckSeedInited = src.luckSeedInited;
        dst.talents = clone(src.talents);
        dst.talLucky = src.talLucky;
        dst.totalWash = src.totalWash;
        dst.totalTalentBars = src.totalTalentBars;
        dst.totalPills = src.totalPills;
        dst.bagPills = src.bagPills;
        dst.hasBagPills = src.hasBagPills;
        dst.goldCount = src.goldCount;
        dst.pityCount = src.pityCount;
        dst.qualityCounts = clone(src.qualityCounts);
        dst.lastPurpleTotalPills = src.lastPurpleTotalPills;
        dst.exchangeCount = src.exchangeCount;
        dst.bornTalentRC = src.bornTalentRC;
    }

    function internationalWashCore(jsState, eligibleSet, mutate = true) {
        if (!jsState || !isInternationalSave(jsState)) return null;
        const s = copyOperationalState(jsState);
        const zz = global.ZZ_DATA && (global.ZZ_DATA[String(s.zizhi)] || global.ZZ_DATA['153']) || {};
        const maxSlots = n(zz.num_talent);
        if (maxSlots <= 0) return null;

        const locked = (s.talents || []).filter(t => !!t.locked).map(t => ({ id: n(t.id), locked: true }));
        const generatedCount = maxSlots - locked.length;
        if (generatedCount <= 0) return null;

        const eligible = eligibleSet || getEligibility(jsState);
        const lockedIds = new Set(locked.map(t => t.id));
        const acceptedIds = new Set();
        const pp = buildPools();

        const startSeed = s.seed;
        const startTotalPills = s.totalPills;
        const startLastPurple = s.lastPurpleTotalPills;
        const startRC = s.bornTalentRC;
        const baseSalt = s.salt;

        let seed = s.seed;
        let luckSeed = s.luckSeed;
        let luckSeedInited = s.luckSeedInited;
        let rc = s.bornTalentRC;
        let anyPurple = false;
        let wasPity = false;
        let pityArmed = n(zz.bd_zz) > 0 && s.talLucky >= n(zz.bd_zz);
        let forcePity = pityArmed;
        let rawAttempts = 0;
        const generated = [];
        const debugTrace = !!global.__INTL_WASH_DEBUG_TRACE__;
        const drawTrace = debugTrace ? [] : null;

        for (let slot = 0; slot < generatedCount; slot++) {
            let accepted = null;
            for (let retry = 0; retry < 1000; retry++) {
                rawAttempts++;
                let d;
                let usedPity = false;
                let rcForAttempt = null;
                let effectiveSalt = baseSalt;

                if (forcePity) {
                    if (!luckSeedInited) {
                        luckSeed = startSeed;
                        luckSeedInited = true;
                    }
                    d = rawDraw(luckSeed, pp.purple, pp.purpleTotal, s.roleId, baseSalt);
                    luckSeed = d.seed;
                    usedPity = true;
                } else {
                    rcForAttempt = rc;
                    effectiveSalt = baseSalt + rc;
                    d = rawDraw(seed, pp.all, pp.allTotal, s.roleId, effectiveSalt);
                    seed = d.seed;
                    rc += 1;
                }

                const id = d.id;
                const t = talent(id);
                const purple = !!t && n(t.weight, 1) === 4;
                const valid = !!t
                    && eligible.has(id)
                    && !lockedIds.has(id)
                    && !acceptedIds.has(id)
                    && !(anyPurple && purple);

                if (drawTrace) drawTrace.push({ id, accepted: valid, pity: usedPity, rc: rcForAttempt, effectiveSalt, seed: d.seed });
                if (!valid) continue;

                if (forcePity) {
                    forcePity = false;
                    wasPity = true;
                }
                accepted = { id, locked: false };
                acceptedIds.add(id);
                if (purple) anyPurple = true;
                generated.push(accepted);
                break;
            }
            if (!accepted) return null;
        }

        const pillsUsed = washCost(s, locked.length);
        const finalTotalPills = startTotalPills + pillsUsed;
        const qCounts = clone(s.qualityCounts || { 1: 0, 2: 0, 3: 0, 4: 0 });
        let purpleAdded = 0;
        generated.forEach(t => {
            const q = quality(t.id);
            qCounts[q] = n(qCounts[q]) + 1;
            if (q >= 4) purpleAdded += 1;
        });

        const next = copyOperationalState(s);
        next.seed = seed;
        next.luckSeed = luckSeed;
        next.luckSeedInited = luckSeedInited;
        next.bornTalentRC = rc;
        next.talents = locked.concat(generated);
        next.talLucky = anyPurple ? 0 : s.talLucky + generated.length;
        next.totalWash = s.totalWash + 1;
        next.totalTalentBars = s.totalTalentBars + generated.length;
        next.totalPills = finalTotalPills;
        next.bagPills = s.hasBagPills ? Math.max(0, s.bagPills - pillsUsed) : s.bagPills;
        next.goldCount = s.goldCount + purpleAdded;
        next.pityCount = s.pityCount + (wasPity ? 1 : 0);
        next.qualityCounts = qCounts;
        next.lastPurpleTotalPills = anyPurple ? finalTotalPills : startLastPurple;

        if (mutate) commitOperationalState(jsState, next);

        return {
            wash_no: next.totalWash,
            talents: clone(next.talents),
            got_gold: anyPurple,
            pills_used: pillsUsed,
            total_pills: finalTotalPills,
            bag_pills: s.hasBagPills ? next.bagPills : null,
            was_pity: wasPity,
            pity_armed: pityArmed,
            tal_lucky: next.talLucky,
            purple_gap_pills: anyPurple ? (startLastPurple != null ? finalTotalPills - startLastPurple : finalTotalPills) : null,
            is_first_purple: anyPurple && startLastPurple == null,
            start_s: startSeed,
            end_s: seed,
            luck_seed: luckSeedInited ? luckSeed : null,
            role_id: s.roleId,
            _intl_rc_start: startRC,
            _intl_rc_end: rc,
            _intl_raw_attempts: rawAttempts,
            _intl_draws: drawTrace || undefined,
            _intl_generated: clone(generated)
        };
    }

    function internationalWashMulti(jsState, times) {
        if (!jsState || !isInternationalSave(jsState)) return [];
        const eligible = getEligibility(jsState);
        const out = [];
        const count = Math.max(0, Math.floor(n(times)));
        for (let i = 0; i < count; i++) {
            const r = internationalWashCore(jsState, eligible, true);
            if (!r) break;
            out.push(r);
        }
        return out;
    }

    function internationalWashUntilGold(jsState, maxIterations) {
        if (!jsState || !isInternationalSave(jsState)) return [];
        const eligible = getEligibility(jsState);
        const out = [];
        const max = Math.max(0, Math.floor(n(maxIterations, 10000)));
        for (let i = 0; i < max; i++) {
            const r = internationalWashCore(jsState, eligible, true);
            if (!r) break;
            out.push(r);
            if (r.got_gold) break;
        }
        return out;
    }

    function internationalWashUntilTalentName(jsState, name, maxIterations) {
        if (!jsState || !isInternationalSave(jsState)) return [];
        const target = String(name || '');
        const eligible = getEligibility(jsState);
        const out = [];
        const max = Math.max(0, Math.floor(n(maxIterations, 5000)));
        for (let i = 0; i < max; i++) {
            const r = internationalWashCore(jsState, eligible, true);
            if (!r) break;
            out.push(r);
            if ((r.talents || []).some(x => {
                const t = talent(x.id);
                return t && t.name === target;
            })) break;
        }
        return out;
    }

    function internationalPreviewSequence(jsState, maxBars) {
        if (!jsState || !isInternationalSave(jsState)) return { purples: [], luck_pool: [] };
        const eligible = getEligibility(jsState);
        const sim = copyOperationalState(jsState);
        const limit = Math.max(1, Math.floor(n(maxBars, 3000)));
        const startBars = sim.totalTalentBars;
        const stopAt = startBars + limit;
        const purples = [];
        const lastByType = Object.create(null);

        (sim.talents || []).forEach(slot => {
            const td = talent(slot.id);
            if (!td || td.type == null) return;
            lastByType[String(td.type)] = {
                id: n(slot.id), name: td.name || String(slot.id),
                barNo: 0, washTimes: 0,
                purple: isPurple(slot.id), shenmai: isShenmai(td)
            };
        });

        while (sim.totalTalentBars < stopAt) {
            const beforeBars = sim.totalTalentBars;
            const r = internationalWashCore(sim, eligible, true);
            if (!r) break;
            const gen = r._intl_generated || [];

            for (let i = 0; i < gen.length; i++) {
                const id = n(gen[i].id);
                const td = talent(id);
                if (!td) continue;
                const barNo = beforeBars + i + 1;
                if (barNo > stopAt) break;
                const typeKey = String(td.type != null ? td.type : id);
                const earlier = lastByType[typeKey] || null;
                const purple = isPurple(id);
                const shenmai = isShenmai(td);

                if (purple) {
                    const canExchange = !!earlier && (shenmai || !earlier.purple);
                    purples.push({
                        wash_no: barNo,
                        wash_times: r.wash_no,
                        talent_id: id,
                        talent_name: td.name || String(id),
                        weight: quality(id),
                        was_pity: !!r.was_pity,
                        earlier_conflict_name: earlier ? earlier.name : null,
                        earlier_conflict_wash_no: earlier ? earlier.barNo : 0,
                        earlier_conflict_wash_times: earlier ? earlier.washTimes : 0,
                        earlier_conflict_gap: earlier ? (barNo - earlier.barNo) : null,
                        earlier_conflict_is_purple: earlier ? !!earlier.purple : false,
                        can_exchange: canExchange,
                        block_reason: earlier
                            ? (canExchange ? null : '前置同类也是紫脉')
                            : '无前置同类冲突脉'
                    });
                }

                lastByType[typeKey] = {
                    id, name: td.name || String(id), barNo,
                    washTimes: r.wash_no, purple, shenmai
                };
            }
        }
        return { purples, luck_pool: [] };
    }

    function talentName(id) {
        const t = talent(id);
        return t && t.name ? t.name : String(id);
    }

    function findTalentIndexByName(s, name) {
        const targetName = String(name || '');
        return (s.talents || []).findIndex(slot => talentName(n(slot.id)) === targetName);
    }

    function setTalentLockedByName(s, name, locked) {
        const idx = findTalentIndexByName(s, name);
        if (idx < 0) return -1;
        s.talents[idx].locked = !!locked;
        return idx;
    }

    function applyWasmOperationalState(s, ws) {
        if (!s || !ws) return;
        const keepRC = n(s.bornTalentRC);
        s.mode = ws.mode;
        s.zizhi = n(ws.zizhi, s.zizhi);
        s.sex = n(ws.sex, s.sex);
        s.vip = n(ws.vip, s.vip);
        s.seed = n(ws.seed);
        s.luckSeed = n(ws.luck_seed);
        s.luckSeedInited = !!ws.luck_seed_inited;
        s.roleId = n(ws.role_id, s.roleId);
        s.salt = n(ws.salt, s.salt);
        s.talents = clone(ws.talents || []);
        s.talLucky = n(ws.tal_lucky);
        s.totalWash = n(ws.total_wash);
        s.totalTalentBars = n(ws.total_talent_bars);
        s.totalPills = n(ws.total_pills);
        s.bagPills = n(ws.bag_pills);
        s.hasBagPills = !!ws.has_bag_pills;
        s.goldCount = n(ws.gold_count);
        s.pityCount = n(ws.pity_count);
        s.qualityCounts = clone(ws.quality_counts || s.qualityCounts || { 1: 0, 2: 0, 3: 0, 4: 0 });
        s.lastPurpleTotalPills = ws.last_purple_total_pills == null ? null : n(ws.last_purple_total_pills);
        s.exchangeCount = n(ws.exchange_count);
        s.strGift = n(ws.str_gift, s.strGift);
        s.conGift = n(ws.con_gift, s.conGift);
        s.dexGift = n(ws.dex_gift, s.dexGift);
        s.intGift = n(ws.int_gift, s.intGift);
        s.roleLevel = n(ws.role_level, s.roleLevel);
        s.roleStats = s.roleStats || clone(ws.role_stats || {});
        s.globalVars = s.globalVars || clone(ws.global_vars || {});
        s.bornTalentRC = keepRC;
    }

    function internationalExchangeViaWasm(s, index) {
        if (!s || index < 0 || typeof global.syncStateToWasm !== 'function' || typeof global.wasmExchangeTalent !== 'function') return null;
        const rcBefore = n(s.bornTalentRC);
        global.syncStateToWasm(s);
        const raw = global.wasmExchangeTalent(index);
        if (!raw || raw.success === false) return raw || null;
        const ws = typeof global.wasmGetState === 'function' ? global.wasmGetState() : null;
        if (ws) applyWasmOperationalState(s, ws);
        s.bornTalentRC = rcBefore;
        return raw;
    }

    function exchangeConflictAt(s, index) {
        const slots = s.talents || [];
        if (index < 0 || index >= slots.length) return null;
        const shenIdxs = [];
        slots.forEach((slot, i) => {
            if (isShenmai(talent(n(slot.id)))) shenIdxs.push(i);
        });
        if (shenIdxs.length >= 2 && shenIdxs.includes(index)) {
            const partner = shenIdxs.find(i => i !== index);
            return { canExchange: true, shenmaiMutual: true, earlierIndex: partner };
        }
        const td = talent(n(slots[index].id));
        if (!td || td.type == null || !isPurple(n(slots[index].id))) return null;
        for (let i = 0; i < index; i++) {
            const earlier = talent(n(slots[i].id));
            if (!earlier || earlier.type == null || n(earlier.type) !== n(td.type)) continue;
            if (isShenmai(td) || !isPurple(n(slots[i].id))) {
                return { canExchange: true, shenmaiMutual: false, earlierIndex: i };
            }
            return { canExchange: false, shenmaiMutual: false, earlierIndex: i };
        }
        return null;
    }

    function internationalExchangePure(s, index, eligible) {
        const slots = s && s.talents || [];
        if (index < 0 || index >= slots.length) return null;
        const removed = slots[index];
        const fromName = talentName(n(removed.id));
        const nextSlots = clone(slots);
        nextSlots.splice(index, 1);
        const existingIds = new Set(nextSlots.map(x => n(x.id)));
        const pp = buildPools();
        let luck = s.luckSeedInited ? n(s.luckSeed) : n(s.seed);
        let chosen = null;
        let rolls = 0;

        for (let retry = 0; retry < 1000; retry++) {
            rolls++;
            const d = rawDraw(luck, pp.purple, pp.purpleTotal, s.roleId, s.salt);
            luck = d.seed;
            if (!eligible.has(d.id) || existingIds.has(d.id)) continue;
            chosen = d.id;
            break;
        }
        if (chosen == null) return null;

        s.luckSeedInited = true;
        s.luckSeed = luck;
        s.talents = nextSlots.concat([{ id: chosen, locked: false }]);
        s.talLucky = 0;
        s.exchangeCount = n(s.exchangeCount) + 1;
        return {
            success: true,
            exchanged_from: fromName,
            exchanged_to: talentName(chosen),
            _pity_rolls: rolls
        };
    }

    function countLuckRollsToSeed(startSeed, endSeed, s, maxRolls) {
        let cur = n(startSeed);
        const end = n(endSeed);
        if (cur === end) return 0;
        const pp = buildPools();
        const max = Math.max(1, n(maxRolls, 1000));
        for (let i = 1; i <= max; i++) {
            const d = rawDraw(cur, pp.purple, pp.purpleTotal, s.roleId, s.salt);
            cur = d.seed;
            if (cur === end) return i;
        }
        return 0;
    }

    function runExchangeChain(s, index, eligible) {
        const chain = [];
        const luckSeedStart = s.luckSeedInited ? n(s.luckSeed) : n(s.seed);
        let firstLuckAfter = luckSeedStart;
        let firstRolls = 0;
        let first = true;
        let currentIndex = index;

        for (let guard = 0; guard < 24; guard++) {
            const conflict = exchangeConflictAt(s, currentIndex);
            if (!conflict || !conflict.canExchange) break;
            const beforeLuck = s.luckSeedInited ? n(s.luckSeed) : n(s.seed);
            const raw = internationalExchangePure(s, currentIndex, eligible);
            if (!raw || raw.success === false) break;
            const toName = String(raw.exchanged_to || '');
            if (!toName) break;
            chain.push(toName);

            if (first) {
                first = false;
                firstLuckAfter = n(s.luckSeed);
                firstRolls = n(raw._pity_rolls);
            }

            currentIndex = findTalentIndexByName(s, toName);
            if (currentIndex < 0) break;
            const nextConflict = exchangeConflictAt(s, currentIndex);
            if (!nextConflict || !nextConflict.canExchange) break;
        }

        return {
            chain,
            final_name: chain.length ? chain[chain.length - 1] : '',
            luck_seed_start: luckSeedStart,
            luck_seed_after_first: firstLuckAfter,
            pity_rolls_first: firstRolls
        };
    }

    function washTimesInternational(s, eligible, times) {
        const count = Math.max(0, Math.floor(n(times)));
        for (let i = 0; i < count; i++) {
            if (!internationalWashCore(s, eligible, true)) return false;
        }
        return true;
    }

    function washUntilTalentInternational(s, eligible, name, maxIterations) {
        if (findTalentIndexByName(s, name) >= 0) return true;
        const max = Math.max(1, Math.floor(n(maxIterations, 20000)));
        for (let i = 0; i < max; i++) {
            if (!internationalWashCore(s, eligible, true)) return false;
            if (findTalentIndexByName(s, name) >= 0) return true;
        }
        return false;
    }

    function lastSlotName(s) {
        const slots = s.talents || [];
        return slots.length ? talentName(n(slots[slots.length - 1].id)) : '';
    }

    function makeRouteError(text) {
        return String(text || '推演失败');
    }

    function simulateInternationalExchangeRoute(baseState, targets, pad, eligible) {
        const s = copyOperationalState(baseState);
        const nodes = [];
        const list = Array.isArray(targets) ? targets : [];

        for (let ti = 0; ti < list.length; ti++) {
            const target = list[ti] || {};
            const purpleName = String(target.purple_name || '');
            const conflictName = String(target.conflict_name || '');
            if (!purpleName) continue;

            if (!target.lock_only && conflictName) {
                if (ti === 0 && n(target.conflict_wash_no) > 0) {
                    if (!washTimesInternational(s, eligible, n(target.conflict_wash_no))) {
                        return { pad, nodes, error: makeRouteError(`无法推进到冲突脉「${conflictName}」`) };
                    }
                    if (findTalentIndexByName(s, conflictName) < 0) {
                        return { pad, nodes, error: makeRouteError(`未洗到冲突脉「${conflictName}」`) };
                    }
                } else if (findTalentIndexByName(s, conflictName) < 0) {
                    if (!washUntilTalentInternational(s, eligible, conflictName, 20000)) {
                        return { pad, nodes, error: makeRouteError(`未洗到冲突脉「${conflictName}」`) };
                    }
                }
                setTalentLockedByName(s, conflictName, true);
            }

            if (!washUntilTalentInternational(s, eligible, purpleName, 20000)) {
                return { pad, nodes, error: makeRouteError(`未洗到紫脉「${purpleName}」`) };
            }
            setTalentLockedByName(s, purpleName, true);

            if (ti === 0 && pad > 0) {
                if (!washTimesInternational(s, eligible, pad)) {
                    return { pad, nodes, error: makeRouteError(`锁紫后无法继续垫洗 ${pad} 次`) };
                }
            }

            const node = {
                purple_name: purpleName,
                conflict_name: conflictName || '—',
                chain: [],
                final_name: purpleName,
                last_slot_name: lastSlotName(s),
                seed_at_exchange: n(s.seed),
                shenmai_forks: [],
                chain_stop_alts: []
            };

            if (target.lock_only) {
                const idx = findTalentIndexByName(s, purpleName);
                const c = exchangeConflictAt(s, idx);
                if (!c || !c.canExchange) {
                    node.conflict_name = '锁留（待互冲）';
                    node.chain = [`${purpleName}（锁留）`];
                    node.final_name = purpleName;
                    nodes.push(node);
                    continue;
                }
            }

            let targetIndex = findTalentIndexByName(s, purpleName);
            if (targetIndex < 0) {
                return { pad, nodes, error: makeRouteError(`紫脉「${purpleName}」在置换前丢失`) };
            }

            const shenIdxs = (s.talents || []).map((slot, i) => isShenmai(talent(n(slot.id))) ? i : -1).filter(i => i >= 0);
            const isMutualShenmai = shenIdxs.length >= 2 && shenIdxs.includes(targetIndex);
            let routeResult = null;

            if (isMutualShenmai) {
                node.conflict_name = `神脉互冲（${shenIdxs.length}条均可置换）`;
                const preFork = copyOperationalState(s);
                const forks = [];
                let canonicalState = null;

                for (const shenIndex of shenIdxs) {
                    const branch = copyOperationalState(preFork);
                    const fromName = talentName(n(branch.talents[shenIndex].id));
                    const r = runExchangeChain(branch, shenIndex, eligible);
                    forks.push({
                        exchange_from: fromName,
                        chain: r.chain,
                        final_name: r.final_name || fromName,
                        luck_seed_start: r.luck_seed_start,
                        luck_seed_after_first: r.luck_seed_after_first,
                        pity_rolls_first: r.pity_rolls_first
                    });
                    if (fromName === purpleName) {
                        routeResult = r;
                        canonicalState = branch;
                    }
                }
                node.shenmai_forks = forks;
                if (!canonicalState && shenIdxs.length) {
                    const branch = copyOperationalState(preFork);
                    routeResult = runExchangeChain(branch, shenIdxs[shenIdxs.length - 1], eligible);
                    canonicalState = branch;
                }
                if (canonicalState) commitOperationalState(s, canonicalState);
            } else {
                routeResult = runExchangeChain(s, targetIndex, eligible);
            }

            if (!routeResult || !routeResult.chain.length) {
                return { pad, nodes, error: makeRouteError(`紫脉「${purpleName}」当前不可置换`) };
            }

            node.chain = routeResult.chain;
            node.final_name = routeResult.final_name || node.chain[node.chain.length - 1] || purpleName;
            nodes.push(node);

            if (conflictName) setTalentLockedByName(s, conflictName, false);
            setTalentLockedByName(s, node.final_name, true);
        }

        return { pad, nodes, error: null };
    }

    function exchangePreviewSignature(s, targets) {
        const slots = (s.talents || []).map(x => `${n(x.id)}:${x.locked ? 1 : 0}`).join(',');
        return [
            eligibilitySignature(s),
            n(s.seed), n(s.luckSeed), s.luckSeedInited ? 1 : 0, n(s.bornTalentRC),
            n(s.talLucky), n(s.totalWash), n(s.totalTalentBars), n(s.totalPills),
            n(s.bagPills), s.hasBagPills ? 1 : 0, n(s.exchangeCount), slots,
            JSON.stringify(targets || [])
        ].join('|');
    }

    function internationalPreviewExchangePads(jsState, targets, maxPad) {
        if (!jsState || !isInternationalSave(jsState)) return [];
        const max = Math.max(0, Math.floor(n(maxPad)));
        const sig = exchangePreviewSignature(jsState, targets);
        const sameContext = exchangePreviewCache
            && exchangePreviewCache.sig === sig
            && exchangePreviewCache.saveDataRef === jsState.saveData
            && exchangePreviewCache.roleRawRef === jsState.roleRaw;
        if (!sameContext) {
            exchangePreviewCache = {
                sig,
                saveDataRef: jsState.saveData,
                roleRawRef: jsState.roleRaw,
                results: []
            };
        }
        if (exchangePreviewCache.results.length > max) {
            return exchangePreviewCache.results.slice(0, max + 1);
        }

        const savedWasmState = typeof global.wasmGetState === 'function' ? global.wasmGetState() : null;
        const eligible = getEligibility(jsState);
        try {
            for (let pad = exchangePreviewCache.results.length; pad <= max; pad++) {
                exchangePreviewCache.results.push(simulateInternationalExchangeRoute(jsState, targets, pad, eligible));
            }
        } catch (e) {
            console.error('internationalPreviewExchangePads failed', e);
        } finally {
            if (savedWasmState && typeof global.wasmSetState === 'function') global.wasmSetState(savedWasmState);
        }
        return exchangePreviewCache.results.slice(0, max + 1);
    }

    global.isInternationalSave = isInternationalSave;
    global.invalidateInternationalWashContext = invalidateInternationalWashContext;
    global.getInternationalEligibleTalentIds = s => Array.from(getEligibility(s));
    global.internationalWashCore = internationalWashCore;
    global.internationalWashMulti = internationalWashMulti;
    global.internationalWashUntilGold = internationalWashUntilGold;
    global.internationalWashUntilTalentName = internationalWashUntilTalentName;
    global.internationalPreviewSequence = internationalPreviewSequence;
    global.internationalPreviewExchangePads = internationalPreviewExchangePads;
    global.__INTL_WASH_DEBUG__ = { nextRand, rawDraw, buildPools, RAW_ORDER, CLASS_WEIGHT };
})(typeof window !== 'undefined' ? window : globalThis);

(function (global) {
    'use strict';

    if (typeof global.wasmSetState !== 'function' || typeof global.wasmGetState !== 'function') return;

    const _cnSetState = global.wasmSetState;
    const _cnGetState = global.wasmGetState;
    const _cnGetAvailableTalents = global.wasmGetAvailableTalents;
    const _cnDoWash = global.wasmDoWash;
    const _cnWashMulti = global.wasmWashMulti;
    const _cnWashUntilGold = global.wasmWashUntilGold;
    const _cnWashUntilTalentName = global.wasmWashUntilTalentName;
    const _cnPreviewSequence = global.wasmPreviewSequence;
    const _cnPreviewExchangePads = global.wasmPreviewExchangePads;
    const _cnExchangeTalent = global.wasmExchangeTalent;

    let shadowState = null;
    let intlWorkingState = null;
    let intlEligibleSet = null;

    function clone(value) {
        return value == null ? value : JSON.parse(JSON.stringify(value));
    }

    function num(value, fallback = 0) {
        const result = Number(value);
        return Number.isFinite(result) ? result : fallback;
    }

    function normalizeChannel(value) {
        return String(value || '').trim();
    }

    function isInternationalChannel(value) {
        const channel = normalizeChannel(value).toLowerCase();
        return channel === '国际服' || channel === '國際服' || channel === 'oversea' || channel === 'international';
    }

    function isIntlSnake(state) {
        return !!state && isInternationalChannel(state.save_channel || state.channel);
    }

    function stripIntlFields(state) {
        const copy = clone(state || {});
        delete copy.born_talent_rc;
        delete copy.save_channel;
        delete copy.channel;
        return copy;
    }

    function snakeToIntl(state) {
        const s = state || {};
        return {
            mode: s.mode,
            zizhi: num(s.zizhi, 153),
            sex: num(s.sex, 1),
            vip: num(s.vip, 1),
            seed: num(s.seed),
            luckSeed: num(s.luck_seed),
            luckSeedInited: !!s.luck_seed_inited,
            roleId: num(s.role_id),
            salt: num(s.salt),
            talents: clone(s.talents || []),
            talLucky: num(s.tal_lucky),
            totalWash: num(s.total_wash),
            totalTalentBars: num(s.total_talent_bars),
            totalPills: num(s.total_pills),
            bagPills: num(s.bag_pills),
            hasBagPills: !!s.has_bag_pills,
            goldCount: num(s.gold_count),
            pityCount: num(s.pity_count),
            qualityCounts: clone(s.quality_counts || { 1: 0, 2: 0, 3: 0, 4: 0 }),
            lastPurpleTotalPills: s.last_purple_total_pills == null ? null : num(s.last_purple_total_pills),
            exchangeCount: num(s.exchange_count),
            strGift: num(s.str_gift),
            conGift: num(s.con_gift),
            dexGift: num(s.dex_gift),
            intGift: num(s.int_gift),
            roleLevel: num(s.role_level, 90),
            roleStats: clone(s.role_stats || {}),
            globalVars: clone(s.global_vars || {}),
            bornTalentRC: num(s.born_talent_rc),
            saveChannel: normalizeChannel(s.save_channel || s.channel || '国际服'),
            saveData: s.__save_data_ref || null,
            roleRaw: s.__role_raw_ref || null,
        };
    }

    function intlToSnake(intl, destination) {
        const dst = destination || {};
        dst.mode = intl.mode;
        dst.zizhi = num(intl.zizhi, dst.zizhi || 153);
        dst.sex = num(intl.sex, dst.sex || 1);
        dst.vip = num(intl.vip, dst.vip || 1);
        dst.seed = num(intl.seed);
        dst.luck_seed = num(intl.luckSeed);
        dst.luck_seed_inited = !!intl.luckSeedInited;
        dst.role_id = num(intl.roleId);
        dst.salt = num(intl.salt);
        dst.talents = clone(intl.talents || []);
        dst.tal_lucky = num(intl.talLucky);
        dst.total_wash = num(intl.totalWash);
        dst.total_talent_bars = num(intl.totalTalentBars);
        dst.total_pills = num(intl.totalPills);
        dst.bag_pills = num(intl.bagPills);
        dst.has_bag_pills = !!intl.hasBagPills;
        dst.gold_count = num(intl.goldCount);
        dst.pity_count = num(intl.pityCount);
        dst.quality_counts = clone(intl.qualityCounts || { 1: 0, 2: 0, 3: 0, 4: 0 });
        dst.last_purple_total_pills = intl.lastPurpleTotalPills == null ? null : num(intl.lastPurpleTotalPills);
        dst.exchange_count = num(intl.exchangeCount);
        dst.str_gift = num(intl.strGift);
        dst.con_gift = num(intl.conGift);
        dst.dex_gift = num(intl.dexGift);
        dst.int_gift = num(intl.intGift);
        dst.role_level = num(intl.roleLevel, 90);
        dst.role_stats = clone(intl.roleStats || dst.role_stats || {});
        dst.global_vars = clone(intl.globalVars || dst.global_vars || {});
        dst.born_talent_rc = num(intl.bornTalentRC);
        dst.save_channel = normalizeChannel(intl.saveChannel || dst.save_channel || '国际服');
        return dst;
    }

    function syncMutableShadowFromIntl(intl) {
        if (!shadowState || !intl) return;
        shadowState.seed = num(intl.seed);
        shadowState.luck_seed = num(intl.luckSeed);
        shadowState.luck_seed_inited = !!intl.luckSeedInited;
        shadowState.talents = (intl.talents || []).map(item => ({ id: num(item.id), locked: !!item.locked }));
        shadowState.tal_lucky = num(intl.talLucky);
        shadowState.total_wash = num(intl.totalWash);
        shadowState.total_talent_bars = num(intl.totalTalentBars);
        shadowState.total_pills = num(intl.totalPills);
        shadowState.bag_pills = num(intl.bagPills);
        shadowState.has_bag_pills = !!intl.hasBagPills;
        shadowState.gold_count = num(intl.goldCount);
        shadowState.pity_count = num(intl.pityCount);
        shadowState.quality_counts = { ...(intl.qualityCounts || { 1: 0, 2: 0, 3: 0, 4: 0 }) };
        shadowState.last_purple_total_pills = intl.lastPurpleTotalPills == null ? null : num(intl.lastPurpleTotalPills);
        shadowState.exchange_count = num(intl.exchangeCount);
        shadowState.born_talent_rc = num(intl.bornTalentRC);
        shadowState.save_channel = normalizeChannel(intl.saveChannel || shadowState.save_channel || '国际服');
    }

    function resetIntlWorkingState() {
        intlWorkingState = null;
        intlEligibleSet = null;
    }

    function ensureIntlWorkingState() {
        if (!shadowState || !isIntlSnake(shadowState)) return false;
        if (intlWorkingState && intlEligibleSet) return true;
        intlWorkingState = snakeToIntl(shadowState);
        const available = typeof global.getInternationalEligibleTalentIds === 'function'
            ? global.getInternationalEligibleTalentIds(intlWorkingState)
            : (global.__intlGetEligibleIds(intlWorkingState) || []);
        intlEligibleSet = new Set(available
            .map(item => num(item && typeof item === 'object' ? item.id : item))
            .filter(id => id > 0));
        return true;
    }

    function syncOriginal(state) {
        return _cnSetState(stripIntlFields(state));
    }

    global.__intlGetEligibleIds = function (intlState) {
        if (typeof _cnSetState !== 'function' || typeof _cnGetAvailableTalents !== 'function') return [];
        let saved = null;
        try { saved = _cnGetState ? _cnGetState() : null; } catch (_) { }
        try {
            const probe = intlToSnake(intlState, {});
            if (!_cnSetState(stripIntlFields(probe))) return [];
            return _cnGetAvailableTalents() || [];
        } finally {
            try { if (saved) _cnSetState(saved); } catch (_) { }
        }
    };

    global.wasmSetState = function (obj) {
        if (!isIntlSnake(obj)) {
            shadowState = null;
            resetIntlWorkingState();
            return _cnSetState(stripIntlFields(obj));
        }
        shadowState = clone(obj || {});
        shadowState.born_talent_rc = num(shadowState.born_talent_rc);
        shadowState.save_channel = normalizeChannel(shadowState.save_channel || '国际服');
        resetIntlWorkingState();
        return syncOriginal(shadowState);
    };

    global.wasmGetState = function () {
        if (shadowState && isIntlSnake(shadowState)) return clone(shadowState);
        return _cnGetState ? _cnGetState() : null;
    };

    function doIntlWash() {
        if (!shadowState || !isIntlSnake(shadowState) || typeof global.internationalWashCore !== 'function') {
            return _cnDoWash ? _cnDoWash() : null;
        }
        if (!ensureIntlWorkingState()) return null;
        const result = global.internationalWashCore(intlWorkingState, intlEligibleSet, true);
        if (!result) return null;
        syncMutableShadowFromIntl(intlWorkingState);
        return result;
    }

    global.wasmDoWash = function () {
        return shadowState && isIntlSnake(shadowState) ? doIntlWash() : (_cnDoWash ? _cnDoWash() : null);
    };

    global.wasmWashMulti = function (times) {
        if (!shadowState || !isIntlSnake(shadowState)) return _cnWashMulti ? _cnWashMulti(times) : [];
        if (!ensureIntlWorkingState()) return [];
        const out = [];
        const count = Math.max(0, Math.floor(num(times)));
        for (let index = 0; index < count; index += 1) {
            const result = global.internationalWashCore(intlWorkingState, intlEligibleSet, true);
            if (!result) break;
            out.push(result);
        }
        syncMutableShadowFromIntl(intlWorkingState);
        return out;
    };

    global.wasmWashUntilGold = function (maxIterations) {
        if (!shadowState || !isIntlSnake(shadowState)) return _cnWashUntilGold ? _cnWashUntilGold(maxIterations) : [];
        if (!ensureIntlWorkingState()) return [];
        const out = [];
        const max = Math.max(0, Math.floor(num(maxIterations, 10000)));
        for (let index = 0; index < max; index += 1) {
            const result = global.internationalWashCore(intlWorkingState, intlEligibleSet, true);
            if (!result) break;
            out.push(result);
            if (result.got_gold) break;
        }
        syncMutableShadowFromIntl(intlWorkingState);
        return out;
    };

    global.wasmWashUntilTalentName = function (name, maxIterations) {
        if (!shadowState || !isIntlSnake(shadowState)) {
            return _cnWashUntilTalentName ? _cnWashUntilTalentName(name, maxIterations) : [];
        }
        if (!ensureIntlWorkingState()) return [];
        const target = String(name || '');
        const out = [];
        const max = Math.max(0, Math.floor(num(maxIterations, 5000)));
        for (let index = 0; index < max; index += 1) {
            const result = global.internationalWashCore(intlWorkingState, intlEligibleSet, true);
            if (!result) break;
            out.push(result);
            if ((result.talents || []).some(slot => {
                const talent = global.TALENT_DATA && global.TALENT_DATA[String(slot.id)];
                return talent && talent.name === target;
            })) break;
        }
        syncMutableShadowFromIntl(intlWorkingState);
        return out;
    };

    global.wasmPreviewSequence = function (maxBars) {
        if (!shadowState || !isIntlSnake(shadowState) || typeof global.internationalPreviewSequence !== 'function') {
            return _cnPreviewSequence ? _cnPreviewSequence(maxBars) : { purples: [], luck_pool: [] };
        }
        return global.internationalPreviewSequence(snakeToIntl(shadowState), maxBars)
            || { purples: [], luck_pool: [] };
    };

    global.wasmPreviewExchangePads = function (targets, maxPad) {
        if (!shadowState || !isIntlSnake(shadowState) || typeof global.internationalPreviewExchangePads !== 'function') {
            return _cnPreviewExchangePads ? _cnPreviewExchangePads(targets, maxPad) : [];
        }
        return global.internationalPreviewExchangePads(snakeToIntl(shadowState), targets, maxPad) || [];
    };

    global.wasmExchangeTalent = function (index) {
        if (!shadowState || !isIntlSnake(shadowState) || typeof _cnExchangeTalent !== 'function') {
            return _cnExchangeTalent ? _cnExchangeTalent(index) : null;
        }
        const rcBefore = num(shadowState.born_talent_rc);
        const channelBefore = shadowState.save_channel;
        if (!syncOriginal(shadowState)) return null;
        const raw = _cnExchangeTalent(index);
        const next = _cnGetState ? _cnGetState() : null;
        if (next) {
            next.born_talent_rc = rcBefore;
            next.save_channel = channelBefore || '国际服';
            shadowState = clone(next);
            resetIntlWorkingState();
        }
        return raw;
    };

    global.__INTL_WASH_FACADE__ = Object.freeze({
        isInternationalChannel,
        isIntlSnake,
        snakeToIntl,
        intlToSnake,
        getShadowState: () => clone(shadowState),
        originals: {
            setState: _cnSetState,
            getState: _cnGetState,
            doWash: _cnDoWash,
            washMulti: _cnWashMulti,
            washUntilGold: _cnWashUntilGold,
            washUntilTalentName: _cnWashUntilTalentName,
            previewSequence: _cnPreviewSequence,
            previewExchangePads: _cnPreviewExchangePads,
            exchangeTalent: _cnExchangeTalent,
        },
    });
})(typeof window !== 'undefined' ? window : globalThis);
