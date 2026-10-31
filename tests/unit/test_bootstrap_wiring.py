"""bootstrap 的接线：用例层选中的设备号要能被内存扫描那条路看到。"""
from __future__ import annotations

from pathlib import Path

from guanxing.bootstrap import build_settings, build_stacks
from guanxing.infra.device import adb_client
from tests.support import RecordingProgress


def test_open_device_uses_the_serial_picked_by_the_usecase(monkeypatch,
                                                          tmp_path: Path) -> None:
    """内存扫描在 bootstrap 就装好了，不靠这个回传就会在多开时无从下手。"""
    monkeypatch.setattr(adb_client, 'find_adb', lambda explicit=None: ('adb.exe', 'test'))
    settings = build_settings(workspace=tmp_path)
    _crypto, _storage, device = build_stacks(settings, RecordingProgress())

    device.use_serial('emulator-5558')

    assert device.open_device().serial == 'emulator-5558'
    assert device.open_device(serial='other').serial == 'other', '显式参数优先于回传值'
