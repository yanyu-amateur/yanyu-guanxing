"""游戏全套加密用的 XXTEA（Cocos 变体）。

与标准实现的差别只有一处：明文尾部带 4 字节长度字，解出来要按它切掉补零。
注意：长度字同时是最好的钥匙预言机，双侧校验不能少，否则误报率从 1e-9 涨到 1e-4。
"""
import struct

from ..constants import MASK32, XXTEA_DELTA, XXTEA_LEN_HEAD, XXTEA_LEN_TAIL
from ..errors import InvalidFormat


class XXTEACrypto:
    """XXTEA 加解密器。"""
    def __init__(self, has_cxxtea: bool = False) -> None:
        self.has_cxxtea = has_cxxtea

    # ---------------- tool ----------------
    def _norm_key(self, key: str|bytes) -> bytes:
        """key -> 16 字节（不足补 0，超出截断）。游戏就是这么做的。"""
        if isinstance(key, str):
            key = key.encode('utf-8')
        return key[:16].ljust(16, b'\x00')

    def _bytes_to_words(self, data: bytes) -> list[int]:
        """小端 4 字节 -> uint32 列表；末尾不足 4 字节补 0。"""
        pad = (-len(data)) % 4
        if pad:
            data = data + b'\x00' * pad
        return list(struct.unpack(f'<{len(data) // 4}I', data))

    def _words_to_bytes(self, words: list[int]) -> bytes:
        return struct.pack(f'<{len(words)}I', *[w & MASK32 for w in words])

    def length_window(self, n: int) -> tuple[int, int]:
        """n 个字时，符合要求的合法长度字区间。"""
        return n * 4 - XXTEA_LEN_TAIL, n * 4 - XXTEA_LEN_HEAD

    def tail_length(self, raw: bytes) -> int:
        """从未裁剪的明文缓冲里读出长度字。"""
        if len(raw) < 4:
            return -1
        return struct.unpack_from('<I', raw, len(raw) - 4)[0]

    # ---------------- decrypt ----------------
    def decrypt_raw_by_c(self, data: bytes, key: str | bytes) -> None | bytes:
        import xxtea as _cxxtea
        try:
            return _cxxtea.decrypt(data, self._norm_key(key), padding=False)
        except Exception:
            return None

    def decrypt_raw_by_py(self, data: bytes, key: str | bytes) -> None | bytes:
        n = len(data) // 4
        if n < 2:
            return None
        v = list(struct.unpack(f'<{n}I', data[:n * 4]))
        k = self._bytes_to_words(self._norm_key(key))
        rounds = 6 + 52 // n
        total = (rounds * XXTEA_DELTA) & MASK32
        y = v[0]
        while total:
            e = (total >> 2) & 3
            for p in range(n - 1, 0, -1):
                z = v[p - 1]
                mx = (((z >> 5) ^ ((y << 2) & MASK32)) +
                    ((y >> 3) ^ ((z << 4) & MASK32))) & MASK32
                mx = (mx ^ ((total ^ y) + (k[(p & 3) ^ e] ^ z))) & MASK32
                v[p] = (v[p] - mx) & MASK32
                y = v[p]
            z = v[n - 1]
            mx = (((z >> 5) ^ ((y << 2) & MASK32)) +
                ((y >> 3) ^ ((z << 4) & MASK32))) & MASK32
            mx = (mx ^ ((total ^ y) + (k[e] ^ z))) & MASK32
            v[0] = (v[0] - mx) & MASK32
            y = v[0]
            total = (total - XXTEA_DELTA) & MASK32
        return self._words_to_bytes(v)

    def decrypt_raw(self, data: bytes, key: str | bytes) -> bytes | None:
        """解密但不校验长度字；C 扩展走不通就退回纯 Python。"""
        if not data:
            return None
        n = len(data) // 4
        if n < 2:
            return None
        data = data[:n * 4]
        if self.has_cxxtea:
            raw = self.decrypt_raw_by_c(data, key)   # 它自己吞异常，None 就是这条路走不通
            if raw is not None:
                return raw
        return self.decrypt_raw_by_py(data, key)

    def decrypt(self, data: bytes, key: str | bytes) -> None | bytes:
        """解密并按长度字裁掉补零。

        Args:
            data: 密文。
            key: 钥匙。
        Returns:
            明文；长度字不在合法区间（钥匙不对）时返回 None。长度字必须双侧校验，
            只校验上界会把误报率从 1e-9 抬到 1e-4。
        """
        raw = self.decrypt_raw(data, key)
        if raw is None:
            return None
        n = len(raw) // 4
        lw = self.tail_length(raw)
        lo, hi = self.length_window(n)
        if not (lo <= lw <= hi):
            return None
        return raw[:lw]

    # ---------------- encrypt ----------------
    def encrypt_raw_by_c(self, data: bytes, key: str | bytes)  -> bytes:
        import xxtea as _cxxtea
        try:
            out = _cxxtea.encrypt(data, self._norm_key(key), padding=False)
        except Exception as exc:
            raise InvalidFormat('C 扩展加密失败') from exc
        if not out or len(out) != len(data):
            raise InvalidFormat('加密后长度不对')
        return out

    def _encrypt_raw_by_py(self, data: bytes, key: str | bytes) -> bytes:
        """纯 Python 的 XXTEA 加密，加密携带 z、解密携带 y，写反会自己解不开自己。

        Args:
            data: 4 字节对齐的明文缓冲。
            key: 钥匙。
        Returns:
            密文。
        """
        n = len(data) // 4
        if n < 2:
            raise InvalidFormat('明文长度不足 8 字节')
        v: list[int] = list(struct.unpack(f'<{n}I', data[:n * 4]))
        k = self._bytes_to_words(self._norm_key(key))
        rounds = 6 + 52 // n
        total = 0
        z = v[n - 1]
        for _ in range(rounds):
            total = (total + XXTEA_DELTA) & MASK32
            e = (total >> 2) & 3
            for p in range(n - 1):
                y = v[p + 1]
                mx = (((z >> 5) ^ ((y << 2) & MASK32)) +
                    ((y >> 3) ^ ((z << 4) & MASK32))) & MASK32
                mx = (mx ^ ((total ^ y) + (k[(p & 3) ^ e] ^ z))) & MASK32
                v[p] = (v[p] + mx) & MASK32
                z = v[p]                       # 携带更新后的 v[p]
            y = v[0]
            mx = (((z >> 5) ^ ((y << 2) & MASK32)) +
                ((y >> 3) ^ ((z << 4) & MASK32))) & MASK32
            mx = (mx ^ ((total ^ y) + (k[((n - 1) & 3) ^ e] ^ z))) & MASK32
            v[n - 1] = (v[n - 1] + mx) & MASK32
            z = v[n - 1]
        return self._words_to_bytes(v)

    def encrypt_raw(self, data: bytes, key: str | bytes)  -> bytes:
        """加密（自动补零 + 附长度字），与 `decrypt` 严格互逆。"""
        if not data:
            return b''
        body = data + b'\x00' * ((-len(data)) % 4)
        buf = body + struct.pack('<I', len(data))
        if self.has_cxxtea:
            return self.encrypt_raw_by_c(buf, key)
        return self._encrypt_raw_by_py(buf, key)
