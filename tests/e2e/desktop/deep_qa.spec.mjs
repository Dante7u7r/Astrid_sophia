import { Key } from "webdriverio";

const EMPTY_FILE = {
  version: "3.0",
  components: [],
  wires: [],
  viewport: { zoom: 1, offsetX: 520, offsetY: 300 },
  simSettings: { dt: 0.00001, tolerance: 0.00001, maxIterations: 100 },
  activeAnalysisMode: "DC",
  probes: {
    ch1ProbeNode: null,
    ch2ProbeNode: null,
    ch3ProbeNode: null,
    ch4ProbeNode: null,
  },
  sparPorts: [],
};

function component(id, type, value, x = 0, y = 0, extra = {}) {
  return { id, type, value, x, y, rotation: 0, ...extra };
}

function circuitFile(components, wires = []) {
  return { ...EMPTY_FILE, components, wires };
}

function rcCircuitFile(simSettings = EMPTY_FILE.simSettings) {
  return {
    ...circuitFile([
      component("V1", "vsource", 5, -160, 80, {
        rotation: 90,
        waveType: "sine",
        amplitude: 5,
        frequency: 1000,
        offset: 0,
      }),
      component("R1", "resistor", 1000, 0, 0),
      component("C1", "capacitor", 0.000001, 160, 80, { rotation: 90 }),
      component("GND1", "ground", 0, 0, 200),
    ], [
      {
        id: "w1",
        from: { componentId: "V1", pinIndex: 1 },
        to: { componentId: "GND1", pinIndex: 0 },
        points: [],
      },
      {
        id: "w2",
        from: { componentId: "V1", pinIndex: 0 },
        to: { componentId: "R1", pinIndex: 0 },
        points: [],
      },
      {
        id: "w3",
        from: { componentId: "R1", pinIndex: 1 },
        to: { componentId: "C1", pinIndex: 0 },
        points: [],
      },
      {
        id: "w4",
        from: { componentId: "C1", pinIndex: 1 },
        to: { componentId: "GND1", pinIndex: 0 },
        points: [],
      },
    ]),
    simSettings,
    probes: {
      ch1ProbeNode: "1",
      ch2ProbeNode: "2",
      ch3ProbeNode: null,
      ch4ProbeNode: null,
    },
  };
}

async function snapshot() {
  return browser.execute(() => window.__ASTRYD_E2E__.snapshot());
}

async function qaState() {
  return browser.execute(() => window.__ASTRYD_QA__);
}

async function consoleText() {
  return browser.execute(
    () => document.querySelector("#console-output")?.textContent ?? "",
  );
}

async function parsedCircuit() {
  return JSON.parse(await browser.execute(() => window.__ASTRYD_E2E__.serializeCircuit()));
}

async function loadCircuit(file) {
  const loaded = await browser.execute(
    (content) => window.__ASTRYD_E2E__.loadSerializedCircuit(content),
    JSON.stringify(file),
  );
  expect(loaded).toBe(true);
  return snapshot();
}

async function focusCanvas() {
  const canvas = await $("#circuit-canvas");
  await canvas.click();
  return canvas;
}

async function selectComponentById(id) {
  const item = (await snapshot()).components.find((candidate) => candidate.id === id);
  expect(item).toBeDefined();
  await browser.action("pointer", { parameters: { pointerType: "mouse" } })
    .move({
      duration: 0,
      origin: "viewport",
      x: Math.round(item.clientX),
      y: Math.round(item.clientY),
    })
    .down({ button: 0 })
    .up({ button: 0 })
    .perform();
  await browser.waitUntil(async () => {
    const value = await browser.execute(() => {
      const input = document.querySelector("#prop-id-input");
      return input instanceof HTMLInputElement ? input.value : "";
    });
    return value === id;
  });
}

async function setControl(selector, value, eventType = "input") {
  const changed = await browser.execute((target, nextValue, type) => {
    const element = document.querySelector(target);
    if (!(element instanceof HTMLInputElement)
      && !(element instanceof HTMLSelectElement)
      && !(element instanceof HTMLTextAreaElement)) return false;
    if (element instanceof HTMLInputElement && element.type === "checkbox") {
      element.checked = Boolean(nextValue);
    } else {
      element.value = String(nextValue);
    }
    element.dispatchEvent(new Event(type, { bubbles: true }));
    return true;
  }, selector, value, eventType);
  expect(changed).toBe(true);
}

async function applyProperties() {
  await browser.execute(() => {
    const button = document.querySelector("#btn-apply-properties");
    if (button instanceof HTMLButtonElement) button.click();
  });
}

async function loadAndSelect(item) {
  await loadCircuit(circuitFile([item]));
  await selectComponentById(item.id);
}

async function placeResistorWithKeyboard() {
  const search = await $("#component-search");
  await search.setValue("resistencia");
  const card = await $("#comp-resistor");
  await browser.execute(() => {
    document.querySelector("#comp-resistor")?.scrollIntoView({ block: "center" });
  });
  await card.click();
  await browser.keys(Key.Enter);
  await browser.waitUntil(async () => (await snapshot()).componentCount === 1);
  await search.click();
  await browser.keys([Key.Control, "a", Key.Backspace]);
}

async function wirePins(from, to, expectedCount) {
  await browser.action("pointer", { parameters: { pointerType: "mouse" } })
    .move({ duration: 0, origin: "viewport", x: Math.round(from.clientX), y: Math.round(from.clientY) })
    .down({ button: 0 })
    .move({ duration: 300, origin: "viewport", x: Math.round(to.clientX), y: Math.round(to.clientY) })
    .up({ button: 0 })
    .perform();
  await browser.waitUntil(async () => (await snapshot()).wireCount === expectedCount);
}

async function worldToClient(point) {
  return browser.execute((worldPoint) => {
    const canvas = document.querySelector("#circuit-canvas");
    const file = JSON.parse(window.__ASTRYD_E2E__.serializeCircuit());
    if (!(canvas instanceof HTMLCanvasElement)) return null;
    const rect = canvas.getBoundingClientRect();
    return {
      x: rect.left + worldPoint.x * file.viewport.zoom + file.viewport.offsetX,
      y: rect.top + worldPoint.y * file.viewport.zoom + file.viewport.offsetY,
    };
  }, point);
}

async function openInstrumentCenter() {
  const dock = await $("#bottom-dock");
  if ((await dock.getAttribute("class")).includes("collapsed")) {
    await $("#instruments-menu-btn").click();
    await $("#menu-toggle-dock").click();
  }
  await browser.waitUntil(async () => !(await dock.getAttribute("class")).includes("collapsed"));
}

async function closeInstrumentCenter() {
  const dock = await $("#bottom-dock");
  if (!(await dock.getAttribute("class")).includes("collapsed")) {
    await browser.execute(() => {
      const button = document.querySelector("#instrument-center-close");
      if (button instanceof HTMLButtonElement) button.click();
    });
    await browser.waitUntil(async () => (await dock.getAttribute("class")).includes("collapsed"));
  }
}

async function runAnalysis(mode) {
  await setControl("#analysis-mode-select", mode, "change");
  const before = (await qaState()).lastUpdatedAt;
  await $("#run-sim-btn").click();
  await browser.waitUntil(async () => {
    const state = await qaState();
    return state?.lastUpdatedAt !== before
      && state?.lastSimulationMode === mode
      && state?.lastSolver === "rust"
      && state?.simulationRunning === false;
  }, {
    timeout: 45_000,
    timeoutMsg: `El analisis ${mode} no termino con el solver Rust`,
  });
  expect(await $("#run-sim-btn").isEnabled()).toBe(true);
  expect(await $("#stop-sim-btn").isEnabled()).toBe(false);
  expect((await qaState()).lastLogType).not.toBe("error");
}

describe("QA nativo profundo de escritorio", () => {
  before(async () => {
    await $("#circuit-canvas").waitForDisplayed({ timeout: 20_000 });
    await browser.waitUntil(async () => browser.execute(
      () => Boolean(window.__ASTRYD_E2E__ && window.__ASTRYD_QA__?.enabled),
    ), { timeout: 20_000 });
  });

  afterEach(async () => {
    await closeInstrumentCenter();
  });

  it("deshace y rehace altas, duplicados y borrado en lote", async () => {
    await loadCircuit(EMPTY_FILE);
    await placeResistorWithKeyboard();

    await focusCanvas();
    await browser.keys([Key.Control, "z"]);
    await browser.waitUntil(async () => (await snapshot()).componentCount === 0);
    await browser.keys([Key.Control, "y"]);
    await browser.waitUntil(async () => (await snapshot()).componentCount === 1);

    const resistor = (await snapshot()).components[0];
    await selectComponentById(resistor.id);
    await browser.keys([Key.Control, "d"]);
    await browser.waitUntil(async () => (await snapshot()).componentCount === 2);
    await browser.keys([Key.Control, "z"]);
    await browser.waitUntil(async () => (await snapshot()).componentCount === 1);
    await browser.keys([Key.Control, "y"]);
    await browser.waitUntil(async () => (await snapshot()).componentCount === 2);

    await focusCanvas();
    await browser.keys([Key.Control, "a"]);
    await browser.keys(Key.Delete);
    await browser.waitUntil(async () => (await snapshot()).componentCount === 0);
    await browser.keys([Key.Control, "z"]);
    await browser.waitUntil(async () => (await snapshot()).componentCount === 2);
  });

  it("impide cables duplicados, elimina un cable y lo restaura", async () => {
    await loadCircuit(circuitFile([
      component("R1", "resistor", 1000, -120, 0),
      component("R2", "resistor", 2000, 120, 0),
    ]));
    let state = await snapshot();
    const r1 = state.components.find((item) => item.id === "R1");
    const r2 = state.components.find((item) => item.id === "R2");

    await wirePins(r1.pins[1], r2.pins[0], 1);
    await wirePins(r1.pins[1], r2.pins[0], 1);
    expect((await parsedCircuit()).wires).toHaveLength(1);

    const points = (await parsedCircuit()).wires[0].points;
    expect(points.length).toBeGreaterThanOrEqual(2);
    const midpoint = {
      x: (points[0].x + points[1].x) / 2,
      y: (points[0].y + points[1].y) / 2,
    };
    const client = await worldToClient(midpoint);
    await browser.action("pointer", { parameters: { pointerType: "mouse" } })
      .move({ duration: 200, origin: "viewport", x: Math.round(client.x), y: Math.round(client.y) })
      .down({ button: 0 })
      .up({ button: 0 })
      .perform();
    await browser.keys(Key.Delete);
    await browser.waitUntil(async () => (await snapshot()).wireCount === 0);
    await browser.keys([Key.Control, "z"]);
    await browser.waitUntil(async () => (await snapshot()).wireCount === 1);
  });

  it("aplica propiedades especializadas y conserva valores limite validos", async () => {
    await loadAndSelect(component("P1", "potentiometer", 10000));
    await setControl("#prop-wiper-slider", 0.23);
    await applyProperties();
    expect((await parsedCircuit()).components[0].wiperPosition).toBeCloseTo(0.23);

    await loadAndSelect(component("LDR1", "ldr", 100));
    await setControl("#prop-lux-slider", 2345);
    await applyProperties();
    expect((await parsedCircuit()).components[0].lux).toBe(2345);

    await loadAndSelect(component("TH1", "thermistor", 25));
    await setControl("#prop-temp-slider", 0);
    await applyProperties();
    expect((await parsedCircuit()).components[0].temperatureCelsius).toBe(0);

    await loadAndSelect(component("DMM1", "dmm", "V"));
    await setControl("#prop-dmm-mode", "A", "change");
    expect((await parsedCircuit()).components[0].value).toBe("A");

    await loadAndSelect(component("S1", "switch", 0));
    await setControl("#prop-switch-state", true, "change");
    await setControl("#prop-switch-ron", 0.025);
    await setControl("#prop-switch-roff", 500000000);
    await applyProperties();
    let edited = (await parsedCircuit()).components[0];
    expect(edited.switchState).toBe(true);
    expect(edited.switchRon).toBeCloseTo(0.025);
    expect(edited.switchRoff).toBe(500000000);

    await loadAndSelect(component("T1", "transformer", 0.001));
    await setControl("#prop-transformer-l1", 0.002);
    await setControl("#prop-transformer-l2", 0.008);
    await setControl("#prop-transformer-k", 0.97);
    await applyProperties();
    edited = (await parsedCircuit()).components[0];
    expect(edited.primaryInductance).toBeCloseTo(0.002);
    expect(edited.secondaryInductance).toBeCloseTo(0.008);
    expect(edited.couplingCoefficient).toBeCloseTo(0.97);

    await loadAndSelect(component("U1", "opamp", 0));
    await setControl("#prop-opamp-vos", 0);
    await setControl("#prop-opamp-gain", 1000000, "change");
    await applyProperties();
    edited = (await parsedCircuit()).components[0];
    expect(edited.offsetVoltage).toBe(0);
    expect(edited.openLoopGain).toBe(1000000);

    await loadAndSelect(component("X1", "x", 1));
    await setControl("#prop-pin-count", 80);
    await setControl("#prop-spice-macro", ".subckt TEST A B\nR1 A B 1k\n.ends TEST");
    await applyProperties();
    edited = (await parsedCircuit()).components[0];
    expect(edited.pinCount).toBe(64);
    expect(edited.spiceMacro).toContain(".subckt TEST");
  });

  it("controla generador, navegacion de instrumentos y trazador I-V", async () => {
    await loadAndSelect(component("V1", "vsource", 5));
    await openInstrumentCenter();
    await $('[data-tab="generator"]').click();
    await browser.waitUntil(async () => (await $("#gen-source-info").getText()).includes("V1"));
    await setControl("#gen-wave-type", "sine", "change");
    await setControl("#gen-freq-slider", 2500);
    await setControl("#gen-amp-slider", 3.3);
    await setControl("#gen-offset-slider", 1.2);
    let source = (await parsedCircuit()).components[0];
    expect(source.waveType).toBe("sine");
    expect(source.frequency).toBe(2500);
    expect(source.amplitude).toBeCloseTo(3.3);
    expect(source.offset).toBeCloseTo(1.2);

    const generatorTab = await $('[data-tab="generator"]');
    await generatorTab.click();
    await browser.keys(Key.ArrowRight);
    expect(await $('[data-tab="logic"]').getAttribute("aria-selected")).toBe("true");
    await $("#logic-clear-btn").click();
    await $('[data-tab="fft"]').click();
    await $("#fft-src-ch2").click();
    expect(await $("#fft-src-ch2").getAttribute("class")).toContain("active");

    await browser.keys(Key.Escape);
    await loadAndSelect(component("D1", "diode", 0));
    await openInstrumentCenter();
    await $('[data-tab="tracer"]').click();
    await browser.waitUntil(async () => (await $("#tracer-comp-name").getText()) === "D1", {
      timeout: 5_000,
    });
    await $("#tracer-run-btn").click();
    const nonEmptyCanvas = await browser.execute(() => {
      const canvas = document.querySelector("#tracer-canvas");
      if (!(canvas instanceof HTMLCanvasElement)) return false;
      const context = canvas.getContext("2d");
      if (!context || canvas.width === 0 || canvas.height === 0) return false;
      const data = context.getImageData(0, 0, canvas.width, canvas.height).data;
      for (let index = 3; index < data.length; index += 4) {
        if (data[index] !== 0) return true;
      }
      return false;
    });
    expect(nonEmptyCanvas).toBe(true);
  });

  it("encadena DC, AC, transitorio y DC sin contaminar resultados ni controles", async () => {
    await loadCircuit(rcCircuitFile());

    await runAnalysis("DC");
    expect(Object.keys((await qaState()).lastDcNodeVoltages).length).toBeGreaterThan(0);

    await runAnalysis("AC");
    let resultState = await snapshot();
    expect(resultState.analysisMode).toBe("AC");
    expect(resultState.acPointCount).toBeGreaterThan(10);

    await runAnalysis("TRAN");
    resultState = await snapshot();
    expect(resultState.analysisMode).toBe("TRAN");
    expect(resultState.transientSampleCount).toBeGreaterThan(10);

    await runAnalysis("DC");
    resultState = await snapshot();
    expect(resultState.analysisMode).toBe("DC");
    expect(Object.keys((await qaState()).lastDcNodeVoltages).length).toBeGreaterThan(0);
  });

  it("ejecuta sensibilidad, PSS y estabilidad desde la interfaz con Rust real", async () => {
    await loadCircuit(rcCircuitFile());

    await runAnalysis("SENS");
    expect(await consoleText()).toContain("RESULTADOS DEL ANÁLISIS DE SENSIBILIDAD");

    await runAnalysis("PSS");
    let resultState = await snapshot();
    expect(resultState.analysisMode).toBe("PSS");
    expect(resultState.transientSampleCount).toBeGreaterThan(10);
    expect(await consoleText()).toContain("PSS Shooting Method");

    await runAnalysis("STB");
    resultState = await snapshot();
    expect(resultState.analysisMode).toBe("STB");
    expect(await consoleText()).toContain("EXTRACCIÓN EXPERIMENTAL DE POLOS Y CEROS");
  });

  it("ejecuta la matriz PVT comercial y devuelve tres trazas nativas", async () => {
    await loadCircuit(rcCircuitFile());
    await setControl("#analysis-mode-select", "PVT", "change");
    await $("#run-sim-btn").click();

    await browser.waitUntil(async () => browser.execute(
      () => document.querySelectorAll(".pvt-profile-btn").length === 3,
    ), {
      timeout: 10_000,
      timeoutMsg: "PVT no mostro los tres perfiles disponibles",
    });

    const profileLabels = await browser.execute(
      () => Array.from(document.querySelectorAll(".pvt-profile-btn"))
        .map((button) => button.textContent?.trim() ?? ""),
    );
    expect(profileLabels).toEqual([
      "Comercial (0-70 C)",
      "Industrial (-40-85 C)",
      "Automotriz (-40-125 C)",
    ]);

    await browser.execute(() => {
      const profile = document.querySelector(".pvt-profile-btn");
      if (profile instanceof HTMLButtonElement) profile.click();
    });
    await browser.waitUntil(async () => {
      const state = await snapshot();
      const controlsReleased = await browser.execute(
        () => Array.from(document.querySelectorAll(".pvt-profile-btn"))
          .every((button) => button instanceof HTMLButtonElement && !button.disabled),
      );
      return state.analysisMode === "PVT"
        && state.pvtMode
        && state.pvtTraceCount === 3
        && controlsReleased
        && (await qaState()).simulationRunning === false;
    }, {
      timeout: 45_000,
      timeoutMsg: "La matriz PVT comercial no termino o no libero sus controles",
    });

    expect(await consoleText()).toContain("RESULTADOS DEL ANALISIS PVT");
    expect(await consoleText()).toContain("TT (Nominal)");
    expect(await consoleText()).toContain("FF (Fast-Fast)");
    expect(await consoleText()).toContain("SS (Slow-Slow)");
  });

  it("extrae S11 nativo de una carga adaptada de 50 ohm por IPC", async () => {
    const netlist = {
      components: [
        { id: "R1", type: "resistor", value: 50, pins: ["1", "0"] },
      ],
      wires: [],
    };
    const settings = {
      ports: [{
        name: "P1",
        positiveNode: "1",
        negativeNode: "0",
        referenceImpedance: 50,
      }],
      fStart: 1_000,
      fEnd: 10_000,
      pointsPerDecade: 4,
      outputFormat: "ri",
    };

    const result = await browser.tauri.execute(
      (tauri, nativeNetlist, nativeSettings) => tauri.core.invoke(
        "extract_sparameter",
        { netlist: nativeNetlist, settings: nativeSettings },
      ),
      netlist,
      settings,
    );

    expect(result.converged).toBe(true);
    expect(result.frequencies.length).toBeGreaterThan(1);
    expect(result.sMatrices.length).toBe(result.frequencies.length);
    for (const matrix of result.sMatrices) {
      expect(Math.abs(matrix[0][0].re)).toBeLessThan(1e-8);
      expect(Math.abs(matrix[0][0].im)).toBeLessThan(1e-8);
    }
  });

  it("rechaza parametros S invalidos sin bloquear el proceso Tauri", async () => {
    const errorMessage = await browser.tauri.execute(
      async (tauri) => {
        try {
          await tauri.core.invoke("extract_sparameter", {
            netlist: { components: [], wires: [] },
            settings: {
              ports: [],
              fStart: 0,
              fEnd: 0,
              pointsPerDecade: 0,
              outputFormat: "desconocido",
            },
          });
          return "";
        } catch (error) {
          return typeof error === "string" ? error : JSON.stringify(error);
        }
      },
    );

    expect(errorMessage).toContain("Se requieren entre 1 y 16 puertos RF");
    await loadCircuit(rcCircuitFile());
    await runAnalysis("DC");
  });

  it("mantiene resultados estables tras doce analisis nativos consecutivos", async () => {
    await loadCircuit(rcCircuitFile());
    let dcReference = null;

    for (const mode of ["DC", "AC", "TRAN", "DC", "TRAN", "AC", "DC", "AC", "TRAN", "DC", "AC", "TRAN"]) {
      await runAnalysis(mode);
      const resultState = await snapshot();
      if (mode === "DC") {
        const voltages = (await qaState()).lastDcNodeVoltages;
        expect(Object.keys(voltages).length).toBeGreaterThan(0);
        if (dcReference === null) {
          dcReference = voltages;
        } else {
          expect(voltages).toEqual(dcReference);
        }
      } else if (mode === "AC") {
        expect(resultState.acPointCount).toBeGreaterThan(10);
      } else {
        expect(resultState.transientSampleCount).toBeGreaterThan(10);
      }
    }
  });

  it("cancela un transitorio largo y recupera una simulacion DC posterior", async () => {
    await loadCircuit(rcCircuitFile({
      dt: 0.00000005,
      tolerance: 0.00001,
      maxIterations: 100,
    }));
    await setControl("#analysis-mode-select", "TRAN", "change");
    await $("#run-sim-btn").click();
    await browser.waitUntil(async () => {
      const state = await qaState();
      return state?.simulationRunning === true && await $("#stop-sim-btn").isEnabled();
    }, {
      timeout: 10_000,
      timeoutMsg: "El transitorio largo no entro en estado activo",
    });

    await $("#stop-sim-btn").click();
    await browser.waitUntil(async () => {
      const state = await qaState();
      return state?.simulationRunning === false
        && await $("#run-sim-btn").isEnabled()
        && !(await $("#stop-sim-btn").isEnabled());
    }, {
      timeout: 10_000,
      timeoutMsg: "La cancelacion no libero los controles",
    });
    await browser.pause(500);
    expect((await qaState()).simulationRunning).toBe(false);

    await runAnalysis("DC");
    expect(Object.keys((await qaState()).lastDcNodeVoltages).length).toBeGreaterThan(0);
  });

  it("mantiene fluido un lienzo de 150 componentes y restaura borrado masivo", async () => {
    const components = [];
    for (let index = 0; index < 150; index++) {
      components.push(component(
        `R${index + 1}`,
        "resistor",
        1000 + index,
        (index % 15) * 100 - 700,
        Math.floor(index / 15) * 80 - 360,
      ));
    }
    await loadCircuit(circuitFile(components));
    const canvas = await focusCanvas();
    await browser.keys("f");
    const viewport = (await parsedCircuit()).viewport;
    expect(Number.isFinite(viewport.zoom)).toBe(true);
    expect(viewport.zoom).toBeGreaterThanOrEqual(0.3);
    expect(viewport.zoom).toBeLessThanOrEqual(3);

    const pixelCount = await browser.execute(() => {
      const target = document.querySelector("#circuit-canvas");
      if (!(target instanceof HTMLCanvasElement)) return 0;
      const context = target.getContext("2d");
      if (!context) return 0;
      const data = context.getImageData(0, 0, target.width, target.height).data;
      let visible = 0;
      for (let index = 0; index < data.length; index += 4) {
        if (Math.max(data[index], data[index + 1], data[index + 2]) > 100) visible++;
      }
      return visible;
    });
    expect(pixelCount).toBeGreaterThan(500);

    await canvas.click();
    await browser.keys([Key.Control, "a"]);
    await browser.keys(Key.Delete);
    await browser.waitUntil(async () => (await snapshot()).componentCount === 0);
    await browser.keys([Key.Control, "z"]);
    await browser.waitUntil(async () => (await snapshot()).componentCount === 150, {
      timeout: 20_000,
    });
  });
});
