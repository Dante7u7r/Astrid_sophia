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
  resolveTouchPanStep,
  resolveTouchPinchStep,
  resolveWheelZoomStep,
  shouldStartPaletteDrag,
} from "./canvas_input_model";
import { showCanvasContextMenu } from "./canvas_context_menu";
import { ComponentSpotlightModal } from "../ui/component_spotlight_modal";
import { getArmedStampTool, armStampTool } from "../ui/component_palette_controller";

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
  onSubcircuitDoubleClick?: (comp: ComponentInstance) => Promise<void> | void;
  onHideMcuDebug: () => void;
  onComponentPlaced: (comp: ComponentInstance) => void;
  onUndo: () => void;
  onRedo: () => void;
  onSelectAll: () => void;
  onFitAll: () => void;
  onEscape: () => void;
  onWireMode: () => void;
}

function resolveNodeAtWorldPoint(
  worldPt: { x: number; y: number },
  orchestrator: CanvasOrchestrator,
  callbacks: { getPinNode?: (pinKey: string) => string | undefined },
): string | undefined {
  if (orchestrator.hoveredPin) {
    const pinKey = `${orchestrator.hoveredPin.componentId}:${orchestrator.hoveredPin.pinIndex}`;
    const node = callbacks.getPinNode?.(pinKey);
    if (node !== undefined) return node;
  }
  if (orchestrator.hoveredWire) {
    const pinKey = `${orchestrator.hoveredWire.from.componentId}:${orchestrator.hoveredWire.from.pinIndex}`;
    const node = callbacks.getPinNode?.(pinKey);
    if (node !== undefined) return node;
  }

  // 1. Búsqueda por proximidad en pines de componentes (35px de tolerancia)
  let closestPinKey: string | null = null;
  let minPinDist = 35;
  for (const comp of orchestrator.components) {
    const pins = orchestrator.getComponentPins(comp);
    for (const pin of pins) {
      const d = Math.hypot(pin.x - worldPt.x, pin.y - worldPt.y);
      if (d < minPinDist) {
        minPinDist = d;
        closestPinKey = `${comp.id}:${pin.pinIndex}`;
      }
    }
  }
  if (closestPinKey) {
    const node = callbacks.getPinNode?.(closestPinKey);
    if (node !== undefined) return node;
  }

  // 2. Búsqueda por proximidad en cables del circuito (25px de tolerancia)
  for (const wire of orchestrator.wires) {
    const fromKey = `${wire.from.componentId}:${wire.from.pinIndex}`;
    for (let i = 0; i < wire.points.length - 1; i++) {
      const p1 = wire.points[i];
      const p2 = wire.points[i + 1];
      const l2 = (p1.x - p2.x) ** 2 + (p1.y - p2.y) ** 2;
      let t = l2 === 0 ? 0 : ((worldPt.x - p1.x) * (p2.x - p1.x) + (worldPt.y - p1.y) * (p2.y - p1.y)) / l2;
      t = Math.max(0, Math.min(1, t));
      const projX = p1.x + t * (p2.x - p1.x);
      const projY = p1.y + t * (p2.y - p1.y);
      if (Math.hypot(worldPt.x - projX, worldPt.y - projY) <= 25) {
        const node = callbacks.getPinNode?.(fromKey);
        if (node !== undefined) return node;
      }
    }
  }

  return undefined;
}

export function attachCanvasInput(
  canvas: HTMLCanvasElement,
  orchestrator: CanvasOrchestrator,
  callbacks: CanvasInputCallbacks,
): () => void {
  let isRightClickPanning = false;
  let rightClickDragDistance = 0;
  let isSpacePressed = false;
  let lastMousePos = { x: 0, y: 0 };
  let draggingCanvasProbe: "CH1" | "CH2" | "CH3" | "CH4" | null = null;
  let lastMouseWorldPt: { x: number; y: number } | null = null;
  let isMouseOverCanvas = false;

  const onMouseDown = (e: MouseEvent) => {
    const rect = canvas.getBoundingClientRect();
    const { screenX, screenY } = clientToCanvasPoint(rect, e);
    const worldPt = orchestrator.screenToWorld(screenX, screenY);

    if (isSpacePressed || e.button === 1 || e.button === 2) {
      isRightClickPanning = true;
      rightClickDragDistance = 0;
      lastMousePos = { x: e.clientX, y: e.clientY };
      if (isSpacePressed) canvas.style.cursor = "grabbing";
      e.preventDefault();
      callbacks.requestRender(true);
      return;
    }

    if (e.button === 0) {
      orchestrator.checkHover(worldPt.x, worldPt.y);

      const armed = getArmedStampTool();
      if (armed) {
        const snapped = orchestrator.snapPointToGrid(worldPt);
        const newComp = orchestrator.addComponent(armed.type as ComponentInstance["type"], snapped.x, snapped.y, armed.value);
        if (armed.modelName) newComp.modelName = armed.modelName;
        if (armed.pinCount) newComp.pinCount = armed.pinCount;
        if (armed.pinLabels) newComp.pinLabels = armed.pinLabels;
        if (armed.spiceNetlist) newComp.spiceNetlist = armed.spiceNetlist;
        callbacks.onNetlistSync();

        const isContinuous = armed.continuous || e.shiftKey;
        if (isContinuous) {
          callbacks.log(
            `Componente colocado: [${newComp.id}] (${armed.name}). Modo continuo activo (Esc o clic derecho para salir).`,
            "system",
          );
        } else {
          callbacks.log(
            `Componente colocado: [${newComp.id}] (${armed.name}).`,
            "system",
          );
          armStampTool(null);
          canvas.style.cursor = "";
        }

        orchestrator.selectedComponent = newComp;
        callbacks.onComponentPlaced(newComp);
        callbacks.requestRender(true);
        callbacks.onCanvasModified();
        return;
      }

      const probeMode = callbacks.getProbePlacementMode();
      if (probeMode) {
        const targetNode = resolveNodeAtWorldPoint(worldPt, orchestrator, callbacks);
        if (targetNode !== undefined) {
          callbacks.onProbePlaced(probeMode, targetNode);
        }
        callbacks.clearProbePlacementMode();
        callbacks.requestRender(true);
        return;
      }

      // Arrastre directo de la insignia de sonda sobre el lienzo
      const hitProbe = orchestrator.hitTestProbe?.(worldPt.x, worldPt.y) ?? null;
      if (hitProbe) {
        draggingCanvasProbe = hitProbe;
        canvas.style.cursor = "grabbing";
        callbacks.log(`Moviendo sonda ${hitProbe}. Arrástrala y suéltala sobre cualquier terminal o cable.`, "system");
        e.preventDefault();
        return;
      }

      if (callbacks.getActiveAnalysisMode() === "SPAR" && orchestrator.hoveredPin) {
        const pinKey = `${orchestrator.hoveredPin.componentId}:${orchestrator.hoveredPin.pinIndex}`;
        const nodeId = callbacks.getPinNode?.(pinKey);
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
      } else if (orchestrator.hoveredWireHandle) {
        // Un clic sobre un segmento debe seleccionarlo aunque el mismo punto también
        // pueda iniciar su arrastre. Sin esta selección, un clic sin movimiento dejaba
        // a Delete/propiedades sin objetivo.
        orchestrator.selectComponentAt(worldPt.x, worldPt.y, e.shiftKey);
        callbacks.onSelectionChanged(null);
        orchestrator.startDraggingWireHandle(orchestrator.hoveredWireHandle, worldPt);
      } else {
        const isShift = e.shiftKey;
        const comp = orchestrator.selectComponentAt(worldPt.x, worldPt.y, isShift);

        if (comp) {
          orchestrator.startDraggingSelected(worldPt.x, worldPt.y);
          callbacks.onSelectionChanged(comp);
        } else if (!isShift && !orchestrator.hoveredWire) {
          orchestrator.selectionStart = { x: worldPt.x, y: worldPt.y };
          orchestrator.selectionEnd = { x: worldPt.x, y: worldPt.y };
          callbacks.onHideMcuDebug();
          callbacks.onSelectionChanged(null);
        } else if (orchestrator.selectedWire) {
          callbacks.onSelectionChanged(null);
          callbacks.log(
            `Cable seleccionado: [${orchestrator.selectedWire.id}]. Edita sus propiedades en el panel lateral o presiona Delete para borrarlo.`,
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
    lastMouseWorldPt = { x: worldPt.x, y: worldPt.y };
    isMouseOverCanvas = true;

    if (draggingCanvasProbe) {
      orchestrator.checkHover(worldPt.x, worldPt.y);
      canvas.style.cursor = "grabbing";
      callbacks.requestRender();
      return;
    }

    orchestrator.checkHover(worldPt.x, worldPt.y);

    if (getArmedStampTool()) {
      canvas.style.cursor = "crosshair";
    } else if (!orchestrator.isDragging && !orchestrator.activePinForWire && !orchestrator.isDraggingWireHandle && !orchestrator.selectionStart) {
      const hoveredProbe = orchestrator.hitTestProbe?.(worldPt.x, worldPt.y) ?? null;
      if (hoveredProbe) {
        canvas.style.cursor = "grab";
      }
    }

    if (orchestrator.isDraggingWireHandle) {
      orchestrator.handleWireHandleDragging(worldPt);
    }

    if (orchestrator.isDragging) {
      orchestrator.handleDragging(worldPt.x, worldPt.y);
    }

    if (orchestrator.selectionStart) {
      orchestrator.selectionEnd = { x: worldPt.x, y: worldPt.y };
    }

    if (orchestrator.activePinForWire) {
      if (orchestrator.hoveredPin) {
        orchestrator.tempWireEnd = { x: orchestrator.hoveredPin.x, y: orchestrator.hoveredPin.y };
      } else if (orchestrator.hoveredWireSnapPoint) {
        orchestrator.tempWireEnd = orchestrator.hoveredWireSnapPoint.snapPoint;
      } else {
        orchestrator.tempWireEnd = orchestrator.snapPointToGrid(worldPt);
      }
      orchestrator.updateRealtimeErc();
    }

    if (isRightClickPanning) {
      const dx = e.clientX - lastMousePos.x;
      const dy = e.clientY - lastMousePos.y;
      rightClickDragDistance += Math.hypot(dx, dy);
      orchestrator.pan(dx, dy);
      lastMousePos = { x: e.clientX, y: e.clientY };
    }

    callbacks.requestRender();
  };

  const completeConnection = (e: MouseEvent) => {
    const rect = canvas.getBoundingClientRect();
    const { screenX, screenY } = clientToCanvasPoint(rect, e);
    const worldPt = orchestrator.screenToWorld(screenX, screenY);

    if (draggingCanvasProbe) {
      const targetNode = resolveNodeAtWorldPoint(worldPt, orchestrator, callbacks);
      if (targetNode !== undefined) {
        callbacks.onProbePlaced(draggingCanvasProbe, targetNode);
        callbacks.log(`Sonda ${draggingCanvasProbe} conectada al Nodo ${targetNode}.`, "system");
      } else {
        callbacks.log(`No se soltó la sonda ${draggingCanvasProbe} sobre un terminal o cable válido.`, "system");
      }
      draggingCanvasProbe = null;
      canvas.style.cursor = "";
      callbacks.requestRender(true);
      return;
    }

    if (orchestrator.isDraggingWireHandle) {
      const wireChanged = orchestrator.stopWireHandleDragging();
      if (wireChanged) {
        callbacks.onCanvasModified();
      }
    }

    if (orchestrator.activePinForWire) {
      let targetPin = orchestrator.hoveredPin;
      if (!targetPin) {
        const threshold = orchestrator.getPinHitThreshold();
        const hit = orchestrator.hitTestPin(worldPt.x, worldPt.y, threshold);
        if (hit && (hit.pin.componentId !== orchestrator.activePinForWire.componentId || hit.pin.pinIndex !== orchestrator.activePinForWire.pinIndex)) {
          targetPin = hit.pin;
        }
      }

      if (targetPin) {
        const from = orchestrator.activePinForWire;
        const to = targetPin;
        orchestrator.connectPins(from, to);
        callbacks.log(
          `Cable conectado: [${from.componentId}] terminal ${from.pinIndex} a [${to.componentId}] terminal ${to.pinIndex}`,
          "system",
        );
        callbacks.onWireConnected();
        callbacks.onCanvasModified();
      } else if (orchestrator.hoveredWireSnapPoint) {
        const from = orchestrator.activePinForWire;
        const { wire: targetWire, snapPoint } = orchestrator.hoveredWireSnapPoint;
        const success = orchestrator.connectPinToWire(from, targetWire, snapPoint);
        if (success) {
          callbacks.log(
            `Empalme en T creado: [${from.componentId}] terminal ${from.pinIndex} conectado a cable existente en (${Math.round(snapPoint.x)}, ${Math.round(snapPoint.y)})`,
            "system",
          );
          callbacks.onWireConnected();
          callbacks.onCanvasModified();
        }
      }
      orchestrator.activePinForWire = null;
      orchestrator.tempWireEnd = null;
    }

    if (orchestrator.selectionStart) {
      orchestrator.completeBoxSelection();
      if (orchestrator.selectedComponents.length > 0 || orchestrator.selectedWires.length > 0) {
        callbacks.log(
          `Selección en lote: ${orchestrator.selectedComponents.length} componentes y ${orchestrator.selectedWires.length} cables seleccionados.`,
          "system",
        );
      }
    }

    if (orchestrator.isDragging) {
      if (typeof orchestrator.hasSelectedMovedDuringDrag === "function" ? orchestrator.hasSelectedMovedDuringDrag() : true) {
        callbacks.onCanvasModified();
      }
    }

    orchestrator.stopDragging();
    callbacks.onNetlistSync();
    isRightClickPanning = false;
    if (isSpacePressed) {
      canvas.style.cursor = "grab";
    } else {
      canvas.style.cursor = "";
    }
    callbacks.requestRender(true);
  };

  const onDblClick = async (e: MouseEvent) => {
    const rect = canvas.getBoundingClientRect();
    const { screenX, screenY } = clientToCanvasPoint(rect, e);
    const worldPt = orchestrator.screenToWorld(screenX, screenY);
    const comp = orchestrator.selectComponentAt(worldPt.x, worldPt.y);

    if (
      comp?.type === "switch" ||
      comp?.type === "switch_spdt" ||
      comp?.type === "switch_dpdt" ||
      comp?.type === "pushbutton"
    ) {
      await callbacks.onSwitchDoubleClick(comp);
      callbacks.requestRender(true);
      callbacks.onCanvasModified();
    } else if (comp?.type === "x" || comp?.subcircuitTabId || comp?.subcircuitName) {
      await callbacks.onSubcircuitDoubleClick?.(comp);
      callbacks.requestRender(true);
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

    // 2. Shift + Scroll (Pan horizontal si se mantiene Shift)
    if (e.shiftKey) {
      const delta = e.deltaY !== 0 ? e.deltaY : e.deltaX;
      orchestrator.pan(-delta, 0);
      callbacks.requestRender();
      e.preventDefault();
      return;
    }

    // 3. Zoom natural con la rueda del ratón o gesto Pinch en touchpad (centrado en la posición del puntero)
    const rect = canvas.getBoundingClientRect();
    const { screenX, screenY } = clientToCanvasPoint(rect, e);
    const isPinch = e.ctrlKey || e.metaKey;
    const { zoomFactor } = resolveWheelZoomStep(
      e.deltaY,
      orchestrator.zoom,
      {
        minZoom: orchestrator.minZoom,
        maxZoom: orchestrator.maxZoom,
      },
      isPinch,
    );

    if (Math.abs(zoomFactor - 1) > 0.0001) {
      orchestrator.zoomAt(zoomFactor, screenX, screenY);
      callbacks.requestRender();
    }
    e.preventDefault();
  };

  let touchStartDistance = 0;
  let touchStartMidpoint = { x: 0, y: 0 };
  let isMultiTouch = false;

  const onTouchStart = (e: TouchEvent) => {
    if (e.touches.length === 2) {
      isMultiTouch = true;
      const t1 = e.touches[0];
      const t2 = e.touches[1];
      touchStartDistance = Math.hypot(t2.clientX - t1.clientX, t2.clientY - t1.clientY);
      touchStartMidpoint = {
        x: (t1.clientX + t2.clientX) / 2,
        y: (t1.clientY + t2.clientY) / 2,
      };
      e.preventDefault();
    } else if (e.touches.length === 1) {
      isMultiTouch = false;
      const t = e.touches[0];
      onMouseDown(
        new MouseEvent("mousedown", {
          clientX: t.clientX,
          clientY: t.clientY,
          button: 0,
        }),
      );
    }
  };

  const onTouchMove = (e: TouchEvent) => {
    if (e.touches.length === 2 && isMultiTouch) {
      const t1 = e.touches[0];
      const t2 = e.touches[1];
      const currDist = Math.hypot(t2.clientX - t1.clientX, t2.clientY - t1.clientY);
      const currMid = {
        x: (t1.clientX + t2.clientX) / 2,
        y: (t1.clientY + t2.clientY) / 2,
      };

      const rect = canvas.getBoundingClientRect();
      const { screenX, screenY } = clientToCanvasPoint(rect, { clientX: currMid.x, clientY: currMid.y });
      const { zoomFactor } = resolveTouchPinchStep(
        touchStartDistance,
        currDist,
        orchestrator.zoom,
        { minZoom: orchestrator.minZoom, maxZoom: orchestrator.maxZoom },
      );
      if (Math.abs(zoomFactor - 1.0) > 0.001) {
        orchestrator.zoomAt(zoomFactor, screenX, screenY);
      }

      const panStep = resolveTouchPanStep(touchStartMidpoint, currMid);
      orchestrator.pan(panStep.x, panStep.y);

      touchStartDistance = currDist;
      touchStartMidpoint = currMid;
      callbacks.requestRender();
      e.preventDefault();
    } else if (e.touches.length === 1 && !isMultiTouch) {
      const t = e.touches[0];
      onMouseMove(
        new MouseEvent("mousemove", {
          clientX: t.clientX,
          clientY: t.clientY,
        }),
      );
      e.preventDefault();
    }
  };

  const onTouchEnd = (e: TouchEvent) => {
    if (isMultiTouch && e.touches.length < 2) {
      isMultiTouch = false;
      touchStartDistance = 0;
    } else if (!isMultiTouch) {
      completeConnection(new MouseEvent("mouseup", {}));
    }
    callbacks.requestRender(true);
  };

  const onKeyDown = (e: KeyboardEvent) => {
    if (isTypingInFormField()) return;

    const ctrl = e.ctrlKey || e.metaKey;
    const key = e.key.toLowerCase();

    // --- Global shortcuts (no selection required) ---
    if ((e.code === "Space" || e.key === " ") && !isSpacePressed) {
      isSpacePressed = true;
      if (!isRightClickPanning) {
        canvas.style.cursor = "grab";
      }
      e.preventDefault();
      return;
    }

    if (ctrl && key === "z" && !e.shiftKey) {
      e.preventDefault();
      callbacks.onUndo();
      callbacks.requestRender(true);
      return;
    }

    if ((ctrl && e.shiftKey && key === "z") || (ctrl && key === "y")) {
      e.preventDefault();
      callbacks.onRedo();
      callbacks.requestRender(true);
      return;
    }

    if (ctrl && key === "c") {
      e.preventDefault();
      const count = orchestrator.copySelected();
      if (count > 0) {
        callbacks.log(
          count === 1
            ? "Componente copiado al portapapeles."
            : `Lote de ${count} elementos copiado al portapapeles.`,
          "system",
        );
      }
      return;
    }

    if (ctrl && key === "x") {
      e.preventDefault();
      const count = orchestrator.cutSelected();
      if (count > 0) {
        callbacks.onSelectionChanged(null);
        callbacks.onNetlistSync();
        callbacks.requestRender(true);
        callbacks.onCanvasModified();
        callbacks.log(
          count === 1
            ? "Componente cortado al portapapeles."
            : `Lote de ${count} elementos cortado al portapapeles.`,
          "system",
        );
      }
      return;
    }

    if (ctrl && key === "v") {
      e.preventDefault();
      const targetPt = isMouseOverCanvas && lastMouseWorldPt ? lastMouseWorldPt : undefined;
      const pasted = orchestrator.paste(targetPt);
      if (pasted && pasted.components.length > 0) {
        callbacks.onNetlistSync();
        callbacks.onSelectionChanged(
          pasted.components.length === 1 ? pasted.components[0] : null,
        );
        callbacks.requestRender(true);
        callbacks.onCanvasModified();
        callbacks.log(
          pasted.components.length === 1
            ? `Componente [${pasted.components[0].id}] pegado en el lienzo.`
            : `Lote de ${pasted.components.length} componentes pegado en el lienzo.`,
          "system",
        );
      }
      return;
    }

    if (ctrl && key === "a") {
      e.preventDefault();
      callbacks.onSelectAll();
      callbacks.requestRender(true);
      return;
    }

    if (ctrl && key === "k") {
      e.preventDefault();
      ComponentSpotlightModal.open((item) => {
        armStampTool({
          type: item.type,
          value: item.defaultVal,
          modelName: item.extraProps?.modelName,
          pinCount: item.extraProps?.pinCount,
          pinLabels: item.extraProps?.pinLabels,
          spiceNetlist: item.extraProps?.spiceNetlist,
          name: item.name,
        });
      });
      return;
    }

    if (e.key === "/" && !isTypingInFormField()) {
      e.preventDefault();
      ComponentSpotlightModal.open((item) => {
        armStampTool({
          type: item.type,
          value: item.defaultVal,
          modelName: item.extraProps?.modelName,
          pinCount: item.extraProps?.pinCount,
          pinLabels: item.extraProps?.pinLabels,
          spiceNetlist: item.extraProps?.spiceNetlist,
          name: item.name,
        });
      });
      return;
    }

    if (e.key === "Escape") {
      if (getArmedStampTool()) {
        e.preventDefault();
        armStampTool(null);
        callbacks.log("Herramienta de colocación cancelada.", "system");
        callbacks.requestRender(true);
        return;
      }
      callbacks.onEscape();
      callbacks.requestRender(true);
      return;
    }

    if (key === "m") {
      e.preventDefault();
      if (e.shiftKey) {
        orchestrator.mirrorSelectedComponentVertical();
      } else {
        orchestrator.mirrorSelectedComponent();
      }
      callbacks.requestRender(true);
      callbacks.onCanvasModified();
      callbacks.onNetlistSync();
      return;
    }

    if (ctrl && key === "d") {
      e.preventDefault();
      orchestrator.duplicateSelected();
      callbacks.requestRender(true);
      callbacks.onCanvasModified();
      callbacks.onNetlistSync();
      return;
    }

    if (key === "w") {
      callbacks.onWireMode();
      callbacks.requestRender(true);
      return;
    }

    if (e.key === "+" || e.key === "=" || e.key === "NumpadAdd") {
      e.preventDefault();
      orchestrator.zoomAt(1.15, canvas.clientWidth / 2, canvas.clientHeight / 2);
      callbacks.requestRender(true);
      return;
    }

    if (e.key === "-" || e.key === "_" || e.key === "NumpadSubtract") {
      e.preventDefault();
      orchestrator.zoomAt(0.85, canvas.clientWidth / 2, canvas.clientHeight / 2);
      callbacks.requestRender(true);
      return;
    }

    if (key === "f" || e.key === "0") {
      e.preventDefault();
      if (orchestrator.fitToScreen()) {
        callbacks.requestRender(true);
        callbacks.log("Esquema centrado y ajustado al lienzo.", "system");
      }
      return;
    }

    if (key === "l") {
      e.preventDefault();
      orchestrator.showWireLabels = !orchestrator.showWireLabels;
      const btnToggle = document.querySelector<HTMLButtonElement>("#btn-toggle-labels");
      if (btnToggle) {
        btnToggle.classList.toggle("btn-active", orchestrator.showWireLabels);
        btnToggle.setAttribute("aria-pressed", String(orchestrator.showWireLabels));
      }
      callbacks.requestRender(true);
      callbacks.log(
        orchestrator.showWireLabels ? "Etiquetas de cables visibles." : "Etiquetas de cables ocultas.",
        "system",
      );
      return;
    }

    // --- Selection-required shortcuts ---
    const hasSelection = hasCanvasSelection(orchestrator);

    // --- Teclas rápidas EDA de inserción directa cuando no hay selección activa ---
    if (!hasSelection && !ctrl && !e.altKey) {
      if (key === "r") {
        e.preventDefault();
        armStampTool({ type: "resistor", value: "1k", name: "Resistencia (1kΩ)" });
        callbacks.log("Herramienta rápida: Resistencia (1kΩ) armada.", "system");
        callbacks.requestRender(true);
        return;
      }
      if (key === "c") {
        e.preventDefault();
        armStampTool({ type: "capacitor", value: "1u", name: "Condensador (1µF)" });
        callbacks.log("Herramienta rápida: Condensador (1µF) armado.", "system");
        callbacks.requestRender(true);
        return;
      }
      if (key === "g") {
        e.preventDefault();
        armStampTool({ type: "ground", value: "0V", name: "Tierra (GND)" });
        callbacks.log("Herramienta rápida: Tierra (GND) armada.", "system");
        callbacks.requestRender(true);
        return;
      }
      if (key === "v") {
        e.preventDefault();
        armStampTool({ type: "vsource", value: "5V", name: "Fuente DC (5V)" });
        callbacks.log("Herramienta rápida: Fuente DC (5V) armada.", "system");
        callbacks.requestRender(true);
        return;
      }
      if (key === "d") {
        e.preventDefault();
        armStampTool({ type: "diode", value: "1N4148", name: "Diodo (1N4148)" });
        callbacks.log("Herramienta rápida: Diodo (1N4148) armado.", "system");
        callbacks.requestRender(true);
        return;
      }
    }

    if (!hasSelection) return;

    if (key === "r") {
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
      callbacks.onSelectionChanged(null);
      callbacks.onNetlistSync();
      callbacks.requestRender(true);
      callbacks.onCanvasModified();
    }
  };

  const onKeyUp = (e: KeyboardEvent) => {
    if (e.code === "Space" || e.key === " ") {
      isSpacePressed = false;
      if (!isRightClickPanning) {
        canvas.style.cursor = "";
      }
    }
  };

  const onWindowBlur = () => {
    isSpacePressed = false;
    isRightClickPanning = false;
    canvas.style.cursor = "";
  };

  const onContextMenu = (e: MouseEvent) => {
    if (rightClickDragDistance > 6) {
      e.preventDefault();
      rightClickDragDistance = 0;
      return;
    }

    if (getArmedStampTool()) {
      e.preventDefault();
      armStampTool(null);
      canvas.style.cursor = "";
      callbacks.log("Herramienta de colocación desactivada.", "system");
      callbacks.requestRender(true);
      return;
    }

    if (callbacks.getProbePlacementMode()) {
      e.preventDefault();
      callbacks.clearProbePlacementMode();
      callbacks.log("Colocación de sonda cancelada.", "system");
      callbacks.requestRender(true);
      return;
    }

    if (orchestrator.activePinForWire) {
      e.preventDefault();
      orchestrator.activePinForWire = null;
      orchestrator.tempWireEnd = null;
      callbacks.log("Trazado de cable cancelado.", "system");
      callbacks.requestRender(true);
      return;
    }

    showCanvasContextMenu(e, canvas, orchestrator, callbacks);
  };

  const onMouseEnter = () => {
    isMouseOverCanvas = true;
  };

  const onMouseLeave = (e: MouseEvent) => {
    isMouseOverCanvas = false;
    completeConnection(e);
  };

  canvas.addEventListener("mousedown", onMouseDown);
  canvas.addEventListener("mousemove", onMouseMove);
  canvas.addEventListener("mouseup", completeConnection);
  canvas.addEventListener("mouseenter", onMouseEnter);
  canvas.addEventListener("mouseleave", onMouseLeave);
  canvas.addEventListener("dblclick", onDblClick);
  canvas.addEventListener("wheel", onWheel, { passive: false });
  canvas.addEventListener("contextmenu", onContextMenu);
  canvas.addEventListener("touchstart", onTouchStart, { passive: false });
  canvas.addEventListener("touchmove", onTouchMove, { passive: false });
  canvas.addEventListener("touchend", onTouchEnd);
  canvas.addEventListener("touchcancel", onTouchEnd);
  window.addEventListener("keydown", onKeyDown);
  window.addEventListener("keyup", onKeyUp);
  window.addEventListener("blur", onWindowBlur);

  return () => {
    canvas.removeEventListener("mousedown", onMouseDown);
    canvas.removeEventListener("mousemove", onMouseMove);
    canvas.removeEventListener("mouseup", completeConnection);
    canvas.removeEventListener("mouseenter", onMouseEnter);
    canvas.removeEventListener("mouseleave", onMouseLeave);
    canvas.removeEventListener("dblclick", onDblClick);
    canvas.removeEventListener("wheel", onWheel);
    canvas.removeEventListener("contextmenu", onContextMenu);
    canvas.removeEventListener("touchstart", onTouchStart);
    canvas.removeEventListener("touchmove", onTouchMove);
    canvas.removeEventListener("touchend", onTouchEnd);
    canvas.removeEventListener("touchcancel", onTouchEnd);
    window.removeEventListener("keydown", onKeyDown);
    window.removeEventListener("keyup", onKeyUp);
    window.removeEventListener("blur", onWindowBlur);
  };
}

export function attachCanvasDrop(
  canvasViewport: HTMLElement,
  canvas: HTMLCanvasElement,
  orchestrator: CanvasOrchestrator,
  callbacks: Pick<
    CanvasInputCallbacks,
    "requestRender" | "onNetlistSync" | "onCanvasModified" | "onComponentPlaced" | "log"
  > & {
    getPinNode?: (pinKey: string) => string | undefined;
    onProbePlaced?: (channel: "CH1" | "CH2" | "CH3" | "CH4", nodeId: string) => void;
  },
): () => void {
  const placeComponent = (
    type: ComponentInstance["type"],
    value: ComponentInstance["value"],
    clientX: number,
    clientY: number,
    extraProps?: {
      modelName?: string;
      pinCount?: number;
      pinLabels?: Record<number, string>;
      spiceNetlist?: string;
    },
  ): boolean => {
    try {
      const rect = canvas.getBoundingClientRect();
      const { screenX, screenY } = clientToCanvasPoint(rect, { clientX, clientY });
      const worldPt = orchestrator.screenToWorld(screenX, screenY);
      const snapped = orchestrator.snapPointToGrid(worldPt);
      const newComp = orchestrator.addComponent(type, snapped.x, snapped.y, value);
      if (extraProps) {
        if (extraProps.modelName) newComp.modelName = extraProps.modelName;
        if (extraProps.pinCount) newComp.pinCount = extraProps.pinCount;
        if (extraProps.pinLabels) newComp.pinLabels = extraProps.pinLabels;
        if (extraProps.spiceNetlist) newComp.spiceNetlist = extraProps.spiceNetlist;
      }
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
    if (e.dataTransfer) {
      e.dataTransfer.dropEffect = "copy";
      const rect = canvas.getBoundingClientRect();
      const { screenX, screenY } = clientToCanvasPoint(rect, e);
      const worldPt = orchestrator.screenToWorld(screenX, screenY);
      orchestrator.checkHover(worldPt.x, worldPt.y);
      callbacks.requestRender();
    }
  };

  const onDrop = (e: DragEvent) => {
    e.preventDefault();
    try {
      // 1. Detección robusta de arrastre de sonda del osciloscopio
      let probeChannel: string | undefined = e.dataTransfer?.getData("application/astryd-probe");
      const plainText = e.dataTransfer?.getData("text/plain") || "";
      if (!probeChannel || !["CH1", "CH2", "CH3", "CH4"].includes(probeChannel)) {
        if (plainText.startsWith("probe:")) {
          probeChannel = plainText.replace("probe:", "").trim().toUpperCase();
        } else if (["CH1", "CH2", "CH3", "CH4"].includes(plainText.trim().toUpperCase())) {
          probeChannel = plainText.trim().toUpperCase();
        }
      }

      if (probeChannel && ["CH1", "CH2", "CH3", "CH4"].includes(probeChannel)) {
        const rect = canvas.getBoundingClientRect();
        const { screenX, screenY } = clientToCanvasPoint(rect, e);
        const worldPt = orchestrator.screenToWorld(screenX, screenY);
        orchestrator.checkHover(worldPt.x, worldPt.y);

        let targetNode: string | undefined;
        if (orchestrator.hoveredPin) {
          const pinKey = `${orchestrator.hoveredPin.componentId}:${orchestrator.hoveredPin.pinIndex}`;
          targetNode = callbacks.getPinNode?.(pinKey);
        } else if (orchestrator.hoveredWire) {
          const pinKey = `${orchestrator.hoveredWire.from.componentId}:${orchestrator.hoveredWire.from.pinIndex}`;
          targetNode = callbacks.getPinNode?.(pinKey);
        }

        // Búsqueda por proximidad si el cursor no cayó exactamente a nivel de píxel sobre el pin
        if (targetNode === undefined) {
          let closestPinKey: string | null = null;
          let minDistance = 30; // 30px en coordenadas del mundo
          for (const comp of orchestrator.components) {
            const pins = orchestrator.getComponentPins(comp);
            for (const pin of pins) {
              const d = Math.hypot(pin.x - worldPt.x, pin.y - worldPt.y);
              if (d < minDistance) {
                minDistance = d;
                closestPinKey = `${comp.id}:${pin.pinIndex}`;
              }
            }
          }
          if (closestPinKey) {
            targetNode = callbacks.getPinNode?.(closestPinKey);
          }
        }

        // Búsqueda por proximidad en cables si aún no se resuelve
        if (targetNode === undefined) {
          for (const wire of orchestrator.wires) {
            const fromKey = `${wire.from.componentId}:${wire.from.pinIndex}`;
            for (let i = 0; i < wire.points.length - 1; i++) {
              const p1 = wire.points[i];
              const p2 = wire.points[i + 1];
              const l2 = (p1.x - p2.x) ** 2 + (p1.y - p2.y) ** 2;
              let t = l2 === 0 ? 0 : ((worldPt.x - p1.x) * (p2.x - p1.x) + (worldPt.y - p1.y) * (p2.y - p1.y)) / l2;
              t = Math.max(0, Math.min(1, t));
              const projX = p1.x + t * (p2.x - p1.x);
              const projY = p1.y + t * (p2.y - p1.y);
              if (Math.hypot(worldPt.x - projX, worldPt.y - projY) <= 20) {
                targetNode = callbacks.getPinNode?.(fromKey);
                break;
              }
            }
            if (targetNode !== undefined) break;
          }
        }

        if (targetNode !== undefined) {
          callbacks.onProbePlaced?.(probeChannel as "CH1" | "CH2" | "CH3" | "CH4", targetNode);
          callbacks.requestRender(true);
        } else {
          callbacks.log(`Suelta la sonda ${probeChannel} sobre un terminal o cable del circuito.`, "system");
        }
        return;
      }

      // 2. Colocación de componentes estándar desde la paleta
      const rawData = plainText;
      if (!rawData) return;
      const { type, value } = JSON.parse(rawData) as {
        type: ComponentInstance["type"];
        value: ComponentInstance["value"];
      };
      placeComponent(type, value, e.clientX, e.clientY);
    } catch {
      callbacks.log("Error al procesar elemento soltado en el lienzo.", "error");
    }
  };

  const onDragEnter = (e: DragEvent) => {
    e.preventDefault();
  };

  canvasViewport.addEventListener("dragover", onDragOver);
  canvasViewport.addEventListener("drop", onDrop);
  canvasViewport.addEventListener("dragenter", onDragEnter);

  const paletteCleanups: Array<() => void> = [];
  let pointerId: number | null = null;
  let startX = 0;
  let startY = 0;
  let dragging = false;
  let ghost: HTMLElement | null = null;
  let activeDragCard: HTMLElement | null = null;

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
    if (!activeDragCard) return;
    dragging = true;
    activeDragCard.classList.add("palette-drag-source");
    document.body.classList.add("palette-drag-active");
    ghost = activeDragCard.cloneNode(true) as HTMLElement;
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
    if (activeDragCard) {
      activeDragCard.classList.remove("palette-drag-source");
      activeDragCard = null;
    }
    document.body.classList.remove("palette-drag-active");
    canvasViewport.classList.remove("palette-drop-target");
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
    if (dragging && isInsideViewport(event.clientX, event.clientY) && activeDragCard) {
      const data = parsePaletteComponentData(activeDragCard.dataset);
      placeComponent(data.type, data.value, event.clientX, event.clientY, {
        modelName: data.modelName,
        pinCount: data.pinCount,
        pinLabels: data.pinLabels,
        spiceNetlist: data.spiceNetlist,
      });
    }
    resetDrag();
  };

  const onPointerCancel = (event: PointerEvent): void => {
    if (event.pointerId === pointerId) resetDrag();
  };

  const onDocumentPointerDown = (event: PointerEvent): void => {
    if (event.button !== 0 || pointerId !== null) return;
    const target = (event.target as HTMLElement).closest<HTMLElement>(".component-card, .palette-favorite-chip");
    if (!target) return;
    activeDragCard = target;
    pointerId = event.pointerId;
    startX = event.clientX;
    startY = event.clientY;
    document.addEventListener("pointermove", onPointerMove, { passive: false });
    document.addEventListener("pointerup", onPointerUp);
    document.addEventListener("pointercancel", onPointerCancel);
    window.addEventListener("blur", resetDrag, { once: true });
  };

  const onDocumentKeyDown = (event: KeyboardEvent): void => {
    if (event.key !== "Enter" && event.key !== " ") return;
    const target = (event.target as HTMLElement | null)?.closest<HTMLElement>(
      ".component-card, .palette-favorite-chip",
    );
    if (!target) return;

    event.preventDefault();
    const rect = canvasViewport.getBoundingClientRect();
    const data = parsePaletteComponentData(target.dataset);
    const placed = placeComponent(
      data.type,
      data.value,
      rect.left + rect.width / 2,
      rect.top + rect.height / 2,
      {
        modelName: data.modelName,
        pinCount: data.pinCount,
        pinLabels: data.pinLabels,
        spiceNetlist: data.spiceNetlist,
      },
    );
    if (placed) armStampTool(null);
  };

  document.addEventListener("pointerdown", onDocumentPointerDown);
  document.addEventListener("keydown", onDocumentKeyDown);
  paletteCleanups.push(() => {
    document.removeEventListener("pointerdown", onDocumentPointerDown);
    document.removeEventListener("keydown", onDocumentKeyDown);
    resetDrag();
  });

  // Vinculación de arrastre mediante Pointer Events para botones y pestañas del osciloscopio
  const probeButtons = [
    { id: "#osc-tab-ch1", getChannel: () => "CH1" as const },
    { id: "#osc-tab-ch2", getChannel: () => "CH2" as const },
    { id: "#osc-tab-ch3", getChannel: () => "CH3" as const },
    { id: "#osc-tab-ch4", getChannel: () => "CH4" as const },
    { id: "#osc-ch1-btn", getChannel: () => "CH1" as const },
    { id: "#osc-ch2-btn", getChannel: () => "CH2" as const },
    { id: "#osc-ch3-btn", getChannel: () => "CH3" as const },
    { id: "#osc-ch4-btn", getChannel: () => "CH4" as const },
    {
      id: "#osc-focused-pick-probe-btn",
      getChannel: () => {
        const activeTab = document.querySelector(".osc-channel-tab.active") as HTMLElement | null;
        const ch = activeTab?.dataset?.ch?.toUpperCase() || "CH1";
        return (["CH1", "CH2", "CH3", "CH4"].includes(ch) ? ch : "CH1") as "CH1" | "CH2" | "CH3" | "CH4";
      },
    },
  ];

  probeButtons.forEach(({ id, getChannel }) => {
    const el = document.querySelector<HTMLElement>(id);
    if (el) {
      const cleanup = attachProbePointerDrag(el, getChannel, canvasViewport, canvas, orchestrator, callbacks);
      paletteCleanups.push(cleanup);
    }
  });

  return () => {
    canvasViewport.removeEventListener("dragover", onDragOver);
    canvasViewport.removeEventListener("drop", onDrop);
    canvasViewport.removeEventListener("dragenter", onDragEnter);
    paletteCleanups.forEach((cleanup) => cleanup());
  };
}

function attachProbePointerDrag(
  element: HTMLElement,
  getChannel: () => "CH1" | "CH2" | "CH3" | "CH4",
  canvasViewport: HTMLElement,
  canvas: HTMLCanvasElement,
  orchestrator: CanvasOrchestrator,
  callbacks: {
    requestRender: (immediate?: boolean) => void;
    log: (text: string, type?: "system" | "error") => void;
    getPinNode?: (pinKey: string) => string | undefined;
    onProbePlaced?: (channel: "CH1" | "CH2" | "CH3" | "CH4", nodeId: string) => void;
  },
): () => void {
  let pointerId: number | null = null;
  let startX = 0;
  let startY = 0;
  let dragging = false;
  let ghost: HTMLElement | null = null;

  element.setAttribute("draggable", "false");
  element.style.userSelect = "none";
  element.style.touchAction = "none";

  const onDragStart = (e: DragEvent) => {
    e.preventDefault();
  };
  element.addEventListener("dragstart", onDragStart);

  const probeColors: Record<string, { color: string; bg: string }> = {
    CH1: { color: "#FACC15", bg: "rgba(250, 204, 21, 0.15)" },
    CH2: { color: "#38BDF8", bg: "rgba(56, 189, 248, 0.15)" },
    CH3: { color: "#F43F5E", bg: "rgba(244, 63, 94, 0.15)" },
    CH4: { color: "#34D399", bg: "rgba(52, 211, 153, 0.15)" },
  };

  const isInsideCanvas = (clientX: number, clientY: number): boolean => {
    const rect = canvasViewport.getBoundingClientRect();
    return isPointInsideRect(rect, { clientX, clientY });
  };

  const updateDragVisuals = (clientX: number, clientY: number): void => {
    if (ghost) {
      ghost.style.transform = `translate3d(${clientX + 10}px, ${clientY + 10}px, 0)`;
    }
    if (isInsideCanvas(clientX, clientY)) {
      const rect = canvas.getBoundingClientRect();
      const { screenX, screenY } = clientToCanvasPoint(rect, { clientX, clientY });
      const worldPt = orchestrator.screenToWorld(screenX, screenY);
      orchestrator.checkHover(worldPt.x, worldPt.y);
      callbacks.requestRender();
    }
  };

  const beginDrag = (clientX: number, clientY: number): void => {
    dragging = true;
    const ch = getChannel();
    const info = probeColors[ch] || { color: "#FACC15", bg: "rgba(250, 204, 21, 0.15)" };

    ghost = document.createElement("div");
    ghost.className = "probe-drag-ghost";
    ghost.textContent = `📍 ${ch}`;
    ghost.style.color = info.color;
    ghost.style.borderColor = info.color;
    ghost.style.transform = `translate3d(${clientX + 10}px, ${clientY + 10}px, 0)`;
    document.body.appendChild(ghost);
    document.body.style.cursor = "grabbing";
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
    document.body.style.cursor = "";
  };

  const onPointerDown = (event: PointerEvent): void => {
    if (event.button !== 0 || pointerId !== null) return;
    pointerId = event.pointerId;
    startX = event.clientX;
    startY = event.clientY;
    try {
      (event.currentTarget as HTMLElement)?.setPointerCapture?.(event.pointerId);
    } catch {
      // Ignorar fallo de captura en mocks
    }
    document.addEventListener("pointermove", onPointerMove, { passive: false });
    document.addEventListener("pointerup", onPointerUp);
    document.addEventListener("pointercancel", onPointerCancel);
    window.addEventListener("blur", resetDrag, { once: true });
  };

  const onPointerMove = (event: PointerEvent): void => {
    if (event.pointerId !== pointerId) return;
    if (!dragging && Math.hypot(event.clientX - startX, event.clientY - startY) > 5) {
      beginDrag(event.clientX, event.clientY);
    }
    if (dragging) {
      event.preventDefault();
      updateDragVisuals(event.clientX, event.clientY);
    }
  };

  const onPointerUp = (event: PointerEvent): void => {
    if (event.pointerId !== pointerId) return;
    if (dragging && isInsideCanvas(event.clientX, event.clientY)) {
      const ch = getChannel();
      const rect = canvas.getBoundingClientRect();
      const { screenX, screenY } = clientToCanvasPoint(rect, { clientX: event.clientX, clientY: event.clientY });
      const worldPt = orchestrator.screenToWorld(screenX, screenY);
      const targetNode = resolveNodeAtWorldPoint(worldPt, orchestrator, callbacks);
      if (targetNode !== undefined) {
        callbacks.onProbePlaced?.(ch, targetNode);
        callbacks.log(`Sonda ${ch} conectada al Nodo ${targetNode}.`, "system");
        callbacks.requestRender(true);
      } else {
        callbacks.log(`Suelta la sonda ${ch} sobre un terminal o cable del circuito.`, "system");
      }
    }
    resetDrag();
  };

  const onPointerCancel = (event: PointerEvent): void => {
    if (event.pointerId === pointerId) resetDrag();
  };

  element.addEventListener("pointerdown", onPointerDown);
  return () => {
    element.removeEventListener("dragstart", onDragStart);
    element.removeEventListener("pointerdown", onPointerDown);
    resetDrag();
  };
}
