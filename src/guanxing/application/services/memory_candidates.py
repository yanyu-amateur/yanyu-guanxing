"""一次内存扫描的产物，纯数据，不碰设备也不碰解密。

三类候选互补：strings 铺可打印串及其 16 字节变体，anchored 由已知后缀往前取 8 字节，
psw_anchored 由已知 psw 往后取 8 字节；psows 记本次用了哪些锚点，表里新增 psw 时缓存要失效。
"""
from __future__ import annotations

from dataclasses import dataclass


@dataclass(frozen=True)
class MemoryCandidates:
    """一次内存扫描的全部产物。"""

    strings: frozenset[bytes]
    anchored: frozenset[bytes]
    psw_anchored: frozenset[bytes]
    psows: frozenset[str] = frozenset()

    def inner_pool(self) -> set[bytes]:
        """内层爆破的原始候选：三类取并。"""
        return set(self.strings) | set(self.anchored) | set(self.psw_anchored)

    def merge(self, other: MemoryCandidates | None) -> MemoryCandidates:
        """把上一次的结果并进来（重扫只补新锚点，不丢旧候选）。"""
        if other is None:
            return self
        return MemoryCandidates(
            self.strings | other.strings,
            self.anchored | other.anchored,
            self.psw_anchored | other.psw_anchored,
            self.psows | other.psows,
        )


__all__ = ['MemoryCandidates']
