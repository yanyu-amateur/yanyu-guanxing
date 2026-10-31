"""退出码（用户契约，不能变）。"""
from __future__ import annotations

EXIT_OK = 0            # 成功 / 用户主动取消
EXIT_UNEXPECTED = 1    # 未预期错误（有堆栈）
EXIT_USER = 2          # 用户可修复的错误
EXIT_INTERRUPT = 130   # Ctrl+C

__all__ = ['EXIT_INTERRUPT', 'EXIT_OK', 'EXIT_UNEXPECTED', 'EXIT_USER']
