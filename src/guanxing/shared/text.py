"""文本工具：脱敏、大小/时长格式化、安全文件名。"""
from __future__ import annotations

import re

# Windows 保留名（CON/PRN/AUX/NUL/COM1..9/LPT1..9），大小写不敏感
_WIN_RESERVED = {
    'con', 'prn', 'aux', 'nul',
    *(f'com{i}' for i in range(1, 10)),
    *(f'lpt{i}' for i in range(1, 10)),
}
_ILLEGAL = re.compile(r'[<>:"/\\|?*\x00-\x1f]')


def redact(secret: str, *, keep_head: int = 4, keep_tail: int = 4) -> str:
    """密钥脱敏：短于 ``keep_head + keep_tail`` 的直接全掩，避免"脱敏后等于原文"。"""
    if not secret:
        return ''
    if len(secret) <= keep_head + keep_tail:
        return '…' * len(secret)
    return f'{secret[:keep_head]}…{secret[-keep_tail:]}'


def safe_filename(name: str, *, fallback: str = 'unnamed', max_len: int = 80) -> str:
    """把任意字符串变成跨平台安全的文件名。

    Args:
        name: 原始名字。
        fallback: 清洗后为空时的兜底名。
        max_len: 最大长度（按字符而非字节）。
    Returns:
        安全文件名。
    """
    s = _ILLEGAL.sub('_', (name or '').strip())
    s = s.rstrip(' .')
    if not s:
        return fallback
    if s.split('.')[0].lower() in _WIN_RESERVED:
        s = f'_{s}'
    return s[:max_len] or fallback


def human_size(n: int | float) -> str:
    """1024 进制的人类可读大小。"""
    size = float(n)
    for unit in ('B', 'KB', 'MB', 'GB', 'TB'):
        if abs(size) < 1024.0 or unit == 'TB':
            return f'{size:.0f}{unit}' if unit == 'B' else f'{size:.1f}{unit}'
        size /= 1024.0
    return f'{size:.1f}TB'


__all__ = ['human_size', 'redact', 'safe_filename']
