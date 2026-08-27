// ==========================================================================
// SPICE NETLIST EXPORTER — Generador de Netlists Estándar (.cir / .sp / .net)
// ==========================================================================

import type { ComponentInstance, WireInstance } from "../canvas_orchestrator";
import { getComponentPins } from "../canvas/component_pins";
import { extractElectricalNetlist } from "./netlist_extractor";
import { ALL_COMMERCIAL_DISCRETE_MODELS } from "./commercial_discrete_models";
import { COMMERCIAL_SUBCIRCUITS } from "./commercial_ic_library";

export interface SpiceExportOptions {
  readonly title?: string;
  readonly targetFormat?: "spice3" | "ltspice" | "kicad";
  readonly analysisCommand?: string; // Ej. ".tran 1u 10ms", ".ac dec 20 10 100k", ".op"
  readonly includeHeader?: boolean;
  readonly includeModels?: boolean;
}

/**
 * Formatea un valor numérico a sufijos de ingeniería estándar SPICE (k, Meg, u, n, p, f).
 */
export function formatSpiceValue(val: number | string | undefined, defaultVal = "1k"): string {
  if (val === undefined || val === null || val === "") return defaultVal;
  if (typeof val === "string") {
    // Si ya contiene unidades o notación científica válida, preservarla
    return val.trim();
  }

  const num = Number(val);
  if (!Number.isFinite(num)) return defaultVal;
  if (num === 0) return "0";

  const abs = Math.abs(num);
  if (abs >= 1e12) return `${(num / 1e12).toFixed(3).replace(/\.?0+$/, "")}T`;
  if (abs >= 1e9) return `${(num / 1e9).toFixed(3).replace(/\.?0+$/, "")}G`;
  if (abs >= 1e6) return `${(num / 1e6).toFixed(3).replace(/\.?0+$/, "")}Meg`;
  if (abs >= 1e3) return `${(num / 1e3).toFixed(3).replace(/\.?0+$/, "")}k`;
  if (abs >= 1) return `${num.toFixed(3).replace(/\.?0+$/, "")}`;
  if (abs >= 1e-3) return `${(num * 1e3).toFixed(3).replace(/\.?0+$/, "")}m`;
  if (abs >= 1e-6) return `${(num * 1e6).toFixed(3).replace(/\.?0+$/, "")}u`;
  if (abs >= 1e-9) return `${(num * 1e9).toFixed(3).replace(/\.?0+$/, "")}n`;
  if (abs >= 1e-12) return `${(num * 1e12).toFixed(3).replace(/\.?0+$/, "")}p`;
  if (abs >= 1e-15) return `${(num * 1e15).toFixed(3).replace(/\.?0+$/, "")}f`;

  return num.toExponential(3);
}

/**
 * Exporta un circuito esquemático completo a código SPICE / LTspice (.cir).
 */
export function exportToSpiceNetlist(
  components: readonly ComponentInstance[],
  wires: readonly WireInstance[],
  options: SpiceExportOptions = {},
): string {
  const title = options.title || "Astryd Sophia Schematic Circuit";
  const analysisCmd = options.analysisCommand || ".tran 10u 20ms";
  const includeHeader = options.includeHeader ?? true;
  const includeModels = options.includeModels ?? true;

  const { netlist } = extractElectricalNetlist(components, wires, getComponentPins);

  const lines: string[] = [];

  // 1. Título y Cabecera SPICE
  if (includeHeader) {
    lines.push(`* ${title}`);
    lines.push(`* Generado por Astryd Sophia Electronic Design Automation`);
    lines.push(`* Fecha: ${new Date().toISOString()}`);
    lines.push(`* Formato: ${options.targetFormat?.toUpperCase() || "SPICE3 / LTSPICE"}`);
    lines.push("* -------------------------------------------------------------");
    lines.push("");
  }

  const usedModels = new Set<string>();
  const usedSubcircuits = new Set<string>();

  // 2. Componentes e Instancias
  for (const comp of netlist.components) {
    // Ignorar elementos gráficos o de documentación
    if (comp.type === "net_label" || comp.type === "text_note" || comp.type === "ground") {
      continue;
    }

    const pins = comp.pins;
    const p1 = pins[0] ?? "0";
    const p2 = pins[1] ?? "0";
    const p3 = pins[2] ?? "0";

    switch (comp.type) {
      case "resistor":
        lines.push(`R_${comp.id} ${p1} ${p2} ${formatSpiceValue(comp.value, "1k")}`);
        break;

      case "capacitor":
        lines.push(`C_${comp.id} ${p1} ${p2} ${formatSpiceValue(comp.value, "10u")}`);
        break;

      case "inductor":
        lines.push(`L_${comp.id} ${p1} ${p2} ${formatSpiceValue(comp.value, "1m")}`);
        break;

      case "diode": {
        const modelName = comp.modelName || "D1N4148";
        usedModels.add(modelName.toUpperCase());
        lines.push(`D_${comp.id} ${p1} ${p2} ${modelName}`);
        break;
      }

      case "npn": {
        const modelName = comp.modelName || "2N2222A";
        usedModels.add(modelName.toUpperCase());
        lines.push(`Q_${comp.id} ${p2} ${p1} ${p3} ${modelName}`); // C B E
        break;
      }

      case "pnp": {
        const modelName = comp.modelName || "2N2907A";
        usedModels.add(modelName.toUpperCase());
        lines.push(`Q_${comp.id} ${p2} ${p1} ${p3} ${modelName}`); // C B E
        break;
      }

      case "nmos": {
        const modelName = comp.modelName || "2N7000";
        usedModels.add(modelName.toUpperCase());
        lines.push(`M_${comp.id} ${p2} ${p1} ${p3} ${p3} ${modelName}`); // D G S Sub
        break;
      }

      case "pmos": {
        const modelName = comp.modelName || "BS250";
        usedModels.add(modelName.toUpperCase());
        lines.push(`M_${comp.id} ${p2} ${p1} ${p3} ${p3} ${modelName}`); // D G S Sub
        break;
      }

      case "vsource": {
        const vVal = formatSpiceValue(comp.value, "5");
        lines.push(`V_${comp.id} ${p1} ${p2} DC ${vVal}`);
        break;
      }

      case "isource": {
        const iVal = formatSpiceValue(comp.value, "1m");
        lines.push(`I_${comp.id} ${p1} ${p2} DC ${iVal}`);
        break;
      }

      case "opamp":
      case "opamp_ideal": {
        // Modelo ideal E (VCVS con ganancia Aol)
        lines.push(`E_${comp.id} ${p3} 0 ${p1} ${p2} 200k`);
        break;
      }

      case "x": {
        const subName = comp.subcircuitName || comp.modelName || String(comp.value || "SUBCKT");
        usedSubcircuits.add(subName.toUpperCase());
        let paramClause = "";
        if (comp.instanceParams && Object.keys(comp.instanceParams).length > 0) {
          const pairs = Object.entries(comp.instanceParams).map(([k, v]) => `${k}=${v}`);
          paramClause = ` PARAMS: ${pairs.join(" ")}`;
        }
        lines.push(`X_${comp.id} ${pins.join(" ")} ${subName}${paramClause}`);
        break;
      }

      default:
        // Carga pasiva de protección para componentes genéricos
        lines.push(`R_PASS_${comp.id} ${p1} ${p2} ${formatSpiceValue(comp.value, "1k")}`);
        break;
    }
  }

  // 3. Directiva de Análisis de Simulación
  lines.push("");
  lines.push("* --- Directivas de Simulación ---");
  lines.push(analysisCmd);

  // 4. Modelos SPICE embebidos (.MODEL y .SUBCKT)
  if (includeModels) {
    lines.push("");
    lines.push("* =============================================================");
    lines.push("* DEFINICIONES DE MODELOS SPICE EMBEBIDOS (.MODEL / .SUBCKT)");
    lines.push("* =============================================================");

    for (const mName of usedModels) {
      const model = ALL_COMMERCIAL_DISCRETE_MODELS.find((m) => m.name.toUpperCase() === mName);
      if (model) {
        lines.push(model.rawDefinition);
      } else {
        lines.push(`.MODEL ${mName} D(IS=1e-14 RS=0.1)`);
      }
    }

    for (const sName of usedSubcircuits) {
      const sub = COMMERCIAL_SUBCIRCUITS.find((s) => s.name.toUpperCase() === sName);
      if (sub) {
        lines.push("");
        lines.push(sub.rawNetlist);
      }
    }
  }

  lines.push("");
  lines.push(".END");

  return lines.join("\n");
}
