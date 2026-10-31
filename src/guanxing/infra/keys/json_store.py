"""keys.json 与 keys.local.json 的读写实现（KeyStore 端口），只往表里补。

读写同一套形状（str 与 list 都认）；升级前先备份；损坏或版本过新就停止写入；
与内置表冲突的条目清洗回内置值并备份，运行期被内置拒绝的值不写盘。
"""
import json
import logging
import shutil
from collections.abc import Callable
from datetime import datetime
from enum import Enum
from pathlib import Path

from guanxing.application.ports.keystore import KeyStore
from guanxing.domain.keys.table import KeyTable
from guanxing.shared.errors import KeysFileTooNew
from guanxing.shared.utils import check_path, write_json

from .migrate import (
    CURRENT_SCHEMA,
    LOCAL_SCHEMA,
    LocalMigration,
    Migration,
    migrate,
    migrate_local,
    split_inner_key,
)

logger = logging.getLogger(__name__)

class _State(Enum):
    """读文件的结果：没有文件 / 读到合法 dict / 内容坏了。"""
    MISSING = 'missing'
    OK = 'ok'
    BROKEN = 'broken'


def _read_doc(path: Path) -> tuple[dict, _State]:
    """读 JSON 文档并区分没文件与文件坏了。

    Args:
        path: 目标文件。
    Returns:
        (文档, 状态)。不能用 load_json，它把两种情况都变成空 dict，
        而这里必须知道文件坏没坏，否则下一次写入会把用户积累的表抹掉。
    """
    try:
        # utf-8-sig：允许记事本另存为「UTF-8 带 BOM」后再放回来
        text = Path(path).read_text(encoding='utf-8-sig')
    except FileNotFoundError:
        return {}, _State.MISSING
    except OSError as exc:
        logger.warning('读不了 %s：%s', path, exc)
        return {}, _State.BROKEN
    if not text.strip():
        return {}, _State.MISSING      # 0 字节是常见状态（用户还没记过东西）
    try:
        doc = json.loads(text)
    except ValueError:
        return {}, _State.BROKEN
    return (doc, _State.OK) if isinstance(doc, dict) else ({}, _State.BROKEN)


class KeyStoreImpl(KeyStore):
    def __init__(self, keys_path: str|Path, keys_local_path: str|Path, key_table: KeyTable) -> None:
        # 首次运行时 keys.json / keys.local.json 可能不存在，允许自动创建。
        check_path(keys_path, writable=True)
        check_path(keys_local_path, writable=True)
        self.keys_path = Path(keys_path)
        self.keys_local_path = Path(keys_local_path)
        self.key_table: KeyTable = key_table
        # 文件不可信时关掉落盘：内置表照常可用，但不会覆盖用户的文件
        self.persist = True
        self.persist_local = True
        # 加载期发生的事，交给 bootstrap 用 progress 输出（infra 不该自己决定措辞层级）：
        # notes = 已完成的事（迁移/备份）；problems = 需要用户处理的事（文件坏了/版本过新）
        self.notes: list[str] = []
        self.problems: list[str] = []
        # 本次加载期间是否已经落过盘（迁移会写一次，冲突清洗就不必再备份一遍）
        self._wrote = False
        # keys.local.json 里跟机器走的环境值（adb/serial/pkg），原样保留、只透传给配置层
        self.local_env: dict[str, str] = {}

    # ───────────────── 加载 ─────────────────
    def load(self) -> None:
        self._load_keys()
        self._load_keys_local()
        self._settle_conflicts()
        logger.debug("密钥表加载完成")

    def _settle_conflicts(self) -> None:
        """把与内置表冲突的文件条目清洗回内置值，运行期冲突不在这里。"""
        conflicts = [c for c in self.key_table.conflicts if not c[3]]
        if not conflicts:
            return
        detail = '、'.join(f'{v}（丢弃 {bad}）' for v, _good, bad, _rt in conflicts[:3])
        more = f' 等 {len(conflicts)} 条' if len(conflicts) > 3 else ''
        self.problems.append(
            f'{self.keys_path.name} 里有与内置表冲突的 psw：{detail}{more}。'
            '已采用内置表的值（内置表随工具发布；如需覆盖请用 --inner-key 显式指定）'
        )
        if not self.persist or self._wrote:
            return                       # 迁移那一步已经写过带内置值的表了
        backup = self._backup(self.keys_path, f'conflict-{len(conflicts)}')
        if backup is not None:
            self.notes.append(f'冲突条目已按内置表清洗，原文件备份为 {backup.name}')
        self._save_keys()
    
    def report_runtime_conflicts(self) -> list[str]:
        """运行期挖到但被内置表拒绝的钥匙，提示用户内置值可能错了。

        Returns:
            提示文案列表，没有运行时冲突时为空。
            不写盘也不清洗：跨重启纠正内置表等于给投毒开第二条通道。
        """
        runtime = [c for c in self.key_table.conflicts if c[3]]
        if not runtime:
            return []
        detail = '、'.join(f'{v}（内置 {good}，本次解出 {bad}）'
                          for v, good, bad, _rt in runtime[:3])
        more = f' 等 {len(runtime)} 条' if len(runtime) > 3 else ''
        return [
            f'内置表里 {detail}{more} 的值与实际不符（本次运行用的是解出来的钥匙）',
            '内置表随发版更新，请把这个现象反馈给维护者；'
            '临时可用 --inner-key 手填正确密钥',
        ]

    def _load_keys(self) -> None:
        logger.debug("加载密钥表")
        raw, state = _read_doc(self.keys_path)
        if state is _State.BROKEN:
            self.persist = False
            self.problems.append(
                f'{self.keys_path.name} 不是合法 JSON，本次不会写入它'
                '（请先修好或删掉该文件；内置密钥表仍然可用）'
            )
            return
        try:
            # 内置表已经认识的后缀不必按 1.1 的 runtime 再登记一份
            migration = migrate(raw, known_suffixes=self.key_table.channel_suffixes)
        except KeysFileTooNew as exc:
            self.persist = False
            self.problems.append(str(exc.message))
            return

        self._apply(migration.data)
        if state is _State.OK and migration.changed:
            self._upgrade(migration)

    def _apply(self, data: dict) -> None:
        """把迁移后的两张表灌进 KeyTable，脏值由 add_* 自己挡。

        Args:
            data: 迁移后的文档。
        """
        for channel, suffixes in (data.get('channel_suffix_table') or {}).items():
            for suffix in suffixes:
                self.key_table.add_channel_suffix(channel, suffix)
        for version, psw in (data.get('version_psw_table') or {}).items():
            self.key_table.add_version_psw(version, psw)

    def _upgrade(self, migration: Migration) -> None:
        backup = self._backup(self.keys_path, migration.from_version)
        if backup is None:
            self.persist = False
            self.problems.append(
                f'{self.keys_path.name} 需要升级到 v{CURRENT_SCHEMA}，但备份失败，'
                '本次不写入（避免丢数据）'
            )
            return
        self.notes.extend(migration.notes)
        self.notes.append(
            f'{self.keys_path.name} 已升级到 v{CURRENT_SCHEMA}，'
            f'旧文件备份为 {backup.name}'
        )
        self._save_keys()

    @staticmethod
    def _backup(path: Path, tag: str | int) -> Path | None:
        """把原文件另存为 ``<name>.<tag>.bak``；已存在就加时间戳，绝不覆盖。"""
        label = f'v{tag}' if isinstance(tag, int) and tag else (
            str(tag) if tag else 'v0')
        dest = path.with_name(f'{path.name}.{label}.bak')
        if dest.exists():
            stamp = datetime.now().strftime('%Y%m%d-%H%M%S')
            dest = path.with_name(f'{path.name}.{label}-{stamp}.bak')
        try:
            shutil.copy2(path, dest)
        except OSError:
            logger.warning('备份 %s 失败', path, exc_info=True)
            return None
        return dest

    def _load_keys_local(self) -> None:
        logger.debug("加载本地密钥表")
        raw, state = _read_doc(self.keys_local_path)
        if state is _State.BROKEN:
            self.persist_local = False
            self.problems.append(
                f'{self.keys_local_path.name} 不是合法 JSON，本次不会写入它'
                '（外层密钥可能需要在下次运行时重新挖一次）'
            )
            return
        try:
            migration = migrate_local(raw)
        except KeysFileTooNew as exc:
            self.persist_local = False
            self.problems.append(exc.message)
            return

        self._apply_local(migration.data)
        self.local_env = dict(migration.env)
        # 没有文件时不要走升级：那会为了"备份一个不存在的文件"而把落盘关掉
        if state is _State.OK and migration.changed:
            self._upgrade_local(migration)

    def _apply_local(self, data: dict) -> None:
        """把迁移后的两张外层密钥表灌进 KeyTable（脏值已由 migrate_local 挡掉）。"""
        for account, keys in (data.get('outer_keys_by_acc') or {}).items():
            for key in keys:
                self.key_table.add_outer_key_by_acc(account, key)
        for save_id, keys in (data.get('outer_keys_by_id') or {}).items():
            for key in keys:
                self.key_table.add_outer_key_by_id(save_id, key)

    def _upgrade_local(self, migration: LocalMigration) -> None:
        backup = self._backup(self.keys_local_path, migration.from_version)
        if backup is None:
            self.persist_local = False
            self.problems.append(
                f'{self.keys_local_path.name} 需要升级到 v{LOCAL_SCHEMA}，但备份失败，'
                '本次不写入（避免丢数据）'
            )
            return
        self.notes.extend(f'{self.keys_local_path.name}：{note}' for note in migration.notes)
        self.notes.append(
            f'{self.keys_local_path.name} 已升级到 v{LOCAL_SCHEMA}，'
            f'旧文件备份为 {backup.name}'
        )
        self._save_keys_local()

    # ───────────────── 保存 ─────────────────
    def _save_keys(self) -> None:
        if not self.persist:
            return
        _doc = [
            "内层密钥表（可以任人分享、任意提交，与账号无关）",
            "内层密钥 inner_key = psw(8) + suffix(8)",
            "channel_suffix_table:  渠道 -> 内层密钥后缀suffix",
            "version_psw_table:     版本号 -> 内层密钥前缀psw",
            "版本更新时, psw(8) 会变更, suffix(8) 基本不会变更",
            "schema_version: 文件格式版本；工具升级时会自动迁移，并把旧文件另存为 .bak",
        ]
        keys_data = {
            "_说明": _doc,
            "schema_version": CURRENT_SCHEMA,
            "channel_suffix_table": self.key_table.channel_suffixes,
            "version_psw_table": self.key_table.version_psw,
        }
        write_json(self.keys_path, keys_data)
        self._wrote = True

    def _save_keys_local(self) -> None:
        if not self.persist_local:
            return
        _doc = [
            "外层密钥表（本机相关，仅当前机器有效，已在 .gitignore 里）",
            "outer_keys_by_acc:     账号信息 -> 16 位外层密钥",
            "outer_keys_by_id:      save 表里的 id（md5）-> 16 位外层密钥",
            "adb / serial / pkg:    上次用的 adb 环境；留空就自动发现",
            "schema_version: 文件格式版本；工具升级时会自动迁移，并把旧文件另存为 .bak",
        ]
        keys_local_data: dict = {
            "_说明": _doc,
            "schema_version": LOCAL_SCHEMA,
            "outer_keys_by_acc": self.key_table.outer_keys_by_acc,
            "outer_keys_by_id": self.key_table.outer_keys_by_id,
        }
        # 环境值不由本类产生，只负责原样带下去（1.1 写进去的路径不能因为一次落盘就丢）
        keys_local_data.update(self.local_env)
        write_json(self.keys_local_path, keys_local_data)

    # ───────────────── 候选查询 ─────────────────
    def outer_candidates(self, account: str | None, save_id: str | None,
                         explicit: str | None = None) -> list[str]:
        out: list[str] = []
        if explicit and explicit.strip():
            out.append(explicit.strip())
        if save_id:
            out.extend(self.key_table.outer_keys_by_id.get(save_id, []))
        if account:
            out.extend(self.key_table.outer_keys_by_acc.get(account, []))
        seen: set[str] = set()
        uniq: list[str] = []
        for key in out:
            if key and key not in seen:
                seen.add(key)
                uniq.append(key)
        return uniq

    # ───────────────── 学习（写即落盘）─────────────────
    def remember_inner(self, version: str, psw: str) -> bool:
        """把新学到的 psw 永久记下。返回 True 表示确实是新值。"""
        if not version or not psw:
            return False
        old = (self.key_table.version_psw.get(version) or '').strip()
        if old == psw.strip():
            return False
        if not self.key_table.add_version_psw(version, psw, from_runtime=True):
            # 内置表收录过这一版且值不同：拒收（conflicts 里已记下，供上层提示）
            return False
        return self._flush(
            self._save_keys,
            f'keys.json 写入失败，psw 仅保留在内存（版本 {version}）',
            enabled=self.persist,
        )

    def remember_inner_key(self, version: str, inner_key: str,
                           runtime: str = 'android') -> bool:
        """把完整内层密钥拆成 psw 与后缀分别记下，后缀是新的就收进表里。

        Args:
            version: 8 位版本号。
            inner_key: 16 字符完整密钥（psw + 后缀）。
            runtime: 新后缀归属的渠道。
        Returns:
            True 表示表里确实多出了新东西。落盘失败只警告不抛错，内存里的表已更新。
        """
        psw, suffix = split_inner_key(inner_key)
        if not version or not psw:
            return False
        if not suffix:
            # 只有 psw 没有后缀：不能自己编后缀，交给 remember_inner
            return self.remember_inner(version, psw)

        changed = False
        if (self.key_table.version_psw.get(version) or '').strip() != psw:
            # 内置拒收时 add_* 会返回 False 并记进 conflicts，这里靠 changed 反映
            changed = self.key_table.add_version_psw(version, psw, from_runtime=True)
        if not self._has_suffix(suffix):
            channel = runtime or 'android'
            self.key_table.add_channel_suffix(channel, suffix)
            logger.debug('新渠道后缀 %s（归到 %s）', suffix, channel)
            changed = True
        if not changed:
            return False
        return self._flush(
            self._save_keys,
            f'keys.json 写入失败，内层密钥仅保留在内存（版本 {version}）',
            enabled=self.persist,
        )

    def _has_suffix(self, suffix: str) -> bool:
        """后缀是否已在任意渠道下。"""
        return any(suffix in bucket for bucket in self.key_table.channel_suffixes.values())

    def remember_outer(self, account: str | None, key: str,
                       save_id: str | None = None) -> bool:
        """把外层密钥记住。有 save_id 就按 id 记（更稳），否则按账号记。"""
        if not key or not key.strip():
            return False
        key = key.strip()
        changed = False
        if save_id:
            bucket = self.key_table.outer_keys_by_id.setdefault(save_id, [])
            if key not in bucket:
                bucket.append(key)
                changed = True
        if account:
            bucket = self.key_table.outer_keys_by_acc.setdefault(account, [])
            if key not in bucket:
                bucket.append(key)
                changed = True
        if not changed:
            return False
        return self._flush(
            self._save_keys_local,
            'keys.local.json 写入失败，外层密钥仅保留在内存',
            enabled=self.persist_local,
        )

    @staticmethod
    def _flush(writer: Callable[[], None], message: str, *,
               enabled: bool = True) -> bool:
        """落盘，失败只警告，返回是否真的写成功。"""
        if not enabled:
            return False
        try:
            writer()
        except OSError:
            logger.warning(message, exc_info=True)
            return False
        return True
