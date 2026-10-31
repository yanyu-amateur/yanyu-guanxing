"""存档格式识别与解析：新版带 8 字符外层标记，初版是纯 base64。

新版 content = marker(8) + base64(XXTEA(base64(版本号+内层密文), 外层密钥))，括号里那段就是初版 content。
识别靠形状 + 能不能真正解开，换标记不需要发版，也不存在"未登记标记"这种状态。
"""

import re

from ..constants import SAVE_MARKER_LEN, SAVE_VERSION_LEN
from ..crypto.codec import Codec
from ..errors import InvalidFormat
from .types import SaveFormatType

_VERSION_RE = re.compile(r'^\d{8}$')

# 标准 base64 字母表（含 padding）。用来把"像存档的乱码"挡在外面。
_B64_CHARS = frozenset(
    'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/=')


def _new_body(content: str) -> bytes | None:
    """按新版形状切开：8 字符可打印前缀 + base64 密文（XXTEA 要求 4 字节对齐）。

    Args:
        content: 存档 content 文本。
    Returns:
        外层密文；形状不符返回 None。
    注意两点，都是为了让"不是存档的东西"别被当成新版：
    1. 不判前缀是不是"见过的标记"——能不能解开与那 8 个字符无关，
       换标记不该让工具失效（所以这里没有标记名单）；
    2. 尾部必须是严格 base64（只有 ``A-Za-z0-9+/=``）。只按"4 对齐 + 能解"
       放行的话，8% 的随机可打印串都会通过，接着白扫一两分钟内存；收紧到严格
       字符集后实测误判为 0，而真实存档一个都不受影响。
    """
    if len(content) <= SAVE_MARKER_LEN:
        return None
    marker = content[:SAVE_MARKER_LEN]
    if not marker.isprintable() or any(c.isspace() for c in marker):
        return None
    tail = content[SAVE_MARKER_LEN:]
    if not tail or len(tail) % 4 or any(c not in _B64_CHARS for c in tail):
        return None
    raw = Codec.b64d(tail)
    if not raw or len(raw) % 4:
        return None
    return raw


# ─────────────────────────── 识别 ───────────────────────────
def detect_format(content: str) -> SaveFormatType | None:
    """探测存档格式，返回 old / new / None。

    判定顺序不能倒：初版 base64 整串同样满足"8 字符前缀 + 4 对齐 base64"，
    与新版形状完全重合，只能靠更强的校验先把初版摘出去：
    1. 整串按初版解开，且前 8 字节是 8 位数字版本号 → old；
    2. 否则只要形状符合新版 → new。

    真正的把关在下一步：外层密钥能不能解出 zlib+json 存档。标记本身
    没有任何密码学作用，卡在它上面只会让"存档更换标签"变成工具静默失效。
    """
    if not content or len(content) < 16:
        return None
    env = Codec.b64d(content)
    if env and len(env) > SAVE_VERSION_LEN:
        ver = env[:SAVE_VERSION_LEN].decode('ascii', 'ignore')
        if _VERSION_RE.match(ver) and (len(env) - SAVE_VERSION_LEN) % 4 == 0:
            return SaveFormatType.OLD
    if _new_body(content) is not None:
        return SaveFormatType.NEW
    return None


# ─────────────────────────── 解析 ───────────────────────────
def parse_old(content: str) -> tuple[str, bytes]:
    """初版: 返回 (version, body)。body 是内层 XXTEA 密文。"""
    env = Codec.b64d(content)
    if env is None:
        raise InvalidFormat('初版 content 不是合法 base64')
    version = env[:SAVE_VERSION_LEN].decode('ascii', 'replace')
    if not _VERSION_RE.match(version):
        raise InvalidFormat(f'版本号非法: {version!r}')
    body = env[SAVE_VERSION_LEN:]
    if len(body) % 4:
        raise InvalidFormat(f'内层密文长度未对齐: {len(body)}')
    return version, body


def parse_new(content: str) -> tuple[str, bytes]:
    """新版: 返回 (marker, body)，body 仍是外层密文。

    Raises:
        InvalidFormat: 前缀不是 8 个可打印字符，或剩余部分不是 4 对齐的 base64。
    """
    raw = _new_body(content)
    if raw is None:
        raise InvalidFormat(
            f'新版 content 形状不对（前缀 {content[:SAVE_MARKER_LEN]!r}，'
            '剩余部分需是 4 字节对齐的 base64）')
    return content[:SAVE_MARKER_LEN], raw
