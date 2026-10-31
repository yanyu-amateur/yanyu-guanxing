"""内置表兜底契约 —— 外部 keys.json 全丢，工具仍然能解已知版本的存档。

这正是 ``domain/keys/builtin_tables.py`` 存在的唯一理由：
它不是一个「默认配置」，而是「文件没了也得能工作」的底线。
"""
from __future__ import annotations

from pathlib import Path

from guanxing.domain.keys import builtin_tables as bt
from guanxing.domain.keys.resolver import inner_candidates
from guanxing.domain.keys.table import KeyTable
from guanxing.domain.save.format import detect_format
from guanxing.domain.save.types import SaveFormatType
from guanxing.infra.keys.json_store import KeyStoreImpl


# ── 拷贝语义：调用方改自己那份，不能污染模块级表 ──
def test_channel_suffixes_returns_independent_copy() -> None:
    first = bt.channel_suffixes()
    first['android'].append('tjunk000')
    first['pc'] = ['nope']
    assert 'tjunk000' not in bt.channel_suffixes()['android']
    assert 'pc' not in bt.BUILTIN_CHANNEL_SUFFIXES


def test_version_psw_returns_independent_copy() -> None:
    first = bt.version_psw()
    first['00073440'] = 'tampered'
    first['99999999'] = 'fake'
    assert bt.version_psw()['00073440'] == 'pon1dxg7'
    assert '99999999' not in bt.BUILTIN_VERSION_PSW


def test_two_key_tables_do_not_share_state() -> None:
    a = KeyTable()
    a.add_version_psw('00073440', 'hacked')
    a.add_channel_suffix('android', 'zzz00000')
    b = KeyTable()
    assert b.version_psw['00073440'] == 'pon1dxg7'
    assert 'zzz00000' not in b.channel_suffixes['android']


# ── 兜底：没有任何外部文件，仍然出得了正确候选 ──
def test_no_external_files_still_yields_inner_key(tmp_path: Path) -> None:
    table = KeyTable()
    store = KeyStoreImpl(tmp_path / 'keys.json', tmp_path / 'keys.local.json', table)
    store.load()                       # 两个文件都不存在
    assert not (tmp_path / 'keys.json').exists()

    candidates = inner_candidates(table, 'android', '00073440')
    assert 'pon1dxg7po06ewkx' in candidates      # 主渠道
    assert 'pon1dxg7meeo0wmk' in candidates      # 次渠道
    assert 'pon1dxg7' in candidates              # 历史空后缀版本


def test_builtin_psw_present_for_every_builtin_version() -> None:
    table = KeyTable()
    for version, psw in bt.BUILTIN_VERSION_PSW.items():
        assert table.version_psw[version] == psw


# ── 外层标记不是"要适配的常量"：本工具不维护名单 ──
def test_marker_is_not_a_table() -> None:
    """标记不参与加解密，所以不该存在任何已知标记表。"""
    assert not hasattr(bt, 'BUILTIN_SAVE_MARKERS')
    assert not hasattr(bt, 'DEFAULT_SAVE_MARKER'), 'DEFAULT_SAVE_MARKER 属于格式常量'


def test_default_marker_lives_with_format_constants() -> None:
    from guanxing.domain.constants import DEFAULT_SAVE_MARKER, SAVE_MARKER_LEN
    assert len(DEFAULT_SAVE_MARKER) == SAVE_MARKER_LEN


def test_any_printable_marker_is_detected() -> None:
    """随便换 8 个字符都要照样识别成新版。"""
    for marker in ('dnkemiea', 'zzzzzzzz', 'Ab3dE7gH', '0000aaaa'):
        content = marker + 'QUJDREVGR0hJSktMTU5PUA=='
        assert detect_format(content) is SaveFormatType.NEW
