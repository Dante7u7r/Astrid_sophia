import {
  findDuplicateComponentIds,
  isValidComponentId,
  type ComponentInstance,
  type Point2D,
  type WireInstance,
} from "../canvas_orchestrator";
import type { AnalysisMode } from "../ui/simulation_controls";
import { normalizeDmmMode } from "../simulation/dmm";

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
  "nmos", "opamp", "pmos", "npn", "pnp", "lamp", "relay", "buzzer",
  "mcu_8051", "mcu_avr", "arduino_uno", "esp32", "raspberry_pi_pico",
  "isource", "led", "transformer", "switch", "x", "potentiometer",
  "ldr", "thermistor", "dmm",
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
] as const;

const BOOLEAN_COMPONENT_FIELDS = [
  "mirror",
  "relayClosed",
  "switchState",
] as const;

const STRING_COMPONENT_FIELDS = [
  "waveType",
  "firmwareHex",
  "spiceMacro",
] as const;

const DEFAULT_OSCILLOSCOPE: PersistedOscilloscopeState = {
  channelsEnabled: [true, false, false, false],
  voltsPerDiv: [1, 1, 1, 1],
  offsets: [0, 0, 0, 0],
  timeDivValue: 0.02,
  isXyMode: false,
  isCursorsEnabled: false,
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

class CircuitFileValidationError extends Error {}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function finiteNumber(value: unknown, path: string, fallback?: number): number {
  if (value === undefined && fallback !== undefined) return fallback;
  if (typeof value !== "number" || !Number.isFinite(value)) {
    throw new CircuitFileValidationError(`${path} debe ser un numero finito.`);
  }
  return value;
}

function finiteInteger(value: unknown, path: string, fallback?: number): number {
  const parsed = finiteNumber(value, path, fallback);
  if (!Number.isInteger(parsed)) {
    throw new CircuitFileValidationError(`${path} debe ser un entero.`);
  }
  return parsed;
}

function nullableString(value: unknown, path: string, fallback: string | null): string | null {
  if (value === undefined) return fallback;
  if (typeof value === "string" || value === null) return value;
  throw new CircuitFileValidationError(`${path} debe ser texto o null.`);
}

function parsePoint(value: unknown, path: string): Point2D {
  if (!isRecord(value)) throw new CircuitFileValidationError(`${path} no es un punto valido.`);
  return {
    x: finiteNumber(value.x, `${path}.x`),
    y: finiteNumber(value.y, `${path}.y`),
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
  const writable = component as unknown as Record<string, unknown>;

  for (const field of NUMERIC_COMPONENT_FIELDS) {
    if (value[field] !== undefined) writable[field] = finiteNumber(value[field], `${path}.${field}`);
  }
  for (const field of BOOLEAN_COMPONENT_FIELDS) {
    if (value[field] !== undefined) {
      if (typeof value[field] !== "boolean") {
        throw new CircuitFileValidationError(`${path}.${field} debe ser booleano.`);
      }
      writable[field] = value[field];
    }
  }
  for (const field of STRING_COMPONENT_FIELDS) {
    if (value[field] !== undefined) {
      if (typeof value[field] !== "string") {
        throw new CircuitFileValidationError(`${path}.${field} debe ser texto.`);
      }
      writable[field] = value[field];
    }
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

  return {
    id: value.id,
    from: {
      componentId: value.from.componentId,
      pinIndex: fromPinIndex,
    },
    to: {
      componentId: value.to.componentId,
      pinIndex: toPinIndex,
    },
    points: Array.isArray(value.points)
      ? value.points.map((point, pointIndex) => parsePoint(point, `${path}.points[${pointIndex}]`))
      : [],
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
  const triggerChannel = value.triggerChannel;
  const triggerEdge = value.triggerEdge;
  if (triggerChannel !== undefined
    && triggerChannel !== "ch1"
    && triggerChannel !== "ch2"
    && triggerChannel !== "ch3"
    && triggerChannel !== "ch4") {
    throw new CircuitFileValidationError("oscilloscope.triggerChannel no es valido.");
  }
  if (triggerEdge !== undefined && triggerEdge !== "rising" && triggerEdge !== "falling") {
    throw new CircuitFileValidationError("oscilloscope.triggerEdge no es valido.");
  }
  if (value.isXyMode !== undefined && typeof value.isXyMode !== "boolean") {
    throw new CircuitFileValidationError("oscilloscope.isXyMode debe ser booleano.");
  }
  if (value.isCursorsEnabled !== undefined && typeof value.isCursorsEnabled !== "boolean") {
    throw new CircuitFileValidationError("oscilloscope.isCursorsEnabled debe ser booleano.");
  }

  return {
    channelsEnabled: parseBooleanTuple(value.channelsEnabled, DEFAULT_OSCILLOSCOPE.channelsEnabled),
    voltsPerDiv: parseNumberTuple(value.voltsPerDiv, "oscilloscope.voltsPerDiv", DEFAULT_OSCILLOSCOPE.voltsPerDiv),
    offsets: parseNumberTuple(value.offsets, "oscilloscope.offsets", DEFAULT_OSCILLOSCOPE.offsets),
    timeDivValue: finiteNumber(value.timeDivValue, "oscilloscope.timeDivValue", DEFAULT_OSCILLOSCOPE.timeDivValue),
    isXyMode: typeof value.isXyMode === "boolean" ? value.isXyMode : false,
    isCursorsEnabled: typeof value.isCursorsEnabled === "boolean" ? value.isCursorsEnabled : false,
    triggerChannel: triggerChannel ?? "ch1",
    triggerEdge: triggerEdge === "falling" ? "falling" : "rising",
    triggerLevel: finiteNumber(value.triggerLevel, "oscilloscope.triggerLevel", 0),
    cursorT1: finiteNumber(value.cursorT1, "oscilloscope.cursorT1", 0.25),
    cursorT2: finiteNumber(value.cursorT2, "oscilloscope.cursorT2", 0.75),
    cursorV1: finiteNumber(value.cursorV1, "oscilloscope.cursorV1", 1),
    cursorV2: finiteNumber(value.cursorV2, "oscilloscope.cursorV2", -1),
  };
}

function validateReferences(components: readonly ComponentInstance[], wires: readonly WireInstance[]): void {
  const duplicates = findDuplicateComponentIds(components);
  if (duplicates.length > 0) {
    throw new CircuitFileValidationError(`IDs de componente duplicados: ${duplicates.join(", ")}.`);
  }

  const componentIds = new Set(components.map(component => component.id));
  const missingReference = wires.find(wire =>
    !componentIds.has(wire.from.componentId) || !componentIds.has(wire.to.componentId),
  );
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
  }));
}

export function parseCircuitFile(json: string): CircuitFileParseResult {
  try {
    const root: unknown = JSON.parse(json);
    if (!isRecord(root)) throw new CircuitFileValidationError("El archivo no contiene un objeto JSON.");

    if (root.version !== undefined && typeof root.version !== "string") {
      throw new CircuitFileValidationError("version debe ser texto.");
    }
    const sourceVersion = root.version ?? "2.0";
    if (sourceVersion !== "2.0" && sourceVersion !== CURRENT_CIRCUIT_FILE_VERSION) {
      throw new CircuitFileValidationError(`Version de archivo no soportada: [${sourceVersion}].`);
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
    if (zoom < 0.3 || zoom > 3) {
      throw new CircuitFileValidationError("viewport.zoom debe estar entre 0.3 y 3.");
    }
    if (dt <= 0 || tolerance <= 0 || maxIterations <= 0) {
      throw new CircuitFileValidationError("Los ajustes de simulacion deben ser positivos.");
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
      migratedFrom: sourceVersion === CURRENT_CIRCUIT_FILE_VERSION ? null : sourceVersion,
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return { ok: false, error: `Archivo .astryd invalido: ${message}` };
  }
}
