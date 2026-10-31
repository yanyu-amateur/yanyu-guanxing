/*
 * wash_offline_boot.js
 * 洗脉引擎离线引导：把官方 wasm 内核（内联 base64）接入官方 wasm_api 加载链。
 * 原理：wasm_algorithm_api 的初始化只依赖 RuntimeAssetLoader.load('wash_engine')，
 *       这里注入一个返回本地字节的加载器，其余（bridge/configure/方法面）全部复用官方文件。
 * 加载顺序要求：必须在 algorithm_wasm_bridge.js / wasm_algorithm_api.js 之前执行
 *              （需先注入 YYJH_WASM_MODULES 与 RuntimeAssetLoader）。
 * 参照：shared/hengshan_offline_boot.js（恒山离线内核，同一套模式）
 */
(function () {
    'use strict';

    // 模块白名单：只加载洗脉内核（hengshan/equipment/drop 不引入）
    window.YYJH_WASM_MODULES = ['wash'];

    // 版本标识（wasm_api 展示 / configure 指纹用）
    if (!window.CORE_VERSION) window.CORE_VERSION = 'offline-wash';

    // 离线资源加载器：替代云端加密包下载 + 解密链
    var cachedBytes = null;
    window.RuntimeAssetLoader = {
        load: function (name) {
            if (name !== 'wash_engine') {
                return Promise.reject(new Error('离线加载器仅内置 wash_engine，收到：' + name));
            }
            if (!cachedBytes) {
                var b64 = window.WASH_ENGINE_WASM_B64 || '';
                if (!b64) throw new Error('离线内核缺失：未找到 window.WASH_ENGINE_WASM_B64');
                var binary = atob(b64);
                var bytes = new Uint8Array(binary.length);
                for (var i = 0; i < binary.length; i += 1) bytes[i] = binary.charCodeAt(i);
                cachedBytes = bytes;
            }
            return Promise.resolve(cachedBytes);
        }
    };
})();
