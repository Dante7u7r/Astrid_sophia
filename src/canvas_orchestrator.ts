import { type McuRuntime } from "./simulation/mcu-runtime";
import { type McuSpiceBridge } from "./simulation/mcu-spice-bridge";
import { drawComponentSymbol } from "./canvas/component_renderer";
import { getComponentPins as resolveComponentPins } from "./canvas/component_pins";
import {
  clampCameraOffsets,
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
import {
  applyDrag,
  completeBoxSelection,
  createDragOffsets,
  selectComponentAt,
} from "./canvas/selection_model";
import {
  connectPins as connectWirePins,
  syncWireConnections as syncWireModelConnections,
  wirePathIntersects,
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
  createComponentLookup,
  createGridRenderPlan,
  createSelectedComponentIds,
  ensureCanvasBuffer,
  getVisibleComponents,
  resolveRenderDetail,
  type RenderDetail,
} from "./canvas/render_model";
import {
  drawProbeBadges,
  drawSelectionBox,
  drawSParameterMarkers,
  drawTemporaryWire,
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

type RenderPinCache = Map<string, PinInstance[]>;

interface GridPathCache {
  key: string;
  path: Path2D;
}

export class CanvasOrchestrator {
  private canvas: HTMLCanvasElement;
  public simulationActive: boolean = false;
  private ctx: CanvasRenderingContext2D;
  private gridPathCache: GridPathCache | null = null;

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
    this.ctx = context;
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

  public render(_voltageMap: Record<string, number> = {}, probes: ProbeBadges = {}, nodeMap: Record<string, string> = {}, sparMarkers?: SParameterMarker[]): void {
    const dpr = window.devicePixelRatio || 1;
    ensureCanvasBuffer(this.canvas, dpr);

    this.clampCameraOffsets();

    // 2. Reset transform to identity, clear the entire physical buffer
    this.ctx.setTransform(1, 0, 0, 1, 0, 0);
    this.ctx.clearRect(0, 0, this.canvas.width, this.canvas.height);
    this.ctx.save();

    // 3. Apply Camera Transformations (zoom & pan) scaled by DPR
    this.ctx.setTransform(
      this.zoom * dpr, 0,
      0, this.zoom * dpr,
      this.offsetX * dpr,
      this.offsetY * dpr,
    );

    // 4. Draw Background Grid
    this.drawWorldGrid(dpr);

    const componentById = createComponentLookup(this.components);
    const pinCache: RenderPinCache = new Map();
    const visibleWorldBounds = this.getVisibleWorldBounds();
    const visibleComponents = getVisibleComponents(this.components, visibleWorldBounds);
    const selectedIds = createSelectedComponentIds(this.selectedComponents);

    // 3. Draw Wires
    this.drawWires(componentById, pinCache, visibleWorldBounds);

    const renderDetail = resolveRenderDetail(this.zoom, visibleComponents.length);

    // 4. Draw Components
    for (const comp of visibleComponents) {
      const isSelected = comp.selected || 
                         this.selectedComponent?.id === comp.id ||
                         selectedIds.has(comp.id);
      const isHovered = this.hoveredComponent?.id === comp.id;
      drawComponentSymbol(this.ctx, comp, isSelected, isHovered, { detail: renderDetail });
    }

    drawTemporaryWire(
      this.ctx,
      this.activePinForWire,
      this.tempWireEnd,
      (start, end) => this.generateOrthogonalPath(start, end),
    );
    // 6. Draw Highlights & Pins
    this.drawPins(_voltageMap, nodeMap, pinCache, visibleComponents, renderDetail);

    // 6b. Draw Visual ERC Issues
    this.drawERCIssues(componentById, pinCache);

    drawProbeBadges(this.ctx, probes);
    drawSParameterMarkers(this.ctx, sparMarkers);
    drawSelectionBox(this.ctx, this.selectionStart, this.selectionEnd);

    this.ctx.restore();
  }

  private getVisibleWorldBounds(): BoundingBox {
    return getVisibleWorldBounds(this, {
      width: this.canvas.clientWidth,
      height: this.canvas.clientHeight,
    });
  }

  private drawWorldGrid(dpr: number = 1): void {
    const cssW = this.canvas.clientWidth;
    const cssH = this.canvas.clientHeight;
    if (cssW <= 0 || cssH <= 0 || !Number.isFinite(this.zoom) || this.zoom <= 0) return;

    const topLeft = this.screenToWorld(0, 0);
    const bottomRight = this.screenToWorld(cssW, cssH);

    const gridPlan = createGridRenderPlan({
      topLeft,
      bottomRight,
      gridSize: this.gridSize,
      zoom: this.zoom,
    });
    if (!gridPlan) return;

    this.ctx.save();
    this.ctx.setTransform(
      this.zoom * dpr, 0,
      0, this.zoom * dpr,
      this.offsetX * dpr,
      this.offsetY * dpr,
    );
    this.ctx.fillStyle = "rgba(255, 255, 255, 0.05)";

    let path = this.gridPathCache?.key === gridPlan.cacheKey ? this.gridPathCache.path : null;
    if (!path) {
      path = new Path2D();
      for (let x = gridPlan.startX; x <= gridPlan.endX; x += gridPlan.gridStep) {
        for (let y = gridPlan.startY; y <= gridPlan.endY; y += gridPlan.gridStep) {
          path.rect(
            x - gridPlan.dotSize / 2,
            y - gridPlan.dotSize / 2,
            gridPlan.dotSize,
            gridPlan.dotSize,
          );
        }
      }
      this.gridPathCache = { key: gridPlan.cacheKey, path };
    }
    this.ctx.fill(path);
    this.ctx.restore();
  }

  private getPinsCached(comp: ComponentInstance, pinCache: RenderPinCache): PinInstance[] {
    const cached = pinCache.get(comp.id);
    if (cached) return cached;
    const pins = this.getComponentPins(comp);
    pinCache.set(comp.id, pins);
    return pins;
  }

  private drawWires(
    componentById: ReadonlyMap<string, ComponentInstance>,
    pinCache: RenderPinCache,
    visibleWorldBounds: BoundingBox,
  ): void {
    this.ctx.save();
    
    for (const wire of this.wires) {
      // Find endpoints
      const fromComp = componentById.get(wire.from.componentId);
      const toComp = componentById.get(wire.to.componentId);
      
      if (!fromComp || !toComp) continue;

      const fromPins = this.getPinsCached(fromComp, pinCache);
      const toPins = this.getPinsCached(toComp, pinCache);
      const startPt = fromPins.find(p => p.pinIndex === wire.from.pinIndex);
      const endPt = toPins.find(p => p.pinIndex === wire.to.pinIndex);

      if (!startPt || !endPt) continue;

      const pts = wire.points;
      if (!pts || pts.length < 2) continue;
      if (!this.wirePathIntersects(pts, visibleWorldBounds)) continue;

      // Dibujar camino ortogonal con esquinas redondeadas
      this.ctx.beginPath();
      this.ctx.moveTo(pts[0].x, pts[0].y);

      const cornerRadius = 8;
      if (pts.length > 2) {
        for (let i = 1; i < pts.length - 1; i++) {
          const p1 = pts[i];
          const p2 = pts[i + 1];
          this.ctx.arcTo(p1.x, p1.y, p2.x, p2.y, cornerRadius);
        }
      }
      this.ctx.lineTo(pts[pts.length - 1].x, pts[pts.length - 1].y);

      // Estilo interactivo del cable
      const isSelected = this.selectedWire?.id === wire.id;
      const isHovered = this.hoveredWire?.id === wire.id;

      if (isSelected) {
        this.ctx.strokeStyle = "hsl(270, 89%, 65%)"; // Selected violet neón
        this.ctx.lineWidth = 3;
        this.ctx.shadowColor = "hsl(270, 89%, 65%)";
        this.ctx.shadowBlur = 8;
      } else if (isHovered) {
        this.ctx.strokeStyle = "hsl(210, 100%, 56%)"; // Hovered azul neón
        this.ctx.lineWidth = 2.5;
        this.ctx.shadowColor = "hsl(210, 100%, 56%)";
        this.ctx.shadowBlur = 6;
      } else {
        this.ctx.strokeStyle = "rgba(255, 255, 255, 0.45)"; // Cable estándar semitransparente
        this.ctx.lineWidth = 2;
        this.ctx.shadowBlur = 0;
      }

      this.ctx.stroke();
      this.ctx.shadowBlur = 0; // Reset shadow

      // Highlight conexiones/pins
      this.ctx.fillStyle = isSelected 
        ? "hsl(270, 89%, 65%)" 
        : isHovered 
          ? "hsl(210, 100%, 56%)" 
          : "rgba(102, 252, 241, 0.3)";
      this.ctx.beginPath();
      this.ctx.arc(startPt.x, startPt.y, 4, 0, Math.PI * 2);
      this.ctx.arc(endPt.x, endPt.y, 4, 0, Math.PI * 2);
      this.ctx.fill();
    }

    this.ctx.restore();
  }

  private wirePathIntersects(points: readonly Point2D[], bounds: BoundingBox): boolean {
    return wirePathIntersects(points, bounds);
  }

  private drawPins(
    voltageMap: Record<string, number> = {},
    nodeMap: Record<string, string> = {},
    pinCache: RenderPinCache = new Map(),
    componentsToDraw: readonly ComponentInstance[] = this.components,
    renderDetail: RenderDetail = "full",
  ): void {
    this.ctx.save();

    for (const comp of componentsToDraw) {
      const pins = this.getPinsCached(comp, pinCache);
      for (const pin of pins) {
        const isHovered = this.hoveredPin && 
                          this.hoveredPin.componentId === pin.componentId && 
                          this.hoveredPin.pinIndex === pin.pinIndex;
        const isActive = this.activePinForWire && 
                         this.activePinForWire.componentId === pin.componentId && 
                         this.activePinForWire.pinIndex === pin.pinIndex;
        if (renderDetail === "compact" && !isHovered && !isActive) continue;

        if (isHovered || isActive) {
          this.ctx.fillStyle = "hsl(174, 97%, 69%)";
          this.ctx.shadowColor = "hsl(174, 97%, 69%)";
          this.ctx.shadowBlur = 6;
          this.ctx.beginPath();
          this.ctx.arc(pin.x, pin.y, 6, 0, Math.PI * 2);
          this.ctx.fill();
          this.ctx.shadowBlur = 0;

          // Draw tooltip with node info and voltage
          const pinKey = `${pin.componentId}:${pin.pinIndex}`;
          const nodeId = nodeMap[pinKey];
          if (isHovered && nodeId) {
            const nodeLabel = nodeId === "0" ? "Nodo 0 (GND)" : `Nodo ${nodeId}`;
            const volt = voltageMap[pinKey];
            const voltLine = volt !== undefined ? `${volt.toFixed(4)} V` : null;

            const lines: string[] = [nodeLabel];
            if (voltLine) lines.push(voltLine);

            this.ctx.font = "bold 9px var(--font-mono)";
            const lineHeight = 12;
            const paddingX = 8;
            const paddingY = 5;
            let maxWidth = 0;
            for (const line of lines) {
              const w = this.ctx.measureText(line).width;
              if (w > maxWidth) maxWidth = w;
            }

            const boxH = lines.length * lineHeight + paddingY * 2;
            const boxY = pin.y - 10 - boxH;

            this.ctx.fillStyle = "rgba(8, 12, 22, 0.95)";
            this.ctx.strokeStyle = "rgba(102, 252, 241, 0.4)";
            this.ctx.lineWidth = 1;
            this.ctx.beginPath();
            this.ctx.roundRect(
              pin.x - maxWidth / 2 - paddingX,
              boxY,
              maxWidth + paddingX * 2,
              boxH,
              4
            );
            this.ctx.fill();
            this.ctx.stroke();

            this.ctx.fillStyle = "hsl(174, 97%, 69%)";
            this.ctx.textAlign = "center";
            for (let i = 0; i < lines.length; i++) {
              this.ctx.fillText(lines[i], pin.x, boxY + paddingY + lineHeight * (i + 0.7));
            }
          }
        } else {
          this.ctx.fillStyle = "rgba(102, 252, 241, 0.5)";
          this.ctx.beginPath();
          this.ctx.arc(pin.x, pin.y, 3, 0, Math.PI * 2);
          this.ctx.fill();
        }
      }
    }

    this.ctx.restore();
  }

  private drawERCIssues(
    componentById: ReadonlyMap<string, ComponentInstance> = new Map(this.components.map(component => [component.id, component])),
    pinCache: RenderPinCache = new Map(),
  ): void {
    if (this.ercIssues.length === 0) return;

    const pulseRadius = 10 + Math.sin(Date.now() / 150) * 3;

    for (const issue of this.ercIssues) {
      const comp = componentById.get(issue.componentId);
      if (!comp) continue;

      const isError = issue.type === "error";
      const ringColor = isError ? "hsl(0, 84%, 60%)" : "hsl(35, 92%, 55%)";
      const fillColor = isError ? "rgba(239, 68, 68, 0.2)" : "rgba(245, 158, 11, 0.2)";

      if (issue.pinIndex !== undefined) {
        // Alerta específica en un pin
        const pins = this.getPinsCached(comp, pinCache);
        const pin = pins.find(p => p.pinIndex === issue.pinIndex);
        if (pin) {
          this.ctx.save();
          this.ctx.beginPath();
          this.ctx.arc(pin.x, pin.y, pulseRadius, 0, Math.PI * 2);
          this.ctx.strokeStyle = ringColor;
          this.ctx.lineWidth = 1.5;
          this.ctx.stroke();
          this.ctx.fillStyle = fillColor;
          this.ctx.fill();
          
          this.ctx.beginPath();
          this.ctx.arc(pin.x, pin.y, 4, 0, Math.PI * 2);
          this.ctx.fillStyle = ringColor;
          this.ctx.fill();
          this.ctx.restore();
        }
      } else {
        // Alerta en todo el componente
        this.ctx.save();
        this.ctx.beginPath();
        const compRadius = 25 + Math.sin(Date.now() / 150) * 5;
        this.ctx.arc(comp.x, comp.y, compRadius, 0, Math.PI * 2);
        this.ctx.strokeStyle = ringColor;
        this.ctx.lineWidth = 2;
        this.ctx.stroke();
        this.ctx.fillStyle = fillColor;
        this.ctx.fill();

        // Cartel de advertencia arriba del componente
        const badgeY = comp.y - 32;
        this.ctx.beginPath();
        this.ctx.moveTo(comp.x - 7, badgeY + 4);
        this.ctx.lineTo(comp.x + 7, badgeY + 4);
        this.ctx.lineTo(comp.x, badgeY - 8);
        this.ctx.closePath();
        this.ctx.fillStyle = ringColor;
        this.ctx.fill();
        
        this.ctx.fillStyle = "white";
        this.ctx.font = "bold 8px var(--font-sans)";
        this.ctx.textAlign = "center";
        this.ctx.fillText("!", comp.x, badgeY + 2);
        this.ctx.restore();
      }
    }
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
