import type { TabManager } from "./tab_manager";

/**
 * tab_context_menu.ts — Menú Contextual de Clic Derecho para las Pestañas de Circuitos (Workspaces).
 *
 * Provee acciones para renombrar, duplicar, cerrar pestañas y cerrar pestañas adyacentes.
 */

export function showTabContextMenu(
  event: MouseEvent,
  tabId: string,
  tabManager: TabManager,
): void {
  event.preventDefault();
  event.stopPropagation();

  const existingMenu = document.getElementById("tab-context-menu");
  if (existingMenu) existingMenu.remove();

  const targetTab = tabManager.getTabById(tabId);
  if (!targetTab) return;

  const menu = document.createElement("div");
  menu.id = "tab-context-menu";
  menu.className = "canvas-context-menu tab-context-menu";

  const posX = event.clientX;
  const posY = event.clientY;

  menu.style.position = "fixed";
  menu.style.left = `${posX}px`;
  menu.style.top = `${posY}px`;

  const closeMenu = (evt: MouseEvent) => {
    if (!menu.contains(evt.target as Node)) {
      menu.remove();
      document.removeEventListener("mousedown", closeMenu);
      document.removeEventListener("keydown", onKeyDown);
    }
  };

  const onKeyDown = (evt: KeyboardEvent) => {
    if (evt.key === "Escape") {
      menu.remove();
      document.removeEventListener("mousedown", closeMenu);
      document.removeEventListener("keydown", onKeyDown);
    }
  };

  setTimeout(() => {
    document.addEventListener("mousedown", closeMenu);
    document.addEventListener("keydown", onKeyDown);
  }, 10);

  const createMenuItem = (
    label: string,
    shortcut: string,
    action: () => void,
    icon = "",
  ): HTMLButtonElement => {
    const btn = document.createElement("button");
    btn.className = "context-menu-item";
    btn.type = "button";

    const leftDiv = document.createElement("div");
    leftDiv.className = "context-menu-item-left";

    if (icon) {
      const iconSpan = document.createElement("span");
      iconSpan.className = "context-menu-icon";
      iconSpan.textContent = icon;
      leftDiv.appendChild(iconSpan);
    }

    const labelSpan = document.createElement("span");
    labelSpan.textContent = label;
    leftDiv.appendChild(labelSpan);
    btn.appendChild(leftDiv);

    if (shortcut) {
      const shortcutSpan = document.createElement("span");
      shortcutSpan.className = "context-menu-shortcut";
      shortcutSpan.textContent = shortcut;
      btn.appendChild(shortcutSpan);
    }

    btn.addEventListener("click", () => {
      action();
      menu.remove();
      document.removeEventListener("mousedown", closeMenu);
      document.removeEventListener("keydown", onKeyDown);
    });

    return btn;
  };

  const appendDivider = () => {
    const divider = document.createElement("div");
    divider.className = "context-menu-divider";
    menu.appendChild(divider);
  };

  // 1. Renombrar
  menu.appendChild(
    createMenuItem("Renombrar Hoja...", "F2", () => {
      const newName = window.prompt("Introduce el nuevo nombre para la hoja:", targetTab.name);
      if (newName && newName.trim()) {
        tabManager.renameTab(tabId, newName.trim());
      }
    }, "✏️"),
  );

  // 2. Duplicar
  menu.appendChild(
    createMenuItem("Duplicar Pestaña", "Ctrl+D", () => {
      tabManager.duplicateTab(tabId);
    }, "📑"),
  );

  // 3. Guardar Como
  menu.appendChild(
    createMenuItem("Guardar Hoja Como...", "Ctrl+Shift+S", () => {
      if (tabManager.activeTabId !== tabId) {
        tabManager.switchTab(tabId);
      }
      void tabManager.saveCircuitAs();
    }, "💾"),
  );

  appendDivider();

  // 4. Cerrar
  menu.appendChild(
    createMenuItem("Cerrar Pestaña", "Ctrl+W", () => {
      void tabManager.closeTab(tabId);
    }, "❌"),
  );

  // 5. Cerrar Otras Pestañas
  const otherTabsCount = tabManager.tabs.filter(t => t.id !== tabId).length;
  if (otherTabsCount > 0) {
    menu.appendChild(
      createMenuItem("Cerrar Otras Pestañas", "", () => {
        void tabManager.closeOtherTabs(tabId);
      }, "🚫"),
    );
  }

  document.body.appendChild(menu);

  // Ajuste inteligente de límites de pantalla
  const menuRect = menu.getBoundingClientRect();
  if (menuRect.right > window.innerWidth - 10) {
    menu.style.left = `${Math.max(10, posX - menuRect.width)}px`;
  }
  if (menuRect.bottom > window.innerHeight - 10) {
    menu.style.top = `${Math.max(10, posY - menuRect.height)}px`;
  }
}
