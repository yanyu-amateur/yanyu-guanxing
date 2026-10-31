"""用扫描到的候选爆破钥匙，预言机只负责初筛，命中后必须再复核。

外层复核"能解出可识别格式的 content"，内层复核 zlib+JSON 能过。
只信预言机会把假命中当真，只留 psw 半段又会把刚锚定到的后缀丢掉。
"""
from __future__ import annotations

from guanxing.domain.crypto import candidates as cand_mod
from guanxing.domain.crypto.xxtea import XXTEACrypto
from guanxing.domain.errors import OuterKeyUnavailable
from guanxing.domain.save.envelope import SaveEnvelope
from guanxing.domain.save.format import detect_format, parse_new, parse_old
from guanxing.domain.save.types import SaveFormatType
from guanxing.shared.progress import ProgressSink

from ..ports.executor import CrackExecutor, Hit
from .memory_scanner import MemoryScanner
from .process_locator import ProcessLocator


class KeyCracker:
    """把"候选池"变成"能用的钥匙"。"""

    def __init__(
        self,
        *,
        executor: CrackExecutor,
        xxtea: XXTEACrypto,
        envelope: SaveEnvelope,
        locator: ProcessLocator,
        scanner: MemoryScanner,
        progress: ProgressSink,
    ) -> None:
        self.executor = executor
        self.xxtea = xxtea
        self.envelope = envelope
        self.locator = locator
        self.scanner = scanner
        self.progress = progress

    # ────────────────────── 外层密钥 ──────────────────────
    def outer_key(self, content: str, *, runtime: str = 'android') -> str:
        """爆破 dat.db content 的外层密钥；失败抛 ``OuterKeyUnavailable``。"""
        if detect_format(content) is not SaveFormatType.NEW:
            raise OuterKeyUnavailable(
                '这是初版存档，没有外层加密，不需要爆破',
                command='mem', retry_with_outer_key=False,
            )
        _, cipher = parse_new(content)
        self.progress.step(
            '外层密钥',
            '本地没有，改从进程内存里找（需游戏在运行、且登录的是同一账号）',
        )
        _, pid = self.locator.find()

        cands = self.scanner.scan(pid, runtime)
        pool = cand_mod.normalize(cands.strings)
        if not cands.anchored and not cands.psw_anchored:
            # 锚点全空 = 内存里没有游戏的密钥痕迹，多半还没进角色界面 / 没点过保存。
            # 这时候只能拿通用可打印串硬试，几十万条各解一次，几乎不可能命中。
            self.progress.warn(
                '进程内存里没有游戏的密钥锚点（还没进角色界面或挂机太久？）'
                '只能拿通用字符串进行硬试，不一定能解出。'
                )
            self.progress.warn(
                '可以考虑 Ctrl + C 结束当前进程，先重启游戏进入角色界面、点一次保存，再重试'
            )
        self.progress.step('爆破外层密钥', f'密文 {len(cipher):,} B / 候选 {len(pool):,} 条')
        hits = self._crack(cipher, pool, '爆破外层密钥')
        key = self._verify_outer(cipher, hits)
        if not key:
            raise OuterKeyUnavailable(
                f'扫了进程内存（{len(pool):,} 条候选）仍没解出外层密钥',
                tried=len(pool), command='mem', retry_with_outer_key=False,
            )
        return key

    def _verify_outer(self, cipher: bytes, hits: list[Hit]) -> str:
        """预言机只给"可能是"；能解出可识别格式的 content 才算真的。"""
        for key, _length_word, _head in hits:
            plain = self.xxtea.decrypt(cipher, key)
            if not plain:
                continue
            text = plain.decode('ascii', 'ignore')
            if detect_format(text) is None:
                continue
            try:
                parse_old(text)
            except Exception:  # 解出来但不是存档就换下一个
                continue
            return key.decode('latin-1').rstrip('\x00')
        return ''

    # ────────────────────── 内层密钥 ──────────────────────
    def inner_key(self, version: str, body: bytes, *, runtime: str = 'android') -> str:
        """爆破完整内层密钥（psw + 后缀），必须返回整把钥匙，只留 psw 会丢掉刚锚定的后缀。

        Args:
            version: 8 位版本号，只用于日志与进度文案。
            body: 内层 XXTEA 密文。
            runtime: 当前平台，决定渠道后缀的尝试优先级。
        Returns:
            16 字符完整密钥；扫描跑了但没命中时为空串。
        Raises:
            InnerKeyUnavailable: 扫描压根没法开始（游戏没在跑或没有可读内存）。
        """
        from guanxing.domain.errors import InnerKeyUnavailable

        try:
            _package, pid = self.locator.find()
            cands = self.scanner.scan(pid, runtime)
        except OuterKeyUnavailable as exc:
            # 不能悄悄返回空串：上层会把它当成"表里没有"，把用户引去抓包
            raise InnerKeyUnavailable(exc.reason) from exc

        suffixes = self.envelope.suffixes(runtime)
        pool = cand_mod.normalize(
            [c for c in cand_mod.expand_suffixes(cands.inner_pool(), suffixes)
             if len(c) == cand_mod.KEY_LEN]
        )
        self.progress.step(
            '爆破内层密钥',
            f'版本 {version} / 候选 {len(pool):,} 条'
            f'（{len(suffixes)} 个渠道后缀、{len(cands.psw_anchored):,} 个 psw 锚定点）',
        )
        for key, _length_word, _head in self._crack(body, pool, '爆破内层密钥'):
            data, used = self.envelope.try_inner(body, [key])
            if data is None or used is None:
                continue
            raw = used.decode('latin-1') if isinstance(used, bytes) else str(used)
            return raw[:cand_mod.KEY_LEN]
        return ''

    # ────────────────────── 公共 ──────────────────────
    def _crack(self, target: bytes, pool: list[bytes], label: str) -> list[Hit]:
        """跑一遍爆破，进度按时间节流上报。

        Args:
            target: 待解密的密文。
            pool: 候选钥匙。
            label: 进度条与步骤行的名字。
        Returns:
            预言机命中的候选列表。
        """
        handle = self.progress.task(len(pool), label, unit='条')
        done_before = [0]
        elapsed_before = [0.0]
        try:
            def _tick(done: int, total: int, elapsed: float) -> None:
                step = done - done_before[0]
                gap = elapsed - elapsed_before[0]
                done_before[0], elapsed_before[0] = done, elapsed
                # 用瞬时速率：平均速率会把"刚开始很慢"一直挂在屏幕上
                handle.update(step, f'实时 {step / gap:,.0f} 条/秒' if gap > 0 else '')
                

            hits = self.executor.crack(target, pool, progress=_tick)
        finally:
            handle.close()
        self.progress.step(label, f'预言机命中 {len(hits)} 个候选')
        return hits


__all__ = ['KeyCracker']
