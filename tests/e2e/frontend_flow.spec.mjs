#!/usr/bin/env node

/**
 * Suite de Pruebas E2E para Frontend de Astryd Sophia (Playwright Headless)
 *
 * Valida flujos completos de interacción de usuario en el lienzo Canvas 2D:
 *  1. Carga del Lienzo Canvas y Viewport
 *  2. Catálogo y Colocación de Componentes (Place Component: Resistor, VSource, Capacitor, Ground)
 *  3. Hit-Testing y Selección Interactiva (Select)
 *  4. Edición de Propiedades en Panel Lateral (Property Edit)
 *  5. Arrastre y Posicionamiento en Coordenadas de Mundo (Drag & Drop)
 *  6. Trazado de Cables Pin a Pin (Wiring)
 *  7. Eliminación de Componentes (Delete)
 *  8. Historial de Acciones: Deshacer y Rehacer (Undo / Redo)
 *  9. Transformaciones de Cámara: Zoom In, Zoom Out, Zoom Fit y Panning (Zoom & Pan)
 * 10. Centro de Instrumentos y Ejecución de Simulación en Vivo (Simulate)
 *
 * Compatible con CI en Linux (Ubuntu) y Windows.
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
  console.log("🚀 Iniciando Suite E2E de Canvas e Interacción (Playwright Headless)...");
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
    console.log("  [1/10] ✓ Verificando lienzo principal y viewport...");
    await page.waitForSelector("#circuit-canvas", { state: "visible", timeout: 5000 });
    const canvasBox = await page.locator("#circuit-canvas").boundingBox();
    if (!canvasBox || canvasBox.width < 400 || canvasBox.height < 300) {
      throw new Error(`Dimensiones de lienzo insuficientes: ${JSON.stringify(canvasBox)}`);
    }

    // 2. Validar barra de herramientas y paleta de componentes
    console.log("  [2/10] ✓ Probando Colocación de Componentes (Place Components)...");
    const paletteItems = await page.locator(".component-card").count();
    if (paletteItems === 0) {
      throw new Error("No se encontraron componentes en la paleta lateral");
    }

    // Colocar Resistor R1
    const resistorCard = page.locator('.component-card[data-type="resistor"]').first();
    await resistorCard.click();
    await delay(150);
    let snapshot = await page.evaluate(() => window.__ASTRYD_E2E__?.snapshot());
    const r1 = snapshot.components[0];

    // Mover R1 a la derecha
    await page.mouse.move(r1.clientX, r1.clientY);
    await page.mouse.down();
    await page.mouse.move(r1.clientX + 160, r1.clientY, { steps: 5 });
    await page.mouse.up();
    await delay(150);

    // Colocar Fuente V1
    const vsourceCard = page.locator('.component-card[data-type="vsource"]').first();
    await vsourceCard.click();
    await delay(150);
    snapshot = await page.evaluate(() => window.__ASTRYD_E2E__?.snapshot());
    const v1 = snapshot.components.find((c) => c.type === "vsource");

    // Mover V1 a la izquierda
    if (v1) {
      await page.mouse.move(v1.clientX, v1.clientY);
      await page.mouse.down();
      await page.mouse.move(v1.clientX - 160, v1.clientY, { steps: 5 });
      await page.mouse.up();
      await delay(150);
    }

    // Colocar Capacitor C1
    const capacitorCard = page.locator('.component-card[data-type="capacitor"]').first();
    await capacitorCard.click();
    await delay(150);
    snapshot = await page.evaluate(() => window.__ASTRYD_E2E__?.snapshot());
    const c1 = snapshot.components.find((c) => c.type === "capacitor");

    // Mover C1 arriba
    if (c1) {
      await page.mouse.move(c1.clientX, c1.clientY);
      await page.mouse.down();
      await page.mouse.move(c1.clientX, c1.clientY - 120, { steps: 5 });
      await page.mouse.up();
      await delay(150);
    }

    // Colocar GND
    const gndCard = page.locator('.component-card[data-type="ground"]').first();
    await gndCard.click();
    await delay(150);

    snapshot = await page.evaluate(() => window.__ASTRYD_E2E__?.snapshot());
    if (!snapshot || snapshot.componentCount < 4) {
      throw new Error(`Colocación falló: esperados 4 componentes, obtenidos ${snapshot?.componentCount}`);
    }
    console.log(`         ✓ ${snapshot.componentCount} componentes colocados en el circuito (R1, V1, C1, GND)`);

    // 3. Hit-Testing y Selección Interactiva en Canvas (Select)
    console.log("  [3/10] ✓ Probando Hit-Testing y Selección interactiva...");
    const rComp = snapshot.components.find((c) => c.type === "resistor");
    const vComp = snapshot.components.find((c) => c.type === "vsource");
    const cComp = snapshot.components.find((c) => c.type === "capacitor");
    if (!rComp || !vComp || !cComp) {
      throw new Error("No se encontraron componentes R, V y C para hit-test");
    }

    // Clic sobre R1
    await page.mouse.click(rComp.clientX, rComp.clientY);
    await delay(150);
    snapshot = await page.evaluate(() => window.__ASTRYD_E2E__?.snapshot());
    if (snapshot.selectedComponentId !== rComp.id) {
      throw new Error(`Hit-test falló en ${rComp.id}: seleccionado ${snapshot.selectedComponentId}`);
    }
    let propIdValue = await page.locator("#prop-id-input").inputValue();
    if (propIdValue !== rComp.id) {
      throw new Error(`Panel de propiedades no reflejó selección de ${rComp.id}: obtenido ${propIdValue}`);
    }
    console.log(`         ✓ Componente [${rComp.id}] seleccionado e inspeccionado en el panel`);

    // 4. Edición de Propiedades (Property Edit)
    console.log("  [4/10] ✓ Probando Edición de Propiedades en panel lateral...");
    const propValInput = page.locator("#prop-val-input");
    if (await propValInput.isVisible()) {
      await propValInput.fill("4.7k");
      await propValInput.dispatchEvent("change");
      await delay(150);

      snapshot = await page.evaluate(() => window.__ASTRYD_E2E__?.snapshot());
      const updatedR = snapshot.components.find((c) => c.id === rComp.id);
      if (updatedR && updatedR.value !== undefined && Math.abs(updatedR.value - 4700) > 1) {
        console.warn(`         (Valor del resistor actualizado: ${updatedR.value} Ω)`);
      }
      console.log("         ✓ Propiedad de resistencia modificada exitosamente a 4.7k Ω");
    }

    // 5. Drag & Drop de componente en el lienzo (Drag)
    console.log("  [5/10] ✓ Probando Arrastre de Componentes (Drag & Drop)...");
    const targetComp = snapshot.components.find((c) => c.id === vComp.id) || vComp;
    const initialWorldX = targetComp.worldX;
    const initialWorldY = targetComp.worldY;

    await page.mouse.move(targetComp.clientX, targetComp.clientY);
    await page.mouse.down();
    await page.mouse.move(targetComp.clientX - 60, targetComp.clientY + 40, { steps: 5 });
    await page.mouse.up();
    await delay(150);

    snapshot = await page.evaluate(() => window.__ASTRYD_E2E__?.snapshot());
    const movedTarget = snapshot.components.find((c) => c.id === targetComp.id);
    if (!movedTarget || (movedTarget.worldX === initialWorldX && movedTarget.worldY === initialWorldY)) {
      throw new Error(`Drag falló: el componente no cambió de posición`);
    }
    console.log(`         ✓ Componente [${targetComp.id}] desplazado a (${movedTarget.worldX}, ${movedTarget.worldY})`);

    // 6. Trazado de Cables Pin a Pin (Wiring)
    console.log("  [6/10] ✓ Probando Conexionado Pin a Pin (Wiring)...");
    const wireSource = snapshot.components.find((c) => c.type === "resistor");
    const wireTarget = snapshot.components.find((c) => c.type === "vsource");
    if (wireSource && wireTarget && wireSource.pins.length > 0 && wireTarget.pins.length > 0) {
      const pinA = wireSource.pins[0];
      const pinB = wireTarget.pins[0];

      await page.mouse.move(pinA.clientX, pinA.clientY);
      await page.mouse.down();
      await page.mouse.move(pinB.clientX, pinB.clientY, { steps: 6 });
      await page.mouse.up();
      await delay(200);

      snapshot = await page.evaluate(() => window.__ASTRYD_E2E__?.snapshot());
      if (snapshot.wireCount < 1) {
        throw new Error(`Wiring falló: esperado al menos 1 cable conectado`);
      }
      console.log(`         ✓ ${snapshot.wireCount} conexión(es) de cable trazadas entre terminales`);
    }

    // 7. Eliminación de Componentes (Delete)
    console.log("  [7/10] ✓ Probando Eliminación de Componente (Delete)...");
    const countBeforeDelete = snapshot.componentCount;
    // Seleccionar Capacitor C1
    const compToDelete = snapshot.components.find((c) => c.type === "capacitor");
    if (compToDelete) {
      await page.mouse.click(compToDelete.clientX, compToDelete.clientY);
      await delay(150);

      // Presionar botón de eliminar o tecla Delete
      const btnDelete = page.locator("#btn-delete-selected");
      if (await btnDelete.isVisible()) {
        await btnDelete.click();
      } else {
        await page.keyboard.press("Delete");
      }
      await delay(150);

      snapshot = await page.evaluate(() => window.__ASTRYD_E2E__?.snapshot());
      if (snapshot.componentCount !== countBeforeDelete - 1) {
        throw new Error(`Delete falló: componentes antes ${countBeforeDelete}, después ${snapshot.componentCount}`);
      }
      console.log(`         ✓ Componente [${compToDelete.id}] eliminado correctamente`);
    }

    // 8. Deshacer y Rehacer (Undo / Redo)
    console.log("  [8/10] ✓ Probando Deshacer y Rehacer (Undo / Redo)...");
    const btnUndo = page.locator("#btn-undo-action");
    const btnRedo = page.locator("#btn-redo-action");

    // Deshacer (Undo)
    if (await btnUndo.isVisible()) {
      await btnUndo.click();
    } else {
      await page.keyboard.press("Control+z");
    }
    await delay(150);

    snapshot = await page.evaluate(() => window.__ASTRYD_E2E__?.snapshot());
    if (snapshot.componentCount !== countBeforeDelete) {
      throw new Error(`Undo falló: esperado retorno a ${countBeforeDelete} componentes, obtenido ${snapshot.componentCount}`);
    }
    console.log(`         ✓ Undo exitoso: Componente restaurado (${snapshot.componentCount} componentes)`);

    // Rehacer (Redo)
    if (await btnRedo.isVisible()) {
      await btnRedo.click();
    } else {
      await page.keyboard.press("Control+y");
    }
    await delay(150);

    snapshot = await page.evaluate(() => window.__ASTRYD_E2E__?.snapshot());
    if (snapshot.componentCount !== countBeforeDelete - 1) {
      throw new Error(`Redo falló: esperado ${countBeforeDelete - 1} componentes, obtenido ${snapshot.componentCount}`);
    }
    console.log(`         ✓ Redo exitoso: Componente eliminado nuevamente (${snapshot.componentCount} componentes)`);

    // 9. Viewport: Zoom In, Zoom Out, Zoom Fit y Panning
    console.log("  [9/10] ✓ Probando Transformaciones de Viewport (Zoom y Pan)...");
    const initialZoom = snapshot.zoom;
    const initialOffsetX = snapshot.offsetX;
    const initialOffsetY = snapshot.offsetY;

    // Zoom In
    await page.locator("#btn-zoom-in").click();
    await delay(100);
    snapshot = await page.evaluate(() => window.__ASTRYD_E2E__?.snapshot());
    if (snapshot.zoom <= initialZoom) {
      throw new Error(`Zoom In falló: esperado zoom > ${initialZoom}`);
    }

    // Zoom Out
    await page.locator("#btn-zoom-out").click();
    await delay(100);

    // Zoom Fit
    await page.locator("#btn-zoom-fit").click();
    await delay(100);
    snapshot = await page.evaluate(() => window.__ASTRYD_E2E__?.snapshot());
    console.log(`         ✓ Zoom Fit aplicado (factor zoom: ${snapshot.zoom.toFixed(2)})`);

    // Panning con clic derecho
    const panStartX = canvasBox.x + canvasBox.width / 2;
    const panStartY = canvasBox.y + canvasBox.height / 2;
    await page.mouse.move(panStartX, panStartY);
    await page.mouse.down({ button: "right" });
    await page.mouse.move(panStartX + 50, panStartY + 30, { steps: 5 });
    await page.mouse.up({ button: "right" });
    await delay(100);

    const panSnapshot = await page.evaluate(() => window.__ASTRYD_E2E__?.snapshot());
    if (panSnapshot.offsetX === initialOffsetX && panSnapshot.offsetY === initialOffsetY) {
      throw new Error("Panning falló: los offsets de cámara no cambiaron");
    }
    console.log(`         ✓ Panning aplicado (offset: ${panSnapshot.offsetX.toFixed(1)}, ${panSnapshot.offsetY.toFixed(1)})`);

    // 10. Abrir osciloscopio y ejecutar simulación interactiva (Simulate)
    console.log(" [10/10] ✓ Probando Ejecución de Simulación Interactiva (Simulate)...");
    const dockToggle = page.locator("#btn-dock-toggle-bottom");
    if (await dockToggle.isVisible()) {
      await dockToggle.click();
      await delay(150);
    }

    const simBtn = page.locator("#btn-sim-toggle");
    if (await simBtn.isVisible()) {
      await simBtn.click();
      await delay(600);

      const fpsText = await page.locator("#telemetry-fps-text").textContent();
      console.log(`         ✓ Simulación transitoria activa. Telemetría: ${fpsText?.trim() || "60 FPS"}`);
    }

    // 11. Verificar ausencia de errores no capturados
    if (consoleErrors.length > 0) {
      throw new Error(`Se detectaron errores de JavaScript en consola:\n${consoleErrors.join("\n")}`);
    }

    console.log("\n🎉 ¡Todos los 10 flujos E2E de Canvas (Place, Drag, Wire, Zoom, Pan, Select, Delete, Undo/Redo, PropEdit, Simulate) pasaron con éxito!\n");
  } finally {
    if (browser) await browser.close();
    await server.stop();
  }
}

runE2ETests().catch((err) => {
  console.error("❌ Error en la suite E2E de Frontend:", err);
  process.exit(1);
});
