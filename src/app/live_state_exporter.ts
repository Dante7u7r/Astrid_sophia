import type { CanvasOrchestrator, ComponentInstance, WireInstance } from "../canvas_orchestrator";
import type { TabManager } from "../ui/tab_manager";
import type { AnalysisMode } from "../ui/simulation_controls";
import { buildCadSchematicSvg } from "../ui/cad_schematic_exporter";

export interface LiveComponentSummary {
  id: string;
  type: string;
  value?: number | string;
  label?: string;
  x: number;
  y: number;
  rotation?: number;
  terminalType?: string;
  voltage?: number;
  waveType?: string;
  frequency?: number;
  amplitude?: number;
  switchState?: boolean;
}

export interface LiveWireSummary {
  id: string;
  from: { componentId: string; pinIndex: number };
  to: { componentId: string; pinIndex: number };
  points: Array<{ x: number; y: number }>;
}

export interface LiveInspectionSnapshot {
  timestamp: string;
  version: "1.0";
  activeTab: {
    id: string | null;
    name: string;
    analysisMode: AnalysisMode;
    unsaved: boolean;
  };
  metrics: {
    componentCount: number;
    wireCount: number;
    resolvedNodeCount: number;
    isSimulating: boolean;
  };
  components: LiveComponentSummary[];
  wires: LiveWireSummary[];
  nodeVoltages: Record<string, number>;
  branchCurrents: Record<string, number>;
  ercIssues: Array<{ severity: string; message: string; componentId?: string }>;
  recentLogs: Array<{ time: string; text: string; type: string }>;
}

export interface LiveStateExporterDeps {
  getOrchestrator: () => CanvasOrchestrator | null;
  getTabManager: () => TabManager | null;
  getActiveAnalysisMode: () => AnalysisMode;
  getVoltageMap: () => Readonly<Record<string, number>>;
  getBranchCurrents: () => Readonly<Record<string, number>>;
  isSimulationActive: () => boolean;
  getRecentLogs: () => Array<{ time: string; text: string; type: string }>;
  invokeTauri: (cmd: string, args?: Record<string, unknown>) => Promise<unknown>;
}

export interface LiveStateExporter {
  buildSnapshot(): LiveInspectionSnapshot;
  buildSvgSchematic(): string;
  flush(): Promise<void>;
  scheduleExport(delayMs?: number): void;
  dispose(): void;
}

export function createLiveStateExporter(deps: LiveStateExporterDeps): LiveStateExporter {
  let exportTimer: ReturnType<typeof setTimeout> | null = null;
  let isFlushing = false;

  const buildSnapshot = (): LiveInspectionSnapshot => {
    const orchestrator = deps.getOrchestrator();
    const tabManager = deps.getTabManager();
    const activeTab = tabManager?.getActiveTab();
    const components = orchestrator?.components ?? [];
    const wires = orchestrator?.wires ?? [];
    const voltageMap = deps.getVoltageMap();
    const branchCurrents = deps.getBranchCurrents();
    const isSimulating = deps.isSimulationActive();
    const recentLogs = deps.getRecentLogs().slice(-20);

    const componentSummaries: LiveComponentSummary[] = components.map((comp: ComponentInstance) => ({
      id: comp.id,
      type: comp.type,
      value: comp.value,
      label: comp.label,
      x: Math.round(comp.x),
      y: Math.round(comp.y),
      rotation: comp.rotation,
      terminalType: comp.terminalType,
      voltage: comp.voltage,
      waveType: comp.waveType,
      frequency: comp.frequency,
      amplitude: comp.amplitude,
      switchState: comp.switchState,
    }));

    const wireSummaries: LiveWireSummary[] = wires.map((wire: WireInstance) => ({
      id: wire.id,
      from: { componentId: wire.from.componentId, pinIndex: wire.from.pinIndex },
      to: { componentId: wire.to.componentId, pinIndex: wire.to.pinIndex },
      points: wire.points.map(pt => ({ x: Math.round(pt.x), y: Math.round(pt.y) })),
    }));

    const ercIssues = (orchestrator?.ercIssues ?? []).map(issue => ({
      severity: ((issue as { severity?: string; type?: string }).severity ?? issue.type ?? "warning"),
      message: issue.message,
      componentId: issue.componentId,
    }));

    return {
      timestamp: new Date().toISOString(),
      version: "1.0",
      activeTab: {
        id: activeTab?.id ?? null,
        name: activeTab?.name ?? "Circuito",
        analysisMode: deps.getActiveAnalysisMode(),
        unsaved: activeTab?.unsaved ?? false,
      },
      metrics: {
        componentCount: components.length,
        wireCount: wires.length,
        resolvedNodeCount: Object.keys(voltageMap).length,
        isSimulating,
      },
      components: componentSummaries,
      wires: wireSummaries,
      nodeVoltages: { ...voltageMap },
      branchCurrents: { ...branchCurrents },
      ercIssues,
      recentLogs,
    };
  };

  const buildSvgSchematic = (): string => {
    const orchestrator = deps.getOrchestrator();
    if (!orchestrator || orchestrator.components.length === 0) return "";
    try {
      const result = buildCadSchematicSvg(orchestrator.components, orchestrator.wires, {
        theme: "print_clean",
        includeGrid: true,
        includeTitleBlock: true,
        titleBlockInfo: {
          title: deps.getTabManager()?.getActiveTab()?.name ?? "Astryd Sophia Live",
          author: "Usuario",
          organization: "Astryd Sophia CAD",
          revision: "1.0-LIVE",
          date: new Date().toLocaleDateString(),
          sheet: "1/1",
        },
        includeNetLabels: true,
      });
      return result.content;
    } catch {
      return "";
    }
  };

  const flush = async (): Promise<void> => {
    if (isFlushing) return;
    isFlushing = true;
    try {
      const snapshot = buildSnapshot();
      const stateJson = JSON.stringify(snapshot, null, 2);
      const svg = buildSvgSchematic();

      if (typeof window !== "undefined") {
        (window as any).__ASTRYD_LIVE_STATE__ = snapshot;
        try {
          localStorage.setItem("astryd_live_state", stateJson);
        } catch {
          // Ignorar cuota de localStorage
        }

        if (typeof fetch === "function") {
          try {
            void fetch("/__astryd_live_state__", {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({ stateJson, svgSchematic: svg }),
            }).catch(() => {});
          } catch {
            // Ignorar errores de red
          }
        }
      }

      await deps.invokeTauri("update_live_inspection_state", {
        stateJson,
        svgSchematic: svg.length > 0 ? svg : undefined,
      });
    } catch {
      // Ignorar errores si no estamos en entorno Tauri
    } finally {
      isFlushing = false;
    }
  };

  const scheduleExport = (delayMs = 500): void => {
    if (exportTimer) {
      clearTimeout(exportTimer);
    }
    exportTimer = setTimeout(() => {
      exportTimer = null;
      void flush();
    }, delayMs);
  };

  return {
    buildSnapshot,
    buildSvgSchematic,
    flush,
    scheduleExport,
    dispose: () => {
      if (exportTimer) {
        clearTimeout(exportTimer);
        exportTimer = null;
      }
    },
  };
}
