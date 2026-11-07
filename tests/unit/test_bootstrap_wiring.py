"""bootstrap 的接线：用例层选中的设备号要能被内存扫描那条路看到。"""
from __future__ import annotations

import json
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


def test_remember_writes_adb_and_serial(monkeypatch, tmp_path: Path) -> None:
    """落档后下次启动直接复用上次那台，不用再全量探测。"""
    monkeypatch.setattr(adb_client, 'find_adb', lambda explicit=None: ('adb.exe', 'test'))
    settings = build_settings(workspace=tmp_path)
    _crypto, _storage, device = build_stacks(settings, RecordingProgress())

    device.open_device()
    device.remember(serial='127.0.0.1:5561')

    doc = json.loads((tmp_path / 'keys.local.json').read_text(encoding='utf-8'))
    assert doc['serial'] == '127.0.0.1:5561'
    assert doc['adb'] == 'adb.exe'
