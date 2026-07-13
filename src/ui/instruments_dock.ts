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
import {
  createNoopInstrumentCallbacks,
  type InstrumentCallbacks,
} from "./instrument_callbacks";
import { updateQaState } from "../testing/qa_state";

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

  constructor(
    container: HTMLElement,
    orchestrator: CanvasOrchestrator,
    callbacks: Partial<InstrumentCallbacks>,
  ) {
    this.container = container;
    this.tabs = this.container.querySelectorAll(".inst-tab");
    this.contents = this.container.querySelectorAll(".inst-content-box");
    this.init(orchestrator, { ...createNoopInstrumentCallbacks(), ...callbacks });
  }

  private init(orchestrator: CanvasOrchestrator, callbacks: InstrumentCallbacks) {
    // 1. Vincular clics de pestañas
    const tabList = this.container.querySelector(".instruments-tabs-bar");
    tabList?.setAttribute("role", "tablist");
    tabList?.setAttribute("aria-label", "Instrumentos disponibles");

    this.tabs.forEach((tab, index) => {
      tab.addEventListener("click", () => {
        const targetTab = tab.getAttribute("data-tab");
        if (targetTab) this.switchTab(targetTab);
      });

      const targetTab = tab.getAttribute("data-tab");
      if (!targetTab) return;
      const panel = this.container.querySelector(`#inst-${targetTab}`);
      const tabId = `instrument-tab-${targetTab}`;
      tab.id = tabId;
      tab.setAttribute("role", "tab");
      tab.setAttribute("aria-controls", `inst-${targetTab}`);
      tab.setAttribute("aria-selected", String(index === 0));
      tab.tabIndex = index === 0 ? 0 : -1;
      panel?.setAttribute("role", "tabpanel");
      panel?.setAttribute("aria-labelledby", tabId);

      tab.addEventListener("keydown", (event) => {
        const tabs = [...this.tabs];
        let nextIndex = tabs.indexOf(tab);
        if (event.key === "ArrowRight") nextIndex = (nextIndex + 1) % tabs.length;
        else if (event.key === "ArrowLeft") nextIndex = (nextIndex - 1 + tabs.length) % tabs.length;
        else if (event.key === "Home") nextIndex = 0;
        else if (event.key === "End") nextIndex = tabs.length - 1;
        else return;

        event.preventDefault();
        const nextTab = tabs[nextIndex];
        const nextTarget = nextTab.getAttribute("data-tab");
        if (nextTarget) this.switchTab(nextTarget);
        nextTab.focus();
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
    updateQaState({ activeInstrumentTab: tabId });

    // Actualizar botones de pestaña
    this.tabs.forEach((tab) => {
      const isTarget = tab.getAttribute("data-tab") === tabId;
      tab.classList.toggle("active", isTarget);
      tab.style.color = isTarget ? "var(--cyan)" : "var(--text-muted)";
      tab.setAttribute("aria-selected", String(isTarget));
      tab.tabIndex = isTarget ? 0 : -1;
    });

    // Actualizar visibilidad de cajas de contenido
    this.contents.forEach((box) => {
      const isTarget = box.id === `inst-${tabId}`;
      box.style.display = isTarget ? (tabId === "oscilloscope" ? "flex" : "flex") : "none";
      box.toggleAttribute("hidden", !isTarget);
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
