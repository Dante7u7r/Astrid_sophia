import { spawn } from "node:child_process";
import { mkdirSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import { chromium } from "playwright";

const HOST = "127.0.0.1";
const PORT = Number(process.env.AUDIT_UI_PORT ?? 4174);
const BASE_URL = `http://${HOST}:${PORT}`;
const OUTPUT_DIR = resolve(process.cwd(), "visual-audit-results");

const VIEWPORTS = [
  {
    name: "desktop",
    width: 1280,
    height: 720,
    minCanvasWidth: 640,
    minCanvasHeight: 420,
    expected: {
      leftCollapsed: false,
      rightCollapsed: false,
      dockCollapsed: true,
    },
  },
  {
    name: "mobile",
    width: 390,
    height: 844,
    minCanvasWidth: 320,
    minCanvasHeight: 520,
    expected: {
      leftCollapsed: true,
      rightCollapsed: true,
      dockCollapsed: true,
    },
  },
];

function fail(message, details = undefined) {
  const suffix = details ? `\n${JSON.stringify(details, null, 2)}` : "";
  throw new Error(`${message}${suffix}`);
}

async function isPreviewAvailable() {
  try {
    const response = await fetch(`${BASE_URL}/?audit=1`, { signal: AbortSignal.timeout(1200) });
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
  fail(`Vite preview no respondió en ${BASE_URL}`);
}

async function ensurePreview() {
  if (await isPreviewAvailable()) {
    return { started: false, stop: async () => {} };
  }

  const npmCommand = process.platform === "win32" ? "npm.cmd" : "npm";
  const child = spawn(
    npmCommand,
    ["run", "preview", "--", "--host", HOST, "--port", String(PORT)],
    {
      cwd: process.cwd(),
      stdio: ["ignore", "pipe", "pipe"],
      env: { ...process.env, BROWSER: "none" },
      shell: process.platform === "win32",
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
    started: true,
    stop: async () => {
      child.kill();
      await delay(250);
    },
  };
}

async function collectMetrics(page) {
  return page.evaluate(() => {
    const rectFor = (selector) => {
      const element = document.querySelector(selector);
      if (!element) return null;
      const rect = element.getBoundingClientRect();
      const styles = window.getComputedStyle(element);
      return {
        x: Math.round(rect.x),
        y: Math.round(rect.y),
        width: Math.round(rect.width),
        height: Math.round(rect.height),
        display: styles.display,
        opacity: styles.opacity,
      };
    };

    const canvas = document.querySelector("#circuit-canvas");
    let nonTransparentCanvasPixels = 0;
    if (canvas instanceof HTMLCanvasElement && canvas.width > 0 && canvas.height > 0) {
      const ctx = canvas.getContext("2d");
      if (ctx) {
        const sampleWidth = Math.min(canvas.width, 80);
        const sampleHeight = Math.min(canvas.height, 80);
        const data = ctx.getImageData(0, 0, sampleWidth, sampleHeight).data;
        for (let index = 3; index < data.length; index += 4) {
          if (data[index] !== 0) nonTransparentCanvasPixels += 1;
        }
      }
    }

    return {
      title: document.title,
      viewport: { width: window.innerWidth, height: window.innerHeight },
      documentScrollWidth: document.documentElement.scrollWidth,
      bodyScrollWidth: document.body.scrollWidth,
      cards: document.querySelectorAll(".component-card").length,
      nestedCards: [...document.querySelectorAll(".component-card .component-card")].map((element) => element.id),
      header: rectFor(".main-header"),
      workspace: rectFor("#workspace-center"),
      canvas: rectFor("#circuit-canvas"),
      leftPanel: {
        ...rectFor("#sidebar-left"),
        collapsed: document.querySelector("#sidebar-left")?.classList.contains("collapsed") ?? null,
      },
      rightPanel: {
        ...rectFor("#sidebar-right"),
        collapsed: document.querySelector("#sidebar-right")?.classList.contains("collapsed") ?? null,
      },
      bottomDock: {
        ...rectFor("#bottom-dock"),
        collapsed: document.querySelector("#bottom-dock")?.classList.contains("collapsed") ?? null,
      },
      expandLeft: rectFor("#btn-expand-left"),
      expandRight: rectFor("#btn-expand-right"),
      drawerBackdropActive: document.querySelector("#mobile-drawer-backdrop")?.classList.contains("active") ?? false,
      nonTransparentCanvasPixels,
      consoleTail: [...document.querySelectorAll(".log-line")]
        .slice(-5)
        .map((element) => element.textContent),
    };
  });
}

function assertViewport(caseConfig, metrics) {
  const errors = [];
  const maxScrollWidth = caseConfig.width + 1;

  if (metrics.documentScrollWidth > maxScrollWidth || metrics.bodyScrollWidth > maxScrollWidth) {
    errors.push(`overflow horizontal: document=${metrics.documentScrollWidth}, body=${metrics.bodyScrollWidth}, viewport=${caseConfig.width}`);
  }

  if (metrics.nestedCards.length > 0) {
    errors.push(`component-card anidadas: ${metrics.nestedCards.join(", ")}`);
  }

  if (metrics.cards < 20) {
    errors.push(`biblioteca incompleta: solo ${metrics.cards} tarjetas`);
  }

  if (!metrics.canvas || metrics.canvas.width < caseConfig.minCanvasWidth || metrics.canvas.height < caseConfig.minCanvasHeight) {
    errors.push(`canvas insuficiente: ${JSON.stringify(metrics.canvas)}`);
  }

  if (metrics.nonTransparentCanvasPixels === 0) {
    errors.push("canvas sin pixeles renderizados");
  }

  for (const [key, expectedValue] of Object.entries(caseConfig.expected)) {
    const actualValue = key === "leftCollapsed"
      ? metrics.leftPanel.collapsed
      : key === "rightCollapsed"
        ? metrics.rightPanel.collapsed
        : metrics.bottomDock.collapsed;
    if (actualValue !== expectedValue) {
      errors.push(`${key}: esperado=${expectedValue}, actual=${actualValue}`);
    }
  }

  if (errors.length > 0) {
    fail(`Auditoría UI falló en ${caseConfig.name}`, { errors, metrics });
  }
}

function assertDrawerState(label, metrics, expected) {
  const errors = [];
  if (metrics.leftPanel.collapsed !== expected.leftCollapsed) {
    errors.push(`leftCollapsed: esperado=${expected.leftCollapsed}, actual=${metrics.leftPanel.collapsed}`);
  }
  if (metrics.rightPanel.collapsed !== expected.rightCollapsed) {
    errors.push(`rightCollapsed: esperado=${expected.rightCollapsed}, actual=${metrics.rightPanel.collapsed}`);
  }
  if (metrics.drawerBackdropActive !== expected.backdropActive) {
    errors.push(`backdropActive: esperado=${expected.backdropActive}, actual=${metrics.drawerBackdropActive}`);
  }
  if (!metrics.canvas || metrics.canvas.width < 320 || metrics.canvas.height < 520) {
    errors.push(`canvas perdió espacio durante ${label}: ${JSON.stringify(metrics.canvas)}`);
  }
  if (errors.length > 0) {
    fail(`Drawer móvil inválido: ${label}`, { errors, metrics });
  }
}

async function auditMobileDrawers(page) {
  await page.click("#btn-expand-left");
  await page.waitForTimeout(350);
  assertDrawerState("abrir Componentes", await collectMetrics(page), {
    leftCollapsed: false,
    rightCollapsed: true,
    backdropActive: true,
  });
  await page.screenshot({ path: resolve(OUTPUT_DIR, "mobile-drawer-components.png"), fullPage: false, timeout: 10_000 });

  await page.mouse.click(370, 420);
  await page.waitForTimeout(350);
  assertDrawerState("cerrar con backdrop", await collectMetrics(page), {
    leftCollapsed: true,
    rightCollapsed: true,
    backdropActive: false,
  });

  await page.click("#btn-expand-right");
  await page.waitForTimeout(350);
  assertDrawerState("abrir Propiedades", await collectMetrics(page), {
    leftCollapsed: true,
    rightCollapsed: false,
    backdropActive: true,
  });
  await page.screenshot({ path: resolve(OUTPUT_DIR, "mobile-drawer-properties.png"), fullPage: false, timeout: 10_000 });

  await page.keyboard.press("Escape");
  await page.waitForTimeout(350);
  assertDrawerState("cerrar con Escape", await collectMetrics(page), {
    leftCollapsed: true,
    rightCollapsed: true,
    backdropActive: false,
  });
}

async function runAudit() {
  mkdirSync(OUTPUT_DIR, { recursive: true });
  const preview = await ensurePreview();
  const browser = await chromium.launch({ headless: true });
  const summary = [];

  try {
    for (const caseConfig of VIEWPORTS) {
      const page = await browser.newPage({
        viewport: { width: caseConfig.width, height: caseConfig.height },
      });
      page.setDefaultTimeout(8_000);
      await page.addInitScript(() => {
        localStorage.clear();
      });

      await page.route("**/*", (route) => {
        const url = route.request().url();
        if (url.includes("fonts.googleapis.com") || url.includes("fonts.gstatic.com")) {
          return route.abort();
        }
        return route.continue();
      });

      await page.goto(`${BASE_URL}/?audit=1&auditStage=canvas`, {
        waitUntil: "domcontentloaded",
        timeout: 12_000,
      });
      await page.waitForTimeout(1_200);

      const metrics = await collectMetrics(page);
      assertViewport(caseConfig, metrics);

      const screenshotPath = resolve(OUTPUT_DIR, `${caseConfig.name}.png`);
      await page.screenshot({ path: screenshotPath, fullPage: false, timeout: 10_000 });
      if (caseConfig.name === "mobile") {
        await auditMobileDrawers(page);
      }
      summary.push({ name: caseConfig.name, screenshotPath, metrics });
      await page.close();
    }
  } finally {
    await browser.close();
    await preview.stop();
  }

  const summaryPath = resolve(OUTPUT_DIR, "summary.json");
  writeFileSync(summaryPath, JSON.stringify(summary, null, 2));
  console.log(`Auditoría UI OK. Resultados: ${summaryPath}`);
}

runAudit().catch((error) => {
  console.error(error.message);
  process.exit(1);
});
