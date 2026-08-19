/**
 * BodeAnalyzerInstrument — Analizador de Respuesta en Frecuencia (Bode / AC / BA-2000 Pro)
 *
 * Instrumento de laboratorio para Diagramas de Bode (Magnitud/Fase), Sensibilidad y Polos/Ceros,
 * con cálculo de margen de fase, margen de ganancia, frecuencia de corte y cursores de frecuencia.
 */

import type { CanvasOrchestrator } from "../canvas_orchestrator";
import type { InstrumentCallbacks } from "./instrument_callbacks";
import { createNoopInstrumentCallbacks } from "./instrument_callbacks";
import { ensureCanvasDpr } from "./canvas_dpr";
import {
  generateRcLowPassBode,
  processAcSweepData,
  type BodeDataSet,
} from "./bode_plot_model";
import { drawBodePlot } from "./bode_plot_renderer";
import { drawSensitivityPlot } from "./sensitivity_plot_renderer";
import { drawPoleZeroPlot } from "./pole_zero_renderer";
import type { SensitivityAnalysisResult, StabilityAnalysisResult } from "../simulation/tauri_commands";
import type { AcSweepResult } from "./oscilloscope_panel";

export type BodeViewMode = "bode" | "sens" | "polezero";

export class BodeAnalyzerInstrument {
  private container: HTMLElement;
  public readonly orchestrator: CanvasOrchestrator;
  private canvas: HTMLCanvasElement | null = null;
  private ctx: CanvasRenderingContext2D | null = null;
  private resizeObserver: ResizeObserver | null = null;

  // Modo de visualización activo
  private viewMode: BodeViewMode = "bode";

  // Parámetros de barrido AC
  private fStart = 10;
  private fEnd = 1_000_000;
  private pointsPerDecade = 25;
  private outputNode = "1";

  // Cursores de Frecuencia F1 y F2
  private isCursorsEnabled = false;
  private cursorF1: number | null = null;
  private cursorF2: number | null = null;

  // Resultados almacenados
  private bodeData: BodeDataSet | null = null;
  private sensResult: SensitivityAnalysisResult | null = null;
  private stabilityResult: StabilityAnalysisResult | null = null;

  constructor(
    container: HTMLElement,
    orchestrator: CanvasOrchestrator,
    _callbacks: InstrumentCallbacks = createNoopInstrumentCallbacks(),
  ) {
    this.container = container;
    this.orchestrator = orchestrator;
    this.render();
    this.initCanvas();
    this.bindEvents();
    this.loadDefaultPreset();
  }

  private render(): void {
    this.container.innerHTML = `
      <div class="bode-main-layout">
        <!-- Barra Lateral: Controles y Métricas de Respuesta -->
        <aside class="bode-sidebar">
          <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 2px;">
            <h4 class="gen-section-title" style="color: #38bdf8;">📈 Análisis AC / Bode</h4>
          </div>

          <!-- Selector de Modo de Visualización -->
          <div style="display: flex; flex-direction: column; gap: 2px;">
            <label class="rack-label" style="font-size: 0.58rem;">Modo de Visualización</label>
            <div style="display: flex; gap: 2px;">
              <button id="bode-btn-mode-bode" type="button" class="bode-btn active" style="flex: 1; justify-content: center;">Bode</button>
              <button id="bode-btn-mode-sens" type="button" class="bode-btn" style="flex: 1; justify-content: center;">Sensib.</button>
              <button id="bode-btn-mode-pz" type="button" class="bode-btn" style="flex: 1; justify-content: center;">Polos/S</button>
            </div>
          </div>

          <!-- Parámetros de Barrido de Frecuencia -->
          <div id="bode-sweep-controls" style="display: flex; flex-direction: column; gap: 4px;">
            <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 4px;">
              <div style="display: flex; flex-direction: column; gap: 2px;">
                <label class="rack-label" style="font-size: 0.58rem;">F. Inicial (Hz)</label>
                <input id="bode-input-fstart" type="number" class="gen-input" value="10" min="0.01" step="any" />
              </div>
              <div style="display: flex; flex-direction: column; gap: 2px;">
                <label class="rack-label" style="font-size: 0.58rem;">F. Final (Hz)</label>
                <input id="bode-input-fend" type="number" class="gen-input" value="1000000" min="1" step="any" />
              </div>
            </div>

            <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 4px;">
              <div style="display: flex; flex-direction: column; gap: 2px;">
                <label class="rack-label" style="font-size: 0.58rem;">Puntos/Década</label>
                <select id="bode-select-ppd" class="osc-select-mini" style="cursor: pointer;">
                  <option value="10">10 pts</option>
                  <option value="25" selected>25 pts</option>
                  <option value="50">50 pts</option>
                  <option value="100">100 pts</option>
                </select>
              </div>
              <div style="display: flex; flex-direction: column; gap: 2px;">
                <label class="rack-label" style="font-size: 0.58rem;">Nodo Medido</label>
                <input id="bode-input-node" type="text" class="gen-input" value="1" placeholder="ej. 1, out" />
              </div>
            </div>
          </div>

          <!-- Botón de Ejecución Rápida -->
          <button id="bode-btn-run" type="button" class="gen-trigger-btn" style="width: 100%; justify-content: center; margin-top: 2px;">
            🚀 Ejecutar Barrido AC
          </button>

          <!-- Tarjetas de Métricas de Estabilidad y Ancho de Banda -->
          <div style="display: flex; flex-direction: column; gap: 4px; margin-top: 4px;">
            <div class="tracer-metric-card">
              <span class="rack-label" style="font-size: 0.55rem; color: #38bdf8;">Frec. Corte fc (-3dB)</span>
              <span id="bode-metric-fc" class="tracer-metric-val" style="color: #22c55e;">—</span>
            </div>

            <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 4px;">
              <div class="tracer-metric-card">
                <span class="rack-label" style="font-size: 0.55rem; color: #f59e0b;">Margen Fase (PM)</span>
                <span id="bode-metric-pm" style="font-family: var(--font-mono); font-size: 0.75rem; font-weight: bold; color: #fff;">—</span>
              </div>
              <div class="tracer-metric-card">
                <span class="rack-label" style="font-size: 0.55rem; color: #ec4899;">Margen Gan. (GM)</span>
                <span id="bode-metric-gm" style="font-family: var(--font-mono); font-size: 0.75rem; font-weight: bold; color: #fff;">—</span>
              </div>
            </div>

            <div class="tracer-metric-card">
              <span class="rack-label" style="font-size: 0.55rem;">Estabilidad en Lazo</span>
              <span id="bode-metric-stability" style="font-family: var(--font-mono); font-size: 0.65rem; font-weight: bold; color: #38bdf8;">—</span>
            </div>
          </div>

          <!-- Botones de Cursores y Exportación -->
          <div style="display: flex; gap: 4px; margin-top: 4px;">
            <button id="bode-btn-cursors" type="button" class="bode-btn" style="flex: 1; justify-content: center;">📍 Cursores</button>
            <button id="bode-btn-csv" type="button" class="bode-btn" style="flex: 1; justify-content: center;">📥 CSV</button>
            <button id="bode-btn-png" type="button" class="bode-btn" style="flex: 1; justify-content: center;">📸 PNG</button>
          </div>
        </aside>

        <!-- Área Central del Viewport Gráfico -->
        <main class="bode-viewport-frame">
          <canvas id="bode-canvas" class="bode-canvas"></canvas>
        </main>
      </div>
    `;
  }

  private initCanvas(): void {
    this.canvas = this.container.querySelector("#bode-canvas") as HTMLCanvasElement | null;
    if (!this.canvas) return;
    this.ctx = this.canvas.getContext("2d");

    this.resizeObserver = new ResizeObserver(() => {
      this.draw();
    });
    this.resizeObserver.observe(this.canvas);
  }

  private bindEvents(): void {
    // Selector de Modo de Visualización
    const btnBode = this.container.querySelector("#bode-btn-mode-bode");
    const btnSens = this.container.querySelector("#bode-btn-mode-sens");
    const btnPz = this.container.querySelector("#bode-btn-mode-pz");

    btnBode?.addEventListener("click", () => {
      this.setViewMode("bode");
      btnBode.classList.add("active");
      btnSens?.classList.remove("active");
      btnPz?.classList.remove("active");
    });

    btnSens?.addEventListener("click", () => {
      this.setViewMode("sens");
      btnSens.classList.add("active");
      btnBode?.classList.remove("active");
      btnPz?.classList.remove("active");
    });

    btnPz?.addEventListener("click", () => {
      this.setViewMode("polezero");
      btnPz.classList.add("active");
      btnBode?.classList.remove("active");
      btnSens?.classList.remove("active");
    });

    // Inputs de Frecuencia
    this.container.querySelector("#bode-input-fstart")?.addEventListener("change", (e) => {
      this.fStart = Number((e.target as HTMLInputElement).value) || 10;
    });
    this.container.querySelector("#bode-input-fend")?.addEventListener("change", (e) => {
      this.fEnd = Number((e.target as HTMLInputElement).value) || 1_000_000;
    });
    this.container.querySelector("#bode-select-ppd")?.addEventListener("change", (e) => {
      this.pointsPerDecade = Number((e.target as HTMLSelectElement).value) || 25;
    });
    this.container.querySelector("#bode-input-node")?.addEventListener("change", (e) => {
      this.outputNode = (e.target as HTMLInputElement).value.trim() || "1";
    });

    // Botón Ejecutar
    this.container.querySelector("#bode-btn-run")?.addEventListener("click", () => {
      this.runSimulation();
    });

    // Botón Cursores
    const cursorsBtn = this.container.querySelector("#bode-btn-cursors") as HTMLButtonElement | null;
    cursorsBtn?.addEventListener("click", () => {
      this.isCursorsEnabled = !this.isCursorsEnabled;
      cursorsBtn.classList.toggle("active", this.isCursorsEnabled);
      if (this.isCursorsEnabled && this.bodeData && this.bodeData.points.length > 0) {
        this.cursorF1 = this.bodeData.points[Math.floor(this.bodeData.points.length * 0.25)].freq;
        this.cursorF2 = this.bodeData.points[Math.floor(this.bodeData.points.length * 0.75)].freq;
      }
      this.draw();
    });

    // Botón Exportar CSV
    this.container.querySelector("#bode-btn-csv")?.addEventListener("click", () => {
      this.exportCsv();
    });

    // Botón Exportar PNG
    this.container.querySelector("#bode-btn-png")?.addEventListener("click", () => {
      this.exportPng();
    });
  }

  public setViewMode(mode: BodeViewMode): void {
    this.viewMode = mode;
    this.draw();
  }

  public loadDefaultPreset(): void {
    // Cargar filtro RC paso bajo (1k + 100nF -> fc = 1.59 kHz) por defecto
    this.bodeData = generateRcLowPassBode(1000, 100e-9, this.fStart, this.fEnd, this.pointsPerDecade);
    this.updateMetricsUi();
    this.draw();
  }

  public setAcSweepResult(result: AcSweepResult, measuredNode?: string): void {
    const node = measuredNode || this.outputNode || Object.keys(result.nodeAmplitudes)[0] || "1";
    const amplitudes = result.nodeAmplitudes[node] || [];
    const phases = result.nodePhases[node] || [];

    this.bodeData = processAcSweepData(result.frequencies, amplitudes, phases, 1.0);
    this.setViewMode("bode");
    this.updateMetricsUi();
    this.draw();
  }

  public setSensitivityResult(result: SensitivityAnalysisResult): void {
    this.sensResult = result;
    this.setViewMode("sens");
    this.draw();
  }

  public setStabilityResult(result: StabilityAnalysisResult): void {
    this.stabilityResult = result;
    this.setViewMode("polezero");
    this.draw();
  }

  private updateMetricsUi(): void {
    if (!this.bodeData) return;
    const m = this.bodeData.metrics;

    const fcEl = this.container.querySelector("#bode-metric-fc");
    if (fcEl) {
      fcEl.textContent = m.cutoffFreq3dB ? formatFreq(m.cutoffFreq3dB) : "—";
    }

    const pmEl = this.container.querySelector("#bode-metric-pm");
    if (pmEl) {
      pmEl.textContent = m.phaseMarginDeg !== null ? `${m.phaseMarginDeg.toFixed(1)}°` : "—";
    }

    const gmEl = this.container.querySelector("#bode-metric-gm");
    if (gmEl) {
      gmEl.textContent = m.gainMarginDb !== null ? `${m.gainMarginDb.toFixed(1)} dB` : "—";
    }

    const stabEl = this.container.querySelector("#bode-metric-stability");
    if (stabEl) {
      if (m.phaseMarginDeg !== null) {
        if (m.phaseMarginDeg > 45) {
          stabEl.textContent = "✓ Estable (PM > 45°)";
          (stabEl as HTMLElement).style.color = "#22c55e";
        } else if (m.phaseMarginDeg > 0) {
          stabEl.textContent = "⚠ Marginal (PM < 45°)";
          (stabEl as HTMLElement).style.color = "#f59e0b";
        } else {
          stabEl.textContent = "🛑 Inestable (PM ≤ 0°)";
          (stabEl as HTMLElement).style.color = "#f87171";
        }
      } else {
        stabEl.textContent = "Estable (Sin cruce 0dB)";
        (stabEl as HTMLElement).style.color = "#38bdf8";
      }
    }
  }

  public draw(): void {
    if (!this.canvas || !this.ctx) return;
    const { width, height } = ensureCanvasDpr(this.canvas, this.ctx);

    if (this.viewMode === "bode") {
      drawBodePlot(this.ctx, width, height, this.bodeData, {
        fMin: this.fStart,
        fMax: this.fEnd,
        isCursorsEnabled: this.isCursorsEnabled,
        cursorF1: this.cursorF1,
        cursorF2: this.cursorF2,
      });
    } else if (this.viewMode === "sens") {
      drawSensitivityPlot(this.ctx, width, height, this.sensResult);
    } else if (this.viewMode === "polezero") {
      drawPoleZeroPlot(this.ctx, width, height, this.stabilityResult);
    }
  }

  private runSimulation(): void {
    // Si hay un botón de ejecutar simulación en la barra superior con modo AC, activarlo
    const runSimBtn = document.querySelector("#run-sim-btn") as HTMLButtonElement | null;
    const modeSelect = document.querySelector("#analysis-mode-select") as HTMLSelectElement | null;
    if (modeSelect && modeSelect.value !== "AC") {
      modeSelect.value = "AC";
      modeSelect.dispatchEvent(new Event("change"));
    }
    if (runSimBtn && !runSimBtn.disabled) {
      runSimBtn.click();
    }
  }

  private exportCsv(): void {
    if (!this.bodeData || this.bodeData.points.length === 0) return;
    const lines = ["Frecuencia_Hz,Magnitud_dB,Fase_Deg,Magnitud_Lineal_V"];
    for (const pt of this.bodeData.points) {
      lines.push(`${pt.freq.toFixed(4)},${pt.magDb.toFixed(4)},${pt.phaseDeg.toFixed(4)},${pt.magLinear.toFixed(6)}`);
    }
    const blob = new Blob([lines.join("\n")], { type: "text/csv" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = `bode_diagram_${Date.now()}.csv`;
    link.click();
    URL.revokeObjectURL(url);
  }

  private exportPng(): void {
    if (!this.canvas) return;
    const url = this.canvas.toDataURL("image/png");
    const link = document.createElement("a");
    link.href = url;
    link.download = `bode_plot_${Date.now()}.png`;
    link.click();
  }

  public destroy(): void {
    if (this.resizeObserver) {
      this.resizeObserver.disconnect();
      this.resizeObserver = null;
    }
  }
}

function formatFreq(hz: number): string {
  if (hz >= 1e9) return `${(hz / 1e9).toFixed(2)} GHz`;
  if (hz >= 1e6) return `${(hz / 1e6).toFixed(2)} MHz`;
  if (hz >= 1e3) return `${(hz / 1e3).toFixed(2)} kHz`;
  return `${hz.toFixed(2)} Hz`;
}
