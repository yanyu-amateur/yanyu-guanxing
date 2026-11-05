"""ADB 网关实现：设备/进程查询、shell、exec-out、拉文件。

子进程一律带 CREATE_NO_WINDOW，输出按 UTF-8 解、失败用 replace。
注意：设备路径必须单引号包裹并转义内部引号；所有失败翻译成 ADBError 并保留 __cause__。
"""
from __future__ import annotations

import logging
import subprocess
import sys
import time
from datetime import datetime
from pathlib import Path

from guanxing.application.ports.device import DeviceGateway, DeviceInfo, RemoteFile
from guanxing.shared.errors import ADBError, ADBTimeout, MultipleDevices
from guanxing.shared.logging import PROG

from .constants import REMOTE_SAVE_GLOB, REMOTE_SAVE_ROOTS
from .discovery import find_adb

logger = logging.getLogger(__name__)

_CREATE_NO_WINDOW = 0x08000000 if sys.platform == 'win32' else 0

# adb 服务端刚起来（第一次调用、或刚 kill-server）时设备还没注册完，要等几秒；
# 实测 MuMu 三个实例约 6 秒，留一点余量
DEVICE_SETTLE_SEC = 8.0
DEVICE_POLL_SEC = 0.25

# adb root 之后 adbd 会重启，要给它一点时间重新上线
ADBD_RESTART_SEC = 5.0

ROOT_HINT = (
    '模拟器没有以 root 运行，读不到 /data/data 下的存档。'
    '请在模拟器设置里打开 root（MuMu：设置 → 其他 → root 权限），'
    '或在终端执行 adb root 后重试'
)


def _quote(path: str) -> str:
    """设备端 shell 单引号转义：``a'b`` → ``'a'\\''b'``。"""
    return "'" + str(path).replace("'", "'\\''") + "'"


def _field(parts: list[str], name: str) -> str:
    """从 ``devices -l`` 的 ``product:e1q model:SM_S9210 …`` 里取值。"""
    prefix = f'{name}:'
    for item in parts:
        if item.startswith(prefix):
            return item[len(prefix):]
    return ''


class DeviceGatewayImpl(DeviceGateway):
    """``DeviceGateway`` 的 adb 实现。"""

    def __init__(
        self,
        *,
        exe: str | None = None,
        serial: str | None = None,
        timeout: int = 20,
    ) -> None:
        found, source = find_adb(explicit=exe)
        if not found:
            raise ADBError(
                '找不到 adb 可执行文件',
                hint='设置环境变量 YYGX_ADB 指向 adb.exe，或用 --adb 指定',
            )
        self.exe = str(found)
        self.exe_src = source
        self.serial = serial
        self.timeout = timeout
        self._serial_ok: bool | None = None
        self._root_ready = False
        self._last_devices: list[DeviceInfo] | None = None

    # ────────────────────── 基础执行 ──────────────────────
    def _base(self) -> list[str]:
        serial = self._checked_serial()
        return [self.exe, *(['-s', serial] if serial else [])]

    def _checked_serial(self) -> str | None:
        """核一遍 serial 是否真的在线，不在就退回自动选择。

        Returns:
            可以带 -s 的设备号；没指定或已确认失效时为 None。
            空列表与探测异常都只意味着"这次没问出来"，不据此判定失效。
        """
        if not self.serial:
            return None
        if self._serial_ok is None:
            try:
                online = [d.serial for d in self.devices()]
            except (ADBError, ADBTimeout) as exc:
                logger.warning(
                    '查不到 adb 设备列表（%s），本轮沿用 %s', exc, self.serial)
                return self.serial
            if online:
                self._serial_ok = self.serial in online
                if not self._serial_ok:
                    logger.warning(
                        '指定的模拟器 %s 不在 adb devices 里，已改为自动选择', self.serial)
        return self.serial if self._serial_ok is not False else None

    def _run(self, args: list[str], timeout: int | None = None
             ) -> subprocess.CompletedProcess[bytes]:
        try:
            return subprocess.run(
                args,
                capture_output=True,
                timeout=timeout or self.timeout,
                creationflags=_CREATE_NO_WINDOW,
            )
        except FileNotFoundError as exc:
            raise ADBError(f'adb 不可执行: {self.exe}',
                           hint='确认 adb 路径正确') from exc
        except subprocess.TimeoutExpired as exc:
            # 超时和"命令失败"不是一回事：内存扫描据此决定"跳过这段"还是"整轮作废"
            raise ADBTimeout(f'adb 命令超时（{timeout or self.timeout}s）',
                             hint='设备卡住或 adb 服务异常，可试 adb kill-server') from exc

    # ────────────────────── 设备 ──────────────────────
    def devices(self) -> list[DeviceInfo]:
        """列出在线设备；刚启动 adb 服务端时短轮询等模拟器注册。

        Returns:
            在线设备列表；等到超时仍为空时返回空列表。
            成功的结果另存一份，供 ``_checked_serial`` / ``_raise_for`` 复用，
            避免一次取档反复探测。
        """
        deadline = time.monotonic() + DEVICE_SETTLE_SEC
        announced = False
        while True:
            try:
                result = self._list_devices()
            except ADBError as exc:
                if time.monotonic() >= deadline:
                    raise
                logger.debug('adb devices 失败，重试：%s', exc)
                result = []
            else:
                self._last_devices = result
                if result or time.monotonic() >= deadline:
                    return result
            if not announced:
                announced = True
                logging.getLogger(PROG).info(
                    'adb 还没看到设备，等待模拟器注册（最多 %d 秒）…', int(DEVICE_SETTLE_SEC))
            time.sleep(DEVICE_POLL_SEC)

    def _list_devices(self) -> list[DeviceInfo]:
        # 带 -l 才能拿到机型：多开时端口是随机的，机型才是用户认得出的那个
        proc = self._run([self.exe, 'devices', '-l'])
        text = proc.stdout.decode('utf-8', 'replace')
        result: list[DeviceInfo] = []
        for line in text.splitlines()[1:]:
            parts = line.split()
            if len(parts) >= 2 and parts[1] == 'device':
                result.append(DeviceInfo(serial=parts[0], state='device',
                                         model=_field(parts[2:], 'model')))
        return result

    def ensure_root(self) -> None:
        """确认 adb shell 是 root，不是就尝试 ``adb root`` 提权。

        Raises:
            ADBError: 提权失败。存档都在 ``/data/data`` 下，非 root 读不到，
                提前报出来比让每个路径都静默返回空要清楚得多。
        """
        if self._root_ready:
            return
        if self._shell_is_root():
            self._root_ready = True
            return

        logger.info('adb shell 不是 root，尝试 adb root 提权 …')
        proc = self._run([*self._base(), 'root'], timeout=30)
        text = (proc.stdout + proc.stderr).decode('utf-8', 'replace').strip()
        if 'cannot run as root' in text or 'not allowed' in text:
            raise ADBError('模拟器不允许 adb root', hint=ROOT_HINT)

        deadline = time.monotonic() + ADBD_RESTART_SEC
        while time.monotonic() < deadline:
            time.sleep(DEVICE_POLL_SEC)
            try:
                if self._shell_is_root():
                    self._root_ready = True
                    self.serial = self._checked_serial() or self.serial
                    return
            except ADBError:
                continue
        raise ADBError('模拟器没有以 root 运行', hint=ROOT_HINT)

    def _shell_is_root(self) -> bool:
        """当前 adb shell 的身份是不是 ``uid=0``。"""
        proc = self._run([*self._base(), 'shell', 'id'], timeout=30)
        if proc.returncode != 0:
            raise self._error_from('shell', proc, 'id')
        return 'uid=0(' in proc.stdout.decode('utf-8', 'replace')

    def sh(self, cmd: str, *, timeout: int | None = None,
           check: bool = True) -> str:
        """执行 shell 命令并返回 stdout。

        Args:
            cmd: 设备端命令。
            timeout: 超时秒数，None 用实例默认值。
            check: 退出码非 0 时是否抛错。``stat`` / ``ls`` 命中多个 glob 时
                只要一条失败整体就退非 0，但 stdout 里常有可用结果，所以它们传 False
                自己判断。
        Returns:
            stdout 文本。
        Raises:
            ADBError: ``check`` 为真且退出码非 0。
        """
        logger.debug('adb shell: %s', cmd)
        proc = self._run([*self._base(), 'shell', cmd], timeout=timeout)
        if check and proc.returncode != 0:
            raise self._error_from('shell', proc, cmd)
        return proc.stdout.decode('utf-8', 'replace')

    def exec_out(self, cmd: str, *, timeout: int | None = None) -> bytes:
        """在设备上跑命令并原样收二进制 stdout（不落 /sdcard）。

        Args:
            cmd: 设备端命令。
            timeout: 超时秒数，None 用实例默认值。
        Returns:
            stdout 原始字节。
        """
        proc = self._run([*self._base(), 'exec-out', cmd], timeout=timeout)
        logger.debug('adb exec-out: %s', cmd)
        if proc.returncode != 0:
            raise self._error_from('exec-out', proc)
        return proc.stdout

    # ────────────────────── 进程 / 包 ──────────────────────
    def pid_of(self, package: str) -> str | None:
        """进程号；没在跑返回 None（``pidof`` 非 0 退也是正常情况）。"""
        proc = self._run([*self._base(), 'shell', f'pidof {_quote(package)}'],
                         timeout=30)
        text = proc.stdout.decode('utf-8', 'replace').strip()
        if text:
            return text.split()[0]
        if proc.returncode != 0 and proc.stderr.strip():
            raise self._error_from('shell', proc, f'pidof {package}')
        return None

    def _error_from(self, kind: str, proc: subprocess.CompletedProcess[bytes],
                    cmd: str = '') -> ADBError:
        """把 adb 的失败翻成用户能据此动手的错误，不做副作用，方便 raise。"""
        err = proc.stderr.decode('utf-8', 'replace').strip()
        if 'more than one device' in err:
            online = self._last_devices
            if online is None:
                try:
                    online = self._list_devices()
                except ADBError:
                    online = []
            suffix = f'：{"、".join(d.label for d in online)}' if online else ''
            return MultipleDevices(
                f'检测到多个模拟器，没指定用哪一个{suffix}',
                hint='用 --serial 指定其中一台，或设环境变量 YYGX_SERIAL',
            )
        if 'device not found' in err or 'device offline' in err:
            return ADBError(
                f'设备已断开（{err}）',
                hint='模拟器可能重启或换端口了，确认 adb devices 里还有它，必要时重连',
            )
        if 'Permission denied' in err:
            return ADBError(f'adb {kind} 没有权限：{err}', hint=ROOT_HINT)
        return ADBError(f'adb {kind} 失败（{proc.returncode}）: {err or cmd}')

    # ────────────────────── 存档定位 ──────────────────────
    def detect_save_packages(self) -> list[str]:
        """扫候选根目录，返回带存档结构的包名，渠道无关。

        Returns:
            去重排序后的包名列表。单个 root 失败不会中断整轮，但要记日志。
        """
        found: set[str] = set()
        for root in REMOTE_SAVE_ROOTS:
            prefix, _, suffix = root.partition('{pkg}')
            # 只有固定前缀加引号，``*`` 必须留在引号外（mksh 不展开引号里的通配符）
            pattern = f'{_quote(prefix)}*{suffix}/{REMOTE_SAVE_GLOB}'
            try:
                text = self.sh(f'ls -d {pattern} 2>/dev/null || true', timeout=120)
            except MultipleDevices:
                raise
            except ADBError as exc:
                logger.warning('探测包名失败（%s）：%s', root, exc)
                continue
            for line in text.splitlines():
                line = line.strip()
                if not line.startswith(prefix):
                    continue
                name = line[len(prefix):].split('/', 1)[0]
                if '.' in name:            # 包名必带点，同时排除 . / .. 之类
                    found.add(name)
        return sorted(found)

    def find_saves(self, package: str) -> list[RemoteFile]:
        """在 REMOTE_SAVE_ROOTS 下枚举 ``*/server*/dat.db``。

        Args:
            package: 游戏包名。
        Returns:
            按修改时间倒序的远端文件列表，已按 ``files/`` 之后的路径去重。
        Raises:
            MultipleDevices: 多台设备在线却没指定用哪一台。
            ADBError: 所有 root 都读不到（多半是没 root）。
        """
        found: dict[str, RemoteFile] = {}
        failure: ADBError | None = None
        for root in REMOTE_SAVE_ROOTS:
            base = root.format(pkg=package)
            pattern = f'{_quote(base)}/{REMOTE_SAVE_GLOB}'
            try:
                items = self._stat_saves(pattern) or self._ls_saves(pattern)
            except MultipleDevices:
                raise
            except ADBError as exc:
                logger.warning('枚举存档失败（%s）：%s', root, exc)
                failure = failure or exc
                continue
            for item in items:
                found.setdefault(_save_key(item.path), item)
        if not found and failure is not None:
            raise failure
        return sorted(found.values(), key=lambda f: f.sort_key(), reverse=True)

    def _stat_saves(self, pattern: str) -> list[RemoteFile]:
        """``stat -c '%s %Y %n'``：一次拿全 大小 + epoch + 路径。

        Args:
            pattern: 已拼好的 glob，调用方负责引号。
        Returns:
            解析出的存档列表。退出码非 0 但 stdout 有内容时照常返回，
            因为 glob 命中多个路径时只要一条失败，``stat`` 整体就退非 0。
        Raises:
            ADBError: 一条都解析不出来且原因不是"没匹配到"。
        """
        text = self.sh(f"stat -c '%s %Y %n' {pattern} 2>&1",
                       timeout=self.timeout, check=False)
        files = _parse_stat(text)
        if files:
            return files
        self._reject_unreadable(text, 'stat')
        return []

    def _ls_saves(self, pattern: str) -> list[RemoteFile]:
        """退化路径（设备没有 stat，或它不支持 -c）。

        Args:
            pattern: 已拼好的 glob，调用方负责引号。
        Returns:
            解析出的存档列表；一条都没有且原因不是"没匹配到"时抛错。
        """
        text = self.sh(f'ls -l {pattern} 2>&1', timeout=self.timeout, check=False)
        files = _parse_ls(text)
        if files:
            return files
        self._reject_unreadable(text, 'ls')
        return []

    @staticmethod
    def _reject_unreadable(text: str, kind: str) -> None:
        """把"没权限"这类真失败和"glob 没匹配到"区分开。

        Args:
            text: 命令的合并输出。
            kind: 命令名，只用于拼错误消息。
        Raises:
            ADBError: 输出里出现权限不足。
        """
        if 'Permission denied' in text:
            raise ADBError(f'{kind} 读不到存档目录', hint=ROOT_HINT)

    def pull(self, remote: str, local: Path) -> Path:
        local = Path(local)
        local.parent.mkdir(parents=True, exist_ok=True)
        proc = self._run([*self._base(), 'pull', remote, str(local)], timeout=120)
        if proc.returncode != 0:
            err = proc.stderr.decode('utf-8', 'replace').strip()
            raise ADBError(f'拉取失败: {remote}', hint=err or None)
        if not local.exists():
            raise ADBError(f'拉取后本地文件不存在: {local}')
        return local


def _save_key(path: str) -> str:
    """去重键：取 files/ 之后的相对路径。

    Args:
        path: 设备上的存档路径。
    Returns:
        去重用的键。同一份存档会以 /data/data、/data/user/0、MuMuShared 三个视图出现。
    """
    marker = '/files/'
    idx = path.rfind(marker)
    return path[idx + len(marker):] if idx >= 0 else path


def _parse_stat(text: str) -> list[RemoteFile]:
    """解析 ``stat -c '%s %Y %n'``：``大小 epoch 路径``。"""
    out: list[RemoteFile] = []
    for line in text.splitlines():
        parts = line.split(None, 2)
        if len(parts) < 3 or not parts[2].endswith('dat.db'):
            continue
        try:
            size = int(parts[0])
            epoch = float(parts[1])
        except ValueError:
            continue
        out.append(RemoteFile(
            path=parts[2].strip(),
            size=size,
            mtime=_fmt_time(epoch),
            mtime_epoch=epoch,
        ))
    return out


def _fmt_time(epoch: float) -> str:
    if epoch <= 0:
        return ''
    try:
        return datetime.fromtimestamp(epoch).strftime('%Y-%m-%d %H:%M')
    except (OverflowError, OSError, ValueError):
        return ''


def _parse_ls(text: str) -> list[RemoteFile]:
    """解析 ``ls -l`` 输出：``perms links owner group size date time path``。"""
    out: list[RemoteFile] = []
    for line in text.splitlines():
        parts = line.split()
        if len(parts) < 8 or not parts[0].startswith(('-', 'l')):
            continue
        path = parts[-1]
        if not path.endswith('dat.db'):
            continue
        try:
            size = int(parts[-4])
        except ValueError:
            size = 0
        out.append(RemoteFile(path=path, size=size, mtime=f'{parts[-3]} {parts[-2]}'))
    return out


__all__ = ['DeviceGatewayImpl']
