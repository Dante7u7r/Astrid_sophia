import type { PanelLayoutManager } from "./panel_layout_manager";

export type SidePanel = "left" | "right";

export interface SidePanelController {
  init(): void;
  toggleSidePanel(panel: SidePanel): void;
  syncDrawerState(): void;
  isCompactDrawerViewport(): boolean;
}

export interface SidePanelControllerDeps {
  getPanelLayoutManager(): PanelLayoutManager | null;
  isTypingInFormField(): boolean;
  matchMedia(query: string): MediaQueryList;
  requestAnimationFrame(callback: FrameRequestCallback): number;
  setTimeout(callback: () => void, delay: number): number;
}

function queryButton(selector: string): HTMLButtonElement | null {
  return document.querySelector<HTMLButtonElement>(selector);
}

export function createSidePanelController(deps: SidePanelControllerDeps): SidePanelController {
  let sidebarLeft: HTMLElement | null = null;
  let sidebarRight: HTMLElement | null = null;
  let btnToggleLeft: HTMLButtonElement | null = null;
  let btnToggleRight: HTMLButtonElement | null = null;
  let drawerBackdrop: HTMLElement | null = null;
  const compactDrawerMedia = deps.matchMedia("(max-width: 760px)");

  const isCompactDrawerViewport = (): boolean => compactDrawerMedia.matches;

  const isSidePanelCollapsed = (panel: SidePanel): boolean => {
    const element = panel === "left" ? sidebarLeft : sidebarRight;
    if (isCompactDrawerViewport()) {
      return element?.classList.contains("collapsed") ?? true;
    }
    return deps.getPanelLayoutManager()?.isPanelCollapsed(panel) ?? element?.classList.contains("collapsed") ?? true;
  };

  const syncDrawerState = (): void => {
    const leftCollapsed = isSidePanelCollapsed("left");
    const rightCollapsed = isSidePanelCollapsed("right");
    const compact = isCompactDrawerViewport();
    const drawerOpen = compact && (!leftCollapsed || !rightCollapsed);

    document.body.classList.toggle("mobile-drawer-open", drawerOpen);
    drawerBackdrop?.classList.toggle("active", drawerOpen);
    drawerBackdrop?.toggleAttribute("hidden", !drawerOpen);

    sidebarLeft?.setAttribute("aria-hidden", compact && leftCollapsed ? "true" : "false");
    sidebarRight?.setAttribute("aria-hidden", compact && rightCollapsed ? "true" : "false");

    btnToggleLeft?.setAttribute("aria-expanded", String(!leftCollapsed));
    btnToggleRight?.setAttribute("aria-expanded", String(!rightCollapsed));
    document.querySelector("#btn-dock-toggle-left")?.setAttribute("aria-expanded", String(!leftCollapsed));
    document.querySelector("#btn-dock-toggle-right")?.setAttribute("aria-expanded", String(!rightCollapsed));
    document.querySelector("#btn-expand-left")?.setAttribute("aria-expanded", String(!leftCollapsed));
    document.querySelector("#btn-expand-right")?.setAttribute("aria-expanded", String(!rightCollapsed));
  };

  const closeMobileDrawers = (): void => {
    if (!isCompactDrawerViewport()) return;
    deps.getPanelLayoutManager()?.setPanelCollapsed("left", true);
    deps.getPanelLayoutManager()?.setPanelCollapsed("right", true);
    syncDrawerState();
  };

  const toggleSidePanel = (panel: SidePanel): void => {
    const panelLayoutManager = deps.getPanelLayoutManager();
    if (!panelLayoutManager) return;

    if (!isCompactDrawerViewport()) {
      panelLayoutManager.togglePanel(panel);
      syncDrawerState();
      return;
    }

    const opening = isSidePanelCollapsed(panel);
    if (panel === "left") {
      panelLayoutManager.setPanelCollapsed("right", true);
      panelLayoutManager.setPanelCollapsed("left", !opening);
    } else {
      panelLayoutManager.setPanelCollapsed("left", true);
      panelLayoutManager.setPanelCollapsed("right", !opening);
    }
    syncDrawerState();
  };

  const init = (): void => {
    sidebarLeft = document.querySelector("#sidebar-left");
    sidebarRight = document.querySelector("#sidebar-right");
    btnToggleLeft = queryButton("#btn-toggle-left");
    btnToggleRight = queryButton("#btn-toggle-right");
    const btnDockLeft = queryButton("#btn-dock-toggle-left");
    const btnDockRight = queryButton("#btn-dock-toggle-right");
    const btnExpandLeft = queryButton("#btn-expand-left");
    const btnExpandRight = queryButton("#btn-expand-right");

    const toggleLeft = () => {
      const panelLayoutManager = deps.getPanelLayoutManager();
      if (panelLayoutManager) {
        toggleSidePanel("left");
        return;
      }
      if (!sidebarLeft) return;
      sidebarLeft.classList.toggle("collapsed");
      const isCollapsed = sidebarLeft.classList.contains("collapsed");
      if (btnToggleLeft) btnToggleLeft.textContent = isCollapsed ? "Componentes >" : "< Colapsar";
      if (btnDockLeft) btnDockLeft.classList.toggle("active", !isCollapsed);
      if (btnExpandLeft) btnExpandLeft.style.display = isCollapsed ? "block" : "none";
    };

    const toggleRight = () => {
      const panelLayoutManager = deps.getPanelLayoutManager();
      if (panelLayoutManager) {
        toggleSidePanel("right");
        return;
      }
      if (!sidebarRight) return;
      sidebarRight.classList.toggle("collapsed");
      const isCollapsed = sidebarRight.classList.contains("collapsed");
      if (btnToggleRight) btnToggleRight.textContent = isCollapsed ? "< Propiedades" : "Colapsar >";
      if (btnDockRight) btnDockRight.classList.toggle("active", !isCollapsed);
      if (btnExpandRight) btnExpandRight.style.display = isCollapsed ? "block" : "none";
    };

    btnToggleLeft?.addEventListener("click", toggleLeft);
    btnDockLeft?.addEventListener("click", toggleLeft);
    btnExpandLeft?.addEventListener("click", toggleLeft);
    btnToggleRight?.addEventListener("click", toggleRight);
    btnDockRight?.addEventListener("click", toggleRight);
    btnExpandRight?.addEventListener("click", toggleRight);

    drawerBackdrop = document.querySelector("#mobile-drawer-backdrop");
    if (!drawerBackdrop) {
      drawerBackdrop = document.createElement("div");
      drawerBackdrop.id = "mobile-drawer-backdrop";
      drawerBackdrop.className = "mobile-drawer-backdrop";
      drawerBackdrop.hidden = true;
      drawerBackdrop.setAttribute("aria-hidden", "true");
      document.querySelector("#main-dashboard")?.appendChild(drawerBackdrop);
    }

    drawerBackdrop.addEventListener("click", closeMobileDrawers);
    document.addEventListener("keydown", (event) => {
      if (event.key === "Escape" && !deps.isTypingInFormField()) {
        closeMobileDrawers();
      }
    });
    window.addEventListener("panel-layout-change", syncDrawerState);
    compactDrawerMedia.addEventListener("change", () => syncDrawerState());
    syncDrawerState();
    deps.requestAnimationFrame(() => syncDrawerState());
    deps.setTimeout(() => syncDrawerState(), 420);
  };

  return {
    init,
    toggleSidePanel,
    syncDrawerState,
    isCompactDrawerViewport,
  };
}
