"""外层密钥解析：扫内存前要先问一句，别闷头扫 1.5GB。"""
from __future__ import annotations

from pathlib import Path

import pytest

from guanxing.application.dto import ImportOutcome, ImportRequest
from guanxing.application.services.outer_key_resolver import OuterKeyResolver
from guanxing.application.services.save_decoder import SaveDecoder
from guanxing.domain.crypto.xxtea import XXTEACrypto
from guanxing.domain.errors import REASON_NEEDS_MEMORY, OuterKeyUnavailable
from guanxing.domain.keys.table import KeyTable
from guanxing.domain.protocol.keys import ProtocolKeyDeriver
from guanxing.domain.save.envelope import SaveEnvelope
from guanxing.infra.keys.json_store import KeyStoreImpl
from guanxing.shared.settings import MemMode, Settings
from tests.support import RecordingProgress

VERSION = '00070001'
INNER = 'ab12cd34po06ewkx'
OUTER = '0123456789abcdef'
DATA = {'MainRole': {'Name': 'test'}}


def _settings(tmp_path: Path) -> Settings:
    from guanxing.bootstrap import build_settings

    return build_settings(workspace=tmp_path)


@pytest.fixture
def resolver_parts(tmp_path: Path):
    xxtea = XXTEACrypto(has_cxxtea=False)
    table = KeyTable()
    keystore = KeyStoreImpl(tmp_path / 'keys.json', tmp_path / 'keys.local.json', table)
    keystore.load()
    envelope = SaveEnvelope(xxtea, table)
    deriver = ProtocolKeyDeriver(xxtea)
    decoder = SaveDecoder(xxtea, envelope, deriver, RecordingProgress())
    content = envelope.build_new(DATA, VERSION, INNER, OUTER, 'dnkemiea', 1)
    return keystore, decoder, content


def test_auto_asks_before_scanning_memory(resolver_parts) -> None:
    """AUTO 模式：本地没有就抛 needs_memory 标记，绝不偷偷扫内存。"""
    keystore, decoder, content = resolver_parts
    scanned: list[str] = []

    def fake_memory(text: str) -> str:
        scanned.append(text)
        return OUTER

    resolver = OuterKeyResolver(keystore, decoder, RecordingProgress(), memory=fake_memory)

    with pytest.raises(OuterKeyUnavailable) as err:
        resolver.resolve(content, account='someone@example.com')
    assert err.value.tag == REASON_NEEDS_MEMORY
    assert 'someone@example.com' in err.value.message
    assert scanned == []                      # 没经过用户同意就不许扫


def test_force_does_scan_and_remembers(resolver_parts) -> None:
    keystore, decoder, content = resolver_parts
    resolver = OuterKeyResolver(keystore, decoder, RecordingProgress(),
                                memory=lambda _text: OUTER)

    key = resolver.resolve(content, account='acc', mem_mode=MemMode.FORCE)

    assert key == OUTER
    # 扫到之后就记住，下次 auto 直接命中（不再问）
    assert resolver.resolve(content, account='acc') == OUTER


def test_force_rejects_unverified_memory_key(resolver_parts) -> None:
    """内存里挖到的钥匙必须先自己能解开存档；解不开就不许落盘。"""
    keystore, decoder, content = resolver_parts
    resolver = OuterKeyResolver(keystore, decoder, RecordingProgress(),
                                memory=lambda _text: 'ffffffffffffffff')

    with pytest.raises(OuterKeyUnavailable) as err:
        resolver.resolve(content, account='acc', mem_mode=MemMode.FORCE)

    assert err.value.tag == ''
    # 错误值绝不能进 keys.local.json，否则下次 auto 会直接命中它
    assert keystore.outer_candidates('acc', None) == []


def test_force_still_tries_explicit_key(resolver_parts) -> None:
    """--mem force 只跳过表里记的值；--outer-key 是用户指令，必须优先试。"""
    keystore, decoder, content = resolver_parts
    scanned: list[str] = []

    def fake_memory(text: str) -> str:
        scanned.append(text)
        return 'ffffffffffffffff'

    resolver = OuterKeyResolver(keystore, decoder, RecordingProgress(), memory=fake_memory)

    assert resolver.resolve(content, explicit=OUTER, mem_mode=MemMode.FORCE) == OUTER
    assert scanned == []                     # 显式钥匙已经解开了，不必去扫内存


def test_off_still_tries_explicit_key(resolver_parts) -> None:
    """--mem off 也不该让手填的钥匙失效。"""
    keystore, decoder, content = resolver_parts
    resolver = OuterKeyResolver(keystore, decoder, RecordingProgress(),
                                memory=lambda _text: pytest.fail('不该扫内存'))

    assert resolver.resolve(content, explicit=OUTER, mem_mode=MemMode.OFF) == OUTER


def test_off_never_scans(resolver_parts) -> None:
    keystore, decoder, content = resolver_parts
    resolver = OuterKeyResolver(keystore, decoder, RecordingProgress(),
                                memory=lambda _text: OUTER)

    with pytest.raises(OuterKeyUnavailable) as err:
        resolver.resolve(content, mem_mode=MemMode.OFF)
    assert err.value.tag == ''                 # 不是"要征询"，是直接拒绝


def test_old_format_never_needs_outer_key(tmp_path: Path) -> None:
    xxtea = XXTEACrypto(has_cxxtea=False)
    table = KeyTable()
    store = KeyStoreImpl(tmp_path / 'k.json', tmp_path / 'l.json', table)
    store.load()
    envelope = SaveEnvelope(xxtea, table)
    decoder = SaveDecoder(xxtea, envelope, ProtocolKeyDeriver(xxtea), RecordingProgress())
    old = envelope.build_old(DATA, VERSION, INNER, 1)
    resolver = OuterKeyResolver(store, decoder, RecordingProgress(),
                                memory=lambda _text: pytest.fail('不该扫内存'))

    assert resolver.resolve(old) == ''


# ───────────────── 向导：确认后才扫，拒绝就转手填 ─────────────────
def _request() -> ImportRequest:
    return ImportRequest(source=Path('x.db'), out_dir=Path('out'))


def _run(call, *, ask_scan=None, ask_manual_key=None):
    """用给定的"调用替身"跑一遍重试策略（策略本身在 application 层）。"""
    from guanxing.application.usecases import run_import as mod

    def fake_usecase(req, crypto, storage, progress):
        return call(req)

    orig = mod.import_local
    mod.import_local = fake_usecase          # type: ignore[assignment]
    try:
        return mod.run_import(_request(), None, None, RecordingProgress(),
                              command='local', ask_scan=ask_scan,
                              ask_manual_key=ask_manual_key)
    finally:
        mod.import_local = orig              # type: ignore[assignment]


def test_wizard_confirms_then_retries_with_force(monkeypatch, tmp_path) -> None:
    from guanxing.interface.cli.interactive import wizard

    seen: list[str] = []

    def fake_call(req, *_a, **_kw):
        seen.append(req.mem_mode)
        if len(seen) == 1:
            raise OuterKeyUnavailable('本地没有外层密钥', tag=REASON_NEEDS_MEMORY)
        return ImportOutcome(ok=True)

    monkeypatch.setattr(wizard, 'confirm', lambda *a, **kw: True)

    prompter = wizard.InteractivePrompter(_settings(tmp_path), RecordingProgress())
    out = _run(fake_call, ask_scan=prompter.confirm_scan,
               ask_manual_key=prompter.ask_manual_key)

    assert out.ok
    assert seen == [MemMode.AUTO, MemMode.FORCE]     # 确认后带 force 重试


def test_wizard_declines_and_asks_for_key(monkeypatch, tmp_path) -> None:
    from guanxing.interface.cli.interactive import wizard

    seen: list[str] = []

    def fake_call(req, *_a, **_kw):
        seen.append(req.mem_mode)
        raise OuterKeyUnavailable('本地没有外层密钥', tag=REASON_NEEDS_MEMORY)

    monkeypatch.setattr(wizard, 'confirm', lambda *a, **kw: False)
    monkeypatch.setattr(wizard, 'ask', lambda *a, **kw: '')      # 手填也跳过

    prompter = wizard.InteractivePrompter(_settings(tmp_path), RecordingProgress())
    with pytest.raises(OuterKeyUnavailable):
        _run(fake_call, ask_scan=prompter.confirm_scan,
             ask_manual_key=prompter.ask_manual_key)
    assert seen == [MemMode.AUTO]              # 没去扫内存
