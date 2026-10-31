/* ============================================================================
 * 存档导入 —— 只支持两种文件：
 *   1) 本地导出的加密存档 .yanyu（magic = YANYUPL1）：本地解密，不联网、不需要服务器
 *        v1 = 固定口令
 *        v2 = 固定口令 + 授权码（文件里只放 8 字节「码指纹」用于溯源，没码解不开）
 *   2) 明文 JSON（一键导出工具生成的 .json）
 *
 * ！旧的官方 v1.8 / v1.8.3 / v1.9 / v2.0 / v2.1 / v3.0 / v3.1 解析逻辑，
 *   以及配套的授权码联网校验（/api/license）已全部移除。
 *
 * 对外入口（各页面共用，勿改名）：
 *   decryptSaveFile(file)          —— 各页面「导入存档」用它
 *   decryptSaveBytes(bytes, name, allowPrompt)
 *   saveShareStore / loadShareStore / clearShareStore / markNavTransition / consumeNavTransition
 * ========================================================================== */

/* ---------- 本地导出容器（.yanyu）常量 ---------- */
var SAVE_PLAIN_YANYU_MAGIC = 'YANYUPL1';
var SAVE_PLAIN_YANYU_VERSION = 1;          /* 仅固定口令 */
var SAVE_PLAIN_YANYU_VERSION_CODE = 2;     /* 固定口令 + 授权码 */
var SAVE_PLAIN_YANYU_FLAG_GZIP = 1;
var SAVE_PLAIN_YANYU_SECRET = 'yanyu-plain-export-v1|7f3c1d9a4e6b2085';
var SAVE_PLAIN_YANYU_KDF_ITERATIONS = 120000;
var SAVE_PLAIN_YANYU_SALT_BYTES = 16;
var SAVE_PLAIN_YANYU_NONCE_BYTES = 12;
var SAVE_PLAIN_YANYU_CODE_TAG_BYTES = 8;
/* magic(8) + version(1) + flags(1) 之后就是 salt */
var SAVE_PLAIN_YANYU_PREFIX_BYTES = SAVE_PLAIN_YANYU_MAGIC.length + 2;
var SAVE_PLAIN_YANYU_HEADER_BYTES = SAVE_PLAIN_YANYU_PREFIX_BYTES
    + SAVE_PLAIN_YANYU_SALT_BYTES + SAVE_PLAIN_YANYU_NONCE_BYTES;

/* 本机记住的授权码（解 .yanyu v2 用），一次输入长期有效 */
var YANYU_CODE_KEY = 'yyjh_yanyu_code_v1';

function getYanyuCode() {
    try {
        if (typeof localStorage === 'undefined') return '';
        return String(localStorage.getItem(YANYU_CODE_KEY) || '').trim();
    } catch (e) {
        return '';
    }
}

function setYanyuCode(code) {
    try {
        localStorage.setItem(YANYU_CODE_KEY, String(code || '').trim());
    } catch (e) { }
}

/* ---------- 小工具 ---------- */
function _b64ToBytes(b64) {
    b64 = String(b64).replace(/-/g, '+').replace(/_/g, '/');
    while (b64.length % 4) b64 += '=';
    if (typeof atob === 'function') {
        const bin = atob(b64);
        const bytes = new Uint8Array(bin.length);
        for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
        return bytes;
    }
    return new Uint8Array(Buffer.from(b64, 'base64'));
}

function _bytesToAscii(bytes) {
    let s = '';
    for (let i = 0; i < bytes.length; i++) s += String.fromCharCode(bytes[i]);
    return s;
}

function _bytesToHex(bytes) {
    let s = '';
    for (let i = 0; i < bytes.length; i++) s += ('0' + bytes[i].toString(16)).slice(-2);
    return s;
}

async function _inflateGzip(data) {
    if (typeof DecompressionStream !== 'undefined') {
        try {
            const ds = new DecompressionStream('gzip');
            const stream = new Blob([data]).stream().pipeThrough(ds);
            const buf = await new Response(stream).arrayBuffer();
            return new Uint8Array(buf);
        } catch (e) { }
    }
    if (typeof pako !== 'undefined' && pako.ungzip) {
        return pako.ungzip(data);
    }
    throw new Error('当前环境不支持 gzip 解压（需 DecompressionStream 或 pako）');
}

/* ---------- .yanyu 解密 ---------- */

/** 是否是本地导出的加密容器（.yanyu / YANYUPL1）。 */
function isPlainYanyuContainer(bytes) {
    return !!bytes
        && bytes.length > SAVE_PLAIN_YANYU_HEADER_BYTES + 16
        && _bytesToAscii(bytes.slice(0, SAVE_PLAIN_YANYU_MAGIC.length)) === SAVE_PLAIN_YANYU_MAGIC;
}

/** 读取 .yanyu 头部：版本 / 是否需要授权码 / 授权码指纹（8 字节 hex，仅用于溯源）。 */
function readPlainYanyuHeader(bytes) {
    if (!isPlainYanyuContainer(bytes)) return null;
    const version = bytes[SAVE_PLAIN_YANYU_MAGIC.length];
    const withCode = version === SAVE_PLAIN_YANYU_VERSION_CODE;
    return {
        version: version,
        needsCode: withCode,
        codeTag: withCode
            ? _bytesToHex(bytes.slice(
                SAVE_PLAIN_YANYU_HEADER_BYTES,
                SAVE_PLAIN_YANYU_HEADER_BYTES + SAVE_PLAIN_YANYU_CODE_TAG_BYTES))
            : ''
    };
}

/**
 * 本地解密 .yanyu：PBKDF2 -> AES-256-GCM -> gzip -> JSON。全程不联网。
 * v2 没给授权码 / 给错，分别抛 YANYU_CODE_REQUIRED / YANYU_CODE_WRONG。
 */
async function decryptPlainYanyuBytes(bytes, fileName, code) {
    const info = readPlainYanyuHeader(bytes);
    if (!info) throw new Error('不是有效的 .yanyu 存档（文件头不匹配）');
    if (info.version !== SAVE_PLAIN_YANYU_VERSION && info.version !== SAVE_PLAIN_YANYU_VERSION_CODE) {
        throw new Error('不支持的 .yanyu 版本：' + info.version + '，请更新工具');
    }
    code = code ? String(code).trim() : '';
    if (info.needsCode && !code) throw new Error('YANYU_CODE_REQUIRED');

    const flags = bytes[SAVE_PLAIN_YANYU_MAGIC.length + 1];
    const saltStart = SAVE_PLAIN_YANYU_PREFIX_BYTES;
    const nonceStart = saltStart + SAVE_PLAIN_YANYU_SALT_BYTES;
    const nonceEnd = nonceStart + SAVE_PLAIN_YANYU_NONCE_BYTES;
    const bodyStart = nonceEnd + (info.needsCode ? SAVE_PLAIN_YANYU_CODE_TAG_BYTES : 0);
    const salt = bytes.slice(saltStart, nonceStart);
    const nonce = bytes.slice(nonceStart, nonceEnd);
    const body = bytes.slice(bodyStart);

    const subtle = typeof crypto !== 'undefined' && crypto.subtle ? crypto.subtle : null;
    if (!subtle) {
        throw new Error('当前浏览器不支持本地安全解密，请使用最新版 Chrome 或 Edge');
    }

    let plain;
    try {
        const material = info.needsCode
            ? (SAVE_PLAIN_YANYU_SECRET + '\u0000' + code)
            : SAVE_PLAIN_YANYU_SECRET;
        const password = new TextEncoder().encode(material);
        const keyMaterial = await subtle.importKey(
            'raw', password, { name: 'PBKDF2' }, false, ['deriveKey']);
        const key = await subtle.deriveKey({
            name: 'PBKDF2', salt, iterations: SAVE_PLAIN_YANYU_KDF_ITERATIONS, hash: 'SHA-256'
        }, keyMaterial, { name: 'AES-GCM', length: 256 }, false, ['decrypt']);
        password.fill(0);
        plain = new Uint8Array(await subtle.decrypt({
            name: 'AES-GCM', iv: nonce, tagLength: 128
        }, key, body));
    } catch (error) {
        if (info.needsCode) throw new Error('YANYU_CODE_WRONG');
        throw new Error('.yanyu 解密失败：文件已损坏或被修改过');
    }

    if (flags & SAVE_PLAIN_YANYU_FLAG_GZIP) {
        plain = await _inflateGzip(plain);
    }
    let text = new TextDecoder('utf-8').decode(plain);
    if (text.charCodeAt(0) === 0xFEFF) text = text.slice(1);

    let parsed;
    try {
        parsed = JSON.parse(text);
    } catch (e) {
        throw new Error('.yanyu 内容不是有效 JSON');
    }
    if (!parsed || typeof parsed !== 'object') throw new Error('.yanyu 内容不是有效 JSON');
    const data = parsed.data && typeof parsed.data === 'object' ? parsed.data : parsed;
    if (Array.isArray(data) || !data.MainRole || !data.globalVariable) {
        throw new Error('.yanyu 存档缺少必要字段（MainRole / globalVariable）');
    }
    return {
        data: data,
        platform: data.MainRole.Platform || '',
        channel: '',
        columns: null,
        row: null,
        format: 'yanyu-plain',
        version: '本地导出',
        file: String(fileName || ''),
        codeTag: info.codeTag
    };
}

/** 同上，但输入是 base64（供 last-import.js 自动导入通道使用）。 */
async function decryptPlainYanyuBase64(b64, fileName, code) {
    if (!b64) throw new Error('.yanyu 内容为空');
    return decryptPlainYanyuBytes(_b64ToBytes(String(b64).trim()), fileName, code);
}

/* ---------- 明文 JSON ---------- */

function readPlainJsonBytes(bytes, fileName) {
    let text = '';
    try {
        text = new TextDecoder('utf-8').decode(bytes);
    } catch (e) {
        throw new Error('PLAIN_JSON_INVALID');
    }
    if (text.charCodeAt(0) === 0xFEFF) text = text.slice(1);
    let parsed;
    try {
        parsed = JSON.parse(text);
    } catch (e) {
        throw new Error('PLAIN_JSON_INVALID');
    }
    if (!parsed || typeof parsed !== 'object') throw new Error('PLAIN_JSON_INVALID');
    const data = parsed.data && typeof parsed.data === 'object' && !Array.isArray(parsed.data)
        ? parsed.data : parsed;
    if (!data || typeof data !== 'object' || Array.isArray(data)) throw new Error('PLAIN_JSON_INVALID');
    if (!data.MainRole || !data.globalVariable) throw new Error('PLAIN_JSON_INVALID');
    return {
        data: data,
        platform: data.MainRole.Platform || '',
        channel: '',
        columns: null,
        row: null,
        format: 'plain-json',
        version: '明文',
        file: String(fileName || '')
    };
}

/* ---------- 统一入口 ---------- */

/**
 * 自动判断文件类型并读出存档。
 * 先用文件头认 .yanyu；不是的话一律按明文 JSON 试读（不强制要求 .json 后缀）。
 * allowPrompt=false 时不弹授权码输入框（用于页面自动加载通道）。
 */
async function decryptSaveBytes(bytes, fileName, allowPrompt) {
    const name = String(fileName || '');
    if (isPlainYanyuContainer(bytes)) {
        const code = getYanyuCode();
        try {
            return await decryptPlainYanyuBytes(bytes, name, code);
        } catch (err) {
            const msg = err && err.message ? String(err.message) : '';
            if (msg !== 'YANYU_CODE_REQUIRED' && msg !== 'YANYU_CODE_WRONG') throw err;
            if (!allowPrompt) throw err;
            const tip = msg === 'YANYU_CODE_WRONG'
                ? '授权码不对，请重新输入。'
                : '这张存档需要用授权码打开。';
            let input = window.prompt(tip + '\n（导出这张存档时用的授权码，输入一次以后会记住）', '');
            if (input === null || !String(input).trim()) throw new Error('已取消导入');
            input = String(input).trim();
            setYanyuCode(input);
            return await decryptPlainYanyuBytes(bytes, name, input);
        }
    }
    try {
        return readPlainJsonBytes(bytes, name);
    } catch (e) {
        throw new Error(/\.json$/i.test(name) || /^yanyu-plain/i.test(name)
            ? 'PLAIN_JSON_INVALID' : 'SAVE_FILE_UNSUPPORTED');
    }
}

/** 各页面「导入存档」统一调用（首页 / 装备页 / 角色页 / 模拟器页都在用）。 */
async function decryptSaveFile(file) {
    if (!file) throw new Error('SAVE_FILE_UNSUPPORTED');
    let bytes;
    try {
        bytes = new Uint8Array(await file.arrayBuffer());
    } catch (e) {
        throw new Error('SAVE_FILE_UNSUPPORTED');
    }
    return decryptSaveBytes(bytes, String(file.name || ''), true);
}


var SAVE_SHARE_KEY = 'yyjh_share_save_v1';
var SAVE_SHARE_META_KEY = 'yyjh_share_save_meta_v1';

/* ---------- 从 URL hash 接收存档（Firefox 的 file:// 跨页唯一可行方式） ----------
 * Firefox 默认 privacy.file_unique_origin：每个 html 文件独立源，localStorage 互不相通。
 * 但 URL 本身是跟着导航走的 —— 把存档压进 #gx= 就能在跳转时带过去，
 * 子页面在脚本执行的第一时间解出来写进自己的 localStorage。
 * 好处：完全原生跳转（URL/后退按钮都正常），子页面第一次渲染就有数据，零闪烁。
 * 400KB 实测可传（压缩后体积；原档 1.5MB）。
 */
(function () {
    if (typeof location === 'undefined' || typeof window === 'undefined') return;
    var hash = String(location.hash || '');
    if (hash.indexOf('#gx=') !== 0) return;

    var payload = hash.slice(4);
    var raw = '';
    if (payload) {
        try {
            if (typeof pako === 'undefined' || typeof atob !== 'function') return;
            var b64 = payload.replace(/-/g, '+').replace(/_/g, '/');
            while (b64.length % 4) b64 += '=';
            var bin = atob(b64);
            var bytes = new Uint8Array(bin.length);
            for (var i = 0; i < bin.length; i += 1) bytes[i] = bin.charCodeAt(i);
            raw = new TextDecoder().decode(pako.inflate(bytes));
        } catch (e) {
            raw = '';
        }
    }

    if (raw) {
        try {
            localStorage.setItem(SAVE_SHARE_KEY, raw);
            localStorage.setItem(SAVE_SHARE_META_KEY, '{}');
        } catch (e) { }
    } else if (!payload) {
        // 空的 #gx= 是首页明确在说"已经清空了"。
        // 不照做的话，本页会继续用自己上次留下的旧副本。
        try {
            localStorage.removeItem(SAVE_SHARE_KEY);
            localStorage.removeItem(SAVE_SHARE_META_KEY);
        } catch (e) { }
    }
    // 立刻把 hash 清掉：不然刷新会因为 hash 没变而不重跑，地址栏也难看
    try { history.replaceState(null, '', location.pathname + location.search); } catch (e) { }
})();

function saveShareStore(data, meta) {
    try {
        if (typeof localStorage === 'undefined') return false;
        localStorage.setItem(SAVE_SHARE_KEY, JSON.stringify(data));
        localStorage.setItem(SAVE_SHARE_META_KEY, JSON.stringify(meta || {}));
        return true;
    } catch (e) {
        return false;
    }
}

function loadShareStore() {
    try {
        if (typeof localStorage === 'undefined') return null;
        const raw = localStorage.getItem(SAVE_SHARE_KEY);
        if (!raw) return null;
        let data;
        if (raw.charCodeAt(0) === 123) {
            data = JSON.parse(raw);
        } else {
            if (typeof pako === 'undefined' || typeof atob !== 'function') return null;
            const bin = atob(raw);
            const bytes = new Uint8Array(bin.length);
            for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
            data = JSON.parse(new TextDecoder().decode(pako.inflate(bytes)));
        }
        let meta = {};
        try { meta = JSON.parse(localStorage.getItem(SAVE_SHARE_META_KEY) || '{}'); } catch (e) { }
        return { data, meta };
    } catch (e) {
        return null;
    }
}

function clearShareStore() {
    try {
        if (typeof localStorage !== 'undefined') {
            localStorage.removeItem(SAVE_SHARE_KEY);
            localStorage.removeItem(SAVE_SHARE_META_KEY);
        }
    } catch (e) { }
}

/* ---------- 给 page_bridge.js 的原始读写口 ----------
 * 直接搬字符串，避免把 3MB 存档再 JSON.parse / stringify 一遍。
 * shareStoreRaw()      -> { d, m } | null
 * shareStoreApplyRaw() -> 写入并返回是否成功；d 为空串表示"清空"
 */
function shareStoreRaw() {
    try {
        if (typeof localStorage === 'undefined') return null;
        const d = localStorage.getItem(SAVE_SHARE_KEY);
        if (!d) return null;
        return { d: d, m: localStorage.getItem(SAVE_SHARE_META_KEY) || '{}' };
    } catch (e) {
        return null;
    }
}

function shareStoreApplyRaw(d, m) {
    try {
        if (typeof localStorage === 'undefined') return false;
        if (!d) {
            localStorage.removeItem(SAVE_SHARE_KEY);
            localStorage.removeItem(SAVE_SHARE_META_KEY);
            return true;
        }
        localStorage.setItem(SAVE_SHARE_KEY, String(d));
        localStorage.setItem(SAVE_SHARE_META_KEY, String(m || '{}'));
        return true;
    } catch (e) {
        return false;
    }
}

/* ---------- 「重置网页状态」：别再让 local-save.js 把存档灌回来 ----------
 * local-save.js 是脚本标签注入的，页面一加载就无条件生效。重置清掉 localStorage
 * 之后，下一次刷新它会立刻把同一份旧存档写回 window.__latestPlainSave。
 * 所以要把"被否掉的是哪一份"记下来。用内容指纹（长度+首尾片段），
 * 这样同一份文件重复导出仍会被挡住，换了一份就会正常加载。
 */
var RESET_SUPPRESS_KEY = 'yyjh_reset_suppress_v1';
/* 上一次是从 local-save.js 的哪一份播种进来的。
 * 用来区分两种情况：
 *   · 同一个 local-save.js、用户手动导入过 → 不要再播种（否则手动导入被顶掉）
 *   · 工具重新跑了一遍（编号变了 / 内容变了）→ 播种，让新存档生效
 */
var SEEDED_FP_KEY = 'yyjh_seeded_fp_v1';

function injectionFingerprint(data) {
    // local-save.js 每次导出都带一个新的 __latestSaveStamp，最能代表"是哪一次导出"
    if (typeof window !== 'undefined' && window.__latestSaveStamp) {
        return 'pub:' + window.__latestSaveStamp;
    }
    if (!data || typeof data !== 'object') return '';
    try {
        var text = JSON.stringify(data);
        if (!text) return '';
        return 'c:' + text.length + ':' + text.slice(0, 64) + ':' + text.slice(-64);
    } catch (e) {
        return '';
    }
}

function isInjectionSuppressed(data) {
    var dismissed = '';
    try { dismissed = localStorage.getItem(RESET_SUPPRESS_KEY) || ''; } catch (e) { }
    if (!dismissed) return false;
    var current = injectionFingerprint(data);
    return !!current && current === dismissed;
}

function suppressInjection(data) {
    var fingerprint = injectionFingerprint(data);
    try {
        if (fingerprint) localStorage.setItem(RESET_SUPPRESS_KEY, fingerprint);
        else localStorage.removeItem(RESET_SUPPRESS_KEY);
    } catch (e) { }
}

/* 首页把 local-save.js 里那份灌进 localStorage。
 * 只有"这一次导出还没播过"才播，避免把用户的手动导入顶掉。
 * 返回是否真的播了。
 */
function seedFromInjection() {
    var data = window.__latestPlainSave;
    if (!data || typeof data !== 'object') return false;
    if (isInjectionSuppressed(data)) return false;
    var fingerprint = injectionFingerprint(data);
    var seeded = '';
    try { seeded = localStorage.getItem(SEEDED_FP_KEY) || ''; } catch (e) { }
    if (fingerprint && seeded === fingerprint) return false;
    var ok = saveShareStore(data, window.__latestSaveMeta || {});
    if (ok) { try { localStorage.setItem(SEEDED_FP_KEY, fingerprint); } catch (e) { } }
    return ok;
}


function markNavTransition() {
    try {
        if (typeof sessionStorage !== 'undefined') sessionStorage.setItem('yyjh_nav_transition', '1');
    } catch (e) { }
}

function consumeNavTransition() {
    try {
        if (typeof sessionStorage === 'undefined') return false;
        const v = sessionStorage.getItem('yyjh_nav_transition') === '1';
        sessionStorage.removeItem('yyjh_nav_transition');
        return v;
    } catch (e) {
        return false;
    }
}

function _importFeedback(on) {
    try {
        var input = document.getElementById('saveFileInput');
        if (!input) return;
        var label = input.closest ? input.closest('label') : null;
        if (!label) label = input.parentNode;
        if (!label) return;
        var txt = label.querySelector ? label.querySelector('.import-txt') : null;
        if (!txt) return;
        if (on) {
            if (!txt.dataset.importTxt) txt.dataset.importTxt = txt.textContent;
            txt.textContent = '解密中…';
        } else {
            if (txt.dataset.importTxt) txt.textContent = txt.dataset.importTxt;
        }
    } catch (e) { }
}
