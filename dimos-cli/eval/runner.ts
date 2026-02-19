/**
 * Eval Runner — Server-side orchestrator that sequences eval workflows.
 *
 * Connects to the bridge server's WebSocket, sends commands to the browser
 * (load env, start workflow), collects results, and outputs scores.
 */

export interface EvalResult {
  name: string;
  environment: string;
  reason: string;
  durationMs: number;
  rubricScores: Record<string, unknown>;
  pass: boolean;
}

export interface RunEvalOptions {
  wsUrl: string;
  manifestPath: string;
  filterEnv?: string;
  filterWorkflow?: string;
  outputFormat?: "json" | "junit";
}

export async function runEvals(options: RunEvalOptions): Promise<EvalResult[]> {
  const { wsUrl, manifestPath, filterEnv, filterWorkflow, outputFormat } = options;

  // Load manifest
  const manifestText = await Deno.readTextFile(manifestPath);
  const manifest = JSON.parse(manifestText);

  // Collect all workflows to run
  const workflowsToRun: Array<{ env: string; scene: string; workflowPath: string; workflowName: string }> = [];

  for (const env of manifest.environments) {
    if (filterEnv && env.name !== filterEnv) continue;
    for (const wfName of env.workflows) {
      if (filterWorkflow && wfName !== filterWorkflow) continue;
      const dir = new URL(`../../evals/${env.name}/`, import.meta.url).pathname;
      workflowsToRun.push({
        env: env.name,
        scene: env.scene,
        workflowPath: `${dir}${wfName}.json`,
        workflowName: wfName,
      });
    }
  }

  if (workflowsToRun.length === 0) {
    console.log("[runner] No workflows match filter criteria.");
    return [];
  }

  console.log(`[runner] Running ${workflowsToRun.length} workflow(s)...`);

  // Connect to bridge WebSocket
  const ws = new WebSocket(wsUrl);
  ws.binaryType = "arraybuffer";

  await new Promise<void>((resolve, reject) => {
    ws.onopen = () => resolve();
    ws.onerror = (e) => reject(new Error(`WebSocket connection failed: ${e}`));
    const timeout = setTimeout(() => reject(new Error("WebSocket connect timeout")), 10000);
    ws.onopen = () => { clearTimeout(timeout); resolve(); };
  });

  console.log("[runner] Connected to bridge");

  // Helper: send command and wait for response
  function sendAndWait(cmd: Record<string, unknown>, responseType: string, timeoutMs = 60000): Promise<Record<string, unknown>> {
    return new Promise((resolve, reject) => {
      const timeout = setTimeout(() => reject(new Error(`Timeout waiting for ${responseType}`)), timeoutMs);

      const handler = (event: MessageEvent) => {
        if (typeof event.data !== "string") return;
        try {
          const msg = JSON.parse(event.data);
          if (msg.type === responseType) {
            clearTimeout(timeout);
            ws.removeEventListener("message", handler);
            resolve(msg);
          }
        } catch { /* not JSON */ }
      };

      ws.addEventListener("message", handler);
      ws.send(JSON.stringify(cmd));
    });
  }

  // Wait for the browser eval harness to be alive (ping/pong handshake)
  console.log("[runner] Waiting for browser eval harness...");
  const harnessTimeout = 60000;
  const harnessStart = Date.now();
  let harnessReady = false;
  while (Date.now() - harnessStart < harnessTimeout) {
    try {
      await sendAndWait({ type: "ping" }, "pong", 3000);
      harnessReady = true;
      break;
    } catch {
      // No response yet — browser not connected or harness not initialized
      await new Promise((r) => setTimeout(r, 1000));
    }
  }
  if (!harnessReady) {
    console.error("[runner] Timeout waiting for browser eval harness. Is the browser open?");
    ws.close();
    return [];
  }
  console.log("[runner] Browser eval harness connected!");

  const results: EvalResult[] = [];
  let currentScene = "";

  for (const wf of workflowsToRun) {
    // Load environment if different from current
    if (wf.scene !== currentScene) {
      console.log(`[runner] Loading environment: ${wf.env} (scene: ${wf.scene})`);
      await sendAndWait({ type: "loadEnv", scene: wf.scene }, "envReady", 30000);
      currentScene = wf.scene;
      // Wait for physics to settle
      await new Promise((r) => setTimeout(r, 2000));
    }

    // Load workflow definition
    const wfText = await Deno.readTextFile(wf.workflowPath);
    const workflow = JSON.parse(wfText);

    console.log(`[runner] Starting workflow: ${wf.workflowName} — "${workflow.task}"`);

    // Start workflow and wait for completion
    const timeoutMs = (workflow.timeoutSec || 120) * 1000 + 5000; // +5s buffer
    const result = await sendAndWait(
      { type: "startWorkflow", workflow },
      "workflowComplete",
      timeoutMs,
    ) as Record<string, unknown>;

    const scores = result.rubricScores as Record<string, { pass?: boolean }> || {};
    const allPass = Object.values(scores).every((s) => s.pass !== false);

    const evalResult: EvalResult = {
      name: wf.workflowName,
      environment: wf.env,
      reason: result.reason as string,
      durationMs: result.durationMs as number,
      rubricScores: scores,
      pass: allPass,
    };

    results.push(evalResult);

    const status = allPass ? "PASS" : "FAIL";
    console.log(`[runner] ${status}: ${wf.workflowName} (${evalResult.durationMs}ms)`);
  }

  ws.close();

  // Output results
  if (outputFormat === "junit") {
    const xml = toJunitXml(results);
    console.log(xml);
  } else {
    console.log(JSON.stringify(results, null, 2));
  }

  // Summary
  const passed = results.filter((r) => r.pass).length;
  const failed = results.length - passed;
  console.log(`\n[runner] Done: ${passed} passed, ${failed} failed, ${results.length} total`);

  return results;
}

// ── JUnit XML output ──────────────────────────────────────────────────────

function toJunitXml(results: EvalResult[]): string {
  const totalTime = results.reduce((s, r) => s + r.durationMs, 0) / 1000;
  const failures = results.filter((r) => !r.pass).length;

  let xml = `<?xml version="1.0" encoding="UTF-8"?>\n`;
  xml += `<testsuites tests="${results.length}" failures="${failures}" time="${totalTime.toFixed(1)}">\n`;
  xml += `  <testsuite name="dimsim-evals" tests="${results.length}" failures="${failures}">\n`;

  for (const r of results) {
    const time = (r.durationMs / 1000).toFixed(1);
    xml += `    <testcase name="${r.name}" classname="${r.environment}" time="${time}"`;
    if (r.pass) {
      xml += ` />\n`;
    } else {
      xml += `>\n`;
      xml += `      <failure message="${r.reason}">${JSON.stringify(r.rubricScores)}</failure>\n`;
      xml += `    </testcase>\n`;
    }
  }

  xml += `  </testsuite>\n`;
  xml += `</testsuites>\n`;
  return xml;
}
