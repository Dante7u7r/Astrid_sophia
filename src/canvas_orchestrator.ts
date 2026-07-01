import { type McuRuntime } from "./simulation/mcu-runtime";
import { type McuSpiceBridge } from "./simulation/mcu-spice-bridge";
import { drawComponentSymbol } from "./canvas/component_renderer";

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

export function wireEndpointKey(ep: WireEndpoint): string {
  return `${ep.componentId}:${ep.pinIndex}`;
}

/** Half-extents (local space, pre-rotation) aligned with render() geometry. */
export function getComponentLocalHalfExtents(comp: ComponentInstance): { halfW: number; halfH: number } {
  switch (comp.type) {
    case 'mcu_8051':
      return { halfW: 65, halfH: 225 };
    case 'mcu_avr':
      return { halfW: 65, halfH: 165 };
    case 'arduino_uno':
    case 'esp32':
    case 'raspberry_pi_pico':
      return { halfW: 45, halfH: 65 };
    case 'opamp':
      return { halfW: 45, halfH: 45 };
    case 'relay':
      return { halfW: 45, halfH: 25 };
    case 'switch':
      return { halfW: 45, halfH: 15 };
    case 'transformer':
      return { halfW: 45, halfH: 25 };
    case 'nmos':
    case 'pmos':
    case 'npn':
    case 'pnp':
      return { halfW: 45, halfH: 45 };
    case 'x': {
      const pinsLeft = Math.ceil((comp.pinCount ?? 4) / 2);
      const totalHeight = Math.max(pinsLeft * 40, 60);
      return { halfW: 65, halfH: totalHeight / 2 + 5 };
    }
    case 'dmm':
      return { halfW: 30, halfH: 40 };
    default:
      return { halfW: 40, halfH: 40 };
  }
}

export function getComponentBounds(comp: ComponentInstance): BoundingBox {
  const { halfW, halfH } = getComponentLocalHalfExtents(comp);
  const rad = (comp.rotation * Math.PI) / 180;
  const cos = Math.abs(Math.cos(rad));
  const sin = Math.abs(Math.sin(rad));
  const worldHalfW = halfW * cos + halfH * sin;
  const worldHalfH = halfW * sin + halfH * cos;
  return {
    x: comp.x - worldHalfW,
    y: comp.y - worldHalfH,
    width: worldHalfW * 2,
    height: worldHalfH * 2,
  };
}

export function hitTestComponentAt(
  comp: ComponentInstance,
  worldX: number,
  worldY: number,
): boolean {
  const { halfW, halfH } = getComponentLocalHalfExtents(comp);
  const rad = (-comp.rotation * Math.PI) / 180;
  const cos = Math.cos(rad);
  const sin = Math.sin(rad);
  const dx = worldX - comp.x;
  const dy = worldY - comp.y;
  const localX = dx * cos - dy * sin;
  const localY = dx * sin + dy * cos;
  return localX >= -halfW && localX <= halfW && localY >= -halfH && localY <= halfH;
}

export class CanvasOrchestrator {
  private canvas: HTMLCanvasElement;
  public simulationActive: boolean = false;
  private ctx: CanvasRenderingContext2D;

  // Viewport State
  public zoom: number = 1.0;
  public offsetX: number = 0;
  public offsetY: number = 0;

  // Constants
  public readonly minZoom: number = 0.3;
  public readonly maxZoom: number = 3.0;
  public readonly gridSize: number = 20;

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
    return {
      x: (screenX - this.offsetX) / this.zoom,
      y: (screenY - this.offsetY) / this.zoom,
    };
  }

  public worldToScreen(worldX: number, worldY: number): Point2D {
    return {
      x: worldX * this.zoom + this.offsetX,
      y: worldY * this.zoom + this.offsetY,
    };
  }

  public snapToGrid(coord: number): number {
    return Math.round(coord / this.gridSize) * this.gridSize;
  }

  public snapPointToGrid(p: Point2D): Point2D {
    return {
      x: this.snapToGrid(p.x),
      y: this.snapToGrid(p.y),
    };
  }

  public screenToWorldSnapped(screenX: number, screenY: number): Point2D {
    return this.snapPointToGrid(this.screenToWorld(screenX, screenY));
  }

  public generateOrthogonalPath(start: Point2D, end: Point2D): Point2D[] {
    const pts: Point2D[] = [{ x: start.x, y: start.y }];
    const dx = Math.abs(end.x - start.x);
    const dy = Math.abs(end.y - start.y);

    if (dx < 0.1) {
      pts.push({ x: end.x, y: end.y });
    } else if (dy < 0.1) {
      pts.push({ x: end.x, y: end.y });
    } else {
      if (dx >= dy) {
        const midX = start.x + (end.x - start.x) / 2;
        pts.push(this.snapPointToGrid({ x: midX, y: start.y }));
        pts.push(this.snapPointToGrid({ x: midX, y: end.y }));
      } else {
        const midY = start.y + (end.y - start.y) / 2;
        pts.push(this.snapPointToGrid({ x: start.x, y: midY }));
        pts.push(this.snapPointToGrid({ x: end.x, y: midY }));
      }
      pts.push({ x: end.x, y: end.y });
    }
    return pts;
  }

  public getComponentPins(comp: ComponentInstance): PinInstance[] {
    const pins: PinInstance[] = [];
    const rad = (comp.rotation * Math.PI) / 180;
    const cos = Math.cos(rad);
    const sin = Math.sin(rad);

    const getRotatedOffset = (lx: number, ly: number): Point2D => {
      const finalLx = comp.mirror ? -lx : lx;
      return {
        x: comp.x + (finalLx * cos - ly * sin),
        y: comp.y + (finalLx * sin + ly * cos),
      };
    };

    if (comp.type === 'ground') {
      // Ground has 1 pin at the top center of its drawing
      const pt = getRotatedOffset(0, -20);
      pins.push({ componentId: comp.id, pinIndex: 0, x: pt.x, y: pt.y });
    } else if (comp.type === 'nmos' || comp.type === 'pmos' || comp.type === 'npn' || comp.type === 'pnp') {
      // NMOS, PMOS, and BJT (NPN/PNP) all have 3 pins
      const ptGate = getRotatedOffset(-40, 0);
      const ptDrain = getRotatedOffset(20, -40);
      const ptSource = getRotatedOffset(20, 40);
      pins.push({ componentId: comp.id, pinIndex: 0, x: ptGate.x, y: ptGate.y });
      pins.push({ componentId: comp.id, pinIndex: 1, x: ptDrain.x, y: ptDrain.y });
      pins.push({ componentId: comp.id, pinIndex: 2, x: ptSource.x, y: ptSource.y });
    } else if (comp.type === 'opamp') {
      // Op-Amp has 5 pins: In+ (-40, -15), In- (-40, 15), V+ (0, -40), V- (0, 40), Out (40, 0)
      const ptInPos = getRotatedOffset(-40, -15);
      const ptInNeg = getRotatedOffset(-40, 15);
      const ptVplus = getRotatedOffset(0, -40);
      const ptVminus = getRotatedOffset(0, 40);
      const ptOut = getRotatedOffset(40, 0);
      pins.push({ componentId: comp.id, pinIndex: 0, x: ptInPos.x, y: ptInPos.y });
      pins.push({ componentId: comp.id, pinIndex: 1, x: ptInNeg.x, y: ptInNeg.y });
      pins.push({ componentId: comp.id, pinIndex: 2, x: ptVplus.x, y: ptVplus.y });
      pins.push({ componentId: comp.id, pinIndex: 3, x: ptVminus.x, y: ptVminus.y });
      pins.push({ componentId: comp.id, pinIndex: 4, x: ptOut.x, y: ptOut.y });
    } else if (comp.type === 'relay') {
      // Relay has 4 pins: coil-a (-40, -20), coil-b (-40, 20), common (40, -20), no (40, 20)
      const ptCoilA = getRotatedOffset(-40, -20);
      const ptCoilB = getRotatedOffset(-40, 20);
      const ptCommon = getRotatedOffset(40, -20);
      const ptNo = getRotatedOffset(40, 20);
      pins.push({ componentId: comp.id, pinIndex: 0, x: ptCoilA.x, y: ptCoilA.y });
      pins.push({ componentId: comp.id, pinIndex: 1, x: ptCoilB.x, y: ptCoilB.y });
      pins.push({ componentId: comp.id, pinIndex: 2, x: ptCommon.x, y: ptCommon.y });
      pins.push({ componentId: comp.id, pinIndex: 3, x: ptNo.x, y: ptNo.y });
    } else if (comp.type === 'potentiometer') {
      // Potentiometer has 3 pins: Terminal A (-40, 0), Wiper (0, 40), Terminal B (40, 0)
      const ptA = getRotatedOffset(-40, 0);
      const ptWiper = getRotatedOffset(0, 40);
      const ptB = getRotatedOffset(40, 0);
      pins.push({ componentId: comp.id, pinIndex: 0, x: ptA.x, y: ptA.y });
      pins.push({ componentId: comp.id, pinIndex: 1, x: ptWiper.x, y: ptWiper.y });
      pins.push({ componentId: comp.id, pinIndex: 2, x: ptB.x, y: ptB.y });
    } else if (comp.type === 'mcu_8051') {
      // DIP-40 Package
      // Pins 1-20 on the left side, y: -200 to 180 (step 20)
      for (let i = 0; i < 20; i++) {
        const pt = getRotatedOffset(-60, -200 + i * 20);
        pins.push({ componentId: comp.id, pinIndex: i, x: pt.x, y: pt.y });
      }
      // Pins 21-40 on the right side, y: 180 to -200 (step -20)
      for (let i = 0; i < 20; i++) {
        const pt = getRotatedOffset(60, 180 - i * 20);
        pins.push({ componentId: comp.id, pinIndex: 20 + i, x: pt.x, y: pt.y });
      }
    } else if (comp.type === 'mcu_avr') {
      // DIP-28 Package (ATmega328P)
      // Pins 1-14 on the left side, y: -140 to 120 (step 20)
      for (let i = 0; i < 14; i++) {
        const pt = getRotatedOffset(-60, -140 + i * 20);
        pins.push({ componentId: comp.id, pinIndex: i, x: pt.x, y: pt.y });
      }
      // Pins 15-28 on the right side, y: 120 to -140 (step -20)
      for (let i = 0; i < 14; i++) {
        const pt = getRotatedOffset(60, 120 - i * 20);
        pins.push({ componentId: comp.id, pinIndex: 14 + i, x: pt.x, y: pt.y });
      }
    } else if (comp.type === 'arduino_uno' || comp.type === 'esp32' || comp.type === 'raspberry_pi_pico') {
      // Symmetrical 6-pin layout
      // Left side: Pin 0 (IN), Pin 2 (ADC), Pin 4 (VCC)
      // Right side: Pin 1 (OUT), Pin 3 (DAC), Pin 5 (GND)
      const pt0 = getRotatedOffset(-40, -40);
      const pt1 = getRotatedOffset(40, -40);
      const pt2 = getRotatedOffset(-40, 0);
      const pt3 = getRotatedOffset(40, 0);
      const pt4 = getRotatedOffset(-40, 40);
      const pt5 = getRotatedOffset(40, 40);
      pins.push({ componentId: comp.id, pinIndex: 0, x: pt0.x, y: pt0.y });
      pins.push({ componentId: comp.id, pinIndex: 1, x: pt1.x, y: pt1.y });
      pins.push({ componentId: comp.id, pinIndex: 2, x: pt2.x, y: pt2.y });
      pins.push({ componentId: comp.id, pinIndex: 3, x: pt3.x, y: pt3.y });
      pins.push({ componentId: comp.id, pinIndex: 4, x: pt4.x, y: pt4.y });
      pins.push({ componentId: comp.id, pinIndex: 5, x: pt5.x, y: pt5.y });
    } else if (comp.type === 'transformer') {
      // Transformer has 4 pins: primary side (0, 1), secondary side (2, 3)
      const ptPri1 = getRotatedOffset(-40, -20);
      const ptPri2 = getRotatedOffset(-40, 20);
      const ptSec1 = getRotatedOffset(40, -20);
      const ptSec2 = getRotatedOffset(40, 20);
      pins.push({ componentId: comp.id, pinIndex: 0, x: ptPri1.x, y: ptPri1.y });
      pins.push({ componentId: comp.id, pinIndex: 1, x: ptPri2.x, y: ptPri2.y });
      pins.push({ componentId: comp.id, pinIndex: 2, x: ptSec1.x, y: ptSec1.y });
      pins.push({ componentId: comp.id, pinIndex: 3, x: ptSec2.x, y: ptSec2.y });
    } else if (comp.type === 'x') {
      const pinCount = comp.pinCount ?? 4;
      const pinsLeft = Math.ceil(pinCount / 2);
      const totalHeight = Math.max(pinsLeft * 40, 60);
      const halfH = totalHeight / 2;

      for (let i = 0; i < pinCount; i++) {
        const pos = Math.floor(i / 2);
        const yOffset = -halfH + 20 + pos * 40;
        if (i % 2 === 0) {
          // Pin par (0, 2, 4...) -> Izquierda. Conexión lógica en la punta exterior (-60)
          const pt = getRotatedOffset(-60, yOffset);
          pins.push({ componentId: comp.id, pinIndex: i, x: pt.x, y: pt.y });
        } else {
          // Pin impar (1, 3, 5...) -> Derecha. Conexión lógica en la punta exterior (60)
          const pt = getRotatedOffset(60, yOffset);
          pins.push({ componentId: comp.id, pinIndex: i, x: pt.x, y: pt.y });
        }
      }
    } else {
      // Other 2-pin components (resistor, capacitor, inductor, diode, vsource, isource, led, switch)
      const pt1 = getRotatedOffset(-40, 0);
      const pt2 = getRotatedOffset(40, 0);
      pins.push({ componentId: comp.id, pinIndex: 0, x: pt1.x, y: pt1.y });
      pins.push({ componentId: comp.id, pinIndex: 1, x: pt2.x, y: pt2.y });
    }

    return pins;
  }

  public isVisible(box: BoundingBox): boolean {
    const topLeft = this.screenToWorld(0, 0);
    const bottomRight = this.screenToWorld(this.canvas.width, this.canvas.height);

    return (
      box.x + box.width >= topLeft.x &&
      box.x <= bottomRight.x &&
      box.y + box.height >= topLeft.y &&
      box.y <= bottomRight.y
    );
  }

  // --- CAMERA OPERATIONS ---

  /** Calculates the geometric center of all components in world coordinates.
   * Defaults to (0, 0) if the circuit is empty. */
  public getCircuitGeometricCenter(): Point2D {
    if (this.components.length === 0) {
      return { x: 0, y: 0 };
    }
    let minX = Infinity;
    let maxX = -Infinity;
    let minY = Infinity;
    let maxY = -Infinity;
    for (const comp of this.components) {
      const bounds = getComponentBounds(comp);
      minX = Math.min(minX, bounds.x);
      maxX = Math.max(maxX, bounds.x + bounds.width);
      minY = Math.min(minY, bounds.y);
      maxY = Math.max(maxY, bounds.y + bounds.height);
    }
    return {
      x: (minX + maxX) / 2,
      y: (minY + maxY) / 2,
    };
  }

  /** Keeps the circuit geometric center within the visible screen area. */
  public clampCameraOffsets(): void {
    const center = this.getCircuitGeometricCenter();
    const Gx = center.x;
    const Gy = center.y;
    const canvasWidth = this.canvas.width;
    const canvasHeight = this.canvas.height;

    // Offset required to place Gx at screen coordinate X is: screenX - Gx * zoom
    // We constrain screenX between [0, canvasWidth]
    const minOffsetX = -Gx * this.zoom;
    const maxOffsetX = canvasWidth - Gx * this.zoom;
    const minOffsetY = -Gy * this.zoom;
    const maxOffsetY = canvasHeight - Gy * this.zoom;

    this.offsetX = Math.min(Math.max(this.offsetX, minOffsetX), maxOffsetX);
    this.offsetY = Math.min(Math.max(this.offsetY, minOffsetY), maxOffsetY);
  }

  public zoomAt(zoomFactor: number, screenTargetX: number, screenTargetY: number): void {
    const worldTarget = this.screenToWorld(screenTargetX, screenTargetY);
    const nextZoom = Math.min(Math.max(this.zoom * zoomFactor, this.minZoom), this.maxZoom);
    if (nextZoom === this.zoom) return;

    this.zoom = nextZoom;
    this.offsetX = screenTargetX - worldTarget.x * this.zoom;
    this.offsetY = screenTargetY - worldTarget.y * this.zoom;
    this.clampCameraOffsets();
  }

  public pan(dx: number, dy: number): void {
    this.offsetX += dx;
    this.offsetY += dy;
    this.clampCameraOffsets();
  }

  // --- DRAWING / RENDERING ---

  public render(_voltageMap: Record<string, number> = {}, probes: { ch1?: Point2D; ch2?: Point2D; ch3?: Point2D; ch4?: Point2D } = {}, nodeMap: Record<string, string> = {}, sparMarkers?: { index: number; x: number; y: number }[]): void {
    const { width, height } = this.canvas;
    
    // Sync actual drawing bounds
    if (this.canvas.width !== this.canvas.clientWidth || this.canvas.height !== this.canvas.clientHeight) {
      this.canvas.width = this.canvas.clientWidth;
      this.canvas.height = this.canvas.clientHeight;
    }

    this.clampCameraOffsets();

    this.ctx.clearRect(0, 0, width, height);
    this.ctx.save();

    // 1. Draw Background Grid
    this.drawWorldGrid();

    // 2. Apply Camera Transformations
    this.ctx.setTransform(this.zoom, 0, 0, this.zoom, this.offsetX, this.offsetY);

    // 3. Draw Wires
    this.drawWires(_voltageMap);

    // 4. Draw Components
    for (const comp of this.components) {
      const isSelected = comp.selected || 
                         this.selectedComponent?.id === comp.id ||
                         this.selectedComponents.some(c => c.id === comp.id);
      const isHovered = this.hoveredComponent?.id === comp.id;
      drawComponentSymbol(this.ctx, comp, isSelected, isHovered);
    }

    // 5. Draw Temporary Drawing Wire
    if (this.activePinForWire && this.tempWireEnd) {
      this.ctx.strokeStyle = "rgba(102, 252, 241, 0.6)";
      this.ctx.lineWidth = 2.5;
      this.ctx.setLineDash([6, 4]);
      this.ctx.beginPath();
      
      const pinPt = this.activePinForWire;
      const previewPath = this.generateOrthogonalPath(pinPt, this.tempWireEnd);
      this.ctx.moveTo(previewPath[0].x, previewPath[0].y);
      for (let i = 1; i < previewPath.length; i++) {
        this.ctx.lineTo(previewPath[i].x, previewPath[i].y);
      }
      
      this.ctx.stroke();
      this.ctx.setLineDash([]);
    }

    // 6. Draw Highlights & Pins
    this.drawPins(_voltageMap, nodeMap);

    // 6b. Draw Visual ERC Issues
    this.drawERCIssues();

    // 7. Draw Oscilloscope Probe Badges
    if (probes.ch1) {
      this.ctx.fillStyle = "hsl(174, 97%, 69%)";
      this.ctx.shadowColor = "hsl(174, 97%, 69%)";
      this.ctx.shadowBlur = 8;
      this.ctx.beginPath();
      this.ctx.arc(probes.ch1.x, probes.ch1.y - 14, 8, 0, Math.PI * 2);
      this.ctx.fill();
      this.ctx.shadowBlur = 0;
      
      this.ctx.fillStyle = "#030508";
      this.ctx.font = "bold 9px var(--font-sans)";
      this.ctx.textAlign = "center";
      this.ctx.fillText("①", probes.ch1.x, probes.ch1.y - 11);
    }
    if (probes.ch2) {
      this.ctx.fillStyle = "hsl(270, 89%, 65%)";
      this.ctx.shadowColor = "hsl(270, 89%, 65%)";
      this.ctx.shadowBlur = 8;
      this.ctx.beginPath();
      this.ctx.arc(probes.ch2.x, probes.ch2.y - 14, 8, 0, Math.PI * 2);
      this.ctx.fill();
      this.ctx.shadowBlur = 0;
      
      this.ctx.fillStyle = "#030508";
      this.ctx.font = "bold 9px var(--font-sans)";
      this.ctx.textAlign = "center";
      this.ctx.fillText("②", probes.ch2.x, probes.ch2.y - 11);
    }
    if (probes.ch3) {
      this.ctx.fillStyle = "hsl(25, 95%, 53%)";
      this.ctx.shadowColor = "hsl(25, 95%, 53%)";
      this.ctx.shadowBlur = 8;
      this.ctx.beginPath();
      this.ctx.arc(probes.ch3.x, probes.ch3.y - 14, 8, 0, Math.PI * 2);
      this.ctx.fill();
      this.ctx.shadowBlur = 0;
      
      this.ctx.fillStyle = "#030508";
      this.ctx.font = "bold 9px var(--font-sans)";
      this.ctx.textAlign = "center";
      this.ctx.fillText("③", probes.ch3.x, probes.ch3.y - 11);
    }
    if (probes.ch4) {
      this.ctx.fillStyle = "hsl(142, 70%, 45%)";
      this.ctx.shadowColor = "hsl(142, 70%, 45%)";
      this.ctx.shadowBlur = 8;
      this.ctx.beginPath();
      this.ctx.arc(probes.ch4.x, probes.ch4.y - 14, 8, 0, Math.PI * 2);
      this.ctx.fill();
      this.ctx.shadowBlur = 0;
      
      this.ctx.fillStyle = "#030508";
      this.ctx.font = "bold 9px var(--font-sans)";
      this.ctx.textAlign = "center";
      this.ctx.fillText("④", probes.ch4.x, probes.ch4.y - 11);
    }

    // 7b. Draw S-Parameter RF Port Markers (P1, P2, ...)
    if (sparMarkers) {
      for (const marker of sparMarkers) {
        const hue = 140 + marker.index * 30; // Verde → turquesa → naranja
        this.ctx.fillStyle = `hsla(${hue}, 90%, 60%, 0.85)`;
        this.ctx.shadowColor = `hsla(${hue}, 90%, 60%, 0.6)`;
        this.ctx.shadowBlur = 10;
        this.ctx.beginPath();
        this.ctx.arc(marker.x, marker.y - 14, 10, 0, Math.PI * 2);
        this.ctx.fill();
        this.ctx.shadowBlur = 0;
        this.ctx.fillStyle = '#030508';
        this.ctx.font = 'bold 10px var(--font-sans)';
        this.ctx.textAlign = 'center';
        this.ctx.fillText(`P${marker.index}`, marker.x, marker.y - 11);
      }
    }

    // 8. Draw CAD Selection Drag Box
    if (this.selectionStart && this.selectionEnd) {
      this.ctx.save();
      this.ctx.fillStyle = "rgba(102, 252, 241, 0.05)";
      this.ctx.strokeStyle = "rgba(102, 252, 241, 0.4)";
      this.ctx.lineWidth = 1.5;
      this.ctx.setLineDash([4, 3]);
      
      const x = Math.min(this.selectionStart.x, this.selectionEnd.x);
      const y = Math.min(this.selectionStart.y, this.selectionEnd.y);
      const w = Math.abs(this.selectionStart.x - this.selectionEnd.x);
      const h = Math.abs(this.selectionStart.y - this.selectionEnd.y);
      
      this.ctx.beginPath();
      this.ctx.roundRect(x, y, w, h, 4);
      this.ctx.fill();
      this.ctx.stroke();
      this.ctx.restore();
    }

    this.ctx.restore();
  }

  private drawWorldGrid(): void {
    const { width, height } = this.canvas;
    const topLeft = this.screenToWorld(0, 0);
    const bottomRight = this.screenToWorld(width, height);

    const startX = Math.floor(topLeft.x / this.gridSize) * this.gridSize;
    const endX = Math.ceil(bottomRight.x / this.gridSize) * this.gridSize;
    const startY = Math.floor(topLeft.y / this.gridSize) * this.gridSize;
    const endY = Math.ceil(bottomRight.y / this.gridSize) * this.gridSize;

    this.ctx.save();
    this.ctx.setTransform(this.zoom, 0, 0, this.zoom, this.offsetX, this.offsetY);
    this.ctx.fillStyle = "rgba(255, 255, 255, 0.05)";

    const dotSize = 1.5 / this.zoom;
    this.ctx.beginPath();
    for (let x = startX; x <= endX; x += this.gridSize) {
      for (let y = startY; y <= endY; y += this.gridSize) {
        this.ctx.rect(x - dotSize / 2, y - dotSize / 2, dotSize, dotSize);
      }
    }
    this.ctx.fill();
    this.ctx.restore();
  }

  private drawWires(_voltageMap: Record<string, number> = {}): void {
    this.ctx.save();
    
    for (const wire of this.wires) {
      // Find endpoints
      const fromComp = this.components.find(c => c.id === wire.from.componentId);
      const toComp = this.components.find(c => c.id === wire.to.componentId);
      
      if (!fromComp || !toComp) continue;

      const fromPins = this.getComponentPins(fromComp);
      const toPins = this.getComponentPins(toComp);
      const startPt = fromPins.find(p => p.pinIndex === wire.from.pinIndex);
      const endPt = toPins.find(p => p.pinIndex === wire.to.pinIndex);

      if (!startPt || !endPt) continue;

      const pts = wire.points;
      if (!pts || pts.length < 2) continue;

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

  private drawPins(voltageMap: Record<string, number> = {}, nodeMap: Record<string, string> = {}): void {
    this.ctx.save();

    for (const comp of this.components) {
      const pins = this.getComponentPins(comp);
      for (const pin of pins) {
        const isHovered = this.hoveredPin && 
                          this.hoveredPin.componentId === pin.componentId && 
                          this.hoveredPin.pinIndex === pin.pinIndex;
        const isActive = this.activePinForWire && 
                         this.activePinForWire.componentId === pin.componentId && 
                         this.activePinForWire.pinIndex === pin.pinIndex;

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

  private drawERCIssues(): void {
    if (this.ercIssues.length === 0) return;

    const pulseRadius = 10 + Math.sin(Date.now() / 150) * 3;

    for (const issue of this.ercIssues) {
      const comp = this.components.find(c => c.id === issue.componentId);
      if (!comp) continue;

      const isError = issue.type === "error";
      const ringColor = isError ? "hsl(0, 84%, 60%)" : "hsl(35, 92%, 55%)";
      const fillColor = isError ? "rgba(239, 68, 68, 0.2)" : "rgba(245, 158, 11, 0.2)";

      if (issue.pinIndex !== undefined) {
        // Alerta específica en un pin
        const pins = this.getComponentPins(comp);
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
    for (const comp of this.components) {
      const pins = this.getComponentPins(comp);
      for (const pin of pins) {
        const dx = worldX - pin.x;
        const dy = worldY - pin.y;
        if (dx * dx + dy * dy <= t * t) {
          return { pin, comp };
        }
      }
    }
    return null;
  }

  // --- ACTIONS & OPERATIONS ---

  public addComponent(type: ComponentInstance['type'], x: number, y: number, value: number): ComponentInstance {
    // Generate incremental ID
    const count = this.components.filter(c => c.type === type).length + 1;
    let prefix = "R";
    switch (type) {
      case 'capacitor': prefix = "C"; break;
      case 'inductor': prefix = "L"; break;
      case 'diode': prefix = "D"; break;
      case 'nmos': prefix = "M"; break;
      case 'pmos': prefix = "M"; break;
      case 'npn': prefix = "Q"; break;
      case 'pnp': prefix = "Q"; break;
      case 'vsource': prefix = "V"; break;
      case 'ground': prefix = "GND"; break;
      case 'lamp': prefix = "LP"; break;
      case 'relay': prefix = "RY"; break;
      case 'buzzer': prefix = "BZ"; break;
      case 'isource': prefix = "I"; break;
      case 'led': prefix = "LED"; break;
      case 'switch': prefix = "SW"; break;
      case 'transformer': prefix = "T"; break;
      case 'x': prefix = "X"; break;
    }
    const id = prefix === "GND" ? `GND${count}` : `${prefix}${count}`;

    const newComp: ComponentInstance = {
      id,
      type,
      value,
      x: this.snapToGrid(x),
      y: this.snapToGrid(y),
      rotation: 0,
    };

    this.components.push(newComp);
    return newComp;
  }

  public removeComponent(id: string): void {
    this.components = this.components.filter(c => c.id !== id);
    // Also remove any wires attached to this component
    this.wires = this.wires.filter(w => w.from.componentId !== id && w.to.componentId !== id);
    this.selectedComponents = this.selectedComponents.filter(c => c.id !== id);
  }

  public checkHover(worldX: number, worldY: number): void {
    this.hoveredComponent = null;
    this.hoveredPin = null;
    this.hoveredWire = null;

    // 1. Check pin hover first (takes priority)
    const hit = this.hitTestPin(worldX, worldY);
    if (hit) {
      this.hoveredPin = hit.pin;
      this.canvas.style.cursor = this.activePinForWire ? 'crosshair' : 'pointer';
      return;
    }

    // 2. Check component bounds hover
    for (const comp of this.components) {
      if (hitTestComponentAt(comp, worldX, worldY)) {
        this.hoveredComponent = comp;
        if (this.isDragging) {
          this.canvas.style.cursor = 'grabbing';
        } else if (this.activePinForWire) {
          this.canvas.style.cursor = 'crosshair';
        } else if (this.simulationActive && comp.type === 'switch') {
          this.canvas.style.cursor = 'pointer';
        } else {
          this.canvas.style.cursor = 'grab';
        }
        return;
      }
    }

    // 3. Check wire proximity hover
    for (const wire of this.wires) {
      if (!wire.points || wire.points.length < 2) continue;
      for (let i = 0; i < wire.points.length - 1; i++) {
        const p1 = wire.points[i];
        const p2 = wire.points[i + 1];
        
        let dist = Infinity;
        if (Math.abs(p1.y - p2.y) < 0.1) { // Segmento horizontal
          const minX = Math.min(p1.x, p2.x);
          const maxX = Math.max(p1.x, p2.x);
          if (worldX >= minX - 4 && worldX <= maxX + 4) {
            dist = Math.abs(worldY - p1.y);
          }
        } else if (Math.abs(p1.x - p2.x) < 0.1) { // Segmento vertical
          const minY = Math.min(p1.y, p2.y);
          const maxY = Math.max(p1.y, p2.y);
          if (worldY >= minY - 4 && worldY <= maxY + 4) {
            dist = Math.abs(worldX - p1.x);
          }
        }
        
        if (dist < 6) { // Tolerancia de proximidad al cable de 6px
          this.hoveredWire = wire;
          this.canvas.style.cursor = 'pointer';
          return;
        }
      }
    }
    this.canvas.style.cursor = 'default';
  }

  public selectComponentAt(worldX: number, worldY: number, isShift: boolean = false): ComponentInstance | null {
    let hitComp: ComponentInstance | null = null;
    for (let i = this.components.length - 1; i >= 0; i--) {
      const comp = this.components[i];
      if (hitTestComponentAt(comp, worldX, worldY)) {
        hitComp = comp;
        break;
      }
    }

    if (hitComp) {
      this.selectedWire = null; // Quitar selección de cable
      if (isShift) {
        // Modo aditivo
        const idx = this.selectedComponents.findIndex(c => c.id === hitComp!.id);
        if (idx >= 0) {
          this.selectedComponents.splice(idx, 1);
        } else {
          this.selectedComponents.push(hitComp);
        }
        this.selectedComponent = this.selectedComponents.length > 0 
          ? this.selectedComponents[this.selectedComponents.length - 1] 
          : null;
      } else {
        // Clic normal
        // Si ya pertenece al lote actual seleccionado, no vaciar el lote (para permitir arrastrar todo el grupo)
        if (!this.selectedComponents.some(c => c.id === hitComp!.id)) {
          this.selectedComponents = [hitComp];
        }
        this.selectedComponent = hitComp;
      }
      return hitComp;
    }

    // Si no golpeó ningún componente y no hay Shift, limpiar selección
    if (!isShift) {
      this.selectedComponent = null;
      this.selectedComponents = [];
      
      // Intentar seleccionar cable
      if (this.hoveredWire) {
        this.selectedWire = this.hoveredWire;
      } else {
        this.selectedWire = null;
      }
    }
    return null;
  }

  public completeBoxSelection(): void {
    if (!this.selectionStart || !this.selectionEnd) return;
    
    const x = Math.min(this.selectionStart.x, this.selectionEnd.x);
    const y = Math.min(this.selectionStart.y, this.selectionEnd.y);
    const w = Math.abs(this.selectionStart.x - this.selectionEnd.x);
    const h = Math.abs(this.selectionStart.y - this.selectionEnd.y);
    
    // Umbral mínimo para evitar clicks en el vacío
    if (w < 6 && h < 6) {
      this.selectedComponents = [];
      this.selectedComponent = null;
      this.selectedWire = null;
      this.selectionStart = null;
      this.selectionEnd = null;
      return;
    }
    
    this.selectedComponents = [];
    this.selectedWire = null;
    
    for (const comp of this.components) {
      const bounds = getComponentBounds(comp);
      const cx = bounds.x + bounds.width / 2;
      const cy = bounds.y + bounds.height / 2;
      if (cx >= x && cx <= x + w && cy >= y && cy <= y + h) {
        this.selectedComponents.push(comp);
      }
    }
    
    if (this.selectedComponents.length > 0) {
      this.selectedComponent = this.selectedComponents[this.selectedComponents.length - 1];
    } else {
      this.selectedComponent = null;
    }
    
    this.selectionStart = null;
    this.selectionEnd = null;
  }

  public startDraggingSelected(worldX: number, worldY: number): void {
    this.isDragging = true;
    this.canvas.style.cursor = 'grabbing';
    this.dragStartOffsets = {};
    
    if (this.selectedComponents.length > 0) {
      for (const comp of this.selectedComponents) {
        this.dragStartOffsets[comp.id] = {
          x: worldX - comp.x,
          y: worldY - comp.y
        };
      }
    } else if (this.selectedComponent) {
      this.dragStartOffset = {
        x: worldX - this.selectedComponent.x,
        y: worldY - this.selectedComponent.y
      };
    }
  }

  public handleDragging(worldX: number, worldY: number): void {
    if (!this.isDragging) return;

    if (this.selectedComponents.length > 0) {
      for (const comp of this.selectedComponents) {
        const offset = this.dragStartOffsets[comp.id];
        if (offset) {
          comp.x = this.snapToGrid(worldX - offset.x);
          comp.y = this.snapToGrid(worldY - offset.y);
        }
      }
    } else if (this.selectedComponent) {
      this.selectedComponent.x = this.snapToGrid(worldX - this.dragStartOffset.x);
      this.selectedComponent.y = this.snapToGrid(worldY - this.dragStartOffset.y);
    }
    
    this.syncWireConnections();
  }

  public stopDragging(): void {
    this.isDragging = false;
    this.canvas.style.cursor = 'default';
  }

  public syncWireConnections(): void {
    for (const wire of this.wires) {
      const fromComp = this.components.find(c => c.id === wire.from.componentId);
      const toComp = this.components.find(c => c.id === wire.to.componentId);
      if (!fromComp || !toComp) continue;

      const fromPins = this.getComponentPins(fromComp);
      const toPins = this.getComponentPins(toComp);
      const startPt = fromPins.find(p => p.pinIndex === wire.from.pinIndex);
      const endPt = toPins.find(p => p.pinIndex === wire.to.pinIndex);
      if (!startPt || !endPt) continue;

      wire.points = this.generateOrthogonalPath(startPt, endPt);
    }
  }

  public connectPins(from: PinInstance, to: PinInstance): void {
    if (from.componentId === to.componentId) return;

    const exists = this.wires.some(
      w => 
        (w.from.componentId === from.componentId && w.from.pinIndex === from.pinIndex &&
         w.to.componentId === to.componentId && w.to.pinIndex === to.pinIndex) ||
        (w.from.componentId === to.componentId && w.from.pinIndex === to.pinIndex &&
         w.to.componentId === from.componentId && w.to.pinIndex === from.pinIndex)
    );

    if (exists) return;

    const id = `wire_${from.componentId}_p${from.pinIndex}_to_${to.componentId}_p${to.pinIndex}`;
    this.wires.push({
      id,
      from: { componentId: from.componentId, pinIndex: from.pinIndex },
      to: { componentId: to.componentId, pinIndex: to.pinIndex },
      points: []
    });
    this.syncWireConnections();
  }

  public rotateSelectedComponent(): void {
    if (this.selectedComponents.length > 0) {
      for (const comp of this.selectedComponents) {
        comp.rotation = (comp.rotation + 90) % 360;
      }
    } else if (this.selectedComponent) {
      this.selectedComponent.rotation = (this.selectedComponent.rotation + 90) % 360;
    }
    this.syncWireConnections();
  }

  public rotateSelectedByDegrees(deltaDegrees: number): void {
    if (this.selectedComponents.length > 0) {
      for (const comp of this.selectedComponents) {
        comp.rotation = (comp.rotation + deltaDegrees + 360) % 360;
      }
    } else if (this.selectedComponent) {
      this.selectedComponent.rotation = (this.selectedComponent.rotation + deltaDegrees + 360) % 360;
    }
    this.syncWireConnections();
  }

  public mirrorSelectedComponent(): void {
    if (this.selectedComponents.length > 0) {
      for (const comp of this.selectedComponents) {
        comp.mirror = !comp.mirror;
      }
    } else if (this.selectedComponent) {
      this.selectedComponent.mirror = !this.selectedComponent.mirror;
    }
    this.syncWireConnections();
  }

  public duplicateSelected(): void {
    if (this.selectedComponents.length > 0) {
      const newSelection: ComponentInstance[] = [];
      for (const comp of this.selectedComponents) {
        const dup = this.addComponent(comp.type, comp.x + 40, comp.y + 40, Number(comp.value) || 0);
        dup.rotation = comp.rotation;
        dup.mirror = comp.mirror;
        dup.wiperPosition = comp.wiperPosition;
        dup.lux = comp.lux;
        dup.temperatureCelsius = comp.temperatureCelsius;
        dup.waveType = comp.waveType;
        dup.amplitude = comp.amplitude;
        dup.frequency = comp.frequency;
        dup.offset = comp.offset;
        dup.dutyCycle = comp.dutyCycle;
        newSelection.push(dup);
      }
      for (const comp of this.selectedComponents) {
        comp.selected = false;
      }
      this.selectedComponents = newSelection;
      for (const comp of this.selectedComponents) {
        comp.selected = true;
      }
    } else if (this.selectedComponent) {
      const comp = this.selectedComponent;
      const dup = this.addComponent(comp.type, comp.x + 40, comp.y + 40, Number(comp.value) || 0);
      dup.rotation = comp.rotation;
      dup.mirror = comp.mirror;
      dup.wiperPosition = comp.wiperPosition;
      dup.lux = comp.lux;
      dup.temperatureCelsius = comp.temperatureCelsius;
      dup.waveType = comp.waveType;
      dup.amplitude = comp.amplitude;
      dup.frequency = comp.frequency;
      dup.offset = comp.offset;
      dup.dutyCycle = comp.dutyCycle;
      this.selectedComponent = dup;
    }
  }

  public removeSelected(): void {
    // 1. Borrar cable seleccionado individual
    if (this.selectedWire) {
      this.wires = this.wires.filter(w => w.id !== this.selectedWire!.id);
      this.selectedWire = null;
      return;
    }

    // 2. Borrar componentes seleccionados en lote
    if (this.selectedComponents.length > 0) {
      for (const comp of this.selectedComponents) {
        this.removeComponent(comp.id);
      }
      this.selectedComponents = [];
      this.selectedComponent = null;
    } else if (this.selectedComponent) {
      this.removeComponent(this.selectedComponent.id);
      this.selectedComponent = null;
    }
  }

  public fitAll(): void {
    if (this.components.length === 0) return;

    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
    for (const comp of this.components) {
      const bounds = getComponentBounds(comp);
      minX = Math.min(minX, bounds.x);
      minY = Math.min(minY, bounds.y);
      maxX = Math.max(maxX, bounds.x + bounds.width);
      maxY = Math.max(maxY, bounds.y + bounds.height);
    }

    for (const wire of this.wires) {
      for (const pt of wire.points) {
        minX = Math.min(minX, pt.x);
        minY = Math.min(minY, pt.y);
        maxX = Math.max(maxX, pt.x);
        maxY = Math.max(maxY, pt.y);
      }
    }

    const margin = 40;
    minX -= margin;
    minY -= margin;
    maxX += margin;
    maxY += margin;

    const canvasW = this.canvas.width;
    const canvasH = this.canvas.height;
    const worldW = maxX - minX;
    const worldH = maxY - minY;
    if (worldW <= 0 || worldH <= 0 || canvasW <= 0 || canvasH <= 0) return;

    const zoomX = canvasW / worldW;
    const zoomY = canvasH / worldH;
    this.zoom = Math.min(zoomX, zoomY, this.maxZoom);
    this.zoom = Math.max(this.zoom, this.minZoom);

    this.offsetX = (canvasW - (minX + maxX) * this.zoom) / 2;
    this.offsetY = (canvasH - (minY + maxY) * this.zoom) / 2;
  }

  public resetCameraToCircuit(): void {
    if (this.components.length === 0) {
      this.zoom = 1.0;
      this.offsetX = this.canvas.width / 2;
      this.offsetY = this.canvas.height / 2;
      this.render();
      return;
    }

    let minX = Infinity;
    let minY = Infinity;
    let maxX = -Infinity;
    let maxY = -Infinity;

    for (const comp of this.components) {
      const bounds = getComponentBounds(comp);
      minX = Math.min(minX, bounds.x);
      minY = Math.min(minY, bounds.y);
      maxX = Math.max(maxX, bounds.x + bounds.width);
      maxY = Math.max(maxY, bounds.y + bounds.height);
    }

    const margin = 40;
    minX -= margin;
    minY -= margin;
    maxX += margin;
    maxY += margin;

    const canvasW = this.canvas.width;
    const canvasH = this.canvas.height;
    const worldW = maxX - minX;
    const worldH = maxY - minY;

    if (worldW <= 0 || worldH <= 0 || canvasW <= 0 || canvasH <= 0) return;

    const zoomX = canvasW / worldW;
    const zoomY = canvasH / worldH;
    
    let targetZoom = Math.min(zoomX, zoomY, this.maxZoom);
    targetZoom = Math.max(targetZoom, this.minZoom);

    this.zoom = targetZoom;
    this.offsetX = (canvasW - (minX + maxX) * this.zoom) / 2;
    this.offsetY = (canvasH - (minY + maxY) * this.zoom) / 2;
    
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
