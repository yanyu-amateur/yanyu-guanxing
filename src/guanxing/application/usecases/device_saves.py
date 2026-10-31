"""用例：从模拟器定位并取回 dat.db。"""
from __future__ import annotations

import re
import time
from collections.abc import Callable, Sequence
from dataclasses import dataclass
from pathlib import Path

from guanxing.domain.channels import DEFAULT_PACKAGE, label_of
from guanxing.domain.save import naming
from guanxing.shared.errors import AppError
from guanxing.shared.progress import ProgressSink

from ..packs import DeviceStack, StorageStack
from ..ports.device import DeviceInfo, RemoteFile

# 临时存档的文件名：``<yyyymmdd-hhmmss>-<包名>.db``（见 pull_save）。
# 清理时只认这个形状，避免把 cache_dir 里别的东西删掉。
_CACHE_NAME_RE = re.compile(r'^\d{8}-\d{6}-.+\.db$')

# 临时存档至少留这么久再清：失败提示会让用户马上去看它，不能刚生成就删掉
CACHE_KEEP_SEC = 60*60*24


def list_devices(device: DeviceStack) -> list[DeviceInfo]:
    """列出可用设备；一个都没有时给出可执行的提示。"""
    devices = list(device.open_device().devices())
    if not devices:
        raise AppError(
            '没有检测到模拟器',
            hints=[
                '确认 MuMu 等模拟器已启动，且 adb devices 能看到它',
                '找不到 adb 时可设环境变量 启动时添加 --adb 指向 adb.exe',
            ],
        )
    return devices


def list_saves(
    device: DeviceStack,
    *,
    serial: str,
    package: str | None = None,
    progress: ProgressSink,
) -> list[RemoteFile]:
    """该包名下的所有 ``dat.db``（按修改时间倒序）。

    Args:
        device: 设备那一包。
        serial: adb 设备号。
        package: 包名；None 时先用官服，没存档再让设备自己报。
        progress: 进度上报。
    Returns:
        按修改时间倒序的远端文件。
    Raises:
        AppError: 设备上一个带存档的包都没有。
    """
    gateway = device.open_device(serial=serial)

    wanted = package or DEFAULT_PACKAGE
    progress.step('目标包名', f'{wanted}（{label_of(wanted)}）')
    files = list(gateway.find_saves(wanted))
    if not files and package is None:
        # 内置表没命中（新渠道）——问设备：谁有 files/<账号>/serverNN/dat.db
        detected = list(gateway.detect_save_packages())
        progress.step('自动探测包名', '、'.join(detected) or '（无）')
        for candidate in detected:
            if candidate == wanted:
                continue
            files.extend(gateway.find_saves(candidate))
    if not files:
        raise AppError(
            f'在 {wanted}（{label_of(wanted)}）下没找到 dat.db',
            hints=[
                '确认游戏已进入过一次角色（存档是进游戏后才落盘的）',
                '玩的是其他渠道就用 --package 指定包名，或设环境变量 YYGX_PKG',
                '或者在向导里改用 capture 模式，配合抓包拿到 psw',
            ],
        )
    return files


def package_of(path: str) -> str:
    """从存档路径 …/<pkg>/files/<账号>/serverNN/dat.db 里取包名。

    Args:
        path: 设备上的存档路径。
    Returns:
        包名；路径里没有 files/ 时返回空串。缓存文件名以路径为准，因为自动探测到的
        包名未必是 --package 给的那个。
    """
    parts = Path(path or '').parts
    if 'files' not in parts:
        return ''
    idx = parts.index('files')
    return parts[idx - 1] if idx else ''


def purge_cache(cache_dir: Path, *, progress: ProgressSink,
                min_age_sec: int = CACHE_KEEP_SEC) -> int:
    """清掉 _cache 里放久了的临时 dat.db，返回删掉的个数。

    Args:
        cache_dir: 临时目录，一般是 <out>/_cache。
        progress: 进度上报。
        min_age_sec: 只清超过这么久没动过的文件，默认一天。
    Returns:
        删掉的文件数。只清本工具命名的文件，且刚生成的要留着给用户排查。
    """
    root = Path(cache_dir)
    removed = 0
    now = time.time()
    try:
        if not root.is_dir():
            return 0
        for item in root.glob('*.db'):
            if not _CACHE_NAME_RE.match(item.name):
                continue
            try:
                if now - item.stat().st_mtime < min_age_sec:
                    continue
                item.unlink()
                removed += 1
            except OSError:
                continue
    except OSError:
        return removed
    if removed and progress is not None:
        progress.debug(f'已清理 {removed} 份早先留下的临时存档（{root}）')
    return removed


def pull_save(
    device: DeviceStack,
    storage: StorageStack,
    *,
    serial: str,
    remote: RemoteFile,
    package: str | None = None,
    progress: ProgressSink,
) -> Path:
    """把设备上的 dat.db 拉到本地缓存目录。

    Args:
        device: 设备那一包。
        storage: 存储那一包，提供 cache_dir 与 clock。
        serial: adb 设备号。
        remote: 要拉的远端文件。
        package: 包名兜底，路径里推得出真实包名时以路径为准。
        progress: 进度上报。
    Returns:
        本地路径。用完调 discard 删掉，拉之前会先清一次早先的残留。
    """
    purge_cache(storage.cache_dir, progress=progress)
    package = package_of(remote.path) or package or DEFAULT_PACKAGE
    dest = Path(storage.cache_dir) / (
        f'{storage.clock():%Y%m%d-%H%M%S}-{package}.db'
    )
    gateway = device.open_device(serial=serial)
    local = gateway.pull(remote.path, dest)
    progress.step('已拉取', f'{local}（{local.stat().st_size:,} B）')
    return local


def hint_leftover(local: Path | None, *, progress: ProgressSink) -> None:
    """导入失败时告诉用户临时档留在哪，否则 _cache 会静默积累。

    Args:
        local: 从设备拉下来的本地路径；None 表示这次根本没拉过。
        progress: 进度上报。
    """
    if local is None or progress is None:
        return
    progress.hint(f'从模拟器拉的存档留在 {local}，排查完可以删掉')


def discard(local: Path, *, progress: ProgressSink) -> None:
    """删掉临时拉下来的 dat.db（导入成功后调）。失败时不删"""
    path = Path(local)
    try:
        path.unlink(missing_ok=True)
    except OSError:
        return
    try:
        if path.parent.is_dir() and not any(path.parent.iterdir()):
            path.parent.rmdir()
    except OSError:
        pass
    if progress is not None:
        progress.debug(f'已清理临时文件 {path.name}')


# ─────────────── 选设备 / 选存档 / 拉取（两个入口共用一套） ───────────────
@dataclass(frozen=True)
class Picked:
    """选定并已拉到本地的一份存档。"""

    local: Path
    remote: RemoteFile
    serial: str

    @property
    def server(self) -> str:
        """区服号（从远端路径 ``…/serverNN/dat.db`` 推）。"""
        return naming.server_of(self.remote.path)


DeviceChooser = Callable[[Sequence[DeviceInfo]], "DeviceInfo | None"]
SaveChooser = Callable[[Sequence[RemoteFile]], "RemoteFile | None"]


def pick_device(device: DeviceStack,
                chooser: DeviceChooser | None = None,
                *,
                serial: str | None = None,
                progress: ProgressSink,
                ) -> DeviceInfo | None:
    """选一台设备；``chooser`` 返回 None 表示用户放弃。

    Args:
        device: 设备那一包。
        chooser: 多台时的选择器（CLI 传 ``SilentPrompter`` 的实现 = 按 serial 挑，
            向导传真正的提问回调）。
        serial: 用户指定的设备号（``--serial`` / ``YYGX_SERIAL`` / keys.local.json 记的）。
            这里只负责"它不在线"时说一句，挑哪台由 ``chooser`` 决定：
            向导本来就把它排到默认位，静默替用户决定会问都不问地换机器。
        progress: 进度上报。
    Returns:
        选中的设备；用户放弃时返回 None。
    """
    devices = list_devices(device)
    matched = next((d for d in devices if serial and d.serial == serial), None)
    if serial and matched is None:
        # 只说事实，不说"已改用谁"：向导随后会问，命令行随后会打「模拟器: xxx」，
        # 这里替任何一方下结论都会说错
        progress.warn(
            f'指定的模拟器 {serial} 不在线（现有：'
            f'{"、".join(d.label for d in devices)}）')
    if len(devices) == 1:
        return devices[0]
    if chooser is not None:
        return chooser(devices)
    return matched or devices[0]


def pick_save(device: DeviceStack, *, serial: str, package: str | None,
              chooser: SaveChooser | None = None,
              progress: ProgressSink) -> RemoteFile | None:
    """列出该设备上的 dat.db 并选一份。

    Args:
        device: 设备那一包。
        serial: 设备号。
        package: 包名；None 时先试官服再自动探测。
        chooser: 选择器（CLI 传 None = 取最新的一份）；它也可以对唯一一份返回 None，
            表示用户放弃——所以只要传了 chooser，就总是让它过一遍。
        progress: 进度上报。
    Returns:
        选中的远端文件；用户放弃时返回 None。
    """
    files = list_saves(device, serial=serial, package=package, progress=progress)
    if chooser is None:
        return files[0]                     # list_saves 已按修改时间倒序
    return chooser(files)


def fetch_save(device: DeviceStack, storage: StorageStack, *,
               package: str | None = None,
               serial: str | None = None,
               device_chooser: DeviceChooser | None = None,
               save_chooser: SaveChooser | None = None,
               progress: ProgressSink) -> Picked | None:
    """从模拟器里选定一份存档并拉到本地缓存。

    这是「选设备 → 选存档 → 拉取 → 推区服号」的唯一实现：
    CLI 传 ``chooser=None``（取第一台 / 最新一份），向导传真正的提问回调。

    Args:
        device: 设备那一包。
        storage: 存储那一包。
        package: 包名；None 时先试官服再自动探测。
        serial: 用户指定的设备号；在线就用它，不在线提示后回落第一台。
        device_chooser: 多台设备时的选择器。
        save_chooser: 多份存档时的选择器。
        progress: 进度上报。
    Returns:
        选定结果；用户放弃时返回 None。
    Raises:
        AppError: 一台设备都没有，或该包名下没有 dat.db。
    """
    picked_device = pick_device(device, device_chooser,
                                serial=serial, progress=progress)
    if picked_device is None:
        return None
    serial = picked_device.serial
    device.use_serial(serial)      # 之后的内存扫描也用这台，别再让 adb 自己挑
    progress.step('模拟器', picked_device.label)

    remote = pick_save(device, serial=serial, package=package,
                       chooser=save_chooser, progress=progress)
    if remote is None:
        return None
    progress.step('选择存档', remote.path)

    local = pull_save(device, storage, serial=serial, remote=remote,
                      package=package, progress=progress)
    return Picked(local=local, remote=remote, serial=serial)


__all__ = [
    'CACHE_KEEP_SEC',
    'DeviceChooser', 'Picked', 'SaveChooser', 'discard', 'fetch_save',
    'hint_leftover', 'list_devices', 'list_saves', 'package_of', 'pick_device',
    'pick_save', 'pull_save', 'purge_cache',
]
