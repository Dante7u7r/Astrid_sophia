import type { CanvasOrchestrator } from "../canvas_orchestrator";
import type { CircuitDocumentController } from "../app/circuit_document_controller";
import type { OscilloscopePanel } from "../ui/oscilloscope_panel";
import type { CircuitNetlist } from "../simulation/netlist_extractor";
import { invokeTyped } from "../simulation/tauri_commands";
import {
  beginFeedbackRun,
  completeFeedbackRun,
  recordCircuitSummary,
  recordConvergence,
} from "../feedback/instrumentation";

interface DesktopE2eSnapshot {
  readonly componentCount: number;
  readonly wireCount: number;
  readonly activeTabName: string | null;
  readonly analysisMode: string | null;
  readonly acPointCount: number;
  readonly transientSampleCount: number;
  readonly pvtMode: boolean;
  readonly pvtTraceCount: number;
  readonly zoom: number;
  readonly offsetX: number;
  readonly offsetY: number;
  readonly selectedComponentId: string | null;
  readonly components: Array<{
    readonly id: string;
    readonly type: string;
    readonly value?: number | string;
    readonly label?: string;
    readonly clientX: number;
    readonly clientY: number;
    readonly worldX: number;
    readonly worldY: number;
    readonly pins: Array<{ readonly clientX: number; readonly clientY: number }>;
  }>;
}

interface DesktopE2eBridge {
  snapshot(): DesktopE2eSnapshot;
  serializeCircuit(): string;
  loadSerializedCircuit(content: string): boolean;
  setDisablePacing(disable: boolean): void;
  benchmarkFeedbackDc(netlist: CircuitNetlist, iterations: number): Promise<Array<{
    totalMs: number;
    solverMs: number;
    instrumentationMs: number;
  }>>;
}

declare global {
  interface Window {
    __ASTRYD_E2E__?: DesktopE2eBridge;
    orchestrator?: CanvasOrchestrator | null;
    oscilloscopePanel?: OscilloscopePanel | null;
  }
}

interface DesktopE2eBridgeDependencies {
  getOrchestrator(): CanvasOrchestrator | null;
  getDocumentController(): CircuitDocumentController | null;
  getActiveTabName(): string | null;
  getOscilloscopePanel(): OscilloscopePanel | null;
  updateCanvasRendering(): void;
  setDisablePacing?: (disable: boolean) => void;
}

export function installDesktopE2eBridge(dependencies: DesktopE2eBridgeDependencies): void {
  const isAuditOrE2e = typeof import.meta !== "undefined"
    && (import.meta.env.DEV || import.meta.env.MODE === "wdio"
        || (typeof window !== "undefined" && window.location.search.includes("e2e=1")));
  if (!isAuditOrE2e) return;

  // The Tauri service compares the native title with document.title exactly.
  document.title = "Biaani";

  Object.defineProperty(window, "orchestrator", {
    get: () => dependencies.getOrchestrator(),
    configurable: true,
  });
  Object.defineProperty(window, "oscilloscopePanel", {
    get: () => dependencies.getOscilloscopePanel(),
    configurable: true,
  });

  window.__ASTRYD_E2E__ = {
    snapshot(): DesktopE2eSnapshot {
      const orchestrator = dependencies.getOrchestrator();
      const oscilloscope = dependencies.getOscilloscopePanel();
      const canvas = document.querySelector<HTMLCanvasElement>("#circuit-canvas");
      if (!orchestrator || !canvas) {
        return {
          componentCount: 0,
          wireCount: 0,
          activeTabName: null,
          analysisMode: oscilloscope?.activeAnalysisMode ?? null,
          acPointCount: oscilloscope?.acSweepResults?.frequencies.length ?? 0,
          transientSampleCount: oscilloscope?.transientResults.length ?? 0,
          pvtMode: oscilloscope?.pvtMode ?? false,
          pvtTraceCount: oscilloscope?.pvtTraces.length ?? 0,
          zoom: 1.0,
          offsetX: 0,
          offsetY: 0,
          selectedComponentId: null,
          components: [],
        };
      }

      const rect = canvas.getBoundingClientRect();
      return {
        componentCount: orchestrator.components.length,
        wireCount: orchestrator.wires.length,
        activeTabName: dependencies.getActiveTabName(),
        analysisMode: oscilloscope?.activeAnalysisMode ?? null,
        acPointCount: oscilloscope?.acSweepResults?.frequencies.length ?? 0,
        transientSampleCount: oscilloscope?.transientResults.length ?? 0,
        pvtMode: oscilloscope?.pvtMode ?? false,
        pvtTraceCount: oscilloscope?.pvtTraces.length ?? 0,
        zoom: orchestrator.zoom,
        offsetX: orchestrator.offsetX,
        offsetY: orchestrator.offsetY,
        selectedComponentId: orchestrator.selectedComponent?.id ?? null,
        components: orchestrator.components.map((component) => {
          const center = orchestrator.worldToScreen(component.x, component.y);
          return {
            id: component.id,
            type: component.type,
            value: component.value,
            label: component.label,
            clientX: rect.left + center.x,
            clientY: rect.top + center.y,
            worldX: component.x,
            worldY: component.y,
            pins: orchestrator.getComponentPins(component).map((pin) => {
              const point = orchestrator.worldToScreen(pin.x, pin.y);
              return { clientX: rect.left + point.x, clientY: rect.top + point.y };
            }),
          };
        }),
      };
    },

    serializeCircuit(): string {
      return dependencies.getDocumentController()?.serializeCircuit() ?? "{}";
    },

    loadSerializedCircuit(content: string): boolean {
      const loaded = dependencies.getDocumentController()?.deserializeCircuit(content) ?? false;
      if (loaded) dependencies.updateCanvasRendering();
      return loaded;
    },

    setDisablePacing(disable: boolean): void {
      dependencies.setDisablePacing?.(disable);
    },

    async benchmarkFeedbackDc(netlist: CircuitNetlist, requestedIterations: number) {
      const iterations = Math.max(1, Math.min(requestedIterations, 50));
      const execute = async () => {
        const startedAt = performance.now();
        const preInstrumentationStartedAt = performance.now();
        const run = beginFeedbackRun({
          analysis: "DC",
          workspaceId: "feedback-benchmark",
          netlist,
          settings: { tolerance: 1e-6, maxIterations: 100 },
        });
        recordCircuitSummary(run, netlist);
        const preInstrumentationMs = performance.now() - preInstrumentationStartedAt;
        const solverStartedAt = performance.now();
        const result = await invokeTyped("run_dc_simulation", {
          netlist,
          tolerance: 1e-6,
          maxIterations: 100,
        });
        const solverMs = performance.now() - solverStartedAt;
        const postInstrumentationStartedAt = performance.now();
        recordConvergence(run, result);
        completeFeedbackRun(run, { pointCount: 1, converged: result.converged ?? true });
        const postInstrumentationMs = performance.now() - postInstrumentationStartedAt;
        return {
          totalMs: performance.now() - startedAt,
          solverMs,
          instrumentationMs: preInstrumentationMs + postInstrumentationMs,
        };
      };

      for (let warmup = 0; warmup < 3; warmup += 1) await execute();
      const durations: Array<{
        totalMs: number;
        solverMs: number;
        instrumentationMs: number;
      }> = [];
      for (let index = 0; index < iterations; index += 1) durations.push(await execute());
      return durations;
    },
  };
}
