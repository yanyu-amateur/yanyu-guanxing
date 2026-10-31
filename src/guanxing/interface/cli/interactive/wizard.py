"""python run.py 无参时的交互主流程：先选已有存档直接看网页，或走 local/capture 导入新的。

local 走「进角色存档 → 查本地钥匙 → 没有就扫内存」；capture 只用 HAR 补密钥或读旧版存档。
注意：导入流程在 ``cli/flow.py`` 里，这里只提供"每一步都问"的 Prompter 与快照入口。
"""
from __future__ import annotations

from collections.abc import Sequence
from dataclasses import replace
from pathlib import Path

from guanxing.application.packs import CryptoStack, DeviceStack, StorageStack
from guanxing.application.ports.device import DeviceInfo, RemoteFile
from guanxing.application.services.snapshots import (
    Snapshot,
    list_snapshots,
    load_plain_save,
)
from guanxing.application.usecases.publish_web import publish_web
from guanxing.domain.errors import OuterKeyUnavailable
from guanxing.shared.errors import AppError
from guanxing.shared.progress import ProgressSink
from guanxing.shared.settings import Settings
from guanxing.shared.text import human_size

from ..exit_codes import EXIT_OK
from ..flow import FlowRequest, FlowRunner, Prompter, run_capture, run_local
from .prompts import ask, choose, confirm


class InteractivePrompter(Prompter):
    """向导用：每一步都问，回车取默认值。"""

    def __init__(self, settings: Settings, progress: ProgressSink) -> None:
        self.settings = settings
        self.progress = progress

    def choose_device(self, devices: Sequence[DeviceInfo]) -> DeviceInfo | None:
        # 上次用过的设备（keys.local.json 里的 serial）排到默认位，仍可改选
        remembered = self.settings.serial
        labels = [(d.label + ('（上次用的）' if remembered and d.serial == remembered else ''))
                  for d in devices]
        default = next((i for i, d in enumerate(devices, 1)
                        if remembered and d.serial == remembered), 1)
        idx = choose('选择模拟器，自行在模拟器设置中查阅对应型号', labels, default=default)
        return None if idx == 0 else devices[idx - 1]

    def choose_save(self, files: Sequence[RemoteFile]) -> RemoteFile | None:
        if len(files) > 1:
            idx = choose(
                '找到多个 dat.db（按修改时间从新到旧；选最近的那个）',
                [_save_label(f, i) for i, f in enumerate(files)],
                default=1,
            )
            return None if idx == 0 else files[idx - 1]
        if not confirm(f'使用 {files[0].path}（{files[0].size:,} B）？', default=True):
            return None
        return files[0]

    def confirm_scan(self, _exc: OuterKeyUnavailable) -> bool:
        """是否允许扫内存：只读，但会占几百 MB 带宽与十几秒，值得问一句。"""
        return confirm(
            '本地没有这个存档的外层密钥（新版存档每账号一把）。\n'
            '是否从模拟器进程内存中获取？（需要模拟器已开 root、正登录同一账号，只读不修改）\n'
            '如继续，请先重新登录游戏 - 进角色界面 - 点一次保存\n'
            '接下来可能要几分钟（要扫模拟器内存）',
            default=True,
        )

    def ask_manual_key(self, _exc: OuterKeyUnavailable) -> str | None:
        """让用户手填外层密钥；回车表示放弃。"""
        return ask('本地没有可用外层密钥，请粘贴 16 位外层密钥（回车跳过）', default='') or None

    def before_pull(self) -> None:
        self.progress.info('开始识别模拟器并拉取 dat.db（可能要几秒）……')


def run_wizard(settings: Settings, crypto: CryptoStack, storage: StorageStack,
               device: DeviceStack, progress: ProgressSink) -> int:
    """向导主函数，返回退出码。"""
    _banner()
    snapshots = list_snapshots(storage.fs, Path(settings.out_dir))

    if snapshots:
        # 这里的 0 是"导入新的"，不是"返回"——标签必须跟着这个语义走
        picked = choose(
            '已导入的存档（选 0 表示导入新的）',
            [s.label() for s in snapshots],
            default=0,
            zero_label='导入新的存档',
        )
        if picked:
            return _open_snapshot(snapshots[picked - 1], settings, storage, progress)
    else:
        print(f'\n（{settings.out_dir} 下还没有导入过存档）')

    mode = choose('选择导入方式', [
        'local   —— 读模拟器上的 dat.db 解档（默认；需要 adb）',
        'capture —— 旧版 HAR 可选此项直接出存档，'
        '其他仅在内存挖不到 psw 时用这条路径提取',
    ], default=1)
    if mode == 0:
        return EXIT_OK

    req = FlowRequest(allow_device=True)
    if mode == 1:
        return _finish(run_local, req, settings, crypto, storage, device, progress)
    har = ask('HAR 文件路径')
    if not har:
        raise AppError('没有提供 HAR 文件')
    return _finish(run_capture, replace(req, source=Path(har)),
                   settings, crypto, storage, device, progress)


def _finish(run: FlowRunner, req: FlowRequest, settings: Settings,
            crypto: CryptoStack, storage: StorageStack, device: DeviceStack,
            progress: ProgressSink) -> int:
    """跑完导入后问一句要不要打开网页。"""
    outcome = run(req, settings, crypto, storage, device, progress,
                  InteractivePrompter(settings, progress))
    if confirm('导入成功，是否打开网页？', default=True):
        return _open_payload(settings, outcome.data, outcome.to_meta(),
                             storage, progress)
    return EXIT_OK


def _save_label(item: RemoteFile, index: int) -> str:
    """渲染一行存档选项：区服、账号前缀、修改时间、大小。

    Args:
        item: 远端文件。
        index: 在列表里的下标，0 表示最新。
    Returns:
        一行文本，形如 ``server1  abcdef12…  2026-10-30 13:46  1.3MB  ← 最新``。
    """
    parts = Path(item.path).parts
    server = parts[-2] if len(parts) >= 2 else '?'
    account = parts[-3][:8] + '…' if len(parts) >= 3 else ''
    newest = '  ← 最新' if index == 0 else ''
    return (f'{server:<10} {account:<10} '
            f'{item.mtime or "?":<16} {human_size(item.size):>8}{newest}')


def _open_snapshot(snapshot: Snapshot, settings: Settings, storage: StorageStack,
                   progress: ProgressSink) -> int:
    """把已导入的快照直接发布到网页。"""
    data = load_plain_save(storage.fs, snapshot)
    if data is None:
        raise AppError(f'快照里没有可用的 dat.json: {snapshot.dat_json}')
    return _open_payload(settings, data, snapshot.meta, storage, progress)


def _open_payload(settings: Settings, data: dict | None, meta: dict | None,
                  storage: StorageStack, progress: ProgressSink) -> int:
    """把存档发布成网页并打开；返回退出码（这一步成功即视为整体成功）。"""
    publish_web(settings, data, meta, storage, progress)
    return EXIT_OK


def _banner() -> None:
    print('=' * 60)
    print(' 观星工具 · 存档导入')
    print('=' * 60)


__all__ = ['InteractivePrompter', 'run_wizard']
