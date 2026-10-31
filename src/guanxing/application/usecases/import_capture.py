"""用例：把一次抓包还原成存档，产出 ImportOutcome。

所有能离线拿的东西都由探测阶段算好（realKey、旧版存档本体、psw、版本），
这里只消费那份结果；``req.probe`` 没带 realKey 时才自己去探一次。
拿不到存档时抛 OuterKeyUnavailable，明确区分「没有 download」与「缺 psw」两种原因。
"""
from __future__ import annotations

from dataclasses import replace

from guanxing.domain.errors import InvalidFormat, OuterKeyUnavailable
from guanxing.shared.errors import DBError, HarError
from guanxing.shared.progress import ProgressSink
from guanxing.shared.text import redact

from ..dto import ImportOutcome, ImportRequest
from ..packs import CryptoStack, StorageStack
from ._common import (
    decode_with_hunt,
    emit,
    fill_from_decoded,
    read_capture,
    save_id_of,
)


def import_capture(
    req: ImportRequest,
    crypto: CryptoStack,
    storage: StorageStack,
    progress: ProgressSink,
) -> ImportOutcome:
    """把一次抓包还原成存档。

    Args:
        req: 导入请求；``probe`` 已带 realKey 时不再打开 HAR。
        crypto: 密钥与解密那一包。
        storage: 存储那一包。
        progress: 进度上报。
    Returns:
        导入结果。
    Raises:
        InvalidFormat: 既没给 HAR 也没给探测结果。
        HarError: HAR 里缺 acc 头或 k 头，或 HAR 本身读不了。
        OuterKeyUnavailable: 没有 download 响应，或只拿到 psw 却缺 dat.db。
        DBError: 指定的 dat.db 里没有 content。
    """
    probe = req.probe
    if probe is None or not probe.real_key:
        if req.source is None:
            raise InvalidFormat('capture 模式需要提供 HAR 文件路径')
        probe = read_capture(req.source, crypto, storage, progress)

    out = ImportOutcome(kind='har', source=str(req.source or ''), runtime=req.runtime)

    account = (req.account or probe.account).strip()
    if not account:
        raise HarError('HAR 里没有 acc 请求头（建议从打开游戏之前开始抓包）')
    if not probe.real_key:
        raise HarError('HAR 里没有带 k 的响应头（请从"打开游戏之前"开始抓包）')
    out.account = account
    out.save_id = save_id_of(account)
    # 区服优先级：显式 --server > HAR 的 area 头（两者都没有就留空）
    out.server = (req.server or probe.server).strip()
    out.add_step('账号', account)
    out.add_step('realKey', redact(probe.real_key))

    # 旧版：存档本体就在 upload 请求体里，解得出就不需要 dat.db
    content: str | None = probe.content or None
    source = probe.content_source if content else ''
    psw = probe.psw
    if psw:
        out.psw = psw
        out.add_step('psw', redact(psw))
    elif probe.has_download:
        out.add_step('download 响应', '有，但解不出 psw')
    if not probe.has_download and content is None:
        raise OuterKeyUnavailable(
            'HAR 里没有可用的 download 响应：upload3 的 body 由 RSA 包裹的'
            '一次性会话密钥加密，离线解不开，只能靠 download',
            command='download',
            retry_with_outer_key=False,
        )

    if probe.version:
        # 抓包头里的版本号与 content 里的是两回事，标签分开放，别和后面的“版本号”撞名。
        # 注意：这里不写 keys.json——psw 要等 decode_with_hunt 解开了才登记，
        # 而且版本号要用解密后得到的真实值，不是这个 ver 头。
        out.add_step('抓包版本', probe.version)

    if content is None:
        if req.database is None:
            raise OuterKeyUnavailable(
                '抓包只能给到 psw，存档本体在 dat.db 里，请用 --db 指定它',
                psw_available=bool(psw),
                command='download',
                retry_with_outer_key=False,
            )
        savedb = storage.open_savedb(req.database)
        row = savedb.read_save()
        content = row.get('content') or ''
        if not content:
            raise DBError(
                f'{getattr(req.database, "name", req.database)} 的 save 表里没有 content'
            )
        # dat.db 那一行的 id 才是这份存档的真实主键：外层密钥缓存要按它记，
        out.save_id = (row.get('id') or '').strip() or out.save_id
        source = f'dat.db（{getattr(req.database, "name", req.database)}）'
    out.add_step('存档来源', source)

    outer_key = crypto.outer_keys.resolve(
        content,
        runtime=req.runtime,
        account=out.account,
        save_id=out.save_id,
        explicit=req.outer_key,
        mem_mode=req.mem_mode,
    )

    decoded = decode_with_hunt(
        crypto, content,
        runtime=req.runtime,
        outer_key=outer_key,
        inner_key=req.inner_key,
        psw=psw,
        mem_mode=req.mem_mode,
    )

    fill_from_decoded(out, replace(decoded, psw=psw))
    emit(out, req, storage, progress)
    return out


__all__ = ['import_capture']
