"""HAR 读取器：命令名正则匹配 + 只走 download 取 psw。"""
from __future__ import annotations

import base64
import json
from pathlib import Path

import pytest

from guanxing.application.services.save_decoder import SaveDecoder
from guanxing.domain.crypto.codec import Codec
from guanxing.domain.crypto.xxtea import XXTEACrypto
from guanxing.domain.keys.table import KeyTable
from guanxing.domain.protocol.keys import ProtocolKeyDeriver
from guanxing.domain.save.envelope import SaveEnvelope
from guanxing.infra.capture.har_reader import HarReaderImpl
from guanxing.shared.errors import HarError
from tests.support import RecordingProgress

REAL_KEY = 'abcde' + 'eakec' + '000000'      # 任意固定 16 字节，只要能自洽加解密
PSW = 'ab12cd34'


def _entry(command: str, *, url='https://x/api_command', acc='TESTACC', ver='70001',
           req_body=None, resp_text=None) -> dict:
    return {
        'startedDateTime': '2026-01-01T00:00:00Z',
        'time': 1.0,
        'request': {
            'method': 'POST',
            'url': url,
            'httpVersion': 'HTTP/1.1',
            'cookies': [],
            'headers': [
                {'name': 'command', 'value': command},
                {'name': 'acc', 'value': acc},
                {'name': 'area', 'value': '1'},
                {'name': 'ver', 'value': ver},
            ],
            'queryString': [],
            'postData': {'mimeType': 'text/plain', 'text': req_body or ''},
            'headersSize': 0,
            'bodySize': 0,
        },
        'response': {
            'status': 200,
            'statusText': 'OK',
            'httpVersion': 'HTTP/1.1',
            'cookies': [],
            'headers': [],
            'content': {'mimeType': 'application/json', 'text': resp_text or ''},
            'redirectURL': '',
            'headersSize': 0,
            'bodySize': 0,
        },
        'cache': {},
        'timings': {},
    }


def _har(tmp_path: Path, entries: list[dict]) -> Path:
    path = tmp_path / 'x.har'
    path.write_text(json.dumps({
        'log': {
            'version': '1.2',
            'creator': {'name': 't', 'version': '1'},
            'entries': entries,
        },
    }), encoding='utf-8')
    return path


def _extra(plain: str) -> str:
    return Codec.b64e(XXTEACrypto().encrypt_raw(plain.encode(), REAL_KEY))


def test_downloads_matches_any_number_suffix(tmp_path: Path) -> None:
    """`download` / `download3` / `download12` 都要认（以前元组硬列会漏）。"""
    har = HarReaderImpl(_har(tmp_path, [
        _entry('upload3'), _entry('download'), _entry('download3'), _entry('download12'),
    ]))
    cmds = [har.command_of(e) for e in har.downloads()]
    assert sorted(cmds) == ['download', 'download12', 'download3']


def test_downloads_ignores_upload(tmp_path: Path) -> None:
    har = HarReaderImpl(_har(tmp_path, [_entry('upload3'), _entry('upload2')]))
    assert har.downloads() == []
    assert har.download_payload() is None


def test_download_payload_prefers_extra(tmp_path: Path) -> None:
    har = HarReaderImpl(_har(tmp_path, [
        _entry('download3', resp_text=json.dumps({'data': 'x' * 5000})),
        _entry('download3', resp_text=json.dumps({'extra': 'E', 'data': 'y'})),
    ]))
    payload = har.download_payload()
    assert payload is not None and payload['extra'] == 'E'


def test_probe_headers_without_upload(tmp_path: Path) -> None:
    """HAR 里一条 upload 都没有，也能从任意 api 条目取到账号/区服/版本。"""
    har = HarReaderImpl(_har(tmp_path, [_entry('download3')]))
    assert har.account() == 'TESTACC'
    assert har.server() == '1'
    assert har.client_version() == '70001'


def test_psw_from_download_roundtrip(tmp_path: Path) -> None:
    har = HarReaderImpl(_har(tmp_path, [
        _entry('download3', resp_text=json.dumps({'extra': _extra(PSW), 'data': 'z'}))
    ]))
    decoder = SaveDecoder(XXTEACrypto(), SaveEnvelope(XXTEACrypto(), KeyTable()),
                          ProtocolKeyDeriver(XXTEACrypto()), RecordingProgress())
    assert decoder.psw_from_download(har.download_payload(), REAL_KEY) == PSW


@pytest.mark.parametrize('raw,expected', [
    ('ab12cd34', 'ab12cd34'),
    ('ab12cd34,70001', 'ab12cd34'),
    ('70001|ab12cd34', 'ab12cd34'),
    ('70001 ab12cd34', 'ab12cd34'),
    ('', ''),
])
def test_extract_psw_tolerates_separators(raw: str, expected: str) -> None:
    assert SaveDecoder._extract_psw(raw) == expected


# ───────────────────── 报错要说清是哪种坏 ─────────────────────
def test_empty_entries_says_so(tmp_path: Path) -> None:
    """空 entries 不能被吞成「无效的 HAR 文件」——那个提示根本没法排查。"""
    with pytest.raises(HarError) as err:
        HarReaderImpl(_har(tmp_path, []))
    assert '没有任何请求' in str(err.value)


def test_malformed_har_says_invalid(tmp_path: Path) -> None:
    """结构不对时要指出缺哪个字段，不能只说"无效的 HAR 文件"。"""
    path = tmp_path / 'bad.har'
    path.write_text('{"log": {}}', encoding='utf-8')
    with pytest.raises(HarError) as err:
        HarReaderImpl(path)
    assert 'HAR 结构不完整' in str(err.value)
    assert err.value.hints, '必须带 hint 说明缺什么'
    assert 'creator' in err.value.hints[0] or 'entries' in err.value.hints[0]


def test_base64_encoded_response_is_decoded(tmp_path: Path) -> None:
    """Chrome / Charles 会把响应体写成 base64，应当自动解出来。"""
    raw = json.dumps({'extra': 'abc', 'data': 'zzz'}).encode('utf-8')
    entry = _entry('download3', resp_text=base64.b64encode(raw).decode('ascii'))
    entry['response']['content']['encoding'] = 'base64'
    reader = HarReaderImpl(_har(tmp_path, [entry]))
    assert reader.download_payload() == {'extra': 'abc', 'data': 'zzz'}
