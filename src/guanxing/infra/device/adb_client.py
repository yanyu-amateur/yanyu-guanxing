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
        # 指定的设备号先核一遍再决定要不要带 -s（None = 还没核过）
        self._serial_ok: bool | None = None

    # ────────────────────── 基础执行 ──────────────────────
    def _base(self) -> list[str]:
        serial = self._checked_serial()
        return [self.exe, *(['-s', serial] if serial else [])]

    def _checked_serial(self) -> str | None:
        """核一遍 serial 是否真的在线，不在就退回自动选择，只核一次。

        Returns:
            可以带 -s 的设备号；没指定或已失效时为 None。
            过期设备号会让 adb shell 直接报 device not found，而挖密钥全靠 shell 与 exec-out，
            所以宁可退回自动选择，也不要拿一个失效的号把整轮扫描废掉。
        """
        if not self.serial:
            return None
        if self._serial_ok is None:
            try:
                self._serial_ok = any(d.serial == self.serial for d in self.devices())
            except (ADBError, ADBTimeout):
                # 连 devices 都问不到（超时/服务没起）：别在这里下结论，
                # 让真正的命令去报那个更有用的错
                self._serial_ok = True
            if not self._serial_ok:
                logger.warning(
                    '指定的模拟器 %s 不在 adb devices 里，已改为自动选择', self.serial)
        return self.serial if self._serial_ok else None

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
        """列出在线设备；刚启动 adb 服务端时短轮询等模拟器注册。"""
        deadline = time.monotonic() + DEVICE_SETTLE_SEC
        announced = False
        while True:
            result = self._list_devices()
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

    def sh(self, cmd: str, *, timeout: int | None = None) -> str:
        logger.debug('adb shell: %s', cmd)
        proc = self._run([*self._base(), 'shell', cmd], timeout=timeout)
        if proc.returncode != 0:
            self._raise_for('shell', proc, cmd)
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
            self._raise_for('exec-out', proc)
        return proc.stdout

    # ────────────────────── 进程 / 包 ──────────────────────
    def pid_of(self, package: str) -> str | None:
        """进程号；没在跑返回 None（``pidof`` 非 0 退也是正常情况）。"""
        proc = self._run([*self._base(), 'shell', f'pidof {_quote(package)}'],
                         timeout=30)
        text = proc.stdout.decode('utf-8', 'replace').strip()
        if text:
            return text.split()[0]
        # pidof 找不到进程只退非 0、不写 stderr；写了 stderr 才是真错误（多设备/无设备）
        if proc.returncode != 0 and proc.stderr.strip():
            self._raise_for('shell', proc, f'pidof {package}')
        return None

    def _raise_for(self, kind: str, proc: subprocess.CompletedProcess[bytes],
                   cmd: str = '') -> None:
        """把 adb 的失败翻成用户能据此动手的错误。"""
        err = proc.stderr.decode('utf-8', 'replace').strip()
        if 'more than one device' in err:
            online = '、'.join(d.label for d in self._list_devices())
            raise MultipleDevices(
                f'检测到多个模拟器，没指定用哪一个：{online}',
                hint='用 --serial 指定其中一台，或设环境变量 YYGX_SERIAL',
            )
        raise ADBError(f'adb {kind} 失败（{proc.returncode}）: {err or cmd}')

    # ────────────────────── 存档定位 ──────────────────────
    def detect_save_packages(self) -> list[str]:
        """扫候选根目录，返回带存档结构的包名，渠道无关。"""
        found: set[str] = set()
        for root in REMOTE_SAVE_ROOTS:
            prefix, _, suffix = root.partition('{pkg}')
            # 只有固定前缀加引号，``*`` 必须留在引号外（mksh 不展开引号里的通配符）
            pattern = f'{_quote(prefix)}*{suffix}/{REMOTE_SAVE_GLOB}'
            try:
                text = self.sh(f'ls -d {pattern} 2>/dev/null || true', timeout=120)
            except ADBError:
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
        """
        found: dict[str, RemoteFile] = {}
        for root in REMOTE_SAVE_ROOTS:
            base = root.format(pkg=package)
            #只给固定的根目录加引号，通配符必须留在引号外 ——
            #   Android 的 mksh 不会展开单引号里的 ``*``，整串引起来等于永远匹配不到
            #   （这就是"在 xxx 下没找到 dat.db"的真因）。
            pattern = f'{_quote(base)}/{REMOTE_SAVE_GLOB}'
            for item in self._stat_saves(pattern) or self._ls_saves(pattern):
                found.setdefault(_save_key(item.path), item)
        # 同一份存档可能在多个 root 下重复（``/data/data`` 与 ``/data/user/0``
        # 是同一目录的两个视图；MuMu 还有共享目录软链），按"files 之后的相对路径"去重
        return sorted(found.values(), key=lambda f: f.sort_key(), reverse=True)

    def _stat_saves(self, pattern: str) -> list[RemoteFile]:
        """``stat -c '%s %Y %n'``：一次拿全 大小 + epoch + 路径。"""
        try:
            text = self.sh(f"stat -c '%s %Y %n' {pattern} 2>/dev/null")
        except ADBError:
            return []
        return _parse_stat(text)

    def _ls_saves(self, pattern: str) -> list[RemoteFile]:
        """退化路径（设备没有 stat，或它不支持 -c）。"""
        try:
            text = self.sh(f'ls -l {pattern} 2>/dev/null')
        except ADBError:
            return []
        return _parse_ls(text)

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
