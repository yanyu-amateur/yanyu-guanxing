"""用例：导入存档，缺密钥时按统一策略重试。

外层缺失走"扫内存 / 手填密钥"两个回调，内层缺失的兜底在 decode_with_hunt 里。
重试顺序只在这里写一遍，入口只负责提供回调。
"""
from __future__ import annotations

from collections.abc import Callable
from dataclasses import replace

from guanxing.domain.errors import REASON_NEEDS_MEMORY, OuterKeyUnavailable
from guanxing.shared.progress import ProgressSink
from guanxing.shared.settings import MemMode
from guanxing.shared.text import redact

from ..dto import ImportOutcome, ImportRequest
from ..packs import CryptoStack, StorageStack
from .import_capture import import_capture
from .import_local import import_local

# 两条回调：返回 True/字符串表示"用户同意"，None/False 表示放弃（原样抛出错误）。
AskScan = Callable[[OuterKeyUnavailable], bool]
AskManualKey = Callable[[OuterKeyUnavailable], "str | None"]

Command = Callable[[ImportRequest, CryptoStack, StorageStack, ProgressSink],
                   ImportOutcome]


def _usecase_for(req: ImportRequest) -> Command:
    """``auto`` 的命令选择：看源文件扩展名（``.db`` 走 local，其余走 capture）。"""
    suffix = req.source.suffix.lower() if req.source else ''
    return import_local if suffix == '.db' else import_capture


def run_import(
    req: ImportRequest,
    crypto: CryptoStack,
    storage: StorageStack,
    progress: ProgressSink,
    *,
    ask_scan: AskScan | None = None,
    ask_manual_key: AskManualKey | None = None,
    command: str = 'auto',
) -> ImportOutcome:
    """跑一次导入，缺外层密钥时按回调决定下一步；内层缺失的兜底在 decode_with_hunt。

    Args:
        req: 请求。
        crypto: 密钥与解密那一包。
        storage: 存储那一包。
        progress: 进度上报。
        ask_scan: 是否允许扫内存；None 表示直接扫，CLI 就是这么用的。
        ask_manual_key: 是否要手填外层密钥；None 表示不问。
        command: local / capture / auto。
    Returns:
        导入结果。
    Raises:
        OuterKeyUnavailable: 没人能补上外层密钥。
    """
    call = import_local if command == 'local' else (
        import_capture if command == 'capture' else _usecase_for(req))
    try:
        return call(req, crypto, storage, progress)
    except OuterKeyUnavailable as exc:
        return _recover(exc, req, crypto, storage, progress, call,
                        ask_scan=ask_scan, ask_manual_key=ask_manual_key)


def _recover(
    exc: OuterKeyUnavailable,
    req: ImportRequest,
    crypto: CryptoStack,
    storage: StorageStack,
    progress: ProgressSink,
    call: Command,
    *,
    ask_scan: AskScan | None,
    ask_manual_key: AskManualKey | None,
) -> ImportOutcome:
    """外层密钥缺失时的唯一重试路径。"""
    if exc.tag == REASON_NEEDS_MEMORY:
        if ask_scan is None or ask_scan(exc):
            progress.step('内存扫描', '只读取游戏进程内存，不修改存档')
            return call(replace(req, mem_mode=MemMode.FORCE), crypto, storage, progress)
        progress.hint('已跳过内存扫描；也可以改用手工粘贴外层密钥')
    elif exc.psw_available or not exc.retry_with_outer_key:
        # 已经拿到 psw、只差 dat.db 时，追问外层密钥没用；
        # 抓包根本没拿到 psw（离线走不通）时，追问也没用，该去模拟器。
        raise exc

    if ask_manual_key is None:
        raise exc
    key = (ask_manual_key(exc) or '').strip()
    if not key:
        raise exc
    progress.step('外层密钥', redact(key))
    return call(replace(req, outer_key=key), crypto, storage, progress)


__all__ = ['AskManualKey', 'AskScan', 'run_import']
