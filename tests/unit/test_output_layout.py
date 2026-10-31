"""输出布局：目录规则（时间戳、不撞名改名）与缓存清理。"""
from __future__ import annotations

from datetime import datetime
from pathlib import Path

from guanxing.application.services.output_layout import OutputLayout
from guanxing.application.usecases import device_saves as ds
from guanxing.infra.fs.local import FileSystemImpl
from tests.support import RecordingProgress

MOMENT = datetime(2026, 1, 1, 0, 0, 0)


def _layout() -> OutputLayout:
    return OutputLayout(FileSystemImpl(), RecordingProgress())


def test_snapshot_dir_is_group_then_stamp(tmp_path: Path) -> None:
    snap = _layout().make_snapshot_dir(
        tmp_path, runtime='android', server=1, nick='测试角色', moment=MOMENT,
    )
    assert snap == tmp_path / 'android-s1-测试角色' / '20260101-000000'
    assert snap.is_dir()


def test_same_timestamp_reuses_the_same_dir(tmp_path: Path) -> None:
    """跟旧工具一致：不追加 -2/-3，同一秒就是同一个目录。"""
    layout = _layout()
    first = layout.make_snapshot_dir(
        tmp_path, runtime='android', server=1, nick='测试角色', moment=MOMENT)
    second = layout.make_snapshot_dir(
        tmp_path, runtime='android', server=1, nick='测试角色', moment=MOMENT)
    assert first == second


def test_override_name_wins(tmp_path: Path) -> None:
    snap = _layout().make_snapshot_dir(
        tmp_path, runtime='android', server=1, nick='x', override='custom',
        moment=MOMENT,
    )
    assert snap.parent.name == 'custom'


def test_write_all_creates_three_files(tmp_path: Path) -> None:
    layout = _layout()
    snap = layout.make_snapshot_dir(
        tmp_path, runtime='android', server=1, nick='测试角色', moment=MOMENT)
    written = layout.write_all(snap, data={'a': 1}, meta={'m': 1},
                               report_text='report')
    assert set(written) == {'json', 'meta', 'report'}
    assert (snap / 'dat.json').is_file()
    assert (snap / 'dat.meta.json').is_file()
    assert (snap / 'dat.report.md').is_file()


def test_discard_removes_pulled_file(tmp_path: Path) -> None:
    pulled = tmp_path / '_cache' / 'x.db'
    pulled.parent.mkdir(parents=True)
    pulled.write_bytes(b'x')

    ds.discard(pulled, progress=RecordingProgress())

    assert not pulled.exists()
    assert not pulled.parent.exists()          # 空目录一起清掉


def test_discard_is_silent_when_missing(tmp_path: Path) -> None:
    ds.discard(tmp_path / 'nope.db', progress=RecordingProgress())           # 不抛
