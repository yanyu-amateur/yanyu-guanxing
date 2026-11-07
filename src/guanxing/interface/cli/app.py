"""命令行入口：解析参数 → 调用例 → 翻译结果与退出码。

退出码 0 成功/取消，1 未预期错误，2 用户可修复错误，130 中断。
运行环境参数在主命令和子命令上都认，写在哪一侧都可以。
"""
from __future__ import annotations

import argparse
import logging
import sys
from dataclasses import replace
from pathlib import Path

from guanxing.application.usecases.device_saves import purge_cache
from guanxing.bootstrap import build_progress, build_settings, build_stacks
from guanxing.domain.save.naming import DB_SUFFIX
from guanxing.shared.errors import AppError, CancelledError
from guanxing.shared.logging import PROG, setup_logging
from guanxing.shared.progress import ProgressSink
from guanxing.shared.settings import MemMode, Settings

from .exit_codes import (
    EXIT_INTERRUPT,
    EXIT_OK,
    EXIT_UNEXPECTED,
    EXIT_USER,
)
from .flow import FlowRequest, FlowRunner, SilentPrompter, run_capture, run_local
from .options import add_import_options, add_run_options
from .report import report_error


# ───────────────────────── 主流程 ─────────────────────────
def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(
        prog=PROG,
        description='观星工具 —— 存档解析与密钥管理',
        formatter_class=argparse.RawDescriptionHelpFormatter,
    )
    add_run_options(parser)

    sub = parser.add_subparsers(dest='command', metavar='<命令>')

    def sub_parser(name: str, help_text: str, *, with_db: bool = True
                   ) -> argparse.ArgumentParser:
        p = sub.add_parser(name, help=help_text)
        add_run_options(p, inherited=True)
        add_import_options(p, with_db=with_db)
        return p

    p_cap = sub_parser('capture', 'HAR → 存档（旧版自带存档，新版还要 dat.db）')
    p_cap.add_argument('har', metavar='HAR', help='抓包导出的 .har 文件')

    p_loc = sub_parser('local', 'dat.db → 存档（不给路径就从模拟器取）', with_db=False)
    p_loc.add_argument('db_file', metavar='DAT_DB', nargs='?',
                       help='本地 dat.db；省略则从模拟器取')

    p_auto = sub_parser('auto', '按扩展名自动选择（.db → local，其它 → capture）')
    p_auto.add_argument('path', metavar='PATH', help='dat.db 或 .har 文件')

    return parser


def parse_argv(argv: list[str]) -> argparse.Namespace:
    """解析参数，并把主命令与子命令两侧的 ``-v`` 合并成一个级数。"""
    args = build_parser().parse_args(argv)
    args.verbose += getattr(args, 'verbose_sub', 0)
    return args


# ───────────────────────── 主流程 ─────────────────────────
def main(argv: list[str] | None = None, *,
         default_workspace: Path | None = None) -> int:
    """命令行入口，default_workspace 一般是启动脚本所在目录。"""
    argv = sys.argv[1:] if argv is None else list(argv)

    try:
        args = parse_argv(argv)
        if not args.command and not sys.stdin.isatty():
            # 无参 + 非 TTY（管道/CI）只打印帮助；有 TTY 时进交互向导
            build_parser().print_help()
            return EXIT_OK
        return _dispatch(args, default_workspace=default_workspace)
    except KeyboardInterrupt:
        build_progress().warn('已中断')
        return EXIT_INTERRUPT
    except CancelledError:
        # 用户自己按 q / Ctrl+C 退出，不算失败，也别用 ERROR 吓人
        build_progress().info('已取消')
        return EXIT_OK
    except AppError as err:
        _report_error(err, build_progress())
        return EXIT_USER
    except Exception:  # noqa: BLE001 - 顶层兜底，必须留下堆栈
        logging.getLogger(PROG).exception('未预期的错误')
        return EXIT_UNEXPECTED


def _settings_for(args: argparse.Namespace,
                  default_workspace: Path | None = None) -> Settings:
    """命令行参数加环境变量得到本次运行的 Settings。"""
    out = getattr(args, 'out', None)
    settings = build_settings(
        out_dir=Path(out).expanduser() if out else None,
        package=getattr(args, 'package', None),
        adb_path=getattr(args, 'adb', None),
        serial=getattr(args, 'serial', None),
        default_workspace=default_workspace,
    )
    settings = replace(settings,
                       verbose=getattr(args, 'verbose', 0),
                       quiet=getattr(args, 'quiet', False))
    runtime = getattr(args, 'runtime', None)
    if runtime:
        settings = replace(settings, runtime=runtime)
    mem = getattr(args, 'mem', None)
    if mem:
        settings = replace(settings, mem_mode=MemMode.parse(mem))
    return settings


def _dispatch(args: argparse.Namespace, *,
              default_workspace: Path | None = None) -> int:
    """定日志与配置、完成装配，再把导入交给共用流程。"""
    log_file = getattr(args, 'log', None)
    level = 'warning' if getattr(args, 'quiet', False) else (
        'debug' if getattr(args, 'verbose', 0) else 'info')
    try:
        setup_logging(path=log_file, level=level)
    except OSError as exc:
        # 此刻 root logger 还没配好，hints 会被丢掉，提示直接写进消息里
        raise AppError(f'日志文件写不了: {log_file}'
                       '（确认目录存在且可写，或换个 --log 路径）') from exc

    settings = _settings_for(args, default_workspace=default_workspace)
    progress = build_progress(settings)
    _warn_if_workspace_moved(settings, default_workspace, progress)
    crypto, storage, device = build_stacks(settings, progress)

    # 清理临时区
    purge_cache(settings.cache_dir, progress=progress)

    if args.command is None:
        from .interactive.wizard import run_wizard
        return run_wizard(settings, crypto, storage, device, progress)

    run, req = _to_flow_request(args)
    run(req, settings, crypto, storage, device, progress,
        SilentPrompter(progress, serial=settings.serial))
    return EXIT_OK


def _to_flow_request(args: argparse.Namespace) -> tuple[FlowRunner, FlowRequest]:
    """把 argparse 的结果翻成「走哪条入口 + 入口参数」。

    ``auto`` 是命令行独有的便利：这里就按扩展名定死成 local 或 capture，
    下游不必再猜一遍。
    """
    db = getattr(args, 'db', None)
    path = getattr(args, 'har', None) or getattr(args, 'db_file', None) \
        or getattr(args, 'path', None)
    source = Path(path) if path else None
    kind = args.command
    if kind != 'local' and source is not None and source.suffix.lower() != DB_SUFFIX:
        kind = 'capture'
    elif kind != 'capture':
        kind = 'local'
    if kind == 'local' and db:
        # auto 拿到 .db 时它就是存档本身，再给 --db 只会让两份路径打架
        raise AppError(
            f'auto 拿到的 {source.name if source else "dat.db"} 就是存档本身，'
            '不要再加 --db',
            hints=['想解另一份就写成: python run.py local <那份 dat.db>'],
        )
    # local 不给路径就等于"从模拟器读档"，不必再要求 --from-device
    allow = getattr(args, 'from_device', False) or kind == 'local'
    req = FlowRequest(
        source=source,
        database=Path(db) if db else None,
        server=getattr(args, 'server', None),
        allow_device=allow,
        prefer_device=getattr(args, 'from_device', False),
        outer_key=getattr(args, 'outer_key', None),
        inner_key=getattr(args, 'inner_key', None),
        account=getattr(args, 'account', None),
        name=getattr(args, 'name', None),
        dry_run=getattr(args, 'dry_run', False),
    )
    return (run_local if kind == 'local' else run_capture), req


def _warn_if_workspace_moved(settings: Settings, default_workspace: Path | None,
                             progress: ProgressSink) -> None:
    """工作区没落在启动脚本目录时提醒一句。"""
    if default_workspace is None or settings.workspace == default_workspace:
        return
    if Path(settings.web_dir).is_dir() or not (default_workspace / 'web').is_dir():
        return
    progress.hint(
        f'当前工作区是 {settings.workspace}，不是工具目录 {default_workspace}：'
        '密钥表和 output/ 都会落在前者，网页也找不到。'
        '想改回去就清掉环境变量 GUANXING_WORKSPACE')


def _report_error(err: AppError, progress: ProgressSink) -> None:
    report_error(err, progress)


if __name__ == '__main__':
    raise SystemExit(main())
