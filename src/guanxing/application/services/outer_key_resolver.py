"""外层密钥解析优先级：显式传入 → 按 save_id 记过的 → 按账号记过的 → 内存爆破。

每拿到一把都先用内层 zlib 验一遍再采信，全不行抛 OuterKeyUnavailable（附已试来源）。
内存爆破是注入进来的 callable：没接设备时传 None，离线解档就不必拉起 adb。
"""
from __future__ import annotations

from collections.abc import Callable

from guanxing.domain.errors import (
    REASON_NEEDS_MEMORY,
    InnerKeyMissing,
    InvalidFormat,
    OuterKeyRejected,
    OuterKeyUnavailable,
)
from guanxing.domain.save.format import detect_format
from guanxing.domain.save.types import SaveFormatType
from guanxing.shared.errors import AppError
from guanxing.shared.progress import ProgressSink
from guanxing.shared.settings import MemMode

from ..ports.keystore import KeyStore
from .save_decoder import SaveDecoder


class OuterKeyResolver:
    """为某个 content 找一个能真正解开的外层密钥。"""

    def __init__(
        self,
        keystore: KeyStore,
        decoder: SaveDecoder,
        progress: ProgressSink,
        memory: Callable[[str], str] | None = None,
    ) -> None:
        self.keystore = keystore
        self.decoder = decoder
        self.progress = progress
        # ``memory(content) -> 可用外层密钥``；没接设备时传 None
        self.memory = memory

    def resolve(
        self,
        content: str,
        *,
        runtime: str = 'android',
        account: str | None = None,
        save_id: str | None = None,
        explicit: str | None = None,
        mem_mode: MemMode = MemMode.AUTO,
    ) -> str:
        """返回已验证可用的外层密钥（能解出内层即算通过），格式认不出来时立刻报错。

        Args:
            content: dat.db 里的 content。
            runtime: 平台，决定内层候选的后缀优先级。
            account: 账号，用于按账号取记过的外层密钥。
            save_id: 存档主键，比账号更稳的缓存键。
            explicit: 用户显式指定的外层密钥。它是用户指令，不受 ``mem_mode`` 影响。
            mem_mode: 是否允许扫内存；``force`` 只跳过表里记的值，不跳过 ``explicit``。
        Returns:
            已验证的外层密钥；初版存档没有外层加密，返回空串。
        Raises:
            InvalidFormat: content 根本不是能识别的存档，先别谈钥匙。
            OuterKeyUnavailable: 本地没有、内存里也没挖到。
        """
        fmt = detect_format(content)
        # 初版存档根本没有外层加密
        if fmt is SaveFormatType.OLD:
            return ''
        if fmt is None:
            raise InvalidFormat(
                'content 不是可识别的存档格式（既不是初版也不是新版）',
                hints=['确认给的是 dat.db 里的 content 列，而不是整库文件路径'],
            )

        mode = MemMode.parse(mem_mode)
        token = (explicit or '').strip()
        # 显式密钥是用户指令，不受 --mem 管：force 只该跳过"表里记的值"，
        # 否则 --outer-key 会和扫内存撞车，游戏没开就直接失败
        if token and self._try(content, token, runtime):
            if self.keystore.remember_outer(account, token, save_id) and self.progress:
                self.progress.step('外层密钥', '已记入 keys.local.json')
            return token

        candidates = list(self.keystore.outer_candidates(account, save_id))
        tried = len(candidates) + (1 if token else 0)

        if not mode.skip_table:
            for key in candidates:
                if self._try(content, key, runtime):
                    is_new = self.keystore.remember_outer(account, key, save_id)
                    if is_new and self.progress:
                        self.progress.step('外层密钥', '已记入 keys.local.json')
                    return key

        if not mode.may_scan:
            raise OuterKeyUnavailable(
                '本地没有可用外层密钥，且已禁用内存扫描（--mem off）',
                tried=tried,
                command='local',
            )

        if self.memory is not None:
            if not mode.skip_table:
                # 扫内存耗时较长，交互层收到这个 reason 会问一句，用户同意后带 force 重试；
                who = f'账号 {account} ' if account else ''
                detail = f'已试 {tried} 个候选' if tried else '本地也没有任何缓存'
                raise OuterKeyUnavailable(
                    f'本地没有{who}的外层密钥（新版存档每账号一把；{detail}）',
                    tag=REASON_NEEDS_MEMORY,
                    tried=tried,
                    command='local',
                )
            key = self.memory(content)
            if not self._try(content, key, runtime):
                # 挖出来的钥匙也要过一遍验证再采信：没验过就落盘，
                # 会把错误值永久压进 keys.local.json，下次 auto 直接命中它
                raise OuterKeyUnavailable(
                    '从进程内存里挖到的外层密钥解不开这份存档',
                    tried=tried + 1,
                    command='mem',
                    retry_with_outer_key=False,
                )
            is_new = self.keystore.remember_outer(account, key, save_id)
            self.progress.step('外层密钥', '已从进程内存爆破得到')
            if is_new:
                self.progress.hint('已记入 keys.local.json，下次直接命中')
            return key

        raise OuterKeyUnavailable(
            '本地没有可用外层密钥；且没有可用的设备内存扫描',
            tried=tried,
            command='local',
        )

    def _try(self, content: str, key: str, runtime: str) -> bool:
        """外层钥匙是否真的解开了这一段 content。

        Args:
            content: dat.db 里的 content。
            key: 待验证的外层密钥。
            runtime: 平台，透传给内层解码。
        Returns:
            True 表示外层通过；内层失败也算通过，那只是密钥表缺版本。
        """
        try:
            self.decoder.decode_content(content, runtime=runtime, outer_key=key)
        except InnerKeyMissing:
            return True
        except (OuterKeyRejected, InvalidFormat):
            return False
        except AppError:
            return False
        return True


__all__ = ['OuterKeyResolver']
