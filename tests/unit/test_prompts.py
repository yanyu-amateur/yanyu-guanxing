"""交互原语：任何提问都能用 q 退出（旧工具习惯，不能丢）；提问前要清掉残留按键。"""
from __future__ import annotations

import sys
import types

import pytest

from guanxing.interface.cli.interactive import prompts
from guanxing.interface.cli.interactive.prompts import (
    QUIT_WORDS,
    ask,
    choose,
    confirm,
)
from guanxing.shared.console import take_input_mark
from guanxing.shared.errors import CancelledError


@pytest.mark.parametrize('word', list(QUIT_WORDS))
def test_ask_quits(monkeypatch, word: str) -> None:
    monkeypatch.setattr('builtins.input', lambda *a, **k: word)
    with pytest.raises(CancelledError):
        ask('路径')


# ───────────────────── 残留按键 ─────────────────────
def test_ask_drains_pending_keys_first(monkeypatch) -> None:
    """扫内存时狂按的回车不能替用户回答下一个问题。"""
    drained: list[int] = []
    monkeypatch.setattr(prompts, 'drain_input',
                        lambda: drained.append(1) or 0)
    monkeypatch.setattr('builtins.input', lambda *a, **k: '')
    assert ask('路径', default='abc') == 'abc'
    assert drained == [1]


def test_drain_is_noop_when_stdin_is_not_a_tty() -> None:
    """pytest 的 stdin 不是终端，清空必须什么都不做（否则会吃掉喂进去的数据）。"""
    assert prompts.drain_input() == 0


def test_drain_swallows_broken_tty(monkeypatch) -> None:
    """isatty 自己炸了也只是别清，不能让提问失败。"""
    class BrokenStdin:
        def isatty(self) -> bool:
            raise OSError('boom')

    monkeypatch.setattr(prompts.sys, 'stdin', BrokenStdin())
    assert prompts.drain_input() == 0


def test_drain_windows_counts_dropped_keys(monkeypatch) -> None:
    keys = list('yy\n')
    fake = types.SimpleNamespace(kbhit=lambda: bool(keys),
                                 getwch=lambda: keys.pop(0))
    monkeypatch.setitem(sys.modules, 'msvcrt', fake)

    assert prompts._drain_windows() == 3
    assert keys == []


# ───────────────────── 排版 ─────────────────────
def test_ask_separates_itself_from_logs(monkeypatch, capsys) -> None:
    """提问前必须有空行，否则提问会被当成上一条日志的一部分。"""
    monkeypatch.setattr(prompts, 'drain_input', lambda: 0)
    monkeypatch.setattr('builtins.input', lambda *a, **k: 'x')

    assert ask('路径') == 'x'
    assert capsys.readouterr().out.startswith('\n')


def test_choose_puts_its_own_blank_line(monkeypatch, capsys) -> None:
    """选项列表自己顶上空行，紧跟的"请选择"不该再多一个空行。"""
    monkeypatch.setattr(prompts, 'drain_input', lambda: 0)
    monkeypatch.setattr('builtins.input', lambda *a, **k: '1')

    choose('选一个', ['a', 'b'])
    out = capsys.readouterr().out
    assert out.startswith('\n选一个\n')
    assert '0) 返回' in out


def test_choose_zero_label_is_per_call(monkeypatch, capsys) -> None:
    """0 号选项的含义各处不同（返回 / 导入新的），标签必须跟着调用点走。"""
    monkeypatch.setattr(prompts, 'drain_input', lambda: 0)
    monkeypatch.setattr('builtins.input', lambda *a, **k: '0')

    assert choose('已导入的存档', ['a'], default=0,
                  zero_label='导入新的存档') == 0
    out = capsys.readouterr().out
    assert '0) 导入新的存档' in out
    assert '0) 返回' not in out, '标题说"导入新的"，0 号就不能写"返回"'


def test_input_marks_but_does_not_blank(monkeypatch, capsys) -> None:
    """输完不马上空行，只记下「刚输入过」，空行由下一条日志自己补。"""
    take_input_mark()
    monkeypatch.setattr(prompts, 'drain_input', lambda: 0)
    monkeypatch.setattr('builtins.input', lambda *a, **k: 'x')

    ask('路径')
    assert capsys.readouterr().out == '\n'      # 只有提问前那一个空行
    assert take_input_mark() is True


def test_inner_ask_does_not_blank(monkeypatch, capsys) -> None:
    """紧跟在选项列表后面的提问（inner=True）不再顶空行。"""
    take_input_mark()
    monkeypatch.setattr(prompts, 'drain_input', lambda: 0)
    monkeypatch.setattr('builtins.input', lambda *a, **k: 'x')

    ask('请选择', inner=True)
    assert capsys.readouterr().out == ''


@pytest.mark.parametrize('word', ['Q', 'QUIT', 'Exit', '  退出  '])
def test_quit_is_case_and_space_insensitive(monkeypatch, word: str) -> None:
    monkeypatch.setattr('builtins.input', lambda *a, **k: word)
    with pytest.raises(CancelledError):
        ask('路径')


def test_choose_quits(monkeypatch) -> None:
    monkeypatch.setattr('builtins.input', lambda *a, **k: 'q')
    with pytest.raises(CancelledError):
        choose('选一个', ['a', 'b'])


def test_confirm_quits(monkeypatch) -> None:
    monkeypatch.setattr('builtins.input', lambda *a, **k: 'q')
    with pytest.raises(CancelledError):
        confirm('继续？')


def test_empty_input_uses_default(monkeypatch) -> None:
    monkeypatch.setattr('builtins.input', lambda *a, **k: '')
    assert ask('路径', default='abc') == 'abc'
    assert confirm('继续？', default=True) is True


def test_choose_reprompts_on_garbage(monkeypatch) -> None:
    answers = iter(['x', '99', '2'])
    monkeypatch.setattr('builtins.input', lambda *a, **k: next(answers))
    assert choose('选一个', ['a', 'b']) == 2
