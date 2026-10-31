"""三包拆分契约 —— 装配点只返回 tuple，下游只拿自己那一包。"""
from __future__ import annotations

import dataclasses
import json
from datetime import datetime
from pathlib import Path

import pytest

from guanxing.application import packs
from guanxing.application.dto import ImportOutcome, ImportRequest
from guanxing.application.usecases._common import emit, pick_nick
from guanxing.bootstrap import build_settings
from guanxing.shared.errors import AppError
from tests.support import RecordingProgress, stacks_for


def _settings(tmp_path: Path):
    return build_settings(workspace=tmp_path)


def test_build_stacks_returns_three_typed_packs(tmp_path: Path) -> None:
    crypto, storage, device = stacks_for(_settings(tmp_path))
    assert isinstance(crypto, packs.CryptoStack)
    assert isinstance(storage, packs.StorageStack)
    assert isinstance(device, packs.DeviceStack)


def test_crypto_pack_exposes_narrow_hooks_not_the_hunter(tmp_path: Path) -> None:
    """用例只该看到"找钥匙"的 callable，不该拿到整台扫描机。"""
    crypto, _storage, _device = stacks_for(_settings(tmp_path))
    assert callable(crypto.hunt_inner_key)
    assert not hasattr(crypto, 'mem_hunter')


def test_storage_pack_takes_paths_from_settings(tmp_path: Path) -> None:
    """输出/缓存目录只有 Settings 一个来源，包里不再另存一份默认值。"""
    settings = _settings(tmp_path)
    _crypto, storage, _device = stacks_for(settings)
    assert storage.cache_dir == Path(settings.cache_dir)
    assert not hasattr(storage, 'default_out_dir')


def test_packs_have_no_behaviour() -> None:
    """零方法：包一旦长出方法就从依赖清单变成上帝对象。"""
    for cls in (packs.CryptoStack, packs.StorageStack, packs.DeviceStack):
        # 字段的默认值可能是 callable（如 clock=datetime.now），不算方法
        field_names = {f.name for f in dataclasses.fields(cls)}
        methods = [
            name for name, value in vars(cls).items()
            if callable(value) and not name.startswith('__') and name not in field_names
        ]
        assert methods == [], f'{cls.__name__} 不应有方法，却有 {methods}'


# ── emit 的单一来源守卫 ──
def _storage(tmp_path: Path) -> packs.StorageStack:
    class _Layout:
        def make_snapshot_dir(self, *_a, **_kw):  # noqa: ANN001
            raise AssertionError('不该走到写文件')

    return packs.StorageStack(
        fs=object(),
        layout=_Layout(),
        open_savedb=lambda _p: object(),
        open_capture=lambda _p: object(),
        cache_dir=tmp_path,
        clock=lambda: datetime(2026, 10, 30, 12, 0, 0),
    )


def test_emit_refuses_missing_out_dir(tmp_path: Path) -> None:
    """输出目录必须由接口层从 settings 填好；用例不自己猜默认值。"""
    out = ImportOutcome(kind='local', source='x', runtime='android')
    out.data = json.loads('{"MainRole": {"Name": "x"}}')
    req = ImportRequest(source=tmp_path / 'dat.db', out_dir=None)

    with pytest.raises(AppError) as err:
        emit(out, req, _storage(tmp_path), RecordingProgress())
    assert 'out_dir' in err.value.message


# ───────────────────── 角色名只在 MainRole.Name ─────────────────────
def test_pick_nick_reads_main_role_name() -> None:
    """真实存档的角色名就在顶层 ``MainRole.Name``（全量模型里也确认如此）。"""
    assert pick_nick({'MainRole': {'Name': '游戏角色'}}) == '游戏角色'
    assert pick_nick({'MainRole': {'Name': '  游戏角色  '}}) == '游戏角色'


@pytest.mark.parametrize('data', [
    None,
    {},
    {'MainRole': None},
    {'MainRole': []},
    {'MainRole': {}},
    {'MainRole': {'Name': None}},
    {'MainRole': {'Name': '   '}},
    {'MainRole': {'Name': 123}},
    {'nick': '只有假路径才有'},
    {'mainRole': {'name': '只有假路径才有'}},
])
def test_pick_nick_returns_empty_for_missing_or_wrong_shapes(data) -> None:
    """取不到就返回空串，交给调用方退化成 unnamed；不猜别的键。"""
    assert pick_nick(data) == ''
