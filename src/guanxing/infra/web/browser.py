"""打开浏览器的平台差异（Windows 用 ShellExecuteW，其余用 webbrowser）。

Windows 上 ``os.startfile`` 与 ``webbrowser.open`` 都会吞掉 ShellExecute 的返回码，
连"文件不存在"都报成功，所以这里直接调 ShellExecuteW，失败才能说明原因。

另外，被 VS Code 之类"运行而不调试"拉起的进程常处在一个关闭即杀全部子进程的
Job 对象里（``JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE``）。这时 ShellExecute 会返回成功，
但它起的浏览器进程在我们退出时立刻被杀掉，表现为"日志说成功、窗口没出现"。
这种情况下改用 explorer.exe 代开 —— 它跑在 shell 自己的进程里，不受这个 Job 约束。
"""
from __future__ import annotations

import logging
import subprocess
import sys
import time
import webbrowser
from ctypes import wintypes
from pathlib import Path
from urllib.parse import unquote, urlparse
from urllib.request import url2pathname

logger = logging.getLogger('guanxing.web')

SW_SHOWNORMAL = 1
_CREATE_NO_WINDOW = 0x08000000 if sys.platform == 'win32' else 0
JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE = 0x2000

SHELL_ERRORS: dict[int, str] = {
    0: '系统资源不足',
    2: '文件不存在',
    3: '路径不存在',
    5: '权限被拒绝（提权进程打不开普通权限的浏览器）',
    26: '拒绝访问',
    27: '文件关联不完整',
    28: 'DDE 超时（浏览器正忙）',
    29: 'DDE 失败（浏览器没响应）',
    30: 'DDE 忙碌（浏览器正处理上一个请求）',
    31: '没有关联的程序能打开这个文件',
    32: '找不到可用的程序',
}

DDE_CODES = frozenset({28, 29, 30})


def _job_extend_info() -> type:
    """延迟构造 ``JOBOBJECT_EXTENDED_LIMIT_INFORMATION``，非 Windows 不必付 ctypes 的代价。"""
    import ctypes

    class _Basic(ctypes.Structure):
        _fields_ = [
            ('PerProcessUserTimeLimit', ctypes.c_int64),
            ('PerJobUserTimeLimit', ctypes.c_int64),
            ('LimitFlags', wintypes.DWORD),
            ('MinimumWorkingSetSize', ctypes.c_size_t),
            ('MaximumWorkingSetSize', ctypes.c_size_t),
            ('ActiveProcessLimit', wintypes.DWORD),
            ('Affinity', ctypes.c_size_t),
            ('PriorityClass', wintypes.DWORD),
            ('SchedulingClass', wintypes.DWORD),
        ]

    class _IoCounters(ctypes.Structure):
        _fields_ = [(name, ctypes.c_uint64) for name in
                    ('ReadOperationCount', 'WriteOperationCount', 'OtherOperationCount',
                     'ReadTransferCount', 'WriteTransferCount', 'OtherTransferCount')]

    class _Extended(ctypes.Structure):
        _fields_ = [
            ('BasicLimitInformation', _Basic),
            ('IoInfo', _IoCounters),
            ('ProcessMemoryLimit', ctypes.c_size_t),
            ('JobMemoryLimit', ctypes.c_size_t),
            ('PeakProcessMemoryUsed', ctypes.c_size_t),
            ('PeakJobMemoryUsed', ctypes.c_size_t),
        ]

    return _Extended


def in_kill_on_close_job() -> bool:
    """当前进程是否处在"最后一个句柄关闭就杀光所有进程"的 Job 里。

    Returns:
        True 表示退出时 Job 可能随之关闭并连带杀掉我们启动的子进程。
        VS Code / PyCharm 的"运行而不调试"、部分 CI runner 都会这样包一层。
    """
    if sys.platform != 'win32':
        return False
    import ctypes

    try:
        k32 = ctypes.WinDLL('kernel32', use_last_error=True)
        k32.GetCurrentProcess.restype = wintypes.HANDLE
        k32.IsProcessInJob.argtypes = [wintypes.HANDLE, wintypes.HANDLE,
                                       ctypes.POINTER(wintypes.BOOL)]
        k32.QueryInformationJobObject.argtypes = [wintypes.HANDLE, ctypes.c_int,
                                                  ctypes.c_void_p, wintypes.DWORD,
                                                  ctypes.POINTER(wintypes.DWORD)]

        inside = wintypes.BOOL()
        k32.IsProcessInJob(k32.GetCurrentProcess(), None, ctypes.byref(inside))
        if not inside.value:
            return False

        extended = _job_extend_info()()
        ret = k32.QueryInformationJobObject(None, 9, ctypes.byref(extended),
                                            ctypes.sizeof(extended), None)
        if not ret:
            return False
        flags = extended.BasicLimitInformation.LimitFlags
        return bool(flags & JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE)
    except (AttributeError, OSError):
        return False


def _open_via_explorer(path: str) -> bool:
    """让 explorer.exe 代开本地文件。

    Args:
        path: 本地文件路径。
    Returns:
        True 表示 explorer 被成功调起。explorer 恒以退出码 1 结束，
        所以这里只能确认"命令跑起来了"，真正的打开结果它报不出来。
    """
    try:
        subprocess.run(['explorer.exe', str(path)], timeout=10,
                       creationflags=_CREATE_NO_WINDOW, check=False)
    except (OSError, subprocess.TimeoutExpired) as exc:
        logger.debug('explorer.exe 代开失败：%s', exc)
        return False
    return True


def _shell_execute(url: str) -> int:
    """调用 ShellExecuteW 打开 URL。

    Args:
        url: 要打开的目标，通常是 ``file://`` URI。
    Returns:
        ShellExecute 的原始返回码，大于 32 表示成功；调用本身不可用时返回 0。
    """
    if sys.platform != 'win32':
        return 33
    import ctypes

    try:
        shell32 = ctypes.WinDLL('shell32', use_last_error=True)
    except OSError:
        return 0
    func = shell32.ShellExecuteW
    func.argtypes = [wintypes.HWND, wintypes.LPCWSTR, wintypes.LPCWSTR,
                     wintypes.LPCWSTR, wintypes.LPCWSTR, ctypes.c_int]
    func.restype = ctypes.c_void_p
    try:
        raw = func(None, None, url, None, None, SW_SHOWNORMAL)
    except OSError:
        return 0
    return int(raw) if raw else 0


def _describe(code: int) -> str:
    """把 ShellExecute 返回码翻成一句中文。"""
    return SHELL_ERRORS.get(code, f'ShellExecute 返回 {code}')


def open_url(url: str, *, new: int = 2, retries: int = 2,
             retry_delay: float = 0.3) -> bool:
    """在默认浏览器打开 URL，返回是否成功。

    Args:
        url: 要打开的目标。
        new: 非 Windows 平台透传给 ``webbrowser.open``。
        retries: DDE 类失败（浏览器正忙）时的重试次数。
        retry_delay: 每次重试前等待的秒数。
    Returns:
        True 表示系统真的接受了这个请求。Windows 上按 ShellExecute 的返回码判定，
        失败会记 warning 说明原因。
    """
    if sys.platform != 'win32':
        try:
            return bool(webbrowser.open(url, new=new))
        except Exception:  # noqa: BLE001 - 浏览器不可用不该让主流程失败
            logger.warning('打开浏览器失败，请手动访问: %s', url, exc_info=True)
            return False

    if in_kill_on_close_job():
        logger.debug('当前进程在 KILL_ON_JOB_CLOSE 的 Job 里，'
                     'ShellExecute 起的浏览器会被连带杀掉，改用 explorer.exe 代开')
        if _open_via_explorer(_local_path(url)):
            return True

    code = _shell_execute(url)
    attempt = 0
    while code <= 32 and code in DDE_CODES and attempt < retries:
        attempt += 1
        logger.debug('ShellExecute 返回 %s，%.1f 秒后重试（%d/%d）',
                     _describe(code), retry_delay, attempt, retries)
        time.sleep(retry_delay)
        code = _shell_execute(url)

    if code > 32:
        return True
    logger.warning('没能自动打开浏览器（%s），请手动打开: %s',
                   _describe(code), manual_hint(url))
    return False


def _local_path(url: str) -> str:
    """把 ``file://`` URI 还原成本地路径，非 file 协议原样返回。"""
    return manual_hint(url) if url.startswith('file:') else url


def is_elevated() -> bool:
    """当前进程是否以管理员权限运行。

    Returns:
        True 表示提权。提权进程通过 DDE 投递 URL 给普通权限的浏览器常被拒绝。
    """
    if sys.platform != 'win32':
        return False
    import ctypes

    try:
        return bool(ctypes.windll.shell32.IsUserAnAdmin())
    except (AttributeError, OSError):
        return False


def manual_hint(url: str) -> str:
    """把 ``file://`` URI 还原成可直接双击的本地路径。

    Args:
        url: ``file://`` URI 或本地路径。
    Returns:
        Windows 风格的本地路径；解析不出时原样返回。
    """
    if not url.startswith('file:'):
        return str(Path(url))
    try:
        path = url2pathname(unquote(urlparse(url).path))
    except ValueError:
        return url
    return str(Path(path))


__all__ = ['DDE_CODES', 'SHELL_ERRORS', 'in_kill_on_close_job', 'is_elevated',
           'manual_hint', 'open_url']
