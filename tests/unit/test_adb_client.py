"""adb 适配器：存档枚举与「按修改时间倒序」。"""
from __future__ import annotations

from datetime import datetime

import pytest

from guanxing.infra.device.adb_client import DeviceGatewayImpl, _parse_stat
from guanxing.shared.errors import ADBError, MultipleDevices

STAT_TEXT = (
    '1048576 1700000000 /data/data/pkg/files/accA/server1/dat.db\n'
    '2048 1690000000 /data/data/pkg/files/accB/server2/dat.db\n'
)
LS_TEXT = (
    '-rw------- 1 u0_a53 u0_a53 1048576 2026-01-02 03:04 '
    '/data/data/pkg/files/accA/server1/dat.db\n'
    '-rw------- 1 u0_a53 u0_a53  2048 2026-01-01 05:06 '
    '/data/data/pkg/files/accB/server2/dat.db\n'
)


class _FakeADB(DeviceGatewayImpl):
    """只替换 sh()，不碰真实 adb。"""

    def __init__(self, stat_text: str = '', ls_text: str = '') -> None:
        self.stat_text = stat_text
        self.ls_text = ls_text
        self.commands: list[str] = []

    def sh(self, cmd: str, *, timeout: int | None = None) -> str:
        self.commands.append(cmd)
        return self.stat_text if cmd.lstrip().startswith('stat') else self.ls_text


def test_parse_stat_reads_size_epoch_path() -> None:
    files = _parse_stat(STAT_TEXT)
    assert [f.path for f in files] == [
        '/data/data/pkg/files/accA/server1/dat.db',
        '/data/data/pkg/files/accB/server2/dat.db',
    ]
    assert files[0].size == 1048576
    assert files[0].mtime_epoch == 1700000000
    assert files[0].mtime == datetime.fromtimestamp(1700000000).strftime('%Y-%m-%d %H:%M')


def test_parse_stat_skips_non_datdb_and_garbage() -> None:
    assert _parse_stat('x y z\n1 2 /a/b.txt\n') == []


def test_find_saves_sorted_by_epoch_desc() -> None:
    adb = _FakeADB(stat_text=STAT_TEXT)
    files = adb.find_saves('pkg')
    assert [f.path.rsplit('/', 2)[-2] for f in files] == ['server1', 'server2']


def test_find_saves_falls_back_to_ls_when_stat_missing() -> None:
    """设备没有 ``stat -c`` 时不能一条都拿不到。"""
    adb = _FakeADB(stat_text='', ls_text=LS_TEXT)
    files = adb.find_saves('pkg')
    assert len(files) == 2
    assert files[0].path.endswith('server1/dat.db')
    assert files[0].mtime == '2026-01-02 03:04'


def test_find_saves_dedupes_same_path() -> None:
    adb = _FakeADB(stat_text=STAT_TEXT)
    files = adb.find_saves('pkg')
    assert len(files) == 2                     # 4 个 root 都返回同样两行，按路径去重


def test_find_saves_dedupes_same_file_via_other_root() -> None:
    """``/data/data`` 与 ``/data/user/0`` 是同一份数据的两个视图，不能算两份。"""
    text = (
        '1048576 1700000000 /data/data/pkg/files/accA/server1/dat.db\n'
        '1048576 1700000000 /data/user/0/pkg/files/accA/server1/dat.db\n'
    )
    files = _FakeADB(stat_text=text).find_saves('pkg')
    assert len(files) == 1
    assert files[0].path.startswith('/data/data/')


def test_glob_is_not_quoted_as_a_whole() -> None:
    """通配符必须留在引号外 —— mksh 不会展开单引号里的 ``*``（曾导致永远找不到档）。"""
    adb = _FakeADB(stat_text=STAT_TEXT)
    adb.find_saves('pkg')
    stat_cmds = [c for c in adb.commands if c.lstrip().startswith('stat')]
    assert stat_cmds, '应该至少调用一次 stat'
    for cmd in stat_cmds:
        assert '*/server*/dat.db' in cmd
        assert "'*/server*/dat.db'" not in cmd


# ───────────── 指定了设备号：先核一遍，失效就不带 -s ─────────────
class _SerialADB(DeviceGatewayImpl):
    """只桩掉子进程：``devices`` 返回固定列表，其余命令记录下来。

    注意不重写 ``_run`` 以外的东西——``_base()`` / ``_checked_serial()``
    的真实行为才是被测对象。
    """

    def __init__(self, serial: str | None, online: list[str]) -> None:
        self.serial = serial
        self.online = online
        self.timeout = 20
        self.exe = 'adb'
        self.exe_src = 'test'
        self._serial_ok = None
        self.calls: list[list[str]] = []

    def _run(self, args, timeout=None):  # type: ignore[override]
        self.calls.append(list(args))
        text = 'List of devices attached\n' + ''.join(
            f'{s}\tdevice\n' for s in self.online)
        return type('P', (), {'returncode': 0, 'stdout': text.encode(),
                              'stderr': b''})()


def test_online_serial_keeps_the_dash_s_flag() -> None:
    adb = _SerialADB('127.0.0.1:7555', ['127.0.0.1:7555'])
    adb.sh('echo hi')
    assert adb.calls[-1] == ['adb', '-s', '127.0.0.1:7555', 'shell', 'echo hi']


def test_stale_serial_falls_back_to_auto_pick() -> None:
    """过期的设备号（模拟器换端口、多开换实例）不能让挖密钥直接失败。"""
    adb = _SerialADB('127.0.0.1:9999', ['127.0.0.1:7555'])
    adb.sh('echo hi')
    assert adb.calls[-1] == ['adb', 'shell', 'echo hi'], '失效的设备号必须不再带 -s'


def test_stale_serial_warns_once_only(caplog) -> None:
    adb = _SerialADB('127.0.0.1:9999', ['127.0.0.1:7555'])
    with caplog.at_level('WARNING'):
        adb.sh('a')
        adb.sh('b')
    assert len([r for r in caplog.records if '不在 adb devices' in r.getMessage()]) == 1
    assert [c[:2] for c in adb.calls].count(['adb', 'devices']) == 1, '只核一次'


def test_no_serial_never_probes_devices() -> None:
    """没指定设备时不该多跑一次 adb devices（离线解档/本地路径不受影响）。"""
    adb = _SerialADB(None, ['127.0.0.1:7555'])
    adb.sh('echo hi')
    assert all(c[1:2] != ['devices'] for c in adb.calls)
    assert adb.calls[-1] == ['adb', 'shell', 'echo hi']


def test_list_devices_reads_model_for_multi_instance_picking() -> None:
    """端口每次新建都随机，机型才是用户能对上自己模拟器实例的那个标识。"""
    text = (
        'List of devices attached\n'
        'emulator-5558          device product:e1q model:SM_S9210 device:e1q transport_id:1\n'
        'emulator-5562          device product:cupid model:2201123C device:cupid transport_id:3\n'
    )

    class _L(_SerialADB):
        def _run(self, args, timeout=None):
            return type('P', (), {'returncode': 0, 'stdout': text.encode(),
                                  'stderr': b''})()

    devices = _L(None, []).devices()

    assert [d.model for d in devices] == ['SM_S9210', '2201123C']
    assert devices[0].label == 'emulator-5558 (SM_S9210)'


def test_list_devices_tolerates_plain_devices_output() -> None:
    """没有 -l 附加字段（或旧版 adb）时不能崩，机型留空即可。"""
    adb = _SerialADB(None, ['emulator-5558'])
    devices = adb.devices()
    assert [d.model for d in devices] == ['']
    assert devices[0].label == 'emulator-5558'


def test_devices_failure_does_not_drop_the_flag() -> None:
    """adb devices 本身问不到时不下结论，让真正的命令报更有用的错。"""
    class _Broken(_SerialADB):
        def _run(self, args, timeout=None):
            self.calls.append(list(args))
            raise ADBError('adb 服务没起')

    adb = _Broken('127.0.0.1:7555', [])
    assert adb._checked_serial() == '127.0.0.1:7555'


# ───────────── 刚 kill-server：设备要过几秒才重新注册 ─────────────
def test_devices_waits_for_late_registration(monkeypatch) -> None:
    """一次查空就判"没有模拟器"，会把"等一下就好"误报成"没开模拟器"。"""
    from guanxing.infra.device import adb_client

    monkeypatch.setattr(adb_client, 'DEVICE_SETTLE_SEC', 2.0)
    monkeypatch.setattr(adb_client, 'DEVICE_POLL_SEC', 0.0)

    class _Late(_SerialADB):
        def __init__(self) -> None:
            super().__init__(None, ['emulator-5558'])
            self.empty_rounds = 2

        def _run(self, args, timeout=None):
            if self.empty_rounds:
                self.empty_rounds -= 1
                self.calls.append(list(args))
                return type('P', (), {'returncode': 0, 'stdout': b'List of devices attached\n',
                                      'stderr': b''})()
            return super()._run(args, timeout)

    adb = _Late()
    assert [d.serial for d in adb.devices()] == ['emulator-5558']
    assert len([c for c in adb.calls if c[1:2] == ['devices']]) == 3


# ───────────── 多台设备：不指定就该明确说要指定，而不是"游戏没在跑" ─────────────
class _MultiADB(_SerialADB):
    """不带 -s 时 adb 怎么回，就照着回。"""

    def _run(self, args, timeout=None):
        self.calls.append(list(args))
        if args[1:2] == ['devices']:
            text = b'List of devices attached\nemulator-5558\tdevice\nemulator-5560\tdevice\n'
            return type('P', (), {'returncode': 0, 'stdout': text, 'stderr': b''})()
        assert '-s' not in args, '带上 -s 就不该走到这里'
        err = b'adb.exe: more than one device/emulator\n'
        return type('P', (), {'returncode': 1, 'stdout': b'', 'stderr': err})()


def test_pid_of_reports_multiple_devices_instead_of_none() -> None:
    adb = _MultiADB(None, ['emulator-5558', 'emulator-5560'])

    with pytest.raises(MultipleDevices) as err:
        adb.pid_of('com.x')

    assert 'emulator-5558' in err.value.message and 'emulator-5560' in err.value.message
    assert any('--serial' in h for h in err.value.hints)


def test_pid_of_returns_none_when_process_absent() -> None:
    """pidof 找不到进程只退非 0、不写 stderr —— 这是正常情况，不是错误。"""
    class _NoProcess(_SerialADB):
        def _run(self, args, timeout=None):
            if args[1:2] == ['devices']:
                return super()._run(args, timeout)
            self.calls.append(list(args))
            return type('P', (), {'returncode': 1, 'stdout': b'', 'stderr': b''})()

    assert _NoProcess('emulator-5558', ['emulator-5558']).pid_of('com.x') is None
