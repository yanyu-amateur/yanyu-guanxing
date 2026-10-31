"""CrackExecutor 的 multiprocessing 实现。

worker 判定函数与共享数据（密文、长度字区间）都放模块顶层，靠 initializer 传给子进程。
注意：Windows 用 spawn，实例方法/闭包传不过去；候选少时走单进程，避免起池开销。
"""
from __future__ import annotations

import multiprocessing as mp
import time
from collections.abc import Iterable

from guanxing.application.ports.executor import CrackExecutor
from guanxing.domain.crypto.oracle import REPORT_INTERVAL, Hit, Oracle, ProgressFn
from guanxing.domain.crypto.xxtea import XXTEACrypto

# 子进程里的全局状态（spawn 下由 _init_worker 填）

_XXTEA: XXTEACrypto | None = None
_CT: bytes = b''
_LO = 0
_HI = 0


def _init_worker(ct: bytes, lo: int, hi: int, has_c: bool) -> None:
    global _XXTEA, _CT, _LO, _HI
    _XXTEA = XXTEACrypto(has_cxxtea=has_c)
    _CT, _LO, _HI = ct, lo, hi


def _check(key: bytes) -> Hit | None:
    """长度字预言机判定（误报率 4/2^32 ≈ 1e-9）。"""
    if _XXTEA is None:  # pragma: no cover - 只可能是 initargs 丢了
        return None
    raw = _XXTEA.decrypt_raw(_CT, key)
    if raw is None:
        return None
    length_word = _XXTEA.tail_length(raw)
    if _LO <= length_word <= _HI:
        return bytes(key), length_word, raw[:64]
    return None


class CrackExecutorImpl(CrackExecutor):
    """``CrackExecutor`` 的进程池实现。"""
    def __init__(self, xxtea: XXTEACrypto, oracle: Oracle,
                 threshold: int = 20000, max_workers: int | None = None) -> None:
        self.xxtea = xxtea
        self.oracle = oracle
        self.threshold = threshold
        self.max_workers = max_workers

    # ───────────────────── 单进程 ─────────────────────
    def crack_single(self, ct: bytes, candidates: Iterable[bytes],
                     progress: ProgressFn | None = None) -> list[Hit]:
        """单进程爆破（候选少时用，避开起池开销）。"""
        return self.oracle.crack_single(ct, list(candidates), progress=progress)

    # ───────────────────── 自动选路 ─────────────────────
    def crack(self, ct: bytes, candidates: Iterable[bytes],
              progress: ProgressFn | None = None) -> list[Hit]:
        """候选少于 ``threshold`` 或显式单进程时走本地，否则开进程池。

        Args:
            ct: 待解密的密文。
            candidates: 候选钥匙。
            progress: 进度回调，签名 ``(done, total, elapsed)``，按时间节流。
        Returns:
            命中列表。
        """
        cands = [bytes(c) for c in candidates]
        if not cands:
            return []
        started = time.perf_counter()
        if len(cands) < self.threshold or self.max_workers == 1:
            return self.crack_single(ct, cands, progress=progress)

        n = len(ct) // 4
        lo, hi = self.xxtea.length_window(n)
        nproc = self.max_workers or max(2, mp.cpu_count() or 4)
        chunk = self._chunk_size(ct, cands[0])
        report = _Reporter(progress, started)

        hits: list[Hit] = []
        with mp.Pool(nproc, initializer=_init_worker,
                     initargs=(ct, lo, hi, self.xxtea.has_cxxtea)) as pool:
            for done, result in enumerate(
                pool.imap_unordered(_check, cands, chunksize=chunk), 1
            ):
                if result is not None:
                    hits.append(result)
                report(done, len(cands))
        report(len(cands), len(cands), force=True)
        return hits

    def _chunk_size(self, ct: bytes, sample: bytes) -> int:
        """按实测的单条成本定分片大小，让第一条进度在 1 秒内出现。

        Args:
            ct: 待解密的密文，用它测单条耗时。
            sample: 拿来试的一条候选。
        Returns:
            每个 worker 一次领多少条。纯 Python 解 1MB 密文要近 1 秒，
            分片按条数拍脑袋会变成"进度条十几分钟不动"。
        """
        t = time.perf_counter()
        self.xxtea.decrypt_raw(ct, sample)
        per = max(time.perf_counter() - t, 1e-6)
        return max(1, min(256, int(1.0 / per)))


class _Reporter:
    """按时间节流的进度上报：不管候选池多大，至少每 ``interval`` 秒动一次。"""

    def __init__(self, fn: ProgressFn | None, started: float,
                 interval: float = REPORT_INTERVAL) -> None:
        self.fn = fn
        self.started = started
        self.interval = interval
        self._last = 0.0
        self._done = -1

    def __call__(self, done: int, total: int, *, force: bool = False) -> None:
        if self.fn is None or done == self._done:
            return
        now = time.perf_counter()
        if force or done >= total or now - self._last >= self.interval:
            self.fn(done, total, now - self.started)
            self._last = now
            self._done = done


__all__ = ['CrackExecutorImpl']

