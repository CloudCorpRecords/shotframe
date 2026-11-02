/**
 * shotframe core: two calls to the AppScreen rendering API.
 *
 *   renderScreenshots(args, deps) -> { body, meta }
 *   getRenderStatus(args, deps)   -> { body, meta }
 *
 * A render takes screen layouts (opaque JSON objects defined by
 * the API) and image files. Files arrive either as a local path
 * — read off disk here, with a leading `~/` expanded to the
 * home directory, and base64-encoded — or as inline base64 for
 * tiny test images. Resolution happens before any request: a
 * bad file item or an unreadable path fails the call and no
 * request is made.
 *
 * The wire paths are documented reconstructions:
 *   POST {base}/v1/renders            body {screens, files?}
 *   GET  {base}/v1/renders/<job_id>   (job_id URL-encoded)
 *
 * The API key is optional: APPSCREEN_API_KEY, when set and
 * non-empty, travels as `Authorization: Bearer <key>`; without
 * it the client calls anonymously. APPSCREEN_MCP_CLIENT, when
 * set, travels as the `X-MCP-Client` header.
 *
 * A 2xx JSON body comes back verbatim as `body`; the quota
 * metadata the API reported is extracted into `meta`: `quota`
 * (from the body's `_meta.quota`, verbatim), plus `balance` and
 * `cost` when the body reported them, and `upgradeUrl` when the
 * body carried one. A 402 becomes an `insufficient_credits`
 * error carrying the API's error text; any other non-2xx becomes
 * an `appscreen API error` carrying the status and a body
 * snippet. Rendering spends the caller's own workspace credits;
 * this client holds no payment instrument.
 */
import { readFile } from "node:fs/promises";
import { homedir } from "node:os";
import type {
  FetchFn,
  FetchResponseLike,
  FileItemInput,
  GetRenderStatusArgs,
  RenderResult,
  RenderScreenshotsArgs,
  ResolvedFile,
  ShotframeDeps,
} from "./types.js";

export const VERSION = "0.1.0";

export const DEFAULT_BASE_URL = "https://api.appscreen.co";

async function defaultFetch(
  url: string,
  init: { method: string; headers: Record<string, string>; body?: string },
): Promise<FetchResponseLike> {
  return fetch(url, { method: init.method, headers: init.headers, body: init.body });
}

function baseUrl(deps: ShotframeDeps): string {
  return (deps.baseUrl ?? process.env.APPSCREEN_BASE_URL ?? DEFAULT_BASE_URL).replace(/\/+$/, "");
}

function buildHeaders(deps: ShotframeDeps, withBody: boolean): Record<string, string> {
  const headers: Record<string, string> = { Accept: "application/json" };
  if (withBody) headers["Content-Type"] = "application/json";
  const apiKey = deps.apiKey ?? process.env.APPSCREEN_API_KEY;
  if (apiKey) headers.Authorization = `Bearer ${apiKey}`;
  const mcpClient = deps.mcpClient ?? process.env.APPSCREEN_MCP_CLIENT;
  if (mcpClient) headers["X-MCP-Client"] = mcpClient;
  return headers;
}

function expandHome(path: string, deps: ShotframeDeps): string {
  if (path === "~") return deps.homeDir ?? process.env.HOME ?? homedir();
  if (path.startsWith("~/")) {
    const home = deps.homeDir ?? process.env.HOME ?? homedir();
    return `${home}${path.slice(1)}`;
  }
  return path;
}

function validateScreens(screens: unknown): Record<string, unknown>[] {
  if (
    !Array.isArray(screens) ||
    screens.length === 0 ||
    screens.some((s) => typeof s !== "object" || s === null || Array.isArray(s))
  ) {
    throw new Error("invalid argument: screens must be a non-empty array of layout objects");
  }
  return screens as Record<string, unknown>[];
}

async function resolveFiles(
  files: FileItemInput[] | undefined,
  deps: ShotframeDeps,
): Promise<ResolvedFile[] | undefined> {
  if (files === undefined) return undefined;
  if (!Array.isArray(files)) {
    throw new Error("invalid argument: files must be an array of file objects");
  }
  const read = deps.readFileFn ?? ((p: string) => readFile(p));
  const resolved: ResolvedFile[] = [];
  for (let i = 0; i < files.length; i++) {
    const item = files[i] as FileItemInput;
    const name = item?.name;
    if (typeof name !== "string" || name.length === 0) {
      throw new Error(`invalid argument: files[${i}].name must be a non-empty string`);
    }
    const hasPath = item.path !== undefined && item.path !== null;
    const hasBase64 = item.base64 !== undefined && item.base64 !== null;
    if (hasPath === hasBase64) {
      throw new Error(`invalid argument: files[${i}] must carry exactly one of path or base64`);
    }
    if (hasBase64) {
      resolved.push({ name, base64: item.base64 as string });
      continue;
    }
    const givenPath = item.path as string;
    let bytes: Buffer;
    try {
      bytes = await read(expandHome(givenPath, deps));
    } catch (err) {
      throw new Error(
        `failed to read file ${givenPath}: ${err instanceof Error ? err.message : String(err)}`,
      );
    }
    resolved.push({ name, base64: Buffer.from(bytes).toString("base64") });
  }
  return resolved;
}

function extractMeta(body: unknown): Record<string, unknown> {
  const meta: Record<string, unknown> = {};
  if (typeof body !== "object" || body === null) return meta;
  const record = body as Record<string, unknown>;
  const inner = record._meta;
  const innerRecord =
    typeof inner === "object" && inner !== null ? (inner as Record<string, unknown>) : undefined;
  const quota = innerRecord?.quota;
  if (typeof quota !== "object" || quota === null) return meta;
  meta.quota = quota;
  const quotaRecord = quota as Record<string, unknown>;
  const balance = record.balance ?? innerRecord?.balance ?? quotaRecord.balance;
  if (balance !== undefined) meta.balance = balance;
  const cost = record.cost ?? innerRecord?.cost ?? quotaRecord.cost;
  if (cost !== undefined) meta.cost = cost;
  const upgradeUrl = record.upgradeUrl ?? innerRecord?.upgradeUrl ?? quotaRecord.upgradeUrl;
  if (upgradeUrl !== undefined) meta.upgradeUrl = upgradeUrl;
  return meta;
}

async function handleResponse(response: FetchResponseLike): Promise<RenderResult> {
  const text = await response.text();
  if (response.status === 402) {
    let apiError: unknown;
    try {
      const parsed = JSON.parse(text) as Record<string, unknown>;
      apiError = parsed?.error;
    } catch {
      apiError = undefined;
    }
    if (typeof apiError === "string" && apiError.length > 0) {
      throw new Error(`insufficient_credits: ${apiError}`);
    }
    throw new Error("appscreen API error: HTTP 402");
  }
  if (!response.ok) {
    throw new Error(
      `appscreen API error: HTTP ${response.status}${text ? `: ${text.slice(0, 500)}` : ""}`,
    );
  }
  let body: unknown;
  try {
    body = JSON.parse(text);
  } catch {
    throw new Error("appscreen API returned a non-JSON response");
  }
  return { body, meta: extractMeta(body) };
}

async function send(
  deps: ShotframeDeps,
  method: string,
  path: string,
  body?: unknown,
): Promise<RenderResult> {
  const fetchFn: FetchFn = deps.fetchFn ?? defaultFetch;
  const init: { method: string; headers: Record<string, string>; body?: string } = {
    method,
    headers: buildHeaders(deps, body !== undefined),
  };
  if (body !== undefined) init.body = JSON.stringify(body);
  let response: FetchResponseLike;
  try {
    response = await fetchFn(`${baseUrl(deps)}${path}`, init);
  } catch (err) {
    throw new Error(
      `appscreen API request failed: ${err instanceof Error ? err.message : String(err)}`,
    );
  }
  return handleResponse(response);
}

/** Submit a render job: resolve files, then POST /v1/renders. */
export async function renderScreenshots(
  args: RenderScreenshotsArgs,
  deps: ShotframeDeps = {},
): Promise<RenderResult> {
  const screens = validateScreens(args.screens);
  const files = await resolveFiles(args.files, deps);
  const body: Record<string, unknown> = { screens };
  if (files !== undefined) body.files = files;
  return send(deps, "POST", "/v1/renders", body);
}

/** Poll a render job: GET /v1/renders/<url-encoded job_id>. */
export async function getRenderStatus(
  args: GetRenderStatusArgs,
  deps: ShotframeDeps = {},
): Promise<RenderResult> {
  if (typeof args.job_id !== "string" || args.job_id.length === 0) {
    throw new Error("invalid argument: job_id must be a non-empty string");
  }
  return send(deps, "GET", `/v1/renders/${encodeURIComponent(args.job_id)}`);
}

/** Render a payload as the JSON text block MCP clients show. */
export function formatPayload(payload: unknown): string {
  return typeof payload === "string" ? payload : JSON.stringify(payload, null, 2);
}
