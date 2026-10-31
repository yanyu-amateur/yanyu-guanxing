"""存档信封：外层标记、外层密钥、内层密钥的解包与打包。

解内层时按候选顺序逐个试，试到 zlib+JSON 通得过为止。
只做一层的动作，格式识别与分派在 save_decoder，别在这里再写一套 detect_format。
"""

import json
from collections.abc import Sequence

from ..constants import DEFAULT_SAVE_MARKER, INNER_PSW_LEN
from ..crypto.codec import Codec
from ..crypto.xxtea import XXTEACrypto
from ..errors import OuterKeyRejected
from ..keys.resolver import candidates_from_psw, inner_candidates, suffix_order
from ..keys.table import KeyTable
from .format import parse_new


class SaveEnvelope:
    """存档信封：加密/解密存档的高层接口。"""

    def __init__(self, xxtea: XXTEACrypto, key_table: KeyTable) -> None:
        self.xxtea = xxtea
        self._table = key_table

    # ─────────────────── 表的窄接口 ───────────────────
    @property
    def key_table(self) -> KeyTable:
        """密钥表本体。仅供本域的其它组件（如 SaveDecoder 的候选构造）使用。"""
        return self._table

    def psw_of(self, version: str) -> tuple[str, str]:
        """某个版本的 psw 及其来源。

        Args:
            version: 8 位版本号。
        Returns:
            ``(psw, 来源)``；表里没有这一版时 psw 为空串。
            来源是 ``builtin`` / ``keys.json``。
        """
        return (self._table.version_psw.get(version) or '').strip(), \
            self._table.source_of(version)

    def all_psows(self) -> frozenset[str]:
        """表里所有长度合法的 psw（内存扫描拿它当锚点）。"""
        return frozenset(
            p for p in self._table.version_psw.values()
            if len(p) == INNER_PSW_LEN
        )

    def suffixes(self, runtime: str) -> list[str]:
        """渠道后缀尝试顺序（当前平台优先）。"""
        return suffix_order(self._table, runtime)

    def candidates_from(self, psw: str, runtime: str) -> list[str]:
        """用一把 psw 拼出内层候选（还没落表的值也能试）。"""
        return candidates_from_psw(self._table, runtime, psw)

    def unwrap_outer(self, content: str, outer_key: str | bytes) -> str:
        """新版: 用外层密钥解出 X（= 初版 content）。返回 base64 文本 str。"""
        marker, cipher = parse_new(content)
        plain = self.xxtea.decrypt(cipher, outer_key)
        if plain is None:
            shown = (outer_key.decode('latin-1', 'ignore')
                     if isinstance(outer_key, bytes) else outer_key)
            raise OuterKeyRejected(marker, shown)
        return plain.decode('ascii')

    # ─────────────────────── 内层（核心） ───────────────────────
    def try_inner(self, body: bytes, candidates: Sequence[str | bytes]
                  ) -> tuple[dict, str | bytes] | tuple[None, None]:
        """逐个试内层密钥。返回 (data, key)。用 zlib+json 双重校验，比单靠长度字更稳。"""
        seen: set[str | bytes] = set()
        for k in candidates:
            if not k or k in seen:
                continue
            seen.add(k)
            comp = self.xxtea.decrypt(body, k)
            if not comp:
                continue
            raw = Codec.zlib_d(comp)
            if raw is None:
                continue
            try:
                return json.loads(raw.decode('utf-8')), k
            except Exception:
                continue
        return None, None

    def inner_candidates(self, version: str, runtime: str = 'android',
                         explicit: str | None = None,
                         extra: Sequence[str] = ()) -> list[str]:
        """候选内层密钥的优先级顺序，复用 keys.resolver 以免与密钥库的候选分叉。

        Args:
            version: 8 位版本号。
            runtime: 当前平台，决定渠道后缀优先级。
            explicit: 用户显式指定的完整内层密钥。
            extra: 额外候选，比如还没落表的 psw 拼出来的钥匙。
        Returns:
            去重后的候选，顺序是显式、额外、表里 psw 加各渠道后缀、裸 psw。
        """
        return inner_candidates(
            self._table, runtime, version, explicit=explicit, extra=extra,
        )

    # ─────────────────────────── 构造 ───────────────────────────
    def build_old(self, data: dict, version: str, inner_key: str | bytes,
                  level: int = 6) -> str:
        """构造初版 content。"""
        comp = Codec.zlib_c(json.dumps(data, ensure_ascii=False,
                                        separators=(',', ':')).encode('utf-8'), level)
        body = self.xxtea.encrypt_raw(comp, inner_key)
        env = version.encode('ascii') + body
        return Codec.b64e(env)

    def build_new(self, data: dict, version: str, inner_key: str | bytes,
                  outer_key: str | bytes, marker: str = DEFAULT_SAVE_MARKER,
                  level: int = 6) -> str:
        """构造新版 content。"""
        x = self.build_old(data, version, inner_key, level)
        cipher = self.xxtea.encrypt_raw(x.encode('ascii'), outer_key)
        return marker + Codec.b64e(cipher)


__all__ = ['SaveEnvelope']
