// @vitest-environment happy-dom

import { beforeEach, describe, expect, it } from "vitest";
import { installQaState, recordQaLog, recordQaSolverResult, updateQaState } from "./qa_state";

beforeEach(() => {
  document.documentElement.removeAttribute("data-qa-enabled");
  document.documentElement.removeAttribute("data-qa-last-demo-file");
  document.documentElement.removeAttribute("data-qa-last-solver");
  document.documentElement.removeAttribute("data-qa-node-voltages");
  delete window.__ASTRYD_QA__;
  installQaState();
  updateQaState({ simulationRunning: false });
});

describe("qa_state", () => {
  it("expone estado estructurado para QA sin OCR", () => {
    updateQaState({ lastSimulationMode: "DC", simulationRunning: true });
    recordQaLog("Demo [01_filtro_rc.astryd] cargada correctamente.", "receive");
    recordQaLog("¡Resultados calculados exitosamente en Rust [MNA Newton-Raphson]!", "receive");
    recordQaSolverResult("rust");
    recordQaLog("Nodo 1: Voltaje = 5.0000 V", "receive");

    expect(window.__ASTRYD_QA__?.lastSimulationMode).toBe("DC");
    expect(window.__ASTRYD_QA__?.simulationRunning).toBe(true);
    expect(window.__ASTRYD_QA__?.lastDemoFile).toBe("01_filtro_rc.astryd");
    expect(window.__ASTRYD_QA__?.lastSolver).toBe("rust");
    expect(window.__ASTRYD_QA__?.lastDcNodeVoltages["1"]).toBe(5);
    expect(document.documentElement.dataset.qaLastDemoFile).toBe("01_filtro_rc.astryd");
    expect(document.documentElement.dataset.qaLastSolver).toBe("rust");
  });

  it("cuenta cada arranque una sola vez aunque termine entre dos lecturas del test", () => {
    const previousCount = window.__ASTRYD_QA__!.simulationRunCount;
    updateQaState({ simulationRunning: true });
    updateQaState({ simulationRunning: true });
    updateQaState({ simulationRunning: false });

    expect(window.__ASTRYD_QA__!.simulationRunCount).toBe(previousCount + 1);
    expect(window.__ASTRYD_QA__!.simulationRunning).toBe(false);
    expect(document.documentElement.dataset.qaSimulationRunCount).toBe(String(previousCount + 1));

    updateQaState({ simulationRunning: true });
    updateQaState({ simulationRunning: false });
    expect(window.__ASTRYD_QA__!.simulationRunCount).toBe(previousCount + 2);
  });

  it("no atribuye un motor por logs ni reutiliza resultados de una corrida anterior", () => {
    updateQaState({ simulationRunning: true });
    recordQaSolverResult("rust");
    recordQaLog("Nodo 1: Voltaje = 5.0000 V", "receive");
    updateQaState({ simulationRunning: false });
    updateQaState({ simulationRunning: true });
    recordQaLog("Error en el solver de Rust", "error");
    recordQaLog("Iniciando solucionador local en TypeScript...", "system");
    expect(window.__ASTRYD_QA__!.lastSolver).toBeNull();
    expect(window.__ASTRYD_QA__!.lastDcNodeVoltages).toEqual({});
    recordQaSolverResult("typescript");
    expect(window.__ASTRYD_QA__!.lastSolver).toBe("typescript");
  });
});
