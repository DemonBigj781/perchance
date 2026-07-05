from __future__ import annotations

import base64
import io
import random
from typing import Any, Literal
from urllib.parse import urljoin

import aiofiles

from . import errors
from .generator import Generator


def _find_proxy_download(value: Any) -> str | None:
    """Find the proxy image download path or token in a generate response."""
    if isinstance(value, str):
        if "downloadTemporaryImageViaProxy" in value:
            return value
        if value.startswith("v1.") and len(value) > 80:
            return f"/downloadTemporaryImageViaProxy?t={value}"
        return None
    if isinstance(value, dict):
        for item in value.values():
            result = _find_proxy_download(item)
            if result:
                return result
        return None
    if isinstance(value, list):
        for item in value:
            result = _find_proxy_download(item)
            if result:
                return result
    return None


class ImageResult:
    """Image generation result."""

    def __init__(
        self,
        *,
        generator: "ImageGenerator",
        image_id: str,
        file_extension: str,
        seed: int,
        prompt: str,
        width: int,
        height: int,
        guidance_scale: float,
        negative_prompt: str | None,
        maybe_nsfw: bool,
        proxy_download: str | None = None,
    ) -> None:
        self._generator = generator
        self.image_id = image_id
        self.file_extension = file_extension
        self.seed = seed
        self.prompt = prompt
        self.width = width
        self.height = height
        self.guidance_scale = guidance_scale
        self.negative_prompt = negative_prompt
        self.maybe_nsfw = maybe_nsfw
        self.proxy_download = proxy_download

    def __str__(self) -> str:
        return f"{self.image_id}.{self.file_extension}"

    @property
    def size(self) -> tuple[int, int]:
        return self.width, self.height

    async def download(self) -> io.BytesIO:
        """Download the generated image."""
        urls = []
        if self.proxy_download:
            urls.append(urljoin(self._generator.BASE_URL + "/", self.proxy_download))
        urls.append(
            f"{self._generator.BASE_URL}/downloadTemporaryImage"
            f"?imageId={self.image_id}"
        )
        async with await self._generator._context.new_page() as page:
            await page.goto(
                f"{self._generator.BASE_URL}/verifyUser"
                f"?thread=0"
                f"&__cacheBust={random.random()}"
            )
            response_data = await page.evaluate(
                "async (urls) => {"
                "  const failures = [];"
                "  for (const url of urls) {"
                "    const response = await fetch(url);"
                "    if (!response.ok) { failures.push(response.status + ' ' + url); continue; }"
                "    const blob = await response.blob();"
                "    const base64 = await new Promise(resolve => {"
                "      const reader = new FileReader();"
                "      reader.onloadend = () => resolve(reader.result.split(',')[1]);"
                "      reader.readAsDataURL(blob);"
                "    });"
                "    return { ok: true, data: base64 };"
                "  }"
                "  return { ok: false, failures };"
                "}",
                urls,
            )
            if not response_data["ok"]:
                raise errors.ConnectionError(
                    f"Failed to download image: {response_data['failures']}"
                )
            data = base64.b64decode(response_data["data"])
            return io.BytesIO(data)

    async def save(self, filename: str | None = None) -> None:
        """Download and save the image to disk."""
        file = filename or f"{self.image_id}.{self.file_extension}"
        async with aiofiles.open(file, "wb") as f:
            img = await self.download()
            await f.write(img.read())


class ImageGenerator(Generator):
    """AI image generator powered by Perchance."""

    BASE_URL = "https://image-generation.perchance.org/api"

    def __init__(self) -> None:
        super().__init__()

    async def _generate_with_key(self, key: str, resolution: str, prompt: str,
                                  negative_prompt: str | None, seed: int,
                                  guidance_scale: float) -> dict:
        """Make the actual API call. Returns the JSON response."""
        await self._start()
        async with await self._context.new_page() as page:
            await page.goto(
                f"{self.BASE_URL}/verifyUser"
                f"?thread=0"
                f"&__cacheBust={random.random()}"
            )
            url = (
                f"{self.BASE_URL}/generate"
                f"?userKey={key}"
                f"&requestId=aiImageCompletion{random.randint(0, 2**30)}"
                f"&__cacheBust={random.random()}"
            )
            body = {
                "generatorName": "ai-image-generator",
                "channel": "ai-text-to-image-generator",
                "subChannel": "public",
                "prompt": prompt,
                "negativePrompt": negative_prompt or "",
                "seed": seed,
                "resolution": resolution,
                "guidanceScale": guidance_scale,
            }
            return await page.evaluate(
                "async ({ url, body }) => {"
                "  const response = await fetch(url, {"
                "    method: 'POST',"
                "    headers: { 'Content-Type': 'application/json' },"
                "    body: JSON.stringify(body)"
                "  });"
                "  return await response.json();"
                "}",
                {"url": url, "body": body},
            )

    async def image(
        self,
        prompt: str,
        *,
        negative_prompt: str | None = None,
        seed: int = -1,
        shape: Literal["portrait", "square", "landscape"] = "square",
        guidance_scale: float = 7.0,
    ) -> ImageResult:
        """
        Generate an image.

        Self-healing: if the userKey is rejected by the API, a fresh
        key is obtained (which may trigger the full Turnstile flow if
        Cloudflare clearance has expired) and the request is retried.
        """
        if shape == "portrait":
            resolution = "512x768"
        elif shape == "square":
            resolution = "768x768"
        elif shape == "landscape":
            resolution = "768x512"
        else:
            raise ValueError(f"Invalid shape: {shape}")

        await self._start()

        for attempt in range(2):
            key = await self._ensure_user_key()
            if not key:
                raise errors.AuthenticationError("Failed to retrieve user key")

            response = await self._generate_with_key(
                key, resolution, prompt, negative_prompt, seed, guidance_scale
            )

            # Check if the key was rejected (no imageId = auth failure)
            if "imageId" not in response:
                if attempt == 0:
                    continue
                raise errors.AuthenticationError(
                    f"User key rejected after retry. Response: {response}"
                )

            return ImageResult(
                generator=self,
                image_id=response["imageId"],
                file_extension=response["fileExtension"],
                seed=response["seed"],
                prompt=response["prompt"],
                width=response["width"],
                height=response["height"],
                guidance_scale=response["guidanceScale"],
                negative_prompt=response["negativePrompt"],
                maybe_nsfw=response["maybeNsfw"],
                proxy_download=_find_proxy_download(response),
            )

        raise errors.AuthenticationError("Failed to generate image after key refresh")
