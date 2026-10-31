from enum import Enum

class Padding(str, Enum):
    PKCS7_4_MIN8 = ...
    PKCS7_8 = ...
    LENGTH_WORD_PREFIX = ...
    LENGTH_WORD_SUFFIX = ...
    NONE = ...

VERSION: str

PKCS7_4_MIN8: Padding
PKCS7_8: Padding
LENGTH_WORD_PREFIX: Padding
LENGTH_WORD_SUFFIX: Padding


PaddingT = type[Padding]
_Pad = Padding
PaddingArg = Padding | str | bool | None


class XXTEA:
    Padding: PaddingT
    PKCS7_4_MIN8: _Pad
    PKCS7_8: _Pad
    LENGTH_WORD_PREFIX: _Pad
    LENGTH_WORD_SUFFIX: _Pad

    def __init__(
        self,
        key: bytes,
        padding: PaddingArg = ...,
        rounds: int = ...,
    ) -> None: ...
    # 实例方法只收一个位置参数（C 层 METH_O）
    def encrypt(self, data: bytes, /) -> bytes: ...
    def decrypt(self, data: bytes, /) -> bytes: ...
    def encrypt_hex(self, data: bytes, /) -> bytes: ...
    def decrypt_hex(self, data: bytes, /) -> bytes: ...

def encrypt(
    data: bytes, key: bytes,
    padding: PaddingArg = ..., rounds: int = ...,
) -> bytes: ...
def decrypt(
    data: bytes, key: bytes,
    padding: PaddingArg = ..., rounds: int = ...,
) -> bytes: ...
def encrypt_hex(
    data: bytes, key: bytes,
    padding: PaddingArg = ..., rounds: int = ...,
) -> bytes: ...
def decrypt_hex(
    data: bytes, key: bytes,
    padding: PaddingArg = ..., rounds: int = ...,
) -> bytes: ...