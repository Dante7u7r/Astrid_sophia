/**
 * LogicAnalyzerInstrument — Analizador Lógico Digital de 8 Canales
 */

import { CanvasOrchestrator } from "../canvas_orchestrator";

export class LogicAnalyzerInstrument {
  private container: HTMLElement;
  private orchestrator: CanvasOrchestrator;
  private callbacks: any;
  private canvas: HTMLCanvasElement | null = null;
  private ctx: CanvasRenderingContext2D | null = null;

  // Configuration: mapping of 8 digital channels (D0 - D7) to electrical node names
  private channels: (string | null)[] = [null, null, null, null, null, null, null, null];
  private nodeHistory: Record<string, { time: number; val: number }[]> = {};

  constructor(container: HTMLElement, orchestrator: CanvasOrchestrator, callbacks: any) {
    this.container = container;
    this.orchestrator = orchestrator;
    this.callbacks = callbacks;
    this.render();
    this.initCanvas();
    this.bindEvents();
  }

  private render() {
    this.container.innerHTML = `
      <div style="display: flex; gap: 10px; height: 100%; font-family: var(--font-sans); overflow: hidden;">
        <!-- Panel Izquierdo: Selectores de Sonda por Canal -->
        <div style="width: 25%; background: rgba(0,0,0,0.4); border-right: 1px solid var(--border-color); display: flex; flex-direction: column; gap: 4px; padding: 6px; overflow-y: auto;">
          <h4 style="color: var(--cyan); font-size: 0.65rem; text-transform: uppercase; margin-bottom: 4px; letter-spacing: 0.5px; text-align: center;">Canales Lógicos</h4>
          ${Array.from({ length: 8 })
            .map(
              (_, i) => `
            <div style="display: flex; align-items: center; justify-content: space-between; gap: 6px; font-size: 0.68rem; background: rgba(255,255,255,0.02); padding: 4px; border-radius: 4px;">
              <span style="font-weight: bold; color: hsl(${i * 45}, 80%, 60%);">D${i}</span>
              <select class="logic-channel-select" data-index="${i}" style="background: rgba(0,0,0,0.6); border: 1px solid var(--border-color); color: var(--text-bright); font-size: 0.65rem; width: 75%; border-radius: 3px; cursor: pointer; outline: none;">
                <option value="">-- Sin Sonda --</option>
              </select>
            </div>
          `
            )
            .join("")}
        </div>

        <!-- Panel Derecho: Gráfico de Diagramas de Tiempo -->
        <div style="width: 75%; position: relative; display: flex; flex-direction: column; overflow: hidden; background: rgba(2, 3, 8, 0.95);">
          <div style="height: 24px; padding: 4px 10px; display: flex; align-items: center; justify-content: space-between; border-bottom: 1px solid var(--border-subtle); background: rgba(0,0,0,0.2);">
            <span style="font-size: 0.65rem; color: var(--text-muted); text-transform: uppercase;">Líneas de Tiempo Lógicas (0 / 1)</span>
            <button id="logic-clear-btn" class="btn-osc-mini" style="font-size: 0.62rem; padding: 2px 8px;">Limpiar</button>
          </div>
          <div style="flex-grow: 1; position: relative;">
            <canvas id="logic-canvas" style="width: 100%; height: 100%; display: block;"></canvas>
          </div>
        </div>
      </div>
    `;
  }

  private initCanvas() {
    this.canvas = this.container.querySelector("#logic-canvas") as HTMLCanvasElement;
    if (this.canvas) {
      this.ctx = this.canvas.getContext("2d");
      const resize = () => {
        if (this.canvas && this.canvas.parentElement) {
          this.canvas.width = this.canvas.parentElement.clientWidth;
          this.canvas.height = this.canvas.parentElement.clientHeight;
          this.drawWaveforms();
        }
      };
      window.addEventListener("resize", resize);
      setTimeout(resize, 100);
    }
  }

  private bindEvents() {
    const clearBtn = this.container.querySelector("#logic-clear-btn");
    if (clearBtn) {
      clearBtn.addEventListener("click", () => {
        this.nodeHistory = {};
        this.drawWaveforms();
      });
    }

    // Actualizar dinámicamente las opciones del selector de nodos disponibles
    const updateSelectors = () => {
      // Intentar obtener todos los nombres de nodos eléctricos del netlist/simulación
      const selectElements = this.container.querySelectorAll(".logic-channel-select") as NodeListOf<HTMLSelectElement>;
      const existingNodes = Object.keys(this.orchestrator.components.reduce<Record<string, boolean>>((acc, comp) => {
        // Enlazar pines a nodos reales
        const pins = this.orchestrator.getComponentPins(comp);
        pins.forEach((_, idx) => {
          const key = `${comp.id}:${idx}`;
          const nodeId = this.callbacks.getPinNode(key);
          if (nodeId !== undefined) acc[nodeId] = true;
        });
        return acc;
      }, { "0": true }));

      selectElements.forEach((select) => {
        const index = parseInt(select.getAttribute("data-index") || "0", 10);
        const currentVal = this.channels[index] || "";
        
        // Regenerar opciones
        let html = `<option value="">-- Sin Sonda --</option>`;
        Object.keys(existingNodes).sort().forEach((node) => {
          html += `<option value="${node}" ${node === currentVal ? "selected" : ""}>Nodo ${node}</option>`;
        });
        select.innerHTML = html;
      });
    };

    updateSelectors();
    setInterval(updateSelectors, 2000);

    // Guardar canal seleccionado
    this.container.addEventListener("change", (e) => {
      const select = e.target as HTMLSelectElement;
      if (select && select.classList.contains("logic-channel-select")) {
        const index = parseInt(select.getAttribute("data-index") || "0", 10);
        this.channels[index] = select.value || null;
        this.drawWaveforms();
      }
    });
  }

  public recordTimeStep(time: number, nodeVoltages: Record<string, number>) {
    // Almacenar el historial de voltajes
    for (const [node, voltage] of Object.entries(nodeVoltages)) {
      if (!this.nodeHistory[node]) {
        this.nodeHistory[node] = [];
      }
      this.nodeHistory[node].push({ time, val: voltage });

      // Mantener buffer de tamaño manejable
      if (this.nodeHistory[node].length > 1000) {
        this.nodeHistory[node].shift();
      }
    }

    this.drawWaveforms();
  }

  private drawWaveforms() {
    if (!this.canvas || !this.ctx) return;
    const w = this.canvas.width;
    const h = this.canvas.height;
    this.ctx.clearRect(0, 0, w, h);

    const channelHeight = h / 8;

    // Dibujar rejilla horizontal y etiquetas de canal
    for (let i = 0; i < 8; i++) {
      const topY = i * channelHeight;

      // Color de canal
      const hue = i * 45;
      this.ctx.strokeStyle = "rgba(255,255,255,0.03)";
      this.ctx.lineWidth = 1;
      this.ctx.beginPath();
      this.ctx.moveTo(0, topY + channelHeight);
      this.ctx.lineTo(w, topY + channelHeight);
      this.ctx.stroke();

      // Línea de referencia baja (0)
      this.ctx.strokeStyle = "rgba(255, 255, 255, 0.08)";
      this.ctx.beginPath();
      this.ctx.moveTo(60, topY + channelHeight - 8);
      this.ctx.lineTo(w, topY + channelHeight - 8);
      this.ctx.stroke();

      // Nombre de canal en pantalla
      this.ctx.fillStyle = `hsl(${hue}, 80%, 60%)`;
      this.ctx.font = "bold 9px var(--font-mono)";
      this.ctx.fillText(`D${i}: ${this.channels[i] ? `Nodo ${this.channels[i]}` : "OFF"}`, 8, topY + 16);

      // Dibujar la señal digital
      const node = this.channels[i];
      if (!node || !this.nodeHistory[node] || this.nodeHistory[node].length < 2) continue;

      const history = this.nodeHistory[node];
      const maxPoints = history.length;
      
      this.ctx.strokeStyle = `hsl(${hue}, 90%, 55%)`;
      this.ctx.lineWidth = 2;
      this.ctx.beginPath();

      const getLogicState = (v: number): "0" | "1" | "X" => {
        if (v < 0.8) return "0";
        if (v > 2.0) return "1";
        return "X";
      };

      const getPixelY = (state: "0" | "1" | "X"): number => {
        if (state === "1") return topY + 10;
        if (state === "0") return topY + channelHeight - 10;
        return topY + channelHeight / 2; // Undefined / Z state in center
      };

      for (let p = 0; p < maxPoints; p++) {
        const pt = history[p];
        const state = getLogicState(pt.val);
        const x = 60 + ((w - 70) * p) / (maxPoints - 1);
        const y = getPixelY(state);

        if (p === 0) {
          this.ctx.moveTo(x, y);
        } else {
          // Dibujar transiciones verticales perfectas de lógica digital
          const prevState = getLogicState(history[p - 1].val);
          if (prevState !== state) {
            const prevY = getPixelY(prevState);
            this.ctx.lineTo(x, prevY);
          }
          this.ctx.lineTo(x, y);
        }
      }
      this.ctx.stroke();
    }
  }
}
