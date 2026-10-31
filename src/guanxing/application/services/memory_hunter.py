"""内存爆破的入口：定位进程、扫内存、爆破。

内部再分别实现三项功能，因为三者互不相干但参数与缓存耦合。
调用方只看 outer_key / inner_key 即可。
"""
from __future__ import annotations

from collections.abc import Callable

from guanxing.domain.channels import GAME_PACKAGES
from guanxing.domain.crypto.xxtea import XXTEACrypto
from guanxing.domain.save.envelope import SaveEnvelope
from guanxing.shared.progress import ProgressSink

from ..ports.device import DeviceGateway
from ..ports.executor import CrackExecutor
from ..ports.memory import ProcessMemory
from .key_cracker import KeyCracker
from .memory_candidates import MemoryCandidates
from .memory_scanner import MemoryScanner
from .process_locator import ProcessLocator


class MemoryKeyHunter:
    """一块内存扫一次，外层密钥和完整内层密钥都从这份候选池里爆破。"""

    def __init__(
        self,
        *,
        open_device: Callable[..., DeviceGateway],
        open_memory: Callable[..., ProcessMemory],
        executor: CrackExecutor,
        xxtea: XXTEACrypto,
        envelope: SaveEnvelope,
        progress: ProgressSink,
        packages: tuple[str, ...] = GAME_PACKAGES,
        anon_only: bool = True,
        min_kb: int = 64,
        region_max_mb: int = 64,
        chunk_mb: int = 64,
        limit_mb: int | None = None,
    ) -> None:
        """扫描参数默认值与 ``shared.settings.MemScan`` 保持一致；bootstrap 总是显式传入。"""
        self.locator = ProcessLocator(
            open_device=open_device, packages=packages, progress=progress,
        )
        self.scanner = MemoryScanner(
            open_memory=open_memory, envelope=envelope, progress=progress,
            anon_only=anon_only, min_kb=min_kb, region_max_mb=region_max_mb,
            chunk_mb=chunk_mb, limit_mb=limit_mb,
        )
        self.cracker = KeyCracker(
            executor=executor, xxtea=xxtea, envelope=envelope,
            locator=self.locator, scanner=self.scanner, progress=progress,
        )

    def scan(self, pid: str, runtime: str = 'android') -> MemoryCandidates:
        """扫一遍目标进程（按 pid 缓存）。"""
        return self.scanner.scan(pid, runtime)

    def outer_key(self, content: str, *, runtime: str = 'android') -> str:
        """爆破 dat.db content 的外层密钥。"""
        return self.cracker.outer_key(content, runtime=runtime)

    def inner_key(self, version: str, body: bytes, *, runtime: str = 'android') -> str:
        """爆破完整内层密钥（psw + 后缀）。"""
        return self.cracker.inner_key(version, body, runtime=runtime)


__all__ = ['MemoryKeyHunter']
