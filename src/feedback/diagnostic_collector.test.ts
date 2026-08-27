// @vitest-environment happy-dom

import { describe, it, expect, vi } from "vitest";
import {
  collectDiagnosticBundle,
  captureEnvironmentMetadata,
  captureCanvasScreenshot,
  type DiagnosticCollectorDeps,
} from "./diagnostic_collector";
import type { CanvasOrchestrator, ComponentInstance, WireInstance } from "../canvas_orchestrator";

describe("diagnostic_collector", () => {
  it("captura metadatos de entorno válidos", () => {
    const env = captureEnvironmentMetadata();
    expect(env.appVersion).toBeDefined();
    expect(env.os).toBeDefined();
    expect(env.screenResolution).toBeDefined();
    expect(env.devicePixelRatio).toBeGreaterThan(0);
    expect(env.timestamp).toBeDefined();
  });

  it("captura screenshot de canvas cuando está disponible", () => {
    const mockCanvas = {
      toDataURL: vi.fn().mockReturnValue("data:image/png;base64,mockdata"),
    } as unknown as HTMLCanvasElement;

    const screenshot = captureCanvasScreenshot(mockCanvas);
    expect(screenshot).toBe("data:image/png;base64,mockdata");
    expect(mockCanvas.toDataURL).toHaveBeenCalledWith("image/png");
  });

  it("construye un DiagnosticBundle completo con circuito, logs y metadatos", () => {
    const mockOrchestrator = {
      components: [{ id: "R1", type: "resistor", x: 100, y: 100 }] as ComponentInstance[],
      wires: [{ id: "W1" }] as WireInstance[],
    } as CanvasOrchestrator;

    const mockDocController = {
      serializeCircuit: vi.fn().mockReturnValue(JSON.stringify({ version: "1.0", components: [] })),
    };

    const deps: DiagnosticCollectorDeps = {
      getOrchestrator: () => mockOrchestrator,
      getCircuitDocumentController: () => mockDocController as any,
      getSimulationSettings: () => ({ dt: 0.001, tolerance: 1e-5, maxIterations: 100, transientDuration: 0.01 }),
      getActiveAnalysisMode: () => "TRAN",
      isSimulationActive: () => true,
      getRecentLogs: () => [
        { time: "12:00:00.000", text: "Inicio de simulación", type: "system" },
      ],
      getActiveTabName: () => "Filtro RC",
    };

    const bundle = collectDiagnosticBundle(deps, {
      category: "simulation",
      userNote: "La simulación divergió en t=2ms",
      contact: "test@example.com",
    });

    expect(bundle.format).toBe("biaani-diagnostic-bundle");
    expect(bundle.schemaVersion).toBe(1);
    expect(bundle.category).toBe("simulation");
    expect(bundle.userNote).toBe("La simulación divergió en t=2ms");
    expect(bundle.contact).toBe("test@example.com");
    expect(bundle.circuit?.componentCount).toBe(1);
    expect(bundle.circuit?.wireCount).toBe(1);
    expect(bundle.simulation?.activeMode).toBe("TRAN");
    expect(bundle.simulation?.isSimulating).toBe(true);
    expect(bundle.simulation?.tabName).toBe("Filtro RC");
    expect(bundle.recentLogs).toHaveLength(1);
  });

  it("respeta exclusiones cuando el usuario desmarca opciones", () => {
    const deps: DiagnosticCollectorDeps = {
      getOrchestrator: () => null,
      getSimulationSettings: () => ({ dt: 0.001, tolerance: 1e-5, maxIterations: 100, transientDuration: 0.01 }),
      getActiveAnalysisMode: () => "DC",
      isSimulationActive: () => false,
      getRecentLogs: () => [{ time: "12:00:00", text: "Log", type: "system" }],
    };

    const bundle = collectDiagnosticBundle(deps, {
      inclusions: {
        includeCircuitFile: false,
        includeLogs: false,
        includeEnvironment: false,
      },
    });

    expect(bundle.circuit).toBeUndefined();
    expect(bundle.recentLogs).toBeUndefined();
    expect(bundle.environment).toBeUndefined();
  });
});
