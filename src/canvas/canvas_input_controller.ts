import {
  CanvasOrchestrator,
  ComponentInstance,
  hitTestComponentAt,
} from "../canvas_orchestrator";
import { isTypingInFormField } from "./keyboard_guards";
import type { AnalysisMode } from "../ui/simulation_controls";

export interface CanvasInputCallbacks {
  requestRender: (immediate?: boolean) => void;
  onWireConnected: () => void;
  onCanvasModified: () => void;
  onNetlistSync: () => void;
  onSelectionChanged: (comp: ComponentInstance | null) => void;
  getPinNode: (pinKey: string) => string | undefined;
  log: (text: string, type?: "system" | "error") => void;
  getProbePlacementMode: () => "CH1" | "CH2" | "CH3" | "CH4" | null;
  clearProbePlacementMode: () => void;
  onProbePlaced: (channel: "CH1" | "CH2" | "CH3" | "CH4", nodeId: string) => void;
  getActiveAnalysisMode: () => AnalysisMode;
  onSparPortAssign: (nodeId: string) => boolean;
  onSwitchDoubleClick: (comp: ComponentInstance) => Promise<void>;
  onHideMcuDebug: () => void;
  onComponentPlaced: (comp: ComponentInstance) => void;
  onUndo: () => void;
  onRedo: () => void;
  onSelectAll: () => void;
  onFitAll: () => void;
  onEscape: () => void;
  onWireMode: () => void;
}

export function attachCanvasInput(
  canvas: HTMLCanvasElement,
  orchestrator: CanvasOrchestrator,
  callbacks: CanvasInputCallbacks,
): () => void {
  let isRightClickPanning = false;
  let lastMousePos = { x: 0, y: 0 };

  const onMouseDown = (e: MouseEvent) => {
    const rect = canvas.getBoundingClientRect();
    const screenX = e.clientX - rect.left;
    const screenY = e.clientY - rect.top;
    const worldPt = orchestrator.screenToWorld(screenX, screenY);

    if (e.button === 0) {
      const probeMode = callbacks.getProbePlacementMode();
      if (probeMode) {
        if (orchestrator.hoveredPin) {
          const pinKey = `${orchestrator.hoveredPin.componentId}:${orchestrator.hoveredPin.pinIndex}`;
          const nodeId = callbacks.getPinNode(pinKey);
          if (nodeId !== undefined) {
            callbacks.onProbePlaced(probeMode, nodeId);
          }
        }
        callbacks.clearProbePlacementMode();
        callbacks.requestRender(true);
        return;
      }

      if (callbacks.getActiveAnalysisMode() === "SPAR" && orchestrator.hoveredPin) {
        const pinKey = `${orchestrator.hoveredPin.componentId}:${orchestrator.hoveredPin.pinIndex}`;
        const nodeId = callbacks.getPinNode(pinKey);
        if (nodeId !== undefined) {
          if (callbacks.onSparPortAssign(nodeId)) {
            callbacks.requestRender(true);
            return;
          }
        }
      }

      if (orchestrator.hoveredPin) {
        orchestrator.activePinForWire = orchestrator.hoveredPin;
        orchestrator.tempWireEnd = orchestrator.snapPointToGrid(worldPt);
      } else {
        const isShift = e.shiftKey;
        const comp = orchestrator.selectComponentAt(worldPt.x, worldPt.y, isShift);

        if (comp) {
          orchestrator.startDraggingSelected(worldPt.x, worldPt.y);
          callbacks.onSelectionChanged(comp);
        } else if (!isShift && !orchestrator.hoveredWire) {
          orchestrator.selectionStart = orchestrator.snapPointToGrid(worldPt);
          orchestrator.selectionEnd = orchestrator.snapPointToGrid(worldPt);
          callbacks.onHideMcuDebug();
          callbacks.onSelectionChanged(null);
        } else if (orchestrator.selectedWire) {
          callbacks.log(
            `Cable seleccionado: [${orchestrator.selectedWire.id}]. Presiona Delete/Backspace para eliminarlo de forma individual.`,
            "system",
          );
        }
      }
    } else if (e.button === 1 || e.button === 2) {
      isRightClickPanning = true;
      lastMousePos = { x: e.clientX, y: e.clientY };
      e.preventDefault();
    }
    callbacks.requestRender(true);
  };

  const onMouseMove = (e: MouseEvent) => {
    const rect = canvas.getBoundingClientRect();
    const screenX = e.clientX - rect.left;
    const screenY = e.clientY - rect.top;
    const worldPt = orchestrator.screenToWorld(screenX, screenY);

    orchestrator.checkHover(worldPt.x, worldPt.y);

    if (orchestrator.isDragging) {
      orchestrator.handleDragging(worldPt.x, worldPt.y);
    }

    if (orchestrator.selectionStart) {
      orchestrator.selectionEnd = orchestrator.snapPointToGrid(worldPt);
    }

    if (orchestrator.activePinForWire) {
      orchestrator.tempWireEnd = orchestrator.snapPointToGrid(worldPt);
    }

    if (isRightClickPanning) {
      const dx = e.clientX - lastMousePos.x;
      const dy = e.clientY - lastMousePos.y;
      orchestrator.pan(dx, dy);
      lastMousePos = { x: e.clientX, y: e.clientY };
    }

    callbacks.requestRender();
  };

  const completeConnection = (_e: MouseEvent) => {
    if (orchestrator.activePinForWire) {
      if (orchestrator.hoveredPin) {
        const from = orchestrator.activePinForWire;
        const to = orchestrator.hoveredPin;
        orchestrator.connectPins(from, to);
        callbacks.log(
          `Cable conectado: [${from.componentId}] terminal ${from.pinIndex} a [${to.componentId}] terminal ${to.pinIndex}`,
          "system",
        );
        callbacks.onWireConnected();
        callbacks.onCanvasModified();
      }
      orchestrator.activePinForWire = null;
      orchestrator.tempWireEnd = null;
    }

    if (orchestrator.selectionStart) {
      orchestrator.completeBoxSelection();
      if (orchestrator.selectedComponents.length > 0) {
        callbacks.log(
          `Selección en lote: ${orchestrator.selectedComponents.length} componentes seleccionados.`,
          "system",
        );
      }
    }

    if (orchestrator.isDragging) {
      callbacks.onCanvasModified();
    }

    orchestrator.stopDragging();
    callbacks.onNetlistSync();
    isRightClickPanning = false;
    callbacks.requestRender(true);
  };

  const onDblClick = async (e: MouseEvent) => {
    const rect = canvas.getBoundingClientRect();
    const screenX = e.clientX - rect.left;
    const screenY = e.clientY - rect.top;
    const worldPt = orchestrator.screenToWorld(screenX, screenY);
    const comp = orchestrator.selectComponentAt(worldPt.x, worldPt.y);

    if (comp?.type === "switch") {
      await callbacks.onSwitchDoubleClick(comp);
      callbacks.requestRender(true);
      callbacks.onCanvasModified();
    }
  };

  const onWheel = (e: WheelEvent) => {
    if (e.shiftKey && (orchestrator.selectedComponent || orchestrator.selectedComponents.length > 0)) {
      const degrees = e.deltaY < 0 ? -15 : 15;
      orchestrator.rotateSelectedByDegrees(degrees);
      if (orchestrator.selectedComponents.length > 0) {
        callbacks.log(`Lote de ${orchestrator.selectedComponents.length} componentes rotados de forma fina (15°).`, "system");
      } else if (orchestrator.selectedComponent) {
        callbacks.log(`Componente [${orchestrator.selectedComponent.id}] rotado de forma fina a ${orchestrator.selectedComponent.rotation}°`, "system");
      }
      callbacks.requestRender(true);
      callbacks.onCanvasModified();
      e.preventDefault();
      return;
    }

    const rect = canvas.getBoundingClientRect();
    const screenX = e.clientX - rect.left;
    const screenY = e.clientY - rect.top;
    const zoomFactor = e.deltaY < 0 ? 1.1 : 0.9;
    
    // Zoom factor bounding guard check
    const currentZoom = orchestrator.zoom;
    const nextZoom = currentZoom * zoomFactor;
    if (nextZoom >= orchestrator.minZoom && nextZoom <= orchestrator.maxZoom) {
      orchestrator.zoomAt(zoomFactor, screenX, screenY);
    } else {
      // Clamp to exactly the min/max boundary
      const clampedZoom = Math.min(Math.max(nextZoom, orchestrator.minZoom), orchestrator.maxZoom);
      const clampedFactor = clampedZoom / currentZoom;
      orchestrator.zoomAt(clampedFactor, screenX, screenY);
    }
    
    callbacks.requestRender(true);
    e.preventDefault();
  };

  const onKeyDown = (e: KeyboardEvent) => {
    if (isTypingInFormField()) return;

    const ctrl = e.ctrlKey || e.metaKey;

    // --- Global shortcuts (no selection required) ---
    if (ctrl && e.key === "z" && !e.shiftKey) {
      e.preventDefault();
      callbacks.onUndo();
      callbacks.requestRender(true);
      return;
    }

    if ((ctrl && e.shiftKey && e.key === "z") || (ctrl && e.key === "y")) {
      e.preventDefault();
      callbacks.onRedo();
      callbacks.requestRender(true);
      return;
    }

    if (ctrl && e.key === "a") {
      e.preventDefault();
      callbacks.onSelectAll();
      callbacks.requestRender(true);
      return;
    }

    if (e.key === "Escape") {
      callbacks.onEscape();
      callbacks.requestRender(true);
      return;
    }

    if (e.key === "f" || e.key === "F") {
      callbacks.onFitAll();
      callbacks.requestRender(true);
      return;
    }

    if (e.key === "m" || e.key === "M") {
      e.preventDefault();
      orchestrator.mirrorSelectedComponent();
      callbacks.requestRender(true);
      callbacks.onCanvasModified();
      callbacks.onNetlistSync();
      return;
    }

    if (ctrl && (e.key === "d" || e.key === "D")) {
      e.preventDefault();
      orchestrator.duplicateSelected();
      callbacks.requestRender(true);
      callbacks.onCanvasModified();
      callbacks.onNetlistSync();
      return;
    }

    if (e.key === "w" || e.key === "W") {
      callbacks.onWireMode();
      callbacks.requestRender(true);
      return;
    }

    // --- Selection-required shortcuts ---
    const hasSelection =
      orchestrator.selectedComponents.length > 0 ||
      orchestrator.selectedComponent !== null ||
      orchestrator.selectedWire !== null;

    if (!hasSelection) return;

    if (e.key === "r" || e.key === "R") {
      orchestrator.rotateSelectedComponent();
      if (orchestrator.selectedComponents.length > 0) {
        callbacks.log(
          `Lote de ${orchestrator.selectedComponents.length} componentes rotado de forma colectiva.`,
          "system",
        );
      } else if (orchestrator.selectedComponent) {
        callbacks.log(
          `Componente [${orchestrator.selectedComponent.id}] rotado a ${orchestrator.selectedComponent.rotation}°`,
          "system",
        );
      }
      callbacks.requestRender(true);
      callbacks.onCanvasModified();
    } else if (e.key === "Delete" || e.key === "Backspace") {
      if (orchestrator.selectedWire) {
        callbacks.log(`Cable [${orchestrator.selectedWire.id}] eliminado de forma individual.`, "system");
      } else if (orchestrator.selectedComponents.length > 0) {
        callbacks.log(
          `Lote de ${orchestrator.selectedComponents.length} componentes eliminado del lienzo.`,
          "system",
        );
      } else if (orchestrator.selectedComponent) {
        callbacks.log(`Componente [${orchestrator.selectedComponent.id}] eliminado del lienzo.`, "system");
      }
      orchestrator.removeSelected();
      callbacks.onNetlistSync();
      callbacks.requestRender(true);
      callbacks.onCanvasModified();
    }
  };

  const onContextMenu = (e: MouseEvent) => {
    e.preventDefault();

    const existingMenu = document.getElementById("canvas-context-menu");
    if (existingMenu) existingMenu.remove();

    const rect = canvas.getBoundingClientRect();
    const screenX = e.clientX - rect.left;
    const screenY = e.clientY - rect.top;
    const worldPt = orchestrator.screenToWorld(screenX, screenY);

    const clickedComp = orchestrator.components.find(comp => hitTestComponentAt(comp, worldPt.x, worldPt.y));

    const menu = document.createElement("div");
    menu.id = "canvas-context-menu";
    menu.className = "canvas-context-menu";

    const container = canvas.parentElement || document.body;
    const containerRect = container.getBoundingClientRect();
    menu.style.position = "absolute";
    menu.style.left = `${e.clientX - containerRect.left + container.scrollLeft}px`;
    menu.style.top = `${e.clientY - containerRect.top + container.scrollTop}px`;

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
      const isSelected = clickedComp.selected || 
                         orchestrator.selectedComponent?.id === clickedComp.id ||
                         orchestrator.selectedComponents.some(c => c.id === clickedComp.id);
      if (!isSelected) {
        orchestrator.selectedComponent = clickedComp;
        orchestrator.selectedComponents = [];
        callbacks.onSelectionChanged(clickedComp);
        callbacks.requestRender(true);
      }

      menu.appendChild(createMenuItem("Rotar 90°", "R", () => {
        orchestrator.rotateSelectedComponent();
        callbacks.requestRender(true);
        callbacks.onCanvasModified();
      }));

      menu.appendChild(createMenuItem("Rotar 15°", "Shift+Rueda", () => {
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

      const divider = document.createElement("div");
      divider.className = "context-menu-divider";
      menu.appendChild(divider);

      menu.appendChild(createMenuItem("Eliminar", "Supr", () => {
        orchestrator.removeSelected();
        callbacks.requestRender(true);
        callbacks.onCanvasModified();
        callbacks.onNetlistSync();
      }));
    } else {
      menu.appendChild(createMenuItem("Centrar Vista", "F", () => {
        orchestrator.resetCameraToCircuit();
      }));

      menu.appendChild(createMenuItem("Seleccionar Todo", "Ctrl+A", () => {
        callbacks.onSelectAll();
        callbacks.requestRender(true);
      }));

      if (orchestrator.selectedComponent || orchestrator.selectedComponents.length > 0) {
        menu.appendChild(createMenuItem("Limpiar Selección", "", () => {
          orchestrator.selectedComponent = null;
          orchestrator.selectedComponents = [];
          callbacks.onSelectionChanged(null);
          callbacks.requestRender(true);
        }));
      }

      const divider = document.createElement("div");
      divider.className = "context-menu-divider";
      menu.appendChild(divider);

      menu.appendChild(createMenuItem("Restablecer Layout", "Ctrl+0", () => {
        const event = new KeyboardEvent("keydown", { key: "0", ctrlKey: true });
        document.dispatchEvent(event);
      }));
    }

    container.appendChild(menu);
  };

  canvas.addEventListener("mousedown", onMouseDown);
  canvas.addEventListener("mousemove", onMouseMove);
  canvas.addEventListener("mouseup", completeConnection);
  canvas.addEventListener("mouseleave", completeConnection);
  canvas.addEventListener("dblclick", onDblClick);
  canvas.addEventListener("wheel", onWheel, { passive: false });
  canvas.addEventListener("contextmenu", onContextMenu as any);
  window.addEventListener("keydown", onKeyDown);

  return () => {
    canvas.removeEventListener("mousedown", onMouseDown);
    canvas.removeEventListener("mousemove", onMouseMove);
    canvas.removeEventListener("mouseup", completeConnection);
    canvas.removeEventListener("mouseleave", completeConnection);
    canvas.removeEventListener("dblclick", onDblClick);
    canvas.removeEventListener("wheel", onWheel);
    canvas.removeEventListener("contextmenu", onContextMenu);
    window.removeEventListener("keydown", onKeyDown);
  };
}

export function attachCanvasDrop(
  canvasViewport: HTMLElement,
  canvas: HTMLCanvasElement,
  orchestrator: CanvasOrchestrator,
  callbacks: Pick<
    CanvasInputCallbacks,
    "requestRender" | "onNetlistSync" | "onCanvasModified" | "onComponentPlaced" | "log"
  >,
): () => void {
  const onDragOver = (e: DragEvent) => e.preventDefault();

  const onDrop = (e: DragEvent) => {
    e.preventDefault();
    try {
      const rawData = e.dataTransfer?.getData("text/plain");
      if (!rawData) return;
      const { type, value } = JSON.parse(rawData) as { type: ComponentInstance["type"]; value: number };

      const rect = canvas.getBoundingClientRect();
      const screenX = e.clientX - rect.left;
      const screenY = e.clientY - rect.top;
      const worldPt = orchestrator.screenToWorld(screenX, screenY);
      const snapped = orchestrator.snapPointToGrid(worldPt);
      const newComp = orchestrator.addComponent(type, snapped.x, snapped.y, value);
      callbacks.onNetlistSync();
      callbacks.log(`Componente colocado: [${newComp.id}] en (X:${newComp.x}, Y:${newComp.y})`, "system");
      orchestrator.selectedComponent = newComp;
      callbacks.onComponentPlaced(newComp);
      callbacks.requestRender(true);
      callbacks.onCanvasModified();
    } catch {
      callbacks.log("Error al colocar componente.", "error");
    }
  };

  canvasViewport.addEventListener("dragover", onDragOver);
  canvasViewport.addEventListener("drop", onDrop);

  return () => {
    canvasViewport.removeEventListener("dragover", onDragOver);
    canvasViewport.removeEventListener("drop", onDrop);
  };
}
