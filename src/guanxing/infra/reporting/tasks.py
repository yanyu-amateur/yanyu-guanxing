"""长任务进度句柄的两种实现：tqdm 进度条，或没装 tqdm 时的退化日志。

一个基类管计数，两个子类只管怎么显示；要不要显示统一由 make_task 判断一次。
写 stderr 与 logging 同流，{postfix} 必须进 bar_format 否则附注会被丢掉。
"""
from __future__ import annotations

import logging
import sys

from guanxing.shared.progress import NullTask, TaskHandle

INDENT = '  '

# 已完成/总数、速度、预计剩余；末尾 {postfix} 用来显示"候选 N 条"
BAR_FMT = ('{desc}: {percentage:3.0f}%|{bar}| {n_fmt}/{total_fmt}'
           ' [{elapsed}<{remaining}, {rate_fmt}]{postfix}')


class _CountingTask:
    """计数与收尾的共用部分。子类只实现 ``_render`` / ``_finish``。"""

    def __init__(self, total: int, desc: str, unit: str = '') -> None:
        self.total = max(0, total)
        self.desc = desc
        self.unit = unit
        self.done = 0

    def update(self, advance: int = 1, note: str = '') -> None:
        self.done += max(0, advance)
        self._render(note)

    def close(self) -> None:
        self._finish()

    def _render(self, note: str) -> None:      # pragma: no cover - 抽象
        raise NotImplementedError

    def _finish(self) -> None:                 # pragma: no cover - 抽象
        raise NotImplementedError


class LogTask(_CountingTask):
    """退化实现：百分比进度，每跨过 ``step_pct`` 打一行 debug，避免刷屏。

    用 debug 而不是 info：默认不该把二十行百分比喷到用户脸上，``-v`` 时才看。
    """

    def __init__(self, logger: logging.Logger, total: int, desc: str, *,
                 unit: str = '', step_pct: int = 5) -> None:
        super().__init__(total, desc, unit)
        self.logger = logger
        self.step_pct = step_pct
        self._next = 0

    def _render(self, note: str) -> None:
        if self.total <= 0:
            return
        pct = self.done * 100 // self.total
        if pct < self._next:
            return
        self._next = pct - (pct % self.step_pct) + self.step_pct
        suffix = f' {note}' if note else ''
        self.logger.debug('%s %d/%d%s (%d%%)%s', self.desc, self.done,
                          self.total, self.unit, pct, suffix)

    def _finish(self) -> None:
        if self.total > 0:
            self.logger.debug('%s 完成 %d/%d', self.desc, self.done, self.total)


class TqdmTask(_CountingTask):
    """``tqdm`` 实现（保留最终行，让用户看到 100% 与平均速度）。"""

    def __init__(self, total: int, desc: str, unit: str = '') -> None:
        super().__init__(total, desc, unit)
        from tqdm import tqdm  # 只有真要用时才 import，没装也炸不到别处

        self._bar = tqdm(
            total=self.total,
            desc=f'{INDENT}{desc}',
            unit=unit or 'it',
            unit_scale=unit == 'B',
            unit_divisor=1024,
            file=sys.stderr,
            leave=True,
            dynamic_ncols=True,
            bar_format=BAR_FMT,
        )

    def _render(self, note: str) -> None:
        if note:
            self._bar.set_postfix_str(note, refresh=False)
        self._bar.update(max(0, self.done - self._bar.n))

    def _finish(self) -> None:
        # close() 自己会写出最终行并以换行结束，不需要额外 hack
        self._bar.close()


def make_task(logger: logging.Logger, total: int, desc: str, *,
              unit: str = '', quiet: bool = False) -> TaskHandle:
    """按环境挑一种实现——这是"要不要显示"的唯一判断点。"""
    if quiet or total <= 0:
        return NullTask(total, desc, unit)
    try:
        import tqdm  # noqa: F401 - 只用来判断装没装
    except ImportError:
        return LogTask(logger, total, desc, unit=unit)
    return TqdmTask(total, desc, unit)


__all__ = ['BAR_FMT', 'INDENT', 'LogTask', 'TqdmTask', 'make_task']
