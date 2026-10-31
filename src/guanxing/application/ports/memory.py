"""进程内存端口，块粒度读取（不是字节粒度）。

热路径一次调用要拿到整段区域，避免拖取大幅拖慢时间
实现见 infra/memory；/proc/<pid>/maps 的纯解析在 proc_maps.py。
"""
from __future__ import annotations

from collections.abc import Sequence
from dataclasses import dataclass
from typing import Protocol

PAGE = 4096


@dataclass(frozen=True)
class Region:
    """一段可读内存。"""

    start: int
    end: int
    perm: str = 'rw-p'
    path: str = ''

    @property
    def size(self) -> int:
        return max(0, self.end - self.start)

    @property
    def is_anon(self) -> bool:
        """是否匿名区（``[heap]`` / ``[stack]`` 这类括号路径）。

        Returns:
            True 表示该区域没有文件映射；密钥通常在堆里，所以默认只扫匿名区。
        """
        return (not self.path) or self.path.startswith('[')

    @property
    def readable(self) -> bool:
        return 'r' in self.perm

    def label(self) -> str:
        return f'0x{self.start:x}-0x{self.end:x} {self.size / 1048576:.1f}MB {self.path}'


class ProcessMemory(Protocol):
    """目标进程的内存读取能力。

    ``read_region`` 读不出来（权限不足的页）时返回短数据；
    但超时必须抛 ``MemoryReadTimeout``，那不是"这段没有密钥"。
    """

    def regions(self, pid: str, *, anon_only: bool = True,
                min_kb: int = 64) -> Sequence[Region]:
        """列出可扫区域（按大小降序）。"""
        ...

    def read_region(self, pid: str, region: Region, *, max_mb: int = 64,
                    chunk_mb: int = 64) -> bytes:
        """把一段区域读回本地（内部自己做分块，调用方不用管）。"""
        ...


__all__ = ['PAGE', 'ProcessMemory', 'Region']