import { type McuRuntime } from "./simulation/mcu-runtime";
import { type McuSpiceBridge } from "./simulation/mcu-spice-bridge";
import { getComponentPins as resolveComponentPins } from "./canvas/component_pins";
import { CanvasSceneRenderer } from "./canvas/canvas_scene_renderer";
import {
  clampCameraOffsets,
  fitBoundsToViewport,
  generateOrthogonalPath,
  getCircuitBounds,
  getCircuitGeometricCenter,
  isVisible,
  screenToWorld,
  snapPointToGrid,
  snapToGrid,
  worldToScreen,
  zoomAt,
} from "./canvas/viewport_camera";
import {
  applyDrag,
  completeBoxSelection,
  createDragOffsets,
  selectComponentAt,
} from "./canvas/selection_model";
import {
  connectPins as connectWirePins,
  syncWireConnections as syncWireModelConnections,
} from "./canvas/wiring_model";
import {
  createComponent,
  duplicateSelection,
  mirrorSelection,
  removeComponentFromCircuit,
  removeSelection,
  renameComponentInCircuit,
  rotateSelection,
} from "./canvas/component_actions";
import {
  hitTestPin as hitTestPinInModel,
  resolveHoverState,
} from "./canvas/hover_model";
import {
  type ProbeBadges,
  type SParameterMarker,
} from "./canvas/render_overlays";

export {
  copyComponentConfiguration,
  findDuplicateComponentIds,
  generateUniqueComponentId,
  isValidComponentId,
  normalizeComponentId,
} from "./canvas/component_identity";
export {
  getComponentBounds,
  getComponentLocalHalfExtents,
  hitTestComponentAt,
} from "./canvas/component_geometry";
export { wireEndpointKey } from "./canvas/wire_identity";
export { getComponentPins } from "./canvas/component_pins";
export {
  boundsIntersect,
  fitBoundsToViewport,
  generateOrthogonalPath,
  getCircuitBounds,
  getCircuitGeometricCenter,
  getVisibleWorldBounds,
  isVisible,
  screenToWorld,
  snapPointToGrid,
  snapToGrid,
  worldToScreen,
  zoomAt,
} from "./canvas/viewport_camera";
export {
  applyDrag,
  completeBoxSelection,
  createDragOffsets,
  findTopComponentAt,
  selectComponentAt,
} from "./canvas/selection_model";
export {
  connectPins as connectWirePins,
  findHoveredWire,
  syncWireConnections as syncWireModelConnections,
  wirePathIntersects,
  wireExists,
} from "./canvas/wiring_model";
export {
  createComponent,
  duplicateSelection,
  mirrorSelection,
  removeComponentFromCircuit,
  removeSelection,
  renameComponentInCircuit,
  rotateSelection,
} from "./canvas/component_actions";
export {
  hitTestPin as hitTestPinInModel,
  resolveHoverState,
} from "./canvas/hover_model";
export {
  createComponentLookup,
  createGridRenderPlan,
  createSelectedComponentIds,
  ensureCanvasBuffer,
  getCanvasBufferSize,
  getVisibleComponents,
  resolveRenderDetail,
} from "./canvas/render_model";
export {
  drawProbeBadges,
  drawSelectionBox,
  drawSParameterMarkers,
  drawTemporaryWire,
} from "./canvas/render_overlays";

export interface Point2D {
  x: number;
  y: number;
}

export interface BoundingBox {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface ComponentInstance {
  id: string;
  type: 'resistor' | 'capacitor' | 'inductor' | 'diode' | 'vsource' | 'ground' | 'nmos' | 'opamp' | 'pmos' | 'npn' | 'pnp' | 'lamp' | 'relay' | 'buzzer' | 'mcu_8051' | 'mcu_avr' | 'arduino_uno' | 'esp32' | 'raspberry_pi_pico' | 'isource' | 'led' | 'transformer' | 'switch' | 'x' | 'potentiometer' | 'ldr' | 'thermistor' | 'dmm';
  value: number | string;
  dmmValue?: string;
  wiperPosition?: number; // Cursor del potenciómetro (0.01 - 0.99)
  lux?: number; // Iluminación en Luxes para LDR (1 - 10000)
  temperatureCelsius?: number; // Temperatura del termistor (-50 - 150 C)
  x: number;
  y: number;
  rotation: number; // 0, 90, 180, 270 degrees
  selected?: boolean;
  mirror?: boolean;
  waveType?: string;
  amplitude?: number;
  frequency?: number;
  offset?: number;
  offsetVoltage?: number;
  openLoopGain?: number;
  dutyCycle?: number;
  glowLevel?: number;
  relayClosed?: boolean;
  buzzerLevel?: number;
  
  // MCU properties
  firmwareHex?: string; // HEX content
  firmware?: Uint8Array; // compiled binary
  mcuClockSpeed?: number;
  mcuRuntime?: McuRuntime | null;
  mcuBridge?: McuSpiceBridge | null;
  mcuPinStates?: Record<number, number | string>; // logical states (0, 1, 'X', 'Z')
  
  // Transformer properties
  primaryInductance?: number;
  secondaryInductance?: number;
  couplingCoefficient?: number;
  
  // Switch properties
  switchRon?: number;
  switchRoff?: number;
  switchVth?: number;
  switchVh?: number;
  switchState?: boolean;

  // Macromodelo SPICE (subcircuito definido por el usuario)
  spiceMacro?: string;
  // Número dinámico de pines para subcircuito genérico (defecto 4)
  pinCount?: number;
}

export interface PinInstance {
  componentId: string;
  pinIndex: number;
  x: number; // World X
  y: number; // World Y
}

export interface WireEndpoint {
  componentId: string;
  pinIndex: number;
}

export interface WireInstance {
  id: string;
  from: WireEndpoint;
  to: WireEndpoint;
  points: Point2D[]; // Path points for rendering
}

export class CanvasOrchestrator {
  private canvas: HTMLCanvasElement;
  public simulationActive: boolean = false;
  private readonly sceneRenderer: CanvasSceneRenderer;

  // Viewport State
  public zoom: number = 1.0;
  public offsetX: number = 0;
  public offsetY: number = 0;

  // Constants
  public readonly minZoom: number = 0.3;
  public readonly maxZoom: number = 3.0;
  public gridSize: number = 20;

  // Components & Wires State
  public components: ComponentInstance[] = [];
  public wires: WireInstance[] = [];

  // Interaction State
  public hoveredComponent: ComponentInstance | null = null;
  public hoveredPin: PinInstance | null = null;
  public hoveredWire: WireInstance | null = null;
  
  public selectedComponent: ComponentInstance | null = null; // Mantenido para compatibilidad e indicador principal
  public selectedComponents: ComponentInstance[] = [];
  public selectedWire: WireInstance | null = null;
  
  public activePinForWire: PinInstance | null = null;
  public tempWireEnd: Point2D | null = null;
  public ercIssues: { componentId: string; type: "error" | "warning"; message: string; pinIndex?: number }[] = [];
  
  public isDragging: boolean = false;
  private dragStartOffset: Point2D = { x: 0, y: 0 };
  private dragStartOffsets: Record<string, Point2D> = {};

  // Caja de Selección CAD
  public selectionStart: Point2D | null = null;
  public selectionEnd: Point2D | null = null;

  constructor(canvas: HTMLCanvasElement) {
    this.canvas = canvas;
    const context = canvas.getContext("2d");
    if (!context) throw new Error("Could not acquire 2D rendering context");
    this.sceneRenderer = new CanvasSceneRenderer(canvas, context, this);
  }

  // --- COORDINATE TRANSLATIONS ---

  public screenToWorld(screenX: number, screenY: number): Point2D {
    return screenToWorld(screenX, screenY, this);
  }

  public worldToScreen(worldX: number, worldY: number): Point2D {
    return worldToScreen(worldX, worldY, this);
  }

  public snapToGrid(coord: number): number {
    return snapToGrid(coord, this.gridSize);
  }

  public snapPointToGrid(p: Point2D): Point2D {
    return snapPointToGrid(p, this.gridSize);
  }

  public screenToWorldSnapped(screenX: number, screenY: number): Point2D {
    return this.snapPointToGrid(this.screenToWorld(screenX, screenY));
  }

  public generateOrthogonalPath(start: Point2D, end: Point2D): Point2D[] {
    return generateOrthogonalPath(start, end, this.gridSize);
  }

  public getComponentPins(comp: ComponentInstance): PinInstance[] {
    return resolveComponentPins(comp);
  }
  public isVisible(box: BoundingBox): boolean {
    return isVisible(box, this, {
      width: this.canvas.clientWidth,
      height: this.canvas.clientHeight,
    });
  }

  // --- CAMERA OPERATIONS ---

  /** Calculates the geometric center of all components in world coordinates.
   * Defaults to (0, 0) if the circuit is empty. */
  public getCircuitGeometricCenter(): Point2D {
    return getCircuitGeometricCenter(this.components);
  }

  /** Keeps the circuit geometric center within the visible screen area. */
  public clampCameraOffsets(): void {
    const nextCamera = clampCameraOffsets(this, this.getCircuitGeometricCenter(), {
      width: this.canvas.clientWidth,
      height: this.canvas.clientHeight,
    });
    this.offsetX = nextCamera.offsetX;
    this.offsetY = nextCamera.offsetY;
  }

  public zoomAt(zoomFactor: number, screenTargetX: number, screenTargetY: number): void {
    const nextCamera = zoomAt(
      this,
      { minZoom: this.minZoom, maxZoom: this.maxZoom },
      { width: this.canvas.clientWidth, height: this.canvas.clientHeight },
      this.getCircuitGeometricCenter(),
      zoomFactor,
      { x: screenTargetX, y: screenTargetY },
    );
    this.zoom = nextCamera.zoom;
    this.offsetX = nextCamera.offsetX;
    this.offsetY = nextCamera.offsetY;
  }

  public pan(dx: number, dy: number): void {
    this.offsetX += dx;
    this.offsetY += dy;
    this.clampCameraOffsets();
  }

  // --- DRAWING / RENDERING ---

  public render(voltageMap: Record<string, number> = {}, probes: ProbeBadges = {}, nodeMap: Record<string, string> = {}, sparMarkers?: SParameterMarker[]): void {
    this.sceneRenderer.render(voltageMap, probes, nodeMap, sparMarkers);
  }

  /** Pin pick radius in world units; scales inversely with zoom for consistent screen feel. */
  public getPinHitThreshold(): number {
    return Math.max(6, 12 / this.zoom);
  }

  public hitTestPin(worldX: number, worldY: number, threshold?: number): { pin: PinInstance; comp: ComponentInstance } | null {
    const t = threshold ?? this.getPinHitThreshold();
    return hitTestPinInModel(
      this.components,
      (component) => this.getComponentPins(component),
      worldX,
      worldY,
      t,
    );
  }

  // --- ACTIONS & OPERATIONS ---

  public addComponent(
    type: ComponentInstance['type'],
    x: number,
    y: number,
    value: number | string,
  ): ComponentInstance {
    const newComp = createComponent(
      this.components,
      type,
      x,
      y,
      value,
      (coordinate) => this.snapToGrid(coordinate),
    );
    this.components.push(newComp);
    return newComp;
  }

  public renameComponent(component: ComponentInstance, requestedId: string): string | null {
    const error = renameComponentInCircuit(this.components, this.wires, component, requestedId);
    if (!error) this.syncWireConnections();
    return error;
  }

  public removeComponent(id: string): void {
    const result = removeComponentFromCircuit(
      this.components,
      this.wires,
      this.selectedComponents,
      id,
    );
    this.components = result.components;
    this.wires = result.wires;
    this.selectedComponents = result.selectedComponents;
  }

  public checkHover(worldX: number, worldY: number): void {
    const hover = resolveHoverState(
      this.components,
      this.wires,
      (component) => this.getComponentPins(component),
      worldX,
      worldY,
      {
        activePinForWire: this.activePinForWire,
        isDragging: this.isDragging,
        simulationActive: this.simulationActive,
        pinThreshold: this.getPinHitThreshold(),
      },
    );
    this.hoveredComponent = hover.hoveredComponent;
    this.hoveredPin = hover.hoveredPin;
    this.hoveredWire = hover.hoveredWire;
    this.canvas.style.cursor = hover.cursor;
  }

  public selectComponentAt(worldX: number, worldY: number, isShift: boolean = false): ComponentInstance | null {
    const result = selectComponentAt(
      this.components,
      {
        selectedComponent: this.selectedComponent,
        selectedComponents: this.selectedComponents,
        selectedWire: this.selectedWire,
      },
      this.hoveredWire,
      worldX,
      worldY,
      isShift,
    );
    this.selectedComponent = result.selectedComponent;
    this.selectedComponents = result.selectedComponents;
    this.selectedWire = result.selectedWire;
    return result.hitComponent;
  }
  public completeBoxSelection(): void {
    const result = completeBoxSelection(this.components, this.selectionStart, this.selectionEnd);
    if (result) {
      this.selectedComponent = result.selectedComponent;
      this.selectedComponents = result.selectedComponents;
      this.selectedWire = result.selectedWire;
    }
    this.selectionStart = null;
    this.selectionEnd = null;
  }
  public startDraggingSelected(worldX: number, worldY: number): void {
    this.isDragging = true;
    this.canvas.style.cursor = 'grabbing';
    const offsets = createDragOffsets(
      this.selectedComponents,
      this.selectedComponent,
      { x: worldX, y: worldY },
    );
    this.dragStartOffsets = offsets.dragStartOffsets;
    this.dragStartOffset = offsets.dragStartOffset;
  }
  public handleDragging(worldX: number, worldY: number): void {
    if (!this.isDragging) return;

    applyDrag(
      this.selectedComponents,
      this.selectedComponent,
      this.dragStartOffsets,
      this.dragStartOffset,
      { x: worldX, y: worldY },
      this.gridSize,
    );
    this.syncWireConnections();
  }
  public stopDragging(): void {
    this.isDragging = false;
    this.canvas.style.cursor = 'default';
  }

  public syncWireConnections(): void {
    syncWireModelConnections(
      this.components,
      this.wires,
      (component) => this.getComponentPins(component),
      (start, end) => this.generateOrthogonalPath(start, end),
    );
  }

  public connectPins(from: PinInstance, to: PinInstance): void {
    if (connectWirePins(this.wires, from, to)) {
      this.syncWireConnections();
    }
  }

  public rotateSelectedComponent(): void {
    rotateSelection(this.selectedComponents, this.selectedComponent, 90);
    this.syncWireConnections();
  }

  public rotateSelectedByDegrees(deltaDegrees: number): void {
    rotateSelection(this.selectedComponents, this.selectedComponent, deltaDegrees);
    this.syncWireConnections();
  }

  public mirrorSelectedComponent(): void {
    mirrorSelection(this.selectedComponents, this.selectedComponent);
    this.syncWireConnections();
  }

  public duplicateSelected(): void {
    const result = duplicateSelection(
      this.selectedComponents,
      this.selectedComponent,
      (type, x, y, value) => this.addComponent(type, x, y, value),
    );
    this.selectedComponent = result.selectedComponent;
    this.selectedComponents = result.selectedComponents;
  }

  public removeSelected(): void {
    const result = removeSelection(
      this.components,
      this.wires,
      this.selectedWire,
      this.selectedComponents,
      this.selectedComponent,
    );
    this.components = result.components;
    this.wires = result.wires;
    this.selectedWire = result.selectedWire;
    this.selectedComponent = result.selectedComponent;
    this.selectedComponents = result.selectedComponents;
  }

  public fitAll(): void {
    const bounds = getCircuitBounds(this.components, this.wires);
    if (!bounds) return;

    const nextCamera = fitBoundsToViewport(
      bounds,
      { width: this.canvas.clientWidth, height: this.canvas.clientHeight },
      { minZoom: this.minZoom, maxZoom: this.maxZoom },
    );
    if (!nextCamera) return;

    this.zoom = nextCamera.zoom;
    this.offsetX = nextCamera.offsetX;
    this.offsetY = nextCamera.offsetY;
  }

  public resetCameraToCircuit(): void {
    if (this.components.length === 0) {
      this.zoom = 1.0;
      this.offsetX = this.canvas.clientWidth / 2;
      this.offsetY = this.canvas.clientHeight / 2;
      this.render();
      return;
    }

    this.fitAll();
    
    this.render();
  }

  public cancelWire(): void {
    this.activePinForWire = null;
    this.tempWireEnd = null;
  }

  public selectAll(): void {
    this.selectedWire = null;
    this.selectedComponents = [...this.components];
    if (this.selectedComponents.length === 1) {
      this.selectedComponent = this.selectedComponents[0];
    } else if (this.selectedComponents.length > 0) {
      this.selectedComponent = null;
    }
  }
}
