"""用例依赖按用途分成 crypto / storage / device 三包。

装配点 bootstrap 一次调用返回 tuple，下游各取自己那一包，不落地成"什么都有"的实例。
注意：字段只放能力（Port、工厂、窄 Callable），不放业务数据；包内零方法。
"""
from __future__ import annotations

from collections.abc import Callable
from dataclasses import dataclass, field
from datetime import datetime
from pathlib import Path
from typing import Any

from guanxing.domain.protocol.keys import ProtocolKeyDeriver

from .ports.capture import HarReader
from .ports.device import DeviceGateway
from .ports.fs import FileSystem
from .ports.keystore import KeyStore
from .ports.savedb import DBProcessor
from .services.outer_key_resolver import OuterKeyResolver
from .services.output_layout import OutputLayout
from .services.save_decoder import SaveDecoder


@dataclass(frozen=True)
class CryptoStack:
    """密钥与解密：查表、组密钥、解内外两层、挖内存都算这里的。"""

    keystore: KeyStore
    deriver: ProtocolKeyDeriver
    decoder: SaveDecoder
    outer_keys: OuterKeyResolver
    # 去进程内存里挖内层密钥的窄能力，没接设备时为 None（外层的挖法由 outer_keys 自己持有）
    hunt_inner_key: Callable[..., str] | None = None


@dataclass(frozen=True)
class StorageStack:
    """本地读写与"把结果交出去"：输出目录、dat.db、HAR、缓存、时间戳、网页发布。"""

    fs: FileSystem
    layout: OutputLayout
    open_savedb: Callable[[Path], DBProcessor]
    open_capture: Callable[[Path], HarReader]
    cache_dir: Path = field(default_factory=lambda: Path('_cache'))
    clock: Callable[[], datetime] = datetime.now
    # 写 web/local-save.js 与打开浏览器都是"交给外部世界"的动作，归存储这一包。
    # 默认值做成"一调用就炸"：漏接线要立刻暴露，而不是静默什么都不做。
    write_local_save: Callable[[Path, dict | None, dict | None], Path] = field(
        default_factory=lambda: _unbound('write_local_save'))
    open_url: Callable[[str], bool] = field(
        default_factory=lambda: _unbound('open_url'))


def _unbound(name: str, owner: str = 'StorageStack') -> Any:
    """占位默认值：没接实现就明确报错。"""
    def _fail(*_args: object, **_kwargs: object) -> Any:
        raise RuntimeError(f'{owner}.{name} 未接线（应由 bootstrap 注入）')
    return _fail


@dataclass(frozen=True)
class DeviceStack:
    """设备：目前只有"开一个 adb 网关"，未来的 push/restart 也长在这里。"""

    open_device: Callable[..., DeviceGateway]
    # 记住这一轮选定的是哪台设备：内存扫描在 bootstrap 就装配好了，
    # 拿不到用例层选出来的设备号，不靠这个回传就会在多开时失败
    use_serial: Callable[[str], None] = field(
        default_factory=lambda: _unbound('use_serial', 'DeviceStack'))


__all__ = ['CryptoStack', 'DeviceStack', 'StorageStack']
