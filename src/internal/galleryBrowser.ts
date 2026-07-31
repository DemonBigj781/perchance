import type { BrowserPage } from "../generator.js";
import { GALLERY_DOCUMENT_ORIGIN } from "./galleryProtocol.js";

export interface RawGalleryFeedPage {
  records: unknown[];
  consumed: number;
  hasMore: boolean;
}

export interface BrowserFetchResult {
  status: number;
  finalUrl: string;
  contentType: string;
  body: unknown;
}

export interface BrowserImageResult {
  status: number;
  finalUrl: string;
  contentType: string;
  data: string;
}

export async function readGalleryFeed(
  page: BrowserPage,
  request: { startSkip: number; limit: number },
): Promise<RawGalleryFeedPage> {
  return await page.evaluate<RawGalleryFeedPage>(
    async ({ startSkip, limit }: { startSkip: number; limit: number }) => {
      function recordFromElement(element: Element): Record<string, unknown> {
        const container = element as HTMLElement;
        const image = container.querySelector("img");
        const ratioSource =
          image instanceof HTMLImageElement
            ? image.style.aspectRatio
            : container.style.aspectRatio;
        const ratio = ratioSource
          .split("/")
          .map((part) => Number(part.trim()));

        return {
          imageId: container.dataset.imageId,
          imageUrl:
            image instanceof HTMLImageElement ? image.currentSrc || image.src : undefined,
          prompt: container.dataset.prompt,
          negativePrompt: container.dataset.negativePrompt,
          seed: container.dataset.seed,
          guidanceScale: container.dataset.guidanceScale,
          width: Number.isFinite(ratio[0]) ? ratio[0] : undefined,
          height: Number.isFinite(ratio[1]) ? ratio[1] : undefined,
        };
      }

      function extract(root: ParentNode): Record<string, unknown>[] {
        return Array.from(root.querySelectorAll(".imageCtn"), recordFromElement);
      }

      const main = document.querySelector("#main");
      if (!main) throw new Error("Gallery page did not expose its structured feed.");

      const initial = extract(main);
      let observedPageSize = initial.length;
      const records: Record<string, unknown>[] = [];
      let offset = startSkip;
      let hasMore = false;

      if (startSkip === 0) {
        records.push(...initial.slice(0, limit));
        const loadMoreButton = document.querySelector<HTMLElement>(
          "button[onclick*='loadMoreButtonClickHandler']",
        );
        hasMore =
          records.length < initial.length ||
          (initial.length > 0 && loadMoreButton?.style.display !== "none");
        offset = initial.length;
      }

      while (records.length < limit) {
        const url = new URL(window.location.href);
        url.searchParams.set("imageElementsHtmlOnly", "true");
        url.searchParams.set("skip", String(offset));
        const response = await fetch(url.href, { redirect: "error" });
        if (
          !response.ok ||
          new URL(response.url).origin !== window.location.origin
        ) {
          throw new Error(
            `Gallery fragment request failed with status ${response.status}.`,
          );
        }

        const wrapper = document.createElement("div");
        wrapper.innerHTML = await response.text();
        const batch = extract(wrapper);
        if (batch.length === 0) {
          hasMore = false;
          break;
        }
        if (observedPageSize === 0) observedPageSize = batch.length;

        const remaining = limit - records.length;
        const selected = batch.slice(0, remaining);
        records.push(...selected);
        offset += batch.length;
        hasMore =
          selected.length < batch.length ||
          batch.length === observedPageSize;

        if (batch.length < observedPageSize) {
          hasMore = selected.length < batch.length;
          break;
        }
      }

      return {
        records,
        consumed: records.length,
        hasMore,
      };
    },
    request,
  );
}

export async function fetchGalleryDocument(
  page: BrowserPage,
  imageId: string,
): Promise<BrowserFetchResult> {
  const url = `${GALLERY_DOCUMENT_ORIGIN}/docs/${imageId}.json`;
  return await page.evaluate<BrowserFetchResult>(
    async (documentUrl: string) => {
      const response = await fetch(documentUrl, { redirect: "follow" });
      const contentType = response.headers.get("content-type") ?? "";
      let body: unknown = null;
      if (contentType.toLowerCase().includes("application/json")) {
        const text = await response.text();
        try {
          body = JSON.parse(text);
        } catch {
          body = { malformedJson: true };
        }
      } else {
        await response.text();
      }
      return {
        status: response.status,
        finalUrl: response.url,
        contentType,
        body,
      };
    },
    url,
  );
}

export async function fetchGalleryImage(
  page: BrowserPage,
  imageUrl: string,
): Promise<BrowserImageResult> {
  return await page.evaluate<BrowserImageResult>(
    async (url: string) => {
      const response = await fetch(url, { redirect: "follow" });
      const blob = await response.blob();
      const data = await new Promise<string>((resolve, reject) => {
        const reader = new FileReader();
        reader.onerror = () => reject(reader.error);
        reader.onloadend = () => {
          resolve(String(reader.result).split(",")[1] ?? "");
        };
        reader.readAsDataURL(blob);
      });
      return {
        status: response.status,
        finalUrl: response.url,
        contentType: response.headers.get("content-type") ?? "",
        data,
      };
    },
    imageUrl,
  );
}
