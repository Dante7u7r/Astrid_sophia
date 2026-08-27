import { type McuRuntime } from "./simulation/mcu-runtime";
import { type McuSpiceBridge } from "./simulation/mcu-spice-bridge";
import { globalComponentRegistry } from "./components";
import { getComponentPins as resolveComponentPins } from "./canvas/component_pins";
import { CanvasSceneRenderer } from "./canvas/canvas_scene_renderer";
import { CanvasOverlayRenderer } from "./canvas/canvas_overlay_renderer";
import { evaluateRealtimeErcIssues } from "./simulation/erc_graph";
import {
  clampCameraOffsets,
  fitBoundsToViewport,
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
  autoRouteCircuitWires,
  generateSmartOrthogonalPath,
  runCircuitDRC,
  type DRCRulesConfig,
  type DRCReport,
  type MultiNetRouteOptions,
  type RoutedSegment,
  type RoutingLayer,
  type Via,
} from "./canvas/smart_wire_router";
import {
  computeSmartAlignment,
  type AlignmentGuide,
} from "./canvas/alignment_guidelines";
import { simplifyOrthogonalWirePath } from "./canvas/wire_cleanup";
import {
  applyDrag,
  completeBoxSelection,
  createDragOffsets,
  selectComponentAt,
} from "./canvas/selection_model";
import {
  connectPins as connectWirePins,
  connectPinToWire as connectWirePinToWire,
  dragJunctionNode,
  dragWireSegment,
  dragWireVertex,
  syncWireConnections as syncWireModelConnections,
  type WireHandleHit,
  type WireHandleType,
  type WireSegmentIntersection,
} from "./canvas/wiring_model";
import {
  createComponent,
  duplicateSelection,
  mirrorSelection,
  mirrorSelectionVertical,
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
  connectPinToWire as connectWirePinToWire,
  findHoveredWire,
  findWireSegmentIntersection,
  syncWireConnections as syncWireModelConnections,
  wirePathIntersects,
  wireExists,
  type WireSegmentIntersection,
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
export {
  SchematicSpatialIndex,
  SpatialHashGrid,
  getWireBounds,
} from "./canvas/spatial_index";

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
  type: 'resistor' | 'capacitor' | 'inductor' | 'diode' | 'zener_diode' | 'schottky_diode' | 'fuse' | 'vsource' | 'ground' | 'nmos' | 'opamp' | 'opamp_ideal' | 'pmos' | 'npn' | 'pnp' | 'igbt' | 'lamp' | 'relay' | 'buzzer' | 'mcu_8051' | 'mcu_avr' | 'mcu_pic16' | 'arduino_uno' | 'esp32' | 'raspberry_pi_pico' | 'isource' | 'led' | 'transformer' | 'switch' | 'switch_spdt' | 'switch_dpdt' | 'pushbutton' | 'dc_motor' | 'servo_motor' | 'stepper_motor' | 'speaker' | 'solenoid' | 'ssr' | 'seven_segment' | 'lcd_16x2' | 'x' | 'potentiometer' | 'ldr' | 'thermistor' | 'dmm' | 'and_gate' | 'or_gate' | 'not_gate' | 'nand_gate' | 'nor_gate' | 'xor_gate' | 'opto' | 'njf' | 'pjf' | 'bsim3nmos' | 'bsim3pmos' | 'bsim4nmos' | 'bsim4pmos' | 'net_label' | 'text_note' | 'power_port' | 'vcvs' | 'vccs' | 'ccvs' | 'cccs' | 'flipflop_d' | 'flipflop_jk' | 'bcd_to_7seg' | 'shift_register_595' | 'ic_4017' | 'ic_7490' | 'ic_74193' | 'ic_74138' | 'ic_74151' | 'scr' | 'triac' | 'diac' | 'tl431' | 'wattmeter' | 'logic_probe' | 'pulse_generator' | 'frequency_counter' | 'stb_probe';
  value: number | string;
  w?: number;
  l?: number;
  igbtKp?: number;
  igbtAlpha?: number;
  igbtTau?: number;
  igbtWb?: number;
  igbtCge?: number;
  igbtCgc?: number;
  dmmValue?: string;
  wiperPosition?: number; // Cursor del potenciómetro (0.01 - 0.99)
  lux?: number; // Iluminación en Luxes para LDR (1 - 10000)
  temperatureCelsius?: number; // Temperatura del termistor (-50 - 150 C)
  isBlown?: boolean; // Estado de fusible fundido
  x: number;
  y: number;
  rotation: number; // 0, 90, 180, 270 degrees
  selected?: boolean;
  mirror?: boolean;
  mirrorY?: boolean;
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
  label?: string; // Etiqueta de texto o nombre de red
  terminalType?: "signal" | "power" | "ground" | "input" | "output" | "bidirectional" | "generator" | "bus_tap" | "test_point" | "no_connect"; // Tipo de terminal EDA (Proteus / Altium / KiCad)
  terminalStyle?: "standard" | "arrow" | "circle" | "bar" | "triangle" | "earth" | "chassis" | "digital" | "analog"; // Estilo visual del terminal / masa / riel
  voltage?: number; // Tensión asignada al terminal de alimentación (V)
  fontSize?: number; // Tamaño de fuente para notas
  textColor?: string; // Color personalizado de texto
  noteTheme?: "card" | "plain" | "warning" | "info" | "success" | "outline"; // Estilo visual de la nota
  
  // MCU properties
  firmwareHex?: string; // HEX content
  firmware?: Uint8Array; // compiled binary
  esp32SourceCode?: string; // Código fuente C++/Arduino para ESP32
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
  spiceNetlist?: string;
  subcircuitTabId?: string;
  subcircuitName?: string;
  isSubcircuitBlock?: boolean;
  params?: Record<string, number | string>;
  // Nombre del modelo comercial o subcircuito
  modelName?: string;
  // Etiquetas personalizadas de pines
  pinLabels?: Record<number, string>;
  // Número dinámico de pines para subcircuito genérico (defecto 4)
  pinCount?: number;

  // Parámetros avanzados de Fuentes (RF / AM / Fase / Resistencia interna / Barrido AC)
  phase?: number; // Fase inicial en grados (0 - 360)
  modFrequency?: number; // Frecuencia de modulación AM (Hz)
  modIndex?: number; // Índice de modulación AM (0.0 - 1.0)
  sequentialState?: { q?: boolean; qNot?: boolean; prevClk?: boolean; shiftReg?: number; latchReg?: number; [key: string]: unknown };
  holdingCurrent?: number; // Corriente de mantenimiento Ih (A)
  gateTriggerVoltage?: number; // Tensión de disparo de puerta Vgt (V)
  gateTriggerCurrent?: number; // Corriente de disparo de puerta Igt (A)
  breakoverVoltage?: number; // Tensión de ruptura directa Vbo (V)
  refVoltage?: number; // Tensión de referencia interna Vref (V)
  powerState?: { isLatched?: boolean; [key: string]: unknown };
  activePower?: number; // Potencia activa W (Vatímetro)
  apparentPower?: number; // Potencia aparente VA (Vatímetro)
  powerFactor?: number; // Factor de potencia cos(phi) (Vatímetro)
  frequencyReading?: number; // Frecuencia medida Hz (Frecuencímetro)
  periodReading?: number; // Periodo medido s (Frecuencímetro)
  dutyCycleReading?: number; // Ciclo de trabajo medido % (Frecuencímetro)
  logicState?: "1" | "0" | "X"; // Estado lógico actual (Sonda Lógica)
  pulseMode?: "single" | "continuous"; // Modo de disparo del Inyector de Pulsos
  sourceResistance?: number; // Resistencia interna de la fuente Rs (Ohms)
  acMag?: number; // Magnitud AC para barridos en frecuencia / Bode (V o A)
  acPhase?: number; // Fase AC en grados para barridos en frecuencia / Bode

  // Parámetros de Componentes Pasivos (R, C, L, Pot)
  tolerance?: number; // Tolerancia de fabricación (% ej. 1, 5, 10)
  powerRating?: number; // Potencia nominal de disipación (W ej. 0.25, 0.5, 1.0)
  voltageRating?: number; // Tensión máxima admisible (V ej. 16, 25, 50, 100, 400)
  esr?: number; // Resistencia Serie Equivalente (Ohms)
  cpar?: number; // Capacitancia parásita en paralelo Cp (F)
  tc1?: number; // Coeficiente de temperatura de primer orden TC1 (ppm/°C)
  rleak?: number; // Resistencia de fuga dieléctrica Rleak (Ohms)
  initialCondition?: number; // Condición inicial transitoria .IC (V o A)
  expression?: string; // Expresión paramétrica matemática EDA ej. {R_LOAD/2}
  dielectricType?: "ceramic" | "electrolytic" | "tantalum" | "film"; // Tipo de dieléctrico
  dcResistance?: number; // Resistencia de devanado DCR (Ohms)
  currentRating?: number; // Corriente máxima de trabajo (A)
  isat?: number; // Corriente de saturación magnética Isat (A)
  potTaper?: "linear" | "log" | "antilog"; // Curva de variación del potenciómetro

  // Parámetros de Diodos y Optoelectrónica (LED)
  ledColor?: "red" | "green" | "blue" | "yellow" | "white" | "orange" | "ir" | "uv";
  forwardVoltage?: number; // Tensión directa Vf (V)
  maxCurrent?: number; // Corriente máxima If_max (mA)
  diodeBv?: number; // Tensión de ruptura Zener / Breakdown (V ej. 3.3, 5.1, 12.0)

  // Parámetros físicos SPICE de semiconductores
  diodeIs?: number;
  diodeRs?: number;
  diodeN?: number;
  diodeCjo?: number;
  diodeTt?: number;
  diodeIbv?: number;
  bjtIs?: number;
  bjtBf?: number;
  bjtVaf?: number;
  bjtRb?: number;
  bjtRc?: number;
  bjtCje?: number;
  bjtCjc?: number;
  mosVth?: number;
  mosRon?: number;
  mosCgs?: number;
  mosCgd?: number;
  jfetVto?: number;
  jfetBeta?: number;
  jfetLambda?: number;
  jfetCgs?: number;
  jfetCgd?: number;
  opampAol?: number;
  opampGbw?: number;
  opampSr?: number;
  opampRin?: number;
  opampRout?: number;
  opampVos?: number;
  opampIb?: number;
  opampIsc?: number;
  opampIq?: number;
  opampVdrop?: number;
  opampIos?: number;
  opampCmrr?: number;
  opampPsrr?: number;
  opampEn?: number;
  opampIn?: number;
  opampFc?: number;

  // Parámetros de compuertas lógicas digitales y de señal mixta
  gateInputs?: number; // Número de entradas (2, 3, 4, 8)
  logicFamily?: "ttl" | "cmos5v" | "cmos3v3" | "lvcmos1v8" | "cmos12v" | "custom";
  propagationDelay?: number; // Tiempo de propagación tpd (s)
  schmittTrigger?: boolean; // Entrada con histéresis Schmitt
  openCollector?: boolean; // Salida colector abierto / open-drain
  gateTrise?: number;
  gateTfall?: number;
  gateRout?: number;
  gateVhigh?: number;
  gateVlow?: number;
  riseDelay?: number;
  fallDelay?: number;
  symbolStandard?: "IEEE" | "IEC";

  // Parámetros de actuadores, motores y displays
  motorRpm?: number;
  motorAngle?: number;
  servoAngle?: number;
  stepperSteps?: number;
  speakerPower?: number;
  solenoidPosition?: number;
  solenoidEngaged?: boolean;
  ssrActive?: boolean;
  displayChar?: string;
  displayLine2?: string;
  segmentStates?: Record<string, boolean>;
  isMomentary?: boolean;
  switchPosition?: number;
  buzzerActive?: boolean;
  buzzerMode?: "active" | "passive";
  lampVoltage?: number;
  lampBurned?: boolean;
  sevenSegmentType?: "common_anode" | "common_cathode";

  // Layout de subcircuitos SPICE (DIP, TO-220, Op-Amp)
  subcircuitLayout?: "to220" | "opamp_5p" | "dip" | "generic_box";
  instanceParams?: Record<string, number | string>;
}

export interface PinInstance {
  componentId: string;
  pinIndex: number;
  x: number; // World X
  y: number; // World Y
  label?: string;
  name?: string;
  isJunction?: boolean;
  junctionPos?: Point2D;
}

export interface WireEndpoint {
  componentId: string;
  pinIndex: number;
  isJunction?: boolean;
  junctionPos?: Point2D;
}

export interface WireInstance {
  id: string;
  from: WireEndpoint;
  to: WireEndpoint;
  points: Point2D[]; // Path points for rendering
  label?: string;
  color?: string;
  customPath?: boolean;
  layer?: RoutingLayer;
  vias?: Via[];
  routedSegments?: RoutedSegment[];
  isBus?: boolean;
  busWidth?: number;
}

export interface WireDragState {
  wire: WireInstance;
  handleType: WireHandleType;
  handleIndex: number;
  initialPoints: Point2D[];
  dragStartWorld: Point2D;
}

export class CanvasOrchestrator {
  private canvas: HTMLCanvasElement;
  public simulationActive: boolean = false;
  public simulationPaused: boolean = false;
  public transientResults?: readonly { time?: number; nodeVoltages?: Record<string, number>; branchCurrents?: Record<string, number> }[];
  private readonly sceneRenderer: CanvasSceneRenderer;
  private overlayRenderer: CanvasOverlayRenderer | null = null;

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
  public hoveredWireHandle: WireHandleHit | null = null;
  public hoveredWireSnapPoint: WireSegmentIntersection | null = null;
  
  public selectedComponent: ComponentInstance | null = null; // Mantenido para compatibilidad e indicador principal
  public selectedComponents: ComponentInstance[] = [];
  public selectedWire: WireInstance | null = null;
  public selectedWires: WireInstance[] = [];
  
  public activePinForWire: PinInstance | null = null;
  public tempWireEnd: Point2D | null = null;
  public ercIssues: { componentId: string; type: "error" | "warning"; message: string; pinIndex?: number }[] = [];
  
  public isDragging: boolean = false;
  public isDraggingWireHandle: boolean = false;
  public activeWireDrag: WireDragState | null = null;
  private dragStartOffset: Point2D = { x: 0, y: 0 };
  private dragStartOffsets: Record<string, Point2D> = {};
  private dragInitialPositions: Map<string, Point2D> = new Map();

  // Caja de Selección CAD
  public selectionStart: Point2D | null = null;
  public selectionEnd: Point2D | null = null;
  public activeAlignmentGuides: AlignmentGuide[] = [];
  public showWireLabels: boolean = false;
  public currentFlowMode: "conventional" | "electron" = "conventional";
  public currentAnimationSpeed: number = 1.0;
  public showCurrentAnimation: boolean = true;
  public showThermalHeatmap: boolean = true;
  public showReactiveFields: boolean = true;
  public showTelemetryHud: boolean = true;
  public symbolStandard: "IEEE" | "IEC" = "IEEE";

  public setSymbolStandard(std: "IEEE" | "IEC"): void {
    if (this.symbolStandard !== std) {
      this.symbolStandard = std;
      this.render();
    }
  }

  constructor(canvas: HTMLCanvasElement, overlayCanvas?: HTMLCanvasElement | null) {
    this.canvas = canvas;
    const context = canvas.getContext("2d");
    if (!context) throw new Error("Could not acquire 2D rendering context");
    this.sceneRenderer = new CanvasSceneRenderer(canvas, context, this);
    if (overlayCanvas) {
      this.attachOverlayCanvas(overlayCanvas);
    }
  }

  public attachOverlayCanvas(overlayCanvas: HTMLCanvasElement): void {
    this.overlayRenderer = new CanvasOverlayRenderer(overlayCanvas, this);
    this.sceneRenderer.hasOverlayRenderer = true;
  }

  public hasLayeredRendering(): boolean {
    return this.overlayRenderer !== null;
  }

  public updateRealtimeErc(): void {
    if (this.components.length === 0) {
      this.ercIssues = [];
      return;
    }
    this.ercIssues = evaluateRealtimeErcIssues(
      this.components,
      this.wires,
      comp => this.getComponentPins(comp),
    );
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

  public generateOrthogonalPath(start: Point2D, end: Point2D, fromCompId?: string, toCompId?: string): Point2D[] {
    const obstacles: BoundingBox[] = this.components
      .filter((c) => c.id !== fromCompId && c.id !== toCompId)
      .map((comp) => globalComponentRegistry.getBounds(comp));

    return generateSmartOrthogonalPath(start, end, this.gridSize, obstacles);
  }

  /**
   * Ejecuta el auto-enrutamiento multi-red ortogonal con asignación de capas y vías para todos los cables.
   */
  public autoRouteAllWires(options?: MultiNetRouteOptions): WireInstance[] {
    this.wires = autoRouteCircuitWires(this.components, this.wires, {
      gridSize: this.gridSize,
      ...options,
    });
    return this.wires;
  }

  /**
   * Ejecuta la verificación de reglas de diseño (DRC) en el circuito esquemático actual.
   */
  public validateDRC(rules?: Partial<DRCRulesConfig>): DRCReport {
    return runCircuitDRC(this.components, this.wires, rules);
  }

  public get drcViolations() {
    return this.validateDRC().violations;
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

  /**
   * Ajusta y centra automáticamente todos los componentes y cables del esquema
   * dentro del área visible del canvas respetando los límites de zoom.
   */
  public fitToScreen(margin = 40): boolean {
    const bounds = getCircuitBounds(this.components, this.wires, margin);
    if (!bounds) return false;
    const viewport = {
      width: this.canvas.clientWidth || this.canvas.width || 800,
      height: this.canvas.clientHeight || this.canvas.height || 600,
    };
    const nextCamera = fitBoundsToViewport(bounds, viewport, {
      minZoom: this.minZoom,
      maxZoom: 1.2,
    });
    if (!nextCamera) return false;
    this.zoom = nextCamera.zoom;
    this.offsetX = nextCamera.offsetX;
    this.offsetY = nextCamera.offsetY;
    return true;
  }

  // --- DRAWING / RENDERING ---

  public lastProbes: ProbeBadges = {};

  public renderBase(
    voltageMap: Record<string, number> = {},
    probes: ProbeBadges = {},
    nodeMap: Record<string, string> = {},
    sparMarkers?: SParameterMarker[],
    branchCurrents: Record<string, number> = {},
  ): void {
    this.lastProbes = probes;
    this.sceneRenderer.render(voltageMap, probes, nodeMap, sparMarkers, branchCurrents);
  }

  public renderOverlay(
    voltageMap: Record<string, number> = {},
    branchCurrents: Record<string, number> = {},
    now?: number,
  ): void {
    this.overlayRenderer?.renderOverlay(voltageMap, branchCurrents, now);
  }

  public clearOverlay(): void {
    this.overlayRenderer?.clear();
  }

  public render(
    voltageMap: Record<string, number> = {},
    probes: ProbeBadges = {},
    nodeMap: Record<string, string> = {},
    sparMarkers?: SParameterMarker[],
    branchCurrents: Record<string, number> = {},
  ): void {
    this.lastProbes = probes;
    this.renderBase(voltageMap, probes, nodeMap, sparMarkers, branchCurrents);
    if (this.overlayRenderer) {
      this.renderOverlay(voltageMap, branchCurrents);
    }
  }

  public hitTestProbe(worldX: number, worldY: number): "CH1" | "CH2" | "CH3" | "CH4" | null {
    const probeEntries: [keyof ProbeBadges, "CH1" | "CH2" | "CH3" | "CH4"][] = [
      ["ch1", "CH1"],
      ["ch2", "CH2"],
      ["ch3", "CH3"],
      ["ch4", "CH4"],
    ];
    for (const [key, ch] of probeEntries) {
      const pt = this.lastProbes[key];
      if (!pt) continue;
      // Badge rectangle: width 28, height 15, centered at pt.x, top at pt.y - 23
      const inBadge = worldX >= pt.x - 18 && worldX <= pt.x + 18 && worldY >= pt.y - 28 && worldY <= pt.y - 2;
      const nearTip = Math.hypot(worldX - pt.x, worldY - pt.y) <= 15;
      if (inBadge || nearTip) {
        return ch;
      }
    }
    return null;
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
      this.wires,
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
    this.sceneRenderer.spatialIndex.ensureUpdated(this.components, this.wires);
    const hover = resolveHoverState(
      this.components,
      this.wires,
      (component) => this.getComponentPins(component),
      worldX,
      worldY,
      {
        activePinForWire: this.activePinForWire,
        isDragging: this.isDragging || this.isDraggingWireHandle,
        simulationActive: this.simulationActive,
        pinThreshold: this.getPinHitThreshold(),
      },
      this.sceneRenderer.spatialIndex,
    );
    this.hoveredComponent = hover.hoveredComponent;
    this.hoveredPin = hover.hoveredPin;
    this.hoveredWire = hover.hoveredWire;
    this.hoveredWireHandle = hover.hoveredWireHandle;
    this.hoveredWireSnapPoint = hover.hoveredWireSnapPoint;
    this.canvas.style.cursor = hover.cursor;
  }

  public startDraggingWireHandle(hit: WireHandleHit, worldPt: Point2D): void {
    this.isDraggingWireHandle = true;
    this.canvas.style.cursor = hit.type === 'segment' ? 'ns-resize' : 'move';
    this.activeWireDrag = {
      wire: hit.wire,
      handleType: hit.type,
      handleIndex: hit.index,
      initialPoints: hit.wire.points.map(p => ({ ...p })),
      dragStartWorld: { ...worldPt },
    };
  }

  public handleWireHandleDragging(worldPt: Point2D): void {
    if (!this.activeWireDrag) return;
    const deltaX = worldPt.x - this.activeWireDrag.dragStartWorld.x;
    const deltaY = worldPt.y - this.activeWireDrag.dragStartWorld.y;

    if (this.activeWireDrag.handleType === 'junction') {
      const snapped = this.snapPointToGrid(worldPt);
      dragJunctionNode(this.wires, this.activeWireDrag.dragStartWorld, snapped);
      this.activeWireDrag.dragStartWorld = { ...snapped };
      this.syncWireConnections();
    } else if (this.activeWireDrag.handleType === 'vertex') {
      const snapped = this.snapPointToGrid(worldPt);
      this.activeWireDrag.wire.points = dragWireVertex(
        this.activeWireDrag.initialPoints,
        this.activeWireDrag.handleIndex,
        snapped,
      );
      this.activeWireDrag.wire.customPath = true;
    } else {
      const snappedX = Math.round(deltaX / this.gridSize) * this.gridSize;
      const snappedY = Math.round(deltaY / this.gridSize) * this.gridSize;
      this.activeWireDrag.wire.points = dragWireSegment(
        this.activeWireDrag.initialPoints,
        this.activeWireDrag.handleIndex,
        snappedX,
        snappedY,
      );
      this.activeWireDrag.wire.customPath = true;
    }
  }

  public stopWireHandleDragging(): boolean {
    let hasChanged = false;
    if (this.activeWireDrag && this.activeWireDrag.wire.points) {
      this.activeWireDrag.wire.points = simplifyOrthogonalWirePath(this.activeWireDrag.wire.points);
      const init = this.activeWireDrag.initialPoints;
      const curr = this.activeWireDrag.wire.points;
      if (init.length !== curr.length || init.some((p, i) => p.x !== curr[i].x || p.y !== curr[i].y)) {
        hasChanged = true;
      }
    }
    this.isDraggingWireHandle = false;
    this.activeWireDrag = null;
    this.canvas.style.cursor = 'default';
    return hasChanged;
  }

  public selectComponentAt(worldX: number, worldY: number, isShift: boolean = false): ComponentInstance | null {
    this.sceneRenderer.spatialIndex.ensureUpdated(this.components, this.wires);
    const result = selectComponentAt(
      this.components,
      {
        selectedComponent: this.selectedComponent,
        selectedComponents: this.selectedComponents,
        selectedWire: this.selectedWire,
        selectedWires: this.selectedWires,
      },
      this.hoveredWire,
      worldX,
      worldY,
      isShift,
      this.sceneRenderer.spatialIndex,
    );
    this.selectedComponent = result.selectedComponent;
    this.selectedComponents = result.selectedComponents;
    this.selectedWire = result.selectedWire;
    this.selectedWires = result.selectedWires;
    return result.hitComponent;
  }
  public completeBoxSelection(): void {
    const result = completeBoxSelection(this.components, this.wires, this.selectionStart, this.selectionEnd);
    if (result) {
      this.selectedComponent = result.selectedComponent;
      this.selectedComponents = result.selectedComponents;
      this.selectedWire = result.selectedWire;
      this.selectedWires = result.selectedWires;
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
    this.dragInitialPositions = new Map();
    const list = this.selectedComponents.length > 0
      ? this.selectedComponents
      : (this.selectedComponent ? [this.selectedComponent] : []);
    for (const c of list) {
      this.dragInitialPositions.set(c.id, { x: c.x, y: c.y });
    }
  }

  public hasSelectedMovedDuringDrag(): boolean {
    if (!this.dragInitialPositions || this.dragInitialPositions.size === 0) return false;
    const list = this.selectedComponents.length > 0
      ? this.selectedComponents
      : (this.selectedComponent ? [this.selectedComponent] : []);
    for (const c of list) {
      const init = this.dragInitialPositions.get(c.id);
      if (init && (init.x !== c.x || init.y !== c.y)) {
        return true;
      }
    }
    return false;
  }
  public handleDragging(worldX: number, worldY: number): void {
    if (!this.isDragging) return;

    const dragging = this.selectedComponents.length > 0
      ? this.selectedComponents
      : (this.selectedComponent ? [this.selectedComponent] : []);

    let alignmentAdjustment: Point2D = { x: 0, y: 0 };
    if (dragging.length > 0) {
      const primary = dragging[0];
      const offset = this.dragStartOffsets[primary.id] ?? this.dragStartOffset;
      const rawTentativeX = this.snapToGrid(worldX - offset.x);
      const rawTentativeY = this.snapToGrid(worldY - offset.y);

      const alignment = computeSmartAlignment(
        dragging,
        this.components,
        { x: rawTentativeX, y: rawTentativeY },
        {
          threshold: 8,
          resolvePins: (comp) => this.getComponentPins(comp),
        },
      );
      this.activeAlignmentGuides = alignment.guides;
      alignmentAdjustment = alignment.adjustedOffset;
    } else {
      this.activeAlignmentGuides = [];
    }

    applyDrag(
      this.selectedComponents,
      this.selectedComponent,
      this.dragStartOffsets,
      this.dragStartOffset,
      { x: worldX, y: worldY },
      this.gridSize,
      alignmentAdjustment,
    );
    this.syncWireConnections();
  }
  public stopDragging(): void {
    this.isDragging = false;
    this.activeAlignmentGuides = [];
    this.dragInitialPositions.clear();
    this.canvas.style.cursor = 'default';
  }

  public syncWireConnections(): void {
    syncWireModelConnections(
      this.components,
      this.wires,
      (component) => this.getComponentPins(component),
      (start, end, fromId, toId) => this.generateOrthogonalPath(start, end, fromId, toId),
    );
  }

  public updateWireConnections(): void {
    this.syncWireConnections();
  }

  public addWire(points: Point2D[], from?: WireEndpoint, to?: WireEndpoint): WireInstance {
    const wire: WireInstance = {
      id: `w_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`,
      points,
      from: from ?? { componentId: "", pinIndex: 0 },
      to: to ?? { componentId: "", pinIndex: 0 },
    };
    this.wires.push(wire);
    this.syncWireConnections();
    return wire;
  }

  public connectPins(from: PinInstance, to: PinInstance): void {
    if (connectWirePins(this.wires, from, to)) {
      this.syncWireConnections();
    }
  }

  public connectPinToWire(from: PinInstance, targetWire: WireInstance, splitPoint: Point2D): boolean {
    const success = connectWirePinToWire(this.wires, from, targetWire, splitPoint);
    if (success) {
      this.syncWireConnections();
    }
    return success;
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

  public mirrorSelectedComponentVertical(): void {
    mirrorSelectionVertical(this.selectedComponents, this.selectedComponent);
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
      this.selectedWires,
    );
    this.components = result.components;
    this.wires = result.wires;
    this.selectedWire = result.selectedWire;
    this.selectedWires = result.selectedWires;
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

  /**
   * Centra el lienzo sobre un componente específico, lo selecciona y actualiza la escena.
   */
  public focusComponent(componentId: string): boolean {
    const comp = this.components.find((c) => c.id === componentId);
    if (!comp) return false;

    this.selectedComponents = [comp];
    this.selectedComponent = comp;
    this.selectedWire = null;

    const width = this.canvas.clientWidth || 800;
    const height = this.canvas.clientHeight || 600;

    this.offsetX = width / 2 - comp.x * this.zoom;
    this.offsetY = height / 2 - comp.y * this.zoom;
    this.render();
    return true;
  }
}
