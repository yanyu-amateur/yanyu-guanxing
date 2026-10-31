"""网页静态注入文件（file:// 下跨页面传存档的唯一可靠通道）。"""
from __future__ import annotations

import json
from pathlib import Path

from guanxing.infra.web.publish import (
    build_local_save_js,
    write_local_save,
)


def test_js_assigns_both_globals() -> None:
    js = build_local_save_js({'MainRole': {'Name': 'x'}}, {'version': '00070001'})
    assert 'window.__latestPlainSave' in js
    assert 'window.__latestSaveMeta' in js
    assert '"00070001"' in js


def test_js_uses_null_when_no_payload() -> None:
    assert 'window.__latestPlainSave = null;' in build_local_save_js(None, None)


def test_stamp_written_only_for_a_real_payload() -> None:
    """导出编号让网页能区分「用户否掉的那次注入」和「同一份存档重新导出」。"""
    stamped = build_local_save_js({'a': 1}, {}, 'abc123')
    assert 'window.__latestSaveStamp = "abc123";' in stamped
    assert '__latestSaveStamp' not in build_local_save_js(None, {}, '')


def test_js_escapes_closing_script_tag() -> None:
    js = build_local_save_js({'a': '</script><b>'}, None)
    assert '</script>' not in js
    assert '<\\/script>' in js


def test_write_creates_file_in_web_dir(tmp_path: Path) -> None:
    target = write_local_save(tmp_path, {'a': 1}, {})
    assert target == tmp_path / 'local-save.js'
    assert target.is_file()
    assert (tmp_path / 'index.html').exists() is False      # 只写自己的文件


def test_written_js_is_valid_python_free_json(tmp_path: Path) -> None:
    """写出去的赋值必须能被 JSON 还原（不能有尾逗号之类）。"""
    write_local_save(tmp_path, {'b': [1, 2]}, {'k': 'v'})
    text = (tmp_path / 'local-save.js').read_text(encoding='utf-8')
    line = next(ln for ln in text.splitlines() if ln.startswith('window.__latestPlainSave'))
    payload = line.split('=', 1)[1].strip().rstrip(';')
    assert json.loads(payload) == {'b': [1, 2]}


def test_write_embeds_a_stamp_for_each_export(tmp_path: Path) -> None:
    """每次导出编号都不同：重置过的网页重新导入同一份存档仍会自动加载。"""
    first = write_local_save(tmp_path, {'b': [1, 2]}, {}).read_text(encoding='utf-8')
    second = write_local_save(tmp_path, {'b': [1, 2]}, {}).read_text(encoding='utf-8')
    assert 'window.__latestSaveStamp' in first
    assert first != second


def test_no_stamp_when_there_is_no_save(tmp_path: Path) -> None:
    text = write_local_save(tmp_path, None, None).read_text(encoding='utf-8')
    assert '__latestSaveStamp' not in text
