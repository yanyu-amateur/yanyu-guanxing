"""输出语法与进度条：所有用户可见行只有「步骤 / 提示 / 警告」三种形态。"""
from __future__ import annotations

import logging

from guanxing.infra.reporting import tasks
from guanxing.infra.reporting.log_sink import INDENT, MARK_HINT, MARK_WARN, LogReporter
from guanxing.infra.reporting.tasks import LogTask, TqdmTask
from guanxing.shared.console import mark_input_done, take_input_mark
from guanxing.shared.progress import NullTask


def _records(caplog) -> list[str]:
    return [r.getMessage() for r in caplog.records]


# ───────────────────── 三种行 ─────────────────────
def test_step_hint_warn_have_one_shape(caplog) -> None:
    reporter = LogReporter(logging.getLogger('guanxing.test'))
    with caplog.at_level(logging.DEBUG):
        reporter.step('设备', '127.0.0.1:7559')
        reporter.hint('先进一次角色再导入')
        reporter.warn('示例警告')

    assert _records(caplog) == [
        f'{INDENT}设备: 127.0.0.1:7559',
        f'{INDENT}{MARK_HINT}先进一次角色再导入',
        f'{INDENT}{MARK_WARN}示例警告',
    ]
    # 提示行只靠「提示：」标记，不出现任何符号前缀
    assert MARK_HINT == '提示：'
    assert '·' not in _records(caplog)[1]


def test_quiet_prints_nothing(caplog) -> None:
    reporter = LogReporter(logging.getLogger('guanxing.test'), quiet=True)
    with caplog.at_level(logging.DEBUG):
        reporter.step('设备', 'x')
        reporter.hint('y')
    assert caplog.records == []


def test_quiet_still_prints_warnings(caplog) -> None:
    """--quiet 是"只看警告"：成功时一行都没有，结果靠退出码判断。"""
    reporter = LogReporter(logging.getLogger('guanxing.test'), quiet=True)
    with caplog.at_level(logging.DEBUG):
        reporter.step('结果', '成功')
        reporter.warn('示例警告')
    assert _records(caplog) == [f'{INDENT}{MARK_WARN}示例警告']


# ───────────────────── 进度条 ─────────────────────
def test_task_uses_tqdm_when_available() -> None:
    task = LogReporter().task(1024, '扫描内存', unit='B')
    assert isinstance(task, TqdmTask)
    task.update(512, '候选 1')
    task.update(512)
    task.close()


def test_quiet_never_draws_a_bar() -> None:
    task = LogReporter(quiet=True).task(10, '爆破内层密钥', unit='条')
    assert not isinstance(task, TqdmTask)
    task.update(10)
    task.close()


def test_task_falls_back_without_tqdm(monkeypatch) -> None:
    """没装 tqdm 也要能跑：退化成 5% 一行的 debug 进度。"""
    import builtins

    real_import = builtins.__import__

    def fake_import(name, *args, **kwargs):
        if name == 'tqdm':
            raise ImportError(name)
        return real_import(name, *args, **kwargs)

    monkeypatch.setattr(builtins, '__import__', fake_import)
    task = tasks.make_task(logging.getLogger('guanxing.test'), 10, '爆破内层密钥',
                           unit='条')
    assert isinstance(task, LogTask)
    task.update(10, '1,000 条/秒')
    task.close()


def test_zero_total_does_not_open_a_bar() -> None:
    task = LogReporter().task(0, '没有任何候选')
    assert isinstance(task, NullTask)
    task.update(1)
    task.close()


# ───────────────────── 输入与日志的分隔 ─────────────────────
def test_first_log_after_input_gets_a_blank_line(caplog, capsys) -> None:
    """「输入 → 日志」的边界补一个空行，其它地方不补。"""
    take_input_mark()                      # 先把别处留下的标记清掉
    reporter = LogReporter(logging.getLogger('guanxing.test'))

    with caplog.at_level(logging.INFO):
        reporter.step('设备', 'x')

    assert capsys.readouterr().err == ''   # 没输入过就不空行

    mark_input_done()
    with caplog.at_level(logging.INFO):
        reporter.step('设备', 'y')

    assert capsys.readouterr().err == '\n'  # 刚输入过：先空一行
    assert _records(caplog)[-1] == f'{INDENT}设备: y'

    # 标记一次性消费，不会连续两行日志都空行
    with caplog.at_level(logging.INFO):
        reporter.step('设备', 'z')
    assert capsys.readouterr().err == ''
