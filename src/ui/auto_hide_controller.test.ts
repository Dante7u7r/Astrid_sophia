// @vitest-environment happy-dom

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  AUTO_HIDE_STORAGE_KEY,
  createAutoHideController,
  DEFAULT_AUTO_HIDE_SETTINGS,
  type AutoHideSettings,
} from "./auto_hide_controller";
import type { PanelKey, PanelLayoutManager } from "./panel_layout_manager";

describe("AutoHideController Clean", () => {
  let mockLayoutManager: PanelLayoutManager;
  let collapsedState: Record<PanelKey, boolean>;
  let mockStorage: Record<string, string>;
  let storageAdapter: Storage;
  let isTyping = false;

  beforeEach(() => {
    collapsedState = {
      left: true,
      right: true,
      dock: true,
    };
    mockStorage = {};
    isTyping = false;

    storageAdapter = {
      getItem: (key: string) => mockStorage[key] ?? null,
      setItem: (key: string, value: string) => {
        mockStorage[key] = value;
      },
      removeItem: (key: string) => {
        delete mockStorage[key];
      },
      clear: () => {
        mockStorage = {};
      },
      key: (_index: number) => null,
      length: 0,
    };

    mockLayoutManager = {
      isPanelCollapsed: vi.fn((panel: PanelKey) => collapsedState[panel]),
      setPanelCollapsed: vi.fn((panel: PanelKey, collapsed: boolean) => {
        collapsedState[panel] = collapsed;
      }),
    } as unknown as PanelLayoutManager;

    document.body.innerHTML = `
      <header>
        <button id="btn-zen-mode" type="button">Zen</button>
      </header>
      <aside id="sidebar-left" class="collapsed">
        <button id="btn-pin-left" class="btn-pin-toggle" type="button">🔓</button>
      </aside>
      <div id="workspace-center" style="width: 1000px; height: 800px;"></div>
      <aside id="sidebar-right" class="collapsed">
        <button id="btn-pin-right" class="btn-pin-toggle" type="button">🔓</button>
        <input id="prop-input" type="text" />
      </aside>
      <section id="bottom-dock" class="collapsed">
        <button id="instrument-center-pin" class="btn-pin-toggle" type="button">🔓</button>
      </section>
    `;

    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
    document.body.innerHTML = "";
  });

  it("carga la configuración por defecto y sincroniza los botones de pin", () => {
    const controller = createAutoHideController({
      getPanelLayoutManager: () => mockLayoutManager,
      isTypingInFormField: () => isTyping,
      storage: storageAdapter,
    });
    controller.init();

    expect(controller.getSettings()).toEqual(DEFAULT_AUTO_HIDE_SETTINGS);
    const pinLeft = document.querySelector<HTMLButtonElement>("#btn-pin-left")!;
    expect(pinLeft.textContent).toBe("🔓");
    expect(pinLeft.getAttribute("aria-pressed")).toBe("false");
  });

  it("alterna el estado de fijación (pin) y persiste en storage", () => {
    const controller = createAutoHideController({
      getPanelLayoutManager: () => mockLayoutManager,
      isTypingInFormField: () => isTyping,
      storage: storageAdapter,
    });
    controller.init();

    const pinLeft = document.querySelector<HTMLButtonElement>("#btn-pin-left")!;
    pinLeft.click();

    expect(controller.getSettings().left).toBe(false);
    expect(pinLeft.textContent).toBe("📌");
    expect(pinLeft.getAttribute("aria-pressed")).toBe("true");

    const saved = JSON.parse(mockStorage[AUTO_HIDE_STORAGE_KEY]) as AutoHideSettings;
    expect(saved.left).toBe(false);
  });

  it("ignora barridos rápidos del cursor y despliega el panel tras dwell time de 120ms", () => {
    const controller = createAutoHideController({
      getPanelLayoutManager: () => mockLayoutManager,
      isTypingInFormField: () => isTyping,
      storage: storageAdapter,
      hotzoneThresholdPx: 36,
      dwellDelayMs: 120,
    });
    controller.init();

    const workspace = document.querySelector<HTMLElement>("#workspace-center")!;
    vi.spyOn(workspace, "getBoundingClientRect").mockReturnValue({
      left: 0,
      top: 0,
      width: 1000,
      height: 800,
      right: 1000,
      bottom: 800,
      x: 0,
      y: 0,
      toJSON: () => ({}),
    });

    workspace.dispatchEvent(
      new PointerEvent("pointermove", {
        clientX: 20,
        clientY: 300,
      }),
    );

    vi.advanceTimersByTime(60);
    expect(mockLayoutManager.setPanelCollapsed).not.toHaveBeenCalledWith("left", false);

    vi.advanceTimersByTime(60);
    expect(mockLayoutManager.setPanelCollapsed).toHaveBeenCalledWith("left", false);
  });

  it("cancela la apertura si el cursor sale de la hotzone antes de cumplir el dwell time", () => {
    const controller = createAutoHideController({
      getPanelLayoutManager: () => mockLayoutManager,
      isTypingInFormField: () => isTyping,
      storage: storageAdapter,
      hotzoneThresholdPx: 36,
      dwellDelayMs: 120,
    });
    controller.init();

    const workspace = document.querySelector<HTMLElement>("#workspace-center")!;
    vi.spyOn(workspace, "getBoundingClientRect").mockReturnValue({
      left: 0,
      top: 0,
      width: 1000,
      height: 800,
      right: 1000,
      bottom: 800,
      x: 0,
      y: 0,
      toJSON: () => ({}),
    });

    workspace.dispatchEvent(
      new PointerEvent("pointermove", {
        clientX: 20,
        clientY: 300,
      }),
    );

    vi.advanceTimersByTime(50);

    workspace.dispatchEvent(
      new PointerEvent("pointermove", {
        clientX: 200,
        clientY: 300,
      }),
    );

    vi.advanceTimersByTime(150);
    expect(mockLayoutManager.setPanelCollapsed).not.toHaveBeenCalledWith("left", false);
  });

  it("repliega el panel de componentes inmediatamente al arrastrar un elemento sobre el lienzo", () => {
    const controller = createAutoHideController({
      getPanelLayoutManager: () => mockLayoutManager,
      isTypingInFormField: () => isTyping,
      storage: storageAdapter,
    });
    controller.init();

    collapsedState.left = false;
    const workspace = document.querySelector<HTMLElement>("#workspace-center")!;
    workspace.dispatchEvent(new Event("dragenter"));

    expect(mockLayoutManager.setPanelCollapsed).toHaveBeenCalledWith("left", true);
  });

  it("alterna el modo Zen / Inmersivo ocultando todos los paneles y restaurando su estado", () => {
    const controller = createAutoHideController({
      getPanelLayoutManager: () => mockLayoutManager,
      isTypingInFormField: () => isTyping,
      storage: storageAdapter,
    });
    controller.init();

    controller.toggleZenMode();
    expect(controller.isZenMode()).toBe(true);
    expect(mockLayoutManager.setPanelCollapsed).toHaveBeenCalledWith("left", true);
    expect(mockLayoutManager.setPanelCollapsed).toHaveBeenCalledWith("right", true);
    expect(mockLayoutManager.setPanelCollapsed).toHaveBeenCalledWith("dock", true);

    const btnZen = document.querySelector<HTMLButtonElement>("#btn-zen-mode")!;
    expect(btnZen.classList.contains("active")).toBe(true);

    controller.toggleZenMode();
    expect(controller.isZenMode()).toBe(false);
    expect(btnZen.classList.contains("active")).toBe(false);
  });

  it("activa el modo Zen con el atajo de teclado Ctrl+Shift+F", () => {
    const controller = createAutoHideController({
      getPanelLayoutManager: () => mockLayoutManager,
      isTypingInFormField: () => isTyping,
      storage: storageAdapter,
    });
    controller.init();

    document.dispatchEvent(
      new KeyboardEvent("keydown", {
        key: "F",
        ctrlKey: true,
        shiftKey: true,
      }),
    );

    expect(controller.isZenMode()).toBe(true);
  });

  it("activa el modo Zen con F11 y sale con Escape", () => {
    const controller = createAutoHideController({
      getPanelLayoutManager: () => mockLayoutManager,
      isTypingInFormField: () => isTyping,
      storage: storageAdapter,
    });
    controller.init();

    document.dispatchEvent(new KeyboardEvent("keydown", { key: "F11" }));
    expect(controller.isZenMode()).toBe(true);
    expect(document.body.classList.contains("zen-mode")).toBe(true);

    const pill = document.querySelector<HTMLButtonElement>("#zen-exit-pill")!;
    expect(pill).not.toBeNull();
    expect(pill.style.display).toBe("flex");

    document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape" }));
    expect(controller.isZenMode()).toBe(false);
    expect(document.body.classList.contains("zen-mode")).toBe(false);
    expect(pill.style.display).toBe("none");
  });

  it("permite salir del modo Zen haciendo clic en el pill flotante", () => {
    const controller = createAutoHideController({
      getPanelLayoutManager: () => mockLayoutManager,
      isTypingInFormField: () => isTyping,
      storage: storageAdapter,
    });
    controller.init();

    controller.toggleZenMode(true);
    expect(controller.isZenMode()).toBe(true);

    const pill = document.querySelector<HTMLButtonElement>("#zen-exit-pill")!;
    expect(pill).not.toBeNull();
    pill.click();

    expect(controller.isZenMode()).toBe(false);
  });

  it("suspende la reapertura de paneles por hotzone mientras el modo Zen está activo", () => {
    const controller = createAutoHideController({
      getPanelLayoutManager: () => mockLayoutManager,
      isTypingInFormField: () => isTyping,
      storage: storageAdapter,
      hotzoneThresholdPx: 36,
      dwellDelayMs: 50,
    });
    controller.init();

    controller.toggleZenMode(true);
    (mockLayoutManager.setPanelCollapsed as any).mockClear();

    const workspace = document.querySelector<HTMLElement>("#workspace-center")!;
    vi.spyOn(workspace, "getBoundingClientRect").mockReturnValue({
      left: 0,
      top: 0,
      width: 1000,
      height: 800,
      right: 1000,
      bottom: 800,
      x: 0,
      y: 0,
      toJSON: () => ({}),
    });

    workspace.dispatchEvent(
      new PointerEvent("pointermove", {
        clientX: 10,
        clientY: 300,
      }),
    );

    vi.advanceTimersByTime(200);
    expect(mockLayoutManager.setPanelCollapsed).not.toHaveBeenCalled();
  });

  it("suspende el colapso automático de paneles si el tour guiado está activo", () => {
    let guideActive = true;
    const controller = createAutoHideController({
      getPanelLayoutManager: () => mockLayoutManager,
      isTypingInFormField: () => isTyping,
      isGuideActive: () => guideActive,
      storage: storageAdapter,
    });
    controller.init();

    controller.triggerPanelCollapse("left", true);
    expect(mockLayoutManager.setPanelCollapsed).not.toHaveBeenCalledWith("left", true);

    controller.triggerPanelCollapse("left", false);
    vi.advanceTimersByTime(300);
    expect(mockLayoutManager.setPanelCollapsed).not.toHaveBeenCalledWith("left", true);

    // Si el tour se desactiva, el colapso vuelve a funcionar
    guideActive = false;
    controller.triggerPanelCollapse("left", true);
    expect(mockLayoutManager.setPanelCollapsed).toHaveBeenCalledWith("left", true);
  });

  it("ignora zonas sensibles si el cursor está sobre una ventana flotante o si se está interactuando con ella", () => {
    const controller = createAutoHideController({
      getPanelLayoutManager: () => mockLayoutManager,
      isTypingInFormField: () => isTyping,
      storage: storageAdapter,
      hotzoneThresholdPx: 36,
      dwellDelayMs: 50,
    });
    controller.init();

    const workspace = document.querySelector<HTMLElement>("#workspace-center")!;
    vi.spyOn(workspace, "getBoundingClientRect").mockReturnValue({
      left: 0,
      top: 0,
      width: 1000,
      height: 800,
      right: 1000,
      bottom: 800,
      x: 0,
      y: 0,
      toJSON: () => ({}),
    });

    // Caso 1: Evento originado dentro de una ventana flotante
    const floatingWin = document.createElement("div");
    floatingWin.className = "floating-instrument-window";
    floatingWin.style.width = "400px";
    floatingWin.style.height = "300px";
    const header = document.createElement("div");
    header.className = "floating-window-header";
    floatingWin.appendChild(header);
    workspace.appendChild(floatingWin);

    header.dispatchEvent(
      new PointerEvent("pointermove", {
        clientX: 20, // Zona izquierda pero dentro del header flotante
        clientY: 300,
        bubbles: true,
      }),
    );

    vi.advanceTimersByTime(100);
    expect(mockLayoutManager.setPanelCollapsed).not.toHaveBeenCalledWith("left", false);

    // Caso 2: Interacción activa / arrastre / redimensionamiento activo
    document.body.classList.add("is-interacting-floating-window");
    workspace.dispatchEvent(
      new PointerEvent("pointermove", {
        clientX: 980, // Zona derecha
        clientY: 300,
      }),
    );
    vi.advanceTimersByTime(100);
    expect(mockLayoutManager.setPanelCollapsed).not.toHaveBeenCalledWith("right", false);

    // Caso 3: Ventana flotante maximizada
    document.body.classList.remove("is-interacting-floating-window");
    floatingWin.classList.add("is-maximized");
    workspace.dispatchEvent(
      new PointerEvent("pointermove", {
        clientX: 500,
        clientY: 790, // Zona inferior (dock)
      }),
    );
    vi.advanceTimersByTime(100);
    expect(mockLayoutManager.setPanelCollapsed).not.toHaveBeenCalledWith("dock", false);
  });
});

