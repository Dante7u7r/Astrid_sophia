/**
 * LogicAnalyzerInstrument — Analizador Lógico Digital de 8 Canales (LA-800 Pro)
 *
 * Instrumento de laboratorio digital para captura de señales lógicas multicanal (D0..D7),
 * decodificación de buses paralelos (Hex), disparo por flanco (Trigger), regla temporal y cursores de tiempo.
 */

import { CanvasOrchestrator } from "../canvas_orchestrator";
import type { InstrumentCallbacks } from "./instrument_callbacks";
import { ensureCanvasDpr } from "./canvas_dpr";
import {
  decodeParallelBus,
  decodeI2cProtocol,
  decodeSpiProtocol,
  decodeUartProtocol,
  findTriggerMatch,
  formatTimeDiv,
  LOGIC_FAMILIES,
  type BusPacket,
  type ChannelTriggerConfig,
  type LogicSample,
  type LogicThresholdConfig,
  type TriggerEdge,
} from "./logic_analyzer_model";
import { drawLogicAnalyzer, type LogicRendererChannel } from "./logic_analyzer_renderer";

export type ProtocolDecoderMode = "parallel" | "i2c" | "spi" | "uart" | "none";

export class LogicAnalyzerInstrument {
  private container: HTMLElement;
  private orchestrator: CanvasOrchestrator;
  private callbacks: InstrumentCallbacks;
  private canvas: HTMLCanvasElement | null = null;
  private ctx: CanvasRenderingContext2D | null = null;
  private resizeObserver: ResizeObserver | null = null;

  // Configuración de Canales (D0..D7)
  private channels: (string | null)[] = [null, null, null, null, null, null, null, null];
  private channelEnabled: boolean[] = [true, true, true, true, true, true, true, true];
  private nodeHistory: Record<string, LogicSample[]> = {};

  // Configuración de Umbrales y Disparo
  private selectedThreshold: LogicThresholdConfig = LOGIC_FAMILIES[0]; // TTL 5V por defecto
  private triggerConfig: ChannelTriggerConfig = { channelIndex: 0, edge: "none" };
  private decoderMode: ProtocolDecoderMode = "parallel";
  private isCursorsEnabled = false;

  // Ventana de Tiempo / Zoom y Pan
  private timeDiv = 10e-6; // 10 µs / div por defecto
  private timeOffset = 0;   // Segundos de desplazamiento
  private isAutoFit = true;

  // Cursores T1 y T2
  private cursorT1: number | null = null;
  private cursorT2: number | null = null;

  private pollIntervalId: ReturnType<typeof setInterval> | null = null;

  constructor(container: HTMLElement, orchestrator: CanvasOrchestrator, callbacks: InstrumentCallbacks) {
    this.container = container;
    this.orchestrator = orchestrator;
    this.callbacks = callbacks;

    this.render();
    this.initCanvas();
    this.bindEvents();
    this.updateSelectors();

    this.pollIntervalId = setInterval(() => this.updateSelectors(), 1500);
  }

  private render(): void {
    this.container.innerHTML = `
      <div class="logic-main-layout">
        <!-- Barra Lateral: Canales Digitales D0-D7 y Umbrales -->
        <aside class="logic-sidebar">
          <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 2px;">
            <h4 class="gen-section-title" style="color: #c084fc;">📊 Canales (D0..D7)</h4>
            <button id="logic-btn-auto-assign" type="button" class="logic-btn" style="padding: 2px 6px; font-size: 0.6rem;">
              ⚡ Auto-Asignar
            </button>
          </div>

          <!-- Selector de Familia Lógica -->
          <div style="display: flex; flex-direction: column; gap: 2px; margin-bottom: 4px;">
            <label class="rack-label" style="font-size: 0.58rem;">Familia Lógica</label>
            <select id="logic-family-select" class="osc-select" style="width: 100%; cursor: pointer;">
              ${LOGIC_FAMILIES.map(
                (f) => `<option value="${f.id}" ${f.id === this.selectedThreshold.id ? "selected" : ""}>${f.name}</option>`,
              ).join("")}
            </select>
          </div>

          <!-- Lista de Asignación de Canales D0..D7 -->
          <div id="logic-channels-list" style="display: flex; flex-direction: column; gap: 3px; overflow-y: auto; flex: 1;">
            ${Array.from({ length: 8 }).map((_, i) => `
              <div class="logic-ch-row">
                <input type="checkbox" id="logic-ch-en-${i}" data-ch="${i}" checked style="cursor: pointer;" />
                <span class="logic-ch-badge" style="color: hsl(${i * 45}, 85%, 60%);">D${i}</span>
                <select id="logic-select-ch-${i}" data-index="${i}" class="logic-channel-select osc-select-mini" style="flex: 1; cursor: pointer;">
                  <option value="">-- OFF --</option>
                </select>
              </div>
            `).join("")}
          </div>

          <!-- Panel de Disparo (Trigger) -->
          <div style="border-top: 1px solid rgba(255,255,255,0.08); padding-top: 6px; display: flex; flex-direction: column; gap: 4px;">
            <div class="rack-label-group">
              <span class="rack-label">🎯 Disparo (Trigger)</span>
            </div>
            <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 4px;">
              <select id="logic-trig-source" class="osc-select-mini" style="cursor: pointer;">
                ${Array.from({ length: 8 }).map((_, i) => `<option value="${i}">Canal D${i}</option>`).join("")}
              </select>
              <select id="logic-trig-edge" class="osc-select-mini" style="cursor: pointer;">
                <option value="none">Libre (OFF)</option>
                <option value="rising">Flanco ↑</option>
                <option value="falling">Flanco ↓</option>
                <option value="either">Flanco ↕</option>
                <option value="high">Nivel Alto (1)</option>
                <option value="low">Nivel Bajo (0)</option>
              </select>
            </div>
          </div>
        </aside>

        <!-- Área Principal de Diagrama de Tiempos -->
        <main class="logic-content-area">
          <!-- Barra Superior: Controles de Base de Tiempo, Bus, Cursores y Exportación -->
          <div class="logic-top-bar">
            <div style="display: flex; gap: 4px; align-items: center;">
              <select id="logic-decoder-select" class="osc-select-mini" style="font-size: 0.7rem; padding: 2px 4px; cursor: pointer;" title="Decodificador de Protocolo">
                <option value="parallel" selected>Decodificador: Bus Hex (D0..D7)</option>
                <option value="i2c">Decodificador: I2C (D0:SCL, D1:SDA)</option>
                <option value="spi">Decodificador: SPI (D0:SCK, D1:MOSI, D2:MISO, D3:CS)</option>
                <option value="uart">Decodificador: UART (D0:RX, 9600 Bd)</option>
                <option value="none">Decodificador: Ninguno</option>
              </select>
              <button id="logic-btn-cursors" type="button" class="logic-btn" title="Alternar cursores temporales T1 y T2">
                📏 Cursores: OFF
              </button>
              <button id="logic-btn-clear" type="button" class="logic-btn" title="Limpiar historial de captura">
                🧹 Limpiar
              </button>
            </div>

            <!-- Base de Tiempo y Zoom -->
            <div style="display: flex; gap: 4px; align-items: center;">
              <button id="logic-zoom-in" type="button" class="logic-btn" title="Aumentar resolución temporal (Zoom In)">➕</button>
              <button id="logic-zoom-out" type="button" class="logic-btn" title="Disminuir resolución temporal (Zoom Out)">➖</button>
              <button id="logic-zoom-fit" type="button" class="logic-btn" title="Ajustar a todas las muestras capturadas">⛶ Auto-Fit</button>
              <button id="logic-btn-export-csv" type="button" class="logic-btn" title="Exportar datos a CSV">💾 CSV</button>
              <button id="logic-btn-snapshot" type="button" class="logic-btn" title="Descargar captura PNG">📸 PNG</button>
            </div>
          </div>

          <!-- Visor Gráfico Central del Diagrama de Tiempos -->
          <div class="logic-viewport-frame">
            <canvas id="logic-canvas" class="logic-canvas"></canvas>
          </div>

          <!-- Barra Inferior de Telemetría y Mediciones -->
          <div class="logic-telemetry-bar">
            <span id="logic-status-samples">Muestras: 0</span>
            <span id="logic-status-span">Rango: 0.00 µs</span>
            <span id="logic-status-cursors" style="color: #eab308;">Cursores: Inactivos</span>
          </div>
        </main>
      </div>
    `;
  }

  private initCanvas(): void {
    this.canvas = this.container.querySelector("#logic-canvas") as HTMLCanvasElement;
    if (this.canvas) {
      this.ctx = this.canvas.getContext("2d");
      this.resizeObserver = new ResizeObserver(() => {
        this.drawWaveforms();
      });
      this.resizeObserver.observe(this.canvas);
      this.drawWaveforms();
    }
  }

  private bindEvents(): void {
    // 1. Selector de Familia Lógica
    const familySelect = this.container.querySelector("#logic-family-select") as HTMLSelectElement | null;
    familySelect?.addEventListener("change", () => {
      const found = LOGIC_FAMILIES.find((f) => f.id === familySelect.value);
      if (found) {
        this.selectedThreshold = found;
        this.drawWaveforms();
      }
    });

    // 2. Selector de Decodificador de Protocolo
    const decoderSelect = this.container.querySelector("#logic-decoder-select") as HTMLSelectElement | null;
    decoderSelect?.addEventListener("change", () => {
      this.decoderMode = (decoderSelect.value as ProtocolDecoderMode) || "parallel";
      this.drawWaveforms();
    });

    // 3. Botón Cursores ON/OFF
    const cursorsBtn = this.container.querySelector("#logic-btn-cursors") as HTMLButtonElement | null;
    cursorsBtn?.addEventListener("click", () => {
      this.isCursorsEnabled = !this.isCursorsEnabled;
      cursorsBtn.classList.toggle("active", this.isCursorsEnabled);
      cursorsBtn.textContent = this.isCursorsEnabled ? "📏 Cursores: ON" : "📏 Cursores: OFF";

      if (this.isCursorsEnabled) {
        const timeBounds = this.getTimeBounds();
        const duration = timeBounds.endTime - timeBounds.startTime;
        this.cursorT1 = timeBounds.startTime + duration * 0.25;
        this.cursorT2 = timeBounds.startTime + duration * 0.75;
      } else {
        this.cursorT1 = null;
        this.cursorT2 = null;
      }
      this.drawWaveforms();
    });

    // 4. Limpiar Muestras
    this.container.querySelector("#logic-btn-clear")?.addEventListener("click", () => {
      this.nodeHistory = {};
      this.drawWaveforms();
    });

    // 5. Controles de Zoom
    this.container.querySelector("#logic-zoom-in")?.addEventListener("click", () => {
      this.isAutoFit = false;
      this.timeDiv = Math.max(1e-9, this.timeDiv * 0.5);
      this.drawWaveforms();
    });

    this.container.querySelector("#logic-zoom-out")?.addEventListener("click", () => {
      this.isAutoFit = false;
      this.timeDiv = Math.min(10, this.timeDiv * 2.0);
      this.drawWaveforms();
    });

    this.container.querySelector("#logic-zoom-fit")?.addEventListener("click", () => {
      this.isAutoFit = true;
      this.drawWaveforms();
    });

    // 6. Configuración de Disparo (Trigger)
    const trigSourceEl = this.container.querySelector("#logic-trig-source") as HTMLSelectElement | null;
    const trigEdgeEl = this.container.querySelector("#logic-trig-edge") as HTMLSelectElement | null;

    const updateTrigger = () => {
      this.triggerConfig = {
        channelIndex: parseInt(trigSourceEl?.value || "0", 10),
        edge: (trigEdgeEl?.value || "none") as TriggerEdge,
      };
      this.drawWaveforms();
    };

    trigSourceEl?.addEventListener("change", updateTrigger);
    trigEdgeEl?.addEventListener("change", updateTrigger);

    // 7. Auto-Asignación de Canales
    this.container.querySelector("#logic-btn-auto-assign")?.addEventListener("click", () => {
      this.autoAssignNodes();
    });

    // 8. Habilitación individual de canales (checkboxes) y selección de nodos
    for (let i = 0; i < 8; i++) {
      const chk = this.container.querySelector(`#logic-ch-en-${i}`) as HTMLInputElement | null;
      chk?.addEventListener("change", () => {
        this.channelEnabled[i] = chk.checked;
        this.drawWaveforms();
      });

      const sel = this.container.querySelector(`#logic-select-ch-${i}`) as HTMLSelectElement | null;
      sel?.addEventListener("change", () => {
        this.channels[i] = sel.value || null;
        this.drawWaveforms();
      });
    }

    // 9. Exportación CSV y PNG
    this.container.querySelector("#logic-btn-export-csv")?.addEventListener("click", () => this.exportCsv());
    this.container.querySelector("#logic-btn-snapshot")?.addEventListener("click", () => this.snapshotPng());
  }

  public updateSelectors(): void {
    const existingNodes = Object.keys(
      this.orchestrator.components.reduce<Record<string, boolean>>((acc, comp) => {
        const pins = this.orchestrator.getComponentPins(comp);
        pins.forEach((_, idx) => {
          const key = `${comp.id}:${idx}`;
          const nodeId = this.callbacks.getPinNode?.(key);
          if (nodeId !== undefined) acc[nodeId] = true;
        });
        return acc;
      }, Object.keys(this.nodeHistory).reduce<Record<string, boolean>>((acc, n) => {
        acc[n] = true;
        return acc;
      }, { "0": true })),
    );

    for (let i = 0; i < 8; i++) {
      const select = this.container.querySelector(`#logic-select-ch-${i}`) as HTMLSelectElement | null;
      if (!select) continue;

      const currentVal = this.channels[i] || "";
      let html = `<option value="">-- OFF --</option>`;
      existingNodes.sort().forEach((node) => {
        html += `<option value="${node}" ${node === currentVal ? "selected" : ""}>Nodo ${node}</option>`;
      });

      if (select.innerHTML !== html) {
        select.innerHTML = html;
      }
    }
  }

  private autoAssignNodes(): void {
    const existingNodes = Object.keys(this.nodeHistory).filter((n) => n !== "0");
    for (let i = 0; i < 8; i++) {
      if (i < existingNodes.length) {
        this.channels[i] = existingNodes[i];
      }
    }
    this.updateSelectors();
    this.drawWaveforms();
  }

  public recordTimeStep(time: number, nodeVoltages: Record<string, number>): void {
    for (const [node, voltage] of Object.entries(nodeVoltages)) {
      if (!this.nodeHistory[node]) {
        this.nodeHistory[node] = [];
      }
      this.nodeHistory[node].push({ time, val: voltage });

      // Mantener tamaño de historial seguro (máximo 8000 muestras por nodo)
      if (this.nodeHistory[node].length > 8000) {
        this.nodeHistory[node].splice(0, 2000);
      }
    }

    this.drawWaveforms();
  }

  private getTimeBounds(): { startTime: number; endTime: number } {
    let minTime = Infinity;
    let maxTime = -Infinity;

    for (let i = 0; i < 8; i++) {
      const node = this.channels[i];
      if (node && this.nodeHistory[node] && this.nodeHistory[node].length > 0) {
        const h = this.nodeHistory[node];
        minTime = Math.min(minTime, h[0].time);
        maxTime = Math.max(maxTime, h[h.length - 1].time);
      }
    }

    if (!Number.isFinite(minTime) || !Number.isFinite(maxTime) || minTime >= maxTime) {
      return { startTime: 0, endTime: 100e-6 };
    }

    if (this.isAutoFit) {
      return { startTime: minTime, endTime: maxTime };
    }

    const totalWindow = this.timeDiv * 10;
    const start = Math.max(minTime, maxTime - totalWindow + this.timeOffset);
    return { startTime: start, endTime: start + totalWindow };
  }

  public drawWaveforms(): void {
    if (!this.canvas || !this.ctx) return;
    const { width, height } = ensureCanvasDpr(this.canvas, this.ctx);

    const timeBounds = this.getTimeBounds();
    const channelsHistory = this.channels.map((node) => (node ? this.nodeHistory[node] || [] : []));

    // Renderizar Canales Digitales
    const rendererChannels: LogicRendererChannel[] = Array.from({ length: 8 }).map((_, i) => ({
      index: i,
      nodeName: this.channels[i],
      enabled: this.channelEnabled[i],
      color: `hsl(${i * 45}, 85%, 60%)`,
      samples: channelsHistory[i],
    }));

    // Búsqueda de Trigger Match
    let triggerTime: number | null = null;
    if (this.triggerConfig.edge !== "none") {
      const trigIdx = findTriggerMatch(channelsHistory, this.triggerConfig, this.selectedThreshold);
      const trigSamples = channelsHistory[this.triggerConfig.channelIndex];
      if (trigSamples && trigIdx < trigSamples.length) {
        triggerTime = trigSamples[trigIdx].time;
      }
    }

    // Decodificación de Protocolo Seleccionado
    let busPackets: BusPacket[] = [];
    if (this.decoderMode === "parallel") {
      busPackets = decodeParallelBus(channelsHistory, this.channelEnabled, this.selectedThreshold, timeBounds);
    } else if (this.decoderMode === "i2c") {
      const scl = channelsHistory[0] || [];
      const sda = channelsHistory[1] || [];
      const i2cPackets = decodeI2cProtocol(scl, sda, this.selectedThreshold);
      busPackets = i2cPackets.map((p) => ({
        startTime: p.startTime,
        endTime: p.endTime,
        value: p.value ?? 0,
        hasUndefined: false,
        hexLabel: p.label,
      }));
    } else if (this.decoderMode === "spi") {
      const sck = channelsHistory[0] || [];
      const mosi = channelsHistory[1] || [];
      const miso = channelsHistory[2] || [];
      const cs = channelsHistory[3] || [];
      const spiPackets = decodeSpiProtocol(sck, mosi, miso, cs, this.selectedThreshold);
      busPackets = spiPackets.map((p) => ({
        startTime: p.startTime,
        endTime: p.endTime,
        value: p.mosiByte ?? p.misoByte ?? 0,
        hasUndefined: false,
        hexLabel: p.label,
      }));
    } else if (this.decoderMode === "uart") {
      const rx = channelsHistory[0] || [];
      const uartPackets = decodeUartProtocol(rx, 9600, this.selectedThreshold);
      busPackets = uartPackets.map((p) => ({
        startTime: p.startTime,
        endTime: p.endTime,
        value: p.byte,
        hasUndefined: Boolean(p.isParityError),
        hexLabel: `0x${p.byte.toString(16).toUpperCase().padStart(2, "0")} ${p.charLabel}`,
      }));
    }

    drawLogicAnalyzer(this.ctx, {
      width,
      height,
      channels: rendererChannels,
      threshold: this.selectedThreshold,
      timeWindow: timeBounds,
      triggerTime,
      isBusEnabled: this.decoderMode !== "none",
      busPackets,
      cursors: this.isCursorsEnabled ? { cursorT1: this.cursorT1, cursorT2: this.cursorT2 } : undefined,
    });

    // Actualizar barra de estado y telemetría
    this.updateStatusFooter(timeBounds);
  }

  private updateStatusFooter(timeBounds: { startTime: number; endTime: number }): void {
    let totalSamples = 0;
    for (const node of this.channels) {
      if (node && this.nodeHistory[node]) totalSamples += this.nodeHistory[node].length;
    }

    const samplesEl = this.container.querySelector("#logic-status-samples");
    if (samplesEl) samplesEl.textContent = `Muestras: ${totalSamples.toLocaleString()}`;

    const spanEl = this.container.querySelector("#logic-status-span");
    const spanDuration = timeBounds.endTime - timeBounds.startTime;
    if (spanEl) spanEl.textContent = `Rango: ${formatTimeDiv(spanDuration / 10)}`;

    const cursorsEl = this.container.querySelector("#logic-status-cursors") as HTMLElement | null;
    if (cursorsEl) {
      if (this.isCursorsEnabled && this.cursorT1 !== null && this.cursorT2 !== null) {
        const dt = Math.abs(this.cursorT2 - this.cursorT1);
        const f = dt > 0 ? 1 / dt : 0;
        const fStr = f >= 1e6 ? `${(f / 1e6).toFixed(2)} MHz` : f >= 1e3 ? `${(f / 1e3).toFixed(2)} kHz` : `${f.toFixed(0)} Hz`;
        const dtStr = dt >= 1e-3 ? `${(dt * 1e3).toFixed(2)} ms` : `${(dt * 1e6).toFixed(2)} µs`;
        cursorsEl.textContent = `Δt: ${dtStr} | f: ${fStr}`;
      } else {
        cursorsEl.textContent = "Cursores: Inactivos";
      }
    }
  }

  public exportCsv(): void {
    const activeChs = this.channels.map((n, i) => ({ idx: i, node: n, en: this.channelEnabled[i] })).filter((c) => c.en && c.node);

    if (activeChs.length === 0) return;

    let csv = "Time_s," + activeChs.map((c) => `D${c.idx}_Node_${c.node}`).join(",") + "\n";

    // Unir timestamps
    const timesSet = new Set<number>();
    for (const ch of activeChs) {
      const h = this.nodeHistory[ch.node!];
      if (h) h.forEach((s) => timesSet.add(s.time));
    }
    const sortedTimes = Array.from(timesSet).sort((a, b) => a - b);

    for (const t of sortedTimes) {
      const vals = activeChs.map((ch) => {
        const h = this.nodeHistory[ch.node!];
        if (!h || h.length === 0) return "0";
        const sample = h.find((s) => s.time === t);
        return sample ? (sample.val >= this.selectedThreshold.vHigh ? "1" : "0") : "0";
      });
      csv += `${t},${vals.join(",")}\n`;
    }

    const blob = new Blob([csv], { type: "text/csv;charset=utf-8;" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = `analizador_logico_${Date.now()}.csv`;
    link.click();
    URL.revokeObjectURL(url);
  }

  public snapshotPng(): void {
    if (!this.canvas) return;
    const link = document.createElement("a");
    link.download = `analizador_logico_captura_${Date.now()}.png`;
    link.href = this.canvas.toDataURL("image/png");
    link.click();
  }

  public destroy(): void {
    if (this.pollIntervalId) clearInterval(this.pollIntervalId);
    if (this.resizeObserver) this.resizeObserver.disconnect();
  }
}

