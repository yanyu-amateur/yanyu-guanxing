"""测试共用的替身：一个会记录输出的 ProgressSink。

放在 tests 而不是 src：生产代码没有任何地方需要"什么都不做"的进度实现
（``build_progress`` 永远返回真正的 ``LogReporter``），只有测试要。
"""
from __future__ import annotations

from guanxing.shared.progress import NullTask, TaskHandle


class RecordingProgress:
    """完整实现 ``ProgressSink`` 并记录每一次输出。

    三种断言方式：
    - ``lines``: step/info/warn/hint 的完整文本，按调用顺序
    - ``events``: step 的 label 或整行文本，用来断言先后顺序
    - ``warns`` / ``hints`` / ``debugs``: 分类列表
    """

    def __init__(self) -> None:
        self.lines: list[str] = []
        self.events: list[str] = []
        self.warns: list[str] = []
        self.hints: list[str] = []
        self.debugs: list[str] = []
        self.tasks: list[str] = []

    def step(self, label: str, value: str, *, ok: bool = True) -> None:
        self.lines.append(f'{label}: {value}')
        self.events.append(label)

    def info(self, text: str) -> None:
        self.lines.append(text)
        self.events.append(text)

    def warn(self, text: str) -> None:
        self.lines.append(text)
        self.warns.append(text)
        self.events.append('warn')

    def hint(self, text: str) -> None:
        self.lines.append(text)
        self.hints.append(text)
        self.events.append(text)

    def debug(self, text: str) -> None:
        self.debugs.append(text)

    def task(self, total: int, desc: str, unit: str = '') -> TaskHandle:
        self.tasks.append(desc)
        return NullTask(total, desc, unit)


def stacks_for(settings):
    """``build_stacks(settings)`` 的测试版：默认挂一个记录器。"""
    from guanxing.bootstrap import build_stacks

    return build_stacks(settings, RecordingProgress())


__all__ = ['RecordingProgress', 'stacks_for']
