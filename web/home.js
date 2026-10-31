(function () {
    'use strict';

    function renderHomeState(data) {
        var shared = data ? { data: data } : (typeof loadShareStore === 'function' ? loadShareStore() : null);
        var hasSave = !!(shared && shared.data);
        var status = document.getElementById('homeSaveStatus');
        var mainRole = document.getElementById('homeMainRole');
        if (status) status.textContent = hasSave ? '导入成功' : '未导入';
        if (mainRole) {
            mainRole.textContent = hasSave && typeof getArchiveMainRoleName === 'function'
                ? getArchiveMainRoleName(shared.data)
                : '—';
        }
        return hasSave;
    }

    function setMessage(message, isError) {
        var element = document.getElementById('homeImportMessage');
        if (!element) return;
        element.textContent = message;
        element.classList.toggle('is-error', !!isError);
        element.classList.toggle('is-success', !isError && message === '导入成功');
    }

    /* ---------------------------------------------------------------
     * 明文 dat.json 读取（只接受观星工具导出的明文存档）
     *
     * 为什么不再走 .yanyu：观星工具现在直接产出 dat.json，
     * 不再需要「本地导出 -> 授权码 -> AES 解密」这一层；
     * 少一层就少一个出错点，存档也不再落两份。
     * --------------------------------------------------------------- */
    function normalizePlainSave(parsed) {
        if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return null;
        // 兼容 {"data": {...}} 包裹形式
        var data = parsed.data && typeof parsed.data === 'object' && !Array.isArray(parsed.data)
            ? parsed.data : parsed;
        if (!data || typeof data !== 'object' || Array.isArray(data)) return null;
        if (!data.MainRole || !data.globalVariable) return null;
        return data;
    }

    async function readDatJson(file) {
        var text;
        try {
            text = await file.text();
        } catch (e) {
            throw new Error('READ_FAILED');
        }
        if (text && text.charCodeAt(0) === 0xFEFF) text = text.slice(1);
        var parsed;
        try {
            parsed = JSON.parse(text);
        } catch (e) {
            throw new Error('PLAIN_JSON_INVALID');
        }
        var data = normalizePlainSave(parsed);
        if (!data) throw new Error('PLAIN_JSON_INVALID');
        return {
            data: data,
            version: '本地存档',
            platform: (data.MainRole && data.MainRole.Platform) || '',
            format: 'plain-json'
        };
    }

    function storeSave(result) {
        if (typeof saveShareStore !== 'function') return false;
        return saveShareStore(result.data, {
            version: result.version,
            platform: result.platform || '',
            channel: '',
            format: result.format || 'plain-json'
        });
    }

    async function handleImport(file) {
        if (!file) return;
        if (typeof _importFeedback === 'function') _importFeedback(true);
        setMessage('正在读取存档…', false);
        try {
            // 只接受明文 dat.json（由观星工具导出）
            var result = await readDatJson(file);
            if (!storeSave(result)) {
                throw new Error('浏览器无法保存存档，请检查本地存储权限或剩余空间');
            }
            renderHomeState(result.data);
            setMessage('导入成功', false);
        } catch (error) {
            var message = error && error.message ? String(error.message) : '';
            if (message === 'PLAIN_JSON_INVALID') setMessage('不是有效的 dat.json（缺少 MainRole / globalVariable）', true);
            else if (message === 'READ_FAILED') setMessage('读取文件失败，请确认文件未被占用', true);
            else setMessage(message || '数据错误', true);
        } finally {
            if (typeof _importFeedback === 'function') _importFeedback(false);
        }
    }

    function initializeHome() {
        // 唯一真源 = 本页 localStorage。
        // local-save.js（脚本标签注入，天然跨源）只是"播种"来源：
        //   · 工具刚跑过（编号/内容变了）→ 播进来
        //   · 同一份已经播过，或用户手动导入过 → 不动
        //   · 用户点过重置 → 记住被否掉的那一份，不再播
        var injected = window.__latestPlainSave;
        if (injected && typeof seedFromInjection === 'function') {
            if (!normalizePlainSave(injected)) setMessage('注入的存档无效，请手动选择 dat.json', true);
            else seedFromInjection();
        }
        renderHomeState();

        var input = document.getElementById('saveFileInput');
        if (input) input.addEventListener('change', function (event) {
            var file = event.target.files && event.target.files[0];
            handleImport(file);
            event.target.value = '';
        });

        // 「重置网页状态」的点击由 shared/archive_state.js 统一绑定
        // （清 localStorage + 记住别再播种 + 刷新）。这里不要再绑一份。
    }

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', initializeHome);
    } else {
        initializeHome();
    }
    setTimeout(function () {
        if (typeof prewarmSql === 'function') prewarmSql();
    }, 200);
})();
