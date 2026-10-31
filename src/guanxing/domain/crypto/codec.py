"""基础编解码：base64 / zlib。

游戏里这些"编码"和加密层层套：
    明文 JSON --zlib--> --XXTEA--> --base64--> --XXTEA--> --base64--> 落盘
"""
import base64
import binascii
import zlib

BytesLike = bytes | bytearray | memoryview

class Codec:
    """基础编解码：base64 / zlib。"""
    # ---------------- base64 ---------------
    @staticmethod
    def b64d(s: str|bytes) -> bytes | None:
        """宽松 base64 解码（自动补 padding，忽略空白）。"""
        if isinstance(s, str):
            s = s.encode('ascii', 'ignore')
        s = bytes(c for c in s if c not in b' \t\r\n')
        if len(s) % 4:
            s += b'=' * (4 - len(s) % 4)
        try:
            return base64.b64decode(s, validate=False)
        except (binascii.Error, ValueError):
            return None

    @staticmethod
    def b64e(b: BytesLike) -> str:
        return base64.b64encode(b).decode('ascii')

    # ---------------- zlib ---------------
    @staticmethod
    def zlib_d(b: BytesLike) -> bytes | None:
        try:
            return zlib.decompress(b)
        except zlib.error:
            return None

    @staticmethod
    def zlib_c(b: BytesLike, level: int = 6) -> bytes:
        return zlib.compress(b, level)
