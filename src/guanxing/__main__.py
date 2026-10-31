"""``python -m guanxing`` 入口。

工作区与 ``run.py`` 保持一致：钉在包所在仓库的根目录，不落在当前目录。
注意：``pip install`` 后从任意目录调用时，包已装进 site-packages，
这里推出来的是 site-packages 而不是仓库根，所以只在开发态（源码目录）才有意义。
"""
from pathlib import Path

from guanxing.interface.cli.app import main

if __name__ == '__main__':
    # src/guanxing/__main__.py -> parents[0]=guanxing, [1]=src, [2]=仓库根
    _ROOT = Path(__file__).resolve().parents[2]
    raise SystemExit(main(default_workspace=_ROOT if (_ROOT / 'run.py').is_file() else None))

