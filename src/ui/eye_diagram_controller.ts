import type { TimeStepResult } from "./oscilloscope_panel";
import {
  calculateEyeDiagram,
  exportEyeDiagramReportToCsv,
  STANDARD_HEX_EYE_MASK,
  type EyeDiagramResult,
  type EyeMaskDefinition,
} from "../simulation/eye_diagram_model";
import { drawEyeDiagram, type EyeRenderOptions } from "./eye_diagram_renderer";

export interface EyeDiagramControllerDependencies {
  getTransientResults: () => readonly TimeStepResult[];
  getAvailableNodes?: () => readonly string[];
  addLog: (text: string, type?: "system" | "send" | "receive" | "error") => void;
  documentRef?: Document;
}

export class EyeDiagramController {
  private selectedNode = "1";
  private forcedBaudRate: number | null = null;
  private currentMask: EyeMaskDefinition | null = STANDARD_HEX_EYE_MASK;
  private colorScheme: EyeRenderOptions["colorScheme"] = "cyan_phosphor";

  private currentResult: EyeDiagramResult | null = null;

  private canvas: HTMLCanvasElement | null = null;
  private nodeSelect: HTMLSelectElement | null = null;
  private baudInput: HTMLInputElement | null = null;
  private autoBaudBtn: HTMLButtonElement | null = null;
  private maskSelect: HTMLSelectElement | null = null;
  private colorSelect: HTMLSelectElement | null = null;
  private exportCsvBtn: HTMLButtonElement | null = null;

  // HUD Readouts
  private heightValEl: HTMLElement | null = null;
  private widthValEl: HTMLElement | null = null;
  private tieRmsValEl: HTMLElement | null = null;
  private periodJitterValEl: HTMLElement | null = null;
  private baudValEl: HTMLElement | null = null;
  private qFactorValEl: HTMLElement | null = null;

  constructor(private readonly dependencies: EyeDiagramControllerDependencies) {}

  public init(): void {
    const doc = this.getDocument();
    this.canvas = doc.querySelector("#eye-canvas");
    this.nodeSelect = doc.querySelector("#eye-node-select");
    this.baudInput = doc.querySelector("#eye-baud-input");
    this.autoBaudBtn = doc.querySelector("#eye-autobaud-btn");
    this.maskSelect = doc.querySelector("#eye-mask-select");
    this.colorSelect = doc.querySelector("#eye-color-select");
    this.exportCsvBtn = doc.querySelector("#eye-export-csv-btn");

    this.heightValEl = doc.querySelector("#eye-hud-height");
    this.widthValEl = doc.querySelector("#eye-hud-width");
    this.tieRmsValEl = doc.querySelector("#eye-hud-tie-rms");
    this.periodJitterValEl = doc.querySelector("#eye-hud-period-jitter");
    this.baudValEl = doc.querySelector("#eye-hud-baud");
    this.qFactorValEl = doc.querySelector("#eye-hud-qfactor");

    this.nodeSelect?.addEventListener("change", () => {
      this.selectedNode = this.nodeSelect?.value || "1";
      this.recalculateAndRender();
    });

    this.baudInput?.addEventListener("change", () => {
      const val = parseFloat(this.baudInput?.value || "");
      this.forcedBaudRate = Number.isFinite(val) && val > 0 ? val : null;
      this.recalculateAndRender();
    });

    this.autoBaudBtn?.addEventListener("click", () => {
      this.forcedBaudRate = null;
      if (this.baudInput) this.baudInput.value = "";
      this.recalculateAndRender();
    });

    this.maskSelect?.addEventListener("change", () => {
      const val = this.maskSelect?.value;
      this.currentMask = val === "hex" ? STANDARD_HEX_EYE_MASK : null;
      this.draw();
    });

    this.colorSelect?.addEventListener("change", () => {
      this.colorScheme = (this.colorSelect?.value as EyeRenderOptions["colorScheme"]) || "cyan_phosphor";
      this.draw();
    });

    this.exportCsvBtn?.addEventListener("click", () => {
      this.exportCsv();
    });

    this.populateNodes();
    this.recalculateAndRender();
  }

  public populateNodes(): void {
    if (!this.nodeSelect) return;
    const nodes = this.dependencies.getAvailableNodes ? this.dependencies.getAvailableNodes() : ["1", "2", "out", "clk", "data"];
    this.nodeSelect.innerHTML = "";

    for (const node of nodes) {
      const opt = document.createElement("option");
      opt.value = node;
      opt.textContent = `Nodo V(${node})`;
      this.nodeSelect.appendChild(opt);
    }
    if (nodes.length > 0) {
      this.selectedNode = nodes[0];
      this.nodeSelect.value = nodes[0];
    }
  }

  public recalculateAndRender(): void {
    const transient = this.dependencies.getTransientResults();
    const forcedUnitInterval = this.forcedBaudRate && this.forcedBaudRate > 0 ? 1 / this.forcedBaudRate : undefined;

    this.currentResult = calculateEyeDiagram(transient, this.selectedNode, {
      forcedUnitInterval,
      mask: this.currentMask ?? undefined,
    });

    this.updateHudMetrics();
    this.draw();
  }

  public draw(): void {
    if (!this.canvas) return;
    const ctx = this.canvas.getContext("2d");
    if (!ctx) return;

    drawEyeDiagram(ctx, {
      width: this.canvas.width,
      height: this.canvas.height,
      result: this.currentResult,
      showMask: Boolean(this.currentMask),
      mask: this.currentMask ?? undefined,
      showSamplingPoint: true,
      colorScheme: this.colorScheme,
    });
  }

  private updateHudMetrics(): void {
    if (!this.currentResult) {
      if (this.heightValEl) this.heightValEl.textContent = "--";
      if (this.widthValEl) this.widthValEl.textContent = "--";
      if (this.tieRmsValEl) this.tieRmsValEl.textContent = "--";
      if (this.periodJitterValEl) this.periodJitterValEl.textContent = "--";
      if (this.baudValEl) this.baudValEl.textContent = "--";
      if (this.qFactorValEl) this.qFactorValEl.textContent = "--";
      return;
    }

    const res = this.currentResult;
    if (this.heightValEl) this.heightValEl.textContent = `${res.eyeHeight.toFixed(3)} V`;
    if (this.widthValEl) this.widthValEl.textContent = `${(res.eyeWidthUi * 100).toFixed(1)}% UI`;
    if (this.tieRmsValEl) this.tieRmsValEl.textContent = `${(res.jitter.tieRms * 1e12).toFixed(1)} ps`;
    if (this.periodJitterValEl) this.periodJitterValEl.textContent = `${(res.jitter.periodJitterRms * 1e12).toFixed(1)} ps`;
    if (this.baudValEl) this.baudValEl.textContent = `${(res.baudRate / 1e6).toFixed(2)} MBaud`;
    if (this.qFactorValEl) this.qFactorValEl.textContent = res.qualityFactorQ.toFixed(2);
  }

  public exportCsv(): void {
    if (!this.currentResult) {
      this.dependencies.addLog("No hay datos de diagrama de ojo disponibles para exportar.", "error");
      return;
    }

    const csvContent = exportEyeDiagramReportToCsv(this.currentResult);
    const blob = new Blob([csvContent], { type: "text/csv;charset=utf-8;" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.setAttribute("href", url);
    link.setAttribute("download", `eye_diagram_${this.currentResult.node}_${Date.now()}.csv`);
    link.click();
    URL.revokeObjectURL(url);

    this.dependencies.addLog(`Reporte de Diagrama de Ojo y Jitter exportado exitosamente a CSV.`, "receive");
  }

  public getCurrentResult(): EyeDiagramResult | null {
    return this.currentResult;
  }

  private getDocument(): Document {
    return this.dependencies.documentRef ?? document;
  }
}

export function createEyeDiagramController(
  dependencies: EyeDiagramControllerDependencies,
): EyeDiagramController {
  return new EyeDiagramController(dependencies);
}
