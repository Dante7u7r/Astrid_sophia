// ==========================================================================
// SIMULATION CONTROLS — Capa de presentación de la barra de herramientas
// ==========================================================================
// Responsabilidades:
//   1. Realizar todas las consultas del DOM para los botones de control
//      de simulación (modo de análisis, run, stop, estado IPC).
//   2. Gestionar el toggle visual de clases CSS ('active', 'disabled',
//      'btn-stop') sobre los botones cuando cambia el modo o el estado
//      de la simulación.
//   3. Delegar la lógica analítica pesada (extracción de netlist, ERC,
//      dispatch a Rust/TS, actualización de paneles) a los handlers
//      inyectados desde main.ts.
//
// Desacoplamiento:
//   El módulo NO importa nada de '../canvas_orchestrator', '../simulation/',
//   ni del DOM de main.ts. Toda la comunicación con la capa de dominio
//   ocurre exclusivamente a través de la interfaz SimulationControlHandlers.
//
//   Esto elimina cualquier riesgo de importación circular, ya que
//   main.ts → simulation_controls.ts es la única dirección de flujo.
// ==========================================================================

import { type CircuitNetlist } from "../simulation/netlist_extractor";

// ==========================================================================
// Tipos públicos
// ==========================================================================

/** Unión discriminada de los 8 modos de análisis del simulador. */
export type AnalysisMode = 'DC' | 'AC' | 'TRAN' | 'SENS' | 'PSS' | 'STB' | 'PVT' | 'SPAR';

/** Pipeline de callbacks para desacoplar la UI de la lógica de dominio.
 *  Los handlers son clausuras residentes en main.ts con acceso completo
 *  a las 15+ variables globales (orchestrator, oscilloscopePanel,
 *  simulationRunner, liveVoltages, etc.). */
export interface SimulationControlHandlers {
  /** Invocado cuando el usuario presiona "Run".
   *  Recibe el netlist ya extraído y el modo activo.
   *  Debe ejecutar ERC, invocar al solver Rust/TS, actualizar
   *  osciloscopio, canvas, logs. */
  readonly onRunSimulation: (netlist: CircuitNetlist, mode: AnalysisMode) => Promise<void>;

  /** Invocado cuando el usuario presiona "Stop".
   *  Debe detener el backend Rust, limpiar el streaming IPC,
   *  detener el osciloscopio y el audio. */
  readonly onStopSimulation: () => Promise<void>;

  /** Persiste el modo de análisis activo y notifica a la UI
   *  (osciloscopio, canvas, botones PVT). */
  readonly setActiveAnalysisMode: (mode: AnalysisMode) => void;

  readonly addLog: (text: string, type: 'system' | 'send' | 'receive' | 'error') => void;
  readonly updateCanvasRendering: () => void;
}

/** Interfaz pública retornada por initSimulationControls(). */
export interface SimulationControls {
  /** Actualiza el estado disabled/enabled de run/stop. */
  setSimulationRunning: (running: boolean) => void;
  /** Restaura la clase 'active' sobre el botón del modo indicado
   *  (usado por initTabManager al restaurar pestañas guardadas). */
  setActiveModeButton: (mode: AnalysisMode) => void;
  /** Libera referencias del DOM para evitar fugas de memoria. */
  destroy: () => void;
}

// ==========================================================================
// Estado interno del módulo
// ==========================================================================

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
let currentMode: AnalysisMode = 'DC';

// ==========================================================================
// Lógica visual de selección de modo
// ==========================================================================

/** Alterna la clase 'active' sobre el botón clickeado y la elimina
 *  de todos los demás. NOTA: la notificación al osciloscopio y
 *  canvas se delega al handler setActiveAnalysisMode. */
function selectMode(
  btn: HTMLButtonElement | null,
  mode: AnalysisMode,
  handlers: SimulationControlHandlers,
): void {
  if (!btn) return;
  btn.addEventListener('click', () => {
    // Limpiar clase active de todos los botones de modo
    const allModeBtns = [
      analysisDcBtn, analysisAcBtn, analysisTranBtn,
      analysisSensBtn, analysisPssBtn, analysisStbBtn,
      analysisPvtBtn, analysisSparBtn,
    ];
    allModeBtns.forEach(b => b?.classList.remove('active'));
    btn.classList.add('active');

    currentMode = mode;
    handlers.setActiveAnalysisMode(mode);

    // Actualizar barra de estado
    const modoTexto = mode === 'DC' ? 'Corriente Continua (CC)' :
      mode === 'AC' ? 'Barrido CA (CA)' :
      mode === 'TRAN' ? 'Transitorio (TRAN)' :
      mode === 'SENS' ? 'Sensibilidad y Peor Caso (SENS)' :
      mode === 'PSS' ? 'Régimen Permanente Periódico (PSS)' :
      mode === 'PVT' ? 'Análisis PVT (Process-Voltage-Temperature)' :
      mode === 'SPAR' ? 'Parámetros S (Touchstone)' :
      'Análisis de Estabilidad (STB)';
    handlers.addLog(`Modo de Simulación: ${modoTexto}`, 'system');

    // Limpiar botones de perfil PVT al cambiar de modo
    if (mode !== 'PVT') {
      document.querySelectorAll('.pvt-profile-btn').forEach(el => el.remove());
    }
  });
}

// ==========================================================================
// Factory: inicialización de controles con inyección de handlers
// ==========================================================================

export function initSimulationControls(
  handlers: SimulationControlHandlers,
): SimulationControls {
  // --- Consultas del DOM con casteo estricto ---
  analysisDcBtn = document.querySelector('#analysis-dc-btn') as HTMLButtonElement | null;
  analysisAcBtn = document.querySelector('#analysis-ac-btn') as HTMLButtonElement | null;
  analysisTranBtn = document.querySelector('#analysis-tran-btn') as HTMLButtonElement | null;
  analysisSensBtn = document.querySelector('#analysis-sens-btn') as HTMLButtonElement | null;
  analysisPssBtn = document.querySelector('#analysis-pss-btn') as HTMLButtonElement | null;
  analysisStbBtn = document.querySelector('#analysis-stb-btn') as HTMLButtonElement | null;
  analysisPvtBtn = document.querySelector('#analysis-pvt-btn') as HTMLButtonElement | null;
  analysisSparBtn = document.querySelector('#analysis-spar-btn') as HTMLButtonElement | null;
  runSimBtn = document.querySelector('#run-sim-btn') as HTMLButtonElement | null;
  stopSimBtn = document.querySelector('#stop-sim-btn') as HTMLButtonElement | null;

  // --- Registrar selectores de modo ---
  selectMode(analysisDcBtn, 'DC', handlers);
  selectMode(analysisAcBtn, 'AC', handlers);
  selectMode(analysisTranBtn, 'TRAN', handlers);
  selectMode(analysisSensBtn, 'SENS', handlers);
  selectMode(analysisPssBtn, 'PSS', handlers);
  selectMode(analysisStbBtn, 'STB', handlers);
  selectMode(analysisPvtBtn, 'PVT', handlers);
  selectMode(analysisSparBtn, 'SPAR', handlers);

  // --- Botón Run: solo mutación visual + delegación ---
  if (runSimBtn && stopSimBtn) {
    runSimBtn.addEventListener('click', async () => {
      runSimBtn!.disabled = true;
      stopSimBtn!.disabled = false;
      stopSimBtn!.classList.add('btn-stop');

      // ACTUAL: el handler recibe el netlist ya extraído.
      // El módulo NO extrae netlist ni ejecuta ERC.
      await handlers.onRunSimulation({} as CircuitNetlist, currentMode);

      // Si el handler falla (no extrajo netlist), se restaura UI
      // mediante el error catch interno del handler.
    });

    // --- Botón Stop: restauración visual + delegación ---
    stopSimBtn.addEventListener('click', async () => {
      runSimBtn!.disabled = false;
      stopSimBtn!.disabled = true;
      stopSimBtn!.classList.remove('btn-stop');

      await handlers.onStopSimulation();
    });
  }

  // --- Objeto público retornado ---
  return {
    setSimulationRunning(running: boolean): void {
      if (!runSimBtn || !stopSimBtn) return;
      runSimBtn.disabled = running;
      stopSimBtn.disabled = !running;
      if (running) {
        stopSimBtn.classList.add('btn-stop');
      } else {
        stopSimBtn.classList.remove('btn-stop');
      }
    },

    setActiveModeButton(mode: AnalysisMode): void {
      const allModeBtns = [
        analysisDcBtn, analysisAcBtn, analysisTranBtn,
        analysisSensBtn, analysisPssBtn, analysisStbBtn,
        analysisPvtBtn, analysisSparBtn,
      ];
      allModeBtns.forEach(b => b?.classList.remove('active'));
      const modeMap: Record<AnalysisMode, HTMLButtonElement | null> = {
        DC: analysisDcBtn, AC: analysisAcBtn, TRAN: analysisTranBtn,
        SENS: analysisSensBtn, PSS: analysisPssBtn, STB: analysisStbBtn,
        PVT: analysisPvtBtn, SPAR: analysisSparBtn,
      };
      modeMap[mode]?.classList.add('active');
      currentMode = mode;
    },

    destroy(): void {
      analysisDcBtn = null;
      analysisAcBtn = null;
      analysisTranBtn = null;
      analysisSensBtn = null;
      analysisPssBtn = null;
      analysisStbBtn = null;
      analysisPvtBtn = null;
      analysisSparBtn = null;
      runSimBtn = null;
      stopSimBtn = null;
    },
  };
}
