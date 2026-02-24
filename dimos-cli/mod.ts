/**
 * @module
 *
 * **DimSim** — 3D simulation environment for the
 * [dimos](https://github.com/dimensionalOS/dimos) robotics stack.
 *
 * Provides a browser-based Three.js + Rapier simulator with LCM transport,
 * sensor publishing (RGB, depth, LiDAR, odometry), and an eval harness for
 * automated testing of navigation and perception pipelines.
 *
 * ## Install
 *
 * ```sh
 * deno install -gAf jsr:@antim/dimsim
 * ```
 *
 * ## Setup
 *
 * Download core assets (~22 MB) and install a scene:
 *
 * ```sh
 * dimsim setup
 * dimsim scene install apt
 * ```
 *
 * ## Run
 *
 * Start the dev server and open the URL it prints:
 *
 * ```sh
 * dimsim dev --scene apt
 * ```
 *
 * Run headless evals in CI:
 *
 * ```sh
 * dimsim eval --headless --env hotel-lobby --workflow reach-vase
 * ```
 *
 * ## Programmatic API
 *
 * ```ts
 * import { startBridgeServer } from "@antim/dimsim";
 *
 * startBridgeServer({ port: 8090, distDir: "./dist", scene: "apt" });
 * ```
 */

export { startBridgeServer } from "./bridge/server.ts";
export { launchHeadless, launchMultiPage } from "./headless/launcher.ts";
export { runEvals, runEvalsMultiPage, collectWorkflows, toJunitXml } from "./eval/runner.ts";
export { setup, sceneInstall, sceneList, sceneRemove, getDimsimHome, getDistDir } from "./setup.ts";
