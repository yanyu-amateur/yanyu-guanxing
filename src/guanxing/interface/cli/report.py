"""导入结果与错误的统一输出（CLI 与向导共用一套）。

单点维护的理由：两处各写一份的话，"-vv 才显示完整密钥"这类开关迟早只在一个入口生效。
"""
from __future__ import annotations

import logging

from guanxing.application.dto import ImportOutcome
from guanxing.application.ports.keystore import KeyStore
from guanxing.shared.errors import AppError
from guanxing.shared.logging import PROG
from guanxing.shared.progress import ProgressSink
from guanxing.shared.text import redact

from .messages import render


def print_outcome(out: ImportOutcome, progress: ProgressSink, *, show_keys: bool) -> None:
    """打印一次导入的结论行，走 step 所以 --quiet 下不输出。"""
    progress.step('结果', '成功' if out.ok else '未完成')
    progress.step('平台/区服', f'{out.runtime} / {out.server or "?"}')
    progress.step('角色', f'{out.nick or "?"}（版本 {out.version or "?"}）')
    progress.step('字段数', f'{out.field_count}')
    progress.step('内层密钥', out.inner_key if show_keys else redact(out.inner_key))
    if out.outputs:
        progress.step('输出', str(next(iter(out.outputs.values())).parent))
    for warning in out.warnings:
        progress.warn(warning)


def report_keystore_notes(keystore: KeyStore, progress: ProgressSink) -> None:
    """报出"内置表的值与实际不符"这类运行期发现（不落盘，只提示）。"""
    for line in keystore.report_runtime_conflicts():
        progress.hint(line)


def report_error(err: AppError, progress: ProgressSink) -> None:
    """把可预期错误翻成"一句话 + 若干提示"。"""
    message, hints = render(err)
    logging.getLogger(PROG).error(message)
    for hint in hints:
        progress.hint(hint)


__all__ = ['print_outcome', 'report_error', 'report_keystore_notes']
