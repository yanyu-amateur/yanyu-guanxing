"""外部 keys.json 丢失或没带过来时的内置兜底表（渠道后缀、版本 psw）。

KeyTable 构造时用它播种，外部文件只能往上补，永远不能覆盖或删掉内置项。
注意：新增版本只加行不改老行（老值都在设备上验过）；取值请用 channel_suffixes()/version_psw() 拿副本。
"""
from __future__ import annotations

# ─────────────────── 渠道后缀（内层密钥 = psw + 后缀） ───────────────────
BUILTIN_CHANNEL_SUFFIXES: dict[str, tuple[str, ...]] = {
    'android': ('po06ewkx', 'meeo0wmk'),
    'ios': ('yoqkmrtj',),
    'test_server': ('cgkmi4cq',),
}

# ─────────────────────── 版本号 -> 内层 psw ───────────────────────
BUILTIN_VERSION_PSW: dict[str, str] = {
    '00072280': 'hjo0e3q9',
    '00072288': 'jkds85we',
    '00072294': 'juhycd8e',
    '00073288': '90qabeon',
    '00073302': 'njglp5lv',
    '00073314': 'jkimeicc',
    '00073315': 'u6cgjphe',
    '00073420': 'n0b06b00',
    '00073440': 'pon1dxg7',
    '00073460': 'u52kw6lb',
    '00073570': 'xi9iz9h4',
    # '00073645': '15fgt27w',
    # '00073659': 'dasf34df',
    # '00073661': 'wmjhuy6d',
}

# ─────────────────── 外层标记：不收录 ───────────────────
# 外层标记（content 开头的 8 字符，如 dnkemiea）不参与加解密，解密时原样切掉。
# 识别存档靠形状（见 domain/save/format.py），换标记不需要发版。
# 唯一用到标记的地方是"自己造一份 content"，那用 constants.DEFAULT_SAVE_MARKER。


def channel_suffixes() -> dict[str, list[str]]:
    """渠道后缀的可变副本（每个调用方各拿一份，互不影响）。"""
    return {channel: list(suffixes) for channel, suffixes in BUILTIN_CHANNEL_SUFFIXES.items()}


def version_psw() -> dict[str, str]:
    """版本->psw 的可变副本。"""
    return dict(BUILTIN_VERSION_PSW)


__all__ = [
    'BUILTIN_CHANNEL_SUFFIXES',
    'BUILTIN_VERSION_PSW',
    'channel_suffixes',
    'version_psw',
]
