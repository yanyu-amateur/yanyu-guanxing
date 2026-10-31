"""FileSystem 实现：UTF-8 读、原子写、目录创建。

原子写先落临时文件再 os.replace，避免留下写了一半的 dat.json。
注意：所有失败翻译成 WriteFailed 并保留 __cause__。
"""
from __future__ import annotations

import os
import tempfile
from collections.abc import Sequence
from pathlib import Path

from guanxing.application.ports.fs import FileSystem
from guanxing.shared.errors import WriteFailed


class FileSystemImpl(FileSystem):
    """FileSystem 端口的本地实现。

    读用 ``utf-8-sig``（容忍 BOM），写用 ``utf-8``（绝不带 BOM）——
    """

    READ_ENCODING = 'utf-8-sig'
    WRITE_ENCODING = 'utf-8'

    def __init__(self, encoding: str = WRITE_ENCODING) -> None:
        self.encoding = encoding          # 写默认；读另有 READ_ENCODING

    # ── 读 ──
    def exists(self, path: Path) -> bool:
        return Path(path).exists()

    def read_text(self, path: Path, *, encoding: str | None = None) -> str:
        try:
            return Path(path).read_text(
                encoding=encoding or self.READ_ENCODING)
        except OSError as exc:
            raise WriteFailed(f'读取失败: {path}') from exc

    # ── 写 ──
    def atomic_write_text(
        self, path: Path, text: str, *, encoding: str | None = None
    ) -> None:
        """先写同目录临时文件再 replace —— 防止写入过程中断导致文件损坏。"""
        p = Path(path)
        enc = encoding or self.encoding
        try:
            p.parent.mkdir(parents=True, exist_ok=True)
            fd, tmp = tempfile.mkstemp(dir=str(p.parent), prefix='.tmp_', suffix='.part')
            try:
                with os.fdopen(fd, 'w', encoding=enc, newline='\n') as fh:
                    fh.write(text)
                os.replace(tmp, p)
            except BaseException:
                Path(tmp).unlink(missing_ok=True)
                raise
        except OSError as exc:
            raise WriteFailed(f'写入失败: {p}') from exc

    # ── 目录 ──
    def makedirs(self, path: Path) -> None:
        try:
            Path(path).mkdir(parents=True, exist_ok=True)
        except OSError as exc:
            raise WriteFailed(f'创建目录失败: {path}') from exc

    def list_dir(self, path: Path) -> Sequence[Path]:
        p = Path(path)
        if not p.is_dir():
            return ()
        return tuple(sorted(p.iterdir()))


__all__ = ['FileSystemImpl']
