"""应用错误基类：code + message + hints + context 四件套。
code 给 interface 挑中文模板，hints 给用户下一步，context 留给测试断言。
注意：message 只写"发生了什么"，"怎么办"放 hints，命令名由 interface 拼。
"""
from __future__ import annotations

from collections.abc import Mapping, Sequence
from typing import Any


class AppError(Exception):
    """所有「可预期」错误的基类。未预期异常不走这里。"""

    code: str = "APP_ERROR"

    def __init__(
        self,
        message: str | None = None,
        *,
        hints: Sequence[str] = (),
        context: Mapping[str, Any] | None = None,
    ) -> None:
        self.message = message or (self.__class__.__doc__ or self.code).strip()
        self.hints = list(hints)
        self.context = dict(context or {})
        super().__init__(self.message)

    def __str__(self) -> str:  # 让 exception 的 str() 稳定，便于日志
        return self.message


class InfraError(AppError):
    """基础设施层错误（IO / 设备 / 子进程）。"""

    code = "INFRA_ERROR"


class HarError(InfraError):
    """HAR 文件读不出来或结构不对。"""

    code = "HAR_ERROR"

    def __init__(self, message: str | None = None, hint: str | None = None) -> None:
        self.hint = hint
        super().__init__(message, hints=[hint] if hint else ())


class DBError(InfraError):
    """dat.db 打不开 / 没有 save 表 / 写不进去。"""

    code = "DB_ERROR"

    def __init__(self, message: str | None = None, hint: str | None = None) -> None:
        self.hint = hint
        super().__init__(message, hints=[hint] if hint else ())


class ADBError(InfraError):
    """adb 调用失败。"""

    code = "ADB_ERROR"

    def __init__(self, message: str | None = None, hint: str | None = None) -> None:
        self.hint = hint
        super().__init__(message, hints=[hint] if hint else ())


class MultipleDevices(ADBError):
    """多台设备在线却没指定用哪台：不带 ``-s`` 的命令 adb 会直接拒绝。"""

    code = "ADB_MULTIPLE_DEVICES"


class ADBTimeout(ADBError):
    """adb 命令超时（与"命令失败"区分：超时说明设备慢/卡，不是路径不对）。"""

    code = "ADB_TIMEOUT"


class WriteFailed(InfraError):
    """文件写入失败（保留 __cause__ 以便日志堆栈可追溯）。"""

    code = "WRITE_FAILED"


class KeysFileTooNew(InfraError):
    """keys.json 的 schema_version 比本工具支持的更高。

    绝不能改写它：那会把新版工具写进去的内容（以及未来的格式）抹掉。
    """

    code = "KEYS_FILE_TOO_NEW"


class CancelledError(AppError):
    """用户主动取消（退出码 0，不算失败）。"""

    code = "CANCELLED"

    def __init__(self, message: str | None = None) -> None:
        super().__init__(message or '已取消')


__all__ = ['ADBError', 'ADBTimeout', 'AppError', 'CancelledError',
           'DBError', 'HarError', 'InfraError', 'KeysFileTooNew',
           'MultipleDevices', 'WriteFailed']