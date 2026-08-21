import type {
  CornerAnalysisReport,
  CornerSpec,
} from "../simulation/corner_analysis_model";
import {
  buildCornerAnalysisReport,
  exportCornerAnalysisToCsv,
} from "../simulation/corner_analysis_model";
import type { PvtRunResult } from "./oscilloscope_panel";

export interface CornerAnalysisDashboardDependencies {
  getPvtResults: () => readonly PvtRunResult[];
  getCircuitTitle?: () => string;
  addLog: (text: string, type?: "system" | "send" | "receive" | "error") => void;
  documentRef?: Document;
}

export class CornerAnalysisDashboard {
  private specs: CornerSpec[] = [
    {
      id: "spec-vpp-out",
      name: "Voltaje Pico a Pico Vpp",
      metricKey: "vpp",
      node: "out",
      min: 2.5,
      max: 5.5,
      unit: "V",
    },
    {
      id: "spec-risetime-out",
      name: "Tiempo de Subida RiseTime",
      metricKey: "risetime",
      node: "out",
      max: 1e-4,
      unit: "s",
    },
  ];

  private activeVoltageIndex = 0;
  private currentReport: CornerAnalysisReport | null = null;

  private heatmapCanvas: HTMLCanvasElement | null = null;
  private yieldBadge: HTMLElement | null = null;
  private specListContainer: HTMLElement | null = null;
  private voltageTabsContainer: HTMLElement | null = null;
  private summaryTextEl: HTMLElement | null = null;
  private exportCsvBtn: HTMLButtonElement | null = null;

  constructor(private readonly dependencies: CornerAnalysisDashboardDependencies) {}

  public init(): void {
    const doc = this.getDocument();
    this.heatmapCanvas = doc.querySelector("#corner-heatmap-canvas");
    this.yieldBadge = doc.querySelector("#corner-yield-badge");
    this.specListContainer = doc.querySelector("#corner-specs-list");
    this.voltageTabsContainer = doc.querySelector("#corner-volt-tabs");
    this.summaryTextEl = doc.querySelector("#corner-summary-text");
    this.exportCsvBtn = doc.querySelector("#corner-export-csv-btn");

    this.exportCsvBtn?.addEventListener("click", () => {
      this.exportCsv();
    });

    this.heatmapCanvas?.addEventListener("mousemove", (e) => {
      this.handleCanvasHover(e);
    });

    this.render();
  }

  public setSpecs(specs: CornerSpec[]): void {
    this.specs = [...specs];
    this.render();
  }

  public addSpec(spec: CornerSpec): void {
    this.specs.push(spec);
    this.render();
  }

  public getReport(): CornerAnalysisReport | null {
    const pvtResults = this.dependencies.getPvtResults();
    if (!pvtResults || pvtResults.length === 0) return null;
    const title = this.dependencies.getCircuitTitle ? this.dependencies.getCircuitTitle() : "Circuito Principal";
    return buildCornerAnalysisReport(pvtResults, this.specs, title);
  }

  public render(): void {
    const report = this.getReport();
    this.currentReport = report;

    if (!report) {
      if (this.summaryTextEl) {
        this.summaryTextEl.textContent = "No hay resultados PVT disponibles. Ejecuta un análisis de matriz PVT primero.";
      }
      if (this.yieldBadge) {
        this.yieldBadge.textContent = "YIELD: --";
        this.yieldBadge.style.borderColor = "var(--border-subtle)";
      }
      return;
    }

    // 1. Actualizar el indicador de rendimiento (Yield)
    if (this.yieldBadge) {
      const isPerfect = report.yieldPercent >= 100;
      const isAcceptable = report.yieldPercent >= 80;
      const color = isPerfect ? "#22c55e" : isAcceptable ? "#eab308" : "#ef4444";

      this.yieldBadge.textContent = `RENDIMIENTO (YIELD): ${report.yieldPercent.toFixed(1)}% (${report.passedCorners}/${report.totalCorners} PASS)`;
      this.yieldBadge.style.color = color;
      this.yieldBadge.style.borderColor = color;
      this.yieldBadge.style.boxShadow = `0 0 12px ${color}33`;
    }

    if (this.summaryTextEl) {
      this.summaryTextEl.textContent = `Análisis de ${report.totalCorners} esquinas | ${report.passedCorners} Aprobadas | ${report.failedCorners} Fuera de especificación`;
    }

    // 2. Renderizar Pestañas de Voltaje
    this.renderVoltageTabs(report.voltages);

    // 3. Renderizar Lista de Especificaciones
    this.renderSpecList();

    // 4. Dibujar Heatmap en Canvas 2D
    this.drawHeatmap();
  }

  private renderVoltageTabs(voltages: readonly number[]): void {
    if (!this.voltageTabsContainer) return;
    this.voltageTabsContainer.innerHTML = "";

    voltages.forEach((volt, idx) => {
      const btn = document.createElement("button");
      btn.className = `btn-mini-tab ${idx === this.activeVoltageIndex ? "active" : ""}`;
      btn.type = "button";
      btn.textContent = `VDD ${(volt * 100).toFixed(0)}% (${volt.toFixed(2)}x)`;
      btn.addEventListener("click", () => {
        this.activeVoltageIndex = idx;
        this.renderVoltageTabs(voltages);
        this.drawHeatmap();
      });
      this.voltageTabsContainer?.appendChild(btn);
    });
  }

  private renderSpecList(): void {
    if (!this.specListContainer) return;
    this.specListContainer.innerHTML = "";

    for (const spec of this.specs) {
      const item = document.createElement("div");
      item.className = "corner-spec-chip";
      const minStr = spec.min !== undefined ? `Min: ${spec.min}${spec.unit}` : "";
      const maxStr = spec.max !== undefined ? `Max: ${spec.max}${spec.unit}` : "";
      const boundsStr = [minStr, maxStr].filter(Boolean).join(" | ");

      item.innerHTML = `
        <span class="spec-name">${spec.name} (N:${spec.node})</span>
        <span class="spec-bounds">${boundsStr}</span>
      `;
      this.specListContainer.appendChild(item);
    }
  }

  public drawHeatmap(): void {
    if (!this.heatmapCanvas || !this.currentReport) return;
    const ctx = this.heatmapCanvas.getContext("2d");
    if (!ctx) return;

    const report = this.currentReport;
    const width = this.heatmapCanvas.width;
    const height = this.heatmapCanvas.height;

    ctx.clearRect(0, 0, width, height);

    // Fondo del Canvas
    ctx.fillStyle = "#070a14";
    ctx.fillRect(0, 0, width, height);

    const corners = report.corners.length > 0 ? report.corners : ["ss", "sf", "tt", "fs", "ff"];
    const temps = report.temperatures.length > 0 ? report.temperatures : [-40, 27, 125];
    const targetVolt = report.voltages[this.activeVoltageIndex] ?? 1.0;

    const paddingLeft = 70;
    const paddingBottom = 40;
    const paddingTop = 30;
    const paddingRight = 20;

    const gridWidth = width - paddingLeft - paddingRight;
    const gridHeight = height - paddingTop - paddingBottom;

    const cellWidth = gridWidth / corners.length;
    const cellHeight = gridHeight / temps.length;

    // Dibujar Celdas del Heatmap
    for (let r = 0; r < temps.length; r++) {
      const temp = temps[r];
      for (let c = 0; c < corners.length; c++) {
        const corner = corners[c];
        const cell = report.cells.find(
          (cl) => cl.corner === corner && Math.abs(cl.temperatureC - temp) < 0.1 && Math.abs(cl.voltageScaling - targetVolt) < 0.01,
        );

        const x = paddingLeft + c * cellWidth;
        const y = paddingTop + r * cellHeight;

        ctx.lineWidth = 1;
        ctx.strokeStyle = "#1e293b";

        if (!cell || !cell.converged) {
          ctx.fillStyle = "#1e293b";
        } else if (cell.pass) {
          ctx.fillStyle = "rgba(34, 197, 94, 0.85)"; // Verde neon Pass
        } else {
          ctx.fillStyle = "rgba(239, 68, 68, 0.85)"; // Rojo neon Fail
        }

        ctx.fillRect(x + 2, y + 2, cellWidth - 4, cellHeight - 4);
        ctx.strokeRect(x + 2, y + 2, cellWidth - 4, cellHeight - 4);

        // Texto en el centro de la celda
        ctx.fillStyle = "#ffffff";
        ctx.font = "bold 11px sans-serif";
        ctx.textAlign = "center";
        ctx.textBaseline = "middle";

        const text = cell ? (cell.pass ? "PASS" : "FAIL") : "--";
        ctx.fillText(text, x + cellWidth / 2, y + cellHeight / 2);
      }
    }

    // Dibujar Ejes y Etiquetas
    ctx.fillStyle = "#94a3b8";
    ctx.font = "11px sans-serif";
    ctx.textAlign = "center";
    ctx.textBaseline = "top";

    // Eje X: Esquinas
    for (let c = 0; c < corners.length; c++) {
      const x = paddingLeft + c * cellWidth + cellWidth / 2;
      ctx.fillText(corners[c].toUpperCase(), x, height - paddingBottom + 10);
    }

    // Eje Y: Temperaturas
    ctx.textAlign = "right";
    ctx.textBaseline = "middle";
    for (let r = 0; r < temps.length; r++) {
      const y = paddingTop + r * cellHeight + cellHeight / 2;
      ctx.fillText(`${temps[r]}°C`, paddingLeft - 10, y);
    }
  }

  private handleCanvasHover(e: MouseEvent): void {
    if (!this.heatmapCanvas || !this.currentReport) return;
    const rect = this.heatmapCanvas.getBoundingClientRect();
    const x = e.clientX - rect.left;
    const y = e.clientY - rect.top;

    const report = this.currentReport;
    const corners = report.corners.length > 0 ? report.corners : ["ss", "sf", "tt", "fs", "ff"];
    const temps = report.temperatures.length > 0 ? report.temperatures : [-40, 27, 125];
    const targetVolt = report.voltages[this.activeVoltageIndex] ?? 1.0;

    const paddingLeft = 70;
    const paddingTop = 30;
    const cellWidth = (this.heatmapCanvas.width - paddingLeft - 20) / corners.length;
    const cellHeight = (this.heatmapCanvas.height - paddingTop - 40) / temps.length;

    const col = Math.floor((x - paddingLeft) / cellWidth);
    const row = Math.floor((y - paddingTop) / cellHeight);

    if (col >= 0 && col < corners.length && row >= 0 && row < temps.length) {
      const corner = corners[col];
      const temp = temps[row];
      const cell = report.cells.find(
        (cl) => cl.corner === corner && Math.abs(cl.temperatureC - temp) < 0.1 && Math.abs(cl.voltageScaling - targetVolt) < 0.01,
      );

      if (cell) {
        this.heatmapCanvas.title = cell.tooltip;
      }
    }
  }

  public exportCsv(): void {
    const report = this.getReport();
    if (!report) return;

    const csvContent = exportCornerAnalysisToCsv(report);
    const blob = new Blob([csvContent], { type: "text/csv;charset=utf-8;" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.setAttribute("href", url);
    link.setAttribute("download", `analisis_esquinas_pvt_${Date.now()}.csv`);
    link.click();
    URL.revokeObjectURL(url);

    this.dependencies.addLog(`Reporte de esquinas PVT exportado exitosamente a CSV.`, "receive");
  }

  private getDocument(): Document {
    return this.dependencies.documentRef ?? document;
  }
}

export function createCornerAnalysisDashboard(
  dependencies: CornerAnalysisDashboardDependencies,
): CornerAnalysisDashboard {
  return new CornerAnalysisDashboard(dependencies);
}
