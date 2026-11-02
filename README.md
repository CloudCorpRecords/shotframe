# shotframe

Need App Store or Google Play screenshots for a store
listing? shotframe hands the AppScreen API a set of screen
layouts plus the image files they reference, and gives you
back either a render job you can poll or a direct download
link for the finished screenshots.

How a render flows:

- `screens` — the layouts, as JSON objects. Their structure
  is defined by the AppScreen API; shotframe passes them
  through untouched and cannot validate them for you.
- `files` — the images the layouts use. Each item names a
  file and carries exactly one source: a local `path` (the
  client reads the bytes off disk and encodes them; a leading
  `~/` expands to your home directory) or inline `base64`
  (meant only for tiny synthetic test images). An unreadable
  path fails the call before any request is made.
- The reply preserves the API's own fields — a `jobId` for
  keyed/async renders or a download link for anonymous/inline
  ones, plus `balance` and `cost` when reported. Quota
  metadata the API reports is surfaced on the MCP result's
  `_meta` (`quota`, and `balance` / `cost` / `upgradeUrl`
  when present).

Poll a job with its `jobId` to learn its status and, when it
is done, get a signed download URL. Signed URLs expire after
about an hour; poll again to refresh one.

## Configuration

The API key is optional — anonymous use works, capped by the
service at 5 lifetime renders:

```bash
export APPSCREEN_API_KEY="your key"   # optional
```

Rendering spends your own AppScreen workspace credits; when
they run out the API answers 402 and the tool reports it as
an `insufficient_credits` error carrying the API's cost and
balance text. shotframe itself holds no payment instrument.

Other environment variables:

- `APPSCREEN_BASE_URL` — API base URL
  (`https://api.appscreen.co` by default)
- `APPSCREEN_MCP_CLIENT` — sent as the `X-MCP-Client`
  header, identifying the calling client

## CLI

```bash
npx @reneturcios/shotframe render_screenshots '{"screens":[{"device":"iphone"}], "files":[{"name":"icon.png","path":"~/shots/icon.png"}]}'
npx @reneturcios/shotframe get_render_status '{"job_id":"job-123"}'
npx @reneturcios/shotframe --version
```

Output is the API result body as JSON. Exit codes: `0` on
success, `1` on a runtime error (including a validation
failure, an unreadable file, or an upstream error), `2` on a
usage error.

## MCP server

```bash
npx -y @reneturcios/shotframe mcp
```

MCP client config:

```json
{
  "mcpServers": {
    "shotframe": {
      "command": "npx",
      "args": ["-y", "@reneturcios/shotframe", "mcp"],
      "env": { "APPSCREEN_API_KEY": "your key" }
    }
  }
}
```

### Tools

- `render_screenshots` — Render App Store and Google Play
  screenshots from screens (layout JSON) and image files.
  Returns a jobId for keyed/async renders or a download link
  for anonymous/inline renders. `screens` is required;
  `files` is optional.
- `get_render_status` — Poll a render job by jobId. Returns
  the status and a signed download URL when done. Signed
  URLs expire after about an hour; re-poll to refresh.

## Docker

```bash
docker run -i -e APPSCREEN_API_KEY="your key" ghcr.io/cloudcorprecords/shotframe
docker run --rm ghcr.io/cloudcorprecords/shotframe get_render_status '{"job_id":"job-123"}'
```

## Development

```bash
npm install
npm run build   # tsc -> dist/
npm test        # tsx --test test/*.test.ts (fake fetch + temp files, no network)
npm run dev     # run the CLI from source
```

## License

MIT — Copyright (c) 2026 Rene Turcios
