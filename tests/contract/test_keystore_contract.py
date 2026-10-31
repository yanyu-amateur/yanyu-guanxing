"""密钥库契约：锁住「新密钥识别不了」这个已修 bug 涉及的四条断言。

内置表永远参与候选且文件只能补充；脏值不得污染表；落盘文件必带 schema_version；
文件里的值不许覆盖内置已收录的版本（唯一例外是运行期真的解开过存档的值）。
"""
from __future__ import annotations

import json
from pathlib import Path

import pytest

from guanxing.domain.keys.resolver import inner_candidates
from guanxing.domain.keys.table import KeyTable
from guanxing.infra.keys.json_store import KeyStoreImpl


def _cands(table: KeyTable, version: str, runtime: str = 'android') -> list[str]:
    """内层候选——统一走 domain 的唯一实现（端口不再重复一套）。"""
    return inner_candidates(table, runtime, version)


def _open_store(tmp_path: Path, keys_text: str, local_text: str = ''):
    keys = tmp_path / 'keys.json'
    local = tmp_path / 'keys.local.json'
    keys.write_text(keys_text, encoding='utf-8')
    local.write_text(local_text, encoding='utf-8')
    table = KeyTable()
    store = KeyStoreImpl(keys, local, table)
    store.load()
    return store, table, keys, local


# ── 1. 内置表不被文件覆盖 ──
def test_dirty_keys_json_keeps_builtin_table(tmp_path) -> None:
    """真实踩过的坑：keys.json 里是 {"android": ""}，结果内置后缀全丢。"""
    _store, table, _keys, _local = _open_store(
        tmp_path,
        '{"channel_suffix_table": {"android": ""}, "version_psw_table": {}}',
    )
    assert 'po06ewkx' in table.channel_suffixes['android']
    assert '' not in table.channel_suffixes['android']
    assert table.version_psw.get('00073440') == 'pon1dxg7'


def test_first_run_without_any_file(tmp_path) -> None:
    """首次运行（两个文件都不存在）不能崩。"""
    table = KeyTable()
    store = KeyStoreImpl(tmp_path / 'k.json', tmp_path / 'l.json', table)
    store.load()
    assert 'po06ewkx' in table.channel_suffixes['android']


def test_empty_local_file_is_ok(tmp_path) -> None:
    """keys.local.json 为 0 字节是常见状态（用户没记过外层密钥）。"""
    store, table, _k, _l = _open_store(tmp_path, '{}', '')
    assert store.outer_candidates('ACC', 'SID') == []
    assert 'po06ewkx' in table.channel_suffixes['android']


# ── 2. 学习新版本 key 并落盘 ──
def test_remember_inner_persists_and_keeps_builtin(tmp_path) -> None:
    store, table, keys, _local = _open_store(tmp_path, '{}')

    assert store.remember_inner('00079999', 'zz11yy22') is True

    on_disk = json.loads(keys.read_text(encoding='utf-8'))
    assert on_disk['schema_version'] >= 2          # 写回时总是带上版本号
    assert on_disk['version_psw_table']['00079999'] == 'zz11yy22'
    # 内置项仍在（写回不能把内置表抹掉）
    assert '00073440' in on_disk['version_psw_table']
    assert 'po06ewkx' in on_disk['channel_suffix_table']['android']
    # 内存里立即可用
    assert 'zz11yy22po06ewkx' in _cands(table, '00079999')


def test_remember_inner_is_idempotent(tmp_path) -> None:
    store, _table, _keys, _local = _open_store(tmp_path, '{}')
    assert store.remember_inner('00079999', 'zz11yy22') is True
    assert store.remember_inner('00079999', 'zz11yy22') is False


def test_remember_inner_rejects_empty(tmp_path) -> None:
    store, _table, _keys, _local = _open_store(tmp_path, '{}')
    assert store.remember_inner('', 'x') is False
    assert store.remember_inner('00070001', '') is False


# ── 2b. 完整内层密钥：psw 与后缀一起学 ──
def test_remember_inner_key_stores_unknown_suffix(tmp_path) -> None:
    """新渠道后缀不在表里时，必须跟着 psw 一起存下来，否则等于白扫。"""
    store, table, keys, _local = _open_store(tmp_path, '{}')
    unknown = 'zq83ndkx'

    assert store.remember_inner_key('00079999', 'zz11yy22' + unknown) is True

    on_disk = json.loads(keys.read_text(encoding='utf-8'))
    assert on_disk['version_psw_table']['00079999'] == 'zz11yy22'
    assert unknown in on_disk['channel_suffix_table']['android']
    assert 'zz11yy22' + unknown in _cands(table, '00079999')
    # 内置项没被抹掉
    assert 'po06ewkx' in table.channel_suffixes['android']


def test_remember_inner_key_keeps_known_suffix_single_copy(tmp_path) -> None:
    store, table, _keys, _local = _open_store(tmp_path, '{}')
    assert store.remember_inner_key('00079999', 'zz11yy22po06ewkx') is True
    assert table.channel_suffixes['android'].count('po06ewkx') == 1
    # 同一个版本再记一遍就是旧值
    assert store.remember_inner_key('00079999', 'zz11yy22po06ewkx') is False


def test_remember_inner_key_accepts_bare_psw(tmp_path) -> None:
    """只有 8 位时按 psw 处理，不能自己编个后缀出来。"""
    store, _table, keys, _local = _open_store(tmp_path, '{}')
    assert store.remember_inner_key('00079999', 'zz11yy22') is True
    on_disk = json.loads(keys.read_text(encoding='utf-8'))
    assert on_disk['version_psw_table']['00079999'] == 'zz11yy22'
    assert store.remember_inner_key('', 'zz11yy22po06ewkx') is False


# ── 3. 外层密钥记忆与去重 ──
def test_outer_candidates_dedup(tmp_path) -> None:
    store, _table, _keys, _local = _open_store(tmp_path, '{}')
    store.remember_outer('ACC', 'k1', 'SID')
    store.remember_outer('ACC', 'k1', 'SID')
    assert store.outer_candidates('ACC', 'SID') == ['k1']


def test_outer_candidates_explicit_first(tmp_path) -> None:
    store, _table, _keys, _local = _open_store(tmp_path, '{}')
    store.remember_outer('ACC', 'k1', 'SID')
    assert store.outer_candidates('ACC', 'SID', 'explicit')[0] == 'explicit'


def test_outer_remember_persists(tmp_path) -> None:
    store, _table, _keys, local = _open_store(tmp_path, '{}')
    store.remember_outer('ACC', 'k1', 'SID')
    on_disk = json.loads(local.read_text(encoding='utf-8'))
    assert 'k1' in on_disk['outer_keys_by_id']['SID']


# ── 4. 内置版本永远有候选 ──
@pytest.mark.parametrize('version', ['00073440', '00073420', '00073314'])
def test_builtin_versions_available(tmp_path, version: str) -> None:
    _store, table, _keys, _local = _open_store(tmp_path, '{}')
    assert _cands(table, version), f'{version} 应有候选'


# ── 5. 内置表与用户表是并集：互不覆盖、互不丢失 ──
BUILTIN_FIXTURE = {'00000001': 'psw00001', '00000003': 'psw00003'}
SUFFIX_FIXTURE = {'android': ['po06ewkx']}


@pytest.fixture()
def builtin_only_1_and_3(monkeypatch):
    """把内置表换成"发版时只有 001 和 003"的样子。"""
    monkeypatch.setattr('guanxing.domain.keys.table.version_psw',
                        lambda: dict(BUILTIN_FIXTURE))
    monkeypatch.setattr('guanxing.domain.keys.table.channel_suffixes',
                        lambda: {k: list(v) for k, v in SUFFIX_FIXTURE.items()})


def test_builtin_and_user_table_are_merged(tmp_path, builtin_only_1_and_3) -> None:
    """内置表与他人分享的文件必须合并成一张表：用户 pull 新版只是内置表多了几版。"""
    keys = tmp_path / 'keys.json'
    keys.write_text(json.dumps({
        'schema_version': 2,
        'channel_suffix_table': {'android': ['po06ewkx']},
        'version_psw_table': {'00000001': 'psw00001', '00000002': 'psw00002'},
    }), encoding='utf-8')

    table = KeyTable()
    store = KeyStoreImpl(keys, tmp_path / 'keys.local.json', table)
    store.load()

    for version in ('00000001', '00000002', '00000003'):
        assert inner_candidates(table, 'android', version), f'{version} 应有候选'
    # 只读加载不该改写用户文件（他没学到新东西）
    assert '00000003' not in keys.read_text(encoding='utf-8')


def test_learning_a_new_version_keeps_everything(tmp_path, builtin_only_1_and_3) -> None:
    """用户在内置 003 的时期又挖到 004，落盘后四版都在，重读也不丢。"""
    keys = tmp_path / 'keys.json'
    keys.write_text(json.dumps({
        'schema_version': 2,
        'channel_suffix_table': {'android': ['po06ewkx']},
        'version_psw_table': {'00000001': 'psw00001', '00000002': 'psw00002'},
    }), encoding='utf-8')

    table = KeyTable()
    store = KeyStoreImpl(keys, tmp_path / 'keys.local.json', table)
    store.load()
    assert store.remember_inner('00000004', 'psw00004') is True

    on_disk = json.loads(keys.read_text(encoding='utf-8'))
    assert {'00000001', '00000002', '00000003', '00000004'} <= set(
        on_disk['version_psw_table'])

    # 换一次运行重新加载，四版仍可用
    table2 = KeyTable()
    store2 = KeyStoreImpl(keys, tmp_path / 'keys.local.json', table2)
    store2.load()
    for version in ('00000001', '00000002', '00000003', '00000004'):
        assert inner_candidates(table2, 'android', version), f'{version} 重读后丢失'


# ── 6. 信任模型：内置表优先，只有验证过的值能覆盖 ──
def _builtin_fixture(monkeypatch, mapping: dict[str, str]) -> None:
    monkeypatch.setattr('guanxing.domain.keys.table.version_psw',
                        lambda: dict(mapping))


def test_file_cannot_override_builtin(tmp_path, monkeypatch) -> None:
    """特殊场景：文件里塞一条错误 psw 顶掉内置已收录的版本。"""
    _builtin_fixture(monkeypatch, {'00000001': 'good0001'})
    keys = tmp_path / 'keys.json'
    keys.write_text(json.dumps({
        'schema_version': 2,
        'channel_suffix_table': {},
        'version_psw_table': {'00000001': 'bad00001'},
    }), encoding='utf-8')

    table = KeyTable()
    store = KeyStoreImpl(keys, tmp_path / 'keys.local.json', table)
    store.load()

    assert table.version_psw['00000001'] == 'good0001', '内置值被文件覆盖了'
    assert table.conflicts == [('00000001', 'good0001', 'bad00001', False)]
    assert any('冲突' in p for p in store.problems)


def test_conflicting_file_is_cleaned_so_warning_does_not_repeat(
        tmp_path, monkeypatch) -> None:
    """冲突清洗：文件被改回内置值，下次启动不再警告。"""
    _builtin_fixture(monkeypatch, {'00000001': 'good0001'})
    keys = tmp_path / 'keys.json'
    keys.write_text(json.dumps({
        'schema_version': 2,
        'channel_suffix_table': {},
        'version_psw_table': {'00000001': 'bad00001'},
    }), encoding='utf-8')

    KeyStoreImpl(keys, tmp_path / 'keys.local.json', KeyTable()).load()
    on_disk = json.loads(keys.read_text(encoding='utf-8'))
    assert on_disk['version_psw_table']['00000001'] == 'good0001'
    assert list(tmp_path.glob('*.bak')), '清洗前必须备份'

    second = KeyStoreImpl(keys, tmp_path / 'keys.local.json', KeyTable())
    second.load()
    assert second.key_table.conflicts == []
    assert second.problems == []


def test_runtime_value_cannot_override_builtin_either(tmp_path, monkeypatch) -> None:
    """内置表是唯一权威，运行期挖到的值也改不动已收录的版本。"""
    _builtin_fixture(monkeypatch, {'00000001': 'good0001'})
    table = KeyTable()
    assert table.add_version_psw('00000001', 'newly0001', from_runtime=True) is False
    assert table.version_psw['00000001'] == 'good0001'
    assert table.conflicts == [('00000001', 'good0001', 'newly0001', True)]


def test_file_value_never_overrides_builtin(tmp_path) -> None:
    table = KeyTable()
    assert table.add_version_psw('00073440', 'badpsw00') is False
    assert table.version_psw['00073440'] == 'pon1dxg7'


def test_non_builtin_version_can_be_overridden(tmp_path) -> None:
    """非内置版本没有"可信基线"，后写者胜（文件补充 / 运行期学到都一样）。"""
    table = KeyTable()
    assert table.add_version_psw('00079999', 'first000') is True
    assert table.add_version_psw('00079999', 'second00') is True
    assert table.version_psw['00079999'] == 'second00'


def test_source_of_reports_where_the_value_came_from() -> None:
    table = KeyTable()
    assert table.source_of('00073440') == 'builtin'
    table.add_version_psw('00079999', 'zz11yy22')
    assert table.source_of('00079999') == 'keys.json'
    assert table.source_of('00000000') == ''
