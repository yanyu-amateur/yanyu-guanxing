"""内层解码兜底链：抓包 psw 先落表 → 再扫内存拿整把钥匙（含表里没有的后缀）。

锁住一个真实踩过的坑：扫内存明明锚定到了后缀，代码却只把前 8 位当 psw 返回，
结果后缀被丢掉、下一步照样解不开。
"""
from __future__ import annotations

from dataclasses import replace
from pathlib import Path

import pytest

from guanxing.application.packs import CryptoStack
from guanxing.application.usecases._common import decode_with_hunt
from guanxing.bootstrap import build_settings
from guanxing.domain.errors import InnerKeyMissing, InnerKeyUnavailable
from guanxing.domain.keys.resolver import inner_candidates
from guanxing.shared.settings import MemMode
from tests.support import stacks_for

OUTER_KEY = '0123456789abcdef'
KNOWN_SUFFIX = 'po06ewkx'           # 内置表里就有
UNKNOWN_SUFFIX = 'zq83ndkx'         # 全新渠道，表里没有
NEW_VERSION = '00079999'            # 内置表里没有
NEW_PSW = 'zz11yy22'


def _cands(crypto: CryptoStack, version: str, runtime: str = 'android') -> list[str]:
    """内层候选——走 domain 的唯一实现（密钥库端口不再重复一套）。"""
    return inner_candidates(crypto.decoder.envelope.key_table, runtime, version)


@pytest.fixture
def crypto(tmp_path: Path) -> CryptoStack:
    stacks = stacks_for(build_settings(workspace=tmp_path))
    # 禁掉真实内存爆破：单测不该去连 adb
    return replace(stacks[0], hunt_inner_key=None)


def _content(crypto: CryptoStack, inner_key: str, version: str) -> str:
    data = {'MainRole': {'Name': '测试角色'}, 'globalVariable': {}}
    return crypto.decoder.envelope.build_new(data, version, inner_key, OUTER_KEY)


# ───────────────────── 扫内存拿到整把钥匙 ─────────────────────
def test_full_key_from_memory_is_used_as_is(crypto: CryptoStack) -> None:
    """扫到 ``psw+未知后缀`` 时，必须整把拿去试，不能退化成只记 psw。"""
    content = _content(crypto, NEW_PSW + UNKNOWN_SUFFIX, NEW_VERSION)
    asked: dict[str, str] = {}

    def hunt(version: str, body: bytes, *, runtime: str = 'android') -> str:
        asked['version'] = version
        asked['runtime'] = runtime
        return NEW_PSW + UNKNOWN_SUFFIX

    decoded = decode_with_hunt(replace(crypto, hunt_inner_key=hunt), content,
                               outer_key=OUTER_KEY)

    assert decoded.inner_key == NEW_PSW + UNKNOWN_SUFFIX
    assert asked == {'version': NEW_VERSION, 'runtime': 'android'}
    # 新后缀要跟着落盘，否则下次还得再扫一遍
    assert NEW_PSW + UNKNOWN_SUFFIX in _cands(crypto, NEW_VERSION)


def test_empty_hunt_result_keeps_inner_key_missing(crypto: CryptoStack) -> None:
    """内存里也没有时要抛原来那个错，而不是悄悄解出半个结果。"""
    content = _content(crypto, NEW_PSW + KNOWN_SUFFIX, NEW_VERSION)
    hunter = replace(crypto, hunt_inner_key=lambda *a, **k: '')

    with pytest.raises(InnerKeyMissing):
        decode_with_hunt(hunter, content, outer_key=OUTER_KEY)


def test_scan_cannot_run_reports_the_real_reason(crypto: CryptoStack) -> None:
    """扫描跑不起来时原因必须带到最终错误里，否则用户会以为密钥没收录。"""
    content = _content(crypto, NEW_PSW + KNOWN_SUFFIX, NEW_VERSION)

    def hunt(*_a, **_k):
        raise InnerKeyUnavailable('没有找到正在运行的游戏进程')

    with pytest.raises(InnerKeyMissing) as err:
        decode_with_hunt(replace(crypto, hunt_inner_key=hunt), content,
                         outer_key=OUTER_KEY)
    assert any('没有找到正在运行的游戏进程' in h for h in err.value.hints)


# ───────────────────── 抓包 psw：先在内存里试，通了才落表 ─────────────────────
def test_har_psw_is_enough_when_suffix_is_known(crypto: CryptoStack) -> None:
    """抓包给了 psw、后缀是已知渠道时，压根不该去扫内存。"""
    content = _content(crypto, NEW_PSW + KNOWN_SUFFIX, NEW_VERSION)
    called: list[int] = []

    def hunt(*args, **kwargs) -> str:
        called.append(1)
        return ''

    decoded = decode_with_hunt(replace(crypto, hunt_inner_key=hunt), content,
                               outer_key=OUTER_KEY, psw=NEW_PSW)

    assert decoded.inner_key == NEW_PSW + KNOWN_SUFFIX
    assert called == []
    # 解开了才登记，版本号取自存档本身
    assert NEW_PSW + KNOWN_SUFFIX in _cands(crypto, NEW_VERSION)


def test_har_psw_is_not_persisted_when_it_does_not_decode(
    crypto: CryptoStack, tmp_path: Path
) -> None:
    """psw 解不开时一个字节都不许写进 keys.json。"""
    keys_file = crypto.keystore.keys_path
    content = _content(crypto, NEW_PSW + UNKNOWN_SUFFIX, NEW_VERSION)
    before = keys_file.read_text(encoding='utf-8') if keys_file.exists() else None

    with pytest.raises(InnerKeyMissing):
        decode_with_hunt(replace(crypto, hunt_inner_key=lambda *a, **k: ''), content,
                         outer_key=OUTER_KEY, psw='wrongpsw')

    after = keys_file.read_text(encoding='utf-8') if keys_file.exists() else None
    assert after == before
    assert 'wrongpsw' not in (after or '')


def test_har_psw_falls_back_to_memory_when_suffix_is_new(
    crypto: CryptoStack,
) -> None:
    """抓包只给 psw，后缀是全新的 → 还得靠内存那一步补齐。"""
    content = _content(crypto, NEW_PSW + UNKNOWN_SUFFIX, NEW_VERSION)
    full = NEW_PSW + UNKNOWN_SUFFIX
    seen: dict[str, object] = {}

    def hunt(version: str, body: bytes, *, runtime: str = 'android') -> str:
        # 此时 psw 还没验证通过，表里不该有它（不能靠"先落表"来喂内存扫描）
        seen['cands'] = _cands(crypto, NEW_VERSION)
        return full

    decoded = decode_with_hunt(replace(crypto, hunt_inner_key=hunt), content,
                               outer_key=OUTER_KEY, psw=NEW_PSW)

    assert decoded.inner_key == full
    assert not any(c.startswith(NEW_PSW) for c in seen['cands'])  # type: ignore[union-attr]
    # 最终整把钥匙都进了表
    assert full in _cands(crypto, NEW_VERSION)


# ───────────────── ───── --mem off 一视同仁 ─────────────────
def test_mem_off_skips_inner_memory_scan(crypto: CryptoStack) -> None:
    """--mem off 必须同时拦住内层扫描，否则会白扫 1.6GB 内存。"""
    content = _content(crypto, NEW_PSW + UNKNOWN_SUFFIX, NEW_VERSION)
    called: list[int] = []

    def hunt(*_a, **_k) -> str:
        called.append(1)
        return NEW_PSW + UNKNOWN_SUFFIX

    with pytest.raises(InnerKeyMissing):
        decode_with_hunt(replace(crypto, hunt_inner_key=hunt), content,
                         outer_key=OUTER_KEY, mem_mode=MemMode.OFF)
    assert called == [], '--mem off 时不许碰内存'


def test_mem_off_still_reports_table_value(crypto: CryptoStack) -> None:
    """跳过扫描时，消息里仍要能看出"表里有这一版"。"""
    table = crypto.decoder.envelope.key_table
    table.add_version_psw(NEW_VERSION, 'badpsw99')
    content = _content(crypto, NEW_PSW + UNKNOWN_SUFFIX, NEW_VERSION)

    with pytest.raises(InnerKeyMissing) as err:
        decode_with_hunt(replace(crypto, hunt_inner_key=lambda *a, **k: ''),
                         content, outer_key=OUTER_KEY, mem_mode=MemMode.OFF)
    assert err.value.has_table_value
    assert err.value.table_value == 'badpsw99'


def test_scan_cannot_run_keeps_table_value(crypto: CryptoStack) -> None:
    """扫描跑不起来时，也要保留"表里有值"这个信息（不能退化成"缺密钥"）。"""
    table = crypto.decoder.envelope.key_table
    table.add_version_psw(NEW_VERSION, 'badpsw99')
    content = _content(crypto, NEW_PSW + UNKNOWN_SUFFIX, NEW_VERSION)

    def hunt(*_a, **_k):
        raise InnerKeyUnavailable('没有找到正在运行的游戏进程')

    with pytest.raises(InnerKeyMissing) as err:
        decode_with_hunt(replace(crypto, hunt_inner_key=hunt), content,
                         outer_key=OUTER_KEY)
    assert err.value.has_table_value
    assert any('没有找到正在运行的游戏进程' in h for h in err.value.hints)
