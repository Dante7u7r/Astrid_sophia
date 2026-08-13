/**
 * CurveTracerInstrument — Trazador de Curvas I-V de Semiconductores
 */

import { CanvasOrchestrator } from "../canvas_orchestrator";
import type { InstrumentCallbacks } from "./instrument_callbacks";
import { ensureCanvasDpr } from "./canvas_dpr";

export class CurveTracerInstrument {
  private container: HTMLElement;
  private orchestrator: CanvasOrchestrator;
  private callbacks: InstrumentCallbacks;
  private canvas: HTMLCanvasElement | null = null;
  private ctx: CanvasRenderingContext2D | null = null;

  // Selected semiconductor for tracing
  private selectedCompId: string | null = null;

  constructor(container: HTMLElement, orchestrator: CanvasOrchestrator, callbacks: InstrumentCallbacks = {} as any) {
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
        <!-- Panel Izquierdo: Configuración del Trazado -->
        <div style="width: 28%; background: rgba(0,0,0,0.4); border-right: 1px solid var(--border-color); display: flex; flex-direction: column; gap: 10px; padding: 10px; overflow-y: auto;">
          <h4 style="color: var(--cyan); font-size: 0.75rem; text-transform: uppercase; letter-spacing: 0.5px;">Trazador de Curvas I-V</h4>
          
          <div style="background: rgba(255,255,255,0.03); border: 1px solid var(--border-subtle); padding: 8px; border-radius: 4px;">
            <div style="font-size: 0.65rem; color: var(--text-muted); text-transform: uppercase; margin-bottom: 4px;">Dispositivo Objetivo</div>
            <div id="tracer-comp-name" style="font-weight: bold; color: var(--text-bright); font-size: 0.85rem;">[Selecciona un componente]</div>
            <div id="tracer-comp-type" style="font-size: 0.68rem; color: var(--cyan);">Semiconductor (Diodo, BJT, MOS)</div>
          </div>

          <div style="display: flex; flex-direction: column; gap: 6px;">
            <label style="font-size: 0.65rem; color: var(--text-muted);">V-Sweep Max (V):</label>
            <input type="number" id="tracer-vmax" value="5" min="0.1" max="50" step="0.5" style="background: rgba(0,0,0,0.6); border: 1px solid var(--border-color); color: #fff; padding: 4px; border-radius: 3px; font-size: 0.75rem;">
          </div>

          <button id="tracer-run-btn" class="btn-osc-primary" style="margin-top: auto; padding: 8px; font-weight: bold;">
            🚀 Ejecutar Trazado I-V
          </button>
        </div>

        <!-- Panel Derecho: Gráfico XY -->
        <div style="width: 72%; display: flex; flex-direction: column; overflow: hidden; background: rgba(2, 3, 8, 0.95);">
          <div style="height: 24px; padding: 4px 10px; display: flex; align-items: center; justify-content: space-between; border-bottom: 1px solid var(--border-subtle); background: rgba(0,0,0,0.2);">
            <span style="font-size: 0.65rem; color: var(--text-muted); text-transform: uppercase;">Curva de Corriente (Id/Ic) vs Tensión (Vd/Vce)</span>
          </div>
          <div style="flex-grow: 1; position: relative;">
            <canvas id="tracer-canvas" style="width: 100%; height: 100%; display: block;"></canvas>
            <div class="osc-grid-overlay"></div>
          </div>
        </div>
      </div>
    `;
  }

  private initCanvas() {
    this.canvas = this.container.querySelector("#tracer-canvas") as HTMLCanvasElement;
    if (this.canvas) {
      this.ctx = this.canvas.getContext("2d");
      const resize = () => {
        if (this.canvas && this.ctx) {
          ensureCanvasDpr(this.canvas, this.ctx);
          this.drawStaticGrid();
        }
      };
      window.addEventListener("resize", resize);
      setTimeout(resize, 100);
    }
  }

  private bindEvents() {
    const runBtn = this.container.querySelector("#tracer-run-btn") as HTMLButtonElement;

    if (runBtn) {
      runBtn.addEventListener("click", () => {
        this.runTrace();
      });
    }

    // Auto-detección del componente seleccionado
    setInterval(() => {
      const nameEl = this.container.querySelector("#tracer-comp-name");
      const typeEl = this.container.querySelector("#tracer-comp-type");
      const sel = this.orchestrator.selectedComponent;

      if (sel && ["diode", "npn", "pnp", "nmos", "pmos", "led"].includes(sel.type)) {
        this.selectedCompId = sel.id;
        if (nameEl) nameEl.textContent = sel.id.toUpperCase();
        if (typeEl) {
          typeEl.textContent =
            sel.type === "diode" ? "Diodo PN" :
            sel.type === "led" ? "Diodo LED" :
            sel.type === "npn" ? "BJT NPN" :
            sel.type === "pnp" ? "BJT PNP" :
            sel.type === "nmos" ? "MOSFET Canal N" : "MOSFET Canal P";
        }
      }
    }, 1000);
  }

  private drawStaticGrid() {
    if (!this.canvas || !this.ctx) return;
    const { width: w, height: h } = ensureCanvasDpr(this.canvas, this.ctx);
    this.ctx.clearRect(0, 0, w, h);

    // Ejes cartesianos
    this.ctx.strokeStyle = "rgba(255,255,255,0.15)";
    this.ctx.lineWidth = 1;
    this.ctx.beginPath();
    // Eje Y
    this.ctx.moveTo(50, 10);
    this.ctx.lineTo(50, h - 30);
    // Eje X
    this.ctx.moveTo(50, h - 30);
    this.ctx.lineTo(w - 20, h - 30);
    this.ctx.stroke();

    // Rejilla tenue
    this.ctx.strokeStyle = "rgba(255,255,255,0.03)";
    const chartW = w - 70;
    const chartH = h - 40;
    for (let i = 1; i <= 5; i++) {
      const x = 50 + (chartW / 5) * i;
      const y = (h - 30) - (chartH / 5) * i;
      
      this.ctx.beginPath();
      this.ctx.moveTo(x, 10);
      this.ctx.lineTo(x, h - 30);
      this.ctx.stroke();

      this.ctx.beginPath();
      this.ctx.moveTo(50, y);
      this.ctx.lineTo(w - 20, y);
      this.ctx.stroke();
    }
  }

  private runTrace() {
    if (!this.canvas || !this.ctx) return;
    const { width: w, height: h } = ensureCanvasDpr(this.canvas, this.ctx);
    this.drawStaticGrid();

    const comp = this.orchestrator.components.find((c) => c.id === this.selectedCompId);
    if (!comp) {
      this.callbacks.log("Por favor, selecciona un diodo o transistor en el lienzo para trazar.", "error");
      return;
    }

    const chartW = w - 70;
    const chartH = h - 40;

    this.callbacks.log(`Trazando curva característica para el componente [${comp.id}]...`, "system");

    // Simular el trazado paramétrico
    if (comp.type === "diode" || comp.type === "led") {
      // Curva diodo clásica (Shockley)
      const Is = comp.type === "led" ? 1e-18 : 1e-12; // Menor corriente de saturación en LED
      const Vt = 0.026;
      const eta = comp.type === "led" ? 2.0 : 1.0;

      this.ctx.strokeStyle = "var(--cyan)";
      this.ctx.lineWidth = 2.5;
      this.ctx.beginPath();

      const maxV = comp.type === "led" ? 3.0 : 1.2;
      const maxI = 0.05; // 50 mA

      for (let i = 0; i <= 100; i++) {
        const v = (maxV * i) / 100;
        const current = Is * (Math.exp(v / (eta * Vt)) - 1);
        
        const x = 50 + (v / maxV) * chartW;
        const y = h - 30 - (Math.min(maxI, current) / maxI) * chartH;

        if (i === 0) this.ctx.moveTo(x, y);
        else this.ctx.lineTo(x, y);
      }
      this.ctx.stroke();

      // Textos de escalas
      this.ctx.fillStyle = "var(--text-muted)";
      this.ctx.fillText(`${maxV.toFixed(1)} V`, w - 30, h - 18);
      this.ctx.fillText(`${(maxI * 1000).toFixed(0)} mA`, 15, 20);

    } else if (comp.type === "npn" || comp.type === "pnp") {
      // Curva BJT (Familia de curvas Ic vs Vce para diferentes Ib)
      const beta = 150;
      const Vaf = 100; // Early voltage
      
      const maxVce = 10.0;
      const maxIc = 0.03; // 30 mA

      // Trazar 5 curvas para diferentes Ib (10uA, 20uA, 30uA, 40uA, 50uA)
      for (let step = 1; step <= 5; step++) {
        const Ib = step * 40e-6; // 40uA a 200uA
        this.ctx.strokeStyle = `hsl(${140 + step * 15}, 80%, 55%)`;
        this.ctx.lineWidth = 1.5;
        this.ctx.beginPath();

        for (let i = 0; i <= 100; i++) {
          const vce = (maxVce * i) / 100;
          // Saturation + active region model with Early effect
          const satFactor = 1 - Math.exp(-vce / 0.5);
          const ic = satFactor * beta * Ib * (1 + vce / Vaf);

          const x = 50 + (vce / maxVce) * chartW;
          const y = h - 30 - (Math.min(maxIc, ic) / maxIc) * chartH;

          if (i === 0) this.ctx.moveTo(x, y);
          else this.ctx.lineTo(x, y);
        }
        this.ctx.stroke();
      }

      this.ctx.fillStyle = "var(--text-muted)";
      this.ctx.fillText(`${maxVce.toFixed(1)} Vce`, w - 35, h - 18);
      this.ctx.fillText(`${(maxIc * 1000).toFixed(0)} mA`, 15, 20);

    } else if (comp.type === "nmos" || comp.type === "pmos") {
      // Curva MOSFET (Familia de curvas Id vs Vds para diferentes Vgs)
      const Kn = 2e-3;
      const Vth = 2.0;
      const lambda = 0.02; // Canal modulation
      
      const maxVds = 12.0;
      const maxId = 0.04; // 40 mA

      // Trazar 5 curvas para diferentes Vgs (3V a 7V)
      for (let step = 1; step <= 5; step++) {
        const Vgs = 2.5 + step * 0.9;
        this.ctx.strokeStyle = `hsl(${260 + step * 15}, 80%, 65%)`;
        this.ctx.lineWidth = 1.5;
        this.ctx.beginPath();

        for (let i = 0; i <= 100; i++) {
          const vds = (maxVds * i) / 100;
          let id = 0;

          if (Vgs > Vth) {
            if (vds < Vgs - Vth) {
              // Triodo region
              id = Kn * (2 * (Vgs - Vth) * vds - vds * vds) * (1 + lambda * vds);
            } else {
              // Saturation region
              id = Kn * Math.pow(Vgs - Vth, 2) * (1 + lambda * vds);
            }
          }

          const x = 50 + (vds / maxVds) * chartW;
          const y = h - 30 - (Math.min(maxId, id) / maxId) * chartH;

          if (i === 0) this.ctx.moveTo(x, y);
          else this.ctx.lineTo(x, y);
        }
        this.ctx.stroke();
      }

      this.ctx.fillStyle = "var(--text-muted)";
      this.ctx.fillText(`${maxVds.toFixed(1)} Vds`, w - 35, h - 18);
      this.ctx.fillText(`${(maxId * 1000).toFixed(0)} mA`, 15, 20);
    }
  }
}
