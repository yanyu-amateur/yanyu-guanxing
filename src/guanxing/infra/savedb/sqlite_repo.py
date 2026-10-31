"""dat.db 的 sqlite 实现（DBProcessor 端口）。

一个 dat.db 就是一份存档：玩家每次登录落盘的都是同一个文件
换账号/换角色是另外的库文件
"""

import sqlite3
from contextlib import AbstractContextManager
from pathlib import Path

from guanxing.application.ports.savedb import DBProcessor
from guanxing.shared.errors import DBError
from guanxing.shared.utils import check_path


class _DBConnection(AbstractContextManager):
    def __init__(self, db_path: str) -> None:
        self.conn = sqlite3.connect(db_path)
        self.conn.text_factory = str

    def __enter__(self) -> sqlite3.Connection:
        return self.conn

    def __exit__(self, exc_type: object, exc_value: object,
                 traceback: object) -> None:
        self.conn.close()


class DBProcessorImpl(DBProcessor):
    def __init__(self, db_path: str | Path) -> None:
        try:
            check_path(db_path, readable=True)
        except OSError as exc:
            raise DBError(f'打不开 dat.db: {db_path}',
                          hint='确认路径写对，且文件不是坏的/被占用的') from exc
        self.db_path = str(db_path)

    def read_save(self) -> dict[str, str]:
        """读这份库里唯一的存档行。

        Raises:
            DBError: 文件不可读、没有 save 表、或表为空。
        """
        try:
            with _DBConnection(self.db_path) as conn:
                row = conn.execute(
                    'SELECT id, content, player FROM save'
                ).fetchone()
        except sqlite3.Error as exc:
            raise DBError(f'{self.db_path} 里没有可读的 save 表',
                          hint=str(exc)) from exc
        if row is None:
            raise DBError(f'{self.db_path} 的 save 表是空的')
        return {"id": row[0], "content": row[1], "player": row[2]}

    def write_save(self, row: dict[str, str]) -> None:
        """写入或覆盖一条 save 行，改档回写用，当前无 CLI 入口。

        Args:
            row: 至少含 id / content / player。page_size 保持 1024，新库会自动建出 save 表。
        """
        pk = (row.get('id') or '').strip()
        if not pk:
            raise DBError('写入 save 行失败：缺少 id')
        content = row.get('content') or ''
        player = row.get('player') or ''
        try:
            Path(self.db_path).parent.mkdir(parents=True, exist_ok=True)
            conn = sqlite3.connect(self.db_path)
            try:
                conn.text_factory = str
                conn.execute('PRAGMA page_size=1024')
                conn.execute(
                    'CREATE TABLE IF NOT EXISTS save ('
                    'id TEXT PRIMARY KEY NOT NULL, '
                    'content TEXT, '
                    'player TEXT)'
                )
                conn.execute(
                    'INSERT OR REPLACE INTO save (id, content, player) VALUES (?,?,?)',
                    (pk, content, player),
                )
                conn.commit()
            finally:
                conn.close()
        except sqlite3.Error as exc:
            raise DBError(f'写入 {self.db_path} 失败: {exc}') from exc
