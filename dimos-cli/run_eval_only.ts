#!/usr/bin/env -S deno run --allow-all --unstable-net
import { resolve, dirname, fromFileUrl } from "@std/path";
import { runEvals } from "./eval/runner.ts";

const CLI_DIR = dirname(fromFileUrl(import.meta.url));
const EVALS_DIR = resolve(CLI_DIR, "../evals");

const results = await runEvals({
  wsUrl: `ws://localhost:${Deno.args[0] || "8090"}`,
  manifestPath: resolve(EVALS_DIR, "manifest.json"),
  filterEnv: Deno.args[1] || "hotel-lobby",
  filterWorkflow: Deno.args[2] || "reach-vase",
  outputFormat: "json",
});

const passed = results.filter(r => r.pass).length;
const failed = results.length - passed;
console.log(`\nEval done: ${passed} passed, ${failed} failed`);
Deno.exit(failed > 0 ? 1 : 0);
