import { describe, test, expect, vi, beforeEach } from "vitest";
import { createLiveStateExporter } from "./live_state_exporter";
import type { CanvasOrchestrator } from "../canvas_orchestrator";
import type { TabManager } from "../ui/tab_manager";

describe("live_state_exporter", () => {
  let mockOrchestrator: CanvasOrchestrator;
  let mockTabManager: TabManager;
  let invokeTauri: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    mockOrchestrator = {
      components: [
        { id: "R1", type: "resistor", value: 1000, x: 100, y: 200, rotation: 0 },
        { id: "V1", type: "vsource", value: 5, x: 50, y: 200, rotation: 0 },
      ],
      wires: [
        {
          id: "w1",
          from: { componentId: "V1", pinIndex: 0 },
          to: { componentId: "R1", pinIndex: 0 },
          points: [{ x: 50, y: 200 }, { x: 100, y: 200 }],
        },
      ],
      ercIssues: [
        { severity: "warning", message: "Falta conexión a tierra" },
      ],
      simulationActive: true,
    } as unknown as CanvasOrchestrator;

    mockTabManager = {
      getActiveTab: () => ({
        id: "tab-123",
        name: "Prueba Live",
        unsaved: true,
      }),
    } as unknown as TabManager;

    invokeTauri = vi.fn().mockResolvedValue(undefined);
  });

  test("buildSnapshot recolecta metricas, componentes, cables y voltajes correctamente", () => {
    const exporter = createLiveStateExporter({
      getOrchestrator: () => mockOrchestrator,
      getTabManager: () => mockTabManager,
      getActiveAnalysisMode: () => "TRAN",
      getVoltageMap: () => ({ "0": 0, "1": 5.0, "2": 2.5 }),
      getBranchCurrents: () => ({ V1: -0.005 }),
      isSimulationActive: () => true,
      getRecentLogs: () => [
        { time: "12:00:00.000", text: "Simulación iniciada", type: "system" },
      ],
      invokeTauri,
    });

    const snapshot = exporter.buildSnapshot();

    expect(snapshot.version).toBe("1.0");
    expect(snapshot.activeTab.id).toBe("tab-123");
    expect(snapshot.activeTab.name).toBe("Prueba Live");
    expect(snapshot.activeTab.analysisMode).toBe("TRAN");
    expect(snapshot.metrics.componentCount).toBe(2);
    expect(snapshot.metrics.wireCount).toBe(1);
    expect(snapshot.metrics.resolvedNodeCount).toBe(3);
    expect(snapshot.metrics.isSimulating).toBe(true);

    expect(snapshot.components).toHaveLength(2);
    expect(snapshot.components[0]?.id).toBe("R1");
    expect(snapshot.components[0]?.value).toBe(1000);

    expect(snapshot.wires).toHaveLength(1);
    expect(snapshot.wires[0]?.from.componentId).toBe("V1");

    expect(snapshot.nodeVoltages).toEqual({ "0": 0, "1": 5.0, "2": 2.5 });
    expect(snapshot.ercIssues).toHaveLength(1);
    expect(snapshot.ercIssues[0]?.severity).toBe("warning");

    expect(snapshot.recentLogs).toHaveLength(1);
  });

  test("flush invoca update_live_inspection_state en Tauri", async () => {
    const exporter = createLiveStateExporter({
      getOrchestrator: () => mockOrchestrator,
      getTabManager: () => mockTabManager,
      getActiveAnalysisMode: () => "DC",
      getVoltageMap: () => ({}),
      getBranchCurrents: () => ({}),
      isSimulationActive: () => false,
      getRecentLogs: () => [],
      invokeTauri,
    });

    await exporter.flush();

    expect(invokeTauri).toHaveBeenCalledWith("update_live_inspection_state", expect.objectContaining({
      stateJson: expect.any(String),
    }));
  });
});
