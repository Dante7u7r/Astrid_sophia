import { describe, expect, it, vi } from "vitest";
import type { CanvasOrchestrator } from "../canvas_orchestrator";
import { TabFileActions, type TabFileActionDependencies } from "./tab_file_actions";
import { createWorkspaceTab } from "./workspace_state";

function createDependencies(overrides: Partial<TabFileActionDependencies> = {}) {
  const orchestrator = {
    components: [
      { id: "R1", type: "resistor", value: "1k", x: 10, y: 20, rotation: 0 },
    ],
    wires: [],
    zoom: 1,
    offsetX: 0,
    offsetY: 0,
  } as unknown as CanvasOrchestrator;

  const dependencies: TabFileActionDependencies = {
    getOrchestrator: () => orchestrator,
    getOscilloscopePanel: () => null,
    getActiveAnalysisMode: () => "DC",
    getProbes: () => ({ ch1: "1", ch2: "2", ch3: "3", ch4: "4" }),
    getSparPorts: () => [],
    getVoltageSnapshot: () => ({ "1": 5 }),
    documentController: { serializeCircuit: vi.fn(() => "{\"ok\":true}") },
    addLog: vi.fn(),
    invokeTauri: vi.fn(),
    renderTabsBar: vi.fn(),
    ...overrides,
  };

  return { dependencies, orchestrator };
}

describe("TabFileActions", () => {
  it("guarda directo usando la ruta existente y marca la pestana como limpia", async () => {
    const { dependencies } = createDependencies();
    const tab = createWorkspaceTab("tab-1", "Circuito");
    tab.filePath = "C:/tmp/circuito.astryd";
    tab.unsaved = true;
    const actions = new TabFileActions(dependencies);

    await actions.saveDirect(tab, vi.fn());

    expect(dependencies.invokeTauri).toHaveBeenCalledWith("save_circuit_to_path", {
      path: "C:/tmp/circuito.astryd",
      content: "{\"ok\":true}",
    });
    expect(tab.unsaved).toBe(false);
    expect(tab.components).toHaveLength(1);
    expect(tab.voltageSnapshot).toEqual({ "1": 5 });
    expect(dependencies.renderTabsBar).toHaveBeenCalledOnce();
  });

  it("usa guardar como cuando la pestana no tiene ruta", async () => {
    const { dependencies } = createDependencies();
    const tab = createWorkspaceTab("tab-1", "Circuito");
    const fallback = vi.fn(async () => undefined);
    const actions = new TabFileActions(dependencies);

    await actions.saveDirect(tab, fallback);

    expect(fallback).toHaveBeenCalledOnce();
    expect(dependencies.invokeTauri).not.toHaveBeenCalled();
  });

  it("guardar como aplica nombre, ruta y estado limpio si Tauri devuelve archivo", async () => {
    const invokeTauri = vi.fn(async () => "C:/tmp/nuevo.astryd");
    const { dependencies } = createDependencies({ invokeTauri });
    const tab = createWorkspaceTab("tab-1", "Circuito");
    tab.unsaved = true;
    const actions = new TabFileActions(dependencies);

    await actions.saveAs(tab);

    expect(invokeTauri).toHaveBeenCalledWith("save_circuit_file", {
      content: "{\"ok\":true}",
    });
    expect(tab.filePath).toBe("C:/tmp/nuevo.astryd");
    expect(tab.name).toBe("nuevo.astryd");
    expect(tab.unsaved).toBe(false);
    expect(dependencies.renderTabsBar).toHaveBeenCalledOnce();
  });
});
