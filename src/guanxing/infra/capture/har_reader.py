"""HAR 读取实现：定位 upload 请求体与 download 响应，取账号、区服、版本。

命令名用正则 upload[0-9]{0,2} / download[0-9]{0,2} 匹配，不写死完整名字。
"""

import base64
import json
import re
from pathlib import Path

from guanxing.application.ports.capture import HarReader
from guanxing.domain.capture.har_model import EntryModel, HarModel
from guanxing.shared.errors import HarError
from guanxing.shared.utils import check_path, load_json

DOWNLOAD_RE = re.compile(r'download[0-9]{0,2}', re.IGNORECASE)
UPLOAD_RE = re.compile(r'upload[0-9]{0,2}', re.IGNORECASE)


def _describe_validation(exc: object) -> str:
    """把 pydantic 的校验错误压成一行人话，说清字段路径与缺什么。

    Args:
        exc: 捕获到的异常，可能是 pydantic ValidationError 也可能是别的 ValueError。
    Returns:
        可直接放进 hint 的说明。只说无效 HAR 等于没说，用户看不出是哪个字段。
    """
    errors = getattr(exc, 'errors', None)
    if not callable(errors):
        return '用文本编辑器检查导出的 .har 是否是完整 JSON'
    try:
        items = errors()
    except Exception:  # 拿不到细节就退回通用提示
        return '用文本编辑器检查导出的 .har 是否是完整 JSON'
    parts: list[str] = []
    for item in items[:3]:
        loc = '.'.join(str(x) for x in item.get('loc', ()))
        kind = item.get('type', '')
        parts.append(f'{loc}（{kind}）' if loc else kind)
    return '缺失或类型不对的字段: ' + '、'.join(parts) if parts else '结构不符合 HAR 规范'


class HarReaderImpl(HarReader):
    def __init__(self, path: str|Path) -> None:
        try:
            check_path(path, readable=True)
        except OSError as exc:
            raise HarError(f'读不到 HAR 文件: {path}') from exc
        self.path = path
        self.raw = load_json(path)

        try:
            _har = HarModel.model_validate(self.raw)
        except (ValueError, TypeError) as exc:      # pydantic 的 ValidationError 也是 ValueError
            raise HarError(
                f'HAR 结构不完整: {path}',
                hint=_describe_validation(exc),
            ) from exc
        self.entries = _har.log.entries
        if not self.entries:
            # 单独抛，以免被上面的 except 吞成“无效的 HAR 文件”
            raise HarError(f'HAR 文件 {path} 没有任何请求/响应条目')

    def get_value_by_header_name(self, entry: EntryModel, name: str,
                                 where: str = 'request') -> None | str:
        """获取请求/响应头"""
        if where == 'request':
            headers = entry.request.headers
        elif where == 'response':
            headers = entry.response.headers
        else:
            raise ValueError('where 只能是 request 或 response')
        for h in headers:
            if h.name.lower() == name.lower():
                return h.value.strip()
        return None

    def command_of(self, entry: EntryModel) -> str:
        """请求的 ``command`` 头（去空白）。"""
        return (self.get_value_by_header_name(entry, 'command', 'request') or '').strip()

    def _response_len(self, entry: EntryModel) -> int:
        return len(self._response_text(entry) or '')

    def downloads(self) -> list[EntryModel]:
        """所有 download 条目，按响应体从大到小。

        Returns:
            条目列表；新协议下这是唯一能离线取到东西的入口。
        """
        res = []
        for e in self.entries:
            cmd = self.command_of(e)
            # 有 command 头就按它判；没有时退回看 URL（个别抓包工具会丢自定义头）
            target = cmd if cmd else (e.request.url or '')
            if DOWNLOAD_RE.search(target):
                res.append(e)
        return sorted(res, key=self._response_len, reverse=True)

    def key_source(self) -> EntryModel | None:
        """找到带 k 响应头的那条（通常是登录或 startGame 的响应）。"""
        for e in self.entries:
            if self.get_value_by_header_name(e, 'k', 'response'):
                return e
        return None

    def k_header(self) -> None | str:
        """抓包里的 k 响应头（通常是登录或 startGame 的响应）。"""
        e = self.key_source()
        if e is None:
            return None
        return self.get_value_by_header_name(e, 'k', 'response')

    def _probe_entry(self) -> EntryModel | None:
        """任取一条带 acc 请求头的条目。

        Returns:
            条目；整个 HAR 里没有 acc 头时返回 None。
            acc/area/ver 每条 api 请求都带，不要依赖 upload 条目。
        """
        for e in self.entries:
            if self.get_value_by_header_name(e, 'acc', 'request'):
                return e
        return None

    def account(self, entry: EntryModel|None=None) -> None | str:
        """账号 - request.headers.acc"""
        e = entry or self._probe_entry()
        if e is None:
            return None
        return self.get_value_by_header_name(e, 'acc', 'request')

    def server(self, entry: EntryModel|None=None) -> None | str:
        """服务器号 - request.headers.area"""
        e = entry or self._probe_entry()
        if e is None:
            return None
        return self.get_value_by_header_name(e, 'area', 'request')

    def client_version(self, entry: EntryModel|None=None) -> None | str:
        """客户端版本号 - request.headers.ver（与 content 内的版本号一致）。"""
        for e in (entry, *self.downloads(), self._probe_entry()):
            if e is None:
                continue
            ver = self.get_value_by_header_name(e, 'ver', 'request')
            if ver and ver.strip():
                return ver.strip()
        return None

    # ───────────── 旧版：存档藏在 upload 请求体里 ─────────────
    def body_text(self, entry: EntryModel) -> str:
        """请求体原始文本（``postData.text``）。

        Args:
            entry: HAR 条目。
        Returns:
            请求体文本；没有时返回空串。
        """
        post = entry.request.postData
        return (post.text or '') if post is not None else ''

    def upload_bodies(self, min_chars: int = 0) -> list[EntryModel]:
        """upload 系请求，按请求体从大到小。

        Args:
            min_chars: 请求体至少多少字符才算候选（小请求不可能装下存档）。
        Returns:
            条目列表；没有 ``command`` 头的条目不会被当成 upload。
        """
        picked = [
            e for e in self.entries
            if UPLOAD_RE.search(self.command_of(e))
            and len(self.body_text(e)) >= min_chars
        ]
        return sorted(picked, key=lambda e: len(self.body_text(e)), reverse=True)

    # ───────────── 新协议唯一还能用的入口：download ─────────────
    def download_payload(self) -> dict[str, str] | None:
        """取 download 响应的明文 JSON，优先返回带 extra 的那条。

        Returns:
            {stamp, saveCode, extra, data, code}；没有可用条目时返回 None。
            extra 是离线拿到 psw 的唯一来源。
        """
        best: dict[str, str] | None = None
        for e in self.downloads():
            payload = self._payload_of(e)
            if payload is None:
                continue
            if payload.get('extra'):
                return payload
            if best is None:
                best = payload
        return best

    def _payload_of(self, entry: EntryModel) -> dict[str, str] | None:
        text = self._response_text(entry)
        if not text or not text.lstrip().startswith('{'):
            return None
        try:
            payload = json.loads(text)
        except (TypeError, ValueError):
            return None
        if not isinstance(payload, dict):
            return None
        if not (payload.get('extra') or payload.get('data')):
            return None
        return {str(k): str(v) for k, v in payload.items()}

    def _response_text(self, entry: EntryModel) -> str | None:
        """取响应体文本，content.encoding 为 base64 时先解码。

        Args:
            entry: HAR 条目。
        Returns:
            文本；没有响应体或解不出来时返回 None。
            Chrome、Charles、部分版本的 ProxyPin 默认把二进制响应体写成 base64。
        """
        content = entry.response.content
        if not isinstance(content, dict):
            return None
        text = content.get('text')
        if not isinstance(text, str):
            return None
        encoding = str(content.get('encoding') or '').strip().lower()
        if encoding != 'base64':
            return text
        try:
            raw = base64.b64decode(text, validate=False)
        except (ValueError, TypeError):
            return None
        return raw.decode('utf-8', 'replace')
