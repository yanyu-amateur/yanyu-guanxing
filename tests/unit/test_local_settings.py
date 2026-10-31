"""配置优先级：命令行 > 环境变量 > keys.local.json 里的本机环境 > 内置默认。

1.1 工具把上次用的 adb / serial / pkg 存在 keys.local.json 里；
新版仍然认这三个值，所以老用户的文件不用手改就能继续跑。
"""
from __future__ import annotations

import json
from pathlib import Path

from guanxing.infra.shared.settings import load_settings

LEGACY_ENV = {
    'adb': r'C:\tools\platform-tools\adb.exe',
    'serial': '127.0.0.1:7555',
    'pkg': 'com.example.game',
}


def _workspace(tmp_path: Path, doc: object) -> Path:
    (tmp_path / 'keys.local.json').write_text(
        json.dumps(doc, ensure_ascii=False), encoding='utf-8')
    return tmp_path


def test_env_is_read_from_keys_local(tmp_path: Path) -> None:
    ws = _workspace(tmp_path, {'outer_keys': {}, **LEGACY_ENV})
    settings = load_settings(env={}, workspace=ws)
    assert settings.adb_path == LEGACY_ENV['adb']
    assert settings.serial == LEGACY_ENV['serial']
    assert settings.package == LEGACY_ENV['pkg']


def test_environment_variable_wins(tmp_path: Path) -> None:
    ws = _workspace(tmp_path, LEGACY_ENV)
    settings = load_settings(
        env={'YYGX_ADB': r'D:\other\adb.exe', 'YYGX_SERIAL': '127.0.0.1:7600'},
        workspace=ws,
    )
    assert settings.adb_path == r'D:\other\adb.exe'
    assert settings.serial == '127.0.0.1:7600', '变量优先于文件里的值'
    assert settings.package == LEGACY_ENV['pkg'], '没给变量的还是落回文件里的'


def test_cli_override_wins_over_everything(tmp_path: Path) -> None:
    ws = _workspace(tmp_path, LEGACY_ENV)
    settings = load_settings(env={'YYGX_ADB': r'D:\other\adb.exe'},
                             workspace=ws, package='com.other.game')
    assert settings.package == 'com.other.game'
    assert settings.adb_path == r'D:\other\adb.exe'


def test_missing_file_falls_back_to_defaults(tmp_path: Path) -> None:
    settings = load_settings(env={}, workspace=tmp_path)
    assert (settings.adb_path, settings.serial, settings.package) == (None, None, None)


def test_broken_file_does_not_raise(tmp_path: Path) -> None:
    """配置文件坏了由 KeyStore 统一报错；配置层只当没有，不能崩。"""
    (tmp_path / 'keys.local.json').write_text('{oops', encoding='utf-8')
    settings = load_settings(env={}, workspace=tmp_path)
    assert settings.adb_path is None


def test_blank_values_are_ignored(tmp_path: Path) -> None:
    ws = _workspace(tmp_path, {'adb': '   ', 'serial': '', 'pkg': None})
    settings = load_settings(env={}, workspace=ws)
    assert (settings.adb_path, settings.serial, settings.package) == (None, None, None)


def test_bom_tolerant(tmp_path: Path) -> None:
    """记事本另存为「UTF-8 带 BOM」是 Windows 上的常见状态。"""
    text = json.dumps(LEGACY_ENV, ensure_ascii=False)
    (tmp_path / 'keys.local.json').write_text('\ufeff' + text, encoding='utf-8')
    assert load_settings(env={}, workspace=tmp_path).serial == LEGACY_ENV['serial']
