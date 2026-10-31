"""爆破引擎：用 XXTEA 尾部长度字预言机判定候选钥匙是否命中。

正确的钥匙解出的末 4 字节必然落在 [n*4-7, n*4-4]，错误的钥匙是均匀分布的垃圾。
注意：误报率 4/2^32 ≈ 1e-9，所以"命中即可信"，但仍要用 zlib+JSON 复核存档本体。
"""

import time
from collections.abc import Callable, Iterable

from .xxtea import XXTEACrypto

Hit = tuple[bytes, int, bytes]
ProgressFn = Callable[[int, int, float], None]

# 进度回调的最小间隔。纯 Python 解 1MB 密文一条要近 1 秒，
# 每命中一条就报一次反而会把时间花在格式化与写终端上。
REPORT_INTERVAL = 0.25


class Oracle:
    def __init__(self, xxtea_crypto: XXTEACrypto) -> None:
        self.xxtea = xxtea_crypto

    def crack_single(self, ct: bytes, candidates: Iterable[str | bytes],
                     *, progress: ProgressFn | None = None) -> list[Hit]:
        """单进程爆破。

        Args:
            ct: 待解密的密文。
            candidates: 候选钥匙，16 字节的 bytes 或 str 都认。
            progress: 进度回调，签名 ``(done, total, elapsed)``，按时间节流。
        Returns:
            命中列表，每项是 ``(key, 长度字, 明文头 64B)``。
        """
        items = list(candidates)
        total = len(items)
        n = len(ct) // 4
        lo, hi = self.xxtea.length_window(n)
        hits: list[Hit] = []
        started = last = time.perf_counter()
        for done, k in enumerate(items, 1):
            raw = self.xxtea.decrypt_raw(ct, k)
            if raw is not None:
                lw = self.xxtea.tail_length(raw)
                if lo <= lw <= hi:
                    key = k if isinstance(k, bytes) else str(k).encode('latin-1', 'ignore')
                    hits.append((key, lw, raw[:64]))
            if progress is not None:
                now = time.perf_counter()
                if now - last >= REPORT_INTERVAL or done == total:
                    progress(done, total, now - started)
                    last = now
        return hits
