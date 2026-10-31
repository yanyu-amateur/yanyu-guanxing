"""跨层数据契约"""
from __future__ import annotations

from dataclasses import dataclass, field
from pathlib import Path
from typing import Any

from guanxing.shared.settings import MemMode


@dataclass(frozen=True)
class StepRecord:
    """流程中的一步，最终会写进 dat.meta.json 的 steps 数组。"""

    label: str
    value: str
    ok: bool = True


@dataclass(frozen=True)
class CaptureProbe:
    """一份 HAR 的能力探测结果。

    探测阶段就把能算的都算好（realKey、旧版存档本体、psw、版本），
    导入阶段只消费这份结果，同一份 HAR 不再解析第二遍。
    注意：探测阶段不改任何状态（不写 keys.json），落表留给导入用例。
    """

    account: str = ''
    server: str = ''
    version: str = ''
    has_save: bool = False          # 旧版：upload 请求体里直接带着存档
    content: str = ''               # 旧版存档本体（探测时已解出）
    content_source: str = ''        # 它来自哪条 upload
    psw: str = ''                   # download.extra 解出的 psw
    has_download: bool = False      # HAR 里有能用的 download 响应（不论 psw 解没解出）
    real_key: str = ''              # 由 acc + k 头推出来的会话密钥


@dataclass(frozen=True)
class ImportRequest:
    """一次「把某个输入变成存档」的请求。

    ``database`` 只在新型 HAR（body 用会话密钥加密）时才必须；
    旧版 HAR 的存档本体就在 upload 请求体里，可以不给。
    """

    source: Path | None = None
    database: Path | None = None
    runtime: str = 'android'
    mem_mode: MemMode = MemMode.AUTO
    outer_key: str | None = None
    inner_key: str | None = None
    account: str | None = None
    server: str | None = None      # 区服号；从设备路径推出来，手工导入时可为空
    out_dir: Path | None = None
    name: str | None = None
    dry_run: bool = False
    # 调用方若已经探测过这份 HAR，把结果带进来，导入阶段就不再重解 upload 体
    probe: CaptureProbe | None = None


@dataclass
class ImportOutcome:
    """导入结果。可变是刻意的：用例边跑边填 steps/warnings。"""

    ok: bool = False
    source: str = ''
    kind: str = 'har'               # har | local
    runtime: str = 'android'
    account: str = ''
    save_id: str = ''
    server: str = ''
    version: str = ''
    nick: str = ''
    marker: str = ''
    save_format: str = 'new'
    outer_key: str = ''
    inner_key: str = ''
    field_count: int = 0
    steps: list[StepRecord] = field(default_factory=list)
    warnings: list[str] = field(default_factory=list)
    outputs: dict[str, Path] = field(default_factory=dict)
    # 明文存档 JSON —— 只给同进程内的后续步骤用，不进 meta.json
    data: dict[str, Any] | None = None
    # 回写 dat.db 用的 content。注意：目前没有任何代码给它赋值，
    content: str = ''
    # HAR 新协议降级路径里拿到的 psw（已脱敏前的原值，仅内存）
    psw: str = ''

    def add_step(self, label: str, value: str, *, ok: bool = True) -> None:
        self.steps.append(StepRecord(label=label, value=value, ok=ok))

    def warn(self, text: str) -> None:
        if text not in self.warnings:
            self.warnings.append(text)

    def to_meta(self) -> dict[str, Any]:
        """``dat.meta.json`` / ``__latestSaveMeta`` 的唯一来源（密钥已脱敏）。"""
        from guanxing import __version__
        from guanxing.shared.text import redact

        return {
            'schema_version': 1,
            'tool': {'name': 'guanxing', 'version': __version__},
            'source': self.source,
            'kind': self.kind,
            'runtime': self.runtime,
            'account': self.account,
            'save_id': self.save_id,
            'server': self.server,
            'version': self.version,
            'marker': self.marker,
            'save_format': self.save_format,
            'nick': self.nick,
            'field_count': self.field_count,
            'outer_key': redact(self.outer_key),
            'inner_key': redact(self.inner_key),
            'psw': redact(self.psw),
            'warnings': list(self.warnings),
            'steps': [{'label': s.label, 'value': s.value, 'ok': s.ok}
                      for s in self.steps],
        }
