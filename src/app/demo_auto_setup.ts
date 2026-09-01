/**
 * demo_auto_setup.ts — Orquestador de Auto-Arranque, Auto-Sondeo y Calibración de Demos
 *
 * Analiza la topología de los circuitos de demostración cargados para ubicar
 * automáticamente las sondas de medición (CH1 en Entrada, CH2 en Salida) y
 * coordinar la visualización interactiva instantánea.
 */

import type { ComponentInstance } from "../canvas_orchestrator";

export interface DemoProbeTargets {
  ch1Node: string | null;
  ch2Node: string | null;
  ch1ComponentId?: string;
  ch2ComponentId?: string;
  recommendedAnalysisMode?: "TRAN" | "AC" | "DC" | "PSS";
}

/**
 * Analiza los componentes y el mapa de nodos de un circuito de demostración
 * para determinar las mejores ubicaciones de sonda para CH1 y CH2.
 */
export function resolveDemoProbeTargets(
  components: readonly ComponentInstance[],
  pinToNodeMap: Readonly<Record<string, string>>,
): DemoProbeTargets {
  let ch1Node: string | null = null;
  let ch2Node: string | null = null;
  let ch1Comp: string | undefined;
  let ch2Comp: string | undefined;

  // 1. Prioridad: Net Labels / Test Points explícitos
  for (const comp of components) {
    if (comp.type === "net_label" || comp.type === "text_note") {
      const val = String(comp.value || comp.label || "").toUpperCase();
      const node = pinToNodeMap[`${comp.id}:0`];
      if (node && node !== "0") {
        if (val.includes("VIN") || val.includes("AC") || val.includes("IN")) {
          if (!ch1Node) {
            ch1Node = node;
            ch1Comp = comp.id;
          }
        } else if (
          val.includes("VOUT") ||
          val.includes("PULSE") ||
          val.includes("RECT") ||
          val.includes("OUT") ||
          val.includes("NET_A")
        ) {
          if (!ch2Node) {
            ch2Node = node;
            ch2Comp = comp.id;
          }
        }
      }
    }
  }

  // 2. Si no se encontró CH1, asignar al terminal activo de la fuente primaria
  if (!ch1Node) {
    const primarySource = components.find(
      (c) => c.id === "V1" || c.id === "I1" || c.type === "vsource" || c.type === "isource",
    );
    if (primarySource) {
      const n0 = pinToNodeMap[`${primarySource.id}:0`];
      const n1 = pinToNodeMap[`${primarySource.id}:1`];
      const sourceNode = (n0 && n0 !== "0") ? n0 : (n1 && n1 !== "0") ? n1 : null;
      if (sourceNode) {
        ch1Node = sourceNode;
        ch1Comp = primarySource.id;
      }
    }
  }

  // 3. Si no se encontró CH2, buscar salida de OpAmp / Comparador o Carga
  if (!ch2Node) {
    const opamp = components.find(
      (c) => c.type === "opamp" || c.type === "opamp_ideal" || c.type === "comparator_ideal",
    );
    if (opamp) {
      const outNode = pinToNodeMap[`${opamp.id}:4`] ?? pinToNodeMap[`${opamp.id}:2`];
      if (outNode && outNode !== "0") {
        ch2Node = outNode;
        ch2Comp = opamp.id;
      }
    } else {
      const loadResistor = components.find(
        (c) => c.id.startsWith("RL") || c.id === "R2" || c.id === "R1",
      );
      if (loadResistor) {
        const n0 = pinToNodeMap[`${loadResistor.id}:0`];
        const n1 = pinToNodeMap[`${loadResistor.id}:1`];
        const candidate =
          n0 && n0 !== "0" && n0 !== ch1Node
            ? n0
            : n1 && n1 !== "0" && n1 !== ch1Node
            ? n1
            : null;
        if (candidate) {
          ch2Node = candidate;
          ch2Comp = loadResistor.id;
        }
      }
    }
  }

  return {
    ch1Node,
    ch2Node,
    ch1ComponentId: ch1Comp,
    ch2ComponentId: ch2Comp,
    recommendedAnalysisMode: "TRAN",
  };
}
