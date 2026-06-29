import { safeInvoke as invoke } from "./simulation/tauri_mock";
import { CanvasOrchestrator, ComponentInstance, Point2D } from "./canvas_orchestrator";
import { TelemetryPanel } from "./ui/telemetry_panel";
import { SettingsModal, SimulationSettings } from "./ui/settings_modal";
import { OscilloscopePanel, TimeStepResult, PvtRunResult, PvtTrace } from "./ui/oscilloscope_panel";
import { parseBuzzerActuatorModel } from "./ui/actuator_helpers";
import { extractElectricalNetlist, type CircuitNetlist } from "./simulation/netlist_extractor";
import { McuDebugPanel } from "./ui/mcu_debug_panel";
import {
  runCycles,
  resetRuntime,
  PVT_PROFILE_COMMERCIAL,
  PVT_PROFILE_INDUSTRIAL,
  PVT_PROFILE_AUTOMOTIVE,
  type PvtConfig,
  type SParameterResult,
  type SParameterSettings,
  type PortDefinition,
} from "./simulation";
import { solveCircuitTS, solveTransientCircuitTS } from "./simulation/fallback_solver";
import { createSimulationRunner, type SimulationRunner } from "./simulation/simulation_runner";
import { initSimulationControls, type SimulationControls } from "./ui/simulation_controls";
import { runElectricalRuleCheck, dispatchSimulation } from "./simulation/simulation_dispatcher";
import { createCircuitStateManager } from "./simulation/circuit_state_manager";
import { attachCanvasInput, attachCanvasDrop } from "./canvas/canvas_input_controller";
import { isTypingInFormField } from "./canvas/keyboard_guards";
// Variables Globales del Estado — centralizadas en CircuitStateManager
const circuitState = createCircuitStateManager();

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
// (centralizado en circuitState.getVoltageMap())

// Mapa de correspondencia entre cada terminal física y su nodo eléctrico resuelto
// (centralizado en circuitState.getPinToNodeMap())

// --- ESTADOS DE SONDAS E INSTRUMENTACIÓN DEL OSCILOSCOPIO ---
let probePlacementMode: 'CH1' | 'CH2' | null = null;

// --- ESTADO DE SELECCIÓN DE PUERTOS RF PARA PARÁMETROS S ---
let sparPorts: { nodeId: string; z0: number }[] = [];
let sparFStart = 10.0;
let sparFEnd = 100000.0;
let sparPPD = 20;
let ch1ProbeNode: string | null = "1"; // Canal 1 por defecto al Nodo 1
let ch2ProbeNode: string | null = "2"; // Canal 2 por defecto al Nodo 2

let renderFramePending = false;

function doCanvasRender(): void {
  const pinVoltageMap = circuitState.buildPinVoltageMap();

  let ch1PinPos: Point2D | undefined;
  let ch2PinPos: Point2D | undefined;

  const ch1Node = oscilloscopePanel ? oscilloscopePanel.ch1ProbeNode : ch1ProbeNode;
  const ch2Node = oscilloscopePanel ? oscilloscopePanel.ch2ProbeNode : ch2ProbeNode;

  if (orchestrator) {
    const sparMarkers: { index: number; x: number; y: number }[] = [];
    for (const sp of sparPorts) {
      for (const comp of orchestrator.components) {
        const pins = orchestrator.getComponentPins(comp);
        for (const pin of pins) {
          const pinKey = `${comp.id}:${pin.pinIndex}`;
          const nodeId = circuitState.getPinNode(pinKey);
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
        const nodeId = circuitState.getPinNode(pinKey);
        if (nodeId === ch1Node && !ch1PinPos) {
          ch1PinPos = { x: pin.x, y: pin.y };
        }
        if (nodeId === ch2Node && !ch2PinPos) {
          ch2PinPos = { x: pin.x, y: pin.y };
        }
      }
    }
    orchestrator.render(
      pinVoltageMap,
      { ch1: ch1PinPos, ch2: ch2PinPos },
      circuitState.getPinToNodeMap(),
      sparMarkers.length > 0 ? sparMarkers : undefined,
    );
  }
}

function updateCanvasRendering(immediate = false): void {
  if (immediate) {
    renderFramePending = false;
    doCanvasRender();
    return;
  }
  if (renderFramePending) return;
  renderFramePending = true;
  requestAnimationFrame(() => {
    renderFramePending = false;
    doCanvasRender();
  });
}

// Instancia global del runner de simulación interactiva
let simulationRunner: SimulationRunner | null = null;
let simulationControls: SimulationControls | null = null;

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
        if (simulationRunner?.isSimulationActive() ?? false) {
          const mutations: { componentId: string; field: string; value: number }[] = [];
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
// Adaptador puro: convierte el estado global del orchestrator en la
// netlist eléctrica y actualiza el mapa de terminales a nodos.

function extractNetlist(): CircuitNetlist | null {
  if (!orchestrator) return null;
  const result = extractElectricalNetlist(
    orchestrator.components,
    orchestrator.wires,
    (c) => orchestrator!.getComponentPins(c),
  );
  circuitState.setPinToNodeMap(result.pinToNodeMap);
  return result.netlist;
}

// --- WRAPPER LOCAL PARA EL SOLVER TRANSITORIO DE RESPALDO ---
// Extrae los firmwares del orchestrator global y los pasa como
// parámetro explícito a la función pura de fallback_solver.

function solveTransientCircuitLocal(netlist: CircuitNetlist, dt: number, tMax: number): TimeStepResult[] | string {
  const firmware: Record<string, Uint8Array> = {};
  if (orchestrator) {
    for (const comp of orchestrator.components) {
      if (comp.firmware) firmware[comp.id] = comp.firmware;
    }
  }
  return solveTransientCircuitTS(netlist, dt, tMax, firmware);
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
    const netlist = extractNetlist();
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
          circuitState.audioOrchestrator.stopAll();
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

  attachCanvasInput(canvasElement, orchestrator, {
    requestRender: (immediate) => updateCanvasRendering(immediate),
    onWireConnected: () => {
      extractNetlist();
      addLog(
        `Cable conectado entre terminales del lienzo.`,
        "system",
      );
    },
    onCanvasModified: () => markCurrentTabAsModified(),
    onNetlistSync: () => extractNetlist(),
    onSelectionChanged: (comp) => {
      if (comp) updatePropertiesPanel(comp);
    },
    getPinNode: (pinKey) => circuitState.getPinNode(pinKey),
    log: (text, type = "system") => addLog(text, type),
    getProbePlacementMode: () => probePlacementMode,
    clearProbePlacementMode: () => { probePlacementMode = null; },
    onProbePlaced: (channel, nodeId) => {
      if (channel === "CH1") {
        ch1ProbeNode = nodeId;
        addLog(`Sonda del Canal 1 (Cian) conectada al Nodo ${nodeId}.`, "system");
      } else {
        ch2ProbeNode = nodeId;
        addLog(`Sonda del Canal 2 (Morada) conectada al Nodo ${nodeId}.`, "system");
      }
    },
    getActiveAnalysisMode: () => activeAnalysisMode,
    onSparPortAssign: (nodeId) => {
      if (sparPorts.some(p => p.nodeId === nodeId)) {
        addLog(`El Nodo ${nodeId} ya está asignado como puerto RF.`, "system");
        return false;
      }
      sparPorts.push({ nodeId, z0: 50 });
      addLog(`Puerto RF ${sparPorts.length} asignado al Nodo ${nodeId} (Z0 = 50 Ω).`, "system");
      return true;
    },
    onSwitchDoubleClick: async (comp) => {
      comp.switchState = !(comp.switchState ?? false);
      if (simulationRunner?.isSimulationActive() ?? false) {
        try {
          await invoke("inject_live_mutation", {
            mutation: {
              componentId: comp.id,
              field: "switch_state",
              value: comp.switchState ? 1.0 : 0.0,
            },
          });
          addLog(
            `Switch [${comp.id}] → ${comp.switchState ? "Cerrado" : "Abierto"} (mutación en caliente)`,
            "system",
          );
        } catch (err) {
          addLog(`Error al mutar switch: ${err}`, "error");
        }
      }
    },
    onHideMcuDebug: () => mcuDebugPanel?.hide(),
    onComponentPlaced: (comp) => {
      updatePropertiesPanel(comp);
    },
  });

  const canvasViewport = document.querySelector("#canvas-viewport") as HTMLElement;
  if (canvasViewport) {
    attachCanvasDrop(canvasViewport, canvasElement, orchestrator, {
      requestRender: (immediate) => updateCanvasRendering(immediate),
      onNetlistSync: () => extractNetlist(),
      onCanvasModified: () => markCurrentTabAsModified(),
      onComponentPlaced: (comp) => updatePropertiesPanel(comp),
      log: (text, type = "system") => addLog(text, type),
    });
  }

  const toolboxCards = document.querySelectorAll(".component-card");
  toolboxCards.forEach(card => {
    card.addEventListener("dragstart", (e) => {
      const htmlEvent = e as DragEvent;
      const type = card.getAttribute("data-type") || "resistor";
      const defaultValue = card.getAttribute("data-default") || "1000";
      htmlEvent.dataTransfer?.setData("text/plain", JSON.stringify({ type, value: parseFloat(defaultValue) }));
    });
  });

  // Zoom In/Out & Clear floating buttons
  const btnClearCanvas = document.querySelector("#btn-clear-canvas");
  if (btnClearCanvas) {
    btnClearCanvas.addEventListener("click", () => {
      orchestrator!.components = [];
      orchestrator!.wires = [];
      orchestrator!.selectedComponent = null;
      circuitState.clearVoltages();
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

  // Inicializar el runner de simulación interactiva con callbacks
  // que desacoplan el motor del DOM/UI/Canvas.
  simulationRunner = createSimulationRunner({
    onFrameReceived: (frame) => {
      circuitState.setVoltagesFromFrame(frame);

      if (oscilloscopePanel) {
        oscilloscopePanel.transientResults.push({
          time: frame.time,
          nodeVoltages: { ...frame.nodeVoltages } as Record<string, number>,
          branchCurrents: { ...frame.branchCurrents } as Record<string, number>,
        });
      }

      updateCanvasRendering();

      if (frame.isFinal) {
        addLog(`Simulación interactiva completada en t = ${frame.time.toFixed(6)} s.`, 'receive');
        if (oscilloscopePanel) {
          circuitState.actuatorHistory.precompute(orchestrator!.components, oscilloscopePanel.transientResults, { ...circuitState.getPinToNodeMap() });
        }
      }
    },
    onSimulationError: (error) => {
      addLog(`Error en simulación: ${error}`, 'error');
      simulationRunner?.stopInteractiveTransient();
    },
    onSimulationComplete: (finalTime) => {
      addLog(`Simulación completada en t = ${finalTime.toFixed(6)} s.`, 'receive');
    },
    onSimulationStateChanged: (active) => {
      if (orchestrator) orchestrator.simulationActive = active;
    },
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
          circuitState.setVoltagesFromSnapshot(closest.nodeVoltages);

          // Sincronizar estados lógicos de los pines de MCUs y depurador en playback
          for (const comp of orchestrator.components) {
            if (comp.type === 'mcu_8051' || comp.type === 'mcu_avr' || comp.type === 'arduino_uno' || comp.type === 'esp32' || comp.type === 'raspberry_pi_pico') {
              const pins = orchestrator.getComponentPins(comp);
              const pinStates: Record<number, number | string> = {};
              const vCC = (comp.type === 'mcu_8051' || comp.type === 'arduino_uno') ? 5.0 : 3.3;
              
              pins.forEach((_, pinIdx) => {
                const nodeKey = circuitState.getPinNode(`${comp.id}:${pinIdx}`);
                if (nodeKey) {
                  const volt = circuitState.getNodeVoltage(nodeKey) ?? 0.0;
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
            const hist = circuitState.actuatorHistory.history.get(comp.id);
            if (hist && hist[closestIdx]) {
              comp.glowLevel = hist[closestIdx].glowLevel;
              comp.relayClosed = hist[closestIdx].relayClosed;
              comp.buzzerLevel = hist[closestIdx].buzzerLevel;

              if (comp.type === 'buzzer') {
                const model = parseBuzzerActuatorModel(comp.value?.toString() ?? "");
                const level = comp.buzzerLevel ?? 0;
                if (level > 0.05) {
                  circuitState.audioOrchestrator.updateBuzzer(comp.id, model.resonantFrequencyHz, level);
                } else {
                  circuitState.audioOrchestrator.stopBuzzer(comp.id);
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
  // Inicializar referencias del DOM para indicadores de estado IPC
  ipcStatusDot = document.querySelector("#ipc-status-dot");
  ipcStatusText = document.querySelector("#ipc-status-text");

  // Inicializar controles de simulación con handlers que
  // encapsulan el dispatch analítico pesado evitando que el
  // módulo simulation_controls conozca las variables globales.
  simulationControls = initSimulationControls({
    onRunSimulation: async (_netlist, mode) => {
      addLog(`Iniciando simulación física de análisis [${
        mode === 'DC' ? 'Corriente Continua' :
        mode === 'AC' ? 'Barrido CA' :
        mode === 'TRAN' ? 'Transitorio' :
        mode === 'PVT' ? 'PVT Corner Analysis' : 'Transitorio'
      }]...`, "system");

      const netlist = extractNetlist();
      if (!netlist || netlist.components.length === 0) {
        addLog("Error: El lienzo está vacío. Coloca componentes antes de simular.", "error");
        simulationControls?.setSimulationRunning(false);
        return;
      }

      // ERC — Chequeo de Reglas Eléctricas (validación topológica)
      const ercResult = runElectricalRuleCheck(
        netlist,
        orchestrator!.components,
        orchestrator!.wires,
        (c) => orchestrator!.getComponentPins(c),
      );
      for (const warn of ercResult.warnings) {
        addLog(`[ERC Advertencia] ${warn}`, "error");
      }
      if (!ercResult.passed) {
        addLog("----------------------------------------------------------------", "error");
        addLog("¡ERC FALLIDO! La simulación se ha abortado para prevenir bloqueos matemáticos:", "error");
        for (const err of ercResult.errors) {
          addLog(`▶ [ERC Error] ${err}`, "error");
        }
        addLog("Corrige estos errores topológicos en el lienzo para poder simular.", "error");
        addLog("----------------------------------------------------------------", "error");
        simulationControls?.setSimulationRunning(false);
        return;
      }

      // Preparar osciloscopio para nueva simulación
      if (oscilloscopePanel) {
        oscilloscopePanel.transientResults = [];
        oscilloscopePanel.sweepTime = 0.0;
        if (mode !== 'PVT') {
          oscilloscopePanel.pvtMode = false;
          oscilloscopePanel.pvtTraces = [];
        }
        oscilloscopePanel.start();
      }

      // Despachar al orquestador de solvers (Rust IPC + fallback TS)
      await dispatchSimulation(netlist, mode, {
        simSettings,
        transientDuration,
        simulationRunner,
        solveCircuitTS,
        solveTransientCircuitLocal,
        onSpecialMode: async (n, m) => {
          if (m === 'PVT') await runPvtAnalysis(n);
          if (m === 'SPAR') await runSparamExport(n);
        },
      }, {
        addLog,
        onResultsReady: (m, results) => {
          if (m === 'AC') {
            if (oscilloscopePanel) oscilloscopePanel.acSweepResults = results;
          } else if (m === 'SENS') {
            circuitState.setVoltagesFromSnapshot(results.nominalVoltages ?? {});
          } else if (m === 'PSS') {
            if (oscilloscopePanel) oscilloscopePanel.transientResults = results || [];
            const oscT = oscilloscopePanel ? oscilloscopePanel.transientResults : [];
            if (oscT.length > 0) circuitState.setVoltagesFromSnapshot(oscT[oscT.length - 1].nodeVoltages);
          } else if (m === 'TRAN' && Array.isArray(results)) {
            if (oscilloscopePanel) oscilloscopePanel.transientResults = results;
            if (results.length > 0) circuitState.setVoltagesFromSnapshot(results[results.length - 1].nodeVoltages);
            circuitState.actuatorHistory.precompute(orchestrator!.components, results, { ...circuitState.getPinToNodeMap() });
          } else {
            circuitState.setVoltagesFromSnapshot(results.nodeVoltages ?? {});
          }
        },
        onIpcStatusUpdate: (text, color) => {
          if (ipcStatusDot && ipcStatusText) {
            ipcStatusDot.classList.add("active");
            ipcStatusText.textContent = text;
            ipcStatusText.style.color = color;
          }
        },
        updateCanvasRendering,
      });
    },
    onStopSimulation: async () => {
      addLog("Deteniendo simulación física del circuito.", "system");
      await simulationRunner?.stopInteractiveTransient();
      circuitState.audioOrchestrator.stopAll();
      if (oscilloscopePanel) oscilloscopePanel.stop();
    },
    setActiveAnalysisMode: (mode) => {
      activeAnalysisMode = mode;
      if (oscilloscopePanel) {
        oscilloscopePanel.activeAnalysisMode = mode;
        oscilloscopePanel.draw();
      }
      if (mode !== 'PVT') {
        document.querySelectorAll('.pvt-profile-btn').forEach(el => el.remove());
      }
    },
    addLog,
    updateCanvasRendering,
  });

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
    for (const [node, volt] of Object.entries(circuitState.getVoltageMap())) {
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
    const nodes = Object.keys(circuitState.getVoltageMap());
    const voltages = new Float64Array(Object.values(circuitState.getVoltageMap()));
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

    circuitState.clearVoltages();
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
      simulationControls?.setActiveModeButton(activeAnalysisMode);
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
    extractNetlist();
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

  const demoSelect = document.querySelector("#btn-open-demo") as HTMLSelectElement | null;
  if (demoSelect) {
    demoSelect.addEventListener("change", async () => {
      const file = demoSelect.value;
      demoSelect.value = "";
      if (!file) return;
      try {
        addLog(`Cargando demo: ${file}…`, "system");
        const resp = await fetch(`/demos/${file}`);
        if (!resp.ok) {
          addLog(`No se encontró la demo ${file}`, "error");
          return;
        }
        const content = await resp.text();
        createNewTab(file.replace(".astryd", ""), { components: [], wires: [], filePath: null });
        if (deserializeCircuit(content)) {
          const tab = tabs.find(t => t.id === activeTabId);
          if (tab) {
            tab.name = file.replace(".astryd", "");
            tab.unsaved = false;
          }
          renderTabsBar();
          addLog(`Demo [${file}] cargada correctamente.`, "receive");
        }
      } catch (err) {
        addLog(`Error al cargar demo: ${err}`, "error");
      }
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
    simulationControls?.setActiveModeButton(activeAnalysisMode);

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
    extractNetlist();
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
    if (isTypingInFormField()) return;

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
