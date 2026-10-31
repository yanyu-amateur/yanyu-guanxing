"""用例：把明文存档写成网页能读的静态文件，并打开首页。"""
from __future__ import annotations

from pathlib import Path

from guanxing.shared.progress import ProgressSink
from guanxing.shared.settings import Settings

from ..packs import StorageStack

INDEX_NAME = 'index.html'


def publish_web(
    settings: Settings,
    data: dict | None,
    meta: dict | None,
    storage: StorageStack,
    progress: ProgressSink,
) -> Path | None:
    """把存档写入 ``<web>/local-save.js`` 并打开首页。

    Args:
        settings: 本次运行配置（用 ``web_dir``）。
        data: 明文存档；为空时什么都不做。
        meta: 存档元信息。
        storage: 存储那一包（提供"写注入文件"与"打开浏览器"两个能力）。
        progress: 进度上报。
    Returns:
        写出的注入文件路径；``data`` 为空时返回 None。
    """
    if not data:
        progress.warn('没有可注入网页的存档数据')
        return None

    target = storage.write_local_save(settings.web_dir, data, meta)
    progress.step('已写入', f'{target}（双击 index.html 即可使用）')

    index = Path(settings.web_dir) / INDEX_NAME
    if not storage.fs.exists(index):
        progress.warn(f'没找到 {index}，请手动打开')
        return target
    storage.open_url(index.as_uri())
    return target


__all__ = ['INDEX_NAME', 'publish_web']
