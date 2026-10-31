/*
 * APK-WEB-SHIM —— 烟雨存档导出 APK 的「内嵌网页适配层」
 * =====================================================
 * 本文件是唯一真源，由 同步网页.ps1 原样复制成 assets/web/last-import.js。
 *
 * 运行时 App 会在这段代码前面拼一行赋值语句（把刚抓到的存档交给网页），
 * 格式与 PC 版 export-plain\write_last_import.ps1 生成的完全一致 ——
 * 网页 home.js 的 initializeHome() 本来就在读这个变量，所以网页源码一行都不用改。
 *
 * 职责：
 *   1. 存档落库兜底：localStorage 配额不足时，依次尝试「清缓存重试 → 压缩存储 → 内存兜底」
 *   2. 界面适配：保留网页的手动导入入口，并提示自动导入方式。
 *
 * 加载位置：index.html 里的 <script src="./last-import.js">，在 shared/save_decrypt.js
 *          之后、home.js 之前执行（顺序由 index.html 保证，勿动）。
 */
(function () {
    'use strict';

    var MARK = 'APK-WEB-SHIM';
    var SAVE_KEY = 'yyjh_share_save_v1';
    var META_KEY = 'yyjh_share_save_meta_v1';

    // 供排障：控制台里 window.__YANYU_APK__ 有值即表示 shim 生效
    window.__YANYU_APK__ = MARK;

    var memSave = null;

    /* ------------------------------------------------------------------
     * 1. localStorage 写入兜底
     *    网页原实现（save_decrypt.js）失败只返回 false，home.js 会弹
     *    「浏览器无法保存存档」——大号存档撞配额时观星就废了。
     * ------------------------------------------------------------------ */
    var origSave = (typeof window.saveShareStore === 'function') ? window.saveShareStore : null;

    function applyMemoryStore() {
        if (!memSave) return;
        try {
            window.loadShareStore = function () { return { data: memSave, meta: {} }; };
            window.__yanyuApkMemorySave = true;
        } catch (e) { }
    }

    function storeCompressed(data, meta) {
        // loadShareStore 认识「base64(zlib)」这种形式（首字符不是 '{' 就走 pako.inflate）
        if (typeof pako === 'undefined' || typeof btoa !== 'function') return false;
        var gz = pako.deflate(JSON.stringify(data));
        var bin = '';
        var CHUNK = 8192;
        for (var i = 0; i < gz.length; i += CHUNK) {
            bin += String.fromCharCode.apply(null, gz.subarray(i, i + CHUNK));
        }
        localStorage.setItem(SAVE_KEY, btoa(bin));
        localStorage.setItem(META_KEY, JSON.stringify(meta || {}));
        return true;
    }

    function dropOtherKeys() {
        var drop = [];
        for (var i = 0; i < localStorage.length; i += 1) {
            var k = localStorage.key(i);
            if (k && k.indexOf('yyjh_') === 0 && k !== SAVE_KEY && k !== META_KEY) drop.push(k);
        }
        for (var j = 0; j < drop.length; j += 1) localStorage.removeItem(drop[j]);
        return drop.length;
    }

    if (origSave) {
        window.saveShareStore = function (data, meta) {
            meta = meta || {};

            // 第 0 步：原样存
            try { if (origSave(data, meta)) return true; } catch (e) { }

            // 第 1 步：清掉本工具其它 yyjh_ 缓存（跳脉缓存等，可重算）后重试
            try {
                dropOtherKeys();
                if (origSave(data, meta)) return true;
            } catch (e1) { }

            // 第 2 步：压缩后存（体积通常只剩 1/5 ~ 1/10）
            try {
                if (storeCompressed(data, meta)) return true;
            } catch (e2) { }

            // 第 3 步：内存兜底 —— 至少不弹「无法保存存档」，本页仍可正常观星
            memSave = data;
            applyMemoryStore();
            return true;
        };
    }

    /* ------------------------------------------------------------------
     * 2. 界面适配：保留原生文件选择器对应的手动导入入口
     * ------------------------------------------------------------------ */

    function hasStoredSave() {
        if (memSave) return true;
        try { return !!localStorage.getItem(SAVE_KEY); } catch (e) { return false; }
    }

    function applyGuideMessage() {
        var msg = document.getElementById('homeImportMessage');
        if (!msg) return;
        // home.js 已给出导入结果或错误时不要覆盖
        if (msg.textContent) return;
        msg.classList.remove('is-error');
        msg.textContent = hasStoredSave()
            ? '存档已导入，选择下方板块开始观星。'
            : '点顶部「一键开始」获取存档，或直接导入 .yanyu 文件。';
    }

    function applyUi() {
        applyGuideMessage();
    }

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', function () {
            setTimeout(applyUi, 0);
        });
    } else {
        applyUi();
        setTimeout(applyUi, 0);
    }
})();
