"""交互原语：问一句、选一个、确认一下。

只做输入，不写文件、不做业务；EOFError/KeyboardInterrupt 统一翻译成 CancelledError（退出码 0）。
注意：提问前空一行并丢掉排队的按键；输完不空行，「输入 → 日志」那条空行由日志层自己补。
"""
from __future__ import annotations

import os
import sys
from collections.abc import Sequence
from typing import IO

from guanxing.shared.console import mark_input_done, take_input_mark
from guanxing.shared.errors import CancelledError

# 回车以外表示退出的输入
QUIT_WORDS = ('q', 'quit', 'exit', '退出')


def drain_input() -> int:
    """丢弃 stdin 里已排队、用户还没对着问题按下的按键。

    Returns:
        丢弃的按键数；无法计数时返回 -1，非终端或已空返回 0。
        扫内存动辄几十秒，等不及的人会一直敲回车，那些回车会让紧接着的 confirm
        被瞬间回答。只在真终端上清，管道或重定向时清了会把数据吃掉。
    """
    stream = sys.stdin
    if stream is None:
        return 0
    try:
        if not stream.isatty():
            return 0
        return _drain_tty(stream)
    except Exception:  # 清不掉也不该让提问失败
        return 0


def _drain_tty(stream: IO[str]) -> int:
    """按平台清空终端输入缓冲。"""
    if os.name == 'nt':
        return _drain_windows()
    return _drain_posix(stream)


def _drain_windows() -> int:
    """Windows 下用 msvcrt 把排队的按键逐个取走，能数清几个。"""
    import msvcrt
    dropped = 0
    while msvcrt.kbhit():
        msvcrt.getwch()
        dropped += 1
    return dropped


def _drain_posix(stream: IO[str]) -> int:
    """POSIX 下用 tcflush 一次清空，清得干净但数不出个数。"""
    import termios
    # 这个分支只在 POSIX 走，Windows 上的 termios 是空壳模块，所以忽略类型报错
    termios.tcflush(stream.fileno(), termios.TCIFLUSH)  # type: ignore[attr-defined]
    return -1


def _reject_quit(raw: str) -> str:
    """输 q 就取消，在每一个提问处生效，不靠调用方记得处理。"""
    if raw.strip().lower() in QUIT_WORDS:
        raise CancelledError('已取消')
    return raw


def ask(question: str, *, default: str = '', inner: bool = False) -> str:
    """问一个字符串，直接回车返回 default，输 q 取消。

    Args:
        question: 问题文本。
        default: 直接回车时的返回值。
        inner: 是否紧跟在上面的选项列表后面，True 时不再顶空行。
    Returns:
        用户输入，已去空白；空输入返回 default。
    Raises:
        CancelledError: 输 q，或 Ctrl+C、EOF。
    """
    if not inner:
        print()
    else:
        take_input_mark()    # 上面已经是本模块的输出，下一条日志不用再空
    suffix = f' [{default}]' if default else ''
    drain_input()        # 只保留用户看到问题之后按的键
    try:
        raw = input(f'{question}{suffix}: ').strip()
    except (EOFError, KeyboardInterrupt) as exc:
        raise CancelledError('已取消') from exc
    mark_input_done()
    _reject_quit(raw)
    return raw or default


def choose(question: str, options: Sequence[str], *, default: int = 1,
           zero_label: str = '返回') -> int:
    """从列表里选一个，返回 1 起的序号。空列表返回 0。

    Args:
        question: 问题文本。
        options: 选项列表（展示时从 1 开始编号，0 固定是"不走任何选项"）。
        default: 直接回车时的序号。
        zero_label: 0 号选项的文字。各处的 0 含义不同（返回 / 导入新的），
            写死一句会让标题和实际行为对不上。
    Returns:
        用户选的序号（1 起）；选 0 返回 0。
    """
    if not options:
        return 0
    print()
    print(question)
    for i, option in enumerate(options, 1):
        print(f'  {i}) {option}')
    print(f'  0) {zero_label}　　（任何时候输 q + 回车 = 退出）')
    while True:
        # 选项列表自己已经占了上面几行，紧跟"请选择"更好读
        raw = ask('请选择', default=str(default), inner=True)
        if not raw.isdigit():
            print('  请输入数字')
            continue
        picked = int(raw)
        if picked == 0 or 1 <= picked <= len(options):
            return picked
        print(f'  超出范围（0-{len(options)}）')


def confirm(question: str, *, default: bool = True) -> bool:
    """Y/n 确认（输 ``q`` 也算取消）。"""
    hint = 'Y/n' if default else 'y/N'
    raw = ask(f'{question} [{hint}]', default='').strip().lower()
    if not raw:
        return default
    return raw in ('y', 'yes', '是', '1')


__all__ = ['QUIT_WORDS', 'ask', 'choose', 'confirm', 'drain_input']
