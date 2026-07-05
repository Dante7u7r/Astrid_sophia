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
import { solveCircuitTS } from "./simulation/fallback_solver";
import { createSimulationRunner, type SimulationRunner } from "./simulation/simulation_runner";
import { initSimulationControls, type SimulationControls } from "./ui/simulation_controls";
import { runElectricalRuleCheck, dispatchSimulation, clearPendingTimeouts } from "./simulation/simulation_dispatcher";
import { createCircuitStateManager } from "./simulation/circuit_state_manager";
import { attachCanvasInput, attachCanvasDrop } from "./canvas/canvas_input_controller";
import { isTypingInFormField, installWebviewKeyGuards } from "./canvas/keyboard_guards";
import { TooltipManager } from "./ui/tooltip_manager";
import { TabManager, type Tab } from "./ui/tab_manager";
import { PropertyEditor } from "./ui/property_editor";
import { ExporterPanel } from "./ui/exporter_panel";
import { CommandHistory } from "./canvas/command_history";
import { PanelLayoutManager } from "./ui/panel_layout_manager";
import { InstrumentsDock } from "./ui/instruments_dock";
import { resolveVisualAuditConfig } from "./testing/visual_audit_config";
// Variables Globales del Estado — centralizadas en CircuitStateManager
const circuitState = createCircuitStateManager();
const visualAudit = resolveVisualAuditConfig(window.location.search, {
  isDevelopment: import.meta.env.DEV,
  mode: import.meta.env.MODE,
});
if (visualAudit.enabled) {
  document.documentElement.dataset.auditStage = visualAudit.stage;
  document.documentElement.dataset.auditStep = visualAudit.step;
}

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
let panelLayoutManager: PanelLayoutManager | null = null;
let instrumentsDock: InstrumentsDock | null = null;



let consoleOutput: HTMLElement | null = null;
let clearConsoleBtn: HTMLButtonElement | null = null;
let ipcStatusDot: HTMLElement | null = null;
let ipcStatusText: HTMLElement | null = null;

// Instancia global del Canvas Orchestrator
let orchestrator: CanvasOrchestrator | null = null;

// Interfaz para la gestión de Pestañas (Workspace Tabs)
let tabManager: TabManager | null = null;
let propertyEditor: PropertyEditor | null = null;
let exporterPanel: ExporterPanel | null = null;

// Instancias de submódulos UI modularizados
let telemetryPanel: TelemetryPanel | null = null;
let oscilloscopePanel: OscilloscopePanel | null = null;

// Historial de comandos para undo/redo
const commandHistory = new CommandHistory({ maxHistorySize: 200 });

// Mapa global de voltajes resueltos para visualización
// (centralizado en circuitState.getVoltageMap())

// Mapa de correspondencia entre cada terminal física y su nodo eléctrico resuelto
// (centralizado en circuitState.getPinToNodeMap())

// --- ESTADOS DE SONDAS E INSTRUMENTACIÓN DEL OSCILOSCOPIO ---
let probePlacementMode: 'CH1' | 'CH2' | 'CH3' | 'CH4' | null = null;

// --- ESTADO DE SELECCIÓN DE PUERTOS RF PARA PARÁMETROS S ---
let sparPorts: { nodeId: string; z0: number }[] = [];
let sparFStart = 10.0;
let sparFEnd = 100000.0;
let sparPPD = 20;
let ch1ProbeNode: string | null = "1"; // Canal 1 por defecto al Nodo 1
let ch2ProbeNode: string | null = "2"; // Canal 2 por defecto al Nodo 2
let ch3ProbeNode: string | null = "3";
let ch4ProbeNode: string | null = "4";

let renderFramePending = false;
let oscilloscopeFramePending = false;
let drawerBackdrop: HTMLElement | null = null;
const compactDrawerMedia = window.matchMedia("(max-width: 760px)");

function doCanvasRender(): void {
  if (visualAudit.isStep("skip-render")) return;

  const pinVoltageMap = circuitState.buildPinVoltageMap();

  let ch1PinPos: Point2D | undefined;
  let ch2PinPos: Point2D | undefined;
  let ch3PinPos: Point2D | undefined;
  let ch4PinPos: Point2D | undefined;

  const ch1Node = oscilloscopePanel ? oscilloscopePanel.ch1ProbeNode : ch1ProbeNode;
  const ch2Node = oscilloscopePanel ? oscilloscopePanel.ch2ProbeNode : ch2ProbeNode;
  const ch3Node = oscilloscopePanel ? oscilloscopePanel.ch3ProbeNode : ch3ProbeNode;
  const ch4Node = oscilloscopePanel ? oscilloscopePanel.ch4ProbeNode : ch4ProbeNode;

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
        if (nodeId === ch3Node && !ch3PinPos) {
          ch3PinPos = { x: pin.x, y: pin.y };
        }
        if (nodeId === ch4Node && !ch4PinPos) {
          ch4PinPos = { x: pin.x, y: pin.y };
        }
      }
    }
    if (!visualAudit.isStep("skip-canvas-render")) {
      orchestrator.render(
        pinVoltageMap,
        { ch1: ch1PinPos, ch2: ch2PinPos, ch3: ch3PinPos, ch4: ch4PinPos },
        circuitState.getPinToNodeMap(),
        sparMarkers.length > 0 ? sparMarkers : undefined,
      );
    }
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

function doOscilloscopeRender(): void {
  if (visualAudit.isStep("skip-osc-render")) return;
  oscilloscopePanel?.refreshVisibility();
}

function updateOscilloscopeRendering(immediate = false): void {
  if (immediate) {
    oscilloscopeFramePending = false;
    doOscilloscopeRender();
    return;
  }
  if (oscilloscopeFramePending) return;
  oscilloscopeFramePending = true;
  requestAnimationFrame(() => {
    oscilloscopeFramePending = false;
    doOscilloscopeRender();
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
  if (oscilloscopePanel.ch3ProbeNode) monitoredNodes.push(oscilloscopePanel.ch3ProbeNode);
  if (oscilloscopePanel.ch4ProbeNode) monitoredNodes.push(oscilloscopePanel.ch4ProbeNode);

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

function isCompactDrawerViewport(): boolean {
  return compactDrawerMedia.matches;
}

function isSidePanelCollapsed(panel: "left" | "right"): boolean {
  const element = panel === "left" ? sidebarLeft : sidebarRight;
  if (isCompactDrawerViewport()) {
    return element?.classList.contains("collapsed") ?? true;
  }
  return panelLayoutManager?.isPanelCollapsed(panel) ?? element?.classList.contains("collapsed") ?? true;
}

function syncDrawerState(): void {
  const leftCollapsed = isSidePanelCollapsed("left");
  const rightCollapsed = isSidePanelCollapsed("right");
  const compact = isCompactDrawerViewport();
  const drawerOpen = compact && (!leftCollapsed || !rightCollapsed);

  document.body.classList.toggle("mobile-drawer-open", drawerOpen);
  drawerBackdrop?.classList.toggle("active", drawerOpen);
  drawerBackdrop?.toggleAttribute("hidden", !drawerOpen);

  sidebarLeft?.setAttribute("aria-hidden", compact && leftCollapsed ? "true" : "false");
  sidebarRight?.setAttribute("aria-hidden", compact && rightCollapsed ? "true" : "false");

  btnToggleLeft?.setAttribute("aria-expanded", String(!leftCollapsed));
  btnToggleRight?.setAttribute("aria-expanded", String(!rightCollapsed));
  document.querySelector("#btn-dock-toggle-left")?.setAttribute("aria-expanded", String(!leftCollapsed));
  document.querySelector("#btn-dock-toggle-right")?.setAttribute("aria-expanded", String(!rightCollapsed));
  document.querySelector("#btn-expand-left")?.setAttribute("aria-expanded", String(!leftCollapsed));
  document.querySelector("#btn-expand-right")?.setAttribute("aria-expanded", String(!rightCollapsed));
}

function closeMobileDrawers(): void {
  if (!isCompactDrawerViewport()) return;
  panelLayoutManager?.setPanelCollapsed("left", true);
  panelLayoutManager?.setPanelCollapsed("right", true);
  syncDrawerState();
}

function toggleSidePanel(panel: "left" | "right"): void {
  if (!panelLayoutManager) return;

  if (!isCompactDrawerViewport()) {
    panelLayoutManager.togglePanel(panel);
    syncDrawerState();
    return;
  }

  const opening = isSidePanelCollapsed(panel);
  if (panel === "left") {
    panelLayoutManager.setPanelCollapsed("right", true);
    panelLayoutManager.setPanelCollapsed("left", !opening);
  } else {
    panelLayoutManager.setPanelCollapsed("left", true);
    panelLayoutManager.setPanelCollapsed("right", !opening);
  }
  syncDrawerState();
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
    if (panelLayoutManager) {
      toggleSidePanel("left");
      return;
    }
    if (!sidebarLeft) return;
    sidebarLeft.classList.toggle("collapsed");
    const isCollapsed = sidebarLeft.classList.contains("collapsed");
    if (btnToggleLeft) btnToggleLeft.textContent = isCollapsed ? "Componentes ▶" : "◀ Colapsar";
    if (btnDockLeft) btnDockLeft.classList.toggle("active", !isCollapsed);
    if (btnExpandLeft) btnExpandLeft.style.display = isCollapsed ? "block" : "none";
  };

  const toggleRight = () => {
    if (panelLayoutManager) {
      toggleSidePanel("right");
      return;
    }
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

  drawerBackdrop = document.querySelector("#mobile-drawer-backdrop") as HTMLElement | null;
  if (!drawerBackdrop) {
    drawerBackdrop = document.createElement("div");
    drawerBackdrop.id = "mobile-drawer-backdrop";
    drawerBackdrop.className = "mobile-drawer-backdrop";
    drawerBackdrop.hidden = true;
    drawerBackdrop.setAttribute("aria-hidden", "true");
    document.querySelector("#main-dashboard")?.appendChild(drawerBackdrop);
  }

  drawerBackdrop.addEventListener("click", closeMobileDrawers);
  document.addEventListener("keydown", (event) => {
    if (event.key === "Escape" && !isTypingInFormField()) {
      closeMobileDrawers();
    }
  });
  window.addEventListener("panel-layout-change", syncDrawerState);
  compactDrawerMedia.addEventListener("change", () => syncDrawerState());
  syncDrawerState();
  requestAnimationFrame(() => syncDrawerState());
  window.setTimeout(() => syncDrawerState(), 420);
}

// --- ACTUALIZACIÓN DE PROPIEDADES EN EL PANEL DERECHO DELEGADO ---

function updatePropertiesPanel(comp: ComponentInstance) {
  propertyEditor?.updatePropertiesPanel(comp);
}



// --- ALGORITMO DE EXTRACCIÓN DE NODOS ELÉCTRICOS (DSU / DISJOINT SETS) ---
// Adaptador puro: convierte el estado global del orchestrator en la
// netlist eléctrica y actualiza el mapa de terminales a nodos.

function extractNetlist(reportErrors = false): CircuitNetlist | null {
  if (!orchestrator) return null;
  const result = extractElectricalNetlist(
    orchestrator.components,
    orchestrator.wires,
    (c) => orchestrator!.getComponentPins(c),
  );

  if (result.error) {
    if (reportErrors) {
      TelemetryPanel.logError(result.error);
      addLog(`[Pre-flight ERC] ${result.error}`, "error");
    }
    return null;
  }

  circuitState.setPinToNodeMap(result.pinToNodeMap);
  return result.netlist;
}

// --- WRAPPER LOCAL PARA EL SOLVER TRANSITORIO DE RESPALDO ---
// Extrae los firmwares del orchestrator global y los pasa como
// parámetro explícito a la función pura de fallback_solver.

async function solveTransientCircuitLocal(netlist: CircuitNetlist, dt: number, tMax: number): Promise<TimeStepResult[] | string> {
  const firmware: Record<string, Uint8Array> = {};
  if (orchestrator) {
    for (const comp of orchestrator.components) {
      if (comp.firmware) firmware[comp.id] = comp.firmware;
    }
  }

  const worker = new Worker(
    new URL('./simulation/co_simulation_worker.ts', import.meta.url),
    { type: 'module' }
  );

  return new Promise<TimeStepResult[] | string>((resolve) => {
    worker.onmessage = (e) => {
      const data = e.data;
      if (data.type === 'success') {
        resolve(data.results);
      } else {
        resolve(data.error);
      }
      worker.terminate();
    };

    worker.onerror = (err) => {
      resolve(err.message || "Error desconocido en el Worker transitorio local");
      worker.terminate();
    };

    worker.postMessage({ type: 'run_fallback', netlist, dt, tMax, firmware });
  });
}

// --- INTERACTIVIDAD INTERNA DEL OSCILOSCOPIO ---

function initOscilloscopeInterface() {
  const oscCh1Btn = document.querySelector("#osc-ch1-btn") as HTMLButtonElement | null;
  const oscCh2Btn = document.querySelector("#osc-ch2-btn") as HTMLButtonElement | null;
  const oscCh3Btn = document.querySelector("#osc-ch3-btn") as HTMLButtonElement | null;
  const oscCh4Btn = document.querySelector("#osc-ch4-btn") as HTMLButtonElement | null;
  const oscPauseBtn = document.querySelector("#osc-pause-btn") as HTMLButtonElement | null;

  const handleProbeActivation = (mode: 'CH1' | 'CH2' | 'CH3' | 'CH4') => {
    const netlist = extractNetlist();
    if (!netlist || netlist.components.length === 0) {
      addLog("Coloca componentes en el lienzo antes de colocar una sonda.", "error");
      return;
    }
    probePlacementMode = mode;
    addLog(`[Osciloscopio] Modo colocación de sonda del ${mode} activo. Haz clic sobre un terminal del componente en el lienzo para conectar la sonda.`, "system");
  };

  const setupChBtn = (btn: HTMLButtonElement | null, channel: 'CH1' | 'CH2' | 'CH3' | 'CH4', getProbe: () => string | null, colorName: string) => {
    if (!btn) return;
    btn.addEventListener("click", (e) => {
      if (e.shiftKey) {
        handleProbeActivation(channel);
      } else {
        btn.classList.toggle("active");
        const node = getProbe();
        addLog(`Canal ${channel.replace("CH", "")} (Sonda en Nodo ${node}, color ${colorName}) ${btn.classList.contains('active') ? 'visible' : 'oculto'}.`, "system");
        if (oscilloscopePanel && !oscilloscopePanel.isSimulating) {
          updateOscilloscopeRendering();
        }
      }
    });
  };

  setupChBtn(oscCh1Btn, 'CH1', () => oscilloscopePanel ? oscilloscopePanel.ch1ProbeNode : ch1ProbeNode, 'Cian');
  setupChBtn(oscCh2Btn, 'CH2', () => oscilloscopePanel ? oscilloscopePanel.ch2ProbeNode : ch2ProbeNode, 'Morado');
  setupChBtn(oscCh3Btn, 'CH3', () => oscilloscopePanel ? oscilloscopePanel.ch3ProbeNode : ch3ProbeNode, 'Naranja');
  setupChBtn(oscCh4Btn, 'CH4', () => oscilloscopePanel ? oscilloscopePanel.ch4ProbeNode : ch4ProbeNode, 'Verde');

  if (oscPauseBtn) {
    oscPauseBtn.addEventListener("click", () => {
      if (oscilloscopePanel) {
        if (!oscilloscopePanel.isOscPaused) {
          oscilloscopePanel.pause();
          circuitState.audioOrchestrator.stopAll();
        } else {
          oscilloscopePanel.resume();
        }
        oscPauseBtn.classList.toggle("active");
        oscPauseBtn.textContent = oscilloscopePanel.isOscPaused ? "Reanudar" : "Pausar";
      }
    });
  }

  setTimeout(() => {
    updateOscilloscopeRendering();
  }, 100);
}

// --- INICIALIZACIÓN DEL MOTOR DE LIENZO INTERACTIVO (CANVAS CAD) ---

function initCanvasCAD() {
  const canvasElement = document.querySelector("#circuit-canvas") as HTMLCanvasElement;
  if (!canvasElement) return;

  orchestrator = new CanvasOrchestrator(canvasElement);
  if (visualAudit.isStep("orchestrator")) return;

  const viewport = canvasElement.parentElement;

  let prevCanvasWidth = -1;
  let prevCanvasHeight = -1;

  const syncCanvasDimensions = () => {
    if (!viewport) return;
    const dpr = window.devicePixelRatio || 1;
    const width = viewport.clientWidth;
    const height = viewport.clientHeight;
    const bufW = Math.round(width * dpr);
    const bufH = Math.round(height * dpr);
    
    // Guard: solo actualizar si las dimensiones realmente cambiaron.
    // Esto previene el feedback loop del ResizeObserver en WebKit
    // (cambiar canvas.width/.height puede disparar otro ResizeObserver).
    if (bufW !== prevCanvasWidth || bufH !== prevCanvasHeight) {
      prevCanvasWidth = bufW;
      prevCanvasHeight = bufH;
      canvasElement.width = bufW;
      canvasElement.height = bufH;
      requestAnimationFrame(() => updateCanvasRendering());
    }
  };

  // Callback compartido: PanelLayoutManager lo usa tras arrastrar splitters
  const resizeCanvas = () => {
    syncCanvasDimensions();
  };

  // ResizeObserver sobre el viewport: fiable incluso cuando window.resize
  // no se dispara (Tauri/Linux al maximizar/restaurar)
  if (viewport) {
    const ro = new ResizeObserver(() => syncCanvasDimensions());
    ro.observe(viewport);
  }

  syncCanvasDimensions();
  if (visualAudit.isStep("resize")) return;

  // Inicializar PanelLayoutManager con callback de resize del canvas
  const appRoot = document.querySelector("#app-viewport") as HTMLElement;
  if (appRoot) {
    panelLayoutManager = new PanelLayoutManager(appRoot, resizeCanvas);
  }
  if (visualAudit.isStep("layout")) return;

  const bottomDock = document.querySelector("#bottom-dock") as HTMLElement;
  if (bottomDock && orchestrator && !visualAudit.enabled) {
    instrumentsDock = new InstrumentsDock(bottomDock, orchestrator, {
      onCanvasModified: () => {
        markCurrentTabAsModified();
        if (orchestrator) orchestrator.ercIssues = [];
      },
      onNetlistSync: () => extractNetlist(),
      requestRender: (immediate: boolean) => updateCanvasRendering(immediate),
      getPinNode: (pinKey: string) => circuitState.getPinNode(pinKey),
      log: (text: string, type: "system" | "error" = "system") => addLog(text, type),
    });
  }

  attachCanvasInput(canvasElement, orchestrator, {
    requestRender: (immediate) => updateCanvasRendering(immediate),
    onWireConnected: () => {
      extractNetlist();
      addLog(
        `Cable conectado entre terminales del lienzo.`,
        "system",
      );
    },
    onCanvasModified: () => {
      markCurrentTabAsModified();
      if (orchestrator) {
        orchestrator.ercIssues = [];
      }
    },
    onNetlistSync: () => extractNetlist(),
    onSelectionChanged: (comp) => {
      if (comp) {
        updatePropertiesPanel(comp);
        if (panelLayoutManager) {
          if (isCompactDrawerViewport()) {
            panelLayoutManager.setPanelCollapsed("left", true);
          }
          panelLayoutManager.setPanelCollapsed("right", false);
          syncDrawerState();
        }
      } else {
        if (panelLayoutManager) {
          panelLayoutManager.setPanelCollapsed("right", true);
          syncDrawerState();
        }
      }
    },
    getPinNode: (pinKey) => circuitState.getPinNode(pinKey),
    log: (text, type = "system") => addLog(text, type),
    getProbePlacementMode: () => probePlacementMode,
    clearProbePlacementMode: () => { probePlacementMode = null; },
    onProbePlaced: (channel, nodeId) => {
      if (channel === "CH1") {
        ch1ProbeNode = nodeId;
        if (oscilloscopePanel) oscilloscopePanel.ch1ProbeNode = nodeId;
        addLog(`Sonda del Canal 1 (Cian) conectada al Nodo ${nodeId}.`, "system");
      } else if (channel === "CH2") {
        ch2ProbeNode = nodeId;
        if (oscilloscopePanel) oscilloscopePanel.ch2ProbeNode = nodeId;
        addLog(`Sonda del Canal 2 (Morada) conectada al Nodo ${nodeId}.`, "system");
      } else if (channel === "CH3") {
        ch3ProbeNode = nodeId;
        if (oscilloscopePanel) oscilloscopePanel.ch3ProbeNode = nodeId;
        addLog(`Sonda del Canal 3 (Naranja) conectada al Nodo ${nodeId}.`, "system");
      } else if (channel === "CH4") {
        ch4ProbeNode = nodeId;
        if (oscilloscopePanel) oscilloscopePanel.ch4ProbeNode = nodeId;
        addLog(`Sonda del Canal 4 (Verde) conectada al Nodo ${nodeId}.`, "system");
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
    onUndo: () => commandHistory.undo(),
    onRedo: () => commandHistory.redo(),
    onSelectAll: () => orchestrator?.selectAll(),
    onFitAll: () => orchestrator?.resetCameraToCircuit(),
    onEscape: () => orchestrator?.cancelWire(),
    onWireMode: () => addLog("Wire mode placeholder (doble click en pin para conectar)", "system"),
  });
  if (visualAudit.isStep("input")) return;

  const canvasViewport = document.querySelector("#canvas-viewport") as HTMLElement;
  if (canvasViewport) {
    attachCanvasDrop(canvasViewport, canvasElement, orchestrator, {
      requestRender: (immediate) => updateCanvasRendering(immediate),
      onNetlistSync: () => extractNetlist(),
      onCanvasModified: () => {
        markCurrentTabAsModified();
        if (orchestrator) {
          orchestrator.ercIssues = [];
        }
      },
      onComponentPlaced: (comp) => updatePropertiesPanel(comp),
      log: (text, type = "system") => addLog(text, type),
    });
  }
  if (visualAudit.isStep("drop")) return;

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
      orchestrator!.zoomAt(1.15, canvasElement.clientWidth / 2, canvasElement.clientHeight / 2);
      updateCanvasRendering();
    });
  }

  const btnZoomOut = document.querySelector("#btn-zoom-out");
  if (btnZoomOut) {
    btnZoomOut.addEventListener("click", () => {
      orchestrator!.zoomAt(0.85, canvasElement.clientWidth / 2, canvasElement.clientHeight / 2);
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
  // Instalar protectores de teclado del WebView contra recarga accidental
  installWebviewKeyGuards(!!(import.meta as any).env?.DEV);

  // Inicializar gestor de tooltips premium
  TooltipManager.init();

  consoleOutput = document.querySelector("#console-output");
  clearConsoleBtn = document.querySelector("#clear-console-btn");

  // Instanciar submódulos de UI modularizados
  telemetryPanel = new TelemetryPanel();
  if (!visualAudit.enabled) {
    telemetryPanel.start();
  }

  tabManager = new TabManager({
    getOrchestrator: () => orchestrator,
    getOscilloscopePanel: () => oscilloscopePanel,
    getMcuDebugPanel: () => mcuDebugPanel,
    getSimulationControls: () => simulationControls,
    extractNetlist,
    updateCanvasRendering: () => updateCanvasRendering(),
    getActiveAnalysisMode: () => activeAnalysisMode,
    setActiveAnalysisMode: (mode) => { activeAnalysisMode = mode; },
    getProbes: () => ({ ch1: ch1ProbeNode, ch2: ch2ProbeNode }),
    setProbes: (ch1, ch2) => { ch1ProbeNode = ch1; ch2ProbeNode = ch2; },
    setSparPorts: (ports) => { sparPorts = ports; },
    serializeCircuit,
    addLog,
    invokeTauri: invoke,
  });

  propertyEditor = new PropertyEditor({
    getOrchestrator: () => orchestrator,
    getMcuDebugPanel: () => mcuDebugPanel,
    getSimulationRunner: () => simulationRunner,
    addLog,
    updateCanvasRendering,
    markCurrentTabAsModified: () => tabManager!.markCurrentTabAsModified(),
    invokeTauri: invoke,
  });

  exporterPanel = new ExporterPanel({
    getOscilloscopePanel: () => oscilloscopePanel,
    getActiveAnalysisMode: () => activeAnalysisMode,
    getProbeNodes: () => ({ ch1: ch1ProbeNode, ch2: ch2ProbeNode }),
    getVoltageMap: () => circuitState.getVoltageMap(),
    addLog,
  });

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
        updateOscilloscopeRendering();
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
      TelemetryPanel.logError(`Error en simulación transitoria: ${error}`);
    },
    onSimulationComplete: (finalTime) => {
      addLog(`Simulación completada en t = ${finalTime.toFixed(6)} s.`, 'receive');
    },
    onSimulationStateChanged: (active) => {
      if (orchestrator) orchestrator.simulationActive = active;
      simulationControls?.setSimulationRunning(active);
    },
  });

  oscilloscopePanel = new OscilloscopePanel();
  window.addEventListener("panel-layout-change", () => {
    updateOscilloscopeRendering();
  });
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

          // ─── 5 INSTRUMENTOS VIRTUALES DATA FEED ───

          // 1. Multímetros digitales (DMM)
          for (const comp of orchestrator.components) {
            if (comp.type === 'dmm') {
              const pin0Node = circuitState.getPinNode(`${comp.id}:0`);
              const pin1Node = circuitState.getPinNode(`${comp.id}:1`);
              if (pin0Node !== undefined && pin1Node !== undefined) {
                const v0 = closest.nodeVoltages[pin0Node] ?? 0.0;
                const v1 = closest.nodeVoltages[pin1Node] ?? 0.0;
                const mode = comp.value?.toString() ?? "V";

                if (mode === "V") {
                  const diff = v0 - v1;
                  comp.dmmValue = diff.toFixed(3) + " V";
                } else if (mode === "A") {
                  const diff = v0 - v1;
                  const iVal = diff / 0.01; // Ley de Ohm a través del shunt de 10mOhm
                  if (Math.abs(iVal) < 1e-3) {
                    comp.dmmValue = (iVal * 1e6).toFixed(1) + " uA";
                  } else if (Math.abs(iVal) < 1) {
                    comp.dmmValue = (iVal * 1e3).toFixed(2) + " mA";
                  } else {
                    comp.dmmValue = iVal.toFixed(3) + " A";
                  }
                } else {
                  // Modo ohmiómetro: aproximación local
                  comp.dmmValue = "-- Ω";
                }
              } else {
                comp.dmmValue = "OPEN";
              }
            }
          }

          // 2. Analizador lógico
          if (instrumentsDock && instrumentsDock.logicAnalyzer) {
            instrumentsDock.logicAnalyzer.recordTimeStep(closest.time, closest.nodeVoltages);
          }

          // 3. Analizador de Espectro (FFT)
          if (instrumentsDock && instrumentsDock.fftAnalyzer && oscilloscopePanel) {
            const ch1Data = oscilloscopePanel.transientResults.map(r => ({
              time: r.time,
              val: r.nodeVoltages[oscilloscopePanel!.ch1ProbeNode || ""] ?? 0
            }));
            const ch2Data = oscilloscopePanel.transientResults.map(r => ({
              time: r.time,
              val: r.nodeVoltages[oscilloscopePanel!.ch2ProbeNode || ""] ?? 0
            }));
            instrumentsDock.fftAnalyzer.setTimeData(ch1Data, ch2Data);
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
  propertyEditor!.init();
  exporterPanel!.init();

  // --- MENU DE INSTRUMENTACION ---
  const instrumentsMenuBtn = document.querySelector("#instruments-menu-btn") as HTMLButtonElement | null;
  const instrumentsDropdown = document.querySelector("#instruments-dropdown") as HTMLElement | null;

  if (instrumentsMenuBtn && instrumentsDropdown) {
    instrumentsMenuBtn.addEventListener("click", (e) => {
      e.stopPropagation();
      const open = instrumentsDropdown.style.display === "block";
      instrumentsDropdown.style.display = open ? "none" : "block";
    });

    document.addEventListener("click", (e) => {
      if (instrumentsDropdown && !instrumentsDropdown.contains(e.target as Node)) {
        instrumentsDropdown.style.display = "none";
      }
    });

    // Wire buttons inside the menu
    const menuToggleLeft = instrumentsDropdown.querySelector("#menu-toggle-left");
    const menuToggleRight = instrumentsDropdown.querySelector("#menu-toggle-right");
    const menuToggleDock = instrumentsDropdown.querySelector("#menu-toggle-dock");
    const menuRunErc = instrumentsDropdown.querySelector("#menu-run-erc");
    const menuSettings = instrumentsDropdown.querySelector("#menu-settings");

    if (menuToggleLeft) {
      menuToggleLeft.addEventListener("click", () => {
        toggleSidePanel("left");
      });
    }
    if (menuToggleRight) {
      menuToggleRight.addEventListener("click", () => {
        toggleSidePanel("right");
      });
    }
    if (menuToggleDock) {
      menuToggleDock.addEventListener("click", () => {
        panelLayoutManager?.togglePanel("dock");
      });
    }
    if (menuRunErc) {
      menuRunErc.addEventListener("click", () => {
        const netlist = extractNetlist(true);
        if (netlist) {
          const res = runElectricalRuleCheck(
            netlist,
            orchestrator!.components,
            orchestrator!.wires,
            (c) => orchestrator!.getComponentPins(c),
          );
          if (orchestrator) {
            const ercIssues: { componentId: string; type: "error" | "warning"; message: string; pinIndex?: number }[] = [];
            for (const w of res.warnings) {
              const compMatch = w.match(/\[([a-zA-Z0-9_]+)\]/);
              if (compMatch) {
                const componentId = compMatch[1];
                const pinMatch = w.match(/terminal index (\d+)/);
                const pinIndex = pinMatch ? parseInt(pinMatch[1], 10) : undefined;
                ercIssues.push({ componentId, type: "warning", message: w, pinIndex });
              }
            }
            for (const err of res.errors) {
              const compMatch = err.match(/\[([a-zA-Z0-9_,\s]+)\]/);
              if (compMatch) {
                const compList = compMatch[1].split(',').map(s => s.trim());
                for (const cid of compList) {
                  ercIssues.push({ componentId: cid, type: "error", message: err });
                }
              }
            }
            orchestrator.ercIssues = ercIssues;
            orchestrator.render();
          }
          if (res.passed) {
            addLog("ERC completado exitosamente sin errores críticos.", "system");
          } else {
            addLog(`ERC falló con ${res.errors.length} errores críticos. Chequee los halos pulsantes en el lienzo.`, "error");
          }
        }
      });
    }
    if (menuSettings) {
      menuSettings.addEventListener("click", () => {
        const trigger = document.querySelector("#settings-trigger-btn") as HTMLButtonElement | null;
        if (trigger) trigger.click();
      });
    }
  }

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

      if (panelLayoutManager) {
        panelLayoutManager.setPanelCollapsed("dock", false);
      }
      if (!orchestrator || orchestrator.components.length === 0) {
        addLog("Error: El lienzo está vacío. Coloca componentes antes de simular.", "error");
        simulationControls?.setSimulationRunning(false);
        return;
      }

      // ERC — Chequeo de Reglas Eléctricas (validación topológica)
      const netlist = extractNetlist(true);
      if (!netlist) {
        simulationControls?.setSimulationRunning(false);
        return;
      }

      const ercResult = runElectricalRuleCheck(
        netlist,
        orchestrator!.components,
        orchestrator!.wires,
        (c) => orchestrator!.getComponentPins(c),
      );

      const ercIssues: { componentId: string; type: "error" | "warning"; message: string; pinIndex?: number }[] = [];

      for (const warn of ercResult.warnings) {
        addLog(`[ERC Advertencia] ${warn}`, "error");
        const compMatch = warn.match(/\[([a-zA-Z0-9_]+)\]/);
        if (compMatch) {
          const componentId = compMatch[1];
          let pinIndex: number | undefined = undefined;
          const pinMatch = warn.match(/terminal index (\d+)/);
          if (pinMatch) {
            pinIndex = parseInt(pinMatch[1], 10);
          }
          ercIssues.push({ componentId, type: "warning", message: warn, pinIndex });
        }
      }

      for (const err of ercResult.errors) {
        const compMatch = err.match(/\[([a-zA-Z0-9_,\s]+)\]/);
        if (compMatch) {
          const compList = compMatch[1].split(',').map(s => s.trim());
          for (const componentId of compList) {
            ercIssues.push({ componentId, type: "error", message: err });
          }
        }
      }

      if (orchestrator) {
        orchestrator.ercIssues = ercIssues;
        orchestrator.render();
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
          updateOscilloscopeRendering();
        },
        onIpcStatusUpdate: (text, color) => {
          if (ipcStatusDot && ipcStatusText) {
            ipcStatusDot.classList.add("active");
            ipcStatusText.textContent = text;
            ipcStatusText.style.color = color;
          }
        },
        updateCanvasRendering,
        onSimulationFinished: () => {
          simulationControls?.setSimulationRunning(false);
        },
        onHighlightElement: (id) => {
          if (orchestrator) {
            const comp = orchestrator.components.find(c => c.id === id);
            if (comp) {
              orchestrator.selectedComponents = [comp];
              orchestrator.selectedComponent = comp;
              orchestrator.render();
            }
          }
        },
      });
    },
    onStopSimulation: async () => {
      addLog("Deteniendo simulación física del circuito.", "system");
      clearPendingTimeouts();
      await simulationRunner?.stopInteractiveTransient();
      circuitState.audioOrchestrator.stopAll();
      if (oscilloscopePanel) oscilloscopePanel.stop();
      circuitState.resetAll();
    },
    setActiveAnalysisMode: (mode) => {
      activeAnalysisMode = mode;
      if (oscilloscopePanel) {
        oscilloscopePanel.activeAnalysisMode = mode;
        updateOscilloscopeRendering();
      }
      if (mode !== 'PVT') {
        document.querySelectorAll('.pvt-profile-btn').forEach(el => el.remove());
      }
    },
    addLog,
    updateCanvasRendering,
  });

  if (!visualAudit.enabled) {
    initOscilloscopeInterface();
    initCanvasCAD();
    initFilePersistence();
    initTabManager();
  } else {
    if (visualAudit.stage === "oscilloscope") {
      initOscilloscopeInterface();
    }
    if (visualAudit.stage === "canvas") {
      initOscilloscopeInterface();
      initCanvasCAD();
    }
    if (visualAudit.stage === "tabs") {
      initOscilloscopeInterface();
      initCanvasCAD();
      initFilePersistence();
      initTabManager();
    }
    addLog(
      `Modo auditoría visual activo (etapa: ${visualAudit.stage}, paso: ${visualAudit.step}).`,
      "system",
    );
  }

  if (clearConsoleBtn) {
    clearConsoleBtn.addEventListener("click", () => {
      if (consoleOutput) {
        consoleOutput.innerHTML = `<div class="log-line system-msg">> Limpieza de registros. Consola limpia.</div>`;
      }
    });
  }

  addLog("Entorno de desarrollo de UI premium cargado a 60 FPS estables.", "system");
  addLog("Colocación de sondas interactivas: Haz Shift+Click en Canal 1 o Canal 2 para conectar las sondas en el circuito.", "system");
});

// --- EXPORTADORES PREMIUM DE REPORTES CIENTÍFICOS (DELEGADOS) ---
// (Ver src/ui/exporter_panel.ts)

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
    updateOscilloscopeRendering();

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
      tabManager!.createNewTab();
    });
  }

  const demoSelect = document.querySelector("#btn-open-demo") as HTMLSelectElement | null;
  if (demoSelect) {
    demoSelect.addEventListener("change", async () => {
      const file = demoSelect.value;
      demoSelect.value = "";
      if (!file) return;
      
      // Limpiar explícitamente todo el estado (osciloscopio, MCU, netlist, voltajes) antes de cargar la demo
      circuitState.prepareForDemoLoad(oscilloscopePanel, orchestrator);

      try {
        addLog(`Cargando demo: ${file}…`, "system");
        const resp = await fetch(`/demos/${file}`);
        if (!resp.ok) {
          addLog(`No se encontró la demo ${file}`, "error");
          return;
        }
        const content = await resp.text();
        tabManager!.createNewTab(file.replace(".astryd", ""), { components: [], wires: [], filePath: null });
        if (deserializeCircuit(content)) {
          const tab = tabManager!.tabs.find(t => t.id === tabManager!.activeTabId);
          if (tab) {
            tab.name = file.replace(".astryd", "");
            tab.unsaved = false;
          }
          tabManager!.renderTabsBar();
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
          const currentTab = tabManager!.tabs.find(t => t.id === tabManager!.activeTabId);
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
            tabToLoad = tabManager!.createNewTab(filename, { components: [], wires: [], filePath });
          }

          const success = deserializeCircuit(content);
          if (success) {
            tabToLoad.filePath = filePath;
            tabToLoad.unsaved = false;
            tabManager!.renderTabsBar();
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
      tabManager!.saveCircuitDirect();
    });
  }
}

// --- GESTOR DE PESTAÑAS (WORKSPACE TABS DELEGADO) ---

function markCurrentTabAsModified() {
  tabManager?.markCurrentTabAsModified();
}

function initTabManager() {
  tabManager!.init(() => initTabKeyboardShortcuts());
  initComponentCategories();
  initComponentSearch();
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
    // Evitar recarga y navegación accidental en el WebView de Tauri
    if (!isTypingInFormField()) {
      const ctrl = e.ctrlKey || e.metaKey;

      if (e.key === "F5") {
        e.preventDefault();
      }
      if (ctrl && e.key.toLowerCase() === "r") {
        e.preventDefault();
      }
      if (e.key === "Backspace") {
        e.preventDefault();
      }
    }

    if (isTypingInFormField()) return;

    // Ctrl + N: Nueva pestaña
    if ((e.ctrlKey || e.metaKey) && e.key === "n") {
      e.preventDefault();
      tabManager!.createNewTab();
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
        tabManager!.saveCircuitAs();
      } else {
        tabManager!.saveCircuitDirect();
      }
    }
    // Ctrl + W: Cerrar pestaña activa
    if ((e.ctrlKey || e.metaKey) && e.key === "w") {
      e.preventDefault();
      if (tabManager!.activeTabId) {
        tabManager!.closeTab(tabManager!.activeTabId);
      }
    }
    // F9: Alternar panel izquierdo (Componentes)
    if (e.key === "F9") {
      e.preventDefault();
      toggleSidePanel("left");
    }
    // F10: Alternar panel derecho (Propiedades)
    if (e.key === "F10") {
      e.preventDefault();
      toggleSidePanel("right");
    }
    // F8: Alternar panel inferior (Dock de Instrumentos/Osciloscopio)
    if (e.key === "F8") {
      e.preventDefault();
      if (panelLayoutManager) {
        panelLayoutManager.togglePanel("dock");
      }
    }
  });
}
