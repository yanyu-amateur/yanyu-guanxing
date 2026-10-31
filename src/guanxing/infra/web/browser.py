"""打开浏览器的平台差异（``start`` / ``open`` / ``xdg-open``）。"""
from __future__ import annotations

import logging
import webbrowser

logger = logging.getLogger('guanxing.web')


def open_url(url: str, *, new: int = 2) -> bool:
    """尝试在默认浏览器打开，返回是否成功（失败不抛，只记 warning）。"""
    try:
        ok = webbrowser.open(url, new=new)
    except Exception:  # noqa: BLE001 - 浏览器不可用不该让主流程失败
        logger.warning('打开浏览器失败，请手动访问: %s', url, exc_info=True)
        return False
    if not ok:
        logger.warning('系统没有关联默认浏览器，请手动访问: %s', url)
    return ok


__all__ = ['open_url']
