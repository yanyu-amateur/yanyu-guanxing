"""旧版 HAR（upload 体里带存档）不需要 dat.db 也能解。"""
from __future__ import annotations

import base64
import json
import uuid
from dataclasses import replace
from pathlib import Path

import pytest

from guanxing.application.dto import ImportRequest
from guanxing.application.packs import CryptoStack, StorageStack
from guanxing.application.usecases.import_capture import import_capture
from guanxing.application.usecases.probe_capture import probe_capture
from guanxing.bootstrap import build_settings
from guanxing.domain.crypto.xxtea import XXTEACrypto
from guanxing.domain.errors import OuterKeyUnavailable
from guanxing.domain.protocol.keys import ProtocolKeyDeriver
from tests.support import RecordingProgress, stacks_for

# 全部合成值：账号是 32 位占位串，k 头由 seed 现算，与任何真实账号无关
ACC = 'TESTACC' + '0' * 25
SEED = b'seed01'
_XXTEA = XXTEACrypto(has_cxxtea=False)
K_HEADER = base64.b64encode(
    _XXTEA.encrypt_raw(SEED, ProtocolKeyDeriver(_XXTEA).protocol_key(ACC, b''))
).decode('ascii')
VERSION = '00073440'
INNER_KEY = 'pon1dxg7po06ewkx'          # 00073440 的 psw + 安卓主后缀
OUTER_KEY = '0123456789abcdef'          # 合成的外层密钥（与任何真实账号无关）


def _save(fields: int = 2000) -> dict:
    """造一份真实体量的存档（随机值不可压缩，才能过 64KB 预筛）。"""
    data: dict = {'MainRole': {'Name': '测试角色'}, 'BaseSID': 1}
    for i in range(fields):
        data[f'k{i}'] = uuid.uuid4().hex
    return data


DATA = _save()


@pytest.fixture
def crypto(tmp_path: Path) -> CryptoStack:
    stacks = stacks_for(build_settings(workspace=tmp_path))
    # 禁掉内存爆破：测试不该去连 adb
    return replace(stacks[0], hunt_inner_key=None)


@pytest.fixture
def storage(tmp_path: Path) -> StorageStack:
    return stacks_for(build_settings(workspace=tmp_path))[1]


def _entry(command: str, *, body: str = '', k_header: str = K_HEADER,
           ver: str = VERSION) -> dict:
    headers = [
        {'name': 'command', 'value': command},
        {'name': 'acc', 'value': ACC},
        {'name': 'area', 'value': '1'},
        {'name': 'ver', 'value': ver},
    ]
    resp_headers = [{'name': 'k', 'value': k_header}] if k_header else []
    return {
        'startedDateTime': '2026-01-01T00:00:00Z',
        'time': 1.0,
        'request': {
            'method': 'POST',
            'url': 'http://andr.wlfy.blue8.cn/api_command',
            'httpVersion': 'HTTP/1.1',
            'cookies': [],
            'headers': headers,
            'queryString': [],
            'postData': {'mimeType': 'text/plain', 'text': body},
            'headersSize': 0,
            'bodySize': 0,
        },
        'response': {
            'status': 200,
            'statusText': 'OK',
            'httpVersion': 'HTTP/1.1',
            'cookies': [],
            'headers': resp_headers,
            'content': {'mimeType': 'application/json', 'text': ''},
            'redirectURL': '',
            'headersSize': 0,
            'bodySize': 0,
        },
        'cache': {},
        'timings': {},
    }


def _har(tmp_path: Path, entries: list[dict]) -> Path:
    path = tmp_path / 'old.har'
    path.write_text(json.dumps({'log': {
        'version': '1.2',
        'creator': {'name': 't', 'version': '1'},
        'entries': entries,
    }}), encoding='utf-8')
    return path


def _upload_body(crypto: CryptoStack, *, garbage: bool = False) -> str:
    """造一份旧版 upload 请求体：base64( XXTEA(content, realKey) )。"""
    real_key = crypto.deriver.derive(ACC, K_HEADER)['real_key']
    if garbage:
        plain = b'\xff' * 70_000              # 交给 XXTEA 也解不出可读文本（但要过预筛）
    else:
        plain = crypto.decoder.envelope.build_old(DATA, VERSION, INNER_KEY, 1).encode('ascii')
    return base64.b64encode(crypto.decoder.xxtea.encrypt_raw(plain, real_key)).decode('ascii')


def _req(har: Path, tmp_path: Path, **kw) -> ImportRequest:
    return ImportRequest(source=har, runtime='android', out_dir=tmp_path / 'out', **kw)


def _steps(out) -> dict[str, str]:
    return {step.label: step.value for step in out.steps}


def test_old_har_decodes_without_dat_db(crypto, storage, tmp_path: Path) -> None:
    """upload 体里有存档 → 不需要 --db。"""
    body = _upload_body(crypto)
    assert len(body) >= 64_000                  # 确认过预筛阈值
    har = _har(tmp_path, [_entry('upload2', body=body)])

    out = import_capture(_req(har, tmp_path), crypto, storage, RecordingProgress())

    assert out.ok
    assert out.version == VERSION
    assert out.data['MainRole']['Name'] == '测试角色'
    assert 'upload' in _steps(out)['存档来源']


def test_small_upload_bodies_are_ignored(crypto, storage, tmp_path: Path) -> None:
    """小请求（uploadLocation 之类）不参与解密，避免白花时间。"""
    body = _upload_body(crypto)
    har = _har(tmp_path, [
        _entry('uploadLocation', body='q1lrngvC27pE5zc='),
        _entry('upload2', body=body),
    ])

    out = import_capture(_req(har, tmp_path), crypto, storage, RecordingProgress())
    assert out.ok
    assert _steps(out)['存档来源'] == 'upload（upload2）'


def test_old_har_with_changed_marker_is_not_silently_dropped(
        crypto, storage, tmp_path: Path
) -> None:
    """如果更换外层标记，upload 体里的存档不许被当成没找到丢掉。"""
    real_key = crypto.deriver.derive(ACC, K_HEADER)['real_key']
    inner = crypto.decoder.envelope.build_new(
        DATA, VERSION, INNER_KEY, OUTER_KEY, marker='zzzzzzzz')
    body = base64.b64encode(
        crypto.decoder.xxtea.encrypt_raw(inner.encode('ascii'), real_key)).decode('ascii')
    har = _har(tmp_path, [_entry('upload2', body=body)])

    out = import_capture(
        _req(har, tmp_path, outer_key=OUTER_KEY), crypto, storage, RecordingProgress())

    assert out.ok, '换标记后 old HAR 路径必须仍然能解'
    assert out.marker == 'zzzzzzzz'
    assert _steps(out)['存档来源'] == 'upload（upload2）'


def test_new_style_body_without_download_reports_session_key(
        crypto, storage, tmp_path: Path) -> None:
    """新版 body 解不开且没有 download → 明确说是会话密钥加密。"""
    har = _har(tmp_path, [_entry('upload3', body=_upload_body(crypto, garbage=True))])

    with pytest.raises(OuterKeyUnavailable) as err:
        import_capture(_req(har, tmp_path), crypto, storage, RecordingProgress())
    assert 'download' in err.value.message
    assert not err.value.retry_with_outer_key


def test_undecryptable_body_then_requires_dat_db(crypto, storage, tmp_path: Path) -> None:
    """解不开又没有 --db 时，错误要指向 dat.db（而不是笼统的“解不出 psw”）。"""
    har = _har(tmp_path, [_entry('upload3', body=_upload_body(crypto, garbage=True))])
    download = _entry('download', body='')
    download['response']['content']['text'] = json.dumps(
        {'code': '0', 'data': 'x', 'extra': 'not-a-real-extra'})
    har.write_text(json.dumps({'log': {
        'version': '1.2',
        'creator': {'name': 't', 'version': '1'},
        'entries': [download],
    }}), encoding='utf-8')

    with pytest.raises(OuterKeyUnavailable) as err:
        import_capture(_req(har, tmp_path), crypto, storage, RecordingProgress())
    assert 'dat.db' in err.value.message


def test_dat_db_row_id_wins_over_har_account_id(
    crypto, storage, tmp_path: Path
) -> None:
    """给了 --db 时外层密钥按 dat.db 那一行的 id 缓存，用错 id 会让缓存永远不命中。"""
    import sqlite3

    from guanxing.infra.savedb.sqlite_repo import DBProcessorImpl

    # 造一个 dat.db：id 故意不是 md5(账号)，content 用能解开的真实格式
    content = crypto.decoder.envelope.build_new(
        {'MainRole': {'Name': 'X'}, 'BaseSID': 1}, VERSION, INNER_KEY, OUTER_KEY)
    db = tmp_path / 'dat.db'
    conn = sqlite3.connect(db)
    conn.execute('CREATE TABLE save (id TEXT PRIMARY KEY NOT NULL, '
                 'content TEXT, player TEXT)')
    conn.execute('INSERT INTO save VALUES (?,?,?)', ('REAL_ROW_ID', content, '{}'))
    conn.commit()
    conn.close()

    # HAR 只提供 psw（新版 upload3 的 body 解不开）
    har = _har(tmp_path, [_entry('upload3', body=_upload_body(crypto, garbage=True))])
    download = _entry('download', body='')
    download['response']['content']['text'] = json.dumps(
        {'code': '0', 'data': 'x', 'extra': 'junk'})
    har.write_text(json.dumps({'log': {
        'version': '1.2',
        'creator': {'name': 't', 'version': '1'},
        'entries': [download],
    }}), encoding='utf-8')

    out = import_capture(
        _req(har, tmp_path, database=db, outer_key=OUTER_KEY),
        crypto, storage, RecordingProgress())
    assert out.save_id == 'REAL_ROW_ID'
    assert DBProcessorImpl(db).read_save()['id'] == 'REAL_ROW_ID'


# ─────────────────── 入口探测：先看版本，再决定问不问 dat.db ───────────────────
def test_probe_old_har_says_no_db_needed(crypto, storage, tmp_path: Path) -> None:
    har = _har(tmp_path, [_entry('upload2', body=_upload_body(crypto))])
    probe = probe_capture(har, crypto, storage, RecordingProgress())
    assert probe.has_save
    assert probe.version == VERSION
    assert probe.account == ACC
    assert probe.server == '1'


def test_probe_new_har_needs_db(crypto, storage, tmp_path: Path) -> None:
    har = _har(tmp_path, [_entry('upload3', body=_upload_body(crypto, garbage=True))])
    probe = probe_capture(har, crypto, storage, RecordingProgress())
    assert not probe.has_save

# --- probe 复用：入口探测过一次，导入阶段就不能再解一遍 upload 体 ---
def test_probe_carries_content_for_reuse(crypto, storage, tmp_path: Path) -> None:
    har = _har(tmp_path, [_entry('upload2', body=_upload_body(crypto))])
    probe = probe_capture(har, crypto, storage, RecordingProgress())
    assert probe.content
    assert probe.content_source == 'upload（upload2）'


def test_probe_result_skips_second_upload_decode(
        crypto, storage, tmp_path: Path) -> None:
    """探测过的 HAR，导入阶段不再打开第二遍（一次 capture 只解析一次）。"""
    from dataclasses import replace as _replace

    har = _har(tmp_path, [_entry('upload2', body=_upload_body(crypto))])
    probe = probe_capture(har, crypto, storage, RecordingProgress())

    def boom(*_a, **_kw):
        raise AssertionError('已经探测过，不该再打开一次 HAR')

    out = import_capture(_req(har, tmp_path, probe=probe), crypto,
                         _replace(storage, open_capture=boom), RecordingProgress())
    assert out.ok
    assert _steps(out)['存档来源'] == 'upload（upload2）'


def _download_entry(crypto, psw: str) -> dict:
    """一条带 extra 的 download 响应，extra 用 realKey 加密。"""
    real_key = crypto.deriver.derive(ACC, K_HEADER)['real_key']
    extra = base64.b64encode(
        crypto.decoder.xxtea.encrypt_raw(psw.encode('ascii'), real_key)).decode('ascii')
    entry = _entry('download')
    entry['response']['content']['text'] = json.dumps(
        {'code': '0', 'data': 'x', 'extra': extra})
    return entry


def test_probe_carries_psw_so_download_is_decoded_once(
        crypto, storage, tmp_path: Path) -> None:
    """探测已经解过 download，导入阶段不再解第二遍，psw 直接沿用。"""
    from dataclasses import replace as _replace

    psw = INNER_KEY[:8]
    har = _har(tmp_path, [_entry('upload2', body=_upload_body(crypto)),
                          _download_entry(crypto, psw)])
    probe = probe_capture(har, crypto, storage, RecordingProgress())
    assert probe.psw == psw

    def boom(*_a, **_kw):
        raise AssertionError('已经探测过，不该再打开一次 HAR')

    out = import_capture(_req(har, tmp_path, probe=probe), crypto,
                         _replace(storage, open_capture=boom), RecordingProgress())
    assert out.psw == psw
    assert 'psw' in _steps(out)          # 8 位 psw 会被整段掩掉，只断言登记过

# --- 落盘版本号必须来自解密后的存档，而不是抓包的 ver 头 ---
def test_wrong_ver_header_never_reaches_keys_json(
        crypto, storage, tmp_path: Path) -> None:
    """HAR 的 ver 头写错时不许污染 keys.json，落盘只在解密成功之后。"""
    from dataclasses import replace as _replace

    new_version = '00079999'          # 内置表里没有，才能看出落盘用的是哪个版本
    psw = 'zz11yy22'
    inner = psw + 'po06ewkx'          # psw + 已知后缀（后缀靠内置表就能拼出来）
    real_key = crypto.deriver.derive(ACC, K_HEADER)['real_key']

    keys_file = Path(crypto.keystore.keys_path)
    keys_file.write_text('{"schema_version": 2, "channel_suffix_table": {}, '
                         '"version_psw_table": {}}', encoding='utf-8')
    stacks_crypto = _replace(stacks_for(build_settings(workspace=tmp_path))[0],
                             hunt_inner_key=None)
    stacks_crypto.keystore.load()

    body = crypto.decoder.envelope.build_old(DATA, new_version, inner, 1).encode('ascii')
    upload = base64.b64encode(
        crypto.decoder.xxtea.encrypt_raw(body, real_key)).decode('ascii')

    # client_version() 优先取 download 条目的 ver 头，所以两条都要改成错的
    upload_entry = _entry('upload2', body=upload, ver='00099999')
    extra = base64.b64encode(
        crypto.decoder.xxtea.encrypt_raw(psw.encode('ascii'), real_key)).decode('ascii')
    download = _entry('download', ver='00099999')
    download['response']['content']['text'] = json.dumps(
        {'code': '0', 'data': 'x', 'extra': extra})
    har = _har(tmp_path, [upload_entry, download])

    out = import_capture(_req(har, tmp_path), stacks_crypto, storage, RecordingProgress())
    assert out.ok
    assert out.version == new_version

    on_disk = json.loads(keys_file.read_text(encoding='utf-8'))['version_psw_table']
    assert '00099999' not in on_disk, '错版本被写进了表'
    assert on_disk.get(new_version) == psw, '真实版本没有登记'
    # 内置版本的正确值不许被这把 psw 覆盖
    assert on_disk.get('00073440') == 'pon1dxg7'
