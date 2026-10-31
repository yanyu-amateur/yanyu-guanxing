"""错误 → 用户提示的分派（注册表按 isinstance 匹配，从具体到抽象）。

为什么值得测：注册表顺序一旦被改乱，``InvalidFormat`` 这类子类就会被更抽象的规则
先吃掉，用户看到的提示就变成另一件事的——而且不会有任何异常提醒。
"""
from __future__ import annotations

from guanxing.domain.errors import (
    REASON_NEEDS_MEMORY,
    InnerKeyMissing,
    InvalidFormat,
    MemoryReadTimeout,
    OuterKeyUnavailable,
)
from guanxing.interface.cli.messages import render
from guanxing.shared.errors import ADBError, AppError, HarError


def _text(err: AppError) -> str:
    message, hints = render(err)
    return message + '\n' + '\n'.join(hints)


def test_outer_key_with_psw_points_at_dat_db() -> None:
    """已拿到 psw 时唯一的下一步就是给 dat.db，不该再劝去抓包。"""
    text = _text(OuterKeyUnavailable('x', psw_available=True, command='download'))
    assert '--db' in text
    assert 'capture' in text


def test_outer_key_needing_memory_lists_mem_advice() -> None:
    text = _text(OuterKeyUnavailable('x', tag=REASON_NEEDS_MEMORY))
    assert 'root' in text
    assert '重新登录' in text


def test_inner_key_reports_version_and_mentions_capture() -> None:
    text = _text(InnerKeyMissing('00070001', 'android', tried=3))
    assert '00070001' in text
    assert 'capture' in text


def test_invalid_format_gets_format_advice_not_generic() -> None:
    """子类必须命中自己的规则，而不是落到更抽象的基类上。"""
    text = _text(InvalidFormat('坏文件'))
    assert 'capture 要 .har' in text


def test_hints_use_a_command_that_actually_runs() -> None:
    """提示里的命令必须解压即能用，guanxing 与 python -m guanxing 都要先安装。"""
    from guanxing.interface.cli.messages import HINT_CMD

    assert HINT_CMD == 'python run.py'
    for err in (OuterKeyUnavailable('x', command='mem'),
                OuterKeyUnavailable('x', tag=REASON_NEEDS_MEMORY),
                OuterKeyUnavailable('x', psw_available=True),
                OuterKeyUnavailable('x', command='download'),
                InnerKeyMissing('00070001', 'android'),
                InnerKeyMissing('00070001', 'android', table_value='ab12cd34')):
        for hint in render(err)[1]:
            assert '\nguanxing ' not in hint
            assert not hint.lstrip().startswith('guanxing ')
            assert ' python -m guanxing' not in hint


def test_memory_timeout_suggests_retry_not_root() -> None:
    """超时是设备慢，不能给"去开 root"这种错误方向。"""
    text = _text(MemoryReadTimeout('超时'))
    assert 'root' not in text
    assert '重试' in text


def test_har_and_adb_have_their_own_advice() -> None:
    assert 'acc' in _text(HarError('坏 HAR'))
    assert 'adb' in _text(ADBError('连不上'))


def test_plain_app_error_passes_hints_through() -> None:
    message, hints = render(AppError('就这样', hints=['照做']))
    assert message == '就这样'
    assert hints == ['照做']


def test_error_own_hints_come_before_rule_hints() -> None:
    err = InnerKeyMissing('00070001', 'android', extra_hint='内存扫描没能进行：游戏没开')
    _message, hints = render(err)
    assert hints[0].startswith('内存扫描没能进行')


# ───────────────── 内层密钥：缺 vs 有值但不对 ─────────────────
def test_inner_key_missing_says_absent() -> None:
    text = _text(InnerKeyMissing('00070001', 'android', tried=4))
    assert '表里没有' in text
    assert '--inner-key' not in text, '没有值的时候不该建议手填'


def test_inner_key_present_but_wrong_is_a_different_story() -> None:
    """表里有这一版却解不开：不能再劝用户去挖/去抓包（挖也挖不出新东西）。"""
    text = _text(InnerKeyMissing(
        '00070001', 'android', tried=4,
        table_value='ab12cd34', table_source='builtin'))
    assert '表里有' in text
    assert '内置表' in text
    assert '不匹配' in text
    assert '--inner-key' in text          # 有值时才给手填这条路
    assert 'capture' not in text, '不该再劝去抓包'


def test_inner_key_mentions_user_file_when_value_came_from_there() -> None:
    text = _text(InnerKeyMissing(
        '00079999', 'android', tried=2,
        table_value='zz11yy22', table_source='keys.json'))
    assert 'keys.json' in text


def test_inner_key_message_differs_by_table_value() -> None:
    absent = InnerKeyMissing('00070001', 'android').message
    present = InnerKeyMissing('00070001', 'android',
                              table_value='ab12cd34').message
    assert absent != present
    # message 会进控制台与日志文件，psw 只留头尾（见 redact）
    assert 'ab12cd34' not in present
    assert 'ab…34' in present
