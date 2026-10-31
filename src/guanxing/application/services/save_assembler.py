"""把明文 JSON 重新打包成 content 并写回 dat.db（初版/新版两种）。

注意：目前没有公开入口，严禁回写，后果自负。
"""
from __future__ import annotations

from typing import Any

from guanxing.domain.constants import DEFAULT_SAVE_MARKER
from guanxing.domain.save import player as player_mod
from guanxing.domain.save.envelope import SaveEnvelope
from guanxing.domain.save.types import SaveFormatType
from guanxing.shared.progress import ProgressSink

from ..ports.savedb import DBProcessor


class SaveAssembler:
    """content 组装 + dat.db 落库。"""

    def __init__(
        self,
        envelope: SaveEnvelope,
        *,
        progress: ProgressSink,
        savedb: DBProcessor | None = None,
    ) -> None:
        self.envelope = envelope
        self.savedb = savedb
        self.progress = progress

    # ── content ──
    def rebuild(
        self,
        data: dict[str, Any],
        version: str,
        inner_key: str,
        *,
        outer_key: str | None = None,
        marker: str | None = None,
        fmt: str = 'new',
        level: int = 6,
    ) -> tuple[str, str]:
        """重建 content。

        Args:
            data: 明文存档。
            version: 8 位版本号。
            inner_key: 内层密钥。
            outer_key: 外层密钥，新版必填。
            marker: 外层标记，缺省用内置表里的默认值。
            fmt: ``old`` 或 ``new``。
            level: zlib 压缩级别。
        Returns:
            ``(content, marker)``；初版返回的 marker 是空串。
        Raises:
            OuterKeyUnavailable: 新版却没有外层密钥。
        """
        kind = (fmt or 'new').strip().lower()
        if kind == SaveFormatType.OLD.value:
            return self.envelope.build_old(data, version, inner_key, level), ''
        if not outer_key:
            from guanxing.domain.errors import OuterKeyUnavailable
            raise OuterKeyUnavailable('重新打包新版存档必须提供外层密钥', command='rebuild')
        mark = (marker or DEFAULT_SAVE_MARKER).strip()
        content = self.envelope.build_new(data, version, inner_key, outer_key, mark, level)
        return content, mark

    # ── dat.db ──
    def write_db(self, save_id: str, content: str,
                 data: dict[str, Any] | None = None,
                 version: str = '') -> None:
        """把重建出来的 content 写回 ``self.savedb``（回写分支专用，无 CLI 入口）。"""
        if self.savedb is None:
            return
        player_text = self.player_text(data, version)
        self.savedb.write_save({'id': save_id, 'content': content, 'player': player_text})
        self.progress.step('写入 dat.db', f'{save_id[:8]}… ({len(content):,} 字符)')

    @staticmethod
    def player_text(data: dict[str, Any] | None, version: str) -> str:
        """生成 save.player 的明文摘要（实现已下移到 domain，这里只做转发）。"""
        return player_mod.build_text(data, version)


__all__ = ['SaveAssembler']
