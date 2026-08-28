import {
  findDuplicateComponentIds,
  isValidComponentId,
  type ComponentInstance,
  type WireInstance,
  type WireEndpoint,
} from "../canvas_orchestrator";
import {
  isJunctionEndpoint,
  extractJunctionPosFromId,
} from "../canvas/wire_identity";
import type { AnalysisMode } from "../ui/simulation_controls";
import { normalizeDmmMode } from "../simulation/dmm";
import {
  CircuitFileValidationError,
  finiteInteger,
  finiteNumber,
  isRecord,
  nullableString,
  parsePoint,
} from "./circuit_file_validators";

export const CURRENT_CIRCUIT_FILE_VERSION = "3.0";

export interface CircuitViewport {
  zoom: number;
  offsetX: number;
  offsetY: number;
}

export interface PersistedSimulationSettings {
  dt: number;
  tolerance: number;
  maxIterations: number;
  transientDuration?: number;
}

export interface PersistedProbeState {
  ch1ProbeNode: string | null;
  ch2ProbeNode: string | null;
  ch3ProbeNode: string | null;
  ch4ProbeNode: string | null;
}

export interface PersistedOscilloscopeState {
  channelsEnabled: [boolean, boolean, boolean, boolean];
  voltsPerDiv: [number, number, number, number];
  offsets: [number, number, number, number];
  timeDivValue: number;
  isXyMode: boolean;
  isCursorsEnabled: boolean;
  isMathEnabled?: boolean;
  mathExpression?: string;
  mathVoltsPerDiv?: number;
  mathOffset?: number;
  cursorTargetChannel?: "ch1" | "ch2" | "ch3" | "ch4" | "math";
  triggerChannel: "ch1" | "ch2" | "ch3" | "ch4";
  triggerEdge: "rising" | "falling";
  triggerLevel: number;
  cursorT1: number;
  cursorT2: number;
  cursorV1: number;
  cursorV2: number;
}

export interface CircuitFileData {
  version: typeof CURRENT_CIRCUIT_FILE_VERSION;
  components: ComponentInstance[];
  wires: WireInstance[];
  viewport: CircuitViewport;
  simSettings: PersistedSimulationSettings;
  activeAnalysisMode: AnalysisMode;
  probes: PersistedProbeState;
  sparPorts: { nodeId: string; z0: number }[];
  oscilloscope: PersistedOscilloscopeState;
}

export interface CircuitFileSnapshot extends Omit<CircuitFileData, "version" | "components" | "wires"> {
  components: readonly ComponentInstance[];
  wires: readonly WireInstance[];
}

export type CircuitFileParseResult =
  | { ok: true; data: CircuitFileData; migratedFrom: string | null }
  | { ok: false; error: string };

const COMPONENT_TYPES = new Set<ComponentInstance["type"]>([
  "resistor", "capacitor", "inductor", "diode", "vsource", "ground",
  "nmos", "opamp", "opamp_ideal", "pmos", "npn", "pnp", "lamp", "relay", "buzzer",
  "mcu_8051", "mcu_avr", "arduino_uno", "esp32", "raspberry_pi_pico",
  "isource", "led", "transformer", "switch", "x", "potentiometer",
  "ldr", "thermistor", "dmm", "fuse",
  "zener_diode", "schottky_diode", "njf", "pjf", "opto", "igbt",
  "bsim3nmos", "bsim3pmos", "bsim4nmos", "bsim4pmos",
  "and_gate", "or_gate", "not_gate", "nand_gate", "nor_gate", "xor_gate",
  "net_label", "power_port", "text_note",
]);

const ANALYSIS_MODES = new Set<AnalysisMode>([
  "DC", "AC", "TRAN", "SENS", "PSS", "STB", "PVT", "SPAR",
]);

const NUMERIC_COMPONENT_FIELDS = [
  "wiperPosition",
  "lux",
  "temperatureCelsius",
  "amplitude",
  "frequency",
  "offset",
  "offsetVoltage",
  "openLoopGain",
  "dutyCycle",
  "mcuClockSpeed",
  "primaryInductance",
  "secondaryInductance",
  "couplingCoefficient",
  "switchRon",
  "switchRoff",
  "switchVth",
  "switchVh",
  "pinCount",
  "voltage",
  "phase",
  "modFrequency",
  "modIndex",
  "sourceResistance",
  "acMag",
  "acPhase",
  "tolerance",
  "powerRating",
  "voltageRating",
  "esr",
  "dcResistance",
  "currentRating",
  "isat",
  "forwardVoltage",
  "maxCurrent",
  "diodeBv",
  "diodeIs",
  "diodeRs",
  "diodeN",
  "diodeCjo",
  "diodeTt",
  "diodeIbv",
  "bjtIs",
  "bjtBf",
  "bjtVaf",
  "bjtRb",
  "bjtRc",
  "bjtCje",
  "bjtCjc",
  "mosVth",
  "mosRon",
  "mosCgs",
  "mosCgd",
  "igbtKp",
  "igbtAlpha",
  "igbtTau",
  "igbtWb",
  "igbtCge",
  "igbtCgc",
  "jfetVto",
  "jfetBeta",
  "jfetLambda",
  "jfetCgs",
  "jfetCgd",
  "opampAol",
  "opampGbw",
  "opampSr",
  "opampRin",
  "opampRout",
  "opampVos",
  "opampIb",
  "opampIsc",
  "opampIq",
  "opampVdrop",
  "opampIos",
  "opampCmrr",
  "opampPsrr",
  "opampEn",
  "opampIn",
  "opampFc",
  "gateTrise",
  "gateTfall",
  "gateRout",
  "gateVhigh",
  "gateVlow",
  "riseDelay",
  "fallDelay",
] as const;

const BOOLEAN_COMPONENT_FIELDS = [
  "mirror",
  "mirrorY",
  "relayClosed",
  "switchState",
  "isSubcircuitBlock",
] as const;

const STRING_COMPONENT_FIELDS = [
  "waveType",
  "firmwareHex",
  "spiceMacro",
  "spiceNetlist",
  "subcircuitTabId",
  "subcircuitName",
  "modelName",
  "dielectricType",
  "potTaper",
  "ledColor",
  "terminalStyle",
] as const;

const VALID_TERMINAL_TYPES = new Set<string>([
  "signal",
  "power",
  "ground",
  "input",
  "output",
  "bidirectional",
  "generator",
  "bus_tap",
  "test_point",
  "no_connect",
]);

type NumericComponentField = (typeof NUMERIC_COMPONENT_FIELDS)[number];
type BooleanComponentField = (typeof BOOLEAN_COMPONENT_FIELDS)[number];
type StringComponentField = (typeof STRING_COMPONENT_FIELDS)[number];
type WritableParsedComponent = ComponentInstance
  & Partial<Record<NumericComponentField, number>>
  & Partial<Record<BooleanComponentField, boolean>>
  & Partial<Record<StringComponentField, string>>;

const DEFAULT_OSCILLOSCOPE: PersistedOscilloscopeState = {
  channelsEnabled: [true, false, false, false],
  voltsPerDiv: [1, 1, 1, 1],
  offsets: [0, 0, 0, 0],
  timeDivValue: 0.02,
  isXyMode: false,
  isCursorsEnabled: false,
  isMathEnabled: false,
  mathExpression: "CH1 - CH2",
  triggerChannel: "ch1",
  triggerEdge: "rising",
  triggerLevel: 0,
  cursorT1: 0.25,
  cursorT2: 0.75,
  cursorV1: 1,
  cursorV2: -1,
};

export function createDefaultOscilloscopeState(): PersistedOscilloscopeState {
  return {
    ...DEFAULT_OSCILLOSCOPE,
    channelsEnabled: [...DEFAULT_OSCILLOSCOPE.channelsEnabled],
    voltsPerDiv: [...DEFAULT_OSCILLOSCOPE.voltsPerDiv],
    offsets: [...DEFAULT_OSCILLOSCOPE.offsets],
  };
}

function serializeComponent(component: ComponentInstance): Record<string, unknown> {
  const serialized: Record<string, unknown> = {
    id: component.id,
    type: component.type,
    value: component.value,
    x: component.x,
    y: component.y,
    rotation: component.rotation,
  };

  for (const field of NUMERIC_COMPONENT_FIELDS) {
    if (component[field] !== undefined) serialized[field] = component[field];
  }
  for (const field of BOOLEAN_COMPONENT_FIELDS) {
    if (component[field] !== undefined) serialized[field] = component[field];
  }
  for (const field of STRING_COMPONENT_FIELDS) {
    if (component[field] !== undefined) serialized[field] = component[field];
  }
  if (component.terminalType) serialized.terminalType = component.terminalType;
  if (component.params) serialized.params = component.params;
  if (component.pinLabels) serialized.pinLabels = component.pinLabels;
  if (component.firmware) serialized.firmwareBytes = Array.from(component.firmware);

  return serialized;
}

function parseComponent(value: unknown, index: number): ComponentInstance {
  const path = `components[${index}]`;
  if (!isRecord(value)) throw new CircuitFileValidationError(`${path} no es un objeto valido.`);
  if (typeof value.id !== "string" || !isValidComponentId(value.id)) {
    throw new CircuitFileValidationError(`${path}.id no es valido.`);
  }
  if (typeof value.type !== "string" || !COMPONENT_TYPES.has(value.type as ComponentInstance["type"])) {
    throw new CircuitFileValidationError(`${path}.type no esta soportado.`);
  }
  if ((typeof value.value !== "number" || !Number.isFinite(value.value))
    && typeof value.value !== "string") {
    throw new CircuitFileValidationError(`${path}.value debe ser numero o texto.`);
  }

  const component: ComponentInstance = {
    id: value.id,
    type: value.type as ComponentInstance["type"],
    value: value.value,
    x: finiteNumber(value.x, `${path}.x`),
    y: finiteNumber(value.y, `${path}.y`),
    rotation: finiteNumber(value.rotation, `${path}.rotation`, 0),
  };
  const writable: WritableParsedComponent = component;

  for (const field of NUMERIC_COMPONENT_FIELDS) {
    if (value[field] !== undefined) (writable as any)[field] = finiteNumber(value[field], `${path}.${field}`);
  }
  for (const field of BOOLEAN_COMPONENT_FIELDS) {
    if (value[field] !== undefined) {
      if (typeof value[field] !== "boolean") {
        throw new CircuitFileValidationError(`${path}.${field} debe ser booleano.`);
      }
      (writable as any)[field] = value[field];
    }
  }
  for (const field of STRING_COMPONENT_FIELDS) {
    if (value[field] !== undefined) {
      if (typeof value[field] !== "string") {
        throw new CircuitFileValidationError(`${path}.${field} debe ser texto.`);
      }
      (writable as any)[field] = value[field];
    }
  }

  if (value.terminalType !== undefined) {
    if (typeof value.terminalType !== "string" || !VALID_TERMINAL_TYPES.has(value.terminalType)) {
      throw new CircuitFileValidationError(`${path}.terminalType no es valido.`);
    }
    component.terminalType = value.terminalType as any;
  }

  if (isRecord(value.params)) {
    component.params = { ...value.params } as Record<string, number | string>;
  }

  if (isRecord(value.pinLabels)) {
    component.pinLabels = { ...value.pinLabels } as Record<number, string>;
  }

  if (value.firmwareBytes !== undefined) {
    if (!Array.isArray(value.firmwareBytes)
      || value.firmwareBytes.some(byte => !Number.isInteger(byte) || byte < 0 || byte > 255)) {
      throw new CircuitFileValidationError(`${path}.firmwareBytes no es valido.`);
    }
    component.firmware = Uint8Array.from(value.firmwareBytes as number[]);
  }
  if (component.pinCount !== undefined
    && (!Number.isInteger(component.pinCount) || component.pinCount < 2 || component.pinCount > 64)) {
    throw new CircuitFileValidationError(`${path}.pinCount debe ser un entero entre 2 y 64.`);
  }
  if (component.wiperPosition !== undefined
    && (component.wiperPosition < 0.01 || component.wiperPosition > 0.99)) {
    throw new CircuitFileValidationError(`${path}.wiperPosition debe estar entre 0.01 y 0.99.`);
  }
  if (component.couplingCoefficient !== undefined
    && (component.couplingCoefficient < 0 || component.couplingCoefficient >= 1)) {
    throw new CircuitFileValidationError(`${path}.couplingCoefficient debe estar entre 0 y 1.`);
  }
  if (component.type === "dmm") {
    component.value = normalizeDmmMode(component.value);
    component.dmmValue = undefined;
  }
  if (component.type === "switch") {
    if ((component.switchRon ?? 0.01) <= 0) {
      throw new CircuitFileValidationError(`${path}.switchRon debe ser positivo.`);
    }
    if ((component.switchRoff ?? 1e9) < (component.switchRon ?? 0.01)) {
      throw new CircuitFileValidationError(`${path}.switchRoff no puede ser menor que switchRon.`);
    }
    if ((component.switchVh ?? 0.05) < 0) {
      throw new CircuitFileValidationError(`${path}.switchVh no puede ser negativo.`);
    }
  }
  if (component.type === "transformer") {
    if ((component.primaryInductance ?? 1e-3) <= 0
      || (component.secondaryInductance ?? 1e-3) <= 0) {
      throw new CircuitFileValidationError(`${path} requiere inductancias positivas.`);
    }
  }

  return component;
}

function parseWire(value: unknown, index: number): WireInstance {
  const path = `wires[${index}]`;
  if (!isRecord(value) || typeof value.id !== "string" || !value.id.trim()) {
    throw new CircuitFileValidationError(`${path}.id no es valido.`);
  }
  if (!isRecord(value.from) || !isRecord(value.to)) {
    throw new CircuitFileValidationError(`${path} no contiene extremos validos.`);
  }
  if (typeof value.from.componentId !== "string" || typeof value.to.componentId !== "string") {
    throw new CircuitFileValidationError(`${path} contiene referencias invalidas.`);
  }

  const fromPinIndex = finiteInteger(value.from.pinIndex, `${path}.from.pinIndex`);
  const toPinIndex = finiteInteger(value.to.pinIndex, `${path}.to.pinIndex`);
  if (fromPinIndex < 0 || toPinIndex < 0) {
    throw new CircuitFileValidationError(`${path} contiene un indice de terminal negativo.`);
  }

  const fromIsJunction = typeof value.from.isJunction === "boolean"
    ? value.from.isJunction
    : isJunctionEndpoint(value.from as unknown as WireEndpoint);
  let fromJunctionPos = value.from.junctionPos ? parsePoint(value.from.junctionPos, `${path}.from.junctionPos`) : undefined;
  if (!fromJunctionPos && fromIsJunction && typeof value.from.componentId === "string") {
    fromJunctionPos = extractJunctionPosFromId(value.from.componentId);
  }

  const toIsJunction = typeof value.to.isJunction === "boolean"
    ? value.to.isJunction
    : isJunctionEndpoint(value.to as unknown as WireEndpoint);
  let toJunctionPos = value.to.junctionPos ? parsePoint(value.to.junctionPos, `${path}.to.junctionPos`) : undefined;
  if (!toJunctionPos && toIsJunction && typeof value.to.componentId === "string") {
    toJunctionPos = extractJunctionPosFromId(value.to.componentId);
  }

  const label = typeof value.label === "string" && value.label.trim().length > 0
    ? value.label.trim()
    : undefined;
  const color = typeof value.color === "string" && value.color.trim().length > 0
    ? value.color.trim()
    : undefined;
  const customPath = typeof value.customPath === "boolean" ? value.customPath : undefined;

  return {
    id: value.id,
    from: {
      componentId: value.from.componentId,
      pinIndex: fromPinIndex,
      ...(fromIsJunction ? { isJunction: true } : {}),
      ...(fromJunctionPos ? { junctionPos: fromJunctionPos } : {}),
    },
    to: {
      componentId: value.to.componentId,
      pinIndex: toPinIndex,
      ...(toIsJunction ? { isJunction: true } : {}),
      ...(toJunctionPos ? { junctionPos: toJunctionPos } : {}),
    },
    points: Array.isArray(value.points)
      ? value.points.map((point, pointIndex) => parsePoint(point, `${path}.points[${pointIndex}]`))
      : [],
    ...(label ? { label } : {}),
    ...(color ? { color } : {}),
    ...(customPath ? { customPath } : {}),
  };
}

function parseBooleanTuple(value: unknown, fallback: [boolean, boolean, boolean, boolean]): [boolean, boolean, boolean, boolean] {
  if (value === undefined) return [...fallback];
  if (!Array.isArray(value) || value.length !== 4 || value.some(item => typeof item !== "boolean")) {
    throw new CircuitFileValidationError("oscilloscope.channelsEnabled debe contener cuatro booleanos.");
  }
  return value as [boolean, boolean, boolean, boolean];
}

function parseNumberTuple(value: unknown, path: string, fallback: [number, number, number, number]): [number, number, number, number] {
  if (value === undefined) return [...fallback];
  if (!Array.isArray(value) || value.length !== 4) {
    throw new CircuitFileValidationError(`${path} debe contener cuatro numeros.`);
  }
  return value.map((item, index) => finiteNumber(item, `${path}[${index}]`)) as [number, number, number, number];
}

function parseOscilloscope(value: unknown): PersistedOscilloscopeState {
  if (value === undefined) return { ...DEFAULT_OSCILLOSCOPE };
  if (!isRecord(value)) {
    throw new CircuitFileValidationError("oscilloscope debe ser un objeto.");
  }
  return {
    channelsEnabled: parseBooleanTuple(value.channelsEnabled, DEFAULT_OSCILLOSCOPE.channelsEnabled),
    voltsPerDiv: parseNumberTuple(value.voltsPerDiv, "oscilloscope.voltsPerDiv", DEFAULT_OSCILLOSCOPE.voltsPerDiv),
    offsets: parseNumberTuple(value.offsets, "oscilloscope.offsets", DEFAULT_OSCILLOSCOPE.offsets),
    timeDivValue: finiteNumber(value.timeDivValue, "oscilloscope.timeDivValue", DEFAULT_OSCILLOSCOPE.timeDivValue),
    isXyMode: typeof value.isXyMode === "boolean" ? value.isXyMode : DEFAULT_OSCILLOSCOPE.isXyMode,
    isCursorsEnabled: typeof value.isCursorsEnabled === "boolean" ? value.isCursorsEnabled : DEFAULT_OSCILLOSCOPE.isCursorsEnabled,
    isMathEnabled: typeof value.isMathEnabled === "boolean" ? value.isMathEnabled : DEFAULT_OSCILLOSCOPE.isMathEnabled,
    mathExpression: typeof value.mathExpression === "string" ? value.mathExpression : DEFAULT_OSCILLOSCOPE.mathExpression,
    triggerChannel: value.triggerChannel === "ch2" || value.triggerChannel === "ch3" || value.triggerChannel === "ch4"
      ? value.triggerChannel
      : "ch1",
    triggerEdge: value.triggerEdge === "falling" ? "falling" : "rising",
    triggerLevel: finiteNumber(value.triggerLevel, "oscilloscope.triggerLevel", DEFAULT_OSCILLOSCOPE.triggerLevel),
    cursorT1: finiteNumber(value.cursorT1, "oscilloscope.cursorT1", DEFAULT_OSCILLOSCOPE.cursorT1),
    cursorT2: finiteNumber(value.cursorT2, "oscilloscope.cursorT2", DEFAULT_OSCILLOSCOPE.cursorT2),
    cursorV1: finiteNumber(value.cursorV1, "oscilloscope.cursorV1", DEFAULT_OSCILLOSCOPE.cursorV1),
    cursorV2: finiteNumber(value.cursorV2, "oscilloscope.cursorV2", DEFAULT_OSCILLOSCOPE.cursorV2),
  };
}

function validateReferences(components: readonly ComponentInstance[], wires: readonly WireInstance[]): void {
  const duplicates = findDuplicateComponentIds(components);
  if (duplicates.length > 0) {
    throw new CircuitFileValidationError(`IDs de componente duplicados: ${duplicates.join(", ")}.`);
  }

  const componentIds = new Set(components.map(component => component.id));
  const missingReference = wires.find(wire => {
    const fromValid = isJunctionEndpoint(wire.from) || componentIds.has(wire.from.componentId);
    const toValid = isJunctionEndpoint(wire.to) || componentIds.has(wire.to.componentId);
    return !fromValid || !toValid;
  });
  if (missingReference) {
    throw new CircuitFileValidationError(`El cable [${missingReference.id}] referencia un componente inexistente.`);
  }

  const wireIds = new Set<string>();
  for (const wire of wires) {
    const normalized = wire.id.toUpperCase();
    if (wireIds.has(normalized)) {
      throw new CircuitFileValidationError(`ID de cable duplicado: [${wire.id}].`);
    }
    wireIds.add(normalized);
  }
}

export function serializeCircuitFile(snapshot: CircuitFileSnapshot): string {
  const fileData = {
    version: CURRENT_CIRCUIT_FILE_VERSION,
    components: snapshot.components.map(serializeComponent),
    wires: snapshot.wires,
    viewport: snapshot.viewport,
    simSettings: snapshot.simSettings,
    activeAnalysisMode: snapshot.activeAnalysisMode,
    probes: snapshot.probes,
    sparPorts: snapshot.sparPorts,
    oscilloscope: snapshot.oscilloscope,
  };
  return JSON.stringify(fileData, null, 2);
}

export function cloneCircuitComponents(
  components: readonly ComponentInstance[],
): ComponentInstance[] {
  return components.map((component, index) => parseComponent(serializeComponent(component), index));
}

export function cloneCircuitWires(wires: readonly WireInstance[]): WireInstance[] {
  return wires.map(wire => ({
    id: wire.id,
    from: { ...wire.from },
    to: { ...wire.to },
    points: wire.points.map(point => ({ ...point })),
    ...(wire.label !== undefined ? { label: wire.label } : {}),
    ...(wire.color !== undefined ? { color: wire.color } : {}),
    ...(wire.customPath !== undefined ? { customPath: wire.customPath } : {}),
  }));
}

export function parseCircuitFile(json: string): CircuitFileParseResult {
  try {
    const cleanJson = typeof json === "string" ? json.replace(/^\uFEFF/, "") : json;
    const parsedRaw: unknown = JSON.parse(cleanJson);
    if (!isRecord(parsedRaw)) throw new CircuitFileValidationError("El archivo no contiene un objeto JSON.");
    let root: Record<string, unknown> = parsedRaw;

    let migratedFrom: string | null = null;

    // Desempaquetado automático de paquetes de diagnóstico (Biaani Diagnostic Bundle)
    if (root.format === "biaani-diagnostic-bundle" && isRecord(root.circuit) && typeof root.circuit.rawFileJson === "string") {
      migratedFrom = `paquete de diagnóstico (${String(root.category || "reporte")})`;
      const innerRoot: unknown = JSON.parse(root.circuit.rawFileJson);
      if (!isRecord(innerRoot)) throw new CircuitFileValidationError("El paquete de diagnóstico no contiene un circuito válido.");
      root = innerRoot;
    }

    if (root.version !== undefined && typeof root.version !== "string") {
      throw new CircuitFileValidationError("version debe ser texto.");
    }
    const sourceVersion = root.version ?? "2.0";
    if (sourceVersion !== "2.0" && sourceVersion !== CURRENT_CIRCUIT_FILE_VERSION) {
      throw new CircuitFileValidationError(`Version de archivo no soportada: [${sourceVersion}].`);
    }
    if (migratedFrom === null && sourceVersion !== CURRENT_CIRCUIT_FILE_VERSION) {
      migratedFrom = sourceVersion;
    }
    if (!Array.isArray(root.components) || !Array.isArray(root.wires)) {
      throw new CircuitFileValidationError("El archivo no contiene listas de componentes y cables.");
    }

    const components = root.components.map(parseComponent);
    const wires = root.wires.map(parseWire);
    validateReferences(components, wires);

    if (root.viewport !== undefined && !isRecord(root.viewport)) {
      throw new CircuitFileValidationError("viewport debe ser un objeto.");
    }
    if (root.simSettings !== undefined && !isRecord(root.simSettings)) {
      throw new CircuitFileValidationError("simSettings debe ser un objeto.");
    }
    if (root.probes !== undefined && !isRecord(root.probes)) {
      throw new CircuitFileValidationError("probes debe ser un objeto.");
    }
    if (root.sparPorts !== undefined && !Array.isArray(root.sparPorts)) {
      throw new CircuitFileValidationError("sparPorts debe ser una lista.");
    }
    const viewport = root.viewport ?? {};
    const settings = root.simSettings ?? {};
    const probes = root.probes ?? {};
    const rawPorts = root.sparPorts ?? [];
    const sparPorts = rawPorts.map((port, index) => {
      if (!isRecord(port) || typeof port.nodeId !== "string") {
        throw new CircuitFileValidationError(`sparPorts[${index}] no es valido.`);
      }
      return {
        nodeId: port.nodeId,
        z0: finiteNumber(port.z0, `sparPorts[${index}].z0`, 50),
      };
    });
    if (root.activeAnalysisMode !== undefined
      && (typeof root.activeAnalysisMode !== "string"
        || !ANALYSIS_MODES.has(root.activeAnalysisMode as AnalysisMode))) {
      throw new CircuitFileValidationError("activeAnalysisMode no es valido.");
    }
    const mode = (root.activeAnalysisMode ?? "DC") as AnalysisMode;

    const zoom = finiteNumber(viewport.zoom, "viewport.zoom", 1);
    const dt = finiteNumber(settings.dt, "simSettings.dt", 0.0001);
    const tolerance = finiteNumber(settings.tolerance, "simSettings.tolerance", 0.00001);
    const maxIterations = finiteInteger(settings.maxIterations, "simSettings.maxIterations", 100);
    const transientDuration = finiteNumber(settings.transientDuration, "simSettings.transientDuration", 10);
    if (zoom < 0.3 || zoom > 3) {
      throw new CircuitFileValidationError("viewport.zoom debe estar entre 0.3 y 3.");
    }
    if (dt <= 0 || tolerance <= 0 || maxIterations <= 0
      || transientDuration < 0.001 || transientDuration > 600) {
      throw new CircuitFileValidationError("Los ajustes de simulacion deben ser positivos y la duración transitoria debe estar entre 0.001 y 600 segundos.");
    }
    if (sparPorts.some(port => port.z0 <= 0)) {
      throw new CircuitFileValidationError("La impedancia de los puertos RF debe ser positiva.");
    }

    const data: CircuitFileData = {
      version: CURRENT_CIRCUIT_FILE_VERSION,
      components,
      wires,
      viewport: {
        zoom,
        offsetX: finiteNumber(viewport.offsetX, "viewport.offsetX", 0),
        offsetY: finiteNumber(viewport.offsetY, "viewport.offsetY", 0),
      },
      simSettings: {
        dt,
        tolerance,
        maxIterations,
        transientDuration,
      },
      activeAnalysisMode: mode,
      probes: {
        ch1ProbeNode: nullableString(probes.ch1ProbeNode, "probes.ch1ProbeNode", "1"),
        ch2ProbeNode: nullableString(probes.ch2ProbeNode, "probes.ch2ProbeNode", "2"),
        ch3ProbeNode: nullableString(probes.ch3ProbeNode, "probes.ch3ProbeNode", "3"),
        ch4ProbeNode: nullableString(probes.ch4ProbeNode, "probes.ch4ProbeNode", "4"),
      },
      sparPorts,
      oscilloscope: parseOscilloscope(root.oscilloscope),
    };

    return {
      ok: true,
      data,
      migratedFrom: migratedFrom ?? (sourceVersion === CURRENT_CIRCUIT_FILE_VERSION ? null : sourceVersion),
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return { ok: false, error: `Archivo .astryd invalido: ${message}` };
  }
}
