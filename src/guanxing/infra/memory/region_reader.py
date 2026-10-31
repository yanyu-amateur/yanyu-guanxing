"""ProcessMemory 的 adb 实现：exec-out dd 分块把进程内存拉回本地。

走 exec-out 省掉"写 /sdcard 再 pull"的一次落盘，减少内存耗时
注意：设备端是 32 位有符号算术，skip/count 必须由 PC 端算成十进制再拼命令。
"""
from __future__ import annotations

import logging
from typing import Protocol

from guanxing.application.ports.memory import PAGE, ProcessMemory, Region
from guanxing.domain.errors import MemoryReadTimeout
from guanxing.shared.errors import ADBError, ADBTimeout, MultipleDevices

from .proc_maps import parse_maps, select_regions

logger = logging.getLogger(__name__)


class _AdbShell(Protocol):
    """这里只需要 adb 的两个能力，不直接依赖 DeviceGatewayImpl（方便单测）。"""
    def sh(self, cmd: str, *, timeout: int | None = None) -> str: ...
    def exec_out(self, cmd: str, *, timeout: int | None = None) -> bytes: ...


class ProcessMemoryImpl(ProcessMemory):
    """``ProcessMemory`` 的 adb 实现。"""

    def __init__(self, adb: _AdbShell, *, timeout: int = 300) -> None:
        self.adb = adb
        self.timeout = timeout

    # ────────────────────── 区域 ──────────────────────
    def maps_text(self, pid: str) -> str:
        return self.adb.sh(f'cat /proc/{pid}/maps', timeout=self.timeout)

    def regions(self, pid: str, *, anon_only: bool = True,
                min_kb: int = 64) -> list[Region]:
        return select_regions(
            parse_maps(self.maps_text(pid)), anon_only=anon_only, min_kb=min_kb,
        )

    # ────────────────────── 读取 ──────────────────────
    def read_region(self, pid: str, region: Region, *, max_mb: int = 64,
                    chunk_mb: int = 64) -> bytes:
        """按 ``chunk_mb`` 分块读回整段；不可读的块跳过（返回内容可能比预期短）。

        Raises:
            MemoryReadTimeout: 某一块 adb 超时。整轮扫描应当就此停下并如实报出来。
        """
        size = min(region.size, max_mb * 1048576) if max_mb else region.size
        size -= size % PAGE
        if size <= 0:
            return b''
        step = max(PAGE, (chunk_mb * 1048576) // PAGE * PAGE)

        buf = bytearray()
        offset = 0
        while offset < size:
            take = min(step, size - offset)
            pages = take // PAGE
            if pages <= 0:
                break
            skip = (region.start + offset) // PAGE
            buf += self._read_pages(pid, skip, pages)
            offset += pages * PAGE
        return bytes(buf)

    def _read_pages(self, pid: str, skip: int, pages: int) -> bytes:
        cmd = (f'dd if=/proc/{pid}/mem bs={PAGE} skip={skip} count={pages} '
               f'2>/dev/null')
        try:
            return self.adb.exec_out(cmd, timeout=self.timeout)
        except ADBTimeout as exc:
            # 超时说明设备慢，不是"这段没有密钥"；吞掉会让用户以为没 root
            raise MemoryReadTimeout(
                f'读 {pages} 页（skip={skip}）超过 {self.timeout}s'
            ) from exc
        except ADBError as exc:
            # 多设备 = 选哪台的问题，每块都会失败，不能当成"这段没密钥"跳过
            if isinstance(exc, MultipleDevices):
                raise
            # 权限不足的页：跳过这一段，继续扫别的
            logger.debug('跳过一段不可读内存 skip=%s pages=%s: %s', skip, pages, exc)
            return b''


__all__ = ['ProcessMemoryImpl']