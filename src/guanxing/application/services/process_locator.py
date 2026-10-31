"""找到"正在运行、且装了这款游戏"的进程（只碰设备端口）。

一次 ``detect_save_packages`` 就能拿到"谁有存档目录"，比内置表里逐个 ``pidof``
省掉十几次 adb 往返；内置表只用来排序（官服优先）。
adb 读不通不是"游戏没开"，两者要分别上抛，否则用户会去重启游戏而该修的是 adb。
"""
from __future__ import annotations

import logging
from collections.abc import Callable

from guanxing.domain.channels import GAME_PACKAGES
from guanxing.domain.errors import OuterKeyUnavailable
from guanxing.shared.errors import ADBError, MultipleDevices
from guanxing.shared.progress import ProgressSink

from ..ports.device import DeviceGateway

logger = logging.getLogger(__name__)


class ProcessLocator:
    """定位目标进程：返回 ``(包名, pid)``。"""

    def __init__(
        self,
        *,
        open_device: Callable[..., DeviceGateway],
        packages: tuple[str, ...] = GAME_PACKAGES,
        progress: ProgressSink,
    ) -> None:
        self.open_device = open_device
        self.packages = packages
        self.progress = progress

    def find(self) -> tuple[str, str]:
        """返回 ``(包名, pid)``；没有正在运行的游戏就抛结构化错误。

        Raises:
            ADBError: adb 连不上设备、读不到进程列表。
            OuterKeyUnavailable: adb 正常，只是没有游戏进程在跑。
        """
        device = self.open_device()
        detected = self._detect_packages(device)
        if not detected:
            self._require_device(device)
        order = [p for p in self.packages if p in detected]
        order += [p for p in detected if p not in order]
        if not order:
            order = list(self.packages)

        failure: ADBError | None = None
        for package in order:
            try:
                pid = device.pid_of(package)
            except ADBError as exc:      # 单个包查不到不该中断整轮，但要留痕
                failure = failure or exc
                continue
            if pid:
                tag = '' if package in self.packages else '，自动探测'
                self.progress.step('内存爆破', f'{package} 正在运行（pid {pid}{tag}）')
                return package, pid

        if isinstance(failure, MultipleDevices):
            raise failure          # 多设备是"选哪台"的问题，别裹成"adb 读不到进程列表"
        if failure is not None:
            # 全查不通说明问题在 adb，不在游戏
            raise ADBError(
                f'adb 读不到进程列表：{failure.message}',
                hint=failure.hints[0] if failure.hints else None,
            ) from failure

        raise OuterKeyUnavailable(
            '没有找到正在运行的游戏进程，内存里挖不到密钥',
            command='mem',
            retry_with_outer_key=False,
        )

    def _require_device(self, device: DeviceGateway) -> None:
        """一个存档目录都没扫到时，先分清是 adb 没连上还是真没装游戏。"""
        if device.devices():
            return
        raise ADBError(
            '没有检测到模拟器',
            hint='adb devices 里一台都没有：模拟器没启动，或 adb 连的不是它那个端口',
        )

    def _detect_packages(self, device: DeviceGateway) -> list[str]:
        """设备上带存档目录的包名；探测失败时退回内置表。"""
        try:
            return list(device.detect_save_packages())
        except ADBError as exc:          # 探测失败就走内置表
            logger.warning('自动探测包名失败，退回内置表：%s', exc)
            return list(self.packages)


__all__ = ['ProcessLocator']
