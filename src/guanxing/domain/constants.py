"""事实常量：长度、位宽、魔术字、固定字符串。

会随游戏版本增长的数据表不在这里，见 keys/builtin_tables.py。
"""

# ───────────────────────── XXTEA ─────────────────────────
XXTEA_DELTA = 0x9E3779B9
MASK32 = 0xFFFFFFFF
# 密文长度 n 个字时，末字（明文长度）必须落在 [n*4-7, n*4-4]
# 随机猜中概率 4/2^32 ≈ 1e-9  —— 所有"爆破钥匙"都靠它当预言机
XXTEA_LEN_TAIL = 7
XXTEA_LEN_HEAD = 4

# ─────────────────────── 存档格式 ───────────────────────
# 新版: marker(8) + base64( XXTEA( base64(版本号(8) + XXTEA(zlib(json), 内层密钥)), 外层密钥 ) )
# 初版:              base64(              版本号(8) + XXTEA(zlib(json), 内层密钥) )
SAVE_MARKER_LEN = 8
SAVE_VERSION_LEN = 8

# 重新打包默认用的外层标记
DEFAULT_SAVE_MARKER = 'dnkemiea'

# ───────────────────── 内层密钥结构 ─────────────────────
# inner_key = psw(8) + 渠道后缀(8)，两段都是可打印 ASCII 且总在内存里连成 16 字节
INNER_PSW_LEN = 8
INNER_KEY_LEN = 16

# ───────────────────── 协议（抓包） ─────────────────────
PROTOCOL_MIDDLE = 'eakec'        # realKey = acc[:5] + "eakec" + innerK[:6]
PROTOCOL_KEY_LEN = 16
PROTOCOL_INNER_MIN = 1
PROTOCOL_INNER_MAX = 128
