# Changelog

## 0.1.0 (2026-10-27)

- Initial release: `render_screenshots` and `get_render_status`
  MCP tools and matching CLI subcommands backed by the AppScreen
  API — submit screen layouts plus image files for rendering,
  then poll a job for its status and signed download URL.
- Image files are passed by local path (a leading `~/` expands
  to the home directory) or by inline base64 for tiny test
  images; path items are read off disk and encoded before any
  request is made.
- The API key is optional: `APPSCREEN_API_KEY` is sent as a
  Bearer token when set, and anonymous calls are made when it
  is absent. Quota metadata reported by the API is surfaced on
  the MCP result's `_meta`.
