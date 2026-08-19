/**
 * FftAnalyzerInstrument — Analizador de Espectro (FFT / SA-1000 Pro)
 *
 * Instrumento de laboratorio digital para análisis en el dominio de la frecuencia,
 * cálculo de armónicos, THD, THD+N, SNR, SFDR, SINAD, ventanas de ponderación y cursores.
 */

import type { InstrumentCallbacks } from "./instrument_callbacks";
import { ensureCanvasDpr } from "./canvas_dpr";
import {
  computeFftSpectrum,
  FFT_WINDOWS,
  type FftAnalysisResult,
  type FftAveragingMode,
  type FftScaleMode,
  type FftWindowType,
} from "./fft_analyzer_model";
import { drawFftSpectrum } from "./fft_analyzer_renderer";

export class FftAnalyzerInstrument {
  private container: HTMLElement;
  private canvas: HTMLCanvasElement | null = null;
  private ctx: CanvasRenderingContext2D | null = null;
  private resizeObserver: ResizeObserver | null = null;

  // Selección de canal
  private activeChannel: "CH1" | "CH2" | "DIFF" = "CH1";
  private rawCh1Data: { time: number; val: number }[] = [];
  private rawCh2Data: { time: number; val: number }[] = [];

  // Configuración de análisis
  private windowType: FftWindowType = "hann";
  private scaleMode: FftScaleMode = "dbv";
  private avgMode: FftAveragingMode = "off";
  private refLevelDb = 0; // 0 dBV
  private rangeDb = 80;   // 80 dB

  // Envolvente Max-Hold
  private maxHoldMagnitudes: Float64Array | null = null;

  // Cursores de Frecuencia F1 y F2
  private isCursorsEnabled = false;
  private cursorF1: number | null = null;
  private cursorF2: number | null = null;

  // Último resultado analizado
  private lastResult: FftAnalysisResult | null = null;

  constructor(container: HTMLElement, _callbacks: InstrumentCallbacks) {
    this.container = container;
    this.render();
    this.initCanvas();
    this.bindEvents();
  }

  private render(): void {
    this.container.innerHTML = `
      <div class="fft-main-layout">
        <!-- Barra Lateral: Controles y Métricas de Distorsión -->
        <aside class="fft-sidebar">
          <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 2px;">
            <h4 class="gen-section-title" style="color: #38bdf8;">📈 Analizador FFT</h4>
          </div>

          <!-- Selector de Canal de Entrada -->
          <div style="display: flex; flex-direction: column; gap: 2px;">
            <label class="rack-label" style="font-size: 0.58rem;">Canal de Entrada</label>
            <div style="display: flex; gap: 3px;">
              <button id="fft-btn-ch1" type="button" class="fft-btn active" style="flex: 1; justify-content: center;">CH1</button>
              <button id="fft-btn-ch2" type="button" class="fft-btn" style="flex: 1; justify-content: center;">CH2</button>
              <button id="fft-btn-diff" type="button" class="fft-btn" style="flex: 1; justify-content: center;" title="Diferencial CH1 - CH2">DIFF</button>
            </div>
          </div>

          <!-- Selector de Ventana de Ponderación -->
          <div style="display: flex; flex-direction: column; gap: 2px;">
            <label class="rack-label" style="font-size: 0.58rem;">Ventana FFT</label>
            <select id="fft-select-window" class="osc-select" style="width: 100%; cursor: pointer;">
              ${FFT_WINDOWS.map((w) => `<option value="${w.id}" ${w.id === this.windowType ? "selected" : ""}>${w.name}</option>`).join("")}
            </select>
          </div>

          <!-- Selector de Escala y Modo de Trazo -->
          <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 4px;">
            <div style="display: flex; flex-direction: column; gap: 2px;">
              <label class="rack-label" style="font-size: 0.58rem;">Escala Y</label>
              <select id="fft-select-scale" class="osc-select-mini" style="cursor: pointer;">
                <option value="dbv">dBV (1 Vrms)</option>
                <option value="dbm">dBm (50 Ω)</option>
                <option value="linear_rms">Lineal (Vrms)</option>
                <option value="linear_vpk">Lineal (Vpk)</option>
              </select>
            </div>
            <div style="display: flex; flex-direction: column; gap: 2px;">
              <label class="rack-label" style="font-size: 0.58rem;">Modo Trazo</label>
              <select id="fft-select-avg" class="osc-select-mini" style="cursor: pointer;">
                <option value="off">En Vivo (Directo)</option>
                <option value="max_hold">Max Hold</option>
                <option value="avg_8">Promedio 8x</option>
                <option value="avg_16">Promedio 16x</option>
              </select>
            </div>
          </div>

          <!-- Tarjetas de Métricas de Distorsión y Calidad de Señal -->
          <div style="display: flex; flex-direction: column; gap: 4px; border-top: 1px solid rgba(255,255,255,0.08); padding-top: 6px; flex: 1; overflow-y: auto;">
            <div class="fft-metric-card">
              <span class="rack-label" style="color: #38bdf8;">Frecuencia Fundamental (f0)</span>
              <span id="fft-val-f0" class="fft-metric-val" style="color: #38bdf8;">-- Hz</span>
            </div>

            <div class="fft-metric-card">
              <span class="rack-label" style="color: #a855f7;">Distorsión Armónica Total (THD)</span>
              <span id="fft-val-thd" class="fft-metric-val" style="color: #c084fc;">-- %</span>
            </div>

            <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 4px;">
              <div class="fft-metric-card">
                <span class="rack-label" style="font-size: 0.55rem;">SNR (Señal/Ruido)</span>
                <span id="fft-val-snr" style="font-family: var(--font-mono); font-size: 0.72rem; font-weight: bold; color: #22c55e;">-- dB</span>
              </div>
              <div class="fft-metric-card">
                <span class="rack-label" style="font-size: 0.55rem;">SFDR (Rango Libre)</span>
                <span id="fft-val-sfdr" style="font-family: var(--font-mono); font-size: 0.72rem; font-weight: bold; color: #eab308;">-- dBc</span>
              </div>
            </div>

            <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 4px;">
              <div class="fft-metric-card">
                <span class="rack-label" style="font-size: 0.55rem;">THD + Ruido (THD+N)</span>
                <span id="fft-val-thdn" style="font-family: var(--font-mono); font-size: 0.72rem; font-weight: bold; color: #f97316;">-- %</span>
              </div>
              <div class="fft-metric-card">
                <span class="rack-label" style="font-size: 0.55rem;">SINAD</span>
                <span id="fft-val-sinad" style="font-family: var(--font-mono); font-size: 0.72rem; font-weight: bold; color: #38bdf8;">-- dB</span>
              </div>
            </div>
          </div>
        </aside>

        <!-- Área Principal del Espectro FFT -->
        <main class="fft-content-area">
          <!-- Barra Superior: Controles de Referencia, Rango, Cursores y Exportación -->
          <div class="fft-top-bar">
            <div style="display: flex; gap: 4px; align-items: center;">
              <button id="fft-btn-cursors" type="button" class="fft-btn" title="Alternar cursores de frecuencia F1 y F2">
                📏 Cursores: OFF
              </button>
              <button id="fft-btn-reset-hold" type="button" class="fft-btn" title="Reiniciar envolvente Max-Hold">
                🔄 Reset Hold
              </button>
            </div>

            <!-- Ajuste de Nivel de Referencia y Rango Dinámico -->
            <div style="display: flex; gap: 4px; align-items: center;">
              <div style="display: flex; align-items: center; gap: 2px;">
                <span class="rack-label" style="font-size: 0.58rem;">Ref:</span>
                <select id="fft-select-ref" class="osc-select-mini" style="cursor: pointer;">
                  <option value="20">+20 dB</option>
                  <option value="10">+10 dB</option>
                  <option value="0" selected>0 dB</option>
                  <option value="-10">-10 dB</option>
                  <option value="-20">-20 dB</option>
                </select>
              </div>

              <div style="display: flex; align-items: center; gap: 2px;">
                <span class="rack-label" style="font-size: 0.58rem;">Rango:</span>
                <select id="fft-select-range" class="osc-select-mini" style="cursor: pointer;">
                  <option value="40">40 dB</option>
                  <option value="60">60 dB</option>
                  <option value="80" selected>80 dB</option>
                  <option value="100">100 dB</option>
                  <option value="120">120 dB</option>
                </select>
              </div>

              <button id="fft-btn-export-csv" type="button" class="fft-btn" title="Exportar espectro a CSV">💾 CSV</button>
              <button id="fft-btn-snapshot" type="button" class="fft-btn" title="Descargar captura PNG">📸 PNG</button>
            </div>
          </div>

          <!-- Visor Gráfico Central del Espectro -->
          <div class="fft-viewport-frame">
            <canvas id="fft-canvas" class="fft-canvas"></canvas>
          </div>

          <!-- Barra Inferior de Telemetría y Mediciones -->
          <div class="fft-telemetry-bar">
            <span id="fft-status-rbw">RBW: -- Hz</span>
            <span id="fft-status-span">Span: 0 Hz .. 0 Hz</span>
            <span id="fft-status-cursors" style="color: #eab308;">Cursores: Inactivos</span>
          </div>
        </main>
      </div>
    `;
  }

  private initCanvas(): void {
    this.canvas = this.container.querySelector("#fft-canvas") as HTMLCanvasElement;
    if (this.canvas) {
      this.ctx = this.canvas.getContext("2d");
      this.resizeObserver = new ResizeObserver(() => {
        this.computeAndDraw();
      });
      this.resizeObserver.observe(this.canvas);
      this.computeAndDraw();
    }
  }

  private bindEvents(): void {
    // 1. Selector de Canal de Entrada (CH1, CH2, DIFF)
    const btnCh1 = this.container.querySelector("#fft-btn-ch1") as HTMLElement | null;
    const btnCh2 = this.container.querySelector("#fft-btn-ch2") as HTMLElement | null;
    const btnDiff = this.container.querySelector("#fft-btn-diff") as HTMLElement | null;

    const setChannel = (ch: "CH1" | "CH2" | "DIFF") => {
      this.activeChannel = ch;
      btnCh1?.classList.toggle("active", ch === "CH1");
      btnCh2?.classList.toggle("active", ch === "CH2");
      btnDiff?.classList.toggle("active", ch === "DIFF");
      this.resetHold();
      this.computeAndDraw();
    };

    btnCh1?.addEventListener("click", () => setChannel("CH1"));
    btnCh2?.addEventListener("click", () => setChannel("CH2"));
    btnDiff?.addEventListener("click", () => setChannel("DIFF"));

    // 2. Selector de Ventana FFT
    const winSelect = this.container.querySelector("#fft-select-window") as HTMLSelectElement | null;
    winSelect?.addEventListener("change", () => {
      this.windowType = (winSelect?.value || "hann") as FftWindowType;
      this.computeAndDraw();
    });

    // 3. Selector de Escala Y y Modo de Trazo
    const scaleSelect = this.container.querySelector("#fft-select-scale") as HTMLSelectElement | null;
    scaleSelect?.addEventListener("change", () => {
      this.scaleMode = (scaleSelect?.value || "dbv") as FftScaleMode;
      this.computeAndDraw();
    });

    const avgSelect = this.container.querySelector("#fft-select-avg") as HTMLSelectElement | null;
    avgSelect?.addEventListener("change", () => {
      this.avgMode = (avgSelect?.value || "off") as FftAveragingMode;
      this.resetHold();
      this.computeAndDraw();
    });

    // 4. Nivel de Referencia y Rango
    const refSelect = this.container.querySelector("#fft-select-ref") as HTMLSelectElement | null;
    refSelect?.addEventListener("change", () => {
      this.refLevelDb = parseFloat(refSelect?.value || "0");
      this.computeAndDraw();
    });

    const rangeSelect = this.container.querySelector("#fft-select-range") as HTMLSelectElement | null;
    rangeSelect?.addEventListener("change", () => {
      this.rangeDb = parseFloat(rangeSelect?.value || "80");
      this.computeAndDraw();
    });

    // 5. Cursores F1 / F2 ON/OFF
    const cursorsBtn = this.container.querySelector("#fft-btn-cursors") as HTMLButtonElement | null;
    cursorsBtn?.addEventListener("click", () => {
      this.isCursorsEnabled = !this.isCursorsEnabled;
      cursorsBtn.classList.toggle("active", this.isCursorsEnabled);
      cursorsBtn.textContent = this.isCursorsEnabled ? "📏 Cursores: ON" : "📏 Cursores: OFF";

      if (this.isCursorsEnabled && this.lastResult) {
        const maxF = this.lastResult.samplingFreq / 2;
        this.cursorF1 = this.lastResult.fundamentalFreq || maxF * 0.25;
        this.cursorF2 = (this.lastResult.fundamentalFreq * 2) || maxF * 0.5;
      } else {
        this.cursorF1 = null;
        this.cursorF2 = null;
      }
      this.computeAndDraw();
    });

    // 6. Reset Hold
    this.container.querySelector("#fft-btn-reset-hold")?.addEventListener("click", () => {
      this.resetHold();
      this.computeAndDraw();
    });

    // 7. Exportación CSV y Snapshot PNG
    this.container.querySelector("#fft-btn-export-csv")?.addEventListener("click", () => this.exportCsv());
    this.container.querySelector("#fft-btn-snapshot")?.addEventListener("click", () => this.snapshotPng());
  }

  public resetHold(): void {
    this.maxHoldMagnitudes = null;
  }

  public setTimeData(
    channel1Data: { time: number; val: number }[],
    channel2Data: { time: number; val: number }[],
  ): void {
    this.rawCh1Data = channel1Data;
    this.rawCh2Data = channel2Data;
    this.computeAndDraw();
  }

  private getActiveRawData(): { time: number; val: number }[] {
    if (this.activeChannel === "CH1") return this.rawCh1Data;
    if (this.activeChannel === "CH2") return this.rawCh2Data;

    // Modo Diferencial CH1 - CH2
    const len = Math.min(this.rawCh1Data.length, this.rawCh2Data.length);
    const diff: { time: number; val: number }[] = [];
    for (let i = 0; i < len; i++) {
      diff.push({
        time: this.rawCh1Data[i].time,
        val: this.rawCh1Data[i].val - this.rawCh2Data[i].val,
      });
    }
    return diff;
  }

  public computeAndDraw(): void {
    const raw = this.getActiveRawData();
    const result = computeFftSpectrum(raw, this.windowType, 1024);
    this.lastResult = result;

    if (result) {
      // Manejar Max-Hold
      if (this.avgMode === "max_hold") {
        if (!this.maxHoldMagnitudes || this.maxHoldMagnitudes.length !== result.magnitudesVrms.length) {
          this.maxHoldMagnitudes = new Float64Array(result.magnitudesVrms);
        } else {
          for (let i = 0; i < result.magnitudesVrms.length; i++) {
            if (result.magnitudesVrms[i] > this.maxHoldMagnitudes[i]) {
              this.maxHoldMagnitudes[i] = result.magnitudesVrms[i];
            }
          }
        }
      } else {
        this.maxHoldMagnitudes = null;
      }

      // Actualizar Métricas en Panel Lateral
      this.updateMetricsUI(result);
    }

    if (!this.canvas || !this.ctx) return;
    const { width, height } = ensureCanvasDpr(this.canvas, this.ctx);

    drawFftSpectrum(this.ctx, {
      width,
      height,
      result,
      maxHoldMagnitudes: this.maxHoldMagnitudes,
      scaleMode: this.scaleMode,
      refLevelDb: this.refLevelDb,
      rangeDb: this.rangeDb,
      showHarmonics: true,
      cursors: this.isCursorsEnabled ? { cursorF1: this.cursorF1, cursorF2: this.cursorF2 } : undefined,
    });

    // Actualizar barra inferior de telemetría
    this.updateStatusFooter(result);
  }

  private updateMetricsUI(result: FftAnalysisResult): void {
    const f0El = this.container.querySelector("#fft-val-f0");
    if (f0El) {
      const f = result.fundamentalFreq;
      const fStr = f >= 1e6 ? `${(f / 1e6).toFixed(3)} MHz` : f >= 1e3 ? `${(f / 1e3).toFixed(2)} kHz` : `${f.toFixed(1)} Hz`;
      f0El.textContent = fStr;
    }

    const thdEl = this.container.querySelector("#fft-val-thd");
    if (thdEl) {
      thdEl.textContent = `${result.thdPercent.toFixed(2)} % (${result.thdDb.toFixed(1)} dB)`;
    }

    const snrEl = this.container.querySelector("#fft-val-snr");
    if (snrEl) snrEl.textContent = `${result.snrDb.toFixed(1)} dB`;

    const sfdrEl = this.container.querySelector("#fft-val-sfdr");
    if (sfdrEl) sfdrEl.textContent = `${result.sfdrDbc.toFixed(1)} dBc`;

    const thdnEl = this.container.querySelector("#fft-val-thdn");
    if (thdnEl) thdnEl.textContent = `${result.thdPlusNoisePercent.toFixed(2)} %`;

    const sinadEl = this.container.querySelector("#fft-val-sinad");
    if (sinadEl) sinadEl.textContent = `${result.sinadDb.toFixed(1)} dB`;
  }

  private updateStatusFooter(result: FftAnalysisResult | null): void {
    const rbwEl = this.container.querySelector("#fft-status-rbw");
    const spanEl = this.container.querySelector("#fft-status-span");
    const cursorsEl = this.container.querySelector("#fft-status-cursors");

    if (!result) {
      if (rbwEl) rbwEl.textContent = "RBW: -- Hz";
      if (spanEl) spanEl.textContent = "Span: --";
      if (cursorsEl) cursorsEl.textContent = "Cursores: Inactivos";
      return;
    }

    const rbw = result.samplingFreq / result.numPoints;
    const rbwStr = rbw >= 1e3 ? `${(rbw / 1e3).toFixed(2)} kHz` : `${rbw.toFixed(1)} Hz`;
    if (rbwEl) rbwEl.textContent = `RBW: ${rbwStr} (N=${result.numPoints})`;

    const maxF = result.samplingFreq / 2;
    const spanStr = maxF >= 1e6 ? `${(maxF / 1e6).toFixed(2)} MHz` : `${(maxF / 1e3).toFixed(1)} kHz`;
    if (spanEl) spanEl.textContent = `Span: 0 Hz .. ${spanStr}`;

    if (cursorsEl) {
      if (this.isCursorsEnabled && this.cursorF1 !== null && this.cursorF2 !== null) {
        const df = Math.abs(this.cursorF2 - this.cursorF1);
        const dfStr = df >= 1e6 ? `${(df / 1e6).toFixed(3)} MHz` : df >= 1e3 ? `${(df / 1e3).toFixed(2)} kHz` : `${df.toFixed(1)} Hz`;
        cursorsEl.textContent = `Δf: ${dfStr}`;
      } else {
        cursorsEl.textContent = "Cursores: Inactivos";
      }
    }
  }

  public exportCsv(): void {
    if (!this.lastResult) return;

    let csv = "Frequency_Hz,Magnitude_Vrms,Magnitude_dBV\n";
    for (let i = 0; i < this.lastResult.frequencies.length; i++) {
      csv += `${this.lastResult.frequencies[i]},${this.lastResult.magnitudesVrms[i]},${this.lastResult.magnitudesDbv[i]}\n`;
    }

    const blob = new Blob([csv], { type: "text/csv;charset=utf-8;" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = `espectro_fft_${Date.now()}.csv`;
    link.click();
    URL.revokeObjectURL(url);
  }

  public snapshotPng(): void {
    if (!this.canvas) return;
    const link = document.createElement("a");
    link.download = `espectro_fft_captura_${Date.now()}.png`;
    link.href = this.canvas.toDataURL("image/png");
    link.click();
  }

  public destroy(): void {
    if (this.resizeObserver) this.resizeObserver.disconnect();
  }
}

