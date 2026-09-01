import type { PanelLayoutManager } from "./panel_layout_manager";

export interface InstrumentCenterControllerDependencies {
  getPanelLayoutManager(): PanelLayoutManager | null;
  isTypingInFormField(): boolean;
  onResizeRequested(): void;
}

export class InstrumentCenterController {
  private wasOpen = false;

  constructor(private readonly dependencies: InstrumentCenterControllerDependencies) {}

  init(): void {
    const center = document.querySelector("#bottom-dock") as HTMLElement | null;
    const backdrop = document.querySelector("#instrument-center-backdrop") as HTMLElement | null;
    const closeButton = document.querySelector("#instrument-center-close") as HTMLButtonElement | null;
    if (!center || !closeButton) return;

    const closeCenter = (): void => {
      this.dependencies.getPanelLayoutManager()?.setPanelCollapsed("dock", true);
    };

    const syncCenterState = (): void => {
      const isOpen = !center.classList.contains("collapsed");
      center.setAttribute("aria-hidden", String(!isOpen));
      if (backdrop) backdrop.setAttribute("hidden", "true");

      if (isOpen !== this.wasOpen) {
        requestAnimationFrame(() => {
          this.dependencies.onResizeRequested();
        });
      }

      this.wasOpen = isOpen;
    };

    closeButton.addEventListener("click", closeCenter);
    if (backdrop) backdrop.addEventListener("click", closeCenter);
    document.addEventListener("keydown", (event) => {
      if (center.classList.contains("collapsed")) return;

      if (event.key === "Escape" && !this.dependencies.isTypingInFormField()) {
        event.preventDefault();
        closeCenter();
      }
    });

    window.addEventListener("panel-layout-change", syncCenterState);
    syncCenterState();
  }
}

export function createInstrumentCenterController(
  dependencies: InstrumentCenterControllerDependencies,
): InstrumentCenterController {
  return new InstrumentCenterController(dependencies);
}
