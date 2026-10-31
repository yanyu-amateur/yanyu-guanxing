"""从明文存档生成 player 字段的文本（列表页展示用）。"""

import json

from .models import SaveModel

FIELD_ORDER = ['energy', 'menpai', 'sex', 'money', 'lev', 'prestige', 'doubt',
               'saveCode', 'nick', 'job', 'version', 'avatar', 'yue']


def build_text(data: dict | None, version: str) -> str:
    """生成 dat.db 里 save.player 列的明文摘要。"""
    if not data:
        return ''
    try:
        return build(SaveModel.model_validate(data), version)
    except Exception:
        return ''


def build(data: SaveModel, version: str) -> str:
    """压成网页展示用的 player JSON，键序固定、分隔符不带空格。"""
    avatar = data.main_role.cloth if data.main_role.cloth is not None else data.main_role.shoe  # 二者疑似始终一致，疑似可以删掉
    try:
        version_num = int(version)
    except (TypeError, ValueError):
        version_num = 0
    output = {
        'energy': data.energy,
        'menpai': data.main_role.men_pai,
        'sex': data.main_role.sex,
        'money': data.money,
        'lev': data.main_role.level,
        'prestige': data.global_variable.repute,
        'doubt': 0,
        'saveCode': data.sav_code,
        'nick': data.main_role.name,
        'job': data.main_role.job,
        'version': version_num,
        'avatar': avatar if avatar is not None else 0,
        'yue': data.yue
    }
    ordered = {k: output[k] for k in FIELD_ORDER}
    res = json.dumps(ordered, ensure_ascii=False, separators=(',', ':'))
    return res
