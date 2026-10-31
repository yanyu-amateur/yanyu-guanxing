"""把存档写成 web/local-save.js，让 file:// 双击也能跨页面读到存档。

每个页面 script 引入它，loadShareStore() 在 localStorage 为空时回退到这里。
注意：内容是真实存档必须 gitignore；写 UTF-8，并把 </ 转义防止提前闭合标签。
"""
from __future__ import annotations

import json
import logging
import uuid
from pathlib import Path

from guanxing.shared.errors import WriteFailed

logger = logging.getLogger(__name__)

LOCAL_SAVE_NAME = 'local-save.js'


def build_local_save_js(payload: dict | None, meta: dict | None,
                        pub_id: str = '') -> str:
    """生成注入脚本，把明文存档与元信息写成两个全局变量。

    Args:
        payload: 明文存档。
        meta: 存档元信息。
        pub_id: 这一次导出的编号，网页靠它区分同一份存档的两次导出。
    Returns:
        可直接作为 local-save.js 的脚本文本。
    """
    data = 'null'
    if payload:
        data = json.dumps(payload, ensure_ascii=False, separators=(',', ':')).replace('</', '<\\/')
    meta_text = json.dumps(meta or {}, ensure_ascii=False, separators=(',', ':')).replace('</', '<\\/')
    stamp = f'window.__latestSaveStamp = {json.dumps(pub_id)};\n' if pub_id else ''
    return (
        '/* 由观星工具生成，不要提交到仓库；下次导入会覆盖。 */\n'
        f'window.__latestPlainSave = {data};\n'
        f'window.__latestSaveMeta = {meta_text};\n'
        f'{stamp}'
    )


def write_local_save(web_dir: Path, payload: dict | None,
                     meta: dict | None) -> Path:
    """写到 <web>/local-save.js 并返回路径。

    Args:
        web_dir: 网页目录。
        payload: 明文存档，None 表示写成空注入。
        meta: 存档元信息。
    Returns:
        写出的文件路径。
    Raises:
        WriteFailed: 目录建不出来或文件写不进去（只读目录、磁盘满等）。
    """
    target = Path(web_dir) / LOCAL_SAVE_NAME
    try:
        target.parent.mkdir(parents=True, exist_ok=True)
        target.write_text(build_local_save_js(payload, meta, uuid.uuid4().hex if payload else ''),
                          encoding='utf-8')
    except OSError as exc:
        raise WriteFailed(
            f'写不进 {target}: {exc}',
            hints=['确认 web/ 目录存在且可写', '或设环境变量 GUANXING_WEB 指向可写目录'],
        ) from exc
    logger.debug('已写入静态存档注入文件: %s（%d 字节）', target, target.stat().st_size)
    return target


__all__ = ['LOCAL_SAVE_NAME', 'build_local_save_js', 'write_local_save']
