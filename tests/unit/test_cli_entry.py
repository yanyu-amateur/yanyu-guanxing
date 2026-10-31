"""CLI 入口：全局参数任意位置、退出码语义（手册 §10.1 / §10.2）。"""
from __future__ import annotations

import argparse
import json
import logging
import os
import time
from pathlib import Path

import pytest

from guanxing.application.ports.device import RemoteFile
from guanxing.application.usecases.device_saves import CACHE_KEEP_SEC, Picked
from guanxing.bootstrap import build_settings
from guanxing.infra.reporting.log_sink import INDENT
from guanxing.interface.cli import app, flow
from guanxing.interface.cli.app import _pre_extract, main
from guanxing.interface.cli.exit_codes import EXIT_OK, EXIT_USER
from guanxing.interface.cli.flow import FlowRequest
from guanxing.shared.console import take_input_mark
from guanxing.shared.errors import CancelledError, HarError
from tests.support import RecordingProgress, stacks_for


@pytest.fixture(autouse=True)
def _restore_root_logging():
    """main() 里的 setup_logging(force=True) 会留下指向本次捕获流的 handler。

    不还原的话，后面的用例一旦 log 就会写进别处的 stderr 缓冲，出现莫名其妙的
    "captured stderr" 污染（本文件是唯一真正调 main() 的地方）。
    """
    root = logging.getLogger()
    saved, level = root.handlers[:], root.level
    yield
    root.handlers[:] = saved
    root.setLevel(level)


def test_pre_extract_pulls_v_after_subcommand() -> None:
    rest, verbose, quiet, log = _pre_extract(['local', 'a.db', '-v'])
    assert rest == ['local', 'a.db']
    assert (verbose, quiet, log) == (1, False, None)


def test_pre_extract_counts_double_v() -> None:
    rest, verbose, _, _ = _pre_extract(['-vv', 'local', 'x'])
    assert rest == ['local', 'x'] and verbose == 2


@pytest.mark.parametrize('argv', [
    ['local', 'x', '--log', 'a.log'],
    ['--log', 'a.log', 'local', 'x'],
    ['local', 'x', '--log=a.log'],
])
def test_pre_extract_log_anywhere(argv: list[str]) -> None:
    rest, _, _, log = _pre_extract(argv)
    assert log == 'a.log'
    assert rest == ['local', 'x']


def test_pre_extract_keeps_positional_untouched() -> None:
    rest, verbose, quiet, log = _pre_extract(['capture', 'x.har', '--db', 'd.db'])
    assert rest == ['capture', 'x.har', '--db', 'd.db']
    assert (verbose, quiet, log) == (0, False, None)


def test_local_missing_db_is_user_error(tmp_path: Path, monkeypatch) -> None:
    # 必须切到临时目录：真实入口按 cwd 解析 keys.json / keys.local.json，
    # 不切的话加载期会把开发者自己的密钥表迁移一遍（测试不许碰真实文件）。
    monkeypatch.chdir(tmp_path)
    assert main(['local', str(tmp_path / 'nope.db')]) == EXIT_USER


def test_help_exits_ok() -> None:
    with pytest.raises(SystemExit) as exc:
        main(['--help'])
    assert exc.value.code == EXIT_OK


def test_info_subcommand_is_gone() -> None:
    """info 只是按扩展名猜类型，却要连带迁移密钥表，已删除。"""
    with pytest.raises(SystemExit):
        main(['info', 'x'])


def test_cancel_is_logged_as_info_not_error(monkeypatch, caplog) -> None:
    """用户按 q 退出是正常操作：退出码 0、级别 INFO，且跟别的行一样缩进。"""
    take_input_mark()        # 清掉别的用例留下的标记，保证不断言到多余空行

    def boom(*_args, **_kw):
        raise CancelledError('已取消')

    monkeypatch.setattr(app, '_dispatch', boom)
    with caplog.at_level(logging.DEBUG):
        assert main(['local', 'x']) == EXIT_OK

    record = caplog.records[-1]
    assert record.levelno == logging.INFO
    assert record.getMessage() == f'{INDENT}已取消'


# ───────────────────── 全局开关要落进 Settings ─────────────────────
def test_verbose_and_quiet_reach_settings(tmp_path: Path, monkeypatch) -> None:
    """-vv 要能显示完整密钥、--quiet 要能关掉进度条，都靠 Settings 里这两个字段。"""
    monkeypatch.chdir(tmp_path)      # 同上：别读开发者真实的 keys.local.json
    args = argparse.Namespace(verbose=2, quiet=False, out=None, package=None)
    settings = app._settings_for(args)
    assert settings.verbose == 2
    assert settings.show_keys is True

    args = argparse.Namespace(verbose=0, quiet=True, out=None, package=None)
    settings = app._settings_for(args)
    assert settings.quiet is True
    assert settings.show_keys is False


def test_run_purges_stale_cache(tmp_path: Path, monkeypatch) -> None:
    """每次运行清一次放久了的残骸：上次失败/中断留下的 dat.db 不该一直堆着。"""
    monkeypatch.chdir(tmp_path)
    cache = tmp_path / 'output' / '_cache'
    cache.mkdir(parents=True)
    stale = cache / '20260101-010101-com.a.db'
    stale.write_bytes(b'x' * 64)
    # 比保留期再早一分钟：改 CACHE_KEEP_SEC 时这个用例不用跟着改
    stamp = time.time() - (CACHE_KEEP_SEC + 60)
    os.utime(stale, (stamp, stamp))

    assert main(['local', str(tmp_path / 'nope.db')]) == EXIT_USER
    assert not stale.exists(), '本次运行一开始就该清掉放久了的残骸'


def test_run_keeps_fresh_cache(tmp_path: Path, monkeypatch) -> None:
    """刚拉下来的档必须留着——失败提示会让用户马上去看它，甚至拿它重跑。"""
    monkeypatch.chdir(tmp_path)
    cache = tmp_path / 'output' / '_cache'
    cache.mkdir(parents=True)
    fresh = cache / '20260101-010101-com.a.db'
    fresh.write_bytes(b'x' * 64)

    assert main(['local', str(tmp_path / 'nope.db')]) == EXIT_USER
    assert fresh.exists()


# ───────────────────── --from-device 的探测顺序 ─────────────────────
def _har(entries: list[dict]) -> str:
    return json.dumps({
        'log': {'version': '1.2', 'creator': {'name': 't', 'version': '1'},
                'entries': entries},
    }, ensure_ascii=False)


def _bare_entry() -> dict:
    """一条什么头都没有的条目：结构合法、但取不到 acc/k/download。"""
    return {
        'startedDateTime': '2026-01-01T00:00:00Z', 'time': 1.0,
        'request': {'method': 'POST', 'url': 'https://x/api',
                    'httpVersion': 'HTTP/1.1', 'cookies': [], 'headers': [],
                    'queryString': [], 'headersSize': 0, 'bodySize': 0},
        'response': {'status': 200, 'statusText': 'OK', 'httpVersion': 'HTTP/1.1',
                     'cookies': [], 'headers': [],
                     'content': {'size': 0, 'mimeType': 'application/json'},
                     'redirectURL': '', 'headersSize': 0, 'bodySize': 0},
        'cache': {}, 'timings': {},
    }


def test_local_without_path_pulls_from_device(tmp_path: Path, monkeypatch) -> None:
    """`local` 不带路径就是从模拟器读档：不再要求额外加 --from-device。"""
    from guanxing.application.dto import ImportOutcome

    monkeypatch.chdir(tmp_path)
    seen: dict = {}
    local_db = tmp_path / 'pulled.db'
    local_db.write_bytes(b'x')
    monkeypatch.setattr(flow, 'fetch_save',
                        lambda *_a, **_kw: seen.update(hit=True)
                        or Picked(local=local_db,
                                  remote=RemoteFile('/d/files/a/server1/dat.db', 1, ''),
                                  serial='emu-1'))
    monkeypatch.setattr(
        'guanxing.application.usecases.run_import.import_local',
        lambda req, *a, progress=None: ImportOutcome(ok=True, nick='x'))

    assert main(['local']) == EXIT_OK
    assert seen.get('hit') is True


def test_auto_picks_entry_by_suffix(tmp_path: Path) -> None:
    """auto 只在命令行里判一次扩展名：.db 走 local，其余走 capture。"""
    db = tmp_path / 'dat.db'
    har = tmp_path / 'x.har'
    assert app._to_flow_request(app.build_parser().parse_args(['auto', str(db)]))[0] \
        is flow.run_local
    assert app._to_flow_request(app.build_parser().parse_args(['auto', str(har)]))[0] \
        is flow.run_capture


def test_capture_reports_unreadable_har_before_pulling(monkeypatch, tmp_path: Path) -> None:
    """读不了 HAR 就直接上抛：不能默默当成"新版存档"再去白拉一次设备存档。"""
    settings = build_settings(workspace=tmp_path)
    crypto, storage, device = stacks_for(settings)
    bad = tmp_path / 'bad.har'
    bad.write_text('{"log": {}}', encoding='utf-8')

    def boom(*_a, **_kw):
        raise AssertionError('HAR 都读不了，不该去碰设备')

    monkeypatch.setattr(flow, 'fetch_save', boom)
    with pytest.raises(HarError):
        flow.run_capture(FlowRequest(source=bad, allow_device=True),
                         settings, crypto, storage, device, RecordingProgress(),
                         flow.SilentPrompter(RecordingProgress()))


def test_capture_with_db_does_not_claim_har_has_save(
        tmp_path: Path, monkeypatch, capsys) -> None:
    """HAR 里没存档时别说"HAR 自带存档（旧版）"，否则紧接着报错自相矛盾。"""
    monkeypatch.chdir(tmp_path)
    har = tmp_path / 'new.har'
    har.write_text(_har([_bare_entry()]), encoding='utf-8')

    assert main(['capture', str(har), '--db', str(tmp_path / 'd.db'),
                 '--from-device']) == EXIT_USER
    err = capsys.readouterr().err
    assert 'HAR 自带存档' not in err
    assert '只提供 psw' in err


def test_failed_import_tells_where_the_pulled_db_is(
        tmp_path: Path, monkeypatch, capsys) -> None:
    """导入失败时临时档故意不删，但必须告诉用户它在哪，否则 _cache 会静默积累。"""
    monkeypatch.chdir(tmp_path)
    har = tmp_path / 'new.har'
    har.write_text(_har([_bare_entry()]), encoding='utf-8')
    pulled = tmp_path / 'output' / '_cache' / '20260101-010101-com.a.db'
    pulled.parent.mkdir(parents=True)
    pulled.write_bytes(b'x')

    monkeypatch.setattr(flow, 'fetch_save',
                        lambda *_a, **_kw: Picked(
                            local=pulled,
                            remote=RemoteFile('/d/files/a/server1/dat.db', 1, ''),
                            serial='emu-1'))
    assert main(['capture', str(har), '--from-device']) == EXIT_USER
    assert str(pulled) in capsys.readouterr().err
    assert pulled.exists(), '失败时故意留着给用户排查'
