#!/usr/bin/env -S deno run --allow-all --unstable-net

/**
 * DimSim CLI — Entry point for running evals and dev mode.
 *
 * Usage:
 *   dimsim eval [--headless] [--env <name>] [--workflow <name>] [--output json|junit]
 *   dimsim dev  [--scene <name>] [--port <n>]
 */

import { resolve, dirname, fromFileUrl } from "@std/path";
import { startBridgeServer } from "./bridge/server.ts";
import { launchHeadless } from "./headless/launcher.ts";
import { runEvals } from "./eval/runner.ts";

const CLI_DIR = dirname(fromFileUrl(import.meta.url));
const DIST_DIR = resolve(CLI_DIR, "../dist");
const EVALS_DIR = resolve(CLI_DIR, "../evals");

function printUsage() {
  console.log(`
DimSim — Semantic eval harness for dimos

Usage:
  dimsim dev  [options]       Start dev server (+ optional eval)
  dimsim eval [options]       Run eval workflows (headless CI)

Dev options:
  --scene <name>              Scene to load (default: hotel-lobby)
  --port <n>                  Server port (default: 8090)
  --eval <workflow>           Run an eval workflow after browser connects
  --env <name>                Environment for eval (auto-detected from manifest)

Eval options (headless CI):
  --headless                  Run in headless Chromium (for CI)
  --env <name>                Filter to specific environment
  --workflow <name>           Filter to specific workflow
  --output json|junit         Output format (default: json)
  --port <n>                  Bridge server port (default: 8090)
  --timeout <ms>              Engine init timeout (default: 30000)
`);
}

function parseArgs(args: string[]) {
  const opts: Record<string, string | boolean> = {};
  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (arg.startsWith("--")) {
      const key = arg.slice(2);
      const next = args[i + 1];
      if (next && !next.startsWith("--")) {
        opts[key] = next;
        i++;
      } else {
        opts[key] = true;
      }
    }
  }
  return opts;
}

async function main() {
  const subcommand = Deno.args[0];
  const opts = parseArgs(Deno.args.slice(1));

  if (!subcommand || subcommand === "help" || subcommand === "--help") {
    printUsage();
    Deno.exit(0);
  }

  const port = parseInt(opts.port as string) || 8090;

  if (subcommand === "dev") {
    const scene = (opts.scene as string) || "hotel-lobby";
    const evalWorkflow = opts.eval as string | undefined;
    console.log(`[dimsim] Dev mode — scene: ${scene}, port: ${port}`);

    startBridgeServer({ port, distDir: DIST_DIR, scene });

    console.log(`[dimsim] Open http://localhost:${port} in your browser`);

    if (evalWorkflow) {
      console.log(`[dimsim] Eval workflow: ${evalWorkflow}`);
      console.log("[dimsim] Waiting for browser to connect and load scene...\n");

      const wsUrl = `ws://localhost:${port}`;
      const manifestPath = resolve(EVALS_DIR, "manifest.json");

      const results = await runEvals({
        wsUrl,
        manifestPath,
        filterEnv: opts.env as string,
        filterWorkflow: evalWorkflow,
        outputFormat: "json",
      });

      const passed = results.filter((r) => r.pass).length;
      const failed = results.length - passed;
      console.log(`\n[dimsim] Eval done: ${passed} passed, ${failed} failed`);

      // Stay alive in dev mode (don't exit like headless eval does)
      console.log("[dimsim] Eval complete. Server still running. Press Ctrl+C to stop.");
    } else {
      console.log("[dimsim] Press Ctrl+C to stop.");
    }

    // Keep alive
    await new Promise(() => {});
  }

  if (subcommand === "eval") {
    const headless = opts.headless === true;
    const scene = (opts.scene as string) || (opts.env as string) || "hotel-lobby";
    const timeout = parseInt(opts.timeout as string) || 30000;
    const outputFormat = (opts.output as string) === "junit" ? "junit" : "json";

    console.log(`[dimsim] Eval mode — headless: ${headless}, port: ${port}`);

    // Start bridge server (runs in background via Deno.serve)
    startBridgeServer({ port, distDir: DIST_DIR, scene });
    // Give server a moment to bind
    await new Promise((r) => setTimeout(r, 500));

    const url = `http://localhost:${port}`;

    if (headless) {
      console.log("[dimsim] Launching headless browser...");
      const instance = await launchHeadless({ url, timeout });

      // Give DimSim a moment to initialize sensors + bridge
      await new Promise((r) => setTimeout(r, 3000));

      // Run evals
      const wsUrl = `ws://localhost:${port}`;
      const manifestPath = resolve(EVALS_DIR, "manifest.json");

      const results = await runEvals({
        wsUrl,
        manifestPath,
        filterEnv: opts.env as string,
        filterWorkflow: opts.workflow as string,
        outputFormat: outputFormat as "json" | "junit",
      });

      await instance.close();

      // Exit with non-zero if any eval failed
      const failed = results.filter((r) => !r.pass).length;
      Deno.exit(failed > 0 ? 1 : 0);
    } else {
      console.log(`[dimsim] Open ${url} in your browser to start evals`);
      console.log("[dimsim] Press Ctrl+C to stop.");
      await new Promise(() => {});
    }
  }

  printUsage();
  Deno.exit(1);
}

main();
