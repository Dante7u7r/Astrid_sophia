import type { ComponentInstance } from "../canvas_orchestrator";
import type { CircuitNetlist } from "../simulation/netlist_extractor";
import type { SimulationRunner, InteractiveMutationField } from "../simulation/simulation_runner";
import type { OscilloscopePanel, PvtTrace } from "./oscilloscope_panel";
import {
  type ParametricParameter,
  type ParametricTarget,
  getAvailableParametersForComponent,
  generateSweepValues,
  formatParametricValue,
} from "./parametric_sweep_model";

const SWEEP_TRACE_COLORS = [
  "#66fcf1", // Neon Cyan
  "#a855f7", // Purple
  "#f97316", // Orange
  "#22c55e", // Green
  "#ec4899", // Pink
  "#eab308", // Yellow
  "#38bdf8", // Sky Blue
  "#f43f5e", // Rose
];

export interface ParametricSweepDependencies {
  getComponents: () => readonly ComponentInstance[];
  getSelectedComponent: () => ComponentInstance | null;
  getSimulationRunner: () => SimulationRunner | null;
  getOscilloscopePanel: () => OscilloscopePanel | null;
  getCircuitNetlist?: () => CircuitNetlist | null;
  updateCanvasRendering: () => void;
  markCurrentTabAsModified?: () => void;
  addLog: (text: string, type?: "system" | "send" | "receive" | "error") => void;
  invokeTauri?: <T>(cmd: string, args?: unknown) => Promise<T>;
  documentRef?: Document;
}

export class ParametricSweepController {
  private activeTarget: ParametricTarget | null = null;
  private isSweepRunning = false;

  private compSelect: HTMLSelectElement | null = null;
  private paramSelect: HTMLSelectElement | null = null;
  private slider: HTMLInputElement | null = null;
  private valBadge: HTMLElement | null = null;
  private minInput: HTMLInputElement | null = null;
  private maxInput: HTMLInputElement | null = null;
  private stepsInput: HTMLInputElement | null = null;
  private logCheck: HTMLInputElement | null = null;
  private runBtn: HTMLButtonElement | null = null;
  private clearBtn: HTMLButtonElement | null = null;

  constructor(private readonly dependencies: ParametricSweepDependencies) {}

  public init(): void {
    const doc = this.getDocument();
    this.compSelect = doc.querySelector("#param-sweep-comp-select");
    this.paramSelect = doc.querySelector("#param-sweep-param-select");
    this.slider = doc.querySelector("#param-sweep-slider");
    this.valBadge = doc.querySelector("#param-sweep-val-badge");
    this.minInput = doc.querySelector("#param-sweep-min");
    this.maxInput = doc.querySelector("#param-sweep-max");
    this.stepsInput = doc.querySelector("#param-sweep-steps");
    this.logCheck = doc.querySelector("#param-sweep-log");
    this.runBtn = doc.querySelector("#param-sweep-run-btn");
    this.clearBtn = doc.querySelector("#param-sweep-clear-btn");

    this.compSelect?.addEventListener("change", () => {
      const compId = this.compSelect?.value;
      if (compId) this.onComponentSelected(compId);
    });

    this.paramSelect?.addEventListener("change", () => {
      const param = this.paramSelect?.value as ParametricParameter;
      if (param && this.compSelect?.value) {
        this.selectTarget(this.compSelect.value, param);
      }
    });

    this.slider?.addEventListener("input", () => {
      this.onSliderChange();
    });

    this.runBtn?.addEventListener("click", () => {
      void this.runFamilyOfCurvesSweep();
    });

    this.clearBtn?.addEventListener("click", () => {
      this.clearFamilyOfCurves();
    });

    this.refreshComponentsList();
  }

  public refreshComponentsList(): void {
    if (!this.compSelect) return;
    const components = this.dependencies.getComponents();
    const currentVal = this.compSelect.value;

    this.compSelect.innerHTML = '<option value="">-- Seleccionar Componente --</option>';
    for (const comp of components) {
      if (comp.type === "ground") continue;
      const opt = document.createElement("option");
      opt.value = comp.id;
      opt.textContent = `${comp.id} (${comp.type})`;
      this.compSelect.appendChild(opt);
    }

    if (currentVal && components.some((c) => c.id === currentVal)) {
      this.compSelect.value = currentVal;
    } else {
      const selected = this.dependencies.getSelectedComponent();
      if (selected && selected.type !== "ground") {
        this.compSelect.value = selected.id;
        this.onComponentSelected(selected.id);
      }
    }
  }

  public onComponentSelected(componentId: string): void {
    const comp = this.dependencies.getComponents().find((c) => c.id === componentId);
    if (!comp) return;

    const available = getAvailableParametersForComponent(comp);
    if (this.paramSelect) {
      this.paramSelect.innerHTML = "";
      for (const target of available) {
        const opt = document.createElement("option");
        opt.value = target.parameter;
        opt.textContent = target.label;
        this.paramSelect.appendChild(opt);
      }
    }

    if (available.length > 0) {
      this.selectTarget(componentId, available[0].parameter);
    }
  }

  public selectTarget(componentId: string, param: ParametricParameter): void {
    const comp = this.dependencies.getComponents().find((c) => c.id === componentId);
    if (!comp) return;

    const targets = getAvailableParametersForComponent(comp);
    const target = targets.find((t) => t.parameter === param) || targets[0];
    if (!target) return;

    this.activeTarget = target;

    if (this.minInput) this.minInput.value = target.min.toString();
    if (this.maxInput) this.maxInput.value = target.max.toString();
    if (this.stepsInput) this.stepsInput.value = "5";
    if (this.logCheck) this.logCheck.checked = target.isLog;

    this.updateSliderRange(target);
    this.updateValueBadge(target.current);
  }

  private updateSliderRange(target: ParametricTarget): void {
    if (!this.slider) return;
    this.slider.min = "0";
    this.slider.max = "1000";
    this.slider.step = "1";

    // Mapear el valor actual a posición del slider (0..1000)
    let pos = 500;
    if (target.isLog && target.min > 0 && target.max > 0) {
      const logMin = Math.log10(target.min);
      const logMax = Math.log10(target.max);
      const logCur = Math.log10(Math.max(target.min, Math.min(target.max, target.current)));
      pos = ((logCur - logMin) / (logMax - logMin)) * 1000;
    } else {
      pos = ((target.current - target.min) / (target.max - target.min)) * 1000;
    }
    this.slider.value = Math.max(0, Math.min(1000, Math.round(pos))).toString();
  }

  private calculateValueFromSlider(pos: number, target: ParametricTarget): number {
    const frac = Math.max(0, Math.min(1, pos / 1000));
    if (target.isLog && target.min > 0 && target.max > 0) {
      const logMin = Math.log10(target.min);
      const logMax = Math.log10(target.max);
      return Math.pow(10, logMin + frac * (logMax - logMin));
    }
    return target.min + frac * (target.max - target.min);
  }

  public onSliderChange(): void {
    if (!this.activeTarget || !this.slider) return;
    const pos = parseFloat(this.slider.value);
    const newVal = this.calculateValueFromSlider(pos, this.activeTarget);
    this.activeTarget.current = newVal;
    this.updateValueBadge(newVal);

    // 1. Actualizar el componente en el esquemático
    const comp = this.dependencies.getComponents().find((c) => c.id === this.activeTarget!.componentId);
    if (comp) {
      if (this.activeTarget.parameter === "value") {
        comp.value = newVal;
        comp.label = formatParametricValue(newVal, "value", this.activeTarget.unit);
      } else if (this.activeTarget.parameter === "amplitude") {
        (comp as unknown as { amplitude?: number }).amplitude = newVal;
      } else if (this.activeTarget.parameter === "frequency") {
        (comp as unknown as { frequency?: number }).frequency = newVal;
      } else if (this.activeTarget.parameter === "offset") {
        (comp as unknown as { offset?: number }).offset = newVal;
      } else if (this.activeTarget.parameter === "w") {
        (comp as unknown as { w?: number }).w = newVal;
      } else if (this.activeTarget.parameter === "l") {
        (comp as unknown as { l?: number }).l = newVal;
      } else if (this.activeTarget.parameter === "wiper") {
        (comp as unknown as { wiper?: number }).wiper = newVal;
      }
      this.dependencies.updateCanvasRendering();
      this.dependencies.markCurrentTabAsModified?.();
    }

    // 2. Hot-patching en vivo durante simulación activa
    const runner = this.dependencies.getSimulationRunner();
    if (runner && runner.isSimulationActive()) {
      const mutationField: InteractiveMutationField =
        this.activeTarget.parameter === "amplitude"
          ? "amplitude"
          : this.activeTarget.parameter === "frequency"
            ? "frequency"
            : this.activeTarget.parameter === "offset"
              ? "offset"
              : this.activeTarget.parameter === "duty_cycle"
                ? "duty_cycle"
                : "value";

      void runner.mutateComponent(this.activeTarget.componentId, mutationField, newVal);
    }
  }

  private updateValueBadge(val: number): void {
    if (!this.valBadge || !this.activeTarget) return;
    this.valBadge.textContent = formatParametricValue(val, this.activeTarget.parameter, this.activeTarget.unit);
  }

  public async runFamilyOfCurvesSweep(): Promise<void> {
    if (!this.activeTarget || this.isSweepRunning) return;
    const oscilloscope = this.dependencies.getOscilloscopePanel();
    if (!oscilloscope) return;

    const min = parseFloat(this.minInput?.value || "") || this.activeTarget.min;
    const max = parseFloat(this.maxInput?.value || "") || this.activeTarget.max;
    const steps = parseInt(this.stepsInput?.value || "", 10) || 5;
    const isLog = this.logCheck?.checked ?? this.activeTarget.isLog;

    const sweepValues = generateSweepValues({ min, max, steps, isLog });
    this.isSweepRunning = true;
    if (this.runBtn) this.runBtn.disabled = true;

    this.dependencies.addLog(
      `Iniciando barrido paramétrico de [${this.activeTarget.componentId}.${this.activeTarget.parameter}]: ${sweepValues.length} puntos...`,
      "send",
    );

    const traces: PvtTrace[] = [];
    const baseNetlist = this.dependencies.getCircuitNetlist ? this.dependencies.getCircuitNetlist() : null;

    try {
      for (let i = 0; i < sweepValues.length; i++) {
        const val = sweepValues[i];
        const valStr = formatParametricValue(val, this.activeTarget.parameter, this.activeTarget.unit);
        const color = SWEEP_TRACE_COLORS[i % SWEEP_TRACE_COLORS.length];

        let results = oscilloscope.transientResults;

        // Si tenemos netlist e IPC, ejecutamos una corrida transitoria con el parámetro modificado
        if (baseNetlist && this.dependencies.invokeTauri) {
          const sweepNetlist: CircuitNetlist = JSON.parse(JSON.stringify(baseNetlist));
          const comp = sweepNetlist.components.find((c) => c.id === this.activeTarget!.componentId);
          if (comp) {
            if (this.activeTarget.parameter === "value") {
              (comp as { value: number | string }).value = val;
            } else if (this.activeTarget.parameter === "amplitude") {
              (comp as unknown as { amplitude?: number }).amplitude = val;
            } else if (this.activeTarget.parameter === "frequency") {
              (comp as unknown as { frequency?: number }).frequency = val;
            } else if (this.activeTarget.parameter === "offset") {
              (comp as unknown as { offset?: number }).offset = val;
            } else if (this.activeTarget.parameter === "w") {
              (comp as unknown as { w?: number }).w = val;
            } else if (this.activeTarget.parameter === "l") {
              (comp as unknown as { l?: number }).l = val;
            }
          }

          try {
            const runRes = await this.dependencies.invokeTauri<{ transient: import("./oscilloscope_panel").TimeStepResult[] }>(
              "run_transient_simulation",
              {
                netlist: sweepNetlist,
                settings: {
                  dt: 1e-4,
                  tMax: oscilloscope.timeDivValue * 10,
                  fixedStep: true,
                },
              },
            );
            if (runRes?.transient?.length) {
              results = runRes.transient;
            }
          } catch {
            // Fallback a traza actual
          }
        }

        traces.push({
          label: `${this.activeTarget.componentId}=${valStr}`,
          name: `${this.activeTarget.componentId}=${valStr}`,
          results: [...results],
          visible: true,
          color,
        });
      }

      oscilloscope.pvtTraces = traces;
      oscilloscope.pvtMode = true;
      oscilloscope.activeAnalysisMode = "PVT";
      oscilloscope.draw();

      this.dependencies.addLog(
        `Familia de curvas paramétricas generada exitosamente (${traces.length} trazas).`,
        "receive",
      );
    } catch (err) {
      const errorMsg = err instanceof Error ? err.message : String(err);
      this.dependencies.addLog(`Error al generar familia de curvas: ${errorMsg}`, "error");
    } finally {
      this.isSweepRunning = false;
      if (this.runBtn) this.runBtn.disabled = false;
    }
  }

  public clearFamilyOfCurves(): void {
    const oscilloscope = this.dependencies.getOscilloscopePanel();
    if (!oscilloscope) return;
    oscilloscope.pvtTraces = [];
    oscilloscope.pvtMode = false;
    oscilloscope.draw();
    this.dependencies.addLog("Familia de curvas paramétricas eliminada del osciloscopio.", "system");
  }

  private getDocument(): Document {
    return this.dependencies.documentRef ?? document;
  }
}

export function createParametricSweepController(
  dependencies: ParametricSweepDependencies,
): ParametricSweepController {
  return new ParametricSweepController(dependencies);
}
