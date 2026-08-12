import { Key } from "webdriverio";

async function qaState() {
  return browser.execute(() => window.__ASTRYD_QA__);
}

async function snapshot() {
  return browser.execute(() => window.__ASTRYD_E2E__?.snapshot());
}

async function loadTransientDemo() {
  const demoSelect = await $("#btn-open-demo");
  const demoOptionIndex = await browser.execute(() => {
    const select = document.querySelector("#btn-open-demo");
    if (!(select instanceof HTMLSelectElement)) return -1;
    return [...select.options].findIndex(option => option.value === "02_puente_rectificador.astryd");
  });
  expect(demoOptionIndex).toBeGreaterThanOrEqual(0);

  await demoSelect.click();
  await browser.keys([
    Key.Home,
    ...Array.from({ length: demoOptionIndex }, () => Key.ArrowDown),
    Key.Enter,
  ]);
  await browser.waitUntil(async () => (await qaState())?.lastDemoFile === "02_puente_rectificador.astryd", {
    timeout: 15_000,
    timeoutMsg: "No se cargó la demostración transitoria.",
  });
}

describe("transitorio en tiempo real", () => {
  it("mantiene la corrida activa mientras entrega muestras físicas y permite detenerla", async () => {
    await $("#circuit-canvas").waitForDisplayed({ timeout: 20_000 });
    await browser.waitUntil(async () => browser.execute(
      () => Boolean(window.__ASTRYD_E2E__ && window.__ASTRYD_QA__?.enabled),
    ), { timeout: 20_000, timeoutMsg: "No se inicializó el puente E2E." });

    await loadTransientDemo();
    expect((await snapshot()).analysisMode).toBe("TRAN");

    await $("#run-sim-btn").click();
    await browser.waitUntil(async () => {
      const state = await qaState();
      return state?.simulationRunning === true
        && (await snapshot()).transientSampleCount > 1
        && await $("#stop-sim-btn").isEnabled();
    }, {
      timeout: 15_000,
      timeoutMsg: "El transitorio se desactivó antes de entregar muestras en tiempo real.",
    });

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
  });
});
