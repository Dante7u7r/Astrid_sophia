/**
 * InstrumentsDock — Workbench Tab Manager
 *
 * Administra las pestañas del panel izquierdo del dock inferior.
 */

import { SignalGeneratorInstrument } from "./signal_generator_instrument";
import { LogicAnalyzerInstrument } from "./logic_analyzer_instrument";
import { FftAnalyzerInstrument } from "./fft_analyzer_instrument";
import { CurveTracerInstrument } from "./curve_tracer_instrument";
import { CanvasOrchestrator } from "../canvas_orchestrator";

export class InstrumentsDock {
  private container: HTMLElement;
  private tabs: NodeListOf<HTMLButtonElement>;
  private contents: NodeListOf<HTMLElement>;
  private activeTab: string = "oscilloscope";

  // Instrument Instances
  public generator: SignalGeneratorInstrument | null = null;
  public logicAnalyzer: LogicAnalyzerInstrument | null = null;
  public fftAnalyzer: FftAnalyzerInstrument | null = null;
  public curveTracer: CurveTracerInstrument | null = null;

  constructor(container: HTMLElement, orchestrator: CanvasOrchestrator, callbacks: any) {
    this.container = container;
    this.tabs = this.container.querySelectorAll(".inst-tab");
    this.contents = this.container.querySelectorAll(".inst-content-box");
    this.init(orchestrator, callbacks);
  }

  private init(orchestrator: CanvasOrchestrator, callbacks: any) {
    // 1. Vincular clics de pestañas
    this.tabs.forEach((tab) => {
      tab.addEventListener("click", () => {
        const targetTab = tab.getAttribute("data-tab");
        if (targetTab) this.switchTab(targetTab);
      });
    });

    // 2. Inicializar los instrumentos virtuales
    const genContainer = this.container.querySelector("#inst-generator") as HTMLElement;
    if (genContainer) {
      this.generator = new SignalGeneratorInstrument(genContainer, orchestrator, callbacks);
    }

    const logicContainer = this.container.querySelector("#inst-logic") as HTMLElement;
    if (logicContainer) {
      this.logicAnalyzer = new LogicAnalyzerInstrument(logicContainer, orchestrator, callbacks);
    }

    const fftContainer = this.container.querySelector("#inst-fft") as HTMLElement;
    if (fftContainer) {
      this.fftAnalyzer = new FftAnalyzerInstrument(fftContainer, callbacks);
    }

    const tracerContainer = this.container.querySelector("#inst-tracer") as HTMLElement;
    if (tracerContainer) {
      this.curveTracer = new CurveTracerInstrument(tracerContainer, orchestrator, callbacks);
    }
  }

  public switchTab(tabId: string) {
    this.activeTab = tabId;

    // Actualizar botones de pestaña
    this.tabs.forEach((tab) => {
      const isTarget = tab.getAttribute("data-tab") === tabId;
      tab.classList.toggle("active", isTarget);
      tab.style.color = isTarget ? "var(--cyan)" : "var(--text-muted)";
    });

    // Actualizar visibilidad de cajas de contenido
    this.contents.forEach((box) => {
      const isTarget = box.id === `inst-${tabId}`;
      box.style.display = isTarget ? (tabId === "oscilloscope" ? "flex" : "flex") : "none";
    });

    // Notificar redibujado
    if (tabId === "oscilloscope") {
      window.dispatchEvent(new Event("resize"));
    }
  }

  public getActiveTab(): string {
    return this.activeTab;
  }
}
