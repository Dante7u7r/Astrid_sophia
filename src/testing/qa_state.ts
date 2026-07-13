import type { AnalysisMode } from "../ui/simulation_controls";

export interface AstrydQaState {
  readonly enabled: boolean;
  lastLog: string | null;
  lastLogType: "system" | "send" | "receive" | "error" | null;
  lastDemoFile: string | null;
  lastSimulationMode: AnalysisMode | null;
  lastSolver: "rust" | "typescript" | null;
  lastDcNodeVoltages: Record<string, number>;
  activeInstrumentTab: string | null;
  simulationRunning: boolean;
  lastUpdatedAt: string;
}

declare global {
  interface Window {
    __ASTRYD_QA__?: AstrydQaState;
  }
}

const QA_ENABLED = typeof import.meta !== "undefined"
  && (import.meta.env.DEV || import.meta.env.MODE === "audit");

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
  lastUpdatedAt: new Date(0).toISOString(),
};

export function installQaState(): void {
  if (!QA_ENABLED || typeof window === "undefined") return;
  window.__ASTRYD_QA__ = state;
  syncDomState();
}

export function updateQaState(patch: Partial<Omit<AstrydQaState, "enabled">>): void {
  if (!QA_ENABLED) return;
  Object.assign(state, patch, { lastUpdatedAt: new Date().toISOString() });
  syncDomState();
}

export function recordQaLog(
  text: string,
  type: "system" | "send" | "receive" | "error",
): void {
  if (!QA_ENABLED) return;

  const patch: Partial<Omit<AstrydQaState, "enabled">> = {
    lastLog: text,
    lastLogType: type,
  };

  const demoMatch = text.match(/Demo \[(.+?)\] cargada correctamente/);
  if (demoMatch) {
    patch.lastDemoFile = demoMatch[1];
  }

  if (text.includes("Rust")) {
    patch.lastSolver = "rust";
  } else if (text.includes("TypeScript")) {
    patch.lastSolver = "typescript";
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
  root.dataset.qaNodeVoltages = JSON.stringify(state.lastDcNodeVoltages);
}
