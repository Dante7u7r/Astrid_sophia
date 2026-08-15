import {
  ComponentInstance,
  PinInstance,
  WireInstance,
  findDuplicateComponentIds,
  isValidComponentId,
} from "../canvas_orchestrator";
import {
  parseLampActuatorModel,
  parseBuzzerActuatorModel,
  parseRelayActuatorModel,
} from "../ui/actuator_helpers";
import {
  DMM_CURRENT_SHUNT_RESISTANCE,
  DMM_RESISTANCE_GUARD,
  DMM_RESISTANCE_TEST_CURRENT,
  DMM_VOLTAGE_INPUT_RESISTANCE,
  normalizeDmmMode,
} from "./dmm";
import {
  DisjointSetUnion,
  assignRootNode,
  pinKey,
} from "./netlist_node_model";
import { allowsFloatingPins } from "./component_pin_rules";

// ==========================================================================
// INTERFACES DE LA NETLIST ELÉCTRICA
// ==========================================================================

export interface ExtractedComponent {
  readonly id: string;
  readonly type: string;
  readonly value: number;
  pins: string[];
  readonly waveType?: string;
  readonly amplitude?: number;
  readonly frequency?: number;
  readonly offset?: number;
  readonly dutyCycle?: number;
  readonly switchState?: boolean;
  readonly switchRon?: number;
  readonly switchRoff?: number;
  readonly switchVth?: number;
  readonly switchVh?: number;
  readonly subcircuitName?: string;
  readonly firmware?: Uint8Array;
  readonly mcuClockSpeed?: number;
}

export interface MutualInductance {
  readonly id: string;
  readonly l1_id: string;
  readonly l2_id: string;
  readonly k_coeff: number;
}

export interface CircuitNetlist {
  readonly components: readonly ExtractedComponent[];
  wires: { readonly id: string; nodes: string[] }[];
  readonly mutual_inductances?: readonly MutualInductance[];
  readonly subcircuitDefinitions?: string;
}

export interface NetlistExtractionResult {
  readonly netlist: CircuitNetlist;
  readonly pinToNodeMap: Readonly<Record<string, string>>;
  readonly error?: string;
}

export function validateSchematicIntegrity(
  components: readonly ComponentInstance[],
  wires: readonly WireInstance[],
  getPins: (comp: ComponentInstance) => readonly PinInstance[],
): string | undefined {
  const invalidIds = components
    .map(component => component.id)
    .filter(id => !isValidComponentId(id));
  if (invalidIds.length > 0) {
    return `Identificador de componente invalido: ${invalidIds.map(id => `[${id || "(vacio)"}]`).join(", ")}.`;
  }

  const duplicateIds = findDuplicateComponentIds(components);
  if (duplicateIds.length > 0) {
    return `Identificadores de componente duplicados: ${duplicateIds.map(id => `[${id}]`).join(", ")}.`;
  }

  const componentIds = new Set(components.map(component => component.id));
  const danglingWires = wires.filter(wire =>
    (!wire.from.isJunction && !componentIds.has(wire.from.componentId))
    || (!wire.to.isJunction && !componentIds.has(wire.to.componentId)),
  );
  if (danglingWires.length > 0) {
    return `Cables con referencias a componentes inexistentes: ${danglingWires.map(wire => `[${wire.id}]`).join(", ")}.`;
  }

  const componentById = new Map(components.map(component => [component.id, component]));
  const wiresWithInvalidPins = wires.filter(wire => {
    if (!wire.from.isJunction) {
      const fromComponent = componentById.get(wire.from.componentId);
      if (!fromComponent) return false;
      const fromPinExists = getPins(fromComponent).some(pin => pin.pinIndex === wire.from.pinIndex);
      if (!fromPinExists) return true;
    }
    if (!wire.to.isJunction) {
      const toComponent = componentById.get(wire.to.componentId);
      if (!toComponent) return false;
      const toPinExists = getPins(toComponent).some(pin => pin.pinIndex === wire.to.pinIndex);
      if (!toPinExists) return true;
    }
    return false;
  });
  if (wiresWithInvalidPins.length > 0) {
    return `Cables conectados a terminales inexistentes: ${wiresWithInvalidPins.map(wire => `[${wire.id}]`).join(", ")}.`;
  }

  const seenWireIds = new Set<string>();
  const duplicateWireIds = new Set<string>();
  for (const wire of wires) {
    if (!wire.id.trim()) return "Hay un cable sin identificador.";
    const normalized = wire.id.trim().toUpperCase();
    if (seenWireIds.has(normalized)) duplicateWireIds.add(wire.id);
    seenWireIds.add(normalized);
  }
  if (duplicateWireIds.size > 0) {
    return `Identificadores de cable duplicados: ${[...duplicateWireIds].map(id => `[${id}]`).join(", ")}.`;
  }

  return undefined;
}

// ==========================================================================
// DSU — DISJOINT SET UNION (UNIÓN-BÚSQUEDA DE CONJUNTOS DISJUNTOS)
//
// El algoritmo DSU (también llamado Union-Find) se utiliza aquí para
// colapsar todos los terminales conectados por cables (wires) en un único
// nodo eléctrico. Cada pin físico de cada componente se modela como un
// elemento del conjunto. Cuando un cable conecta dos pines, se ejecuta
// union(pinA, pinB), lo que fusiona sus respectivos conjuntos.
//
// Tras procesar todos los cables, cada grupo de pines conectados comparte
// una misma raíz. Esa raíz se asigna a un identificador de nodo eléctrico
// único ("0" para Tierra, "1", "2", ... para el resto).
//
// La compresión de caminos (path compression) en find() garantiza una
// complejidad amortizada O(α(N)) por operación, donde α es la función
// inversa de Ackermann — esencialmente constante para cualquier N práctico.
// ==========================================================================

// ==========================================================================
// EXTRACCIÓN DE NETLIST ELÉCTRICA
//
// Función pura: recibe los componentes y cables del lienzo y devuelve:
//   - netlist: estructura legible por el solver MNA (Rust o TS fallback)
//   - pinToNodeMap: mapeo de cada terminal física → ID de nodo eléctrico
//
// No depende de ninguna variable global ni del objeto orchestrator.
// Todos los datos se reciben explícitamente como argumentos.
// ==========================================================================

// ==========================================================================
// CACHÉ TOPOLÓGICA DE NETLIST
// ==========================================================================

interface CachedTopologyData {
  signature: string;
  pinToNodeMap: Record<string, string>;
  compPinMapping: Record<string, string[]>;
  subcircuitDefinitions?: string;
  error?: string;
}

let topologicalCache: CachedTopologyData | null = null;

export function invalidateTopologicalCache(): void {
  topologicalCache = null;
}

export function computeTopologySignature(
  components: readonly ComponentInstance[],
  wires: readonly WireInstance[],
  getPins: (comp: ComponentInstance) => readonly PinInstance[],
): string {
  const compsSig = components
    .map(c => {
      const pinCount = getPins(c).length;
      let extra = "";
      if (c.type === "dmm") extra = `:${normalizeDmmMode(c.value)}`;
      else if (c.type === "x") extra = `:${c.spiceMacro ?? ""}`;
      else if (c.type === "net_label") extra = `:${String(c.label || c.value || c.id).trim().toUpperCase()}`;
      return `${c.id}:${c.type}:${pinCount}${extra}`;
    })
    .sort()
    .join("|");

  const wiresSig = wires
    .map(w => {
      const fromKey = w.from.isJunction && w.from.junctionPos
        ? `j_${Math.round(w.from.junctionPos.x)}_${Math.round(w.from.junctionPos.y)}`
        : `${w.from.componentId}:${w.from.pinIndex}`;
      const toKey = w.to.isJunction && w.to.junctionPos
        ? `j_${Math.round(w.to.junctionPos.x)}_${Math.round(w.to.junctionPos.y)}`
        : `${w.to.componentId}:${w.to.pinIndex}`;
      const labelExtra = w.label ? `:${w.label.trim().toUpperCase()}` : "";
      return `${w.id}:${fromKey}->${toKey}${labelExtra}`;
    })
    .sort()
    .join("|");

  return `${compsSig}||${wiresSig}`;
}

export function extractElectricalNetlist(
  components: readonly ComponentInstance[],
  wires: readonly WireInstance[],
  getPins: (comp: ComponentInstance) => readonly PinInstance[],
): NetlistExtractionResult {
  const emptyResult = (error: string): NetlistExtractionResult => ({
    netlist: { components: [], wires: [] },
    pinToNodeMap: {},
    error,
  });

  const integrityError = validateSchematicIntegrity(components, wires, getPins);
  if (integrityError) return emptyResult(integrityError);

  const currentSignature = computeTopologySignature(components, wires, getPins);

  let isCacheHit = false;
  let compPinMapping: Record<string, string[]> = {};
  let pinToNodeMap: Record<string, string> = {};

  if (topologicalCache && topologicalCache.signature === currentSignature) {
    isCacheHit = true;
    pinToNodeMap = { ...topologicalCache.pinToNodeMap };
    compPinMapping = { ...topologicalCache.compPinMapping };
  }

  const dsu = isCacheHit ? null : new DisjointSetUnion();
  const rootToNodeIdMap: Record<string, string> = {};
  const nextNodeId = { value: 1 };

  if (!isCacheHit) {
    // 1. Declarar cada pin de cada componente en el DSU
    const allPinKeys: string[] = [];
    compPinMapping = {};

    for (const comp of components) {
      if (comp.type === 'text_note') {
        compPinMapping[comp.id] = [];
        continue;
      }

      if (comp.type === 'relay') {
        compPinMapping[comp.id] = [
          pinKey(comp.id, 0),
          pinKey(comp.id, 1),
          pinKey(comp.id, 2),
          pinKey(comp.id, 3),
          `${comp.id}:internal`,
        ];
        allPinKeys.push(`${comp.id}:0`, `${comp.id}:1`, `${comp.id}:2`, `${comp.id}:3`, `${comp.id}:internal`);
      } else {
        const pins = getPins(comp);
        compPinMapping[comp.id] = [];
        for (const pin of pins) {
          const key = pinKey(comp.id, pin.pinIndex);
          allPinKeys.push(key);
          compPinMapping[comp.id].push(key);
        }
      }
    }

    // 2. Unir los pins y uniones que están conectados por cables (wires)
    for (const wire of wires) {
      const keyFrom = wire.from.isJunction && wire.from.junctionPos
        ? `junction:${Math.round(wire.from.junctionPos.x)}_${Math.round(wire.from.junctionPos.y)}`
        : pinKey(wire.from.componentId, wire.from.pinIndex);
      const keyTo = wire.to.isJunction && wire.to.junctionPos
        ? `junction:${Math.round(wire.to.junctionPos.x)}_${Math.round(wire.to.junctionPos.y)}`
        : pinKey(wire.to.componentId, wire.to.pinIndex);
      dsu!.union(keyFrom, keyTo);

      // Unión virtual por etiqueta de red en cable (Named Net Tie)
      if (wire.label && wire.label.trim().length > 0) {
        const netKey = `net_virtual:${wire.label.trim().toUpperCase()}`;
        dsu!.union(keyFrom, netKey);
      }
    }

    // Unión virtual para componentes net_label (Puertos de Red Banderola EDA)
    for (const comp of components) {
      if (comp.type === 'net_label') {
        const netName = String(comp.label || comp.value || comp.id).trim().toUpperCase();
        if (netName.length > 0) {
          const compPin = pinKey(comp.id, 0);
          const netKey = `net_virtual:${netName}`;
          dsu!.union(compPin, netKey);
        }
      }
    }

    // 3. Identificar el grupo de Tierra (GND) y asignarle el ID de nodo "0"
    let gndRoot: string | null = null;
    for (const comp of components) {
      if (comp.type === 'ground') {
        const gndPinKey = `${comp.id}:0`;
        gndRoot = dsu!.find(gndPinKey);
        break;
      }
    }

    if (!gndRoot) {
      for (const gndAlias of ["GND", "0", "TIERRA", "GROUND"]) {
        const gndKey = `net_virtual:${gndAlias}`;
        if (dsu!.has(gndKey)) {
          gndRoot = dsu!.find(gndKey);
          break;
        }
      }
    }

    if (gndRoot) {
      rootToNodeIdMap[gndRoot] = "0";
    }
  }

  // Helper puro para resolución de nodo (Cache Hit ➔ lectura directa O(1); Cache Miss ➔ DSU lookup)
  const resolveNode = (pk: string): string => {
    if (isCacheHit) {
      return pinToNodeMap[pk] || "0";
    }
    const root = dsu!.find(pk);
    const nodeId = assignRootNode(rootToNodeIdMap, root, nextNodeId);
    pinToNodeMap[pk] = nodeId;
    return nodeId;
  };

  const getComponentNodes = (pinsKeys: readonly string[]): string[] => {
    return pinsKeys.map(resolveNode);
  };

  const extractedComponents: ExtractedComponent[] = [];
  let netlistMutualInductances: MutualInductance[] = [];

  for (const comp of components) {
    const pinsKeys = compPinMapping[comp.id] || [];

    if (comp.type === 'potentiometer') {
      const pinsMapped = getComponentNodes(pinsKeys);

      const pin0Node = pinsMapped[0] || "0";
      const pin1Node = pinsMapped[1] || "0";
      const pin2Node = pinsMapped[2] || "0";

      const totalVal = Number(comp.value) || 10000;
      const pos = Math.max(0.01, Math.min(0.99, comp.wiperPosition ?? 0.5));

      const r1Val = totalVal * pos;
      const r2Val = totalVal * (1 - pos);

      extractedComponents.push({
        id: `${comp.id}__R1`,
        type: 'resistor',
        value: r1Val,
        pins: [pin0Node, pin1Node],
      });

      extractedComponents.push({
        id: `${comp.id}__R2`,
        type: 'resistor',
        value: r2Val,
        pins: [pin1Node, pin2Node],
      });
    } else if (comp.type === 'ldr') {
      const pinsMapped = getComponentNodes(pinsKeys);

      const pin0Node = pinsMapped[0] || "0";
      const pin1Node = pinsMapped[1] || "0";

      const luxVal = comp.lux ?? 100;
      const rVal = 500.0 + 500000.0 / Math.max(1, luxVal);

      extractedComponents.push({
        id: comp.id,
        type: 'resistor',
        value: rVal,
        pins: [pin0Node, pin1Node],
      });
    } else if (comp.type === 'dmm') {
      const pinsMapped = getComponentNodes(pinsKeys);

      const pin0Node = pinsMapped[0] || "0";
      const pin1Node = pinsMapped[1] || "0";

      const mode = normalizeDmmMode(comp.value);
      if (mode === "R") {
        extractedComponents.push({
          id: `${comp.id}__test`,
          type: "isource",
          value: DMM_RESISTANCE_TEST_CURRENT,
          pins: [pin0Node, pin1Node],
        });
        extractedComponents.push({
          id: `${comp.id}__guard`,
          type: "resistor",
          value: DMM_RESISTANCE_GUARD,
          pins: [pin0Node, pin1Node],
        });
      } else {
        extractedComponents.push({
          id: comp.id,
          type: "resistor",
          value: mode === "A"
            ? DMM_CURRENT_SHUNT_RESISTANCE
            : DMM_VOLTAGE_INPUT_RESISTANCE,
          pins: [pin0Node, pin1Node],
        });
      }
    } else if (comp.type === 'thermistor') {
      const pinsMapped = getComponentNodes(pinsKeys);

      const pin0Node = pinsMapped[0] || "0";
      const pin1Node = pinsMapped[1] || "0";

      const tempCelsius = comp.temperatureCelsius ?? 25;
      const tempK = tempCelsius + 273.15;
      const t0 = 298.15;
      const r0 = 10000;
      const beta = 3950;
      const rVal = r0 * Math.exp(beta * (1.0 / tempK - 1.0 / t0));

      extractedComponents.push({
        id: comp.id,
        type: 'resistor',
        value: rVal,
        pins: [pin0Node, pin1Node],
      });
    } else if (comp.type === 'lamp') {
      const model = parseLampActuatorModel(comp.value?.toString() ?? "");
      const pinsMapped = getComponentNodes(pinsKeys);

      extractedComponents.push({
        id: comp.id,
        type: 'resistor',
        value: model.coldResistanceOhms,
        pins: pinsMapped,
      });
    } else if (comp.type === 'buzzer') {
      const model = parseBuzzerActuatorModel(comp.value?.toString() ?? "");
      const pinsMapped = getComponentNodes(pinsKeys);

      extractedComponents.push({
        id: comp.id,
        type: 'resistor',
        value: model.inactiveResistanceOhms,
        pins: pinsMapped,
      });
    } else if (comp.type === 'relay') {
      const model = parseRelayActuatorModel(comp.value?.toString() ?? "");
      const pin0Node = resolveNode(`${comp.id}:0`);
      const pin1Node = resolveNode(`${comp.id}:1`);
      const pin2Node = resolveNode(`${comp.id}:2`);
      const pin3Node = resolveNode(`${comp.id}:3`);
      const pinInternalNode = resolveNode(`${comp.id}:internal`);

      extractedComponents.push({
        id: `${comp.id}__coil_res`,
        type: 'resistor',
        value: model.coilResistanceOhms,
        pins: [pin0Node, pinInternalNode],
      });

      extractedComponents.push({
        id: `${comp.id}__coil`,
        type: 'inductor',
        value: model.inductanceHenrys,
        pins: [pinInternalNode, pin1Node],
      });

      const isClosed = comp.relayClosed ?? false;
      const contactVal = isClosed ? model.contactClosedResistanceOhms : model.contactOpenResistanceOhms;
      extractedComponents.push({
        id: `${comp.id}__contact`,
        type: 'resistor',
        value: contactVal,
        pins: [pin2Node, pin3Node],
      });
    } else if (comp.type === 'transformer') {
      const priNode1 = resolveNode(`${comp.id}:0`);
      const priNode2 = resolveNode(`${comp.id}:1`);
      const secNode1 = resolveNode(`${comp.id}:2`);
      const secNode2 = resolveNode(`${comp.id}:3`);

      const L1 = comp.primaryInductance ?? 1e-3;
      const L2 = comp.secondaryInductance ?? 1e-3;
      const k = Math.max(0, Math.min(0.9999, comp.couplingCoefficient ?? 0.9));

      extractedComponents.push({
        id: `${comp.id}__L1`,
        type: 'inductor',
        value: L1,
        pins: [priNode1, priNode2],
      });

      extractedComponents.push({
        id: `${comp.id}__L2`,
        type: 'inductor',
        value: L2,
        pins: [secNode1, secNode2],
      });

      if (!netlistMutualInductances) {
        netlistMutualInductances = [];
      }
      netlistMutualInductances.push({
        id: `${comp.id}__K`,
        l1_id: `${comp.id}__L1`,
        l2_id: `${comp.id}__L2`,
        k_coeff: k,
      });
    } else if (comp.type === 'opamp') {
      const pinsMapped = getComponentNodes(pinsKeys);

      const pin0Node = pinsMapped[0] || "0"; // In+
      const pin1Node = pinsMapped[1] || "0"; // In-
      const pin2Node = pinsMapped[2] || "0"; // V+
      const pin3Node = pinsMapped[3] || "0"; // V-
      const pin4Node = pinsMapped[4] || "0"; // Out

      const offsetNodeId = resolveNode(`${comp.id}__offset_node`);

      const vos = comp.offsetVoltage !== undefined ? Number(comp.offsetVoltage) : 0.002;
      const aol = comp.openLoopGain !== undefined ? Number(comp.openLoopGain) : 100000.0;

      // 1. Fuente de tensión offset en serie
      extractedComponents.push({
        id: `${comp.id}__vos`,
        type: 'vsource',
        value: vos,
        pins: [pin0Node, offsetNodeId],
        waveType: 'dc',
      });

      // 2. Elemento opamp primitivo
      extractedComponents.push({
        id: comp.id,
        type: 'opamp',
        value: aol,
        pins: [offsetNodeId, pin1Node, pin2Node, pin3Node, pin4Node],
      });
    } else {
      if (comp.type === 'net_label' || comp.type === 'text_note') {
        continue;
      }

      const pinsMapped = getComponentNodes(pinsKeys);

      let subcircuitName: string | undefined;
      if (comp.type === 'x' && comp.spiceMacro) {
        for (const line of comp.spiceMacro.split('\n')) {
          const t = line.trim();
          if (t.toLowerCase().startsWith('.subckt')) {
            const parts = t.split(/\s+/);
            if (parts.length >= 2) subcircuitName = parts[1];
            break;
          }
        }
      }

      extractedComponents.push({
        id: comp.id,
        type: comp.type,
        value: Number(comp.value) || 0,
        pins: pinsMapped,
        waveType: comp.waveType,
        amplitude: comp.amplitude,
        frequency: comp.frequency,
        offset: comp.offset,
        dutyCycle: comp.dutyCycle,
        switchState: comp.type === 'switch' ? (comp.switchState ?? false) : undefined,
        switchRon: comp.switchRon,
        switchRoff: comp.switchRoff,
        switchVth: comp.switchVth,
        switchVh: comp.switchVh,
        subcircuitName,
        firmware: comp.firmware,
        mcuClockSpeed: comp.mcuClockSpeed,
      });
    }
  }

  // Mapear wires a IDs de nodos eléctricos
  const extractedWires = wires.map(w => {
    const fromKey = w.from.isJunction && w.from.junctionPos
      ? `junction:${Math.round(w.from.junctionPos.x)}_${Math.round(w.from.junctionPos.y)}`
      : pinKey(w.from.componentId, w.from.pinIndex);
    const toKey = w.to.isJunction && w.to.junctionPos
      ? `junction:${Math.round(w.to.junctionPos.x)}_${Math.round(w.to.junctionPos.y)}`
      : pinKey(w.to.componentId, w.to.pinIndex);
    const nodeFrom = resolveNode(fromKey);
    const nodeTo = resolveNode(toKey);
    return {
      id: w.id,
      nodes: [nodeFrom, nodeTo],
    };
  });

  // Concatenar todos los bloques spiceMacro de los Subcircuitos Genéricos (tipo 'x')
  const macroBlocks: string[] = [];
  for (const comp of components) {
    if (comp.type === 'x' && comp.spiceMacro && comp.spiceMacro.trim().length > 0) {
      macroBlocks.push(comp.spiceMacro.trim());
    }
  }
  const subcircuitDefinitions = macroBlocks.length > 0 ? macroBlocks.join("\n\n") : undefined;

  const netlist: CircuitNetlist = {
    components: extractedComponents,
    wires: extractedWires,
    mutual_inductances: netlistMutualInductances.length > 0 ? netlistMutualInductances : undefined,
    subcircuitDefinitions,
  };

  // Pre-flight ERC
  let ercError: string | undefined;

  if (isCacheHit) {
    ercError = topologicalCache?.error;
  } else {
    const node0Exists = Object.values(pinToNodeMap).includes("0");

    if (!node0Exists) {
      ercError = "Referencia a Tierra (GND / Nodo 0) no encontrada. Agrega un componente de Tierra.";
    } else {
      const nodeCounts: Record<string, number> = {};
      for (const comp of extractedComponents) {
        for (const pinNode of comp.pins) {
          nodeCounts[pinNode] = (nodeCounts[pinNode] || 0) + 1;
        }
      }

      const connectedPinKeys = new Set<string>();
      for (const wire of wires) {
        connectedPinKeys.add(pinKey(wire.from.componentId, wire.from.pinIndex));
        connectedPinKeys.add(pinKey(wire.to.componentId, wire.to.pinIndex));
      }

      const allowedFloatingNodes = new Set<string>();
      for (const comp of components) {
        if (!allowsFloatingPins(comp.type)) continue;
        for (const pin of getPins(comp)) {
          const key = pinKey(comp.id, pin.pinIndex);
          if (!connectedPinKeys.has(key)) {
            allowedFloatingNodes.add(pinToNodeMap[key]);
          }
        }
      }

      const lowDegreeNodes: string[] = [];
      for (const [nodeId, count] of Object.entries(nodeCounts)) {
        if (nodeId !== "0" && count < 2 && !allowedFloatingNodes.has(nodeId)) {
          lowDegreeNodes.push(nodeId);
        }
      }

      if (lowDegreeNodes.length > 0) {
        ercError = `Pre-flight ERC fallido: Nodo huérfano detectado (Nodo ${lowDegreeNodes.join(", ")} tiene grado de conexión < 2). Verifica que no haya cables flotantes o componentes desconectados.`;
      }
    }

    topologicalCache = {
      signature: currentSignature,
      pinToNodeMap: { ...pinToNodeMap },
      compPinMapping,
      subcircuitDefinitions,
      error: ercError,
    };
  }

  return { netlist, pinToNodeMap, error: ercError };
}

/** @internal — Exportado exclusivamente para pruebas unitarias de caja blanca */
export { DisjointSetUnion };
