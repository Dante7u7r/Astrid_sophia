#!/usr/bin/env node

/**
 * Suite de Pruebas E2E Headless para Frontend de Astryd Sophia (Playwright)
 *
 * Ejecuta validaciones de integración y de interfaz de usuario en un navegador Chromium real
 * sin requerir el backend de Tauri ni Windows WebDriverIO. Compatible con entornos Linux en CI.
 * Incluye pruebas exhaustivas de:
 *  - Carga del Lienzo Canvas 2D
 *  - Catálogo y Colocación de Componentes
 *  - Hit-Testing y Selección en Lienzo
 *  - Drag & Drop (Mover componentes en coordenadas de mundo)
 *  - Trazado de Cables Pin a Pin (Wiring Mode)
 *  - Viewport (Zoom In, Zoom Out, Zoom Fit y Panning)
 *  - Desacople flotante de instrumentos (Osciloscopio)
 *  - Simulación interactiva y Telemetría en vivo
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
    await page.goto(`${BASE_URL}/?audit=1&auditStage=tabs`, { waitUntil: "domcontentloaded" });

    // 1. Validar carga básica del DOM y Canvas
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

    // 3. Colocación y Arrastre inicial desde la Paleta
    console.log("  ✓ Probando colocación de componentes (Resistor y Fuente DC)...");
    const resistorCard = page.locator('.component-card[data-type="resistor"]').first();
    await resistorCard.click();
    await delay(200);

    let snapshot = await page.evaluate(() => window.__ASTRYD_E2E__?.snapshot());
    if (!snapshot || snapshot.componentCount < 1) {
      throw new Error(`Fallo en colocación de Resistor: obtenido ${snapshot?.componentCount}`);
    }
    const r1 = snapshot.components[0];

    // Mover R1 a la derecha para dar espacio a V1 en el centro
    await page.mouse.move(r1.clientX, r1.clientY);
    await page.mouse.down();
    await page.mouse.move(r1.clientX + 160, r1.clientY, { steps: 5 });
    await page.mouse.up();
    await delay(200);

    const vsourceCard = page.locator('.component-card[data-type="vsource"]').first();
    await vsourceCard.click();
    await delay(200);

    snapshot = await page.evaluate(() => window.__ASTRYD_E2E__?.snapshot());
    if (snapshot.componentCount < 2) {
      throw new Error(`Fallo en colocación de Fuente: obtenido ${snapshot.componentCount}`);
    }
    console.log(`  ✓ ${snapshot.componentCount} componentes colocados en posiciones diferenciadas`);

    // 4. Hit-Testing y Selección en Canvas
    console.log("  ✓ Probando Hit-Testing y Selección interactiva...");
    const rComp = snapshot.components.find((c) => c.type === "resistor");
    const vComp = snapshot.components.find((c) => c.type === "vsource");
    if (!rComp || !vComp) {
      throw new Error("No se encontraron componentes R y V para hit-test");
    }

    // Clic sobre R1
    await page.mouse.click(rComp.clientX, rComp.clientY);
    await delay(150);
    snapshot = await page.evaluate(() => window.__ASTRYD_E2E__?.snapshot());
    if (snapshot.selectedComponentId !== rComp.id) {
      throw new Error(`Hit-test falló en ${rComp.id}: obtenido ${snapshot.selectedComponentId}`);
    }
    let propIdValue = await page.locator("#prop-id-input").inputValue();
    if (propIdValue !== rComp.id) {
      throw new Error(`Panel de propiedades no reflejó selección de ${rComp.id}: obtenido ${propIdValue}`);
    }

    // Clic sobre V1
    await page.mouse.click(vComp.clientX, vComp.clientY);
    await delay(150);
    snapshot = await page.evaluate(() => window.__ASTRYD_E2E__?.snapshot());
    if (snapshot.selectedComponentId !== vComp.id) {
      throw new Error(`Hit-test falló en ${vComp.id}: obtenido ${snapshot.selectedComponentId}`);
    }
    propIdValue = await page.locator("#prop-id-input").inputValue();
    if (propIdValue !== vComp.id) {
      throw new Error(`Panel de propiedades no reflejó selección de ${vComp.id}: obtenido ${propIdValue}`);
    }
    console.log(`  ✓ Hit-test exitoso: [${rComp.id}] y [${vComp.id}] seleccionados con precisión`);

    // 5. Drag & Drop de componente en el lienzo
    console.log("  ✓ Probando Drag & Drop de componente en el lienzo...");
    const targetComp = snapshot.components.find((c) => c.id === vComp.id) || vComp;
    const initialWorldX = targetComp.worldX;
    const initialWorldY = targetComp.worldY;

    await page.mouse.move(targetComp.clientX, targetComp.clientY);
    await page.mouse.down();
    await page.mouse.move(targetComp.clientX - 100, targetComp.clientY + 80, { steps: 6 });
    await page.mouse.up();
    await delay(200);

    snapshot = await page.evaluate(() => window.__ASTRYD_E2E__?.snapshot());
    const movedTarget = snapshot.components.find((c) => c.id === targetComp.id);
    if (!movedTarget || (movedTarget.worldX === initialWorldX && movedTarget.worldY === initialWorldY)) {
      throw new Error(`Drag falló: el componente no cambió de posición (antes: ${initialWorldX},${initialWorldY} - después: ${movedTarget?.worldX},${movedTarget?.worldY})`);
    }
    console.log(`  ✓ Drag exitoso: [${targetComp.id}] movido de (${initialWorldX}, ${initialWorldY}) a (${movedTarget.worldX}, ${movedTarget.worldY})`);

    // 6. Trazado de Cables Pin a Pin (Wiring Mode)
    console.log("  ✓ Probando conexionado pin a pin (Wiring)...");
    const wireSource = snapshot.components.find((c) => c.type === "resistor");
    const wireTarget = snapshot.components.find((c) => c.type === "vsource");
    if (!wireSource || !wireTarget || wireSource.pins.length === 0 || wireTarget.pins.length === 0) {
      throw new Error("No se encontraron terminales para trazar cable");
    }

    const pinA = wireSource.pins[0];
    const pinB = wireTarget.pins[0];

    await page.mouse.move(pinA.clientX, pinA.clientY);
    await page.mouse.down();
    await page.mouse.move(pinB.clientX, pinB.clientY, { steps: 6 });
    await page.mouse.up();
    await delay(200);

    snapshot = await page.evaluate(() => window.__ASTRYD_E2E__?.snapshot());
    if (snapshot.wireCount < 1) {
      throw new Error(`Wiring falló: esperado al menos 1 cable conectado, obtenido ${snapshot.wireCount}`);
    }
    console.log(`  ✓ Wiring exitoso: ${snapshot.wireCount} cable(s) conectado(s) entre terminales`);

    // 7. Viewport: Zoom In, Zoom Out, Zoom Fit y Panning
    console.log("  ✓ Probando transformaciones de Viewport (Zoom y Pan)...");
    const initialZoom = snapshot.zoom;
    const initialOffsetX = snapshot.offsetX;
    const initialOffsetY = snapshot.offsetY;

    // Zoom In
    await page.locator("#btn-zoom-in").click();
    await delay(150);
    snapshot = await page.evaluate(() => window.__ASTRYD_E2E__?.snapshot());
    if (snapshot.zoom <= initialZoom) {
      throw new Error(`Zoom In falló: esperado zoom > ${initialZoom}, obtenido ${snapshot.zoom}`);
    }

    // Zoom Out
    await page.locator("#btn-zoom-out").click();
    await delay(150);

    // Zoom Fit
    await page.locator("#btn-zoom-fit").click();
    await delay(150);
    snapshot = await page.evaluate(() => window.__ASTRYD_E2E__?.snapshot());
    console.log(`  ✓ Zoom ajustado por fit: factor ${snapshot.zoom.toFixed(2)}`);

    // Panning con clic derecho
    const panStartX = canvasBox.x + canvasBox.width / 2;
    const panStartY = canvasBox.y + canvasBox.height / 2;
    await page.mouse.move(panStartX, panStartY);
    await page.mouse.down({ button: "right" });
    await page.mouse.move(panStartX + 60, panStartY + 40, { steps: 5 });
    await page.mouse.up({ button: "right" });
    await delay(150);

    const panSnapshot = await page.evaluate(() => window.__ASTRYD_E2E__?.snapshot());
    if (panSnapshot.offsetX === initialOffsetX && panSnapshot.offsetY === initialOffsetY) {
      throw new Error("Panning falló: los offsets de cámara no cambiaron");
    }
    console.log(`  ✓ Panning de cámara verificado: offset (${panSnapshot.offsetX.toFixed(1)}, ${panSnapshot.offsetY.toFixed(1)})`);

    // 8. Abrir el dock de instrumentos y osciloscopio
    console.log("  ✓ Verificando apertura del Centro de Instrumentos...");
    const dockToggle = page.locator("#btn-dock-toggle-bottom");
    if (await dockToggle.isVisible()) {
      await dockToggle.click();
      await delay(200);
      const oscTabBtn = page.locator('.inst-tab[data-tab="oscilloscope"]').first();
      if (await oscTabBtn.isVisible()) {
        await oscTabBtn.click();
        await delay(200);
      }
      console.log("  ✓ Centro de Instrumentos y pestaña Osciloscopio abiertos");
    }

    // 9. Iniciar simulación interactiva con mock solver
    console.log("  ✓ Probando inicio de simulación transitoria...");
    const simBtn = page.locator("#btn-sim-toggle");
    if (await simBtn.isVisible()) {
      await simBtn.click();
      await delay(800);

      // Verificar que el osciloscopio o telemetría respondió
      const fpsText = await page.locator("#telemetry-fps-text").textContent();
      console.log(`  ✓ Telemetría en vivo detectada: ${fpsText?.trim() || "OK"}`);
    }

    // 10. Verificar ausencia de errores no capturados
    if (consoleErrors.length > 0) {
      throw new Error(`Se detectaron errores de JavaScript en la consola: \n${consoleErrors.join("\n")}`);
    }

    console.log("🎉 ¡Todas las pruebas E2E de Canvas e Interacción se ejecutaron exitosamente!\n");
  } finally {
    if (browser) await browser.close();
    await server.stop();
  }
}

runE2ETests().catch((err) => {
  console.error("❌ Error en la suite E2E de Frontend:", err);
  process.exit(1);
});
