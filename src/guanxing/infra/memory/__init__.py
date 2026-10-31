"""内存扫描适配器（端口实现见 ``region_reader.py``，纯解析见 ``proc_maps.py``）。"""
from .proc_maps import parse_maps, select_regions, total_bytes
from .region_reader import ProcessMemoryImpl

__all__ = ['ProcessMemoryImpl', 'parse_maps', 'select_regions', 'total_bytes']
