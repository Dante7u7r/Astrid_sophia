import { mkdir, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

const DEMO_FILE = "01_divisor_rc.astryd";

async function appSnapshot() {
  return browser.execute(() => window.__ASTRYD_E2E__?.snapshot());
}

async function qaState() {
  return browser.execute(() => window.__ASTRYD_QA__);
}

async function dragPaletteComponent(selector, target) {
  await browser.execute((cardSelector, destination) => {
    const card = document.querySelector(cardSelector);
    if (!(card instanceof HTMLElement)) throw new Error(`Componente no encontrado: ${cardSelector}`);
    const source = card.getBoundingClientRect();
    const pointerId = 91;
    card.dispatchEvent(new PointerEvent("pointerdown", {
      bubbles: true,
      button: 0,
      buttons: 1,
      pointerId,
      clientX: source.left + source.width / 2,
      clientY: source.top + source.height / 2,
    }));
    document.dispatchEvent(new PointerEvent("pointermove", {
      bubbles: true,
      buttons: 1,
      pointerId,
      clientX: destination.x,
      clientY: destination.y,
    }));
    document.dispatchEvent(new PointerEvent("pointerup", {
      bubbles: true,
      button: 0,
      pointerId,
      clientX: destination.x,
      clientY: destination.y,
    }));
  }, selector, target);
}

async function wireCanvasPins(from, to) {
  await browser.execute((start, end) => {
    const canvas = document.querySelector("#circuit-canvas");
    if (!(canvas instanceof HTMLCanvasElement)) throw new Error("Lienzo no disponible");
    const mouse = (type, point, buttons) => canvas.dispatchEvent(new MouseEvent(type, {
      bubbles: true,
      button: 0,
      buttons,
      clientX: point.x,
      clientY: point.y,
    }));
    mouse("mousemove", start, 0);
    mouse("mousedown", start, 1);
    mouse("mousemove", end, 1);
    mouse("mouseup", end, 0);
  }, from, to);
}

describe("flujo nativo de escritorio", () => {
  it("carga, simula, guarda, usa instrumentos, edita, cablea y restaura", async () => {
    const canvas = await $("#circuit-canvas");
    await canvas.waitForDisplayed({ timeout: 20_000 });
    await browser.waitUntil(async () => browser.execute(
      () => Boolean(window.__ASTRYD_E2E__ && window.__ASTRYD_QA__?.enabled),
    ), { timeout: 20_000, timeoutMsg: "El puente E2E de la ventana Tauri no se inicializo" });

    const demoSelect = await $("#btn-open-demo");
    await demoSelect.selectByAttribute("value", DEMO_FILE);
    await browser.execute((value) => {
      const select = document.querySelector("#btn-open-demo");
      if (!(select instanceof HTMLSelectElement)) throw new Error("Selector de demos no disponible");
      select.value = value;
      select.dispatchEvent(new Event("change", { bubbles: true }));
    }, DEMO_FILE);
    await browser.waitUntil(async () => (await qaState())?.lastDemoFile === DEMO_FILE, {
      timeout: 15_000,
      timeoutMsg: "La demo no termino de cargar",
    });

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
    await resistor.scrollIntoView();
    const canvasLocation = await canvas.getLocation();
    const canvasSize = await canvas.getSize();
    await dragPaletteComponent("#comp-resistor", {
        x: canvasLocation.x + canvasSize.width * 0.78,
        y: canvasLocation.y + canvasSize.height * 0.72,
    });
    await browser.waitUntil(async () => (await appSnapshot())?.componentCount === 5, {
      timeoutMsg: "Arrastrar el resistor no agrego el componente",
    });

    const edited = await appSnapshot();
    const newResistor = edited.components.find(
      (component) => component.type === "resistor"
        && !baseline.components.some((original) => original.id === component.id),
    );
    const ground = edited.components.find((component) => component.type === "ground");
    expect(newResistor).toBeDefined();
    expect(ground).toBeDefined();
    await wireCanvasPins(
      { x: newResistor.pins[0].clientX, y: newResistor.pins[0].clientY },
      { x: ground.pins[0].clientX, y: ground.pins[0].clientY },
    );
    await browser.waitUntil(async () => (await appSnapshot())?.wireCount === 5, {
      timeoutMsg: "El gesto de cableado no creo la conexion",
    });

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
