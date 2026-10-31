/* 跨 file:// 页面把存档带过去。
 *
 * 问题
 * ----
 * Firefox 默认 privacy.file_unique_origin = true，每个 html 文件算独立源：
 *   localStorage / sessionStorage / IndexedDB  → 子页面完全看不见
 *   cookie                                     → file:// 下禁用
 *   window.name                                → 跨源导航后被清空（Chrome 会保留）
 *   <script src>                               → 能跨源，但只能读文件、不能写文件
 *
 * 解法
 * ----
 * **URL 是跟着导航走的**。把存档压进 #gx=，点链接时拼到目标地址上：
 *   存档 1.5MB → pako.deflate → urlsafe base64 ≈ 400KB（实测 Firefox 可传）
 * 子页面 save_decrypt.js 一执行就解出来写进自己的 localStorage（见那边注释），
 * 所以它**第一次渲染就有数据**，不需要 reload、不需要叠层、原生跳转、零闪烁。
 *
 * 什么时候需要这样做
 * ------------------
 * 页面加载时探一次"别的 file:// 页面能不能读到我这份 localStorage"：
 *   · 能读（Chrome / Edge 的 file://，或本地 http 服务）→ 原生跳转，不带 hash
 *   · 读不到（Firefox 默认设置）                      → 原生跳转，带上 #gx=
 * 两条路都是普通导航，URL 和后退按钮都正常。
 */
(function () {
    'use strict';
    if (window.__yyjhPageBridge) return;
    window.__yyjhPageBridge = 'v5';

    var PROBE = 'gx-probe';
    var SHARED_FLAG = 'yyjh_storage_shared_v1';
    var PROBE_VALUE = 'yyjh-probe-ok';
    var HASH_PREFIX = '#gx=';
    /* URL 长度上限保护：实测 400KB hash 在 Firefox 下可传。
     * 存档更大（压完超过这个值）就不带 hash 了 —— 裸跳，子页面退回自己那份副本，
     * 总比导航失败好。 */
    var MAX_HASH_LEN = 1200000;

    var hosted = false;
    try { hosted = window.top !== window; } catch (e) { hosted = true; }

    // 被别的页面装进 iframe（调试用）：不参与导航接管
    if (hosted) return;

    function localRaw() {
        try { return (typeof shareStoreRaw === 'function') ? shareStoreRaw() : null; } catch (e) { return null; }
    }

    /* 存档 raw JSON 压成 urlsafe base64（去掉 = 和 +/，可直接放进 URL） */
    function packForUrl(text) {
        if (typeof pako === 'undefined' || typeof btoa !== 'function') return '';
        try {
            var bytes = pako.deflate(new TextEncoder().encode(text));
            var CHUNK = 8192;
            var bin = '';
            for (var i = 0; i < bytes.length; i += CHUNK) {
                bin += String.fromCharCode.apply(null, bytes.subarray(i, i + CHUNK));
            }
            return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
        } catch (e) {
            return '';
        }
    }

    /* 探测"别的 file:// 页面能不能读到我这份 localStorage"。
     * 页面加载时做（不是点链接时），结果缓存在 sessionStorage，一次会话只探一次。 */
    var probeDone = null;
    var probePromise = new Promise(function (resolve) {
        var cached = null;
        try { cached = sessionStorage.getItem(SHARED_FLAG); } catch (e) { }
        if (cached === '1' || cached === '0') { resolve(cached === '1'); return; }
        probeDone = resolve;
        try { localStorage.setItem('yyjh_probe_v1', PROBE_VALUE); } catch (e) { }

        var p = document.createElement('iframe');
        p.style.display = 'none';
        p.setAttribute('aria-hidden', 'true');
        try { p.src = new URL('./shared/storage_probe.html', location.href).href; } catch (e) { resolve(false); return; }
        (document.body || document.documentElement).appendChild(p);
        window.setTimeout(function () {
            if (p.parentNode) p.parentNode.removeChild(p);
            resolve(false);      // 探不出来按"不共享"处理（带 hash，功能优先）
        }, 1200);
    });

    window.addEventListener('message', function (ev) {
        var d = ev && ev.data;
        if (!d || d.type !== PROBE) return;
        var shared = (d.seen === PROBE_VALUE);
        try { sessionStorage.setItem(SHARED_FLAG, shared ? '1' : '0'); } catch (e) { }
        if (probeDone) probeDone(shared);
    });

    function goWithHash(href) {
        var raw = localRaw();
        var u = new URL(href, location.href);
        u.hash = '';                     // 目标页原有的 hash 让给存档
        if (!raw || !raw.d) {
            // 首页没有存档：用空的 #gx= 告诉子页面"把你自己的副本也清掉"
            location.href = u.href + HASH_PREFIX;
            return;
        }
        var packed = packForUrl(raw.d);
        if (!packed || packed.length > MAX_HASH_LEN) { location.href = href; return; }
        location.href = u.href + HASH_PREFIX + packed;
    }

    /* 拦截站内链接：只有"存储不共享"时才带 hash，其余情况原生跳转。 */
    document.addEventListener('click', function (ev) {
        if (!ev || ev.defaultPrevented || ev.button !== 0) return;
        if (ev.metaKey || ev.ctrlKey || ev.shiftKey || ev.altKey) return;

        var a = ev.target && ev.target.closest ? ev.target.closest('a[href]') : null;
        if (!a) return;
        if (a.target && a.target !== '_self') return;
        if (a.hasAttribute('download')) return;

        var rawHref = a.getAttribute('href') || '';
        if (/^(https?:|mailto:|tel:|javascript:|data:|#)/i.test(rawHref)) return;
        if (!/\.html?($|[?#])/i.test(rawHref)) return;

        var cached = null;
        try { cached = sessionStorage.getItem(SHARED_FLAG); } catch (e) { }
        if (cached === '1') return;                      // 同源：原生跳转

        ev.preventDefault();
        var href = a.href;
        if (cached === '0') { goWithHash(href); return; }

        // 还没探完（加载后立刻点）：先拦下，探明后再决定
        probePromise.then(function (shared) {
            if (shared) location.href = href;
            else goWithHash(href);
        });
    }, true);

    window.gxPackForUrl = packForUrl;
})();
