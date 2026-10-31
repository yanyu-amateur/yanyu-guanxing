"""命令行与向导共用的导入编排：local 与 capture 各一条入口。

local 只读 dat.db；capture 先用 HAR 取 psw（旧版还能直接拿到存档），存档仍从 --db 或设备来。
两条只在这些地方不同，取档、清理临时档、打印结论只写这一遍，提问收进 ``Prompter``。
注意：这里不翻译退出码也不吞异常；临时档"成功即删、失败留并提示在哪"只在这一处决定。
"""
from __future__ import annotations

from collections.abc import Callable, Sequence
from dataclasses import dataclass
from pathlib import Path
from typing import Protocol

from guanxing.application.dto import CaptureProbe, ImportOutcome, ImportRequest
from guanxing.application.packs import CryptoStack, DeviceStack, StorageStack
from guanxing.application.ports.device import DeviceInfo, RemoteFile
from guanxing.application.usecases.device_saves import (
    discard,
    fetch_save,
    hint_leftover,
)
from guanxing.application.usecases.probe_capture import probe_capture
from guanxing.application.usecases.run_import import run_import
from guanxing.domain.errors import OuterKeyUnavailable
from guanxing.shared.errors import AppError, CancelledError
from guanxing.shared.progress import ProgressSink
from guanxing.shared.settings import Settings

from .report import print_outcome, report_keystore_notes


@dataclass(frozen=True)
class FlowRequest:
    """一次导入的入口参数，与 argparse 和向导菜单的细节无关。"""

    source: Path | None = None      # local 的 dat.db，或 capture 的 HAR
    database: Path | None = None    # 显式 --db，只有 capture 用得上
    server: str | None = None
    allow_device: bool = False      # 允许去模拟器取档
    prefer_device: bool = False     # 用户显式要求 --from-device
    outer_key: str | None = None
    inner_key: str | None = None
    account: str | None = None
    name: str | None = None
    dry_run: bool = False


class Prompter(Protocol):
    """流程里唯一需要问用户的四件事，外加一句开工前的预告。"""

    def choose_device(self, devices: Sequence[DeviceInfo]) -> DeviceInfo | None:
        """多台设备时选一台；返回 None 表示用户放弃。"""
        ...

    def choose_save(self, files: Sequence[RemoteFile]) -> RemoteFile | None:
        """多份存档时选一份；返回 None 表示用户放弃。"""
        ...

    def confirm_scan(self, exc: OuterKeyUnavailable) -> bool:
        """缺外层密钥时，问是否允许扫进程内存。"""
        ...

    def ask_manual_key(self, exc: OuterKeyUnavailable) -> str | None:
        """缺外层密钥时，问要不要手填；返回 None 表示不填。"""
        ...

    def before_pull(self) -> None:
        """真正开始取档前的预告（说不说取决于入口）。"""
        ...


# 两条入口签名一致，调用方按场景选一条
FlowRunner = Callable[[FlowRequest, Settings, CryptoStack, StorageStack,
                       DeviceStack, ProgressSink, Prompter], ImportOutcome]


class SilentPrompter:
    """不提问的实现：命令行用。所有选择都取默认值，默认值本身带一句提示。"""

    def __init__(self, progress: ProgressSink, *, serial: str | None = None) -> None:
        self.progress = progress
        self.serial = serial

    def choose_device(self, devices: Sequence[DeviceInfo]) -> DeviceInfo | None:
        if self.serial:
            for item in devices:
                if item.serial == self.serial:
                    return item
            return devices[0]        # 不在线的情况 pick_device 已经提示过，这里不重复
        if len(devices) > 1:
            self.progress.warn(
                f'检测到 {len(devices)} 个模拟器，默认用 {devices[0].label}'
                '（可用 --serial 指定）')
        return devices[0]

    def choose_save(self, files: Sequence[RemoteFile]) -> RemoteFile | None:
        """``list_saves`` 已按修改时间倒序，第一份就是最新的。"""
        return files[0]

    def confirm_scan(self, _exc: OuterKeyUnavailable) -> bool:
        self.progress.hint('本地没有外层密钥，改从进程内存里找（--mem off 可禁用）')
        return True

    def ask_manual_key(self, _exc: OuterKeyUnavailable) -> str | None:
        """命令行不追问密钥：缺就报错，让用户带 --outer-key 重跑。"""
        return None

    def before_pull(self) -> None:
        """非交互：不预告耗时，进度行自己会说在拉什么。"""
        return None


def run_local(
    req: FlowRequest,
    settings: Settings,
    crypto: CryptoStack,
    storage: StorageStack,
    device: DeviceStack,
    progress: ProgressSink,
    prompter: Prompter,
) -> ImportOutcome:
    """读一份 dat.db 解档：给了路径就用它，否则从模拟器取一份。

    Args:
        req: 入口参数，``source`` 是 dat.db 路径，可以没有。
        settings: 本次运行配置。
        crypto: 密钥与解密那一包。
        storage: 存储那一包。
        device: 设备那一包。
        progress: 进度上报。
        prompter: 需要问用户时的实现。
    Returns:
        导入结果（临时档已处理，结论行已输出）。
    Raises:
        AppError: 任何可预期的失败；临时档会留着并另外提示在哪。
        CancelledError: 用户在选设备或选存档时放弃。
    """
    db_path, server, pulled = _pick_database(
        req, probe=None, settings=settings, device=device, storage=storage,
        progress=progress, prompter=prompter)
    return _import(req, settings, crypto, storage, progress, prompter,
                   command='local', probe=None, source=db_path,
                   database=req.database, server=server, pulled=pulled)


def run_capture(
    req: FlowRequest,
    settings: Settings,
    crypto: CryptoStack,
    storage: StorageStack,
    device: DeviceStack,
    progress: ProgressSink,
    prompter: Prompter,
) -> ImportOutcome:
    """读一份 HAR：旧版存档就在 upload 体里，新版只提供 psw，存档另取。

    Args:
        req: 入口参数，``source`` 是 HAR 路径。
        settings: 本次运行配置。
        crypto: 密钥与解密那一包。
        storage: 存储那一包。
        device: 设备那一包。
        progress: 进度上报。
        prompter: 需要问用户时的实现。
    Returns:
        导入结果（临时档已处理，结论行已输出）。
    Raises:
        AppError: 任何可预期的失败；读不了 HAR 会在这里就上抛。
        CancelledError: 用户在选设备或选存档时放弃。
    """
    if req.source is None:
        raise AppError('capture 模式需要提供 HAR 文件路径',
                       hints=['例: python run.py capture x.har --from-device'])
    probe = _probe_har(req.source, crypto, storage, progress)
    db_path, server, pulled = _pick_database(
        req, probe=probe, settings=settings, device=device, storage=storage,
        progress=progress, prompter=prompter)
    return _import(req, settings, crypto, storage, progress, prompter,
                   command='capture', probe=probe, source=req.source,
                   database=db_path, server=server, pulled=pulled)


def _probe_har(source: Path, crypto: CryptoStack, storage: StorageStack,
               progress: ProgressSink) -> CaptureProbe:
    """探测 HAR 的形状：账号、区服、版本，以及存档是否就在 upload 体里。

    Args:
        source: HAR 文件路径。
        crypto: 密钥与解密那一包。
        storage: 存储那一包。
        progress: 进度上报。
    Returns:
        探测结果，带着已经解出来的 ``content`` 与 ``psw``。
    Raises:
        HarError: HAR 读不了或结构不对。先报这个，别为探测去白拉一次设备存档。
    """
    probe = probe_capture(source, crypto, storage, progress)
    progress.step('抓包版本', probe.version or '（未抓到）')
    if probe.account:
        progress.step('账号', probe.account)
    return probe


def _pick_database(
    req: FlowRequest,
    *,
    probe: CaptureProbe | None,
    settings: Settings,
    device: DeviceStack,
    storage: StorageStack,
    progress: ProgressSink,
    prompter: Prompter,
) -> tuple[Path | None, str | None, Path | None]:
    """定下这次要解的 dat.db，必要时从模拟器取一份。

    Args:
        req: 入口参数。
        probe: capture 的探测结果；None 表示这是 local（``req.source`` 本身就是 dat.db）。
    Returns:
        ``(路径, 区服号, 需要用完清理的临时档)``。路径为 None 时交给用例报错，
        因为"缺 psw"与"缺 dat.db"各自有更贴切的提示。
    """
    if req.database is not None:
        if probe is not None and not probe.has_save:
            progress.step('存档来源', f'dat.db（{req.database.name}，HAR 只提供 psw）')
        return req.database, req.server, None

    if probe is None:
        if req.source is not None:
            if req.prefer_device:
                progress.hint(f'已按你给的路径读取存档，跳过模拟器：{req.source.name}')
            return req.source, req.server, None
    elif probe.has_save:
        progress.step('存档来源', 'HAR 的 upload 请求体（旧版，不需要 dat.db）')
        return None, req.server, None

    if not req.allow_device:
        return None, req.server, None

    prompter.before_pull()
    progress.step('存档来源', '模拟器上的 dat.db'
                  + ('（HAR 只提供 psw）' if probe is not None else ''))
    picked = fetch_save(device, storage, package=settings.package,
                        serial=settings.serial,
                        device_chooser=prompter.choose_device,
                        save_chooser=prompter.choose_save,
                        progress=progress)
    if picked is None:
        raise CancelledError('已取消')
    return picked.local, picked.server, picked.local


def _import(
    req: FlowRequest,
    settings: Settings,
    crypto: CryptoStack,
    storage: StorageStack,
    progress: ProgressSink,
    prompter: Prompter,
    *,
    command: str,
    probe: CaptureProbe | None,
    source: Path | None,
    database: Path | None,
    server: str | None,
    pulled: Path | None,
) -> ImportOutcome:
    """跑用例并收尾：成功清临时档，失败留档并提示在哪，然后打印结论。"""
    request = ImportRequest(
        source=source,
        database=database,
        runtime=settings.runtime,
        mem_mode=settings.mem_mode,
        outer_key=req.outer_key,
        inner_key=req.inner_key,
        account=req.account,
        server=server,
        out_dir=Path(settings.out_dir),
        name=req.name,
        dry_run=req.dry_run,
        probe=probe,
    )
    try:
        outcome = run_import(request, crypto, storage, progress,
                             ask_scan=prompter.confirm_scan,
                             ask_manual_key=prompter.ask_manual_key,
                             command=command)
    except AppError:
        hint_leftover(pulled, progress=progress)
        raise
    if pulled is not None:
        discard(pulled, progress=progress)
    report_keystore_notes(crypto.keystore, progress)
    print_outcome(outcome, progress, show_keys=settings.show_keys)
    return outcome


__all__ = ['FlowRequest', 'FlowRunner', 'Prompter', 'SilentPrompter',
           'run_capture', 'run_local']
