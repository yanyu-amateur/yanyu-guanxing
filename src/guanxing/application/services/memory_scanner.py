"""把进程内存读回来并抽出候选钥匙（只碰内存端口 + 候选生成）。

耗时几乎全在这里，所以进度按"这段打算读多少"推进：
dd 撞到不可读页会返回空/短，按实际字节推进会让进度条卡住不动。
"""
from __future__ import annotations

from collections.abc import Callable

from guanxing.application.ports.memory import ProcessMemory, Region
from guanxing.domain.crypto import candidates as cand_mod
from guanxing.domain.errors import MemoryReadTimeout, OuterKeyUnavailable
from guanxing.domain.save.envelope import SaveEnvelope
from guanxing.shared.progress import ProgressSink
from guanxing.shared.text import human_size

from .memory_candidates import MemoryCandidates

MB = 1048576


class MemoryScanner:
    """扫一块内存，产出三类候选；结果按 pid 缓存。"""

    def __init__(
        self,
        *,
        open_memory: Callable[..., ProcessMemory],
        envelope: SaveEnvelope,
        progress: ProgressSink,
        anon_only: bool = True,
        min_kb: int = 64,
        region_max_mb: int = 64,
        chunk_mb: int = 64,
        limit_mb: int | None = None,
    ) -> None:
        self.open_memory = open_memory
        self.envelope = envelope
        self.progress = progress
        self.anon_only = anon_only
        self.min_kb = min_kb
        self.region_max_mb = region_max_mb
        self.chunk_mb = chunk_mb
        self.limit_mb = limit_mb
        # pid -> 一次扫描的全部候选；同一进程只扫一次
        self._scanned: dict[str, MemoryCandidates] = {}

    def scan(self, pid: str, runtime: str = 'android') -> MemoryCandidates:
        """扫一遍目标进程返回三类候选，按 pid 缓存，学到新 psw 时重扫以补锚点。

        Args:
            pid: 目标进程号。
            runtime: 当前平台，决定后缀的尝试优先级。
        Returns:
            本次（或上次）扫描的全部候选。
        """
        psows = self._psw_needles()
        cached = self._scanned.get(pid)
        if cached is not None and cached.psows >= psows:
            return cached
        if cached is not None:
            self.progress.debug(
                f'表里多了新的 psw（{len(psows - cached.psows)} 个），重扫一次补锚点'
            )

        memory = self.open_memory()
        regions = list(memory.regions(
            pid, anon_only=self.anon_only, min_kb=self.min_kb,
        ))
        cap = self.region_max_mb * MB
        total = sum(min(r.size, cap) for r in regions)
        self.progress.step(
            '内存区域', f'{len(regions)} 段，共要扫 {human_size(total)}（pid {pid}）'
        )
        if not regions:
            raise OuterKeyUnavailable(
                '目标进程没有可读内存（多半是没 root，或游戏还没进到角色界面）',
                command='mem',
                retry_with_outer_key=False,
            )

        suffixes = self.envelope.suffixes(runtime)
        strings: set[bytes] = set()
        anchored: set[bytes] = set()
        psw_anchored: set[bytes] = set()
        planned = 0
        skipped = 0
        task = self.progress.task(total, '扫描内存', unit='B')
        try:
            for region in regions:
                expected = min(region.size, cap)
                data = self._read(memory, pid, region)
                if data:
                    strings |= cand_mod.harvest_strings(data)
                    if suffixes:
                        anchored |= cand_mod.suffixed_candidates(data, suffixes)
                    if psows:
                        psw_anchored |= cand_mod.psw_anchored_candidates(data, psows)
                if len(data) < expected:
                    skipped += expected - len(data)
                planned += expected
                task.update(
                    expected,
                    f'候选 {len(strings) + len(anchored) + len(psw_anchored):,}',
                )
                if self.limit_mb and planned >= self.limit_mb * MB:
                    self.progress.step('扫描', f'达到上限 {self.limit_mb} MB，提前停止')
                    break
        finally:
            task.close()

        if skipped:
            self.progress.warn(
                f'{human_size(skipped)} 内存读不出来，已跳过'
                '（多半是没 root，或那段是内核保护的页）'
            )

        self.progress.step(
            '候选',
            f'可打印串 {len(strings):,} 条 / 后缀锚定 {len(anchored):,} 条'
            f' / psw 锚定 {len(psw_anchored):,} 条',
        )
        found = MemoryCandidates(
            frozenset(strings), frozenset(anchored), frozenset(psw_anchored), psows,
        ).merge(cached)
        self._scanned[pid] = found
        return found

    def _read(self, memory: ProcessMemory, pid: str, region: Region) -> bytes:
        """读一段；超时要立刻上抛，那不代表这段没有密钥。"""
        try:
            return memory.read_region(
                pid, region, max_mb=self.region_max_mb, chunk_mb=self.chunk_mb,
            )
        except MemoryReadTimeout as exc:
            raise OuterKeyUnavailable(
                f'读取进程内存超时（{exc.reason}）。'
                '模拟器太慢或正忙，请重试；也可以先把游戏切回角色界面上传存档后再试',
                command='mem', retry_with_outer_key=False,
            ) from exc

    def _psw_needles(self) -> frozenset[str]:
        """表里所有 8 位 psw —— 任何一个都可能成为"后面紧跟后缀"的锚点。"""
        return self.envelope.all_psows()


__all__ = ['MemoryScanner']
