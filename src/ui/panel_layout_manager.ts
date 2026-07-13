/**
 * PanelLayoutManager — Sistema de Splitters Redimensionables
 * 
 * Gestiona el redimensionado interactivo de los 3 paneles principales:
 * - Panel izquierdo (biblioteca de componentes)
 * - Panel derecho (propiedades)
 * - Dock inferior (osciloscopio + consola)
 * 
 * Incluye:
 * - Arrastre de splitters con mouse
 * - Doble-clic en headers para colapsar/expandir
 * - Atajos de teclado (Ctrl+1/2/3/0)
 * - Persistencia en localStorage
 */

import {
  DEFAULT_LAYOUT,
  PANEL_LIMITS,
  type PanelKey,
  type PanelLayout,
  getDefaultLayoutForViewport,
  getDockMaxPx,
  getKeyboardResizeDirection,
  resizePanelByDrag,
  resizePanelByKeyboard,
  sanitizeStoredLayout,
} from "./panel_layout_model";

function getDefaultLayout(): PanelLayout {
  return getDefaultLayoutForViewport(typeof window !== "undefined" ? window.innerWidth : Number.POSITIVE_INFINITY);
}

const STORAGE_KEY = "astryd_panel_layout";

export class PanelLayoutManager {
  private layout: PanelLayout;
  private root: HTMLElement;
  private sidebarLeft: HTMLElement | null = null;
  private sidebarRight: HTMLElement | null = null;
  private bottomDock: HTMLElement | null = null;
  private resizeCallback: (() => void) | null = null;
  private resizeNotificationId: number | null = null;

  // Drag state
  private activeHandle: PanelKey | null = null;
  private dragStartPos = 0;
  private dragStartSize = 0;

  constructor(root: HTMLElement, resizeCallback?: () => void) {
    this.root = root;
    this.resizeCallback = resizeCallback ?? null;
    this.layout = this.loadLayout();
    this.init();
  }

  private init() {
    this.sidebarLeft = this.root.querySelector("#sidebar-left");
    this.sidebarRight = this.root.querySelector("#sidebar-right");
    this.bottomDock = this.root.querySelector("#bottom-dock");

    // Inyectar handles de resize en el DOM
    this.injectResizeHandles();

    // Aplicar layout guardado
    this.applyLayout();

    // Vincular eventos de arrastre
    this.bindDragEvents();

    // Vincular doble-clic en headers
    this.bindHeaderDoubleClick();

    // Vincular atajos de teclado
    this.bindKeyboardShortcuts();
  }

  // ─── Inyección de Handles ──────────────────────────

  private injectResizeHandles() {
    const dashboard = this.root.querySelector("#main-dashboard");
    if (!dashboard) return;

    // Handle izquierdo: entre sidebar-left y workspace-center
    const workspaceCenter = this.root.querySelector("#workspace-center");
    if (this.sidebarLeft && workspaceCenter) {
      const handleLeft = document.createElement("div");
      handleLeft.className = "resize-handle resize-handle-col";
      handleLeft.id = "resize-handle-left";
      handleLeft.dataset.tooltip = "Arrastrar para redimensionar · Doble-clic para restaurar";
      this.configureSeparator(handleLeft, "left");
      dashboard.insertBefore(handleLeft, workspaceCenter);
    }

    // Handle derecho: entre workspace-center y sidebar-right
    if (this.sidebarRight && workspaceCenter) {
      const handleRight = document.createElement("div");
      handleRight.className = "resize-handle resize-handle-col";
      handleRight.id = "resize-handle-right";
      handleRight.dataset.tooltip = "Arrastrar para redimensionar · Doble-clic para restaurar";
      this.configureSeparator(handleRight, "right");
      dashboard.insertBefore(handleRight, this.sidebarRight);
    }

    // Handle del dock inferior: antes del contenido del bottom-dock
    if (this.bottomDock) {
      const handleDock = document.createElement("div");
      handleDock.className = "resize-handle resize-handle-row";
      handleDock.id = "resize-handle-dock";
      handleDock.dataset.tooltip = "Arrastrar para redimensionar el dock inferior";
      this.configureSeparator(handleDock, "dock");
      this.bottomDock.insertBefore(handleDock, this.bottomDock.firstChild);
    }
  }

  private configureSeparator(handle: HTMLElement, panel: PanelKey): void {
    handle.tabIndex = 0;
    handle.setAttribute("role", "separator");
    handle.setAttribute("aria-label", panel === "left"
      ? "Redimensionar panel de componentes"
      : panel === "right"
        ? "Redimensionar panel de propiedades"
        : "Redimensionar centro de instrumentos");
    handle.setAttribute("aria-orientation", panel === "dock" ? "horizontal" : "vertical");
    handle.addEventListener("keydown", (event) => this.resizeByKeyboard(event, panel));
  }

  // ─── Aplicación del Layout ─────────────────────────

  private applyLayout() {
    const rootEl = document.documentElement;

    // Dimensiones via CSS custom properties
    rootEl.style.setProperty("--left-panel-width", `${this.layout.leftWidth}px`);
    rootEl.style.setProperty("--right-panel-width", `${this.layout.rightWidth}px`);
    rootEl.style.setProperty("--osc-panel-height", `${this.layout.dockHeight}px`);

    // Estado de colapso
    if (this.sidebarLeft) {
      this.sidebarLeft.classList.toggle("collapsed", this.layout.leftCollapsed);
    }
    if (this.sidebarRight) {
      this.sidebarRight.classList.toggle("collapsed", this.layout.rightCollapsed);
    }
    this.root.querySelector("#resize-handle-left")?.classList.toggle("panel-collapsed", this.layout.leftCollapsed);
    this.root.querySelector("#resize-handle-right")?.classList.toggle("panel-collapsed", this.layout.rightCollapsed);
    if (this.bottomDock) {
      this.bottomDock.classList.toggle("collapsed", this.layout.dockCollapsed);
    }

    // Actualizar botones de toggle existentes
    this.syncToggleButtons();
    this.syncSeparatorValues();
    this.dispatchLayoutChange();

    this.scheduleResizeNotification();
  }

  private syncToggleButtons() {
    const btnToggleLeft = this.root.querySelector("#btn-toggle-left") as HTMLElement | null;
    const btnToggleRight = this.root.querySelector("#btn-toggle-right") as HTMLElement | null;
    const btnDockLeft = this.root.querySelector("#btn-dock-toggle-left") as HTMLElement | null;
    const btnDockRight = this.root.querySelector("#btn-dock-toggle-right") as HTMLElement | null;
    const btnExpandLeft = this.root.querySelector("#btn-expand-left") as HTMLElement | null;
    const btnExpandRight = this.root.querySelector("#btn-expand-right") as HTMLElement | null;

    if (btnToggleLeft) {
      btnToggleLeft.textContent = this.layout.leftCollapsed ? "Componentes ▶" : "◀ Colapsar";
    }
    if (btnDockLeft) {
      btnDockLeft.classList.toggle("active", !this.layout.leftCollapsed);
    }
    if (btnExpandLeft) {
      btnExpandLeft.style.display = this.layout.leftCollapsed ? "block" : "none";
    }

    if (btnToggleRight) {
      btnToggleRight.textContent = this.layout.rightCollapsed ? "◀ Propiedades" : "Colapsar ▶";
    }
    if (btnDockRight) {
      btnDockRight.classList.toggle("active", !this.layout.rightCollapsed);
      btnDockRight.textContent = this.layout.rightCollapsed ? "Propiedades ◀" : "Propiedades ◨";
    }
    if (btnExpandRight) {
      btnExpandRight.style.display = this.layout.rightCollapsed ? "block" : "none";
    }
  }

  // ─── Drag de Splitters ─────────────────────────────

  private bindDragEvents() {
    const handleLeft = this.root.querySelector("#resize-handle-left") as HTMLElement | null;
    const handleRight = this.root.querySelector("#resize-handle-right") as HTMLElement | null;
    const handleDock = this.root.querySelector("#resize-handle-dock") as HTMLElement | null;

    if (handleLeft) {
      handleLeft.addEventListener("mousedown", (e) => this.startDrag(e, "left"));
      handleLeft.addEventListener("dblclick", () => this.resetDimension("left"));
    }
    if (handleRight) {
      handleRight.addEventListener("mousedown", (e) => this.startDrag(e, "right"));
      handleRight.addEventListener("dblclick", () => this.resetDimension("right"));
    }
    if (handleDock) {
      handleDock.addEventListener("mousedown", (e) => this.startDrag(e, "dock"));
      handleDock.addEventListener("dblclick", () => this.resetDimension("dock"));
    }

    // Listeners globales para mousemove/mouseup
    document.addEventListener("mousemove", (e) => this.onDrag(e));
    document.addEventListener("mouseup", () => this.endDrag());
  }

  private startDrag(e: MouseEvent, handle: PanelKey) {
    e.preventDefault();
    this.activeHandle = handle;

    if (handle === "left") {
      this.dragStartPos = e.clientX;
      this.dragStartSize = this.layout.leftWidth;
    } else if (handle === "right") {
      this.dragStartPos = e.clientX;
      this.dragStartSize = this.layout.rightWidth;
    } else {
      this.dragStartPos = e.clientY;
      this.dragStartSize = this.layout.dockHeight;
    }

    document.body.style.cursor = handle === "dock" ? "row-resize" : "col-resize";
    document.body.style.userSelect = "none";

    // Marcar el handle activo visualmente
    const el = this.root.querySelector(`#resize-handle-${handle}`) as HTMLElement | null;
    if (el) el.classList.add("active");
  }

  private onDrag(e: MouseEvent) {
    if (!this.activeHandle) return;

    if (this.activeHandle === "left") {
      const newWidth = resizePanelByDrag("left", this.dragStartSize, this.dragStartPos, e.clientX, window.innerHeight);
      this.layout.leftWidth = newWidth;
      document.documentElement.style.setProperty("--left-panel-width", `${newWidth}px`);
    } else if (this.activeHandle === "right") {
      const newWidth = resizePanelByDrag("right", this.dragStartSize, this.dragStartPos, e.clientX, window.innerHeight);
      this.layout.rightWidth = newWidth;
      document.documentElement.style.setProperty("--right-panel-width", `${newWidth}px`);
    } else if (this.activeHandle === "dock") {
      const newHeight = resizePanelByDrag("dock", this.dragStartSize, this.dragStartPos, e.clientY, window.innerHeight);
      this.layout.dockHeight = newHeight;
      document.documentElement.style.setProperty("--osc-panel-height", `${newHeight}px`);
    }

    this.notifyResize();
  }

  private endDrag() {
    if (!this.activeHandle) return;

    const el = this.root.querySelector(`#resize-handle-${this.activeHandle}`) as HTMLElement | null;
    if (el) el.classList.remove("active");

    this.activeHandle = null;
    document.body.style.cursor = "";
    document.body.style.userSelect = "";
    this.saveLayout();
    this.syncSeparatorValues();
  }

  private resetDimension(handle: PanelKey) {
    if (handle === "left") {
      this.layout.leftWidth = DEFAULT_LAYOUT.leftWidth;
      document.documentElement.style.setProperty("--left-panel-width", `${DEFAULT_LAYOUT.leftWidth}px`);
    } else if (handle === "right") {
      this.layout.rightWidth = DEFAULT_LAYOUT.rightWidth;
      document.documentElement.style.setProperty("--right-panel-width", `${DEFAULT_LAYOUT.rightWidth}px`);
    } else {
      this.layout.dockHeight = DEFAULT_LAYOUT.dockHeight;
      document.documentElement.style.setProperty("--osc-panel-height", `${DEFAULT_LAYOUT.dockHeight}px`);
    }
    this.saveLayout();
    this.syncSeparatorValues();
    this.notifyResize();
  }

  private resizeByKeyboard(event: KeyboardEvent, panel: PanelKey): void {
    const direction = getKeyboardResizeDirection(panel, event.key);
    if (direction === 0 && event.key !== "Home") return;
    event.preventDefault();

    if (event.key === "Home") {
      this.resetDimension(panel);
      return;
    }

    const step = event.shiftKey ? 25 : 10;
    if (panel === "left") {
      this.layout.leftWidth = resizePanelByKeyboard("left", this.layout.leftWidth, direction, step, window.innerHeight);
      document.documentElement.style.setProperty("--left-panel-width", `${this.layout.leftWidth}px`);
    } else if (panel === "right") {
      this.layout.rightWidth = resizePanelByKeyboard("right", this.layout.rightWidth, direction, step, window.innerHeight);
      document.documentElement.style.setProperty("--right-panel-width", `${this.layout.rightWidth}px`);
    } else {
      this.layout.dockHeight = resizePanelByKeyboard("dock", this.layout.dockHeight, direction, step, window.innerHeight);
      document.documentElement.style.setProperty("--osc-panel-height", `${this.layout.dockHeight}px`);
    }
    this.saveLayout();
    this.syncSeparatorValues();
    this.notifyResize();
  }

  private syncSeparatorValues(): void {
    const dockMax = getDockMaxPx(window.innerHeight);
    const values: Array<[PanelKey, number, number, number]> = [
      ["left", this.layout.leftWidth, PANEL_LIMITS.leftMin, PANEL_LIMITS.leftMax],
      ["right", this.layout.rightWidth, PANEL_LIMITS.rightMin, PANEL_LIMITS.rightMax],
      ["dock", this.layout.dockHeight, PANEL_LIMITS.dockMin, dockMax],
    ];
    values.forEach(([panel, value, min, max]) => {
      const handle = this.root.querySelector(`#resize-handle-${panel}`);
      handle?.setAttribute("aria-valuemin", String(min));
      handle?.setAttribute("aria-valuemax", String(max));
      handle?.setAttribute("aria-valuenow", String(Math.round(value)));
    });
  }

  // ─── Doble-Clic en Headers ─────────────────────────

  private bindHeaderDoubleClick() {
    const leftHeader = this.root.querySelector("#left-panel-header") as HTMLElement | null;
    const rightHeader = this.root.querySelector("#right-panel-header") as HTMLElement | null;
    const oscHeader = this.root.querySelector("#osc-header") as HTMLElement | null;
    const consoleHeader = this.root.querySelector("#console-header") as HTMLElement | null;

    if (leftHeader) {
      leftHeader.addEventListener("dblclick", () => this.togglePanel("left"));
    }
    if (rightHeader) {
      rightHeader.addEventListener("dblclick", () => this.togglePanel("right"));
    }
    if (oscHeader) {
      oscHeader.addEventListener("dblclick", () => this.togglePanel("dock"));
    }
    if (consoleHeader) {
      consoleHeader.addEventListener("dblclick", () => this.togglePanel("dock"));
    }
  }

  // ─── Atajos de Teclado ─────────────────────────────

  private bindKeyboardShortcuts() {
    document.addEventListener("keydown", (e: KeyboardEvent) => {
      // Ignorar si el foco está en un input/textarea/select
      const tag = (e.target as HTMLElement)?.tagName;
      if (tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT") return;

      if (e.ctrlKey || e.metaKey) {
        switch (e.key) {
          case "1":
            e.preventDefault();
            this.togglePanel("left");
            break;
          case "2":
            e.preventDefault();
            this.togglePanel("right");
            break;
          case "3":
            e.preventDefault();
            this.togglePanel("dock");
            break;
          case "0":
            e.preventDefault();
            this.resetAllPanels();
            break;
        }
      }
    });
  }

  // ─── API Pública ───────────────────────────────────

  public setPanelCollapsed(panel: PanelKey, collapsed: boolean) {
    if (panel === "left") {
      if (this.layout.leftCollapsed === collapsed) return;
      this.layout.leftCollapsed = collapsed;
      if (this.sidebarLeft) {
        this.sidebarLeft.classList.toggle("collapsed", collapsed);
      }
    } else if (panel === "right") {
      if (this.layout.rightCollapsed === collapsed) return;
      this.layout.rightCollapsed = collapsed;
      if (this.sidebarRight) {
        this.sidebarRight.classList.toggle("collapsed", collapsed);
      }
    } else {
      if (this.layout.dockCollapsed === collapsed) return;
      this.layout.dockCollapsed = collapsed;
      if (this.bottomDock) {
        this.bottomDock.classList.toggle("collapsed", collapsed);
      }
    }

    this.syncToggleButtons();
    this.saveLayout();
    this.dispatchLayoutChange();
    if (panel === "dock" && !collapsed) {
      this.focusInstrumentCenterClose();
    }
    this.scheduleResizeNotification();
  }

  public isPanelCollapsed(panel: PanelKey): boolean {
    if (panel === "left") return this.layout.leftCollapsed;
    if (panel === "right") return this.layout.rightCollapsed;
    return this.layout.dockCollapsed;
  }

  public togglePanel(panel: PanelKey) {
    if (panel === "left") {
      this.layout.leftCollapsed = !this.layout.leftCollapsed;
      if (this.sidebarLeft) {
        this.sidebarLeft.classList.toggle("collapsed", this.layout.leftCollapsed);
      }
    } else if (panel === "right") {
      this.layout.rightCollapsed = !this.layout.rightCollapsed;
      if (this.sidebarRight) {
        this.sidebarRight.classList.toggle("collapsed", this.layout.rightCollapsed);
      }
    } else {
      this.layout.dockCollapsed = !this.layout.dockCollapsed;
      if (this.bottomDock) {
        this.bottomDock.classList.toggle("collapsed", this.layout.dockCollapsed);
      }
    }

    this.syncToggleButtons();
    this.saveLayout();
    this.dispatchLayoutChange();
    if (panel === "dock" && !this.layout.dockCollapsed) {
      this.focusInstrumentCenterClose();
    }

    this.scheduleResizeNotification();
  }

  public resetAllPanels() {
    this.layout = getDefaultLayout();
    this.applyLayout();
    this.saveLayout();
  }

  // ─── Persistencia ──────────────────────────────────

  private saveLayout() {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(this.layout));
    } catch {
      // localStorage puede no estar disponible en ciertos contextos
    }
  }

  private loadLayout(): PanelLayout {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (raw) {
        const parsed = JSON.parse(raw) as Partial<PanelLayout>;
        return sanitizeStoredLayout(parsed, window.innerHeight) ?? getDefaultLayout();
      }
    } catch {
      // Ignorar errores de parsing
    }
    return getDefaultLayout();
  }

  // --- Utilidades ────────────────────────────────────

  private notifyResize() {
    if (this.resizeCallback) {
      this.resizeCallback();
    }
  }

  private scheduleResizeNotification(delayMs = 340) {
    if (this.resizeNotificationId !== null) {
      window.clearTimeout(this.resizeNotificationId);
    }
    this.resizeNotificationId = window.setTimeout(() => {
      this.resizeNotificationId = null;
      this.notifyResize();
    }, delayMs);
  }

  private dispatchLayoutChange() {
    window.dispatchEvent(new CustomEvent("panel-layout-change"));
  }

  private focusInstrumentCenterClose(): void {
    window.setTimeout(() => {
      const closeButton = this.root.querySelector("#instrument-center-close") as HTMLButtonElement | null;
      closeButton?.focus({ preventScroll: true });
    }, 0);
  }
}
