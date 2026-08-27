/**
 * SignalGeneratorInstrument — Generador de Funciones Virtual (AFG / AWG)
 *
 * Instrumento virtual de laboratorio para síntesis de formas de onda en tiempo real,
 * vinculación dinámica con fuentes en el lienzo esquemático y control interactivo de parámetros.
 */

import { CanvasOrchestrator, ComponentInstance } from "../canvas_orchestrator";
import type { InstrumentCallbacks } from "./instrument_callbacks";
import { ensureCanvasDpr } from "./canvas_dpr";
import {
  calculateSignalMetrics,
  formatFrequency,
  formatVoltage,
  GENERATOR_PRESETS,
  type GeneratorWaveType,
  type SignalGeneratorParams,
} from "./signal_generator_model";
import { drawSignalGeneratorPreview } from "./signal_generator_renderer";

export class SignalGeneratorInstrument {
  private container: HTMLElement;
  private orchestrator: CanvasOrchestrator;
  private callbacks: InstrumentCallbacks;

  // Canvas y Renderizado
  private previewCanvas: HTMLCanvasElement | null = null;
  private previewCtx: CanvasRenderingContext2D | null = null;
  private animFrameId: number | null = null;
  private resizeObserver: ResizeObserver | null = null;
  private phaseAnimationTime = 0;
  private lastFrameTimestamp = 0;

  // Estado del Instrumento
  private targetSourceId: string | null = null;
  private params: SignalGeneratorParams = {
    waveType: "sine",
    frequency: 1000,
    amplitude: 5.0,
    offset: 0.0,
    dutyCycle: 0.5,
    phase: 0,
    modFrequency: 100,
    modIndex: 0.5,
    enabled: true,
  };

  // Referencias a elementos del DOM
  private sourceSelectEl: HTMLSelectElement | null = null;
  private sourceInfoCardEl: HTMLElement | null = null;
  private outputToggleBtn: HTMLButtonElement | null = null;
  private waveButtons: HTMLButtonElement[] = [];

  // Inputs y Sliders
  private freqSlider: HTMLInputElement | null = null;
  private freqInput: HTMLInputElement | null = null;
  private freqUnitSelect: HTMLSelectElement | null = null;

  private ampSlider: HTMLInputElement | null = null;
  private ampInput: HTMLInputElement | null = null;

  private offsetSlider: HTMLInputElement | null = null;
  private offsetInput: HTMLInputElement | null = null;

  private dutySlider: HTMLInputElement | null = null;
  private dutyInput: HTMLInputElement | null = null;
  private dutyContainer: HTMLElement | null = null;

  private phaseSlider: HTMLInputElement | null = null;
  private phaseInput: HTMLInputElement | null = null;

  private modFreqInput: HTMLInputElement | null = null;
  private modIndexSlider: HTMLInputElement | null = null;
  private modIndexInput: HTMLInputElement | null = null;
  private amContainer: HTMLElement | null = null;

  private pollIntervalId: ReturnType<typeof setInterval> | null = null;

  constructor(container: HTMLElement, orchestrator: CanvasOrchestrator, callbacks: InstrumentCallbacks) {
    this.container = container;
    this.orchestrator = orchestrator;
    this.callbacks = callbacks;

    this.render();
    this.queryDOMElements();
    this.bindEvents();
    this.initCanvasAndAnimation();
    this.updateLinkedSourceInfo();

    this.pollIntervalId = setInterval(() => this.updateLinkedSourceInfo(), 800);
  }

  private render(): void {
    this.container.innerHTML = `
      <div class="gen-main-layout">
        <!-- Barra Lateral Izquierda: Vinculación de Fuentes y Presets -->
        <aside class="gen-sidebar">
          <div class="gen-sidebar-section">
            <h4 class="gen-section-title">⚡ Fuente Vinculada</h4>
            <div class="gen-input-row" style="margin-bottom: 4px;">
              <select id="gen-source-select" class="osc-select" style="width: 100%; cursor: pointer;">
                <option value="">(Buscando fuentes...)</option>
              </select>
            </div>
            <div id="gen-source-card" class="gen-source-card">
              <span style="color: var(--text-muted);">Detectando fuentes en el lienzo...</span>
            </div>
          </div>

          <div class="gen-sidebar-section" style="flex: 1; overflow-y: auto;">
            <h4 class="gen-section-title">📚 Presets de Laboratorio</h4>
            <div id="gen-presets-container" style="display: flex; flex-direction: column; gap: 4px; margin-top: 2px;">
              ${GENERATOR_PRESETS.map(
                (p) => `
                <button type="button" class="gen-preset-chip" data-preset-id="${p.id}" title="${p.description}">
                  <strong>${p.name}</strong>
                </button>
              `,
              ).join("")}
            </div>
          </div>

          <div class="gen-sidebar-section">
            <button id="gen-btn-create-source" type="button" class="gen-wave-btn" style="width: 100%; justify-content: center;">
              ➕ Insertar Fuente al Esquema
            </button>
          </div>
        </aside>

        <!-- Área Principal de Síntesis y Controles -->
        <main class="gen-content-area">
          <!-- Barra Superior: Selector de Forma de Onda y Salida -->
          <div class="gen-top-bar">
            <div class="gen-wave-buttons">
              <button type="button" class="gen-wave-btn active" data-wave="sine" title="Onda Senoidal">∿ Seno</button>
              <button type="button" class="gen-wave-btn" data-wave="square" title="Onda Cuadrada">⊓ Cuadrada</button>
              <button type="button" class="gen-wave-btn" data-wave="triangle" title="Onda Triangular">⋀ Triángulo</button>
              <button type="button" class="gen-wave-btn" data-wave="sawtooth" title="Diente de Sierra">⊿ Rampa</button>
              <button type="button" class="gen-wave-btn" data-wave="pulse" title="Tren de Pulsos">⎍ Pulso</button>
              <button type="button" class="gen-wave-btn" data-wave="sweep" title="Barrido de Frecuencia">〰 Sweep</button>
              <button type="button" class="gen-wave-btn" data-wave="am" title="Modulación en Amplitud">📻 AM</button>
              <button type="button" class="gen-wave-btn" data-wave="fm" title="Modulación en Frecuencia">📻 FM</button>
              <button type="button" class="gen-wave-btn" data-wave="noise" title="Ruido Blanco">⚅ Ruido</button>
              <button type="button" class="gen-wave-btn" data-wave="dc" title="Corriente Continua (DC)">⎓ DC</button>
            </div>

            <div style="display: flex; gap: 4px; align-items: center;">
              <button id="gen-z-toggle" type="button" class="gen-wave-btn" style="font-family: var(--font-mono); font-size: 0.68rem; font-weight: bold; border-color: rgba(56,189,248,0.4);" title="Alternar impedancia de salida de referencia">
                ⚡ 50 Ω
              </button>
              <button id="gen-output-toggle" type="button" class="gen-output-btn active" title="Alternar encendido de la señal de salida">
                ⚡ SALIDA: ACTIVA
              </button>
            </div>
          </div>

          <!-- Visor Gráfico Central del Sintetizador -->
          <div class="gen-viewport-frame">
            <canvas id="gen-preview-canvas" class="gen-canvas"></canvas>
          </div>

          <!-- Matriz de Controles de Parámetros -->
          <div class="gen-controls-grid">
            <!-- 1. Frecuencia -->
            <div class="gen-control-card">
              <div class="gen-control-header">
                <span class="gen-control-label">Frecuencia</span>
                <span id="gen-val-freq" class="gen-control-val">1.00 kHz</span>
              </div>
              <div class="gen-input-row">
                <input id="gen-num-freq" type="number" min="0.01" step="0.1" value="1.0" class="gen-num-input" />
                <select id="gen-unit-freq" class="gen-unit-select">
                  <option value="1">Hz</option>
                  <option value="1000" selected>kHz</option>
                  <option value="1000000">MHz</option>
                </select>
              </div>
              <input id="gen-slider-freq" type="range" min="0" max="600" step="1" value="300" class="gen-slider" />
            </div>

            <!-- 2. Amplitud -->
            <div class="gen-control-card">
              <div class="gen-control-header">
                <span class="gen-control-label">Amplitud (Vpk)</span>
                <span id="gen-val-amp" class="gen-control-val">5.00 V</span>
              </div>
              <div class="gen-input-row">
                <input id="gen-num-amp" type="number" min="0.01" max="1000" step="0.1" value="5.0" class="gen-num-input" />
                <span style="font-size: 0.65rem; color: var(--text-muted); font-family: var(--font-mono);">V</span>
              </div>
              <input id="gen-slider-amp" type="range" min="0.1" max="30" step="0.1" value="5" class="gen-slider" />
            </div>

            <!-- 3. Tensión Offset -->
            <div class="gen-control-card">
              <div class="gen-control-header">
                <span class="gen-control-label">Tensión Offset</span>
                <span id="gen-val-offset" class="gen-control-val">0.00 V</span>
              </div>
              <div class="gen-input-row">
                <input id="gen-num-offset" type="number" min="-24" max="24" step="0.1" value="0.0" class="gen-num-input" />
                <span style="font-size: 0.65rem; color: var(--text-muted); font-family: var(--font-mono);">V</span>
              </div>
              <input id="gen-slider-offset" type="range" min="-15" max="15" step="0.1" value="0" class="gen-slider" />
            </div>

            <!-- 4. Fase Inicial -->
            <div class="gen-control-card">
              <div class="gen-control-header">
                <span class="gen-control-label">Fase Inicial</span>
                <span id="gen-val-phase" class="gen-control-val">0°</span>
              </div>
              <div class="gen-input-row">
                <input id="gen-num-phase" type="number" min="0" max="360" step="1" value="0" class="gen-num-input" />
                <span style="font-size: 0.65rem; color: var(--text-muted); font-family: var(--font-mono);">°</span>
              </div>
              <input id="gen-slider-phase" type="range" min="0" max="360" step="1" value="0" class="gen-slider" />
            </div>

            <!-- 5. Duty Cycle (Opcional para Cuadrada / Pulso / Triangular) -->
            <div id="gen-card-duty" class="gen-control-card" style="display: none;">
              <div class="gen-control-header">
                <span class="gen-control-label">Ciclo de Trabajo</span>
                <span id="gen-val-duty" class="gen-control-val">50%</span>
              </div>
              <div class="gen-input-row">
                <input id="gen-num-duty" type="number" min="1" max="99" step="1" value="50" class="gen-num-input" />
                <span style="font-size: 0.65rem; color: var(--text-muted); font-family: var(--font-mono);">%</span>
              </div>
              <input id="gen-slider-duty" type="range" min="1" max="99" step="1" value="50" class="gen-slider" />
            </div>

            <!-- 6. AM Modulación (Opcional) -->
            <div id="gen-card-am" class="gen-control-card" style="display: none;">
              <div class="gen-control-header">
                <span class="gen-control-label">AM Mod (Hz / %)</span>
                <span id="gen-val-am" class="gen-control-val">100Hz / 50%</span>
              </div>
              <div class="gen-input-row">
                <input id="gen-num-mod-freq" type="number" min="1" max="2000" step="10" value="100" class="gen-num-input" placeholder="Hz" />
                <input id="gen-num-mod-idx" type="number" min="0" max="100" step="5" value="50" class="gen-num-input" placeholder="%" />
              </div>
              <input id="gen-slider-mod-idx" type="range" min="0" max="100" step="1" value="50" class="gen-slider" />
            </div>

            <!-- 7. Sweep Controles (Opcional) -->
            <div id="gen-card-sweep" class="gen-control-card" style="display: none;">
              <div class="gen-control-header">
                <span class="gen-control-label">Barrido (F1 - F2)</span>
                <span id="gen-val-sweep" class="gen-control-val">100Hz - 10kHz</span>
              </div>
              <div class="gen-input-row">
                <input id="gen-num-sweep-start" type="number" min="1" max="1000000" step="10" value="100" class="gen-num-input" placeholder="F. Start (Hz)" />
                <input id="gen-num-sweep-end" type="number" min="1" max="10000000" step="100" value="10000" class="gen-num-input" placeholder="F. End (Hz)" />
              </div>
            </div>
          </div>
        </main>
      </div>
    `;
  }

  private queryDOMElements(): void {
    this.previewCanvas = this.container.querySelector("#gen-preview-canvas") as HTMLCanvasElement;
    if (this.previewCanvas) {
      this.previewCtx = this.previewCanvas.getContext("2d");
    }

    this.sourceSelectEl = this.container.querySelector("#gen-source-select");
    this.sourceInfoCardEl = this.container.querySelector("#gen-source-card");
    this.outputToggleBtn = this.container.querySelector("#gen-output-toggle");
    this.waveButtons = Array.from(this.container.querySelectorAll(".gen-wave-btn"));

    this.freqSlider = this.container.querySelector("#gen-slider-freq");
    this.freqInput = this.container.querySelector("#gen-num-freq");
    this.freqUnitSelect = this.container.querySelector("#gen-unit-freq");

    this.ampSlider = this.container.querySelector("#gen-slider-amp");
    this.ampInput = this.container.querySelector("#gen-num-amp");

    this.offsetSlider = this.container.querySelector("#gen-slider-offset");
    this.offsetInput = this.container.querySelector("#gen-num-offset");

    this.dutySlider = this.container.querySelector("#gen-slider-duty");
    this.dutyInput = this.container.querySelector("#gen-num-duty");
    this.dutyContainer = this.container.querySelector("#gen-card-duty");

    this.phaseSlider = this.container.querySelector("#gen-slider-phase");
    this.phaseInput = this.container.querySelector("#gen-num-phase");

    this.modFreqInput = this.container.querySelector("#gen-num-mod-freq");
    this.modIndexSlider = this.container.querySelector("#gen-slider-mod-idx");
    this.modIndexInput = this.container.querySelector("#gen-num-mod-idx");
    this.amContainer = this.container.querySelector("#gen-card-am");
  }

  private bindEvents(): void {
    if (typeof window !== "undefined") {
      window.addEventListener("astryd-theme-changed", () => {
        this.renderFrame();
      });
    }

    // 1. Selector de Fuente en Lienzo
    this.sourceSelectEl?.addEventListener("change", () => {
      const selectedId = this.sourceSelectEl?.value;
      if (selectedId) {
        this.targetSourceId = selectedId;
        const source = this.orchestrator.components.find((c) => c.id === selectedId);
        if (source) {
          this.loadFromSource(source);
        }
      }
    });

    // 2. Botón de Inserción Rápida de Fuente en Lienzo
    this.container.querySelector("#gen-btn-create-source")?.addEventListener("click", () => {
      const newSource = this.orchestrator.addComponent("vsource", 140, 140, this.params.amplitude || 5);
      if (newSource) {
        newSource.waveType = this.params.waveType;
        newSource.frequency = this.params.frequency;
        newSource.amplitude = this.params.amplitude;
        newSource.offset = this.params.offset;
        this.targetSourceId = newSource.id;
        this.updateLinkedSourceInfo();
        this.syncToSource();
      }
    });

    // 3. Botón de Salida (Enable / Disable)
    this.outputToggleBtn?.addEventListener("click", () => {
      this.params.enabled = !this.params.enabled;
      this.updateOutputButtonUI();
      this.syncToSource();
    });

    // 3.1 Botón de Impedancia de Salida (50 Ω vs High-Z)
    const zToggleBtn = this.container.querySelector<HTMLButtonElement>("#gen-z-toggle");
    zToggleBtn?.addEventListener("click", () => {
      const current = this.params.outputImpedance ?? "50_ohm";
      this.params.outputImpedance = current === "50_ohm" ? "high_z" : "50_ohm";
      if (zToggleBtn) {
        zToggleBtn.textContent = this.params.outputImpedance === "50_ohm" ? "⚡ 50 Ω" : "⚡ High-Z";
      }
      this.syncToSource();
      this.renderFrame();
    });

    // 4. Botones de Tipo de Onda
    for (const btn of this.waveButtons) {
      btn.addEventListener("click", () => {
        const wave = btn.getAttribute("data-wave") as GeneratorWaveType | null;
        if (wave) {
          this.setWaveType(wave);
        }
      });
    }

    // 4.1 Sweep start/end inputs
    const sweepStartInput = this.container.querySelector<HTMLInputElement>("#gen-num-sweep-start");
    const sweepEndInput = this.container.querySelector<HTMLInputElement>("#gen-num-sweep-end");
    sweepStartInput?.addEventListener("change", () => {
      this.params.sweepStartFreq = parseFloat(sweepStartInput.value) || 100;
      this.updateValueBadge("gen-val-sweep", `${this.params.sweepStartFreq}Hz - ${this.params.sweepEndFreq ?? 10000}Hz`);
      this.syncToSource();
    });
    sweepEndInput?.addEventListener("change", () => {
      this.params.sweepEndFreq = parseFloat(sweepEndInput.value) || 10000;
      this.updateValueBadge("gen-val-sweep", `${this.params.sweepStartFreq ?? 100}Hz - ${this.params.sweepEndFreq}Hz`);
      this.syncToSource();
    });

    // 5. Presets de Laboratorio
    const presetButtons = this.container.querySelectorAll(".gen-preset-chip");
    presetButtons.forEach((btn) => {
      btn.addEventListener("click", () => {
        const presetId = btn.getAttribute("data-preset-id");
        const preset = GENERATOR_PRESETS.find((p) => p.id === presetId);
        if (preset) {
          this.applyPreset(preset);
        }
      });
    });

    // 6. Controles de Frecuencia (Slider Logarítmico + Input Numérico + Unidad)
    this.freqSlider?.addEventListener("input", () => {
      const sliderVal = parseFloat(this.freqSlider!.value); // 0 .. 600
      // Escala logarítmica: 0.1 Hz a 10 MHz
      const logFreq = Math.pow(10, (sliderVal / 600) * 8 - 1);
      this.params.frequency = Math.max(0.01, logFreq);
      this.syncFreqUI(false, true);
      this.syncToSource();
    });

    this.freqInput?.addEventListener("change", () => {
      const val = parseFloat(this.freqInput!.value) || 1;
      const unit = parseFloat(this.freqUnitSelect?.value || "1000");
      this.params.frequency = Math.max(0.01, val * unit);
      this.syncFreqUI(true, false);
      this.syncToSource();
    });

    this.freqUnitSelect?.addEventListener("change", () => {
      const val = parseFloat(this.freqInput?.value || "1") || 1;
      const unit = parseFloat(this.freqUnitSelect!.value);
      this.params.frequency = Math.max(0.01, val * unit);
      this.syncFreqUI(true, false);
      this.syncToSource();
    });

    // 7. Amplitud
    this.ampSlider?.addEventListener("input", () => {
      this.params.amplitude = parseFloat(this.ampSlider!.value);
      if (this.ampInput) this.ampInput.value = this.params.amplitude.toFixed(2);
      this.updateValueBadge("gen-val-amp", `${this.params.amplitude.toFixed(2)} V`);
      this.syncToSource();
    });

    this.ampInput?.addEventListener("change", () => {
      this.params.amplitude = Math.max(0.01, parseFloat(this.ampInput!.value) || 1);
      if (this.ampSlider) this.ampSlider.value = this.params.amplitude.toString();
      this.updateValueBadge("gen-val-amp", `${this.params.amplitude.toFixed(2)} V`);
      this.syncToSource();
    });

    // 8. Offset
    this.offsetSlider?.addEventListener("input", () => {
      this.params.offset = parseFloat(this.offsetSlider!.value);
      if (this.offsetInput) this.offsetInput.value = this.params.offset.toFixed(2);
      this.updateValueBadge("gen-val-offset", `${this.params.offset.toFixed(2)} V`);
      this.syncToSource();
    });

    this.offsetInput?.addEventListener("change", () => {
      this.params.offset = parseFloat(this.offsetInput!.value) || 0;
      if (this.offsetSlider) this.offsetSlider.value = this.params.offset.toString();
      this.updateValueBadge("gen-val-offset", `${this.params.offset.toFixed(2)} V`);
      this.syncToSource();
    });

    // 9. Duty Cycle
    this.dutySlider?.addEventListener("input", () => {
      const dutyPct = parseFloat(this.dutySlider!.value);
      this.params.dutyCycle = dutyPct / 100;
      if (this.dutyInput) this.dutyInput.value = dutyPct.toFixed(0);
      this.updateValueBadge("gen-val-duty", `${dutyPct.toFixed(0)}%`);
      this.syncToSource();
    });

    this.dutyInput?.addEventListener("change", () => {
      const dutyPct = Math.max(1, Math.min(99, parseFloat(this.dutyInput!.value) || 50));
      this.params.dutyCycle = dutyPct / 100;
      if (this.dutySlider) this.dutySlider.value = dutyPct.toString();
      this.updateValueBadge("gen-val-duty", `${dutyPct.toFixed(0)}%`);
      this.syncToSource();
    });

    // 10. Fase Inicial
    this.phaseSlider?.addEventListener("input", () => {
      this.params.phase = parseFloat(this.phaseSlider!.value);
      if (this.phaseInput) this.phaseInput.value = this.params.phase.toFixed(0);
      this.updateValueBadge("gen-val-phase", `${this.params.phase.toFixed(0)}°`);
      this.syncToSource();
    });

    this.phaseInput?.addEventListener("change", () => {
      this.params.phase = Math.max(0, Math.min(360, parseFloat(this.phaseInput!.value) || 0));
      if (this.phaseSlider) this.phaseSlider.value = this.params.phase.toString();
      this.updateValueBadge("gen-val-phase", `${this.params.phase.toFixed(0)}°`);
      this.syncToSource();
    });

    // 11. AM Modulación
    this.modIndexSlider?.addEventListener("input", () => {
      const idxPct = parseFloat(this.modIndexSlider!.value);
      this.params.modIndex = idxPct / 100;
      if (this.modIndexInput) this.modIndexInput.value = idxPct.toFixed(0);
      this.updateValueBadge("gen-val-am", `${this.params.modFrequency}Hz / ${idxPct.toFixed(0)}%`);
      this.syncToSource();
    });

    this.modIndexInput?.addEventListener("change", () => {
      const idxPct = Math.max(0, Math.min(100, parseFloat(this.modIndexInput!.value) || 50));
      this.params.modIndex = idxPct / 100;
      if (this.modIndexSlider) this.modIndexSlider.value = idxPct.toString();
      this.updateValueBadge("gen-val-am", `${this.params.modFrequency}Hz / ${idxPct.toFixed(0)}%`);
      this.syncToSource();
    });

    this.modFreqInput?.addEventListener("change", () => {
      this.params.modFrequency = Math.max(0.1, parseFloat(this.modFreqInput!.value) || 100);
      this.updateValueBadge("gen-val-am", `${this.params.modFrequency}Hz / ${((this.params.modIndex || 0.5) * 100).toFixed(0)}%`);
      this.syncToSource();
    });
  }

  private initCanvasAndAnimation(): void {
    if (!this.previewCanvas) return;

    this.resizeObserver = new ResizeObserver(() => {
      this.renderFrame();
      this.scheduleNextFrame();
    });
    this.resizeObserver.observe(this.previewCanvas);
    this.renderFrame();
    this.scheduleNextFrame();
  }

  public isCanvasVisible(): boolean {
    if (!this.previewCanvas?.isConnected) return false;
    const container = this.container;
    if (container.closest("[hidden]") || container.style.display === "none") return false;
    return true;
  }

  private shouldAnimate(): boolean {
    return this.params.enabled && (this.callbacks?.isSimulating?.() ?? false) && this.isCanvasVisible();
  }

  public scheduleNextFrame(): void {
    if (!this.shouldAnimate() || this.animFrameId !== null) return;

    this.animFrameId = requestAnimationFrame((timestamp) => {
      this.animFrameId = null;
      if (this.lastFrameTimestamp > 0) {
        const dt = (timestamp - this.lastFrameTimestamp) / 1000;
        if (this.params.enabled && this.params.waveType !== "dc") {
          this.phaseAnimationTime += dt * (1 / Math.max(1e-5, this.params.frequency)) * 0.75;
        }
      }
      this.lastFrameTimestamp = timestamp;
      this.renderFrame();
      this.scheduleNextFrame();
    });
  }

  public renderFrame(): void {
    if (!this.previewCanvas || !this.previewCtx) return;

    const { width, height } = ensureCanvasDpr(this.previewCanvas, this.previewCtx);
    const metrics = calculateSignalMetrics(this.params);

    drawSignalGeneratorPreview(this.previewCtx, {
      width,
      height,
      params: this.params,
      metrics,
      phaseOffsetTime: this.phaseAnimationTime,
    });
  }

  public setWaveType(waveType: GeneratorWaveType): void {
    this.params.waveType = waveType;

    for (const btn of this.waveButtons) {
      btn.classList.toggle("active", btn.getAttribute("data-wave") === waveType);
    }

    // Visibilidad de controles auxiliares
    const isDutyRelevant = waveType === "square" || waveType === "pulse" || waveType === "triangle";
    if (this.dutyContainer) {
      this.dutyContainer.style.display = isDutyRelevant ? "flex" : "none";
    }

    if (this.amContainer) {
      this.amContainer.style.display = waveType === "am" ? "flex" : "none";
    }

    const sweepCard = this.container.querySelector<HTMLElement>("#gen-card-sweep");
    if (sweepCard) {
      sweepCard.style.display = waveType === "sweep" ? "flex" : "none";
    }

    this.syncToSource();
  }

  public applyPreset(preset: (typeof GENERATOR_PRESETS)[number]): void {
    if (preset.params.waveType) this.params.waveType = preset.params.waveType;
    if (preset.params.frequency !== undefined) this.params.frequency = preset.params.frequency;
    if (preset.params.amplitude !== undefined) this.params.amplitude = preset.params.amplitude;
    if (preset.params.offset !== undefined) this.params.offset = preset.params.offset;
    if (preset.params.dutyCycle !== undefined) this.params.dutyCycle = preset.params.dutyCycle;
    if (preset.params.phase !== undefined) this.params.phase = preset.params.phase;
    if (preset.params.modFrequency !== undefined) this.params.modFrequency = preset.params.modFrequency;
    if (preset.params.modIndex !== undefined) this.params.modIndex = preset.params.modIndex;

    this.setWaveType(this.params.waveType);
    this.syncAllUI();
    this.syncToSource();
  }

  private syncFreqUI(updateSlider = true, updateInput = true): void {
    const f = this.params.frequency;
    this.updateValueBadge("gen-val-freq", formatFrequency(f));

    if (updateSlider && this.freqSlider) {
      // f = 10^((val/600)*8 - 1) => (val/600)*8 = log10(f) + 1 => val = (log10(f)+1)/8 * 600
      const sliderVal = Math.max(0, Math.min(600, ((Math.log10(Math.max(0.1, f)) + 1) / 8) * 600));
      this.freqSlider.value = sliderVal.toString();
    }

    if (updateInput && this.freqInput && this.freqUnitSelect) {
      if (f >= 1_000_000) {
        this.freqUnitSelect.value = "1000000";
        this.freqInput.value = (f / 1_000_000).toFixed(2);
      } else if (f >= 1_000) {
        this.freqUnitSelect.value = "1000";
        this.freqInput.value = (f / 1_000).toFixed(2);
      } else {
        this.freqUnitSelect.value = "1";
        this.freqInput.value = f.toFixed(1);
      }
    }
  }

  private syncAllUI(): void {
    this.syncFreqUI(true, true);

    if (this.ampSlider) this.ampSlider.value = this.params.amplitude.toString();
    if (this.ampInput) this.ampInput.value = this.params.amplitude.toFixed(2);
    this.updateValueBadge("gen-val-amp", `${this.params.amplitude.toFixed(2)} V`);

    if (this.offsetSlider) this.offsetSlider.value = this.params.offset.toString();
    if (this.offsetInput) this.offsetInput.value = this.params.offset.toFixed(2);
    this.updateValueBadge("gen-val-offset", `${this.params.offset.toFixed(2)} V`);

    const dutyPct = (this.params.dutyCycle * 100).toFixed(0);
    if (this.dutySlider) this.dutySlider.value = dutyPct;
    if (this.dutyInput) this.dutyInput.value = dutyPct;
    this.updateValueBadge("gen-val-duty", `${dutyPct}%`);

    if (this.phaseSlider) this.phaseSlider.value = this.params.phase.toString();
    if (this.phaseInput) this.phaseInput.value = this.params.phase.toString();
    this.updateValueBadge("gen-val-phase", `${this.params.phase}°`);

    this.updateOutputButtonUI();
  }

  private updateOutputButtonUI(): void {
    if (!this.outputToggleBtn) return;
    this.outputToggleBtn.classList.toggle("active", this.params.enabled);
    this.outputToggleBtn.textContent = this.params.enabled ? "⚡ SALIDA: ACTIVA" : "⏸ SALIDA: EN ESPERA";
  }

  private updateValueBadge(elementId: string, text: string): void {
    const el = this.container.querySelector(`#${elementId}`);
    if (el) el.textContent = text;
  }

  private syncToSource(): void {
    const source = this.findLinkedSource();
    if (!source) return;

    source.waveType = this.params.waveType;
    source.frequency = this.params.frequency;
    source.amplitude = this.params.amplitude;
    source.offset = this.params.offset;
    source.dutyCycle = this.params.dutyCycle;
    source.phase = this.params.phase;
    source.modFrequency = this.params.modFrequency;
    source.modIndex = this.params.modIndex;

    this.callbacks.onCanvasModified();
    this.callbacks.onNetlistSync();
    this.callbacks.requestRender(true);
    this.callbacks.onSourceMutated?.(source);
  }

  public syncFromExternalSource(source: ComponentInstance): void {
    const current = this.findLinkedSource();
    if (current && current.id === source.id) {
      this.loadFromSource(source);
      this.updateLinkedSourceInfo();
    }
  }

  private loadFromSource(source: ComponentInstance): void {
    if (source.waveType) this.params.waveType = source.waveType as GeneratorWaveType;
    if (source.frequency !== undefined) this.params.frequency = source.frequency;
    if (source.amplitude !== undefined) this.params.amplitude = source.amplitude;
    if (source.offset !== undefined) this.params.offset = source.offset;
    if (source.dutyCycle !== undefined) this.params.dutyCycle = source.dutyCycle;
    if (source.phase !== undefined) this.params.phase = source.phase;
    if (source.modFrequency !== undefined) this.params.modFrequency = source.modFrequency;
    if (source.modIndex !== undefined) this.params.modIndex = source.modIndex;

    this.setWaveType(this.params.waveType);
    this.syncAllUI();
  }

  public findLinkedSource(): ComponentInstance | null {
    // 1. Si hay una seleccionada y es fuente
    const sel = this.orchestrator.selectedComponent;
    if (sel && (sel.type === "vsource" || sel.type === "isource")) {
      this.targetSourceId = sel.id;
      return sel;
    }

    // 2. Si no, usar la última asociada
    if (this.targetSourceId) {
      const found = this.orchestrator.components.find((c) => c.id === this.targetSourceId);
      if (found) return found;
    }

    // 3. Si no, tomar la primera fuente del circuito
    const first = this.orchestrator.components.find((c) => c.type === "vsource" || c.type === "isource");
    if (first) {
      this.targetSourceId = first.id;
      return first;
    }

    return null;
  }

  public updateLinkedSourceInfo(): void {
    const sources = this.orchestrator.components.filter((c) => c.type === "vsource" || c.type === "isource");
    const activeSource = this.findLinkedSource();

    if (this.sourceSelectEl) {
      if (sources.length === 0) {
        this.sourceSelectEl.innerHTML = `<option value="">(Sin fuentes en el lienzo)</option>`;
        this.sourceSelectEl.disabled = true;
      } else {
        this.sourceSelectEl.disabled = false;
        this.sourceSelectEl.innerHTML = sources
          .map(
            (s) =>
              `<option value="${s.id}" ${s.id === activeSource?.id ? "selected" : ""}>${s.id} (${s.type === "vsource" ? "Tensión" : "Corriente"})</option>`,
          )
          .join("");
      }
    }

    if (this.sourceInfoCardEl) {
      if (activeSource) {
        this.sourceInfoCardEl.innerHTML = `
          <div style="display: flex; justify-content: space-between; margin-bottom: 2px;">
            <strong style="color: var(--cyan);">${activeSource.id}</strong>
            <span class="meas-node-badge">${activeSource.type.toUpperCase()}</span>
          </div>
          <div>Tipo: <strong>${activeSource.waveType?.toUpperCase() ?? "DC"}</strong></div>
          <div>Frecuencia: <strong>${formatFrequency(activeSource.frequency ?? 1000)}</strong></div>
          <div>Amplitud: <strong>${formatVoltage(activeSource.amplitude ?? 5)}</strong></div>
        `;
      } else {
        this.sourceInfoCardEl.innerHTML = `
          <span style="color: #f87171; font-weight: 600;">No hay fuentes en el lienzo.</span><br/>
          <span style="color: var(--text-muted); font-size: 0.64rem;">Usa el botón inferior para insertar una fuente automáticamente.</span>
        `;
      }
    }
  }

  public destroy(): void {
    if (this.pollIntervalId) clearInterval(this.pollIntervalId);
    if (this.animFrameId) cancelAnimationFrame(this.animFrameId);
    if (this.resizeObserver) this.resizeObserver.disconnect();
  }
}

