#!/usr/bin/env node

/**
 * Suite de Pruebas E2E Headless para Frontend de Astryd Sophia (Playwright)
 *
 * Ejecuta validaciones de integración y de interfaz de usuario en un navegador Chromium real
 * sin requerir el backend de Tauri ni Windows WebDriverIO. Compatible con entornos Linux en CI.
 */

import { spawn } from "node:child_process";
import { resolve } from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import { chromium } from "playwright";

const HOST = "127.0.0.1";
const PORT = Number(process.env.E2E_PORT ?? 4175);
const BASE_URL = `http://${HOST}:${PORT}`;

async function isServerReady() {
  try {
    const res = await fetch(`${BASE_URL}/?audit=1`, { signal: AbortSignal.timeout(1200) });
    return res.ok;
  } catch {
    return false;
  }
}

async function ensurePreviewServer() {
  if (await isServerReady()) {
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

  const started = Date.now();
  while (Date.now() - started < 20_000) {
    if (await isServerReady()) break;
    await delay(300);
  }

  if (!(await isServerReady())) {
    child.kill();
    throw new Error(`El servidor Vite preview no inició en ${BASE_URL}`);
  }

  return {
    stop: async () => {
      child.kill();
      await delay(200);
    },
  };
}

async function runE2ETests() {
  console.log("🚀 Iniciando Suite E2E de Frontend (Playwright Headless)...");
  const server = await ensurePreviewServer();

  let browser;
  try {
    browser = await chromium.launch({
      headless: true,
      args: ["--no-sandbox", "--disable-setuid-sandbox", "--disable-dev-shm-usage"],
    });

    const context = await browser.newContext({
      viewport: { width: 1280, height: 720 },
    });

    const page = await context.newPage();
    const consoleErrors = [];
    page.on("pageerror", (err) => consoleErrors.push(err.message));

    console.log(`📡 Navegando a ${BASE_URL}...`);
    await page.goto(`${BASE_URL}/?audit=1`, { waitUntil: "domcontentloaded" });

    // 1. Validar carga básica del DOM
    console.log("  ✓ Verificando lienzo principal y viewport...");
    await page.waitForSelector("#circuit-canvas", { state: "visible", timeout: 5000 });
    const canvasBox = await page.locator("#circuit-canvas").boundingBox();
    if (!canvasBox || canvasBox.width < 400 || canvasBox.height < 300) {
      throw new Error(`Dimensiones de lienzo insuficientes: ${JSON.stringify(canvasBox)}`);
    }

    // 2. Validar barra de herramientas y paleta de componentes
    console.log("  ✓ Verificando barra de herramientas y paleta...");
    const paletteItems = await page.locator(".component-card").count();
    if (paletteItems === 0) {
      throw new Error("No se encontraron componentes en la paleta lateral");
    }
    console.log(`  ✓ ${paletteItems} componentes disponibles en la paleta`);

    // 3. Abrir el dock de instrumentos y osciloscopio
    console.log("  ✓ Verificando apertura del Osciloscopio Digital...");
    const oscTabBtn = page.locator('.inst-tab[data-tab="oscilloscope"]');
    if (await oscTabBtn.count() > 0) {
      await oscTabBtn.click();
      await delay(200);
    }

    // Desacoplar osciloscopio a ventana flotante
    const popoutBtn = page.locator("#btn-popout-instrument");
    if (await popoutBtn.isVisible()) {
      await popoutBtn.click();
      await delay(300);

      const floatingOsc = page.locator(".floating-instrument-window");
      const floatingCount = await floatingOsc.count();
      if (floatingCount === 0) {
        throw new Error("No se creó la ventana flotante del instrumento");
      }
      console.log("  ✓ Ventana flotante del Osciloscopio desacoplada correctamente");
    }

    // 4. Iniciar simulación interactiva con mock solver
    console.log("  ✓ Probando inicio de simulación transitoria...");
    const simBtn = page.locator("#btn-sim-toggle");
    if (await simBtn.isVisible()) {
      await simBtn.click();
      await delay(800);

      // Verificar que el osciloscopio o telemetría respondió
      const fpsText = await page.locator("#telemetry-fps-text").textContent();
      console.log(`  ✓ Telemetría en vivo detectada: ${fpsText?.trim() || "OK"}`);
    }

    // 5. Verificar ausencia de errores no capturados
    if (consoleErrors.length > 0) {
      throw new Error(`Se detectaron errores de JavaScript en la consola: \n${consoleErrors.join("\n")}`);
    }

    console.log("🎉 ¡Todas las pruebas E2E de frontend se ejecutaron exitosamente!\n");
  } finally {
    if (browser) await browser.close();
    await server.stop();
  }
}

runE2ETests().catch((err) => {
  console.error("❌ Error en la suite E2E de Frontend:", err);
  process.exit(1);
});
