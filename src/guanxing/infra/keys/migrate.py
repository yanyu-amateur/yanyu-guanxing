"""keys.json 与 keys.local.json 的版本号与升级，纯函数不碰 IO。

keys.json 无版本号就补、把 1.1 的 inner_keys 拆成 psw 与后缀；keys.local.json 另把
outer_keys 并入 outer_keys_by_acc 并保留 adb/serial/pkg。版本过新时抛 KeysFileTooNew。
"""
from __future__ import annotations

from collections.abc import Mapping
from dataclasses import dataclass, field
from typing import Any

from guanxing.domain.constants import INNER_KEY_LEN, INNER_PSW_LEN
from guanxing.shared.errors import KeysFileTooNew

# 当前工具支持的 keys.json 版本号
CURRENT_SCHEMA = 2
# 当前工具支持的 keys.local.json 版本号
LOCAL_SCHEMA = 2

# 这些字段由本模块/写入方负责，其余顶层字段会在重写时丢弃
_MANAGED = {'schema_version', 'channel_suffix_table', 'version_psw_table',
            'inner_keys', '_说明'}

# keys.local.json 里与账号无关、跟机器走的环境值（1.1 就有，新版继续认）
LOCAL_ENV_FIELDS = ('adb', 'serial', 'pkg')

# 前四项由本模块/写入方负责；LOCAL_ENV_FIELDS 原样带过去
_LOCAL_MANAGED = {'schema_version', 'outer_keys', 'outer_keys_by_acc',
                  'outer_keys_by_id', '_说明', *LOCAL_ENV_FIELDS}


@dataclass(frozen=True)
class Migration:
    """一次升级的结果。"""

    data: dict[str, Any]
    from_version: int
    notes: tuple[str, ...] = ()
    absorbed_legacy: bool = False

    @property
    def changed(self) -> bool:
        """是否需要把升级结果写回磁盘。"""
        return self.from_version != CURRENT_SCHEMA or self.absorbed_legacy


def migrate(
    raw: Mapping[str, Any] | None,
    *,
    known_suffixes: Mapping[str, list[str]] | None = None,
) -> Migration:
    """把任意历史形状的文档升级成当前形状。

    Args:
        raw: 从 keys.json 读到的原始 dict（可能是 ``{}``）。
        known_suffixes: 已经认识的渠道后缀（一般是内置表 + 内存表）。
            1.1 条目里的 runtime 只是"在哪个平台破出来的"，同一个后缀不该因此
            在两张渠道下各登记一份；传进来就能避免这种重复。
    Returns:
        升级结果；``changed`` 为真时调用方应先备份再重写。
    Raises:
        KeysFileTooNew: 文件的 ``schema_version`` 比本工具支持的更高。
    """
    doc = dict(raw or {})
    version = _version_of(doc)
    if version > CURRENT_SCHEMA:
        raise KeysFileTooNew(
            f'keys.json 的 schema_version={version} 比本工具支持的 {CURRENT_SCHEMA} 新',
            hints=['请升级观星工具；旧版本不会改写这个文件'],
        )

    notes: list[str] = []
    psows = _psows_of(doc)
    suffixes = _suffixes_of(doc)
    known = {s for bucket in (known_suffixes or {}).values() for s in bucket}
    absorbed, has_legacy = _absorb_legacy(
        doc.get('inner_keys'), psows, suffixes, notes, known=known)

    unknown = sorted(set(doc) - _MANAGED)
    if unknown:
        notes.append(f'不认识的顶层字段已丢弃：{"、".join(unknown)}（原文件已备份）')

    data = {
        'schema_version': CURRENT_SCHEMA,
        'channel_suffix_table': {k: v for k, v in suffixes.items() if v},
        'version_psw_table': psows,
    }
    return Migration(data=data, from_version=version, notes=tuple(notes),
                     absorbed_legacy=has_legacy and absorbed > 0)


@dataclass(frozen=True)
class LocalMigration:
    """一次 keys.local.json 升级的结果。"""

    data: dict[str, Any]
    from_version: int
    # 本机环境（adb/serial/pkg），配置层拿它当环境变量之后的兜底
    env: dict[str, str] = field(default_factory=dict)
    notes: tuple[str, ...] = ()
    merged_legacy: bool = False

    @property
    def changed(self) -> bool:
        """是否需要把升级结果写回磁盘。"""
        return self.from_version != LOCAL_SCHEMA or self.merged_legacy


def migrate_local(raw: Mapping[str, Any] | None) -> LocalMigration:
    """把任意历史形状的 keys.local.json 升级成当前形状。

    changed 为真时调用方应先备份再重写。
    """
    doc = dict(raw or {})
    version = _version_of(doc)
    if version > LOCAL_SCHEMA:
        raise KeysFileTooNew(
            f'keys.local.json 的 schema_version={version} 比本工具支持的 {LOCAL_SCHEMA} 新',
            hints=['请升级观星工具；旧版本不会改写这个文件'],
        )

    notes: list[str] = []
    by_acc = _buckets_of(doc.get('outer_keys_by_acc'))
    legacy = doc.get('outer_keys')
    merged = isinstance(legacy, dict)
    if merged:
        legacy_acc = _buckets_of(legacy)
        for account, keys in legacy_acc.items():
            bucket = by_acc.setdefault(account, [])
            for key in keys:
                if key not in bucket:
                    bucket.append(key)
        if legacy_acc:
            notes.append(
                f'已把 1.1 的 outer_keys 并入 outer_keys_by_acc（{len(legacy_acc)} 个账号）')
    elif legacy is not None:
        # 形状不对时不能装没事——这个文件里是用户自己的外层密钥
        notes.append('outer_keys 不是预期的 {账号: 密钥} 形状，已忽略（原文件已备份）')
    by_id = _buckets_of(doc.get('outer_keys_by_id'))
    env = _env_of(doc)

    unknown = sorted(set(doc) - _LOCAL_MANAGED)
    if unknown:
        notes.append(f'不认识的顶层字段已丢弃：{"、".join(unknown)}（原文件已备份）')

    data: dict[str, Any] = {
        'schema_version': LOCAL_SCHEMA,
        'outer_keys_by_acc': {k: v for k, v in by_acc.items() if v},
        'outer_keys_by_id': {k: v for k, v in by_id.items() if v},
        **env,
    }
    return LocalMigration(data=data, from_version=version, env=env,
                          notes=tuple(notes), merged_legacy=merged)


def _buckets_of(table: object) -> dict[str, list[str]]:
    """``{id: "key"}`` / ``{id: ["key"]}`` → ``{id: ["key"]}``（脏值丢掉）。

    Returns:
        新的 dict（不改动入参），值为非空 ``str`` 列表，已去重保序。
    """
    out: dict[str, list[str]] = {}
    if not isinstance(table, dict):
        return out
    for name, value in table.items():
        if not isinstance(name, str) or not name.strip():
            continue
        bucket = out.setdefault(name.strip(), [])
        items = [value] if isinstance(value, str) else (
            value if isinstance(value, (list, tuple)) else ())
        for item in items:
            if isinstance(item, str) and item.strip() and item.strip() not in bucket:
                bucket.append(item.strip())
    return out


def _env_of(doc: Mapping[str, Any]) -> dict[str, str]:
    """取出 ``adb`` / ``serial`` / ``pkg``（空值与脏值不要）。"""
    out: dict[str, str] = {}
    for name in LOCAL_ENV_FIELDS:
        value = doc.get(name)
        if isinstance(value, str) and value.strip():
            out[name] = value.strip()
    return out


def _version_of(doc: Mapping[str, Any]) -> int:
    value = doc.get('schema_version')
    if isinstance(value, bool):
        return 0
    if isinstance(value, int):
        return value
    if isinstance(value, str) and value.strip().isdigit():
        return int(value.strip())
    return 0


def _psows_of(doc: Mapping[str, Any]) -> dict[str, str]:
    out: dict[str, str] = {}
    table = doc.get('version_psw_table')
    if not isinstance(table, dict):
        return out
    for version, psw in table.items():
        if isinstance(version, str) and isinstance(psw, str) \
                and version.strip() and psw.strip():
            out[version.strip()] = psw.strip()
    return out


def _suffixes_of(doc: Mapping[str, Any]) -> dict[str, list[str]]:
    out: dict[str, list[str]] = {}
    table = doc.get('channel_suffix_table')
    if not isinstance(table, dict):
        return out
    for channel, values in table.items():
        if not isinstance(channel, str) or not channel.strip():
            continue
        bucket = out.setdefault(channel.strip(), [])
        for value in values if isinstance(values, (list, tuple)) else ():
            if isinstance(value, str) and value.strip() and value.strip() not in bucket:
                bucket.append(value.strip())
    return out


def _absorb_legacy(
    items: object,
    psows: dict[str, str],
    suffixes: dict[str, list[str]],
    notes: list[str],
    *,
    known: set[str] | None = None,
) -> tuple[int, bool]:
    """把 1.1 的 inner_keys 列表并进 psw 与后缀两张表。

    Args:
        items: inner_keys 列表。
        psows: 版本到 psw 的表，就地写入。
        suffixes: 渠道到后缀的表，就地写入。
        notes: 迁移说明，就地追加。
        known: 已经认识的后缀，用来避免同一后缀重复登记。
    Returns:
        (吸收条数, 是否见过这个字段)。同版本 psw 冲突时保留文件里已有的值；
        后缀已在任意渠道登记过就不再重复登记，因为 1.1 的 runtime 只表示在哪破出来的。
    """
    if not isinstance(items, (list, tuple)):
        return 0, False
    absorbed = 0
    for item in items:
        if not isinstance(item, dict):
            continue
        version = str(item.get('version') or '').strip()
        runtime = str(item.get('runtime') or '').strip() or 'android'
        psw, suffix = split_inner_key(str(item.get('key') or ''))
        if not version or not psw:
            continue
        old = psows.get(version)
        if old and old != psw:
            notes.append(f'版本 {version} 的 psw 冲突：保留文件里的 {old}，忽略 1.1 表里的 {psw}')
        else:
            psows[version] = psw
        if suffix and suffix not in (known or set()) and not _has_suffix(suffixes, suffix):
            suffixes.setdefault(runtime, []).append(suffix)
        absorbed += 1
    if absorbed:
        notes.append(f'已从 1.1 的 inner_keys 迁移 {absorbed} 条（psw 与渠道后缀已拆开）')
    return absorbed, True


def split_inner_key(key: str) -> tuple[str, str]:
    """``psw(8) + suffix(8)`` → ``(psw, suffix)``。

    Args:
        key: 16 位内层密钥（也可以只给 8 位 psw）。
    Returns:
        ``(psw, suffix)``；不足 8 位或含不可打印字符时返回 ``('', '')``；
        只有 8 位时 suffix 为空串。
    """
    text = (key or '').strip()
    if len(text) < INNER_PSW_LEN or not _is_token(text[:INNER_PSW_LEN]):
        return '', ''
    if len(text) < INNER_KEY_LEN:
        return text[:INNER_PSW_LEN], ''
    suffix = text[INNER_PSW_LEN:INNER_KEY_LEN]
    if not _is_token(suffix):
        return text[:INNER_PSW_LEN], ''
    return text[:INNER_PSW_LEN], suffix


def _has_suffix(suffixes: Mapping[str, list[str]], suffix: str) -> bool:
    return any(suffix in bucket for bucket in suffixes.values())


def _is_token(text: str) -> bool:
    return bool(text) and text.isprintable() and not any(c.isspace() for c in text)


__all__ = ['CURRENT_SCHEMA', 'LOCAL_ENV_FIELDS', 'LOCAL_SCHEMA',
           'LocalMigration', 'Migration', 'migrate', 'migrate_local',
           'split_inner_key']
