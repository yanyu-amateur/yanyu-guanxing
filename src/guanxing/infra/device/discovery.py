"""定位 adb 可执行文件，顺序是显式参数、环境变量、常见安装位置、PATH、用户目录浅搜。

不扫盘根目录：以前把 C:\\ 与 D:\\ 也列进搜索根，没装 adb 的机器首次启动会 glob 满整盘。
"""
from __future__ import annotations

import glob
import logging
import os
import shutil
from collections.abc import Iterator
from pathlib import Path

_ADB_CANDIDATES = [
    r'%LOCALAPPDATA%\Android\Sdk\platform-tools\adb.exe',
    r'C:\Android\Sdk\platform-tools\adb.exe',
    r'C:\platform-tools\adb.exe',
    r'D:\platform-tools\adb.exe',
    # 模拟器自带的 adb
    r'C:\Program Files\mumu\MuMuPlayer\nx_device\12.0\shell\adb.exe',
    r'C:\Program Files\mumu\MuMuPlayer\nx_device\15.0\shell\adb.exe',
    r'C:\Program Files\MuMuPlayer\nx_device\12.0\shell\adb.exe',
    r'C:\Program Files\MuMuPlayer\nx_device\15.0\shell\adb.exe',
    r'C:\Program Files\Netease\MuMuPlayer\nx_device\12.0\shell\adb.exe',
    r'C:\Program Files\Netease\MuMuPlayer\nx_device\15.0\shell\adb.exe',
    r'C:\Program Files\leidian\LDPlayer9\adb.exe',
    r'C:\Program Files\LDPlayer9\adb.exe',
    r'C:\Program Files (x86)\mumu\MuMuPlayer\nx_device\12.0\shell\adb.exe',
    r'C:\Program Files (x86)\mumu\MuMuPlayer\nx_device\15.0\shell\adb.exe',
    r'C:\Program Files (x86)\MuMuPlayer\nx_device\12.0\shell\adb.exe',
    r'C:\Program Files (x86)\MuMuPlayer\nx_device\15.0\shell\adb.exe',
    r'C:\Program Files (x86)\Netease\MuMuPlayer\nx_device\12.0\shell\adb.exe',
    r'C:\Program Files (x86)\Netease\MuMuPlayer\nx_device\15.0\shell\adb.exe',
    r'C:\Program Files (x86)\leidian\LDPlayer9\adb.exe',
    r'C:\Program Files (x86)\LDPlayer9\adb.exe',
]

# "装在哪都行"的位置：SDK 一般就在这几个目录下的 platform-tools 里
_ADB_SEARCH_ROOTS = [
    r'%LOCALAPPDATA%',
    r'%USERPROFILE%\AppData\Local',
    r'C:\Program Files',
    r'C:\Program Files (x86)',
    r'D:\Program Files',
]

# 用户自己解压的 zip：只在这两个目录往下找
_DEEP_ROOTS = (r'%USERPROFILE%\Desktop', r'%USERPROFILE%\Downloads')

logger = logging.getLogger(__name__)

# find_adb 要跑一堆目录扫描，进程内缓存一份（可能被多次构造 adb 调用）
_FIND_CACHE: dict[tuple[str | None, str | None], tuple[str | None, str]] = {}


def _expand(p: str) -> str:
    return os.path.expandvars(os.path.expanduser(p))


def _ok(p: str | Path | None) -> bool:
    """能读到就算可用。

    Args:
        p: 候选路径，可以是 None。
    Returns:
        True 表示是个可读文件。这里不能用 check_path，它找不到会抛 FileNotFoundError，
        而环境变量填错一个路径不该让搜索链断掉。
    """
    if not p:
        return False
    try:
        return Path(p).is_file()
    except OSError:
        return False


def _search_platform_tools() -> Iterator[str]:
    """在常见安装根下两级内找 ``platform-tools/adb.exe``，再在用户目录里深搜三层。"""
    seen: set[str] = set()
    for root in _ADB_SEARCH_ROOTS:
        root = _expand(root)
        if not os.path.isdir(root):
            continue
        pat = os.path.join(root, *(['*'] * 2), 'platform-tools', 'adb.exe')
        for p in glob.glob(pat):
            d = os.path.dirname(p)
            if d in seen:
                continue
            seen.add(d)
            yield p
    for root in _DEEP_ROOTS:
        root = _expand(root)
        if not os.path.isdir(root):
            continue
        pat = os.path.join(root, *(['*'] * 3), 'adb.exe')
        for p in glob.glob(pat)[:200]:
            if os.path.basename(p).lower() in ('adb.exe', 'hd-adb.exe'):
                yield p


def find_adb(explicit: str | Path | None = None) -> tuple[str | None, str]:
    """返回 ``(adb 路径, 来源说明)``；找不到时路径为 None。"""
    key = str(explicit) if explicit else None
    cached = _FIND_CACHE.get((key, None))
    if cached is not None:
        return cached
    found = _find_adb_uncached(explicit)
    if found[0]:                      # 只缓存命中，避免一次失败后永远拿不到
        _FIND_CACHE[(key, None)] = found
    return found


def _find_adb_uncached(explicit: str | Path | None = None) -> tuple[str | None, str]:
    if _ok(explicit):
        return str(explicit), "--adb"

    env = os.environ.get('YYGX_ADB')
    if _ok(env):
        return env, '环境变量 YYGX_ADB'

    which = shutil.which('adb') or shutil.which('adb.exe')
    if _ok(which):
        return which, '系统 PATH 中的 adb'

    for p in _ADB_CANDIDATES:
        p = _expand(p)
        if _ok(p):
            return p, '常见安装位置'

    logger.debug('常见位置没找到 adb，正在用户目录里搜索 …')
    for p in _search_platform_tools():
        if _ok(p):
            return p, '搜索找到'

    return None, '没找到'
