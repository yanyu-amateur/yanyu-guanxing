"""输出命名规则，纯函数无 IO：<outdir>/<平台>-<区服>-<角色>/<yyyymmdd-hhmmss>/。

与旧版本保持一致，dat.db 不写进快照
"""
from __future__ import annotations

from datetime import datetime
from pathlib import Path

from guanxing.shared.text import safe_filename

_PLATFORM_TAG = {'android': 'android', 'ios': 'ios'}

# 存档库只有一种：游戏写出来的 dat.db（sqlite 格式，但扩展名就这一个）
DB_SUFFIX = '.db'


def platform_tag(runtime: str) -> str:
    return _PLATFORM_TAG.get((runtime or '').strip().lower(), 'unknown')


def server_tag(server: str | int | None) -> str:
    """区服标签：``1`` → ``s1``；空值 → ``unknown``。"""
    raw = '' if server is None else str(server).strip()
    return f's{raw}' if raw else 'unknown'


def group_name(
    runtime: str,
    server: str | int | None,
    nick: str,
    override: str | None = None,
) -> str:
    """快照分组目录名。

    Args:
        runtime: 平台。
        server: 区服号。
        nick: 角色名。
        override: 用户显式指定的名字。
    Returns:
        安全的目录名，形如 ``android-s26-测试角色``。
    """
    if override and override.strip():
        return safe_filename(override.strip())
    parts = [platform_tag(runtime), server_tag(server), safe_filename(nick or 'unnamed')]
    return '-'.join(p for p in parts if p)


def stamp_of(moment: datetime) -> str:
    """时间戳目录名，精确到秒。"""
    return moment.strftime('%Y%m%d-%H%M%S')


def server_of(path: str | None) -> str:
    """从设备路径 ``…/files/<账号>/server1/dat.db`` 里取区服号。

    Args:
        path: 远端路径（本地路径同样适用）。
    Returns:
        ``'1'``；路径里没有 ``serverNN`` 目录时返回空串。
    """
    parts = Path(path or '').parts
    if len(parts) < 2:
        return ''
    name = parts[-2]
    return name[len('server'):] if name.startswith('server') else ''


__all__ = [
    'DB_SUFFIX', 'group_name', 'platform_tag', 'server_of',
    'server_tag', 'stamp_of',
]
