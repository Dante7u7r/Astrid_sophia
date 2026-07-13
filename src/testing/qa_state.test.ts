// @vitest-environment happy-dom

import { beforeEach, describe, expect, it } from "vitest";
import { installQaState, recordQaLog, updateQaState } from "./qa_state";

beforeEach(() => {
  document.documentElement.removeAttribute("data-qa-enabled");
  document.documentElement.removeAttribute("data-qa-last-demo-file");
  document.documentElement.removeAttribute("data-qa-last-solver");
  document.documentElement.removeAttribute("data-qa-node-voltages");
  delete window.__ASTRYD_QA__;
  installQaState();
});

describe("qa_state", () => {
  it("expone estado estructurado para QA sin OCR", () => {
    updateQaState({ lastSimulationMode: "DC", simulationRunning: true });
    recordQaLog("Demo [01_divisor_rc.astryd] cargada correctamente.", "receive");
    recordQaLog("¡Resultados calculados exitosamente en Rust [MNA Newton-Raphson]!", "receive");
    recordQaLog("Nodo 1: Voltaje = 5.0000 V", "receive");

    expect(window.__ASTRYD_QA__?.lastSimulationMode).toBe("DC");
    expect(window.__ASTRYD_QA__?.simulationRunning).toBe(true);
    expect(window.__ASTRYD_QA__?.lastDemoFile).toBe("01_divisor_rc.astryd");
    expect(window.__ASTRYD_QA__?.lastSolver).toBe("rust");
    expect(window.__ASTRYD_QA__?.lastDcNodeVoltages["1"]).toBe(5);
    expect(document.documentElement.dataset.qaLastDemoFile).toBe("01_divisor_rc.astryd");
    expect(document.documentElement.dataset.qaLastSolver).toBe("rust");
  });
});
