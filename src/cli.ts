#!/usr/bin/env node
/**
 * shotframe CLI.
 *
 *   shotframe render_screenshots '<json>'
 *   shotframe get_render_status '<json>'
 *   shotframe mcp
 *   shotframe --version
 *
 * Each tool subcommand takes its arguments as one JSON string
 * and prints the API result body as JSON. Configuration comes
 * from the environment: APPSCREEN_API_KEY (optional; anonymous
 * when absent), APPSCREEN_BASE_URL, APPSCREEN_MCP_CLIENT.
 * Exit codes: 0 success, 1 runtime error, 2 usage error.
 */
import type { FileItemInput } from "./types.js";
import { formatPayload, getRenderStatus, renderScreenshots, VERSION } from "./render.js";

function usage(): never {
  console.error(`Usage:
  shotframe render_screenshots '<json>'
  shotframe get_render_status '<json>'
  shotframe mcp
  shotframe --version`);
  process.exit(2);
}

function parseJsonArg(rest: string[]): Record<string, unknown> {
  if (rest.length !== 1) usage();
  try {
    const parsed = JSON.parse(rest[0]) as unknown;
    if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
      console.error("error: argument must be a JSON object");
      process.exit(1);
    }
    return parsed as Record<string, unknown>;
  } catch {
    console.error("error: argument is not valid JSON");
    process.exit(1);
  }
}

async function main(): Promise<void> {
  const [cmd, ...rest] = process.argv.slice(2);
  if (cmd === "--version" || cmd === "-v") {
    console.log(VERSION);
    return;
  }
  if (cmd === "mcp") {
    if (rest.length !== 0) usage();
    await import("./mcp.js");
    return;
  }
  if (cmd !== "render_screenshots" && cmd !== "get_render_status") usage();

  const args = parseJsonArg(rest);
  try {
    const result =
      cmd === "render_screenshots"
        ? await renderScreenshots({
            screens: args.screens,
            files: args.files as FileItemInput[] | undefined,
          })
        : await getRenderStatus({ job_id: args.job_id });
    console.log(formatPayload(result.body));
  } catch (err) {
    console.error(`error: ${err instanceof Error ? err.message : String(err)}`);
    process.exit(1);
  }
}

void main();
