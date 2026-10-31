'use strict';

importScripts('data.js', 'wash_source_engine.js', 'wash_source_optimizer.js');

function postWorkerMessage(type, requestId, payload) {
    self.postMessage({ type, requestId, ...(payload || {}) });
}

async function runWorkerSearch(message) {
    const requestId = String(message && message.requestId || '');
    const input = message && message.input || {};
    try {
        postWorkerMessage('progress', requestId, {
            progress: { phase: 'worker-start', done: 0, total: 1, message: '正在启动后台计算线程' },
        });
        const result = await WashSourceOptimizer.searchWashRoutes({
            initialState: input.initialState,
            targetIds: input.targetIds,
            talentData: TALENT_DATA,
            dlcMode: !!input.dlcMode,
            eligibleTalentIds: input.eligibleTalentIds,
            bagPills: input.bagPills,
            hasBagPills: !!input.hasBagPills,
            options: input.options,
            shouldCancel: () => false,
            onProgress: progress => postWorkerMessage('progress', requestId, { progress }),
            onCandidate: result => postWorkerMessage('candidate', requestId, { result }),
        });
        postWorkerMessage('result', requestId, { result });
    } catch (error) {
        postWorkerMessage('error', requestId, {
            error: error && error.message ? error.message : String(error || '后台搜索失败'),
        });
    }
}

self.onmessage = async event => {
    const message = event && event.data || {};
    if (message.type === 'start') await runWorkerSearch(message);
};
