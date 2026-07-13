import { afterEach, describe, expect, it, vi } from "vitest";
import { createDesktopWorkspaceControllers } from "./desktop_workspace_controllers";

const mocks = vi.hoisted(() => ({
  documentController: { serializeCircuit: vi.fn(() => "{}") },
  tabManager: {
    markCurrentTabAsModified: vi.fn(),
  },
  tabCallbacks: null as Record<string, unknown> | null,
  propertyEditor: {},
  propertyEditorCallbacks: null as Record<string, unknown> | null,
  exporterPanel: {},
  exporterPanelCallbacks: null as Record<string, unknown> | null,
  settingsCallback: null as ((settings: unknown) => void) | null,
}));

vi.mock("./circuit_document_controller", () => ({
  createCircuitDocumentController: vi.fn(() => mocks.documentController),
}));

vi.mock("../ui/tab_manager", () => ({
  TabManager: vi.fn().mockImplementation(function TabManager(callbacks: Record<string, unknown>) {
    mocks.tabCallbacks = callbacks;
    return mocks.tabManager;
  }),
}));

vi.mock("../ui/property_editor", () => ({
  PropertyEditor: vi.fn().mockImplementation(function PropertyEditor(callbacks: Record<string, unknown>) {
    mocks.propertyEditorCallbacks = callbacks;
    return mocks.propertyEditor;
  }),
}));

vi.mock("../ui/exporter_panel", () => ({
  ExporterPanel: vi.fn().mockImplementation(function ExporterPanel(callbacks: Record<string, unknown>) {
    mocks.exporterPanelCallbacks = callbacks;
    return mocks.exporterPanel;
  }),
}));

vi.mock("../ui/settings_modal", () => ({
  SettingsModal: vi.fn().mockImplementation(function SettingsModal(_settings: unknown, callback: (settings: unknown) => void) {
    mocks.settingsCallback = callback;
  }),
}));

afterEach(() => {
  vi.clearAllMocks();
  mocks.tabCallbacks = null;
  mocks.propertyEditorCallbacks = null;
  mocks.exporterPanelCallbacks = null;
  mocks.settingsCallback = null;
});

describe("createDesktopWorkspaceControllers", () => {
  it("crea controladores de workspace y conserva callbacks criticos", () => {
    let settings = { dt: 1, tolerance: 2, maxIterations: 3 };
    const setSimulationSettings = vi.fn((nextSettings) => {
      settings = nextSettings as typeof settings;
    });
    const addLog = vi.fn();
    const simulationControls = {
      isSimulationRunning: vi.fn(() => false),
      setActiveModeButton: vi.fn(),
    };
    const circuitState = {
      getVoltageMap: vi.fn(() => ({ "1": 5 })),
      setVoltagesFromSnapshot: vi.fn(),
      actuatorHistory: { clear: vi.fn() },
      audioOrchestrator: { stopAll: vi.fn() },
    };
    const probePlacementController = {
      getNodes: vi.fn(() => ({ ch1: "1", ch2: "2", ch3: "3", ch4: "4" })),
      setNodes: vi.fn(),
    };

    const controllers = createDesktopWorkspaceControllers({
      circuitState,
      probePlacementController,
      getOrchestrator: () => null,
      getOscilloscopePanel: () => null,
      getMcuDebugPanel: () => null,
      getSimulationRunner: () => null,
      getSimulationControls: () => simulationControls,
      getSimulationSettings: () => settings,
      setSimulationSettings,
      getActiveAnalysisMode: () => "DC",
      setActiveAnalysisMode: vi.fn(),
      getSparPorts: vi.fn(() => []),
      setSparPorts: vi.fn(),
      extractNetlist: vi.fn(() => null),
      resetPerformanceCaches: vi.fn(),
      updateCanvasRendering: vi.fn(),
      updateOscilloscopeRendering: vi.fn(),
      addLog,
      logError: vi.fn(),
      invokeTauri: vi.fn(),
    } as never);

    expect(controllers.circuitDocumentController).toBe(mocks.documentController);
    expect(controllers.tabManager).toBe(mocks.tabManager);
    expect(controllers.propertyEditor).toBe(mocks.propertyEditor);
    expect(controllers.exporterPanel).toBe(mocks.exporterPanel);

    (mocks.propertyEditorCallbacks!.markCurrentTabAsModified as () => void)();
    expect(mocks.tabManager.markCurrentTabAsModified).toHaveBeenCalledOnce();

    expect((mocks.tabCallbacks!.canChangeActiveTab as () => boolean)()).toBe(true);
    (mocks.tabCallbacks!.resetRuntimeState as () => void)();
    expect(circuitState.actuatorHistory.clear).toHaveBeenCalledOnce();
    expect(circuitState.audioOrchestrator.stopAll).toHaveBeenCalledOnce();

    expect((mocks.exporterPanelCallbacks!.getProbeNodes as () => unknown)()).toEqual({ ch1: "1", ch2: "2" });

    mocks.settingsCallback!({ dt: 4, tolerance: 5, maxIterations: 6 });
    expect(setSimulationSettings).toHaveBeenCalledWith({ dt: 4, tolerance: 5, maxIterations: 6 });
    expect(addLog).toHaveBeenCalledWith("Ajustes guardados: dt=4, tol=5, iterMax=6", "system");
  });
});
