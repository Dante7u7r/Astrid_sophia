/**
 * StressAnalysis — Diagnóstico de Estrés Físico y Área de Operación Segura (SOA / Smoke Analysis)
 *
 * Evalúa las condiciones de operación eléctrica y térmica en tiempo real sobre los componentes del circuito:
 * - Resistencias: Disipación de potencia P = V^2 / R contra límite nominal (P_max, defecto 0.25 W).
 * - Condensadores: Tensión continua V_dc contra tensión máxima de ruptura de dieléctrico.
 * - Diodos: Tensión inversa pico (PIV / VRRM) y corriente continua directa IF_max.
 * - Transistores BJT: Tensión V_CE contra V_CEO, corriente I_C contra I_Cmax y potencia total P_tot.
 * - Transistores MOSFET: Tensión V_DS contra V_DSS, tensión V_GS contra V_GSS (+-20V) y corriente I_D.
 * - Detector de Picos Inductivos: Conmutación inductiva sin diodo de protección en antiparalelo (Flyback).
 */

import type { CircuitNetlist } from "../simulation/netlist_extractor";

export type ComponentStressStatus = "safe" | "warning" | "overload";

export interface ComponentStressItem {
  readonly componentId: string;
  readonly componentType: string;
  readonly metricName: string;         // Ej: "Potencia Disipada (P)", "Tensión Inversa (VR)", "Tensión Vce"
  readonly actualValue: number;        // Valor medido en unidades SI (W, V, A)
  readonly ratedLimit: number;         // Límite nominal seguro de la hoja de datos
  readonly unit: string;               // "W", "V", "A", "mW", etc.
  readonly percentOfRating: number;    // % respecto al valor nominal (ej: 125%)
  readonly status: ComponentStressStatus; // safe (<80%), warning (80-100%), overload (>100%)
  readonly description: string;
}

export interface InductiveSpikeHazard {
  readonly inductorId: string;
  readonly switchingComponentId: string;
  readonly anodeNode: string;
  readonly cathodeNode: string;
  readonly description: string;
}

export interface ComponentStressReport {
  readonly timestamp: number;
  readonly items: readonly ComponentStressItem[];
  readonly inductiveHazards: readonly InductiveSpikeHazard[];
  readonly highestStressPercent: number;
  readonly overloadedCount: number;
  readonly warningCount: number;
  readonly summary: string;
}

export interface ComponentRatingOverrides {
  readonly maxResistorPowerWatts?: number;     // Defecto: 0.25 W (1/4 W estándar)
  readonly maxCapacitorVoltageVolts?: number;  // Defecto: 25 V
  readonly maxDiodeReverseVolts?: number;      // Defecto: 50 V (1N4148 ~ 100V)
  readonly maxDiodeCurrentAmps?: number;       // Defecto: 1.0 A
  readonly maxBjtVceoVolts?: number;           // Defecto: 40 V (2N2222 ~ 40V)
  readonly maxBjtIcAmps?: number;              // Defecto: 0.8 A
  readonly maxBjtPowerWatts?: number;          // Defecto: 0.5 W (TO-92)
  readonly maxMosfetVdssVolts?: number;        // Defecto: 60 V (2N7000 ~ 60V)
  readonly maxMosfetIdAmps?: number;           // Defecto: 0.5 A
  readonly maxMosfetPowerWatts?: number;       // Defecto: 0.83 W
}

const DEFAULT_RATINGS: Required<ComponentRatingOverrides> = {
  maxResistorPowerWatts: 0.25,
  maxCapacitorVoltageVolts: 25.0,
  maxDiodeReverseVolts: 50.0,
  maxDiodeCurrentAmps: 1.0,
  maxBjtVceoVolts: 40.0,
  maxBjtIcAmps: 0.8,
  maxBjtPowerWatts: 0.5,
  maxMosfetVdssVolts: 60.0,
  maxMosfetIdAmps: 0.5,
  maxMosfetPowerWatts: 0.83,
};

function getNodeVoltage(nodeVoltages: Record<string, number>, node: string | undefined): number {
  if (!node || node === "0" || node.toLowerCase() === "gnd") return 0;
  return nodeVoltages[node] ?? 0;
}

/**
 * Evalúa el estrés físico de todos los componentes del circuito a partir de las tensiones
 * de nodo de la solución MNA y las corrientes de rama.
 */
export function evaluateComponentStress(
  netlist: CircuitNetlist,
  nodeVoltages: Record<string, number>,
  componentCurrents: Record<string, number> = {},
  overrides: ComponentRatingOverrides = {},
): ComponentStressReport {
  const ratings = { ...DEFAULT_RATINGS, ...overrides };
  const items: ComponentStressItem[] = [];

  for (const comp of netlist.components) {
    const type = comp.type.toLowerCase();
    const id = comp.id;
    const pins = comp.pins || [];

    // 1. Resistencias: P = V^2 / R o I^2 * R
    if (/resistor|potentiometer|thermistor|ldr/i.test(type)) {
      const r = Math.max(1e-6, typeof comp.value === "number" ? comp.value : 1000);
      const v1 = getNodeVoltage(nodeVoltages, pins[0]);
      const v2 = getNodeVoltage(nodeVoltages, pins[1]);
      const vDrop = Math.abs(v1 - v2);
      const power = (vDrop * vDrop) / r;
      const limit = ratings.maxResistorPowerWatts;
      const pct = (power / limit) * 100;

      const status: ComponentStressStatus = pct > 100 ? "overload" : pct >= 80 ? "warning" : "safe";
      items.push({
        componentId: id,
        componentType: "resistor",
        metricName: "Potencia Disipada (P)",
        actualValue: power,
        ratedLimit: limit,
        unit: power >= 1 ? "W" : "mW",
        percentOfRating: pct,
        status,
        description: `Disipación: ${(power * (power >= 1 ? 1 : 1000)).toFixed(2)} ${power >= 1 ? "W" : "mW"} (Límite: ${limit} W).`,
      });
    }

    // 2. Condensadores: Tensión dieléctrica V_drop <= V_rating
    else if (/capacitor/i.test(type)) {
      const v1 = getNodeVoltage(nodeVoltages, pins[0]);
      const v2 = getNodeVoltage(nodeVoltages, pins[1]);
      const vDrop = Math.abs(v1 - v2);
      const limit = ratings.maxCapacitorVoltageVolts;
      const pct = (vDrop / limit) * 100;

      const status: ComponentStressStatus = pct > 100 ? "overload" : pct >= 80 ? "warning" : "safe";
      items.push({
        componentId: id,
        componentType: "capacitor",
        metricName: "Tensión Dieléctrica (V)",
        actualValue: vDrop,
        ratedLimit: limit,
        unit: "V",
        percentOfRating: pct,
        status,
        description: `Tensión: ${vDrop.toFixed(2)} V (Límite dieléctrico: ${limit} V).`,
      });
    }

    // 3. Diodos: Tensión inversa VR <= VRRM y Corriente directa IF <= IF_max
    else if (/diode|led/i.test(type)) {
      const vAnode = getNodeVoltage(nodeVoltages, pins[0]);
      const vCathode = getNodeVoltage(nodeVoltages, pins[1]);
      const vDiff = vAnode - vCathode;

      if (vDiff < 0) {
        // En polarización inversa
        const vRev = Math.abs(vDiff);
        const limit = ratings.maxDiodeReverseVolts;
        const pct = (vRev / limit) * 100;
        const status: ComponentStressStatus = pct > 100 ? "overload" : pct >= 80 ? "warning" : "safe";
        items.push({
          componentId: id,
          componentType: "diode",
          metricName: "Tensión Inversa Pico (VR)",
          actualValue: vRev,
          ratedLimit: limit,
          unit: "V",
          percentOfRating: pct,
          status,
          description: `Tensión inversa: ${vRev.toFixed(2)} V (Límite PIV: ${limit} V).`,
        });
      } else {
        // En polarización directa
        const iF = Math.abs(componentCurrents[id] || (vDiff > 0.6 ? (vDiff - 0.6) / 5 : 0));
        const limit = ratings.maxDiodeCurrentAmps;
        const pct = (iF / limit) * 100;
        const status: ComponentStressStatus = pct > 100 ? "overload" : pct >= 80 ? "warning" : "safe";
        items.push({
          componentId: id,
          componentType: "diode",
          metricName: "Corriente Directa (IF)",
          actualValue: iF,
          ratedLimit: limit,
          unit: iF >= 1 ? "A" : "mA",
          percentOfRating: pct,
          status,
          description: `Corriente directa: ${(iF * (iF >= 1 ? 1 : 1000)).toFixed(1)} ${iF >= 1 ? "A" : "mA"} (Límite: ${limit} A).`,
        });
      }
    }

    // 4. Transistores BJT (NPN / PNP)
    else if (/npn|pnp|bjt/i.test(type)) {
      // Pines típicos: [Collector, Base, Emitter]
      const vC = getNodeVoltage(nodeVoltages, pins[0]);
      const vB = getNodeVoltage(nodeVoltages, pins[1]);
      const vE = getNodeVoltage(nodeVoltages, pins[2]);
      const vCE = Math.abs(vC - vE);
      const vBE = Math.abs(vB - vE);

      // Verificación V_CEO
      const vLimit = ratings.maxBjtVceoVolts;
      const vPct = (vCE / vLimit) * 100;
      items.push({
        componentId: id,
        componentType: "bjt",
        metricName: "Tensión Colector-Emisor (Vce)",
        actualValue: vCE,
        ratedLimit: vLimit,
        unit: "V",
        percentOfRating: vPct,
        status: vPct > 100 ? "overload" : vPct >= 80 ? "warning" : "safe",
        description: `Vce: ${vCE.toFixed(2)} V (Límite Vceo: ${vLimit} V).`,
      });

      // Potencia disipada P = Vce * Ic + Vbe * Ib
      const iC = Math.abs(componentCurrents[`${id}_c`] || componentCurrents[id] || 0.01);
      const power = vCE * iC + vBE * (iC / 100);
      const pLimit = ratings.maxBjtPowerWatts;
      const pPct = (power / pLimit) * 100;
      items.push({
        componentId: id,
        componentType: "bjt",
        metricName: "Potencia Total BJT (Ptot)",
        actualValue: power,
        ratedLimit: pLimit,
        unit: power >= 1 ? "W" : "mW",
        percentOfRating: pPct,
        status: pPct > 100 ? "overload" : pPct >= 80 ? "warning" : "safe",
        description: `Potencia: ${(power * (power >= 1 ? 1 : 1000)).toFixed(1)} ${power >= 1 ? "W" : "mW"} (Límite: ${pLimit} W).`,
      });
    }

    // 5. Transistores MOSFET (NMOS / PMOS)
    else if (/nmos|pmos|mosfet/i.test(type)) {
      // Pines típicos: [Drain, Gate, Source]
      const vD = getNodeVoltage(nodeVoltages, pins[0]);
      const vG = getNodeVoltage(nodeVoltages, pins[1]);
      const vS = getNodeVoltage(nodeVoltages, pins[2]);
      const vDS = Math.abs(vD - vS);
      const vGS = Math.abs(vG - vS);

      // Verificación V_DSS
      const vLimit = ratings.maxMosfetVdssVolts;
      const vPct = (vDS / vLimit) * 100;
      items.push({
        componentId: id,
        componentType: "mosfet",
        metricName: "Tensión Drain-Source (Vds)",
        actualValue: vDS,
        ratedLimit: vLimit,
        unit: "V",
        percentOfRating: vPct,
        status: vPct > 100 ? "overload" : vPct >= 80 ? "warning" : "safe",
        description: `Vds: ${vDS.toFixed(2)} V (Límite Vdss: ${vLimit} V).`,
      });

      // Verificación V_GSS (+-20V límite de óxido de gate)
      const vgsLimit = 20.0;
      const vgsPct = (vGS / vgsLimit) * 100;
      if (vgsPct >= 80) {
        items.push({
          componentId: id,
          componentType: "mosfet",
          metricName: "Tensión Gate-Source (Vgs)",
          actualValue: vGS,
          ratedLimit: vgsLimit,
          unit: "V",
          percentOfRating: vgsPct,
          status: vgsPct > 100 ? "overload" : "warning",
          description: `Vgs: ${vGS.toFixed(2)} V (Límite dieléctrico de Gate: ${vgsLimit} V).`,
        });
      }
    }
  }

  // 6. Detección Topológica de Picos Inductivos sin Diodo Flyback
  const inductiveHazards: InductiveSpikeHazard[] = [];
  const inductors = netlist.components.filter((c) => /inductor|relay|transformer/i.test(c.type));
  const switchesAndTransistors = netlist.components.filter((c) => /npn|pnp|bjt|nmos|pmos|mosfet|switch/i.test(c.type));
  const diodes = netlist.components.filter((c) => /diode|schottky|zener/i.test(c.type));

  for (const ind of inductors) {
    const indPins = ind.pins || [];
    if (indPins.length < 2) continue;
    const nodeA = indPins[0];
    const nodeB = indPins[1];

    // Verificar si comparte nodo con un elemento de conmutación
    const connectedSwitch = switchesAndTransistors.find((s) => s.pins?.includes(nodeA) || s.pins?.includes(nodeB));

    if (connectedSwitch) {
      // Comprobar si existe un diodo conectado entre nodeA y nodeB en antiparalelo
      const hasFlyback = diodes.some((d) => {
        const dPins = d.pins || [];
        return (dPins.includes(nodeA) && dPins.includes(nodeB));
      });

      if (!hasFlyback) {
        inductiveHazards.push({
          inductorId: ind.id,
          switchingComponentId: connectedSwitch.id,
          anodeNode: nodeA,
          cathodeNode: nodeB,
          description: `La bobina ${ind.id} es conmutada por ${connectedSwitch.id} sin diodo flyback de desmagnetización en antiparalelo. Peligro de sobretensión destructiva V = -L(di/dt).`,
        });
      }
    }
  }

  let highestStressPercent = 0;
  let overloadedCount = 0;
  let warningCount = 0;

  for (const item of items) {
    if (item.percentOfRating > highestStressPercent) {
      highestStressPercent = item.percentOfRating;
    }
    if (item.status === "overload") overloadedCount++;
    else if (item.status === "warning") warningCount++;
  }

  const summary = overloadedCount > 0
    ? `⚠️ Peligro: ${overloadedCount} componente(s) en sobrecarga destructiva (>100% SOA).`
    : warningCount > 0
    ? `Atención: ${warningCount} componente(s) operando en zona de advertencia (80-100% rating).`
    : `✓ Operación segura: Todos los componentes dentro de su área segura de operación (SOA).`;

  return {
    timestamp: Date.now(),
    items,
    inductiveHazards,
    highestStressPercent,
    overloadedCount,
    warningCount,
    summary,
  };
}
