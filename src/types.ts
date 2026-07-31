/**
 * Shared types for the Perchance API.
 */

export type ImageShape = "portrait" | "square" | "landscape";

export interface GenerateImageOptions {
  /** Negative prompt to guide generation away from certain features */
  negativePrompt?: string;
  /** Random seed; use -1 for random */
  seed?: number;
  /** Output aspect ratio */
  shape?: ImageShape;
  /** Guidance scale for the model */
  guidanceScale?: number;
}

export interface ImageResultData {
  imageId: string;
  fileExtension: string;
  seed: number;
  prompt: string;
  width: number;
  height: number;
  guidanceScale: number;
  negativePrompt: string;
  maybeNsfw: boolean;
  [key: string]: unknown;
}

export interface GenerateTextOptions {
  /** Text to start the generation with */
  startWith?: string;
  /** Sequences to stop generation at */
  stopSequences?: string[];
  /** Per-chunk timeout in milliseconds */
  timeoutMs?: number;
}

export interface GenerateTextRequestBody {
  generatorName: string;
  instruction: string;
  instructionTokenCount: number;
  startWith: string;
  startWithTokenCount: number;
  stopSequences: string[];
}

export interface GenerateImageRequestBody {
  generatorName: string;
  channel: string;
  subChannel: string;
  prompt: string;
  negativePrompt: string;
  seed: number;
  resolution: string;
  guidanceScale: number;
}

export type GallerySort = "recent" | "top" | "trending";

export interface GalleryEntry {
  imageId: string;
  imageUrl: string;
  prompt: string;
  negativePrompt?: string;
  seed?: number;
  guidanceScale?: number;
  width?: number;
  height?: number;
  score?: number;
  createdAt?: string;
  channel: string;
  subChannel: string;
}

export interface GalleryPage {
  entries: GalleryEntry[];
  nextCursor?: string;
}

export interface GalleryListOptions {
  channel?: string;
  limit?: number;
  cursor?: string;
  sort?: GallerySort;
  timeRange?: string;
  contentFilter?: string;
}

export interface GalleryGetOptions {
  channel?: string;
  contentFilter?: string;
}
