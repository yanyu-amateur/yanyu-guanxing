"""输出命名规则单测（纯字符串，不碰文件系统）。"""
from __future__ import annotations

from datetime import datetime

from guanxing.domain.save.naming import (
    group_name,
    platform_tag,
    server_tag,
    stamp_of,
)


def test_group_name_shape() -> None:
    assert group_name('android', 1, '测试角色') == 'android-s1-测试角色'


def test_group_name_never_contains_account() -> None:
    """账号不进文件名（隐私契约）。"""
    name = group_name('android', 1, '测试角色')
    assert 'TESTACC' not in name


def test_group_name_sanitizes_illegal_chars() -> None:
    name = group_name('android', None, 'a/b:c*d')
    for ch in '/:*':
        assert ch not in name


def test_group_name_override_wins() -> None:
    assert group_name('android', 1, 'nick', override='custom') == 'custom'


def test_server_and_platform_tags() -> None:
    assert server_tag(1) == 's1'
    assert server_tag('') == 'unknown'
    assert platform_tag('IOS') == 'ios'


def test_stamp_is_yyyymmdd_hhmmss() -> None:
    """目录名就是时间戳，跟旧工具一致（不做撞名改名）。"""
    assert stamp_of(datetime(2026, 10, 30, 12, 0, 0)) == '20261030-120000'
    assert stamp_of(datetime(2026, 1, 2, 3, 4, 5)) == '20260102-030405'
