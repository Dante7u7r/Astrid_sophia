import { describe, test, expect, beforeEach } from "vitest";
import {
  saveWorkspaceSession,
  restoreWorkspaceSession,
  clearWorkspaceSession,
  WORKSPACE_SESSION_STORAGE_KEY,
} from "./workspace_session_persister";
import { createWorkspaceTab, type Tab } from "./workspace_state";

describe("workspace_session_persister", () => {
  let mockStorage: Record<string, string>;
  let storage: Storage;

  beforeEach(() => {
    mockStorage = {};
    storage = {
      getItem: (key: string) => mockStorage[key] ?? null,
      setItem: (key: string, value: string) => { mockStorage[key] = value; },
      removeItem: (key: string) => { delete mockStorage[key]; },
      clear: () => { mockStorage = {}; },
      key: (index: number) => Object.keys(mockStorage)[index] ?? null,
      length: 0,
    };
  });

  test("guarda y restaura correctamente una sesion con multiples pestanas y componentes", () => {
    const tab1 = createWorkspaceTab("tab-1", "Filtro RC", {
      components: [
        { id: "R1", type: "resistor", value: 1000, x: 100, y: 100, rotation: 0 },
        { id: "C1", type: "capacitor", value: 1e-6, x: 200, y: 100, rotation: 0 },
      ],
      wires: [
        { id: "w1", from: { componentId: "R1", pinIndex: 1 }, to: { componentId: "C1", pinIndex: 0 }, points: [] },
      ],
      filePath: "C:/circuits/filtro.astryd",
    }, "AC");
    tab1.zoom = 1.5;
    tab1.offsetX = 50;
    tab1.offsetY = -20;
    tab1.unsaved = true;

    const tab2 = createWorkspaceTab("tab-2", "Amplificador", {
      components: [
        { id: "U1", type: "opamp", value: 100000, x: 300, y: 300, rotation: 0 },
      ],
      wires: [],
      filePath: null,
    }, "TRAN");

    const saved = saveWorkspaceSession([tab1, tab2], "tab-1", storage);
    expect(saved).toBe(true);
    expect(mockStorage[WORKSPACE_SESSION_STORAGE_KEY]).toBeDefined();

    const restored = restoreWorkspaceSession("TRAN", storage);
    expect(restored).not.toBeNull();
    expect(restored?.activeTabId).toBe("tab-1");
    expect(restored?.tabs).toHaveLength(2);

    const restoredTab1 = restored!.tabs[0]!;
    expect(restoredTab1.id).toBe("tab-1");
    expect(restoredTab1.name).toBe("Filtro RC");
    expect(restoredTab1.components).toHaveLength(2);
    expect(restoredTab1.wires).toHaveLength(1);
    expect(restoredTab1.zoom).toBe(1.5);
    expect(restoredTab1.offsetX).toBe(50);
    expect(restoredTab1.offsetY).toBe(-20);
    expect(restoredTab1.unsaved).toBe(true);
    expect(restoredTab1.filePath).toBe("C:/circuits/filtro.astryd");

    const restoredTab2 = restored!.tabs[1]!;
    expect(restoredTab2.id).toBe("tab-2");
    expect(restoredTab2.name).toBe("Amplificador");
    expect(restoredTab2.components).toHaveLength(1);
  });

  test("clearWorkspaceSession elimina la clave de almacenamiento", () => {
    storage.setItem(WORKSPACE_SESSION_STORAGE_KEY, "{}");
    clearWorkspaceSession(storage);
    expect(storage.getItem(WORKSPACE_SESSION_STORAGE_KEY)).toBeNull();
  });

  test("restoreWorkspaceSession devuelve null si no hay datos o los datos son invalidos", () => {
    expect(restoreWorkspaceSession("TRAN", storage)).toBeNull();

    storage.setItem(WORKSPACE_SESSION_STORAGE_KEY, "invalid-json");
    expect(restoreWorkspaceSession("TRAN", storage)).toBeNull();

    storage.setItem(WORKSPACE_SESSION_STORAGE_KEY, JSON.stringify({ version: 99, tabs: [] }));
    expect(restoreWorkspaceSession("TRAN", storage)).toBeNull();
  });
});
