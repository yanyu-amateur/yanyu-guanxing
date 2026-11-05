"""打开浏览器：ShellExecute 的返回码必须真的被检查。

``os.startfile`` / ``webbrowser.open`` 连"文件不存在"都报成功，
所以这里锁住三件事：失败要返回 False、DDE 忙碌要重试、失败信息要有可读原因。
另外锁住 Job 对象那条分支：在 KILL_ON_JOB_CLOSE 的 Job 里必须改用 explorer 代开。
"""
from __future__ import annotations

import pytest

from guanxing.infra.web import browser


@pytest.fixture(autouse=True)
def _no_job(monkeypatch):
    """默认走 ShellExecute 分支，需要测 Job 分支的用例自己改回来。"""
    monkeypatch.setattr(browser, 'in_kill_on_close_job', lambda: False)


def test_success_code_returns_true(monkeypatch) -> None:
    monkeypatch.setattr(browser, '_shell_execute', lambda url: 42)
    assert browser.open_url('file:///x/index.html') is True


def test_missing_file_returns_false(monkeypatch) -> None:
    """返回码 2 = 文件不存在，以前这种情况也是 True。"""
    monkeypatch.setattr(browser, '_shell_execute', lambda url: 2)
    assert browser.open_url('file:///x/index.html') is False


def test_dde_busy_is_retried_then_succeeds(monkeypatch) -> None:
    """浏览器正忙时 DDE 返回 30，等一会儿重试通常就好了。"""
    codes = iter([30, 42])
    monkeypatch.setattr(browser, '_shell_execute', lambda url: next(codes))
    monkeypatch.setattr(browser.time, 'sleep', lambda _s: None)

    assert browser.open_url('file:///x/index.html') is True


def test_dde_failure_gives_up_after_retries(monkeypatch) -> None:
    calls: list[str] = []

    def always_busy(url: str) -> int:
        calls.append(url)
        return 30

    monkeypatch.setattr(browser, '_shell_execute', always_busy)
    monkeypatch.setattr(browser.time, 'sleep', lambda _s: None)

    assert browser.open_url('file:///x/index.html', retries=2) is False
    assert len(calls) == 3, '首次 + 两次重试'


def test_non_dde_failure_is_not_retried(monkeypatch) -> None:
    calls: list[str] = []

    def denied(url: str) -> int:
        calls.append(url)
        return 5

    monkeypatch.setattr(browser, '_shell_execute', denied)
    assert browser.open_url('file:///x/index.html') is False
    assert len(calls) == 1


def test_warning_mentions_reason_and_path(monkeypatch, caplog) -> None:
    monkeypatch.setattr(browser, '_shell_execute', lambda url: 2)
    with caplog.at_level('WARNING'):
        browser.open_url('file:///E:/a/b/index.html')

    message = ' '.join(r.getMessage() for r in caplog.records)
    assert '文件不存在' in message
    assert 'index.html' in message


# ───────────── Job 对象：VS Code「运行而不调试」的场景 ─────────────
def test_job_with_kill_on_close_uses_explorer(monkeypatch) -> None:
    """在 KILL_ON_JOB_CLOSE 的 Job 里，ShellExecute 的成功是假的：

    它起的进程会随我们退出被一并杀掉，所以必须改用 explorer.exe 代开。
    """
    monkeypatch.setattr(browser, 'in_kill_on_close_job', lambda: True)
    monkeypatch.setattr(browser, '_shell_execute',
                        lambda url: pytest.fail('不该走 ShellExecute'))
    tried: list[str] = []
    monkeypatch.setattr(browser, '_open_via_explorer',
                        lambda path: (tried.append(path), True)[1])

    assert browser.open_url('file:///E:/a/b/index.html') is True
    assert tried == [r'E:\a\b\index.html'], '要传本地路径而不是 file:// URI'


def test_job_falls_back_to_shell_execute_when_explorer_fails(monkeypatch) -> None:
    monkeypatch.setattr(browser, 'in_kill_on_close_job', lambda: True)
    monkeypatch.setattr(browser, '_open_via_explorer', lambda path: False)
    monkeypatch.setattr(browser, '_shell_execute', lambda url: 42)

    assert browser.open_url('file:///E:/a/b/index.html') is True


def test_job_detection_is_false_offscreen(monkeypatch) -> None:
    """非 Windows 平台不该去碰 kernel32。"""
    monkeypatch.setattr(browser.sys, 'platform', 'linux')
    assert browser.in_kill_on_close_job() is False


@pytest.mark.parametrize('code,expected', [
    (2, '文件不存在'),
    (5, '权限被拒绝'),
    (30, 'DDE 忙碌'),
    (31, '没有关联的程序'),
])
def test_error_codes_are_translated(code: int, expected: str) -> None:
    assert expected in browser._describe(code)


def test_manual_hint_turns_uri_into_windows_path() -> None:
    assert browser.manual_hint('file:///E:/a/b/index.html') == r'E:\a\b\index.html'


def test_manual_hint_passes_plain_path_through() -> None:
    assert browser.manual_hint(r'E:\a\b\index.html') == r'E:\a\b\index.html'
