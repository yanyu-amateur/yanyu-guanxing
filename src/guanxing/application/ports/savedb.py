"""dat.db（sqlite）读写端口。

简单读写，一账号一表，实现在 infra/savedb/sqlite_repo 
"""

from pathlib import Path
from typing import Protocol


class DBProcessor(Protocol):
    def __init__(self, db_path: str | Path) -> None: ...

    def read_save(self) -> dict[str, str]:
        """读这份库里唯一的存档行，返回 ``{id, content, player}``。"""
        ...

    def write_save(self, row: dict[str, str]) -> None:
        """写入或覆盖一条 save 行（按 id 主键），仅供改档回写，当前无入口。

        Args:
            row: 至少含 id / content / player 三个键。
        """
        ...
