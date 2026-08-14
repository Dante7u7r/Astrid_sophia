import type { OscilloscopePanel } from "../ui/oscilloscope_panel";

interface CanvasToolbarOrchestrator {
  components: unknown[];
  wires: unknown[];
  selectedComponent: unknown | null;
  gridSize: number;
  showWireLabels?: boolean;
  zoomAt(factor: number, x: number, y: number): void;
  fitToScreen?(margin?: number): boolean;
}

export interface CanvasToolbarControllerDeps {
  canvasElement: HTMLCanvasElement;
  getOrchestrator(): CanvasToolbarOrchestrator | null;
  getOscilloscopePanel(): OscilloscopePanel | null;
  clearVoltages(): void;
  resetPerformanceCaches(): void;
  updateCanvasRendering(): void;
  markCurrentTabAsModified(): void;
  addLog(text: string, type?: "system" | "error"): void;
}

export function initCanvasToolbarController(deps: CanvasToolbarControllerDeps): void {
  const btnClearCanvas = document.querySelector("#btn-clear-canvas");
  btnClearCanvas?.addEventListener("click", () => {
    const orchestrator = deps.getOrchestrator();
    if (!orchestrator) return;

    orchestrator.components = [];
    orchestrator.wires = [];
    orchestrator.selectedComponent = null;
    deps.clearVoltages();

    const oscilloscopePanel = deps.getOscilloscopePanel();
    if (oscilloscopePanel) {
      oscilloscopePanel.transientResults = [];
      oscilloscopePanel.acSweepResults = null;
      oscilloscopePanel.sweepTime = 0.0;
    }

    deps.resetPerformanceCaches();
    deps.updateCanvasRendering();
    deps.markCurrentTabAsModified();
    deps.addLog("Lienzo vaciado por completo. Memoria limpia.", "system");
  });

  const btnZoomIn = document.querySelector("#btn-zoom-in");
  btnZoomIn?.addEventListener("click", () => {
    deps.getOrchestrator()?.zoomAt(1.15, deps.canvasElement.clientWidth / 2, deps.canvasElement.clientHeight / 2);
    deps.updateCanvasRendering();
  });

  const btnZoomOut = document.querySelector("#btn-zoom-out");
  btnZoomOut?.addEventListener("click", () => {
    deps.getOrchestrator()?.zoomAt(0.85, deps.canvasElement.clientWidth / 2, deps.canvasElement.clientHeight / 2);
    deps.updateCanvasRendering();
  });

  const btnZoomFit = document.querySelector("#btn-zoom-fit");
  btnZoomFit?.addEventListener("click", () => {
    const fitted = deps.getOrchestrator()?.fitToScreen?.();
    if (fitted) {
      deps.updateCanvasRendering();
      deps.addLog("Esquema centrado y ajustado al lienzo.", "system");
    }
  });

  const btnToggleLabels = document.querySelector<HTMLButtonElement>("#btn-toggle-labels");
  if (btnToggleLabels) {
    let labelsEnabled = deps.getOrchestrator()?.showWireLabels ?? false;
    btnToggleLabels.classList.toggle("btn-active", labelsEnabled);
    btnToggleLabels.setAttribute("aria-pressed", String(labelsEnabled));
    btnToggleLabels.setAttribute(
      "aria-label",
      labelsEnabled ? "Ocultar etiquetas de cables" : "Mostrar etiquetas de cables",
    );
    btnToggleLabels.addEventListener("click", () => {
      const orch = deps.getOrchestrator();
      if (!orch) return;
      labelsEnabled = !labelsEnabled;
      orch.showWireLabels = labelsEnabled;
      btnToggleLabels.classList.toggle("btn-active", labelsEnabled);
      btnToggleLabels.setAttribute("aria-pressed", String(labelsEnabled));
      btnToggleLabels.setAttribute(
        "aria-label",
        labelsEnabled ? "Ocultar etiquetas de cables" : "Mostrar etiquetas de cables",
      );
      deps.updateCanvasRendering();
      deps.addLog(
        labelsEnabled ? "Etiquetas de cables visibles." : "Etiquetas de cables ocultas.",
        "system",
      );
    });
  }

  const btnSnapGrid = document.querySelector<HTMLButtonElement>("#btn-snap-grid");
  if (!btnSnapGrid || !deps.getOrchestrator()) return;

  let snapEnabled = true;
  btnSnapGrid.addEventListener("click", () => {
    snapEnabled = !snapEnabled;
    btnSnapGrid.classList.toggle("btn-active", snapEnabled);
    btnSnapGrid.setAttribute("aria-pressed", String(snapEnabled));
    btnSnapGrid.setAttribute(
      "aria-label",
      snapEnabled ? "Desactivar ajuste a rejilla" : "Activar ajuste a rejilla",
    );

    const orchestrator = deps.getOrchestrator();
    if (orchestrator) {
      orchestrator.gridSize = snapEnabled ? 20 : 1;
    }
    deps.addLog(snapEnabled ? "Alineación a rejilla activada." : "Alineación a rejilla desactivada.", "system");
  });
}
