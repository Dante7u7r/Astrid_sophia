import type { ComponentInstance } from "../canvas_orchestrator";
import type { Tab } from "../ui/workspace_state";
import { getComponentPins } from "../canvas/component_pins";
import { extractElectricalNetlist } from "./netlist_extractor";

export interface SubcircuitPortInfo {
  name: string;
  pinIndex: number;
  node: string;
}

export interface GeneratedSubcircuit {
  name: string;
  ports: string[];
  spiceText: string;
}

/**
 * Sanitiza un identificador para que sea válido en la sintaxis SPICE (.subckt).
 */
export function sanitizeSpiceName(name: string): string {
  const cleaned = name.trim().replace(/[^a-zA-Z0-9_]/g, "_");
  return cleaned.length > 0 ? cleaned : "SUBCKT_BLOCK";
}

/**
 * Genera la definición de macromodelo SPICE (.subckt ... .ends) a partir de una hoja esquemática (Tab o circuito).
 */
export function generateSubcircuitFromTab(
  tab: Pick<Tab, "name" | "components" | "wires"> & { subcircuitName?: string },
  customName?: string,
): GeneratedSubcircuit {
  const subcircuitName = sanitizeSpiceName(customName || tab.subcircuitName || tab.name || "SUBCKT");

  // 1. Extraer el netlist eléctrico interno de la hoja hija
  const netlistRes = extractElectricalNetlist(tab.components, tab.wires, getComponentPins);
  const netlist = netlistRes.netlist;

  // 2. Identificar los puertos de interfaz (componentes net_label marcados como terminales o puertos de interfaz)
  const interfaceLabels = tab.components.filter(
    (c) => c.type === "net_label" && c.terminalType !== "ground" && c.terminalType !== "power",
  );

  // Ordenar puertos por posición vertical y horizontal para determinismo
  interfaceLabels.sort((a, b) => {
    if (Math.abs(a.y - b.y) > 5) return a.y - b.y;
    return a.x - b.x;
  });

  const portNames: string[] = [];
  const portNodes: string[] = [];

  for (const labelComp of interfaceLabels) {
    const pName = String(labelComp.label || labelComp.value || labelComp.id).trim().toUpperCase();
    const cleanPortName = sanitizeSpiceName(pName);
    if (!portNames.includes(cleanPortName)) {
      portNames.push(cleanPortName);

      // Buscar qué nodo SPICE interno fue asignado al pin de esta net_label
      const wireOrComp = netlist.components.find((c) => c.id === labelComp.id);
      if (wireOrComp && wireOrComp.pins.length > 0) {
        portNodes.push(wireOrComp.pins[0]);
      } else {
        portNodes.push(cleanPortName);
      }
    }
  }

  // Si no hay net_labels de interfaz, generar puertos por defecto basados en componentes
  if (portNames.length === 0) {
    portNames.push("IN", "OUT");
    portNodes.push("1", "2");
  }

  // 3. Formatear las líneas internas de componentes en sintaxis SPICE
  const lines: string[] = [];
  lines.push(`.subckt ${subcircuitName} ${portNames.join(" ")}`);

  // Mapear cada nodo interno: si coincide con un puerto de interfaz, usar el nombre del puerto; de lo contrario, mantener el nodo interno
  const nodeAliasMap = new Map<string, string>();
  for (let i = 0; i < portNodes.length; i++) {
    nodeAliasMap.set(portNodes[i], portNames[i]);
  }

  const mapNode = (n: string): string => {
    if (n === "0") return "0";
    return nodeAliasMap.get(n) ?? `N_${n}`;
  };

  for (const comp of netlist.components) {
    // Ignorar net_labels ya que sus nodos se convierten en los puertos de la cabecera
    if (comp.type === "net_label" || comp.type === "text_note") continue;

    const mappedPins = comp.pins.map(mapNode);

    switch (comp.type) {
      case "resistor":
        lines.push(`R_${comp.id} ${mappedPins.join(" ")} ${comp.value}`);
        break;
      case "capacitor":
        lines.push(`C_${comp.id} ${mappedPins.join(" ")} ${comp.value}`);
        break;
      case "inductor":
        lines.push(`L_${comp.id} ${mappedPins.join(" ")} ${comp.value}`);
        break;
      case "diode":
        lines.push(`D_${comp.id} ${mappedPins.join(" ")} DMOD_${comp.id}`);
        lines.push(`.model DMOD_${comp.id} D(IS=${comp.diodeIs ?? 1e-14} RS=${comp.diodeRs ?? 0})`);
        break;
      case "vsource":
        lines.push(`V_${comp.id} ${mappedPins.join(" ")} ${comp.value}`);
        break;
      case "isource":
        lines.push(`I_${comp.id} ${mappedPins.join(" ")} ${comp.value}`);
        break;
      case "opamp":
      case "opamp_ideal":
        // Opamp macromodel primitivo
        lines.push(`E_${comp.id} ${mappedPins[2]} 0 ${mappedPins[0]} ${mappedPins[1]} ${comp.opampAol ?? 100000}`);
        break;
      case "x": {
        const subName = comp.subcircuitName || String(comp.value || "SUBCKT");
        lines.push(`X_${comp.id} ${mappedPins.join(" ")} ${subName}`);
        break;
      }
      default:
        // Componente genérico
        lines.push(`R_GEN_${comp.id} ${mappedPins[0] ?? "0"} ${mappedPins[1] ?? "0"} 1k`);
        break;
    }
  }

  lines.push(`.ends ${subcircuitName}`);

  return {
    name: subcircuitName,
    ports: portNames,
    spiceText: lines.join("\n"),
  };
}

/**
 * Recorre todas las instancias de subcircuito (`type === "x"`) en un conjunto de componentes y recolecta
 * recursivamente las definiciones `.subckt` de las hojas hijas correspondientes.
 */
export function gatherHierarchicalSubcircuitDefinitions(
  rootComponents: readonly ComponentInstance[],
  allTabs: readonly Tab[],
  visitedTabs = new Set<string>(),
): string {
  const definitions: string[] = [];

  for (const comp of rootComponents) {
    if (comp.type === "x") {
      // 1. Si ya tiene spiceMacro explícito embebido, usarlo
      if (comp.spiceMacro && comp.spiceMacro.trim().length > 0) {
        definitions.push(comp.spiceMacro.trim());
        continue;
      }

      // 2. Buscar pestaña hija coincidente por ID o por nombre
      const targetTab = allTabs.find(
        (t) =>
          (comp.subcircuitTabId && t.id === comp.subcircuitTabId) ||
          (comp.subcircuitName && (t.subcircuitName === comp.subcircuitName || t.name === comp.subcircuitName)) ||
          (comp.value && (t.subcircuitName === String(comp.value) || t.name === String(comp.value))),
      );

      if (targetTab && !visitedTabs.has(targetTab.id)) {
        visitedTabs.add(targetTab.id);

        const sub = generateSubcircuitFromTab(targetTab, comp.subcircuitName || String(comp.value || ""));
        definitions.push(sub.spiceText);

        // Recurrir en los componentes de la pestaña hija para subcircuitos anidados
        const nestedDefs = gatherHierarchicalSubcircuitDefinitions(
          targetTab.components,
          allTabs,
          visitedTabs,
        );
        if (nestedDefs.length > 0) {
          definitions.push(nestedDefs);
        }
      }
    }
  }

  return definitions.join("\n\n");
}
