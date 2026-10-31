"""shared.utils 的路径检查与 JSON 读写。

check_path 只做存在、可读、可写三件事并返回 Path；内部拼出来的路径别用它，直接 mkdir。
它只在边界用一次：CLI 参数、HAR、dat.db、keys、--log。
"""
from __future__ import annotations

from pathlib import Path

import pytest

from guanxing.shared.utils import check_path, load_json, write_json


def test_returns_path_object(tmp_path: Path) -> None:
    target = tmp_path / 'a.txt'
    target.write_text('x', encoding='utf-8')
    assert check_path(str(target), readable=True) == target
    assert isinstance(check_path(str(tmp_path)), Path)


def test_missing_file_raises(tmp_path: Path) -> None:
    with pytest.raises(FileNotFoundError):
        check_path(tmp_path / 'nope', readable=True)


def test_unreadable_file_raises(tmp_path: Path) -> None:
    target = tmp_path / 'dir_as_file'
    target.mkdir()
    with pytest.raises(OSError):
        check_path(target, readable=True)


def test_writable_creates_parent(tmp_path: Path) -> None:
    target = tmp_path / 'deep' / 'nested' / 'keys.json'
    check_path(target, writable=True)
    assert target.parent.is_dir()


def test_writable_leaves_no_empty_file(tmp_path: Path) -> None:
    """探活用的空文件必须被清掉，否则下次 load_json 会读到空文件。"""
    target = tmp_path / 'keys.json'
    check_path(target, writable=True)
    assert not target.exists()


def test_writable_keeps_existing_content(tmp_path: Path) -> None:
    target = tmp_path / 'keys.json'
    target.write_text('{"a": 1}', encoding='utf-8')
    check_path(target, writable=True)
    assert load_json(target) == {'a': 1}


def test_json_roundtrip(tmp_path: Path) -> None:
    target = tmp_path / 'x.json'
    write_json(target, {'k': 'v'})
    assert load_json(target) == {'k': 'v'}


def test_load_json_tolerates_broken_file(tmp_path: Path) -> None:
    target = tmp_path / 'bad.json'
    target.write_text('{not json', encoding='utf-8')
    assert load_json(target) == {}


def test_load_json_tolerates_missing(tmp_path: Path) -> None:
    assert load_json(tmp_path / 'nope.json') == {}


# ───────────── 编码：写绝不留 BOM，读要容忍外部写的 BOM ─────────────
def test_local_fs_never_writes_bom(tmp_path: Path) -> None:
    """读用 utf-8-sig、写用 utf-8，混用会让写出的 dat.json 带 BOM。"""
    from guanxing.infra.fs.local import FileSystemImpl

    target = tmp_path / 'dat.json'
    FileSystemImpl().atomic_write_text(target, '{"a": 1}')
    assert not target.read_bytes().startswith(b'\xef\xbb\xbf')
    assert target.read_bytes() == b'{"a": 1}'


def test_local_fs_reads_file_with_bom(tmp_path: Path) -> None:
    """记事本/PowerShell 5.1 写出来的带 BOM 文件要能读进来。"""
    from guanxing.infra.fs.local import FileSystemImpl

    target = tmp_path / 'bom.json'
    target.write_bytes(b'\xef\xbb\xbf{"a": 2}')
    assert FileSystemImpl().read_text(target) == '{"a": 2}'


def test_write_json_never_writes_bom(tmp_path: Path) -> None:
    target = tmp_path / 'k.json'
    write_json(target, {'a': 1})
    assert not target.read_bytes().startswith(b'\xef\xbb\xbf')


def test_load_json_tolerates_bom(tmp_path: Path) -> None:
    target = tmp_path / 'k.json'
    target.write_bytes(b'\xef\xbb\xbf{"a": 3}')
    assert load_json(target) == {'a': 3}
