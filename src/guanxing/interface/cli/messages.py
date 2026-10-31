"""把 AppError 翻成一句中文提示加若干下一步建议。

分派靠 isinstance 与一张从具体到抽象的注册表，不用字符串 code，命名冲突时也不会失灵。
新增错误就写一个 _xxx(err) -> list[str] 再加进 _RULES，更具体的类必须排在前面。
"""
from __future__ import annotations

from collections.abc import Callable

from guanxing.domain.errors import (
    REASON_NEEDS_MEMORY,
    InnerKeyMissing,
    InnerKeyUnavailable,
    InvalidFormat,
    MemoryReadTimeout,
    OuterKeyRejected,
    OuterKeyUnavailable,
)
from guanxing.shared.errors import (
    ADBError,
    AppError,
    DBError,
    HarError,
    MultipleDevices,
    WriteFailed,
)

Rule = Callable[[AppError], list[str]]

# 提示里引用的命令前缀。用户拿到的是源码包，按 README 直接 python run.py 就能跑；
# guanxing 与 python -m guanxing 都要先 pip install 才存在。
HINT_CMD = 'python run.py'


# ───────────────────────── 各错误的补充提示 ─────────────────────────
def _outer_key(err: AppError) -> list[str]:
    """外层密钥拿不到（这是"从 0 开始"必经的一步）。"""
    assert isinstance(err, OuterKeyUnavailable)
    if 'mem off' in err.reason:
        # 用户刚说了"不要扫内存"，就不能再建议他去跑会扫内存的流程
        return [
            '想让它从模拟器内存里挖，就去掉 --mem off 再跑一次',
            f'手上有 16 位外层密钥就直接给: {HINT_CMD} local <dat.db> --outer-key <16 位>',
            '外层密钥每账号一把、内容固定，拿到一次就记进 keys.local.json，以后不用再挖',
        ]
    if err.psw_available:
        return [
            'psw 已经拿到，只差存档本体：用 --db 指定 dat.db',
            f'例: {HINT_CMD} capture <har> --db <dat.db>',
        ]
    if err.command == 'download':
        return [
            '这份 HAR 里没有能解出 psw 的 download 响应',
            f'请改用 local 模式：跑 {HINT_CMD}（无参数进向导），读模拟器上的 dat.db',
        ]
    if err.command == 'mem' or err.tag == REASON_NEEDS_MEMORY:
        # 要么正要扫内存（tag），要么已经扫过还是没挖到（command='mem'）
        return [
            '请回到游戏：重新登录 → 进入角色界面 → 点一次保存，再重试'
            '（密钥只在角色界面驻留，切走就没了）',
            '确认模拟器已开 root（MuMu 默认开；雷电/夜神要在设置里打开）',
            f'手上有 16 位外层密钥就直接给: {HINT_CMD} local <dat.db> --outer-key <16 位>',
        ]
    return [
        '外层密钥每账号一把、内容固定，拿到一次就记进 keys.local.json，以后不用再挖',
        f'有密钥就手填: {HINT_CMD} local <dat.db> --outer-key <16 位外层密钥>',
        f'没有就跑 {HINT_CMD}（无参数进向导）：会读 dat.db，查不到就扫模拟器内存挖出来',
    ]


def _inner_key(err: AppError) -> list[str]:
    """内层密钥拿不到时的提示，缺密钥与密钥不对要给不同的下一步。"""
    assert isinstance(err, InnerKeyMissing)
    version = err.version
    if err.has_table_value:
        where = {'builtin': '内置表', 'keys.json': '你的 keys.json'}.get(
            err.table_source, '密钥表')
        return [
            f'表里有版本 {version} 的 psw（来自{where}），但用它拼出的候选都解不开',
            '说明不是"缺密钥"，而是这把密钥与这份存档不匹配：'
            '可能存档其实不是这一版，或表里这一版的值是错的',
            f'确认版本号后可以手填正确密钥试试：{HINT_CMD} local <dat.db> --inner-key <16 位>',
            '如果是内置表的值有问题，请把现象反馈给工具维护者（内置表随发版更新）',
        ]
    return [
        f'版本 {version} 的 psw 和渠道后缀都没对上：表里没有，内存里也没挖到',
        '先在模拟器上重新登录 → 进角色 → 存一次档，再重试（psw 只在角色界面驻留）',
        f'还不行就用抓包补这一步：{HINT_CMD} capture <har>'
        '（HAR 里的 download 响应能直接给出 psw，会写进 keys.json）',
        '注意：新版 HAR 只提供 psw，外层密钥它给不了——外层还是得靠内存挖或手填',
    ]


def _inner_unavailable(err: AppError) -> list[str]:
    assert isinstance(err, InnerKeyUnavailable)
    hints = ['内存扫描没能进行：' + err.reason]
    if '可读内存' in err.reason or 'root' in err.reason:
        hints.append('模拟器需要开启 root 才能读进程内存（MuMu 默认开；雷电/夜神在设置里开）')
    return hints


def _outer_rejected(_err: AppError) -> list[str]:
    return ['这把外层密钥解不开该存档：可能账号不匹配，或存档属于另一个渠道']


def _invalid_format(_err: AppError) -> list[str]:
    return [
        '确认输入文件类型与命令匹配（capture 要 .har，local 要 .db）',
        '如果游戏刚更新过，可能是存档换了新格式，请把 dat.db 反馈给维护者',
    ]


def _memory_timeout(_err: AppError) -> list[str]:
    return [
        '把模拟器的 CPU/内存调大一些，或关掉其它占资源的程序后重试',
        '也可以先重启模拟器（adb kill-server 后再连）',
    ]


def _har(_err: AppError) -> list[str]:
    return ['HAR 需要包含 acc 请求头与带 k 的响应头，建议从打开游戏之前开始抓']


def _db(_err: AppError) -> list[str]:
    return ['确认给的是游戏写的 dat.db（不是导出的 JSON），且游戏没有正在写它']


def _multiple_devices(_err: AppError) -> list[str]:
    return ['用 --serial 指定其中一台，完整列表看 adb devices']


def _adb(_err: AppError) -> list[str]:
    return ['确认模拟器已启动；必要时用 --adb 指定 adb.exe，或设环境变量 YYGX_ADB']


def _write_failed(_err: AppError) -> list[str]:
    return [
        '确认目标目录存在且可写：输出目录可用 -o 换，网页目录用环境变量 GUANXING_WEB',
    ]


# 顺序有意义：先具体后抽象，匹配到第一条就停
_RULES: list[tuple[type[AppError], Rule]] = [
    (MemoryReadTimeout, _memory_timeout),
    (InnerKeyUnavailable, _inner_unavailable),
    (InnerKeyMissing, _inner_key),
    (OuterKeyRejected, _outer_rejected),
    (OuterKeyUnavailable, _outer_key),
    (HarError, _har),
    (DBError, _db),
    (MultipleDevices, _multiple_devices),
    (ADBError, _adb),
    (WriteFailed, _write_failed),
    (InvalidFormat, _invalid_format),
]


def render(err: AppError) -> tuple[str, list[str]]:
    """返回一句话消息与提示列表，错误自带的 hints 排在前面。"""
    hints = list(getattr(err, 'hints', ()) or ())
    for cls, rule in _RULES:
        if isinstance(err, cls):
            hints.extend(h for h in rule(err) if h not in hints)
            break
    return err.message, hints


__all__ = ['HINT_CMD', 'render']
