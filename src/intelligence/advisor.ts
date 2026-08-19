import type { ERCResult } from "../simulation/simulation_dispatcher";
import type { CircuitNetlist } from "../simulation/netlist_extractor";
import type { AnalysisMode } from "../ui/simulation_controls";
import type { SimulationSettings } from "../ui/settings_modal";

export type RecommendationSafety = "informational" | "reversible" | "scientific-review-required";

export interface AdvisorContext {
  readonly analysis: AnalysisMode;
  readonly netlist: CircuitNetlist;
  readonly erc: ERCResult;
  readonly settings: Readonly<SimulationSettings>;
  readonly transientDuration: number;
}

export interface AdvisorRecommendation {
  readonly recommendationId: string;
  readonly ruleId: string;
  readonly ruleVersion: number;
  readonly title: string;
  readonly explanation: string;
  readonly evidence: string;
  readonly safetyClass: RecommendationSafety;
  readonly confidence: number;
  readonly settingsPatch?: Partial<SimulationSettings>;
}

interface AdvisorRule {
  readonly id: string;
  readonly version: number;
  evaluate(context: AdvisorContext): Omit<AdvisorRecommendation, "recommendationId" | "ruleId" | "ruleVersion"> | null;
}

function recommendationId(ruleId: string): string {
  const suffix = typeof crypto?.randomUUID === "function"
    ? crypto.randomUUID()
    : `${Date.now()}-${Math.random().toString(16).slice(2)}`;
  return `${ruleId}:${suffix}`;
}

function hasErc(context: AdvisorContext, pattern: RegExp): boolean {
  return [...context.erc.errors, ...context.erc.warnings].some((message) => pattern.test(message));
}

function countTypes(context: AdvisorContext, pattern: RegExp): number {
  return context.netlist.components.filter((component) => pattern.test(component.type)).length;
}

function minRcTau(context: AdvisorContext): number | null {
  const resistors = context.netlist.components
    .filter((component) => /resistor|potentiometer|thermistor|ldr/i.test(component.type))
    .map((component) => component.value)
    .filter((value) => Number.isFinite(value) && value > 0);
  const capacitors = context.netlist.components
    .filter((component) => /capacitor/i.test(component.type))
    .map((component) => component.value)
    .filter((value) => Number.isFinite(value) && value > 0);
  if (resistors.length === 0 || capacitors.length === 0) return null;
  return Math.min(...resistors) * Math.min(...capacitors);
}

function maxRcTau(context: AdvisorContext): number | null {
  const resistors = context.netlist.components
    .filter((component) => /resistor|potentiometer|thermistor|ldr/i.test(component.type))
    .map((component) => component.value)
    .filter((value) => Number.isFinite(value) && value > 0);
  const capacitors = context.netlist.components
    .filter((component) => /capacitor/i.test(component.type))
    .map((component) => component.value)
    .filter((value) => Number.isFinite(value) && value > 0);
  if (resistors.length === 0 || capacitors.length === 0) return null;
  return Math.max(...resistors) * Math.max(...capacitors);
}

function minLcResonanceFreq(context: AdvisorContext): number | null {
  const inductors = context.netlist.components
    .filter((component) => /inductor/i.test(component.type))
    .map((component) => component.value)
    .filter((value) => Number.isFinite(value) && value > 0);
  const capacitors = context.netlist.components
    .filter((component) => /capacitor/i.test(component.type))
    .map((component) => component.value)
    .filter((value) => Number.isFinite(value) && value > 0);
  if (inductors.length === 0 || capacitors.length === 0) return null;
  const lMin = Math.min(...inductors);
  const cMin = Math.min(...capacitors);
  return 1 / (2 * Math.PI * Math.sqrt(lMin * cMin));
}

function ercRule(
  id: string,
  pattern: RegExp,
  title: string,
  explanation: string,
): AdvisorRule {
  return {
    id,
    version: 1,
    evaluate: (context) => hasErc(context, pattern) ? {
      title,
      explanation,
      evidence: "El ERC produjo el código topológico asociado.",
      safetyClass: "informational",
      confidence: 1,
    } : null,
  };
}

export const ADVISOR_RULES: readonly AdvisorRule[] = [
  ercRule("erc.missing-ground", /tierra|gnd/i, "Añade una referencia GND", "El sistema MNA necesita una referencia de potencial única."),
  ercRule("erc.shorted-vsource", /cortocircuito franco/i, "Corrige la fuente cortocircuitada", "Una fuente ideal no puede imponer tensión entre el mismo nodo."),
  ercRule("erc.parallel-vsource", /fuentes en paralelo/i, "Elimina la restricción de fuentes redundante", "Dos fuentes ideales sobre los mismos nodos hacen singular la formulación."),
  ercRule("erc.floating-pin", /pin flotante/i, "Revisa el pin flotante", "El pin sin conexión puede ser intencional, pero debe confirmarse antes de interpretar resultados."),
  ercRule("erc.orphan-component", /hu[eé]rfano/i, "Conecta o elimina el componente huérfano", "El componente no participa eléctricamente en el circuito."),
  ercRule("erc.isolated-subcircuit", /subcircuito aislado/i, "Conecta el subcircuito a la referencia", "La isla eléctrica carece de camino de referencia para MNA."),
  ercRule("erc.ideal-source-loop", /bucle de fuentes/i, "Rompe el lazo de fuentes ideales", "El lazo impone una corriente indeterminada."),
  ercRule("erc.temporal-mcu", /mcu temporal/i, "Sustituye el MCU temporal", "Ese runtime no ejecuta firmware y no es una base científica válida."),
  {
    id: "tran.rc-time-step",
    version: 1,
    evaluate(context) {
      if (context.analysis !== "TRAN") return null;
      const tau = minRcTau(context);
      if (tau === null || context.settings.dt <= tau / 10) return null;
      return {
        title: "Reduce el paso temporal respecto a la constante RC",
        explanation: "Un dt grande puede ocultar la dinámica más rápida del circuito.",
        evidence: `dt/τmín = ${(context.settings.dt / tau).toPrecision(3)}; objetivo conservador ≤ 0.05.`,
        safetyClass: "reversible",
        confidence: 0.96,
        settingsPatch: { dt: Math.max(1e-9, tau / 20) },
      };
    },
  },
  {
    id: "tran.excessive-points",
    version: 1,
    evaluate(context) {
      if (context.analysis !== "TRAN") return null;
      const points = Math.ceil(context.transientDuration / context.settings.dt);
      return points > 500_000 ? {
        title: "La simulación solicita demasiados pasos",
        explanation: "Aumentar dt reduce coste, pero puede perder eventos; requiere revisión científica.",
        evidence: `${points.toLocaleString()} pasos solicitados.`,
        safetyClass: "scientific-review-required",
        confidence: 0.9,
      } : null;
    },
  },
  {
    id: "solver.low-iteration-limit",
    version: 1,
    evaluate(context) {
      const nonlinear = countTypes(context, /diode|bjt|mos|jfet|opamp|switch/i);
      return nonlinear > 0 && context.settings.maxIterations < 50 ? {
        title: "Amplía el límite de iteraciones no lineales",
        explanation: "El límite actual es bajo para un circuito con dispositivos no lineales.",
        evidence: `${nonlinear} dispositivos no lineales; límite ${context.settings.maxIterations}.`,
        safetyClass: "reversible",
        confidence: 0.88,
        settingsPatch: { maxIterations: 100 },
      } : null;
    },
  },
  {
    id: "solver.excessive-iteration-limit",
    version: 1,
    evaluate: (context) => context.settings.maxIterations > 2_000 ? {
      title: "Revisa el límite extremo de iteraciones",
      explanation: "Un límite muy alto puede ocultar un circuito mal condicionado y bloquear la interfaz.",
      evidence: `Límite configurado: ${context.settings.maxIterations}.`,
      safetyClass: "reversible",
      confidence: 0.84,
      settingsPatch: { maxIterations: 500 },
    } : null,
  },
  {
    id: "solver.loose-tolerance",
    version: 1,
    evaluate: (context) => context.settings.tolerance > 1e-3 ? {
      title: "Usa una tolerancia numérica más estricta",
      explanation: "La tolerancia actual puede aceptar una solución con error material.",
      evidence: `Tolerancia configurada: ${context.settings.tolerance.toExponential(2)}.`,
      safetyClass: "reversible",
      confidence: 0.94,
      settingsPatch: { tolerance: 1e-5 },
    } : null,
  },
  {
    id: "solver.overstrict-tolerance",
    version: 1,
    evaluate: (context) => context.settings.tolerance < 1e-12 ? {
      title: "Evita una tolerancia por debajo de la precisión útil",
      explanation: "La exigencia extrema aumenta iteraciones sin garantizar más exactitud física.",
      evidence: `Tolerancia configurada: ${context.settings.tolerance.toExponential(2)}.`,
      safetyClass: "reversible",
      confidence: 0.9,
      settingsPatch: { tolerance: 1e-9 },
    } : null,
  },
  {
    id: "ac.no-reactive-device",
    version: 1,
    evaluate: (context) => context.analysis === "AC" && countTypes(context, /capacitor|inductor|transmission|opamp|bjt|mos|jfet/i) === 0 ? {
      title: "El barrido AC no contiene elementos dependientes de frecuencia",
      explanation: "La respuesta será esencialmente plana salvo modelos internos no visibles.",
      evidence: "No se detectaron dispositivos reactivos o activos con dinámica.",
      safetyClass: "informational",
      confidence: 0.92,
    } : null,
  },
  {
    id: "pss.no-periodic-source",
    version: 1,
    evaluate: (context) => context.analysis === "PSS" && !context.netlist.components.some((component) => (component.frequency ?? 0) > 0) ? {
      title: "PSS necesita una excitación periódica explícita",
      explanation: "Sin frecuencia fundamental, el periodo de shooting no tiene evidencia física suficiente.",
      evidence: "Ninguna fuente declara frecuencia positiva.",
      safetyClass: "scientific-review-required",
      confidence: 0.98,
    } : null,
  },
  {
    id: "model.experimental-bsim",
    version: 1,
    evaluate: (context) => countTypes(context, /bsim3|bsim4/i) > 0 ? {
      title: "Trata BSIM como modelo experimental",
      explanation: "La implementación parcial no reproduce la corriente de referencia y no sirve todavía para predicción física.",
      evidence: `${countTypes(context, /bsim3|bsim4/i)} dispositivos BSIM; la caracterización NMOS BSIM3 contra ngspice difiere entre 97.9 % y 99.3 %.`,
      safetyClass: "scientific-review-required",
      confidence: 1,
    } : null,
  },
  {
    id: "model.firmware-present",
    version: 1,
    evaluate: (context) => context.netlist.components.some((component) => Boolean(component.firmware?.length)) ? {
      title: "No interpretes el firmware como ejecución cycle-accurate",
      explanation: "La co-simulación MCU actual no implementa la ISA y los periféricos completos.",
      evidence: "El netlist contiene firmware, pero el runtime es experimental.",
      safetyClass: "scientific-review-required",
      confidence: 1,
    } : null,
  },
  {
    id: "topology.large-circuit",
    version: 1,
    evaluate: (context) => context.netlist.components.length > 500 ? {
      title: "Circuito grande: vigila memoria y convergencia",
      explanation: "El coste y el condicionamiento pueden crecer de forma no lineal.",
      evidence: `${context.netlist.components.length} componentes.`,
      safetyClass: "informational",
      confidence: 0.85,
    } : null,
  },
  {
    id: "topology.no-independent-source",
    version: 1,
    evaluate: (context) => !context.netlist.components.some((component) => /vsource|isource/i.test(component.type)) ? {
      title: "No se detectó una fuente independiente",
      explanation: "Un análisis puede ser válido con condiciones iniciales, pero un resultado nulo sería esperable en muchos circuitos pasivos.",
      evidence: "Conteo de fuentes independientes: 0.",
      safetyClass: "informational",
      confidence: 0.82,
    } : null,
  },
  {
    id: "topology.single-node",
    version: 1,
    evaluate(context) {
      const nodes = new Set(context.netlist.components.flatMap((component) => component.pins));
      return nodes.size <= 1 ? {
        title: "La topología sólo contiene un nodo eléctrico",
        explanation: "No existe diferencia de potencial resoluble entre nodos distintos.",
        evidence: `${nodes.size} nodo eléctrico.`,
        safetyClass: "informational",
        confidence: 0.99,
      } : null;
    },
  },
  {
    id: "tran.lc-resonance-step",
    version: 1,
    evaluate(context) {
      if (context.analysis !== "TRAN") return null;
      const fRes = minLcResonanceFreq(context);
      if (fRes === null || fRes <= 0) return null;
      const period = 1 / fRes;
      if (context.settings.dt <= period / 10) return null;
      const recommendedDt = Math.max(1e-9, period / 20);
      const fStr = fRes >= 1e6 ? `${(fRes / 1e6).toFixed(2)} MHz` : fRes >= 1e3 ? `${(fRes / 1e3).toFixed(1)} kHz` : `${fRes.toFixed(0)} Hz`;
      return {
        title: "Paso temporal insuficiente para circuito resonante LC",
        explanation: `El circuito contiene inductores y capacitores con resonancia aproximada a ${fStr}. Un paso temporal grande producirá aliasing numérico y distorsión de la oscilación.`,
        evidence: `f_res = ${fStr}; dt actual = ${context.settings.dt.toExponential(2)} s (debe ser ≤ ${(period / 10).toExponential(2)} s).`,
        safetyClass: "reversible",
        confidence: 0.95,
        settingsPatch: { dt: recommendedDt },
      };
    },
  },
  {
    id: "tran.stiff-system-warning",
    version: 1,
    evaluate(context) {
      if (context.analysis !== "TRAN") return null;
      const minTau = minRcTau(context);
      const maxTau = maxRcTau(context);
      if (minTau === null || maxTau === null || minTau <= 0) return null;
      const ratio = maxTau / minTau;
      if (ratio < 1e4) return null;
      return {
        title: "Sistema dinámico rígido (Stiff System)",
        explanation: "Existen constantes de tiempo extremadamente dispares en el circuito. La integración numérica requiere tolerancias estrictas para evitar inestabilidad.",
        evidence: `Ratio τ_máx / τ_mín = ${ratio.toExponential(1)} (> 10⁴).`,
        safetyClass: "reversible",
        confidence: 0.89,
        settingsPatch: { tolerance: 1e-6, maxIterations: 100 },
      };
    },
  },
] as const;

export function evaluateAdvisor(
  context: AdvisorContext,
  disabledRuleIds: ReadonlySet<string> = new Set(),
): AdvisorRecommendation[] {
  const recommendations: AdvisorRecommendation[] = [];
  for (const rule of ADVISOR_RULES) {
    if (disabledRuleIds.has(rule.id)) continue;
    const result = rule.evaluate(context);
    if (!result) continue;
    recommendations.push({
      ...result,
      recommendationId: recommendationId(rule.id),
      ruleId: rule.id,
      ruleVersion: rule.version,
    });
  }
  return recommendations;
}
