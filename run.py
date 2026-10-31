# -*- coding: utf-8 -*-
"""启动器：不安装也能直接跑。

    python run.py --help
    python run.py local dat.db --outer-key xxxxxxxxxxxxxxxx
    python run.py capture x.har --db dat.db
"""
from __future__ import annotations

import sys
from pathlib import Path

_SRC = Path(__file__).resolve().parent / 'src'
if str(_SRC) not in sys.path:
    sys.path.insert(0, str(_SRC))

from guanxing.interface.cli.app import main  # noqa: E402

if __name__ == '__main__':
    p = Path(__file__).resolve().parent
    raise SystemExit(main(default_workspace=p))
