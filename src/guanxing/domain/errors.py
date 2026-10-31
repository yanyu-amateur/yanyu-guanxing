"""领域错误：让调用方能据此决定下一步，不依赖 interface。"""

from collections.abc import Sequence

from guanxing.shared.errors import AppError
from guanxing.shared.text import redact

from .save.types import SaveFormatType

# 外层密钥只能靠扫内存时的 reason：交互层据此先问一句“要不要扫”，
# 再把 mem_mode 改成 force 重试。写成常量，避免两边字符串对不上。
REASON_NEEDS_MEMORY = 'needs_memory_scan'


class DomainError(AppError):
    """领域层错误基类。"""

    code: str = "DOMAIN_ERROR"


class InvalidFormat(DomainError):
    """存档格式不合法。"""

    code: str = "INVALID_FORMAT"

    def __init__(self, message: str | None = None,
                 *, hints: Sequence[str] = ()) -> None:
        super().__init__(message, hints=hints)

class InnerKeyMissing(DomainError):
    """内层密钥解不开存档。

    分两种情形，给用户的下一步完全不同，所以必须区分：
    - ``table_value`` 为空：表里根本没有这一版的密钥 → 缺密钥，去挖；
    - ``table_value`` 有值：表里有这一版，但拼出的候选都不行 → 值不对（或存档不是这一版），
      这时再去挖/抓包就是白跑，该怀疑密钥本身。
    """

    code: str = "INNER_KEY_MISSING"

    def __init__(
        self, version: str, runtime: str, marker: str = '', tried: int = 0,
        fmt: SaveFormatType = SaveFormatType.OLD, *, extra_hint: str = '',
        table_value: str = '', table_source: str = '',
    ) -> None:
        """构造"内层密钥缺失"。

        Args:
            version: 8 位版本号。
            runtime: 平台。
            marker: 外层标记（初版为空）。
            tried: 已试候选数。
            fmt: 存档格式。
            extra_hint: 额外原因，比如"内存扫描没能进行：没有找到运行中的游戏进程"。
            table_value: 表里这一版的 psw（空串表示表里没有这一版）。
            table_source: 那个值来自哪里（``builtin`` / ``keys.json``）。
        """
        super().__init__(
            self._message(version, tried, table_value, table_source),
            hints=[extra_hint] if extra_hint else (),
            context={
                'version': version,
                'runtime': runtime,
                'marker': marker,
                'tried': tried,
                'format': getattr(fmt, 'value', fmt),
                'table_value': table_value,
                'table_source': table_source,
            },
        )
        self.version = version
        self.runtime = runtime
        self.marker = marker
        self.tried = tried
        self.format = fmt
        self.table_value = table_value
        self.table_source = table_source

    @staticmethod
    def _message(version: str, tried: int, table_value: str,
                 table_source: str) -> str:
        if not table_value:
            return f'版本 {version} 的内层密钥不在表里（试了 {tried} 个候选）'
        where = table_source or '表里'
        return (f'版本 {version} 的内层密钥解不开：表里有 psw '
                f'{redact(table_value, keep_head=2, keep_tail=2)}'
                f'（来自{where}），拼出的 {tried} 个候选都不匹配')

    @property
    def has_table_value(self) -> bool:
        """表里是否有这一版（有值但解不开 ≠ 没有这一版）。"""
        return bool(self.table_value)

class InnerKeyUnavailable(DomainError):
    """内层密钥的内存探测没能进行（游戏没在跑 / 没有可读内存）。

    注意：这不是最终错误——``decode_with_hunt`` 会把它转成 ``InnerKeyMissing``
    并把原因写进 hint，免得用户看到"表里没有"却以为该去抓包。
    """

    code: str = "INNER_KEY_UNAVAILABLE"

    def __init__(self, reason: str) -> None:
        super().__init__(f'内层密钥的内存探测没能进行: {reason}',
                         context={'reason': reason})
        self.reason = reason


class MemoryReadTimeout(DomainError):
    """读进程内存超时。

    必须和"这段读不出来（没 root / 内核保护页）"分开：前者是设备慢，
    重试或调大超时还能跑；后者是权限问题，得去开 root。混成一句话会把用户带错方向。
    """

    code: str = "MEMORY_READ_TIMEOUT"

    def __init__(self, reason: str) -> None:
        super().__init__(f'读取进程内存超时: {reason}', context={'reason': reason})
        self.reason = reason


class OuterKeyMissing(DomainError):
    """调用方没有提供外层密钥。"""

    code: str = "OUTER_KEY_MISSING"
    def __init__(self, message: str|None = None) -> None:
        super().__init__(message)

class OuterKeyRejected(DomainError):
    """外层密钥试过但不适用（能解外层，内层 zlib/JSON 过不了）。"""

    code: str = "OUTER_KEY_REJECTED"
    def __init__(self, marker: str, outer_key: str) -> None:
        # message 会进控制台与日志文件，密钥按全项目规矩脱敏
        self.msg = f'外层密钥 {redact(outer_key)} 不适用于标记 {marker}'
        super().__init__(self.msg)
        self.marker = marker
        self.outer_key = outer_key


class OuterKeyUnavailable(DomainError):
    """外层密钥拿不到（不是错，是真的没法子）。"""

    code: str = "OUTER_KEY_UNAVAILABLE"

    def __init__(self, reason: str, *, tried: int = 0, command: str = '',
                 psw_available: bool = False, retry_with_outer_key: bool = True,
                 tag: str = '') -> None:
        """构造"外层密钥不可用"错误。

        Args:
            reason: 给人看的原因（会拼进 message）。
            tried: 已经试过的来源数量。
            command: 引导用户去用的命令。
            psw_available: 是否已经拿到 psw（拿到就只差 dat.db）。
            retry_with_outer_key: 让用户手填外层密钥是否有意义。
            tag: 机器可读的标记，交互层据它决定要不要先问一句。
        """
        super().__init__(
            f'无法取得外层密钥: {reason}',
            context={
                'reason': reason,
                'tried': tried,
                'command': command,
                'psw_available': psw_available,
                'retry_with_outer_key': retry_with_outer_key,
                'tag': tag,
            },
        )
        self.reason = reason
        self.tried = tried
        self.command = command
        self.psw_available = psw_available
        self.retry_with_outer_key = retry_with_outer_key
        self.tag = tag
