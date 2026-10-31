"""交互与日志共用的控制台状态：上一次输出是不是用户敲的那一行。

日志层靠它在「输入 → 日志」的边界补一个空行，而不是每次输入完都空一行
（那样输入紧跟输入时就会连出两个空行）。
"""
from __future__ import annotations

_input_mark = False


def mark_input_done() -> None:
    """记下"刚刚结束一次终端输入"。由 prompts 在 input() 返回后调用。"""
    global _input_mark
    _input_mark = True


def take_input_mark() -> bool:
    """读一次即清：谁先输出谁负责补那条空行。"""
    global _input_mark
    was = _input_mark
    _input_mark = False
    return was


__all__ = ['mark_input_done', 'take_input_mark']
