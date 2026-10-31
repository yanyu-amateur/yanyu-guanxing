"""入口向导分支连通性（不连设备、不起浏览器）。"""
from __future__ import annotations

import json
from pathlib import Path

import pytest

from guanxing.application.usecases.probe_capture import CaptureProbe
from guanxing.bootstrap import build_settings
from guanxing.interface.cli import flow
from guanxing.interface.cli.flow import FlowRequest
from guanxing.interface.cli.interactive import wizard
from guanxing.interface.cli.interactive.wizard import run_wizard
from tests.support import RecordingProgress, stacks_for

# 取档前的预告文案（before_pull 的措辞），断言只认这一句
PULL_HINT = '开始识别模拟器'


def _settings(tmp_path: Path):
    return build_settings(workspace=tmp_path)


def test_no_snapshot_then_exit(monkeypatch, tmp_path: Path) -> None:
    """没有任何存档时，选 0 应干净退出（退出码 0）。"""
    settings = _settings(tmp_path)
    stacks = stacks_for(settings)
    monkeypatch.setattr('builtins.input', lambda *a, **k: '0')
    assert run_wizard(settings, *stacks, RecordingProgress()) == 0


def test_open_existing_snapshot_injects_dat_json(monkeypatch, tmp_path: Path) -> None:
    """选已有存档 → 把它的 dat.json 注入网页（这里用桩替换真正的浏览器会话）。"""
    snap = tmp_path / 'output' / 'android-s1-测试角色' / '20260101-000000'
    snap.mkdir(parents=True)
    (snap / 'dat.meta.json').write_text(
        json.dumps({'nick': '测试角色', 'version': '00070001'}, ensure_ascii=False),
        encoding='utf-8',
    )
    plain = {'MainRole': {'Name': '测试角色'}, 'globalVariable': {}}
    (snap / 'dat.json').write_text(json.dumps(plain, ensure_ascii=False), encoding='utf-8')

    captured: dict = {}

    def fake_web_session(settings, data, meta, storage=None, progress=None):
        captured['data'] = data
        captured['meta'] = meta
        return 0

    # publish_web 已下沉为用例：桩打在它写文件/开浏览器这两个副作用上
    monkeypatch.setattr(
        'guanxing.interface.cli.interactive.wizard.publish_web', fake_web_session)
    monkeypatch.setattr('builtins.input', lambda *a, **k: '1')

    settings = _settings(tmp_path)
    stacks = stacks_for(settings)
    assert run_wizard(settings, *stacks, RecordingProgress()) == 0
    assert captured['data']['MainRole']['Name'] == '测试角色'
    assert captured['meta']['version'] == '00070001'


def test_bad_snapshot_without_dat_json_raises(monkeypatch, tmp_path: Path) -> None:
    """快照缺 dat.json 时应报可读错误，而不是抛原始异常。"""
    from guanxing.shared.errors import AppError

    snap = tmp_path / 'output' / 'g' / '20260101-000000'
    snap.mkdir(parents=True)
    (snap / 'dat.meta.json').write_text('{"nick":"x"}', encoding='utf-8')

    monkeypatch.setattr('builtins.input', lambda *a, **k: '1')
    settings = _settings(tmp_path)
    stacks = stacks_for(settings)
    with pytest.raises(AppError):
        run_wizard(settings, *stacks, RecordingProgress())


@pytest.mark.parametrize('answer', ['x', '99', '-1'])
def test_choose_tolerates_bad_input(monkeypatch, tmp_path: Path, answer: str) -> None:
    """非法输入应被重新询问，最终选 0 退出（不会误入 local 分支去碰设备）。"""
    settings = _settings(tmp_path)
    stacks = stacks_for(settings)
    answers = iter([answer, '0'])
    monkeypatch.setattr('builtins.input', lambda *a, **k: next(answers))
    assert run_wizard(settings, *stacks, RecordingProgress()) == 0


def test_empty_input_takes_default(monkeypatch, tmp_path: Path) -> None:
    """直接回车采用默认值 1（local），因此应尝试连接设备而不是退出。"""
    from guanxing.shared.errors import AppError

    def no_device(_device):
        raise AppError('没有检测到设备/模拟器')

    monkeypatch.setattr(
        'guanxing.application.usecases.device_saves.list_devices', no_device)

    settings = _settings(tmp_path)
    stacks = stacks_for(settings)
    monkeypatch.setattr('builtins.input', lambda *a, **k: '')
    # 没有设备 → 抛可读错误，而不是卡住或静默返回
    with pytest.raises(AppError):
        run_wizard(settings, *stacks, RecordingProgress())


def test_quit_anywhere_cancels(monkeypatch, tmp_path: Path) -> None:
    """任何一步输 q 都直接取消（旧的交互习惯）。"""
    from guanxing.shared.errors import CancelledError

    settings = _settings(tmp_path)
    stacks = stacks_for(settings)
    monkeypatch.setattr('builtins.input', lambda *a, **k: 'q')
    with pytest.raises(CancelledError):
        run_wizard(settings, *stacks, RecordingProgress())


def _stub_device_saves(monkeypatch, tmp_path: Path) -> dict:
    """把「问设备、列存档、拉取」换成桩，返回被记录的调用参数。"""
    from guanxing.application.dto import ImportOutcome
    from guanxing.application.ports.device import DeviceInfo, RemoteFile

    seen: dict = {}
    local_db = tmp_path / 'pulled.db'
    local_db.write_bytes(b'x')

    monkeypatch.setattr(
        'guanxing.application.usecases.device_saves.list_devices',
        lambda *a, **kw: [DeviceInfo(serial='emulator-5554')],
    )
    monkeypatch.setattr(
        'guanxing.application.usecases.device_saves.list_saves',
        lambda *a, **kw: [RemoteFile(path='/data/x/dat.db', size=4096, mtime='10-30 12:00')],
    )
    monkeypatch.setattr(
        'guanxing.application.usecases.device_saves.pull_save',
        lambda *a, **kw: (seen.update(kw), local_db)[1],
    )
    # 默认当成新版 HAR（需要 dat.db）；旧版那条路见 test_capture_old_har_skips_db
    monkeypatch.setattr(
        'guanxing.interface.cli.flow.probe_capture',
        lambda *a, **kw: CaptureProbe(account='TESTACC', server='1', version='00070001',
                                      has_save=False),
    )

    def fake_capture(req, *a, progress=None):
        seen['database'] = req.database
        seen['source'] = req.source
        return ImportOutcome(ok=True, nick='测试角色', version='00070001',
                             field_count=3, inner_key='ab12cd34po06ewkx')

    monkeypatch.setattr(
        'guanxing.application.usecases.run_import.import_capture', fake_capture,
    )
    return seen


def test_capture_takes_db_from_device(monkeypatch, tmp_path: Path) -> None:
    """capture 模式（新版 HAR）的 dat.db 一律由设备拉取，不再问"从哪来"。"""
    seen = _stub_device_saves(monkeypatch, tmp_path)
    # capture → HAR 路径 → 确认用这份存档（回车默认 Y）→ 不开网页
    answers = iter(['2', 'x.har', '', 'n'])
    monkeypatch.setattr('builtins.input', lambda *a, **k: next(answers))

    settings = _settings(tmp_path)
    stacks = stacks_for(settings)
    assert run_wizard(settings, *stacks, RecordingProgress()) == 0
    assert seen['database'] == tmp_path / 'pulled.db'
    assert str(seen['source']).endswith('x.har')


def test_capture_old_har_skips_db_question(monkeypatch, tmp_path: Path) -> None:
    """旧版 HAR 自带存档：不许再问 dat.db，也不许碰设备。"""
    seen = _stub_device_saves(monkeypatch, tmp_path)
    monkeypatch.setattr(
        'guanxing.interface.cli.flow.probe_capture',
        lambda *a, **kw: CaptureProbe(account='TESTACC', server='1',
                                      version='00073460', has_save=True),
    )

    def boom(*_a, **_k):
        raise AssertionError('旧版 HAR 不该访问设备')

    monkeypatch.setattr(
        'guanxing.application.usecases.device_saves.list_devices', boom)
    monkeypatch.setattr('guanxing.interface.cli.flow.fetch_save', boom)

    answers = iter(['2', 'old.har', 'n'])          # capture → HAR → 不开网页
    monkeypatch.setattr('builtins.input', lambda *a, **k: next(answers))

    settings = _settings(tmp_path)
    stacks = stacks_for(settings)
    assert run_wizard(settings, *stacks, RecordingProgress()) == 0
    assert seen['database'] is None


def test_local_takes_db_from_device(monkeypatch, tmp_path: Path) -> None:
    """local 模式同样走设备拉取（复用同一个 helper）。"""
    from guanxing.application.dto import ImportOutcome

    local_db = tmp_path / 'pulled.db'
    local_db.write_bytes(b'x')
    monkeypatch.setattr(
        'guanxing.application.usecases.device_saves.list_devices',
        lambda *a, **kw: [type('D', (), {'serial': 'emulator-5554', 'label': 'emu'})()],
    )
    monkeypatch.setattr(
        'guanxing.application.usecases.device_saves.list_saves',
        lambda *a, **kw: [type('F', (), {'path': '/data/x/dat.db', 'size': 1,
                                           'mtime': ''})()],
    )
    monkeypatch.setattr(
        'guanxing.application.usecases.device_saves.pull_save',
        lambda *a, **kw: local_db,
    )

    seen: dict = {}
    monkeypatch.setattr(
        'guanxing.application.usecases.run_import.import_local',
        lambda req, *a, progress=None: (
            seen.update(source=req.source, database=req.database),
            ImportOutcome(ok=True, nick='x', version='00070001'),
        )[1],
    )

    answers = iter(['1', '', '', 'n'])      # local → 已进角色存档 → 确认这份 → 不开网页
    monkeypatch.setattr('builtins.input', lambda *a, **k: next(answers))

    settings = _settings(tmp_path)
    stacks = stacks_for(settings)
    assert run_wizard(settings, *stacks, RecordingProgress()) == 0
    assert seen['source'] == local_db
    assert seen['database'] is None          # local 只传 source，不触发 dat.db 回写


# ───────────── 提示只在一处出现：不再前置确认、也不再重复三步操作 ─────────────
def test_local_does_not_pre_confirm_before_pulling(monkeypatch, tmp_path: Path) -> None:
    """选完 local 后不该再有重新登录的前置确认，那句话只在真要扫内存时出现。"""
    from guanxing.application.dto import ImportOutcome
    from guanxing.application.ports.device import DeviceInfo, RemoteFile

    local_db = tmp_path / 'pulled.db'
    local_db.write_bytes(b'x')
    monkeypatch.setattr(
        'guanxing.application.usecases.device_saves.list_devices',
        lambda *a, **kw: [DeviceInfo(serial='emu-1')])
    monkeypatch.setattr(
        'guanxing.application.usecases.device_saves.list_saves',
        lambda *a, **kw: [RemoteFile('/data/x/files/a/server1/dat.db', 1, '01-01 00:00')])
    monkeypatch.setattr(
        'guanxing.application.usecases.device_saves.pull_save',
        lambda *a, **kw: local_db)
    monkeypatch.setattr(
        'guanxing.application.usecases.run_import.import_local',
        lambda req, *a, progress=None: ImportOutcome(ok=True, nick='x'))

    prompts: list[str] = []

    def fake_input(text=''):
        prompts.append(str(text))
        return ''

    monkeypatch.setattr('builtins.input', fake_input)

    settings = _settings(tmp_path)
    stacks = stacks_for(settings)
    run_wizard(settings, *stacks, RecordingProgress())

    joined = ' | '.join(prompts)
    assert '已经做完' not in joined, '还在前置确认'
    assert '重新登录' not in joined, '前置说明没删干净'


def test_local_also_announces_expected_duration(monkeypatch, tmp_path: Path) -> None:
    """local 也要在开始前说明接下来要取档（capture 的两条另有专门用例）。"""
    from guanxing.application.dto import ImportOutcome

    _stub_device_saves(monkeypatch, tmp_path)
    monkeypatch.setattr(
        'guanxing.application.usecases.run_import.import_local',
        lambda req, *a, progress=None: ImportOutcome(ok=True, nick='x'))
    recorder = RecordingProgress()
    monkeypatch.setattr('builtins.input', lambda *a, **k: '')

    settings = _settings(tmp_path)
    stacks = stacks_for(settings)
    flow.run_local(FlowRequest(allow_device=True), settings, *stacks, recorder,
                   wizard.InteractivePrompter(settings, recorder))

    assert any(PULL_HINT in line for line in recorder.lines), 'local 也要预告接下来要取档'


def test_old_har_does_not_announce_a_long_wait(monkeypatch, tmp_path: Path) -> None:
    """旧版 HAR 的存档就在 body 里，不去设备取档——不该出现取档预告。"""
    from guanxing.application.dto import ImportOutcome

    _stub_device_saves(monkeypatch, tmp_path)
    monkeypatch.setattr(
        'guanxing.application.usecases.run_import.import_capture',
        lambda req, *a, progress=None: ImportOutcome(ok=True, nick='x'))
    recorder = RecordingProgress()
    monkeypatch.setattr(
        'guanxing.interface.cli.flow.probe_capture',
        lambda *a, **kw: CaptureProbe(account='TESTACC', server='1',
                                      version='00073460', has_save=True),
    )
    settings = _settings(tmp_path)
    stacks = stacks_for(settings)
    flow.run_capture(FlowRequest(source=Path('old.har'), allow_device=True),
                     settings, *stacks, recorder,
                     wizard.InteractivePrompter(settings, recorder))

    assert not any(PULL_HINT in line for line in recorder.lines), \
        '旧版 HAR 不该出现取档预告'


def test_new_har_announces_a_long_wait_before_pulling(
        monkeypatch, tmp_path: Path) -> None:
    """新版 HAR 要现取存档——这条预告必须保留，且出现在拉档之前。"""
    from guanxing.application.dto import ImportOutcome

    _stub_device_saves(monkeypatch, tmp_path)
    monkeypatch.setattr(
        'guanxing.application.usecases.run_import.import_capture',
        lambda req, *a, progress=None: ImportOutcome(ok=True, nick='x'))
    recorder = RecordingProgress()
    monkeypatch.setattr(
        'guanxing.interface.cli.flow.probe_capture',
        lambda *a, **kw: CaptureProbe(account='TESTACC', server='1',
                                      version='00073460', has_save=False),
    )
    monkeypatch.setattr('builtins.input', lambda *a, **k: '')

    settings = _settings(tmp_path)
    stacks = stacks_for(settings)
    flow.run_capture(FlowRequest(source=Path('new.har'), allow_device=True),
                     settings, *stacks, recorder,
                     wizard.InteractivePrompter(settings, recorder))

    idx = next(i for i, line in enumerate(recorder.lines) if PULL_HINT in line)
    pull = next(i for i, line in enumerate(recorder.lines) if '存档来源' in line)
    assert idx < pull, '预告要在真正开始取档之前'


def test_scan_prompt_does_not_mention_pulling_a_save(
        monkeypatch, tmp_path: Path) -> None:
    """走到"要不要扫内存"时 dat.db 早就拉完了，别再让它以为还要去取档。"""
    prompts: list[str] = []
    monkeypatch.setattr('builtins.input',
                        lambda text='': prompts.append(str(text)) or '')
    from guanxing.domain.errors import OuterKeyUnavailable

    settings = _settings(tmp_path)
    wizard.InteractivePrompter(settings, RecordingProgress()).confirm_scan(
        OuterKeyUnavailable('x', tag='needs_memory'))
    joined = ' '.join(prompts)
    assert '取档' not in joined
    assert '扫' in joined, '要说清接下来是要扫内存'


# ───────────── 上次用过的模拟器（keys.local.json 里的 serial） ─────────────
def _two_devices(monkeypatch, tmp_path: Path) -> dict:
    """两台模拟器：记住的是第二台。"""
    from guanxing.application.ports.device import DeviceInfo, RemoteFile

    seen: dict = {}
    monkeypatch.setattr(
        'guanxing.application.usecases.device_saves.list_devices',
        lambda *a, **kw: [DeviceInfo(serial='127.0.0.1:5555'),
                          DeviceInfo(serial='127.0.0.1:7555')],
    )
    monkeypatch.setattr(
        'guanxing.application.usecases.device_saves.list_saves',
        lambda *a, **kw: [RemoteFile(path='/data/x/dat.db', size=4096, mtime='10-30 12:00')],
    )
    local_db = tmp_path / 'pulled.db'
    local_db.write_bytes(b'x')

    def fake_pull(_device, _storage, **kw):
        seen.update(kw)
        return local_db

    monkeypatch.setattr(
        'guanxing.application.usecases.device_saves.pull_save', fake_pull)
    from guanxing.application.dto import ImportOutcome

    monkeypatch.setattr(
        'guanxing.application.usecases.run_import.import_local',
        lambda req, *a, progress=None: ImportOutcome(ok=True, nick='x'))
    return seen


def test_remembered_serial_is_the_default_device(monkeypatch, tmp_path: Path, capsys) -> None:
    """回车就用上次那台 —— 多开时不必每次重新选。"""
    seen = _two_devices(monkeypatch, tmp_path)
    settings = build_settings(workspace=tmp_path, serial='127.0.0.1:7555')
    monkeypatch.setattr('builtins.input', lambda *a, **k: '')     # 两次回车 = 取默认

    assert flow.run_local(FlowRequest(allow_device=True), settings, *stacks_for(settings),
                          RecordingProgress(),
                          wizard.InteractivePrompter(settings, RecordingProgress())) is not None
    assert seen['serial'] == '127.0.0.1:7555'
    assert '（上次用的）' in capsys.readouterr().out


def test_unknown_remembered_serial_falls_back_to_first(
        monkeypatch, tmp_path: Path, capsys) -> None:
    """记住的那台不在了：不要卡住，退回第一台。"""
    seen = _two_devices(monkeypatch, tmp_path)
    settings = build_settings(workspace=tmp_path, serial='127.0.0.1:7557')
    monkeypatch.setattr('builtins.input', lambda *a, **k: '')

    assert flow.run_local(FlowRequest(allow_device=True), settings, *stacks_for(settings),
                          RecordingProgress(),
                          wizard.InteractivePrompter(settings, RecordingProgress())) is not None
    assert seen['serial'] == '127.0.0.1:5555'
    assert '（上次用的）' not in capsys.readouterr().out
