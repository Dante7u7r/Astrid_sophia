// @vitest-environment happy-dom

import { afterEach, describe, expect, it, vi } from "vitest";
import { createDesktopUiControllers } from "./desktop_ui_controllers";

const mocks = vi.hoisted(() => ({
  renderController: { handlePlaybackFrame: vi.fn() },
  renderDeps: null as Record<string, unknown> | null,
  telemetryPanel: { start: vi.fn() },
  instrumentationCallbacks: null as Record<string, unknown> | null,
  runElectricalRuleCheck: vi.fn(() => ({ warnings: ["w"], errors: [] })),
  parseErcIssues: vi.fn(() => [{ severity: "warning", message: "w" }]),
  mcuDebugPanel: { updateData: vi.fn() },
}));

vi.mock("./render_controller", () => ({
  createRenderController: vi.fn((deps: Record<string, unknown>) => {
    mocks.renderDeps = deps;
    return mocks.renderController;
  }),
}));

vi.mock("../ui/oscilloscope_panel", () => ({
  OscilloscopePanel: vi.fn().mockImplementation(function OscilloscopePanel() {
    return { onFrameUpdate: null };
  }),
}));

vi.mock("../ui/telemetry_panel", () => ({
  TelemetryPanel: vi.fn().mockImplementation(function TelemetryPanel() {
    return mocks.telemetryPanel;
  }),
}));

vi.mock("../ui/mcu_debug_panel", () => ({
  McuDebugPanel: vi.fn().mockImplementation(function McuDebugPanel() {
    return mocks.mcuDebugPanel;
  }),
}));

vi.mock("../ui/instrumentation_menu", () => ({
  initInstrumentationMenu: vi.fn((callbacks: Record<string, unknown>) => {
    mocks.instrumentationCallbacks = callbacks;
  }),
  parseErcIssues: mocks.parseErcIssues,
}));

vi.mock("../simulation/simulation_dispatcher", () => ({
  runElectricalRuleCheck: mocks.runElectricalRuleCheck,
}));

afterEach(() => {
  document.body.innerHTML = "";
  vi.clearAllMocks();
  mocks.renderDeps = null;
  mocks.instrumentationCallbacks = null;
});

describe("createDesktopUiControllers", () => {
  it("cablea render, telemetria, osciloscopio, ERC e instrumentacion", () => {
    document.body.innerHTML = `
      <button id="settings-trigger-btn"></button>
      <aside id="sidebar-right"><div class="panel-body"></div></aside>
    `;
    const updateOscilloscopeRendering = vi.fn();
    const updateCanvasRendering = vi.fn();
    const sidePanelController = { toggleSidePanel: vi.fn() };
    const panelLayoutManager = { togglePanel: vi.fn() };
    const orchestrator = {
      components: [{ id: "R1" }],
      wires: [],
      ercIssues: [],
      getComponentPins: vi.fn(() => []),
      render: vi.fn(),
    };
    const deps = {
      visualAudit: { enabled: false, stage: "static", step: "full", isStep: vi.fn(() => false) },
      performanceMonitor: { snapshot: vi.fn() },
      circuitState: {},
      probePlacementController: { getNodes: vi.fn(() => ({ ch1: "1", ch2: "2", ch3: "3", ch4: "4" })) },
      getOrchestrator: () => orchestrator,
      getPanelLayoutManager: () => panelLayoutManager,
      getInstrumentsDock: () => null,
      getSidePanelController: () => sidePanelController,
      getSparPorts: vi.fn(() => []),
      extractNetlist: vi.fn(() => ({ components: [] })),
      updateCanvasRendering,
      updateOscilloscopeRendering,
      addLog: vi.fn(),
      requestAnimationFrame: vi.fn(),
      now: vi.fn(() => 1),
    };

    const controllers = createDesktopUiControllers(deps as never);

    expect(controllers.renderController).toBe(mocks.renderController);
    expect(controllers.mcuDebugPanel).toBe(mocks.mcuDebugPanel);
    expect(mocks.telemetryPanel.start).toHaveBeenCalledOnce();

    window.dispatchEvent(new Event("panel-layout-change"));
    expect(updateOscilloscopeRendering).toHaveBeenCalledOnce();

    controllers.oscilloscopePanel.onFrameUpdate?.(0.25);
    expect(mocks.renderController.handlePlaybackFrame).toHaveBeenCalledWith(0.25);

    const result = (mocks.instrumentationCallbacks!.runErc as () => unknown)();
    expect(result).toEqual({ warnings: ["w"], errors: [], issues: [{ severity: "warning", message: "w" }] });
    expect(orchestrator.ercIssues).toEqual([{ severity: "warning", message: "w" }]);
    expect(orchestrator.render).toHaveBeenCalledOnce();

    (mocks.instrumentationCallbacks!.toggleLeftPanel as () => void)();
    (mocks.instrumentationCallbacks!.toggleRightPanel as () => void)();
    (mocks.instrumentationCallbacks!.toggleInstrumentCenter as () => void)();
    expect(sidePanelController.toggleSidePanel).toHaveBeenNthCalledWith(1, "left");
    expect(sidePanelController.toggleSidePanel).toHaveBeenNthCalledWith(2, "right");
    expect(panelLayoutManager.togglePanel).toHaveBeenCalledWith("dock");
  });
});
