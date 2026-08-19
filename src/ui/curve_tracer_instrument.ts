/**
 * CurveTracerInstrument — Trazador de Curvas I-V de Semiconductores (CT-500 Pro)
 *
 * Instrumento de laboratorio para trazado paramétrico de características I-V en semiconductores
 * (Diodos, Zener, LEDs, BJTs NPN/PNP, MOSFETs N/P, JFETs N/P y Resistencias) con extracción de parámetros.
 */

import type { CanvasOrchestrator } from "../canvas_orchestrator";
import { createNoopInstrumentCallbacks, type InstrumentCallbacks } from "./instrument_callbacks";
import { ensureCanvasDpr } from "./canvas_dpr";
import {
  DEVICE_PRESETS,
  type DevicePreset,
  generateDeviceTrace,
  type TraceConfig,
  type TraceMode,
  type TraceResult,
} from "./curve_tracer_model";
import { drawCurveTracer } from "./curve_tracer_renderer";

export class CurveTracerInstrument {
  private container: HTMLElement;
  private orchestrator: CanvasOrchestrator;
  private canvas: HTMLCanvasElement | null = null;
  private ctx: CanvasRenderingContext2D | null = null;
  private resizeObserver: ResizeObserver | null = null;
  private syncTimer: number | null = null;

  // Dispositivo seleccionado y configuración de barrido
  private currentPreset: DevicePreset = DEVICE_PRESETS[0]; // 1N4148 por defecto
  private sweepMode: TraceMode = "output";
  private vMax = 5.0;
  private numSteps = 5;
  private selectedCompId: string | null = null;

  // Punto de operación Q interactivo
  private isQPointEnabled = false;
  private qPoint: { v: number; i: number } | null = null;

  // Último resultado generado
  private lastResult: TraceResult | null = null;

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
    this.runTrace();
  }

  private render(): void {
    this.container.innerHTML = `
      <div class="tracer-main-layout">
        <!-- Barra Lateral: Dispositivo, Barrido y Parámetros Extraídos -->
        <aside class="tracer-sidebar">
          <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 2px;">
            <h4 class="gen-section-title" style="color: #38bdf8;">🔬 Trazador I-V</h4>
          </div>

          <!-- Selector de Dispositivo Objetivo -->
          <div style="display: flex; flex-direction: column; gap: 2px;">
            <label class="rack-label" style="font-size: 0.58rem;">Dispositivo Objetivo</label>
            <select id="tracer-select-preset" class="osc-select" style="width: 100%; cursor: pointer;">
              ${DEVICE_PRESETS.map((d) => `<option value="${d.id}" ${d.id === this.currentPreset.id ? "selected" : ""}>${d.name}</option>`).join("")}
            </select>
          </div>

          <!-- Componente Vinculado del Esquema -->
          <div style="background: rgba(0,0,0,0.3); border: 1px solid rgba(255,255,255,0.06); padding: 5px 8px; border-radius: 5px; display: flex; justify-content: space-between; align-items: center;">
            <span class="rack-label" style="font-size: 0.56rem;">En Lienzo:</span>
            <span id="tracer-schematic-link" style="font-family: var(--font-mono); font-size: 0.68rem; font-weight: bold; color: #38bdf8;">[Manual]</span>
          </div>

          <!-- Tipo de Barrido y Configuración -->
          <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 4px;">
            <div style="display: flex; flex-direction: column; gap: 2px;">
              <label class="rack-label" style="font-size: 0.58rem;">Modo de Curva</label>
              <select id="tracer-select-mode" class="osc-select-mini" style="cursor: pointer;">
                <option value="output" selected>Salida (Ic/Id-V)</option>
                <option value="transfer">Transferencia</option>
                <option value="bipolar">Bipolar (±V)</option>
              </select>
            </div>
            <div style="display: flex; flex-direction: column; gap: 2px;">
              <label class="rack-label" style="font-size: 0.58rem;">Pasos de Base/Gate</label>
              <select id="tracer-select-steps" class="osc-select-mini" style="cursor: pointer;">
                <option value="3">3 Pasos</option>
                <option value="5" selected>5 Pasos</option>
                <option value="8">8 Pasos</option>
              </select>
            </div>
          </div>

          <!-- Tensión Máxima de Barrido -->
          <div style="display: flex; flex-direction: column; gap: 2px;">
            <label class="rack-label" style="font-size: 0.58rem;">Tensión Máxima (V-Sweep)</label>
            <div style="display: flex; align-items: center; gap: 4px;">
              <input type="number" id="tracer-input-vmax" value="5.0" min="0.5" max="50" step="0.5" class="gen-param-input" style="flex: 1;" />
              <span class="rack-label" style="font-size: 0.65rem;">V</span>
            </div>
          </div>

          <!-- Botón de Ejecución Rápida -->
          <button id="tracer-btn-run" type="button" class="tracer-btn active" style="justify-content: center; padding: 6px; font-size: 0.72rem; margin-top: 2px;">
            🚀 Ejecutar Trazado I-V
          </button>

          <!-- Tarjetas de Parámetros de Semiconductor Extraídos -->
          <div style="display: flex; flex-direction: column; gap: 4px; border-top: 1px solid rgba(255,255,255,0.08); padding-top: 6px; flex: 1; overflow-y: auto;">
            <div class="tracer-metric-card">
              <span id="tracer-metric-title-1" class="rack-label" style="color: #38bdf8;">Tensión Forward (Vf @ 1mA)</span>
              <span id="tracer-metric-val-1" class="tracer-metric-val" style="color: #38bdf8;">-- V</span>
            </div>

            <div class="tracer-metric-card">
              <span id="tracer-metric-title-2" class="rack-label" style="color: #a855f7;">Resistencia Dinámica (Rd / rds)</span>
              <span id="tracer-metric-val-2" class="tracer-metric-val" style="color: #c084fc;">-- Ω</span>
            </div>

            <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 4px;">
              <div class="tracer-metric-card">
                <span id="tracer-metric-title-3" class="rack-label" style="font-size: 0.55rem;">Ganancia / gm</span>
                <span id="tracer-metric-val-3" style="font-family: var(--font-mono); font-size: 0.72rem; font-weight: bold; color: #22c55e;">--</span>
              </div>
              <div class="tracer-metric-card">
                <span id="tracer-metric-title-4" class="rack-label" style="font-size: 0.55rem;">Tensión Ruptura / Vaf</span>
                <span id="tracer-metric-val-4" style="font-family: var(--font-mono); font-size: 0.72rem; font-weight: bold; color: #eab308;">--</span>
              </div>
            </div>
          </div>
        </aside>

        <!-- Área Principal del Trazador I-V -->
        <main class="tracer-content-area">
          <!-- Barra Superior: Controles de Punto Q, Recta de Carga y Exportación -->
          <div class="tracer-top-bar">
            <div style="display: flex; gap: 4px; align-items: center;">
              <button id="tracer-btn-qpoint" type="button" class="tracer-btn" title="Alternar cursor de punto de trabajo Q">
                📍 Punto Q: OFF
              </button>
            </div>

            <div style="display: flex; gap: 4px; align-items: center;">
              <button id="tracer-btn-export-csv" type="button" class="tracer-btn" title="Exportar familia de curvas a CSV">💾 CSV</button>
              <button id="tracer-btn-snapshot" type="button" class="tracer-btn" title="Descargar captura PNG">📸 PNG</button>
            </div>
          </div>

          <!-- Visor Gráfico Central del Trazador de Curvas -->
          <div class="tracer-viewport-frame">
            <canvas id="tracer-canvas" class="tracer-canvas"></canvas>
          </div>

          <!-- Barra Inferior de Telemetría -->
          <div class="tracer-telemetry-bar">
            <span id="tracer-status-device">Dispositivo: ${this.currentPreset.name}</span>
            <span id="tracer-status-range">Rango: 0 V .. ${this.vMax} V</span>
            <span id="tracer-status-q">Q: Inactivo</span>
          </div>
        </main>
      </div>
    `;
  }

  private initCanvas(): void {
    this.canvas = this.container.querySelector("#tracer-canvas") as HTMLCanvasElement;
    if (this.canvas) {
      this.ctx = this.canvas.getContext("2d");
      this.resizeObserver = new ResizeObserver(() => {
        this.draw();
      });
      this.resizeObserver.observe(this.canvas);
      this.draw();
    }
  }

  private bindEvents(): void {
    // 1. Selector de Presets de Semiconductores
    const presetSelect = this.container.querySelector("#tracer-select-preset") as HTMLSelectElement | null;
    presetSelect?.addEventListener("change", () => {
      const found = DEVICE_PRESETS.find((d) => d.id === presetSelect.value);
      if (found) {
        this.currentPreset = found;
        this.adaptModeForCategory(found.category);
        this.runTrace();
      }
    });

    // 2. Selector de Modo de Curva (Salida, Transferencia, Bipolar)
    const modeSelect = this.container.querySelector("#tracer-select-mode") as HTMLSelectElement | null;
    modeSelect?.addEventListener("change", () => {
      this.sweepMode = (modeSelect?.value || "output") as TraceMode;
      this.runTrace();
    });

    // 3. Selector de Pasos
    const stepsSelect = this.container.querySelector("#tracer-select-steps") as HTMLSelectElement | null;
    stepsSelect?.addEventListener("change", () => {
      this.numSteps = parseInt(stepsSelect?.value || "5", 10);
      this.runTrace();
    });

    // 4. Tensión Máxima V-Sweep
    const vmaxInput = this.container.querySelector("#tracer-input-vmax") as HTMLInputElement | null;
    vmaxInput?.addEventListener("change", () => {
      this.vMax = Math.max(0.5, Math.min(100, parseFloat(vmaxInput?.value || "5.0")));
      this.runTrace();
    });

    // 5. Botón Ejecutar Trazado
    this.container.querySelector("#tracer-btn-run")?.addEventListener("click", () => this.runTrace());

    // 6. Punto Q ON/OFF
    const qBtn = this.container.querySelector("#tracer-btn-qpoint") as HTMLButtonElement | null;
    qBtn?.addEventListener("click", () => {
      this.isQPointEnabled = !this.isQPointEnabled;
      qBtn.classList.toggle("active", this.isQPointEnabled);
      qBtn.textContent = this.isQPointEnabled ? "📍 Punto Q: ON" : "📍 Punto Q: OFF";

      if (this.isQPointEnabled && this.lastResult && this.lastResult.traces.length > 0) {
        const midTrace = this.lastResult.traces[Math.floor(this.lastResult.traces.length / 2)];
        const midPt = midTrace.points[Math.floor(midTrace.points.length * 0.6)];
        this.qPoint = { v: midPt.v, i: midPt.i };
      } else {
        this.qPoint = null;
      }
      this.draw();
      this.updateStatusFooter();
    });

    // 7. Click en Canvas para reposicionar punto Q
    this.canvas?.addEventListener("click", (evt) => {
      if (!this.isQPointEnabled || !this.lastResult || !this.canvas) return;
      const rect = this.canvas.getBoundingClientRect();
      const clickX = evt.clientX - rect.left;
      const plotW = this.canvas.clientWidth - 68;
      const normX = Math.max(0, Math.min(1, (clickX - 52) / plotW));

      const vSpan = this.lastResult.vMax - this.lastResult.vMin;
      const targetV = this.lastResult.vMin + normX * vSpan;

      // Buscar el punto más cercano en la curva del medio
      const midTrace = this.lastResult.traces[Math.floor(this.lastResult.traces.length / 2)];
      let closestPt = midTrace.points[0];
      let minDiff = Infinity;

      for (const pt of midTrace.points) {
        const diff = Math.abs(pt.v - targetV);
        if (diff < minDiff) {
          minDiff = diff;
          closestPt = pt;
        }
      }

      this.qPoint = { v: closestPt.v, i: closestPt.i };
      this.draw();
      this.updateStatusFooter();
    });

    // 8. Exportación CSV y Snapshot PNG
    this.container.querySelector("#tracer-btn-export-csv")?.addEventListener("click", () => this.exportCsv());
    this.container.querySelector("#tracer-btn-snapshot")?.addEventListener("click", () => this.snapshotPng());

    // 9. Sincronización automática de selección de esquemático
    this.syncTimer = window.setInterval(() => {
      this.syncSelectedSchematicComponent();
    }, 1000);
  }

  private adaptModeForCategory(category: string): void {
    const modeSelect = this.container.querySelector("#tracer-select-mode") as HTMLSelectElement | null;
    if (category === "diode" || category === "resistor") {
      if (modeSelect) modeSelect.value = "output";
      this.sweepMode = "output";
    }
  }

  private syncSelectedSchematicComponent(): void {
    const sel = this.orchestrator.selectedComponent;
    const linkEl = this.container.querySelector("#tracer-schematic-link");

    if (sel) {
      const compType = sel.type as string;
      if (["diode", "npn", "pnp", "nmos", "pmos", "jfet", "led", "resistor"].includes(compType)) {
        if (this.selectedCompId !== sel.id) {
          this.selectedCompId = sel.id;
          if (linkEl) linkEl.textContent = `${sel.id.toUpperCase()} (${compType.toUpperCase()})`;

          // Buscar un preset correspondiente al tipo
          const matchingPreset = DEVICE_PRESETS.find((p) => {
            if (compType === "diode" || compType === "led") return p.category === "diode";
            if (compType === "npn" || compType === "pnp") return p.category === "bjt";
            if (compType === "nmos" || compType === "pmos") return p.category === "mosfet";
            if (compType === "jfet") return p.category === "jfet";
            if (compType === "resistor") return p.category === "resistor";
            return false;
          });

          if (matchingPreset) {
            this.currentPreset = matchingPreset;
            const selectEl = this.container.querySelector("#tracer-select-preset") as HTMLSelectElement | null;
            if (selectEl) selectEl.value = matchingPreset.id;
            this.runTrace();
          }
        }
      }
    } else if (!sel && this.selectedCompId) {
      this.selectedCompId = null;
      if (linkEl) linkEl.textContent = "[Manual]";
    }
  }

  public runTrace(): void {
    const config: TraceConfig = {
      vMax: this.vMax,
      numPoints: 150,
      numSteps: this.numSteps,
      mode: this.sweepMode,
    };

    this.lastResult = generateDeviceTrace(this.currentPreset, config);
    this.updateMetricsUI(this.lastResult);
    this.draw();
    this.updateStatusFooter();
  }

  private draw(): void {
    if (!this.canvas || !this.ctx) return;
    const { width, height } = ensureCanvasDpr(this.canvas, this.ctx);

    drawCurveTracer(this.ctx, {
      width,
      height,
      result: this.lastResult,
      qPoint: this.qPoint,
      showTangent: true,
    });
  }

  private updateMetricsUI(result: TraceResult): void {
    const title1 = this.container.querySelector("#tracer-metric-title-1");
    const val1 = this.container.querySelector("#tracer-metric-val-1");
    const title2 = this.container.querySelector("#tracer-metric-title-2");
    const val2 = this.container.querySelector("#tracer-metric-val-2");
    const title3 = this.container.querySelector("#tracer-metric-title-3");
    const val3 = this.container.querySelector("#tracer-metric-val-3");
    const title4 = this.container.querySelector("#tracer-metric-title-4");
    const val4 = this.container.querySelector("#tracer-metric-val-4");

    const p = result.params;

    if (result.category === "diode") {
      if (title1) title1.textContent = "Tensión Forward (Vf @ 1mA)";
      if (val1) val1.textContent = p.vf1mA !== undefined ? `${p.vf1mA.toFixed(3)} V` : "-- V";

      if (title2) title2.textContent = "Resistencia Dinámica (Rd)";
      if (val2) val2.textContent = p.dynamicRes !== undefined ? `${p.dynamicRes.toFixed(2)} Ω` : "-- Ω";

      if (title3) title3.textContent = "Vf @ 10mA";
      if (val3) val3.textContent = p.vf10mA !== undefined ? `${p.vf10mA.toFixed(3)} V` : "-- V";

      if (title4) title4.textContent = "Tensión Zener (Vz)";
      if (val4) val4.textContent = p.zenerVoltage !== undefined ? `${p.zenerVoltage.toFixed(1)} V` : "--";
    } else if (result.category === "bjt") {
      if (title1) title1.textContent = "Ganancia de Corriente (hFE DC)";
      if (val1) val1.textContent = p.hFE_DC !== undefined ? `${p.hFE_DC.toFixed(0)}` : "--";

      if (title2) title2.textContent = "Tensión de Saturación (Vce sat)";
      if (val2) val2.textContent = p.vceSat !== undefined ? `${p.vceSat.toFixed(2)} V` : "-- V";

      if (title3) title3.textContent = "Ganancia hfe AC";
      if (val3) val3.textContent = p.hfe_AC !== undefined ? `${p.hfe_AC.toFixed(0)}` : "--";

      if (title4) title4.textContent = "Tensión Early (Vaf)";
      if (val4) val4.textContent = p.earlyVoltage !== undefined ? `${p.earlyVoltage.toFixed(0)} V` : "--";
    } else if (result.category === "mosfet") {
      if (title1) title1.textContent = "Tensión Umbral (Vth)";
      if (val1) val1.textContent = p.vth !== undefined ? `${p.vth.toFixed(2)} V` : "-- V";

      if (title2) title2.textContent = "Resistencia Rds(on)";
      if (val2) val2.textContent = p.rdsOn !== undefined ? (p.rdsOn < 1 ? `${(p.rdsOn * 1e3).toFixed(1)} mΩ` : `${p.rdsOn.toFixed(2)} Ω`) : "--";

      if (title3) title3.textContent = "Transconductancia (gm)";
      if (val3) val3.textContent = p.gm !== undefined ? `${(p.gm * 1e3).toFixed(1)} mS` : "--";

      if (title4) title4.textContent = "Tipo";
      if (val4) val4.textContent = "MOSFET";
    } else if (result.category === "jfet") {
      if (title1) title1.textContent = "Pinch-off (Vp)";
      if (val1) val1.textContent = p.vth !== undefined ? `${p.vth.toFixed(2)} V` : "-- V";

      if (title2) title2.textContent = "Corriente Idss";
      if (val2) val2.textContent = p.idss !== undefined ? `${(p.idss * 1e3).toFixed(2)} mA` : "--";

      if (title3) title3.textContent = "gm0 (Transcond.)";
      if (val3) val3.textContent = p.gm !== undefined ? `${(p.gm * 1e3).toFixed(1)} mS` : "--";

      if (title4) title4.textContent = "Rds(on)";
      if (val4) val4.textContent = p.rdsOn !== undefined ? `${p.rdsOn.toFixed(1)} Ω` : "--";
    } else {
      // Resistencia
      if (title1) title1.textContent = "Resistencia Medida (R)";
      if (val1) val1.textContent = p.resistance !== undefined ? `${p.resistance.toFixed(1)} Ω` : "-- Ω";

      if (title2) title2.textContent = "Conductancia (G)";
      if (val2) val2.textContent = p.resistance !== undefined ? `${(1 / p.resistance * 1e3).toFixed(2)} mS` : "--";

      if (title3) title3.textContent = "Linealidad";
      if (val3) val3.textContent = "100 %";

      if (title4) title4.textContent = "Tipo";
      if (val4) val4.textContent = "Óhmico";
    }
  }

  private updateStatusFooter(): void {
    const devEl = this.container.querySelector("#tracer-status-device");
    const rangeEl = this.container.querySelector("#tracer-status-range");
    const qEl = this.container.querySelector("#tracer-status-q");

    if (devEl) devEl.textContent = `Dispositivo: ${this.currentPreset.name}`;
    if (rangeEl && this.lastResult) {
      rangeEl.textContent = `Rango: ${this.lastResult.vMin.toFixed(1)} V .. ${this.lastResult.vMax.toFixed(1)} V`;
    }
    if (qEl) {
      if (this.isQPointEnabled && this.qPoint) {
        const vStr = Math.abs(this.qPoint.v) >= 1 ? `${this.qPoint.v.toFixed(2)}V` : `${(this.qPoint.v * 1e3).toFixed(1)}mV`;
        const iStr =
          Math.abs(this.qPoint.i) >= 1.0 ? `${this.qPoint.i.toFixed(3)}A` :
          Math.abs(this.qPoint.i) >= 1e-3 ? `${(this.qPoint.i * 1e3).toFixed(2)}mA` :
          `${(this.qPoint.i * 1e6).toFixed(1)}µA`;
        qEl.textContent = `Q: (${vStr}, ${iStr})`;
      } else {
        qEl.textContent = "Q: Inactivo";
      }
    }
  }

  public exportCsv(): void {
    if (!this.lastResult) return;

    let csv = "Trace_Label,Step_Value,Voltage_V,Current_A\n";
    for (const trace of this.lastResult.traces) {
      for (const pt of trace.points) {
        csv += `"${trace.stepLabel}",${trace.stepValue},${pt.v},${pt.i}\n`;
      }
    }

    const blob = new Blob([csv], { type: "text/csv;charset=utf-8;" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = `trazado_iv_${this.currentPreset.id}_${Date.now()}.csv`;
    link.click();
    URL.revokeObjectURL(url);
  }

  public snapshotPng(): void {
    if (!this.canvas) return;
    const link = document.createElement("a");
    link.download = `trazado_iv_${this.currentPreset.id}_captura_${Date.now()}.png`;
    link.href = this.canvas.toDataURL("image/png");
    link.click();
  }

  public destroy(): void {
    if (this.syncTimer !== null) {
      clearInterval(this.syncTimer);
      this.syncTimer = null;
    }
    if (this.resizeObserver) this.resizeObserver.disconnect();
  }
}

