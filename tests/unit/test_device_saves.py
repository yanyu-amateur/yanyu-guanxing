"""从模拟器取 dat.db 的用例（假网关，不碰 adb）。"""
from __future__ import annotations

import os
import time
from datetime import datetime
from pathlib import Path

import pytest

from guanxing.application import packs
from guanxing.application.ports.device import DeviceInfo, RemoteFile
from guanxing.application.usecases import device_saves as ds
from guanxing.domain.save import naming
from guanxing.shared.errors import AppError
from tests.support import RecordingProgress


class FakeDevice:
    def __init__(self, devices=(), saves=(), fail_pull=False, by_package=None) -> None:
        self._devices = list(devices)
        self._saves = list(saves)
        self.fail_pull = fail_pull
        self.by_package = dict(by_package or {})
        self.detected: list[str] = list(self.by_package)
        self.asked: list[str] = []
        self.pulled: list[tuple[str, Path]] = []

    def devices(self):
        return self._devices

    def find_saves(self, package):
        self.asked.append(package)
        if self.by_package:
            return self.by_package.get(package, [])
        return self._saves

    def detect_save_packages(self):
        return self.detected

    def pull(self, remote, local):
        if self.fail_pull:
            raise AppError('pull 失败')
        local = Path(local)
        local.parent.mkdir(parents=True, exist_ok=True)
        local.write_bytes(b'x' * 32)
        self.pulled.append((remote, local))
        return local


def _device(gateway) -> packs.DeviceStack:
    return packs.DeviceStack(open_device=lambda **_kw: gateway,
                             use_serial=lambda _serial: None)


def _storage(cache_dir: Path) -> packs.StorageStack:
    return packs.StorageStack(
        fs=object(),
        layout=object(),
        open_savedb=lambda _p: object(),
        open_capture=lambda _p: object(),
        cache_dir=cache_dir,
        clock=lambda: datetime(2026, 10, 30, 12, 0, 0),
    )


def test_list_devices_reports_when_none(tmp_path: Path) -> None:
    with pytest.raises(AppError) as err:
        ds.list_devices(_device(FakeDevice()))
    assert '没有检测到模拟器' in err.value.message


def test_list_saves_reports_package_in_message(tmp_path: Path) -> None:
    device = _device(FakeDevice(devices=[DeviceInfo('emulator-5554')]))
    with pytest.raises(AppError) as err:
        ds.list_saves(device, serial='emulator-5554', package='com.x',
                      progress=RecordingProgress())
    assert 'com.x' in err.value.message


def test_pull_save_writes_into_cache_dir(tmp_path: Path) -> None:
    gateway = FakeDevice()
    remote = RemoteFile(path='/data/x/dat.db', size=32, mtime='01-01 00:00')

    local = ds.pull_save(_device(gateway), _storage(tmp_path), serial='emulator-5554',
                         remote=remote, package='com.example.game',
                         progress=RecordingProgress())

    assert local.parent == tmp_path
    assert local.name == '20261030-120000-com.example.game.db'
    assert local.exists()
    assert gateway.pulled == [(remote.path, local)]


def test_newest_save_prefers_first(tmp_path: Path) -> None:
    """list_saves 已按修改时间倒序，调用方直接取 [0]（不再包一层 newest_save）。"""
    older = RemoteFile('/a/dat.db', 1, mtime_epoch=100.0)
    newer = RemoteFile('/b/dat.db', 2, mtime_epoch=200.0)
    files = sorted([older, newer], key=lambda f: f.sort_key(), reverse=True)
    assert files[0] is newer


# ───────────── 临时区：失败/中断留下的 dat.db 不能越积越多 ─────────────
def _age(path: Path, seconds: int) -> None:
    """把文件的修改时间往前拨，模拟"放了很久的残骸"。"""
    stamp = time.time() - seconds
    os.utime(path, (stamp, stamp))


def test_purge_cache_removes_stale_db_files(tmp_path: Path) -> None:
    old1 = tmp_path / '20260101-010101-com.a.db'
    old2 = tmp_path / '20260101-020202-com.b.db'
    for p in (old1, old2):
        p.write_bytes(b'x')
        _age(p, ds.CACHE_KEEP_SEC + 60)
    keep = tmp_path / '别删我.txt'
    keep.write_text('x', encoding='utf-8')
    user_db = tmp_path / 'someone-elses.db'      # 不是本工具的命名，绝不能删
    user_db.write_bytes(b'x')
    _age(user_db, ds.CACHE_KEEP_SEC + 60)

    assert ds.purge_cache(tmp_path, progress=RecordingProgress()) == 2
    assert not old1.exists() and not old2.exists()
    assert keep.exists() and user_db.exists(), '只清本工具自己的、且放久了的临时档'


def test_purge_cache_keeps_fresh_files(tmp_path: Path) -> None:
    """失败提示让用户马上去看那份档，刚生成的一天内不许删。"""
    fresh = tmp_path / '20260101-010101-com.a.db'
    fresh.write_bytes(b'x')

    assert ds.purge_cache(tmp_path, progress=RecordingProgress()) == 0
    assert fresh.exists()


def test_purge_cache_is_noop_when_dir_missing(tmp_path: Path) -> None:
    assert ds.purge_cache(tmp_path / 'nope', progress=RecordingProgress()) == 0


def test_pull_save_purges_previous_leftovers(tmp_path: Path) -> None:
    """拉取前清一次放久了的残骸：用户连续失败几次也不会留下几十 MB。"""
    stale = tmp_path / '20260101-010101-com.a.db'
    stale.write_bytes(b'x' * 100)
    _age(stale, ds.CACHE_KEEP_SEC + 60)
    remote = RemoteFile(path='/data/x/dat.db', size=32, mtime='01-01 00:00')

    local = ds.pull_save(_device(FakeDevice()), _storage(tmp_path),
                         serial='emulator-5554', remote=remote,
                         progress=RecordingProgress())

    assert local.exists()
    assert sorted(p.name for p in tmp_path.glob('*.db')) == [local.name]


@pytest.mark.parametrize('path,expected', [
    ('/data/data/pkg/files/acc/server1/dat.db', '1'),
    ('/data/data/pkg/files/acc/server2/dat.db', '2'),
    ('/data/data/pkg/files/acc/other/dat.db', ''),
    ('dat.db', ''),
])
def test_server_of_reads_folder_name(path: str, expected: str) -> None:
    """区服只在设备路径里（``server1``），content 里没有。"""
    assert naming.server_of(path) == expected


@pytest.mark.parametrize('path,expected', [
    ('/data/data/com.x/files/acc/server1/dat.db', 'com.x'),
    ('/data/user/0/com.y/files/acc/server2/dat.db', 'com.y'),
    ('/sdcard/Android/data/com.z/files/acc/server1/dat.db', 'com.z'),
    ('/mnt/shared/MuMuShared/com.w/files/acc/server2/dat.db', 'com.w'),
    ('weird/path/dat.db', ''),
])
def test_package_of_reads_path(path: str, expected: str) -> None:
    """缓存文件名要按真实包名走 —— 自动探测到的包名可能不是 --package 给的那个。"""
    assert ds.package_of(path) == expected


# ───────────────── 渠道自动探测（内置表没收录时）─────────────────
DETECTED = 'com.wuxia.novastar'
SAVE = RemoteFile(path='/data/data/com.wuxia.novastar/files/abc/server1/dat.db', size=900, mtime='01-01 00:00')


def test_list_saves_falls_back_to_detected_package() -> None:
    """官服没存档时，用设备报上来的包名再找一个。"""
    gateway = FakeDevice(by_package={DETECTED: [SAVE]})

    files = ds.list_saves(_device(gateway), serial='emulator-5554',
                      progress=RecordingProgress())

    assert [f.path for f in files] == [SAVE.path]
    assert gateway.asked[0] != DETECTED      # 先试过官服
    assert DETECTED in gateway.asked         # 再试探测到的


def test_list_saves_skips_detection_when_package_given() -> None:
    """显式给了 --package 就只认它，不去猜别的渠道。"""
    gateway = FakeDevice(by_package={'other.pkg': [SAVE]})

    with pytest.raises(AppError):
        ds.list_saves(_device(gateway), serial='emulator-5554', package='com.x',
                      progress=RecordingProgress())

    assert gateway.asked == ['com.x']


# ───────────── fetch_save：选设备 / 选存档 / 拉取的唯一实现 ─────────────
def _remote(path: str, epoch: float = 0.0) -> RemoteFile:
    return RemoteFile(path=path, size=32, mtime='01-01 00:00', mtime_epoch=epoch)


def test_fetch_save_picks_first_device_and_newest_when_no_chooser(
        tmp_path: Path) -> None:
    """CLI 用法：不传 chooser 就取第一台设备、最新一份存档。"""
    newer = _remote('/data/data/com.x/files/acc/server1/dat.db', 200.0)
    older = _remote('/data/data/com.x/files/acc/server2/dat.db', 100.0)
    gateway = FakeDevice(devices=[DeviceInfo('emu-1'), DeviceInfo('emu-2')],
                         saves=[newer, older])

    picked = ds.fetch_save(_device(gateway), _storage(tmp_path), package='com.x',
                           progress=RecordingProgress())

    assert picked is not None
    assert picked.serial == 'emu-1'
    assert picked.remote is newer
    assert picked.server == '1'
    assert picked.local.exists()


def test_fetch_save_uses_choosers_and_returns_none_on_cancel(
        tmp_path: Path) -> None:
    """向导用法：用户在选择器里放弃 -> 返回 None，且不拉任何文件。"""
    gateway = FakeDevice(devices=[DeviceInfo('emu-1'), DeviceInfo('emu-2')],
                         saves=[_remote('/data/data/com.x/files/a/server1/dat.db')])

    picked = ds.fetch_save(_device(gateway), _storage(tmp_path),
                           package='com.x',
                           device_chooser=lambda devices: None,
                           progress=RecordingProgress())

    assert picked is None
    assert gateway.pulled == []


def test_fetch_save_cancel_on_save_choice_skips_pull(tmp_path: Path) -> None:
    newer = _remote('/data/data/com.x/files/a/server1/dat.db', 200.0)
    older = _remote('/data/data/com.x/files/a/server2/dat.db', 100.0)
    gateway = FakeDevice(devices=[DeviceInfo('emu-1')], saves=[newer, older])

    picked = ds.fetch_save(_device(gateway), _storage(tmp_path), package='com.x',
                           save_chooser=lambda files: files[1],
                           progress=RecordingProgress())

    assert picked is not None and picked.remote is older
    assert picked.server == '2'


def test_fetch_save_reports_no_device(tmp_path: Path) -> None:
    with pytest.raises(AppError) as err:
        ds.fetch_save(_device(FakeDevice()), _storage(tmp_path), package='com.x',
                      progress=RecordingProgress())
    assert '没有检测到模拟器' in err.value.message


def test_fetch_save_returns_none_when_save_chooser_declines(tmp_path: Path) -> None:
    gateway = FakeDevice(devices=[DeviceInfo('emu-1')],
                         saves=[_remote('/data/data/com.x/files/a/server1/dat.db')])
    picked = ds.fetch_save(_device(gateway), _storage(tmp_path), package='com.x',
                           save_chooser=lambda files: None,
                           progress=RecordingProgress())
    assert picked is None
    assert gateway.pulled == []


# ───────────── 指定设备号：用对的那台，不在线要说出来 ─────────────
def _recording_device(gateway, seen: list[str | None],
                      chosen: list[str] | None = None) -> packs.DeviceStack:
    """记下每次 open_device 收到的 serial，用来断言读的是哪台机器。"""
    def open_device(**kwargs):
        seen.append(kwargs.get('serial'))
        return gateway
    return packs.DeviceStack(
        open_device=open_device,
        use_serial=(chosen.append if chosen is not None else lambda _s: None),
    )


def test_pick_device_uses_matched_serial() -> None:
    gateway = FakeDevice(devices=[DeviceInfo('emu-1'), DeviceInfo('emu-2')])
    progress = RecordingProgress()

    picked = ds.pick_device(_device(gateway), serial='emu-2', progress=progress)

    assert picked is not None and picked.serial == 'emu-2'
    assert progress.warns == []


def test_pick_device_warns_when_serial_offline() -> None:
    gateway = FakeDevice(devices=[DeviceInfo('emu-1'), DeviceInfo('emu-2')])
    progress = RecordingProgress()

    picked = ds.pick_device(_device(gateway), serial='emu-9', progress=progress)

    assert picked is not None and picked.serial == 'emu-1'
    assert len(progress.warns) == 1
    assert 'emu-9' in progress.warns[0] and 'emu-1、emu-2' in progress.warns[0]

def test_pick_device_leaves_choice_to_chooser() -> None:
    """有真选择器时不能替用户决定，哪怕 serial 能匹配上。"""
    gateway = FakeDevice(devices=[DeviceInfo('emu-1'), DeviceInfo('emu-2')])
    progress = RecordingProgress()
    asked: list[str] = []

    def chooser(devices):
        asked.extend(d.serial for d in devices)
        return devices[1]

    picked = ds.pick_device(_device(gateway), chooser, serial='emu-1', progress=progress)

    assert picked is not None and picked.serial == 'emu-2'
    assert asked == ['emu-1', 'emu-2']


def test_fetch_save_lists_and_pulls_from_given_serial(tmp_path: Path) -> None:
    """--serial 指定的那台必须贯穿 list_saves 与 pull_save，不能被换成第一台。"""
    gateway = FakeDevice(devices=[DeviceInfo('emu-1'), DeviceInfo('emu-2')],
                         saves=[_remote('/data/data/com.x/files/a/server1/dat.db')])
    seen: list[str | None] = []
    chosen: list[str] = []

    picked = ds.fetch_save(_recording_device(gateway, seen, chosen), _storage(tmp_path),
                           package='com.x', serial='emu-2',
                           progress=RecordingProgress())

    assert picked is not None and picked.serial == 'emu-2'
    # 第一次不带 serial 是 list_devices 枚举用的，之后读档必须都用指定的那台
    assert seen[1:] == ['emu-2', 'emu-2']
    assert chosen == ['emu-2'], '选定的设备号要回传给内存扫描路径'


def test_fetch_save_leaves_last_device_when_no_rescue(tmp_path: Path) -> None:
    """fetch_save 只要选定就回传，哪怕只有一个候选。"""
    gateway = FakeDevice(devices=[DeviceInfo('emu-1')],
                         saves=[_remote('/data/data/com.x/files/a/server1/dat.db')])
    chosen: list[str] = []

    ds.fetch_save(_recording_device(gateway, [], chosen), _storage(tmp_path),
                  package='com.x', progress=RecordingProgress())

    assert chosen == ['emu-1']
