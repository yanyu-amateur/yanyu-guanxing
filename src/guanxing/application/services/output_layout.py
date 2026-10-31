"""输出层：决定文件最终落在哪、按什么名字、按什么顺序写。

先全部写进快照目录，成功后再返回；
任何一步失败都由调用方决定是否清理
"""
from __future__ import annotations

import json
from datetime import datetime
from pathlib import Path
from typing import Any

from guanxing.domain.save.naming import group_name, stamp_of
from guanxing.shared.progress import ProgressSink

from ..ports.fs import FileSystem

JSON_NAME = 'dat.json'
META_NAME = 'dat.meta.json'
REPORT_NAME = 'dat.report.md'


class OutputLayout:
    """把一次导入的结果写成一个快照目录。"""

    def __init__(
        self,
        fs: FileSystem,
        progress: ProgressSink,
    ) -> None:
        self.fs = fs
        self.progress = progress

    def make_snapshot_dir(
        self,
        out_dir: Path,
        *,
        runtime: str,
        server: str | int | None,
        nick: str,
        override: str | None = None,
        moment: datetime | None = None,
    ) -> Path:
        """``<out>/<平台-区服-角色>/<yyyymmdd-hhmmss>``（与前一版本工具一致）。"""
        group = group_name(runtime, server, nick, override)
        parent = Path(out_dir) / group
        self.fs.makedirs(parent)
        snapshot = parent / stamp_of(moment or datetime.now())
        self.fs.makedirs(snapshot)
        return snapshot

    def write_all(
        self,
        snapshot: Path,
        *,
        data: dict[str, Any] | None,
        meta: dict[str, Any],
        report_text: str = '',
    ) -> dict[str, Path]:
        """写出快照里的固定文件（dat.json / dat.meta.json / dat.report.md），返回路径表。"""
        snapshot = Path(snapshot)
        written: dict[str, Path] = {}

        if data is not None:
            json_path = snapshot / JSON_NAME
            self.fs.atomic_write_text(
                json_path,
                json.dumps(data, ensure_ascii=False, indent=2, sort_keys=False),
            )
            written['json'] = json_path

        meta_path = snapshot / META_NAME
        self.fs.atomic_write_text(
            meta_path,
            json.dumps(meta, ensure_ascii=False, indent=2, sort_keys=False),
        )
        written['meta'] = meta_path

        if report_text:
            report_path = snapshot / REPORT_NAME
            self.fs.atomic_write_text(report_path, report_text)
            written['report'] = report_path

        self.progress.step('输出目录', str(snapshot))
        return written


__all__ = ['JSON_NAME', 'META_NAME', 'REPORT_NAME', 'OutputLayout']
