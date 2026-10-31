"""``find_adb``：解析顺序与"不扫盘根目录"这条约束。

历史坑：搜索根里带 ``C:\\`` / ``D:\\`` 时，没装 adb 的机器首次启动会跑满整盘 glob，
用户看到的是"程序卡死"。这个测试直接把"根目录不许出现在搜索根里"钉住。
"""
from __future__ import annotations

import os
from pathlib import Path

import pytest

from guanxing.infra.device import discovery


@pytest.fixture(autouse=True)
def clear_cache():
    discovery._FIND_CACHE.clear()
    yield
    discovery._FIND_CACHE.clear()


def test_explicit_wins(tmp_path: Path, monkeypatch) -> None:
    exe = tmp_path / 'adb.exe'
    exe.write_bytes(b'')
    monkeypatch.setenv('YYGX_ADB', str(tmp_path / 'other' / 'adb.exe'))
    found, source = discovery.find_adb(explicit=str(exe))
    assert found == str(exe)
    assert source == '--adb'


def test_env_used_when_no_explicit(tmp_path: Path, monkeypatch) -> None:
    exe = tmp_path / 'adb.exe'
    exe.write_bytes(b'')
    monkeypatch.setenv('YYGX_ADB', str(exe))
    found, source = discovery.find_adb()
    assert found == str(exe)
    assert 'YYGX_ADB' in source


def test_bad_env_does_not_raise(tmp_path: Path, monkeypatch) -> None:
    """YYGX_ADB 填错也只是继续往下找，不能崩。"""
    monkeypatch.setenv('YYGX_ADB', str(tmp_path / 'nope' / 'adb.exe'))
    found, source = discovery.find_adb()
    assert source != '环境变量 YYGX_ADB'


def test_search_roots_never_include_drive_root() -> None:
    """盘根目录会让首次启动扫满整盘。"""
    roots = list(discovery._ADB_SEARCH_ROOTS) + list(discovery._DEEP_ROOTS)
    for root in roots:
        expanded = discovery._expand(root).replace('\\', os.sep).replace('/', os.sep)
        drive_roots = {f'{ch}:{os.sep}' for ch in 'CDEF'}
        assert expanded.rstrip(os.sep) + os.sep not in drive_roots, root


def test_found_result_is_cached(tmp_path: Path, monkeypatch) -> None:
    exe = tmp_path / 'adb.exe'
    exe.write_bytes(b'')
    discovery.find_adb(explicit=str(exe))
    assert (str(exe), None) in discovery._FIND_CACHE


def test_miss_is_not_cached(monkeypatch) -> None:
    """一次没找到不能永久记住——用户装完 adb 再跑就得能找到。"""
    monkeypatch.setattr(discovery, '_find_adb_uncached',
                        lambda explicit=None: (None, '没找到'))
    assert discovery.find_adb(explicit='x') == (None, '没找到')
    assert discovery._FIND_CACHE == {}



