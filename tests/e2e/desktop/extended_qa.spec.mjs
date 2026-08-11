import { mkdir } from "node:fs/promises";
import { resolve } from "node:path";
import { Key } from "webdriverio";

const COMPONENT_BATCHES = [
  [
    ["comp-resistor", "resistor", 2],
    ["comp-capacitor", "capacitor", 2],
    ["comp-inductor", "inductor", 2],
    ["comp-potentiometer", "potentiometer", 3],
    ["comp-ldr", "ldr", 2],
    ["comp-thermistor", "thermistor", 2],
    ["comp-ground", "ground", 1],
  ],
  [
    ["comp-dmm", "dmm", 2],
    ["comp-vsource", "vsource", 2],
    ["comp-isource", "isource", 2],
    ["comp-transformer", "transformer", 4],
    ["comp-diode", "diode", 2],
    ["comp-nmos", "nmos", 3],
    ["comp-pmos", "pmos", 3],
  ],
  [
    ["comp-npn", "npn", 3],
    ["comp-pnp", "pnp", 3],
    ["comp-led", "led", 2],
    ["comp-opamp", "opamp", 5],
    ["comp-lamp", "lamp", 2],
    ["comp-relay", "relay", 4],
    ["comp-buzzer", "buzzer", 2],
  ],
  [
    ["comp-switch", "switch", 2],
    ["comp-mcu-8051", "mcu_8051", 40],
    ["comp-mcu-avr", "mcu_avr", 28],
    ["comp-arduino-uno", "arduino_uno", 6],
    ["comp-esp32", "esp32", 6],
    ["comp-rpi-pico", "raspberry_pi_pico", 6],
    ["comp-subcircuit", "x", 4],
  ],
];

let emptyCircuit;

async function appSnapshot() {
  return browser.execute(() => window.__ASTRYD_E2E__?.snapshot());
}

async function qaState() {
  return browser.execute(() => window.__ASTRYD_QA__);
}

async function serializedCircuit() {
  return browser.execute(() => window.__ASTRYD_E2E__.serializeCircuit());
}

async function parsedCircuit() {
  return JSON.parse(await serializedCircuit());
}

async function loadCircuit(circuit) {
  const content = typeof circuit === "string" ? circuit : JSON.stringify(circuit);
  return browser.execute(
    (serialized) => window.__ASTRYD_E2E__.loadSerializedCircuit(serialized),
    content,
  );
}

async function consoleText() {
  return browser.execute(
    () => document.querySelector("#console-output")?.textContent ?? "",
  );
}

async function clearConsole() {
  const center = await $("#bottom-dock");
  if ((await center.getAttribute("aria-hidden")) === "true") {
    await openInstrumentsMenu();
    await $("#menu-toggle-dock").click();
    await browser.waitUntil(
      async () => (await center.getAttribute("aria-hidden")) === "false",
      { timeoutMsg: "El centro de instrumentos no se abrio para limpiar la consola" },
    );
  }
  await $("#clear-console-btn").click();
  await browser.waitUntil(async () => (await consoleText()).includes("Consola limpia"));
}

async function closeInstrumentCenter() {
  const center = await $("#bottom-dock");
  if ((await center.getAttribute("aria-hidden")) !== "true") {
    await $("#instrument-center-close").click();
    await browser.waitUntil(
      async () => (await center.getAttribute("aria-hidden")) === "true",
      { timeoutMsg: "El centro de instrumentos no se cerro" },
    );
  }
}

async function setSelectValue(selector, value) {
  const select = await $(selector);
  const optionIndex = await browser.execute((cssSelector, targetValue) => {
    const element = document.querySelector(cssSelector);
    if (!(element instanceof HTMLSelectElement)) return -1;
    return [...element.options].findIndex((option) => option.value === targetValue);
  }, selector, value);
  expect(optionIndex).toBeGreaterThanOrEqual(0);
  await select.click();
  await browser.keys([
    Key.Home,
    ...Array.from({ length: optionIndex }, () => Key.ArrowDown),
    Key.Enter,
  ]);
}

async function resetToEmpty() {
  expect(await loadCircuit(emptyCircuit)).toBe(true);
  await closeInstrumentCenter();
}

async function showPaletteComponent(cardId) {
  const card = await $(`#${cardId}`);
  const search = await $("#component-search");
  await clearPaletteSearch();
  const componentName = await browser.execute(
    (id) => document.querySelector(`#${id} .comp-name`)?.textContent?.trim() ?? "",
    cardId,
  );
  expect(componentName.length).toBeGreaterThan(0);
  await search.setValue(componentName);
  await card.waitForDisplayed({
    timeoutMsg: `La busqueda no mostro ${cardId}`,
  });
  await card.scrollIntoView({ block: "center", inline: "nearest" });
  return card;
}

async function clearPaletteSearch() {
  const search = await $("#component-search");
  await search.click();
  await browser.keys([Key.Control, "a", Key.Backspace]);
}

async function placePaletteComponentWithKeyboard(cardId) {
  const card = await showPaletteComponent(cardId);
  await card.click();
  await browser.keys(Key.Enter);
  await browser.waitUntil(async () => (await appSnapshot())?.componentCount === 1, {
    timeoutMsg: `La insercion accesible de ${cardId} no creo el componente`,
  });
}

async function dragPaletteComponent(cardId, canvas, targetRatio) {
  const source = await showPaletteComponent(cardId);
  const canvasSize = await canvas.getSize();
  const beforeCount = (await appSnapshot()).componentCount;
  await browser.action("pointer", { parameters: { pointerType: "mouse" } })
    .move({ duration: 0, origin: source, x: 0, y: 0 })
    .down({ button: 0 })
    .pause(80)
    .move({ duration: 100, origin: "pointer", x: 20, y: 0 })
    .move({
      duration: 450,
      origin: canvas,
      x: Math.round(canvasSize.width * (targetRatio.x - 0.5)),
      y: Math.round(canvasSize.height * (targetRatio.y - 0.5)),
    })
    .pause(80)
    .up({ button: 0 })
    .perform();
  await browser.waitUntil(async () => (await appSnapshot()).componentCount === beforeCount + 1, {
    timeoutMsg: `Arrastrar ${cardId} no creo el componente`,
  });
}

async function wirePins(from, to, expectedWireCount) {
  await browser.action("pointer", { parameters: { pointerType: "mouse" } })
    .move({ duration: 0, origin: "viewport", x: Math.round(from.clientX), y: Math.round(from.clientY) })
    .down({ button: 0 })
    .pause(80)
    .move({ duration: 420, origin: "viewport", x: Math.round(to.clientX), y: Math.round(to.clientY) })
    .pause(80)
    .up({ button: 0 })
    .perform();
  await browser.waitUntil(async () => (await appSnapshot()).wireCount === expectedWireCount, {
    timeoutMsg: `El cable ${expectedWireCount} no se creo`,
  });
}

async function brightPixelsAround(clientX, clientY) {
  return browser.execute((x, y) => {
    const canvas = document.querySelector("#circuit-canvas");
    if (!(canvas instanceof HTMLCanvasElement)) return 0;
    const context = canvas.getContext("2d");
    if (!context) return 0;
    const rect = canvas.getBoundingClientRect();
    const scaleX = canvas.width / rect.width;
    const scaleY = canvas.height / rect.height;
    const sampleWidth = Math.min(180 * scaleX, canvas.width);
    const sampleHeight = Math.min(180 * scaleY, canvas.height);
    const left = Math.max(0, Math.min(canvas.width - sampleWidth, (x - rect.left) * scaleX - sampleWidth / 2));
    const top = Math.max(0, Math.min(canvas.height - sampleHeight, (y - rect.top) * scaleY - sampleHeight / 2));
    const pixels = context.getImageData(left, top, sampleWidth, sampleHeight).data;
    let bright = 0;
    for (let index = 0; index < pixels.length; index += 4) {
      if (Math.max(pixels[index], pixels[index + 1], pixels[index + 2]) >= 105) bright++;
    }
    return bright;
  }, clientX, clientY);
}

function circuitFile(components, wires, mode = "DC") {
  return {
    version: "3.0",
    components,
    wires,
    viewport: { zoom: 1, offsetX: 520, offsetY: 300 },
    simSettings: { dt: 0.00001, tolerance: 0.00001, maxIterations: 100 },
    activeAnalysisMode: mode,
    probes: {
      ch1ProbeNode: null,
      ch2ProbeNode: null,
      ch3ProbeNode: null,
      ch4ProbeNode: null,
    },
    sparPorts: [],
  };
}

function component(id, type, value, x, y) {
  return { id, type, value, x, y, rotation: 0 };
}

function wire(id, fromId, fromPin, toId, toPin) {
  return {
    id,
    from: { componentId: fromId, pinIndex: fromPin },
    to: { componentId: toId, pinIndex: toPin },
    points: [],
  };
}

async function runAndWaitForConsole(fragment) {
  const before = (await qaState()).lastUpdatedAt;
  await $("#run-sim-btn").click();
  await browser.waitUntil(async () => {
    const state = await qaState();
    return state?.lastUpdatedAt !== before
      && state?.simulationRunning === false
      && (await consoleText()).includes(fragment);
  }, {
    timeout: 45_000,
    timeoutMsg: `La ejecucion no produjo el diagnostico: ${fragment}`,
  });
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
    const captureAnchor = (anchor) => {
      if (!anchor.download || !anchor.href) return;
      const blob = blobs.get(anchor.href);
      const readBuffer = blob
        ? blob.arrayBuffer()
        : fetch(anchor.href).then((response) => response.arrayBuffer());
      void readBuffer.then((buffer) => {
        const bytes = new Uint8Array(buffer);
        window.__ASTRYD_E2E_EXPORTS__.push({
          filename: anchor.download,
          type: blob?.type ?? "",
          size: bytes.byteLength,
          prefix: Array.from(bytes.slice(0, 8)),
        });
      });
    };
    HTMLAnchorElement.prototype.click = function captureExport() {
      captureAnchor(this);
    };
    const originalDispatchEvent = EventTarget.prototype.dispatchEvent;
    EventTarget.prototype.dispatchEvent = function captureDetachedExport(event) {
      if (this instanceof HTMLAnchorElement && event.type === "click") {
        captureAnchor(this);
        return true;
      }
      return originalDispatchEvent.call(this, event);
    };
    document.addEventListener("click", (event) => {
      const anchor = event.target instanceof Element
        ? event.target.closest("a")
        : null;
      if (anchor instanceof HTMLAnchorElement) captureAnchor(anchor);
    }, { capture: true });
  });
}

async function openInstrumentsMenu() {
  const dropdown = await $("#instruments-dropdown");
  if (!(await dropdown.isDisplayed())) await $("#instruments-menu-btn").click();
}

describe("QA nativo extendido de escritorio", () => {
  before(async () => {
    const canvas = await $("#circuit-canvas");
    await canvas.waitForDisplayed({ timeout: 20_000 });
    await browser.waitUntil(async () => browser.execute(
      () => Boolean(window.__ASTRYD_E2E__ && window.__ASTRYD_QA__?.enabled),
    ), { timeout: 20_000, timeoutMsg: "El puente E2E de Tauri no se inicializo" });

    await $("#btn-new-circuit").click();
    await browser.waitUntil(async () => (await appSnapshot())?.componentCount === 0);
    emptyCircuit = await serializedCircuit();
    await closeInstrumentCenter();
  });

  it("verifica controles, busqueda, paneles, ajustes, zoom, rejilla y consola", async () => {
    await resetToEmpty();

    expect(await $("#ipc-status-text").getText()).toBe("Conexión Lista");
    expect(await $("#ipc-status-dot").getAttribute("class")).toContain("active");
    expect(await $("#stop-sim-btn").isEnabled()).toBe(false);
    const analysisOptions = await browser.execute(() => {
      const select = document.querySelector("#analysis-mode-select");
      return select instanceof HTMLSelectElement
        ? [...select.options].map((option) => option.value)
        : [];
    });
    expect(analysisOptions).toEqual(["DC", "AC", "TRAN", "SENS", "PSS", "STB", "PVT", "SPAR"]);

    const search = await $("#component-search");
    await search.setValue("arduino");
    expect(await $("#comp-arduino-uno").isDisplayed()).toBe(true);
    expect(await $("#comp-resistor").isDisplayed()).toBe(false);
    await clearPaletteSearch();
    expect(await $("#comp-resistor").isDisplayed()).toBe(true);

    const initialZoom = (await parsedCircuit()).viewport.zoom;
    await $("#btn-zoom-in").click();
    expect((await parsedCircuit()).viewport.zoom).toBeGreaterThan(initialZoom);
    await $("#btn-zoom-out").click();

    const snap = await $("#btn-snap-grid");
    expect(await snap.getAttribute("aria-pressed")).toBe("true");
    await snap.click();
    expect(await snap.getAttribute("aria-pressed")).toBe("false");
    await snap.click();
    expect(await snap.getAttribute("aria-pressed")).toBe("true");

    const leftToggle = await $("#btn-toggle-left");
    const leftBefore = await leftToggle.getAttribute("aria-expanded");
    await leftToggle.click();
    await browser.waitUntil(async () => (await leftToggle.getAttribute("aria-expanded")) !== leftBefore);
    await browser.keys("F9");
    await browser.waitUntil(async () => (await leftToggle.getAttribute("aria-expanded")) === leftBefore);

    const rightToggle = await $("#btn-toggle-right");
    const rightBefore = await rightToggle.getAttribute("aria-expanded");
    await browser.keys("F10");
    await browser.waitUntil(async () => (await rightToggle.getAttribute("aria-expanded")) !== rightBefore);
    await browser.keys("F10");
    await browser.waitUntil(async () => (await rightToggle.getAttribute("aria-expanded")) === rightBefore);

    const settingsTrigger = await $("#settings-trigger-btn");
    await settingsTrigger.click();
    const modal = await $("#settings-modal");
    await browser.waitUntil(async () => (await modal.getAttribute("aria-hidden")) === "false");
    expect(await browser.execute(() => document.activeElement?.id)).toBe("settings-dt-input");
    await $("#settings-dt-input").setValue("0.00002");
    await $("#settings-tol-input").setValue("0.000002");
    await $("#settings-iter-input").setValue("180");
    await $("#btn-save-settings").click();
    await browser.waitUntil(async () => (await modal.getAttribute("aria-hidden")) === "true");
    const settings = (await parsedCircuit()).simSettings;
    expect(settings).toEqual({ dt: 0.00002, tolerance: 0.000002, maxIterations: 180 });
    expect(await browser.execute(() => document.activeElement?.id)).toBe("settings-trigger-btn");

    await clearConsole();
    expect(await consoleText()).toContain("Consola limpia");
    await runAndWaitForConsole("El lienzo está vacío");
    expect((await qaState()).lastSolver).not.toBe("rust");
  });

  COMPONENT_BATCHES.forEach((batch, batchIndex) => {
    it(`inserta y dibuja componentes de biblioteca, lote ${batchIndex + 1}`, async () => {
      const canvas = await $("#circuit-canvas");
      const canvasLocation = await canvas.getLocation();
      const canvasSize = await canvas.getSize();

      for (const [cardId, expectedType, expectedPins] of batch) {
        await resetToEmpty();
        const emptyCenterX = canvasLocation.x + canvasSize.width / 2;
        const emptyCenterY = canvasLocation.y + canvasSize.height / 2;
        const pixelsBefore = await brightPixelsAround(emptyCenterX, emptyCenterY);

        await placePaletteComponentWithKeyboard(cardId);
        const snapshot = await appSnapshot();
        expect(snapshot.components).toHaveLength(1);
        const placed = snapshot.components[0];
        expect(placed.type).toBe(expectedType);
        expect(placed.pins).toHaveLength(expectedPins);
        expect(Number.isFinite(placed.clientX)).toBe(true);
        expect(Number.isFinite(placed.clientY)).toBe(true);
        expect(placed.clientX).toBeGreaterThan(canvasLocation.x);
        expect(placed.clientX).toBeLessThan(canvasLocation.x + canvasSize.width);
        expect(placed.clientY).toBeGreaterThan(canvasLocation.y);
        expect(placed.clientY).toBeLessThan(canvasLocation.y + canvasSize.height);
        expect(placed.pins.every((pin) =>
          Number.isFinite(pin.clientX) && Number.isFinite(pin.clientY))).toBe(true);

        const pixelsAfter = await brightPixelsAround(placed.clientX, placed.clientY);
        expect(pixelsAfter).toBeGreaterThan(pixelsBefore + 5);
      }
      await clearPaletteSearch();
    });
  });

  it("edita, renombra, rota, refleja, duplica y elimina un componente", async () => {
    await resetToEmpty();
    await placePaletteComponentWithKeyboard("comp-resistor");

    const idInput = await $("#prop-id-input");
    const valueInput = await $("#prop-val-input");
    await idInput.setValue("R_TEST");
    await valueInput.setValue("2.2k");
    await $("#btn-apply-properties").click();
    let data = await parsedCircuit();
    expect(data.components[0].id).toBe("R_TEST");
    expect(data.components[0].value).toBe(2200);

    await browser.keys("r");
    data = await parsedCircuit();
    expect(data.components[0].rotation).toBe(90);
    await browser.keys("m");
    data = await parsedCircuit();
    expect(data.components[0].mirror).toBe(true);

    await browser.keys([Key.Control, "d"]);
    await browser.waitUntil(async () => (await appSnapshot()).componentCount === 2);
    const duplicated = await parsedCircuit();
    expect(new Set(duplicated.components.map((item) => item.id)).size).toBe(2);

    await browser.keys(Key.Delete);
    await browser.waitUntil(async () => (await appSnapshot()).componentCount === 1);
    await $("#btn-clear-canvas").click();
    await browser.waitUntil(async () => (await appSnapshot()).componentCount === 0);
    expect(await consoleText()).toContain("Lienzo vaciado por completo");
  });

  it("construye un divisor desde cero con drag, cablea y simula en Rust", async () => {
    await resetToEmpty();
    const canvas = await $("#circuit-canvas");

    await dragPaletteComponent("comp-vsource", canvas, { x: 0.24, y: 0.45 });
    await dragPaletteComponent("comp-resistor", canvas, { x: 0.45, y: 0.34 });
    await dragPaletteComponent("comp-resistor", canvas, { x: 0.68, y: 0.48 });
    await dragPaletteComponent("comp-ground", canvas, { x: 0.48, y: 0.72 });
    await clearPaletteSearch();

    let snapshot = await appSnapshot();
    expect(snapshot.componentCount).toBe(4);
    const source = snapshot.components.find((item) => item.type === "vsource");
    const resistors = snapshot.components.filter((item) => item.type === "resistor");
    const ground = snapshot.components.find((item) => item.type === "ground");
    expect(source).toBeDefined();
    expect(resistors).toHaveLength(2);
    expect(ground).toBeDefined();

    await wirePins(source.pins[0], resistors[0].pins[0], 1);
    snapshot = await appSnapshot();
    await wirePins(
      snapshot.components.find((item) => item.id === resistors[0].id).pins[1],
      snapshot.components.find((item) => item.id === resistors[1].id).pins[0],
      2,
    );
    snapshot = await appSnapshot();
    await wirePins(
      snapshot.components.find((item) => item.id === resistors[1].id).pins[1],
      snapshot.components.find((item) => item.id === ground.id).pins[0],
      3,
    );
    snapshot = await appSnapshot();
    await wirePins(
      snapshot.components.find((item) => item.id === source.id).pins[1],
      snapshot.components.find((item) => item.id === ground.id).pins[0],
      4,
    );

    const handBuiltCircuit = await parsedCircuit();
    const actualConnections = handBuiltCircuit.wires
      .map((item) => [
        `${item.from.componentId}:${item.from.pinIndex}`,
        `${item.to.componentId}:${item.to.pinIndex}`,
      ].sort().join("<->"))
      .sort();
    const expectedConnections = [
      [`${source.id}:0`, `${resistors[0].id}:0`],
      [`${resistors[0].id}:1`, `${resistors[1].id}:0`],
      [`${resistors[1].id}:1`, `${ground.id}:0`],
      [`${source.id}:1`, `${ground.id}:0`],
    ].map((item) => item.sort().join("<->")).sort();
    expect(actualConnections).toEqual(expectedConnections);

    await clearConsole();
    const beforeRun = (await qaState()).lastUpdatedAt;
    await $("#run-sim-btn").click();
    await browser.waitUntil(async () => {
      const state = await qaState();
      return state?.lastUpdatedAt !== beforeRun
        && state?.lastSolver === "rust"
        && state?.lastSimulationMode === "DC"
        && state?.simulationRunning === false;
    }, { timeout: 45_000, timeoutMsg: "El divisor construido a mano no termino en Rust" });

    const voltages = Object.values((await qaState()).lastDcNodeVoltages);
    expect(voltages.some((value) => Math.abs(Math.abs(value) - 2.5) < 0.05)).toBe(true);
    expect(await consoleText()).not.toContain("ERC FALLIDO");

    await openInstrumentsMenu();
    await $("#menu-run-erc").click();
    await browser.waitUntil(async () => (await consoleText()).includes("ERC completado exitosamente"));

    const outputDir = resolve("desktop-e2e-results", "extended");
    await mkdir(outputDir, { recursive: true });
    await closeInstrumentCenter();
    await browser.saveScreenshot(resolve(outputDir, "divider-built-from-scratch.png"));
  });

  it("provoca y diagnostica lienzo vacio, falta de GND, corto y lazo ideal", async () => {
    await resetToEmpty();
    await clearConsole();
    await runAndWaitForConsole("El lienzo está vacío");

    const noGround = circuitFile(
      [
        component("V1", "vsource", 5, -100, 0),
        component("R1", "resistor", 1000, 100, 0),
      ],
      [
        wire("w1", "V1", 0, "R1", 0),
        wire("w2", "V1", 1, "R1", 1),
      ],
    );
    expect(await loadCircuit(noGround)).toBe(true);
    await clearConsole();
    await runAndWaitForConsole("Referencia a Tierra");
    expect(await consoleText()).toContain("Pre-flight ERC");

    const shortedSource = circuitFile(
      [
        component("V1", "vsource", 5, -80, 0),
        component("GND1", "ground", 0, 80, 0),
      ],
      [
        wire("w1", "V1", 0, "GND1", 0),
        wire("w2", "V1", 1, "GND1", 0),
      ],
    );
    expect(await loadCircuit(shortedSource)).toBe(true);
    await clearConsole();
    await runAndWaitForConsole("Cortocircuito Franco");

    const idealLoop = circuitFile(
      [
        component("V1", "vsource", 5, -120, -80),
        component("V2", "vsource", 3, 120, -80),
        component("V3", "vsource", 2, 0, 100),
        component("GND1", "ground", 0, -220, -80),
      ],
      [
        wire("w1", "V1", 0, "V2", 1),
        wire("w2", "V2", 0, "V3", 1),
        wire("w3", "V3", 0, "V1", 1),
        wire("w4", "GND1", 0, "V1", 0),
      ],
    );
    expect(await loadCircuit(idealLoop)).toBe(true);
    await clearConsole();
    await runAndWaitForConsole("Bucle de fuentes de tensión");
  });

  it("bloquea un pin flotante durante el preflight topologico", async () => {
    const floatingPin = circuitFile(
      [
        component("V1", "vsource", 5, -180, 0),
        component("R1", "resistor", 1000, 0, 0),
        component("R2", "resistor", 1000, 160, 0),
        component("GND1", "ground", 0, 0, 140),
      ],
      [
        wire("w1", "V1", 0, "R1", 0),
        wire("w2", "V1", 1, "GND1", 0),
        wire("w3", "R1", 1, "GND1", 0),
        wire("w4", "R2", 0, "R1", 0),
      ],
    );
    expect(await loadCircuit(floatingPin)).toBe(true);
    await clearConsole();
    await runAndWaitForConsole("Nodo huérfano detectado");
    expect(await consoleText()).toContain("grado de conexión < 2");
    expect(await consoleText()).toContain("Pre-flight ERC");
  });

  it("rechaza archivos corruptos sin destruir el circuito activo", async () => {
    const baseline = circuitFile(
      [
        component("V1", "vsource", 5, -100, 0),
        component("R1", "resistor", 1000, 80, 0),
        component("GND1", "ground", 0, 0, 120),
      ],
      [
        wire("w1", "V1", 0, "R1", 0),
        wire("w2", "R1", 1, "GND1", 0),
        wire("w3", "V1", 1, "GND1", 0),
      ],
    );
    expect(await loadCircuit(baseline)).toBe(true);
    const before = await serializedCircuit();

    expect(await loadCircuit("{json roto")).toBe(false);
    expect(await serializedCircuit()).toBe(before);

    const dangling = circuitFile(
      [component("R1", "resistor", 1000, 0, 0)],
      [wire("w1", "R1", 0, "NO_EXISTE", 0)],
    );
    expect(await loadCircuit(dangling)).toBe(false);
    expect(await serializedCircuit()).toBe(before);
    expect(await consoleText()).toContain("componente inexistente");
  });

  it("aísla estado entre pestañas y valida atajos de creación", async () => {
    await resetToEmpty();
    await placePaletteComponentWithKeyboard("comp-resistor");
    await clearPaletteSearch();
    const firstTabId = await browser.execute(
      () => document.querySelector(".tab-item.active")?.getAttribute("data-id"),
    );

    await $("#circuit-canvas").click();
    await browser.keys([Key.Control, "n"]);
    await browser.waitUntil(async () => (await appSnapshot()).componentCount === 0);
    const secondTabId = await browser.execute(
      () => document.querySelector(".tab-item.active")?.getAttribute("data-id"),
    );
    expect(secondTabId).not.toBe(firstTabId);

    await placePaletteComponentWithKeyboard("comp-capacitor");
    await clearPaletteSearch();
    expect((await appSnapshot()).components[0].type).toBe("capacitor");

    await $(`.tab-item[data-id="${firstTabId}"]`).click();
    await browser.waitUntil(async () => (await appSnapshot()).components[0]?.type === "resistor");
    await $(`.tab-item[data-id="${secondTabId}"]`).click();
    await browser.waitUntil(async () => (await appSnapshot()).components[0]?.type === "capacitor");
  });

  it("comprueba error Touchstone y genera un PDF real tras simulación", async () => {
    const divider = circuitFile(
      [
        component("V1", "vsource", 5, -160, 0),
        component("R1", "resistor", 1000, 0, 0),
        component("R2", "resistor", 1000, 160, 0),
        component("GND1", "ground", 0, 0, 140),
      ],
      [
        wire("w1", "V1", 0, "R1", 0),
        wire("w2", "R1", 1, "R2", 0),
        wire("w3", "R2", 1, "GND1", 0),
        wire("w4", "V1", 1, "GND1", 0),
      ],
    );
    expect(await loadCircuit(divider)).toBe(true);
    await setSelectValue("#analysis-mode-select", "DC");
    await clearConsole();
    const beforeRun = (await qaState()).lastUpdatedAt;
    await $("#run-sim-btn").click();
    await browser.waitUntil(async () => {
      const state = await qaState();
      return state?.lastUpdatedAt !== beforeRun
        && state?.lastSolver === "rust"
        && state?.simulationRunning === false;
    }, { timeout: 45_000 });

    await installExportCapture();
    await openInstrumentsMenu();
    await $("#export-s2p-btn").click();
    await browser.waitUntil(async () => (await consoleText()).includes("Barrido CA"));
    expect(await browser.execute(() => window.__ASTRYD_E2E_EXPORTS__.length)).toBe(0);

    await openInstrumentsMenu();
    await $("#export-pdf-btn").click();
    await browser.waitUntil(async () => browser.execute(
      () => window.__ASTRYD_E2E_EXPORTS__.length === 1,
    ), { timeout: 30_000, timeoutMsg: "El exportador PDF no genero un archivo" });
    const exports = await browser.execute(() => window.__ASTRYD_E2E_EXPORTS__);
    expect(exports[0].filename.toLowerCase()).toContain(".pdf");
    expect(exports[0].prefix.slice(0, 4)).toEqual([0x25, 0x50, 0x44, 0x46]);
    expect(exports[0].size).toBeGreaterThan(2_000);
  });
});
