"""历史快照枚举（入口向导用来列出已导入存档）。"""
from __future__ import annotations

import json
from pathlib import Path

from guanxing.application.services.snapshots import (
    Snapshot,
    list_snapshots,
    load_plain_save,
)
from guanxing.infra.fs.local import FileSystemImpl


def _make(root: Path, group: str, stamp: str, meta: dict, data: dict | None = None) -> Path:
    d = root / group / stamp
    d.mkdir(parents=True, exist_ok=True)
    (d / 'dat.meta.json').write_text(json.dumps(meta, ensure_ascii=False), encoding='utf-8')
    if data is not None:
        (d / 'dat.json').write_text(json.dumps(data, ensure_ascii=False), encoding='utf-8')
    return d


def test_sorted_by_stamp_desc(tmp_path: Path) -> None:
    fs = FileSystemImpl()
    _make(tmp_path, 'android-s1-A', '20260101-000000', {'nick': 'A', 'version': '00070002'})
    _make(tmp_path, 'android-s1-B', '20260202-000000', {'nick': 'B', 'version': '00070001'})
    rows = list_snapshots(fs, tmp_path)
    assert [s.nick for s in rows] == ['B', 'A']


def test_skips_dir_without_meta(tmp_path: Path) -> None:
    fs = FileSystemImpl()
    (tmp_path / 'g' / 'junk').mkdir(parents=True)
    _make(tmp_path, 'g', 'ok', {'nick': 'A'})
    assert [s.stamp for s in list_snapshots(fs, tmp_path)] == ['ok']


def test_tolerates_broken_meta(tmp_path: Path) -> None:
    fs = FileSystemImpl()
    d = tmp_path / 'g' / 'broken'
    d.mkdir(parents=True)
    (d / 'dat.meta.json').write_text('{not json', encoding='utf-8')
    assert list_snapshots(fs, tmp_path) == []


def test_missing_out_dir(tmp_path: Path) -> None:
    assert list_snapshots(FileSystemImpl(), tmp_path / 'nope') == []


def test_skips_private_dirs_like_cache(tmp_path: Path) -> None:
    """``_cache`` 是工具自己的临时目录（放拉回来的 dat.db），不是存档。"""
    fs = FileSystemImpl()
    _make(tmp_path, '_cache', '20260101-000000', {'nick': 'tmp'})
    _make(tmp_path, 'android-s1-A', '20260101-000000', {'nick': 'A'})
    assert [s.nick for s in list_snapshots(fs, tmp_path)] == ['A']


def test_limit(tmp_path: Path) -> None:
    fs = FileSystemImpl()
    for i in range(5):
        _make(tmp_path, 'g', f'2026010{i}-000000', {'nick': str(i)})
    assert len(list_snapshots(fs, tmp_path, limit=3)) == 3


def test_load_plain_save(tmp_path: Path) -> None:
    fs = FileSystemImpl()
    _make(tmp_path, 'g', 's1', {'nick': 'A'}, {'MainRole': {'Name': 'A'}})
    row = list_snapshots(fs, tmp_path)[0]
    assert load_plain_save(fs, row) == {'MainRole': {'Name': 'A'}}


def test_load_plain_save_missing_file(tmp_path: Path) -> None:
    fs = FileSystemImpl()
    _make(tmp_path, 'g', 's1', {'nick': 'A'})
    row = list_snapshots(fs, tmp_path)[0]
    assert load_plain_save(fs, row) is None


def test_snapshot_label_contains_key_fields() -> None:
    snap = Snapshot(directory=Path('/x/android-s1-nick/20260101-000000'),
                    meta={'nick': '测试角色', 'version': '00070001', 'field_count': 221})
    text = snap.label()
    assert '测试角色' in text and '00070001' in text and '221' in text
    assert '1)' not in text, '序号由 choose() 统一加，label 不该自带'
