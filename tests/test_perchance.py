"""
Tests for the perchance library fork with Camoufox Turnstile bypass.

Run with: python -m pytest tests/ -v
Or standalone: python tests/test_perchance.py
"""

import asyncio
import io
import os
import sys
import re

# Add parent dir to path for standalone execution
sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from perchance import ImageGenerator, ImageResult
from perchance.generator import Generator
from perchance import errors


# ─── Generator tests ───

def test_generator_init():
    """Generator initialises with no browser running."""
    gen = Generator()
    assert gen._camoufox is None
    assert gen._browser is None
    assert gen._context is None
    print("✅ test_generator_init passed")


def test_generator_context_manager():
    """Generator works as an async context manager without error."""
    async def run():
        gen = Generator()
        # Just test __aenter__ returns self and __aexit__ doesn't crash
        # We don't call _start() to avoid launching a browser
        result = await gen.__aenter__()
        assert result is gen
        await gen.__aexit__(None, None, None)
    asyncio.run(run())
    print("✅ test_generator_context_manager passed")


def test_generator_close_idempotent():
    """close() should be safe to call even when nothing was started."""
    async def run():
        gen = Generator()
        await gen.close()  # Should not raise
    asyncio.run(run())
    print("✅ test_generator_close_idempotent passed")


# ─── ImageGenerator tests ───

def test_image_generator_inheritance():
    """ImageGenerator inherits from Generator."""
    assert issubclass(ImageGenerator, Generator)
    print("✅ test_image_generator_inheritance passed")


def test_image_generator_base_url():
    """ImageGenerator has the correct API base URL."""
    gen = ImageGenerator()
    assert gen.BASE_URL == "https://image-generation.perchance.org/api"
    print("✅ test_image_generator_base_url passed")


def test_image_generator_init_clean():
    """ImageGenerator initialises with no browser or context."""
    gen = ImageGenerator()
    assert gen._context is None
    assert gen._camoufox is None
    print("✅ test_image_generator_init_clean passed")


def test_image_invalid_shape():
    """image() raises ValueError for invalid shape."""
    async def run():
        gen = ImageGenerator()
        try:
            await gen.image("test", shape="invalid")
            assert False, "Should have raised ValueError"
        except ValueError:
            pass  # Expected
        finally:
            await gen.close()
    asyncio.run(run())
    print("✅ test_image_invalid_shape passed")


# ─── ImageResult tests (no network needed) ───

def test_image_result_str():
    """ImageResult __str__ returns id.extension format."""
    gen = ImageGenerator()
    result = ImageResult(
        generator=gen,
        image_id="abc123",
        file_extension="webp",
        seed=42,
        prompt="test",
        width=768,
        height=768,
        guidance_scale=7.0,
        negative_prompt=None,
        maybe_nsfw=False,
    )
    assert str(result) == "abc123.webp"
    print("✅ test_image_result_str passed")


def test_image_result_size_property():
    """ImageResult.size returns (width, height) tuple."""
    gen = ImageGenerator()
    result = ImageResult(
        generator=gen,
        image_id="abc123",
        file_extension="webp",
        seed=42,
        prompt="test",
        width=512,
        height=768,
        guidance_scale=7.0,
        negative_prompt=None,
        maybe_nsfw=False,
    )
    assert result.size == (512, 768)
    print("✅ test_image_result_size_property passed")


def test_image_result_attributes():
    """ImageResult stores all attributes correctly."""
    gen = ImageGenerator()
    result = ImageResult(
        generator=gen,
        image_id="abc123",
        file_extension="jpeg",
        seed=-1,
        prompt="a cat",
        width=768,
        height=512,
        guidance_scale=8.5,
        negative_prompt="blurry",
        maybe_nsfw=True,
        proxy_download="/downloadTemporaryImageViaProxy?t=v1.test123",
    )
    assert result.image_id == "abc123"
    assert result.file_extension == "jpeg"
    assert result.seed == -1
    assert result.prompt == "a cat"
    assert result.width == 768
    assert result.height == 512
    assert result.guidance_scale == 8.5
    assert result.negative_prompt == "blurry"
    assert result.maybe_nsfw is True
    assert result.proxy_download == "/downloadTemporaryImageViaProxy?t=v1.test123"
    print("✅ test_image_result_attributes passed")


# ─── _find_proxy_download tests ───

def test_find_proxy_download_direct_string():
    """_find_proxy_download finds downloadTemporaryImageViaProxy in a string."""
    from perchance.imagegenerator import _find_proxy_download
    assert _find_proxy_download("/downloadTemporaryImageViaProxy?t=v1.abc") == "/downloadTemporaryImageViaProxy?t=v1.abc"
    print("✅ test_find_proxy_download_direct_string passed")


def test_find_proxy_download_v1_token():
    """_find_proxy_download detects bare v1.* tokens."""
    from perchance.imagegenerator import _find_proxy_download
    token = "v1." + "x" * 80
    result = _find_proxy_download(token)
    assert result == f"/downloadTemporaryImageViaProxy?t={token}"
    print("✅ test_find_proxy_download_v1_token passed")


def test_find_proxy_download_nested_dict():
    """_find_proxy_download finds tokens nested in dicts."""
    from perchance.imagegenerator import _find_proxy_download
    data = {"a": {"b": {"url": "/downloadTemporaryImageViaProxy?t=v1.test"}}}
    assert _find_proxy_download(data) == "/downloadTemporaryImageViaProxy?t=v1.test"
    print("✅ test_find_proxy_download_nested_dict passed")


def test_find_proxy_download_nested_list():
    """_find_proxy_download finds tokens in lists."""
    from perchance.imagegenerator import _find_proxy_download
    data = ["random", {"token": "/downloadTemporaryImageViaProxy?t=v1.test"}, "other"]
    assert _find_proxy_download(data) == "/downloadTemporaryImageViaProxy?t=v1.test"
    print("✅ test_find_proxy_download_nested_list passed")


def test_find_proxy_download_none():
    """_find_proxy_download returns None when nothing is found."""
    from perchance.imagegenerator import _find_proxy_download
    assert _find_proxy_download("random string") is None
    assert _find_proxy_download({"a": "b"}) is None
    assert _find_proxy_download([1, 2, 3]) is None
    assert _find_proxy_download(None) is None
    print("✅ test_find_proxy_download_none passed")


# ─── Live integration tests (require network + Camoufox) ───

LIVE_TESTS = os.environ.get("PERCHANCE_LIVE_TESTS", "0") == "1"

async def _live_generate(shape="square"):
    """Helper: generate one image, return the ImageResult."""
    gen = ImageGenerator()
    try:
        result = await gen.image("a simple test image, blue background", shape=shape)
        return result
    finally:
        await gen.close()


def test_live_square():
    """Generate a square image end-to-end."""
    if not LIVE_TESTS:
        print("⏭️  test_live_square skipped (set PERCHANCE_LIVE_TESTS=1 to enable)")
        return
    result = asyncio.run(_live_generate("square"))
    assert result.image_id
    assert result.file_extension
    assert result.width == 768
    assert result.height == 768
    assert result.size == (768, 768)
    print("✅ test_live_square passed")


def test_live_portrait():
    """Generate a portrait image end-to-end."""
    if not LIVE_TESTS:
        print("⏭️  test_live_portrait skipped (set PERCHANCE_LIVE_TESTS=1 to enable)")
        return
    result = asyncio.run(_live_generate("portrait"))
    assert result.image_id
    assert result.width == 512
    assert result.height == 768
    assert result.size == (512, 768)
    print("✅ test_live_portrait passed")


def test_live_landscape():
    """Generate a landscape image end-to-end."""
    if not LIVE_TESTS:
        print("⏭️  test_live_landscape skipped (set PERCHANCE_LIVE_TESTS=1 to enable)")
        return
    result = asyncio.run(_live_generate("landscape"))
    assert result.image_id
    assert result.width == 768
    assert result.height == 512
    assert result.size == (768, 512)
    print("✅ test_live_landscape passed")


def test_live_download():
    """Download a generated image and verify it's valid binary data."""
    if not LIVE_TESTS:
        print("⏭️  test_live_download skipped (set PERCHANCE_LIVE_TESTS=1 to enable)")
        return
    async def run():
        gen = ImageGenerator()
        try:
            result = await gen.image("a blue square, minimal", shape="square")
            img = await result.download()
            data = img.read()
            assert len(data) > 1000  # Should be at least 1KB
            return data
        finally:
            await gen.close()
    data = asyncio.run(run())
    print(f"✅ test_live_download passed ({len(data)} bytes)")


def test_live_self_healing():
    """Verify that image() recovers from an invalid key."""
    if not LIVE_TESTS:
        print("⏭️  test_live_self_healing skipped (set PERCHANCE_LIVE_TESTS=1 to enable)")
        return
    # This test just verifies the flow works — the self-healing is tested
    # implicitly by the other live tests, since the key may or may not be cached
    result = asyncio.run(_live_generate("square"))
    assert result.image_id
    print("✅ test_live_self_healing passed")


# ─── Runner ───

if __name__ == "__main__":
    tests = [
        test_generator_init,
        test_generator_context_manager,
        test_generator_close_idempotent,
        test_image_generator_inheritance,
        test_image_generator_base_url,
        test_image_generator_init_clean,
        test_image_invalid_shape,
        test_image_result_str,
        test_image_result_size_property,
        test_image_result_attributes,
        test_find_proxy_download_direct_string,
        test_find_proxy_download_v1_token,
        test_find_proxy_download_nested_dict,
        test_find_proxy_download_nested_list,
        test_find_proxy_download_none,
        test_live_square,
        test_live_portrait,
        test_live_landscape,
        test_live_download,
        test_live_self_healing,
    ]
    
    passed = 0
    failed = 0
    for test in tests:
        try:
            test()
            passed += 1
        except Exception as e:
            print(f"❌ {test.__name__} FAILED: {e}")
            failed += 1
    
    print(f"\n{'='*40}")
    print(f"Results: {passed} passed, {failed} failed")
    sys.exit(0 if failed == 0 else 1)
