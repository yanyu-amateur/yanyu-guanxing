"""爆破进度必须持续推进：否则大密文 + 大候选池会变成"进度条十几分钟不动"。

纯 Python 解 1MB 密文一条要近 1 秒，所以"每 N 条更新一次"的节流方式会失效，
必须按时间节流；分片也要按单条实测成本来定。
"""
from __future__ import annotations

import time

from guanxing.domain.crypto.oracle import Oracle
from guanxing.infra.crypto.pool import CrackExecutorImpl


class _SlowXXTEA:
    """每次解密固定耗时，且永不命中 —— 只关心进度是否在动。"""

    has_cxxtea = False

    def __init__(self, cost: float = 0.01) -> None:
        self.cost = cost
        self.calls = 0

    def decrypt_raw(self, data: bytes, key: str | bytes) -> bytes | None:
        self.calls += 1
        time.sleep(self.cost)
        return None

    def tail_length(self, raw: bytes) -> int:
        return -1

    def length_window(self, n: int) -> tuple[int, int]:
        return n * 4 - 7, n * 4 - 4


def test_single_process_reports_progress_while_running() -> None:
    """还没跑完就要有进度：只在最后报一次等于没有进度。"""
    slow = _SlowXXTEA(cost=0.01)          # 每条 10ms
    cands = [f'{i:016d}'.encode() for i in range(60)]
    marks: list[tuple[int, int]] = []

    Oracle(slow).crack_single(                         # type: ignore[arg-type]
        b'\x00' * 64, cands, progress=lambda d, t, _e: marks.append((d, t)))

    assert len(marks) >= 3, f'只有 {len(marks)} 次进度，等于卡死'
    assert marks[-1] == (60, 60), '最后一次必须是完成态'
    assert [d for d, _ in marks] == sorted(d for d, _ in marks), '进度不许回退'


def test_chunk_size_follows_measured_cost() -> None:
    """分片按"1 秒内能跑完"来定，而不是按总候选数除以进程数。"""
    slow = _SlowXXTEA(cost=0.05)                       # 每条 50ms
    ex = CrackExecutorImpl(slow, Oracle(slow), threshold=1)   # type: ignore[arg-type]

    chunk = ex._chunk_size(b'\x00' * 64, b'x' * 16)

    assert 1 <= chunk <= 32, f'分片 {chunk} 条 × 50ms 会让首条进度等太久'
