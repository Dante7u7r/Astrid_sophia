const PREVIOUS_CIRCUIT = {
  version: "3.0",
  components: [],
  wires: [],
  viewport: { zoom: 1, offsetX: 520, offsetY: 300 },
  simSettings: { dt: 0.0001, tolerance: 0.000001, maxIterations: 50, transientDuration: 0 },
  activeAnalysisMode: "DC",
  probes: {
    ch1ProbeNode: null,
    ch2ProbeNode: null,
    ch3ProbeNode: null,
    ch4ProbeNode: null,
  },
  sparPorts: [],
};

const SYNTHESIZED_SETTINGS = {
  dt: 1e-6,
  tolerance: 1e-4,
  maxIterations: 100,
  transientDuration: 0.01,
};
const SYNTHESIZED_TITLE = "Atenuador RF Red PI (-10 dB @ 50 Ω)";

async function snapshot() {
  return browser.execute(() => window.__ASTRYD_E2E__.snapshot());
}

async function qaState() {
  return browser.execute(() => window.__ASTRYD_QA__);
}

async function parsedCircuit() {
  return JSON.parse(await browser.execute(() => window.__ASTRYD_E2E__.serializeCircuit()));
}

async function closeFloatingInstruments() {
  await browser.execute(() => {
    document.querySelectorAll(".floating-instrument-window").forEach((windowElement) => {
      const button = windowElement.querySelector('[aria-label="Cerrar ventana flotante"]');
      if (button instanceof HTMLButtonElement) button.click();
    });
  });
  await browser.waitUntil(async () => browser.execute(
    () => document.querySelectorAll(".floating-instrument-window").length === 0,
  ), { timeoutMsg: "No se cerraron los instrumentos flotantes del spec de síntesis" });
}

async function closeInstrumentCenter() {
  const center = await $("#bottom-dock");
  if ((await center.getAttribute("aria-hidden")) === "true") return;
  await browser.execute(() => {
    const button = document.querySelector("#instrument-center-close");
    if (button instanceof HTMLButtonElement) button.click();
  });
  await browser.waitUntil(async () => (await center.getAttribute("aria-hidden")) === "true", {
    timeoutMsg: "No se cerró el centro de instrumentos del spec de síntesis",
  });
}

describe("síntesis nativa de circuitos", () => {
  before(async () => {
    await $("#circuit-canvas").waitForDisplayed({ timeout: 20_000 });
    await browser.waitUntil(async () => browser.execute(
      () => Boolean(window.__ASTRYD_E2E__ && window.__ASTRYD_QA__?.enabled),
    ), { timeout: 20_000, timeoutMsg: "No se inicializó el puente E2E de Tauri" });
    await browser.execute(() => {
      localStorage.setItem("biaani_guide_tour_seen", "true");
      document.querySelector("#biaani-welcome-toast")?.remove();
    });
    await closeFloatingInstruments();
    await closeInstrumentCenter();
  });

  after(async () => {
    const modal = await $("#circuit-synthesizer-modal");
    if ((await modal.getAttribute("aria-hidden")) === "false") {
      await $("#btn-close-synthesizer-modal").click();
    }
    await closeFloatingInstruments();
    if ((await qaState())?.simulationRunning) {
      await $("#stop-sim-btn").click();
      await browser.waitUntil(async () => (await qaState())?.simulationRunning === false, {
        timeoutMsg: "No se detuvo la simulación pendiente al limpiar el spec de síntesis",
      });
    }
    await closeInstrumentCenter();
  });

  it("carga los ajustes completos del paquete y termina el TRAN automático en una pestaña nueva sin guardar", async () => {
    const loaded = await browser.execute(
      (content) => window.__ASTRYD_E2E__.loadSerializedCircuit(content),
      JSON.stringify(PREVIOUS_CIRCUIT),
    );
    expect(loaded).toBe(true);
    const previousCircuit = await parsedCircuit();
    expect(previousCircuit.activeAnalysisMode).toBe("DC");
    expect(previousCircuit.simSettings).toEqual(PREVIOUS_CIRCUIT.simSettings);
    expect((await snapshot()).componentCount).toBe(0);
    expect((await snapshot()).transientSampleCount).toBe(0);
    expect((await qaState()).simulationRunning).toBe(false);

    const previousTabId = await $(".tab-item.active").getAttribute("data-id");
    const previousTabCount = (await $$(".tab-item")).length;
    const runCountBeforeGeneration = (await qaState()).simulationRunCount;
    expect(Number.isInteger(runCountBeforeGeneration)).toBe(true);

    await $("#btn-synthesizer").click();
    await $("#circuit-synthesizer-modal").waitForDisplayed();
    await $("#synth-circuit-type").selectByAttribute("value", "rf_attenuator");
    await $("#synth-rf-att").waitForDisplayed();
    expect(await $("#synth-rf-att").getValue()).toBe("10");
    expect(await $("#synth-rf-z0").getValue()).toBe("50");
    expect(await $("#synth-rf-type").getValue()).toBe("PI");
    await $("#btn-synth-generate").click();

    await browser.waitUntil(async () => {
      const current = await snapshot();
      return current.activeTabName === SYNTHESIZED_TITLE && current.componentCount > 0;
    }, { timeoutMsg: "El sintetizador no creó y activó el circuito RF" });
    const generatedTabId = await $(".tab-item.active").getAttribute("data-id");
    expect(generatedTabId).not.toBe(previousTabId);
    expect((await $$(".tab-item")).length).toBe(previousTabCount + 1);
    expect(await $(".tab-item.active .tab-unsaved").isExisting()).toBe(true);
    expect(await $("#floating-win-oscilloscope").isExisting()).toBe(false);

    // La precondición vacía borra las trazas; una finalización de esta nueva
    // pestaña impide aprobar con resultados o estado de una corrida anterior.
    const completionLog = `Simulacion [${generatedTabId}] completada en t = 0.010000 s.`;
    let lastObserved = null;
    try {
      await browser.waitUntil(async () => {
        const state = await qaState();
        const current = await snapshot();
        const consoleText = await browser.execute(
          () => document.querySelector("#console-output")?.textContent ?? "",
        );
        const ipcStatus = await $("#ipc-status-text").getText();
        const completed = consoleText.includes(completionLog);
        lastObserved = {
          runs: state.simulationRunCount,
          previousRuns: runCountBeforeGeneration,
          mode: state.lastSimulationMode,
          running: state.simulationRunning,
          samples: current.transientSampleCount,
          ipcStatus,
          solver: state.lastSolver,
          completed,
          consoleTail: consoleText.slice(-3000),
        };
        return state.simulationRunCount > runCountBeforeGeneration
          && state.lastSimulationMode === "TRAN"
          && state.simulationRunning === false
          && current.transientSampleCount > 1
          && completed
          && state.lastSolver === "rust";
      }, {
        timeout: 60_000,
        interval: 50,
        timeoutMsg: "El TRAN automático del sintetizador no terminó en Rust a los 0,01 s del paquete",
      });
    } catch (error) {
      throw new Error(`${String(error)}. Estado final: ${JSON.stringify(lastObserved)}`);
    }

    const generatedCircuit = await parsedCircuit();
    expect(generatedCircuit.activeAnalysisMode).toBe("TRAN");
    expect(generatedCircuit.simSettings).toEqual(SYNTHESIZED_SETTINGS);
    expect(generatedCircuit.components.length).toBeGreaterThan(0);
    expect(generatedCircuit.wires.length).toBeGreaterThan(0);
    expect((await snapshot()).analysisMode).toBe("TRAN");
    expect(await $(".tab-item.active").getAttribute("data-id")).toBe(generatedTabId);
    expect(await $(".tab-item.active .tab-unsaved").isExisting()).toBe(true);
    expect(await $("#floating-win-oscilloscope").isExisting()).toBe(false);
    expect(await $("#run-sim-btn").isEnabled()).toBe(true);
    expect(await $("#stop-sim-btn").isEnabled()).toBe(false);
  });
});
