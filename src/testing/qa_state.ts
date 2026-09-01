import type { AnalysisMode } from "../ui/simulation_controls";

export interface AstrydQaState {
  readonly enabled: boolean;
  lastLog: string | null;
  lastLogType: "system" | "send" | "receive" | "error" | null;
  lastDemoFile: string | null;
  lastSimulationMode: AnalysisMode | null;
  lastSolver: "rust" | "typescript" | "mock" | null;
  lastDcNodeVoltages: Record<string, number>;
  activeInstrumentTab: string | null;
  simulationRunning: boolean;
  simulationRunCount: number;
  lastUpdatedAt: string;
}

type QaStatePatch = Partial<Omit<AstrydQaState, "enabled" | "simulationRunCount">>;

declare global {
  interface Window {
    __ASTRYD_QA__?: AstrydQaState;
  }
}

const QA_ENABLED = typeof import.meta !== "undefined"
  && (import.meta.env.DEV || import.meta.env.MODE === "audit" || import.meta.env.MODE === "wdio");

const state: AstrydQaState = {
  enabled: QA_ENABLED,
  lastLog: null,
  lastLogType: null,
  lastDemoFile: null,
  lastSimulationMode: null,
  lastSolver: null,
  lastDcNodeVoltages: {},
  activeInstrumentTab: null,
  simulationRunning: false,
  simulationRunCount: 0,
  lastUpdatedAt: new Date(0).toISOString(),
};

export function installQaState(): void {
  if (!QA_ENABLED || typeof window === "undefined") return;
  window.__ASTRYD_QA__ = state;
  syncDomState();
}

export function updateQaState(patch: QaStatePatch): void {
  if (!QA_ENABLED) return;
  if (patch.simulationRunning === true && !state.simulationRunning) {
    state.simulationRunCount += 1;
    state.lastSolver = null;
    state.lastDcNodeVoltages = {};
  }
  Object.assign(state, patch, { lastUpdatedAt: new Date().toISOString() });
  syncDomState();
}

/** Solo se registra al recibir resultados, nunca a partir del texto de un log. */
export function recordQaSolverResult(solver: "rust" | "typescript" | "mock"): void {
  if (!QA_ENABLED || state.lastSolver === solver) return;
  updateQaState({ lastSolver: solver });
}

export function recordQaLog(
  text: string,
  type: "system" | "send" | "receive" | "error",
): void {
  if (!QA_ENABLED) return;

  const patch: QaStatePatch = {
    lastLog: text,
    lastLogType: type,
  };

  const demoMatch = text.match(/Demo \[(.+?)\] cargada correctamente/);
  if (demoMatch) {
    patch.lastDemoFile = demoMatch[1];
  }

  const dcMatch = text.match(/^Nodo\s+(.+?):\s+Voltaje\s+=\s+(-?\d+(?:\.\d+)?)\s+V/);
  if (dcMatch) {
    patch.lastDcNodeVoltages = {
      ...state.lastDcNodeVoltages,
      [dcMatch[1]]: Number(dcMatch[2]),
    };
  }

  updateQaState(patch);
}

function syncDomState(): void {
  if (typeof document === "undefined") return;
  const root = document.documentElement;
  root.dataset.qaEnabled = String(state.enabled);
  root.dataset.qaLastDemoFile = state.lastDemoFile ?? "";
  root.dataset.qaLastSimulationMode = state.lastSimulationMode ?? "";
  root.dataset.qaLastSolver = state.lastSolver ?? "";
  root.dataset.qaActiveInstrumentTab = state.activeInstrumentTab ?? "";
  root.dataset.qaSimulationRunning = String(state.simulationRunning);
  root.dataset.qaSimulationRunCount = String(state.simulationRunCount);
  root.dataset.qaNodeVoltages = JSON.stringify(state.lastDcNodeVoltages);
}
