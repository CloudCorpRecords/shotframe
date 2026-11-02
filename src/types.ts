/**
 * shotframe types.
 *
 * shotframe is a client for a screenshot rendering service: the
 * caller supplies screen layouts (JSON objects whose structure
 * the service defines and this client passes through opaquely)
 * plus image files, and the service renders App Store and
 * Google Play screenshots from them. Image files travel as
 * base64 on the wire; a caller may hand over a local path
 * instead and the client reads and encodes the bytes itself.
 */

/** One image file as the caller supplies it: a path or base64. */
export interface FileItemInput {
  /** File name, as the service should know the image. Required. */
  name?: unknown;
  /** Local file path; the client reads the bytes off disk. */
  path?: string;
  /** Inline base64 bytes, for tiny synthetic test images. */
  base64?: string;
  [key: string]: unknown;
}

/** Arguments accepted by `render_screenshots`. */
export interface RenderScreenshotsArgs {
  /** Screen layouts as JSON objects, passed through opaquely. */
  screens: unknown;
  /** Image files; each item carries exactly one of path/base64. */
  files?: FileItemInput[];
}

/** Arguments accepted by `get_render_status`. */
export interface GetRenderStatusArgs {
  /** The jobId returned by render_screenshots. */
  job_id: unknown;
}

/** An image file resolved for the wire: a name and base64 bytes. */
export interface ResolvedFile {
  name: string;
  base64: string;
}

/**
 * What a core call returns: the API body verbatim, plus the
 * quota metadata extracted from it for the MCP result's `_meta`
 * (`quota` verbatim, and `balance` / `cost` / `upgradeUrl` when
 * the API reported them). `meta` is empty when the API reported
 * no quota object.
 */
export interface RenderResult {
  body: unknown;
  meta: Record<string, unknown>;
}

/** The minimal slice of a fetch Response this client relies on. */
export interface FetchResponseLike {
  ok: boolean;
  status: number;
  text(): Promise<string>;
}

/** Injectable fetch, so tests never touch the live network. */
export type FetchFn = (
  url: string,
  init: {
    method: string;
    headers: Record<string, string>;
    body?: string;
  },
) => Promise<FetchResponseLike>;

/** Injectable file reader: a path in, the file's bytes out. */
export type FileReaderFn = (path: string) => Promise<Buffer>;

/** Runtime dependencies for the core, all injectable in tests. */
export interface ShotframeDeps {
  /**
   * AppScreen API key. Falls back to APPSCREEN_API_KEY; when
   * neither is set (or the value is empty) calls are anonymous.
   */
  apiKey?: string;
  /** API base URL. Falls back to APPSCREEN_BASE_URL, then the public API. */
  baseUrl?: string;
  /** MCP client identifier. Falls back to APPSCREEN_MCP_CLIENT. */
  mcpClient?: string;
  /** Fetch implementation. Defaults to the global fetch. */
  fetchFn?: FetchFn;
  /** File reader implementation. Defaults to node:fs readFile. */
  readFileFn?: FileReaderFn;
  /** Home directory used to expand a leading `~/`. Defaults to the OS home. */
  homeDir?: string;
}
