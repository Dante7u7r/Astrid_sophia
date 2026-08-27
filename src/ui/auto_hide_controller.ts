/**
 * AutoHideController — Sistema Unificado de Auto-Ocultación y Auto-Despliegue
 *
 * Gestiona el comportamiento de auto-ocultación inteligente y limpio para:
 * - Panel Izquierdo (Paleta de Componentes)
 * - Panel Derecho (Editor de Propiedades)
 * - Barra Inferior (Centro de Instrumentos)
 *
 * Características:
 * 1. Detección de borde con filtrado de intención (Dwell Time 120ms) para evitar aperturas por barrido rápido.
 * 2. Repliegue inteligente durante arrastre (Drag-and-Drop) al lienzo esquemático.
 * 3. Modo Lienzo Inmersivo (Zen Mode / Ctrl+Shift+F) para maximizar el área de trabajo.
 * 4. Botones de fijación independiente (📌 Fijado / 🔓 Auto-ocultar) con persistencia en localStorage.
 * 5. Lienzo 100% limpio y despejado sin burbujas flotantes obstructivas.
 */

import { getCurrentWindow } from "@tauri-apps/api/window";
import type { PanelLayoutManager } from "./panel_layout_manager";
import type { PanelKey } from "./panel_layout_model";

export type AutoHideSettings = Record<PanelKey, boolean>;

export interface AutoHideControllerDependencies {
  getPanelLayoutManager(): PanelLayoutManager | null;
  isTypingInFormField(): boolean;
  isGuideActive?: () => boolean;
  storage?: Storage;
  hotzoneThresholdPx?: number;
  collapseDelayMs?: number;
  dwellDelayMs?: number;
}

export const AUTO_HIDE_STORAGE_KEY = "astryd_panel_autohide";

export const DEFAULT_AUTO_HIDE_SETTINGS: AutoHideSettings = {
  left: true,
  right: true,
  dock: true,
};

function isTauriEnvironment(): boolean {
  return typeof window !== "undefined" && ("__TAURI_INTERNALS__" in window || "__TAURI__" in window);
}

export async function toggleWindowFullscreen(forceState?: boolean): Promise<boolean> {
  if (isTauriEnvironment()) {
    try {
      const win = getCurrentWindow();
      const current = await win.isFullscreen();
      const next = forceState !== undefined ? forceState : !current;
      await win.setFullscreen(next);
      return next;
    } catch {
      // Fallback a API web si Tauri no responde
    }
  }

  if (typeof document !== "undefined") {
    const isDocFs = Boolean(document.fullscreenElement);
    const next = forceState !== undefined ? forceState : !isDocFs;
    try {
      if (next && !document.fullscreenElement && typeof document.documentElement.requestFullscreen === "function") {
        await document.documentElement.requestFullscreen();
      } else if (!next && document.fullscreenElement && typeof document.exitFullscreen === "function") {
        await document.exitFullscreen();
      }
      return next;
    } catch {
      return isDocFs;
    }
  }
  return false;
}

export class AutoHideController {
  private settings: AutoHideSettings;
  private readonly storage: Storage;
  private readonly hotzonePx: number;
  private readonly delayMs: number;
  private readonly dwellMs: number;

  private leftTimer: number | null = null;
  private rightTimer: number | null = null;
  private dockTimer: number | null = null;

  private dwellTimer: number | null = null;
  private pendingDwellPanel: PanelKey | null = null;

  private zenModeActive = false;
  private preZenSettings: AutoHideSettings | null = null;
  private preZenCollapsed: Record<PanelKey, boolean> | null = null;

  constructor(private readonly dependencies: AutoHideControllerDependencies) {
    this.storage = dependencies.storage ?? (typeof localStorage !== "undefined" ? localStorage : ({} as Storage));
    this.hotzonePx = dependencies.hotzoneThresholdPx ?? 28;
    this.delayMs = dependencies.collapseDelayMs ?? 280;
    this.dwellMs = dependencies.dwellDelayMs ?? 15;
    this.settings = this.loadSettings();
  }

  public init(): void {
    this.bindPanelHoverListeners();
    this.bindWorkspaceHotzoneListeners();
    this.bindPinToggleButtons();
    this.bindDragAndDropListeners();
    this.bindZenModeControls();
    this.bindGlobalEvents();
    this.syncAllPinButtonStates();
  }

  public getSettings(): Readonly<AutoHideSettings> {
    return { ...this.settings };
  }

  public isZenMode(): boolean {
    return this.zenModeActive;
  }

  public setPanelAutoHide(panel: PanelKey, autoHide: boolean): void {
    this.settings[panel] = autoHide;
    this.saveSettings();
    this.syncPinButtonState(panel);
    if (!autoHide) {
      this.cancelTimer(panel);
      this.cancelDwellTimer();
    }
  }

  public toggleZenMode(forceState?: boolean): void {
    const layout = this.dependencies.getPanelLayoutManager();
    const targetState = forceState !== undefined ? forceState : !this.zenModeActive;
    if (this.zenModeActive === targetState) return;

    this.zenModeActive = targetState;

    const appContainer = document.querySelector("#app-viewport") || document.querySelector(".app-container") || document.body;

    if (this.zenModeActive) {
      this.preZenSettings = { ...this.settings };
      this.preZenCollapsed = layout ? {
        left: layout.isPanelCollapsed("left"),
        right: layout.isPanelCollapsed("right"),
        dock: layout.isPanelCollapsed("dock"),
      } : null;

      if (layout) {
        layout.setPanelCollapsed("left", true);
        layout.setPanelCollapsed("right", true);
        layout.setPanelCollapsed("dock", true);
      }

      appContainer.classList.add("zen-mode");
      document.body.classList.add("zen-mode");
      this.renderFloatingExitPill();
      void toggleWindowFullscreen(true);
    } else {
      if (this.preZenSettings) {
        this.settings = { ...this.preZenSettings };
        this.preZenSettings = null;
      }
      if (layout && this.preZenCollapsed) {
        layout.setPanelCollapsed("left", this.preZenCollapsed.left);
        layout.setPanelCollapsed("right", this.preZenCollapsed.right);
        layout.setPanelCollapsed("dock", this.preZenCollapsed.dock);
        this.preZenCollapsed = null;
      }

      appContainer.classList.remove("zen-mode");
      document.body.classList.remove("zen-mode");
      this.removeFloatingExitPill();
      void toggleWindowFullscreen(false);
    }

    const btnZen = document.querySelector("#btn-zen-mode") as HTMLButtonElement | null;
    if (btnZen) {
      btnZen.classList.toggle("active", this.zenModeActive);
      btnZen.setAttribute("aria-pressed", String(this.zenModeActive));
      btnZen.dataset.tooltip = this.zenModeActive
        ? "Salir del Modo Inmersivo (Esc o F11)"
        : "Modo Lienzo Inmersivo / Pantalla Completa (Ctrl+Shift+F o F11)";
    }

    this.syncAllPinButtonStates();
    if (typeof window !== "undefined") {
      window.dispatchEvent(new CustomEvent("zen-mode-changed", { detail: { active: this.zenModeActive } }));
    }
  }

  public triggerPanelReveal(panel: PanelKey): void {
    this.cancelTimer(panel);
    this.cancelDwellTimer();
    const layout = this.dependencies.getPanelLayoutManager();
    if (layout && layout.isPanelCollapsed(panel)) {
      layout.setPanelCollapsed(panel, false);
    }
  }

  public triggerPanelCollapse(panel: PanelKey, immediate = false): void {
    if (!this.settings[panel]) return;
    if (this.dependencies.isTypingInFormField()) return;
    if (this.dependencies.isGuideActive?.()) return;

    this.cancelTimer(panel);
    this.cancelDwellTimer();
    if (immediate) {
      this.dependencies.getPanelLayoutManager()?.setPanelCollapsed(panel, true);
    } else {
      this.scheduleCollapse(panel, this.delayMs);
    }
  }

  // ─── Gestión de Temporizadores de Auto-Colapso ──────────────

  private scheduleCollapse(panel: PanelKey, delayMs: number): void {
    this.cancelTimer(panel);
    const timerId = window.setTimeout(() => {
      if (!this.settings[panel]) return;
      if (this.dependencies.isTypingInFormField()) return;
      if (this.dependencies.isGuideActive?.()) return;

      const element = this.getPanelElement(panel);
      if (element && element.contains(document.activeElement)) {
        return;
      }

      this.dependencies.getPanelLayoutManager()?.setPanelCollapsed(panel, true);
    }, delayMs);

    if (panel === "left") this.leftTimer = timerId;
    else if (panel === "right") this.rightTimer = timerId;
    else this.dockTimer = timerId;
  }

  private cancelTimer(panel: PanelKey): void {
    if (panel === "left" && this.leftTimer !== null) {
      clearTimeout(this.leftTimer);
      this.leftTimer = null;
    } else if (panel === "right" && this.rightTimer !== null) {
      clearTimeout(this.rightTimer);
      this.rightTimer = null;
    } else if (panel === "dock" && this.dockTimer !== null) {
      clearTimeout(this.dockTimer);
      this.dockTimer = null;
    }
  }

  private cancelDwellTimer(): void {
    if (this.dwellTimer !== null) {
      clearTimeout(this.dwellTimer);
      this.dwellTimer = null;
      this.pendingDwellPanel = null;
    }
  }

  private getPanelElement(panel: PanelKey): HTMLElement | null {
    if (panel === "left") return document.querySelector("#sidebar-left");
    if (panel === "right") return document.querySelector("#sidebar-right");
    return document.querySelector("#bottom-dock");
  }

  // ─── Listeners de Hover en Paneles ─────────────────────────

  private bindPanelHoverListeners(): void {
    const bindPanel = (panel: PanelKey, selector: string) => {
      const el = document.querySelector(selector) as HTMLElement | null;
      if (!el) return;

      el.addEventListener("pointerenter", () => {
        this.cancelTimer(panel);
        this.cancelDwellTimer();
      });

      el.addEventListener("pointerleave", (e: PointerEvent) => {
        const related = e.relatedTarget as HTMLElement | null;
        if (related && el.contains(related)) return;

        if (this.settings[panel]) {
          this.scheduleCollapse(panel, this.delayMs);
        }
      });

      el.addEventListener("focusin", () => {
        this.cancelTimer(panel);
        this.cancelDwellTimer();
      });

      el.addEventListener("focusout", () => {
        if (this.settings[panel]) {
          this.scheduleCollapse(panel, this.delayMs);
        }
      });
    };

    bindPanel("left", "#sidebar-left");
    bindPanel("right", "#sidebar-right");
    bindPanel("dock", "#bottom-dock");
  }

  // ─── Listeners de Zonas Sensibles con Dwell Intent ──────────

  private bindWorkspaceHotzoneListeners(): void {
    const workspace = document.querySelector("#workspace-center") as HTMLElement | null;
    if (!workspace) return;

    workspace.addEventListener("pointermove", (e: PointerEvent) => {
      // En modo Zen / Inmersivo se suspende la apertura por hotzone para no obstruir el lienzo
      if (this.zenModeActive) {
        this.cancelDwellTimer();
        return;
      }

      const rect = workspace.getBoundingClientRect();
      const x = e.clientX - rect.left;
      const y = e.clientY - rect.top;

      let detectedPanel: PanelKey | null = null;

      if (x >= 0 && x <= this.hotzonePx && this.settings.left) {
        detectedPanel = "left";
      } else if (x >= rect.width - this.hotzonePx && x <= rect.width && this.settings.right) {
        detectedPanel = "right";
      } else if (y >= rect.height - this.hotzonePx && y <= rect.height && this.settings.dock) {
        detectedPanel = "dock";
      }

      if (detectedPanel) {
        if (this.pendingDwellPanel !== detectedPanel) {
          this.cancelDwellTimer();
          this.pendingDwellPanel = detectedPanel;
          const target = detectedPanel;
          this.dwellTimer = window.setTimeout(() => {
            this.triggerPanelReveal(target);
            this.pendingDwellPanel = null;
            this.dwellTimer = null;
          }, this.dwellMs);
        }
      } else {
        this.cancelDwellTimer();
      }
    });

    workspace.addEventListener("pointerleave", () => {
      this.cancelDwellTimer();
    });
  }

  // ─── Repliegue Inteligente durante Arrastre al Lienzo ───────

  private bindDragAndDropListeners(): void {
    const workspace = document.querySelector("#workspace-center") as HTMLElement | null;
    if (!workspace) return;

    workspace.addEventListener("dragenter", () => {
      if (this.settings.left) {
        this.triggerPanelCollapse("left", true);
      }
    });

    workspace.addEventListener("dragover", () => {
      if (this.settings.left) {
        this.triggerPanelCollapse("left", true);
      }
    });
  }

  // ─── Modo Lienzo Inmersivo (Zen Mode) ───────────────────────

  private bindZenModeControls(): void {
    const btnZen = document.querySelector("#btn-zen-mode") as HTMLButtonElement | null;
    btnZen?.addEventListener("click", () => {
      this.toggleZenMode();
    });

    document.addEventListener("keydown", (e: KeyboardEvent) => {
      if (this.dependencies.isTypingInFormField()) return;

      const isCtrlOrCmd = e.ctrlKey || e.metaKey;
      if (isCtrlOrCmd && e.shiftKey && (e.key === "F" || e.key === "f" || e.code === "KeyF")) {
        e.preventDefault();
        e.stopPropagation();
        this.toggleZenMode();
        return;
      }

      if (e.key === "F11") {
        e.preventDefault();
        e.stopPropagation();
        this.toggleZenMode();
        return;
      }

      if (e.key === "Escape" && this.zenModeActive) {
        e.preventDefault();
        e.stopPropagation();
        this.toggleZenMode(false);
        return;
      }
    });

    if (typeof document !== "undefined") {
      document.addEventListener("fullscreenchange", () => {
        if (!document.fullscreenElement && this.zenModeActive) {
          this.toggleZenMode(false);
        }
      });
    }
  }

  private renderFloatingExitPill(): void {
    let pill = document.querySelector("#zen-exit-pill") as HTMLButtonElement | null;
    if (!pill) {
      pill = document.createElement("button");
      pill.id = "zen-exit-pill";
      pill.className = "zen-exit-pill";
      pill.type = "button";
      pill.setAttribute("aria-label", "Salir de pantalla completa");
      pill.innerHTML = `<span>🔲 Salir de Pantalla Completa <kbd>Esc</kbd></span>`;
      pill.addEventListener("click", () => {
        this.toggleZenMode(false);
      });
      document.body.appendChild(pill);
    }
    pill.style.display = "flex";
  }

  private removeFloatingExitPill(): void {
    const pill = document.querySelector("#zen-exit-pill") as HTMLButtonElement | null;
    if (pill) {
      pill.style.display = "none";
    }
  }

  // ─── Botones de Fijación (Pin Toggles) ──────────────────────

  private bindPinToggleButtons(): void {
    const bindPin = (panel: PanelKey, selector: string) => {
      const btn = document.querySelector(selector) as HTMLButtonElement | null;
      if (!btn) return;

      btn.addEventListener("click", (e) => {
        e.stopPropagation();
        const current = this.settings[panel];
        this.setPanelAutoHide(panel, !current);
      });
    };

    bindPin("left", "#btn-pin-left");
    bindPin("right", "#btn-pin-right");
    bindPin("dock", "#instrument-center-pin");
  }

  public syncPinButtonState(panel: PanelKey): void {
    const selector = panel === "left"
      ? "#btn-pin-left"
      : panel === "right"
        ? "#btn-pin-right"
        : "#instrument-center-pin";

    const btn = document.querySelector(selector) as HTMLButtonElement | null;
    if (!btn) return;

    const isAutoHide = this.settings[panel];
    btn.textContent = isAutoHide ? "🔓" : "📌";
    btn.classList.toggle("pinned", !isAutoHide);
    btn.setAttribute("aria-pressed", String(!isAutoHide));
    btn.dataset.tooltip = isAutoHide
      ? "Auto-ocultar: Activado (Haz clic para fijar)"
      : "Panel fijado (Haz clic para activar auto-ocultar)";
  }

  private syncAllPinButtonStates(): void {
    this.syncPinButtonState("left");
    this.syncPinButtonState("right");
    this.syncPinButtonState("dock");
  }

  // ─── Eventos Globales y Selección ──────────────────────────

  private bindGlobalEvents(): void {
    window.addEventListener("open-floating-instrument", () => {
      if (this.settings.dock) {
        this.scheduleCollapse("dock", 400);
      }
    });

    window.addEventListener("schematic-selection-changed", (event: Event) => {
      const customEvent = event as CustomEvent<{ count?: number }>;
      const count = customEvent.detail?.count ?? 0;
      if (count > 0 && this.settings.right) {
        this.triggerPanelReveal("right");
      }
    });
  }

  // ─── Persistencia en Storage ───────────────────────────────

  private loadSettings(): AutoHideSettings {
    try {
      if (typeof this.storage.getItem === "function") {
        const raw = this.storage.getItem(AUTO_HIDE_STORAGE_KEY);
        if (raw) {
          const parsed = JSON.parse(raw) as Partial<AutoHideSettings>;
          return {
            left: typeof parsed.left === "boolean" ? parsed.left : DEFAULT_AUTO_HIDE_SETTINGS.left,
            right: typeof parsed.right === "boolean" ? parsed.right : DEFAULT_AUTO_HIDE_SETTINGS.right,
            dock: typeof parsed.dock === "boolean" ? parsed.dock : DEFAULT_AUTO_HIDE_SETTINGS.dock,
          };
        }
      }
    } catch {
      // Usar valores por defecto si el storage falla
    }
    return { ...DEFAULT_AUTO_HIDE_SETTINGS };
  }

  private saveSettings(): void {
    try {
      if (typeof this.storage.setItem === "function") {
        this.storage.setItem(AUTO_HIDE_STORAGE_KEY, JSON.stringify(this.settings));
      }
    } catch {
      // Ignorar errores de cuota o modo incógnito
    }
  }
}

export function createAutoHideController(
  dependencies: AutoHideControllerDependencies,
): AutoHideController {
  return new AutoHideController(dependencies);
}
