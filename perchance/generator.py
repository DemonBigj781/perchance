from __future__ import annotations

import asyncio
import re
from typing import Self

from camoufox.async_api import AsyncCamoufox
from playwright.async_api import Browser, BrowserContext


class Generator:
    """Browser context manager using Camoufox (stealth Firefox)."""

    def __init__(self) -> None:
        super().__init__()
        self._camoufox: AsyncCamoufox | None = None
        self._browser: Browser | None = None
        self._context: BrowserContext | None = None

    async def __aenter__(self) -> Self:
        return self

    async def __aexit__(self, exc_type, exc_value, traceback) -> None:
        await self.close()

    async def _start(self) -> None:
        """Launch the Camoufox stealth browser."""
        if self._context:
            return
        self._camoufox = AsyncCamoufox(headless="virtual", disable_coop=True, i_know_what_im_doing=True)
        self._browser = await self._camoufox.__aenter__()
        self._context = await self._browser.new_context()

    async def _ensure_user_key(self) -> str | None:
        key_holder = {"key": None}
        async with await self._context.new_page() as page:
            async def on_response(res):
                if key_holder["key"]:
                    return
                if 'verifyUser' in res.url:
                    try:
                        body = await res.text()
                        m = re.search(r'"userKey":"([^"]+)"', body)
                        if m:
                            key_holder["key"] = m.group(1)
                    except Exception:
                        pass
            page.on('response', lambda r: asyncio.create_task(on_response(r)))
            await page.goto('https://perchance.org/ai-text-to-image-generator', wait_until='networkidle', timeout=60000)
            await page.wait_for_timeout(15000)
            target = None
            for f in page.frames:
                if 'perchance.org' in f.url and 'ai-text-to-image-generator' in f.url and f.url != page.url:
                    target = f
                    break
            if not target:
                return None
            await target.evaluate('() => { const ta = document.querySelector("textarea"); if (ta) { ta.value = "test"; ta.dispatchEvent(new Event("input", {bubbles: true})); ta.dispatchEvent(new Event("change", {bubbles: true})); } }')
            await page.wait_for_timeout(1000)
            await target.evaluate('() => { const btns = document.querySelectorAll("button"); for (const b of btns) { if (b.textContent.includes("generate")) { b.click(); return; } } }')
            for _ in range(60):
                if key_holder["key"]:
                    break
                await page.wait_for_timeout(1000)
            return key_holder["key"]

    async def close(self) -> None:
        if self._context:
            try: await self._context.close()
            except Exception: pass
        if self._camoufox:
            try: await self._camoufox.__aexit__(None, None, None)
            except Exception: pass
            self._camoufox = None
        self._browser = None
        self._context = None
