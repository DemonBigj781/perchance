from __future__ import annotations

import asyncio
import random
import re
from typing import Self

from camoufox.async_api import AsyncCamoufox


class Generator:
    """
    Browser context manager using Camoufox.

    Authentication strategy:
    1. Fast path: navigate directly to verifyUser. If Cloudflare
       remembers this IP (from a recent Turnstile pass), the userKey
       is returned immediately (under 1 second).
    2. Fallback: if the fast path fails (token_required), load the
       full Perchance generator page, inject a prompt, click Generate
       to trigger the Turnstile challenge, and intercept the
       verifyUser?token=*** response to extract the userKey.
    """

    def __init__(self) -> None:
        super().__init__()
        self._camoufox: AsyncCamoufox | None = None
        self._browser = None
        self._context = None

    async def __aenter__(self) -> Self:
        return self

    async def __aexit__(self, exc_type, exc_value, traceback) -> None:
        await self.close()

    async def _start(self) -> None:
        """Launch Camoufox if not already running."""
        if self._context:
            return
        self._camoufox = AsyncCamoufox(
            headless="virtual",
            disable_coop=True,
            i_know_what_im_doing=True,
        )
        self._browser = await self._camoufox.__aenter__()
        self._context = await self._browser.new_context()

    async def _ensure_user_key(self) -> str | None:
        """
        Return a valid Perchance userKey.

        Tries the fast path first (direct verifyUser navigation).
        Falls back to the full Turnstile flow if Cloudflare requires
        a fresh challenge.
        """
        await self._start()

        # Fast path: direct navigation to verifyUser
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

        # Fallback: full Turnstile flow via Perchance generator page
        return await self._get_key_via_turnstile()

    async def _get_key_via_turnstile(self) -> str | None:
        """
        Load the Perchance AI image generator page, inject a dummy
        prompt, click Generate, and intercept the verifyUser?token=***
        response to extract the userKey.
        """
        key_holder = {"key": None}

        async with await self._context.new_page() as page:
            async def on_response(res):
                if key_holder["key"]:
                    return
                if "verifyUser" in res.url:
                    try:
                        body = await res.text()
                        m = re.search(r'"userKey":"([^"]+)"', body)
                        if m:
                            key_holder["key"] = m.group(1)
                    except Exception:
                        pass

            page.on("response", lambda r: asyncio.create_task(on_response(r)))

            await page.goto(
                "https://perchance.org/ai-text-to-image-generator",
                wait_until="networkidle",
                timeout=60000,
            )
            await page.wait_for_timeout(15000)

            # Find the generator output iframe
            target = None
            for f in page.frames:
                if ("perchance.org" in f.url
                        and "ai-text-to-image-generator" in f.url
                        and f.url != page.url):
                    target = f
                    break

            if not target:
                return None

            # Inject a dummy prompt to enable the Generate button
            await target.evaluate(
                '() => { const ta = document.querySelector("textarea");'
                ' if (ta) { ta.value = "test";'
                ' ta.dispatchEvent(new Event("input", {bubbles: true}));'
                ' ta.dispatchEvent(new Event("change", {bubbles: true})); } }'
            )
            await page.wait_for_timeout(1000)

            # Click Generate to trigger the Turnstile verification flow
            await target.evaluate(
                '() => { const btns = document.querySelectorAll("button");'
                ' for (const b of btns) {'
                ' if (b.textContent.toLowerCase().includes("generate"))'
                ' { b.click(); return; } } }'
            )

            # Wait for Turnstile to solve and userKey to arrive
            for _ in range(60):
                if key_holder["key"]:
                    break
                await page.wait_for_timeout(1000)

            return key_holder["key"]

    async def close(self) -> None:
        """Close the browser and release all resources."""
        if self._context:
            try:
                await self._context.close()
            except Exception:
                pass
        if self._camoufox:
            try:
                await self._camoufox.__aexit__(None, None, None)
            except Exception:
                pass
            self._camoufox = None
        self._browser = None
        self._context = None
