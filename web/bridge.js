/*
 * APK-WEB-BRIDGE —— APK 内嵌网页的「导出 → 分享」桥
 * =====================================================
 * 为什么需要它：
 *   WebView 里 blob 下载是不生效的（`a.download` + `a.click()` 在浏览器里会下载，
 *   在 WebView 里既不触发 DownloadListener 也存不下文件）。所以网页上所有
 *   「导出 / 下载」按钮在手机上都是死按钮。
 *
 * 做法：
 *   把所有「blob + a[download] + click」这种导出写法统一改成调用原生分享
 *   （Android 侧 `YanyuBridge.shareText(name, text)`，见 YanyuShareBridge.kt）。
 *   这样不需要给每个导出按钮单独打补丁，以后新加的导出功能也自动生效。
 *
 * 生效条件：
 *   只有注入了原生桥（`window.YanyuBridge`）时才介入；PC / 浏览器 / 线上站
 *   加载到本文件也完全不影响原有下载行为。
 *
 * 注入方式：
 *   APK 的 MainActivity 在每个 *.html 的 </body> 前插一行
 *   `<script src="/assets/apk/bridge.js"></script>`（见 MainActivity.injectBridgeTag）。
 */
(function () {
    'use strict';

    var MARK = 'APK-WEB-BRIDGE';
    var bridge = window.YanyuBridge;

    // 没有原生桥 → 完全不介入，保持网页原本的下载行为
    if (!bridge || typeof bridge.shareText !== 'function') return;

    window.__YANYU_APK_BRIDGE__ = MARK;

    /** 防止「分享失败 → 回落下载 → 又被拦截」的死循环 */
    var inShare = false;

    function callShare(name, text) {
        if (inShare) return false;
        inShare = true;
        try {
            return !!bridge.shareText(String(name || '导出.txt'), String(text == null ? '' : text));
        } catch (e) {
            return false;
        } finally {
            inShare = false;
        }
    }

    /** 给网页脚本（含以后新加的功能）一个显式入口：window.YanyuShare.text('a.txt', 文本) */
    window.YanyuShare = { mark: MARK, available: true, text: callShare };

    function shareFailed(name) {
        window.alert('导出失败：' + (name || '文件') + ' 内容为空或分享不可用。');
    }

    /* ── 记下 URL.createObjectURL 产生的 blob，供点击时取回正文 ───────── */
    var blobByUrl = new Map();
    var MAX_PENDING = 12;

    var origCreateObjectURL = URL.createObjectURL;
    if (typeof origCreateObjectURL === 'function') {
        URL.createObjectURL = function (obj) {
            var url = origCreateObjectURL.apply(URL, arguments);
            try {
                if (obj && typeof Blob !== 'undefined' && obj instanceof Blob) {
                    blobByUrl.set(url, obj);
                    if (blobByUrl.size > MAX_PENDING) {
                        // 兜底：只创建 URL 却不点击时，别让 Map 无限增长
                        var oldest = blobByUrl.keys().next().value;
                        blobByUrl.delete(oldest);
                    }
                }
            } catch (e) { }
            return url;
        };
    }

    function blobToText(blob) {
        if (typeof blob.text === 'function') return blob.text();
        // 老 WebView 没有 Blob.text()，退到 FileReader
        return new Promise(function (resolve, reject) {
            try {
                var reader = new FileReader();
                reader.onload = function () { resolve(String(reader.result == null ? '' : reader.result)); };
                reader.onerror = function () { reject(reader.error || new Error('read failed')); };
                reader.readAsText(blob, 'utf-8');
            } catch (e) {
                reject(e);
            }
        });
    }

    function shareBlob(name, blob) {
        blobToText(blob).then(function (text) {
            if (!callShare(name, text)) shareFailed(name);
        }).catch(function () {
            shareFailed(name);
        });
    }

    /* ── 拦截 a[download].click()（网页所有导出的共同出口） ──────────── */
    var proto = window.HTMLAnchorElement && window.HTMLAnchorElement.prototype;
    if (proto && typeof proto.click === 'function') {
        var origClick = proto.click;
        proto.click = function () {
            try {
                var name = this.getAttribute ? this.getAttribute('download') : '';
                if (!inShare && name) {
                    var url = this.href || '';
                    var blob = blobByUrl.get(url);
                    if (blob) {
                        blobByUrl.delete(url);
                        shareBlob(name, blob);
                        return;      // 不真的点击 → 不触发那个在 WebView 里没用的下载
                    }
                }
            } catch (e) { }
            return origClick.apply(this, arguments);
        };
    }
})();
