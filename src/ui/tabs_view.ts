import type { Tab } from "./workspace_state";

export interface TabsViewHandlers {
  onSelect(tabId: string): void;
  onClose(tabId: string): void;
}

export class TabsView {
  constructor(
    private readonly containerSelector = "#tabs-container",
    private readonly documentRef: Document = document,
  ) {}

  public render(tabs: readonly Tab[], activeTabId: string | null, handlers: TabsViewHandlers): void {
    const container = this.documentRef.querySelector(this.containerSelector);
    if (!container) return;

    container.innerHTML = "";

    tabs.forEach(tab => {
      const tabEl = this.documentRef.createElement("div");
      tabEl.className = `tab-item${tab.id === activeTabId ? " active" : ""}`;
      tabEl.setAttribute("data-id", tab.id);

      const nameSpan = this.documentRef.createElement("span");
      nameSpan.textContent = tab.name;
      tabEl.appendChild(nameSpan);

      if (tab.unsaved) {
        const dot = this.documentRef.createElement("span");
        dot.className = "tab-unsaved";
        tabEl.appendChild(dot);
      }

      const closeBtn = this.documentRef.createElement("button");
      closeBtn.className = "tab-close";
      closeBtn.innerHTML = "&times;";
      closeBtn.type = "button";
      closeBtn.title = "Cerrar pestaña";
      closeBtn.addEventListener("click", (event) => {
        event.stopPropagation();
        handlers.onClose(tab.id);
      });

      tabEl.appendChild(closeBtn);
      tabEl.addEventListener("click", () => {
        handlers.onSelect(tab.id);
      });

      container.appendChild(tabEl);
    });
  }
}
