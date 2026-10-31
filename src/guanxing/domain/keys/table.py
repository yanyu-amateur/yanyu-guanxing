"""内存里的密钥表：内置表播种，外部文件只能往里补，不做 IO。

内置表收录过的版本，任何来源都改不动它；外部值必须验证过才能落盘。
内置表万一写错（实测解不开）可用 --inner-key 临时救急，该值不落盘。
"""

from .builtin_tables import channel_suffixes, version_psw

SOURCE_BUILTIN = 'builtin'
SOURCE_FILE = 'keys.json'


class KeyTable:
    def __init__(self) -> None:
        # 内置表是基线，外部 keys.json 的内容由 add_* 往上补
        self.channel_suffixes: dict[str, list[str]] = channel_suffixes()
        self.version_psw: dict[str, str] = version_psw()
        self.outer_keys_by_acc: dict[str, list[str]] = {}  # 账号相关 -> 外层密钥
        self.outer_keys_by_id: dict[str, list[str]] = {}  # ID 相关 -> 外层密钥
        # 内置收录的版本：文件里的值覆盖不了它们
        self._builtin_versions: frozenset[str] = frozenset(self.version_psw)
        # 被拒绝的覆盖 (版本, 内置值, 被丢弃的值, 是否来自本次运行)，供提示用户
        self.conflicts: list[tuple[str, str, str, bool]] = []

    def add_channel_suffix(self, channel: str, suffix: str) -> None:
        """追加渠道后缀。空值/非字符串一律忽略。"""
        if not isinstance(channel, str) or not channel.strip():
            return
        if not isinstance(suffix, str) or not suffix.strip():
            return
        channel = channel.strip()
        suffix = suffix.strip()
        bucket = self.channel_suffixes.setdefault(channel, [])
        if suffix not in bucket:
            bucket.append(suffix)

    def add_version_psw(self, version: str, psw: str,
                        *, from_runtime: bool = False) -> bool:
        """登记版本→psw。

        Args:
            version: 8 位版本号。
            psw: 内层密钥前缀。
            from_runtime: 这个值是不是本次运行里刚解出存档得到的。
                只影响提示：内置已收录的版本会拒绝任何来源的覆盖，
                但"拒绝的是刚挖到的钥匙"值得单独告诉用户（说明内置值可能错了）。
        Returns:
            True 表示表里的值真的变了。
        """
        if not isinstance(version, str) or not version.strip():
            return False
        if not isinstance(psw, str) or not psw.strip():
            return False
        version = version.strip()
        psw = psw.strip()
        old = self.version_psw.get(version)
        if old == psw:
            return False
        if version in self._builtin_versions:
            # 内置权威：记下冲突，值不动
            self.conflicts.append((version, old or '', psw, from_runtime))
            return False
        self.version_psw[version] = psw
        return True

    def source_of(self, version: str) -> str:
        """表里某个版本的 psw 来自哪里（``builtin`` / ``keys.json`` / 空串）。"""
        version = (version or '').strip()
        if not self.version_psw.get(version):
            return ''
        return SOURCE_BUILTIN if version in self._builtin_versions else SOURCE_FILE

    def add_outer_key_by_acc(self, acc: str, outer_key: str) -> None:
        """按账号记一把外层密钥。空值忽略，同一账号下重复的不再追加。"""
        if not isinstance(acc, str) or not acc.strip():
            return
        if not isinstance(outer_key, str) or not outer_key.strip():
            return
        self._add_unique(self.outer_keys_by_acc, acc.strip(), outer_key.strip())

    def add_outer_key_by_id(self, id: str, outer_key: str) -> None:
        """按 save_id 记一把外层密钥。空值忽略，同一个 id 下重复的不再追加。"""
        if not isinstance(id, str) or not id.strip():
            return
        if not isinstance(outer_key, str) or not outer_key.strip():
            return
        self._add_unique(self.outer_keys_by_id, id.strip(), outer_key.strip())

    @staticmethod
    def _add_unique(bucket: dict[str, list[str]], key: str, value: str) -> None:
        """往 ``key`` 的候选列表里追加 ``value``，已存在就跳过（同一个键内去重）。"""
        values = bucket.setdefault(key, [])
        if value not in values:
            values.append(value)


__all__ = ['SOURCE_BUILTIN', 'SOURCE_FILE', 'KeyTable']
