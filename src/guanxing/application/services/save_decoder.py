"""capture 与 local 共用的解码内核：解外层、裁内层、取 psw、拆旧版上传体都在这里。

旧版 upload 体能用 realKey 直接解开（见 content_from_upload）；
新版的 upload3 用 RSA 包裹的一次性会话密钥，解不开就返回 None。
注意：内层解不开时这里不负责爆破，由 usecase 调 decode_with_hunt 兜底。
"""
from __future__ import annotations

import re
from collections.abc import Sequence
from dataclasses import dataclass

from guanxing.domain.crypto.codec import Codec
from guanxing.domain.crypto.xxtea import XXTEACrypto
from guanxing.domain.errors import (
    InnerKeyMissing,
    InvalidFormat,
    OuterKeyMissing,
    OuterKeyUnavailable,
)
from guanxing.domain.protocol.keys import ProtocolKeyDeriver
from guanxing.domain.save.envelope import SaveEnvelope
from guanxing.domain.save.format import detect_format, parse_old
from guanxing.domain.save.types import SaveFormatType
from guanxing.shared.progress import ProgressSink


@dataclass(frozen=True)
class DecodedSave:
    """一次成功解码的结果（不可变）。"""

    data: dict
    version: str
    inner_key: str
    marker: str = ''
    save_format: str = 'old'
    outer_key: str = ''
    psw: str = ''
    tried: int = 1


class SaveDecoder:
    """把 content / download 响应 / dat.db 行统一解成存档 JSON。"""

    def __init__(
        self,
        xxtea: XXTEACrypto,
        envelope: SaveEnvelope,
        deriver: ProtocolKeyDeriver,
        progress: ProgressSink,
    ) -> None:
        self.xxtea = xxtea
        self.envelope = envelope
        self.deriver = deriver
        self.progress = progress

    # ───────────────────────── content ─────────────────────────
    def decode_content(
        self,
        content: str,
        *,
        runtime: str = 'android',
        outer_key: str | None = None,
        inner_key: str | None = None,
        extra_keys: Sequence[str] = (),
    ) -> DecodedSave:
        """从 content 文本解出存档（自动识别初版/新版）。

        Args:
            content: dat.db 里的 content（或旧版 upload 体里解出的 content）。
            runtime: 平台，决定渠道后缀优先级。
            outer_key: 外层密钥，新版必填。
            inner_key: 用户显式指定的内层密钥。
            extra_keys: 额外内层候选（还没落表的 psw 拼出来的钥匙），
                排在显式密钥之后、表候选之前。
        """
        fmt = detect_format(content)
        if fmt is SaveFormatType.NEW:
            if not outer_key:
                raise OuterKeyUnavailable(
                    '这是新版存档，必须提供外层密钥（每账号一把）',
                    command='local',
                )
            marker = content[:8]
            x = self.envelope.unwrap_outer(content, outer_key)
            data, version, key, tried = self._inner(
                x, runtime, inner_key, marker, extra_keys,
                fmt=SaveFormatType.NEW)
            return DecodedSave(
                data=data, version=version, inner_key=key, marker=marker,
                save_format=SaveFormatType.NEW.value, outer_key=outer_key, tried=tried,
            )

        if fmt is SaveFormatType.OLD:
            data, version, key, tried = self._inner(
                content, runtime, inner_key, '', extra_keys,
                fmt=SaveFormatType.OLD)
            return DecodedSave(
                data=data, version=version, inner_key=key,
                save_format=SaveFormatType.OLD.value,
                outer_key=outer_key or '', tried=tried,
            )

        raise InvalidFormat('无法识别的存档格式（既不是初版也不是新版）')

    def _inner(
        self, content: str, runtime: str, explicit_key: str | None, marker: str,
        extra_keys: Sequence[str] = (),
        fmt: SaveFormatType = SaveFormatType.OLD,
    ) -> tuple[dict, str, str, int]:
        """按候选顺序解内层，全试不通就抛 InnerKeyMissing（附表里原本的 psw）。"""
        version, body = parse_old(content)
        candidates = self.envelope.inner_candidates(
            version, runtime, explicit_key, extra=extra_keys)
        data, key = self.envelope.try_inner(body, candidates)
        if data is None or key is None:
            # 带上"表里本来有没有这一版"，让上层能区分"缺密钥"和"密钥不对"
            table_value, table_source = self.envelope.psw_of(version)
            raise InnerKeyMissing(
                version=version, runtime=runtime, marker=marker,
                tried=len(candidates), fmt=fmt,
                table_value=table_value, table_source=table_source,
            )
        raw = key.decode('ascii', 'ignore') if isinstance(key, bytes) else str(key)
        return data, version, raw, len(candidates)

    # ─────────────── 旧版：存档本体就在 upload 里 ───────────────
    def content_from_upload(self, body: str, real_key: str) -> str | None:
        """把旧版上传体解成 content。

        Args:
            body: upload 请求体（base64 的 XXTEA 密文）。
            real_key: 本次会话的 realKey（账号前 5 位 + eakec + 种子前 6 位）。
        Returns:
            初版 content 文本；解不开（新版的会话密钥加密）时返回 None。
        """
        cipher = Codec.b64d(body)
        if not cipher:
            return None
        plain = self.xxtea.decrypt(cipher, real_key)
        if not plain:
            return None
        try:
            text = plain.decode('ascii')
        except UnicodeDecodeError:
            return None
        return text if detect_format(text) is not None else None

    def inner_body(self, content: str, *, outer_key: str | None = None
                   ) -> tuple[str, bytes]:
        """取出内层爆破的靶子。

        Args:
            content: dat.db 里的 content。
            outer_key: 外层密钥，新版需要。
        Returns:
            ``(version, body)``，body 是内层 XXTEA 密文。
        Raises:
            InvalidFormat: content 结构不对。
        """
        fmt = detect_format(content)
        if fmt is SaveFormatType.NEW:
            if not outer_key:
                raise OuterKeyMissing('这是新版存档，先拿到外层密钥才能取内层密文')
            x = self.envelope.unwrap_outer(content, outer_key)
            return parse_old(x)
        if fmt is SaveFormatType.OLD:
            return parse_old(content)
        raise InvalidFormat('无法识别的存档格式（既不是初版也不是新版）')

    # ───────────────────── psw（新协议唯一可离线得到的密钥） ─────────────────────
    def psw_from_download(self, payload: dict[str, str] | None, real_key: str) -> str:
        """从 download 响应的 extra 解出 psw。

        Args:
            payload: ``download_payload()`` 返回的明文 JSON。
            real_key: 本次会话的 realKey。
        Returns:
            psw；解不出时返回空串。
        """
        if not payload:
            return ''
        extra = payload.get('extra') or ''
        if not extra:
            return ''
        raw = Codec.b64d(extra)
        if raw is None:
            return ''
        plain = self.xxtea.decrypt(raw, real_key)
        if not plain:
            return ''
        return self._extract_psw(plain.decode('ascii', 'ignore'))

    @staticmethod
    def _extract_psw(text: str) -> str:
        """``extra`` 明文可能夹带版本号/分隔符，从中取出真正的 8 位 psw。"""
        text = (text or '').strip()
        if not text:
            return ''
        if len(text) == 8:
            return text
        for token in re.split(r'[^0-9A-Za-z_-]+', text):
            if len(token) == 8:
                return token
        tokens = [t for t in re.split(r'[^0-9A-Za-z_-]+', text) if t]
        return tokens[0] if tokens else text


__all__ = ['DecodedSave', 'SaveDecoder']
