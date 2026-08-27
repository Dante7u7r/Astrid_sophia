// @vitest-environment happy-dom

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { FeedbackModal } from "./feedback_modal";
import type { DiagnosticCollectorDeps } from "../feedback/diagnostic_collector";

describe("FeedbackModal", () => {
  let deps: DiagnosticCollectorDeps;

  beforeEach(() => {
    document.body.innerHTML = "";
    deps = {
      getOrchestrator: () => null,
      getSimulationSettings: () => ({ dt: 0.001, tolerance: 1e-5, maxIterations: 100, transientDuration: 0.01 }),
      getActiveAnalysisMode: () => "TRAN",
      isSimulationActive: () => false,
      getRecentLogs: () => [],
    };
  });

  afterEach(() => {
    FeedbackModal.closeCurrent();
  });

  it("renderiza el modal de feedback en el DOM", () => {
    const modal = FeedbackModal.show({ deps });
    const backdrop = document.querySelector(".feedback-modal-backdrop");
    expect(backdrop).not.toBeNull();
    expect(document.querySelector("#feedback-category")).not.toBeNull();
    expect(document.querySelector("#feedback-note")).not.toBeNull();
    expect(document.querySelector("#btn-feedback-submit")).not.toBeNull();
    modal.close();
    expect(document.querySelector(".feedback-modal-backdrop")).toBeNull();
  });

  it("cierra el modal al hacer clic en el botón de cancelar", () => {
    const onDismiss = vi.fn();
    FeedbackModal.show({ deps, onDismiss });
    const cancelBtn = document.querySelector<HTMLButtonElement>("#btn-feedback-cancel-action");
    expect(cancelBtn).not.toBeNull();
    cancelBtn?.click();
    expect(onDismiss).toHaveBeenCalledTimes(1);
    expect(document.querySelector(".feedback-modal-backdrop")).toBeNull();
  });

  it("permite seleccionar categoría inicial", () => {
    FeedbackModal.show({ deps, initialCategory: "comparison" });
    const categorySelect = document.querySelector<HTMLSelectElement>("#feedback-category");
    expect(categorySelect?.value).toBe("comparison");
  });

  it("renderiza la zona de adjuntar captura externa o archivo de referencia", () => {
    FeedbackModal.show({ deps });
    const pickBtn = document.querySelector("#btn-feedback-pick-file");
    const fileInput = document.querySelector<HTMLInputElement>("#feedback-external-file");
    const fileNameSpan = document.querySelector("#feedback-selected-filename");
    expect(pickBtn).not.toBeNull();
    expect(fileInput).not.toBeNull();
    expect(fileNameSpan?.textContent).toBe("Ningún archivo adjunto");
  });
});
