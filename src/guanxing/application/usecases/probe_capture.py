"""用例：只探测一份 HAR 的形状，不改任何东西。

入口先用它判断「旧版自带存档」还是「新版必须 dat.db」，再决定要不要问用户。
探测本身在 ``_common.read_capture``，导入用例也调它，同一份 HAR 只解析一次。
"""
from __future__ import annotations

from pathlib import Path

from guanxing.shared.progress import ProgressSink

from ..dto import CaptureProbe
from ..packs import CryptoStack, StorageStack
from ._common import read_capture

__all__ = ['CaptureProbe', 'probe_capture']


def probe_capture(
    source: str | Path,
    crypto: CryptoStack,
    storage: StorageStack,
    progress: ProgressSink,
) -> CaptureProbe:
    """探测 HAR 的账号、区服、版本，以及是否自带存档。

    Args:
        source: HAR 文件路径。
        crypto: 密钥与解密那一包。
        storage: 存储那一包（用来打开 HAR）。
        progress: 进度上报。
    Returns:
        探测结果；``has_save`` 为真时导入不需要 dat.db，``real_key`` 为空表示拿不到 k 头。
    """
    return read_capture(Path(source), crypto, storage, progress)
