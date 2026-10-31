"""定位游戏进程：adb 读不通与"游戏没开"必须给出不同的下一步。"""
from __future__ import annotations

import pytest

from guanxing.application.ports.device import DeviceInfo
from guanxing.application.services.process_locator import ProcessLocator
from guanxing.domain.errors import OuterKeyUnavailable
from guanxing.shared.errors import ADBError, ADBTimeout, MultipleDevices
from tests.support import RecordingProgress

PACKAGE = 'com.lanjing.yanyu.lanjing'


class FakeGateway:
    def __init__(self, *, detected=(), devices=None, pid=None, error=None) -> None:
        self._detected = list(detected)
        self._devices = [DeviceInfo(serial='emulator-5554')] if devices is None else devices
        self._pid = pid
        self._error = error
        self.asked: list[str] = []

    def devices(self):
        return self._devices

    def detect_save_packages(self):
        return self._detected

    def pid_of(self, package):
        self.asked.append(package)
        if self._error is not None:
            raise self._error
        return self._pid if package == PACKAGE else None


def _locator(gateway, progress=None) -> ProcessLocator:
    return ProcessLocator(open_device=lambda **_kw: gateway,
                          packages=(PACKAGE,),
                          progress=progress or RecordingProgress())


def test_finds_running_package() -> None:
    gateway = FakeGateway(detected=[PACKAGE], pid='4242')
    assert _locator(gateway).find() == (PACKAGE, '4242')


def test_no_device_connected_is_not_a_missing_game() -> None:
    """adb 一台设备都没有：该去检查 adb，而不是回游戏里进角色界面。"""
    gateway = FakeGateway(detected=[], devices=[])

    with pytest.raises(ADBError) as err:
        _locator(gateway).find()

    assert '没有检测到模拟器' in err.value.message
    joined = ' '.join(err.value.hints)
    assert 'adb devices' in joined


def test_connected_but_game_not_running() -> None:
    """设备在，只是游戏没开：这才是"回游戏进角色界面"该说的话。"""
    gateway = FakeGateway(detected=[PACKAGE], pid=None)

    with pytest.raises(OuterKeyUnavailable) as err:
        _locator(gateway).find()

    assert '进程' in err.value.message
    assert err.value.retry_with_outer_key is False


def test_adb_failure_is_reported_as_adb_not_as_missing_game() -> None:
    gateway = FakeGateway(detected=[PACKAGE], error=ADBError('adb 不可执行'))

    with pytest.raises(ADBError) as err:
        _locator(gateway).find()

    assert 'adb 读不到进程列表' in err.value.message
    assert 'adb 不可执行' in err.value.message


def test_timeout_keeps_its_own_hint() -> None:
    """超时是设备卡，提示要指向 adb kill-server，别退化成"去开 root"。"""
    gateway = FakeGateway(detected=[PACKAGE],
                          error=ADBTimeout('adb 命令超时（30s）',
                                           hint='设备卡住或 adb 服务异常，可试 adb kill-server'))

    with pytest.raises(ADBError) as err:
        _locator(gateway).find()

    assert any('kill-server' in h for h in err.value.hints)


def test_one_bad_package_does_not_stop_the_others() -> None:
    """某个包查不通（比如刚被卸载）不该放过后面真在跑的那个。"""
    class Mixed(FakeGateway):
        def pid_of(self, package):
            self.asked.append(package)
            if package == 'com.broken':
                raise ADBTimeout('adb 命令超时（30s）')
            return '4242' if package == PACKAGE else None

    gateway = Mixed(detected=['com.broken', PACKAGE])
    locator = ProcessLocator(open_device=lambda **_kw: gateway,
                             packages=('com.broken', PACKAGE),
                             progress=RecordingProgress())

    assert locator.find() == (PACKAGE, '4242')
    assert gateway.asked == ['com.broken', PACKAGE]


def test_multiple_devices_is_reported_as_a_choice_problem() -> None:
    """多开又不指定设备：要说"选哪台"，不能裹成"adb 读不到进程列表"。"""
    gateway = FakeGateway(detected=[PACKAGE],
                          error=MultipleDevices('检测到多个模拟器：emu-1、emu-2',
                                                hint='用 --serial 指定'))

    with pytest.raises(MultipleDevices) as err:
        _locator(gateway).find()

    assert err.value.message.startswith('检测到多个模拟器')


def test_detect_failure_falls_back_to_builtin_packages() -> None:
    class BrokenDetect(FakeGateway):
        def detect_save_packages(self):
            raise ADBError('ls 失败')

    gateway = BrokenDetect(detected=[], pid='4242')
    assert _locator(gateway).find() == (PACKAGE, '4242')
