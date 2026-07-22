import type { CanvasOrchestrator, ComponentInstance, WireInstance } from "../canvas_orchestrator";
import type { PerformanceMonitor } from "./performance_monitor";
import { buildTyTracePoints, type TyTracePoint } from "../ui/oscilloscope_model";
import type { TimeStepResult } from "../ui/oscilloscope_panel";

export interface StressCircuitOptions {
  rows?: number;
  cols?: number;
  spacingX?: number;
  spacingY?: number;
  zoom?: number;
}

export interface RenderBenchmarkResult {
  iterations: number;
  componentCount: number;
  wireCount: number;
  minMs: number;
  medianMs: number;
  maxMs: number;
  averageMs: number;
  monitor: ReturnType<PerformanceMonitor["snapshot"]>;
}

export interface PerformanceHarnessApi {
  createStressCircuit(options?: StressCircuitOptions): { componentCount: number; wireCount: number };
  measureCanvasRender(iterations?: number): RenderBenchmarkResult;
  measureTransientTrace(sampleCount?: number): {
    sampleCount: number;
    outputPointCount: number;
    firstPassMs: number;
    cachedPassMs: number;
    peakPreserved: boolean;
  };
  snapshot(): ReturnType<PerformanceMonitor["snapshot"]>;
}

export interface PerformanceHarnessDependencies {
  enabled: boolean;
  getOrchestrator(): CanvasOrchestrator | null;
  clearVoltages(): void;
  resetPerformanceCaches(): void;
  updateCanvasRendering(immediate?: boolean): void;
  performanceMonitor: PerformanceMonitor;
}

declare global {
  interface Window {
    __ASTRYD_PERF__?: PerformanceHarnessApi;
  }
}

export function installPerformanceHarness(dependencies: PerformanceHarnessDependencies): void {
  if (!dependencies.enabled) return;

  const getOrchestratorOrThrow = (): CanvasOrchestrator => {
    const orchestrator = dependencies.getOrchestrator();
    if (!orchestrator) throw new Error("Orquestador no inicializado");
    return orchestrator;
  };

  window.__ASTRYD_PERF__ = {
    createStressCircuit: (options = {}) => {
      const orchestrator = getOrchestratorOrThrow();
      const rows = Math.max(1, Math.min(options.rows ?? 14, 40));
      const cols = Math.max(1, Math.min(options.cols ?? 18, 50));
      const spacingX = options.spacingX ?? 120;
      const spacingY = options.spacingY ?? 80;
      const components: ComponentInstance[] = [];
      const wires: WireInstance[] = [];

      for (let row = 0; row < rows; row += 1) {
        for (let col = 0; col < cols; col += 1) {
          const index = row * cols + col + 1;
          components.push({
            id: `R${index}`,
            type: "resistor",
            value: "1k",
            x: col * spacingX,
            y: row * spacingY,
            rotation: 0,
          });
        }
      }

      for (let row = 0; row < rows; row += 1) {
        for (let col = 0; col < cols - 1; col += 1) {
          const fromId = `R${row * cols + col + 1}`;
          const toId = `R${row * cols + col + 2}`;
          wires.push({
            id: `wire_${fromId}_to_${toId}`,
            from: { componentId: fromId, pinIndex: 1 },
            to: { componentId: toId, pinIndex: 0 },
            points: [
              { x: col * spacingX + 40, y: row * spacingY },
              { x: (col + 1) * spacingX - 40, y: row * spacingY },
            ],
          });
        }
      }

      orchestrator.components = components;
      orchestrator.wires = wires;
      orchestrator.selectedComponent = null;
      orchestrator.selectedComponents = [];
      orchestrator.selectedWire = null;
      orchestrator.zoom = Math.max(orchestrator.minZoom, Math.min(options.zoom ?? 0.65, orchestrator.maxZoom));
      orchestrator.offsetX = 80;
      orchestrator.offsetY = 120;
      dependencies.clearVoltages();
      dependencies.resetPerformanceCaches();
      dependencies.updateCanvasRendering(true);
      return { componentCount: components.length, wireCount: wires.length };
    },
    measureCanvasRender: (iterations = 40) => {
      const orchestrator = getOrchestratorOrThrow();
      const count = Math.max(1, Math.min(iterations, 250));
      const durations: number[] = [];
      for (let index = 0; index < count; index += 1) {
        const startedAt = performance.now();
        dependencies.updateCanvasRendering(true);
        durations.push(performance.now() - startedAt);
      }
      const sorted = [...durations].sort((a, b) => a - b);
      const total = durations.reduce((sum, value) => sum + value, 0);
      return {
        iterations: count,
        componentCount: orchestrator.components.length,
        wireCount: orchestrator.wires.length,
        minMs: sorted[0],
        medianMs: sorted[Math.floor(sorted.length / 2)],
        maxMs: sorted[sorted.length - 1],
        averageMs: total / durations.length,
        monitor: dependencies.performanceMonitor.snapshot(),
      };
    },
    measureTransientTrace: (requestedSampleCount = 1_000_000) => {
      const sampleCount = Math.max(1_000, Math.min(requestedSampleCount, 1_000_000));
      const emptyCurrents: Record<string, number> = {};
      const results: TimeStepResult[] = new Array(sampleCount);
      for (let index = 0; index < sampleCount; index++) {
        results[index] = {
          time: index / sampleCount,
          nodeVoltages: { "1": index === Math.floor(sampleCount * 0.513) ? 25 : Math.sin(index * 0.01) },
          branchCurrents: emptyCurrents,
        };
      }

      const renderTrace = (): TyTracePoint[] => buildTyTracePoints(
        results,
        "1",
        { width: 1_280, height: 480 },
        { voltsPerDiv: 1, offsetPixels: 0, timeDivValue: 0.1 },
      );
      const firstStartedAt = performance.now();
      const points = renderTrace();
      const firstPassMs = performance.now() - firstStartedAt;
      const cachedStartedAt = performance.now();
      renderTrace();
      const cachedPassMs = performance.now() - cachedStartedAt;

      return {
        sampleCount,
        outputPointCount: points.length,
        firstPassMs,
        cachedPassMs,
        peakPreserved: points.some((point) => point.y < -1_000),
      };
    },
    snapshot: () => dependencies.performanceMonitor.snapshot(),
  };
}
