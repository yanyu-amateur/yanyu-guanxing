"""ProcessMemoryImpl 的字节算术与错误分类，用桩替代真设备。

dd 的 skip 必须是绝对页号（region.start + offset），算错就扫到别的区域；
权限不足的块跳过返回短数据，但超时必须抛 MemoryReadTimeout，否则上层会误报没 root。
"""
from __future__ import annotations

import pytest

from guanxing.application.ports.memory import PAGE, Region
from guanxing.domain.errors import MemoryReadTimeout
from guanxing.infra.memory.region_reader import ProcessMemoryImpl
from guanxing.shared.errors import ADBError, ADBTimeout, MultipleDevices

MAPS = '00a00000-00b00000 rw-p 00000000 00:00 0 [heap]\n'


class FakeAdb:
    """记录调用；``behaviour`` 按命令内容决定返回什么。"""

    def __init__(self, *, fail_on_skip: int | None = None,
                 timeout_on_skip: int | None = None) -> None:
        self.calls: list[str] = []
        self.fail_on_skip = fail_on_skip
        self.timeout_on_skip = timeout_on_skip

    def sh(self, cmd: str, *, timeout: int | None = None) -> str:
        self.calls.append(cmd)
        return MAPS

    def exec_out(self, cmd: str, *, timeout: int | None = None) -> bytes:
        self.calls.append(cmd)
        skip = int(cmd.split('skip=')[1].split()[0])
        pages = int(cmd.split('count=')[1].split()[0])
        if self.timeout_on_skip is not None and skip >= self.timeout_on_skip:
            raise ADBTimeout('超时')
        if self.fail_on_skip is not None and skip >= self.fail_on_skip:
            raise ADBError('permission denied')
        return b'\x00' * (pages * PAGE)


def test_regions_filters_by_anon_and_size() -> None:
    mem = ProcessMemoryImpl(FakeAdb(), timeout=10)
    regions = mem.regions('123')
    assert [r.path for r in regions] == ['[heap]']


def test_read_region_uses_absolute_page_skip() -> None:
    """skip 必须是 region.start/PAGE + 已读页数，而不是从 0 开始。"""
    adb = FakeAdb()
    mem = ProcessMemoryImpl(adb, timeout=10)
    region = Region(start=0x00A00000, end=0x00A00000 + PAGE * 4)
    data = mem.read_region('123', region, max_mb=64, chunk_mb=64)

    assert len(data) == PAGE * 4
    reads = [c for c in adb.calls if c.startswith('dd ')]
    assert reads and 'skip=2560' in reads[0]      # 0x00A00000 / 4096
    assert 'count=4' in reads[0]


def test_read_region_reads_in_chunks() -> None:
    adb = FakeAdb()
    mem = ProcessMemoryImpl(adb, timeout=10)
    region = Region(start=0, end=PAGE * 4)
    mem.read_region('123', region, max_mb=64, chunk_mb=PAGE * 2 // 1048576)

    reads = [c for c in adb.calls if c.startswith('dd ')]
    assert len(reads) >= 2, 'chunk_mb 小于区域时必须分多次读'


def test_permission_error_skips_the_chunk() -> None:
    """读不了的页返回短数据，不炸整轮扫描。"""
    adb = FakeAdb(fail_on_skip=1)
    mem = ProcessMemoryImpl(adb, timeout=10)
    region = Region(start=PAGE, end=PAGE * 3)
    assert mem.read_region('123', region, max_mb=64, chunk_mb=64) == b''


def test_timeout_raises_instead_of_silently_skipping() -> None:
    """超时不是"这段没有密钥"，必须往上抛。"""
    adb = FakeAdb(timeout_on_skip=0)
    mem = ProcessMemoryImpl(adb, timeout=5)
    with pytest.raises(MemoryReadTimeout) as exc:
        mem.read_region('123', Region(start=0, end=PAGE), max_mb=64, chunk_mb=64)
    assert '5s' in str(exc.value)


def test_multiple_devices_is_not_treated_as_unreadable_memory() -> None:
    """设备号失效导致多设备歧义时，每块都会失败 —— 不能当成"这段没密钥"跳过。"""
    class _Ambiguous(FakeAdb):
        def exec_out(self, cmd: str, *, timeout: int | None = None) -> bytes:
            raise MultipleDevices('检测到多个模拟器，没指定用哪一个：emu-1、emu-2')

    mem = ProcessMemoryImpl(_Ambiguous(), timeout=10)
    with pytest.raises(MultipleDevices):
        mem.read_region('123', Region(start=0, end=PAGE), max_mb=64, chunk_mb=64)


def test_unaligned_region_is_rounded_down() -> None:
    adb = FakeAdb()
    mem = ProcessMemoryImpl(adb, timeout=10)
    data = mem.read_region('123', Region(start=0, end=PAGE + 100),
                           max_mb=64, chunk_mb=64)
    assert len(data) == PAGE
