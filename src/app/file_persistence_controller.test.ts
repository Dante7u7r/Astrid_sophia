// @vitest-environment happy-dom

import { afterEach, describe, expect, it, vi } from "vitest";
import { initFilePersistenceController } from "./file_persistence_controller";
import type { CircuitDocumentPort, ValidatedCircuitFile } from "./circuit_document_controller";
import type { Tab, TabManager } from "../ui/tab_manager";

const flushAsyncHandlers = () => new Promise(resolve => setTimeout(resolve, 0));

function createValidatedFile(): ValidatedCircuitFile {
  return {
    migratedFrom: null,
    data: {
      version: "3.0",
      components: [],
      wires: [],
      viewport: { zoom: 1, offsetX: 0, offsetY: 0 },
      simSettings: { dt: 0.0001, tolerance: 0.00001, maxIterations: 100 },
      activeAnalysisMode: "DC",
      probes: {
        ch1ProbeNode: "1",
        ch2ProbeNode: "2",
        ch3ProbeNode: "3",
        ch4ProbeNode: "4",
      },
      sparPorts: [],
      oscilloscope: {
        channelsEnabled: [true, false, false, false],
        voltsPerDiv: [1, 1, 1, 1],
        offsets: [0, 0, 0, 0],
        timeDivValue: 0.02,
        isXyMode: false,
        isCursorsEnabled: false,
        triggerChannel: "ch1",
        triggerEdge: "rising",
        triggerLevel: 0,
        cursorT1: 0.25,
        cursorT2: 0.75,
        cursorV1: 1,
        cursorV2: -1,
      },
    },
  };
}

function createTab(overrides: Partial<Tab> = {}): Tab {
  return {
    id: "tab-1",
    name: "Circuito 1",
    components: [],
    wires: [],
    zoom: 1,
    offsetX: 0,
    offsetY: 0,
    filePath: null,
    unsaved: false,
    transientResults: [],
    acSweepResults: null,
    pvtMode: false,
    pvtTraces: [],
    sparResult: null,
    sparCh1Index: 0,
    sparCh2Index: 1,
    sparPorts: [],
    voltageSnapshot: {},
    oscilloscopeState: createValidatedFile().data.oscilloscope,
    ch1ProbeNode: "1",
    ch2ProbeNode: "2",
    ch3ProbeNode: "3",
    ch4ProbeNode: "4",
    activeAnalysisMode: "DC",
    ...overrides,
  };
}

function createTabManagerStub(tab = createTab()): TabManager {
  let activeTab = tab;
  const manager = {
    createNewTab: vi.fn((name?: string) => {
      const newTab = createTab({ id: "tab-2", name: name ?? "Circuito 2" });
      activeTab = newTab;
      return newTab;
    }),
    getActiveTab: vi.fn(() => activeTab),
    isTabEmpty: vi.fn((candidate: Tab) => (
      candidate.components.length === 0
      && candidate.wires.length === 0
      && candidate.filePath === null
      && !candidate.unsaved
    )),
    applyLoadedFileToTab: vi.fn((tabId: string, metadata: { name: string; filePath: string | null; unsaved?: boolean }) => {
      const target = activeTab.id === tabId ? activeTab : tab;
      target.name = metadata.name;
      target.filePath = metadata.filePath;
      target.unsaved = metadata.unsaved ?? false;
      return target;
    }),
    closeTab: vi.fn(async () => undefined),
    saveCircuitDirect: vi.fn(),
  };
  return manager as unknown as TabManager;
}

afterEach(() => {
  document.body.innerHTML = "";
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe("initFilePersistenceController", () => {
  it("conecta el boton Nuevo con el gestor de pestanas", () => {
    document.body.innerHTML = `<button id="btn-new-circuit"></button>`;
    const tabManager = createTabManagerStub();

    initFilePersistenceController({
      getTabManager: () => tabManager,
      documentController: {
        serializeCircuit: vi.fn(),
        validateCircuitFileForLoad: vi.fn(),
        deserializeCircuit: vi.fn(),
      },
      addLog: vi.fn(),
      invokeTauri: vi.fn(),
    });

    document.querySelector<HTMLButtonElement>("#btn-new-circuit")!.click();

    expect(tabManager.createNewTab).toHaveBeenCalledOnce();
  });

  it("carga una demo validada en una pestana nueva", async () => {
    document.body.innerHTML = `<select id="btn-open-demo"><option value="01.astryd">01</option></select>`;
    const tabManager = createTabManagerStub();
    const validated = createValidatedFile();
    const validateCircuitFileForLoad = vi.fn(() => validated);
    const deserializeCircuit = vi.fn(() => true);
    const documentController: CircuitDocumentPort = {
      serializeCircuit: vi.fn(),
      validateCircuitFileForLoad,
      deserializeCircuit,
    };
    vi.stubGlobal("fetch", vi.fn(async () => ({
      ok: true,
      text: async () => "{}",
    })));

    initFilePersistenceController({
      getTabManager: () => tabManager,
      documentController,
      addLog: vi.fn(),
      invokeTauri: vi.fn(),
    });

    const select = document.querySelector<HTMLSelectElement>("#btn-open-demo")!;
    select.value = "01.astryd";
    select.dispatchEvent(new Event("change"));
    await flushAsyncHandlers();

    expect(validateCircuitFileForLoad).toHaveBeenCalledWith("{}");
    expect(deserializeCircuit).toHaveBeenCalledWith("{}", validated);
    expect(tabManager.applyLoadedFileToTab).toHaveBeenCalledWith("tab-2", {
      name: "01",
      filePath: null,
      unsaved: false,
    });
  });

  it("abre un archivo en la pestana vacia activa", async () => {
    document.body.innerHTML = `<button id="btn-open-circuit"></button>`;
    const currentTab = createTab();
    const tabManager = createTabManagerStub(currentTab);
    const validated = createValidatedFile();
    const deserializeCircuit = vi.fn(() => true);
    const documentController: CircuitDocumentPort = {
      serializeCircuit: vi.fn(),
      validateCircuitFileForLoad: vi.fn(() => validated),
      deserializeCircuit,
    };

    initFilePersistenceController({
      getTabManager: () => tabManager,
      documentController,
      addLog: vi.fn(),
      invokeTauri: vi.fn(async () => ["C:\\tmp\\demo.astryd", "{}"] as [string, string]),
    });

    document.querySelector<HTMLButtonElement>("#btn-open-circuit")!.click();
    await flushAsyncHandlers();

    expect(tabManager.createNewTab).not.toHaveBeenCalled();
    expect(deserializeCircuit).toHaveBeenCalledWith("{}", validated);
    expect(currentTab.name).toBe("demo.astryd");
    expect(currentTab.filePath).toBe("C:\\tmp\\demo.astryd");
    expect(currentTab.unsaved).toBe(false);
  });
});
