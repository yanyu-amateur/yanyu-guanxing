"""内层密钥候选顺序单测（纯函数，无 IO）。"""
from __future__ import annotations

from guanxing.domain.keys.resolver import inner_candidates, suffix_order
from guanxing.domain.keys.table import KeyTable


def test_suffix_order_prefers_current_runtime() -> None:
    order = suffix_order(KeyTable(), 'android')
    assert order[0] == 'po06ewkx'
    assert 'yoqkmrtj' in order, '其它平台应作为跨渠道兜底出现'


def test_explicit_comes_first() -> None:
    cands = inner_candidates(KeyTable(), 'android', '00073440', explicit='ZZZZ')
    assert cands[0] == 'ZZZZ'


def test_unknown_version_yields_nothing() -> None:
    assert inner_candidates(KeyTable(), 'android', '00000000') == []


def test_overlay_rescues_unrecorded_version() -> None:
    """从 HAR 学到 psw（已并表但没落盘）时，表里的值必须能顶上 —— 降级路径的关键。"""
    table = KeyTable()
    table.add_version_psw('00070001', 'ab12cd34')     # remember_inner 落盘失败时的形态
    cands = inner_candidates(table, 'android', '00070001')
    assert 'ab12cd34po06ewkx' in cands
    assert 'ab12cd34' in cands


def test_dirty_values_are_ignored() -> None:
    table = KeyTable()
    table.add_channel_suffix('android', '')
    table.add_channel_suffix('android', None)          # type: ignore[arg-type]
    table.add_version_psw('0001', '')
    assert '' not in table.channel_suffixes['android']
    assert '0001' not in table.version_psw


def test_duplicate_suffix_not_added_twice() -> None:
    table = KeyTable()
    before = len(table.channel_suffixes['android'])
    table.add_channel_suffix('android', 'po06ewkx')
    assert len(table.channel_suffixes['android']) == before
