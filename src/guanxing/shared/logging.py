"""标准 logging 的一次性配置：stderr + 可选文件。

控制台一行形如 ``1970-01-01 00:00:00 - guanxing - INFO     提示：xxx``，日期、logger 名、级别都带上；
文件里的格式几乎一样，只是级别不补宽度（落盘不需要对齐）。
"""
import logging
from pathlib import Path

from .utils import check_path

# 程序名（日志 logger 名 + argparse prog + 提示里的命令前缀），只此一处
PROG = 'guanxing'

# 控制台：完整日期 + logger 名 + 固定宽度级别（级别补到 7 位便于对齐）
CONSOLE_FMT = "%(asctime)s - %(name)s - %(levelname)-7s %(message)s"
CONSOLE_DATEFMT = "%Y-%m-%d %H:%M:%S"
# 文件：同样的字段，级别不补宽度
FILE_FMT = "%(asctime)s %(name)s %(levelname)s %(message)s"
FILE_DATEFMT = "%Y-%m-%d %H:%M:%S"


def setup_logging(path: str | Path | None = None, level: str = "info") -> None:
    """配置一次性日志（重复调用会覆盖上一次的 handler）。

    Args:
        path: 日志文件路径；None 表示只输出到控制台。
        level: 级别名，认不出时退回 INFO。
    Raises:
        OSError: 日志文件所在目录建不出来或不可写。要日志却写不了必须让调用方知道，
            吞掉的话用户以为日志在写，实际一行都没有。
    """
    lev = getattr(logging, level.upper(), logging.INFO)
    handlers: list[logging.Handler] = []

    console = logging.StreamHandler()
    console.setLevel(lev)
    console.setFormatter(logging.Formatter(CONSOLE_FMT, datefmt=CONSOLE_DATEFMT))
    handlers.append(console)

    if path is not None:
        log_path = check_path(path, writable=True)
        to_file = logging.FileHandler(log_path, encoding="utf-8")
        to_file.setLevel(lev)
        to_file.setFormatter(logging.Formatter(FILE_FMT, datefmt=FILE_DATEFMT))
        handlers.append(to_file)

    logging.basicConfig(level=lev, handlers=handlers, force=True)


__all__ = ["CONSOLE_DATEFMT", "CONSOLE_FMT", "FILE_DATEFMT", "FILE_FMT", "PROG",
           "setup_logging"]
