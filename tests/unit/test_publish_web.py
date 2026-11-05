"""网页发布用例：写注入文件、提示、打开首页。

锁住三件事：没有数据时什么都不写（不能生成空存档让人以为导入成功）；
首页不存在时只提示不崩；写不进去要抛出来不能静默。
"""
from __future__ import annotations

from pathlib import Path

import pytest

from guanxing.application import packs
from guanxing.application.usecases.publish_web import publish_web
from guanxing.bootstrap import build_settings
from guanxing.shared.errors import WriteFailed
from tests.support import RecordingProgress


class Recorder:
    """记下所有输出的 ProgressSink（只关心 hint/warn/step 的文本）。"""

    def __init__(self) -> None:
        self.steps: list[tuple[str, str]] = []
        self.warnings: list[str] = []
        self.hints: list[str] = []

    def step(self, label: str, value: str, *, ok: bool = True) -> None:
        self.steps.append((label, value))

    def info(self, text: str) -> None:
        pass

    def warn(self, text: str) -> None:
        self.warnings.append(text)

    def hint(self, text: str) -> None:
        self.hints.append(text)

    def debug(self, text: str) -> None:
        pass

    def task(self, total: int, desc: str, unit: str = ''):
        raise AssertionError('发布网页不该开进度条')


def _storage(web_dir: Path, *, fail: bool = False,
             files: set[str] | None = None,
             elevated: bool = False) -> tuple[packs.StorageStack, list[str]]:
    """造一个只实现"写文件 / 开浏览器 / 判断存在"的存储包。"""
    opened: list[str] = []
    existing = files if files is not None else {'index.html'}

    def write_local_save(path: Path, data, meta) -> Path:
        if fail:
            raise WriteFailed('写不进去')
        target = Path(path) / 'local-save.js'
        return target

    def open_url(url: str) -> bool:
        opened.append(url)
        return True

    class _Fs:
        def exists(self, path: Path) -> bool:
            return Path(path).name in existing

        def read_text(self, path: Path, *, encoding: str = 'utf-8') -> str:
            return ''

        def atomic_write_text(self, path: Path, text: str, **kw) -> None:
            pass

        def makedirs(self, path: Path) -> None:
            pass

        def list_dir(self, path: Path):
            return ()

    return packs.StorageStack(
        fs=_Fs(),                      # type: ignore[arg-type]
        layout=object(),               # type: ignore[arg-type]
        open_savedb=lambda _p: object(),
        open_capture=lambda _p: object(),
        write_local_save=write_local_save,
        open_url=open_url,
        is_elevated=lambda: elevated,
    ), opened


def test_empty_data_writes_nothing(tmp_path: Path) -> None:
    """没有明文存档时不许写文件、也不许开浏览器。"""
    settings = build_settings(workspace=tmp_path)
    storage, opened = _storage(settings.web_dir)
    sink = Recorder()

    assert publish_web(settings, None, None, storage, sink) is None
    assert opened == []
    assert any('没有可注入网页的存档数据' in w for w in sink.warnings)


def test_normal_path_writes_and_opens(tmp_path: Path) -> None:
    settings = build_settings(workspace=tmp_path)
    storage, opened = _storage(settings.web_dir)
    sink = Recorder()

    target = publish_web(settings, {'a': 1}, {'nick': 'x'}, storage, sink)

    assert target is not None and target.name == 'local-save.js'
    assert len(opened) == 1 and opened[0].endswith('index.html')
    assert any(label == '已写入' for label, _ in sink.steps)


def test_missing_index_only_warns(tmp_path: Path) -> None:
    """没有首页文件时给提示，不要抛异常，也不要打开不存在的地址。"""
    settings = build_settings(workspace=tmp_path)
    storage, opened = _storage(settings.web_dir, files=set())
    sink = Recorder()

    target = publish_web(settings, {'a': 1}, None, storage, sink)

    assert target is not None              # 文件已经写了，所以仍返回路径
    assert opened == []
    assert any('请手动打开' in w for w in sink.warnings)


def test_write_failure_propagates(tmp_path: Path) -> None:
    """写不进去要抛出去（上层会翻译成"目录不可写"），不能静默成功。"""
    settings = build_settings(workspace=tmp_path)
    storage, _opened = _storage(settings.web_dir, fail=True)

    with pytest.raises(WriteFailed):
        publish_web(settings, {'a': 1}, None, storage, RecordingProgress())


def test_unwired_storage_fails_loudly(tmp_path: Path) -> None:
    """StorageStack 没接线时要立刻炸，而不是静默什么都不做。"""
    settings = build_settings(workspace=tmp_path)
    bare = packs.StorageStack(
        fs=object(),                   # type: ignore[arg-type]
        layout=object(),               # type: ignore[arg-type]
        open_savedb=lambda _p: object(),
        open_capture=lambda _p: object(),
    )
    with pytest.raises(RuntimeError):
        publish_web(settings, {'a': 1}, None, bare, RecordingProgress())


def test_relative_web_dir_is_resolved_before_as_uri(tmp_path: Path) -> None:
    """``web_dir`` 是相对路径时 ``as_uri()`` 会抛 ValueError，必须先 resolve。"""
    settings = build_settings(workspace=Path('.'), web_dir=Path('web'))
    assert not Path(settings.web_dir).is_absolute()

    storage, opened = _storage(Path('web'))
    sink = Recorder()

    publish_web(settings, {'a': 1}, None, storage, sink)

    assert len(opened) == 1
    assert opened[0].startswith('file:///')
    assert Path(opened[0].replace('file:///', '').replace('/', '\\')).is_absolute()


def test_browser_open_failure_warns_with_path(tmp_path: Path) -> None:
    """浏览器没打开时必须提示，并给出能直接双击的路径。"""
    settings = build_settings(workspace=tmp_path)
    storage, opened = _storage(settings.web_dir)

    def failing_open(url: str) -> bool:
        opened.append(url)
        return False

    storage = packs.StorageStack(
        fs=storage.fs, layout=storage.layout,
        open_savedb=storage.open_savedb, open_capture=storage.open_capture,
        write_local_save=storage.write_local_save,
        open_url=failing_open,
        is_elevated=lambda: False,
    )
    sink = Recorder()

    publish_web(settings, {'a': 1}, None, storage, sink)

    assert len(opened) == 1
    assert any('没能自动打开浏览器' in w for w in sink.warnings)
    assert any('index.html' in w for w in sink.warnings)


def test_elevated_run_warns_before_opening(tmp_path: Path) -> None:
    """管理员权限下 DDE 常被拒绝，提前提示一句比失败后才发现好。"""
    settings = build_settings(workspace=tmp_path)
    storage, _opened = _storage(settings.web_dir, elevated=True)
    sink = Recorder()

    publish_web(settings, {'a': 1}, None, storage, sink)

    assert any('管理员权限' in w for w in sink.warnings)
