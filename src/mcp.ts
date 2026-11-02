/**
 * shotframe MCP server. Tools: render_screenshots,
 * get_render_status.
 *
 * Why the low-level Server instead of McpServer: the high-level
 * helper converts schemas to JSON Schema and injects keys that
 * are not in this tool's documented spec ("$schema" and
 * "additionalProperties"), which breaks exact tool-list/schema
 * parity with the spec. This file serves tools/list with the
 * spec's exact input schemas as explicit literals, and the core
 * validates every tools/call argument set.
 *
 * The render handler returns the core's result body as a JSON
 * text block and carries the core's extracted quota metadata
 * (quota / balance / cost / upgradeUrl) on the result's `_meta`
 * whenever the API reported it.
 */
import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import {
  CallToolRequestSchema,
  ErrorCode,
  ListToolsRequestSchema,
  McpError,
} from "@modelcontextprotocol/sdk/types.js";
import type { GetRenderStatusArgs, RenderResult, RenderScreenshotsArgs } from "./types.js";
import { formatPayload, getRenderStatus, renderScreenshots, VERSION } from "./render.js";

const TOOLS = [
  {
    name: "render_screenshots",
    description:
      "Render App Store and Google Play screenshots from screens (layout JSON) and image files. Returns a jobId for keyed/async renders or a download link for anonymous/inline renders.",
    inputSchema: {
      type: "object" as const,
      properties: {
        screens: {
          type: "array",
          items: { type: "object" },
          description:
            "Screen layouts as JSON objects; structure is defined by the AppScreen API and passed through opaquely.",
        },
        files: {
          type: "array",
          items: {
            type: "object",
            properties: {
              name: {
                type: "string",
                description: "File name, as the AppScreen API should know the image.",
              },
              path: {
                type: "string",
                description:
                  "A local file path; the server reads the bytes off disk and encodes them (a leading ~/ expands to the home directory).",
              },
              base64: {
                type: "string",
                description: "Inline base64 image bytes; only for tiny synthetic test images.",
              },
            },
            required: ["name"],
          },
          description:
            "Image files; each item is an object {name, path} or {name, base64}, carrying exactly one of path or base64.",
        },
      },
      required: ["screens"],
    },
  },
  {
    name: "get_render_status",
    description:
      "Poll a render job by jobId. Returns the status and a signed download URL when done. Signed URLs expire after about an hour; re-poll to refresh.",
    inputSchema: {
      type: "object" as const,
      properties: {
        job_id: {
          type: "string",
          description: "The jobId returned by render_screenshots.",
        },
      },
      required: ["job_id"],
    },
  },
];

function successResult(result: RenderResult) {
  const out: {
    content: { type: "text"; text: string }[];
    _meta?: Record<string, unknown>;
  } = {
    content: [{ type: "text" as const, text: formatPayload(result.body) }],
  };
  if (Object.keys(result.meta).length > 0) out._meta = result.meta;
  return out;
}

function errorResult(err: unknown) {
  return {
    content: [
      { type: "text" as const, text: err instanceof Error ? err.message : String(err) },
    ],
    isError: true,
  };
}

const server = new Server(
  { name: "shotframe", version: VERSION },
  { capabilities: { tools: {} } },
);

server.setRequestHandler(ListToolsRequestSchema, async () => ({ tools: TOOLS }));

server.setRequestHandler(CallToolRequestSchema, async (request) => {
  const { name, arguments: args } = request.params;
  try {
    let result: RenderResult;
    if (name === "render_screenshots") {
      result = await renderScreenshots((args ?? {}) as unknown as RenderScreenshotsArgs);
    } else if (name === "get_render_status") {
      result = await getRenderStatus((args ?? {}) as unknown as GetRenderStatusArgs);
    } else {
      throw new McpError(ErrorCode.MethodNotFound, `Unknown tool: ${name}`);
    }
    return successResult(result);
  } catch (err) {
    if (err instanceof McpError) throw err;
    return errorResult(err);
  }
});

async function main(): Promise<void> {
  await server.connect(new StdioServerTransport());
}

void main();
