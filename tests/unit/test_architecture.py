"""分层铁律的机器校验，纯 AST 扫描，不依赖 import-linter。

分层文档会过期而随手 import 不会，所以用 pytest 守住：domain 不许碰 application/infra/interface，
application 不许碰 infra/interface，usecases 之间不许互相 import，只有 reporting 与交互层能 print。
"""
from __future__ import annotations

import ast
from pathlib import Path

import pytest

SRC = Path(__file__).resolve().parents[2] / 'src' / 'guanxing'

LAYER_RULES = {
    'domain': ('guanxing.application', 'guanxing.infra', 'guanxing.interface',
               'guanxing.bootstrap'),
    'application': ('guanxing.infra', 'guanxing.interface', 'guanxing.bootstrap'),
    # 入口层只能依赖 application + bootstrap（组合根），不碰 infra 的具体实现
    'interface': ('guanxing.infra',),
    # 组合根天然要 import 两边；它唯一不能反向依赖的是入口层
    'bootstrap': ('guanxing.interface',),
    'shared': ('guanxing.domain', 'guanxing.application', 'guanxing.infra',
               'guanxing.interface', 'guanxing.bootstrap'),
}


def _py_files(layer: str) -> list[Path]:
    root = SRC / layer
    if not root.is_dir():
        return []
    return sorted(p for p in root.rglob('*.py') if '__pycache__' not in p.parts)


def _imported_modules(path: Path) -> set[str]:
    """收集一个文件里所有 import 的绝对模块名（相对 import 也归一化）。"""
    tree = ast.parse(path.read_text(encoding='utf-8'), filename=str(path))
    pkg_parts = ['guanxing', *path.relative_to(SRC).parts[:-1]]
    names: set[str] = set()
    for node in ast.walk(tree):
        if isinstance(node, ast.Import):
            names.update(alias.name for alias in node.names)
        elif isinstance(node, ast.ImportFrom):
            if node.level == 0:
                if node.module:
                    names.add(node.module)
                continue
            # 相对 import：当前模块所在包向上数 level-1 层
            depth = len(pkg_parts) - (node.level - 1)
            base = pkg_parts[:max(depth, 1)]
            if node.module:
                base = base + node.module.split('.')
            names.add('.'.join(base))
    return names


@pytest.mark.parametrize('layer', sorted(LAYER_RULES))
def test_layer_must_not_import_upper_layers(layer: str) -> None:
    forbidden = LAYER_RULES[layer]
    offenders: list[str] = []
    for path in _py_files(layer):
        for module in _imported_modules(path):
            if module.startswith(forbidden):
                offenders.append(f'{path.relative_to(SRC)} -> {module}')
    assert not offenders, '违反分层依赖:\n' + '\n'.join(offenders)


# 唯一允许 import 兄弟用例的模块：它是"编排者"，职责就是把几个用例按顺序串起来。
# 白名单写在测试里而不是注释里——新增编排者必须显式加进来，等于强制复核一次。
_USECASE_COMPOSERS = {'run_import.py'}


def test_usecases_do_not_import_each_other() -> None:
    root = SRC / 'application' / 'usecases'
    if not root.is_dir():
        pytest.skip('usecases 目录不存在')
    offenders: list[str] = []
    for path in sorted(root.glob('*.py')):
        if path.name.startswith('_') or path.name in _USECASE_COMPOSERS:
            continue
        for module in _imported_modules(path):
            if module.startswith('guanxing.application.usecases.') and not \
                    module.rsplit('.', 1)[-1].startswith('_'):
                offenders.append(f'{path.name} -> {module}')
    assert not offenders, '用例之间不许互相 import:\n' + '\n'.join(offenders)


def test_no_print_outside_reporting() -> None:
    offenders: list[str] = []
    for path in sorted(SRC.rglob('*.py')):
        if '__pycache__' in path.parts:
            continue
        if 'reporting' in path.parts:
            continue
        if 'interactive' in path.parts:
            continue  # 交互提示必然直接 print
        tree = ast.parse(path.read_text(encoding='utf-8'), filename=str(path))
        for node in ast.walk(tree):
            if (isinstance(node, ast.Call) and isinstance(node.func, ast.Name)
                    and node.func.id == 'print'):
                offenders.append(f'{path.relative_to(SRC)}:{node.lineno}')
    assert not offenders, '输出必须走 Reporter，禁止 print:\n' + '\n'.join(offenders)


def test_domain_does_not_import_optional_thirdparty() -> None:
    """domain 允许的标准库白名单之外的第三方库一律禁止（pydantic 例外，见手册）。"""
    allowed = {
        'pydantic',   # 存档模型（可选依赖，缺失时上层已做兜底）
        'xxtea',      # 可选 C 加速，仅在函数体内惰性 import
    }
    stdlib_ok = {
        '__future__', 'base64', 'binascii', 'datetime', 'enum', 'hashlib', 'json', 're',
        'struct', 'typing', 'zlib', 'collections', 'dataclasses', 'itertools',
        'functools', 'math', 'string', 'uuid', 'pathlib', 'copy', 'abc', 'time',
    }
    offenders: list[str] = []
    for path in _py_files('domain'):
        for module in _imported_modules(path):
            if not module.startswith('guanxing'):
                root = module.split('.')[0]
                if root not in stdlib_ok and root not in allowed:
                    offenders.append(f'{path.relative_to(SRC)} -> {module}')
    assert not offenders, 'domain 引入了第三方依赖:\n' + '\n'.join(offenders)
