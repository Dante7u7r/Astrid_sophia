import { mkdir, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { Key } from "webdriverio";

const DEMO_FILE = "01_divisor_rc.astryd";

async function appSnapshot() {
  return browser.execute(() => window.__ASTRYD_E2E__?.snapshot());
}

async function qaState() {
  return browser.execute(() => window.__ASTRYD_QA__);
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

function expectTrustedEvents(events, requiredTypes) {
  for (const type of requiredTypes) {
    const matching = events.filter((event) => event.type === type);
    expect(matching.length).toBeGreaterThan(0);
    expect(matching.every((event) => event.isTrusted)).toBe(true);
  }
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

    const demoSelect = await $("#btn-open-demo");
    const demoOptionIndex = await browser.execute((value) => {
      const select = document.querySelector("#btn-open-demo");
      if (!(select instanceof HTMLSelectElement)) return -1;
      return [...select.options].findIndex((option) => option.value === value);
    }, DEMO_FILE);
    expect(demoOptionIndex).toBeGreaterThanOrEqual(0);
    await captureTrustedInputEvents();
    await demoSelect.click();
    await browser.keys([
      Key.Home,
      ...Array.from({ length: demoOptionIndex }, () => Key.ArrowDown),
      Key.Enter,
    ]);
    await browser.waitUntil(async () => (await qaState())?.lastDemoFile === DEMO_FILE, {
      timeout: 15_000,
      timeoutMsg: "La demo no termino de cargar",
    });
    expectTrustedEvents(await trustedInputEvents(), ["change"]);

    const baseline = await appSnapshot();
    expect(baseline.componentCount).toBe(4);
    expect(baseline.wireCount).toBe(4);
    expect(baseline.activeTabName).toBe("01_divisor_rc");

    await $("#run-sim-btn").click();
    await browser.waitUntil(async () => (await qaState())?.lastSolver === "rust", {
      timeout: 30_000,
      timeoutMsg: "La simulacion nativa no reporto el solver Rust",
    });
    const simulated = await qaState();
    expect(simulated.lastSimulationMode).toBe("DC");
    expect(Object.keys(simulated.lastDcNodeVoltages)).not.toHaveLength(0);

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

    for (const instrument of ["oscilloscope", "generator", "logic", "fft", "tracer"]) {
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

    const outputDir = resolve("desktop-e2e-results");
    await mkdir(outputDir, { recursive: true });
    await browser.saveScreenshot(join(outputDir, "workflow-complete.png"));
    await rm(savedPath, { force: true });
  });
});
