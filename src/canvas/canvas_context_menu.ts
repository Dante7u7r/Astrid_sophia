import {
  type CanvasOrchestrator,
  type ComponentInstance,
  hitTestComponentAt,
} from "../canvas_orchestrator";
import type { CanvasInputCallbacks } from "./canvas_input_controller";
import { clientToCanvasPoint } from "./canvas_input_model";

type ContextMenuCallbacks = Pick<
  CanvasInputCallbacks,
  | "requestRender"
  | "onCanvasModified"
  | "onNetlistSync"
  | "onSelectionChanged"
  | "onSelectAll"
  | "onWireMode"
  | "log"
>;

export function showCanvasContextMenu(
  event: MouseEvent,
  canvas: HTMLCanvasElement,
  orchestrator: CanvasOrchestrator,
  callbacks: ContextMenuCallbacks,
): void {
  event.preventDefault();

  const existingMenu = document.getElementById("canvas-context-menu");
  if (existingMenu) existingMenu.remove();

  const rect = canvas.getBoundingClientRect();
  const { screenX, screenY } = clientToCanvasPoint(rect, event);
  const worldPt = orchestrator.screenToWorld(screenX, screenY);

  const clickedComp = orchestrator.components.find(
    comp => hitTestComponentAt(comp, worldPt.x, worldPt.y),
  );

  const menu = document.createElement("div");
  menu.id = "canvas-context-menu";
  menu.className = "canvas-context-menu";

  const container = canvas.parentElement || document.body;
  const containerRect = container.getBoundingClientRect();
  menu.style.position = "absolute";
  menu.style.left = `${event.clientX - containerRect.left + container.scrollLeft}px`;
  menu.style.top = `${event.clientY - containerRect.top + container.scrollTop}px`;

  const closeMenu = (evt: MouseEvent) => {
    if (!menu.contains(evt.target as Node)) {
      menu.remove();
      document.removeEventListener("mousedown", closeMenu);
    }
  };

  setTimeout(() => {
    document.addEventListener("mousedown", closeMenu);
  }, 10);

  const createMenuItem = (label: string, shortcut: string, action: () => void) => {
    const btn = document.createElement("button");
    btn.className = "context-menu-item";

    const labelSpan = document.createElement("span");
    labelSpan.textContent = label;
    btn.appendChild(labelSpan);

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
    });
    return btn;
  };

  if (clickedComp) {
    populateComponentMenu(menu, clickedComp, orchestrator, callbacks, createMenuItem);
  } else {
    populateCanvasMenu(menu, orchestrator, callbacks, createMenuItem);
  }

  container.appendChild(menu);
}

function appendDivider(menu: HTMLElement): void {
  const divider = document.createElement("div");
  divider.className = "context-menu-divider";
  menu.appendChild(divider);
}

function populateComponentMenu(
  menu: HTMLElement,
  clickedComp: ComponentInstance,
  orchestrator: CanvasOrchestrator,
  callbacks: ContextMenuCallbacks,
  createMenuItem: (label: string, shortcut: string, action: () => void) => HTMLButtonElement,
): void {
  const isSelected = clickedComp.selected
    || orchestrator.selectedComponent?.id === clickedComp.id
    || orchestrator.selectedComponents.some(c => c.id === clickedComp.id);
  if (!isSelected) {
    orchestrator.selectedComponent = clickedComp;
    orchestrator.selectedComponents = [];
    callbacks.onSelectionChanged(clickedComp);
    callbacks.requestRender(true);
  }

  menu.appendChild(createMenuItem("Rotar 90 deg", "R", () => {
    orchestrator.rotateSelectedComponent();
    callbacks.requestRender(true);
    callbacks.onCanvasModified();
  }));

  menu.appendChild(createMenuItem("Rotar 15 deg", "Shift+Rueda", () => {
    orchestrator.rotateSelectedByDegrees(15);
    callbacks.requestRender(true);
    callbacks.onCanvasModified();
  }));

  menu.appendChild(createMenuItem("Espejar (Mirror)", "M", () => {
    orchestrator.mirrorSelectedComponent();
    callbacks.requestRender(true);
    callbacks.onCanvasModified();
  }));

  menu.appendChild(createMenuItem("Duplicar", "Ctrl+D", () => {
    orchestrator.duplicateSelected();
    callbacks.requestRender(true);
    callbacks.onCanvasModified();
    callbacks.onNetlistSync();
  }));

  menu.appendChild(createMenuItem("Iniciar Cable", "W", () => {
    callbacks.onWireMode();
  }));

  menu.appendChild(createMenuItem("Copiar ID", "", () => {
    navigator.clipboard.writeText(clickedComp.id);
    callbacks.log(`ID del componente copiado: ${clickedComp.id}`, "system");
  }));

  appendDivider(menu);

  menu.appendChild(createMenuItem("Eliminar", "Supr", () => {
    orchestrator.removeSelected();
    callbacks.requestRender(true);
    callbacks.onCanvasModified();
    callbacks.onNetlistSync();
  }));
}

function populateCanvasMenu(
  menu: HTMLElement,
  orchestrator: CanvasOrchestrator,
  callbacks: ContextMenuCallbacks,
  createMenuItem: (label: string, shortcut: string, action: () => void) => HTMLButtonElement,
): void {
  menu.appendChild(createMenuItem("Centrar Vista", "F", () => {
    orchestrator.resetCameraToCircuit();
  }));

  menu.appendChild(createMenuItem("Seleccionar Todo", "Ctrl+A", () => {
    callbacks.onSelectAll();
    callbacks.requestRender(true);
  }));

  if (orchestrator.selectedComponent || orchestrator.selectedComponents.length > 0) {
    menu.appendChild(createMenuItem("Limpiar Seleccion", "", () => {
      orchestrator.selectedComponent = null;
      orchestrator.selectedComponents = [];
      callbacks.onSelectionChanged(null);
      callbacks.requestRender(true);
    }));
  }

  appendDivider(menu);

  menu.appendChild(createMenuItem("Restablecer Layout", "Ctrl+0", () => {
    const keyboardEvent = new KeyboardEvent("keydown", { key: "0", ctrlKey: true });
    document.dispatchEvent(keyboardEvent);
  }));
}
