import type { PanelLayoutManager } from "./panel_layout_manager";

export interface InstrumentCenterControllerDependencies {
  getPanelLayoutManager(): PanelLayoutManager | null;
  isTypingInFormField(): boolean;
  onResizeRequested(): void;
}

export class InstrumentCenterController {
  private returnFocus: HTMLElement | null = null;
  private wasOpen = false;
  private focusTimer: number | null = null;

  constructor(private readonly dependencies: InstrumentCenterControllerDependencies) {}

  init(): void {
    const center = document.querySelector("#bottom-dock") as HTMLElement | null;
    const backdrop = document.querySelector("#instrument-center-backdrop") as HTMLElement | null;
    const closeButton = document.querySelector("#instrument-center-close") as HTMLButtonElement | null;
    const menuButton = document.querySelector("#instruments-menu-btn") as HTMLButtonElement | null;
    const dockMenuItem = document.querySelector("#menu-toggle-dock") as HTMLButtonElement | null;
    if (!center || !backdrop || !closeButton) return;

    const closeCenter = (): void => {
      this.dependencies.getPanelLayoutManager()?.setPanelCollapsed("dock", true);
    };

    const syncCenterState = (): void => {
      const isOpen = !center.classList.contains("collapsed");
      center.setAttribute("aria-hidden", String(!isOpen));
      backdrop.toggleAttribute("hidden", !isOpen);
      document.body.classList.toggle("instrument-center-open", isOpen);

      if (isOpen && !this.wasOpen) {
        const activeElement = document.activeElement as HTMLElement | null;
        this.returnFocus = !activeElement
          || activeElement === document.body
          || activeElement.closest("#instruments-dropdown")
          ? menuButton
          : activeElement;
        this.focusCloseButton(closeButton, 60);
        requestAnimationFrame(() => {
          closeButton.focus({ preventScroll: true });
          this.dependencies.onResizeRequested();
        });
      } else if (isOpen) {
        const activeElement = document.activeElement as HTMLElement | null;
        if (!activeElement || activeElement === document.body || !center.contains(activeElement)) {
          closeButton.focus({ preventScroll: true });
        }
      } else if (!isOpen && this.wasOpen) {
        this.clearFocusTimer();
        requestAnimationFrame(() => {
          if (this.returnFocus?.isConnected) {
            this.returnFocus.focus();
          } else {
            menuButton?.focus();
          }
          this.returnFocus = null;
        });
      }

      this.wasOpen = isOpen;
    };

    closeButton.addEventListener("click", closeCenter);
    backdrop.addEventListener("click", closeCenter);
    menuButton?.addEventListener("click", () => this.focusCloseButtonIfOpen(center, closeButton, 0));
    dockMenuItem?.addEventListener("click", () => this.focusCloseButtonIfOpen(center, closeButton, 120));

    document.addEventListener("keydown", (event) => {
      if (center.classList.contains("collapsed")) return;

      if (event.key === "Escape" && !this.dependencies.isTypingInFormField()) {
        event.preventDefault();
        closeCenter();
        return;
      }

      if (event.key !== "Tab") return;
      this.trapFocus(event, center);
    });

    window.addEventListener("panel-layout-change", syncCenterState);
    syncCenterState();
  }

  private focusCloseButton(closeButton: HTMLButtonElement, delayMs: number): void {
    this.clearFocusTimer();
    closeButton.focus({ preventScroll: true });
    this.repairFocusIfLost(closeButton, 0);
    this.repairFocusIfLost(closeButton, 180);
    this.focusTimer = window.setTimeout(() => {
      closeButton.focus({ preventScroll: true });
      this.focusTimer = null;
    }, delayMs);
  }

  private focusCloseButtonIfOpen(
    center: HTMLElement,
    closeButton: HTMLButtonElement,
    delayMs: number,
  ): void {
    window.setTimeout(() => {
      if (!center.classList.contains("collapsed")) {
        closeButton.focus({ preventScroll: true });
        this.repairFocusIfLost(closeButton, 180);
      }
    }, delayMs);
  }

  private repairFocusIfLost(closeButton: HTMLButtonElement, delayMs: number): void {
    window.setTimeout(() => {
      const center = document.querySelector("#bottom-dock") as HTMLElement | null;
      if (!center || center.classList.contains("collapsed")) return;
      const activeElement = document.activeElement as HTMLElement | null;
      if (!activeElement || activeElement === document.body || !center.contains(activeElement)) {
        closeButton.focus({ preventScroll: true });
      }
    }, delayMs);
  }

  private clearFocusTimer(): void {
    if (this.focusTimer !== null) {
      window.clearTimeout(this.focusTimer);
      this.focusTimer = null;
    }
  }

  private trapFocus(event: KeyboardEvent, center: HTMLElement): void {
    const focusable = [...center.querySelectorAll<HTMLElement>(
      'button:not([disabled]), select:not([disabled]), input:not([disabled]), [tabindex]:not([tabindex="-1"])',
    )].filter((element) => element.getClientRects().length > 0);
    if (focusable.length === 0) return;

    const first = focusable[0];
    const last = focusable[focusable.length - 1];
    if (!center.contains(document.activeElement)) {
      event.preventDefault();
      (event.shiftKey ? last : first).focus();
    } else if (event.shiftKey && document.activeElement === first) {
      event.preventDefault();
      last.focus();
    } else if (!event.shiftKey && document.activeElement === last) {
      event.preventDefault();
      first.focus();
    }
  }
}

export function createInstrumentCenterController(
  dependencies: InstrumentCenterControllerDependencies,
): InstrumentCenterController {
  return new InstrumentCenterController(dependencies);
}
