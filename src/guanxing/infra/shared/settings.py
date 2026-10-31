"""从环境变量构造 Settings，是整个项目唯一做配置 IO 的一步。

优先级是命令行参数、环境变量、keys.local.json 里记的本机环境、内置默认，唯一构造点是 bootstrap。
不在 import 期读环境变量，否则测试之间会互相污染；值对象本身在 shared/settings.py。
"""
from __future__ import annotations

import json
import os
from collections.abc import Mapping
from pathlib import Path

from guanxing.infra.keys.migrate import LOCAL_ENV_FIELDS
from guanxing.shared.settings import MemMode, MemScan, Settings, Timeouts


def _env_path(env: Mapping[str, str], key: str) -> Path | None:
    raw = (env.get(key) or '').strip()
    return Path(raw).expanduser() if raw else None


def _local_env(path: Path) -> dict[str, str]:
    """读 keys.local.json 里记的 adb、serial、pkg，读不懂就当没有。"""
    try:
        text = Path(path).read_text(encoding='utf-8-sig')
        doc = json.loads(text) if text.strip() else {}
    except (OSError, ValueError):
        return {}
    if not isinstance(doc, dict):
        return {}
    out: dict[str, str] = {}
    for name in LOCAL_ENV_FIELDS:
        value = doc.get(name)
        if isinstance(value, str) and value.strip():
            out[name] = value.strip()
    return out


def load_settings(
    env: Mapping[str, str] | None = None,
    *,
    workspace: Path | None = None,
    default_workspace: Path | None = None,
    **overrides,
) -> Settings:
    """从环境变量构造配置，再叠加显式覆盖。

    Args:
        env: 环境变量映射，默认 os.environ。
        workspace: 显式指定的工作区，优先级最高，测试与调用方用。
        default_workspace: 兜底工作区，一般是启动脚本所在目录。
    Returns:
        不可变的 Settings。工作区按 workspace、GUANXING_WORKSPACE、
        default_workspace、当前目录依次取，取错地方会把密钥表分叉。
    """
    env = os.environ if env is None else env
    ws = (workspace
          or _env_path(env, 'GUANXING_WORKSPACE')
          or default_workspace
          or Path.cwd())

    out_dir = (
        _env_path(env, 'GUANXING_OUT_DIR')
        or _env_path(env, 'YYGX_OUT_DIR')
        or ws / 'output'
    )
    keys_file = _env_path(env, 'GUANXING_KEYS') or ws / 'keys.json'
    local_keys = _env_path(env, 'GUANXING_KEYS_LOCAL') or ws / 'keys.local.json'

    # 把上次用的 adb 环境存在这里；环境变量仍然优先
    remembered = _local_env(local_keys)
    adb_path = (env.get('YYGX_ADB') or '').strip() or remembered.get('adb') or None
    serial = (env.get('YYGX_SERIAL') or '').strip() or remembered.get('serial') or None
    package = (env.get('YYGX_PKG') or '').strip() or remembered.get('pkg') or None

    base = Settings(
        workspace=ws,
        out_dir=out_dir,
        keys_file=keys_file,
        local_keys_file=local_keys,
        web_dir=_env_path(env, 'GUANXING_WEB') or ws / 'web',
        cache_dir=_env_path(env, 'GUANXING_CACHE') or out_dir / '_cache',
        adb_path=adb_path,
        serial=serial,
        package=package,
        runtime='android',        # 只由 --runtime 指定，不认环境变量
        mem_mode=MemMode.parse(env.get('YYGX_MEM')),
    )
    return base.with_overrides(**overrides)


__all__ = ['MemMode', 'MemScan', 'Settings', 'Timeouts', 'load_settings']
