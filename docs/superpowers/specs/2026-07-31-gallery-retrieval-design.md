# Public Gallery Retrieval Design

Date: 2026-07-31
Status: Approved, not yet implemented

## Objective

Perchance MUST expose public gallery image and prompt retrieval through both
the TypeScript package and the command-line interface. Retrieval MUST support
listing a public gallery feed, looking up a specific gallery item, and
optionally downloading returned images.

The feature MUST use the existing Camoufox runtime. It MUST NOT add a local UI,
an HTTP server, or a second browser implementation.

## Current System Context

The project currently provides image generation, text generation, Camoufox
management, and AppImage packaging. Image generation already owns and closes a
Camoufox browser context, exposes typed result metadata, and supports saving
downloaded images. Gallery retrieval SHOULD follow those lifecycle and output
patterns without coupling gallery reads to image generation requests.

The official Perchance text-to-image plugin constructs public gallery URLs at
`https://image-generation.perchance.org/gallery`. The gallery accepts a
generator channel, public subchannel, sort order, time range, and content
filter. Direct non-browser requests are currently challenged by Cloudflare.
Gallery retrieval therefore MUST execute through Camoufox and consume the
structured data used by the official gallery rather than scrape rendered
cards.

## Scope

The first release MUST provide:

- Public gallery feed retrieval.
- Specific item lookup by image ID or supported gallery URL.
- A configurable gallery channel.
- Prompt and generation metadata retrieval.
- Cursor-based pagination when the upstream service provides a cursor.
- Optional image downloads.
- Typed library exports and CLI commands.

The first release MUST NOT provide:

- A graphical gallery browser.
- A local gallery or generation-history database.
- Private browser-storage gallery access.
- Gallery publishing, voting, commenting, deleting, or moderation actions.
- Cross-gallery discovery without an explicit channel.
- Automatic background synchronization.

## Public Data Model

The package MUST export a normalized `GalleryEntry` interface. It MUST contain:

```ts
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
```

Optional fields MUST remain optional because older gallery records and other
channels may omit generation metadata. Unknown upstream fields MUST NOT be
added to the public result implicitly.

The package MUST export a normalized `GalleryPage` interface:

```ts
export interface GalleryPage {
  entries: GalleryEntry[];
  nextCursor?: string;
}
```

An optional downloaded path MAY be added by CLI serialization after a download
completes. It MUST NOT alter the normalized upstream entry type.

## Library API

The package MUST export a `GalleryClient` with this behavioral surface:

```ts
export interface GalleryListOptions {
  channel?: string;
  limit?: number;
  cursor?: string;
  sort?: "recent" | "top" | "trending";
  timeRange?: string;
  contentFilter?: string;
}

export interface GalleryGetOptions {
  channel?: string;
  contentFilter?: string;
}

export class GalleryClient {
  list(options?: GalleryListOptions): Promise<GalleryPage>;
  get(idOrUrl: string, options?: GalleryGetOptions): Promise<GalleryEntry>;
  download(entry: GalleryEntry, destination: string): Promise<string>;
  close(): Promise<void>;
}
```

The client MUST default `channel` to `ai-text-to-image-generator`. It MUST
default `contentFilter` to `g`. It MUST support dependency injection for tests
and for callers that provide an existing Camoufox context.

The client MUST own a browser it launches and MUST close that browser when
`close()` is called. It MUST NOT close a caller-owned browser context.

## CLI Surface

The CLI MUST add these commands:

```text
perchance gallery list [options]
perchance gallery get <id-or-url> [options]
```

Both commands MUST support:

- `--channel <name>` with a default of `ai-text-to-image-generator`.
- `--content-filter <value>` with a default of `g`.
- `--download` to save returned images.
- `--output <path>` to control the download destination.

`gallery list` MUST additionally support:

- `--limit <number>` with a default of 20 and a valid range of 1 through 100.
- `--cursor <value>` for the next page.
- `--sort <recent|top|trending>` with a default of `recent`.
- `--time-range <value>` with a default of `all-time` for recent sorting and
  `1-month` for ranked sorting unless explicitly supplied.

`gallery list` MUST print one JSON array. `gallery get` MUST print one JSON
object. Downloaded results MUST include a `filePath` field in CLI output.

When `--download` is present without `--output`, the CLI MUST save images under
`gallery_images/`. List downloads MUST use `<image-id>.<extension>`. Item
downloads MUST treat an output path with a recognized image extension as an
exact filename and otherwise treat it as a directory.

## Browser-Backed Transport

The transport MUST use Camoufox to establish a browser session accepted by the
official gallery service. It MUST attach response observation before gallery
navigation so the initial feed response cannot be missed.

The response observer MUST accept responses only from the official gallery
service origin and the specific structured endpoints used by the loaded
gallery. It MUST reject unrelated page, advertising, analytics, and image
responses.

The transport MUST validate the captured payload before returning it. Payload
validation MUST verify collection shape, item identity, image URL, prompt
type, pagination type, and optional numeric metadata. Invalid records MUST
produce a protocol error rather than silently disappearing from a successful
result.

The browser adapter MUST isolate upstream route names and response shapes from
the public API. Changes to the upstream protocol SHOULD require changes only in
the transport and parser modules.

## Listing Flow

Given valid list options, the client MUST:

1. Validate options before launching a browser.
2. Open or reuse a Camoufox context.
3. Attach the gallery response observer.
4. Navigate to the official gallery URL with the requested channel and filters.
5. Wait for the structured feed response with a bounded timeout.
6. Normalize no more than the requested number of entries.
7. Return the normalized page and continuation cursor.

When a cursor is supplied, it MUST be passed using the upstream pagination
mechanism discovered from the official gallery runtime. The public cursor MUST
be treated as opaque.

## Item Lookup Flow

The client MUST accept either a gallery image ID or a supported Perchance
gallery URL. URL parsing MUST reject non-HTTPS URLs and unsupported hosts.

The transport MUST use the official gallery item request used by the loaded
gallery runtime. It MUST NOT scan an unbounded number of feed pages to emulate
item lookup. A missing item MUST produce `GalleryNotFoundError`.

## Download Flow

Downloads MUST occur through the accepted browser session. The client MUST
verify a successful response and an `image/*` content type before writing a
file. Redirects to unsupported schemes MUST be rejected.

The destination parent directory MUST be created when needed. Existing files
MUST NOT be overwritten unless the caller supplied that exact destination and
the existing project save semantics explicitly allow replacement.

The downloaded filename extension MUST be derived from a trusted image content
type or a validated image URL extension. Prompt text and other gallery metadata
MUST NOT influence filesystem paths.

## Validation

Channel names MUST contain only ASCII letters, digits, underscores, and
hyphens. Empty channel names MUST be rejected.

The list limit MUST be an integer between 1 and 100. Sort values MUST be one of
`recent`, `top`, or `trending`. Cursor, time-range, and content-filter values
MUST be bounded strings and MUST be encoded as URL parameters rather than
concatenated into URLs.

Image IDs and item URLs MUST be validated before browser launch. Invalid CLI
arguments MUST fail without starting Camoufox.

## Errors

The package MUST add errors derived from `PerchanceError`:

- `GalleryNotFoundError` for a valid item identifier that does not exist or is
  unavailable under the requested filters.
- `GalleryProtocolError` for incompatible, malformed, or missing structured
  gallery responses.

Browser launch, navigation, timeout, and download failures MAY continue to use
the existing connection-error hierarchy when that accurately identifies the
failure.

The CLI MUST write concise errors to stderr and return a nonzero status. It
MUST NOT print partial successful JSON after a failed list, lookup, or download.

## Cleanup And Ownership

Every CLI gallery operation MUST close its client in `finally`. Browser cleanup
MUST occur after success, validation errors, protocol errors, download errors,
timeouts, and interruption signals.

Closing the client multiple times MUST be safe. Browser ownership MUST follow
the existing project helper so that both context and owning browser are closed
without closing injected caller-owned resources.

## Testing

Default tests MUST use injected browser and network-response fixtures. They
MUST NOT contact Perchance or download Camoufox.

Unit tests MUST cover:

- Default and explicit gallery options.
- Channel, limit, sort, ID, and URL validation.
- Feed payload normalization.
- Optional metadata and older records.
- Cursor propagation.
- Specific item lookup and not-found behavior.
- Rejection of malformed or incompatible payloads.
- Response filtering that ignores unrelated requests.
- Download MIME validation and deterministic filenames.
- Browser ownership and cleanup on every failure path.

CLI tests MUST cover help output, argument forwarding, JSON serialization,
optional downloads, output naming, errors, and cleanup.

An opt-in live integration test MAY run under `PERCHANCE_E2E=1`. It MUST use a
small limit, the `g` content filter, and read-only requests. It MUST NOT vote,
comment, publish, or mutate gallery data.

## Behavioral Scenarios

### List Recent Entries

GIVEN no explicit gallery options
WHEN a caller lists the gallery
THEN the client MUST request the public `ai-text-to-image-generator` channel
with the `g` content filter and return normalized entries.

### Continue A Feed

GIVEN a page with a continuation cursor
WHEN the caller supplies that cursor to a second list call
THEN the client MUST request the next upstream page and return its opaque next
cursor without interpreting it.

### Retrieve One Item

GIVEN a valid gallery image ID or supported gallery URL
WHEN the caller requests that item
THEN the client MUST return its image URL, prompt, and all available normalized
generation metadata.

### Download An Entry

GIVEN a normalized gallery entry and a valid destination
WHEN the caller downloads it
THEN the client MUST save a validated image response and return the final path.

### Reject Invalid Input Early

GIVEN an invalid channel, limit, sort value, image ID, or URL
WHEN the caller starts a gallery operation
THEN validation MUST fail before Camoufox is launched.

### Reject Protocol Drift

GIVEN an upstream response that no longer matches the validated gallery shape
WHEN the transport processes it
THEN the operation MUST fail with `GalleryProtocolError` and close owned browser
resources.

## Acceptance Criteria

The feature is complete when the typed package API and both CLI commands meet
this specification, all default tests pass, the AppImage continues to expose
the commands without adding a UI server, and the opt-in live test can retrieve
at least one public `g`-filtered gallery entry with a nonempty prompt.

## Changelog

| Date       | Change                                                |
|------------|-------------------------------------------------------|
| 2026-07-31 | Initial approved design for public gallery retrieval. |
