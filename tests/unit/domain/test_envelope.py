"""存档信封单测：构造 ↔ 解开往返、格式识别、候选顺序。

注意：解档只有一条生产路径 ``SaveDecoder.decode_content``；
这里直接用它是为了锁住"信封构造出来的东西，解码器解得回来"这个自洽性。
"""
from __future__ import annotations

import pytest

from guanxing.application.services.save_decoder import SaveDecoder
from guanxing.domain.crypto.xxtea import XXTEACrypto
from guanxing.domain.errors import InnerKeyMissing, OuterKeyRejected
from guanxing.domain.keys.table import KeyTable
from guanxing.domain.protocol.keys import ProtocolKeyDeriver
from guanxing.domain.save.envelope import SaveEnvelope
from guanxing.domain.save.format import detect_format, parse_old
from guanxing.domain.save.types import SaveFormatType
from tests.support import RecordingProgress

VERSION = '00073440'
INNER = 'pon1dxg7po06ewkx'      # 内置表里 73440 的 psw + android 后缀
OUTER = '0123456789abcdef'
DATA = {'DBVersion': 73440, 'EncryptID': 'ACC', 'MainRole': {'Name': '测试角色'}}


@pytest.fixture()
def env() -> SaveEnvelope:
    return SaveEnvelope(XXTEACrypto(has_cxxtea=False), KeyTable())


@pytest.fixture()
def decoder(env: SaveEnvelope) -> SaveDecoder:
    return SaveDecoder(env.xxtea, env, ProtocolKeyDeriver(env.xxtea), RecordingProgress())


def test_old_roundtrip(env: SaveEnvelope, decoder: SaveDecoder) -> None:
    content = env.build_old(DATA, VERSION, INNER)
    assert detect_format(content) is SaveFormatType.OLD
    decoded = decoder.decode_content(content, runtime='android')
    assert decoded.data == DATA
    assert decoded.version == VERSION
    assert decoded.inner_key == INNER


def test_new_roundtrip(env: SaveEnvelope, decoder: SaveDecoder) -> None:
    content = env.build_new(DATA, VERSION, INNER, OUTER, marker='dnkemiea')
    assert detect_format(content) is SaveFormatType.NEW
    decoded = decoder.decode_content(content, runtime='android', outer_key=OUTER)
    assert decoded.data == DATA
    assert decoded.marker == 'dnkemiea'
    assert decoded.outer_key == OUTER


def test_new_rejects_wrong_outer_key(env: SaveEnvelope, decoder: SaveDecoder) -> None:
    content = env.build_new(DATA, VERSION, INNER, OUTER)
    with pytest.raises(OuterKeyRejected):
        decoder.decode_content(content, runtime='android', outer_key='0' * 16)


def test_unknown_version_raises_inner_missing(env: SaveEnvelope,
                                              decoder: SaveDecoder) -> None:
    content = env.build_old(DATA, '00099999', INNER)
    with pytest.raises(InnerKeyMissing) as exc:
        decoder.decode_content(content, runtime='android')
    assert exc.value.context['version'] == '00099999'


def test_parse_old_rejects_garbage() -> None:
    from guanxing.domain.errors import InvalidFormat
    with pytest.raises(InvalidFormat):
        parse_old('not-a-save')


def test_inner_candidate_order_starts_with_table_value(env: SaveEnvelope) -> None:
    cands = env.inner_candidates(VERSION, 'android')
    assert cands[0] == INNER
    assert 'pon1dxg7meeo0wmk' in cands   # 跨渠道兜底
    assert 'pon1dxg7' in cands           # 后缀为空的历史版本


def test_envelope_and_resolver_share_one_candidate_list(env: SaveEnvelope) -> None:
    """两条路径必须是同一份候选——各写一套就会一边能解、一边解不开。"""
    from guanxing.domain.keys.resolver import inner_candidates as shared

    assert env.inner_candidates(VERSION, 'ios') == shared(env.key_table, 'ios', VERSION)


# ───────────── 更换外层标记（只换那 8 个字符，存档一个字节没变） ─────────────
NEW_MARKER = 'zzzzzzzz'


def test_any_marker_still_decodes(env: SaveEnvelope, decoder: SaveDecoder) -> None:
    """标记不参与加解密：换了标记也必须照解，不能卡在"格式识别"这一步。"""
    content = env.build_new(DATA, VERSION, INNER, OUTER, marker=NEW_MARKER)
    assert detect_format(content) is SaveFormatType.NEW
    decoded = decoder.decode_content(content, runtime='android', outer_key=OUTER)
    assert decoded.data == DATA
    assert decoded.marker == NEW_MARKER


def test_marker_change_produces_no_noise(env: SaveEnvelope) -> None:
    """换标记是正常现象，不该有任何提示——没有名单，也就没有"未登记"这回事。"""
    progress = RecordingProgress()
    decoder = SaveDecoder(env.xxtea, env, ProtocolKeyDeriver(env.xxtea), progress)
    content = env.build_new(DATA, VERSION, INNER, OUTER, marker=NEW_MARKER)
    decoder.decode_content(content, runtime='android', outer_key=OUTER)
    assert progress.hints == []


def test_old_format_is_not_mistaken_for_new(env: SaveEnvelope, decoder: SaveDecoder) -> None:
    """两种形状完全重合，必须先判 old —— 否则初版存档会被当成新版去要外层密钥。"""
    content = env.build_old(DATA, VERSION, INNER)
    assert detect_format(content) is SaveFormatType.OLD
    assert decoder.decode_content(content, runtime='android').save_format == 'old'


def test_shape_mismatch_is_rejected() -> None:
    """不维护名单 ≠ 放行一切：形状不对还是要报格式错误。"""
    assert detect_format('zzzzzzzz' + 'not base64!!') is None
    assert detect_format('zzzzzzzz' + 'QUJDREVGR0hJSktMTU5PU') is None      # 长度不对齐
    assert detect_format('   x    ' + 'QUJDREVGR0hJSktMTU5PUA==') is None   # 前缀有空白
    assert detect_format('zzzz') is None


@pytest.mark.parametrize('garbage', [
    'zzzzzzzz' + '这串中文很长很长很长很长' * 20,      # 非 ASCII
    'zzzzzzzz' + 'aaa,bbb,ccc,ddd,' * 100,              # 逗号不在 base64 字母表里
    'zzzzzzzz' + 'abcd*efgh/ijkl' * 100,
    'zzzzzzzz' + 'x' * 4095,                            # 长度不对齐
])
def test_garbage_that_looks_printable_is_not_accepted(garbage: str) -> None:
    """随机可打印串约 8% 会碰巧像新版，尾部必须是严格 base64 才收。"""
    assert detect_format(garbage) is None
