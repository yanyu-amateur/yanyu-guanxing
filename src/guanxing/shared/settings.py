"""一次运行的配置值对象，纯数据不做 IO。

怎么读环境变量在 infra/shared/settings.py。
"""
from __future__ import annotations

from dataclasses import dataclass, replace
from enum import Enum
from pathlib import Path


class MemMode(str, Enum):
    """内存爆破策略（配置值，随 CLI / 环境变量传入）。

    - ``AUTO``：先查密钥表/记录，命中即用；否则才扫内存。
    - ``FORCE``：跳过查表，直接扫内存（怀疑表里的钥匙过期时用）。
      只跳过"表里记的值"，``--outer-key`` 这类显式传入仍然优先试。
    - ``OFF``：绝不扫内存（离线/无设备场景，失败就报结构化错误）。
    """
    AUTO = 'auto'
    FORCE = 'force'
    OFF = 'off'

    @classmethod
    def parse(cls, raw: str | MemMode | None) -> MemMode:
        """把 CLI 字符串、环境变量或已解析的枚举归一成 MemMode。

        Args:
            raw: 原始输入。
        Returns:
            对应的 MemMode；非法值退回 AUTO，环境变量写错不该让工具起不来。
        """
        if isinstance(raw, cls):
            return raw
        try:
            return cls((raw or 'auto').strip().lower())
        except ValueError:
            return cls.AUTO

    @property
    def may_scan(self) -> bool:
        """是否允许去扫进程内存（``OFF`` 是唯一禁止的）。"""
        return self is not MemMode.OFF

    @property
    def skip_table(self) -> bool:
        """是否跳过本地查表直接扫（``FORCE``）。"""
        return self is MemMode.FORCE


@dataclass(frozen=True)
class Timeouts:
    """所有外部调用的超时（秒）。集中一处，便于一次调大。"""

    adb: int = 20
    scan: int = 60                  # 单块内存 dd 的超时


@dataclass(frozen=True)
class MemScan:
    """内存扫描与爆破的调优参数。

    换台机器（内存大小、CPU 核数不同）就得改的值放这里；
    "协议规定的"（长度、位宽）放 domain/constants。
    """

    anon_only: bool = True          # 只扫匿名区（跳过 so/apk 映射，少扫一半）
    min_kb: int = 64                # 小于这个的段不值得一次 adb 往返
    region_max_mb: int = 64         # 单个区域最多读多少
    chunk_mb: int = 64              # 一次 dd 读多少
    limit_mb: int | None = None     # 整轮扫描上限（None = 不限）
    crack_threshold: int = 20000    # 候选超过多少才开进程池
    workers: int | None = None      # None = CPU 核数


@dataclass(frozen=True)
class Settings:
    """一次运行的全部配置。"""

    workspace: Path
    out_dir: Path
    keys_file: Path
    local_keys_file: Path
    web_dir: Path
    cache_dir: Path
    adb_path: str | None = None
    serial: str | None = None
    package: str | None = None
    runtime: str = 'android'
    mem_mode: MemMode = MemMode.AUTO
    verbose: int = 0
    quiet: bool = False
    timeouts: Timeouts = Timeouts()
    mem: MemScan = MemScan()

    # ── 派生视图 ──
    @property
    def show_keys(self) -> bool:
        """是否在控制台显示完整密钥（默认脱敏）。"""
        return self.verbose >= 2

    def with_overrides(self, **kwargs) -> Settings:
        """返回替换了若干字段的新实例（不可变风格）。"""
        clean = {k: v for k, v in kwargs.items() if v is not None}
        return replace(self, **clean) if clean else self


__all__ = ['MemMode', 'MemScan', 'Settings', 'Timeouts']
