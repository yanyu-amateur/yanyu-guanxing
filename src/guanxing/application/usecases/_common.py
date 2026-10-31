"""用例共用的小工具"""
from __future__ import annotations

import hashlib
from collections.abc import Sequence
from pathlib import Path
from typing import Any

from guanxing.domain.errors import InnerKeyMissing, InnerKeyUnavailable
from guanxing.domain.save import player as player_mod
from guanxing.shared.errors import AppError
from guanxing.shared.progress import ProgressSink
from guanxing.shared.settings import MemMode
from guanxing.shared.text import redact

from ..dto import CaptureProbe, ImportOutcome, ImportRequest
from ..packs import CryptoStack, StorageStack
from ..ports.capture import HarReader
from ..services.save_decoder import DecodedSave

# 存档体量在百 KB 以上，小于这个的 upload 请求不可能装下它；
# 设这个阈值是为了不去白解 uploadPower / uploadLocation 这类小请求（每条 0.3~0.8s）。
MIN_UPLOAD_CHARS = 64_000


def decode_with_hunt(
    crypto: CryptoStack,
    content: str,
    *,
    runtime: str = 'android',
    outer_key: str,
    inner_key: str | None = None,
    psw: str = '',
    mem_mode: MemMode = MemMode.AUTO,
) -> DecodedSave:
    """解内层，解不开就先拿抓包 psw 试，再退到扫内存；密钥一律先在内存里试通才落表。

    Args:
        crypto: 密钥与解密那一包。
        content: dat.db 里的 content。
        runtime: 平台，决定渠道后缀优先级。
        outer_key: 外层密钥。
        inner_key: 用户显式指定的内层密钥。
        psw: 本次抓包学到的 psw，只有前 8 位，后缀还得查表或扫内存。
        mem_mode: auto/force/off；off 时绝不去扫内存，直接把解不开报上去。
    Returns:
        解码结果，含明文、版本与内外层密钥。
    Raises:
        InnerKeyMissing: 表和内存都没找到可用内层密钥。
    """

    def _decode(explicit: str | None = None,
                extra: Sequence[str] = ()) -> DecodedSave:
        return crypto.decoder.decode_content(
            content, runtime=runtime, outer_key=outer_key,
            inner_key=explicit or inner_key, extra_keys=extra,
        )

    try:
        return _decode()
    except InnerKeyMissing as exc:
        # 1) 抓包学到的 psw：只拼候选在内存里试，解开了才认这个 psw
        if psw:
            extra = crypto.decoder.envelope.candidates_from(psw, runtime)
            try:
                decoded = _decode(extra=extra)
            except InnerKeyMissing:
                pass
            else:
                # 版本号取自刚解开的存档，而不是抓包头的 ver
                crypto.keystore.remember_inner(decoded.version, psw)
                return decoded

        # 2) 表里也没有 → 去进程内存里挖整把钥匙（--mem off 时不挖）
        hunt = crypto.hunt_inner_key
        if hunt is None or not mem_mode.may_scan:
            raise

        _version, body = crypto.decoder.inner_body(content, outer_key=outer_key)
        try:
            found = hunt(exc.version, body, runtime=runtime)
        except InnerKeyUnavailable as hunt_exc:
            # 扫描压根没跑起来（游戏没开 / 没 root）：把原因带上去，
            raise InnerKeyMissing(
                version=exc.version, runtime=runtime, marker=exc.marker,
                tried=exc.tried, fmt=exc.format,
                extra_hint=f'内存扫描没能进行：{hunt_exc.reason}',
                table_value=exc.table_value, table_source=exc.table_source,
            ) from hunt_exc
        if not found:
            raise
        decoded = _decode(found)
        crypto.keystore.remember_inner_key(decoded.version, found, runtime)
        return decoded


def find_embedded_content(
    har: HarReader,
    crypto: CryptoStack,
    real_key: str,
    progress: ProgressSink,
) -> tuple[str | None, str]:
    """在 HAR 的 upload 请求体里找存档（只有旧版 HAR 会有）。

    Args:
        har: 抓包读取端口。
        crypto: 密钥与解密那一包。
        real_key: 本次会话的 realKey。
        progress: 进度上报。
    Returns:
        ``(content, 来源说明)``；没找到时返回 ``(None, '')``。
    """
    for entry in har.upload_bodies(min_chars=MIN_UPLOAD_CHARS):
        command = har.command_of(entry) or '（无命令）'
        content = crypto.decoder.content_from_upload(har.body_text(entry), real_key)
        if content is not None:
            progress.debug(f'{command} 的请求体解出了存档（{len(content):,} 字符）')
            return content, f'upload（{command}）'
        progress.debug(f'{command} 的请求体解不开，跳过')
    return None, ''


def read_capture(
    source: Path,
    crypto: CryptoStack,
    storage: StorageStack,
    progress: ProgressSink,
) -> CaptureProbe:
    """打开一份 HAR，把能离线算的都算出来（realKey、旧版存档本体、psw、版本）。

    Args:
        source: HAR 文件路径。
        crypto: 密钥与解密那一包。
        storage: 存储那一包。
        progress: 进度上报。
    Returns:
        探测结果；``real_key`` 为空表示 HAR 里拿不到 k 头，后面的事都做不了。
        探测用例与导入用例共用这一份，同一份 HAR 只解析一次。
    """
    har = storage.open_capture(source)
    account = (har.account() or '').strip()
    k_header = har.k_header() or ''
    real_key = ''
    if account and k_header:
        real_key = crypto.deriver.derive(account, k_header)['real_key']

    content = ''
    where = ''
    if real_key:
        found, where = find_embedded_content(har, crypto, real_key, progress)
        content = found or ''
        if content:
            progress.step('HAR 自带存档', where)

    psw = ''
    payload = har.download_payload()
    if payload and real_key:
        psw = crypto.decoder.psw_from_download(payload, real_key)

    return CaptureProbe(
        account=account,
        server=har.server() or '',
        version=normalize_version(har.client_version()),
        has_save=bool(content),
        content=content,
        content_source=where,
        psw=psw,
        has_download=payload is not None,
        real_key=real_key,
    )


def save_id_of(account: str) -> str:
    """save 表主键 = md5(账号)。"""
    return hashlib.md5((account or '').encode('utf-8')).hexdigest()


def normalize_version(raw: str | int | None) -> str:
    """``73570`` → ``00073570``；非法值返回空串。"""
    text = '' if raw is None else str(raw).strip()
    if not text.isdigit():
        return ''
    return text.zfill(8)


def fill_from_decoded(out: ImportOutcome, decoded: DecodedSave) -> None:
    """把解码结果搬进 outcome。"""
    out.version = decoded.version
    out.inner_key = decoded.inner_key
    out.marker = decoded.marker
    out.save_format = decoded.save_format
    out.outer_key = decoded.outer_key
    out.psw = decoded.psw
    out.data = decoded.data
    out.field_count = len(decoded.data) if isinstance(decoded.data, dict) else 0
    out.add_step('版本号', decoded.version)
    out.add_step('内层密钥', redact(decoded.inner_key))
    if decoded.outer_key:
        out.add_step('外层密钥', redact(decoded.outer_key))


def pick_nick(data: dict[str, Any] | None) -> str:
    """从存档明文里取角色名。"""
    if not isinstance(data, dict):
        return ''
    main_role = data.get('MainRole')
    if not isinstance(main_role, dict):
        return ''
    name = main_role.get('Name')
    return name.strip() if isinstance(name, str) and name.strip() else ''


def emit(
    out: ImportOutcome,
    req: ImportRequest,
    storage: StorageStack,
    progress: ProgressSink,
) -> None:
    """写快照目录 + 四个文件；``dry_run`` 时只填 outcome。"""
    if out.data is not None:
        out.nick = out.nick or pick_nick(out.data)

    if req.dry_run:
        out.add_step('dry-run', '不写文件')
        out.ok = True
        return

    # 输出目录只由 Settings 提供（接口层在构造 req 时填好）
    if req.out_dir is None:
        raise AppError(
            '内部错误：ImportRequest.out_dir 未设置',
            hints=['输出目录应由接口层用 settings.out_dir 填好再调用用例'],
        )
    out_dir = req.out_dir
    snapshot = storage.layout.make_snapshot_dir(
        out_dir,
        runtime=out.runtime,
        server=out.server,
        nick=out.nick,
        override=req.name,
        moment=storage.clock(),
    )

    # 改档回写：out.content 目前没有任何代码赋值，所以这段不会执行。
    if req.database is not None and out.content:
        savedb = storage.open_savedb(req.database)
        savedb.write_save({
            'id': out.save_id or save_id_of(out.account),
            'content': out.content,
            'player': player_mod.build_text(out.data, out.version),
        })
        out.add_step('写入 dat.db', f'{Path(req.database).name} ({len(out.content):,} 字符)')

    written = storage.layout.write_all(
        snapshot,
        data=out.data,
        meta=out.to_meta(),
        report_text=_build_report(out),
    )
    out.outputs = written
    out.ok = True


def _build_report(out: ImportOutcome) -> str:
    """把 outcome 渲染成导入报告正文（markdown）。"""
    lines = [
        '# 观星工具 · 导入报告',
        '',
        f'- 来源：{out.source}',
        f'- 类型：{out.kind}',
        f'- 平台：{out.runtime}',
        f'- 账号：{out.account}',
        f'- 区服：{out.server}',
        f'- 角色：{out.nick}',
        f'- 版本：{out.version}',
        f'- 字段数：{out.field_count}',
        '',
        '## 步骤',
        '',
    ]
    lines += [f'{i}. {s.label}：{s.value}' for i, s in enumerate(out.steps, 1)]
    if out.warnings:
        lines += ['', '## 警告', '']
        lines += [f'- {w}' for w in out.warnings]
    return '\n'.join(lines) + '\n'


__all__ = [
    'decode_with_hunt', 'emit', 'fill_from_decoded', 'normalize_version',
    'pick_nick', 'read_capture', 'save_id_of',
]
