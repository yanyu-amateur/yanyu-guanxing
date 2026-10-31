"""dat.db 读取：坏文件/没有 save 表必须是 DBError，不能漏出 sqlite3 异常。

漏出去的后果是 main() 走通用兜底，直接甩一屏堆栈，用户根本看不出是 dat.db 的问题。
"""
from __future__ import annotations

import sqlite3
from pathlib import Path

import pytest

from guanxing.infra.savedb.sqlite_repo import DBProcessorImpl
from guanxing.shared.errors import DBError


def _make_db(path: Path, *, table: str = 'save', row: tuple | None = None) -> Path:
    conn = sqlite3.connect(path)
    conn.execute(f'CREATE TABLE {table} (id TEXT PRIMARY KEY NOT NULL, '
                 'content TEXT, player TEXT)')
    if row is not None:
        conn.execute(f'INSERT INTO {table} VALUES (?,?,?)', row)
    conn.commit()
    conn.close()
    return path


def test_read_save_returns_row(tmp_path: Path) -> None:
    db = _make_db(tmp_path / 'dat.db', row=('ABC', 'c0', 'p0'))
    assert DBProcessorImpl(db).read_save()['content'] == 'c0'


def test_missing_save_table_is_db_error(tmp_path: Path) -> None:
    db = _make_db(tmp_path / 'dat.db', table='other')
    with pytest.raises(DBError) as err:
        DBProcessorImpl(db).read_save()
    assert 'save 表' in str(err.value)


def test_empty_save_table_is_db_error(tmp_path: Path) -> None:
    db = _make_db(tmp_path / 'dat.db')
    with pytest.raises(DBError) as err:
        DBProcessorImpl(db).read_save()
    assert '空' in str(err.value)


def test_not_a_sqlite_file_is_db_error(tmp_path: Path) -> None:
    db = tmp_path / 'junk.db'
    db.write_bytes(b'not a database at all' * 100)
    with pytest.raises(DBError):
        DBProcessorImpl(db).read_save()


def test_missing_file_is_db_error(tmp_path: Path) -> None:
    with pytest.raises(DBError) as err:
        DBProcessorImpl(tmp_path / 'nope.db')
    assert '打不开' in str(err.value)