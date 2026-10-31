(function () {
    'use strict';

    var RESET_NOTICE_KEY = 'yyjh_reset_notice_v1';
    var SHARED_SAVE_KEYS = {
        yyjh_share_save_v1: true,
        yyjh_share_save_meta_v1: true
    };

    function getMainRoleName(data) {
        var source = Array.isArray(data) ? data[0] : data;
        var role = source && source.MainRole;
        var name = role && typeof role.Name === 'string' ? role.Name.trim() : '';
        return name || '—';
    }

    function renderArchiveState(data) {
        var shared = data ? { data: data } : (typeof loadShareStore === 'function' ? loadShareStore() : null);
        var hasSave = !!(shared && shared.data);
        var status = document.getElementById('saveStatus');
        var mainRole = document.getElementById('archiveMainRole');
        var importButton = document.getElementById('archiveImportButton');
        if (status) status.textContent = hasSave ? '导入成功' : '未导入';
        if (mainRole) mainRole.textContent = hasSave ? getMainRoleName(shared.data) : '—';
        if (importButton) importButton.textContent = hasSave ? '更换数据' : '导入数据';
        return hasSave;
    }

    function clearNamespacedStorage(storage, preservedKeys) {
        if (!storage) return;
        var keys = [];
        for (var index = 0; index < storage.length; index += 1) {
            var key = storage.key(index);
            if (key && key.indexOf('yyjh_') === 0 && !(preservedKeys && preservedKeys[key])) keys.push(key);
        }
        keys.forEach(function (key) { storage.removeItem(key); });
    }

    function clearWebsiteState() {
        try { clearNamespacedStorage(window.localStorage); } catch (error) { }
        try { clearNamespacedStorage(window.sessionStorage); } catch (error) { }
    }

    function clearOperationState() {
        try { clearNamespacedStorage(window.localStorage, SHARED_SAVE_KEYS); } catch (error) { }
        try { clearNamespacedStorage(window.sessionStorage); } catch (error) { }
    }

    function showResetFeedback() {
        var resetButton = document.getElementById('btnResetWebsite');
        if (!resetButton) return;
        resetButton.textContent = '重置成功';
        resetButton.classList.add('is-reset-success');
        window.setTimeout(function () {
            resetButton.classList.remove('is-reset-success');
            resetButton.textContent = '重置网页';
        }, 2000);
    }

    /* 「重置网页状态」= 连存档一起清空，回到「未导入」。
     * 顺序很重要（写反了就等于没清）：
     *   1. 先记下被否掉的是 local-save.js 里的哪一份（此刻还读得到）；
     *   2. 清掉所有 yyjh_ 状态 —— 注意这会连带删掉抑制标记本身；
     *   3. 所以抑制标记必须在清完之后再写；
     *   4. 刷新。
     * 清完之后首页 localStorage 是空的，page_bridge 会把"空"推给所有子页面，
     * 别的页面也会一起变空。
     */
    function resetWebsiteState() {
        var injected = window.__latestPlainSave;
        clearWebsiteState();
        if (typeof suppressInjection === 'function') suppressInjection(injected);
        try { window.sessionStorage.setItem(RESET_NOTICE_KEY, '1'); } catch (error) { }
        window.location.reload();
    }

    function showNoExportData() {
        window.alert('无数据可以导出');
    }

    function initializeArchiveState() {
        // 首页使用自己的状态卡，没有这些元素，无需解析整份缓存存档。
        if (document.getElementById('saveStatus') || document.getElementById('archiveMainRole')
            || document.getElementById('archiveImportButton')) renderArchiveState();
        var exportButton = document.getElementById('btnExportTable');
        var resetButton = document.getElementById('btnResetWebsite');
        if (exportButton) exportButton.addEventListener('click', showNoExportData);
        if (resetButton) resetButton.addEventListener('click', resetWebsiteState);
        try {
            if (window.sessionStorage.getItem(RESET_NOTICE_KEY) === '1') {
                window.sessionStorage.removeItem(RESET_NOTICE_KEY);
                showResetFeedback();
            }
        } catch (error) { }
    }

    window.getArchiveMainRoleName = getMainRoleName;
    window.renderArchiveState = renderArchiveState;
    window.clearWebsiteState = clearWebsiteState;
    window.clearOperationState = clearOperationState;
    window.showNoExportData = showNoExportData;
    window.resetWebsiteState = resetWebsiteState;

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', initializeArchiveState);
    } else {
        initializeArchiveState();
    }
})();
