"""存档明文里用得到的那部分字段的 pydantic 模型。

只建模用得到的字段，其余忽略；不能自动转换的字段名用显式 alias。
注意：可用 datamodel-codegen 从 dat.json 生成完整字段，但仅供参考，字段类型限制容易出现问题
"""
from pydantic import BaseModel, ConfigDict, Field
from pydantic.alias_generators import to_pascal


class Base(BaseModel):
    model_config = ConfigDict(
        alias_generator=to_pascal,
        validate_by_name=True,
        validate_by_alias=True,
        extra="allow"
    )

class GlobalVariableModel(Base):
    repute: int

class MainRoleModel(Base):
    men_pai: int
    sex: int
    level: int
    name: str
    job: int
    cloth: int | None = None
    shoe: int | None = None

class SaveModel(Base):
    energy: int
    money: float
    global_variable: GlobalVariableModel = Field(..., alias='globalVariable')
    yue: int
    main_role: MainRoleModel
    sav_code: int

