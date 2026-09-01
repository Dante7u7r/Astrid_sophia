import { Key } from "webdriverio";

const TRANSIENT_DEMO = "02_rectificador_filtro_c.biaani";

async function qaState() {
  return browser.execute(() => window.__ASTRYD_QA__);
}

async function snapshot() {
  return browser.execute(() => window.__ASTRYD_E2E__?.snapshot());
}

async function parsedCircuit() {
  return JSON.parse(await browser.execute(() => window.__ASTRYD_E2E__.serializeCircuit()));
}

async function liveProgress() {
  return browser.execute(() => ({
    state: window.__ASTRYD_QA__,
    sampleCount: window.__ASTRYD_E2E__.snapshot().transientSampleCount,
    latestTime: window.oscilloscopePanel?.transientResults.at(-1)?.time ?? null,
  }));
}

async function closeAuxiliaryUi() {
  await browser.execute(() => {
    const settings = document.querySelector("#settings-modal");
    if (settings?.getAttribute("aria-hidden") === "false") {
      const cancel = document.querySelector("#btn-cancel-settings");
      if (cancel instanceof HTMLButtonElement) cancel.click();
    }
    document.querySelectorAll(".floating-instrument-window").forEach((windowElement) => {
      const close = windowElement.querySelector('[aria-label="Cerrar ventana flotante"]');
      if (close instanceof HTMLButtonElement) close.click();
    });
    const dock = document.querySelector("#bottom-dock");
    if (dock?.getAttribute("aria-hidden") === "false") {
      const close = document.querySelector("#instrument-center-close");
      if (close instanceof HTMLButtonElement) close.click();
    }
  });
  await browser.waitUntil(async () => browser.execute(() => (
    document.querySelectorAll(".floating-instrument-window").length === 0
      && document.querySelector("#bottom-dock")?.getAttribute("aria-hidden") === "true"
      && document.querySelector("#settings-modal")?.getAttribute("aria-hidden") === "true"
  )), { timeoutMsg: "No se limpiaron las superficies auxiliares del transitorio" });
}

async function stopSimulation() {
  await $("#stop-sim-btn").click();
  await browser.waitUntil(async () => {
    const state = await qaState();
    return state?.simulationRunning === false
      && await $("#run-sim-btn").isEnabled()
      && !(await $("#stop-sim-btn").isEnabled());
  }, {
    timeout: 10_000,
    timeoutMsg: "Detener no liberó los controles de la corrida transitoria.",
  });
}

async function loadTransientDemo() {
  const runsBefore = (await qaState()).simulationRunCount;
  const demoSelect = await $("#btn-open-demo");
  const demoOptionIndex = await browser.execute((filename) => {
    const select = document.querySelector("#btn-open-demo");
    if (!(select instanceof HTMLSelectElement)) return -1;
    return [...select.options].findIndex(option => option.value === filename);
  }, TRANSIENT_DEMO);
  expect(demoOptionIndex).toBeGreaterThanOrEqual(0);

  await demoSelect.click();
  await browser.keys([
    Key.Home,
    ...Array.from({ length: demoOptionIndex }, () => Key.ArrowDown),
    Key.Enter,
  ]);
  await browser.waitUntil(async () => (await qaState())?.lastDemoFile === TRANSIENT_DEMO, {
    timeout: 15_000,
    timeoutMsg: "No se cargó la demostración transitoria.",
  });
  const circuit = await parsedCircuit();
  expect(circuit.activeAnalysisMode).toBe("TRAN");
  expect(circuit.simSettings.transientDuration).toBeGreaterThan(0);
  const ownerTabId = await $(".tab-item.active").getAttribute("data-id");
  const completionLog = `Simulacion [${ownerTabId}] completada en t = ${circuit.simSettings.transientDuration.toFixed(6)} s.`;
  await browser.waitUntil(async () => {
    const state = await qaState();
    const completed = await browser.execute(
      (message) => document.querySelector("#console-output")?.textContent?.includes(message) ?? false,
      completionLog,
    );
    return state.simulationRunCount > runsBefore
      && state.lastSimulationMode === "TRAN"
      && state.lastSolver === "rust"
      && state.simulationRunning === false
      && (await snapshot()).transientSampleCount > 1
      && completed;
  }, {
    timeout: 60_000,
    timeoutMsg: "La ejecución automática finita de la demo no terminó en Rust.",
  });
}

describe("transitorio en tiempo real", () => {
  before(async () => {
    await $("#circuit-canvas").waitForDisplayed({ timeout: 20_000 });
    await browser.waitUntil(async () => browser.execute(
      () => Boolean(window.__ASTRYD_E2E__ && window.__ASTRYD_QA__?.enabled),
    ), { timeout: 20_000, timeoutMsg: "No se inicializó el puente E2E." });
    await browser.execute(() => {
      localStorage.setItem("biaani_guide_tour_seen", "true");
      document.querySelector("#biaani-welcome-toast")?.remove();
    });
    await closeAuxiliaryUi();
  });

  after(async () => {
    try {
      await closeAuxiliaryUi();
    } finally {
      if ((await qaState())?.simulationRunning) await stopSimulation();
    }
  });

  it("mantiene la corrida continua activa mientras entrega muestras físicas nuevas y permite detenerla", async () => {
    await loadTransientDemo();
    expect((await snapshot()).analysisMode).toBe("TRAN");
    await closeAuxiliaryUi();

    // La demo autoejecuta un TRAN finito. La corrida bajo prueba debe usar
    // duración cero explícita y pacing real, sin heredar su duración finita.
    await $("#settings-trigger-btn").click();
    const settingsModal = await $("#settings-modal");
    await settingsModal.waitForDisplayed();
    await $("#settings-transient-duration-input").setValue("0");
    const disablePacing = await $("#settings-disable-pacing");
    if (await disablePacing.isSelected()) await disablePacing.click();
    expect(await disablePacing.isSelected()).toBe(false);
    await $("#btn-save-settings").click();
    await browser.waitUntil(async () => (await settingsModal.getAttribute("aria-hidden")) === "true");
    expect((await parsedCircuit()).simSettings.transientDuration).toBe(0);

    const runsBefore = (await qaState()).simulationRunCount;
    await $("#run-sim-btn").click();
    await browser.waitUntil(async () => {
      const progress = await liveProgress();
      return progress.state.simulationRunCount > runsBefore
        && progress.state.lastSimulationMode === "TRAN"
        && progress.state.lastSolver === "rust"
        && progress.state.simulationRunning === true
        && progress.sampleCount > 1
        && Number.isFinite(progress.latestTime)
        && await $("#stop-sim-btn").isEnabled();
    }, {
      timeout: 15_000,
      timeoutMsg: "El transitorio se desactivó antes de entregar muestras en tiempo real.",
    });

    const initialProgress = await liveProgress();
    await browser.waitUntil(async () => {
      const progress = await liveProgress();
      return progress.state.simulationRunCount === initialProgress.state.simulationRunCount
        && progress.state.simulationRunning === true
        && progress.state.lastSolver === "rust"
        && progress.sampleCount > initialProgress.sampleCount
        && progress.latestTime > initialProgress.latestTime;
    }, {
      timeout: 10_000,
      timeoutMsg: "La corrida quedó activa pero dejó de entregar muestras con tiempo físico creciente.",
    });

    await stopSimulation();
    const stoppedSamples = (await snapshot()).transientSampleCount;
    await browser.pause(300);
    expect((await qaState()).simulationRunning).toBe(false);
    expect((await snapshot()).transientSampleCount).toBe(stoppedSamples);
  });
});
