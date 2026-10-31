"""回写分支（没有 CLI 入口）的单测：rebuild 出来的 content 能被同一套信封解回原 JSON。

write_db 要把 content 落到 save 表，player 摘要必须是 JSON 文本。
这条链路刻意不对外暴露，改坏了没人发现，所以全靠这里兜住。
"""
from __future__ import annotations

import json
import sqlite3
from pathlib import Path

import pytest

from guanxing.application.services.save_assembler import SaveAssembler
from guanxing.application.services.save_decoder import SaveDecoder
from guanxing.domain.crypto.xxtea import XXTEACrypto
from guanxing.domain.errors import OuterKeyUnavailable
from guanxing.domain.keys.table import KeyTable
from guanxing.domain.protocol.keys import ProtocolKeyDeriver
from guanxing.domain.save.envelope import SaveEnvelope
from guanxing.infra.savedb.sqlite_repo import DBProcessorImpl
from tests.support import RecordingProgress

OUTER_KEY = '0123456789abcdef'
INNER_KEY = 'ab12cd34po06ewkx'
VERSION = '00070001'
MARKER = 'dnkemiea'

DATA = {
    'MainRole': {'Name': '测试角色', 'Level': 7, 'Sex': 1, 'MenPai': 3,
                 'Job': 2, 'Cloth': 11, 'Shoe': 11},
    'globalVariable': {'Repute': 5},
    'Money': 1000,
    'Energy': 60,
    'SavCode': 123,          # SaveModel.sav_code 是 int
    'Yue': 1,
    'DBVersion': 70001,
}


@pytest.fixture()
def envelope() -> SaveEnvelope:
    return SaveEnvelope(XXTEACrypto(has_cxxtea=False), KeyTable())


def _decode(envelope: SaveEnvelope, content: str, outer_key: str | None = None):
    """用生产解码器解一遍，返回明文与 meta 摘要；测试密钥不在内置表里，显式传入。"""
    decoder = SaveDecoder(envelope.xxtea, envelope,
                          ProtocolKeyDeriver(envelope.xxtea), RecordingProgress())
    out = decoder.decode_content(content, runtime='android', outer_key=outer_key,
                                 inner_key=INNER_KEY)
    return out.data, {'version': out.version, 'marker': out.marker,
                      'inner_key': out.inner_key}

def test_rebuild_old_roundtrip(envelope: SaveEnvelope) -> None:
    content, marker = SaveAssembler(envelope, progress=RecordingProgress()).rebuild(
        DATA, VERSION, INNER_KEY, fmt='old')

    assert marker == ''
    decoded, meta = _decode(envelope, content)
    assert meta['version'] == VERSION
    assert decoded == DATA


def test_rebuild_new_roundtrip(envelope: SaveEnvelope) -> None:
    content, marker = SaveAssembler(envelope, progress=RecordingProgress()).rebuild(
        DATA, VERSION, INNER_KEY, outer_key=OUTER_KEY, marker=MARKER)

    assert marker == MARKER
    assert content.startswith(MARKER)
    decoded, meta = _decode(envelope, content, OUTER_KEY)
    assert meta['marker'] == MARKER
    assert decoded == DATA


def test_rebuild_new_requires_outer_key(envelope: SaveEnvelope) -> None:
    with pytest.raises(OuterKeyUnavailable):
        SaveAssembler(envelope, progress=RecordingProgress()).rebuild(DATA, VERSION, INNER_KEY, fmt='new')


def test_write_db_stores_content_and_player(tmp_path: Path, envelope: SaveEnvelope) -> None:
    db = tmp_path / 'dat.db'
    conn = sqlite3.connect(db)
    conn.execute('CREATE TABLE save (id TEXT PRIMARY KEY NOT NULL, '
                 'content TEXT, player TEXT)')
    conn.commit()
    conn.close()

    content, _marker = SaveAssembler(envelope, progress=RecordingProgress()).rebuild(
        DATA, VERSION, INNER_KEY, fmt='old')
    SaveAssembler(envelope, progress=RecordingProgress(), savedb=DBProcessorImpl(db)).write_db('SID-1', content, DATA, VERSION)

    row = DBProcessorImpl(db).read_save()
    assert row['id'] == 'SID-1'
    assert row['content'] == content
    player = json.loads(row['player'])
    assert player['nick'] == '测试角色'
    assert player['version'] == 70001


def test_write_db_without_savedb_is_noop(envelope: SaveEnvelope) -> None:
    """没注入 dat.db 时静默跳过（组装器本身不负责选库）。"""
    SaveAssembler(envelope, progress=RecordingProgress()).write_db('SID-1', 'content', DATA, VERSION)
