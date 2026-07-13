import type { PanelLayoutManager } from "./panel_layout_manager";
import type { SidePanelController } from "./side_panel_controller";
import type { TabManager } from "./tab_manager";

export interface AppKeyboardShortcutsDeps {
  getTabManager(): TabManager | null;
  getPanelLayoutManager(): PanelLayoutManager | null;
  getSidePanelController(): SidePanelController | null;
  isTypingInFormField(): boolean;
  getOpenCircuitButton(): HTMLElement | null;
}

export function initAppKeyboardShortcuts(deps: AppKeyboardShortcutsDeps): void {
  window.addEventListener("keydown", (event) => {
    const typing = deps.isTypingInFormField();
    const ctrl = event.ctrlKey || event.metaKey;

    if (!typing) {
      if (event.key === "F5") {
        event.preventDefault();
      }
      if (ctrl && event.key.toLowerCase() === "r") {
        event.preventDefault();
      }
      if (event.key === "Backspace") {
        event.preventDefault();
      }
    }

    if (typing) return;

    if (ctrl && event.key === "n") {
      event.preventDefault();
      deps.getTabManager()?.createNewTab();
    }
    if (ctrl && event.key === "o") {
      event.preventDefault();
      deps.getOpenCircuitButton()?.click();
    }
    if (ctrl && event.key === "s") {
      event.preventDefault();
      if (event.shiftKey) {
        deps.getTabManager()?.saveCircuitAs();
      } else {
        deps.getTabManager()?.saveCircuitDirect();
      }
    }
    if (ctrl && event.key === "w") {
      event.preventDefault();
      deps.getTabManager()?.closeActiveTab();
    }
    if (event.key === "F9") {
      event.preventDefault();
      deps.getSidePanelController()?.toggleSidePanel("left");
    }
    if (event.key === "F10") {
      event.preventDefault();
      deps.getSidePanelController()?.toggleSidePanel("right");
    }
    if (event.key === "F8") {
      event.preventDefault();
      deps.getPanelLayoutManager()?.togglePanel("dock");
    }
  });
}
