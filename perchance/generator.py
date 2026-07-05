from __future__ import annotations

import asyncio
import random
import re
from typing import Self

from playwright.async_api import Browser, BrowserContext, async_playwright, Playwright

from .utils import generate_user_agent


class Generator:
    """Browser context manager with fast-path and Camoufox fallback."""

    def __init__(self) -> None:
        super().__init__()
        self._pw: Playwright | None = None
        self._browser: Browser | None = None
        self._context: BrowserContext | None = None
        self._is_camoufox: bool = False
        self._camoufox_cm = None

    async def __aenter__(self) -> Self:
        return self

    async def __aexit__(self, exc_type, exc_value, traceback) -> None:
        await self.close()

    async def _try_fast_start(self) -> bool:
        """Try regular Playwright Chromium (fast path)."""
        try:
            if not self._pw:
                self._pw = await async_playwright().start()
            if not self._browser:
                self._browser = await self._pw.chromium.launch(
                    headless=True,
                    args=[
                        "--disable-blink-features=AutomationControlled",
                        "--no-sandbox",
                        "--disable-dev-shm-usage",
                        "--disable-infobars",
                        "--window-size=1920,1080",
                    ],
                )
            if not self._context:
                self._context = await self._browser.new_context(
                    user_agent=generate_user_agent(),
                    viewport={"width": 1920, "height": 1080},
                    locale="en-US",
                    timezone_id="America/New_York",
                )
                await self._context.add_init_script(
                    "Object.defineProperty(navigator, 'webdriver', {get: () => undefined})"
                )
            self._is_camoufox = False
            return True
        except Exception:
            return False

    async def _try_camoufox_start(self) -> bool:
        """Fall back to Camoufox stealth browser."""
        try:
            from camoufox.async_api import AsyncCamoufox
            await self._cleanup_playwright()
            self._camoufox_cm = AsyncCamoufox(
                headless="virtual",
                disable_coop=True,
                i_know_what_im_doing=True,
            )
            self._browser = await self._camoufox_cm.__aenter__()
            self._context = await self._browser.new_context()
            self._is_camoufox = True
            return True
        except Exception:
            return False

    async def _start(self) -> None:
        """Start browser. Fast path first, Camoufox fallback."""
        if self._context:
            return
        if await self._try_fast_start():
            return
        if await self._try_camoufox_start():
            return
        raise RuntimeError("Failed to start browser (both fast and Camoufox paths)")

    async def _ensure_user_key(self) -> str | None:
        """
        Get a valid userKey.
        1. Fast path: navigate directly to verifyUser and scrape userKey.
        2. Camoufox path: load Perchance, trigger generation, intercept verifyUser?token= response.
        """
        if not self._is_camoufox:
            try:
                async with await self._context.new_page() as page:
                    await page.goto(
                        f"https://image-generation.perchance.org/api/verifyUser"
                        f"?thread=0&__cacheBust={random.random()}",
                        wait_until="networkidle",
                        timeout=15000,
                    )
                    content = await page.content()
                    match = re.search(r'"userKey":"([^"]+)"', content)
                    if match:
                        return match.group(1)
            except Exception:
                pass
            # Fast path failed, upgrade to Camoufox
            if not await self._try_camoufox_start():
                return None

        return await self._get_user_key_via_camoufox()

    async def _get_user_key_via_camoufox(self) -> str | None:
        """
        Use Camoufox to load the Perchance generator page, inject a prompt,
        click generate, and intercept the verifyUser?token= response to extract userKey.
        """
        key_holder = {"key": None}

        async with await self._context.new_page() as page:
            # Intercept responses to capture verifyUser?token=* which contains userKey
            async def on_response(res):
                if key_holder["key"]:
                    return
                if "verifyUser" in res.url and "token=" in res.url:
                    try:
                        body = await res.text()
                        match = re.search(r'"userKey":"([^"]+)"', body)
                        if match:
                            key_holder["key"] = match.group(1)
                    except Exception:
                        pass
                # Also check verifyUser responses without token (polling responses)
                if "verifyUser" in res.url and "token=" not in res.url:
                    try:
                        body = await res.text()
                        match = re.search(r'"userKey":"([^"]+)"', body)
                        if match:
                            key_holder["key"] = match.group(1)
                    except Exception:
                        pass

            page.on("response", lambda r: asyncio.create_task(on_response(r)))

            await page.goto(
                "https://perchance.org/ai-text-to-image-generator",
                wait_until="networkidle",
                timeout=60000,
            )
            # Wait for page and iframe to fully load
            await page.wait_for_timeout(15000)

            # Find the generator iframe
            target = None
            for f in page.frames:
                if "perchance.org" in f.url and "ai-text-to-image-generator" in f.url and f.url != page.url:
                    target = f
                    break

            if not target:
                return None

            # Inject a dummy prompt and click generate to trigger the verification flow
            await target.evaluate(
                "() => {"
                '  const ta = document.querySelector("textarea");'
                '  if (ta) {'
                '    ta.value = "test";'
                '    ta.dispatchEvent(new Event("input", {bubbles: true}));'
                '    ta.dispatchEvent(new Event("change", {bubbles: true}));'
                "  }"
                "}"
            )
            await page.wait_for_timeout(1000)

            await target.evaluate(
                "() => {"
                '  const btns = document.querySelectorAll("button");'
                "  for (const b of btns) {"
                '    if (b.textContent.includes("generate")) { b.click(); return; }'
                "  }"
                "}"
            )

            # Wait for the verification flow to complete (token solve + userKey extraction)
            for _ in range(60):  # up to 60 seconds
                if key_holder["key"]:
                    break
                await page.wait_for_timeout(1000)

            return key_holder["key"]

    async def _cleanup_playwright(self) -> None:
        if self._context:
            try: await self._context.close()
            except Exception: pass
            self._context = None
        if self._browser:
            try: await self._browser.close()
            except Exception: pass
            self._browser = None
        if self._pw:
            try: await self._pw.stop()
            except Exception: pass
            self._pw = None

    async def close(self) -> None:
        if self._context:
            try: await self._context.close()
            except Exception: pass
        if self._browser and not self._is_camoufox:
            try: await self._browser.close()
            except Exception: pass
        if self._pw:
            try: await self._pw.stop()
            except Exception: pass
        if self._camoufox_cm:
            try: await self._camoufox_cm.__aexit__(None, None, None)
            except Exception: pass
            self._camoufox_cm = None
