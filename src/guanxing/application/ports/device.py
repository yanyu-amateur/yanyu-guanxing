"""设备端口：adb、存档定位与拉取。

列设备、找哪个包有存档、把文件拉下来。
注意：实现见 ``infra/device/adb_client.py``，所有失败都必须翻成 ADBError。
"""
from __future__ import annotations

from collections.abc import Sequence
from dataclasses import dataclass
from pathlib import Path
from typing import Protocol


@dataclass(frozen=True)
class DeviceInfo:
    """一台可用设备。"""

    serial: str
    state: str = 'device'
    model: str = ''

    @property
    def label(self) -> str:
        return f'{self.serial} ({self.model})' if self.model else self.serial


@dataclass(frozen=True)
class RemoteFile:
    """设备上的一个文件（够用即可，不要为了完整去解析 ls 的全部列）。"""

    path: str
    size: int = 0
    mtime: str = ''
    # 排序使用mtime_epoch，缺失时退化到 mtime 字符串
    mtime_epoch: float = 0.0

    def sort_key(self) -> tuple[float, str]:
        """从新到旧排序用的键（时间缺失时退化到字符串）。"""
        return (self.mtime_epoch, self.mtime)


class DeviceGateway(Protocol):
    """设备能力集合"""

    def devices(self) -> Sequence[DeviceInfo]: ...

    def sh(self, cmd: str, *, timeout: int | None = None) -> str:
        """执行 shell 命令，返回 stdout（失败抛 ADBError）。"""
        ...

    def pid_of(self, package: str) -> str | None:
        """游戏进程id；没在运行返回 None。"""
        ...

    def find_saves(self, package: str) -> Sequence[RemoteFile]:
        """在各候选根目录下找 ``*/server*/dat.db``。"""
        ...

    def detect_save_packages(self) -> Sequence[str]:
        """扫设备，返回带存档结构的包名（渠道无关，渠道表没收录时靠它）。"""
        ...

    def pull(self, remote: str, local: Path) -> Path:
        """把设备文件拉到本地，返回本地路径。"""
        ...


__all__ = ['DeviceGateway', 'DeviceInfo', 'RemoteFile']
