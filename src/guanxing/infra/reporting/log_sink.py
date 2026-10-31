"""ProgressSink 的 logging 实现：步骤、提示、警告三种行加上长任务进度。

过程细节一律走 debug，扫内存与爆破的进度条实现在 tasks.py。
日志 handler 与格式在 shared/logging.py，这里只做进度上报。
"""
from __future__ import annotations

import logging
import sys

from guanxing.shared.console import take_input_mark
from guanxing.shared.progress import TaskHandle

from .tasks import INDENT, make_task

MARK_HINT = '提示：'
MARK_WARN = '! '

_LOGGER_NAME = 'guanxing'


class LogReporter:
    """``ProgressSink`` 的 logging 实现。"""

    def __init__(self, logger: logging.Logger | None = None, *,
                 quiet: bool = False, verbose: int = 0) -> None:
        self.logger = logger or logging.getLogger(_LOGGER_NAME)
        self.quiet = quiet
        self.verbose = verbose

    # ── 流程节点 ──
    def _separate(self) -> None:
        """上一次输出是终端输入时，先空一行，免得日志贴着用户刚敲的回车。"""
        if take_input_mark():
            print(file=sys.stderr)

    def step(self, label: str, value: str, *, ok: bool = True) -> None:
        if self.quiet:
            return
        self._separate()
        mark = '' if ok else '  [失败]'
        self.logger.info('%s%s: %s%s', INDENT, label, value, mark)

    def info(self, text: str) -> None:
        if not self.quiet:
            self._separate()
            self.logger.info('%s%s', INDENT, text)

    def warn(self, text: str) -> None:
        self._separate()
        self.logger.warning('%s%s%s', INDENT, MARK_WARN, text)

    def hint(self, text: str) -> None:
        if not self.quiet:
            self._separate()
            self.logger.info('%s%s%s', INDENT, MARK_HINT, text)

    def debug(self, text: str) -> None:
        if self.verbose:
            self.logger.debug(text)

    def task(self, total: int, desc: str, unit: str = '') -> TaskHandle:
        """高耗时任务：能上 tqdm 就上，否则退化为 5% 一行的 debug 进度。"""
        return make_task(self.logger, total, desc, unit=unit, quiet=self.quiet)


__all__ = ['INDENT', 'MARK_HINT', 'MARK_WARN', 'LogReporter']
