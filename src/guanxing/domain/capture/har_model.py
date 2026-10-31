"""HAR 文件的结构模型（只建模用得到的字段）。"""

from pydantic import BaseModel, ConfigDict, Field


class CreatorModel(BaseModel):
    name: str
    version: str
    comment: str|None = None

class BrowserModel(BaseModel):
    name: str
    version: str
    comment: str|None = None

class PageModel(BaseModel):
    startedDateTime: str
    id: str
    title: str
    pageTimings: dict
    comment: str|None = None

class HeaderModel(BaseModel):
    name: str
    value: str
    comment: str|None = None

class QueryStringModel(BaseModel):
    name: str
    value: str
    comment: str|None = None

class PostDataModel(BaseModel):
    mimeType: str
    params: list|None = None
    text: str|None = None
    comment: str|None = None

class RequestModel(BaseModel):
    method: str
    url: str
    httpVersion: str
    cookies: list[dict]
    headers: list[HeaderModel]
    queryString: list[QueryStringModel]
    postData: PostDataModel|None = None
    headersSize: int
    bodySize: int
    comment: str|None = None

class ResponseModel(BaseModel):
    model_config = ConfigDict(populate_by_name=True, extra="allow")
    responseAvailable: bool|None = Field(None, alias='_responseAvailable')
    originalContentEncoding: str|None = Field(None, alias='_originalContentEncoding')

    status: int
    statusText: str
    httpVersion: str
    cookies: list[dict]
    headers: list[HeaderModel]
    content: dict
    redirectURL: str
    headersSize: int
    bodySize: int
    comment: str|None = None

class EntryModel(BaseModel):
    model_config = ConfigDict(populate_by_name=True, extra="allow")
    id: str|None = Field(None, alias='_id')
    app: dict|None = Field(None, alias='_app')

    pageref: str|None = None
    startedDateTime: str
    time: float
    request: RequestModel
    response: ResponseModel
    cache: dict|None = None
    timings: dict|None = None
    serverIPAddress: str|None = None
    connection: str|None = None
    comment: str|None = None

class LogModel(BaseModel):
    version: str = "1.2"                    # HAR 版本号
    creator: CreatorModel                   # 创建者信息
    browser: BrowserModel|None = None       # 浏览器信息（可选）
    pages: list[PageModel]|None = None      # 页面信息列表（可选）
    entries: list[EntryModel]               # 请求条目列表
    comment: str|None = None                # 注释（可选）

class HarModel(BaseModel):
    log: LogModel
