import { safeInvoke as invoke } from "./simulation/tauri_mock";
import { listen } from "@tauri-apps/api/event";
import { CanvasOrchestrator, ComponentInstance, Point2D } from "./canvas_orchestrator";
import { TelemetryPanel } from "./ui/telemetry_panel";
import { SettingsModal, SimulationSettings } from "./ui/settings_modal";
import { OscilloscopePanel, TimeStepResult, PvtRunResult, PvtTrace } from "./ui/oscilloscope_panel";
import { ActuatorHistoryManager, parseBuzzerActuatorModel, parseLampActuatorModel, parseRelayActuatorModel } from "./ui/actuator_helpers";
import { AudioOrchestrator } from "./ui/audio_orchestrator";
import { McuDebugPanel } from "./ui/mcu_debug_panel";
import {
  createMcuRuntime,
  createMcuSpiceBridge,
  updateGpioInputs,
  runCycles,
  connectGpioToNode,
  STANDARD_8051_DEFINITION,
  ATMEGA328P_DEFINITIONS,
  resetRuntime,
  dispatchAnalogTrigger,
  PVT_PROFILE_COMMERCIAL,
  PVT_PROFILE_INDUSTRIAL,
  PVT_PROFILE_AUTOMOTIVE,
  type PvtConfig,
  type AnalogEventTrigger,
  type McuRuntime,
  type SParameterResult,
  type SParameterSettings,
  type PortDefinition,
} from "./simulation";
// Variables Globales del Estado
let actuatorHistory = new ActuatorHistoryManager();
let audioOrchestrator = new AudioOrchestrator();

let simSettings: SimulationSettings = {
  dt: 0.0001,
  tolerance: 0.00001,
  maxIterations: 100
};

let activeAnalysisMode: 'DC' | 'AC' | 'TRAN' | 'SENS' | 'PSS' | 'STB' | 'PVT' | 'SPAR' = 'DC';
const transientDuration = 0.05; // 50 ms total de simulación
let mcuDebugPanel: McuDebugPanel | null = null;

// --- ELEMENTOS DEL DOM ---
let sidebarLeft: HTMLElement | null = null;
let sidebarRight: HTMLElement | null = null;
let btnToggleLeft: HTMLButtonElement | null = null;
let btnToggleRight: HTMLButtonElement | null = null;

let analysisDcBtn: HTMLButtonElement | null = null;
let analysisAcBtn: HTMLButtonElement | null = null;
let analysisTranBtn: HTMLButtonElement | null = null;
let analysisSensBtn: HTMLButtonElement | null = null;
let analysisPssBtn: HTMLButtonElement | null = null;
let analysisStbBtn: HTMLButtonElement | null = null;
let analysisPvtBtn: HTMLButtonElement | null = null;
let analysisSparBtn: HTMLButtonElement | null = null;
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

// Instancia global del Canvas Orchestrator
let orchestrator: CanvasOrchestrator | null = null;

// Interfaz para la gestión de Pestañas (Workspace Tabs)
interface Tab {
  id: string;
  name: string;
  components: ComponentInstance[];
  wires: any[];
  zoom: number;
  offsetX: number;
  offsetY: number;
  filePath: string | null;
  unsaved: boolean;
  transientResults: TimeStepResult[];
  acSweepResults: any | null;
  ch1ProbeNode: string | null;
  ch2ProbeNode: string | null;
  activeAnalysisMode: 'DC' | 'AC' | 'TRAN' | 'SENS' | 'PSS' | 'STB' | 'PVT' | 'SPAR';
}

let tabs: Tab[] = [];
let activeTabId: string | null = null;

// Instancias de submódulos UI modularizados
let telemetryPanel: TelemetryPanel | null = null;
let oscilloscopePanel: OscilloscopePanel | null = null;

// Mapa global de voltajes resueltos para visualización
let liveVoltages: Record<string, number> = {};

// Mapa de correspondencia entre cada terminal física y su nodo eléctrico resuelto
let pinToNodeMap: Record<string, string> = {};

// --- ESTADOS DE SONDAS E INSTRUMENTACIÓN DEL OSCILOSCOPIO ---
let probePlacementMode: 'CH1' | 'CH2' | null = null;

// --- ESTADO DE SELECCIÓN DE PUERTOS RF PARA PARÁMETROS S ---
let sparPorts: { nodeId: string; z0: number }[] = [];
let sparFStart = 10.0;
let sparFEnd = 100000.0;
let sparPPD = 20;
let ch1ProbeNode: string | null = "1"; // Canal 1 por defecto al Nodo 1
let ch2ProbeNode: string | null = "2"; // Canal 2 por defecto al Nodo 2

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

  const ch1Node = oscilloscopePanel ? oscilloscopePanel.ch1ProbeNode : ch1ProbeNode;
  const ch2Node = oscilloscopePanel ? oscilloscopePanel.ch2ProbeNode : ch2ProbeNode;

    if (orchestrator) {
      // Encontrar coordenadas de puertos RF para marcadores SPAR
      const sparMarkers: { index: number; x: number; y: number }[] = [];
      for (const sp of sparPorts) {
        for (const comp of orchestrator.components) {
          const pins = orchestrator.getComponentPins(comp);
          for (const pin of pins) {
            const pinKey = `${comp.id}:${pin.pinIndex}`;
            const nodeId = pinToNodeMap[pinKey];
            if (nodeId === sp.nodeId) {
              const idx = sparPorts.indexOf(sp) + 1;
              if (!sparMarkers.some(m => m.index === idx)) {
                sparMarkers.push({ index: idx, x: pin.x, y: pin.y });
              }
            }
          }
        }
      }

      for (const comp of orchestrator.components) {
        const pins = orchestrator.getComponentPins(comp);
        for (const pin of pins) {
          const pinKey = `${comp.id}:${pin.pinIndex}`;
          const nodeId = pinToNodeMap[pinKey];
          if (nodeId === ch1Node && !ch1PinPos) {
            ch1PinPos = { x: pin.x, y: pin.y };
          }
          if (nodeId === ch2Node && !ch2PinPos) {
            ch2PinPos = { x: pin.x, y: pin.y };
          }
        }
      }
      orchestrator.render(pinVoltageMap, { ch1: ch1PinPos, ch2: ch2PinPos }, pinToNodeMap, sparMarkers.length > 0 ? sparMarkers : undefined);
    }
}

// --- STREAMING TRANSIENT (FASE 2.1) ---
// --- MOTOR DE INTERRUPCIONES MIXED-SIGNAL (MCU INTERRUPT ENGINE) ---

interface SimulationFrame {
  time: number;
  nodeVoltages: Record<string, number>;
  branchCurrents: Record<string, number>;
  frameIndex: number;
  isFinal: boolean;
  /** Evento de interrupción analógica recibido desde el solver Rust.
   *  null cuando el paso no contiene ningún cruce de umbral. */
  triggerEvent: AnalogEventTrigger | null;
}

/** Registro de runtimes MCU activos durante la simulación interactiva.
 *  Indexado por componentId. Se inicializa en startInteractiveTransient()
 *  y se limpia en stopInteractiveTransient(). */
let interactiveMcuRuntimes: Record<string, { runtime: McuRuntime; type: string; pins: string[] }> | null = null;

let unlistenStream: (() => void) | null = null;

function isSimulationActive(): boolean {
  return unlistenStream !== null;
}

interface ComponentMutation {
  componentId: string;
  field: string;
  value: number;
}

async function startInteractiveTransient(netlist: CircuitNetlist, settings: { dt: number; tMax: number }): Promise<void> {
  if (orchestrator) orchestrator.simulationActive = true;

  // Inicializar runtimes MCU para el entorno interactivo (co-simulación TS+Rust)
  const mcuRuntimes: Record<string, { runtime: McuRuntime; type: string; pins: string[] }> = {};
  for (const comp of netlist.components) {
    if (comp.type === 'mcu_8051' || comp.type === 'mcu_avr') {
      const origComp = orchestrator?.components.find(c => c.id === comp.id);
      if (origComp) {
        const def = comp.type === 'mcu_avr' ? ATMEGA328P_DEFINITIONS : STANDARD_8051_DEFINITION;
        const runtime = createMcuRuntime({
          definition: def,
          firmware: origComp.firmware,
        });
        runtime.pendingInterruptVector = null;
        runtime.globalInterruptEnable = true;
        mcuRuntimes[comp.id] = { runtime, type: comp.type, pins: comp.pins };
      }
    }
  }
  interactiveMcuRuntimes = mcuRuntimes;

  unlistenStream = await listen<SimulationFrame>('sim-frame-update', (event) => {
    const frame = event.payload;
    liveVoltages = frame.nodeVoltages;

    // --- DESPACHO DE INTERRUPCIONES ANALÓGICAS (MCU INTERRUPT ENGINE) ---
    // Si el paso analógico contiene un trigger de cruce de umbral, se inyecta
    // la interrupción de hardware en el runtime de la MCU destino a través
    // del puente SPICE.
    if (frame.triggerEvent && interactiveMcuRuntimes) {
      dispatchAnalogTrigger(frame.triggerEvent, interactiveMcuRuntimes);
    }

    if (oscilloscopePanel) {
      oscilloscopePanel.transientResults.push({
        time: frame.time,
        nodeVoltages: frame.nodeVoltages,
        branchCurrents: frame.branchCurrents,
      });
    }

    updateCanvasRendering();

    if (frame.isFinal) {
      addLog(`Simulación interactiva completada en t = ${frame.time.toFixed(6)} s.`, 'receive');
      if (oscilloscopePanel) {
        actuatorHistory.precompute(orchestrator!.components, oscilloscopePanel.transientResults, pinToNodeMap);
      }
    }
  });

  listen<string>('sim-frame-error', (event) => {
    addLog(`Error en simulación: ${event.payload}`, 'error');
    stopInteractiveTransient();
  });

  await invoke('start_interactive_transient', { netlist, settings });
}

async function stopInteractiveTransient(): Promise<void> {
  await invoke('stop_interactive_transient');
  if (orchestrator) orchestrator.simulationActive = false;
  // Limpiar registro de runtimes MCU interactivos
  interactiveMcuRuntimes = null;
  if (unlistenStream) {
    unlistenStream();
    unlistenStream = null;
  }
}

// --- ANÁLISIS PARAMÉTRICO PVT (PROCESS-VOLTAGE-TEMPERATURE) ---

const PVT_LABELS: Record<string, string> = {
  tt: 'TT (Nominal)',
  ff: 'FF (Fast-Fast)',
  ss: 'SS (Slow-Slow)',
  fs: 'FS (Fast-Slow)',
  sf: 'SF (Slow-Fast)',
};
const PVT_COLORS: string[] = ['#66fcf1', '#a855f7', '#f97316', '#22c55e', '#ef4444'];

async function runPvtAnalysis(netlist: CircuitNetlist): Promise<void> {
  if (!oscilloscopePanel) return;

  addLog('Selecciona un perfil PVT predefinido para el análisis matricial:', 'system');

  const container = document.querySelector('#simulation-bar');
  if (!container) return;

  // Limpiar botones de perfil PVT previos si existen
  document.querySelectorAll('.pvt-profile-btn').forEach(el => el.remove());

  const profiles: { label: string; configs: readonly PvtConfig[] }[] = [
    { label: 'Comercial (0-70°C)', configs: PVT_PROFILE_COMMERCIAL },
    { label: 'Industrial (-40-85°C)', configs: PVT_PROFILE_INDUSTRIAL },
    { label: 'Automotriz (-40-125°C)', configs: PVT_PROFILE_AUTOMOTIVE },
  ];

  for (const profile of profiles) {
    const btn = document.createElement('button');
    btn.className = 'btn-ctrl pvt-profile-btn';
    btn.type = 'button';
    btn.textContent = profile.label;
    btn.addEventListener('click', () => {
      document.querySelectorAll('.pvt-profile-btn').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      executePvtAnalysisMatrix(netlist, [...profile.configs]);
    });
    const separator = container.querySelector('div[style*="width: 1px"]');
    if (separator) {
      container.insertBefore(btn, separator);
    } else {
      container.appendChild(btn);
    }
  }
}

async function executePvtAnalysisMatrix(netlist: CircuitNetlist, pvtConfigs: PvtConfig[]): Promise<void> {
  if (!oscilloscopePanel) return;

  addLog('Iniciando análisis matricial PVT paralelo en Rust...', 'send');

  const monitoredNodes: string[] = [];
  if (oscilloscopePanel.ch1ProbeNode) monitoredNodes.push(oscilloscopePanel.ch1ProbeNode);
  if (oscilloscopePanel.ch2ProbeNode) monitoredNodes.push(oscilloscopePanel.ch2ProbeNode);

  const settings = { dt: simSettings.dt, tMax: 0.05 };

  try {
    const results = await invoke<PvtRunResult[]>('run_pvt_matrix_analysis', {
      netlist,
      transientSettings: settings,
      pvtConfigs,
      monitoredNodes,
    });

    const traces: PvtTrace[] = results.map((r, i) => ({
      config: r.config,
      results: r.transient,
      visible: true,
      color: PVT_COLORS[i % PVT_COLORS.length],
    }));
    oscilloscopePanel.pvtTraces = traces;
    oscilloscopePanel.pvtMode = true;
    oscilloscopePanel.transientResults = [];
    oscilloscopePanel.sweepTime = 0.0;
    oscilloscopePanel.activeAnalysisMode = 'PVT';
    oscilloscopePanel.start();

    addLog('----------------------------------------------------------------', 'system');
    addLog('=== RESULTADOS DEL ANÁLISIS PVT (PROCESS-VOLTAGE-TEMPERATURE) ===', 'system');
    for (const r of results) {
      const label = PVT_LABELS[r.config.corner] ?? r.config.corner.toUpperCase();
      const convIcon = r.converged ? '✅' : '❌';
      addLog(`${convIcon} ${label} | T = ${r.config.temperatureC}°C | V = ${(r.config.voltageScaling * 100).toFixed(0)}% | ${r.converged ? 'Convergió' : `Falló: ${r.error ?? 'desconocido'}`}`, 'receive');
    }
    addLog('----------------------------------------------------------------', 'system');

    if (ipcStatusDot && ipcStatusText) {
      ipcStatusDot.classList.add('active');
      ipcStatusText.textContent = 'PVT Matrix Solver Activo';
      ipcStatusText.style.color = 'var(--accent-cyan)';
    }
  } catch (error) {
    const errorMsg = error instanceof Error ? error.message : String(error);
    addLog(`Error en análisis PVT: ${errorMsg}`, 'error');
  }
}

// --- FUNCIONES AUXILIARES ---

// ==========================================================================
// ANÁLISIS Y EXPORTACIÓN DE PARÁMETROS S (TOUCHSTONE .sNp)
// ==========================================================================

/** Inicia el flujo de extracción de parámetros S y exportación Touchstone.
 *  Si no hay puertos seleccionados, activa el modo de selección en el canvas. */
async function runSparamExport(netlist: CircuitNetlist): Promise<void> {
  if (!oscilloscopePanel) return;

  if (sparPorts.length === 0) {
    addLog('Modo Selección de Puertos RF: Haz clic en los nodos del circuito para designarlos como puertos.', 'system');
    probePlacementMode = 'CH1'; // Reutilizamos el mecanismo de selección de sondas
    addLog('Usa la sonda CH1 para seleccionar el nodo positivo de cada puerto (GND = referencia automática).', 'system');
    return;
  }

  const ports: PortDefinition[] = sparPorts.map((p, i) => ({
    name: `Puerto ${i + 1}`,
    positiveNode: p.nodeId,
    negativeNode: '0',
    referenceImpedance: p.z0,
  }));

  addLog(`Iniciando extracción de parámetros S para ${ports.length} puertos de RF...`, 'send');

  const settings: SParameterSettings = {
    ports,
    fStart: sparFStart,
    fEnd: sparFEnd,
    pointsPerDecade: sparPPD,
    outputFormat: 'ma',
  };

  try {
    const result = await invoke<SParameterResult>('extract_sparameter', {
      netlist,
      settings,
    });

    if (!result.converged) {
      addLog(`Error en extracción S: ${result.error ?? 'desconocido'}`, 'error');
      return;
    }

    // Mostrar resultados en el osciloscopio
    oscilloscopePanel.sparResult = result;
    oscilloscopePanel.activeAnalysisMode = 'SPAR';
    oscilloscopePanel.start();

    // Generar contenido Touchstone
    const touchstoneContent = formatTouchstone(result);
    if (!touchstoneContent) {
      addLog('Error al formatear el archivo Touchstone.', 'error');
      return;
    }

    addLog('Matriz S extraída correctamente. Abriendo diálogo de exportación...', 'receive');

    // Exportar archivo .sNp
    const nPorts = ports.length;
    try {
      const savedPath = await invoke<string>('export_touchstone_file', {
        content: touchstoneContent,
        nPorts,
      });
      addLog(`Archivo Touchstone .s${nPorts}p exportado exitosamente: ${savedPath}`, 'receive');
    } catch (dialogErr) {
      if (typeof dialogErr === 'string' && dialogErr.includes('cancelada')) {
        addLog('Exportación cancelada por el usuario.', 'system');
      } else {
        addLog(`Error al guardar archivo Touchstone: ${dialogErr}`, 'error');
      }
    }

    if (ipcStatusDot && ipcStatusText) {
      ipcStatusDot.classList.add('active');
      ipcStatusText.textContent = 'S-Parameter Solver Activo';
      ipcStatusText.style.color = 'var(--accent-cyan)';
    }
  } catch (error) {
    const errorMsg = error instanceof Error ? error.message : String(error);
    addLog(`Error en extracción de parámetros S: ${errorMsg}`, 'error');
  }
}

/** Formatea un resultado de parámetros S a string Touchstone v2.0.
 *  Compatible con el estándar IEEE 1597.1-2008. */
function formatTouchstone(result: SParameterResult): string {
  const n = result.sMatrices.length > 0 ? result.sMatrices[0].length : 0;
  if (n === 0) return '';

  const lines: string[] = [];
  lines.push('! Touchstone file generated by Astrid Sophia');
  lines.push(`! S-Parameter Matrix: ${n}-port`);
  lines.push(`! Date: ${new Date().toISOString()}`);
  lines.push(`! Reference impedance: ${result.referenceImpedance} ohm`);
  const fmtStr = result.format === 'ma' ? 'MA' : 'RI';
  lines.push(`# Hz S ${fmtStr} R ${result.referenceImpedance}`);

  for (let fi = 0; fi < result.frequencies.length; fi++) {
    const freq = result.frequencies[fi];
    const s = result.sMatrices[fi];

    if (n <= 2) {
      // Una sola línea con todos los datos
      let rowParts = `${freq.toExponential(6)}`;
      for (let j = 0; j < n; j++) {
        for (let i = 0; i < n; i++) {
          const val = s[j][i];
          if (fmtStr === 'MA') {
            const mag = Math.sqrt(val.re * val.re + val.im * val.im);
            const ang = Math.atan2(val.im, val.re) * (180 / Math.PI);
            rowParts += `  ${mag.toExponential(6)} ${ang.toFixed(3)}`;
          } else {
            rowParts += `  ${val.re.toExponential(6)}  ${val.im.toExponential(6)}`;
          }
        }
      }
      lines.push(rowParts);
    } else {
      // Una línea por fila de la matriz (estándar Touchstone v2.0 para N≥3)
      let firstLine = `${freq.toExponential(6)}`;
      for (let i = 0; i < n; i++) {
        const val = s[0][i];
        if (fmtStr === 'MA') {
          const mag = Math.sqrt(val.re * val.re + val.im * val.im);
          const ang = Math.atan2(val.im, val.re) * (180 / Math.PI);
          firstLine += `  ${mag.toExponential(6)} ${ang.toFixed(3)}`;
        } else {
          firstLine += `  ${val.re.toExponential(6)}  ${val.im.toExponential(6)}`;
        }
      }
      lines.push(firstLine);
      for (let j = 1; j < n; j++) {
        let rowLine = '  ';
        for (let i = 0; i < n; i++) {
          const val = s[j][i];
          if (i > 0) rowLine += '  ';
          if (fmtStr === 'MA') {
            const mag = Math.sqrt(val.re * val.re + val.im * val.im);
            const ang = Math.atan2(val.im, val.re) * (180 / Math.PI);
            rowLine += `${mag.toExponential(6)} ${ang.toFixed(3)}`;
          } else {
            rowLine += `${val.re.toExponential(6)}  ${val.im.toExponential(6)}`;
          }
        }
        lines.push(rowLine);
      }
    }
  }

  lines.push('');
  return lines.join('\n');
}

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

// --- INTERACCIONES DE INTERFAZ (SIDEBARS & MODALES) ---

function initSidebars() {
  sidebarLeft = document.querySelector("#sidebar-left");
  sidebarRight = document.querySelector("#sidebar-right");
  btnToggleLeft = document.querySelector("#btn-toggle-left");
  btnToggleRight = document.querySelector("#btn-toggle-right");
  const btnDockLeft = document.querySelector("#btn-dock-toggle-left") as HTMLButtonElement | null;
  const btnDockRight = document.querySelector("#btn-dock-toggle-right") as HTMLButtonElement | null;
  const btnExpandLeft = document.querySelector("#btn-expand-left") as HTMLButtonElement | null;
  const btnExpandRight = document.querySelector("#btn-expand-right") as HTMLButtonElement | null;

  const toggleLeft = () => {
    if (!sidebarLeft) return;
    sidebarLeft.classList.toggle("collapsed");
    const isCollapsed = sidebarLeft.classList.contains("collapsed");
    if (btnToggleLeft) btnToggleLeft.textContent = isCollapsed ? "Componentes ▶" : "◀ Colapsar";
    if (btnDockLeft) btnDockLeft.classList.toggle("active", !isCollapsed);
    if (btnExpandLeft) btnExpandLeft.style.display = isCollapsed ? "block" : "none";
  };

  const toggleRight = () => {
    if (!sidebarRight) return;
    sidebarRight.classList.toggle("collapsed");
    const isCollapsed = sidebarRight.classList.contains("collapsed");
    if (btnToggleRight) btnToggleRight.textContent = isCollapsed ? "◀ Propiedades" : "Colapsar ▶";
    if (btnDockRight) btnDockRight.classList.toggle("active", !isCollapsed);
    if (btnExpandRight) btnExpandRight.style.display = isCollapsed ? "block" : "none";
  };

  if (btnToggleLeft) btnToggleLeft.addEventListener("click", toggleLeft);
  if (btnDockLeft) btnDockLeft.addEventListener("click", toggleLeft);
  if (btnExpandLeft) btnExpandLeft.addEventListener("click", toggleLeft);

  if (btnToggleRight) btnToggleRight.addEventListener("click", toggleRight);
  if (btnDockRight) btnDockRight.addEventListener("click", toggleRight);
  if (btnExpandRight) btnExpandRight.addEventListener("click", toggleRight);
}

// --- ACTUALIZACIÓN DE PROPIEDADES EN EL PANEL DERECHO ---

function updatePropertiesPanel(comp: ComponentInstance) {
  if (!propIdInput || !propValInput || !propValSlider || !propUnitInput) return;

  propIdInput.value = comp.id;
  propValInput.value = comp.value.toString();
  propValSlider.value = comp.value.toString();

  // Mostrar u ocultar panel de depuración de MCU
  if (comp.type === 'mcu_8051' || comp.type === 'mcu_avr') {
    mcuDebugPanel?.show(comp);
  } else {
    mcuDebugPanel?.hide();
  }

  // Ajustar visibilidad de campos de valor para MCUs
  const valGroup = document.querySelector("#group-comp-val") as HTMLElement;
  const unitGroup = document.querySelector("#group-comp-unit") as HTMLElement;
  const valLabel = document.querySelector("#group-comp-val .property-label") as HTMLElement;

  if (valGroup && unitGroup) {
    if (comp.type === 'mcu_8051' || comp.type === 'mcu_avr') {
      valGroup.style.display = "none";
      unitGroup.style.display = "none";
    } else if (comp.type === 'arduino_uno' || comp.type === 'esp32' || comp.type === 'raspberry_pi_pico') {
      valGroup.style.display = "flex";
      unitGroup.style.display = "none";
      if (valLabel) valLabel.textContent = "Modo de Simulación (0-3)";
    } else {
      valGroup.style.display = "flex";
      unitGroup.style.display = "flex";
      if (valLabel) valLabel.textContent = "Valor Nominal";
    }
  }

  const waveContainer = document.querySelector("#wave-properties-container") as HTMLElement;
  const waveTypeSelect = document.querySelector("#prop-wave-type") as HTMLSelectElement;
  const waveAmpInput = document.querySelector("#prop-wave-amp") as HTMLInputElement;
  const waveFreqInput = document.querySelector("#prop-wave-freq") as HTMLInputElement;
  const waveOffsetInput = document.querySelector("#prop-wave-offset") as HTMLInputElement;
  const waveDutyInput = document.querySelector("#prop-wave-duty") as HTMLInputElement;

  if (waveContainer && waveTypeSelect && waveAmpInput && waveFreqInput && waveOffsetInput && waveDutyInput) {
    if (comp.type === 'vsource' || comp.type === 'isource') {
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

  // Mostrar/ocultar editor de macromodelo SPICE para Subcircuito Genérico
  const macroContainer = document.querySelector("#macro-spice-container") as HTMLElement;
  const macroTextarea = document.querySelector("#prop-spice-macro") as HTMLTextAreaElement;
  const pinCountInput = document.querySelector("#prop-pin-count") as HTMLInputElement;
  if (macroContainer && macroTextarea) {
    if (comp.type === 'x') {
      macroContainer.style.display = "flex";
      macroTextarea.value = comp.spiceMacro || "";
      if (pinCountInput) pinCountInput.value = (comp.pinCount ?? 4).toString();
    } else {
      macroContainer.style.display = "none";
    }
  }

  // Para subcircuito genérico, ocultar campos de valor/undad físicos
  if (comp.type === 'x') {
    if (valGroup) valGroup.style.display = "none";
    if (unitGroup) unitGroup.style.display = "none";
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
    case 'isource':
      propUnitInput.value = "Amperios (A) [Offset / CC]";
      propValSlider.min = "-10";
      propValSlider.max = "10";
      break;
    case 'led':
      propUnitInput.value = "Color / Tensión Umbral (V)";
      propValSlider.min = "1.5";
      propValSlider.max = "3.5";
      break;
    case 'switch':
      propUnitInput.value = "Estado (0=Abierto, 1=Cerrado)";
      propValSlider.min = "0";
      propValSlider.max = "1";
      break;
    case 'transformer':
      propUnitInput.value = "Inductancia Primaria (H)";
      propValSlider.min = "0.000001";
      propValSlider.max = "1";
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
          const duplicate = orchestrator!.components.some(c => c.id === newId);
          if (!duplicate) {
            selected.id = newId;
          } else {
            addLog(`Error: El identificador [${newId}] ya existe en el circuito.`, "error");
          }
        }

        selected.value = newVal;

        if (selected.type === 'vsource' || selected.type === 'isource') {
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

            selected.value = selected.offset;
            propValInput!.value = selected.value.toString();
            propValSlider!.value = selected.value.toString();
          }
        }

        // Guardar macromodelo SPICE y número de pines para Subcircuito Genérico
        if (selected.type === 'x') {
          const macroTextarea = document.querySelector("#prop-spice-macro") as HTMLTextAreaElement;
          if (macroTextarea) {
            selected.spiceMacro = macroTextarea.value.trim() || undefined;
          }
          const pinCountInput = document.querySelector("#prop-pin-count") as HTMLInputElement;
          if (pinCountInput) {
            const newPinCount = parseInt(pinCountInput.value) || 4;
            selected.pinCount = Math.max(2, Math.min(64, newPinCount));
          }
        }

        // Emitir mutación en caliente si la simulación está activa
        if (isSimulationActive()) {
          const mutations: ComponentMutation[] = [];
          mutations.push({ componentId: selected.id, field: 'value', value: newVal });
          if (selected.amplitude !== undefined) {
            mutations.push({ componentId: selected.id, field: 'amplitude', value: selected.amplitude });
          }
          if (selected.frequency !== undefined) {
            mutations.push({ componentId: selected.id, field: 'frequency', value: selected.frequency });
          }
          if (selected.offset !== undefined) {
            mutations.push({ componentId: selected.id, field: 'offset', value: selected.offset });
          }
          if (selected.dutyCycle !== undefined) {
            mutations.push({ componentId: selected.id, field: 'duty_cycle', value: selected.dutyCycle });
          }
          if (selected.switchRon !== undefined) {
            mutations.push({ componentId: selected.id, field: 'switch_ron', value: selected.switchRon });
          }
          if (selected.switchRoff !== undefined) {
            mutations.push({ componentId: selected.id, field: 'switch_roff', value: selected.switchRoff });
          }
          for (const m of mutations) {
            invoke('inject_live_mutation', { mutation: m }).catch((err: unknown) => {
              addLog(`Error en mutación en caliente: ${err}`, 'error');
            });
          }
          addLog(`Mutación en caliente emitida para [${selected.id}]: ${mutations.length} campo(s)`, "send");
        }

        updateCanvasRendering();
        markCurrentTabAsModified();
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
  switchState?: boolean;
  switchRon?: number;
  switchRoff?: number;
  subcircuitName?: string; // nombre del subcircuito para tipo 'x'
}

interface MutualInductance {
  id: string;
  l1_id: string;
  l2_id: string;
  k_coeff: number;
}

interface CircuitNetlist {
  components: ExtractedComponent[];
  wires: { id: string; nodes: string[] }[];
  mutual_inductances?: MutualInductance[];
  subcircuitDefinitions?: string;
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
    if (comp.type === 'relay') {
      compPinMapping[comp.id] = [
        `${comp.id}:0`,
        `${comp.id}:1`,
        `${comp.id}:2`,
        `${comp.id}:3`,
        `${comp.id}:internal`
      ];
      allPinKeys.push(`${comp.id}:0`, `${comp.id}:1`, `${comp.id}:2`, `${comp.id}:3`, `${comp.id}:internal`);
    } else {
      const pins = orchestrator.getComponentPins(comp);
      compPinMapping[comp.id] = [];
      for (const pin of pins) {
        const pinKey = `${comp.id}:${pin.pinIndex}`;
        allPinKeys.push(pinKey);
        compPinMapping[comp.id].push(pinKey);
      }
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
  let netlistMutualInductances: MutualInductance[] = [];

  for (const comp of orchestrator.components) {
    const pinsKeys = compPinMapping[comp.id] || [];

    if (comp.type === 'lamp') {
      const model = parseLampActuatorModel(comp.value?.toString() ?? "");
      const pinsMapped = pinsKeys.map(pk => {
        const root = dsu.find(pk);
        if (!rootToNodeIdMap[root]) {
          rootToNodeIdMap[root] = nextNodeId.toString();
          nextNodeId++;
        }
        return rootToNodeIdMap[root];
      });
      extractedComponents.push({
        id: comp.id,
        type: 'resistor',
        value: model.coldResistanceOhms,
        pins: pinsMapped
      });
    }
    else if (comp.type === 'buzzer') {
      const model = parseBuzzerActuatorModel(comp.value?.toString() ?? "");
      const pinsMapped = pinsKeys.map(pk => {
        const root = dsu.find(pk);
        if (!rootToNodeIdMap[root]) {
          rootToNodeIdMap[root] = nextNodeId.toString();
          nextNodeId++;
        }
        return rootToNodeIdMap[root];
      });
      extractedComponents.push({
        id: comp.id,
        type: 'resistor',
        value: model.inactiveResistanceOhms,
        pins: pinsMapped
      });
    }
    else if (comp.type === 'relay') {
      const model = parseRelayActuatorModel(comp.value?.toString() ?? "");
      const pin0Root = dsu.find(`${comp.id}:0`);
      const pin1Root = dsu.find(`${comp.id}:1`);
      const pin2Root = dsu.find(`${comp.id}:2`);
      const pin3Root = dsu.find(`${comp.id}:3`);
      const internalRoot = dsu.find(`${comp.id}:internal`);

      const roots = [pin0Root, pin1Root, pin2Root, pin3Root, internalRoot];
      roots.forEach(r => {
        if (!rootToNodeIdMap[r]) {
          rootToNodeIdMap[r] = nextNodeId.toString();
          nextNodeId++;
        }
      });

      const pin0Node = rootToNodeIdMap[pin0Root];
      const pin1Node = rootToNodeIdMap[pin1Root];
      const pin2Node = rootToNodeIdMap[pin2Root];
      const pin3Node = rootToNodeIdMap[pin3Root];
      const pinInternalNode = rootToNodeIdMap[internalRoot];

      // Coil resistor
      extractedComponents.push({
        id: `${comp.id}__coil_res`,
        type: 'resistor',
        value: model.coilResistanceOhms,
        pins: [pin0Node, pinInternalNode]
      });

      // Coil inductor
      extractedComponents.push({
        id: `${comp.id}__coil`,
        type: 'inductor',
        value: model.inductanceHenrys,
        pins: [pinInternalNode, pin1Node]
      });

      // Contact resistor
      const isClosed = comp.relayClosed ?? false;
      const contactVal = isClosed ? model.contactClosedResistanceOhms : model.contactOpenResistanceOhms;
      extractedComponents.push({
        id: `${comp.id}__contact`,
        type: 'resistor',
        value: contactVal,
        pins: [pin2Node, pin3Node]
      });
    }
    else if (comp.type === 'transformer') {
      // Transformer expands to two coupled inductors + mutual inductance entry
      // Pins: 0,1 = primary | 2,3 = secondary
      const pin0Root = dsu.find(`${comp.id}:0`);
      const pin1Root = dsu.find(`${comp.id}:1`);
      const pin2Root = dsu.find(`${comp.id}:2`);
      const pin3Root = dsu.find(`${comp.id}:3`);

      const roots = [pin0Root, pin1Root, pin2Root, pin3Root];
      roots.forEach(r => {
        if (!rootToNodeIdMap[r]) {
          rootToNodeIdMap[r] = nextNodeId.toString();
          nextNodeId++;
        }
      });

      const priNode1 = rootToNodeIdMap[pin0Root];
      const priNode2 = rootToNodeIdMap[pin1Root];
      const secNode1 = rootToNodeIdMap[pin2Root];
      const secNode2 = rootToNodeIdMap[pin3Root];

      const L1 = comp.primaryInductance ?? 1e-3;
      const L2 = comp.secondaryInductance ?? 1e-3;
      const k = Math.max(0, Math.min(0.9999, comp.couplingCoefficient ?? 0.9));

      // Primary inductor
      extractedComponents.push({
        id: `${comp.id}__L1`,
        type: 'inductor',
        value: L1,
        pins: [priNode1, priNode2]
      });

      // Secondary inductor
      extractedComponents.push({
        id: `${comp.id}__L2`,
        type: 'inductor',
        value: L2,
        pins: [secNode1, secNode2]
      });

      // Add mutual inductance to the netlist (handled via separate field in CircuitNetlist)
      // Note: The MutualInductance will be added to netlist.mutual_inductances after this loop
      if (!netlistMutualInductances) {
        netlistMutualInductances = [];
      }
      netlistMutualInductances.push({
        id: `${comp.id}__K`,
        l1_id: `${comp.id}__L1`,
        l2_id: `${comp.id}__L2`,
        k_coeff: k
      });
    }
    else {
      const pinsMapped: string[] = [];
      for (const pk of pinsKeys) {
        const root = dsu.find(pk);
        if (!rootToNodeIdMap[root]) {
          rootToNodeIdMap[root] = nextNodeId.toString();
          nextNodeId++;
        }
        pinsMapped.push(rootToNodeIdMap[root]);
      }

      let subcircuitName: string | undefined;
      if (comp.type === 'x' && comp.spiceMacro) {
        for (const line of comp.spiceMacro.split('\n')) {
          const t = line.trim();
          if (t.toLowerCase().startsWith('.subckt')) {
            const parts = t.split(/\s+/);
            if (parts.length >= 2) subcircuitName = parts[1];
            break;
          }
        }
      }

      extractedComponents.push({
        id: comp.id,
        type: comp.type,
        value: Number(comp.value) || 0,
        pins: pinsMapped,
        waveType: comp.waveType,
        amplitude: comp.amplitude,
        frequency: comp.frequency,
        offset: comp.offset,
        dutyCycle: comp.dutyCycle,
        switchState: comp.type === 'switch' ? (comp.switchState ?? false) : undefined,
        switchRon: comp.switchRon,
        switchRoff: comp.switchRoff,
        subcircuitName,
      });
    }
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

  // Concatenar todos los bloques spiceMacro de los Subcircuitos Genéricos (tipo 'x')
  const macroBlocks: string[] = [];
  for (const comp of orchestrator.components) {
    if (comp.type === 'x' && comp.spiceMacro && comp.spiceMacro.trim().length > 0) {
      macroBlocks.push(comp.spiceMacro.trim());
    }
  }
  const subcircuitDefinitions = macroBlocks.length > 0 ? macroBlocks.join("\n\n") : undefined;

  return {
    components: extractedComponents,
    wires: extractedWires,
    mutual_inductances: netlistMutualInductances.length > 0 ? netlistMutualInductances : undefined,
    subcircuitDefinitions
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
    } else if (comp.type === 'isource') {
      const nodePos = parseInt(comp.pins[0]);
      const nodeNeg = parseInt(comp.pins[1]);
      // Current source: inject current into pos, extract from neg
      if (nodePos > 0) Z[nodePos - 1] -= comp.value;
      if (nodeNeg > 0) Z[nodeNeg - 1] += comp.value;
    } else if (comp.type === 'diode') {
      const nodeAnode = parseInt(comp.pins[0]);
      const nodeCathode = parseInt(comp.pins[1]);
      stampConductance(nodeAnode, nodeCathode, 1.0 / 50.0);
    } else if (comp.type === 'led') {
      // LED treated as diode in fallback
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
    } else if (comp.type === 'switch') {
      // Switch: simple on/off resistor
      const nodeA = parseInt(comp.pins[0]);
      const nodeB = parseInt(comp.pins[1]);
      const isClosed = comp.switchState ?? false;
      const ron = comp.switchRon ?? 0.01;
      const roff = comp.switchRoff ?? 1e9;
      const G = 1.0 / (isClosed ? ron : roff);
      stampConductance(nodeA, nodeB, G);
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

  // Inicializar MCUs para co-simulación en TS
  const mcuRuntimes: Record<string, { runtime: any, bridge: any, type: string, pins: string[] }> = {};
  for (const comp of netlist.components) {
    if (comp.type === 'mcu_8051' || comp.type === 'mcu_avr') {
      const origComp = orchestrator?.components.find(c => c.id === comp.id);
      if (origComp) {
        const def = comp.type === 'mcu_avr' ? ATMEGA328P_DEFINITIONS : STANDARD_8051_DEFINITION;
        const runtime = createMcuRuntime({
          definition: def,
          firmware: origComp.firmware
        });
        const bridge = createMcuSpiceBridge(runtime, comp.pins.length);
        comp.pins.forEach((nodeId, pinIdx) => {
          connectGpioToNode(bridge, pinIdx, nodeId);
        });
        mcuRuntimes[comp.id] = {
          runtime,
          bridge,
          type: comp.type,
          pins: comp.pins
        };
      }
    }
  }

  const stepsCount = Math.round(tMax / dt);
  const results: TimeStepResult[] = [];
  const rustMcuOutputs: Record<string, Record<number, number>> = {};

  for (let step = 0; step <= stepsCount; step++) {
    const t = step * dt;
    
    // 1. Sincronizar voltajes del circuito al MCU y ejecutar instrucciones
    if (step > 0 && results.length > 0) {
      const prevVoltages = results[results.length - 1].nodeVoltages;
      
      // MCUs locales
      for (const mcuId in mcuRuntimes) {
        const item = mcuRuntimes[mcuId];
        
        // Cargar voltajes de los pines
        const nodeVoltagesMap = new Map<string, number>();
        item.pins.forEach((nodeId) => {
          const v = parseInt(nodeId) > 0 ? (prevVoltages[nodeId] ?? 0.0) : 0.0;
          nodeVoltagesMap.set(nodeId, v);
        });
        
        item.bridge.config.spiceNodeVoltages = nodeVoltagesMap;
        updateGpioInputs(item.bridge);
        
        // Ejecutar ciclos de reloj
        const clockSpeed = item.type === 'mcu_avr' ? 16e6 : 12e6;
        const cycles = Math.round(dt * clockSpeed);
        runCycles(item.runtime, cycles);
      }

      // MCUs Rust (Mocked in TS solver)
      for (const comp of netlist.components) {
        if (comp.type === 'arduino_uno' || comp.type === 'esp32' || comp.type === 'raspberry_pi_pico') {
          const vCC = comp.type === 'arduino_uno' ? 5.0 : 3.3;
          const mode = comp.value; // comp.value es el modo
          
          const pinOutNode = comp.pins[1];
          const pinAdcNode = comp.pins[2];
          
          const vAdc = parseInt(pinAdcNode) > 0 ? (prevVoltages[pinAdcNode] ?? 0.0) : 0.0;
          
          let vOut = 0.0;
          let vDac = 0.0;
          
          if (mode === 1) { // Blink
            vOut = (t % 1.0 < 0.5) ? vCC : 0.0;
          } else if (mode === 2) { // Schmitt trigger
            const vOutPrev = parseInt(pinOutNode) > 0 ? (prevVoltages[pinOutNode] ?? 0.0) : 0.0;
            const wasHigh = vOutPrev > 0.5 * vCC;
            const threshold = wasHigh ? 0.45 * vCC : 0.55 * vCC;
            vOut = (vAdc > threshold) ? vCC : 0.0;
          } else if (mode === 3) { // PWM
            const period = 1e-4; // 10kHz
            const tPhase = t % period;
            const duty = Math.min(Math.max(vAdc / vCC, 0.0), 1.0);
            vDac = (tPhase < duty * period) ? vCC : 0.0;
          } else { // Mode 0: DAC matches ADC
            vDac = Math.min(Math.max(vAdc, 0.0), vCC);
          }
          
          rustMcuOutputs[comp.id] = {
            1: vOut,
            3: vDac
          };
        }
      }
    }

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
      } else if (comp.type === 'isource') {
        const nodePos = parseInt(comp.pins[0]);
        const nodeNeg = parseInt(comp.pins[1]);
        
        let iVal = comp.value;
        if (comp.waveType) {
          const amp = comp.amplitude ?? 0;
          const freq = comp.frequency ?? 1000;
          const offset = comp.offset ?? 0;
          const duty = comp.dutyCycle ?? 0.5;
          
          if (comp.waveType === 'sine') {
            iVal = offset + amp * Math.sin(2 * Math.PI * freq * t);
          } else if (comp.waveType === 'square') {
            const period = 1.0 / freq;
            const tMod = t % period;
            iVal = (tMod < duty * period) ? (offset + amp) : (offset - amp);
          } else if (comp.waveType === 'pulse') {
            const period = 1.0 / freq;
            const tMod = t % period;
            iVal = (tMod < duty * period) ? (offset + amp) : offset;
          }
        }
        
        // Current source: injects current into nodePos, out of nodeNeg
        if (nodePos > 0) Z[nodePos - 1] -= iVal;
        if (nodeNeg > 0) Z[nodeNeg - 1] += iVal;
      } else if (comp.type === 'led') {
        // LED modeled as diode
        const nodeAnode = parseInt(comp.pins[0]);
        const nodeCathode = parseInt(comp.pins[1]);
        stampConductance(nodeAnode, nodeCathode, 1.0 / 50.0);
      } else if (comp.type === 'switch') {
        // Switch: simple on/off resistor
        const nodeA = parseInt(comp.pins[0]);
        const nodeB = parseInt(comp.pins[1]);
        const isClosed = comp.switchState ?? false;
        const ron = comp.switchRon ?? 0.01;
        const roff = comp.switchRoff ?? 1e9;
        const G = 1.0 / (isClosed ? ron : roff);
        stampConductance(nodeA, nodeB, G);
      } else if (comp.type === 'opamp') {
        const nodeInPos = parseInt(comp.pins[0]);
        const nodeInNeg = parseInt(comp.pins[1]);
        const nodeOut = parseInt(comp.pins[4]);
        stampConductance(nodeInPos, nodeInNeg, 1.0 / 1e7);
        stampConductance(nodeOut, 0, 1.0 / 100.0);
      }
    }

    // Estampar MCUs locales (8051 y AVR) usando Norton
    for (const mcuId in mcuRuntimes) {
      const item = mcuRuntimes[mcuId];
      item.bridge.config.gpioPins.forEach((pin: any) => {
        const nodeStr = pin.connectedNodeId;
        if (!nodeStr) return;
        const nodeIdx = parseInt(nodeStr);
        if (nodeIdx <= 0) return;
        
        if (pin.direction !== 'input') {
          if (pin.state === 1) {
            stampConductance(nodeIdx, 0, 1.0 / 50.0);
            Z[nodeIdx - 1] += 5.0 / 50.0;
          } else if (pin.state === 0) {
            stampConductance(nodeIdx, 0, 1.0 / 50.0);
          } else {
            stampConductance(nodeIdx, 0, 1.0 / 1e6);
          }
        } else {
          stampConductance(nodeIdx, 0, 1.0 / 1e6);
        }
      });
    }

    // Estampar MCUs Rust
    for (const comp of netlist.components) {
      if (comp.type === 'arduino_uno' || comp.type === 'esp32' || comp.type === 'raspberry_pi_pico') {
        const vCC = comp.type === 'arduino_uno' ? 5.0 : 3.3;
        const outputs = rustMcuOutputs[comp.id] || {};
        
        comp.pins.forEach((nodeId, pinIdx) => {
          const nodeIdx = parseInt(nodeId);
          if (nodeIdx <= 0) return;
          
          if (pinIdx === 1) { // OUT
            const vOut = outputs[1] ?? 0.0;
            stampConductance(nodeIdx, 0, 1.0 / 50.0);
            Z[nodeIdx - 1] += vOut / 50.0;
          } else if (pinIdx === 3) { // DAC
            const vDac = outputs[3] ?? 0.0;
            stampConductance(nodeIdx, 0, 1.0 / 50.0);
            Z[nodeIdx - 1] += vDac / 50.0;
          } else if (pinIdx === 4) { // VCC
            stampConductance(nodeIdx, 0, 1.0 / 50.0);
            Z[nodeIdx - 1] += vCC / 50.0;
          } else {
            stampConductance(nodeIdx, 0, 1.0 / 1e6);
          }
        });
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
  analysisSensBtn = document.querySelector("#analysis-sens-btn");
  analysisPssBtn = document.querySelector("#analysis-pss-btn");
  analysisStbBtn = document.querySelector("#analysis-stb-btn");
  analysisPvtBtn = document.querySelector("#analysis-pvt-btn");
  analysisSparBtn = document.querySelector("#analysis-spar-btn");
  runSimBtn = document.querySelector("#run-sim-btn");
  stopSimBtn = document.querySelector("#stop-sim-btn");
  ipcStatusDot = document.querySelector("#ipc-status-dot");
  ipcStatusText = document.querySelector("#ipc-status-text");

  const selectMode = (btn: HTMLButtonElement | null, mode: 'DC' | 'AC' | 'TRAN' | 'SENS' | 'PSS' | 'STB' | 'PVT' | 'SPAR') => {
    if (!btn) return;
    btn.addEventListener("click", () => {
      [analysisDcBtn, analysisAcBtn, analysisTranBtn, analysisSensBtn, analysisPssBtn, analysisStbBtn, analysisPvtBtn, analysisSparBtn].forEach(b => b?.classList.remove("active"));
      btn.classList.add("active");
      activeAnalysisMode = mode;
      const modoTexto = mode === 'DC' ? 'Corriente Continua (CC)' : 
                        mode === 'AC' ? 'Barrido CA (CA)' : 
                        mode === 'TRAN' ? 'Transitorio (TRAN)' : 
                        mode === 'SENS' ? 'Sensibilidad y Peor Caso (SENS)' :
                        mode === 'PSS' ? 'Régimen Permanente Periódico (PSS)' :
                        mode === 'PVT' ? 'Análisis PVT (Process-Voltage-Temperature)' :
                        mode === 'SPAR' ? 'Parámetros S (Touchstone)' :
                        'Análisis de Estabilidad (STB)';
      addLog(`Modo de Simulación: ${modoTexto}`, "system");
      if (oscilloscopePanel) {
        oscilloscopePanel.activeAnalysisMode = mode;
        oscilloscopePanel.draw();
      }
      // Limpiar botones de perfil PVT al cambiar de modo
      if (mode !== 'PVT') {
        document.querySelectorAll('.pvt-profile-btn').forEach(el => el.remove());
      }
    });
  };

  selectMode(analysisDcBtn, 'DC');
  selectMode(analysisAcBtn, 'AC');
  selectMode(analysisTranBtn, 'TRAN');
  selectMode(analysisSensBtn, 'SENS');
  selectMode(analysisPssBtn, 'PSS');
  selectMode(analysisStbBtn, 'STB');
  selectMode(analysisPvtBtn, 'PVT');
  selectMode(analysisSparBtn, 'SPAR');

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

    const hasGnd = netlist.components.some(c => c.type === 'ground');
    if (!hasGnd) {
      errors.push("Referencia a Tierra ausente (GND): El circuito necesita al menos un nodo de referencia de 0 V para que el motor matemático de Rust converja.");
    }

    for (const comp of netlist.components) {
      if (comp.type === 'vsource') {
        if (comp.pins[0] === comp.pins[1]) {
          errors.push(`Cortocircuito Franco detectado en la fuente [${comp.id}]: Sus terminales positivo y negativo están conectados al mismo nodo eléctrico.`);
        }
      }
    }

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
      addLog(`Iniciando simulación física de análisis [${
        activeAnalysisMode === 'DC' ? 'Corriente Continua' :
        activeAnalysisMode === 'AC' ? 'Barrido CA' :
        activeAnalysisMode === 'TRAN' ? 'Transitorio' :
        activeAnalysisMode === 'PVT' ? 'PVT Corner Analysis' : 'Transitorio'
      }]...`, "system");
      
      const netlist = extractElectricalNetlist();
      if (!netlist || netlist.components.length === 0) {
        addLog("Error: El lienzo está vacío. Coloca componentes antes de simular.", "error");
        return;
      }

      const ercRes = runElectricalRuleCheck(netlist);
      
      for (const warn of ercRes.warnings) {
        addLog(`[ERC Advertencia] ${warn}`, "error"); 
      }

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
      
      if (oscilloscopePanel) {
        oscilloscopePanel.transientResults = [];
        oscilloscopePanel.sweepTime = 0.0;
        if (activeAnalysisMode !== 'PVT') {
          oscilloscopePanel.pvtMode = false;
          oscilloscopePanel.pvtTraces = [];
        }
        oscilloscopePanel.start();
      }

      try {
        if (activeAnalysisMode === 'AC') {
          addLog("Enviando conexiones al motor de CA de Rust...", "send");
          const settings = { fStart: 10.0, fEnd: 100000.0, pointsPerDecade: 20 };
          const results = await invoke<any>("run_ac_sweep", { netlist, settings });
          addLog(`¡Resultados calculados exitosamente en Rust [Respuesta en Frecuencia CA]!`, "receive");
          
          if (oscilloscopePanel) {
            oscilloscopePanel.acSweepResults = results;
          }

          if (ipcStatusDot && ipcStatusText) {
            ipcStatusDot.classList.add("active");
            ipcStatusText.textContent = "Solucionador Rust Activo";
            ipcStatusText.style.color = "var(--accent-cyan)";
          }

          updateCanvasRendering();

        } else if (activeAnalysisMode === 'TRAN') {
          addLog("Iniciando simulación transitoria interactiva (streaming)...", "send");

          if (oscilloscopePanel) {
            oscilloscopePanel.transientResults = [];
          }

          const settings = { dt: simSettings.dt, tMax: transientDuration };
          await startInteractiveTransient(netlist, settings);

          if (ipcStatusDot && ipcStatusText) {
            ipcStatusDot.classList.add("active");
            ipcStatusText.textContent = "Solucionador Rust Activo";
            ipcStatusText.style.color = "var(--accent-cyan)";
          }

        } else if (activeAnalysisMode === 'SENS') {
          addLog("Enviando conexiones al solucionador de sensibilidad de Rust...", "send");
          const results = await invoke<any>("run_sensitivity_analysis", { netlist });
          addLog(`¡Resultados de Sensibilidad calculados exitosamente en Rust!`, "receive");

          liveVoltages = results.nominalVoltages || {};

          addLog("----------------------------------------------------------------", "system");
          addLog("=== RESULTADOS DEL ANÁLISIS DE SENSIBILIDAD ===", "system");
          for (const sens of results.sensitivities) {
            addLog(`Componente: ${sens.componentId} (${sens.parameterName} = ${sens.parameterValue})`, "receive");
            for (const [node, absVal] of Object.entries(sens.absoluteSensitivities)) {
              const normVal = sens.normalizedSensitivities[node] || 0;
              addLog(`  • Nodo ${node}: Absoluta = ${(absVal as number).toFixed(6)} V/U | Normalizada = ${((normVal as number) * 100).toFixed(2)}%`, "receive");
            }
          }
          addLog("=== LÍMITES DE PEOR CASO (WORST-CASE LIMITS) ===", "system");
          for (const [node, limits] of Object.entries(results.worstCaseLimits)) {
            const lim = limits as any;
            addLog(`  • Nodo ${node}: Nom = ${lim.nominalValue.toFixed(4)} V | Desviación = ±${lim.maxDeviation.toFixed(4)} V | Rango = [${lim.worstCaseLow.toFixed(4)} V, ${lim.worstCaseHigh.toFixed(4)} V]`, "receive");
          }
          addLog("----------------------------------------------------------------", "system");

          if (ipcStatusDot && ipcStatusText) {
            ipcStatusDot.classList.add("active");
            ipcStatusText.textContent = "Solucionador Rust Activo";
            ipcStatusText.style.color = "var(--accent-cyan)";
          }

          updateCanvasRendering();

        } else if (activeAnalysisMode === 'PSS') {
          addLog("Enviando conexiones al motor PSS [Shooting Method] de Rust...", "send");
          
          let period = 1e-3;
          const acSource = netlist.components.find(c => c.frequency && c.frequency > 0);
          if (acSource && acSource.frequency) {
            period = 1.0 / acSource.frequency;
          }
          
          const settings = { period: period, maxShootingIters: 15, shootingTolerance: 1e-4 };
          const results = await invoke<any>("run_pss_simulation", { netlist, settings });
          
          addLog(`¡Resultados calculados exitosamente en Rust [PSS Shooting Method]!`, "receive");
          
          if (oscilloscopePanel) {
            oscilloscopePanel.transientResults = results || [];
          }

          const oscTransient = oscilloscopePanel ? oscilloscopePanel.transientResults : [];
          if (oscTransient.length > 0) {
            liveVoltages = oscTransient[oscTransient.length - 1].nodeVoltages;
          }

          if (ipcStatusDot && ipcStatusText) {
            ipcStatusDot.classList.add("active");
            ipcStatusText.textContent = "Solucionador Rust Activo";
            ipcStatusText.style.color = "var(--accent-cyan)";
          }

          updateCanvasRendering();

        } else if (activeAnalysisMode === 'PVT') {
          await runPvtAnalysis(netlist);

        } else if (activeAnalysisMode === 'SPAR') {
          await runSparamExport(netlist);

        } else if (activeAnalysisMode === 'STB') {
          addLog("Enviando conexiones al motor de análisis de Estabilidad [Polos y Ceros] de Rust...", "send");
          const results = await invoke<any>("run_stability_analysis", { netlist });
          addLog(`¡Resultados de Estabilidad calculados exitosamente en Rust!`, "receive");

          addLog("----------------------------------------------------------------", "system");
          addLog("=== ANÁLISIS DE ESTABILIDAD DE POLOS Y CEROS (STB) ===", "system");
          addLog(`Estado de Estabilidad: ${results.isStable ? "✅ CIRCUITO ESTABLE" : "⚠️ CIRCUITO INESTABLE (Peligro de Oscilación)"}`, "system");
          addLog(`Margen de Fase (Phase Margin): ${results.phaseMargin.toFixed(2)}º`, "receive");
          addLog(`Margen de Ganancia (Gain Margin): ${results.gainMargin.toFixed(2)} dB`, "receive");
          addLog("Lista de Polos del Sistema en el Plano de Laplace (s):", "receive");
          results.poles.forEach((p: any, idx: number) => {
            addLog(`  • Polo ${idx + 1}: ${p.re.toFixed(2)} ${p.im >= 0 ? "+" : "-"} ${Math.abs(p.im).toFixed(2)}j rad/s`, "receive");
          });
          addLog("----------------------------------------------------------------", "system");

          if (ipcStatusDot && ipcStatusText) {
            ipcStatusDot.classList.add("active");
            ipcStatusText.textContent = "Solucionador Rust Activo";
            ipcStatusText.style.color = "var(--accent-cyan)";
          }

          updateCanvasRendering();

        } else {
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

        if (errorMsg.includes("window.__TAURI_IPC__") || errorMsg.includes("not found") || errorMsg.includes("window.__TAURI__")) {
          addLog("Entorno de navegador detectado. Iniciando solucionador local en TypeScript...", "system");
          
          setTimeout(() => {
            if (activeAnalysisMode === 'AC') {
              addLog("Simulando respuesta en frecuencia del circuito localmente en navegador...", "receive");
              const freqs: number[] = [];
              const nodeAmplitudes: Record<string, number[]> = {};
              const nodePhases: Record<string, number[]> = {};

              const nodes = new Set<string>();
              netlist.components.forEach(comp => {
                comp.pins.forEach(pin => {
                  if (pin !== "0") nodes.add(pin);
                });
              });

              const logMin = Math.log10(10);
              const logMax = Math.log10(100000);
              for (let i = 0; i <= 100; i++) {
                const logVal = logMin + (i / 100) * (logMax - logMin);
                freqs.push(Math.pow(10, logVal));
              }

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

              if (oscilloscopePanel) {
                oscilloscopePanel.acSweepResults = {
                  frequencies: freqs,
                  nodeAmplitudes,
                  nodePhases
                };
              }

              if (ipcStatusDot && ipcStatusText) {
                ipcStatusDot.classList.add("active");
                ipcStatusText.textContent = "Respaldo local Activo (Filtro Demo CA)";
                ipcStatusText.style.color = "var(--warning)";
              }

              updateCanvasRendering();
            } else if (activeAnalysisMode === 'TRAN') {
              const tsRes = solveTransientCircuitTS(netlist, simSettings.dt, transientDuration);
              if (typeof tsRes === "string") {
                addLog(`Error del solucionador transitorio local: ${tsRes}`, "error");
              } else {
                if (oscilloscopePanel) {
                  oscilloscopePanel.transientResults = tsRes;
                  actuatorHistory.precompute(orchestrator!.components, tsRes || [], pinToNodeMap);
                }
                addLog(`Respaldo Transitorio local: ${tsRes.length} pasos calculados en TypeScript.`, "receive");
                
                if (tsRes.length > 0) {
                  liveVoltages = tsRes[tsRes.length - 1].nodeVoltages;
                }

                if (ipcStatusDot && ipcStatusText) {
                  ipcStatusDot.classList.add("active");
                  ipcStatusText.textContent = "Respaldo Transitorio local";
                  ipcStatusText.style.color = "var(--warning)";
                }

                updateCanvasRendering();
              }
            } else {
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

      audioOrchestrator.stopAll();

      if (oscilloscopePanel) {
        oscilloscopePanel.stop();
      }
    });
  }
}

// --- INTERACTIVIDAD INTERNA DEL OSCILOSCOPIO ---

function initOscilloscopeInterface() {
  const oscCh1Btn = document.querySelector("#osc-ch1-btn") as HTMLButtonElement | null;
  const oscCh2Btn = document.querySelector("#osc-ch2-btn") as HTMLButtonElement | null;
  const oscPauseBtn = document.querySelector("#osc-pause-btn") as HTMLButtonElement | null;

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

  const exportS2pBtn = document.querySelector("#export-s2p-btn");
  if (exportS2pBtn) {
    exportS2pBtn.addEventListener("click", () => {
      exportarDatosTouchstone();
    });
  }

  const exportH5Btn = document.querySelector("#export-h5-btn");
  if (exportH5Btn) {
    exportH5Btn.addEventListener("click", () => {
      exportarDatosHDF5();
    });
  }

  const exportPdfBtn = document.querySelector("#export-pdf-btn");
  if (exportPdfBtn) {
    exportPdfBtn.addEventListener("click", () => {
      exportarReportePDF();
    });
  }

  const handleProbeActivation = (mode: 'CH1' | 'CH2') => {
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
        oscCh1Btn.classList.toggle("active");
        const node = oscilloscopePanel ? oscilloscopePanel.ch1ProbeNode : ch1ProbeNode;
        addLog(`Canal 1 (Sonda en Nodo ${node}) ${oscCh1Btn.classList.contains('active') ? 'visible' : 'oculto'}.`, "system");
        if (oscilloscopePanel && !oscilloscopePanel.isSimulating) {
          oscilloscopePanel.draw();
        }
      }
    });
  }

  if (oscCh2Btn) {
    oscCh2Btn.addEventListener("click", (e) => {
      if (e.shiftKey) {
        handleProbeActivation('CH2');
      } else {
        oscCh2Btn.classList.toggle("active");
        const node = oscilloscopePanel ? oscilloscopePanel.ch2ProbeNode : ch2ProbeNode;
        addLog(`Canal 2 (Sonda en Nodo ${node}) ${oscCh2Btn.classList.contains('active') ? 'visible' : 'oculto'}.`, "system");
        if (oscilloscopePanel && !oscilloscopePanel.isSimulating) {
          oscilloscopePanel.draw();
        }
      }
    });
  }

  if (oscPauseBtn) {
    oscPauseBtn.addEventListener("click", () => {
      if (oscilloscopePanel) {
        oscilloscopePanel.isOscPaused = !oscilloscopePanel.isOscPaused;
        oscPauseBtn.classList.toggle("active");
        oscPauseBtn.textContent = oscilloscopePanel.isOscPaused ? "Reanudar" : "Pausar";
        if (oscilloscopePanel.isOscPaused) {
          audioOrchestrator.stopAll();
        }
      }
    });
  }

  setTimeout(() => {
    if (oscilloscopePanel) oscilloscopePanel.draw();
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
      const w = parent.clientWidth;
      const h = parent.clientHeight;
      if (w === 0 || h === 0) {
        setTimeout(resizeCanvas, 100);
        return;
      }
      canvasElement.width = w;
      canvasElement.height = h;
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

      // MODO DE SELECCIÓN DE PUERTOS RF PARA PARÁMETROS S
      if (activeAnalysisMode === 'SPAR' && orchestrator!.hoveredPin) {
        const pinKey = `${orchestrator!.hoveredPin.componentId}:${orchestrator!.hoveredPin.pinIndex}`;
        const nodeId = pinToNodeMap[pinKey];
        if (nodeId !== undefined && !sparPorts.some(p => p.nodeId === nodeId)) {
          sparPorts.push({ nodeId, z0: 50 });
          addLog(`Puerto RF ${sparPorts.length} asignado al Nodo ${nodeId} (Z0 = 50 Ω).`, 'system');
          updateCanvasRendering();
          return;
        } else if (nodeId !== undefined) {
          addLog(`El Nodo ${nodeId} ya está asignado como puerto RF.`, 'system');
          return;
        }
      }

      // Modo normal de CAD
      if (orchestrator!.hoveredPin) {
        orchestrator!.activePinForWire = orchestrator!.hoveredPin;
        orchestrator!.tempWireEnd = orchestrator!.snapPointToGrid(worldPt);
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
            orchestrator!.selectionStart = orchestrator!.snapPointToGrid(worldPt);
            orchestrator!.selectionEnd = orchestrator!.snapPointToGrid(worldPt);
            mcuDebugPanel?.hide();
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
      orchestrator!.selectionEnd = orchestrator!.snapPointToGrid(worldPt);
    }

    if (orchestrator!.activePinForWire) {
      orchestrator!.tempWireEnd = orchestrator!.snapPointToGrid(worldPt);
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
        extractElectricalNetlist();
        addLog(`Cable conectado: [${orchestrator!.activePinForWire.componentId}] terminal ${orchestrator!.activePinForWire.pinIndex} a [${orchestrator!.hoveredPin.componentId}] terminal ${orchestrator!.hoveredPin.pinIndex}`, "system");
        markCurrentTabAsModified();
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

    if (orchestrator!.isDragging) {
      markCurrentTabAsModified();
    }

    orchestrator!.stopDragging();
    extractElectricalNetlist();
    isRightClickPanning = false;
    updateCanvasRendering();
  };

  canvasElement.addEventListener("mouseup", completeConnection);
  canvasElement.addEventListener("mouseleave", completeConnection);

  canvasElement.addEventListener("contextmenu", (e) => e.preventDefault());

  // Doble clic para interactuar con componentes en caliente (Switch)
  canvasElement.addEventListener("dblclick", async (e) => {
    const rect = canvasElement.getBoundingClientRect();
    const screenX = e.clientX - rect.left;
    const screenY = e.clientY - rect.top;
    const worldPt = orchestrator!.screenToWorld(screenX, screenY);
    const comp = orchestrator!.selectComponentAt(worldPt.x, worldPt.y);

    if (comp && comp.type === 'switch') {
      comp.switchState = !(comp.switchState ?? false);
      if (isSimulationActive()) {
        try {
          await invoke('inject_live_mutation', {
            mutation: {
              componentId: comp.id,
              field: 'switch_state',
              value: comp.switchState ? 1.0 : 0.0,
            }
          });
          addLog(`Switch [${comp.id}] → ${comp.switchState ? 'Cerrado' : 'Abierto'} (mutación en caliente)`, "system");
        } catch (err) {
          addLog(`Error al mutar switch: ${err}`, "error");
        }
      }
      updateCanvasRendering();
      markCurrentTabAsModified();
    }
  });

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

          const snapped = orchestrator!.snapPointToGrid(worldPt);
          const newComp = orchestrator!.addComponent(type, snapped.x, snapped.y, value);
          extractElectricalNetlist();
          addLog(`Componente colocado: [${newComp.id}] en (X:${newComp.x}, Y:${newComp.y})`, "system");
          
          orchestrator!.selectedComponent = newComp;
          updatePropertiesPanel(newComp);
          updateCanvasRendering();
          markCurrentTabAsModified();
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
      markCurrentTabAsModified();
    } else if (e.key === "Delete" || e.key === "Backspace") {
      if (orchestrator.selectedWire) {
        addLog(`Cable [${orchestrator.selectedWire.id}] eliminado de forma individual.`, "system");
      } else if (orchestrator.selectedComponents.length > 0) {
        addLog(`Lote de ${orchestrator.selectedComponents.length} componentes eliminado del lienzo.`, "system");
      } else if (orchestrator.selectedComponent) {
        addLog(`Componente [${orchestrator.selectedComponent.id}] eliminado del lienzo.`, "system");
      }
      
      orchestrator.removeSelected();
      extractElectricalNetlist();
      updateCanvasRendering();
      markCurrentTabAsModified();
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
      if (oscilloscopePanel) {
        oscilloscopePanel.transientResults = [];
        oscilloscopePanel.acSweepResults = null;
        oscilloscopePanel.sweepTime = 0.0;
      }
      updateCanvasRendering();
      markCurrentTabAsModified();
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

  const btnSnapGrid = document.querySelector("#btn-snap-grid") as HTMLButtonElement | null;
  if (btnSnapGrid && orchestrator) {
    // snapEnabled: true by default (matches btn-active class in HTML)
    let snapEnabled = true;
    btnSnapGrid.addEventListener("click", () => {
      snapEnabled = !snapEnabled;
      btnSnapGrid.classList.toggle("btn-active", snapEnabled);
      // Override gridSize to 1 (no snap) or 20 (full snap)
      (orchestrator as any).gridSize = snapEnabled ? 20 : 1;
      addLog(snapEnabled ? "Alineación a rejilla activada." : "Alineación a rejilla desactivada.", "system");
    });
  }
}

// --- CARGA GENERAL DEL DOM ---



window.addEventListener("DOMContentLoaded", () => {
  consoleOutput = document.querySelector("#console-output");
  clearConsoleBtn = document.querySelector("#clear-console-btn");

  // Instanciar submódulos de UI modularizados
  telemetryPanel = new TelemetryPanel();
  telemetryPanel.start();

  new SettingsModal(simSettings, (newSettings) => {
    simSettings = { ...newSettings };
    addLog(`Ajustes guardados: dt=${simSettings.dt}, tol=${simSettings.tolerance}, iterMax=${simSettings.maxIterations}`, "system");
  });

  oscilloscopePanel = new OscilloscopePanel();
  oscilloscopePanel.onFrameUpdate = (sweepTime) => {
    if (oscilloscopePanel && orchestrator) {
      const results = oscilloscopePanel.transientResults;
      if (results && results.length > 0) {
        let closestIdx = 0;
        let minDiff = Infinity;
        for (let i = 0; i < results.length; i++) {
          const diff = Math.abs(results[i].time - sweepTime);
          if (diff < minDiff) {
            minDiff = diff;
            closestIdx = i;
          }
        }
        const closest = results[closestIdx];
        if (closest) {
          liveVoltages = closest.nodeVoltages;

          // Sincronizar estados lógicos de los pines de MCUs y depurador en playback
          for (const comp of orchestrator.components) {
            if (comp.type === 'mcu_8051' || comp.type === 'mcu_avr' || comp.type === 'arduino_uno' || comp.type === 'esp32' || comp.type === 'raspberry_pi_pico') {
              const pins = orchestrator.getComponentPins(comp);
              const pinStates: Record<number, number | string> = {};
              const vCC = (comp.type === 'mcu_8051' || comp.type === 'arduino_uno') ? 5.0 : 3.3;
              
              pins.forEach((_, pinIdx) => {
                const nodeKey = pinToNodeMap[`${comp.id}:${pinIdx}`];
                if (nodeKey) {
                  const volt = liveVoltages[nodeKey] ?? 0.0;
                  if (volt > 0.7 * vCC) {
                    pinStates[pinIdx] = 1;
                  } else if (volt < 0.3 * vCC) {
                    pinStates[pinIdx] = 0;
                  } else {
                    pinStates[pinIdx] = 'Z';
                  }
                } else {
                  pinStates[pinIdx] = 'Z';
                }
              });
              comp.mcuPinStates = pinStates;

              // Sincronizar runtime del MCU si está seleccionado y cargado
              if (orchestrator.selectedComponent?.id === comp.id && comp.mcuRuntime) {
                const clockSpeed = comp.type === 'mcu_avr' ? 16e6 : 12e6;
                const targetCycle = Math.round(sweepTime * clockSpeed);
                if (comp.mcuRuntime.state.cycle < targetCycle) {
                  const diff = targetCycle - comp.mcuRuntime.state.cycle;
                  runCycles(comp.mcuRuntime, Math.min(diff, 200000));
                } else if (comp.mcuRuntime.state.cycle > targetCycle) {
                  resetRuntime(comp.mcuRuntime);
                  runCycles(comp.mcuRuntime, Math.min(targetCycle, 200000));
                }
                mcuDebugPanel?.updateData();
              }
            }
          }

          for (const comp of orchestrator.components) {
            const hist = actuatorHistory.history.get(comp.id);
            if (hist && hist[closestIdx]) {
              comp.glowLevel = hist[closestIdx].glowLevel;
              comp.relayClosed = hist[closestIdx].relayClosed;
              comp.buzzerLevel = hist[closestIdx].buzzerLevel;

              if (comp.type === 'buzzer') {
                const model = parseBuzzerActuatorModel(comp.value?.toString() ?? "");
                const level = comp.buzzerLevel ?? 0;
                if (level > 0.05) {
                  audioOrchestrator.updateBuzzer(comp.id, model.resonantFrequencyHz, level);
                } else {
                  audioOrchestrator.stopBuzzer(comp.id);
                }
              }
            }
          }
        }
      }
    }
    updateCanvasRendering();
  };

  initSidebars();
  initPropertyEditor();

  const rightPanelBody = document.querySelector("#sidebar-right .panel-body") as HTMLElement;
  if (rightPanelBody) {
    mcuDebugPanel = new McuDebugPanel(rightPanelBody, () => {
      updateCanvasRendering();
    });
  }
  initSimulationControls();
  initOscilloscopeInterface();
  
  initCanvasCAD();
  initFilePersistence();
  initTabManager();

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

  const acResults = oscilloscopePanel ? oscilloscopePanel.acSweepResults : null;
  const tranResults = oscilloscopePanel ? oscilloscopePanel.transientResults : [];
  const ch1Node = oscilloscopePanel ? oscilloscopePanel.ch1ProbeNode : ch1ProbeNode;
  const ch2Node = oscilloscopePanel ? oscilloscopePanel.ch2ProbeNode : ch2ProbeNode;

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

  const acResults = oscilloscopePanel ? oscilloscopePanel.acSweepResults : null;
  const tranResults = oscilloscopePanel ? oscilloscopePanel.transientResults : [];
  const ch1Node = oscilloscopePanel ? oscilloscopePanel.ch1ProbeNode : ch1ProbeNode;
  const ch2Node = oscilloscopePanel ? oscilloscopePanel.ch2ProbeNode : ch2ProbeNode;

  if (activeAnalysisMode === 'AC' && acResults !== null && acResults.frequencies.length > 0) {
    filename = "grafico_bode_ca.svg";
    const freqs = acResults.frequencies;
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

    if (ch1Node) {
      let pathStr = "";
      const amps = acResults.nodeAmplitudes[ch1Node];
      if (amps) {
        for (let i = 0; i < freqs.length; i++) {
          const x = 50 + ((Math.log10(freqs[i]) - logMin) / (logMax - logMin)) * 700;
          const y = 50 + 300 * (1.0 - (amps[i] - (-80)) / (20 - (-80)));
          pathStr += (i === 0 ? "M " : "L ") + `${x} ${y} `;
        }
        svgContent += `<path d="${pathStr}" fill="none" stroke="#66fcf1" stroke-width="2.5" />`;
      }
    }

    if (ch2Node) {
      let pathStr = "";
      const amps = acResults.nodeAmplitudes[ch2Node];
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

  } else if ((activeAnalysisMode === 'TRAN' || activeAnalysisMode === 'PSS') && tranResults.length > 0) {
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
      for (let i = 0; i < tranResults.length; i++) {
        const pt = tranResults[i];
        const x = 50 + (pt.time / transientDuration) * 700;
        const volt = pt.nodeVoltages[nodeId] ?? 0.0;
        const y = 200 - volt * (300 * 0.08);
        pathStr += (i === 0 ? "M " : "L ") + `${x} ${y} `;
      }
      return pathStr;
    };

    if (ch1Node) {
      svgContent += `<path d="${getTransientPath(ch1Node)}" fill="none" stroke="#66fcf1" stroke-width="2.5" />`;
    }
    if (ch2Node) {
      svgContent += `<path d="${getTransientPath(ch2Node)}" fill="none" stroke="#a855f7" stroke-width="2.0" />`;
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

function exportarDatosTouchstone() {
  const acResults = (oscilloscopePanel as any) ? (oscilloscopePanel as any).acSweepResults : null;
  const ch1Node = (oscilloscopePanel as any) ? (oscilloscopePanel as any).ch1ProbeNode : ch1ProbeNode;
  const ch2Node = (oscilloscopePanel as any) ? (oscilloscopePanel as any).ch2ProbeNode : ch2ProbeNode;

  if (activeAnalysisMode !== 'AC' || !acResults || acResults.frequencies.length === 0) {
    addLog("Realiza un análisis de Barrido CA (AC Sweep) antes de exportar datos Touchstone.", "error");
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
  addLog("Datos de Barrido CA exportados a formato Touchstone (.s2p) exitosamente.", "receive");
}

function exportarDatosHDF5() {
  const acResults = (oscilloscopePanel as any) ? (oscilloscopePanel as any).acSweepResults : null;
  const tranResults = (oscilloscopePanel as any) ? (oscilloscopePanel as any).transientResults : [];
  const ch1Node = (oscilloscopePanel as any) ? (oscilloscopePanel as any).ch1ProbeNode : ch1ProbeNode;
  const ch2Node = (oscilloscopePanel as any) ? (oscilloscopePanel as any).ch2ProbeNode : ch2ProbeNode;

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
    const nodes = Object.keys(liveVoltages);
    const voltages = new Float64Array(Object.values(liveVoltages));
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

  dataView.setUint32(8, finalJsonLen, true);
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
  addLog(`Datos binarios exportados a formato HDF5 Lite (.h5) en ${filename}`, "receive");
}

async function getCanvasWithBackground(canvasId: string, backgroundColor: string): Promise<string> {
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

async function exportarReportePDF() {
  const { jsPDF } = await import("jspdf");
  addLog("Generando reporte PDF profesional con gráficos vectoriales...", "system");
  
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
    
    const ch1Node = (oscilloscopePanel as any) ? (oscilloscopePanel as any).ch1ProbeNode : ch1ProbeNode;
    const ch2Node = (oscilloscopePanel as any) ? (oscilloscopePanel as any).ch2ProbeNode : ch2ProbeNode;
    doc.text(`Canal 1 (Sonda): Nodo ${ch1Node ?? "No Conectada"}`, 25, 67);
    doc.text(`Canal 2 (Sonda): Nodo ${ch2Node ?? "No Conectada"}`, 25, 73);

    const circuitImg = await getCanvasWithBackground("circuit-canvas", "#0c101b");
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

    const oscImg = await getCanvasWithBackground("osc-canvas", "#030508");
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
    addLog("Reporte científico PDF descargado exitosamente.", "receive");
  } catch (err: any) {
    console.error("Error al exportar PDF:", err);
    addLog(`Error al exportar PDF: ${err.message || err}`, "error");
  }
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
    if (oscilloscopePanel) {
      oscilloscopePanel.transientResults = [];
      oscilloscopePanel.acSweepResults = null;
      oscilloscopePanel.sweepTime = 0.0;
    }

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

    orchestrator!.syncWireConnections();

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
      const modeButtons = [analysisDcBtn, analysisAcBtn, analysisTranBtn, analysisSensBtn, analysisPssBtn, analysisStbBtn, analysisPvtBtn, analysisSparBtn];
      modeButtons.forEach(btn => btn?.classList.remove('active'));
      if (activeAnalysisMode === 'DC' && analysisDcBtn) analysisDcBtn.classList.add('active');
      if (activeAnalysisMode === 'AC' && analysisAcBtn) analysisAcBtn.classList.add('active');
      if (activeAnalysisMode === 'TRAN' && analysisTranBtn) analysisTranBtn.classList.add('active');
      if (activeAnalysisMode === 'SENS' && analysisSensBtn) analysisSensBtn.classList.add('active');
      if (activeAnalysisMode === 'PSS' && analysisPssBtn) analysisPssBtn.classList.add('active');
      if (activeAnalysisMode === 'STB' && analysisStbBtn) analysisStbBtn.classList.add('active');
      if (activeAnalysisMode === 'PVT' && analysisPvtBtn) analysisPvtBtn.classList.add('active');
      if (activeAnalysisMode === 'SPAR' && analysisSparBtn) analysisSparBtn.classList.add('active');
    }

    // 7. Restaurar asignaciones de osciloscopio
    if (data.probes) {
      ch1ProbeNode = data.probes.ch1ProbeNode || null;
      ch2ProbeNode = data.probes.ch2ProbeNode || null;
      if (oscilloscopePanel) {
        oscilloscopePanel.ch1ProbeNode = ch1ProbeNode;
        oscilloscopePanel.ch2ProbeNode = ch2ProbeNode;
      }
    }

    // Actualizar renderizado y recalcular nodos eléctricos
    extractElectricalNetlist();
    updateCanvasRendering();
    if (oscilloscopePanel) oscilloscopePanel.draw();

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
      createNewTab();
    });
  }

  const btnOpenCircuit = document.querySelector("#btn-open-circuit");
  if (btnOpenCircuit) {
    btnOpenCircuit.addEventListener("click", async () => {
      addLog("Abriendo diálogo para cargar archivo esquemático...", "system");
      try {
        const result = await invoke<[string, string]>("open_circuit_file");
        if (result && Array.isArray(result)) {
          const [filePath, content] = result;
          
          // Verificar si la pestaña activa está limpia/vacía
          const currentTab = tabs.find(t => t.id === activeTabId);
          const isEmpty = currentTab && 
                          currentTab.components.length === 0 && 
                          currentTab.wires.length === 0 && 
                          currentTab.filePath === null && 
                          !currentTab.unsaved;
          
          let tabToLoad: Tab;
          const filename = filePath.split(/[/\\]/).pop() || "esquematico.astryd";
          
          if (isEmpty && currentTab) {
            tabToLoad = currentTab;
            tabToLoad.name = filename;
            tabToLoad.filePath = filePath;
          } else {
            tabToLoad = createNewTab(filename, { components: [], wires: [], filePath });
          }

          const success = deserializeCircuit(content);
          if (success) {
            tabToLoad.filePath = filePath;
            tabToLoad.unsaved = false;
            renderTabsBar();
            addLog(`Esquemático [${tabToLoad.name}] cargado con éxito.`, "receive");
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
    btnSaveCircuit.addEventListener("click", () => {
      saveCircuitDirect();
    });
  }
}

// --- GESTOR DE PESTAÑAS (WORKSPACE TABS) ---

function createNewTab(name?: string, initialData?: { components: any[], wires: any[], filePath: string | null }): Tab {
  const tabId = Math.random().toString(36).substring(2, 9);
  const tabName = name || `Circuito ${tabs.length + 1}`;
  
  const newTab: Tab = {
    id: tabId,
    name: tabName,
    components: initialData?.components || [],
    wires: initialData?.wires || [],
    zoom: 1.0,
    offsetX: 0,
    offsetY: 0,
    filePath: initialData?.filePath || null,
    unsaved: false,
    transientResults: [],
    acSweepResults: null,
    ch1ProbeNode: "1",
    ch2ProbeNode: "2",
    activeAnalysisMode: 'DC'
  };

  tabs.push(newTab);
  switchTab(tabId);
  return newTab;
}

function switchTab(tabId: string) {
  if (activeTabId === tabId) return;

  // 1. Guardar el estado del tab actual
  if (activeTabId && orchestrator) {
    const currentTab = tabs.find(t => t.id === activeTabId);
    if (currentTab) {
      currentTab.components = JSON.parse(JSON.stringify(orchestrator.components));
      currentTab.wires = JSON.parse(JSON.stringify(orchestrator.wires));
      currentTab.zoom = orchestrator.zoom;
      currentTab.offsetX = orchestrator.offsetX;
      currentTab.offsetY = orchestrator.offsetY;
      currentTab.activeAnalysisMode = activeAnalysisMode;
      currentTab.ch1ProbeNode = ch1ProbeNode;
      currentTab.ch2ProbeNode = ch2ProbeNode;
      if (oscilloscopePanel) {
        currentTab.transientResults = oscilloscopePanel.transientResults;
        currentTab.acSweepResults = oscilloscopePanel.acSweepResults;
      }
    }
  }

  // 2. Cargar el estado del nuevo tab activo
  activeTabId = tabId;
  const targetTab = tabs.find(t => t.id === tabId);
  if (targetTab && orchestrator) {
    // Resetear selecciones del lienzo para evitar fantasmas
    orchestrator.selectedComponent = null;
    orchestrator.selectedComponents = [];
    orchestrator.selectedWire = null;
    orchestrator.activePinForWire = null;
    orchestrator.tempWireEnd = null;
    orchestrator.selectionStart = null;
    orchestrator.selectionEnd = null;

    // Volcar componentes y cables
    orchestrator.components = JSON.parse(JSON.stringify(targetTab.components));
    orchestrator.wires = JSON.parse(JSON.stringify(targetTab.wires));
    orchestrator.zoom = targetTab.zoom;
    orchestrator.offsetX = targetTab.offsetX;
    orchestrator.offsetY = targetTab.offsetY;

    activeAnalysisMode = targetTab.activeAnalysisMode;
    ch1ProbeNode = targetTab.ch1ProbeNode;
    ch2ProbeNode = targetTab.ch2ProbeNode;

    // Refrescar los botones de control de análisis en la cabecera
    const modeButtons = [analysisDcBtn, analysisAcBtn, analysisTranBtn, analysisSensBtn, analysisPssBtn, analysisStbBtn, analysisPvtBtn, analysisSparBtn];
    modeButtons.forEach(btn => btn?.classList.remove('active'));
    if (activeAnalysisMode === 'DC' && analysisDcBtn) analysisDcBtn.classList.add('active');
    if (activeAnalysisMode === 'AC' && analysisAcBtn) analysisAcBtn.classList.add('active');
    if (activeAnalysisMode === 'TRAN' && analysisTranBtn) analysisTranBtn.classList.add('active');
    if (activeAnalysisMode === 'SENS' && analysisSensBtn) analysisSensBtn.classList.add('active');
    if (activeAnalysisMode === 'PSS' && analysisPssBtn) analysisPssBtn.classList.add('active');
    if (activeAnalysisMode === 'STB' && analysisStbBtn) analysisStbBtn.classList.add('active');
    if (activeAnalysisMode === 'PVT' && analysisPvtBtn) analysisPvtBtn.classList.add('active');
    if (activeAnalysisMode === 'SPAR' && analysisSparBtn) analysisSparBtn.classList.add('active');

    // Refrescar el Osciloscopio
    if (oscilloscopePanel) {
      oscilloscopePanel.activeAnalysisMode = activeAnalysisMode;
      oscilloscopePanel.ch1ProbeNode = ch1ProbeNode;
      oscilloscopePanel.ch2ProbeNode = ch2ProbeNode;
      oscilloscopePanel.transientResults = targetTab.transientResults;
      oscilloscopePanel.acSweepResults = targetTab.acSweepResults;
      oscilloscopePanel.sweepTime = 0.0;
      oscilloscopePanel.pvtMode = false;
      oscilloscopePanel.pvtTraces = [];
      oscilloscopePanel.sparResult = null;
    }
    sparPorts = [];
    document.querySelectorAll('.pvt-profile-btn').forEach(el => el.remove());

    // Actualizar netlist eléctrico y dibujo
    extractElectricalNetlist();
    updateCanvasRendering();
    if (oscilloscopePanel) oscilloscopePanel.draw();

    // Sincronizar depuración MCU
    if (mcuDebugPanel) {
      mcuDebugPanel.hide();
    }
  }

  renderTabsBar();
}

async function closeTab(tabId: string) {
  const tabIndex = tabs.findIndex(t => t.id === tabId);
  if (tabIndex === -1) return;

  const targetTab = tabs[tabIndex];

  // Si tiene cambios no guardados, solicitar confirmación
  if (targetTab.unsaved) {
    const confirmClose = confirm(`La pestaña "${targetTab.name}" tiene cambios no guardados. ¿Deseas cerrarla de todas formas?`);
    if (!confirmClose) return;
  }

  tabs.splice(tabIndex, 1);

  if (activeTabId === tabId) {
    if (tabs.length > 0) {
      const nextActiveIdx = Math.max(0, tabIndex - 1);
      activeTabId = null; // Evitar que switchTab guarde el estado del tab borrado
      switchTab(tabs[nextActiveIdx].id);
    } else {
      activeTabId = null;
      if (orchestrator) {
        orchestrator.components = [];
        orchestrator.wires = [];
      }
      createNewTab("Circuito 1");
    }
  } else {
    renderTabsBar();
  }
}

function renderTabsBar() {
  const container = document.querySelector("#tabs-container");
  if (!container) return;

  container.innerHTML = "";

  tabs.forEach(tab => {
    const tabEl = document.createElement("div");
    tabEl.className = `tab-item${tab.id === activeTabId ? " active" : ""}`;
    tabEl.setAttribute("data-id", tab.id);

    const nameSpan = document.createElement("span");
    nameSpan.textContent = tab.name;
    tabEl.appendChild(nameSpan);

    if (tab.unsaved) {
      const dot = document.createElement("span");
      dot.className = "tab-unsaved";
      tabEl.appendChild(dot);
    }

    const closeBtn = document.createElement("button");
    closeBtn.className = "tab-close";
    closeBtn.innerHTML = "&times;";
    closeBtn.type = "button";
    closeBtn.title = "Cerrar pestaña";
    closeBtn.addEventListener("click", (e) => {
      e.stopPropagation();
      closeTab(tab.id);
    });

    tabEl.appendChild(closeBtn);

    tabEl.addEventListener("click", () => {
      switchTab(tab.id);
    });

    container.appendChild(tabEl);
  });
}

function markCurrentTabAsModified() {
  const currentTab = tabs.find(t => t.id === activeTabId);
  if (currentTab && !currentTab.unsaved) {
    currentTab.unsaved = true;
    renderTabsBar();
  }
}

async function saveCircuitDirect() {
  const currentTab = tabs.find(t => t.id === activeTabId);
  if (!currentTab) return;

  if (currentTab.filePath) {
    addLog(`Guardando esquemático directamente en: [${currentTab.filePath}]...`, "system");
    try {
      if (orchestrator) {
        currentTab.components = JSON.parse(JSON.stringify(orchestrator.components));
        currentTab.wires = JSON.parse(JSON.stringify(orchestrator.wires));
        currentTab.zoom = orchestrator.zoom;
        currentTab.offsetX = orchestrator.offsetX;
        currentTab.offsetY = orchestrator.offsetY;
      }

      const jsonStr = serializeCircuit();
      await invoke("save_circuit_to_path", { path: currentTab.filePath, content: jsonStr });
      currentTab.unsaved = false;
      renderTabsBar();
      addLog(`Esquemático guardado con éxito.`, "receive");
    } catch (err) {
      addLog(`Error al guardar esquemático: ${err}`, "error");
    }
  } else {
    saveCircuitAs();
  }
}

async function saveCircuitAs() {
  const currentTab = tabs.find(t => t.id === activeTabId);
  if (!currentTab) return;

  addLog("Abriendo diálogo para guardar esquemático...", "system");
  try {
    if (orchestrator) {
      currentTab.components = JSON.parse(JSON.stringify(orchestrator.components));
      currentTab.wires = JSON.parse(JSON.stringify(orchestrator.wires));
      currentTab.zoom = orchestrator.zoom;
      currentTab.offsetX = orchestrator.offsetX;
      currentTab.offsetY = orchestrator.offsetY;
    }

    const jsonStr = serializeCircuit();
    const savedPath = await invoke<string>("save_circuit_file", { content: jsonStr });
    if (savedPath) {
      currentTab.filePath = savedPath;
      currentTab.name = savedPath.split(/[/\\]/).pop() || "esquematico.astryd";
      currentTab.unsaved = false;
      renderTabsBar();
      addLog(`Esquemático guardado con éxito en: [${savedPath}]`, "receive");
    }
  } catch (err) {
    if (err !== "Operación cancelada por el usuario") {
      addLog(`Error al guardar esquemático: ${err}`, "error");
    } else {
      addLog("Operación de guardado cancelada.", "system");
    }
  }
}

// --- INICIALIZACIONES DE CONTROLES MULTI-WORKSPACE ---

function initTabManager() {
  const btnAddTab = document.querySelector("#btn-add-tab");
  if (btnAddTab) {
    btnAddTab.addEventListener("click", () => {
      createNewTab();
    });
  }

  // Crear primera pestaña por defecto
  createNewTab("Circuito 1");

  // Acordeones de categorías de componentes
  initComponentCategories();

  // Reactividad del buscador
  initComponentSearch();

  // Atajos de teclado para pestañas
  initTabKeyboardShortcuts();
}

function initComponentCategories() {
  const headers = document.querySelectorAll(".category-header");
  headers.forEach(header => {
    header.addEventListener("click", () => {
      const content = header.nextElementSibling as HTMLElement;
      if (content) {
        const isOpen = content.classList.contains("open");
        if (isOpen) {
          content.classList.remove("open");
          header.classList.remove("active");
        } else {
          content.classList.add("open");
          header.classList.add("active");
        }
      }
    });
  });
}

function initComponentSearch() {
  const searchInput = document.querySelector("#component-search") as HTMLInputElement;
  if (!searchInput) return;

  searchInput.addEventListener("input", () => {
    const query = searchInput.value.toLowerCase().trim();
    const categories = document.querySelectorAll(".category-group");

    categories.forEach(group => {
      const header = group.querySelector(".category-header") as HTMLElement;
      const content = group.querySelector(".category-content") as HTMLElement;
      const cards = content.querySelectorAll(".component-card");
      let visibleInGroup = 0;

      cards.forEach(card => {
        const name = (card.querySelector(".comp-name")?.textContent || "").toLowerCase();
        const desc = (card.querySelector(".comp-desc")?.textContent || "").toLowerCase();
        
        if (name.includes(query) || desc.includes(query)) {
          (card as HTMLElement).style.display = "flex";
          visibleInGroup++;
        } else {
          (card as HTMLElement).style.display = "none";
        }
      });

      if (query.length > 0) {
        if (visibleInGroup > 0) {
          (group as HTMLElement).style.display = "block";
          content.classList.add("open");
          header.classList.add("active");
        } else {
          (group as HTMLElement).style.display = "none";
        }
      } else {
        // Restaurar estado por defecto
        (group as HTMLElement).style.display = "block";
        const catName = header.getAttribute("data-category");
        if (catName === "pasivos") {
          content.classList.add("open");
          header.classList.add("active");
        } else {
          content.classList.remove("open");
          header.classList.remove("active");
        }
      }
    });
  });
}

function initTabKeyboardShortcuts() {
  window.addEventListener("keydown", (e) => {
    // Si estamos editando un input, no capturar atajos del workspace
    if (document.activeElement?.tagName === "INPUT" || document.activeElement?.tagName === "SELECT") {
      return;
    }

    // Ctrl + N: Nueva pestaña
    if ((e.ctrlKey || e.metaKey) && e.key === "n") {
      e.preventDefault();
      createNewTab();
    }
    // Ctrl + O: Abrir archivo
    if ((e.ctrlKey || e.metaKey) && e.key === "o") {
      e.preventDefault();
      const openBtn = document.querySelector("#btn-open-circuit") as HTMLElement;
      openBtn?.click();
    }
    // Ctrl + S: Guardar (Ctrl+Shift+S para Guardar Como)
    if ((e.ctrlKey || e.metaKey) && e.key === "s") {
      e.preventDefault();
      if (e.shiftKey) {
        saveCircuitAs();
      } else {
        saveCircuitDirect();
      }
    }
    // Ctrl + W: Cerrar pestaña activa
    if ((e.ctrlKey || e.metaKey) && e.key === "w") {
      e.preventDefault();
      if (activeTabId) {
        closeTab(activeTabId);
      }
    }
  });
}
