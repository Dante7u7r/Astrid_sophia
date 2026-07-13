import { spawn } from "node:child_process";
import { mkdirSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import { chromium } from "playwright";

const HOST = "127.0.0.1";
const PORT = Number(process.env.PERF_AUDIT_PORT ?? 4175);
const BASE_URL = `http://${HOST}:${PORT}`;
const OUTPUT_DIR = resolve(process.cwd(), "performance-audit-results");

const SCENARIOS = [
  { name: "stress-252", rows: 14, cols: 18, iterations: 50, medianBudgetMs: 24, maxBudgetMs: 80 },
  { name: "stress-480", rows: 20, cols: 24, iterations: 35, medianBudgetMs: 40, maxBudgetMs: 130 },
  { name: "stress-960-lod", rows: 30, cols: 32, zoom: 0.42, iterations: 30, medianBudgetMs: 42, maxBudgetMs: 140 },
];

function fail(message, details = undefined) {
  const suffix = details ? `\n${JSON.stringify(details, null, 2)}` : "";
  throw new Error(`${message}${suffix}`);
}

async function isPreviewAvailable() {
  try {
    const response = await fetch(`${BASE_URL}/?audit=1&perf=1`, { signal: AbortSignal.timeout(1200) });
    return response.ok;
  } catch {
    return false;
  }
}

async function waitForPreview() {
  const started = Date.now();
  while (Date.now() - started < 20_000) {
    if (await isPreviewAvailable()) return;
    await delay(350);
  }
  fail(`Vite preview no respondio en ${BASE_URL}`);
}

async function ensurePreview() {
  if (await isPreviewAvailable()) {
    return { stop: async () => {} };
  }

  const viteCli = resolve(process.cwd(), "node_modules", "vite", "bin", "vite.js");
  const child = spawn(
    process.execPath,
    [viteCli, "preview", "--host", HOST, "--port", String(PORT)],
    {
      cwd: process.cwd(),
      stdio: ["ignore", "pipe", "pipe"],
      env: { ...process.env, BROWSER: "none" },
    },
  );

  let previewLog = "";
  child.stdout.on("data", (chunk) => {
    previewLog += chunk.toString();
  });
  child.stderr.on("data", (chunk) => {
    previewLog += chunk.toString();
  });

  try {
    await waitForPreview();
  } catch (error) {
    child.kill();
    fail(error.message, { previewLog });
  }

  return {
    stop: async () => {
      child.kill();
      await delay(250);
    },
  };
}

async function runScenario(page, scenario) {
  await page.goto(`${BASE_URL}/?audit=1&auditStage=canvas&perf=1`, {
    waitUntil: "domcontentloaded",
    timeout: 12_000,
  });
  await page.waitForFunction(() => window.__ASTRYD_PERF__ !== undefined, { timeout: 8_000 });
  await page.waitForTimeout(500);

  return page.evaluate((input) => {
    const created = window.__ASTRYD_PERF__.createStressCircuit({
      rows: input.rows,
      cols: input.cols,
      zoom: input.zoom,
    });
    const measured = window.__ASTRYD_PERF__.measureCanvasRender(input.iterations);
    return { ...input, created, measured };
  }, scenario);
}

async function runPerformanceAudit() {
  mkdirSync(OUTPUT_DIR, { recursive: true });
  const preview = await ensurePreview();
  const browser = await chromium.launch({ headless: true });
  const results = [];

  try {
    const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
    page.setDefaultTimeout(10_000);
    page.on("pageerror", (error) => {
      throw error;
    });

    for (const scenario of SCENARIOS) {
      console.log(`[perf] midiendo ${scenario.name}`);
      const result = await runScenario(page, scenario);
      const { medianMs, maxMs, averageMs } = result.measured;
      console.log(
        `[perf] ${scenario.name}: median=${medianMs.toFixed(2)}ms avg=${averageMs.toFixed(2)}ms max=${maxMs.toFixed(2)}ms`,
      );
      if (medianMs > scenario.medianBudgetMs || maxMs > scenario.maxBudgetMs) {
        fail(`Presupuesto de render excedido en ${scenario.name}`, result);
      }
      results.push(result);
    }
  } finally {
    await browser.close();
    await preview.stop();
  }

  const summaryPath = resolve(OUTPUT_DIR, "summary.json");
  writeFileSync(summaryPath, JSON.stringify(results, null, 2));
  console.log(`Auditoria performance OK. Resultados: ${summaryPath}`);
}

runPerformanceAudit().catch((error) => {
  console.error(error.message);
  process.exit(1);
});
