"""``/proc/<pid>/maps`` 解析（纯函数，不碰 adb，可单独单测）。

一行形如：
    7f8a2c0000-7f8a2d0000 rw-p 00000000 00:00 0                          [anon:dalvik-main]
"""
from __future__ import annotations

import re

from guanxing.application.ports.memory import Region

MAPS_RE = re.compile(
    r'^([0-9a-f]+)-([0-9a-f]+)\s+(\S{4})\s+([0-9a-f]+)\s+(\S+)\s+(\d+)\s*(.*)$'
)


def parse_maps(text: str) -> list[Region]:
    """把 maps 文本解析成区域列表（保留全部，不做过滤）。"""
    out: list[Region] = []
    for line in (text or '').splitlines():
        match = MAPS_RE.match(line.strip())
        if not match:
            continue
        out.append(Region(
            start=int(match.group(1), 16),
            end=int(match.group(2), 16),
            perm=match.group(3),
            path=match.group(7).strip(),
        ))
    return out


def select_regions(
    regions: list[Region],
    *,
    anon_only: bool = True,
    min_kb: int = 64,
    sort_desc: bool = True,
) -> list[Region]:
    """从 maps 里挑出值得扫的区域。

    Args:
        regions: 全部区域。
        anon_only: 只留匿名区。
        min_kb: 小于该大小（KB）的段丢掉。
        sort_desc: 是否按大小降序。
    Returns:
        筛选后的区域列表。
    """
    out = []
    for region in regions:
        if not region.readable or region.size <= 0:
            continue
        if anon_only and not region.is_anon:
            continue
        if region.size < min_kb * 1024:
            continue
        out.append(region)
    if sort_desc:
        out.sort(key=lambda r: -r.size)
    return out


def total_bytes(regions: list[Region]) -> int:
    return sum(r.size for r in regions)


__all__ = ['MAPS_RE', 'parse_maps', 'select_regions', 'total_bytes']
