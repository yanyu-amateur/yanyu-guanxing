"""XXTEA 单测：往返、长度预言机、边界。"""
from __future__ import annotations

import pytest

from guanxing.domain.crypto.xxtea import XXTEACrypto

KEY = 'LanJingNo1'


@pytest.fixture(scope='module')
def crypto() -> XXTEACrypto:
    return XXTEACrypto(has_cxxtea=False)


@pytest.mark.parametrize('n', [1, 2, 3, 4, 5, 8, 15, 16, 17, 63, 100, 1023])
def test_roundtrip_all_lengths(crypto, n: int) -> None:
    """任意长度都应能无损往返（含非 4 对齐的长度）。"""
    plain = bytes((i * 37 + 11) % 256 for i in range(n))
    cipher = crypto.encrypt_raw(plain, KEY)
    assert len(cipher) % 4 == 0, '密文必须 4 字节对齐'
    assert crypto.decrypt(cipher, KEY) == plain


def test_length_window_is_double_sided(crypto) -> None:
    """n 个字时合法长度必须落在 [4n-7, 4n-4]，两侧都要卡。"""
    assert crypto.length_window(3) == (5, 8)
    assert crypto.length_window(10) == (33, 36)


def test_wrong_key_is_rejected(crypto) -> None:
    cipher = crypto.encrypt_raw(b'hello world' * 10, KEY)
    assert crypto.decrypt(cipher, 'wrongkey12345678') is None


def test_key_normalised_to_16_bytes(crypto) -> None:
    """密钥不足 16 字节补零、超出截断 —— 与游戏行为一致。"""
    plain = b'abc' * 9
    cipher = crypto.encrypt_raw(plain, 'short')
    assert crypto.decrypt(cipher, b'short'.ljust(16, b'\x00')) == plain
    long_key = '0123456789abcdefEXTRA'
    cipher2 = crypto.encrypt_raw(plain, long_key)
    assert crypto.decrypt(cipher2, '0123456789abcdef') == plain


def test_empty_input(crypto) -> None:
    assert crypto.encrypt_raw(b'', KEY) == b''
    assert crypto.decrypt(b'', KEY) is None
