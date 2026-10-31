"""可选依赖的统一入口。

没装某个可选库不该让整个工具启动失败。
"""
from __future__ import annotations

import importlib


def available(module: str) -> bool:
    """只用来判断能力，不抛异常。"""
    try:
        importlib.import_module(module)
        return True
    except ImportError:
        return False


__all__ = ['available']
