"""内层密钥候选顺序（纯函数，无 IO）。

这个模块决定「拿哪个密钥去试」的顺序。
注意：候选必须永远包含代码内置表里的值，文件里的内容只能补充，不能覆盖掉内置项。
"""
from __future__ import annotations

from collections.abc import Iterable, Sequence

from .table import KeyTable


def suffix_order(table: KeyTable, runtime: str) -> list[str]:
    """渠道后缀尝试顺序：当前平台优先，其后是其它平台。

    Args:
        table: 密钥表。
        runtime: 当前平台。
    Returns:
        去重后的后缀列表。
    """
    exact = list(table.channel_suffixes.get(runtime, ()))
    others: list[str] = []
    for channel, suffixes in table.channel_suffixes.items():
        if channel == runtime:
            continue
        others.extend(suffixes)
    return _dedupe([s for s in (*exact, *others) if s])


def inner_candidates(
    table: KeyTable,
    runtime: str,
    version: str,
    *,
    explicit: str | None = None,
    extra: Sequence[str] = (),
) -> list[str]:
    """生成内层密钥候选，SaveEnvelope 与 decode_with_hunt 都走这里。

    Args:
        table: 密钥表，内置表加文件里的记录。
        runtime: 当前平台。
        version: 8 位版本号。
        explicit: 用户显式指定的内层密钥。
        extra: 额外候选，比如刚抓到的 psw 拼出来的钥匙。
    Returns:
        去重后的候选，顺序是显式、额外、表里 psw 加各渠道后缀、裸 psw。
    """
    out: list[str] = []
    if explicit:
        out.append(explicit)
    out.extend(extra)

    psw = (table.version_psw.get(version) or '').strip()
    if psw:
        for suffix in suffix_order(table, runtime):
            out.append(psw + suffix)
        out.append(psw)  # 后缀为空的历史版本

    return _dedupe([c for c in out if c])


def candidates_from_psw(table: KeyTable, runtime: str, psw: str) -> list[str]:
    """只用一把 psw 拼出内层候选，供先在内存里试通、试过才落表用。

    Args:
        table: 密钥表，用来取全部渠道后缀。
        runtime: 当前平台，决定后缀优先级。
        psw: 8 位 psw。
    Returns:
        候选顺序是 psw 加各渠道后缀、裸 psw；psw 为空时返回空列表。
        不要拿它直接写 keys.json，没验证过的 psw 会永久压在表里挡住后来的正确值。
    """
    token = (psw or '').strip()
    if not token:
        return []
    suffixes = suffix_order(table, runtime)
    return _dedupe([*(token + s for s in suffixes), token])


def _dedupe(items: Iterable[str]) -> list[str]:
    seen: set[str] = set()
    out: list[str] = []
    for item in items:
        if item and item not in seen:
            seen.add(item)
            out.append(item)
    return out


__all__ = ['candidates_from_psw', 'inner_candidates', 'suffix_order']
