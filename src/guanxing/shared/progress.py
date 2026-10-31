"""进度与用户可见输出端口。

用例只依赖 ``ProgressSink``，具体实现（日志 / tqdm）在 ``infra/reporting``。
这样 application 里不会有 print，也不需要 argparse。
"""
from __future__ import annotations

from typing import Protocol, runtime_checkable


@runtime_checkable
class TaskHandle(Protocol):
    """一个可推进的长任务句柄。"""
    def update(self, advance: int = 1, note: str = '') -> None: ...
    def close(self) -> None: ...


@runtime_checkable
class ProgressSink(Protocol):
    """用户可见输出端口。
    step/info/hint 是过程节点，--quiet 时全部静默；warn 在任何级别都输出；
    debug 只在 -v 下出现。
    """
    def step(self, label: str, value: str, *, ok: bool = True) -> None: ...
    def info(self, text: str) -> None: ...
    def warn(self, text: str) -> None: ...
    def hint(self, text: str) -> None: ...
    def debug(self, text: str) -> None: ...
    def task(self, total: int, desc: str, unit: str = '') -> TaskHandle:
        """开一个长任务进度句柄。

        Args:
            total: 总量（字节数或条数）。
            desc: 一句话描述，直接显示在进度条左侧。
            unit: 单位；``'B'`` 会按 1024 缩放成 KB/MB，空则用条。
        Returns:
            可推进、必须 close 的句柄。
        """
        ...


class NullTask:
    """不做任何显示的句柄（计时/计数都省了）。

    ``--quiet`` 或总量为 0 时由 ``tasks.make_task`` 返回，所以它必须留在 src。
    """

    def __init__(self, total: int = 0, desc: str = '', unit: str = '') -> None:
        self.total = total
        self.desc = desc
        self.unit = unit

    def update(self, advance: int = 1, note: str = '') -> None:
        return None

    def close(self) -> None:
        return None


__all__ = ['NullTask', 'ProgressSink', 'TaskHandle']
