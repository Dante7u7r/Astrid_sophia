import { type OscilloscopePanel } from "./oscilloscope_panel";
import { type AnalysisMode } from "./simulation_controls";

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
    let csvContent = "";
    let filename = "reporte_simulacion.csv";

    const oscilloscopePanel = this.callbacks.getOscilloscopePanel();
    const activeAnalysisMode = this.callbacks.getActiveAnalysisMode();
    const probes = this.callbacks.getProbeNodes();

    const acResults = oscilloscopePanel ? oscilloscopePanel.acSweepResults : null;
    const tranResults = oscilloscopePanel ? oscilloscopePanel.transientResults : [];
    const ch1Node = oscilloscopePanel ? oscilloscopePanel.ch1ProbeNode : probes.ch1;
    const ch2Node = oscilloscopePanel ? oscilloscopePanel.ch2ProbeNode : probes.ch2;

    if (activeAnalysisMode === 'AC' && acResults !== null) {
      csvContent = "Frecuencia (Hz),Magnitud Canal 1 (dB),Fase Canal 1 (Grados),Magnitud Canal 2 (dB),Fase Canal 2 (Grados)\n";
      const freqs = acResults.frequencies;
      for (let i = 0; i < freqs.length; i++) {
        const f = freqs[i];
        const db1 = ch1Node ? acResults.nodeAmplitudes[ch1Node]?.[i] ?? 0.0 : 0.0;
        const ph1 = ch1Node ? acResults.nodePhases[ch1Node]?.[i] ?? 0.0 : 0.0;
        const db2 = ch2Node ? acResults.nodeAmplitudes[ch2Node]?.[i] ?? 0.0 : 0.0;
        const ph2 = ch2Node ? acResults.nodePhases[ch2Node]?.[i] ?? 0.0 : 0.0;
        csvContent += `${f.toFixed(2)},${db1.toFixed(4)},${ph1.toFixed(4)},${db2.toFixed(4)},${ph2.toFixed(4)}\n`;
      }
      filename = "reporte_barrido_ca.csv";
    } else if ((activeAnalysisMode === 'TRAN' || activeAnalysisMode === 'PSS') && tranResults.length > 0) {
      csvContent = "Tiempo (s),Voltaje Canal 1 (V),Voltaje Canal 2 (V)\n";
      tranResults.forEach(pt => {
        const v1 = ch1Node ? pt.nodeVoltages[ch1Node] ?? 0.0 : 0.0;
        const v2 = ch2Node ? pt.nodeVoltages[ch2Node] ?? 0.0 : 0.0;
        csvContent += `${pt.time.toFixed(6)},${v1.toFixed(5)},${v2.toFixed(5)}\n`;
      });
      filename = "reporte_transitorio.csv";
    } else {
      csvContent = "Nodo,Voltaje Operacion (V)\n";
      for (const [node, volt] of Object.entries(this.callbacks.getVoltageMap())) {
        csvContent += `${node},${volt.toFixed(5)}\n`;
      }
      filename = "reporte_punto_operacion_cc.csv";
    }

    const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.setAttribute("href", url);
    link.setAttribute("download", filename);
    link.style.visibility = 'hidden';
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    this.callbacks.addLog(`Datos exportados exitosamente a ${filename}`, "receive");
  }

  public exportarDatosSVG(): void {
    let svgContent = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 800 400" style="background:#030508; font-family:sans-serif;">`;
    let filename = "grafico_simulacion.svg";

    svgContent += `<rect width="800" height="400" fill="#030508" />`;
    svgContent += `<text x="400" y="25" fill="hsl(174, 97%, 69%)" font-size="16" font-weight="bold" text-anchor="middle">Astryd Sophia v2.0 Evolution - Reporte Grafico</text>`;

    const oscilloscopePanel = this.callbacks.getOscilloscopePanel();
    const activeAnalysisMode = this.callbacks.getActiveAnalysisMode();
    const probes = this.callbacks.getProbeNodes();

    const acResults = oscilloscopePanel ? oscilloscopePanel.acSweepResults : null;
    const tranResults = oscilloscopePanel ? oscilloscopePanel.transientResults : [];
    const ch1Node = oscilloscopePanel ? oscilloscopePanel.ch1ProbeNode : probes.ch1;
    const ch2Node = oscilloscopePanel ? oscilloscopePanel.ch2ProbeNode : probes.ch2;

    if (activeAnalysisMode === 'AC' && acResults !== null && acResults.frequencies.length > 0) {
      filename = "grafico_barrido_ca.svg";
      const freqs = acResults.frequencies;
      const fMin = freqs[0];
      const fMax = freqs[freqs.length - 1];

      // Dibujar cuadrícula y líneas CA
      svgContent += `<line x1="50" y1="350" x2="750" y2="350" stroke="#1e293b" stroke-width="1.5" />`;
      svgContent += `<line x1="50" y1="50" x2="50" y2="350" stroke="#1e293b" stroke-width="1.5" />`;

      const drawBodePlot = (node: string, color: string, name: string) => {
        const amps = acResults.nodeAmplitudes[node];
        if (!amps) return "";
        let path = "";
        for (let i = 0; i < freqs.length; i++) {
          const ratio = (Math.log10(freqs[i]) - Math.log10(fMin)) / (Math.log10(fMax) - Math.log10(fMin));
          const x = 50 + ratio * 700;
          // Normalizar magnitud a un rango de -60 a 10 dB
          const dbVal = Math.max(-60, Math.min(10, amps[i]));
          const y = 350 - ((dbVal + 60) / 70) * 300;
          path += `${i === 0 ? 'M' : 'L'} ${x.toFixed(1)} ${y.toFixed(1)} `;
        }
        return `<path d="${path}" fill="none" stroke="${color}" stroke-width="2.5" /><text x="60" y="${node === ch1Node ? '70' : '90'}" fill="${color}" font-size="11" font-weight="bold">${name} (${node})</text>`;
      };

      if (ch1Node) svgContent += drawBodePlot(ch1Node, "hsl(174, 97%, 69%)", "Magnitud CH1");
      if (ch2Node) svgContent += drawBodePlot(ch2Node, "hsl(270, 89%, 65%)", "Magnitud CH2");

    } else if ((activeAnalysisMode === 'TRAN' || activeAnalysisMode === 'PSS') && tranResults.length > 0) {
      filename = "grafico_transitorio.svg";
      const tMax = tranResults[tranResults.length - 1].time;

      svgContent += `<line x1="50" y1="350" x2="750" y2="350" stroke="#1e293b" stroke-width="1.5" />`;
      svgContent += `<line x1="50" y1="50" x2="50" y2="350" stroke="#1e293b" stroke-width="1.5" />`;

      const drawTranPlot = (node: string, color: string, name: string) => {
        let path = "";
        let minV = 0.0;
        let maxV = 1.0;
        tranResults.forEach(pt => {
          const v = pt.nodeVoltages[node] ?? 0.0;
          if (v < minV) minV = v;
          if (v > maxV) maxV = v;
        });
        const vDiff = (maxV - minV) || 1.0;

        for (let i = 0; i < tranResults.length; i++) {
          const pt = tranResults[i];
          const x = 50 + (pt.time / tMax) * 700;
          const v = pt.nodeVoltages[node] ?? 0.0;
          const y = 350 - ((v - minV) / vDiff) * 300;
          path += `${i === 0 ? 'M' : 'L'} ${x.toFixed(1)} ${y.toFixed(1)} `;
        }
        return `<path d="${path}" fill="none" stroke="${color}" stroke-width="2.5" /><text x="60" y="${node === ch1Node ? '70' : '90'}" fill="${color}" font-size="11" font-weight="bold">${name} (${node})</text>`;
      };

      if (ch1Node) svgContent += drawTranPlot(ch1Node, "hsl(174, 97%, 69%)", "Voltaje CH1");
      if (ch2Node) svgContent += drawTranPlot(ch2Node, "hsl(270, 89%, 65%)", "Voltaje CH2");
    } else {
      svgContent += `<text x="400" y="200" fill="#64748b" font-size="14" text-anchor="middle">No hay curvas transitorias o de CA para exportar en este modo.</text>`;
    }

    svgContent += `</svg>`;

    const blob = new Blob([svgContent], { type: 'image/svg+xml;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.setAttribute("href", url);
    link.setAttribute("download", filename);
    link.style.visibility = 'hidden';
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    this.callbacks.addLog(`Grafico vectorial exportado exitosamente a ${filename}`, "receive");
  }

  public exportarDatosTouchstone(): void {
    const oscilloscopePanel = this.callbacks.getOscilloscopePanel();
    const activeAnalysisMode = this.callbacks.getActiveAnalysisMode();
    const probes = this.callbacks.getProbeNodes();

    const acResults = oscilloscopePanel ? oscilloscopePanel.acSweepResults : null;
    const ch1Node = oscilloscopePanel ? oscilloscopePanel.ch1ProbeNode : probes.ch1;
    const ch2Node = oscilloscopePanel ? oscilloscopePanel.ch2ProbeNode : probes.ch2;

    if (activeAnalysisMode !== 'AC' || !acResults || acResults.frequencies.length === 0) {
      this.callbacks.addLog("Realiza un análisis de Barrido CA (AC Sweep) antes de exportar datos Touchstone.", "error");
      return;
    }

    let s2pContent = `! Touchstone 2-Port File generated by Astryd Sophia v2.0 Evolution\n`;
    s2pContent += `! Created on: ${new Date().toISOString()}\n`;
    s2pContent += `! Source nodes: Port 1 = Node ${ch1Node ?? 'N/A'}, Port 2 = Node ${ch2Node ?? 'N/A'}\n`;
    s2pContent += `# Hz S DB R 50\n`;

    const freqs = acResults.frequencies;
    for (let i = 0; i < freqs.length; i++) {
      const f = freqs[i];
      const s11_db = ch1Node ? acResults.nodeAmplitudes[ch1Node]?.[i] ?? -80.0 : -80.0;
      const s11_phase = ch1Node ? acResults.nodePhases[ch1Node]?.[i] ?? 0.0 : 0.0;

      const s21_db = ch2Node ? acResults.nodeAmplitudes[ch2Node]?.[i] ?? -80.0 : -80.0;
      const s21_phase = ch2Node ? acResults.nodePhases[ch2Node]?.[i] ?? 0.0 : 0.0;

      const s12_db = -80.0;
      const s12_phase = 0.0;
      const s22_db = -80.0;
      const s22_phase = 0.0;

      s2pContent += `${f.toFixed(4)} ${s11_db.toFixed(6)} ${s11_phase.toFixed(6)} ${s21_db.toFixed(6)} ${s21_phase.toFixed(6)} ${s12_db.toFixed(6)} ${s12_phase.toFixed(6)} ${s22_db.toFixed(6)} ${s22_phase.toFixed(6)}\n`;
    }

    const blob = new Blob([s2pContent], { type: 'text/plain;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.setAttribute("href", url);
    link.setAttribute("download", "reporte_s2p.s2p");
    link.style.visibility = 'hidden';
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
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

    let metadata: any = {
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
      const times = new Float64Array(tranResults.map((r: any) => r.time));
      binaryArrays.push(times);
      metadata.datasets["time"] = { length: times.length, type: "Float64", unit: "s" };

      if (ch1Node) {
        const v1 = new Float64Array(tranResults.map((r: any) => r.nodeVoltages[ch1Node] ?? 0.0));
        binaryArrays.push(v1);
        metadata.datasets[`ch1_voltage`] = { length: v1.length, type: "Float64", unit: "V", node: ch1Node };
      }
      if (ch2Node) {
        const v2 = new Float64Array(tranResults.map((r: any) => r.nodeVoltages[ch2Node] ?? 0.0));
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

    let datasetMetaKeys = Object.keys(metadata.datasets);
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
    
    let totalHeaderSize = 8 + 4 + finalJsonLen;
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

    const blob = new Blob([mainBuffer], { type: 'application/octet-stream' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.setAttribute("href", url);
    link.setAttribute("download", filename);
    link.style.visibility = 'hidden';
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    this.callbacks.addLog(`Datos binarios exportados a formato HDF5 Lite (.h5) en ${filename}`, "receive");
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
    } catch (err: any) {
      console.error("Error al exportar PDF:", err);
      this.callbacks.addLog(`Error al exportar PDF: ${err.message || err}`, "error");
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
