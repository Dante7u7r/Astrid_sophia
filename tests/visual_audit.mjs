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

    const isClippedBy = (selector, containerSelector) => {
      const element = document.querySelector(selector);
      const container = document.querySelector(containerSelector);
      if (!element || !container) return null;
      const elementRect = element.getBoundingClientRect();
      const containerRect = container.getBoundingClientRect();
      const styles = window.getComputedStyle(element);
      if (styles.display === "none" || styles.visibility === "hidden") return false;
      return elementRect.left < containerRect.left - 1
        || elementRect.right > containerRect.right + 1
        || elementRect.top < containerRect.top - 1
        || elementRect.bottom > containerRect.bottom + 1;
    };

    return {
      title: document.title,
      audit: {
        stage: document.documentElement.dataset.auditStage ?? null,
        step: document.documentElement.dataset.auditStep ?? null,
      },
      viewport: { width: window.innerWidth, height: window.innerHeight },
      documentScrollWidth: document.documentElement.scrollWidth,
      bodyScrollWidth: document.body.scrollWidth,
      cards: document.querySelectorAll(".component-card").length,
      nestedCards: [...document.querySelectorAll(".component-card .component-card")].map((element) => element.id),
      header: rectFor(".main-header"),
      headerRegions: {
        logo: rectFor(".logo-area"),
        simulation: rectFor("#simulation-bar"),
        actions: rectFor("#app-status-bar"),
      },
      headerControlClipping: {
        analysis: isClippedBy("#analysis-mode-select", "#simulation-bar"),
        run: isClippedBy("#run-sim-btn", "#simulation-bar"),
        stop: isClippedBy("#stop-sim-btn", "#simulation-bar"),
        newCircuit: isClippedBy("#btn-new-circuit", "#app-status-bar"),
        openCircuit: isClippedBy("#btn-open-circuit", "#app-status-bar"),
        demos: isClippedBy("#btn-open-demo", "#app-status-bar"),
        saveCircuit: isClippedBy("#btn-save-circuit", "#app-status-bar"),
        instruments: isClippedBy("#instruments-menu-btn", "#app-status-bar"),
        settings: isClippedBy("#settings-trigger-btn", "#app-status-bar"),
      },
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
      footer: rectFor("#app-footer"),
      footerInfo: rectFor(".footer-info-group"),
      footerSolver: rectFor(".footer-solver"),
      mobileTargets: {
        expandLeft: rectFor("#btn-expand-left"),
        expandRight: rectFor("#btn-expand-right"),
        zoomIn: rectFor("#btn-zoom-in"),
        run: rectFor("#run-sim-btn"),
      },
      canvasHelp: rectFor("#canvas-help-tip"),
      expandLeft: rectFor("#btn-expand-left"),
      expandRight: rectFor("#btn-expand-right"),
      drawerBackdropActive: document.querySelector("#mobile-drawer-backdrop")?.classList.contains("active") ?? false,
      toasts: [...document.querySelectorAll(".toast-notification")]
        .slice(0, 5)
        .map((element) => element.textContent?.trim()),
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

  if (metrics.audit.stage !== "canvas" || metrics.audit.step !== "full") {
    errors.push(`build de auditoría inactiva o mal configurada: ${JSON.stringify(metrics.audit)}`);
  }

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

  const containedBy = (child, parent) => child && parent
    && child.x >= parent.x - 1
    && child.y >= parent.y - 1
    && child.x + child.width <= parent.x + parent.width + 1
    && child.y + child.height <= parent.y + parent.height + 1;

  for (const [name, region] of Object.entries(metrics.headerRegions)) {
    if (!containedBy(region, metrics.header)) {
      errors.push(`región de header fuera de límites (${name}): ${JSON.stringify(region)}`);
    }
  }

  for (const [name, clipped] of Object.entries(metrics.headerControlClipping)) {
    if (clipped === true) {
      errors.push(`control de header recortado: ${name}`);
    }
  }

  if (!containedBy(metrics.footerInfo, metrics.footer)) {
    errors.push(`telemetría fuera del footer: ${JSON.stringify(metrics.footerInfo)}`);
  }
  if (metrics.footerSolver?.display !== "none" && !containedBy(metrics.footerSolver, metrics.footer)) {
    errors.push(`texto del solver fuera del footer: ${JSON.stringify(metrics.footerSolver)}`);
  }

  if (caseConfig.name === "mobile") {
    for (const [name, target] of Object.entries(metrics.mobileTargets)) {
      if (!target || target.width < 34 || target.height < 30) {
        errors.push(`objetivo táctil insuficiente (${name}): ${JSON.stringify(target)}`);
      }
    }
    if (metrics.canvasHelp?.display !== "none") {
      errors.push("la ayuda larga del canvas debe ocultarse en móvil");
    }
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

async function auditKeyboardFocus(page) {
  for (let attempt = 0; attempt < 10; attempt += 1) {
    await page.keyboard.press("Tab");
    const focusState = await page.evaluate(() => {
      const element = document.activeElement;
      if (!(element instanceof HTMLElement) || element === document.body) return null;
      const styles = window.getComputedStyle(element);
      return {
        id: element.id,
        outlineStyle: styles.outlineStyle,
        outlineWidth: parseFloat(styles.outlineWidth) || 0,
      };
    });
    if (focusState && focusState.outlineStyle !== "none" && focusState.outlineWidth >= 2) return;
  }
  fail("No se encontró un foco de teclado claramente visible");
}

function assertDrawerState(label, metrics, expected) {
  const errors = [];
  if (metrics.toasts.length > 0) {
    errors.push(`toast inesperado durante navegación: ${metrics.toasts.join(" | ")}`);
  }
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

async function auditDesktopPanelCollapse(page) {
  const before = await collectMetrics(page);
  await page.click("#btn-dock-toggle-right");
  await page.waitForTimeout(350);
  const collapsed = await collectMetrics(page);

  const errors = [];
  if (!collapsed.rightPanel.collapsed || collapsed.rightPanel.width > 1) {
    errors.push(`el panel derecho sigue reservando espacio: ${JSON.stringify(collapsed.rightPanel)}`);
  }
  if (!before.workspace || !collapsed.workspace || collapsed.workspace.width < before.workspace.width + 180) {
    errors.push(`el lienzo no recuperó el ancho del panel: antes=${JSON.stringify(before.workspace)}, después=${JSON.stringify(collapsed.workspace)}`);
  }
  if (collapsed.expandRight?.display !== "none") {
    errors.push(`el tirador flotante derecho debe ocultarse en escritorio: ${JSON.stringify(collapsed.expandRight)}`);
  }
  if (errors.length > 0) {
    fail("Colapso del panel derecho inválido en escritorio", { errors });
  }
  await page.screenshot({
    path: resolve(OUTPUT_DIR, "desktop-properties-collapsed.png"),
    fullPage: false,
    timeout: 10_000,
  });

  await page.click("#btn-dock-toggle-right");
  await page.waitForTimeout(350);
  const restored = await collectMetrics(page);
  if (restored.rightPanel.collapsed || restored.workspace?.width !== before.workspace?.width) {
    fail("El panel derecho no restauró su layout", { before: before.workspace, restored });
  }
}

async function auditRenderIsolation(page) {
  console.log("[audit] abriendo centro de instrumentos y comprobando aislamiento");
  const workspaceBefore = (await collectMetrics(page)).workspace;
  await page.click("#instruments-menu-btn");
  await page.click("#menu-toggle-dock");
  await page.waitForTimeout(650);

  const centerState = await page.evaluate(() => {
    const center = document.querySelector("#bottom-dock");
    const backdrop = document.querySelector("#instrument-center-backdrop");
    const instruments = document.querySelector("#instruments-panel");
    const consolePanel = document.querySelector("#console-panel");
    const rect = (element) => {
      if (!(element instanceof HTMLElement)) return null;
      const bounds = element.getBoundingClientRect();
      return { width: Math.round(bounds.width), height: Math.round(bounds.height) };
    };
    return {
      collapsed: center?.classList.contains("collapsed") ?? true,
      ariaHidden: center?.getAttribute("aria-hidden"),
      position: center instanceof HTMLElement ? getComputedStyle(center).position : null,
      backdropHidden: backdrop?.hasAttribute("hidden") ?? true,
      center: rect(center),
      instruments: rect(instruments),
      consolePanel: rect(consolePanel),
      focusedId: document.activeElement?.id ?? null,
      focusedTag: document.activeElement?.tagName ?? null,
      focusedText: document.activeElement?.textContent?.trim().slice(0, 80) ?? null,
    };
  });
  const workspaceOpen = (await collectMetrics(page)).workspace;
  const centerErrors = [];
  if (centerState.collapsed || centerState.ariaHidden !== "false" || centerState.position !== "fixed") {
    centerErrors.push(`estado inválido: ${JSON.stringify(centerState)}`);
  }
  if (centerState.backdropHidden || centerState.focusedId !== "instrument-center-close") {
    centerErrors.push(`backdrop o foco inválido: ${JSON.stringify(centerState)}`);
  }
  if (!centerState.instruments || centerState.instruments.width < 500 || centerState.instruments.height < 400) {
    centerErrors.push(`área de instrumentos insuficiente: ${JSON.stringify(centerState.instruments)}`);
  }
  if (!centerState.consolePanel || centerState.consolePanel.width < 280 || centerState.consolePanel.height < 400) {
    centerErrors.push(`área de logs insuficiente: ${JSON.stringify(centerState.consolePanel)}`);
  }
  if (workspaceOpen?.width !== workspaceBefore?.width || workspaceOpen?.height !== workspaceBefore?.height) {
    centerErrors.push(`el centro alteró el workspace: antes=${JSON.stringify(workspaceBefore)}, abierto=${JSON.stringify(workspaceOpen)}`);
  }
  if (centerErrors.length > 0) {
    fail("Centro de instrumentos inválido en escritorio", { errors: centerErrors });
  }
  await page.screenshot({
    path: resolve(OUTPUT_DIR, "desktop-instrument-center.png"),
    fullPage: false,
    timeout: 10_000,
  });

  for (const tabId of ["generator", "logic", "fft", "tracer", "oscilloscope"]) {
    await page.click(`#instrument-tab-${tabId}`);
    const tabState = await page.evaluate((activeTabId) => ({
      selected: document.querySelector(`#instrument-tab-${activeTabId}`)?.getAttribute("aria-selected"),
      panelHidden: document.querySelector(`#inst-${activeTabId}`)?.hasAttribute("hidden"),
    }), tabId);
    if (tabState.selected !== "true" || tabState.panelHidden) {
      fail(`No se pudo activar el instrumento ${tabId}`, { tabState });
    }
  }
  await page.keyboard.press("ArrowRight");
  const keyboardTab = await page.evaluate(
    () => document.querySelector("#instrument-tab-generator")?.getAttribute("aria-selected"),
  );
  if (keyboardTab !== "true") {
    fail("Las pestañas de instrumentos no responden a flechas de teclado");
  }
  await page.keyboard.press("ArrowLeft");

  const canvasFingerprint = async (selector) => page.evaluate((canvasSelector) => {
    const canvas = document.querySelector(canvasSelector);
    if (!(canvas instanceof HTMLCanvasElement) || canvas.width <= 0 || canvas.height <= 0) return null;
    const context = canvas.getContext("2d");
    if (!context) return null;
    const pixels = context.getImageData(0, 0, canvas.width, canvas.height).data;
    let hash = 2166136261;
    const stride = Math.max(4, Math.floor(pixels.length / 20_000 / 4) * 4);
    for (let index = 0; index < pixels.length; index += stride) {
      hash ^= pixels[index];
      hash = Math.imul(hash, 16777619);
      hash ^= pixels[index + 1] ?? 0;
      hash = Math.imul(hash, 16777619);
      hash ^= pixels[index + 2] ?? 0;
      hash = Math.imul(hash, 16777619);
      hash ^= pixels[index + 3] ?? 0;
      hash = Math.imul(hash, 16777619);
    }
    return `${canvas.width}x${canvas.height}:${hash >>> 0}`;
  }, selector);

  const schematicBefore = await canvasFingerprint("#circuit-canvas");
  const oscilloscopeBefore = await canvasFingerprint("#osc-canvas");
  await page.click("#instrument-center-close");
  await page.waitForTimeout(300);
  const closed = await page.evaluate(() => ({
    collapsed: document.querySelector("#bottom-dock")?.classList.contains("collapsed") ?? false,
    backdropHidden: document.querySelector("#instrument-center-backdrop")?.hasAttribute("hidden") ?? false,
    focusedId: document.activeElement?.id ?? null,
  }));
  if (!closed.collapsed || !closed.backdropHidden || closed.focusedId !== "instruments-menu-btn") {
    fail("El centro de instrumentos no cerró limpiamente", { closed });
  }

  console.log("[audit] huellas iniciales obtenidas; aplicando zoom");
  await page.click("#btn-zoom-in");
  await page.waitForTimeout(250);
  const schematicAfter = await canvasFingerprint("#circuit-canvas");
  const oscilloscopeAfter = await canvasFingerprint("#osc-canvas");

  if (!schematicBefore || !oscilloscopeBefore) {
    fail("No fue posible obtener la huella de los canvas", { schematicBefore, oscilloscopeBefore });
  }
  if (schematicBefore === schematicAfter) {
    fail("El zoom no provocó un render verificable del esquema", { schematicBefore, schematicAfter });
  }
  if (oscilloscopeBefore !== oscilloscopeAfter) {
    fail("El render del esquema modificó el osciloscopio", { oscilloscopeBefore, oscilloscopeAfter });
  }
}

async function auditMobileInstrumentCenter(page) {
  await page.evaluate(() => {
    document.querySelector("#menu-toggle-dock")?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
  });
  await page.waitForTimeout(450);

  const state = await page.evaluate(() => {
    const rect = (selector) => {
      const element = document.querySelector(selector);
      if (!(element instanceof HTMLElement)) return null;
      const bounds = element.getBoundingClientRect();
      return { width: Math.round(bounds.width), height: Math.round(bounds.height) };
    };
    return {
      center: rect("#bottom-dock"),
      instruments: rect("#instruments-panel"),
      consolePanel: rect("#console-panel"),
      consoleDisplay: getComputedStyle(document.querySelector("#console-panel")).display,
      collapsed: document.querySelector("#bottom-dock")?.classList.contains("collapsed") ?? true,
    };
  });
  const errors = [];
  if (state.collapsed || !state.center || state.center.width < 360 || state.center.height < 680) {
    errors.push(`centro móvil insuficiente: ${JSON.stringify(state.center)}`);
  }
  if (!state.instruments || state.instruments.height < 300) {
    errors.push(`instrumentos móviles insuficientes: ${JSON.stringify(state.instruments)}`);
  }
  if (!state.consolePanel || state.consolePanel.height < 140 || state.consoleDisplay === "none") {
    errors.push(`logs móviles inaccesibles: ${JSON.stringify(state)}`);
  }
  if (errors.length > 0) fail("Centro de instrumentos inválido en móvil", { errors });

  await page.screenshot({
    path: resolve(OUTPUT_DIR, "mobile-instrument-center.png"),
    fullPage: false,
    timeout: 10_000,
  });
  await page.keyboard.press("Escape");
  await page.waitForTimeout(300);
  const closed = await page.evaluate(
    () => document.querySelector("#bottom-dock")?.classList.contains("collapsed") ?? false,
  );
  if (!closed) fail("Escape no cerró el centro de instrumentos en móvil");
}

async function runProductionGuard() {
  console.log(`[audit] comprobando guard de producción en ${BASE_URL}`);
  const preview = await ensurePreview();
  const browser = await chromium.launch({ headless: true });

  try {
    const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
    const pageErrors = [];
    page.on("pageerror", (error) => pageErrors.push(error.message));
    await page.addInitScript(() => localStorage.clear());
    await page.goto(`${BASE_URL}/?audit=1&auditStage=canvas&auditStep=skip-render`, {
      waitUntil: "domcontentloaded",
      timeout: 12_000,
    });
    await page.waitForTimeout(1_200);

    const metrics = await collectMetrics(page);
    if (metrics.audit.stage !== null || metrics.audit.step !== null) {
      fail("La build de producción permitió activar el modo auditoría", { audit: metrics.audit });
    }
    if (metrics.nonTransparentCanvasPixels === 0) {
      fail("La aplicación normal no renderizó el canvas durante el guard de producción");
    }
    if (pageErrors.length > 0) {
      fail("La build de producción generó errores JavaScript", { pageErrors });
    }
  } finally {
    await browser.close();
    await preview.stop();
  }

  console.log("[audit] guard de producción OK: los query params fueron ignorados");
}

async function runAudit() {
  mkdirSync(OUTPUT_DIR, { recursive: true });
  console.log(`[audit] preparando preview en ${BASE_URL}`);
  const preview = await ensurePreview();
  console.log("[audit] iniciando Chromium");
  const browser = await chromium.launch({ headless: true });
  const summary = [];

  try {
    for (const caseConfig of VIEWPORTS) {
      console.log(`[audit] cargando viewport ${caseConfig.name}`);
      const page = await browser.newPage({
        viewport: { width: caseConfig.width, height: caseConfig.height },
      });
      const pageErrors = [];
      page.on("pageerror", (error) => pageErrors.push(error.message));
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
      console.log(`[audit] métricas recogidas para ${caseConfig.name}`);
      assertViewport(caseConfig, metrics);

      const screenshotPath = resolve(OUTPUT_DIR, `${caseConfig.name}.png`);
      await page.screenshot({ path: screenshotPath, fullPage: false, timeout: 10_000 });
      if (caseConfig.name === "desktop") {
        await auditKeyboardFocus(page);
        await auditDesktopPanelCollapse(page);
        await auditRenderIsolation(page);
      } else {
        await auditMobileDrawers(page);
        await auditMobileInstrumentCenter(page);
      }
      console.log(`[audit] interacciones verificadas para ${caseConfig.name}`);
      if (pageErrors.length > 0) {
        fail(`Se detectaron errores JavaScript en ${caseConfig.name}`, { pageErrors });
      }
      summary.push({ name: caseConfig.name, screenshotPath, metrics });
      await page.close();
    }
  } finally {
    console.log("[audit] cerrando Chromium y preview");
    await browser.close();
    await preview.stop();
  }

  const summaryPath = resolve(OUTPUT_DIR, "summary.json");
  writeFileSync(summaryPath, JSON.stringify(summary, null, 2));
  console.log(`Auditoría UI OK. Resultados: ${summaryPath}`);
}

const auditRun = process.argv.includes("--expect-production")
  ? runProductionGuard()
  : runAudit();

auditRun.catch((error) => {
  console.error(error.message);
  process.exit(1);
});
