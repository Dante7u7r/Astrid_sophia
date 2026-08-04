import { mkdir, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { Key } from "webdriverio";

const DEMO_FILE = "01_filtro_rc.astryd";
const DEMO_CASES = [
  { file: "01_filtro_rc.astryd", tab: "01_filtro_rc", mode: "DC", components: 4, wires: 4 },
  { file: "02_puente_rectificador.astryd", tab: "02_puente_rectificador", mode: "TRAN", components: 8, wires: 11 },
  { file: "03_arduino_led.astryd", tab: "03_arduino_led", mode: "TRAN", components: 4, wires: 4 },
  { file: "04_amp_bjt_bode.astryd", tab: "04_amp_bjt_bode", mode: "AC", components: 9, wires: 12 },
];

async function appSnapshot() {
  return browser.execute(() => window.__ASTRYD_E2E__?.snapshot());
}

async function qaState() {
  return browser.execute(() => window.__ASTRYD_QA__);
}

async function selectDemo(filename) {
  const demoSelect = await $("#btn-open-demo");
  const demoOptionIndex = await browser.execute((value) => {
    const select = document.querySelector("#btn-open-demo");
    if (!(select instanceof HTMLSelectElement)) return -1;
    return [...select.options].findIndex((option) => option.value === value);
  }, filename);
  expect(demoOptionIndex).toBeGreaterThanOrEqual(0);
  await demoSelect.click();
  await browser.keys([
    Key.Home,
    ...Array.from({ length: demoOptionIndex }, () => Key.ArrowDown),
    Key.Enter,
  ]);
  await browser.waitUntil(async () => (await qaState())?.lastDemoFile === filename, {
    timeout: 15_000,
    timeoutMsg: `La demo ${filename} no termino de cargar`,
  });
}

async function setFeedbackConsent(mode) {
  const modal = await $("#settings-modal");
  if (!(await modal.getAttribute("class")).includes("open")) {
    await $("#settings-trigger-btn").click();
  }
  const select = await $("#feedback-consent-mode");
  await select.selectByAttribute("value", mode);
  await $("#btn-apply-feedback-consent").click();
  await browser.waitUntil(async () =>
    (await select.getValue()) === mode && await $("#btn-apply-feedback-consent").isEnabled(), {
    timeoutMsg: `No se aplicó el consentimiento de feedback ${mode}`,
  });
  await $("#btn-cancel-settings").click();
}

async function captureTrustedInputEvents() {
  await browser.execute(() => {
    window.__ASTRYD_E2E_INPUT_CAPTURE__?.abort();
    const capture = new AbortController();
    window.__ASTRYD_E2E_INPUT_CAPTURE__ = capture;
    window.__ASTRYD_E2E_INPUT_EVENTS__ = [];
    for (const type of [
      "change",
      "pointerdown",
      "pointermove",
      "pointerup",
      "mousedown",
      "mousemove",
      "mouseup",
    ]) {
      document.addEventListener(type, (event) => {
        const target = event.target instanceof Element
          ? event.target.id || event.target.className || event.target.tagName
          : String(event.target);
        window.__ASTRYD_E2E_INPUT_EVENTS__.push({
          type,
          isTrusted: event.isTrusted,
          target,
          clientX: event.clientX,
          clientY: event.clientY,
          buttons: event.buttons,
        });
      }, { capture: true, signal: capture.signal });
    }
  });
}

async function trustedInputEvents() {
  return browser.execute(() => window.__ASTRYD_E2E_INPUT_EVENTS__ ?? []);
}

async function installExportCapture() {
  await browser.execute(() => {
    window.__ASTRYD_E2E_EXPORTS__ = [];
    const blobs = new Map();
    const originalCreateObjectUrl = URL.createObjectURL.bind(URL);
    URL.createObjectURL = (blob) => {
      const url = originalCreateObjectUrl(blob);
      blobs.set(url, blob);
      return url;
    };
    HTMLAnchorElement.prototype.click = function captureExport() {
      const blob = blobs.get(this.href);
      if (!blob || !this.download) return;
      const filename = this.download;
      void blob.arrayBuffer().then((buffer) => {
        const bytes = new Uint8Array(buffer);
        window.__ASTRYD_E2E_EXPORTS__.push({
          filename,
          type: blob.type,
          size: bytes.byteLength,
          prefix: Array.from(bytes.slice(0, 16)),
          text: blob.type === "application/octet-stream"
            ? ""
            : new TextDecoder().decode(bytes),
        });
      });
    };
  });
}

async function capturedExports() {
  return browser.execute(() => window.__ASTRYD_E2E_EXPORTS__ ?? []);
}

async function clickExportButton(buttonId, expectedCount) {
  const dropdown = await $("#instruments-dropdown");
  if (!(await dropdown.isDisplayed())) await $("#instruments-menu-btn").click();
  await $(`#${buttonId}`).click();
  await browser.waitUntil(async () => (await capturedExports()).length === expectedCount, {
    timeoutMsg: `El exportador ${buttonId} no genero un archivo`,
  });
}

async function oscilloscopeColoredPixels() {
  return browser.execute(() => {
    const canvas = document.querySelector("#osc-canvas");
    if (!(canvas instanceof HTMLCanvasElement)) return 0;
    const context = canvas.getContext("2d");
    if (!context || canvas.width === 0 || canvas.height === 0) return 0;
    const pixels = context.getImageData(0, 0, canvas.width, canvas.height).data;
    let colored = 0;
    for (let index = 0; index < pixels.length; index += 4) {
      const red = pixels[index];
      const green = pixels[index + 1];
      const blue = pixels[index + 2];
      if (Math.max(red, green, blue) - Math.min(red, green, blue) > 45) colored++;
    }
    return colored;
  });
}

function expectTrustedEvents(events, requiredTypes) {
  for (const type of requiredTypes) {
    const matching = events.filter((event) => event.type === type);
    expect(matching.length).toBeGreaterThan(0);
    expect(matching.every((event) => event.isTrusted)).toBe(true);
  }
}

function feedbackBenchmarkNetlist() {
  const components = [
    { id: "V_BENCH", type: "vsource", value: 5, pins: ["1", "0"] },
  ];
  for (let index = 1; index <= 239; index++) {
    components.push({
      id: `RS${index}`,
      type: "resistor",
      value: 1_000,
      pins: [String(index), String(index + 1)],
    });
    components.push({
      id: `RP${index}`,
      type: "resistor",
      value: 100_000,
      pins: [String(index + 1), "0"],
    });
  }
  components.push({ id: "C_BENCH", type: "capacitor", value: 1e-9, pins: ["240", "0"] });
  return { components, wires: [] };
}

function percentile(values, ratio) {
  const sorted = [...values].sort((left, right) => left - right);
  return sorted[Math.min(sorted.length - 1, Math.ceil(sorted.length * ratio) - 1)];
}

async function dragPaletteComponent(source, canvas, targetRatio) {
  const canvasSize = await canvas.getSize();
  await browser.action("pointer", { parameters: { pointerType: "mouse" } })
    .move({ duration: 0, origin: source, x: 0, y: 0 })
    .down({ button: 0 })
    .pause(100)
    .move({ duration: 100, origin: "pointer", x: 20, y: 0 })
    .move({
      duration: 600,
      origin: canvas,
      x: Math.round(canvasSize.width * (targetRatio.x - 0.5)),
      y: Math.round(canvasSize.height * (targetRatio.y - 0.5)),
    })
    .pause(100)
    .up({ button: 0 })
    .perform();
}

async function wireCanvasPins(from, to) {
  await browser.action("pointer", { parameters: { pointerType: "mouse" } })
    .move({ duration: 0, origin: "viewport", x: Math.round(from.x), y: Math.round(from.y) })
    .down({ button: 0 })
    .pause(100)
    .move({ duration: 500, origin: "viewport", x: Math.round(to.x), y: Math.round(to.y) })
    .pause(100)
    .up({ button: 0 })
    .perform();
}

describe("flujo nativo de escritorio", () => {
  it("carga, simula, guarda, usa instrumentos, edita, cablea y restaura", async () => {
    const canvas = await $("#circuit-canvas");
    await canvas.waitForDisplayed({ timeout: 20_000 });
    await browser.waitUntil(async () => browser.execute(
      () => Boolean(window.__ASTRYD_E2E__ && window.__ASTRYD_QA__?.enabled),
    ), { timeout: 20_000, timeoutMsg: "El puente E2E de la ventana Tauri no se inicializo" });

    await captureTrustedInputEvents();
    await selectDemo(DEMO_FILE);
    expectTrustedEvents(await trustedInputEvents(), ["change"]);

    const baseline = await appSnapshot();
    expect(baseline.componentCount).toBe(4);
    expect(baseline.wireCount).toBe(4);
    expect(baseline.activeTabName).toBe("01_filtro_rc");

    const originalFeedback = await browser.tauri.execute(
      (tauri) => tauri.core.invoke("get_feedback_status"),
    );
    const benchmarkNetlist = feedbackBenchmarkNetlist();
    await setFeedbackConsent("disabled");
    const feedbackDisabledBefore = await browser.execute(
      (netlist) => window.__ASTRYD_E2E__.benchmarkFeedbackDc(netlist, 12),
      benchmarkNetlist,
    );
    await setFeedbackConsent("local");
    const feedbackLocalDurations = await browser.execute(
      (netlist) => window.__ASTRYD_E2E__.benchmarkFeedbackDc(netlist, 12),
      benchmarkNetlist,
    );
    await setFeedbackConsent("disabled");
    const feedbackDisabledAfter = await browser.execute(
      (netlist) => window.__ASTRYD_E2E__.benchmarkFeedbackDc(netlist, 12),
      benchmarkNetlist,
    );
    await setFeedbackConsent("local");
    const disabledMedian = (
      percentile(feedbackDisabledBefore.map((sample) => sample.totalMs), 0.5)
      + percentile(feedbackDisabledAfter.map((sample) => sample.totalMs), 0.5)
    ) / 2;
    const localMedian = percentile(feedbackLocalDurations.map((sample) => sample.totalMs), 0.5);
    const typicalOverheadPercent = ((localMedian - disabledMedian) / disabledMedian) * 100;
    const disabledP95 = (
      percentile(feedbackDisabledBefore.map((sample) => sample.totalMs), 0.95)
      + percentile(feedbackDisabledAfter.map((sample) => sample.totalMs), 0.95)
    ) / 2;
    const localP95 = percentile(feedbackLocalDurations.map((sample) => sample.totalMs), 0.95);
    const tailOverheadPercent = ((localP95 - disabledP95) / disabledP95) * 100;
    const instrumentationP95 = percentile(
      feedbackLocalDurations.map((sample) => sample.instrumentationMs),
      0.95,
    );
    const solverP95 = percentile(feedbackLocalDurations.map((sample) => sample.solverMs), 0.95);
    const directInstrumentationPercent = (instrumentationP95 / solverP95) * 100;
    const disabledNonSolverP95 = (
      percentile(feedbackDisabledBefore.map((sample) => sample.totalMs - sample.solverMs), 0.95)
      + percentile(feedbackDisabledAfter.map((sample) => sample.totalMs - sample.solverMs), 0.95)
    ) / 2;
    const localNonSolverP95 = percentile(
      feedbackLocalDurations.map((sample) => sample.totalMs - sample.solverMs),
      0.95,
    );
    const synchronousOverheadPercent = (
      Math.max(0, localNonSolverP95 - disabledNonSolverP95) / solverP95
    ) * 100;
    console.log(
      `[feedback-perf] 480 componentes: raw median=${typicalOverheadPercent.toFixed(2)}%, raw p95=${tailOverheadPercent.toFixed(2)}%, synchronous=${synchronousOverheadPercent.toFixed(2)}%, instrumentation p95=${instrumentationP95.toFixed(3)}ms (${directInstrumentationPercent.toFixed(2)}%)`,
    );
    // Las diferencias crudas incluyen toda la variación temporal del solver y
    // se conservan como diagnóstico. El gate E2E usa únicamente el tramo
    // síncrono no perteneciente al solver; la regresión total requiere una
    // máquina controlada y múltiples corridas, como documenta el presupuesto.
    expect(synchronousOverheadPercent).toBeLessThanOrEqual(3);
    expect(directInstrumentationPercent).toBeLessThanOrEqual(2);
    const feedbackStartedAfter = Date.now() - 1;

    await $("#run-sim-btn").click();
    await browser.waitUntil(async () => (await qaState())?.lastSolver === "rust", {
      timeout: 30_000,
      timeoutMsg: "La simulacion nativa no reporto el solver Rust",
    });
    const simulated = await qaState();
    expect(simulated.lastSimulationMode).toBe("DC");
    expect(Object.keys(simulated.lastDcNodeVoltages)).not.toHaveLength(0);

    await browser.pause(750);
    const feedbackPage = await browser.tauri.execute(
      (tauri, query) => tauri.core.invoke("query_feedback_events", { query }),
      { afterUnixMs: feedbackStartedAfter, limit: 100 },
    );
    const started = feedbackPage.events.find((event) => event.kind === "simulation.started");
    expect(started).toBeDefined();
    const correlated = feedbackPage.events.filter((event) => event.runId === started.runId);
    expect(correlated.map((event) => event.kind)).toEqual(expect.arrayContaining([
      "simulation.started",
      "circuit.summary_created",
      "erc.completed",
      "solver.convergence_summary",
      "simulation.completed",
    ]));
    expect(correlated.every((event) => event.workspaceId === started.workspaceId)).toBe(true);
    expect(started.workspaceId).toMatch(/^fnv1a32:[0-9a-f]{8}$/);
    const persistedFeedback = JSON.stringify(correlated);
    for (const forbidden of ["firmware", "nodeVoltages", "branchCurrents", "01_filtro_rc", "V1", "R1", "C1"]) {
      expect(persistedFeedback).not.toContain(forbidden);
    }
    await installExportCapture();
    const feedbackCenter = await $("#bottom-dock");
    if ((await feedbackCenter.getAttribute("class")).includes("collapsed")) {
      await $("#instruments-menu-btn").click();
      await $("#menu-toggle-dock").click();
    }
    await $('.inst-tab[data-tab="intelligence"]').click();
    await $("#intelligence-refresh-btn").click();
    await browser.waitUntil(async () => Number(await $("#intelligence-event-count").getText()) > 0, {
      timeout: 10_000,
      timeoutMsg: "El centro de inteligencia no mostró los eventos persistidos",
    });
    const firstFeedbackRow = await $("#intelligence-history-body tr");
    await firstFeedbackRow.click();
    expect(await $("#intelligence-privacy-viewer").getText()).toContain('"kind"');
    const eventCountBeforeHumanFeedback = Number(await $("#intelligence-event-count").getText());
    await $('[name="feedback-rating"][value="incorrect"]').click();
    await $("#intelligence-feedback-note").setValue("Valor esperado revisado por la prueba E2E.");
    await $("#intelligence-content-confirm").click();
    await $("#intelligence-feedback-submit").click();
    await browser.waitUntil(
      async () => Number(await $("#intelligence-event-count").getText()) > eventCountBeforeHumanFeedback,
      {
      timeout: 10_000,
      timeoutMsg: "El feedback humano no incrementó el conteo persistido",
      },
    );
    await $("#intelligence-export-btn").click();
    await browser.waitUntil(async () => (await capturedExports()).length === 1, {
      timeout: 10_000,
      timeoutMsg: "El centro de inteligencia no exportó el paquete redactado",
    });
    const supportExport = (await capturedExports())[0];
    const supportBundle = JSON.parse(supportExport.text);
    expect(supportBundle.manifest.format).toBe("astryd-feedback-support");
    expect(supportBundle.manifest.formatVersion).toBe(2);
    expect(supportBundle.summaryMarkdown).toContain("# Diagnóstico de Astryd Sophia");
    expect(supportExport.text).not.toContain(started.eventId);
    expect(supportExport.text).not.toContain(started.runId);
    await $("#intelligence-shadow-evaluate").click();
    await browser.waitUntil(async () => (await $("#intelligence-shadow-status").getText()).includes("500"), {
      timeout: 10_000,
      timeoutMsg: "El modo sombra no informó su bloqueo por datos insuficientes",
    });
    await $("#instrument-center-close").click();

    await browser.tauri.execute(
      (tauri, request) => tauri.core.invoke("delete_feedback_data", { request }),
      { scope: "session", sessionId: started.sessionId },
    );
    await setFeedbackConsent(originalFeedback.consentMode);

    const serialized = await browser.execute(() => window.__ASTRYD_E2E__.serializeCircuit());
    const savedPath = join(tmpdir(), `astryd-desktop-e2e-${process.pid}.astryd`);
    await browser.tauri.execute(
      (tauri, path, content) => tauri.core.invoke("save_circuit_to_path", { path, content }),
      savedPath,
      serialized,
    );
    expect(await readFile(savedPath, "utf8")).toBe(serialized);

    const center = await $("#bottom-dock");
    if (!(await center.getAttribute("class")).includes("collapsed")) {
      await $("#instrument-center-close").click();
      await browser.waitUntil(async () => (await center.getAttribute("class")).includes("collapsed"));
    }
    await $("#instruments-menu-btn").click();
    await $("#menu-toggle-dock").click();
    await browser.waitUntil(async () => !(await center.getAttribute("class")).includes("collapsed"), {
      timeoutMsg: "El centro de instrumentos no se abrio",
    });

    for (const instrument of ["oscilloscope", "generator", "logic", "fft", "tracer", "intelligence"]) {
      await $(`.inst-tab[data-tab="${instrument}"]`).click();
      await browser.waitUntil(async () => (await qaState())?.activeInstrumentTab === instrument, {
        timeoutMsg: `No se activo el instrumento ${instrument}`,
      });
      expect(await $(`#inst-${instrument}`).isDisplayed()).toBe(true);
    }
    expect(await $("#console-panel").isDisplayed()).toBe(true);
    await $("#instrument-center-close").click();
    await browser.waitUntil(async () => (await center.getAttribute("class")).includes("collapsed"));

    const resistor = await $("#comp-resistor");
    await captureTrustedInputEvents();
    await dragPaletteComponent(resistor, canvas, { x: 0.78, y: 0.72 });
    const paletteEvents = await trustedInputEvents();
    await browser.waitUntil(async () => (await appSnapshot())?.componentCount === 5, {
      timeoutMsg: "Arrastrar el resistor no agrego el componente",
    });
    expectTrustedEvents(paletteEvents, ["pointerdown", "pointermove", "pointerup"]);
    expect(paletteEvents.some((event) => event.type === "pointermove" && event.buttons === 1)).toBe(true);

    const edited = await appSnapshot();
    const newResistor = edited.components.find(
      (component) => component.type === "resistor"
        && !baseline.components.some((original) => original.id === component.id),
    );
    const ground = edited.components.find((component) => component.type === "ground");
    expect(newResistor).toBeDefined();
    expect(ground).toBeDefined();
    await captureTrustedInputEvents();
    await wireCanvasPins(
      { x: newResistor.pins[0].clientX, y: newResistor.pins[0].clientY },
      { x: ground.pins[0].clientX, y: ground.pins[0].clientY },
    );
    await browser.waitUntil(async () => (await appSnapshot())?.wireCount === 5, {
      timeoutMsg: "El gesto de cableado no creo la conexion",
    });
    const wireEvents = await trustedInputEvents();
    expectTrustedEvents(wireEvents, ["mousedown", "mousemove", "mouseup"]);
    expect(wireEvents.some((event) => event.type === "mousemove" && event.buttons === 1)).toBe(true);

    const loaded = await browser.execute(
      (content) => window.__ASTRYD_E2E__.loadSerializedCircuit(content),
      serialized,
    );
    expect(loaded).toBe(true);
    const restored = await appSnapshot();
    expect(restored.componentCount).toBe(4);
    expect(restored.wireCount).toBe(4);

    const qaTimestampBeforeResimulation = (await qaState()).lastUpdatedAt;
    await $("#run-sim-btn").click();
    await browser.waitUntil(async () => {
      const state = await qaState();
      return state?.lastUpdatedAt !== qaTimestampBeforeResimulation
        && state?.lastSimulationMode === "DC"
        && state?.lastSolver === "rust"
        && state?.simulationRunning === false;
    }, {
      timeout: 30_000,
      timeoutMsg: "La simulacion DC posterior a la restauracion no termino",
    });

    await installExportCapture();
    await clickExportButton("export-csv-btn", 1);
    await clickExportButton("export-svg-btn", 2);
    await clickExportButton("export-h5-btn", 3);
    const exports = await capturedExports();
    expect(exports[0].filename).toBe("reporte_punto_operacion_cc.csv");
    expect(exports[0].text).toContain("Nodo,Voltaje Operacion (V)");
    expect(exports[0].size).toBeGreaterThan(30);
    expect(exports[1].filename).toBe("grafico_simulacion.svg");
    expect(exports[1].text).toContain("<svg");
    expect(exports[1].text).toContain("Astryd Sophia");
    expect(exports[2].filename).toBe("reporte_punto_operacion_cc.h5");
    expect(exports[2].prefix.slice(0, 8)).toEqual([0x89, 0x48, 0x44, 0x46, 0x0d, 0x0a, 0x1a, 0x0a]);
    expect(exports[2].size).toBeGreaterThan(32);

    const analysisSelect = await $("#analysis-mode-select");
    const pvtOptionIndex = await browser.execute(() => {
      const select = document.querySelector("#analysis-mode-select");
      if (!(select instanceof HTMLSelectElement)) return -1;
      return [...select.options].findIndex((option) => option.value === "PVT");
    });
    expect(pvtOptionIndex).toBeGreaterThanOrEqual(0);
    await analysisSelect.click();
    await browser.keys([
      Key.Home,
      ...Array.from({ length: pvtOptionIndex }, () => Key.ArrowDown),
      Key.Enter,
    ]);
    await $("#run-sim-btn").click();
    const commercialProfile = await $(".pvt-profile-btn");
    await commercialProfile.waitForDisplayed({ timeout: 15_000 });
    await commercialProfile.click();
    await browser.waitUntil(async () => {
      const snapshot = await appSnapshot();
      return snapshot?.analysisMode === "PVT"
        && snapshot?.pvtMode === true
        && snapshot?.pvtTraceCount > 0
        && (await qaState())?.simulationRunning === false;
    }, {
      timeout: 90_000,
      timeoutMsg: "La matriz PVT nativa no produjo trazas",
    });

    if ((await center.getAttribute("class")).includes("collapsed")) {
      await $("#instruments-menu-btn").click();
      await $("#menu-toggle-dock").click();
    }
    await $('.inst-tab[data-tab="oscilloscope"]').click();
    await browser.waitUntil(async () => (await oscilloscopeColoredPixels()) > 50, {
      timeoutMsg: "Las trazas PVT no se dibujaron en el osciloscopio",
    });

    const outputDir = resolve("desktop-e2e-results");
    await mkdir(outputDir, { recursive: true });
    await browser.saveScreenshot(join(outputDir, "workflow-complete.png"));
    await rm(savedPath, { force: true });
  });

  it("carga, encuadra y simula todas las demos con el solver nativo", async () => {
    const canvas = await $("#circuit-canvas");
    await canvas.waitForDisplayed({ timeout: 20_000 });
    const instrumentCenter = await $("#bottom-dock");
    if ((await instrumentCenter.getAttribute("aria-hidden")) !== "true") {
      await $("#instrument-center-close").click();
      await browser.waitUntil(
        async () => (await instrumentCenter.getAttribute("aria-hidden")) === "true",
        { timeoutMsg: "El centro de instrumentos no se cerro antes de revisar las demos" },
      );
    }
    const outputDir = resolve("desktop-e2e-results", "demos");
    await mkdir(outputDir, { recursive: true });

    for (const demo of DEMO_CASES) {
      await selectDemo(demo.file);
      const closeInstrumentCenter = await $("#instrument-center-close");
      if (await closeInstrumentCenter.isDisplayed()) {
        await closeInstrumentCenter.click();
        await browser.waitUntil(
          async () => !(await closeInstrumentCenter.isDisplayed()),
          { timeoutMsg: `El centro de instrumentos cubre el esquema ${demo.file}` },
        );
      }
      const snapshot = await appSnapshot();
      expect(snapshot.componentCount).toBe(demo.components);
      expect(snapshot.wireCount).toBe(demo.wires);
      expect(snapshot.activeTabName).toBe(demo.tab);
      expect(snapshot.analysisMode).toBe(demo.mode);

      const canvasLocation = await canvas.getLocation();
      const canvasSize = await canvas.getSize();
      for (const component of snapshot.components) {
        expect(component.clientX).toBeGreaterThan(canvasLocation.x + 20);
        expect(component.clientX).toBeLessThan(canvasLocation.x + canvasSize.width - 20);
        expect(component.clientY).toBeGreaterThan(canvasLocation.y + 20);
        expect(component.clientY).toBeLessThan(canvasLocation.y + canvasSize.height - 20);
      }
      await canvas.moveTo({ xOffset: 12, yOffset: 12 });
      await browser.saveScreenshot(join(outputDir, `${demo.tab}-schematic.png`));

      const beforeRun = (await qaState()).lastUpdatedAt;
      await $("#run-sim-btn").click();
      await browser.waitUntil(async () => {
        const state = await qaState();
        return state?.lastUpdatedAt !== beforeRun
          && state?.lastSimulationMode === demo.mode
          && state?.lastSolver === "rust"
          && state?.simulationRunning === false;
      }, {
        timeout: 90_000,
        timeoutMsg: `La simulacion nativa de ${demo.file} no termino correctamente`,
      });

      const finalState = await qaState();
      if (finalState.lastLogType === "error") {
        throw new Error(`${demo.file} termino con error: ${finalState.lastLog}`);
      }
    }
  });
});
