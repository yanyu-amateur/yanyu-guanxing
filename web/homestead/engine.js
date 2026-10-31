/* 家园派遣推演引擎（自研 loader）
 * 仅加载已解出的 drop_engine.wasm（算法资产），自己实现 ABI 封装。
 * ABI: yanyu_alloc(len) 写请求 -> yanyu_call(ptr,len) 返回 i64(低32=响应指针,高32=响应长度)
 *      请求 JSON {method, ...input}; 响应 {ok, value/error}
 */
(function () {
    'use strict';
    var _exports = null;
    var _loading = null;
    var WASM_URL = './wasm/drop_engine.wasm';

    // 优先用内嵌 base64（file:// 双击打开可用）；失败再回退 fetch（本地服务）
    function loadBytes() {
        var b64 = window.DROP_ENGINE_WASM_B64;
        if (b64) {
            try {
                var binary = atob(b64);
                var bytes = new Uint8Array(binary.length);
                for (var i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
                return Promise.resolve(bytes);
            } catch (e) { /* fallthrough */ }
        }
        return fetch(WASM_URL, { cache: 'no-cache' }).then(function (resp) {
            if (!resp.ok) throw new Error('加载派遣引擎失败 (HTTP ' + resp.status + ')');
            return resp.arrayBuffer();
        });
    }

    function ensure() {
        if (_exports) return Promise.resolve(_exports);
        if (_loading) return _loading;
        _loading = loadBytes().then(function (bytes) {
            return WebAssembly.instantiate(bytes, {});
        }).then(function (result) {
            _exports = result.instance.exports;
            return _exports;
        });
        return _loading;
    }

    function alloc(exports, len) {
        var ptr = exports.yanyu_alloc(len);
        if (!ptr) {
            try { exports.memory.grow(16); } catch (e) { /* ignore */ }
            ptr = exports.yanyu_alloc(len);
        }
        return ptr;
    }

    function callWasm(method, input) {
        var exports = _exports;
        var req = new TextEncoder().encode(JSON.stringify(Object.assign({ method: method }, input || {})));
        var ptr = alloc(exports, req.length);
        if (!ptr) throw new Error('引擎内存分配失败');
        try {
            new Uint8Array(exports.memory.buffer, ptr, req.length).set(req);
            var ret = exports.yanyu_call(ptr, req.length);
            var rptr = Number(0xffffffffn & ret);
            var rlen = Number(ret >> 32n);
            if (!rptr || !rlen) throw new Error('引擎返回空响应');
            try {
                var json = new TextDecoder().decode(new Uint8Array(exports.memory.buffer, rptr, rlen));
                return JSON.parse(json);
            } finally {
                exports.yanyu_free(rptr, rlen);
            }
        } finally {
            exports.yanyu_free(ptr, req.length);
        }
    }

    function homePredict(input) {
        return ensure().then(function () { return callWasm('home.predict', { input: input }); });
    }
    function homeRolePools(roleIds) {
        return ensure().then(function () { return callWasm('home.rolePools', roleIds); });
    }

    window.HomesteadEngine = {
        ensure: ensure,
        homePredict: homePredict,
        homeRolePools: homeRolePools
    };
})();
