"""从内存候选集里挑钥匙：两个方向锚定内层密钥，harvest_strings 兜外层密钥。

已知后缀就往前取 8 字节拿 psw（suffixed_candidates），已知 psw 就往后取 8 字节拿后缀（psw_anchored_candidates）。
注意：只用一个会瘸——只铺量 psw 会被几十万候选淹没，只锚定则两端缺一不可；psw 跨渠道复用，可用 expand_suffixes 推其它渠道。
"""
from __future__ import annotations

import re
from collections.abc import Iterable

from ..constants import INNER_KEY_LEN, INNER_PSW_LEN

KEY_LEN = INNER_KEY_LEN
PRINTABLE_RE = re.compile(rb'[\x20-\x7e]{6,80}')


def _pad(cand: bytes) -> bytes:
    """统一成 16 字节（游戏就是 ``key[:16].ljust(16, b'\\0')``）。"""
    return bytes(cand)[:KEY_LEN].ljust(KEY_LEN, b'\x00')


def _variants(text: bytes) -> set[bytes]:
    return {text, text[:16], text[-16:], text[:24], text[:32]}


def harvest_strings(data: bytes) -> set[bytes]:
    """可打印串 → 16 字节候选（含截断/取尾等变体）。"""
    out: set[bytes] = set()
    for match in PRINTABLE_RE.finditer(data):
        for variant in _variants(match.group()):
            if len(variant) >= 6:
                out.add(_pad(variant))
    return out


def suffixed_candidates(data: bytes, suffixes: list[str] | tuple[str, ...]) -> set[bytes]:
    """取内存里"紧跟在已知后缀前的 8 字节"，那就是 psw。

    Args:
        data: 一块内存内容。
        suffixes: 已知渠道后缀。
    Returns:
        候选 psw 集合。
    """
    out: set[bytes] = set()
    for suffix in suffixes:
        needle = suffix.encode('latin-1', 'ignore')
        if not needle:
            continue
        start = 0
        while True:
            idx = data.find(needle, start)
            if idx < 0:
                break
            start = idx + 1
            if idx < 8:
                continue
            psw = data[idx - 8:idx]
            if all(0x20 <= b <= 0x7E for b in psw):
                out.add(psw + needle)
    return out


def psw_anchored_candidates(
    data: bytes, psows: Iterable[str | bytes], *, suffix_len: int = INNER_PSW_LEN,
) -> set[bytes]:
    """取内存里紧跟在已知 psw 后的 8 字节当后缀，拼回完整内层密钥，是 suffixed_candidates 的反方向。

    Args:
        data: 一块内存内容。
        psows: 已知的 psw，长度必须是 8。
        suffix_len: 后缀长度，默认 8。
    Returns:
        16 字节完整内层密钥集合。
    """
    out: set[bytes] = set()
    for psw in psows:
        needle = psw.encode('latin-1', 'ignore') if isinstance(psw, str) else bytes(psw)
        if len(needle) != INNER_PSW_LEN:
            continue
        start = 0
        while True:
            idx = data.find(needle, start)
            if idx < 0:
                break
            start = idx + 1
            tail = data[idx + INNER_PSW_LEN: idx + INNER_PSW_LEN + suffix_len]
            if len(tail) == suffix_len and all(0x20 <= b <= 0x7E for b in tail):
                out.add(needle + tail)
    return out


def expand_suffixes(cands: set[bytes] | list[bytes],
                    suffixes: list[str] | tuple[str, ...]) -> set[bytes]:
    """把候选里的 psw 拆出来和各渠道后缀重新组合，psw 跨渠道共用。

    Args:
        cands: 爆破命中的候选，内部密钥形态。
        suffixes: 目标渠道后缀。
    Returns:
        新的候选集合。
    """
    out: set[bytes] = set()
    for cand in cands:
        cand = bytes(cand)
        out.add(cand)
        if len(cand) != KEY_LEN:
            continue
        psw = cand[:8]
        for suffix in suffixes:
            out.add(psw + suffix.encode('latin-1', 'ignore'))
    return out


def normalize(cands: Iterable[bytes]) -> list[bytes]:
    """去重、补齐/截断到 16 字节，保持顺序稳定（便于复现与测试）。"""
    seen: set[bytes] = set()
    out: list[bytes] = []
    for cand in cands:
        key = _pad(cand)
        if not key or key in seen:
            continue
        seen.add(key)
        out.append(key)
    return out


__all__ = [
    'KEY_LEN', 'PRINTABLE_RE', 'expand_suffixes', 'harvest_strings', 'normalize',
    'psw_anchored_candidates', 'suffixed_candidates',
]
