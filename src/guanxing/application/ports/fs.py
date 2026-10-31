"""文件系统端口：用例需要读写文件，解决用例的IO问题。

实现见 ``infra/fs/local.py``（UTF-8 读、原子写）。
"""
from __future__ import annotations

from collections.abc import Sequence
from pathlib import Path
from typing import Protocol


class FileSystem(Protocol):
    """最小可用的文件系统能力集合（粗粒度，不做字节级抽象）。"""

    def exists(self, path: Path) -> bool: ...

    def read_text(self, path: Path, *, encoding: str = 'utf-8-sig') -> str:
        """读文本。默认 ``utf-8-sig``：容忍外部工具写入的 BOM。"""
        ...


    def atomic_write_text(self, path: Path, text: str, *,
                          encoding: str = 'utf-8') -> None:
        """原子写文本。默认 ``utf-8``"""
        ...

    def makedirs(self, path: Path) -> None: ...

    def list_dir(self, path: Path) -> Sequence[Path]: ...
