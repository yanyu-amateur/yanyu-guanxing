"""内存爆破：用假设备/假内存喂真加密，验证「外层密钥 + psw 都能挖出来」。

为什么不开真模拟器：单测要能在 CI 跑。这里只把端口换成假的，
XXTEA、候选生成、预言机、zlib+JSON 复核全是真代码 —— 真出错照样会红。
"""
from __future__ import annotations

import pytest

from guanxing.application.ports.device import DeviceInfo
from guanxing.application.ports.memory import Region
from guanxing.application.services.memory_hunter import MemoryKeyHunter
from guanxing.domain.crypto.oracle import Oracle
from guanxing.domain.crypto.xxtea import XXTEACrypto
from guanxing.domain.errors import OuterKeyUnavailable
from guanxing.domain.keys.table import KeyTable
from guanxing.domain.save.envelope import SaveEnvelope
from guanxing.domain.save.format import parse_old
from guanxing.infra.crypto.pool import CrackExecutorImpl
from guanxing.shared.progress import ProgressSink
from tests.support import RecordingProgress

OUTER_KEY = 'A1b2C3d4E5f6G7h8'
SUFFIX = 'meeo0wmk'
PSW = 'ab12cd34'
VERSION = '00070001'
PACKAGE = 'com.example.game'


class FakeDevice:
    def __init__(self, pid: str | None = '4242') -> None:
        self.pid = pid

    def devices(self):
        return [DeviceInfo(serial='emulator-5554')]

    def detect_save_packages(self) -> list[str]:
        return [PACKAGE]

    def pid_of(self, package: str) -> str | None:
        return self.pid if package == PACKAGE else None


class FakeMemory:
    def __init__(self, blob: bytes) -> None:
        self.blob = blob

    def regions(self, pid, *, anon_only=True, min_kb=64, max_mb=None):
        return [Region(start=0x1000, end=0x1000 + len(self.blob))]

    def read_region(self, pid, region, *, max_mb=64, chunk_mb=64, on_progress=None):
        return self.blob


def _hunter(blob: bytes, *, pid: str | None = '4242',
            table: KeyTable | None = None,
            progress: ProgressSink | None = None) -> MemoryKeyHunter:
    """搭一台只用假设备/假内存的门面；progress 省略时挂记录器。"""
    xxtea = XXTEACrypto()
    envelope = SaveEnvelope(xxtea, table or KeyTable())
    # threshold 极大 → 强制单进程，避免 pytest 里 spawn 进程池（慢且难排查）
    executor = CrackExecutorImpl(xxtea, Oracle(xxtea), threshold=10**9, max_workers=1)
    return MemoryKeyHunter(
        open_device=lambda **kw: FakeDevice(pid),
        open_memory=lambda **kw: FakeMemory(blob),
        executor=executor,
        xxtea=xxtea,
        envelope=envelope,
        progress=progress or RecordingProgress(),
        packages=(PACKAGE,),
    )


def _new_save(envelope: SaveEnvelope) -> str:
    data = {'MainRole': {'Name': '测试角色'}, 'globalVariable': {}}
    inner = PSW + SUFFIX
    return envelope.build_new(data, VERSION, inner, OUTER_KEY, marker='dnkemiea')


# ───────────────────── 外层密钥 ─────────────────────
def test_crack_outer_key_from_memory() -> None:
    envelope = SaveEnvelope(XXTEACrypto(), KeyTable())
    content = _new_save(envelope)
    hunter = _hunter(OUTER_KEY.encode() + b'\x00padding\x00')

    assert hunter.outer_key(content) == OUTER_KEY


def test_crack_outer_key_reports_when_nothing_matches() -> None:
    envelope = SaveEnvelope(XXTEACrypto(), KeyTable())
    content = _new_save(envelope)
    hunter = _hunter(b'\x00nothing-useful-here\x00')

    with pytest.raises(OuterKeyUnavailable) as err:
        hunter.outer_key(content)
    assert err.value.retry_with_outer_key is False
    assert 'outer' in err.value.message or '外层' in err.value.message


def test_missing_anchors_warns_before_cracking() -> None:
    """锚点全 0 说明内存里没有游戏的密钥痕迹：先警告，别让人干等几小时。"""
    envelope = SaveEnvelope(XXTEACrypto(), KeyTable())
    content = _new_save(envelope)
    recorder = RecordingProgress()
    hunter = _hunter(b'\x00nothing-useful-here\x00', progress=recorder)

    with pytest.raises(OuterKeyUnavailable):
        hunter.outer_key(content)

    joined = ' | '.join(recorder.warns)
    assert '角色界面' in joined, '要指向"还没进角色界面"这个真实原因'
    before_crack = recorder.events.index('warn') < recorder.events.index('爆破外层密钥')
    assert before_crack, '警告要在开爆破之前出现'


def test_crack_outer_key_needs_running_game() -> None:
    envelope = SaveEnvelope(XXTEACrypto(), KeyTable())
    content = _new_save(envelope)
    hunter = _hunter(b'whatever', pid=None)

    with pytest.raises(OuterKeyUnavailable) as err:
        hunter.outer_key(content)
    assert '进程' in err.value.message


def test_old_format_has_no_outer_key_to_crack() -> None:
    envelope = SaveEnvelope(XXTEACrypto(), KeyTable())
    content = envelope.build_old({'a': 1}, VERSION, PSW + SUFFIX)
    hunter = _hunter(b'anything')

    with pytest.raises(OuterKeyUnavailable):
        hunter.outer_key(content)


# ───────────────────── 内层密钥 ─────────────────────
def test_crack_inner_key_from_suffix_anchor() -> None:
    """内存里只要出现 ``psw+suffix``，就能精确取出整把内层密钥。"""
    envelope = SaveEnvelope(XXTEACrypto(), KeyTable())
    content = envelope.build_old({'a': 1}, VERSION, PSW + SUFFIX)
    hunter = _hunter(b'\x00gg' + (PSW + SUFFIX).encode() + b'\x00zz')

    assert hunter.inner_key(VERSION, parse_old(content)[1]) == PSW + SUFFIX


def test_crack_inner_key_returns_empty_when_not_found() -> None:
    envelope = SaveEnvelope(XXTEACrypto(), KeyTable())
    content = envelope.build_old({'a': 1}, VERSION, PSW + SUFFIX)
    hunter = _hunter(b'\x00totally-unrelated\x00')

    assert hunter.inner_key(VERSION, parse_old(content)[1]) == ''


def test_inner_key_expands_to_other_channels() -> None:
    """内存里只有安卓后缀，也能推出 iOS 的那把内层密钥。"""
    envelope = SaveEnvelope(XXTEACrypto(), KeyTable())
    ios_inner = PSW + 'yoqkmrtj'
    content = envelope.build_old({'a': 1}, VERSION, ios_inner)

    hunter = _hunter(b'\x00' + (PSW + SUFFIX).encode() + b'\x00')

    assert hunter.inner_key(VERSION, parse_old(content)[1]) == ios_inner


def test_inner_key_found_when_suffix_is_unknown() -> None:
    """psw 在表里、后缀是全新渠道时，靠反向锚定把整把钥匙挖出来。"""
    unknown_suffix = 'zq83ndkx'
    version = '00077777'          # 内置表里没有，psw 全靠下面这一行提供
    psw = 'ab12cd34'
    table = KeyTable()
    table.add_version_psw(version, psw)

    envelope = SaveEnvelope(XXTEACrypto(), KeyTable())
    content = envelope.build_old({'a': 1}, version, psw + unknown_suffix)
    # 内存里只有 psw 后面跟着一个表里没有的 8 字节后缀
    hunter = _hunter(b'\x00\x01' + (psw + unknown_suffix).encode() + b'\x00\x02',
                     table=table)

    assert hunter.inner_key(version, parse_old(content)[1]) == psw + unknown_suffix


def test_scan_collects_psw_anchor_separately() -> None:
    """扫描要把「psw 锚定」单独留一份，否则后缀未知时无从下手。"""
    version = '00077777'
    psw = 'ab12cd34'
    suffix = 'zq83ndkx'
    table = KeyTable()
    table.add_version_psw(version, psw)

    hunter = _hunter(b'\x00' + (psw + suffix).encode() + b'\x00', table=table)
    cands = hunter.scan('4242')

    assert (psw + suffix).encode() in cands.psw_anchored
    assert (psw + suffix).encode() in cands.inner_pool()


def test_scan_is_cached_per_pid() -> None:
    hunter = _hunter(b'\x00' + (PSW + SUFFIX).encode() + b'\x00')
    first = hunter.scan('4242')
    second = hunter.scan('4242')
    assert first is second


def test_scan_rescans_when_new_psw_appears() -> None:
    """先扫外层、之后才从抓包学到新 psw 时，缓存必须失效，否则新锚点永远缺一块。"""
    suffix = 'zq83ndkx'
    psw = 'ab12cd34'
    table = KeyTable()
    hunter = _hunter(b'\x00' + (psw + suffix).encode() + b'\x00', table=table)

    first = hunter.scan('4242')
    assert first.psw_anchored == frozenset()

    table.add_version_psw('00077777', psw)
    second = hunter.scan('4242')

    assert second is not first
    assert (psw + suffix).encode() in second.psw_anchored
    assert first.strings <= second.strings     # 旧候选要并进去，不能丢
