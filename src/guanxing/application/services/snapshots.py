"""历史快照枚举（纯读取）。

``python run.py`` 无参启动时要先列出「已导入的存档」，
这里负责把 ``<out>/<平台-区服-角色>/<时间戳>/`` 读成可展示的行。
"""
from __future__ import annotations

import json
from dataclasses import dataclass
from pathlib import Path

from guanxing.shared.errors import AppError

from ..ports.fs import FileSystem

META_NAME = 'dat.meta.json'
JSON_NAME = 'dat.json'


@dataclass(frozen=True)
class Snapshot:
    """一个已导入的存档快照。"""

    directory: Path
    meta: dict

    @property
    def group(self) -> str:
        return self.directory.parent.name

    @property
    def stamp(self) -> str:
        return self.directory.name

    @property
    def nick(self) -> str:
        return str(self.meta.get('nick') or '?')

    @property
    def server(self) -> str:
        return str(self.meta.get('server') or '?')

    @property
    def version(self) -> str:
        return str(self.meta.get('version') or '?')

    @property
    def field_count(self) -> str:
        value = self.meta.get('field_count')
        return str(value) if value is not None else '?'

    @property
    def dat_json(self) -> Path:
        return self.directory / JSON_NAME

    def label(self) -> str:
        """列表里显示的一行，不带序号，序号由 prompts.choose 统一加。
        """
        return (f'{self.group:<24} {self.stamp}  '
                f'v{self.version}  {self.nick}  字段 {self.field_count}')


def list_snapshots(fs: FileSystem, out_dir: Path, *, limit: int = 20) -> list[Snapshot]:
    """按时间倒序列出已导入的快照。

    Args:
        fs: 文件系统端口。
        out_dir: 输出根目录。
        limit: 最多返回多少条。
    Returns:
        快照列表，新→旧；``_`` 开头的目录（如 _cache）不列。
    """
    out_dir = Path(out_dir)
    if not fs.exists(out_dir):
        return []
    rows: list[Snapshot] = []
    for group in fs.list_dir(out_dir):
        # 下划线开头的是工具自己的工作目录（比如 _cache 里的临时 dat.db），不是存档
        if Path(group).name.startswith('_'):
            continue
        for snap in fs.list_dir(Path(group)):
            meta_path = Path(snap) / META_NAME
            if not fs.exists(meta_path):
                continue
            try:
                meta = json.loads(fs.read_text(meta_path))
            except (OSError, ValueError, TypeError, AppError):
                continue
            if isinstance(meta, dict):
                rows.append(Snapshot(directory=Path(snap), meta=meta))
    rows.sort(key=lambda s: (s.stamp, str(s.directory)), reverse=True)
    return rows[:limit]


def load_plain_save(fs: FileSystem, snapshot: Snapshot) -> dict | None:
    """读出快照里的明文 ``dat.json``（网页导入就用它）。"""
    path = snapshot.dat_json
    if not fs.exists(path):
        return None
    try:
        data = json.loads(fs.read_text(path))
    except (OSError, ValueError, TypeError, AppError):
        return None
    return data if isinstance(data, dict) else None


__all__ = ['Snapshot', 'list_snapshots', 'load_plain_save']
