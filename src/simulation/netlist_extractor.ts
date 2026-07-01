import { ComponentInstance, PinInstance, WireInstance } from "../canvas_orchestrator";
import {
  parseLampActuatorModel,
  parseBuzzerActuatorModel,
  parseRelayActuatorModel,
} from "../ui/actuator_helpers";

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
  readonly subcircuitName?: string;
  readonly firmware?: Uint8Array;
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

class DisjointSetUnion {
  private parent: Record<string, string> = {};

  find(i: string): string {
    if (!this.parent[i]) {
      this.parent[i] = i;
      return i;
    }
    if (this.parent[i] === i) {
      return i;
    }
    const root = this.find(this.parent[i]);
    this.parent[i] = root;
    return root;
  }

  union(i: string, j: string): void {
    const rootI = this.find(i);
    const rootJ = this.find(j);
    if (rootI !== rootJ) {
      this.parent[rootI] = rootJ;
    }
  }
}

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

export function extractElectricalNetlist(
  components: readonly ComponentInstance[],
  wires: readonly WireInstance[],
  getPins: (comp: ComponentInstance) => readonly PinInstance[],
): NetlistExtractionResult {
  const dsu = new DisjointSetUnion();

  // 1. Declarar cada pin de cada componente en el DSU
  const allPinKeys: string[] = [];
  const compPinMapping: Record<string, string[]> = {};

  for (const comp of components) {
    if (comp.type === 'relay') {
      compPinMapping[comp.id] = [
        `${comp.id}:0`,
        `${comp.id}:1`,
        `${comp.id}:2`,
        `${comp.id}:3`,
        `${comp.id}:internal`,
      ];
      allPinKeys.push(`${comp.id}:0`, `${comp.id}:1`, `${comp.id}:2`, `${comp.id}:3`, `${comp.id}:internal`);
    } else {
      const pins = getPins(comp);
      compPinMapping[comp.id] = [];
      for (const pin of pins) {
        const pinKey = `${comp.id}:${pin.pinIndex}`;
        allPinKeys.push(pinKey);
        compPinMapping[comp.id].push(pinKey);
      }
    }
  }

  // 2. Unir los pins que están conectados por cables (wires)
  for (const wire of wires) {
    const keyFrom = `${wire.from.componentId}:${wire.from.pinIndex}`;
    const keyTo = `${wire.to.componentId}:${wire.to.pinIndex}`;
    dsu.union(keyFrom, keyTo);
  }

  // 3. Identificar el grupo de Tierra (GND) y asignarle el ID de nodo "0"
  let gndRoot: string | null = null;
  for (const comp of components) {
    if (comp.type === 'ground') {
      const gndPinKey = `${comp.id}:0`;
      gndRoot = dsu.find(gndPinKey);
      break;
    }
  }

  // 4. Mapear cada raíz de grupo a un índice de nodo eléctrico único
  const rootToNodeIdMap: Record<string, string> = {};
  let nextNodeId = 1;

  if (gndRoot) {
    rootToNodeIdMap[gndRoot] = "0";
  }

  const extractedComponents: ExtractedComponent[] = [];
  let netlistMutualInductances: MutualInductance[] = [];

  for (const comp of components) {
    const pinsKeys = compPinMapping[comp.id] || [];

    if (comp.type === 'potentiometer') {
      const pinsMapped = pinsKeys.map(pk => {
        const root = dsu.find(pk);
        if (!rootToNodeIdMap[root]) {
          rootToNodeIdMap[root] = nextNodeId.toString();
          nextNodeId++;
        }
        return rootToNodeIdMap[root];
      });

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
      const pinsMapped = pinsKeys.map(pk => {
        const root = dsu.find(pk);
        if (!rootToNodeIdMap[root]) {
          rootToNodeIdMap[root] = nextNodeId.toString();
          nextNodeId++;
        }
        return rootToNodeIdMap[root];
      });

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
    } else if (comp.type === 'lamp') {
      const model = parseLampActuatorModel(comp.value?.toString() ?? "");
      const pinsMapped = pinsKeys.map(pk => {
        const root = dsu.find(pk);
        if (!rootToNodeIdMap[root]) {
          rootToNodeIdMap[root] = nextNodeId.toString();
          nextNodeId++;
        }
        return rootToNodeIdMap[root];
      });
      extractedComponents.push({
        id: comp.id,
        type: 'resistor',
        value: model.coldResistanceOhms,
        pins: pinsMapped,
      });
    } else if (comp.type === 'buzzer') {
      const model = parseBuzzerActuatorModel(comp.value?.toString() ?? "");
      const pinsMapped = pinsKeys.map(pk => {
        const root = dsu.find(pk);
        if (!rootToNodeIdMap[root]) {
          rootToNodeIdMap[root] = nextNodeId.toString();
          nextNodeId++;
        }
        return rootToNodeIdMap[root];
      });
      extractedComponents.push({
        id: comp.id,
        type: 'resistor',
        value: model.inactiveResistanceOhms,
        pins: pinsMapped,
      });
    } else if (comp.type === 'relay') {
      const model = parseRelayActuatorModel(comp.value?.toString() ?? "");
      const pin0Root = dsu.find(`${comp.id}:0`);
      const pin1Root = dsu.find(`${comp.id}:1`);
      const pin2Root = dsu.find(`${comp.id}:2`);
      const pin3Root = dsu.find(`${comp.id}:3`);
      const internalRoot = dsu.find(`${comp.id}:internal`);

      const roots = [pin0Root, pin1Root, pin2Root, pin3Root, internalRoot];
      roots.forEach(r => {
        if (!rootToNodeIdMap[r]) {
          rootToNodeIdMap[r] = nextNodeId.toString();
          nextNodeId++;
        }
      });

      const pin0Node = rootToNodeIdMap[pin0Root];
      const pin1Node = rootToNodeIdMap[pin1Root];
      const pin2Node = rootToNodeIdMap[pin2Root];
      const pin3Node = rootToNodeIdMap[pin3Root];
      const pinInternalNode = rootToNodeIdMap[internalRoot];

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
      const pin0Root = dsu.find(`${comp.id}:0`);
      const pin1Root = dsu.find(`${comp.id}:1`);
      const pin2Root = dsu.find(`${comp.id}:2`);
      const pin3Root = dsu.find(`${comp.id}:3`);

      const roots = [pin0Root, pin1Root, pin2Root, pin3Root];
      roots.forEach(r => {
        if (!rootToNodeIdMap[r]) {
          rootToNodeIdMap[r] = nextNodeId.toString();
          nextNodeId++;
        }
      });

      const priNode1 = rootToNodeIdMap[pin0Root];
      const priNode2 = rootToNodeIdMap[pin1Root];
      const secNode1 = rootToNodeIdMap[pin2Root];
      const secNode2 = rootToNodeIdMap[pin3Root];

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
    } else {
      const pinsMapped: string[] = [];
      for (const pk of pinsKeys) {
        const root = dsu.find(pk);
        if (!rootToNodeIdMap[root]) {
          rootToNodeIdMap[root] = nextNodeId.toString();
          nextNodeId++;
        }
        pinsMapped.push(rootToNodeIdMap[root]);
      }

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
        subcircuitName,
        firmware: comp.firmware,
      });
    }
  }

  // Mapear wires a IDs de nodos eléctricos
  const extractedWires = wires.map(w => {
    const fromKey = `${w.from.componentId}:${w.from.pinIndex}`;
    const toKey = `${w.to.componentId}:${w.to.pinIndex}`;
    const nodeFrom = rootToNodeIdMap[dsu.find(fromKey)] || "0";
    const nodeTo = rootToNodeIdMap[dsu.find(toKey)] || "0";
    return {
      id: w.id,
      nodes: [nodeFrom, nodeTo],
    };
  });

  // Poblar mapa de terminales a nodos eléctricos
  const pinToNodeMap: Record<string, string> = {};
  for (const comp of components) {
    const pinsKeys = compPinMapping[comp.id] || [];
    for (const pk of pinsKeys) {
      const root = dsu.find(pk);
      const nodeId = rootToNodeIdMap[root] || "0";
      pinToNodeMap[pk] = nodeId;
    }
  }

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

    const lowDegreeNodes: string[] = [];
    for (const [nodeId, count] of Object.entries(nodeCounts)) {
      if (nodeId !== "0" && count < 2) {
        lowDegreeNodes.push(nodeId);
      }
    }

    if (lowDegreeNodes.length > 0) {
      ercError = `Pre-flight ERC fallido: Nodo huérfano detectado (Nodo ${lowDegreeNodes.join(", ")} tiene grado de conexión < 2). Verifica que no haya cables flotantes o componentes desconectados.`;
    }
  }

  return { netlist, pinToNodeMap, error: ercError };
}

/** @internal — Exportado exclusivamente para pruebas unitarias de caja blanca */
export { DisjointSetUnion };
