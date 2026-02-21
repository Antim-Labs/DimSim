#!/usr/bin/env -S deno run --allow-all --unstable-net

/**
 * DimSim CLI — eval runner, dev server, and dimos agent launcher.
 *
 * Usage:
 *   dimsim dev   [--scene <name>] [--port <n>]                Dev server + browser
 *   dimsim eval  [--headless] [--parallel N] [--render gpu]   Headless CI evals
 *   dimsim agent [--nav-only]                                 dimos Python agent
 */

import { resolve, dirname, fromFileUrl } from "@std/path";
import { startBridgeServer } from "./bridge/server.ts";
import { launchHeadless, launchMultiPage, type RenderMode } from "./headless/launcher.ts";
import { runEvals, runEvalsMultiPage, collectWorkflows, toJunitXml, type EvalResult } from "./eval/runner.ts";

const CLI_DIR = dirname(fromFileUrl(import.meta.url));
const PROJECT_DIR = resolve(CLI_DIR, "..");
const DIST_DIR = resolve(PROJECT_DIR, "dist");
const EVALS_DIR = resolve(PROJECT_DIR, "evals");
const DIMOS_VENV = resolve(PROJECT_DIR, "../dimos/.venv/bin/python");
const AGENT_PY = resolve(CLI_DIR, "agent.py");

function printUsage() {
  console.log(`
DimSim CLI — 3D simulation + eval harness for dimos

Commands:
  dimsim dev   [options]      Dev server (open browser, optional eval)
  dimsim eval  [options]      Run eval workflows (headless CI)
  dimsim agent [options]      Launch dimos Python agent

Dev:
  --scene <name>              Scene to load (default: hotel-lobby)
  --port <n>                  Server port (default: 8090)
  --eval <workflow>           Run eval after browser connects
  --env <name>                Environment filter

Eval:
  --headless                  Headless Chromium (required for CI)
  --parallel <n>              N parallel browser pages (default: 1)
  --render gpu|cpu            gpu = Metal/ANGLE, cpu = SwiftShader (default: cpu)
  --env <name>                Filter to environment
  --workflow <name>           Filter to workflow
  --output json|junit         Output format (default: json)
  --port <n>                  Bridge port (default: 8090)
  --timeout <ms>              Engine init timeout (default: auto)

Agent:
  --nav-only                  Nav stack only (no LLM agent)
  --venv <path>               Python venv path (default: ../dimos/.venv/bin/python)
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

  if (subcommand === "agent") {
    const pythonBin = (opts.venv as string) || DIMOS_VENV;
    const navOnly = opts["nav-only"] === true;

    // Verify python exists
    try {
      await Deno.stat(pythonBin);
    } catch {
      console.error(`[dimsim] dimos venv not found at: ${pythonBin}`);
      console.error(`[dimsim] Install dimos first, or pass --venv /path/to/python`);
      Deno.exit(1);
    }

    const cmd = [pythonBin, AGENT_PY];
    if (navOnly) cmd.push("--nav-only");

    console.log(`[dimsim] Starting dimos agent${navOnly ? " (nav-only)" : ""}...`);
    console.log(`[dimsim] Python: ${pythonBin}`);

    const proc = new Deno.Command(cmd[0], {
      args: cmd.slice(1),
      stdin: "inherit",
      stdout: "inherit",
      stderr: "inherit",
      env: { ...Deno.env.toObject() },
    }).spawn();

    const status = await proc.status;
    Deno.exit(status.code);
  }

  if (subcommand === "eval") {
    const headless = opts.headless === true;
    const scene = (opts.scene as string) || (opts.env as string) || "hotel-lobby";
    const parallel = Math.max(1, parseInt(opts.parallel as string) || 1);
    const render = ((opts.render as string) === "gpu" ? "gpu" : "cpu") as RenderMode;
    const defaultTimeout = render === "cpu" ? 120000 : 30000;
    const timeout = parseInt(opts.timeout as string) || defaultTimeout;
    const outputFormat = (opts.output as string) === "junit" ? "junit" : "json";
    const manifestPath = resolve(EVALS_DIR, "manifest.json");

    if (headless && parallel > 1) {
      // -- Multi-page parallel eval ----------------------------------------
      // Single bridge server + single browser with N pages/tabs.
      // Each page gets a channel ID; runner routes commands via channel field.
      const allWorkflows = collectWorkflows(
        manifestPath,
        opts.env as string,
        opts.workflow as string,
      );

      if (allWorkflows.length === 0) {
        console.log("[dimsim] No workflows match filter criteria.");
        Deno.exit(0);
      }

      const numPages = Math.min(parallel, allWorkflows.length);
      console.log(`[dimsim] Multi-page eval — ${allWorkflows.length} workflows across ${numPages} page(s)`);

      // One bridge server, eval-only mode (no LCM)
      startBridgeServer({ port, distDir: DIST_DIR, scene, evalOnly: true });
      await new Promise((r) => setTimeout(r, 500));

      // One browser with N pages
      const url = `http://localhost:${port}`;
      const instance = await launchMultiPage({ url, numPages, timeout, render });
      await new Promise((r) => setTimeout(r, 2000));

      // Run all workflows across pages
      const allResults = await runEvalsMultiPage({
        wsUrl: `ws://localhost:${port}`,
        manifestPath,
        channels: instance.channels,
        filterEnv: opts.env as string,
        filterWorkflow: opts.workflow as string,
      });

      await instance.close();

      // Output aggregated results
      if (outputFormat === "junit") {
        console.log(toJunitXml(allResults));
      } else {
        console.log(JSON.stringify(allResults, null, 2));
      }

      const passed = allResults.filter((r) => r.pass).length;
      const failed = allResults.length - passed;
      console.log(`\n[dimsim] Done: ${passed} passed, ${failed} failed, ${allResults.length} total`);
      Deno.exit(failed > 0 ? 1 : 0);
    }

    // -- Single worker eval (sequential) -----------------------------------
    console.log(`[dimsim] Eval mode — headless: ${headless}, port: ${port}`);

    startBridgeServer({ port, distDir: DIST_DIR, scene, evalOnly: headless });
    await new Promise((r) => setTimeout(r, 500));

    const url = `http://localhost:${port}`;

    if (headless) {
      console.log("[dimsim] Launching headless browser...");
      const instance = await launchHeadless({ url, timeout, render });
      await new Promise((r) => setTimeout(r, 3000));

      const results = await runEvals({
        wsUrl: `ws://localhost:${port}`,
        manifestPath,
        filterEnv: opts.env as string,
        filterWorkflow: opts.workflow as string,
        outputFormat: outputFormat as "json" | "junit",
      });

      await instance.close();

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
