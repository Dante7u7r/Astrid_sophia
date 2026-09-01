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
  readonly onPauseSimulation?: () => Promise<void>;
  readonly onResumeSimulation?: () => Promise<void>;
  readonly setActiveAnalysisMode: (mode: AnalysisMode) => void;
  readonly addLog: (text: string, type: 'system' | 'send' | 'receive' | 'error') => void;
  readonly updateCanvasRendering: () => void;
}

export interface SimulationControls {
  setSimulationRunning: (running: boolean) => void;
  setSimulationPaused: (paused: boolean) => void;
  isSimulationRunning: () => boolean;
  isSimulationPaused: () => boolean;
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
  if (analysisModeSelect?.value) {
    currentMode = analysisModeSelect.value as AnalysisMode;
  }
  let simulationRunning = false;
  let simulationPaused = false;

  function updateButtonLabelsForCurrentMode(): void {
    const meta = ANALYSIS_MODES_METADATA[currentMode] ?? ANALYSIS_MODES_METADATA.DC;
    if (runSimBtn) {
      const labelSpan = runSimBtn.querySelector('.header-action-label');
      if (labelSpan) {
        if (simulationRunning && meta.isStreaming) {
          labelSpan.textContent = simulationPaused ? 'Reanudar' : 'Pausar';
        } else {
          labelSpan.textContent = meta.buttonLabel;
        }
      }
      const iconSpan = runSimBtn.querySelector('.btn-icon');
      if (iconSpan) {
        if (simulationRunning) {
          if (meta.isStreaming) {
            iconSpan.textContent = simulationPaused ? '▶' : '⏸';
          } else {
            iconSpan.textContent = '⏳';
          }
        } else {
          iconSpan.textContent = '▶';
        }
      }
      if (simulationRunning && meta.isStreaming) {
        runSimBtn.setAttribute(
          'data-tooltip',
          simulationPaused ? 'Reanudar simulación interactiva' : 'Pausar simulación interactiva',
        );
      } else {
        runSimBtn.setAttribute('data-tooltip', meta.tooltip);
      }
      runSimBtn.setAttribute('aria-label', meta.label);
    }
    if (stopSimBtn) {
      stopSimBtn.setAttribute('data-tooltip', 'Detener simulación y resetear tensiones a reposo');
      stopSimBtn.setAttribute('aria-label', 'Detener simulación');
    }
  }

  function applySimulationVisualState(running: boolean, paused: boolean = false): void {
    if (analysisModeSelect?.value) {
      currentMode = analysisModeSelect.value as AnalysisMode;
    }
    simulationRunning = running;
    simulationPaused = running && paused;
    if (!runSimBtn || !stopSimBtn) return;

    const meta = ANALYSIS_MODES_METADATA[currentMode] ?? ANALYSIS_MODES_METADATA.DC;
    runSimBtn.disabled = running && !meta.isStreaming;
    stopSimBtn.disabled = !running;

    if (running) {
      if (meta.isStreaming) {
        if (simulationPaused) {
          runSimBtn.classList.remove('sim-active');
          const icon = runSimBtn.querySelector('.btn-icon');
          if (icon) icon.textContent = '▶';
        } else {
          runSimBtn.classList.add('sim-active');
          const icon = runSimBtn.querySelector('.btn-icon');
          if (icon) icon.textContent = '⏸';
        }
      } else {
        runSimBtn.classList.add('sim-active');
        const icon = runSimBtn.querySelector('.btn-icon');
        if (icon) icon.textContent = '⏳';
      }
      stopSimBtn.classList.add('btn-stop');
    } else {
      runSimBtn.classList.remove('sim-active');
      stopSimBtn.classList.remove('btn-stop');
      const icon = runSimBtn.querySelector('.btn-icon');
      if (icon) icon.textContent = '▶';
    }

    updateButtonLabelsForCurrentMode();

    const recIndicator = document.getElementById('sim-rec-indicator');
    if (recIndicator) {
      recIndicator.classList.toggle('active', running && !simulationPaused);
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
        applySimulationVisualState(false, false);
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
      if (analysisModeSelect?.value) {
        currentMode = analysisModeSelect.value as AnalysisMode;
      }
      const meta = ANALYSIS_MODES_METADATA[currentMode] ?? ANALYSIS_MODES_METADATA.DC;
      if (simulationRunning && meta.isStreaming) {
        if (simulationPaused) {
          if (handlers.onResumeSimulation) {
            await handlers.onResumeSimulation();
          } else {
            applySimulationVisualState(true, false);
          }
        } else {
          if (handlers.onPauseSimulation) {
            await handlers.onPauseSimulation();
          } else {
            applySimulationVisualState(true, true);
          }
        }
        return;
      }

      applySimulationVisualState(true, false);
      await handlers.onRunSimulation({} as CircuitNetlist, currentMode);
    });

    stopSimBtn.addEventListener('click', async () => {
      applySimulationVisualState(false, false);
      await handlers.onStopSimulation();
      handlers.updateCanvasRendering();
    });
  }

  // Inicializar etiquetas acordes al modo inicial
  updateButtonLabelsForCurrentMode();

  return {
    setSimulationRunning(running: boolean): void {
      applySimulationVisualState(running, simulationPaused);
    },

    setSimulationPaused(paused: boolean): void {
      applySimulationVisualState(simulationRunning, paused);
    },

    isSimulationRunning(): boolean {
      return simulationRunning;
    },

    isSimulationPaused(): boolean {
      return simulationPaused;
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
