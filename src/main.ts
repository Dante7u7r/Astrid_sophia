import { invoke } from "@tauri-apps/api/core";
import { CanvasOrchestrator, ComponentInstance, Point2D } from "./canvas_orchestrator";

// --- INTERFACE DE CONFIGURACIÓN ---
interface SimulationSettings {
  dt: number;
  tolerance: number;
  maxIterations: number;
}

// Variables Globales del Estado
let simSettings: SimulationSettings = {
  dt: 0.0001,
  tolerance: 0.00001,
  maxIterations: 100
};

let activeAnalysisMode: 'DC' | 'AC' | 'TRAN' = 'DC';
let isSimulating = false;
let animationFrameId: number | null = null;
let oscTime = 0; // Temporizador para el renderizado del osciloscopio

// --- ELEMENTOS DEL DOM ---
let sidebarLeft: HTMLElement | null = null;
let sidebarRight: HTMLElement | null = null;
let btnToggleLeft: HTMLButtonElement | null = null;
let btnToggleRight: HTMLButtonElement | null = null;

let settingsModal: HTMLElement | null = null;
let settingsTriggerBtn: HTMLButtonElement | null = null;
let btnCancelSettings: HTMLButtonElement | null = null;
let btnSaveSettings: HTMLButtonElement | null = null;

let analysisDcBtn: HTMLButtonElement | null = null;
let analysisAcBtn: HTMLButtonElement | null = null;
let analysisTranBtn: HTMLButtonElement | null = null;
let runSimBtn: HTMLButtonElement | null = null;
let stopSimBtn: HTMLButtonElement | null = null;

let propValInput: HTMLInputElement | null = null;
let propValSlider: HTMLInputElement | null = null;
let propValInc: HTMLButtonElement | null = null;
let propValDec: HTMLButtonElement | null = null;
let btnApplyProperties: HTMLButtonElement | null = null;
let propIdInput: HTMLInputElement | null = null;
let propUnitInput: HTMLInputElement | null = null;

let consoleOutput: HTMLElement | null = null;
let clearConsoleBtn: HTMLButtonElement | null = null;
let ipcStatusDot: HTMLElement | null = null;
let ipcStatusText: HTMLElement | null = null;
let telemetryRamText: HTMLElement | null = null;
let telemetryCpuText: HTMLElement | null = null;

let oscCanvas: HTMLCanvasElement | null = null;
let oscCtx: CanvasRenderingContext2D | null = null;
let oscCh1Btn: HTMLButtonElement | null = null;
let oscCh2Btn: HTMLButtonElement | null = null;
let oscPauseBtn: HTMLButtonElement | null = null;
let isOscPaused = false;

// Instancia global del Canvas Orchestrator
let orchestrator: CanvasOrchestrator | null = null;

// Mapa global de voltajes resueltos para visualización
let liveVoltages: Record<string, number> = {};

// Mapa de correspondencia entre cada terminal física y su nodo eléctrico resuelto
let pinToNodeMap: Record<string, string> = {};

// --- ESTADOS DE SONDAS E INSTRUMENTACIÓN DEL OSCILOSCOPIO ---
let probePlacementMode: 'CH1' | 'CH2' | null = null;
let ch1ProbeNode: string | null = "1"; // Canal 1 por defecto al Nodo 1
let ch2ProbeNode: string | null = "2"; // Canal 2 por defecto al Nodo 2

// Resultados de la Simulación Transitoria
interface TimeStepResult {
  time: f64;
  nodeVoltages: Record<string, number>;
  branchCurrents: Record<string, number>;
}
type f64 = number;

let transientResults: TimeStepResult[] = [];
let sweepTime = 0.0;
const transientDuration = 0.05; // 50 ms total de simulación

interface AcSweepResult {
  frequencies: number[];
  nodeAmplitudes: Record<string, number[]>;
  nodePhases: Record<string, number[]>;
  errorLog?: string;
}

let acSweepResults: AcSweepResult | null = null;
let oscMouseX: number | null = null;
// let oscMouseY: number | null = null;

function updateCanvasRendering() {
  const pinVoltageMap: Record<string, number> = {};
  for (const [pinKey, nodeId] of Object.entries(pinToNodeMap)) {
    if (liveVoltages[nodeId] !== undefined) {
      pinVoltageMap[pinKey] = liveVoltages[nodeId];
    }
  }

  // Encontrar coordenadas absolutas lógicas de los terminales asociados a las sondas
  let ch1PinPos: Point2D | undefined;
  let ch2PinPos: Point2D | undefined;

  if (orchestrator) {
    for (const comp of orchestrator.components) {
      const pins = orchestrator.getComponentPins(comp);
      for (const pin of pins) {
        const pinKey = `${comp.id}:${pin.pinIndex}`;
        const nodeId = pinToNodeMap[pinKey];
        if (nodeId === ch1ProbeNode && !ch1PinPos) {
          ch1PinPos = { x: pin.x, y: pin.y };
        }
        if (nodeId === ch2ProbeNode && !ch2PinPos) {
          ch2PinPos = { x: pin.x, y: pin.y };
        }
      }
    }
    orchestrator.render(pinVoltageMap, { ch1: ch1PinPos, ch2: ch2PinPos });
  }
}

// --- FUNCIONES AUXILIARES ---

function getTimestamp(): string {
  const now = new Date();
  const pad = (n: number) => n.toString().padStart(2, '0');
  return `${pad(now.getHours())}:${pad(now.getMinutes())}:${pad(now.getSeconds())}.${now.getMilliseconds().toString().padStart(3, '0')}`;
}

function addLog(text: string, type: 'system' | 'send' | 'receive' | 'error' = 'system') {
  if (!consoleOutput) return;
  const line = document.createElement('div');
  line.className = `log-line ${type}`;
  line.textContent = `[${getTimestamp()}] ${text}`;
  consoleOutput.appendChild(line);
  consoleOutput.scrollTop = consoleOutput.scrollHeight;
}

// --- SIMULADOR EN TIEMPO REAL DEL OSCILOSCOPIO (CANVAS 2) ---
function drawOscilloscope() {
  if (!oscCanvas || !oscCtx) return;

  const width = oscCanvas.clientWidth;
  const height = oscCanvas.clientHeight;
  
  if (oscCanvas.width !== width || oscCanvas.height !== height) {
    oscCanvas.width = width;
    oscCanvas.height = height;
  }

  // Limpiar con fósforo oscuro (efecto de desvanecimiento gradual para persistencia analógica si es animado)
  if (isSimulating && activeAnalysisMode !== 'AC') {
    oscCtx.fillStyle = 'rgba(3, 5, 8, 0.16)';
    oscCtx.fillRect(0, 0, width, height);
  } else {
    oscCtx.fillStyle = '#030508';
    oscCtx.fillRect(0, 0, width, height);
  }

  // --- MODO AC SWEEP: DIAGRAMA DE BODE LOGARÍTMICO ---
  if (activeAnalysisMode === 'AC' && acSweepResults !== null && acSweepResults.frequencies.length > 0) {
    const ctx = oscCtx!;
    const freqs = acSweepResults.frequencies;
    const fMin = freqs[0];
    const fMax = freqs[freqs.length - 1];
    const logMin = Math.log10(fMin);
    const logMax = Math.log10(fMax);

    // Rejilla logarítmica (Décadas)
    ctx.strokeStyle = 'rgba(102, 252, 241, 0.08)';
    ctx.lineWidth = 1;
    
    const decades = [10, 100, 1000, 10000, 100000];
    decades.forEach(dec => {
      if (dec >= fMin && dec <= fMax) {
        const x = ((Math.log10(dec) - logMin) / (logMax - logMin)) * width;
        ctx.beginPath();
        ctx.moveTo(x, 0);
        ctx.lineTo(x, height - 15);
        ctx.stroke();
        
        // Escribir década de frecuencia
        ctx.fillStyle = 'rgba(102, 252, 241, 0.4)';
        ctx.font = '9px var(--font-sans)';
        ctx.textAlign = 'center';
        let label = dec >= 1000 ? (dec / 1000) + " kHz" : dec + " Hz";
        ctx.fillText(label, x, height - 4);
      }
    });

    // Subdivisiones logarítmicas tenues
    ctx.strokeStyle = 'rgba(102, 252, 241, 0.015)';
    for (let dec = 10; dec <= 10000; dec *= 10) {
      for (let mul = 2; mul <= 9; mul++) {
        const val = dec * mul;
        if (val >= fMin && val <= fMax) {
          const x = ((Math.log10(val) - logMin) / (logMax - logMin)) * width;
          ctx.beginPath();
          ctx.moveTo(x, 0);
          ctx.lineTo(x, height - 15);
          ctx.stroke();
        }
      }
    }

    // Líneas horizontales de referencia en dB
    ctx.strokeStyle = 'rgba(255, 255, 255, 0.03)';
    for (let i = 1; i < 5; i++) {
      const y = (height - 15) * (i / 5);
      ctx.beginPath();
      ctx.moveTo(0, y);
      ctx.lineTo(width, y);
      ctx.stroke();
    }

    // Dibujar Curva de Amplitud (dB)
    const drawBodeAmplitude = (nodeId: string, color: string, isCh1: boolean) => {
      const amps = acSweepResults!.nodeAmplitudes[nodeId];
      if (!amps || amps.length === 0) return;

      ctx.strokeStyle = color;
      ctx.lineWidth = isCh1 ? 2.5 : 1.8;
      ctx.shadowColor = color;
      ctx.shadowBlur = isCh1 ? 6 : 3;
      ctx.beginPath();

      for (let i = 0; i < freqs.length; i++) {
        const x = ((Math.log10(freqs[i]) - logMin) / (logMax - logMin)) * width;
        const db = amps[i];
        const y = (height - 15) * (1.0 - (db - (-80)) / (20 - (-80)));

        if (i === 0) ctx.moveTo(x, y);
        else ctx.lineTo(x, y);
      }
      ctx.stroke();
      ctx.shadowBlur = 0;
    };

    // Dibujar Curva de Fase (Grados)
    const drawBodePhase = (nodeId: string, color: string) => {
      const phases = acSweepResults!.nodePhases[nodeId];
      if (!phases || phases.length === 0) return;

      ctx.strokeStyle = color;
      ctx.lineWidth = 1.8;
      ctx.setLineDash([4, 4]);
      ctx.shadowColor = color;
      ctx.shadowBlur = 4;
      ctx.beginPath();

      for (let i = 0; i < freqs.length; i++) {
        const x = ((Math.log10(freqs[i]) - logMin) / (logMax - logMin)) * width;
        const deg = phases[i];
        const y = (height - 15) * (1.0 - (deg - (-180)) / (180 - (-180)));

        if (i === 0) ctx.moveTo(x, y);
        else ctx.lineTo(x, y);
      }
      ctx.stroke();
      ctx.setLineDash([]);
      ctx.shadowBlur = 0;
    };

    if (oscCh1Btn && oscCh1Btn.classList.contains('active') && ch1ProbeNode !== null) {
      drawBodeAmplitude(ch1ProbeNode, '#66fcf1', true);
      drawBodePhase(ch1ProbeNode, 'rgba(102, 252, 241, 0.4)');
    }
    if (oscCh2Btn && oscCh2Btn.classList.contains('active') && ch2ProbeNode !== null) {
      drawBodeAmplitude(ch2ProbeNode, '#a855f7', false);
      drawBodePhase(ch2ProbeNode, 'rgba(168, 85, 247, 0.45)');
    }

    // Escribir marcas de ejes Y
    ctx.fillStyle = 'rgba(255, 255, 255, 0.4)';
    ctx.font = '8px var(--font-mono)';
    ctx.textAlign = 'left';
    ctx.fillText("+20 dB", 5, 12);
    ctx.fillText("-80 dB", 5, height - 20);

    ctx.textAlign = 'right';
    ctx.fillText("+180°", width - 5, 12);
    ctx.fillText("-180°", width - 5, height - 20);

    // CURSOR INTERACTIVO EN HOVER (BODE SWEEP INFO TOOLTIP)
    if (oscMouseX !== null && oscMouseX >= 0 && oscMouseX <= width) {
      const pct = oscMouseX / width;
      const logVal = logMin + pct * (logMax - logMin);
      const fVal = Math.pow(10, logVal);

      let closestIdx = 0;
      let minDiff = Infinity;
      for (let i = 0; i < freqs.length; i++) {
        const diff = Math.abs(freqs[i] - fVal);
        if (diff < minDiff) {
          minDiff = diff;
          closestIdx = i;
        }
      }

      const exactFreq = freqs[closestIdx];

      ctx.strokeStyle = 'rgba(102, 252, 241, 0.35)';
      ctx.lineWidth = 1;
      ctx.setLineDash([3, 3]);
      ctx.beginPath();
      ctx.moveTo(oscMouseX, 0);
      ctx.lineTo(oscMouseX, height - 15);
      ctx.stroke();
      ctx.setLineDash([]);

      ctx.fillStyle = 'rgba(10, 15, 25, 0.9)';
      ctx.strokeStyle = 'rgba(102, 252, 241, 0.5)';
      ctx.lineWidth = 1;
      
      let tooltipText = `Frecuencia: ${exactFreq.toFixed(1)} Hz`;
      if (ch1ProbeNode !== null && oscCh1Btn?.classList.contains('active')) {
        const db1 = acSweepResults.nodeAmplitudes[ch1ProbeNode][closestIdx];
        const ph1 = acSweepResults.nodePhases[ch1ProbeNode][closestIdx];
        tooltipText += ` | Canal 1: ${db1.toFixed(1)} dB, ${ph1.toFixed(1)}°`;
      }
      if (ch2ProbeNode !== null && oscCh2Btn?.classList.contains('active')) {
        const db2 = acSweepResults.nodeAmplitudes[ch2ProbeNode][closestIdx];
        const ph2 = acSweepResults.nodePhases[ch2ProbeNode][closestIdx];
        tooltipText += ` | Canal 2: ${db2.toFixed(1)} dB, ${ph2.toFixed(1)}°`;
      }

      ctx.font = 'bold 9px var(--font-sans)';
      const tWidth = ctx.measureText(tooltipText).width;
      
      const rectX = Math.min(Math.max(oscMouseX - tWidth / 2 - 8, 4), width - tWidth - 16);
      ctx.beginPath();
      ctx.roundRect(rectX, 15, tWidth + 16, 18, 4);
      ctx.fill();
      ctx.stroke();

      ctx.fillStyle = 'hsl(174, 97%, 69%)';
      ctx.textAlign = 'left';
      ctx.fillText(tooltipText, rectX + 8, 27);
    }

  } else {
    // Rejilla de fósforo estándar (Modos TRAN o Senoidales genéricas)
    oscCtx.strokeStyle = 'rgba(102, 252, 241, 0.05)';
    oscCtx.lineWidth = 1;
    
    const gridSize = 30;
    for (let x = 0; x < width; x += gridSize) {
      oscCtx.beginPath();
      oscCtx.moveTo(x, 0);
      oscCtx.lineTo(x, height);
      oscCtx.stroke();
    }
    for (let y = 0; y < height; y += gridSize) {
      oscCtx.beginPath();
      oscCtx.moveTo(0, y);
      oscCtx.lineTo(width, y);
      oscCtx.stroke();
    }

    // Ejes centrales
    oscCtx.strokeStyle = 'rgba(102, 252, 241, 0.15)';
    oscCtx.lineWidth = 1.5;
    oscCtx.beginPath();
    oscCtx.moveTo(0, height / 2);
    oscCtx.lineTo(width, height / 2);
    oscCtx.stroke();

    oscCtx.beginPath();
    oscCtx.moveTo(width / 2, 0);
    oscCtx.lineTo(width / 2, height);
    oscCtx.stroke();

    // --- MODO TRANSIENT: GRAFICAR ONDAS FÍSICAS REALES SIMULADAS ---
    if (activeAnalysisMode === 'TRAN' && transientResults.length > 0) {
      if (isSimulating && !isOscPaused) {
        sweepTime += (transientDuration / 100);
        if (sweepTime > transientDuration) {
          sweepTime = 0.0;
        }
      }

      const scaleY = height * 0.08; 
      const centerY = height / 2;

      // CH 1 (Cian Eléctrico)
      if (oscCh1Btn && oscCh1Btn.classList.contains('active') && ch1ProbeNode !== null) {
        oscCtx.strokeStyle = '#66fcf1';
        oscCtx.lineWidth = 2.5;
        oscCtx.shadowColor = '#66fcf1';
        oscCtx.shadowBlur = 6;
        oscCtx.beginPath();

        let isFirst = true;
        for (const pt of transientResults) {
          if (pt.time > sweepTime) break;

          const x = (pt.time / transientDuration) * width;
          const v = pt.nodeVoltages[ch1ProbeNode] || 0.0;
          const y = centerY - v * scaleY;

          if (isFirst) {
            oscCtx.moveTo(x, y);
            isFirst = false;
          } else {
            oscCtx.lineTo(x, y);
          }
        }
        oscCtx.stroke();
        oscCtx.shadowBlur = 0;

        const activePt = transientResults.find(p => p.time >= sweepTime) || transientResults[transientResults.length - 1];
        if (activePt) {
          const x = (activePt.time / transientDuration) * width;
          const v = activePt.nodeVoltages[ch1ProbeNode] || 0.0;
          const y = centerY - v * scaleY;
          oscCtx.fillStyle = '#66fcf1';
          oscCtx.beginPath();
          oscCtx.arc(x, y, 4, 0, Math.PI * 2);
          oscCtx.fill();
        }
      }

      // CH 2 (Morado/Violeta)
      if (oscCh2Btn && oscCh2Btn.classList.contains('active') && ch2ProbeNode !== null) {
        oscCtx.strokeStyle = '#a855f7';
        oscCtx.lineWidth = 2.0;
        oscCtx.shadowColor = '#a855f7';
        oscCtx.shadowBlur = 4;
        oscCtx.beginPath();

        let isFirst = true;
        for (const pt of transientResults) {
          if (pt.time > sweepTime) break;

          const x = (pt.time / transientDuration) * width;
          const v = pt.nodeVoltages[ch2ProbeNode] || 0.0;
          const y = centerY - v * scaleY;

          if (isFirst) {
            oscCtx.moveTo(x, y);
            isFirst = false;
          } else {
            oscCtx.lineTo(x, y);
          }
        }
        oscCtx.stroke();
        oscCtx.shadowBlur = 0;

        const activePt = transientResults.find(p => p.time >= sweepTime) || transientResults[transientResults.length - 1];
        if (activePt) {
          const x = (activePt.time / transientDuration) * width;
          const v = activePt.nodeVoltages[ch2ProbeNode] || 0.0;
          const y = centerY - v * scaleY;
          oscCtx.fillStyle = '#a855f7';
          oscCtx.beginPath();
          oscCtx.arc(x, y, 3, 0, Math.PI * 2);
          oscCtx.fill();
        }
      }

    } else {
      // --- SEÑALES SENOIDALES SIMULADAS ---
      if (isSimulating && !isOscPaused) {
        oscTime += 0.05;
      }

      // CH 1 (Cian)
      if (oscCh1Btn && oscCh1Btn.classList.contains('active')) {
        oscCtx.strokeStyle = '#66fcf1';
        oscCtx.lineWidth = 2.5;
        oscCtx.shadowColor = '#66fcf1';
        oscCtx.shadowBlur = 6;
        oscCtx.beginPath();

        const node1Volt = liveVoltages['1'] || 0.0;
        const ampl = 15 + Math.min(Math.abs(node1Volt) * 12, height * 0.35);

        for (let x = 0; x < width; x++) {
          const angle = (x / width) * Math.PI * 4 + oscTime;
          const y = (height / 2) + Math.sin(angle) * ampl;
          
          if (x === 0) oscCtx.moveTo(x, y);
          else oscCtx.lineTo(x, y);
        }
        oscCtx.stroke();
        oscCtx.shadowBlur = 0;
      }

      // CH 2 (Morado)
      if (oscCh2Btn && oscCh2Btn.classList.contains('active')) {
        oscCtx.strokeStyle = '#a855f7';
        oscCtx.lineWidth = 2;
        oscCtx.shadowColor = '#a855f7';
        oscCtx.shadowBlur = 4;
        oscCtx.beginPath();

        const node2Volt = liveVoltages['2'] || 0.0;
        const ampl2 = 10 + Math.min(Math.abs(node2Volt) * 10, height * 0.25);

        for (let x = 0; x < width; x++) {
          const t = (x / width) * 8 + oscTime * 1.5;
          const wave = (t % 1) * 2 - 1; 
          const noise = (Math.sin(x * 0.25) * 0.08);
          const y = (height / 2) + (wave + noise) * ampl2;
          
          if (x === 0) oscCtx.moveTo(x, y);
          else oscCtx.lineTo(x, y);
        }
        oscCtx.stroke();
        oscCtx.shadowBlur = 0;
      }
    }
  }

  if (isSimulating) {
    animationFrameId = requestAnimationFrame(drawOscilloscope);
  }
}

function startOscilloscopeLoop() {
  if (animationFrameId) cancelAnimationFrame(animationFrameId);
  isSimulating = true;
  drawOscilloscope();
}

function stopOscilloscopeLoop() {
  isSimulating = false;
  if (animationFrameId) {
    cancelAnimationFrame(animationFrameId);
    animationFrameId = null;
  }
  drawOscilloscope();
}

// --- INTERACCIONES DE INTERFAZ (SIDEBARS & MODALES) ---

function initSidebars() {
  sidebarLeft = document.querySelector("#sidebar-left");
  sidebarRight = document.querySelector("#sidebar-right");
  btnToggleLeft = document.querySelector("#btn-toggle-left");
  btnToggleRight = document.querySelector("#btn-toggle-right");

  if (btnToggleLeft && sidebarLeft) {
    btnToggleLeft.addEventListener("click", () => {
      sidebarLeft?.classList.toggle("collapsed");
      const isCollapsed = sidebarLeft?.classList.contains("collapsed");
      btnToggleLeft!.textContent = isCollapsed ? "Componentes ▶" : "◀ Colapsar";
    });
  }

  if (btnToggleRight && sidebarRight) {
    btnToggleRight.addEventListener("click", () => {
      sidebarRight?.classList.toggle("collapsed");
      const isCollapsed = sidebarRight?.classList.contains("collapsed");
      btnToggleRight!.textContent = isCollapsed ? "◀ Propiedades" : "Expandir ▶";
    });
  }
}

function initModals() {
  settingsModal = document.querySelector("#settings-modal");
  settingsTriggerBtn = document.querySelector("#settings-trigger-btn");
  btnCancelSettings = document.querySelector("#btn-cancel-settings");
  btnSaveSettings = document.querySelector("#btn-save-settings");

  const dtInput = document.querySelector("#settings-dt-input") as HTMLInputElement;
  const tolInput = document.querySelector("#settings-tol-input") as HTMLInputElement;
  const iterInput = document.querySelector("#settings-iter-input") as HTMLInputElement;

  if (settingsTriggerBtn && settingsModal) {
    settingsTriggerBtn.addEventListener("click", () => {
      if (dtInput) dtInput.value = simSettings.dt.toString();
      if (tolInput) tolInput.value = simSettings.tolerance.toString();
      if (iterInput) iterInput.value = simSettings.maxIterations.toString();
      settingsModal?.classList.add("open");
    });
  }

  if (btnCancelSettings && settingsModal) {
    btnCancelSettings.addEventListener("click", () => {
      settingsModal?.classList.remove("open");
    });
  }

  if (btnSaveSettings && settingsModal) {
    btnSaveSettings.addEventListener("click", () => {
      if (dtInput && tolInput && iterInput) {
        simSettings.dt = parseFloat(dtInput.value) || 0.0001;
        simSettings.tolerance = parseFloat(tolInput.value) || 0.00001;
        simSettings.maxIterations = parseInt(iterInput.value) || 100;
        addLog(`Ajustes guardados: dt=${simSettings.dt}, tol=${simSettings.tolerance}, iterMax=${simSettings.maxIterations}`, "system");
      }
      settingsModal?.classList.remove("open");
    });
  }
}

// --- ACTUALIZACIÓN DE PROPIEDADES EN EL PANEL DERECHO ---

function updatePropertiesPanel(comp: ComponentInstance) {
  if (!propIdInput || !propValInput || !propValSlider || !propUnitInput) return;

  propIdInput.value = comp.id;
  propValInput.value = comp.value.toString();
  propValSlider.value = comp.value.toString();

  const waveContainer = document.querySelector("#wave-properties-container") as HTMLElement;
  const waveTypeSelect = document.querySelector("#prop-wave-type") as HTMLSelectElement;
  const waveAmpInput = document.querySelector("#prop-wave-amp") as HTMLInputElement;
  const waveFreqInput = document.querySelector("#prop-wave-freq") as HTMLInputElement;
  const waveOffsetInput = document.querySelector("#prop-wave-offset") as HTMLInputElement;
  const waveDutyInput = document.querySelector("#prop-wave-duty") as HTMLInputElement;

  if (waveContainer && waveTypeSelect && waveAmpInput && waveFreqInput && waveOffsetInput && waveDutyInput) {
    if (comp.type === 'vsource') {
      waveContainer.style.display = "flex";
      waveTypeSelect.value = comp.waveType || "dc";
      waveAmpInput.value = (comp.amplitude ?? 5).toString();
      waveFreqInput.value = (comp.frequency ?? 1000).toString();
      waveOffsetInput.value = (comp.offset ?? 0).toString();
      waveDutyInput.value = (comp.dutyCycle ?? 0.5).toString();
      
      toggleWaveFieldsVisibility(waveTypeSelect.value);
    } else {
      waveContainer.style.display = "none";
    }
  }

  switch (comp.type) {
    case 'resistor':
      propUnitInput.value = "Ohmios (Ω)";
      propValSlider.min = "1";
      propValSlider.max = "10000";
      break;
    case 'capacitor':
      propUnitInput.value = "Faradios (F)";
      propValSlider.min = "0.000000001";
      propValSlider.max = "0.001";
      break;
    case 'inductor':
      propUnitInput.value = "Henrios (H)";
      propValSlider.min = "0.000001";
      propValSlider.max = "1";
      break;
    case 'diode':
      propUnitInput.value = "Unidad Exponencial";
      propValSlider.min = "0";
      propValSlider.max = "100";
      break;
    case 'vsource':
      propUnitInput.value = "Voltios (V) [Offset / CC]";
      propValSlider.min = "-120";
      propValSlider.max = "120";
      break;
    case 'ground':
      propUnitInput.value = "Referencia (0V)";
      propValSlider.min = "0";
      propValSlider.max = "0";
      break;
    case 'nmos':
      propUnitInput.value = "Tensión de Umbral Vth (V)";
      propValSlider.min = "0.1";
      propValSlider.max = "5";
      break;
    case 'pmos':
      propUnitInput.value = "Tensión de Umbral Vth_p (V) [Negativo]";
      propValSlider.min = "-5";
      propValSlider.max = "-0.1";
      break;
    case 'npn':
      propUnitInput.value = "Ganancia de Corriente Beta (βf)";
      propValSlider.min = "10";
      propValSlider.max = "500";
      break;
    case 'pnp':
      propUnitInput.value = "Ganancia de Corriente Beta (βf)";
      propValSlider.min = "10";
      propValSlider.max = "500";
      break;
    case 'opamp':
      propUnitInput.value = "Amplificador Operacional Activo";
      propValSlider.min = "0";
      propValSlider.max = "0";
      break;
  }
}

function toggleWaveFieldsVisibility(waveType: string) {
  const gAmp = document.querySelector("#group-wave-amp") as HTMLElement;
  const gFreq = document.querySelector("#group-wave-freq") as HTMLElement;
  const gOffset = document.querySelector("#group-wave-offset") as HTMLElement;
  const gDuty = document.querySelector("#group-wave-duty") as HTMLElement;

  if (gAmp && gFreq && gOffset && gDuty) {
    if (waveType === 'dc') {
      gAmp.style.display = "none";
      gFreq.style.display = "none";
      gOffset.style.display = "none";
      gDuty.style.display = "none";
    } else if (waveType === 'sine') {
      gAmp.style.display = "flex";
      gFreq.style.display = "flex";
      gOffset.style.display = "flex";
      gDuty.style.display = "none";
    } else if (waveType === 'square' || waveType === 'pulse') {
      gAmp.style.display = "flex";
      gFreq.style.display = "flex";
      gOffset.style.display = "flex";
      gDuty.style.display = "flex";
    }
  }
}

function initPropertyEditor() {
  propValInput = document.querySelector("#prop-val-input");
  propValSlider = document.querySelector("#prop-val-slider");
  propValInc = document.querySelector("#prop-val-inc");
  propValDec = document.querySelector("#prop-val-dec");
  btnApplyProperties = document.querySelector("#btn-apply-properties");
  propIdInput = document.querySelector("#prop-id-input");
  propUnitInput = document.querySelector("#prop-unit-input");

  const waveTypeSelect = document.querySelector("#prop-wave-type") as HTMLSelectElement;
  if (waveTypeSelect) {
    waveTypeSelect.addEventListener("change", () => {
      toggleWaveFieldsVisibility(waveTypeSelect.value);
    });
  }

  if (propValInput && propValSlider) {
    propValSlider.addEventListener("input", (e) => {
      const val = (e.target as HTMLInputElement).value;
      if (propValInput) propValInput.value = val;
    });

    propValInput.addEventListener("input", (e) => {
      const val = (e.target as HTMLInputElement).value;
      if (propValSlider) propValSlider.value = val;
    });
  }

  if (propValInc && propValInput && propValSlider) {
    propValInc.addEventListener("click", () => {
      if (!orchestrator?.selectedComponent) return;
      let val = parseFloat(propValInput!.value) || 0;
      const step = orchestrator.selectedComponent.type === 'capacitor' ? 1e-7 : 10;
      val += step;
      propValInput!.value = val.toString();
      propValSlider!.value = val.toString();
    });
  }

  if (propValDec && propValInput && propValSlider) {
    propValDec.addEventListener("click", () => {
      if (!orchestrator?.selectedComponent) return;
      let val = parseFloat(propValInput!.value) || 0;
      const step = orchestrator.selectedComponent.type === 'capacitor' ? 1e-7 : 10;
      val = Math.max(val - step, 0);
      propValInput!.value = val.toString();
      propValSlider!.value = val.toString();
    });
  }

  if (btnApplyProperties && propIdInput && propValInput && orchestrator) {
    btnApplyProperties.addEventListener("click", () => {
      const selected = orchestrator!.selectedComponent;
      if (selected) {
        const oldId = selected.id;
        const newId = propIdInput!.value.trim();
        const newVal = parseFloat(propValInput!.value) || 0;

        // Validar ID
        if (newId.length > 0 && newId !== oldId) {
          // Verificar duplicados
          const duplicate = orchestrator!.components.some(c => c.id === newId);
          if (!duplicate) {
            selected.id = newId;
          } else {
            addLog(`Error: El identificador [${newId}] ya existe en el circuito.`, "error");
          }
        }

        selected.value = newVal;

        // Si es una fuente de tensión, guardar los parámetros dinámicos de onda
        if (selected.type === 'vsource') {
          const waveTypeSelect = document.querySelector("#prop-wave-type") as HTMLSelectElement;
          const waveAmpInput = document.querySelector("#prop-wave-amp") as HTMLInputElement;
          const waveFreqInput = document.querySelector("#prop-wave-freq") as HTMLInputElement;
          const waveOffsetInput = document.querySelector("#prop-wave-offset") as HTMLInputElement;
          const waveDutyInput = document.querySelector("#prop-wave-duty") as HTMLInputElement;

          if (waveTypeSelect && waveAmpInput && waveFreqInput && waveOffsetInput && waveDutyInput) {
            selected.waveType = waveTypeSelect.value;
            selected.amplitude = parseFloat(waveAmpInput.value) || 0;
            selected.frequency = parseFloat(waveFreqInput.value) || 1000;
            selected.offset = parseFloat(waveOffsetInput.value) || 0;
            selected.dutyCycle = parseFloat(waveDutyInput.value) || 0.5;

            // Sincronizar el valor principal con el offset de CC
            selected.value = selected.offset;
            propValInput!.value = selected.value.toString();
            propValSlider!.value = selected.value.toString();
          }
        }

        updateCanvasRendering();
        addLog(`Propiedades aplicadas a [${selected.id}]: Valor = [${newVal}]`, "system");
      }
    });
  }
}

// --- ALGORITMO DE EXTRACCIÓN DE NODOS ELÉCTRICOS (DSU / DISJOINT SETS) ---

interface ExtractedComponent {
  id: string;
  type: string;
  value: number;
  pins: string[]; // IDs de nodos eléctricos asignados a cada pin
  waveType?: string;
  amplitude?: number;
  frequency?: number;
  offset?: number;
  dutyCycle?: number;
}

interface CircuitNetlist {
  components: ExtractedComponent[];
  wires: { id: string; nodes: string[] }[];
}

class DisjointSetUnion {
  private parent: Record<string, string> = {};

  find(i: string): string {
    if (!this.parent[i]) {
      this.parent[i] = i;
      return i;
    }
    if (this.parent[i] === i) {
      return i;
    }
    const root = this.find(this.parent[i]);
    this.parent[i] = root; // Path compression
    return root;
  }

  union(i: string, j: string): void {
    const rootI = this.find(i);
    const rootJ = this.find(j);
    if (rootI !== rootJ) {
      this.parent[rootI] = rootJ;
    }
  }
}

function extractElectricalNetlist(): CircuitNetlist | null {
  if (!orchestrator) return null;

  const dsu = new DisjointSetUnion();

  // 1. Declarar cada pin de cada componente en el DSU
  const allPinKeys: string[] = [];
  const compPinMapping: Record<string, string[]> = {};

  for (const comp of orchestrator.components) {
    const pins = orchestrator.getComponentPins(comp);
    compPinMapping[comp.id] = [];
    for (const pin of pins) {
      const pinKey = `${comp.id}:${pin.pinIndex}`;
      allPinKeys.push(pinKey);
      compPinMapping[comp.id].push(pinKey);
    }
  }

  // 2. Unir los pins que están conectados por cables (wires)
  for (const wire of orchestrator.wires) {
    const keyFrom = `${wire.from.componentId}:${wire.from.pinIndex}`;
    const keyTo = `${wire.to.componentId}:${wire.to.pinIndex}`;
    dsu.union(keyFrom, keyTo);
  }

  // 3. Identificar el grupo de Tierra (GND) y asignarle el ID de nodo "0"
  let gndRoot: string | null = null;
  for (const comp of orchestrator.components) {
    if (comp.type === 'ground') {
      const gndPinKey = `${comp.id}:0`;
      gndRoot = dsu.find(gndPinKey);
      break;
    }
  }

  // 4. Mapear cada raíz de grupo a un índice de nodo eléctrico único
  const rootToNodeIdMap: Record<string, string> = {};
  let nextNodeId = 1;

  if (gndRoot) {
    rootToNodeIdMap[gndRoot] = "0"; // Tierra siempre es 0
  }

  const extractedComponents: ExtractedComponent[] = [];

  for (const comp of orchestrator.components) {
    const pinsMapped: string[] = [];
    const pinsKeys = compPinMapping[comp.id] || [];

    for (const pk of pinsKeys) {
      const root = dsu.find(pk);
      if (!rootToNodeIdMap[root]) {
        rootToNodeIdMap[root] = nextNodeId.toString();
        nextNodeId++;
      }
      pinsMapped.push(rootToNodeIdMap[root]);
    }

    extractedComponents.push({
      id: comp.id,
      type: comp.type,
      value: comp.value,
      pins: pinsMapped,
      waveType: comp.waveType,
      amplitude: comp.amplitude,
      frequency: comp.frequency,
      offset: comp.offset,
      dutyCycle: comp.dutyCycle,
    });
  }

  // Mapear wires
  const extractedWires = orchestrator.wires.map(w => {
    const fromKey = `${w.from.componentId}:${w.from.pinIndex}`;
    const toKey = `${w.to.componentId}:${w.to.pinIndex}`;
    const nodeFrom = rootToNodeIdMap[dsu.find(fromKey)] || "0";
    const nodeTo = rootToNodeIdMap[dsu.find(toKey)] || "0";
    return {
      id: w.id,
      nodes: [nodeFrom, nodeTo],
    };
  });

  // Poblar mapa de terminales a nodos eléctricos para hover interactivo y colocación de sondas
  pinToNodeMap = {};
  for (const comp of orchestrator.components) {
    const pinsKeys = compPinMapping[comp.id] || [];
    for (const pk of pinsKeys) {
      const root = dsu.find(pk);
      const nodeId = rootToNodeIdMap[root] || "0";
      pinToNodeMap[pk] = nodeId;
    }
  }

  return {
    components: extractedComponents,
    wires: extractedWires,
  };
}

// --- SOLVER DE BACKUP EN TYPESCRIPT PARA ENTORNO DE NAVEGADOR ---

interface TSResult {
  nodeVoltages: Record<string, number>;
  branchCurrents: Record<string, number>;
  convergenceIterations: number;
}

function solveCircuitTS(netlist: CircuitNetlist): TSResult | string {
  let maxNodeIdx = 0;
  for (const comp of netlist.components) {
    for (const pinNode of comp.pins) {
      const idx = parseInt(pinNode);
      if (idx > maxNodeIdx) maxNodeIdx = idx;
    }
  }

  const n = maxNodeIdx;
  const vSources = netlist.components.filter(c => c.type === 'vsource');
  const m = vSources.length;

  const size = n + m;
  if (size === 0) return "El circuito no tiene nodos activos o componentes.";

  const A: number[][] = Array(size).fill(0).map(() => Array(size).fill(0));
  const Z: number[] = Array(size).fill(0);

  const stampConductance = (nodeA: number, nodeB: number, G: number) => {
    if (nodeA > 0) A[nodeA - 1][nodeA - 1] += G;
    if (nodeB > 0) A[nodeB - 1][nodeB - 1] += G;
    if (nodeA > 0 && nodeB > 0) {
      A[nodeA - 1][nodeB - 1] -= G;
      A[nodeB - 1][nodeA - 1] -= G;
    }
  };

  const stampVoltageSource = (vsourceIdx: number, nodePos: number, nodeNeg: number, V: number) => {
    const col = n + vsourceIdx;
    if (nodePos > 0) {
      A[nodePos - 1][col] += 1.0;
      A[col][nodePos - 1] += 1.0;
    }
    if (nodeNeg > 0) {
      A[nodeNeg - 1][col] -= 1.0;
      A[col][nodeNeg - 1] -= 1.0;
    }
    Z[col] = V;
  };

  const vSourceMap: Record<string, number> = {};
  vSources.forEach((vs, idx) => {
    vSourceMap[vs.id] = idx;
  });

  for (const comp of netlist.components) {
    if (comp.type === 'resistor') {
      const nodeA = parseInt(comp.pins[0]);
      const nodeB = parseInt(comp.pins[1]);
      if (comp.value <= 1e-12) return `La resistencia del resistor [${comp.id}] es demasiado baja o cero.`;
      const G = 1.0 / comp.value;
      stampConductance(nodeA, nodeB, G);
    } else if (comp.type === 'vsource') {
      const nodePos = parseInt(comp.pins[0]);
      const nodeNeg = parseInt(comp.pins[1]);
      const vsIdx = vSourceMap[comp.id];
      stampVoltageSource(vsIdx, nodePos, nodeNeg, comp.value);
    } else if (comp.type === 'diode') {
      const nodeAnode = parseInt(comp.pins[0]);
      const nodeCathode = parseInt(comp.pins[1]);
      stampConductance(nodeAnode, nodeCathode, 1.0 / 50.0);
    } else if (comp.type === 'nmos') {
      const nodeGate = parseInt(comp.pins[0]);
      const nodeDrain = parseInt(comp.pins[1]);
      const nodeSource = parseInt(comp.pins[2]);
      stampConductance(nodeDrain, nodeSource, 1.0 / 1e6);
      stampConductance(nodeGate, nodeSource, 1.0 / 1e9);
    } else if (comp.type === 'pmos') {
      const nodeGate = parseInt(comp.pins[0]);
      const nodeDrain = parseInt(comp.pins[1]);
      const nodeSource = parseInt(comp.pins[2]);
      stampConductance(nodeSource, nodeDrain, 1.0 / 1e6);
      stampConductance(nodeGate, nodeSource, 1.0 / 1e9);
    } else if (comp.type === 'npn' || comp.type === 'pnp') {
      const nodeBase = parseInt(comp.pins[0]);
      const nodeCollector = parseInt(comp.pins[1]);
      const nodeEmitter = parseInt(comp.pins[2]);
      stampConductance(nodeCollector, nodeEmitter, 1.0 / 1e6);
      stampConductance(nodeBase, nodeEmitter, 1.0 / 1e9);
    } else if (comp.type === 'opamp') {
      const nodeInPos = parseInt(comp.pins[0]);
      const nodeInNeg = parseInt(comp.pins[1]);
      const nodeOut = parseInt(comp.pins[4]);
      stampConductance(nodeInPos, nodeInNeg, 1.0 / 1e7);
      stampConductance(nodeOut, 0, 1.0 / 100.0);
    } else if (comp.type === 'capacitor') {
      const nodeA = parseInt(comp.pins[0]);
      const nodeB = parseInt(comp.pins[1]);
      stampConductance(nodeA, nodeB, 1.0 / 1e7);
    } else if (comp.type === 'inductor') {
      const nodeA = parseInt(comp.pins[0]);
      const nodeB = parseInt(comp.pins[1]);
      stampConductance(nodeA, nodeB, 1.0 / 0.001);
    }
  }

  const X = solveGaussian(A, Z);
  if (!X) {
    return "No se pudo resolver el sistema de ecuaciones. La matriz MNA es singular.";
  }

  const voltages: Record<string, number> = { "0": 0.0 };
  for (let i = 1; i <= n; i++) {
    voltages[i.toString()] = X[i - 1];
  }

  const currents: Record<string, number> = {};
  vSources.forEach((vs, idx) => {
    currents[vs.id] = X[n + idx];
  });

  return {
    nodeVoltages: voltages,
    branchCurrents: currents,
    convergenceIterations: 1,
  };
}

// Algoritmo de eliminación de Gauss
function solveGaussian(A: number[][], Z: number[]): number[] | null {
  const size = A.length;
  const M: number[][] = Array(size).fill(0).map((_, i) => [...A[i], Z[i]]);

  for (let i = 0; i < size; i++) {
    let maxRow = i;
    for (let r = i + 1; r < size; r++) {
      if (Math.abs(M[r][i]) > Math.abs(M[maxRow][i])) maxRow = r;
    }
    const temp = M[i];
    M[i] = M[maxRow];
    M[maxRow] = temp;

    const pivot = M[i][i];
    if (Math.abs(pivot) < 1e-12) return null;

    for (let c = i; c <= size; c++) {
      M[i][c] /= pivot;
    }

    for (let r = 0; r < size; r++) {
      if (r !== i) {
        const factor = M[r][i];
        for (let c = i; c <= size; c++) {
          M[r][c] -= factor * M[i][c];
        }
      }
    }
  }

  return M.map(row => row[size]);
}

// --- SOLVER TRANSITORIO COMPLEMENTARIO EN TYPESCRIPT (FALLBACK EULER REGRESIVO) ---

function solveTransientCircuitTS(netlist: CircuitNetlist, dt: number, tMax: number): TimeStepResult[] | string {
  let maxNodeIdx = 0;
  for (const comp of netlist.components) {
    for (const pinNode of comp.pins) {
      const idx = parseInt(pinNode);
      if (idx > maxNodeIdx) maxNodeIdx = idx;
    }
  }

  const n = maxNodeIdx;
  const vSources = netlist.components.filter(c => c.type === 'vsource');
  const m = vSources.length;
  const size = n + m;

  if (size === 0) return "El circuito no tiene nodos activos o componentes.";

  const vSourceMap: Record<string, number> = {};
  vSources.forEach((vs, idx) => {
    vSourceMap[vs.id] = idx;
  });

  // Inicializar históricos de almacenamiento
  const capStates: Record<string, number> = {};
  const indStates: Record<string, number> = {};

  for (const comp of netlist.components) {
    if (comp.type === 'capacitor') {
      capStates[comp.id] = 0.0; // Capacitor descargado 0V
    } else if (comp.type === 'inductor') {
      indStates[comp.id] = 0.0; // Bobina descargada 0A
    }
  }

  const stepsCount = Math.round(tMax / dt);
  const results: TimeStepResult[] = [];

  for (let step = 0; step <= stepsCount; step++) {
    const t = step * dt;
    const A: number[][] = Array(size).fill(0).map(() => Array(size).fill(0));
    const Z: number[] = Array(size).fill(0);

    const stampConductance = (nodeA: number, nodeB: number, G: number) => {
      if (nodeA > 0) A[nodeA - 1][nodeA - 1] += G;
      if (nodeB > 0) A[nodeB - 1][nodeB - 1] += G;
      if (nodeA > 0 && nodeB > 0) {
        A[nodeA - 1][nodeB - 1] -= G;
        A[nodeB - 1][nodeA - 1] -= G;
      }
    };

    const stampVoltageSource = (vsourceIdx: number, nodePos: number, nodeNeg: number, V: number) => {
      const col = n + vsourceIdx;
      if (nodePos > 0) {
        A[nodePos - 1][col] += 1.0;
        A[col][nodePos - 1] += 1.0;
      }
      if (nodeNeg > 0) {
        A[nodeNeg - 1][col] -= 1.0;
        A[col][nodeNeg - 1] -= 1.0;
      }
      Z[col] = V;
    };

    // Estampar componentes lineales base
    for (const comp of netlist.components) {
      if (comp.type === 'resistor') {
        const nodeA = parseInt(comp.pins[0]);
        const nodeB = parseInt(comp.pins[1]);
        if (comp.value <= 1e-12) return `Resistencia nula detectada.`;
        stampConductance(nodeA, nodeB, 1.0 / comp.value);
      } else if (comp.type === 'vsource') {
        const nodePos = parseInt(comp.pins[0]);
        const nodeNeg = parseInt(comp.pins[1]);
        const vsIdx = vSourceMap[comp.id];
        
        let vVal = comp.value;
        if (comp.waveType) {
          const amp = comp.amplitude ?? 0;
          const freq = comp.frequency ?? 1000;
          const offset = comp.offset ?? 0;
          const duty = comp.dutyCycle ?? 0.5;
          
          if (comp.waveType === 'sine') {
            vVal = offset + amp * Math.sin(2 * Math.PI * freq * t);
          } else if (comp.waveType === 'square') {
            const period = 1.0 / freq;
            const tMod = t % period;
            vVal = (tMod < duty * period) ? (offset + amp) : (offset - amp);
          } else if (comp.waveType === 'pulse') {
            const period = 1.0 / freq;
            const tMod = t % period;
            vVal = (tMod < duty * period) ? (offset + amp) : offset;
          }
        }
        
        stampVoltageSource(vsIdx, nodePos, nodeNeg, vVal);
      } else if (comp.type === 'diode') {
        const nodeAnode = parseInt(comp.pins[0]);
        const nodeCathode = parseInt(comp.pins[1]);
        stampConductance(nodeAnode, nodeCathode, 1.0 / 50.0);
      } else if (comp.type === 'nmos') {
        const nodeGate = parseInt(comp.pins[0]);
        const nodeDrain = parseInt(comp.pins[1]);
        const nodeSource = parseInt(comp.pins[2]);
        stampConductance(nodeDrain, nodeSource, 1.0 / 1e6);
        stampConductance(nodeGate, nodeSource, 1.0 / 1e9);
      } else if (comp.type === 'pmos') {
        const nodeGate = parseInt(comp.pins[0]);
        const nodeDrain = parseInt(comp.pins[1]);
        const nodeSource = parseInt(comp.pins[2]);
        stampConductance(nodeSource, nodeDrain, 1.0 / 1e6);
        stampConductance(nodeGate, nodeSource, 1.0 / 1e9);
      } else if (comp.type === 'npn' || comp.type === 'pnp') {
        const nodeBase = parseInt(comp.pins[0]);
        const nodeCollector = parseInt(comp.pins[1]);
        const nodeEmitter = parseInt(comp.pins[2]);
        stampConductance(nodeCollector, nodeEmitter, 1.0 / 1e6);
        stampConductance(nodeBase, nodeEmitter, 1.0 / 1e9);
      } else if (comp.type === 'opamp') {
        const nodeInPos = parseInt(comp.pins[0]);
        const nodeInNeg = parseInt(comp.pins[1]);
        const nodeOut = parseInt(comp.pins[4]);
        stampConductance(nodeInPos, nodeInNeg, 1.0 / 1e7);
        stampConductance(nodeOut, 0, 1.0 / 100.0);
      }
    }

    // Estampar modelos acompañantes Euler
    for (const comp of netlist.components) {
      if (comp.type === 'capacitor') {
        const nodePos = parseInt(comp.pins[0]);
        const nodeNeg = parseInt(comp.pins[1]);
        const prevVc = capStates[comp.id] || 0.0;

        const gEq = comp.value / dt;
        const iEq = gEq * prevVc;

        stampConductance(nodePos, nodeNeg, gEq);
        if (nodePos > 0) Z[nodePos - 1] -= iEq;
        if (nodeNeg > 0) Z[nodeNeg - 1] += iEq;

      } else if (comp.type === 'inductor') {
        const nodePos = parseInt(comp.pins[0]);
        const nodeNeg = parseInt(comp.pins[1]);
        const prevIl = indStates[comp.id] || 0.0;

        const gEq = dt / comp.value;
        const iEq = prevIl;

        stampConductance(nodePos, nodeNeg, gEq);
        if (nodePos > 0) Z[nodePos - 1] -= iEq;
        if (nodeNeg > 0) Z[nodeNeg - 1] += iEq;
      }
    }

    // Resolver
    const X = solveGaussian(A, Z);
    if (!X) {
      return `Matriz singular transitoria en t=${t.toFixed(4)}`;
    }

    // Desempaquetar
    const stepVoltages: Record<string, number> = { "0": 0.0 };
    for (let i = 1; i <= n; i++) {
      stepVoltages[i.toString()] = X[i - 1];
    }

    const stepCurrents: Record<string, number> = {};
    vSources.forEach((vs, idx) => {
      stepCurrents[vs.id] = X[n + idx];
    });

    results.push({
      time: t,
      nodeVoltages: stepVoltages,
      branchCurrents: stepCurrents,
    });

    // Actualizar estados para el siguiente paso temporal
    for (const comp of netlist.components) {
      if (comp.type === 'capacitor') {
        const nodePos = parseInt(comp.pins[0]);
        const nodeNeg = parseInt(comp.pins[1]);
        const vPos = nodePos > 0 ? stepVoltages[nodePos.toString()] : 0.0;
        const vNeg = nodeNeg > 0 ? stepVoltages[nodeNeg.toString()] : 0.0;
        capStates[comp.id] = vPos - vNeg;

      } else if (comp.type === 'inductor') {
        const nodePos = parseInt(comp.pins[0]);
        const nodeNeg = parseInt(comp.pins[1]);
        const vPos = nodePos > 0 ? stepVoltages[nodePos.toString()] : 0.0;
        const vNeg = nodeNeg > 0 ? stepVoltages[nodeNeg.toString()] : 0.0;
        const newVl = vPos - vNeg;
        
        const prevIl = indStates[comp.id] || 0.0;
        indStates[comp.id] = (dt / comp.value) * newVl + prevIl;
      }
    }
  }

  return results;
}

// --- CONTROLES DE LA SIMULACIÓN ---

function initSimulationControls() {
  analysisDcBtn = document.querySelector("#analysis-dc-btn");
  analysisAcBtn = document.querySelector("#analysis-ac-btn");
  analysisTranBtn = document.querySelector("#analysis-tran-btn");
  runSimBtn = document.querySelector("#run-sim-btn");
  stopSimBtn = document.querySelector("#stop-sim-btn");
  ipcStatusDot = document.querySelector("#ipc-status-dot");
  ipcStatusText = document.querySelector("#ipc-status-text");

  const selectMode = (btn: HTMLButtonElement | null, mode: 'DC' | 'AC' | 'TRAN') => {
    if (!btn) return;
    btn.addEventListener("click", () => {
      [analysisDcBtn, analysisAcBtn, analysisTranBtn].forEach(b => b?.classList.remove("active"));
      btn.classList.add("active");
      activeAnalysisMode = mode;
      const modoTexto = mode === 'DC' ? 'Corriente Continua (CC)' : mode === 'AC' ? 'Barrido CA (CA)' : 'Transitorio (TRAN)';
      addLog(`Modo de Simulación: ${modoTexto}`, "system");
      drawOscilloscope();
    });
  };

  selectMode(analysisDcBtn, 'DC');
  selectMode(analysisAcBtn, 'AC');
  selectMode(analysisTranBtn, 'TRAN');

interface ERCResult {
  passed: boolean;
  errors: string[];
  warnings: string[];
}

function runElectricalRuleCheck(netlist: CircuitNetlist): ERCResult {
  const errors: string[] = [];
  const warnings: string[] = [];

  if (!netlist || netlist.components.length === 0) {
    return { passed: true, errors, warnings };
  }

  // 1. Verificar si existe al menos una referencia a Tierra (GND)
  const hasGnd = netlist.components.some(c => c.type === 'ground');
  if (!hasGnd) {
    errors.push("Referencia a Tierra ausente (GND): El circuito necesita al menos un nodo de referencia de 0 V para que el motor matemático de Rust converja.");
  }

  // 2. Verificar cortocircuitos de fuentes de tensión
  for (const comp of netlist.components) {
    if (comp.type === 'vsource') {
      if (comp.pins[0] === comp.pins[1]) {
        errors.push(`Cortocircuito Franco detectado en la fuente [${comp.id}]: Sus terminales positivo y negativo están conectados al mismo nodo eléctrico.`);
      }
    }
  }

  // 3. Verificar cortocircuitos en paralelo de fuentes independientes de tensión
  const vsourceNodes: Record<string, string> = {}; 
  for (const comp of netlist.components) {
    if (comp.type === 'vsource') {
      const nodePair = [comp.pins[0], comp.pins[1]].sort().join('-');
      if (vsourceNodes[nodePair]) {
        warnings.push(`Fuentes en Paralelo: Las fuentes de tensión [${comp.id}] and [${vsourceNodes[nodePair]}] están en paralelo. Esto puede producir inconsistencias de simulación si sus valores nominales difieren.`);
      } else {
        vsourceNodes[nodePair] = comp.id;
      }
    }
  }

  // 4. Verificar terminales o pines flotantes (sin conexión)
  if (orchestrator) {
    const pinConnectionCount: Record<string, number> = {};
    
    for (const comp of orchestrator.components) {
      const pins = orchestrator.getComponentPins(comp);
      for (const pin of pins) {
        const pinKey = `${comp.id}:${pin.pinIndex}`;
        pinConnectionCount[pinKey] = 0;
      }
    }

    for (const wire of orchestrator.wires) {
      const keyFrom = `${wire.from.componentId}:${wire.from.pinIndex}`;
      const keyTo = `${wire.to.componentId}:${wire.to.pinIndex}`;
      if (pinConnectionCount[keyFrom] !== undefined) pinConnectionCount[keyFrom]++;
      if (pinConnectionCount[keyTo] !== undefined) pinConnectionCount[keyTo]++;
    }

    for (const comp of orchestrator.components) {
      const pins = orchestrator.getComponentPins(comp);
      let unconnectedCount = 0;
      for (const pin of pins) {
        const pinKey = `${comp.id}:${pin.pinIndex}`;
        if (pinConnectionCount[pinKey] === 0) {
          unconnectedCount++;
        }
      }
      
      if (unconnectedCount === pins.length && comp.type !== 'ground') {
        warnings.push(`Componente huérfano detectado [${comp.id}]: No tiene ninguna conexión activa de red.`);
      } else if (unconnectedCount > 0 && comp.type !== 'ground') {
        const firstFloatIdx = pins.findIndex(p => pinConnectionCount[`${comp.id}:${p.pinIndex}`] === 0);
        warnings.push(`Pin flotante detectado en [${comp.id}] (terminal index ${firstFloatIdx}): Se encuentra desconectado.`);
      }
    }
  }

  const passed = errors.length === 0;
  return { passed, errors, warnings };
}

  if (runSimBtn && stopSimBtn) {
    runSimBtn.addEventListener("click", async () => {
      addLog(`Iniciando simulación física de análisis [${activeAnalysisMode === 'DC' ? 'Corriente Continua' : activeAnalysisMode === 'AC' ? 'Barrido CA' : 'Transitorio'}]...`, "system");
      
      // 1. Extraer Netlist
      const netlist = extractElectricalNetlist();
      if (!netlist || netlist.components.length === 0) {
        addLog("Error: El lienzo está vacío. Coloca componentes antes de simular.", "error");
        return;
      }

      // 2. Ejecutar Verificador de Reglas Eléctricas (ERC)
      const ercRes = runElectricalRuleCheck(netlist);
      
      // Imprimir advertencias (no detienen simulación)
      for (const warn of ercRes.warnings) {
        addLog(`[ERC Advertencia] ${warn}`, "error"); 
      }

      // Imprimir errores y detener la simulación si no pasó el ERC
      if (!ercRes.passed) {
        addLog("----------------------------------------------------------------", "error");
        addLog("¡ERC FALLIDO! La simulación se ha abortado para prevenir bloqueos matemáticos:", "error");
        for (const err of ercRes.errors) {
          addLog(`▶ [ERC Error] ${err}`, "error");
        }
        addLog("Corrige estos errores topológicos en el lienzo para poder simular.", "error");
        addLog("----------------------------------------------------------------", "error");
        return;
      }

      runSimBtn!.disabled = true;
      stopSimBtn!.disabled = false;
      stopSimBtn!.classList.add("btn-stop");
      
      // Limpiar series de tiempo transitorias previas
      transientResults = [];
      sweepTime = 0.0;

      startOscilloscopeLoop();

      try {
        if (activeAnalysisMode === 'AC') {
          // --- EJECUTAR SIMULACIÓN DE BARRIDO CA EN RUST ---
          addLog("Enviando conexiones al motor de CA de Rust...", "send");
          const settings = { fStart: 10.0, fEnd: 100000.0, pointsPerDecade: 20 };
          const results = await invoke<any>("run_ac_sweep", { netlist, settings });
          addLog(`¡Resultados calculados exitosamente en Rust [Respuesta en Frecuencia CA]!`, "receive");
          acSweepResults = results;

          if (ipcStatusDot && ipcStatusText) {
            ipcStatusDot.classList.add("active");
            ipcStatusText.textContent = "Solucionador Rust Activo";
            ipcStatusText.style.color = "var(--accent-cyan)";
          }

          updateCanvasRendering();

        } else if (activeAnalysisMode === 'TRAN') {
          // --- EJECUTAR SIMULACIÓN TRANSITORIA DE ALTO RENDIMIENTO ---
          addLog("Enviando conexiones al motor transitorio de Rust...", "send");
          
          const settings = { dt: simSettings.dt, tMax: transientDuration };
          const results = await invoke<any>("run_transient_simulation", { netlist, settings });
          
          addLog(`¡Resultados calculados exitosamente en Rust [Integración en el dominio del tiempo]!`, "receive");
          transientResults = results || [];

          // Guardar último paso para liveVoltages (interactividad)
          if (transientResults.length > 0) {
            liveVoltages = transientResults[transientResults.length - 1].nodeVoltages;
          }

          if (ipcStatusDot && ipcStatusText) {
            ipcStatusDot.classList.add("active");
            ipcStatusText.textContent = "Solucionador Rust Activo";
            ipcStatusText.style.color = "var(--accent-cyan)";
          }

          updateCanvasRendering();

        } else {
          // --- EJECUTAR SIMULACIÓN DC STANDARD ---
          addLog(`Enviando conexiones a Rust con ${netlist.components.length} componentes...`, "send");
          const results = await invoke<any>("run_dc_simulation", { netlist });
          addLog(`¡Resultados calculados exitosamente en Rust [MNA Newton-Raphson]!`, "receive");
          
          liveVoltages = results.nodeVoltages || {};
          
          for (const [node, volt] of Object.entries(liveVoltages)) {
            addLog(`Nodo ${node}: Voltaje = ${volt.toFixed(4)} V`, "receive");
          }

          if (ipcStatusDot && ipcStatusText) {
            ipcStatusDot.classList.add("active");
            ipcStatusText.textContent = "Solucionador Rust Activo";
            ipcStatusText.style.color = "var(--accent-cyan)";
          }

          updateCanvasRendering();
        }

      } catch (error) {
        const errorMsg = error instanceof Error ? error.message : String(error);
        addLog(`Error en la comunicación con el motor de Rust: ${errorMsg}`, "error");

        // Fallback elegante para Navegador Web
        if (errorMsg.includes("window.__TAURI_IPC__") || errorMsg.includes("not found") || errorMsg.includes("window.__TAURI__")) {
          addLog("Entorno de navegador detectado. Iniciando solucionador local en TypeScript...", "system");
          
          setTimeout(() => {
            if (activeAnalysisMode === 'AC') {
              // Solver AC de respaldo local en TS (Generamos un barrido de frecuencias simulado para un filtro pasa-bajos RC para evitar crash en web)
              addLog("Simulando respuesta en frecuencia del circuito localmente en navegador...", "receive");
              const freqs: number[] = [];
              const nodeAmplitudes: Record<string, number[]> = {};
              const nodePhases: Record<string, number[]> = {};

              // Encontrar nodos activos o componentes en el netlist
              const nodes = new Set<string>();
              netlist.components.forEach(comp => {
                comp.pins.forEach(pin => {
                  if (pin !== "0") nodes.add(pin);
                });
              });

              // Generar 101 puntos logarítmicos entre 10 Hz y 100 kHz
              const logMin = Math.log10(10);
              const logMax = Math.log10(100000);
              for (let i = 0; i <= 100; i++) {
                const logVal = logMin + (i / 100) * (logMax - logMin);
                freqs.push(Math.pow(10, logVal));
              }

              // Calcular un filtro pasa-bajos de juguete para todos los nodos activos
              // Frecuencia de corte simulada de 1 kHz para el canal 1 y 10 kHz para el canal 2
              nodes.forEach(nodeId => {
                const fc = nodeId === "1" ? 1000 : nodeId === "2" ? 10000 : 5000;
                const amps: number[] = [];
                const phases: number[] = [];
                freqs.forEach(f => {
                  const ratio = f / fc;
                  const mag = 1.0 / Math.sqrt(1 + ratio * ratio);
                  const phase = -Math.atan(ratio) * (180 / Math.PI);
                  const db = 20 * Math.log10(mag);
                  amps.push(db);
                  phases.push(phase);
                });
                nodeAmplitudes[nodeId] = amps;
                nodePhases[nodeId] = phases;
              });

              acSweepResults = {
                frequencies: freqs,
                nodeAmplitudes,
                nodePhases
              };

              if (ipcStatusDot && ipcStatusText) {
                ipcStatusDot.classList.add("active");
                ipcStatusText.textContent = "Respaldo local Activo (Filtro Demo CA)";
                ipcStatusText.style.color = "var(--warning)";
              }

              updateCanvasRendering();
            } else if (activeAnalysisMode === 'TRAN') {
              // Solver transitorio local en TS
              const tsRes = solveTransientCircuitTS(netlist, simSettings.dt, transientDuration);
              if (typeof tsRes === "string") {
                addLog(`Error del solucionador transitorio local: ${tsRes}`, "error");
              } else {
                transientResults = tsRes;
                addLog(`Respaldo Transitorio local: ${transientResults.length} pasos calculados en TypeScript.`, "receive");
                
                if (transientResults.length > 0) {
                  liveVoltages = transientResults[transientResults.length - 1].nodeVoltages;
                }

                if (ipcStatusDot && ipcStatusText) {
                  ipcStatusDot.classList.add("active");
                  ipcStatusText.textContent = "Respaldo Transitorio local";
                  ipcStatusText.style.color = "var(--warning)";
                }

                updateCanvasRendering();
              }
            } else {
              // Solver DC local en TS
              const tsRes = solveCircuitTS(netlist);
              if (typeof tsRes === "string") {
                addLog(`Error del solucionador local: ${tsRes}`, "error");
              } else {
                liveVoltages = tsRes.nodeVoltages;
                addLog("Solucionador de respaldo: Resultados calculados en TypeScript.", "receive");
                
                for (const [node, volt] of Object.entries(liveVoltages)) {
                  addLog(`Nodo ${node} (Simulado): ${volt.toFixed(4)} V`, "receive");
                }

                if (ipcStatusDot && ipcStatusText) {
                  ipcStatusDot.classList.add("active");
                  ipcStatusText.textContent = "Respaldo local Activo";
                  ipcStatusText.style.color = "var(--warning)";
                }

                updateCanvasRendering();
              }
            }
          }, 300);
        }
      }
    });

    stopSimBtn.addEventListener("click", () => {
      addLog("Deteniendo simulación física del circuito.", "system");
      runSimBtn!.disabled = false;
      stopSimBtn!.disabled = true;
      stopSimBtn!.classList.remove("btn-stop");

      stopOscilloscopeLoop();
    });
  }
}

// --- INTERACTIVIDAD INTERNA DEL OSCILOSCOPIO ---

function initOscilloscopeInterface() {
  oscCanvas = document.querySelector("#osc-canvas") as HTMLCanvasElement;
  if (oscCanvas) {
    oscCtx = oscCanvas.getContext('2d');

    // Registrar eventos de mouse sobre el osciloscopio para el cursor interactivo en CA
    oscCanvas.addEventListener("mousemove", (e) => {
      const rect = oscCanvas!.getBoundingClientRect();
      oscMouseX = e.clientX - rect.left;
      // oscMouseY = e.clientY - rect.top;
      if (!isSimulating || activeAnalysisMode === 'AC') {
        drawOscilloscope();
      }
    });

    oscCanvas.addEventListener("mouseleave", () => {
      oscMouseX = null;
      // oscMouseY = null;
      if (!isSimulating || activeAnalysisMode === 'AC') {
        drawOscilloscope();
      }
    });
  }

  oscCh1Btn = document.querySelector("#osc-ch1-btn");
  oscCh2Btn = document.querySelector("#osc-ch2-btn");
  oscPauseBtn = document.querySelector("#osc-pause-btn");

  const exportCsvBtn = document.querySelector("#export-csv-btn");
  if (exportCsvBtn) {
    exportCsvBtn.addEventListener("click", () => {
      exportarDatosCSV();
    });
  }

  const exportSvgBtn = document.querySelector("#export-svg-btn");
  if (exportSvgBtn) {
    exportSvgBtn.addEventListener("click", () => {
      exportarDatosSVG();
    });
  }

  // SOPORTE PARA REUBICAR SONDAS CON SHIFT+CLICK
  const handleProbeActivation = (mode: 'CH1' | 'CH2') => {
    // Validar si existen nodos
    const netlist = extractElectricalNetlist();
    if (!netlist || netlist.components.length === 0) {
      addLog("Coloca componentes en el lienzo antes de colocar una sonda.", "error");
      return;
    }
    probePlacementMode = mode;
    addLog(`[Osciloscopio] Modo colocación de sonda del ${mode === 'CH1' ? 'Canal 1' : 'Canal 2'} activo. Haz clic sobre un terminal del componente en el lienzo para conectar la sonda.`, "system");
  };

  if (oscCh1Btn) {
    oscCh1Btn.addEventListener("click", (e) => {
      if (e.shiftKey) {
        handleProbeActivation('CH1');
      } else {
        oscCh1Btn?.classList.toggle("active");
        addLog(`Canal 1 (Sonda en Nodo ${ch1ProbeNode}) ${oscCh1Btn?.classList.contains('active') ? 'visible' : 'oculto'}.`, "system");
        if (!isSimulating) drawOscilloscope();
      }
    });
  }

  if (oscCh2Btn) {
    oscCh2Btn.addEventListener("click", (e) => {
      if (e.shiftKey) {
        handleProbeActivation('CH2');
      } else {
        oscCh2Btn?.classList.toggle("active");
        addLog(`Canal 2 (Sonda en Nodo ${ch2ProbeNode}) ${oscCh2Btn?.classList.contains('active') ? 'visible' : 'oculto'}.`, "system");
        if (!isSimulating) drawOscilloscope();
      }
    });
  }

  if (oscPauseBtn) {
    oscPauseBtn.addEventListener("click", () => {
      isOscPaused = !isOscPaused;
      oscPauseBtn?.classList.toggle("active");
      oscPauseBtn!.textContent = isOscPaused ? "Reanudar" : "Pausar";
    });
  }

  setTimeout(() => {
    drawOscilloscope();
  }, 100);
}

// --- INICIALIZACIÓN DEL MOTOR DE LIENZO INTERACTIVO (CANVAS CAD) ---

function initCanvasCAD() {
  const canvasElement = document.querySelector("#circuit-canvas") as HTMLCanvasElement;
  if (!canvasElement) return;

  orchestrator = new CanvasOrchestrator(canvasElement);

  const resizeCanvas = () => {
    const parent = canvasElement.parentElement;
    if (parent) {
      canvasElement.width = parent.clientWidth;
      canvasElement.height = parent.clientHeight;
      updateCanvasRendering();
    }
  };
  window.addEventListener("resize", resizeCanvas);
  resizeCanvas();

  let isRightClickPanning = false;
  let lastMousePos = { x: 0, y: 0 };

  canvasElement.addEventListener("mousedown", (e) => {
    const rect = canvasElement.getBoundingClientRect();
    const screenX = e.clientX - rect.left;
    const screenY = e.clientY - rect.top;
    const worldPt = orchestrator!.screenToWorld(screenX, screenY);

    if (e.button === 0) { // Clic izquierdo
      // MODO DE COLOCACIÓN DE SONDAS DEL OSCILOSCOPIO
      if (probePlacementMode) {
        if (orchestrator!.hoveredPin) {
          const pinKey = `${orchestrator!.hoveredPin.componentId}:${orchestrator!.hoveredPin.pinIndex}`;
          const nodeId = pinToNodeMap[pinKey];
          if (nodeId !== undefined) {
            if (probePlacementMode === 'CH1') {
              ch1ProbeNode = nodeId;
              addLog(`Sonda del Canal 1 (Cian) conectada al Nodo ${nodeId}.`, "system");
            } else {
              ch2ProbeNode = nodeId;
              addLog(`Sonda del Canal 2 (Morada) conectada al Nodo ${nodeId}.`, "system");
            }
          }
        }
        probePlacementMode = null;
        updateCanvasRendering();
        return;
      }

      // Modo normal de CAD
      if (orchestrator!.hoveredPin) {
        orchestrator!.activePinForWire = orchestrator!.hoveredPin;
        orchestrator!.tempWireEnd = worldPt;
      } else {
        const isShift = e.shiftKey;
        const comp = orchestrator!.selectComponentAt(worldPt.x, worldPt.y, isShift);
        
        if (comp) {
          // Si es selección múltiple, permitir arrastrar el lote
          orchestrator!.startDraggingSelected(worldPt.x, worldPt.y);
          updatePropertiesPanel(comp);
        } else {
          // Si no golpeó ningún componente y no hay Shift, activar caja de arrastre Glassmorphic
          if (!isShift && !orchestrator!.hoveredWire) {
            orchestrator!.selectionStart = worldPt;
            orchestrator!.selectionEnd = worldPt;
          } else if (orchestrator!.selectedWire) {
            addLog(`Cable seleccionado: [${orchestrator!.selectedWire.id}]. Presiona Delete/Backspace para eliminarlo de forma individual.`, "system");
          }
        }
      }
    } else if (e.button === 1 || e.button === 2) {
      isRightClickPanning = true;
      lastMousePos = { x: e.clientX, y: e.clientY };
      e.preventDefault();
    }
    updateCanvasRendering();
  });

  canvasElement.addEventListener("mousemove", (e) => {
    const rect = canvasElement.getBoundingClientRect();
    const screenX = e.clientX - rect.left;
    const screenY = e.clientY - rect.top;
    const worldPt = orchestrator!.screenToWorld(screenX, screenY);

    orchestrator!.checkHover(worldPt.x, worldPt.y);

    // Arrastre de componentes en lote
    if (orchestrator!.isDragging) {
      orchestrator!.handleDragging(worldPt.x, worldPt.y);
    }

    // Dibujo de la caja de selección colectiva
    if (orchestrator!.selectionStart) {
      orchestrator!.selectionEnd = worldPt;
    }

    if (orchestrator!.activePinForWire) {
      orchestrator!.tempWireEnd = worldPt;
    }

    if (isRightClickPanning) {
      const dx = e.clientX - lastMousePos.x;
      const dy = e.clientY - lastMousePos.y;
      orchestrator!.pan(dx, dy);
      lastMousePos = { x: e.clientX, y: e.clientY };
    }

    updateCanvasRendering();
  });

  const completeConnection = (_e: MouseEvent) => {
    // 1. Completar conexión de cable
    if (orchestrator!.activePinForWire) {
      if (orchestrator!.hoveredPin) {
        orchestrator!.connectPins(orchestrator!.activePinForWire, orchestrator!.hoveredPin);
        addLog(`Cable conectado: [${orchestrator!.activePinForWire.componentId}] terminal ${orchestrator!.activePinForWire.pinIndex} a [${orchestrator!.hoveredPin.componentId}] terminal ${orchestrator!.hoveredPin.pinIndex}`, "system");
      }
      orchestrator!.activePinForWire = null;
      orchestrator!.tempWireEnd = null;
    }

    // 2. Completar caja de selección Glassmorphic
    if (orchestrator!.selectionStart) {
      orchestrator!.completeBoxSelection();
      if (orchestrator!.selectedComponents.length > 0) {
        addLog(`Selección en lote: ${orchestrator!.selectedComponents.length} componentes seleccionados.`, "system");
      }
    }

    orchestrator!.stopDragging();
    isRightClickPanning = false;
    updateCanvasRendering();
  };

  canvasElement.addEventListener("mouseup", completeConnection);
  canvasElement.addEventListener("mouseleave", completeConnection);

  canvasElement.addEventListener("contextmenu", (e) => e.preventDefault());

  canvasElement.addEventListener("wheel", (e) => {
    const rect = canvasElement.getBoundingClientRect();
    const screenX = e.clientX - rect.left;
    const screenY = e.clientY - rect.top;
    const zoomFactor = e.deltaY < 0 ? 1.1 : 0.9;
    
    orchestrator!.zoomAt(zoomFactor, screenX, screenY);
    updateCanvasRendering();
    e.preventDefault();
  }, { passive: false });

  // Drag & Drop
  const toolboxCards = document.querySelectorAll(".component-card");
  toolboxCards.forEach(card => {
    card.addEventListener("dragstart", (e) => {
      const htmlEvent = e as DragEvent;
      const type = card.getAttribute("data-type") || "resistor";
      const defaultValue = card.getAttribute("data-default") || "1000";
      
      htmlEvent.dataTransfer?.setData("text/plain", JSON.stringify({ type, value: parseFloat(defaultValue) }));
    });
  });

  const canvasViewport = document.querySelector("#canvas-viewport") as HTMLElement;
  if (canvasViewport) {
    canvasViewport.addEventListener("dragover", (e) => {
      e.preventDefault();
    });

    canvasViewport.addEventListener("drop", (e) => {
      const htmlEvent = e as DragEvent;
      e.preventDefault();

      try {
        const rawData = htmlEvent.dataTransfer?.getData("text/plain");
        if (rawData) {
          const { type, value } = JSON.parse(rawData);
          
          const rect = canvasElement.getBoundingClientRect();
          const screenX = htmlEvent.clientX - rect.left;
          const screenY = htmlEvent.clientY - rect.top;
          const worldPt = orchestrator!.screenToWorld(screenX, screenY);

          const newComp = orchestrator!.addComponent(type, worldPt.x, worldPt.y, value);
          addLog(`Componente colocado: [${newComp.id}] en (X:${newComp.x}, Y:${newComp.y})`, "system");
          
          orchestrator!.selectedComponent = newComp;
          updatePropertiesPanel(newComp);
          updateCanvasRendering();
        }
      } catch (err) {
        addLog("Error al colocar componente.", "error");
      }
    });
  }

  // Keyboard rotation & delete (CAD en lote)
  window.addEventListener("keydown", (e) => {
    if (!orchestrator) return;
    
    const hasSelection = orchestrator.selectedComponents.length > 0 || 
                         orchestrator.selectedComponent !== null || 
                         orchestrator.selectedWire !== null;
                         
    if (!hasSelection) return;

    if (document.activeElement?.tagName === "INPUT") return;

    if (e.key === "r" || e.key === "R") {
      orchestrator.rotateSelectedComponent();
      if (orchestrator.selectedComponents.length > 0) {
        addLog(`Lote de ${orchestrator.selectedComponents.length} componentes rotado de forma colectiva.`, "system");
      } else if (orchestrator.selectedComponent) {
        addLog(`Componente [${orchestrator.selectedComponent.id}] rotado a ${orchestrator.selectedComponent.rotation}°`, "system");
      }
      updateCanvasRendering();
    } else if (e.key === "Delete" || e.key === "Backspace") {
      if (orchestrator.selectedWire) {
        addLog(`Cable [${orchestrator.selectedWire.id}] eliminado de forma individual.`, "system");
      } else if (orchestrator.selectedComponents.length > 0) {
        addLog(`Lote de ${orchestrator.selectedComponents.length} componentes eliminado del lienzo.`, "system");
      } else if (orchestrator.selectedComponent) {
        addLog(`Componente [${orchestrator.selectedComponent.id}] eliminado del lienzo.`, "system");
      }
      
      orchestrator.removeSelected();
      updateCanvasRendering();
    }
  });

  // Zoom In/Out & Clear floating buttons
  const btnClearCanvas = document.querySelector("#btn-clear-canvas");
  if (btnClearCanvas) {
    btnClearCanvas.addEventListener("click", () => {
      orchestrator!.components = [];
      orchestrator!.wires = [];
      orchestrator!.selectedComponent = null;
      liveVoltages = {};
      transientResults = [];
      sweepTime = 0.0;
      updateCanvasRendering();
      addLog("Lienzo vaciado por completo. Memoria limpia.", "system");
    });
  }

  const btnZoomIn = document.querySelector("#btn-zoom-in");
  if (btnZoomIn) {
    btnZoomIn.addEventListener("click", () => {
      orchestrator!.zoomAt(1.15, canvasElement.width / 2, canvasElement.height / 2);
      updateCanvasRendering();
    });
  }

  const btnZoomOut = document.querySelector("#btn-zoom-out");
  if (btnZoomOut) {
    btnZoomOut.addEventListener("click", () => {
      orchestrator!.zoomAt(0.85, canvasElement.width / 2, canvasElement.height / 2);
      updateCanvasRendering();
    });
  }
}

// --- CARGA GENERAL DEL DOM ---

function startTelemetryLoop() {
  const updateTelemetry = async () => {
    try {
      const data = await invoke<any>("get_performance_telemetry");
      if (data) {
        if (telemetryRamText) telemetryRamText.textContent = data.ramFormatted;
        if (telemetryCpuText) telemetryCpuText.textContent = `${data.cpuPercent.toFixed(1)} %`;
      }
    } catch (err) {
      if (telemetryRamText) telemetryRamText.textContent = "TS Local (N/A)";
      if (telemetryCpuText) telemetryCpuText.textContent = "0.0 %";
    }
  };

  updateTelemetry();
  setInterval(updateTelemetry, 3000);
}

window.addEventListener("DOMContentLoaded", () => {
  consoleOutput = document.querySelector("#console-output");
  clearConsoleBtn = document.querySelector("#clear-console-btn");
  telemetryRamText = document.querySelector("#telemetry-ram-text");
  telemetryCpuText = document.querySelector("#telemetry-cpu-text");

  initSidebars();
  initModals();
  initPropertyEditor();
  initSimulationControls();
  initOscilloscopeInterface();
  
  initCanvasCAD();
  initFilePersistence();
  startTelemetryLoop();

  if (clearConsoleBtn) {
    clearConsoleBtn.addEventListener("click", () => {
      if (consoleOutput) {
        consoleOutput.innerHTML = `<div class="log-line system-msg">> Limpieza de registros. Consola limpia.</div>`;
      }
    });
  }

  addLog("Entorno de desarrollo de UI premium cargado a 60 FPS estables.", "system");
  addLog("Colocación de sondas interactiva: Haz Shift+Click en Canal 1 o Canal 2 para conectar las sondas en el circuito.", "system");
});

// --- EXPORTADORES PREMIUM DE REPORTES CIENTÍFICOS (FASE 7) ---

function exportarDatosCSV() {
  let csvContent = "";
  let filename = "reporte_simulacion.csv";

  if (activeAnalysisMode === 'AC' && acSweepResults !== null) {
    csvContent = "Frecuencia (Hz),Magnitud Canal 1 (dB),Fase Canal 1 (Grados),Magnitud Canal 2 (dB),Fase Canal 2 (Grados)\n";
    const freqs = acSweepResults.frequencies;
    for (let i = 0; i < freqs.length; i++) {
      const f = freqs[i];
      const db1 = ch1ProbeNode ? acSweepResults.nodeAmplitudes[ch1ProbeNode]?.[i] ?? 0.0 : 0.0;
      const ph1 = ch1ProbeNode ? acSweepResults.nodePhases[ch1ProbeNode]?.[i] ?? 0.0 : 0.0;
      const db2 = ch2ProbeNode ? acSweepResults.nodeAmplitudes[ch2ProbeNode]?.[i] ?? 0.0 : 0.0;
      const ph2 = ch2ProbeNode ? acSweepResults.nodePhases[ch2ProbeNode]?.[i] ?? 0.0 : 0.0;
      csvContent += `${f.toFixed(2)},${db1.toFixed(4)},${ph1.toFixed(4)},${db2.toFixed(4)},${ph2.toFixed(4)}\n`;
    }
    filename = "reporte_barrido_ca.csv";
  } else if (activeAnalysisMode === 'TRAN' && transientResults.length > 0) {
    csvContent = "Tiempo (s),Voltaje Canal 1 (V),Voltaje Canal 2 (V)\n";
    transientResults.forEach(pt => {
      const v1 = ch1ProbeNode ? pt.nodeVoltages[ch1ProbeNode] ?? 0.0 : 0.0;
      const v2 = ch2ProbeNode ? pt.nodeVoltages[ch2ProbeNode] ?? 0.0 : 0.0;
      csvContent += `${pt.time.toFixed(6)},${v1.toFixed(5)},${v2.toFixed(5)}\n`;
    });
    filename = "reporte_transitorio.csv";
  } else {
    csvContent = "Nodo,Voltaje Operacion (V)\n";
    for (const [node, volt] of Object.entries(liveVoltages)) {
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
  addLog(`Datos exportados exitosamente a ${filename}`, "receive");
}

function exportarDatosSVG() {
  let svgContent = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 800 400" style="background:#030508; font-family:sans-serif;">`;
  let filename = "grafico_simulacion.svg";

  svgContent += `<rect width="800" height="400" fill="#030508" />`;
  svgContent += `<text x="400" y="25" fill="hsl(174, 97%, 69%)" font-size="16" font-weight="bold" text-anchor="middle">Astryd Sophia v2.0 Evolution - Reporte Grafico</text>`;

  if (activeAnalysisMode === 'AC' && acSweepResults !== null && acSweepResults.frequencies.length > 0) {
    filename = "grafico_bode_ca.svg";
    const freqs = acSweepResults.frequencies;
    const logMin = Math.log10(freqs[0]);
    const logMax = Math.log10(freqs[freqs.length - 1]);

    const decades = [10, 100, 1000, 10000, 100000];
    decades.forEach(dec => {
      if (dec >= freqs[0] && dec <= freqs[freqs.length - 1]) {
        const x = 50 + ((Math.log10(dec) - logMin) / (logMax - logMin)) * 700;
        svgContent += `<line x1="${x}" y1="50" x2="${x}" y2="350" stroke="rgba(102, 252, 241, 0.1)" stroke-width="1" />`;
        svgContent += `<text x="${x}" y="370" fill="rgba(102, 252, 241, 0.5)" font-size="9" text-anchor="middle">${dec >= 1000 ? (dec / 1000) + " kHz" : dec + " Hz"}</text>`;
      }
    });

    for (let i = 0; i <= 5; i++) {
      const y = 50 + 300 * (i / 5);
      const db = 20 - i * 20;
      const deg = 180 - i * 72;
      svgContent += `<line x1="50" y1="${y}" x2="750" y2="${y}" stroke="rgba(255, 255, 255, 0.05)" stroke-width="1" />`;
      svgContent += `<text x="45" y="${y + 3}" fill="rgba(102, 252, 241, 0.6)" font-size="9" text-anchor="end">${db} dB</text>`;
      svgContent += `<text x="755" y="${y + 3}" fill="rgba(168, 85, 247, 0.6)" font-size="9" text-anchor="start">${deg}°</text>`;
    }

    if (ch1ProbeNode) {
      let pathStr = "";
      const amps = acSweepResults.nodeAmplitudes[ch1ProbeNode];
      if (amps) {
        for (let i = 0; i < freqs.length; i++) {
          const x = 50 + ((Math.log10(freqs[i]) - logMin) / (logMax - logMin)) * 700;
          const y = 50 + 300 * (1.0 - (amps[i] - (-80)) / (20 - (-80)));
          pathStr += (i === 0 ? "M " : "L ") + `${x} ${y} `;
        }
        svgContent += `<path d="${pathStr}" fill="none" stroke="#66fcf1" stroke-width="2.5" />`;
      }
    }

    if (ch2ProbeNode) {
      let pathStr = "";
      const amps = acSweepResults.nodeAmplitudes[ch2ProbeNode];
      if (amps) {
        for (let i = 0; i < freqs.length; i++) {
          const x = 50 + ((Math.log10(freqs[i]) - logMin) / (logMax - logMin)) * 700;
          const y = 50 + 300 * (1.0 - (amps[i] - (-80)) / (20 - (-80)));
          pathStr += (i === 0 ? "M " : "L ") + `${x} ${y} `;
        }
        svgContent += `<path d="${pathStr}" fill="none" stroke="#a855f7" stroke-width="2" />`;
      }
    }

    svgContent += `<text x="400" y="390" fill="rgba(255, 255, 255, 0.3)" font-size="10" text-anchor="middle">Frecuencia (Logaritmica)</text>`;

  } else if (activeAnalysisMode === 'TRAN' && transientResults.length > 0) {
    filename = "grafico_oscilograma_transitorio.svg";
    for (let i = 0; i <= 10; i++) {
      const x = 50 + 700 * (i / 10);
      svgContent += `<line x1="${x}" y1="50" x2="${x}" y2="350" stroke="rgba(102, 252, 241, 0.05)" stroke-width="1" />`;
    }
    for (let i = 0; i <= 10; i++) {
      const y = 50 + 300 * (i / 10);
      svgContent += `<line x1="50" y1="${y}" x2="750" y2="${y}" stroke="rgba(102, 252, 241, 0.05)" stroke-width="1" />`;
    }
    
    svgContent += `<line x1="50" y1="200" x2="750" y2="200" stroke="rgba(102, 252, 241, 0.2)" stroke-width="1.5" />`;

    const getTransientPath = (nodeId: string) => {
      let pathStr = "";
      for (let i = 0; i < transientResults.length; i++) {
        const pt = transientResults[i];
        const x = 50 + (pt.time / transientDuration) * 700;
        const volt = pt.nodeVoltages[nodeId] ?? 0.0;
        const y = 200 - volt * (300 * 0.08);
        pathStr += (i === 0 ? "M " : "L ") + `${x} ${y} `;
      }
      return pathStr;
    };

    if (ch1ProbeNode) {
      svgContent += `<path d="${getTransientPath(ch1ProbeNode)}" fill="none" stroke="#66fcf1" stroke-width="2.5" />`;
    }
    if (ch2ProbeNode) {
      svgContent += `<path d="${getTransientPath(ch2ProbeNode)}" fill="none" stroke="#a855f7" stroke-width="2.0" />`;
    }

    svgContent += `<text x="400" y="380" fill="rgba(255, 255, 255, 0.3)" font-size="10" text-anchor="middle">Tiempo (s)</text>`;
  } else {
    svgContent += `<text x="400" y="200" fill="rgba(255, 255, 255, 0.4)" font-size="14" text-anchor="middle">Realiza un Analisis transitorio o de Barrido CA para exportar graficos vectoriales.</text>`;
  }

  svgContent += `</svg>`;
  
  const blob = new Blob([svgContent], { type: 'image/svg+xml;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.setAttribute("href", url);
  link.setAttribute("download", filename);
  link.style.visibility = 'hidden';
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  addLog(`Grafico vectorial exportado exitosamente a ${filename}`, "receive");
}

// --- SISTEMA DE PERSISTENCIA LOCAL DE CIRCUITOS (FASE 10) ---

function serializeCircuit(): string {
  if (!orchestrator) return "{}";

  const circuitData = {
    version: "2.0",
    components: orchestrator.components.map(c => ({
      id: c.id,
      type: c.type,
      value: c.value,
      x: c.x,
      y: c.y,
      rotation: c.rotation,
      waveType: c.waveType,
      amplitude: c.amplitude,
      frequency: c.frequency,
      offset: c.offset,
      dutyCycle: c.dutyCycle
    })),
    wires: orchestrator.wires.map(w => ({
      id: w.id,
      from: { componentId: w.from.componentId, pinIndex: w.from.pinIndex },
      to: { componentId: w.to.componentId, pinIndex: w.to.pinIndex },
      points: w.points
    })),
    viewport: {
      zoom: orchestrator.zoom,
      offsetX: orchestrator.offsetX,
      offsetY: orchestrator.offsetY
    },
    simSettings: {
      dt: simSettings.dt,
      tolerance: simSettings.tolerance,
      maxIterations: simSettings.maxIterations
    },
    activeAnalysisMode: activeAnalysisMode,
    probes: {
      ch1ProbeNode: ch1ProbeNode,
      ch2ProbeNode: ch2ProbeNode
    }
  };

  return JSON.stringify(circuitData, null, 2);
}

function deserializeCircuit(jsonStr: string): boolean {
  if (!orchestrator) return false;

  try {
    const data = JSON.parse(jsonStr);

    if (!data.components || !data.wires) {
      addLog("Error: El archivo de esquemático no es válido o está corrupto.", "error");
      return false;
    }

    // 1. Limpiar estado actual por completo
    orchestrator.components = [];
    orchestrator.wires = [];
    orchestrator.selectedComponent = null;
    orchestrator.selectedComponents = [];
    orchestrator.selectedWire = null;
    orchestrator.activePinForWire = null;
    orchestrator.tempWireEnd = null;
    orchestrator.selectionStart = null;
    orchestrator.selectionEnd = null;

    liveVoltages = {};
    transientResults = [];
    sweepTime = 0.0;

    // 2. Restaurar componentes
    for (const comp of data.components) {
      orchestrator.components.push({
        id: comp.id,
        type: comp.type,
        value: comp.value,
        x: comp.x,
        y: comp.y,
        rotation: comp.rotation,
        waveType: comp.waveType,
        amplitude: comp.amplitude,
        frequency: comp.frequency,
        offset: comp.offset,
        dutyCycle: comp.dutyCycle
      });
    }

    // 3. Restaurar cables (wires)
    for (const wire of data.wires) {
      orchestrator.wires.push({
        id: wire.id,
        from: { componentId: wire.from.componentId, pinIndex: wire.from.pinIndex },
        to: { componentId: wire.to.componentId, pinIndex: wire.to.pinIndex },
        points: wire.points || []
      });
    }

    // 4. Restaurar cámara/viewport
    if (data.viewport) {
      orchestrator.zoom = data.viewport.zoom || 1.0;
      orchestrator.offsetX = data.viewport.offsetX || 0;
      orchestrator.offsetY = data.viewport.offsetY || 0;
    }

    // 5. Restaurar ajustes de simulación
    if (data.simSettings) {
      simSettings.dt = data.simSettings.dt || 0.0001;
      simSettings.tolerance = data.simSettings.tolerance || 0.00001;
      simSettings.maxIterations = data.simSettings.maxIterations || 100;
    }

    // 6. Restaurar modo de simulación
    if (data.activeAnalysisMode) {
      activeAnalysisMode = data.activeAnalysisMode;
      const modeButtons = [analysisDcBtn, analysisAcBtn, analysisTranBtn];
      modeButtons.forEach(btn => btn?.classList.remove('active'));
      if (activeAnalysisMode === 'DC' && analysisDcBtn) analysisDcBtn.classList.add('active');
      if (activeAnalysisMode === 'AC' && analysisAcBtn) analysisAcBtn.classList.add('active');
      if (activeAnalysisMode === 'TRAN' && analysisTranBtn) analysisTranBtn.classList.add('active');
    }

    // 7. Restaurar asignaciones de osciloscopio
    if (data.probes) {
      ch1ProbeNode = data.probes.ch1ProbeNode || null;
      ch2ProbeNode = data.probes.ch2ProbeNode || null;
    }

    // Actualizar renderizado y recalcular nodos eléctricos
    extractElectricalNetlist();
    updateCanvasRendering();
    drawOscilloscope();

    return true;
  } catch (err) {
    addLog(`Error al deserializar esquemático: ${(err as Error).message}`, "error");
    return false;
  }
}

function initFilePersistence() {
  const btnNewCircuit = document.querySelector("#btn-new-circuit");
  if (btnNewCircuit) {
    btnNewCircuit.addEventListener("click", () => {
      if (orchestrator) {
        orchestrator.components = [];
        orchestrator.wires = [];
        orchestrator.selectedComponent = null;
        orchestrator.selectedComponents = [];
        orchestrator.selectedWire = null;
        orchestrator.activePinForWire = null;
        orchestrator.tempWireEnd = null;
        orchestrator.selectionStart = null;
        orchestrator.selectionEnd = null;

        liveVoltages = {};
        transientResults = [];
        sweepTime = 0.0;

        orchestrator.zoom = 1.0;
        orchestrator.offsetX = 0;
        orchestrator.offsetY = 0;

        ch1ProbeNode = "1";
        ch2ProbeNode = "2";

        extractElectricalNetlist();
        updateCanvasRendering();
        drawOscilloscope();
        addLog("Nuevo esquemático limpio creado.", "system");
      }
    });
  }

  const btnOpenCircuit = document.querySelector("#btn-open-circuit");
  if (btnOpenCircuit) {
    btnOpenCircuit.addEventListener("click", async () => {
      addLog("Abriendo diálogo para cargar archivo esquemático...", "system");
      try {
        const content = await invoke<string>("open_circuit_file");
        if (content) {
          const success = deserializeCircuit(content);
          if (success) {
            addLog("Esquemático .astryd cargado con éxito.", "receive");
          }
        }
      } catch (err) {
        if (err !== "Operación cancelada por el usuario") {
          addLog(`Error al abrir esquemático: ${err}`, "error");
        } else {
          addLog("Operación de apertura cancelada.", "system");
        }
      }
    });
  }

  const btnSaveCircuit = document.querySelector("#btn-save-circuit");
  if (btnSaveCircuit) {
    btnSaveCircuit.addEventListener("click", async () => {
      addLog("Abriendo diálogo para guardar esquemático...", "system");
      try {
        const jsonStr = serializeCircuit();
        const savedPath = await invoke<string>("save_circuit_file", { content: jsonStr });
        if (savedPath) {
          addLog(`Esquemático guardado con éxito en: [${savedPath}]`, "receive");
        }
      } catch (err) {
        if (err !== "Operación cancelada por el usuario") {
          addLog(`Error al guardar esquemático: ${err}`, "error");
        } else {
          addLog("Operación de guardado cancelada.", "system");
        }
      }
    });
  }
}
