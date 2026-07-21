/**
 * Perchance TypeScript API
 *
 * AI image and text generation via Perchance.org with Cloudflare
 * Turnstile bypass using Camoufox/Playwright.
 */

// Errors
export { PerchanceError, ConnectionError, AuthenticationError, RateLimitError } from "./errors.js";

// Types
export type {
  ImageShape,
  GenerateImageOptions,
  ImageResultData,
  GenerateTextOptions,
  GenerateTextRequestBody,
  GenerateImageRequestBody,
} from "./types.js";

// Browser interfaces
export type { BrowserContext, BrowserPage, BrowserFrame, BrowserResponse } from "./generator.js";

// Base generator
export { Generator } from "./generator.js";

// Image
export { ImageGenerator, ImageResult } from "./imageGenerator.js";

// Text
export { TextGenerator } from "./textGenerator.js";

// Camoufox helper (optional, requires `camoufox` peer dep)
export { launchCamoufox, wrapContext } from "./camoufox.js";
export type { LaunchOptions } from "./camoufox.js";

// Utils (optional, not used by default flow)
export { generateUserAgent } from "./utils.js";
