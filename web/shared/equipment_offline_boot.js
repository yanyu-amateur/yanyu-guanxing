/*
 * equipment_offline_boot.js
 * 装备引擎离线引导：把官方新装备内核（内联 base64，equipment_engine_b64.js）
 *   接入官方 wasm_algorithm_api.js 加载链。原理与 wash_offline_boot.js 完全一致。
 *
 * 作用：
 *   1) 声明模块白名单 window.YYJH_WASM_MODULES = ['equipment']；
 *   2) 注入 window.RuntimeAssetLoader.load('equipment_engine') 返回本地解码字节；
 *   3) 提供 window.initWasm() 壳，保持 equip.js:4920 `await initWasm()` 语义不变。
 *
 * 加载顺序：必须在 algorithm_wasm_bridge.js / wasm_algorithm_api.js 之前执行
 *           （需先注入 YYJH_WASM_MODULES 与 RuntimeAssetLoader）。
 * 参照：shared/wash_offline_boot.js（洗脉离线内核，同一套模式）。
 */
(function () {
    'use strict';

    // 模块白名单：只加载装备内核（wash/hengshan/drop 不引入，本页不需要）
    window.YYJH_WASM_MODULES = ['equipment'];

    // 版本标识（wasm_api 展示 / configure 指纹用）
    if (!window.CORE_VERSION) window.CORE_VERSION = 'offline-equipment';

    // 离线资源加载器：替代云端加密包下载 + 解密链
    var cachedBytes = null;
    window.RuntimeAssetLoader = {
        load: function (name) {
            if (name !== 'equipment_engine') {
                return Promise.reject(new Error('装备离线加载器仅内置 equipment_engine，收到：' + name));
            }
            if (!cachedBytes) {
                var b64 = window.EQUIPMENT_ENGINE_WASM_B64 || '';
                if (!b64) throw new Error('离线装备内核缺失：未找到 window.EQUIPMENT_ENGINE_WASM_B64');
                var binary = atob(b64);
                var bytes = new Uint8Array(binary.length);
                for (var i = 0; i < binary.length; i += 1) bytes[i] = binary.charCodeAt(i);
                cachedBytes = bytes;
            }
            return Promise.resolve(cachedBytes);
        }
    };

    // initWasm 壳：wasm_algorithm_api.js 在 script 加载时已自动 AlgorithmWasmBridge.initialize(['equipment'])，
    // WasmAlgorithmAPI.ready 是 Promise；这里只负责 await 它并把结果归一成 boolean。
    // 仅本页（equip/index.html）加载此文件，故不影响 wash/auto/hengshan 等页的 initWasm。
    window.initWasm = function () {
        if (typeof window.WasmAlgorithmAPI === 'undefined' || !window.WasmAlgorithmAPI || !window.WasmAlgorithmAPI.ready) {
            console.error('[equip] WasmAlgorithmAPI 未就绪（wasm_algorithm_api.js 未加载或顺序错误）');
            return Promise.resolve(false);
        }
        return window.WasmAlgorithmAPI.ready.then(function () {
            return true;
        }).catch(function (e) {
            console.error('[equip] WASM 内核就绪失败：', e);
            return false;
        });
    };
})();
