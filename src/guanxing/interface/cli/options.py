"""命令行参数声明：运行环境（全局）与本次导入（子命令）分开。

主命令与每个子命令都要声明同一批运行环境参数。子命令侧用 ``SUPPRESS`` 默认值，
argparse 共享同一个 namespace，省略时不会覆盖主命令解析到的值，写在子命令后面则覆盖。
"""
from __future__ import annotations

import argparse

RUN_OPTIONS: tuple[tuple[tuple[str, ...], dict], ...] = (
    (('-v', '--verbose'),
     {'action': 'count', 'dest': 'verbose', 'default': 0,
      'help': '-v 详细，-vv 显示完整密钥'}),
    (('-q', '--quiet'),
     {'action': 'store_true', 'default': False,
      'help': '只输出警告（成功时无输出，结果看退出码）'}),
    (('--log',),
     {'metavar': 'FILE', 'default': None, 'help': '同时写入日志文件（UTF-8）'}),
    (('--adb',),
     {'metavar': 'EXE', 'default': None,
      'help': 'adb 可执行文件路径（默认自动查找或读 YYGX_ADB）'}),
    (('--serial',),
     {'metavar': 'SERIAL', 'default': None, 'help': 'adb 设备号（多开时指定）'}),
    (('--package',),
     {'metavar': 'PKG', 'default': None,
      'help': '游戏包名（渠道服不同；不填则先用官服，找不到存档再自动探测）'}),
    (('-o', '--out'),
     {'metavar': 'DIR', 'default': None,
      'help': '输出根目录（默认工作区下的 output/）'}),
    (('--runtime',),
     {'default': None, 'choices': ['android', 'ios'],
      'help': '平台，决定渠道后缀的尝试顺序（默认 android）'}),
    (('--mem',),
     {'default': None, 'choices': ['auto', 'force', 'off'],
      'help': '密钥获取策略：auto=先查表、查不到再扫进程内存；'
              'force=直接扫内存；off=绝不扫（离线/不需要模拟器时用）'}),
)

IMPORT_OPTIONS: tuple[tuple[tuple[str, ...], dict], ...] = (
    (('--db',),
     {'metavar': 'DAT_DB', 'default': None,
      'help': '本地 dat.db 路径（capture 用：新版 HAR 只给 psw，存档要它）'}),
    (('--from-device',),
     {'action': 'store_true', 'default': False,
      'help': '从模拟器里取 dat.db（local 不给路径时本来就会取；'
              'capture 遇到新版 HAR 用这条）'}),
    (('--outer-key',),
     {'metavar': 'KEY', 'default': None, 'help': '外层密钥（16 位，每账号一把）'}),
    (('--inner-key',),
     {'metavar': 'KEY', 'default': None,
      'help': '内层密钥（psw+渠道后缀），一般不用手填'}),
    (('--account',),
     {'metavar': 'ACC', 'default': None,
      'help': '账号（capture 默认读 HAR 的 acc 头；local 默认用存档里的 EncryptID）'}),
    (('--server',),
     {'metavar': 'N', 'default': None,
      'help': '区服号（默认从 dat.db 路径里的 serverNN 推出）'}),
    (('--name',),
     {'default': None, 'help': '覆盖分组目录名'}),
    (('--dry-run',),
     {'action': 'store_true', 'default': False, 'help': '只解析不写文件'}),
)


def _add(parser: argparse.ArgumentParser,
         options: tuple[tuple[tuple[str, ...], dict], ...],
         *, inherited: bool) -> None:
    """把一组参数加到 parser 上；``inherited`` 时用 SUPPRESS 保留主命令的值。"""
    for flags, kwargs in options:
        params = dict(kwargs)
        if inherited:
            params['default'] = argparse.SUPPRESS
            if params.get('action') == 'count':
                params['dest'] = f"{params['dest']}_sub"
        parser.add_argument(*flags, **params)


def add_run_options(parser: argparse.ArgumentParser, *, inherited: bool = False) -> None:
    """运行环境参数：主命令和所有子命令都要认，写在哪一侧都可以。"""
    _add(parser, RUN_OPTIONS, inherited=inherited)


def add_import_options(parser: argparse.ArgumentParser, *, with_db: bool = True) -> None:
    """本次导入的参数；``--db`` 只在 capture/auto 上有意义。"""
    options = IMPORT_OPTIONS if with_db else tuple(
        (flags, kwargs) for flags, kwargs in IMPORT_OPTIONS if flags != ('--db',))
    _add(parser, options, inherited=False)


__all__ = ['IMPORT_OPTIONS', 'RUN_OPTIONS', 'add_import_options', 'add_run_options']
