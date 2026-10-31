"""协议层密钥推导（对应 APK 里的 ProtocolEnvelope）。

key0 = 账号前 5 位 + eakec + 6 位种子，用它解 k 响应头得到内层种子，再拼出 realKey。
注意：realKey 只用来解 upload 请求体，与存档的外层/内层密钥无关。
"""
from ..constants import PROTOCOL_INNER_MAX, PROTOCOL_INNER_MIN, PROTOCOL_KEY_LEN, PROTOCOL_MIDDLE
from ..crypto.codec import Codec
from ..crypto.xxtea import XXTEACrypto
from ..errors import InvalidFormat


class ProtocolKeyDeriver:
    """协议层密钥推导器。"""
    def __init__(self, xxtea: XXTEACrypto) -> None:
        self.xxtea = xxtea

    def protocol_key(self, account: str, seed: bytes) -> bytes:
        """算 key0：账号前 5 位 + eakec + 6 位种子。

        Args:
            account: 账号。
            seed: 种子，缺省补 ``000000``。
        Returns:
            16 字节密钥。
        """
        buf = bytearray(b'0' * PROTOCOL_KEY_LEN)
        prefix = (account[:5] + PROTOCOL_MIDDLE).encode('ascii', 'ignore')[:10]
        buf[:len(prefix)] = prefix
        if seed:
            take = min(6, len(seed))
            buf[10:10 + take] = seed[:take]
        return bytes(buf)


    def derive(self, account: str, k_header: str) -> dict[str, str]:
        """返回 dict(key0, inner_k, real_key)。k_header 是响应头 k 的 base64 值。"""
        if not k_header:
            raise InvalidFormat('缺少 k 响应头（需要从"打开游戏之前"开始抓包）')
        k0 = self.protocol_key(account, b'')
        raw = Codec.b64d(k_header)
        if raw is None:
            raise InvalidFormat(f'k 头不是合法 base64: {k_header[:40]!r}')
        inner = self.xxtea.decrypt(raw, k0)
        if not inner or not (PROTOCOL_INNER_MIN <= len(inner) <= PROTOCOL_INNER_MAX):
            raise InvalidFormat('k 头解密失败或种子长度非法（acc 取错了？）')
        return {
            'key0': k0.decode('ascii'),
            'inner_k': inner.decode('latin-1'),
            'real_key': self.protocol_key(account, inner).decode('ascii'),
        }
