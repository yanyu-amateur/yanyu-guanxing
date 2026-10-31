"""爆破执行端口：把候选分片丢给多进程跑，只要命中结果。

实现见 ``infra/crypto/pool.py``。
注意：Windows 必须 spawn，worker 与共享数据都得是模块级对象，闭包传不进子进程。
"""
from __future__ import annotations

from collections.abc import Iterable
from typing import Protocol

from guanxing.domain.crypto.oracle import Hit, Oracle, ProgressFn
from guanxing.domain.crypto.xxtea import XXTEACrypto


class CrackExecutor(Protocol):
    def __init__(self, xxtea: XXTEACrypto, oracle: Oracle, threshold: int,
                 max_workers: int | None = None) -> None: ...

    def crack_single(self, ct: bytes, candidates: Iterable[bytes],
                     progress: ProgressFn | None = None) -> list[Hit]:
        """单进程爆破（候选少时用，避开起池开销）。

        Args:
            ct: 待解密的密文。
            candidates: 候选钥匙。
            progress: 进度回调，``(done, total, elapsed)``。
        Returns:
            命中列表。
        """
        ...

    def crack(self, ct: bytes, candidates: Iterable[bytes],
              progress: ProgressFn | None = None) -> list[Hit]:
        """对一段密文爆破候选钥匙。

        Args:
            ct: 待解密的密文。
            candidates: 候选钥匙。
            progress: 进度回调，``(done, total, elapsed)``。
        Returns:
            命中列表，每项是 ``(key, 长度字, 明文头 64B)``。
        """
        ...


__all__ = ['CrackExecutor', 'Hit', 'ProgressFn']