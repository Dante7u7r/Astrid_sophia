import {
  CanvasOrchestrator,
  ComponentInstance,
} from "../canvas_orchestrator";
import { isTypingInFormField } from "./keyboard_guards";
import type { AnalysisMode } from "../ui/simulation_controls";
import {
  clientToCanvasPoint,
  hasCanvasSelection,
  isPointInsideRect,
  parsePaletteComponentData,
  resolveWheelZoomStep,
  shouldStartPaletteDrag,
} from "./canvas_input_model";
import { showCanvasContextMenu } from "./canvas_context_menu";

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
    const { screenX, screenY } = clientToCanvasPoint(rect, e);
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
    const { screenX, screenY } = clientToCanvasPoint(rect, e);
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
    const { screenX, screenY } = clientToCanvasPoint(rect, e);
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
    const { screenX, screenY } = clientToCanvasPoint(rect, e);
    const { zoomFactor } = resolveWheelZoomStep(e.deltaY, orchestrator.zoom, {
      minZoom: orchestrator.minZoom,
      maxZoom: orchestrator.maxZoom,
    });
    orchestrator.zoomAt(zoomFactor, screenX, screenY);
    
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
    const hasSelection = hasCanvasSelection(orchestrator);

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
    showCanvasContextMenu(e, canvas, orchestrator, callbacks);
  };
  canvas.addEventListener("mousedown", onMouseDown);
  canvas.addEventListener("mousemove", onMouseMove);
  canvas.addEventListener("mouseup", completeConnection);
  canvas.addEventListener("mouseleave", completeConnection);
  canvas.addEventListener("dblclick", onDblClick);
  canvas.addEventListener("wheel", onWheel, { passive: false });
  canvas.addEventListener("contextmenu", onContextMenu);
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
  const placeComponent = (
    type: ComponentInstance["type"],
    value: ComponentInstance["value"],
    clientX: number,
    clientY: number,
  ): boolean => {
    try {
      const rect = canvas.getBoundingClientRect();
      const { screenX, screenY } = clientToCanvasPoint(rect, { clientX, clientY });
      const worldPt = orchestrator.screenToWorld(screenX, screenY);
      const snapped = orchestrator.snapPointToGrid(worldPt);
      const newComp = orchestrator.addComponent(type, snapped.x, snapped.y, value);
      callbacks.onNetlistSync();
      callbacks.log(`Componente colocado: [${newComp.id}] en (X:${newComp.x}, Y:${newComp.y})`, "system");
      orchestrator.selectedComponent = newComp;
      callbacks.onComponentPlaced(newComp);
      callbacks.requestRender(true);
      callbacks.onCanvasModified();
      return true;
    } catch {
      callbacks.log("Error al colocar componente.", "error");
      return false;
    }
  };

  const onDragOver = (e: DragEvent) => {
    e.preventDefault();
    if (e.dataTransfer) e.dataTransfer.dropEffect = "copy";
  };

  const onDrop = (e: DragEvent) => {
    e.preventDefault();
    try {
      const rawData = e.dataTransfer?.getData("text/plain");
      if (!rawData) return;
      const { type, value } = JSON.parse(rawData) as {
        type: ComponentInstance["type"];
        value: ComponentInstance["value"];
      };
      placeComponent(type, value, e.clientX, e.clientY);
    } catch {
      callbacks.log("Error al colocar componente.", "error");
    }
  };

  canvasViewport.addEventListener("dragover", onDragOver);
  canvasViewport.addEventListener("drop", onDrop);

  const paletteCleanups: Array<() => void> = [];
  const toolboxCards = document.querySelectorAll<HTMLElement>(".component-card");

  toolboxCards.forEach((card) => {
    card.draggable = false;
    card.tabIndex = 0;
    card.setAttribute("role", "button");
    const componentName = card.querySelector(".comp-name")?.textContent?.trim() ?? "componente";
    card.setAttribute("aria-label", `Colocar ${componentName}`);

    let pointerId: number | null = null;
    let startX = 0;
    let startY = 0;
    let dragging = false;
    let ghost: HTMLElement | null = null;

    const getComponentData = (): {
      type: ComponentInstance["type"];
      value: ComponentInstance["value"];
    } => parsePaletteComponentData(card.dataset);

    const isInsideViewport = (clientX: number, clientY: number): boolean => {
      const rect = canvasViewport.getBoundingClientRect();
      return isPointInsideRect(rect, { clientX, clientY });
    };

    const updateDragVisuals = (clientX: number, clientY: number): void => {
      if (ghost) {
        ghost.style.transform = `translate3d(${clientX + 14}px, ${clientY + 14}px, 0)`;
      }
      canvasViewport.classList.toggle("palette-drop-target", isInsideViewport(clientX, clientY));
    };

    const beginVisualDrag = (clientX: number, clientY: number): void => {
      dragging = true;
      card.classList.add("palette-drag-source");
      document.body.classList.add("palette-drag-active");
      ghost = card.cloneNode(true) as HTMLElement;
      ghost.removeAttribute("id");
      ghost.removeAttribute("role");
      ghost.removeAttribute("tabindex");
      ghost.setAttribute("aria-hidden", "true");
      ghost.className = "component-drag-ghost";
      document.body.appendChild(ghost);
      updateDragVisuals(clientX, clientY);
    };

    const resetDrag = (): void => {
      document.removeEventListener("pointermove", onPointerMove);
      document.removeEventListener("pointerup", onPointerUp);
      document.removeEventListener("pointercancel", onPointerCancel);
      window.removeEventListener("blur", resetDrag);
      pointerId = null;
      dragging = false;
      ghost?.remove();
      ghost = null;
      card.classList.remove("palette-drag-source");
      document.body.classList.remove("palette-drag-active");
      canvasViewport.classList.remove("palette-drop-target");
    };

    const onPointerDown = (event: PointerEvent): void => {
      if (event.button !== 0 || pointerId !== null) return;
      pointerId = event.pointerId;
      startX = event.clientX;
      startY = event.clientY;
      document.addEventListener("pointermove", onPointerMove, { passive: false });
      document.addEventListener("pointerup", onPointerUp);
      document.addEventListener("pointercancel", onPointerCancel);
      window.addEventListener("blur", resetDrag, { once: true });
    };

    const onPointerMove = (event: PointerEvent): void => {
      if (event.pointerId !== pointerId) return;
      if (!dragging && shouldStartPaletteDrag(
        { x: startX, y: startY },
        { x: event.clientX, y: event.clientY },
      )) {
        beginVisualDrag(event.clientX, event.clientY);
      }
      if (!dragging) return;
      event.preventDefault();
      updateDragVisuals(event.clientX, event.clientY);
    };

    const onPointerUp = (event: PointerEvent): void => {
      if (event.pointerId !== pointerId) return;
      if (dragging && isInsideViewport(event.clientX, event.clientY)) {
        const { type, value } = getComponentData();
        placeComponent(type, value, event.clientX, event.clientY);
      }
      resetDrag();
    };

    const onPointerCancel = (event: PointerEvent): void => {
      if (event.pointerId === pointerId) resetDrag();
    };

    const onKeyDown = (event: KeyboardEvent): void => {
      if (event.key !== "Enter" && event.key !== " ") return;
      event.preventDefault();
      const rect = canvasViewport.getBoundingClientRect();
      const { type, value } = getComponentData();
      placeComponent(type, value, rect.left + rect.width / 2, rect.top + rect.height / 2);
    };

    card.addEventListener("pointerdown", onPointerDown);
    card.addEventListener("keydown", onKeyDown);

    paletteCleanups.push(() => {
      card.removeEventListener("pointerdown", onPointerDown);
      card.removeEventListener("keydown", onKeyDown);
      resetDrag();
    });
  });

  return () => {
    canvasViewport.removeEventListener("dragover", onDragOver);
    canvasViewport.removeEventListener("drop", onDrop);
    paletteCleanups.forEach((cleanup) => cleanup());
  };
}
