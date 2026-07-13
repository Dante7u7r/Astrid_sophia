import { type OscilloscopePanel, type TimeStepResult } from "./oscilloscope_panel";
import {
  type ExportSnapshot,
  buildCsvExport,
  buildSvgExport,
  buildTouchstoneExport,
} from "./exporter_model";
import { type AnalysisMode } from "./simulation_controls";

interface Hdf5LiteDatasetMetadata {
  length: number;
  type: "Float64";
  unit: string;
  node?: string;
  offset?: number;
  byteLength?: number;
}

interface Hdf5LiteMetadata {
  creator: string;
  timestamp: string;
  analysisMode: AnalysisMode;
  datasets: Record<string, Hdf5LiteDatasetMetadata>;
  nodesList?: string[];
}

function formatErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

export class ExporterPanel {
  constructor(
    private callbacks: {
      getOscilloscopePanel: () => OscilloscopePanel | null;
      getActiveAnalysisMode: () => AnalysisMode;
      getProbeNodes: () => { ch1: string | null; ch2: string | null };
      getVoltageMap: () => Record<string, number>;
      addLog: (text: string, type?: 'system' | 'send' | 'receive' | 'error') => void;
    }
  ) {}

  public exportarDatosCSV(): void {
    const { filename, content } = buildCsvExport(this.createExportSnapshot());
    this.downloadBlob(new Blob([content], { type: 'text/csv;charset=utf-8;' }), filename);
    this.callbacks.addLog(`Datos exportados exitosamente a ${filename}`, "receive");
  }

  public exportarDatosSVG(): void {
    const { filename, content } = buildSvgExport(this.createExportSnapshot());
    this.downloadBlob(new Blob([content], { type: 'image/svg+xml;charset=utf-8' }), filename);
    this.callbacks.addLog(`Grafico vectorial exportado exitosamente a ${filename}`, "receive");
  }

  public exportarDatosTouchstone(): void {
    const exportData = buildTouchstoneExport(this.createExportSnapshot(), new Date().toISOString());
    if (!exportData) {
      this.callbacks.addLog("Realiza un analisis de Barrido CA (AC Sweep) antes de exportar datos Touchstone.", "error");
      return;
    }

    this.downloadBlob(new Blob([exportData.content], { type: 'text/plain;charset=utf-8;' }), exportData.filename);
    this.callbacks.addLog("Datos de Barrido CA exportados a formato Touchstone (.s2p) exitosamente.", "receive");
  }

  public exportarDatosHDF5(): void {
    const oscilloscopePanel = this.callbacks.getOscilloscopePanel();
    const activeAnalysisMode = this.callbacks.getActiveAnalysisMode();
    const probes = this.callbacks.getProbeNodes();

    const acResults = oscilloscopePanel ? oscilloscopePanel.acSweepResults : null;
    const tranResults = oscilloscopePanel ? oscilloscopePanel.transientResults : [];
    const ch1Node = oscilloscopePanel ? oscilloscopePanel.ch1ProbeNode : probes.ch1;
    const ch2Node = oscilloscopePanel ? oscilloscopePanel.ch2ProbeNode : probes.ch2;

    const metadata: Hdf5LiteMetadata = {
      creator: "Astryd Sophia v2.0 Evolution",
      timestamp: new Date().toISOString(),
      analysisMode: activeAnalysisMode,
      datasets: {}
    };

    let binaryArrays: Float64Array[] = [];
    let filename = "reporte_simulacion.h5";

    if (activeAnalysisMode === 'AC' && acResults !== null) {
      filename = "reporte_barrido_ca.h5";
      const freqs = new Float64Array(acResults.frequencies);
      binaryArrays.push(freqs);
      metadata.datasets["frequencies"] = { length: freqs.length, type: "Float64", unit: "Hz" };

      if (ch1Node) {
        const db1 = new Float64Array(acResults.nodeAmplitudes[ch1Node] ?? []);
        const ph1 = new Float64Array(acResults.nodePhases[ch1Node] ?? []);
        binaryArrays.push(db1, ph1);
        metadata.datasets[`ch1_magnitude`] = { length: db1.length, type: "Float64", unit: "dB", node: ch1Node };
        metadata.datasets[`ch1_phase`] = { length: ph1.length, type: "Float64", unit: "deg", node: ch1Node };
      }
      if (ch2Node) {
        const db2 = new Float64Array(acResults.nodeAmplitudes[ch2Node] ?? []);
        const ph2 = new Float64Array(acResults.nodePhases[ch2Node] ?? []);
        binaryArrays.push(db2, ph2);
        metadata.datasets[`ch2_magnitude`] = { length: db2.length, type: "Float64", unit: "dB", node: ch2Node };
        metadata.datasets[`ch2_phase`] = { length: ph2.length, type: "Float64", unit: "deg", node: ch2Node };
      }
    } else if ((activeAnalysisMode === 'TRAN' || activeAnalysisMode === 'PSS') && tranResults.length > 0) {
      filename = "reporte_transitorio.h5";
      const times = new Float64Array(tranResults.map((result: TimeStepResult) => result.time));
      binaryArrays.push(times);
      metadata.datasets["time"] = { length: times.length, type: "Float64", unit: "s" };

      if (ch1Node) {
        const v1 = new Float64Array(
          tranResults.map((result: TimeStepResult) => result.nodeVoltages[ch1Node] ?? 0.0),
        );
        binaryArrays.push(v1);
        metadata.datasets[`ch1_voltage`] = { length: v1.length, type: "Float64", unit: "V", node: ch1Node };
      }
      if (ch2Node) {
        const v2 = new Float64Array(
          tranResults.map((result: TimeStepResult) => result.nodeVoltages[ch2Node] ?? 0.0),
        );
        binaryArrays.push(v2);
        metadata.datasets[`ch2_voltage`] = { length: v2.length, type: "Float64", unit: "V", node: ch2Node };
      }
    } else {
      filename = "reporte_punto_operacion_cc.h5";
      const nodes = Object.keys(this.callbacks.getVoltageMap());
      const voltages = new Float64Array(Object.values(this.callbacks.getVoltageMap()));
      binaryArrays.push(voltages);
      metadata.nodesList = nodes;
      metadata.datasets["voltages"] = { length: voltages.length, type: "Float64", unit: "V" };
    }

    const encoder = new TextEncoder();
    const jsonBytes = encoder.encode(JSON.stringify(metadata));

    let currentOffset = 8 + 4 + jsonBytes.byteLength;
    const paddingNeeded = (8 - (currentOffset % 8)) % 8;
    currentOffset += paddingNeeded;

    const datasetMetaKeys = Object.keys(metadata.datasets);
    for (let i = 0; i < binaryArrays.length; i++) {
      const key = datasetMetaKeys[i];
      if (metadata.datasets[key]) {
        metadata.datasets[key].offset = currentOffset;
        metadata.datasets[key].byteLength = binaryArrays[i].byteLength;
      }
      currentOffset += binaryArrays[i].byteLength;
    }

    const finalJsonBytes = encoder.encode(JSON.stringify(metadata));
    const finalJsonLen = finalJsonBytes.byteLength;
    
    const totalHeaderSize = 8 + 4 + finalJsonLen;
    const finalPadding = (8 - (totalHeaderSize % 8)) % 8;
    const headerSizePadded = totalHeaderSize + finalPadding;
    
    let totalByteLength = headerSizePadded;
    for (let i = 0; i < binaryArrays.length; i++) {
      totalByteLength += binaryArrays[i].byteLength;
    }

    const mainBuffer = new ArrayBuffer(totalByteLength);
    const u8View = new Uint8Array(mainBuffer);
    const dataView = new DataView(mainBuffer);

    const magic = [0x89, 0x48, 0x44, 0x46, 0x0D, 0x0A, 0x1A, 0x0A];
    for (let i = 0; i < 8; i++) {
      u8View[i] = magic[i];
    }

    dataView.setUint32(8, finalJsonLen, true,); // little endian
    u8View.set(finalJsonBytes, 12);

    for (let i = 0; i < finalPadding; i++) {
      u8View[12 + finalJsonLen + i] = 0;
    }

    let writeOffset = headerSizePadded;
    for (let i = 0; i < binaryArrays.length; i++) {
      const arr = binaryArrays[i];
      const arrU8 = new Uint8Array(arr.buffer, arr.byteOffset, arr.byteLength);
      u8View.set(arrU8, writeOffset);
      writeOffset += arr.byteLength;
    }

    this.downloadBlob(new Blob([mainBuffer], { type: 'application/octet-stream' }), filename);
    this.callbacks.addLog(`Datos binarios exportados a formato HDF5 Lite (.h5) en ${filename}`, "receive");
  }

  private createExportSnapshot(): ExportSnapshot {
    const oscilloscopePanel = this.callbacks.getOscilloscopePanel();
    const probes = this.callbacks.getProbeNodes();

    return {
      activeAnalysisMode: this.callbacks.getActiveAnalysisMode(),
      acResults: oscilloscopePanel ? oscilloscopePanel.acSweepResults : null,
      transientResults: oscilloscopePanel ? oscilloscopePanel.transientResults : [],
      ch1Node: oscilloscopePanel ? oscilloscopePanel.ch1ProbeNode : probes.ch1,
      ch2Node: oscilloscopePanel ? oscilloscopePanel.ch2ProbeNode : probes.ch2,
      voltageMap: this.callbacks.getVoltageMap(),
    };
  }

  private downloadBlob(blob: Blob, filename: string): void {
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.setAttribute("href", url);
    link.setAttribute("download", filename);
    link.style.visibility = 'hidden';
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);
  }
  private async getCanvasWithBackground(canvasId: string, backgroundColor: string): Promise<string> {
    const canvas = document.getElementById(canvasId) as HTMLCanvasElement | null;
    if (!canvas || canvas.width === 0 || canvas.height === 0) return "";
    
    try {
      const dataUrl = canvas.toDataURL("image/png");
      if (!dataUrl || dataUrl === "data:,") return "";
      
      return new Promise<string>((resolve) => {
        const img = new Image();
        img.onload = () => {
          const tempCanvas = document.createElement("canvas");
          tempCanvas.width = canvas.width;
          tempCanvas.height = canvas.height;
          const tempCtx = tempCanvas.getContext("2d");
          if (!tempCtx) {
            resolve("");
            return;
          }
          
          tempCtx.fillStyle = backgroundColor;
          tempCtx.fillRect(0, 0, tempCanvas.width, tempCanvas.height);
          tempCtx.drawImage(img, 0, 0);
          resolve(tempCanvas.toDataURL("image/png"));
        };
        img.onerror = () => {
          resolve("");
        };
        img.src = dataUrl;
      });
    } catch (err) {
      console.error(`Error en getCanvasWithBackground para ${canvasId}:`, err);
      return "";
    }
  }

  public async exportarReportePDF(): Promise<void> {
    const { jsPDF } = await import("jspdf");
    this.callbacks.addLog("Generando reporte PDF profesional con gráficos vectoriales...", "system");
    
    const oscilloscopePanel = this.callbacks.getOscilloscopePanel();
    const activeAnalysisMode = this.callbacks.getActiveAnalysisMode();
    const probes = this.callbacks.getProbeNodes();

    try {
      const doc = new jsPDF({
        orientation: "portrait",
        unit: "mm",
        format: "a4"
      });

      const pageWidth = doc.internal.pageSize.getWidth();
      const pageHeight = doc.internal.pageSize.getHeight();

      // PÁGINA 1
      doc.setFillColor(12, 16, 27);
      doc.rect(0, 0, pageWidth, pageHeight, "F");

      doc.setFont("Helvetica", "bold");
      doc.setFontSize(22);
      doc.setTextColor(102, 252, 241);
      doc.text("ASTRYD SOPHIA", 20, 25);
      
      doc.setFontSize(10);
      doc.setFont("Helvetica", "normal");
      doc.setTextColor(168, 85, 247);
      doc.text("SIMULADOR DE CIRCUITOS ELECTRÓNICOS PREMIUM v2.0 EVOLUTION", 20, 31);

      doc.setDrawColor(168, 85, 247);
      doc.setLineWidth(0.5);
      doc.line(20, 35, pageWidth - 20, 35);

      doc.setFontSize(11);
      doc.setTextColor(230, 230, 230);
      doc.setFont("Helvetica", "bold");
      doc.text("Información del Reporte:", 20, 48);

      doc.setFont("Helvetica", "normal");
      doc.setFontSize(10);
      doc.setTextColor(180, 180, 180);
      doc.text(`Fecha de Emisión: ${new Date().toLocaleString()}`, 25, 55);
      doc.text(`Modo de Análisis Activo: ${activeAnalysisMode}`, 25, 61);
      
      const ch1Node = oscilloscopePanel ? oscilloscopePanel.ch1ProbeNode : probes.ch1;
      const ch2Node = oscilloscopePanel ? oscilloscopePanel.ch2ProbeNode : probes.ch2;
      doc.text(`Canal 1 (Sonda): Nodo ${ch1Node ?? "No Conectada"}`, 25, 67);
      doc.text(`Canal 2 (Sonda): Nodo ${ch2Node ?? "No Conectada"}`, 25, 73);

      const circuitImg = await this.getCanvasWithBackground("circuit-canvas", "#0c101b");
      if (circuitImg) {
        doc.setFont("Helvetica", "bold");
        doc.setFontSize(12);
        doc.setTextColor(102, 252, 241);
        doc.text("ESQUEMÁTICO DEL CIRCUITO SIMULADO", 20, 88);

        doc.setDrawColor(102, 252, 241);
        doc.setLineWidth(0.2);
        doc.rect(19.8, 92.8, pageWidth - 39.6, 100.4, "D");
        doc.addImage(circuitImg, "PNG", 20, 93, pageWidth - 40, 100);
      }

      doc.setFontSize(8);
      doc.setFont("Helvetica", "italic");
      doc.setTextColor(100, 100, 100);
      doc.text("Astryd Sophia - Reporte Científico Generado Localmente", 20, pageHeight - 12);
      doc.text("Página 1 de 2", pageWidth - 35, pageHeight - 12);

      // PÁGINA 2
      doc.addPage();
      doc.setFillColor(12, 16, 27);
      doc.rect(0, 0, pageWidth, pageHeight, "F");

      doc.setFont("Helvetica", "bold");
      doc.setFontSize(14);
      doc.setTextColor(102, 252, 241);
      doc.text("RESULTADOS DEL OSCILOSCOPIO", 20, 20);

      doc.setDrawColor(59, 130, 246);
      doc.setLineWidth(0.3);
      doc.line(20, 24, pageWidth - 20, 24);

      const oscImg = await this.getCanvasWithBackground("osc-canvas", "#030508");
      if (oscImg) {
        doc.setDrawColor(59, 130, 246);
        doc.setLineWidth(0.2);
        doc.rect(19.8, 29.8, pageWidth - 39.6, 80.4, "D");
        doc.addImage(oscImg, "PNG", 20, 30, pageWidth - 40, 80);
      }

      doc.setFont("Helvetica", "bold");
      doc.setFontSize(12);
      doc.setTextColor(168, 85, 247);
      doc.text("REGISTROS METROLÓGICOS Y EVENTOS", 20, 122);

      const logList = document.querySelectorAll(".log-entry");
      let yPos = 130;
      doc.setFont("Courier", "normal");
      doc.setFontSize(8.5);
      doc.setTextColor(200, 200, 200);

      if (logList.length > 0) {
        const startIdx = Math.max(0, logList.length - 12);
        for (let i = startIdx; i < logList.length; i++) {
          const text = logList[i].textContent ?? "";
          const cleanedText = text.replace(/[\u23EC\u23F3\uD83D\uDCE5\uD83D\uDCCA]/g, "").trim();
          const truncatedText = cleanedText.length > 90 ? cleanedText.substring(0, 87) + "..." : cleanedText;
          
          if (text.toLowerCase().includes("error")) {
            doc.setTextColor(239, 68, 68);
          } else if (text.toLowerCase().includes("exitosamente") || text.toLowerCase().includes("completado")) {
            doc.setTextColor(16, 185, 129);
          } else {
            doc.setTextColor(200, 200, 200);
          }

          doc.text(truncatedText, 22, yPos);
          yPos += 5.5;
        }
      } else {
        doc.setTextColor(130, 130, 130);
        doc.text("No se encontraron registros de eventos metrológicos.", 22, yPos);
      }

      doc.setFontSize(8);
      doc.setFont("Helvetica", "italic");
      doc.setTextColor(100, 100, 100);
      doc.text("Astryd Sophia - Reporte Científico Generado Localmente", 20, pageHeight - 12);
      doc.text("Página 2 de 2", pageWidth - 35, pageHeight - 12);

      doc.save(`reporte_astryd_sophia_${activeAnalysisMode.toLowerCase()}.pdf`);
      this.callbacks.addLog("Reporte científico PDF descargado exitosamente.", "receive");
    } catch (err: unknown) {
      console.error("Error al exportar PDF:", err);
      this.callbacks.addLog(`Error al exportar PDF: ${formatErrorMessage(err)}`, "error");
    }
  }

  public init() {
    const csvBtn = document.querySelector("#export-csv-btn");
    const svgBtn = document.querySelector("#export-svg-btn");
    const s2pBtn = document.querySelector("#export-s2p-btn");
    const h5Btn = document.querySelector("#export-h5-btn");
    const pdfBtn = document.querySelector("#export-pdf-btn");

    if (csvBtn) csvBtn.addEventListener("click", () => this.exportarDatosCSV());
    if (svgBtn) svgBtn.addEventListener("click", () => this.exportarDatosSVG());
    if (s2pBtn) s2pBtn.addEventListener("click", () => this.exportarDatosTouchstone());
    if (h5Btn) h5Btn.addEventListener("click", () => this.exportarDatosHDF5());
    if (pdfBtn) pdfBtn.addEventListener("click", () => this.exportarReportePDF());
  }
}
