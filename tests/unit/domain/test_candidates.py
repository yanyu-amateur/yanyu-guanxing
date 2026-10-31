"""候选密钥生成 + maps 解析（纯函数，不碰 adb/进程）。"""
from __future__ import annotations

from guanxing.domain.crypto import candidates as cand
from guanxing.infra.memory.proc_maps import parse_maps, select_regions, total_bytes

SUFFIX = 'meeo0wmk'
PSW = 'ab12cd34'


# ───────────────────── 候选 ─────────────────────
def test_harvest_strings_pads_and_truncates() -> None:
    data = b'\x00\x00some-long-printable-token\x00\x00'
    out = cand.harvest_strings(data)
    assert all(len(c) == 16 for c in out)
    assert b'some-long-printa' in out          # 取头部 16 字节
    assert b'-printable-token' in out          # 取尾部 16 字节


def test_harvest_strings_skips_short_noise() -> None:
    assert cand.harvest_strings(b'\x00abc\x00\x01xyz\x00') == set()


def test_suffixed_candidates_finds_psw_before_suffix() -> None:
    """内存里 ``psw+suffix`` 挨着出现时，只产生一个候选 —— 极精确。"""
    data = b'\x00noise' + (PSW + SUFFIX).encode() + b'_tail\x00'
    out = cand.suffixed_candidates(data, [SUFFIX])
    assert (PSW + SUFFIX).encode() in out
    assert len(out) == 1


def test_suffixed_candidates_ignores_nonprintable_psw() -> None:
    data = b'\x00\x01\x02\x03\x04\x05\x06\x07' + SUFFIX.encode()
    assert cand.suffixed_candidates(data, [SUFFIX]) == set()


def test_expand_suffixes_cross_channel() -> None:
    """拿到安卓那把，就能就地推出 iOS 那把（psw 跨渠道复用）。"""
    android = (PSW + SUFFIX).encode()
    out = cand.expand_suffixes({android}, [SUFFIX, 'yoqkmrtj'])
    assert (PSW + 'yoqkmrtj').encode() in out
    assert android in out


def test_psw_anchored_candidates_reads_suffix_after_psw() -> None:
    """后缀未知时反向锚定：psw 后面那 8 个可打印字节就是后缀。"""
    unknown = 'zq83ndkx'
    data = b'\x00noise' + (PSW + unknown).encode() + b'\x00'
    out = cand.psw_anchored_candidates(data, [PSW])
    assert out == {(PSW + unknown).encode()}


def test_psw_anchored_candidates_ignores_nonprintable_suffix() -> None:
    data = PSW.encode() + b'\x00\x01\x02\x03\x04\x05\x06\x07'
    assert cand.psw_anchored_candidates(data, [PSW]) == set()


def test_psw_anchored_candidates_skips_wrong_length_psw() -> None:
    """psw 必须是 8 位，长度不对直接跳过（否则会拿半截去乱锚）。"""
    data = (PSW + 'zq83ndkx').encode()
    assert cand.psw_anchored_candidates(data, ['short', PSW + 'zz']) == set()


def test_normalize_dedupes_and_pads() -> None:
    """去重 + 补齐到 16 字节；输入是 list 时顺序保持稳定。"""
    out = cand.normalize([b'abcdefgh', b'abcdefgh', b'x'])
    assert out == [b'abcdefgh' + b'\x00' * 8, b'x' + b'\x00' * 15]


# ───────────────────── maps ─────────────────────
MAPS = """\
7f00-8f00 rw-p 00000000 00:00 0 
9000-9100 r--p 00000000 08:01 123 /system/lib/libc.so
a000-b000 rw-p 00000000 00:00 0 [heap]
b000-b020 r-xp 00000000 00:00 0 /data/app/libgame.so
"""


def test_parse_maps_fields() -> None:
    regs = parse_maps(MAPS)
    assert len(regs) == 4
    assert regs[0].start == 0x7F00 and regs[0].end == 0x8F00
    assert regs[0].is_anon and regs[0].readable
    assert regs[2].path == '[heap]'


def test_select_regions_filters_by_mode_and_size() -> None:
    regs = parse_maps(MAPS)
    picked = select_regions(regs, anon_only=True, min_kb=0)
    assert {r.path for r in picked} == {'', '[heap]'}
    # 加个下限，小段被剔掉
    assert all(r.size >= 4096 for r in select_regions(regs, anon_only=False, min_kb=4))
    assert total_bytes(regs) == 0x1000 + 0x100 + 0x1000 + 0x20
