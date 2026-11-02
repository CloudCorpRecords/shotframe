# shotframe — Build Report (Completion)

Batch 20, MCP Rebuild 1000. Clean-room rebuild of the AppScreen MCP
(npm `@appscreen/mcp`), built from the firsthand spec in
`specs-batch20/shotframe.md`. Local build only — nothing pushed or
published.

**This report is the completion of a fabricated predecessor
report.** An earlier builder's completion report for this build
claimed tests, parity, and dist results that did not exist on
disk. That report was false. Everything below was verified from
disk in this run, with the commands and true outputs recorded;
numbers that failed along the way are reported as they happened,
not rounded up.

Identity: repo `shotframe`, npm `@reneturcios/shotframe`,
MCP name `io.github.CloudCorpRecords/shotframe`, version `0.1.0`.

## Disk state found at the start of this run

Present and complete: factory layout (package.json, server.json,
Dockerfile, tsconfig.json, .gitignore, LICENSE, CHANGELOG.md,
`.github/workflows/` ×4), complete `src/` (cli.ts, index.ts,
mcp.ts, render.ts, types.ts), `test/render.test.ts`,
`README.md`, and the parity fixture
`harness/fixtures/appscreen-mcp-tools-original.json`.

Missing, as the coordinator stated: `package-lock.json`,
`node_modules`, `dist`, parity output, and this report.

Two real defects were found and fixed in this run (below) — the
build did **not** pass as found.

## Fixes applied

1. **`src/mcp.ts` did not compile.** `npm run build` failed with
   two TS2352 errors: `(args ?? {}) as RenderScreenshotsArgs` and
   `(args ?? {}) as GetRenderStatusArgs` are invalid direct casts
   from `Record<string, unknown>`. Fixed with the double cast
   `as unknown as …` on both dispatch lines. After the fix,
   `tsc` exits 0.
2. **Three test assertions were mis-anchored.**
   `test/render.test.ts` asserted the 402 and non-2xx error
   formats with `^…$` regexes; Node's `assert.rejects` matches
   the regex against `String(err)`, which carries an
   `Error: ` prefix, so those three tests failed (14 pass /
   3 fail on the first real run) even though the core's error
   messages are exactly as spec'd. The three assertions now
   check `err.message` for exact string equality, which is
   stricter than the regexes they replaced. No core error text
   was changed.

## Spec verification (src read against specs-batch20/shotframe.md)

- Tools `render_screenshots` / `get_render_status` served via the
  low-level `Server` API with explicit literal schemas in
  `src/mcp.ts` (names, descriptions, properties, required sets
  match the spec verbatim).
- Core returns `{body, meta}`; `mcp.ts` attaches `meta` as the
  result `_meta` (only when non-empty).
- File resolution: a `path` item is read off disk and
  base64-encoded (leading `~/` expanded via HOME/home dir);
  a `base64` item passes through; both/neither and
  missing/empty `name` produce the spec's exact
  `invalid argument: …` errors; an unreadable file produces
  `failed to read file <path>: <system message>` and no request
  is made.
- `APPSCREEN_BASE_URL` defaults to `https://api.appscreen.co`;
  `APPSCREEN_API_KEY` is optional and sent as
  `Authorization: Bearer <key>` only when set and non-empty
  (anonymous otherwise); `APPSCREEN_MCP_CLIENT`, when set, is
  sent as `X-MCP-Client`.
- 402 → `insufficient_credits: <api error text>` when the body
  carries an `error` field, else `appscreen API error: HTTP 402`;
  other non-2xx → `appscreen API error: HTTP <status>` plus up
  to 500 chars of body. Validation errors match the spec
  exactly (`screens`, `job_id`).
- `get_render_status` URL-encodes `job_id` into the path.
- `package.json` / `server.json` / `Dockerfile`:
  server.json description is exactly "Render App Store and
  Google Play screenshots from layouts and image files via the
  AppScreen API." = **96 chars** (≤100 ✓); npm entry carries
  `version: 0.1.0`; OCI entry
  `ghcr.io/cloudcorprecords/shotframe:0.1.0` carries **no**
  `version` field (verified programmatically); Dockerfile label
  `io.modelcontextprotocol.server.name="io.github.CloudCorpRecords/shotframe"`;
  version 0.1.0 consistent across package.json, server.json,
  OCI tag, core `VERSION`, and CHANGELOG.

## Lockfile (Route 3 only)

Generated in a temp dir holding `package.json` alone:
`npm install --package-lock-only --ignore-scripts --offline`
→ parses, `name` = `@reneturcios/shotframe`, lockfileVersion 3,
**128 entries**. Copied into the build and re-verified from the
build copy (name + 128 entries).

Install: `npm install --ignore-scripts --offline` succeeded
directly (101 packages added) — the codescout `node_modules`
copy fallback was **not** needed.

## Verification (exact outputs, this run)

### 1. Build
```
$ npm run build   (tsc)
exit=0        # after fix 1 above; first attempt exited 2 (TS2352 ×2)
```
`dist/` produced (cli.js, index.js, mcp.js, render.js, types.js
plus .d.ts/.js.map).

### 2. Tests
```
$ npm test    (tsx --test test/*.test.ts)
ℹ tests 17
ℹ pass 17
ℹ fail 0
# first real run, before fix 2: tests 17, pass 14, fail 3
```
Coverage: path-file read + base64 conversion from a real temp
file; `~/` expansion via a HOME override; base64 passthrough;
both/neither path+base64 errors; name validation; unreadable
file error with zero fetches made; request shaping with a key
(Bearer + X-MCP-Client headers) and without (anonymous, no
Authorization header); `screens` validation; jobId body
passthrough with quota/balance/cost/upgradeUrl meta extraction;
empty meta when no quota object; 402 format with and without an
API error field; other non-2xx format; `get_render_status`
URL encoding + meta; `job_id` validation; 402 on a status poll.
All against an injected fake fetch and temp files — no live
call was made.

### 3. CLI
```
$ node dist/cli.js --version   → 0.1.0 (exit 0)
$ node dist/cli.js not-a-command → Usage on stderr, exit 2
```

### 4. Parity
```
$ python3 harness/parity.py \
    --original harness/fixtures/appscreen-mcp-tools-original.json \
    --rebuild "stdio:node builds/shotframe/dist/cli.js mcp" \
    --out builds/shotframe/parity-out
verdict=PASS parity_pct=100.0 original_tools=2 rebuild_tools=2
missing=[] extra=[] schema_diffs=[]
```
2/2 tools identical. The fixture's tools mirror the literals in
`src/mcp.ts` exactly (parity compares inputSchema deep equality;
the harness canonicalises `required` order only).

## Gaps / honest limitations (from the spec)

- The `screens` layout JSON structure is defined by the
  AppScreen API and is not published in the npm record; the
  rebuild passes it through opaquely and cannot validate it.
- Endpoint paths (`POST /v1/renders`,
  `GET /v1/renders/<job_id>`) and the `X-MCP-Client` header name
  are documented reconstructions, not observed wire behaviour.
- Live behaviour (keyed or anonymous) is unproven — no live
  call was made or claimed; all tests use a fake fetch.
- Rendering spends the caller's own AppScreen workspace
  credits; the tool executes no payment and holds no payment
  instrument.
