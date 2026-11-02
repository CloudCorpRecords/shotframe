import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { getRenderStatus, renderScreenshots } from "../src/render.js";
import type { FetchFn, FetchResponseLike } from "../src/types.js";

/**
 * Every test runs against an injected fake fetch: no live
 * network, no real AppScreen key. The fake records the request
 * it was handed and answers with a fixed render payload. File
 * reads use real temporary files through the production
 * node:fs reader unless a test says otherwise.
 */

interface Captured {
  url?: string;
  method?: string;
  headers?: Record<string, string>;
  body?: string;
  calls: number;
}

function fakeFetch(
  captured: Captured,
  response: { status?: number; payload?: unknown; raw?: string } = {},
): FetchFn {
  return async (url, init) => {
    captured.url = url;
    captured.method = init.method;
    captured.headers = init.headers;
    captured.body = init.body;
    captured.calls += 1;
    const status = response.status ?? 200;
    const text =
      response.raw ?? JSON.stringify(response.payload ?? { jobId: "job-1", status: "queued" });
    const res: FetchResponseLike = {
      ok: status >= 200 && status < 300,
      status,
      text: async () => text,
    };
    return res;
  };
}

function newCaptured(): Captured {
  return { calls: 0 };
}

const SCREENS = [{ device: "iphone", layout: { title: "Hello" } }];
const ANON = { apiKey: "" };

describe("renderScreenshots — file resolution", () => {
  it("reads a path file off disk and base64-encodes it before the request", async () => {
    const dir = await mkdtemp(join(tmpdir(), "shotframe-"));
    const filePath = join(dir, "screen.png");
    const bytes = Buffer.from([0x89, 0x50, 0x4e, 0x47, 1, 2, 3]);
    await writeFile(filePath, bytes);
    const captured = newCaptured();
    const out = await renderScreenshots(
      { screens: SCREENS, files: [{ name: "screen.png", path: filePath }] },
      { ...ANON, fetchFn: fakeFetch(captured) },
    );
    assert.equal((out.body as { jobId: string }).jobId, "job-1");
    const sent = JSON.parse(captured.body!) as { files: { name: string; base64: string }[] };
    assert.deepEqual(sent.files, [{ name: "screen.png", base64: bytes.toString("base64") }]);
  });

  it("expands a leading ~/ against the HOME environment variable", async () => {
    const dir = await mkdtemp(join(tmpdir(), "shotframe-home-"));
    await writeFile(join(dir, "home.png"), Buffer.from("home-bytes"));
    const savedHome = process.env.HOME;
    process.env.HOME = dir;
    try {
      const captured = newCaptured();
      await renderScreenshots(
        { screens: SCREENS, files: [{ name: "home.png", path: "~/home.png" }] },
        { ...ANON, fetchFn: fakeFetch(captured) },
      );
      const sent = JSON.parse(captured.body!) as { files: { base64: string }[] };
      assert.equal(sent.files[0].base64, Buffer.from("home-bytes").toString("base64"));
    } finally {
      if (savedHome === undefined) delete process.env.HOME;
      else process.env.HOME = savedHome;
    }
  });

  it("passes a base64 item through unchanged", async () => {
    const captured = newCaptured();
    await renderScreenshots(
      { screens: SCREENS, files: [{ name: "tiny.png", base64: "aGVsbG8=" }] },
      { ...ANON, fetchFn: fakeFetch(captured) },
    );
    const sent = JSON.parse(captured.body!) as { files: unknown[] };
    assert.deepEqual(sent.files, [{ name: "tiny.png", base64: "aGVsbG8=" }]);
  });

  it("rejects a file item carrying both path and base64, and one carrying neither", async () => {
    const captured = newCaptured();
    const fetchFn = fakeFetch(captured);
    await assert.rejects(
      () =>
        renderScreenshots(
          { screens: SCREENS, files: [{ name: "x.png", path: "/tmp/x.png", base64: "AA==" }] },
          { ...ANON, fetchFn },
        ),
      /invalid argument: files\[0\] must carry exactly one of path or base64/,
    );
    await assert.rejects(
      () => renderScreenshots({ screens: SCREENS, files: [{ name: "x.png" }] }, { ...ANON, fetchFn }),
      /invalid argument: files\[0\] must carry exactly one of path or base64/,
    );
    assert.equal(captured.calls, 0);
  });

  it("rejects a missing or empty file name", async () => {
    const fetchFn = fakeFetch(newCaptured());
    await assert.rejects(
      () => renderScreenshots({ screens: SCREENS, files: [{ base64: "AA==" }] }, { ...ANON, fetchFn }),
      /invalid argument: files\[0\]\.name must be a non-empty string/,
    );
    await assert.rejects(
      () =>
        renderScreenshots(
          { screens: SCREENS, files: [{ name: "", base64: "AA==" }] },
          { ...ANON, fetchFn },
        ),
      /invalid argument: files\[0\]\.name must be a non-empty string/,
    );
  });

  it("fails on an unreadable file and makes no request", async () => {
    const captured = newCaptured();
    await assert.rejects(
      () =>
        renderScreenshots(
          { screens: SCREENS, files: [{ name: "nope.png", path: "/nonexistent-dir/nope.png" }] },
          { ...ANON, fetchFn: fakeFetch(captured) },
        ),
      /failed to read file \/nonexistent-dir\/nope\.png: /,
    );
    assert.equal(captured.calls, 0);
  });
});

describe("renderScreenshots — validation", () => {
  it("rejects screens that are not a non-empty array of objects", async () => {
    const fetchFn = fakeFetch(newCaptured());
    for (const bad of [undefined, [], "x", [42], [null]]) {
      await assert.rejects(
        () => renderScreenshots({ screens: bad }, { ...ANON, fetchFn }),
        /invalid argument: screens must be a non-empty array of layout objects/,
      );
    }
  });
});

describe("renderScreenshots — request shaping", () => {
  it("posts {screens, files} to /v1/renders with the Bearer key and client header", async () => {
    const captured = newCaptured();
    await renderScreenshots(
      { screens: SCREENS, files: [{ name: "tiny.png", base64: "AA==" }] },
      { apiKey: "test-key", mcpClient: "test-client", fetchFn: fakeFetch(captured) },
    );
    assert.equal(captured.method, "POST");
    assert.equal(captured.url, "https://api.appscreen.co/v1/renders");
    assert.equal(captured.headers!.Authorization, "Bearer test-key");
    assert.equal(captured.headers!["X-MCP-Client"], "test-client");
    assert.equal(captured.headers!["Content-Type"], "application/json");
    const sent = JSON.parse(captured.body!) as { screens: unknown };
    assert.deepEqual(sent.screens, SCREENS);
  });

  it("calls anonymously — no Authorization header — when no key is set", async () => {
    const captured = newCaptured();
    await renderScreenshots({ screens: SCREENS }, { ...ANON, fetchFn: fakeFetch(captured) });
    assert.equal(captured.headers!.Authorization, undefined);
    assert.equal(captured.headers!["X-MCP-Client"], undefined);
    const sent = JSON.parse(captured.body!) as Record<string, unknown>;
    assert.deepEqual(Object.keys(sent), ["screens"]);
  });
});

describe("renderScreenshots — responses", () => {
  it("passes the jobId body through and extracts quota/balance/cost/upgradeUrl meta", async () => {
    const payload = {
      jobId: "job-9",
      status: "rendering",
      balance: 42,
      cost: 3,
      upgradeUrl: "https://appscreen.co/billing",
      _meta: { quota: { plan: "pro", remaining: 10 } },
    };
    const captured = newCaptured();
    const out = await renderScreenshots(
      { screens: SCREENS },
      { ...ANON, fetchFn: fakeFetch(captured, { payload }) },
    );
    assert.deepEqual(out.body, payload);
    assert.deepEqual(out.meta, {
      quota: { plan: "pro", remaining: 10 },
      balance: 42,
      cost: 3,
      upgradeUrl: "https://appscreen.co/billing",
    });
  });

  it("returns empty meta when the body carries no quota object", async () => {
    const out = await renderScreenshots(
      { screens: SCREENS },
      { ...ANON, fetchFn: fakeFetch(newCaptured(), { payload: { downloadUrl: "https://x/y.zip" } }) },
    );
    assert.deepEqual(out.meta, {});
  });

  it("formats a 402 with an API error field as insufficient_credits", async () => {
    const fetchFn = fakeFetch(newCaptured(), {
      status: 402,
      payload: { error: "render costs 5 credits but the balance is 2 credits" },
    });
    await assert.rejects(
      () => renderScreenshots({ screens: SCREENS }, { ...ANON, fetchFn }),
      (err: unknown) =>
        err instanceof Error &&
        err.message === "insufficient_credits: render costs 5 credits but the balance is 2 credits",
    );
  });

  it("formats a 402 without an error field as a plain HTTP 402 error", async () => {
    const fetchFn = fakeFetch(newCaptured(), { status: 402, payload: {} });
    await assert.rejects(
      () => renderScreenshots({ screens: SCREENS }, { ...ANON, fetchFn }),
      (err: unknown) => err instanceof Error && err.message === "appscreen API error: HTTP 402",
    );
  });

  it("formats other non-2xx responses with the status and a body snippet", async () => {
    const fetchFn = fakeFetch(newCaptured(), { status: 500, raw: "upstream exploded" });
    await assert.rejects(
      () => renderScreenshots({ screens: SCREENS }, { ...ANON, fetchFn }),
      (err: unknown) =>
        err instanceof Error && err.message === "appscreen API error: HTTP 500: upstream exploded",
    );
  });
});

describe("getRenderStatus", () => {
  it("URL-encodes the job_id into the path and extracts meta", async () => {
    const payload = {
      jobId: "job/with space&?",
      status: "done",
      downloadUrl: "https://signed.example/dl.zip",
      balance: 39,
      cost: 3,
      _meta: { quota: { plan: "pro", remaining: 9 } },
    };
    const captured = newCaptured();
    const out = await getRenderStatus(
      { job_id: "job/with space&?" },
      { apiKey: "k", fetchFn: fakeFetch(captured, { payload }) },
    );
    assert.equal(captured.method, "GET");
    assert.equal(
      captured.url,
      "https://api.appscreen.co/v1/renders/job%2Fwith%20space%26%3F",
    );
    assert.equal(captured.headers!.Authorization, "Bearer k");
    assert.deepEqual(out.body, payload);
    assert.deepEqual(out.meta, {
      quota: { plan: "pro", remaining: 9 },
      balance: 39,
      cost: 3,
    });
  });

  it("rejects an empty or missing job_id before any request", async () => {
    const captured = newCaptured();
    const fetchFn = fakeFetch(captured);
    await assert.rejects(
      () => getRenderStatus({ job_id: "" }, { ...ANON, fetchFn }),
      /invalid argument: job_id must be a non-empty string/,
    );
    await assert.rejects(
      () => getRenderStatus({ job_id: undefined }, { ...ANON, fetchFn }),
      /invalid argument: job_id must be a non-empty string/,
    );
    assert.equal(captured.calls, 0);
  });

  it("surfaces a 402 from a status poll as insufficient_credits", async () => {
    const fetchFn = fakeFetch(newCaptured(), {
      status: 402,
      payload: { error: "balance is 0 credits" },
    });
    await assert.rejects(
      () => getRenderStatus({ job_id: "job-1" }, { ...ANON, fetchFn }),
      /insufficient_credits: balance is 0 credits/,
    );
  });
});
