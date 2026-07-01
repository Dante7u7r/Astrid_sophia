// ==========================================================================
// SIMULATION CONTROLS — Capa de presentación de la barra de herramientas
// ==========================================================================

import { type CircuitNetlist } from "../simulation/netlist_extractor";

// ==========================================================================
// Tipos públicos
// ==========================================================================

/** Unión discriminada de los 8 modos de análisis del simulador. */
export type AnalysisMode = 'DC' | 'AC' | 'TRAN' | 'SENS' | 'PSS' | 'STB' | 'PVT' | 'SPAR';

export interface SimulationControlHandlers {
  readonly onRunSimulation: (netlist: CircuitNetlist, mode: AnalysisMode) => Promise<void>;
  readonly onStopSimulation: () => Promise<void>;
  readonly setActiveAnalysisMode: (mode: AnalysisMode) => void;
  readonly addLog: (text: string, type: 'system' | 'send' | 'receive' | 'error') => void;
  readonly updateCanvasRendering: () => void;
}

export interface SimulationControls {
  setSimulationRunning: (running: boolean) => void;
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

  function applySimulationVisualState(running: boolean): void {
    if (!runSimBtn || !stopSimBtn) return;

    runSimBtn.disabled = running;
    stopSimBtn.disabled = !running;

    if (running) {
      runSimBtn.classList.add('sim-active');
      stopSimBtn.classList.add('btn-stop');
      const icon = runSimBtn.querySelector('.btn-icon');
      if (icon) icon.textContent = '⏸';
    } else {
      runSimBtn.classList.remove('sim-active');
      stopSimBtn.classList.remove('btn-stop');
      const icon = runSimBtn.querySelector('.btn-icon');
      if (icon) icon.textContent = '▶';
    }

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
    analysisModeSelect.addEventListener('change', () => {
      const mode = analysisModeSelect!.value as AnalysisMode;
      currentMode = mode;
      handlers.setActiveAnalysisMode(mode);

      const modoTexto = mode === 'DC' ? 'Corriente Continua (CC)' :
        mode === 'AC' ? 'Barrido CA (CA)' :
        mode === 'TRAN' ? 'Transitorio (TRAN)' :
        mode === 'SENS' ? 'Sensibilidad y Peor Caso (SENS)' :
        mode === 'PSS' ? 'Régimen Permanente Periódico (PSS)' :
        mode === 'PVT' ? 'Análisis PVT (Process-Voltage-Temperature)' :
        mode === 'SPAR' ? 'Parámetros S (Touchstone)' :
        'Análisis de Estabilidad (STB)';
      handlers.addLog(`Modo de Simulación: ${modoTexto}`, 'system');

      if (mode !== 'PVT') {
        document.querySelectorAll('.pvt-profile-btn').forEach(el => el.remove());
      }
    });
  }

  if (runSimBtn && stopSimBtn) {
    runSimBtn.addEventListener('click', async () => {
      applySimulationVisualState(true);
      await handlers.onRunSimulation({} as CircuitNetlist, currentMode);
    });

    stopSimBtn.addEventListener('click', async () => {
      applySimulationVisualState(false);
      await handlers.onStopSimulation();
    });
  }

  return {
    setSimulationRunning(running: boolean): void {
      applySimulationVisualState(running);
    },

    setActiveModeButton(mode: AnalysisMode): void {
      if (analysisModeSelect) {
        analysisModeSelect.value = mode;
      }
      currentMode = mode;
    },

    destroy(): void {
      analysisModeSelect = null;
      runSimBtn = null;
      stopSimBtn = null;
    },
  };
}
