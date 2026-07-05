from __future__ import annotations

import asyncio
import json
import os
import random
import re
import time
from typing import Self

from camoufox.async_api import AsyncCamoufox


# Persist the userKey to disk so it survives across process restarts
_KEY_FILE = os.path.join(os.path.expanduser("~"), ".openclaw", "agents", "main", "workspace", ".perchance_key")


class Generator:
    """
    Browser context manager using Camoufox (stealth Firefox).

    The Perchance userKey is persisted to disk so it survives across
    process restarts. The key is only refreshed when the API rejects
    it (self-healing), not on a timer.
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

    def _load_cached_key(self) -> str | None:
        """Load the persisted userKey from disk."""
        try:
            if os.path.exists(_KEY_FILE):
                with open(_KEY_FILE, "r") as f:
                    data = json.load(f)
                    return data.get("key")
        except Exception:
            pass
        return None

    def _save_cached_key(self, key: str) -> None:
        """Persist the userKey to disk."""
        try:
            os.makedirs(os.path.dirname(_KEY_FILE), exist_ok=True)
            with open(_KEY_FILE, "w") as f:
                json.dump({"key": key}, f)
        except Exception:
            pass

    @staticmethod
    def _invalidate_key() -> None:
        """Delete the persisted key (call when API rejects it)."""
        try:
            if os.path.exists(_KEY_FILE):
                os.remove(_KEY_FILE)
        except Exception:
            pass

    async def _ensure_user_key(self) -> str | None:
        """
        Return a valid userKey.

        If a key is persisted on disk, return it immediately (fast path).
        Only launch Camoufox and solve Turnstile when there is no key.
        """
        cached = self._load_cached_key()
        if cached:
            return cached

        # Need to obtain a new key via the full Turnstile flow
        await self._start()

        key_holder = {"key": None}

        async with await self._context.new_page() as page:
            # Intercept verifyUser responses to capture userKey
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
            # Wait for the page and generator iframe to fully load
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

            if key_holder["key"]:
                self._save_cached_key(key_holder["key"])
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
