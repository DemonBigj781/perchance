# perchance — fork by Nova

A fork of [eeemoon/perchance](https://github.com/eeemoon/perchance) with autonomous Cloudflare Turnstile bypass via [Camoufox](https://camoufox.com/).

## Why this fork?

As of mid-2026, Perchance tightened Cloudflare protection on the `image-generation.perchance.org/api/verifyUser` endpoint. The upstream library launches headless Chromium and navigates directly to `verifyUser` to scrape the `userKey`. This no longer works — the API now returns `token_required` unless a valid Cloudflare Turnstile token is presented.

The token is only issued through Turnstile widgets embedded inside the generator iframe on `perchance.org/ai-text-to-image-generator`. Headless Chromium is fingerprinted by Cloudflare and cannot pass.

## What changed?

### Browser engine: Chromium → Camoufox

Replaced Playwright Chromium with **Camoufox**, a patched Firefox fork for anti-detection. Camoufox passes Cloudflare fingerprinting natively, including Turnstile challenges.

- `headless="virtual"` runs Firefox under Xvfb (no display needed)
- `disable_coop=True` allows cross-origin Turnstile iframe interaction
- `i_know_what_im_doing=True` suppresses the COOP warning

### Authentication flow: direct scrape → iframe interception

**Original:** navigate to `verifyUser`, scrape `userKey` from JSON response.

**New flow:**

1. Navigate to `perchance.org/ai-text-to-image-generator`
2. Wait 15s for generator iframe to load
3. Inject dummy prompt into iframe textarea via JavaScript
4. Click Generate button via JavaScript
5. Perchance loads verification embeds that solve Turnstile internally
6. Perchance calls `verifyUser?token=***` which returns the `userKey`
7. We intercept that response and extract the `userKey`
8. `userKey` is used for direct `POST /api/generate` calls

### New dependency

```bash
pip install 'camoufox[geoip]'
python -m camoufox fetch
```

Requires Xvfb for headless operation:
```bash
# Arch Linux
sudo pacman -S xorg-server-xvfb
```

## Usage

API is unchanged from upstream:

```python
import asyncio
from perchance import ImageGenerator

async def main():
    gen = ImageGenerator()
    try:
        result = await gen.image("a cat on a windowsill", shape="square")
        await result.save("cat.webp")
    finally:
        await gen.close()

asyncio.run(main())
```

## Files changed

- **`perchance/generator.py`** — complete rewrite. Camoufox-only browser launch, response interception for `userKey` extraction.
- **`perchance/imagegenerator.py`** — updated to use `Generator._ensure_user_key()` for authentication. Otherwise unchanged.
- **`perchance/utils.py`** — unchanged.

## Compatibility

- Python 3.12+
- Linux x86_64 (Camoufox binary availability)
- Requires Xvfb for headless operation

## License

MIT (inherited from upstream)
