"""keys.json 与 keys.local.json 的版本号与迁移，锁住三类断言。

1.1 的 inner_keys 能拆成 psw 与后缀两张表、outer_keys 能并成 outer_keys_by_acc 列表；
升级前一定先备份，备份失败就不写；文件损坏或版本过新时一个字都不许写。
"""
from __future__ import annotations

import json
from pathlib import Path

import pytest

from guanxing.domain.keys.resolver import inner_candidates
from guanxing.domain.keys.table import KeyTable
from guanxing.infra.keys.json_store import KeyStoreImpl
from guanxing.infra.keys.migrate import (
    CURRENT_SCHEMA,
    LOCAL_SCHEMA,
    migrate,
    migrate_local,
    split_inner_key,
)
from guanxing.shared.errors import KeysFileTooNew

# 1.1 工具的格式（tool_1.1/keys.json 的形状，只留几条代表性的）
LEGACY = {
    '_说明': ['内层密钥表'],
    'inner_keys': [
        {'runtime': 'android', 'version': '00070002', 'key': 'ab12cd34SUFIX001'},
        # 1.1 里 psw 与后缀并非严格按 runtime 归属：这条标 ios 却带安卓后缀
        {'runtime': 'ios', 'version': '00070004', 'key': 'cd34ef56SUFIX001'},
        # 这条的后缀是 test_server 的
        {'runtime': 'android', 'version': '00070003', 'key': 'ef56gh78cgkmi4cq'},
        {'runtime': 'ios', 'version': '00070005', 'key': 'gh78ij90yoqkmrtj'},
    ],
}


def _write(path: Path, doc: object) -> Path:
    path.write_text(json.dumps(doc, ensure_ascii=False), encoding='utf-8')
    return path


def _open(tmp_path: Path, doc: object):
    keys = _write(tmp_path / 'keys.json', doc)
    table = KeyTable()
    store = KeyStoreImpl(keys, tmp_path / 'keys.local.json', table)
    store.load()
    return store, table, keys


# ───────────────────── 纯函数：拆分与合并 ─────────────────────
def test_split_inner_key() -> None:
    assert split_inner_key('ab12cd34SUFIX001') == ('ab12cd34', 'SUFIX001')


def test_split_inner_key_accepts_bare_psw() -> None:
    assert split_inner_key('ab12cd34') == ('ab12cd34', '')


@pytest.mark.parametrize('bad', ['', 'short', '\x00' * 8, 'abc\x01def'])
def test_split_inner_key_rejects_garbage(bad: str) -> None:
    assert split_inner_key(bad) == ('', '')


def test_split_inner_key_falls_back_to_psw_when_suffix_is_dirty() -> None:
    """16 位但后缀不可用时只留 psw —— 聊胜于无，且不会把脏后缀写进表。"""
    assert split_inner_key('ab12cd34 po06ewk') == ('ab12cd34', '')


def test_split_inner_key_strips_surrounding_whitespace() -> None:
    assert split_inner_key('  ab12cd34SUFIX001\n') == ('ab12cd34', 'SUFIX001')


def test_migrate_splits_legacy_inner_keys() -> None:
    result = migrate(LEGACY)
    assert result.from_version == 0
    assert result.changed
    assert result.absorbed_legacy
    data = result.data
    assert data['schema_version'] == CURRENT_SCHEMA
    assert data['version_psw_table']['00070002'] == 'ab12cd34'
    assert data['version_psw_table']['00070003'] == 'ef56gh78'
    # 后缀按条目里的 runtime 归类，但同一个后缀不会在两张渠道下重复出现
    assert 'SUFIX001' in data['channel_suffix_table']['android']
    assert 'SUFIX001' not in data['channel_suffix_table'].get('ios', [])
    assert 'cgkmi4cq' in data['channel_suffix_table']['android']
    assert 'yoqkmrtj' in data['channel_suffix_table']['ios']


def test_migrate_does_not_duplicate_known_suffixes() -> None:
    """内置表已认识的后缀，不再按 1.1 条目的 runtime 在另一张渠道下重复登记。"""
    result = migrate(LEGACY, known_suffixes={
        'android': ['SUFIX001'], 'test_server': ['cgkmi4cq'],
    })
    assert result.data['channel_suffix_table'] == {'ios': ['yoqkmrtj']}
    # psw 该收的仍然收全
    assert set(result.data['version_psw_table'].values()) == {
        'ab12cd34', 'cd34ef56', 'ef56gh78', 'gh78ij90'}


def test_migrate_keeps_existing_psw_on_conflict() -> None:
    """文件里已有的 psw 是用户自己跑出来的，比 1.1 的旧表更可信。"""
    doc = dict(LEGACY)
    doc['version_psw_table'] = {'00070002': 'newpsw00'}
    result = migrate(doc)
    assert result.data['version_psw_table']['00070002'] == 'newpsw00'
    assert any('冲突' in n for n in result.notes)


def test_migrate_adds_version_to_v1_file() -> None:
    """无版本号但已有两张表（重构后首个格式）：只补版本号，内容不动。"""
    doc = {'channel_suffix_table': {'android': ['SUFIX001']},
           'version_psw_table': {'00070001': 'ab12cd34'}}
    result = migrate(doc)
    assert result.from_version == 0
    assert result.changed
    assert not result.absorbed_legacy
    assert result.data['version_psw_table'] == {'00070001': 'ab12cd34'}


def test_migrate_current_version_is_noop() -> None:
    doc = {'schema_version': CURRENT_SCHEMA,
           'channel_suffix_table': {'android': ['SUFIX001']},
           'version_psw_table': {'00070001': 'ab12cd34'}}
    result = migrate(doc)
    assert not result.changed
    assert result.notes == ()


def test_migrate_refuses_newer_schema() -> None:
    with pytest.raises(KeysFileTooNew):
        migrate({'schema_version': CURRENT_SCHEMA + 1, 'version_psw_table': {}})


def test_migrate_drops_unknown_fields_with_a_note() -> None:
    result = migrate({'schema_version': CURRENT_SCHEMA, 'whatever': {'a': 1}})
    assert 'whatever' not in result.data
    assert any('whatever' in n for n in result.notes)


def test_migrate_ignores_dirty_values() -> None:
    doc = {'channel_suffix_table': {'android': ''},
           'version_psw_table': {'00070001': None}}
    result = migrate(doc)
    assert result.data['channel_suffix_table'] == {}
    assert result.data['version_psw_table'] == {}


# ───────────────────── keys.local.json 的迁移 ─────────────────────
# 1.1 工具的形状（tool_1.1/keys.local.json，账号与密钥是合成值）
LEGACY_LOCAL = {
    '_说明': ['外层密钥表'],
    'adb': r'C:\tools\platform-tools\adb.exe',
    'serial': '127.0.0.1:7555',
    'pkg': 'com.example.game',
    'outer_keys': {
        'acc000001@example.com': 'aaaabbbbccccdddd',
        'ACC0000000000000000000000000001': 'eeeEffffgggghhhh',
    },
    'outer_keys_by_id': {
        '0123456789abcdef0123456789abcdef': 'aaaabbbbccccdddd',
        'fedcba9876543210fedcba9876543210': 'iiiijjjjkkkkllll',
    },
}


def test_migrate_local_renames_outer_keys() -> None:
    """1.1 叫 outer_keys、值是单个字符串；新版叫 outer_keys_by_acc、值是列表。"""
    result = migrate_local(LEGACY_LOCAL)
    assert result.from_version == 0
    assert result.changed
    assert result.merged_legacy
    assert result.data['outer_keys_by_acc'] == {
        'acc000001@example.com': ['aaaabbbbccccdddd'],
        'ACC0000000000000000000000000001': ['eeeEffffgggghhhh'],
    }
    assert 'outer_keys' not in result.data


def test_migrate_local_keeps_env_fields() -> None:
    """adb / serial / pkg 是"这台机器"的配置，迁移后必须还在（新版也读它们）。"""
    result = migrate_local(LEGACY_LOCAL)
    assert result.env == {'adb': r'C:\tools\platform-tools\adb.exe',
                          'serial': '127.0.0.1:7555',
                          'pkg': 'com.example.game'}
    assert result.data['adb'] == r'C:\tools\platform-tools\adb.exe'


def test_migrate_local_merges_when_both_names_exist() -> None:
    """两个键同时存在时按账号合并去重，谁在前不影响"每把都会试一遍"。"""
    doc = {'schema_version': LOCAL_SCHEMA,
           'outer_keys_by_acc': {'ACC': ['kkkkkkkkkkkkkkkk']},
           'outer_keys': {'ACC': 'kkkkkkkkkkkkkkkk', 'ACC2': 'llllllllllllllll'}}
    result = migrate_local(doc)
    assert result.data['outer_keys_by_acc'] == {
        'ACC': ['kkkkkkkkkkkkkkkk'],
        'ACC2': ['llllllllllllllll'],
    }
    assert result.changed, '合并过就要重写，否则下次启动还会再合一遍'


def test_migrate_local_current_is_noop() -> None:
    doc = {'schema_version': LOCAL_SCHEMA,
           'outer_keys_by_acc': {'ACC': ['kkkkkkkkkkkkkkkk']},
           'outer_keys_by_id': {},
           'adb': 'x'}
    result = migrate_local(doc)
    assert not result.changed
    assert result.notes == ()


def test_migrate_local_refuses_newer_schema() -> None:
    with pytest.raises(KeysFileTooNew):
        migrate_local({'schema_version': LOCAL_SCHEMA + 1})


def test_migrate_local_drops_unknown_fields_with_a_note() -> None:
    result = migrate_local({'schema_version': LOCAL_SCHEMA, 'whatever': 1})
    assert 'whatever' not in result.data
    assert any('whatever' in n for n in result.notes)


def test_migrate_local_ignores_dirty_values() -> None:
    doc = {'outer_keys': {'': 'k', 'ACC': ''},
           'outer_keys_by_id': {'SID': [None, '  ', 'kkkkkkkkkkkkkkkk']},
           'adb': '   '}
    result = migrate_local(doc)
    assert result.data['outer_keys_by_acc'] == {}
    assert result.data['outer_keys_by_id'] == {'SID': ['kkkkkkkkkkkkkkkk']}
    assert 'adb' not in result.data, '空白值不该写回文件'


# ───────────── keys.local.json 的整体行为（加载 / 备份 / 落盘） ─────────────
def _open_local(tmp_path: Path, doc: object):
    """只关心 keys.local.json：keys.json 给个空的，别让它干扰。"""
    local = _write(tmp_path / 'keys.local.json', doc)
    keys = _write(tmp_path / 'keys.json', {})
    table = KeyTable()
    store = KeyStoreImpl(keys, local, table)
    store.load()
    return store, table, local


def test_legacy_local_file_becomes_usable(tmp_path: Path) -> None:
    store, _table, local = _open_local(tmp_path, LEGACY_LOCAL)

    assert store.outer_candidates('acc000001@example.com', None) == ['aaaabbbbccccdddd']
    assert store.outer_candidates(None, 'fedcba9876543210fedcba9876543210') == [
        'iiiijjjjkkkkllll']

    on_disk = json.loads(local.read_text(encoding='utf-8'))
    assert on_disk['schema_version'] == LOCAL_SCHEMA
    assert 'outer_keys' not in on_disk
    assert on_disk['outer_keys_by_acc']['acc000001@example.com'] == ['aaaabbbbccccdddd']


def test_legacy_local_file_is_backed_up_first(tmp_path: Path) -> None:
    _store, _table, local = _open_local(tmp_path, LEGACY_LOCAL)
    backup = local.with_name(f'{local.name}.v0.bak')
    assert backup.is_file()
    assert json.loads(backup.read_text(encoding='utf-8')) == LEGACY_LOCAL


def test_local_env_survives_a_rewrite(tmp_path: Path) -> None:
    """迁移之后一旦要落盘（记了新密钥），1.1 写进去的 adb 路径不能跟着丢。"""
    store, _table, local = _open_local(tmp_path, LEGACY_LOCAL)
    assert store.remember_outer('NEWACC', 'mmmmnnnnoooopppp', 'NEWSID') is True
    on_disk = json.loads(local.read_text(encoding='utf-8'))
    assert on_disk['adb'] == LEGACY_LOCAL['adb']
    assert on_disk['serial'] == LEGACY_LOCAL['serial']
    assert on_disk['pkg'] == LEGACY_LOCAL['pkg']
    assert on_disk['outer_keys_by_id']['NEWSID'] == ['mmmmnnnnoooopppp']


def test_second_local_load_does_not_rewrite(tmp_path: Path) -> None:
    _, _, local = _open_local(tmp_path, LEGACY_LOCAL)
    after_first = local.read_text(encoding='utf-8')

    store2 = KeyStoreImpl(local.with_name('keys.json'), local, KeyTable())
    store2.load()
    assert store2.notes == []
    assert local.read_text(encoding='utf-8') == after_first


def test_missing_local_file_keeps_persistence_on(tmp_path: Path) -> None:
    """没有 keys.local.json 是首次运行的正常状态，不能因此关掉落盘。"""
    keys = _write(tmp_path / 'keys.json', {})
    local = tmp_path / 'keys.local.json'
    store = KeyStoreImpl(keys, local, KeyTable())
    store.load()

    assert store.persist_local is True
    assert not local.exists(), '不该为了迁移凭空造出文件'
    assert store.remember_outer('ACC', 'kkkkkkkkkkkkkkkk') is True
    assert json.loads(local.read_text(encoding='utf-8'))['schema_version'] == LOCAL_SCHEMA


def test_broken_local_file_is_never_overwritten(tmp_path: Path) -> None:
    local = tmp_path / 'keys.local.json'
    local.write_text('{"outer_keys": {', encoding='utf-8')      # 半个 JSON
    keys = _write(tmp_path / 'keys.json', {})

    store = KeyStoreImpl(keys, local, KeyTable())
    store.load()

    assert store.persist_local is False
    assert any('不是合法 JSON' in p for p in store.problems)
    assert store.remember_outer('ACC', 'kkkkkkkkkkkkkkkk') is False
    assert local.read_text(encoding='utf-8') == '{"outer_keys": {'


def test_too_new_local_file_is_never_overwritten(tmp_path: Path) -> None:
    before = {'schema_version': LOCAL_SCHEMA + 1, 'outer_keys_by_acc': {}}
    _store, _table, local = _open_local(tmp_path, before)
    assert local.read_text(encoding='utf-8') == json.dumps(before, ensure_ascii=False)


# ───────────────────── 与 KeyStore 的集成 ─────────────────────
def test_legacy_file_becomes_usable_keys(tmp_path: Path) -> None:
    _store, table, keys = _open(tmp_path, LEGACY)

    # 迁移后立刻就能解出内层密钥
    assert 'ab12cd34SUFIX001' in inner_candidates(table, 'android', '00070002')
    # 文件已被改写成 v2
    on_disk = json.loads(keys.read_text(encoding='utf-8'))
    assert on_disk['schema_version'] == CURRENT_SCHEMA
    assert 'inner_keys' not in on_disk


def test_upgrade_backs_up_the_original(tmp_path: Path) -> None:
    _store, _table, keys = _open(tmp_path, LEGACY)
    backup = keys.with_name(f'{keys.name}.v0.bak')
    assert backup.is_file()
    original = json.loads(backup.read_text(encoding='utf-8'))
    assert original['inner_keys'], '备份里必须是迁移前的原样内容'


def test_second_load_does_not_rewrite(tmp_path: Path) -> None:
    _, _, keys = _open(tmp_path, LEGACY)
    after_first = keys.read_text(encoding='utf-8')

    store2 = KeyStoreImpl(keys, tmp_path / 'keys.local.json', KeyTable())
    store2.load()
    assert store2.notes == []
    assert keys.read_text(encoding='utf-8') == after_first


def test_broken_file_is_never_overwritten(tmp_path: Path) -> None:
    """坏文件时只读：内置表照常可用，但 remember_* 不许落盘把它抹掉。"""
    keys = tmp_path / 'keys.json'
    keys.write_text('{"version_psw_table": {', encoding='utf-8')     # 半个 JSON

    store = KeyStoreImpl(keys, tmp_path / 'keys.local.json', KeyTable())
    store.load()

    assert store.persist is False
    assert any('不是合法 JSON' in n for n in store.problems)
    assert store.remember_inner('00079999', 'zz11yy22') is False
    assert keys.read_text(encoding='utf-8') == '{"version_psw_table": {'   # 原样保留


def test_too_new_file_is_never_overwritten(tmp_path: Path) -> None:
    keys = _write(tmp_path / 'keys.json',
                  {'schema_version': CURRENT_SCHEMA + 5,
                   'version_psw_table': {'00070001': 'ab12cd34'}})
    before = keys.read_text(encoding='utf-8')

    store = KeyStoreImpl(keys, tmp_path / 'keys.local.json', KeyTable())
    store.load()

    assert store.persist is False
    assert store.problems, '版本过新必须作为 problem 报出来'
    assert store.remember_inner('00079999', 'zz11yy22') is False
    assert keys.read_text(encoding='utf-8') == before


def test_first_run_does_not_create_the_file(tmp_path: Path) -> None:
    """首次运行（没有 keys.json）风格同前：只在真的学到东西时才落盘。"""
    keys = tmp_path / 'keys.json'
    store = KeyStoreImpl(keys, tmp_path / 'keys.local.json', KeyTable())
    store.load()
    assert not keys.exists()
    assert store.remember_inner('00079999', 'zz11yy22') is True
    assert json.loads(keys.read_text(encoding='utf-8'))['schema_version'] == CURRENT_SCHEMA


def test_backup_conflict_gets_a_timestamp(tmp_path: Path) -> None:
    """已经有一份 v0 备份时不覆盖它，另存带时间戳的。"""
    keys = _write(tmp_path / 'keys.json', LEGACY)
    stale = keys.with_name(f'{keys.name}.v0.bak')
    stale.write_text('old backup', encoding='utf-8')

    _open(tmp_path, LEGACY)
    assert stale.read_text(encoding='utf-8') == 'old backup'
    assert len(list(tmp_path.glob('keys.json.v0-*.bak'))) == 1
