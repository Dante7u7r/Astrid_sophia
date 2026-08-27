// @vitest-environment happy-dom

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { CrashReporter } from "./crash_reporter";
import type { DiagnosticCollectorDeps } from "../feedback/diagnostic_collector";

describe("CrashReporter", () => {
  let deps: DiagnosticCollectorDeps;

  beforeEach(() => {
    document.body.innerHTML = "";
    localStorage.clear();
    deps = {
      getOrchestrator: () => null,
      getCircuitDocumentController: () => ({
        serializeCircuit: () => JSON.stringify({ components: [{ id: "R1" }] }),
      } as any),
      getSimulationSettings: () => ({ dt: 0.001, tolerance: 1e-5, maxIterations: 100, transientDuration: 0.01 }),
      getActiveAnalysisMode: () => "TRAN",
      isSimulationActive: () => false,
      getRecentLogs: () => [],
    };
  });

  afterEach(() => {
    const reporter = CrashReporter.getInstance();
    reporter?.closeModal();
  });

  it("intercepta crash, realiza autosave y muestra el modal de emergencia", () => {
    const onCrashObserved = vi.fn();
    const reporter = CrashReporter.install({
      deps,
      onCrashObserved,
    });

    const testError = new Error("Simulated fatal solver crash");
    reporter.handleCrash(testError);

    expect(onCrashObserved).toHaveBeenCalledWith(testError);

    // Verificar autosave en localStorage
    const saved = localStorage.getItem("biaani-emergency-autosave.json");
    expect(saved).not.toBeNull();
    expect(saved).toContain("R1");

    // Verificar modal en el DOM
    const backdrop = document.querySelector(".crash-modal-backdrop");
    expect(backdrop).not.toBeNull();
    expect(document.querySelector(".crash-error-text")?.textContent).toContain("Simulated fatal solver crash");
    expect(document.querySelector("#btn-crash-send-report")).not.toBeNull();
    expect(document.querySelector("#btn-crash-save-local")).not.toBeNull();

    reporter.closeModal();
    expect(document.querySelector(".crash-modal-backdrop")).toBeNull();
  });

  it("ofrece restaurar el circuito recuperado cuando existe en localStorage", () => {
    localStorage.setItem("biaani-emergency-autosave.json", JSON.stringify({ components: [{ id: "R_EMERGENCY" }] }));
    localStorage.setItem("biaani-emergency-autosave-timestamp", new Date().toISOString());

    const mockDocController = {
      deserializeCircuit: vi.fn().mockReturnValue(true),
    };
    const onRestored = vi.fn();

    const prompted = CrashReporter.checkAndPromptEmergencyRecovery(mockDocController, { onRestored });
    expect(prompted).toBe(true);

    const toast = document.querySelector(".toast-card.toast-warning");
    expect(toast).not.toBeNull();
    expect(toast?.textContent).toContain("copia de seguridad tras un cierre inesperado");

    const restoreBtn = Array.from(document.querySelectorAll<HTMLButtonElement>(".btn-toast-action"))
      .find(btn => btn.textContent?.includes("Restaurar"));
    expect(restoreBtn).toBeDefined();

    restoreBtn?.click();
    expect(mockDocController.deserializeCircuit).toHaveBeenCalled();
    expect(onRestored).toHaveBeenCalled();
    expect(localStorage.getItem("biaani-emergency-autosave.json")).toBeNull();
  });

  it("permite descartar el circuito recuperado", () => {
    localStorage.setItem("biaani-emergency-autosave.json", "{}");
    const onDismissed = vi.fn();

    const prompted = CrashReporter.checkAndPromptEmergencyRecovery({ deserializeCircuit: () => true }, { onDismissed });
    expect(prompted).toBe(true);

    const dismissBtn = Array.from(document.querySelectorAll<HTMLButtonElement>(".btn-toast-action"))
      .find(btn => btn.textContent?.includes("Descartar"));
    expect(dismissBtn).toBeDefined();

    dismissBtn?.click();
    expect(onDismissed).toHaveBeenCalled();
    expect(localStorage.getItem("biaani-emergency-autosave.json")).toBeNull();
  });
});
