"""用例：从本地 dat.db 还原存档，产出 ImportOutcome。

外层密钥按 resolver 的策略找，内层密钥按 keys.json/内置表候选依次试，解不开再扫内存。
失败抛 DBError / OuterKeyUnavailable / InnerKeyMissing。
"""
from __future__ import annotations

from guanxing.domain.save import naming
from guanxing.shared.errors import AppError, DBError
from guanxing.shared.progress import ProgressSink

from ..dto import ImportOutcome, ImportRequest
from ..packs import CryptoStack, StorageStack
from ._common import (
    decode_with_hunt,
    emit,
    fill_from_decoded,
    save_id_of,
)


def import_local(
    req: ImportRequest,
    crypto: CryptoStack,
    storage: StorageStack,
    progress: ProgressSink,
) -> ImportOutcome:
    """从 dat.db 还原存档。"""
    db_path = req.database or req.source
    if db_path is None:
        raise AppError('local 模式需要提供 dat.db 路径')

    savedb = storage.open_savedb(db_path)
    row = savedb.read_save()
    content = row.get('content') or ''
    if not content:
        raise DBError(f'{db_path} 的 save 表里没有 content')

    out = ImportOutcome(kind='local', source=str(db_path), runtime=req.runtime)
    out.save_id = (row.get('id') or '').strip()
    # 区服：显式给的优先，否则从路径的 serverNN 推（CLI 直连 local 时没有区服信息，
    # 不推的话输出目录会恒为 android-unknown-角色，和向导模式不一致）
    out.server = (req.server or naming.server_of(str(db_path))).strip()
    out.add_step('存档 id', out.save_id[:16] + '…' if out.save_id else '（空）')
    if out.server:
        out.add_step('区服', out.server)

    outer_key = crypto.outer_keys.resolve(
        content,
        runtime=req.runtime,
        account=req.account,
        save_id=out.save_id or None,
        explicit=req.outer_key,
        mem_mode=req.mem_mode,
    )

    decoded = decode_with_hunt(
        crypto, content,
        runtime=req.runtime,
        outer_key=outer_key,
        inner_key=req.inner_key,
        mem_mode=req.mem_mode,
    )
    fill_from_decoded(out, decoded)

    if not out.account:
        out.account = str(decoded.data.get('EncryptID') or req.account or '')
    if not out.save_id and out.account:
        out.save_id = save_id_of(out.account)

    emit(out, req, storage, progress)
    return out


__all__ = ['import_local']
