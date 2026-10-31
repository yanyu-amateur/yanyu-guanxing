"""渠道包名表，纯数据

表里的条目只决定先试哪个包名，设备端探测到哪个包有存档就用哪个，未收录的渠道同样能跑。
工具只对官服做承诺；新渠道在这一张表里加一行（包名与显示名写在一起）。
"""
from __future__ import annotations

# 官服（默认）
PACKAGE_LANJING = 'com.lanjing.yanyu.lanjing'

# 包名 -> 渠道显示名。dict 保序，官服排最前就是默认。
PACKAGE_LABELS: dict[str, str] = {
    PACKAGE_LANJING: '官服',
    'com.lanjing.yanyu.aligames': '九游',
    'com.lanjing.yanyu.bilibili': 'B站',
    'com.lanjing.yanyu.honor': '荣耀',
    'com.lanjing.yanyu.huawei': '华为',
    'com.lanjing.yanyu.huluxia': '葫芦侠',
    'com.lanjing.yanyu.hwlharmony': '鸿蒙',
    'com.lanjing.yanyu.ljpre': '先行服',
    'com.lanjing.yanyu.m4399': '4399',
    'com.lanjing.yanyu.mi': '小米',
    'com.lanjing.yanyu.mz': '魅族',
    'com.lanjing.yanyu.net.nearme.gamecenter': 'OPPO',
    'com.lanjing.yanyu.vivo': 'vivo',
    'com.lanjing.yanyu.yuedong': '悦动',
    'com.hetun.uc.yanyu': 'UC',
    'com.tencent.tmgp.lanjing.yanyu': '应用宝',
    'com.wuxia.novastar': '国际服',
}

GAME_PACKAGES: tuple[str, ...] = tuple(PACKAGE_LABELS)

DEFAULT_PACKAGE = PACKAGE_LANJING


def label_of(package: str) -> str:
    """包名 -> 可读渠道名（未知包名原样返回）。"""
    return PACKAGE_LABELS.get(package, package)


__all__ = [
    'DEFAULT_PACKAGE', 'GAME_PACKAGES', 'PACKAGE_LABELS', 'PACKAGE_LANJING',
    'label_of',
]
