"""文件与 JSON 的小工具。"""

import json
import os
import tempfile
from pathlib import Path


def check_path(path: str | Path, *, readable: bool = False, writable: bool = False) -> Path:
    """检查路径并返回 Path。

    Args:
        path: 文件路径。
        readable: 是否要求可读，不存在即抛 FileNotFoundError。
        writable: 是否要求可写；文件不存在时只检查父目录。
    Returns:
        检查通过的路径。
    Raises:
        FileNotFoundError: 路径不存在且要求可读。
        OSError: 不可读，或父目录不可用。
    """
    p = Path(path)
    if readable:
        if not p.exists():
            raise FileNotFoundError(f"路径 {p} 不存在")
        try:
            with open(p, "rb") as f:
                f.read(1)
        except Exception as e:
            raise OSError(f"路径 {p} 不可读: {e}") from e
        return p

    if writable:
        if p.exists():
            if not os.access(p, os.W_OK):
                raise OSError(f"路径 {p} 不可写")
            return p
        # 文件还没建：只要父目录能建出来、能写，就认为将来写得进去
        parent = p.parent
        try:
            parent.mkdir(parents=True, exist_ok=True)
        except OSError as e:
            raise OSError(f"路径 {p} 的父目录建不出来: {e}") from e
        if not os.access(parent, os.W_OK):
            raise OSError(f"路径 {p} 的父目录不可写")
        return p
    return p

def load_json(path: str|Path) -> dict:
    """读 JSON 文件，用 utf-8-sig 解码以容忍记事本写入的 BOM。

    Args:
        path: JSON 路径。
    Returns:
        解析结果；文件不存在或解析失败时返回空 dict。
    """
    try:
        with open(path, encoding='utf-8-sig') as f:
            d = json.load(f)
        return d if isinstance(d, dict) else {}
    except Exception:
        return {}


def write_json(path: str|Path, data: dict) -> None:
    """写 JSON 文件，UTF-8、缩进 2，先写临时文件再 os.replace。

    Args:
        path: 目标路径。
        data: 要写入的对象。
        写到一半被中断会留下半个文件，下次读成空表就把用户积累的密钥抹了。
    """
    p = Path(path)
    fd, tmp = tempfile.mkstemp(dir=str(p.parent), prefix='.tmp_', suffix='.part')
    try:
        with os.fdopen(fd, 'w', encoding='utf-8', newline='\n') as f:
            json.dump(data, f, ensure_ascii=False, indent=2)
            f.write('\n')
        os.replace(tmp, p)
    except BaseException:
        Path(tmp).unlink(missing_ok=True)
        raise
