/*
 * wasm_compile_worker.js
 * 算法内核编译 Worker：接收原始 wasm 字节，异步编译后把 WebAssembly.Module 回传主线程。
 * 协议与 shared/algorithm_wasm_bridge.js 对应：
 *   收：{ type: 'wasm-compile', name, bytes }
 *   回：{ type: 'wasm-compiled',      name, module }
 *   或：{ type: 'wasm-compile-error', name, error }
 * 说明：file:// 下浏览器禁止从 null origin 创建 Worker，bridge 会自动捕获并
 *       回退到主线程 WebAssembly.compile，因此本文件缺失也不会阻断离线使用。
 */
'use strict';

self.onmessage = function (event) {
    const data = (event && event.data) || {};
    if (data.type !== 'wasm-compile') return;
    const name = data.name || 'default';
    try {
        if (typeof WebAssembly.compile !== 'function') {
            throw new Error('当前 Worker 环境不支持 WebAssembly.compile');
        }
        WebAssembly.compile(data.bytes).then(function (module) {
            self.postMessage({ type: 'wasm-compiled', name: name, module: module });
        }, function (error) {
            self.postMessage({
                type: 'wasm-compile-error',
                name: name,
                error: (error && error.message) || String(error),
            });
        });
    } catch (error) {
        self.postMessage({
            type: 'wasm-compile-error',
            name: name,
            error: (error && error.message) || String(error),
        });
    }
};
