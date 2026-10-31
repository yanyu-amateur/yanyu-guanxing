"""密钥库端口：取候选、记住新学到的密钥。

信任模型：内置表是唯一权威，内置已收录的版本任何来源都改不动。
端口只负责记和给外层候选，内层候选顺序由 domain/keys/resolver 统一产出。
"""

from collections.abc import Sequence
from typing import Protocol


class KeyStore(Protocol):
    def load(self) -> None: ...

    # 候选查询（只在内存里算，不碰磁盘）
    def outer_candidates(self, account: str | None, save_id: str | None,
                         explicit: str | None = None) -> Sequence[str]:
        """外层密钥候选：显式 > 按 id 记录 > 按账号记录。"""
        ...

    # 落盘
    def remember_inner(self, version: str, psw: str) -> bool:
        """记下新获取的 psw。

        Args:
            version: 8 位版本号。
            psw: 内层密钥前缀。
        Returns:
            True 表示是新值（调用方应提示用户），False 表示已有相同值。
        """
        ...

    def remember_inner_key(self, version: str, inner_key: str,
                           runtime: str = 'android') -> bool:
        """记下完整内层密钥，后缀不在表里时一并收下（只记 psw 的话新渠道照样解不开）。

        Args:
            version: 8 位版本号。
            inner_key: 16 字符完整密钥（psw + 后缀）。
            runtime: 后缀归属的渠道，新后缀会记到这个名下。
        Returns:
            True 表示表里确实多出了新东西。
        """
        ...

    def remember_outer(self, account: str | None, key: str,
                       save_id: str | None = None) -> bool: ...

    def report_runtime_conflicts(self) -> list[str]:
        """运行期挖到、却被内置表拒绝的钥匙，给用户的提示（无冲突时为空）。

        Returns:
            提示文案列表；这些值只用于本次运行，不落盘。
        """
        ...
