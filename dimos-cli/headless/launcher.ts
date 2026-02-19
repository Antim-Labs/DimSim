/**
 * Headless Launcher — Playwright-based headless Chromium for CI/CD.
 *
 * Launches DimSim in a headless browser with WebGL support (SwiftShader
 * for CPU-only environments, real GPU when available).
 */

import { chromium, type Browser, type Page } from "npm:playwright";

export interface LaunchOptions {
  url: string;
  timeout?: number;
}

export interface HeadlessInstance {
  browser: Browser;
  page: Page;
  close: () => Promise<void>;
}

export async function launchHeadless(options: LaunchOptions): Promise<HeadlessInstance> {
  const { url, timeout = 30000 } = options;

  const browser = await chromium.launch({
    channel: "chrome",  // Use system Chrome (has working WebGL + GPU)
    headless: false,    // WebGL needs headed mode; use Xvfb on Linux CI for headless
    args: [
      "--no-sandbox",
      "--disable-setuid-sandbox",
      "--enable-webgl",
      "--enable-webgl2",
    ],
  });

  const context = await browser.newContext({
    viewport: { width: 1280, height: 720 },
    deviceScaleFactor: 1,
  });

  const page = await context.newPage();

  // Forward browser console to Deno stdout
  page.on("console", (msg) => {
    const type = msg.type();
    const text = msg.text();
    if (type === "error") console.error(`[browser] ${text}`);
    else if (type === "warning") console.warn(`[browser] ${text}`);
    else console.log(`[browser] ${text}`);
  });

  console.log(`[headless] Navigating to ${url}`);
  await page.goto(url, { waitUntil: "networkidle" });

  // Wait for DimSim engine to be fully initialized
  console.log("[headless] Waiting for engine init...");
  await page.waitForFunction(
    () => typeof (window as unknown as Record<string, unknown>).__dimosBridge !== "undefined",
    { timeout },
  );

  console.log("[headless] DimSim engine ready, bridge connected.");

  return {
    browser,
    page,
    close: async () => {
      await browser.close();
      console.log("[headless] Browser closed.");
    },
  };
}
