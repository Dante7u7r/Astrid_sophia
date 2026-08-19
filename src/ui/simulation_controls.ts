// ==========================================================================
// SIMULATION CONTROLS — Capa de presentación de la barra de herramientas
// ==========================================================================

import { type CircuitNetlist } from "../simulation/netlist_extractor";

// ==========================================================================
// Tipos públicos
// ==========================================================================

/** Unión discriminada de los 8 modos de análisis del simulador. */
export type AnalysisMode = 'DC' | 'AC' | 'TRAN' | 'SENS' | 'PSS' | 'STB' | 'PVT' | 'SPAR';

export interface AnalysisModeMeta {
  readonly label: string;
  readonly buttonLabel: string;
  readonly isStreaming: boolean;
  readonly description: string;
  readonly tooltip: string;
  readonly icon: string;
}

export const ANALYSIS_MODES_METADATA: Record<AnalysisMode, AnalysisModeMeta> = {
  DC: {
    label: "Análisis CC (Punto de Operación)",
    buttonLabel: "Calcular CC",
    isStreaming: false,
    description: "Calcula el punto de polarización DC estacionario (capacitores abiertos, inductores cortocircuitados).",
    tooltip: "Calcular voltajes de polarización y corrientes DC de reposo",
    icon: "⚖️",
  },
  AC: {
    label: "Barrido CA (Respuesta en Frecuencia)",
    buttonLabel: "Barrido CA",
    isStreaming: false,
    description: "Calcula la respuesta en pequeña señal (magnitud y fase) en el rango de frecuencia configurado.",
    tooltip: "Ejecutar barrido en frecuencia y graficar diagrama de Bode",
    icon: "📈",
  },
  TRAN: {
    label: "Transitorio (Tiempo Real Interactivo)",
    buttonLabel: "Simular",
    isStreaming: true,
    description: "Simula el comportamiento dinámico en el tiempo a 60 FPS con animación de corrientes y osciloscopio en vivo.",
    tooltip: "Iniciar simulación transitoria interactiva en tiempo real",
    icon: "⏱️",
  },
  SENS: {
    label: "Sensibilidad (Peor Caso)",
    buttonLabel: "Sensibilidad",
    isStreaming: false,
    description: "Calcula las sensibilidades normalizadas ∂Vo/∂p de cada componente y analiza el peor caso.",
    tooltip: "Calcular matriz de sensibilidad DC y tolerancias críticas",
    icon: "🔍",
  },
  PSS: {
    label: "PSS (Periodic Steady State)",
    buttonLabel: "Calcular PSS",
    isStreaming: false,
    description: "Calcula el estado estacionario periódico exacto mediante método de disparo (shooting method).",
    tooltip: "Calcular ciclo límite periódico de osciladores o circuitos conmutados",
    icon: "⚠️",
  },
  STB: {
    label: "Polos y Ceros (Estabilidad)",
    buttonLabel: "Polos/Ceros",
    isStreaming: false,
    description: "Calcula los polos y ceros en el plano complejo 's' y el margen de fase/ganancia.",
    tooltip: "Calcular polos, ceros y márgenes de estabilidad en lazo",
    icon: "⚠️",
  },
  PVT: {
    label: "PVT Corner Analysis",
    buttonLabel: "Barrido PVT",
    isStreaming: false,
    description: "Evalúa el circuito bajo variaciones combinadas de Proceso (Fast/Slow), Voltaje y Temperatura.",
    tooltip: "Ejecutar análisis de esquinas de fabricación PVT",
    icon: "🔬",
  },
  SPAR: {
    label: "Parámetros S (Microondas / RF)",
    buttonLabel: "Parámetros S",
    isStreaming: false,
    description: "Calcula la matriz de dispersión RF (S11, S21, S12, S22) y genera exportación Touchstone (.s2p).",
    tooltip: "Calcular parámetros de dispersión en puertos RF de 50 Ω",
    icon: "📡",
  },
};

export interface SimulationControlHandlers {
  readonly onRunSimulation: (netlist: CircuitNetlist, mode: AnalysisMode) => Promise<void>;
  readonly onStopSimulation: () => Promise<void>;
  readonly setActiveAnalysisMode: (mode: AnalysisMode) => void;
  readonly addLog: (text: string, type: 'system' | 'send' | 'receive' | 'error') => void;
  readonly updateCanvasRendering: () => void;
}

export interface SimulationControls {
  setSimulationRunning: (running: boolean) => void;
  isSimulationRunning: () => boolean;
  setActiveModeButton: (mode: AnalysisMode) => void;
  destroy: () => void;
}

// ==========================================================================
// Estado interno del módulo
// ==========================================================================

let analysisModeSelect: HTMLSelectElement | null = null;
let runSimBtn: HTMLButtonElement | null = null;
let stopSimBtn: HTMLButtonElement | null = null;
let currentMode: AnalysisMode = 'DC';

// ==========================================================================
// Factory: inicialización de controles con inyección de handlers
// ==========================================================================

export function initSimulationControls(
  handlers: SimulationControlHandlers,
): SimulationControls {
  analysisModeSelect = document.querySelector('#analysis-mode-select') as HTMLSelectElement | null;
  runSimBtn = document.querySelector('#run-sim-btn') as HTMLButtonElement | null;
  stopSimBtn = document.querySelector('#stop-sim-btn') as HTMLButtonElement | null;
  let simulationRunning = false;

  function updateButtonLabelsForCurrentMode(): void {
    const meta = ANALYSIS_MODES_METADATA[currentMode] ?? ANALYSIS_MODES_METADATA.DC;
    if (runSimBtn) {
      const labelSpan = runSimBtn.querySelector('.header-action-label');
      if (labelSpan) {
        labelSpan.textContent = simulationRunning && meta.isStreaming ? 'Pausar' : meta.buttonLabel;
      }
      runSimBtn.setAttribute('data-tooltip', simulationRunning && meta.isStreaming ? 'Pausar simulación interactiva' : meta.tooltip);
      runSimBtn.setAttribute('aria-label', meta.label);
    }
    if (stopSimBtn) {
      stopSimBtn.setAttribute('data-tooltip', 'Detener simulación y resetear tensiones a reposo');
      stopSimBtn.setAttribute('aria-label', 'Detener simulación');
    }
  }

  function applySimulationVisualState(running: boolean): void {
    simulationRunning = running;
    if (!runSimBtn || !stopSimBtn) return;

    const meta = ANALYSIS_MODES_METADATA[currentMode] ?? ANALYSIS_MODES_METADATA.DC;
    runSimBtn.disabled = running && !meta.isStreaming;
    stopSimBtn.disabled = !running;

    if (running) {
      runSimBtn.classList.add('sim-active');
      stopSimBtn.classList.add('btn-stop');
      const icon = runSimBtn.querySelector('.btn-icon');
      if (icon) icon.textContent = meta.isStreaming ? '⏸' : '⏳';
    } else {
      runSimBtn.classList.remove('sim-active');
      stopSimBtn.classList.remove('btn-stop');
      const icon = runSimBtn.querySelector('.btn-icon');
      if (icon) icon.textContent = '▶';
    }

    updateButtonLabelsForCurrentMode();

    const recIndicator = document.getElementById('sim-rec-indicator');
    if (recIndicator) {
      recIndicator.classList.toggle('active', running);
    }

    const fileButtons = [
      document.getElementById('btn-new-circuit'),
      document.getElementById('btn-open-circuit'),
      document.getElementById('btn-open-demo'),
    ];
    for (const btn of fileButtons) {
      if (!btn) continue;
      btn.classList.toggle('sim-locked', running);
    }
  }

  // --- Registrar selector de modo ---
  if (analysisModeSelect) {
    analysisModeSelect.addEventListener('change', async () => {
      const mode = (analysisModeSelect!.value as AnalysisMode) || 'DC';
      currentMode = mode;

      // Si había una simulación continua corriendo, detenerla inmediatamente al cambiar de modo
      if (simulationRunning) {
        applySimulationVisualState(false);
        await handlers.onStopSimulation();
      }

      handlers.setActiveAnalysisMode(mode);
      updateButtonLabelsForCurrentMode();

      const meta = ANALYSIS_MODES_METADATA[mode] ?? ANALYSIS_MODES_METADATA.DC;
      handlers.addLog(`[Modo de Análisis: ${meta.label}] ${meta.description}`, 'system');

      if (mode !== 'PVT') {
        document.querySelectorAll('.pvt-profile-btn').forEach(el => el.remove());
      }
    });
  }

  if (runSimBtn && stopSimBtn) {
    runSimBtn.addEventListener('click', async () => {
      const meta = ANALYSIS_MODES_METADATA[currentMode] ?? ANALYSIS_MODES_METADATA.DC;
      if (simulationRunning && meta.isStreaming) {
        // Pausar/Detener si ya estaba corriendo en transitorio interactivo
        applySimulationVisualState(false);
        await handlers.onStopSimulation();
        return;
      }

      applySimulationVisualState(true);
      await handlers.onRunSimulation({} as CircuitNetlist, currentMode);
    });

    stopSimBtn.addEventListener('click', async () => {
      applySimulationVisualState(false);
      await handlers.onStopSimulation();
      handlers.updateCanvasRendering();
    });
  }

  // Inicializar etiquetas acordes al modo inicial
  updateButtonLabelsForCurrentMode();

  return {
    setSimulationRunning(running: boolean): void {
      applySimulationVisualState(running);
    },

    isSimulationRunning(): boolean {
      return simulationRunning;
    },

    setActiveModeButton(mode: AnalysisMode): void {
      if (analysisModeSelect) {
        analysisModeSelect.value = mode;
      }
      currentMode = mode;
      updateButtonLabelsForCurrentMode();
    },

    destroy(): void {
      analysisModeSelect = null;
      runSimBtn = null;
      stopSimBtn = null;
    },
  };
}
