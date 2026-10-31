"""组合根：唯一允许同时 import infra 与 application 的地方，只装配不写流程。

其余模块通过构造参数拿端口实现，换实现（如换密钥库格式）只改这个文件。
import 期不要读环境变量或构造对象，否则测试之间会互相污染。
"""
from __future__ import annotations

from datetime import datetime
from pathlib import Path

from guanxing.application.packs import CryptoStack, DeviceStack, StorageStack
from guanxing.application.services.memory_hunter import MemoryKeyHunter
from guanxing.application.services.outer_key_resolver import OuterKeyResolver
from guanxing.application.services.output_layout import OutputLayout
from guanxing.application.services.save_decoder import SaveDecoder
from guanxing.domain.channels import GAME_PACKAGES
from guanxing.domain.crypto.oracle import Oracle
from guanxing.domain.crypto.xxtea import XXTEACrypto
from guanxing.domain.keys.table import KeyTable
from guanxing.domain.protocol.keys import ProtocolKeyDeriver
from guanxing.domain.save.envelope import SaveEnvelope
from guanxing.infra.capture.har_reader import HarReaderImpl
from guanxing.infra.crypto.pool import CrackExecutorImpl
from guanxing.infra.device.adb_client import DeviceGatewayImpl
from guanxing.infra.fs.local import FileSystemImpl
from guanxing.infra.keys.json_store import KeyStoreImpl
from guanxing.infra.memory.region_reader import ProcessMemoryImpl
from guanxing.infra.optional import available
from guanxing.infra.reporting.log_sink import LogReporter
from guanxing.infra.savedb.sqlite_repo import DBProcessorImpl
from guanxing.infra.shared.settings import load_settings
from guanxing.infra.web.browser import open_url
from guanxing.infra.web.publish import write_local_save
from guanxing.shared.progress import ProgressSink
from guanxing.shared.settings import Settings

PROG = 'guanxing'


def _has_c_xxtea() -> bool:
    """可选 C 加速：只在真的装了 ``xxtea`` 包时启用（惰性，不在模块顶层 import）。"""
    return available('xxtea')


def build_settings(**overrides) -> Settings:
    """按「显式覆盖 + 环境变量 + 启动脚本目录」构造配置。"""
    return load_settings(**overrides)


def build_progress(settings: Settings | None = None) -> ProgressSink:
    """构造本次运行的进度上报器，实现在 infra，入口层不直接 new。"""
    import logging

    if settings is None:
        return LogReporter(logging.getLogger(PROG))
    return LogReporter(logging.getLogger(PROG),
                       quiet=settings.quiet, verbose=settings.verbose)



def build_stacks(
    settings: Settings,
    progress: ProgressSink,
) -> tuple[CryptoStack, StorageStack, DeviceStack]:
    """装配一次运行需要的全部实现。

    Args:
        settings: 本次运行的配置。
        progress: 进度上报。
    Returns:
        (crypto, storage, device) 三个按用途分好的包，下游只拿自己那一包。
    """

    xxtea = XXTEACrypto(has_cxxtea=_has_c_xxtea())
    table = KeyTable()
    keystore = KeyStoreImpl(
        settings.keys_file, settings.local_keys_file, table,
    )
    keystore.load()
    for problem in keystore.problems:
        progress.warn(problem)
    for note in keystore.notes:
        progress.hint(note)

    envelope = SaveEnvelope(xxtea, table)
    deriver = ProtocolKeyDeriver(xxtea)
    decoder = SaveDecoder(xxtea, envelope, deriver, progress)

    fs = FileSystemImpl()
    layout = OutputLayout(fs, progress)

    # 用例层选中的设备号写在这里，之后开网关（含内存扫描）都优先用它
    chosen: dict[str, str] = {}

    def _open_device(**overrides) -> DeviceGatewayImpl:
        return DeviceGatewayImpl(
            exe=overrides.pop('exe', settings.adb_path),
            serial=overrides.pop('serial', chosen.get('serial') or settings.serial),
            timeout=overrides.pop('timeout', settings.timeouts.adb),
        )

    # 内存爆破：游戏更新 → psw 变了 → keys.json 里没有 → 只能去进程内存里挖。
    # 构造本身不碰 adb（真要用时才开设备），所以“离线解档”场景不受影响。
    hunter = MemoryKeyHunter(
        open_device=_open_device,
        open_memory=lambda **kw: ProcessMemoryImpl(_open_device(**kw),
                                                timeout=settings.timeouts.scan),
        executor=CrackExecutorImpl(
            xxtea, Oracle(xxtea),
            threshold=settings.mem.crack_threshold,
            max_workers=settings.mem.workers,
        ),
        xxtea=xxtea,
        envelope=envelope,
        progress=progress,
        packages=(settings.package,) if settings.package else GAME_PACKAGES,
        anon_only=settings.mem.anon_only,
        min_kb=settings.mem.min_kb,
        region_max_mb=settings.mem.region_max_mb,
        chunk_mb=settings.mem.chunk_mb,
        limit_mb=settings.mem.limit_mb,
    )
    outer_keys = OuterKeyResolver(keystore, decoder, progress, memory=hunter.outer_key)

    crypto = CryptoStack(
        keystore=keystore,
        deriver=deriver,
        decoder=decoder,
        outer_keys=outer_keys,
        # 只把"找完整内层密钥"这件能力交出去，不把整台扫描机漏到用例层
        hunt_inner_key=hunter.inner_key,
    )
    storage = StorageStack(
        fs=fs,
        layout=layout,
        open_savedb=DBProcessorImpl,
        open_capture=HarReaderImpl,
        cache_dir=Path(settings.cache_dir),
        clock=datetime.now,
        write_local_save=write_local_save,
        open_url=open_url,
    )
    device = DeviceStack(open_device=_open_device,
                         use_serial=lambda serial: chosen.__setitem__('serial', serial))
    return crypto, storage, device


__all__ = ['build_progress', 'build_settings', 'build_stacks']
