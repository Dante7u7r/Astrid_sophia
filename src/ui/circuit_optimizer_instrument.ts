/**
 * CircuitOptimizerInstrument — Panel Interactivo de Auto-Tuning y Optimización Paramétrica
 *
 * Permite seleccionar componentes del circuito, definir cotas físicas [min, max],
 * configurar objetivos multi-dominio (DC, AC y Transitorio) y ejecutar el optimizador
 * Levenberg-Marquardt en escala logarítmica con aplicación inmediata al lienzo EDA.
 */

import type { CanvasOrchestrator } from "../canvas_orchestrator";
import type { InstrumentCallbacks } from "./instrument_callbacks";
import { createNoopInstrumentCallbacks } from "./instrument_callbacks";
import {
  type OptimizableParam,
  type OptimizationTarget,
  type OptimizationSettings,
  type OptimizationResult,
  executeCircuitOptimization,
  formatOptimizationSummary,
  validateOptimizationSetup,
} from "../simulation/circuit_optimizer_model";
import { formatSpiceValue } from "../simulation/spice_value_parser";
import { extractElectricalNetlist } from "../simulation/netlist_extractor";
import { getComponentPins } from "../canvas/component_pins";

export class CircuitOptimizerInstrument {
  private container: HTMLElement;
  public readonly orchestrator: CanvasOrchestrator;
  private callbacks: InstrumentCallbacks;

  // Parámetros y objetivos configurados en la UI
  public params: OptimizableParam[] = [];
  public targets: OptimizationTarget[] = [];
  public settings: OptimizationSettings = {
    maxIterations: 30,
    tolerance: 1e-4,
    initialMu: 1e-2,
  };

  // Último resultado obtenido
  public lastResult: OptimizationResult | null = null;
  public isOptimizing = false;

  constructor(
    container: HTMLElement,
    orchestrator: CanvasOrchestrator,
    callbacks: InstrumentCallbacks = createNoopInstrumentCallbacks(),
  ) {
    this.container = container;
    this.orchestrator = orchestrator;
    this.callbacks = callbacks;

    this.render();
    this.bindEvents();
    this.loadActiveCircuitParameters();
  }

  /**
   * Renderiza el esqueleto HTML del instrumento de optimización
   */
  public render(): void {
    this.container.innerHTML = `
      <div class="optimizer-main-layout" style="display: flex; height: 100%; width: 100%; color: var(--text-primary); font-family: var(--font-sans); background: var(--bg-surface-1);">
        <!-- Panel Izquierdo: Configuración de Parámetros y Objetivos -->
        <aside class="optimizer-sidebar" style="width: 320px; min-width: 280px; border-right: 1px solid var(--border-subtle); padding: 12px; display: flex; flex-direction: column; gap: 10px; overflow-y: auto; background: var(--bg-surface-2);">
          <div style="display: flex; justify-content: space-between; align-items: center;">
            <h4 style="margin: 0; font-size: 0.85rem; color: #38bdf8; display: flex; align-items: center; gap: 6px;">
              <span>🎯</span> Auto-Tuning de Circuitos
            </h4>
            <span id="opt-status-badge" style="font-size: 0.65rem; padding: 2px 6px; border-radius: 4px; background: rgba(56, 189, 248, 0.15); color: #38bdf8; border: 1px solid rgba(56, 189, 248, 0.3);">Listo</span>
          </div>

          <!-- Sección 1: Parámetros a Optimizar -->
          <div style="display: flex; flex-direction: column; gap: 6px;">
            <div style="display: flex; justify-content: space-between; align-items: center;">
              <label style="font-size: 0.72rem; font-weight: bold; color: var(--text-secondary); text-transform: uppercase;">Variables de Circuito</label>
              <button id="opt-btn-scan-circuit" type="button" class="btn-mini" style="font-size: 0.65rem; padding: 2px 6px; background: var(--bg-surface-3); border: 1px solid var(--border-subtle); border-radius: 3px; color: var(--text-primary); cursor: pointer;">🔍 Escanear</button>
            </div>
            <div id="opt-params-list" style="display: flex; flex-direction: column; gap: 4px; max-height: 140px; overflow-y: auto; background: var(--bg-surface-1); padding: 6px; border-radius: 4px; border: 1px solid var(--border-subtle);">
              <!-- Lista dinámica de parámetros -->
            </div>
          </div>

          <!-- Sección 2: Objetivos de Optimización -->
          <div style="display: flex; flex-direction: column; gap: 6px;">
            <div style="display: flex; justify-content: space-between; align-items: center;">
              <label style="font-size: 0.72rem; font-weight: bold; color: var(--text-secondary); text-transform: uppercase;">Objetivos de Diseño</label>
              <button id="opt-btn-add-target" type="button" class="btn-mini" style="font-size: 0.65rem; padding: 2px 6px; background: var(--bg-surface-3); border: 1px solid var(--border-subtle); border-radius: 3px; color: var(--text-primary); cursor: pointer;">➕ Agregar</button>
            </div>
            <div id="opt-targets-list" style="display: flex; flex-direction: column; gap: 4px; max-height: 150px; overflow-y: auto; background: var(--bg-surface-1); padding: 6px; border-radius: 4px; border: 1px solid var(--border-subtle);">
              <!-- Lista dinámica de objetivos -->
            </div>
          </div>

          <!-- Sección 3: Controles de Ejecución -->
          <div style="margin-top: auto; display: flex; flex-direction: column; gap: 6px;">
            <button id="opt-btn-run" type="button" style="width: 100%; padding: 8px; background: linear-gradient(135deg, #0284c7, #0369a1); border: none; border-radius: 4px; color: #ffffff; font-weight: bold; font-size: 0.8rem; cursor: pointer; display: flex; align-items: center; justify-content: center; gap: 6px; box-shadow: 0 2px 4px rgba(0,0,0,0.2);">
              <span>⚡</span> Optimizar Circuito
            </button>
            <button id="opt-btn-apply" type="button" disabled style="width: 100%; padding: 6px; background: var(--bg-surface-3); border: 1px solid var(--border-subtle); border-radius: 4px; color: var(--text-muted); font-size: 0.75rem; cursor: not-allowed; display: flex; align-items: center; justify-content: center; gap: 6px;">
              <span>💾</span> Aplicar al Esquema
            </button>
          </div>
        </aside>

        <!-- Panel Central/Derecho: Monitor de Resultados y Telemetría de Convergencia -->
        <main class="optimizer-results-view" style="flex: 1; padding: 16px; display: flex; flex-direction: column; gap: 12px; overflow-y: auto;">
          <div style="display: flex; justify-content: space-between; align-items: center; border-bottom: 1px solid var(--border-subtle); padding-bottom: 8px;">
            <div>
              <h3 style="margin: 0; font-size: 1rem; color: var(--text-primary);">Resultados del Optimizador Paramétrico</h3>
              <p style="margin: 2px 0 0 0; font-size: 0.72rem; color: var(--text-muted);">Algoritmo Levenberg-Marquardt Log-Scaled con restricciones físicas</p>
            </div>
            <div id="opt-cost-metrics" style="display: flex; gap: 12px; font-size: 0.75rem;">
              <div style="display: flex; flex-direction: column; align-items: flex-end;">
                <span style="color: var(--text-muted); font-size: 0.65rem;">Costo Inicial</span>
                <strong id="opt-val-init-cost" style="color: var(--text-secondary);">--</strong>
              </div>
              <div style="display: flex; flex-direction: column; align-items: flex-end;">
                <span style="color: var(--text-muted); font-size: 0.65rem;">Costo Final</span>
                <strong id="opt-val-final-cost" style="color: #38bdf8;">--</strong>
              </div>
              <div style="display: flex; flex-direction: column; align-items: flex-end;">
                <span style="color: var(--text-muted); font-size: 0.65rem;">Iteraciones</span>
                <strong id="opt-val-iterations" style="color: var(--text-primary);">--</strong>
              </div>
            </div>
          </div>

          <!-- Tabla de Resultados de Parámetros -->
          <div style="display: flex; flex-direction: column; gap: 6px;">
            <h5 style="margin: 0; font-size: 0.75rem; color: var(--text-secondary); text-transform: uppercase;">Valores Óptimos Calculados</h5>
            <div style="border: 1px solid var(--border-subtle); border-radius: 4px; overflow: hidden; background: var(--bg-surface-2);">
              <table style="width: 100%; border-collapse: collapse; font-size: 0.75rem; text-align: left;">
                <thead>
                  <tr style="background: var(--bg-surface-3); color: var(--text-secondary); border-bottom: 1px solid var(--border-subtle);">
                    <th style="padding: 6px 10px;">Componente</th>
                    <th style="padding: 6px 10px;">Propiedad</th>
                    <th style="padding: 6px 10px;">Valor Inicial</th>
                    <th style="padding: 6px 10px;">Valor Óptimo</th>
                    <th style="padding: 6px 10px;">Variación</th>
                  </tr>
                </thead>
                <tbody id="opt-results-table-body">
                  <tr>
                    <td colspan="5" style="padding: 16px; text-align: center; color: var(--text-muted);">
                      Configura las variables y presiona "Optimizar Circuito" para calcular los valores ideales.
                    </td>
                  </tr>
                </tbody>
              </table>
            </div>
          </div>

          <!-- Resumen de Convergencia Textual -->
          <div style="display: flex; flex-direction: column; gap: 4px; margin-top: auto;">
            <label style="font-size: 0.68rem; color: var(--text-muted); text-transform: uppercase;">Informe de Ejecución</label>
            <pre id="opt-log-output" style="margin: 0; padding: 10px; background: #090d16; border: 1px solid var(--border-subtle); border-radius: 4px; font-family: monospace; font-size: 0.7rem; color: #a5f3fc; height: 110px; overflow-y: auto; white-space: pre-wrap;">Esperando inicio de sintonización automática...</pre>
          </div>
        </main>
      </div>
    `;
  }

  /**
   * Vincula los controladores de eventos a los elementos del DOM
   */
  private bindEvents(): void {
    const scanBtn = this.container.querySelector("#opt-btn-scan-circuit");
    scanBtn?.addEventListener("click", () => this.loadActiveCircuitParameters());

    const addTargetBtn = this.container.querySelector("#opt-btn-add-target");
    addTargetBtn?.addEventListener("click", () => this.addDefaultTarget());

    const runBtn = this.container.querySelector("#opt-btn-run");
    runBtn?.addEventListener("click", () => this.runOptimization());

    const applyBtn = this.container.querySelector("#opt-btn-apply");
    applyBtn?.addEventListener("click", () => this.applyOptimalParametersToCircuit());
  }

  /**
   * Escanea los componentes presentes en el lienzo y genera variables optimizables por defecto
   */
  public loadActiveCircuitParameters(): void {
    const components = this.orchestrator.components;
    this.params = [];

    for (const comp of components) {
      if (comp.type === "resistor") {
        this.params.push({
          componentId: comp.id,
          property: "value",
          minVal: 1.0,
          maxVal: 10_000_000.0,
          initialVal: typeof comp.value === "number" ? comp.value : 1000.0,
        });
      } else if (comp.type === "capacitor") {
        this.params.push({
          componentId: comp.id,
          property: "value",
          minVal: 1e-12,
          maxVal: 1e-2,
          initialVal: typeof comp.value === "number" ? comp.value : 100e-9,
        });
      } else if (comp.type === "inductor") {
        this.params.push({
          componentId: comp.id,
          property: "value",
          minVal: 1e-9,
          maxVal: 10.0,
          initialVal: typeof comp.value === "number" ? comp.value : 1e-3,
        });
      }
    }

    if (this.targets.length === 0) {
      // Objetivo por defecto si la lista está vacía
      this.targets.push({
        type: "dcNodeVoltage",
        node: "2",
        targetVoltage: 3.3,
        weight: 1.0,
      });
    }

    this.renderParamsList();
    this.renderTargetsList();
  }

  /**
   * Renderiza la lista de parámetros en la barra lateral
   */
  public renderParamsList(): void {
    const listEl = this.container.querySelector("#opt-params-list");
    if (!listEl) return;

    if (this.params.length === 0) {
      listEl.innerHTML = `<span style="font-size: 0.68rem; color: var(--text-muted); text-align: center; padding: 6px;">No se detectaron componentes pasivos optimizables.</span>`;
      return;
    }

    listEl.innerHTML = this.params
      .map(
        (p, idx) => `
        <div style="display: flex; flex-direction: column; gap: 2px; padding: 4px; background: var(--bg-surface-2); border-radius: 3px; border: 1px solid var(--border-subtle);">
          <div style="display: flex; justify-content: space-between; align-items: center;">
            <strong style="font-size: 0.72rem; color: #38bdf8;">${p.componentId}.${p.property}</strong>
            <button type="button" data-remove-param="${idx}" style="background: none; border: none; color: #f87171; cursor: pointer; font-size: 0.7rem;">✕</button>
          </div>
          <div style="display: grid; grid-template-columns: 1fr 1fr 1fr; gap: 2px; font-size: 0.62rem;">
            <label>Min: <input type="number" step="any" value="${p.minVal}" data-param-min="${idx}" style="width: 100%; background: var(--bg-surface-1); border: 1px solid var(--border-subtle); color: var(--text-primary); border-radius: 2px; font-size: 0.62rem;" /></label>
            <label>Ini: <input type="number" step="any" value="${p.initialVal}" data-param-ini="${idx}" style="width: 100%; background: var(--bg-surface-1); border: 1px solid var(--border-subtle); color: var(--text-primary); border-radius: 2px; font-size: 0.62rem;" /></label>
            <label>Max: <input type="number" step="any" value="${p.maxVal}" data-param-max="${idx}" style="width: 100%; background: var(--bg-surface-1); border: 1px solid var(--border-subtle); color: var(--text-primary); border-radius: 2px; font-size: 0.62rem;" /></label>
          </div>
        </div>
      `,
      )
      .join("");

    // Vincular inputs
    listEl.querySelectorAll<HTMLInputElement>("[data-param-min]").forEach((input) => {
      input.addEventListener("change", (e) => {
        const idx = Number((e.target as HTMLElement).getAttribute("data-param-min"));
        this.params[idx].minVal = parseFloat((e.target as HTMLInputElement).value) || 1e-12;
      });
    });

    listEl.querySelectorAll<HTMLInputElement>("[data-param-ini]").forEach((input) => {
      input.addEventListener("change", (e) => {
        const idx = Number((e.target as HTMLElement).getAttribute("data-param-ini"));
        this.params[idx].initialVal = parseFloat((e.target as HTMLInputElement).value) || 1.0;
      });
    });

    listEl.querySelectorAll<HTMLInputElement>("[data-param-max]").forEach((input) => {
      input.addEventListener("change", (e) => {
        const idx = Number((e.target as HTMLElement).getAttribute("data-param-max"));
        this.params[idx].maxVal = parseFloat((e.target as HTMLInputElement).value) || 1e6;
      });
    });

    listEl.querySelectorAll<HTMLButtonElement>("[data-remove-param]").forEach((btn) => {
      btn.addEventListener("click", (e) => {
        const idx = Number((e.target as HTMLElement).getAttribute("data-remove-param"));
        this.params.splice(idx, 1);
        this.renderParamsList();
      });
    });
  }

  /**
   * Renderiza la lista de objetivos en la barra lateral
   */
  public renderTargetsList(): void {
    const listEl = this.container.querySelector("#opt-targets-list");
    if (!listEl) return;

    if (this.targets.length === 0) {
      listEl.innerHTML = `<span style="font-size: 0.68rem; color: var(--text-muted); text-align: center; padding: 6px;">Agrega al menos un objetivo de optimización.</span>`;
      return;
    }

    listEl.innerHTML = this.targets
      .map((t, idx) => {
        let label = "";
        if (t.type === "dcNodeVoltage") {
          label = `DC V(${t.node}) = ${t.targetVoltage}V`;
        } else if (t.type === "acCutoffFreq") {
          label = `AC Cutoff(${t.node}) = ${formatSpiceValue(t.targetCutoffFreq)}Hz`;
        } else if (t.type === "acGainAtFreq") {
          label = `AC Gain(${t.node}@${formatSpiceValue(t.freq)}Hz) = ${t.targetGainDb}dB`;
        } else if (t.type === "transientSettleVoltage") {
          label = `Tr V(${t.node}@${formatSpiceValue(t.tMax)}s) = ${t.targetVoltage}V`;
        } else if (t.type === "transientRiseTime") {
          label = `Tr Rise(${t.node}) = ${formatSpiceValue(t.targetRiseTime)}s`;
        } else if (t.type === "dcBranchCurrent") {
          label = `DC I(${t.vsourceId}) = ${t.targetCurrent}A`;
        }

        return `
          <div style="display: flex; justify-content: space-between; align-items: center; padding: 4px 6px; background: var(--bg-surface-2); border-radius: 3px; border: 1px solid var(--border-subtle);">
            <span style="font-size: 0.7rem; color: var(--text-primary);">${label}</span>
            <button type="button" data-remove-target="${idx}" style="background: none; border: none; color: #f87171; cursor: pointer; font-size: 0.7rem;">✕</button>
          </div>
        `;
      })
      .join("");

    listEl.querySelectorAll<HTMLButtonElement>("[data-remove-target]").forEach((btn) => {
      btn.addEventListener("click", (e) => {
        const idx = Number((e.target as HTMLElement).getAttribute("data-remove-target"));
        this.targets.splice(idx, 1);
        this.renderTargetsList();
      });
    });
  }

  /**
   * Agrega un objetivo de diseño interactivo
   */
  public addDefaultTarget(): void {
    this.targets.push({
      type: "dcNodeVoltage",
      node: "1",
      targetVoltage: 5.0,
      weight: 1.0,
    });
    this.renderTargetsList();
  }

  /**
   * Ejecuta el proceso de optimización mediante Tauri IPC
   */
  public async runOptimization(): Promise<OptimizationResult | null> {
    if (this.isOptimizing) return null;

    const validation = validateOptimizationSetup(this.params, this.targets);
    if (!validation.valid) {
      this.updateLog(`[Error de Configuración]:\n${validation.errors.join("\n")}`);
      this.callbacks.log?.(`[Optimizer Error]: ${validation.errors[0]}`, "error");
      return null;
    }

    this.isOptimizing = true;
    this.updateStatusBadge("Optimizando...", "#fbbf24");
    this.updateLog("Iniciando algoritmo Levenberg-Marquardt en escala logarítmica...\nEvaluando derivadas y gradientes de residuo...");

    const extraction = extractElectricalNetlist(
      this.orchestrator.components,
      this.orchestrator.wires,
      getComponentPins,
    );
    const netlist = extraction.netlist;

    try {
      const result = await executeCircuitOptimization(
        netlist,
        this.params,
        this.targets,
        this.settings,
      );

      this.lastResult = result;
      this.updateResultsView(result);
      this.callbacks.log?.(
        `[Auto-Tuning]: Convergencia exitosa en ${result.iterations} iteraciones. Costo final: ${result.finalCost.toExponential(2)}`,
        "system",
      );

      const applyBtn = this.container.querySelector("#opt-btn-apply") as HTMLButtonElement | null;
      if (applyBtn) {
        applyBtn.disabled = false;
        applyBtn.style.cursor = "pointer";
        applyBtn.style.color = "var(--text-primary)";
        applyBtn.style.borderColor = "#38bdf8";
      }

      this.updateStatusBadge(result.converged ? "Convergido" : "Completado", "#34d399");
      return result;
    } catch (err) {
      const errMsg = err instanceof Error ? err.message : String(err);
      this.updateLog(`[Fallo de Simulación/IPC]: ${errMsg}`);
      this.updateStatusBadge("Error", "#f87171");
      this.callbacks.log?.(`[Optimizer IPC Error]: ${errMsg}`, "error");
      return null;
    } finally {
      this.isOptimizing = false;
    }
  }

  /**
   * Aplica los parámetros calculados al esquema activo del lienzo
   */
  public applyOptimalParametersToCircuit(): void {
    if (!this.lastResult || !this.lastResult.optimalParameters) return;

    this.callbacks.onCanvasModified?.();

    let appliedCount = 0;
    for (const [key, value] of Object.entries(this.lastResult.optimalParameters)) {
      const [compId, prop] = key.split(".");
      const comp = this.orchestrator.components.find((c) => c.id === compId);
      if (comp && prop === "value" && typeof value === "number") {
        comp.value = value;
        appliedCount++;
      }
    }

    this.callbacks.requestRender?.(true);
    this.callbacks.log?.(
      `[Auto-Tuning]: ${appliedCount} componentes actualizados con sus valores óptimos calculados.`,
      "receive",
    );
    this.updateLog(`\n>>> ${appliedCount} parámetros aplicados exitosamente al esquema activo.`);
  }

  /**
   * Actualiza las métricas y la tabla de resultados en el DOM
   */
  public updateResultsView(result: OptimizationResult): void {
    const initCostEl = this.container.querySelector("#opt-val-init-cost");
    const finalCostEl = this.container.querySelector("#opt-val-final-cost");
    const iterEl = this.container.querySelector("#opt-val-iterations");
    const tableBody = this.container.querySelector("#opt-results-table-body");

    if (initCostEl) initCostEl.textContent = result.initialCost.toExponential(3);
    if (finalCostEl) finalCostEl.textContent = result.finalCost.toExponential(3);
    if (iterEl) iterEl.textContent = String(result.iterations);

    if (tableBody) {
      tableBody.innerHTML = this.params
        .map((p) => {
          const key = `${p.componentId}.${p.property}`;
          const optimal = result.optimalParameters[key] ?? p.initialVal;
          const diffPct = ((optimal - p.initialVal) / p.initialVal) * 100.0;
          const sign = diffPct >= 0 ? "+" : "";

          return `
          <tr style="border-bottom: 1px solid var(--border-subtle);">
            <td style="padding: 6px 10px; font-weight: bold; color: #38bdf8;">${p.componentId}</td>
            <td style="padding: 6px 10px; color: var(--text-secondary);">${p.property}</td>
            <td style="padding: 6px 10px;">${formatSpiceValue(p.initialVal)}</td>
            <td style="padding: 6px 10px; font-weight: bold; color: #34d399;">${formatSpiceValue(optimal)}</td>
            <td style="padding: 6px 10px; color: ${diffPct >= 0 ? "#34d399" : "#fbbf24"};">${sign}${diffPct.toFixed(1)}%</td>
          </tr>
        `;
        })
        .join("");
    }

    this.updateLog(formatOptimizationSummary(result));
  }

  private updateStatusBadge(text: string, color: string): void {
    const badge = this.container.querySelector("#opt-status-badge") as HTMLElement | null;
    if (badge) {
      badge.textContent = text;
      badge.style.color = color;
      badge.style.borderColor = color;
    }
  }

  private updateLog(text: string): void {
    const logEl = this.container.querySelector("#opt-log-output");
    if (logEl) {
      logEl.textContent = text;
    }
  }
}
