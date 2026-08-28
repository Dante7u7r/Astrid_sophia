// ==========================================================================
// SPICE TO COMPONENT TRANSPILER — Motor de Conversión de Macromodelos a EDA
// ==========================================================================

import type { ComponentInstance } from "../canvas_orchestrator";
import type { ComponentCategory, LocalPinDefinition, LiveComponentBehaviorResult } from "../components/types";
import type { EnhancedCatalogItem } from "../components/component_catalog_model";
import type { ParsedSpiceModel, ParsedSubcircuit } from "./spice_library_parser";

export type SubcircuitLayoutStyle = "to220" | "opamp_5p" | "dip" | "transformer_ct" | "generic_box";

export interface TranspiledComponentSpec {
  readonly modelName: string;
  readonly category: string;
  readonly layoutStyle: SubcircuitLayoutStyle;
  readonly pinCount: number;
  readonly pinNames: readonly string[];
  readonly pins: readonly LocalPinDefinition[];
  readonly halfExtents: { readonly halfW: number; readonly halfH: number };
  readonly description: string;
  readonly academicSummary: string;
  readonly spiceModelLevel: string;
  readonly rawNetlist: string;
  readonly svgIconIeee: string;
  readonly svgIconIec: string;
  readonly catalogItem: EnhancedCatalogItem;
}

export interface CanonicalPinoutEntry {
  readonly pattern: RegExp;
  readonly pinCount: number;
  readonly layoutStyle: SubcircuitLayoutStyle;
  readonly pinNames: readonly string[];
}

export const CANONICAL_PINOUTS: readonly CanonicalPinoutEntry[] = [
  // 1. Amplificadores Operacionales Individuales (5 Pines)
  {
    pattern: /^(LM741|UA741|OP07|NE5534|TL071|TL081|LF351|OPA134|CA3140)/i,
    pinCount: 5,
    layoutStyle: "opamp_5p",
    pinNames: ["IN+", "IN-", "V+", "V-", "OUT"],
  },
  // 2. Amplificadores Operacionales Duales (DIP-8)
  {
    pattern: /^(LM358|TL072|TL082|NE5532|RC4558|OPA2134|AD823|LF353)/i,
    pinCount: 8,
    layoutStyle: "dip",
    pinNames: ["1OUT", "1IN-", "1IN+", "V-", "2IN+", "2IN-", "2OUT", "V+"],
  },
  // 3. Amplificadores Operacionales Cuádruples (DIP-14)
  {
    pattern: /^(LM324|TL074|TL084|LM348|OPA4134|LF347)/i,
    pinCount: 14,
    layoutStyle: "dip",
    pinNames: ["1OUT", "1IN-", "1IN+", "V+", "2IN+", "2IN-", "2OUT", "3OUT", "3IN-", "3IN+", "V-", "4IN+", "4IN-", "4OUT"],
  },
  // 4. Comparadores Duales (DIP-8)
  {
    pattern: /^(LM393|LM2903|LM319)/i,
    pinCount: 8,
    layoutStyle: "dip",
    pinNames: ["1OUT", "1IN-", "1IN+", "GND", "2IN+", "2IN-", "2OUT", "VCC"],
  },
  // 5. Temporizador 555 (DIP-8)
  {
    pattern: /^(NE555|LM555|TLC555|ICM7555)/i,
    pinCount: 8,
    layoutStyle: "dip",
    pinNames: ["GND", "TRIG", "OUT", "RESET", "CTRL", "THRESH", "DISCH", "VCC"],
  },
  // 6. Amplificador de Audio de Baja Potencia (DIP-8)
  {
    pattern: /^LM386/i,
    pinCount: 8,
    layoutStyle: "dip",
    pinNames: ["GAIN1", "IN-", "IN+", "GND", "VOUT", "VS", "BYPASS", "GAIN2"],
  },
  // 7. Amplificador de Instrumentación (DIP-8)
  {
    pattern: /^(AD620|INA128|INA129)/i,
    pinCount: 8,
    layoutStyle: "dip",
    pinNames: ["RG1", "IN-", "IN+", "-VS", "REF", "OUT", "+VS", "RG2"],
  },
  // 8. Reguladores Positivos TO-220
  {
    pattern: /^(LM78|78)[0-9]{2}/i,
    pinCount: 3,
    layoutStyle: "to220",
    pinNames: ["IN", "GND", "OUT"],
  },
  // 9. Reguladores Negativos TO-220
  {
    pattern: /^(LM79|79)[0-9]{2}/i,
    pinCount: 3,
    layoutStyle: "to220",
    pinNames: ["GND", "IN", "OUT"],
  },
  // 10. Regulador Ajustable LM317 TO-220
  {
    pattern: /^LM317/i,
    pinCount: 3,
    layoutStyle: "to220",
    pinNames: ["ADJ", "OUT", "IN"],
  },
  // 11. Referencia Shunt TL431 TO-92/TO-220
  {
    pattern: /^TL431/i,
    pinCount: 3,
    layoutStyle: "to220",
    pinNames: ["CATHODE", "ANODE", "REF"],
  },
  // 12. Optoacoplador DIP-4
  {
    pattern: /^(PC817|EL817|4N25|4N35)/i,
    pinCount: 4,
    layoutStyle: "dip",
    pinNames: ["ANODE", "CATHODE", "EMITTER", "COLLECTOR"],
  },
  // 13. Driver Darlington ULN2003A (DIP-16)
  {
    pattern: /^ULN2003/i,
    pinCount: 16,
    layoutStyle: "dip",
    pinNames: ["1B", "2B", "3B", "4B", "5B", "6B", "7B", "GND", "COM", "7C", "6C", "5C", "4C", "3C", "2C", "1C"],
  },
  // 14. Puente H L293D (DIP-16)
  {
    pattern: /^L293/i,
    pinCount: 16,
    layoutStyle: "dip",
    pinNames: ["1,2EN", "1A", "1Y", "GND1", "GND2", "2Y", "2A", "VCC2", "3,4EN", "3A", "3Y", "GND3", "GND4", "4Y", "4A", "VCC1"],
  },
  // 15. Lógica Digital 74HC00 (Quad NAND DIP-14)
  {
    pattern: /^(74HC00|74LS00|74HCT00)/i,
    pinCount: 14,
    layoutStyle: "dip",
    pinNames: ["1A", "1B", "1Y", "2A", "2B", "2Y", "GND", "3Y", "3A", "3B", "4Y", "4A", "4B", "VCC"],
  },
  // 16. Lógica Digital 74HC04 (Hex Inverter DIP-14)
  {
    pattern: /^(74HC04|74LS04|74HCT04)/i,
    pinCount: 14,
    layoutStyle: "dip",
    pinNames: ["1A", "1Y", "2A", "2Y", "3A", "3Y", "GND", "4Y", "4A", "5Y", "5A", "6Y", "6A", "VCC"],
  },
  // 17. Contador Johnson CD4017 (DIP-16)
  {
    pattern: /^(CD4017|HEF4017|HCF4017)/i,
    pinCount: 16,
    layoutStyle: "dip",
    pinNames: ["Q5", "Q1", "Q0", "Q2", "Q6", "Q7", "Q3", "VSS", "CLK_INH", "CLK", "RESET", "Q9", "CO", "Q8", "Q4", "VDD"],
  },
  // 18. Transformador con Toma Central (5 Pines)
  {
    pattern: /(TRAFO.*CT|TRANSFORMER.*CT|XFMR.*CT)/i,
    pinCount: 5,
    layoutStyle: "transformer_ct",
    pinNames: ["PRI1", "PRI2", "SEC1", "CT", "SEC2"],
  },
];

/**
 * Resuelve y auto-asigna nombres semánticos canónicos a pines numéricos arbitrarios según el modelo.
 */
export function resolveCanonicalPinNames(name: string, pinNames: readonly string[]): string[] {
  const pinCount = pinNames.length;
  const areNumeric = pinNames.every((p) => /^[0-9]+$/.test(p) || /^P[0-9]+$/i.test(p));

  const matched = CANONICAL_PINOUTS.find(
    (entry) => entry.pattern.test(name) && entry.pinCount === pinCount,
  );

  if (matched && (areNumeric || pinNames.some((p) => p.startsWith("PIN") || p.startsWith("P_")))) {
    return [...matched.pinNames];
  }

  return [...pinNames];
}

/**
 * Detecta el estilo de encapsulado y disposición de terminales analizando el nombre y los pines del .SUBCKT.
 */
export function detectSubcircuitLayoutStyle(
  name: string,
  rawPinNames: readonly string[],
): SubcircuitLayoutStyle {
  const pinNames = resolveCanonicalPinNames(name, rawPinNames);
  const upper = name.toUpperCase();
  const pinsUpper = pinNames.map((p) => p.toUpperCase());

  // 1. Reguladores TO-220 de 3 pines (LM78xx, LM79xx, LM317, TL431, etc.)
  if (
    pinNames.length === 3 &&
    (upper.startsWith("LM78") ||
      upper.startsWith("LM79") ||
      upper.startsWith("78") ||
      upper.startsWith("79") ||
      upper.startsWith("LM317") ||
      upper.startsWith("LM337") ||
      upper.startsWith("TL431") ||
      ((pinsUpper.some((p) => p.includes("ADJ") || p.includes("GND") || p.includes("COM") || p.includes("REF") || p.includes("A") || p.includes("ANODE")) &&
        pinsUpper.some((p) => p.includes("IN") || p.includes("VI") || p.includes("K") || p.includes("CATHODE")) &&
        pinsUpper.some((p) => p.includes("OUT") || p.includes("VO") || p.includes("REF")))))
  ) {
    return "to220";
  }

  // 2. Amplificadores Operacionales y Comparadores de 5 pines (In+, In-, V+, V-, Out)
  if (
    pinNames.length === 5 &&
    (pinsUpper.some((p) => p.includes("IN+") || p.includes("NON_INV") || p.includes("INP") || p === "3") &&
      pinsUpper.some((p) => p.includes("IN-") || p.includes("INV") || p.includes("INM") || p === "2") &&
      pinsUpper.some((p) => p.includes("OUT") || p === "6" || p === "1"))
  ) {
    return "opamp_5p";
  }

  // 3. Transformadores con Toma Central (Center Tap) de 5 pines
  if (
    pinNames.length === 5 &&
    (upper.includes("TRAFO") ||
      upper.includes("TRANSFORMER") ||
      upper.includes("XFMR") ||
      pinsUpper.some((p) => p.includes("CT") || p.includes("CENTER") || p.includes("TAP") || p.includes("TOMA")))
  ) {
    return "transformer_ct";
  }

  // 4. Encapsulados DIP estándar de 4, 6, 8, 14, 16, 18, 20, 24 o 28 pines
  if (pinNames.length >= 4 && pinNames.length <= 40) {
    return "dip";
  }

  return "generic_box";
}

/**
 * Genera las coordenadas de los pines locales alineadas estrictamente a la rejilla de 20px (Grid-Aligned).
 */
export function generateTranspiledPins(
  layoutStyle: SubcircuitLayoutStyle,
  pinNames: readonly string[],
): {
  pins: LocalPinDefinition[];
  halfExtents: { halfW: number; halfH: number };
} {
  const pinCount = pinNames.length;

  if (layoutStyle === "to220") {
    // Regulador TO-220 de 3 pines: Pin 0 a la izquierda (-40, 0), Pin 1 abajo (0, 40), Pin 2 a la derecha (40, 0)
    return {
      pins: [
        { index: 0, x: -40, y: 0, label: pinNames[0] ?? "IN", name: "Entrada (IN)" },
        { index: 1, x: 0, y: 40, label: pinNames[1] ?? "ADJ", name: "Referencia (ADJ/GND)" },
        { index: 2, x: 40, y: 0, label: pinNames[2] ?? "OUT", name: "Salida (OUT)" },
      ],
      halfExtents: { halfW: 45, halfH: 45 },
    };
  }

  if (layoutStyle === "opamp_5p") {
    // Símbolo Op-Amp de 5 pines: In+ (-40, -20), In- (-40, 20), V+ (0, -40), V- (0, 40), OUT (40, 0)
    return {
      pins: [
        { index: 0, x: -40, y: -20, label: pinNames[0] ?? "+", name: "In+" },
        { index: 1, x: -40, y: 20, label: pinNames[1] ?? "-", name: "In-" },
        { index: 2, x: 0, y: -40, label: pinNames[2] ?? "V+", name: "VCC (+)" },
        { index: 3, x: 0, y: 40, label: pinNames[3] ?? "V-", name: "VEE (-)" },
        { index: 4, x: 40, y: 0, label: pinNames[4] ?? "OUT", name: "Salida" },
      ],
      halfExtents: { halfW: 45, halfH: 45 },
    };
  }

  if (layoutStyle === "transformer_ct") {
    // Transformador con toma central: Primario a la izquierda (2 pines: -20, +20), Secundario a la derecha (3 pines: -20, 0, +20)
    return {
      pins: [
        { index: 0, x: -40, y: -20, label: pinNames[0] ?? "PRI1", name: "Primario 1" },
        { index: 1, x: -40, y: 20, label: pinNames[1] ?? "PRI2", name: "Primario 2" },
        { index: 2, x: 40, y: -20, label: pinNames[2] ?? "SEC1", name: "Secundario +" },
        { index: 3, x: 40, y: 0, label: pinNames[3] ?? "CT", name: "Toma Central (CT)" },
        { index: 4, x: 40, y: 20, label: pinNames[4] ?? "SEC2", name: "Secundario -" },
      ],
      halfExtents: { halfW: 45, halfH: 35 },
    };
  }

  // Encapsulado DIP estándar (Numeración en U contra las manecillas del reloj)
  const pinsPerSide = Math.ceil(pinCount / 2);
  const bodyHeight = Math.max(pinsPerSide * 20 + 20, 60);
  const halfH = Math.ceil(bodyHeight / 40) * 20; // Alineado a 20px
  const halfW = 40; // Espaciado horizontal a -40px y +40px

  const pins: LocalPinDefinition[] = [];

  // Lado Izquierdo: Pines 0 a (pinsPerSide - 1), de arriba hacia abajo
  for (let i = 0; i < pinsPerSide; i++) {
    const y = -halfH + 20 + i * 20;
    pins.push({
      index: i,
      x: -halfW,
      y,
      label: pinNames[i] ?? `P${i + 1}`,
      name: `Pin ${i + 1} (${pinNames[i] ?? ""})`,
    });
  }

  // Lado Derecho: Pines pinsPerSide a (pinCount - 1), de abajo hacia arriba (U-shape)
  for (let i = pinsPerSide; i < pinCount; i++) {
    const slotFromBottom = i - pinsPerSide;
    const y = halfH - 20 - slotFromBottom * 20;
    pins.push({
      index: i,
      x: halfW,
      y,
      label: pinNames[i] ?? `P${i + 1}`,
      name: `Pin ${i + 1} (${pinNames[i] ?? ""})`,
    });
  }

  return {
    pins,
    halfExtents: { halfW: halfW + 5, halfH: halfH + 5 },
  };
}

/**
 * Transpila un subcircuito SPICE parseado en una especificación completa de componente nativo EDA.
 */
export function transpileSpiceSubcircuitToComponent(
  subckt: ParsedSubcircuit,
): TranspiledComponentSpec {
  const effectivePinNames = resolveCanonicalPinNames(subckt.name, subckt.pinNames);
  const layoutStyle = detectSubcircuitLayoutStyle(subckt.name, effectivePinNames);
  const { pins, halfExtents } = generateTranspiledPins(layoutStyle, effectivePinNames);

  const cleanId = `spice-${subckt.name.toLowerCase().replace(/[^a-z0-9_-]/g, "_")}`;
  const shortName = subckt.name.slice(0, 8);

  const effectivePinLabels: Record<number, string> = {};
  effectivePinNames.forEach((name, i) => {
    effectivePinLabels[i] = name;
  });

  // SVG Icons según el tipo de encapsulado
  let svgIconIeee = `<rect x="6" y="6" width="28" height="28" rx="2" stroke="#38BDF8" /><text x="20" y="24" text-anchor="middle" font-size="8" font-family="monospace" fill="#38BDF8">${shortName.slice(0, 5)}</text>`;
  let svgIconIec = svgIconIeee;

  if (layoutStyle === "to220") {
    svgIconIeee = `<rect x="8" y="10" width="24" height="20" rx="1" fill="currentColor" fill-opacity="0.15" stroke="#F59E0B" /><rect x="12" y="6" width="16" height="4" fill="#94A3B8" /><text x="20" y="23" text-anchor="middle" font-size="6.5" font-weight="bold" fill="#F59E0B">REG</text>`;
    svgIconIec = svgIconIeee;
  } else if (layoutStyle === "opamp_5p") {
    svgIconIeee = `<polygon points="6,6 34,20 6,34" fill="#38BDF8" fill-opacity="0.15" stroke="#38BDF8" /><text x="14" y="22" text-anchor="middle" font-size="8" font-weight="bold" fill="#38BDF8">OP</text>`;
    svgIconIec = svgIconIeee;
  } else if (layoutStyle === "transformer_ct") {
    svgIconIeee = `<path d="M 8 12 C 8 8, 14 8, 14 12 C 14 8, 20 8, 20 12 M 20 12 C 20 8, 26 8, 26 12 C 26 8, 32 8, 32 12 M 17 6 L 17 34 M 23 6 L 23 34" stroke="#A78BFA" stroke-width="1.2" fill="none" />`;
    svgIconIec = svgIconIeee;
  } else {
    svgIconIeee = `<rect x="8" y="6" width="24" height="28" rx="2" fill="currentColor" fill-opacity="0.12" stroke="#818CF8" /><circle cx="20" cy="6" r="2.5" fill="#818CF8" /><text x="20" y="23" text-anchor="middle" font-size="7" font-family="monospace" font-weight="bold" fill="#818CF8">${shortName.slice(0, 5)}</text>`;
    svgIconIec = svgIconIeee;
  }

  const catalogItem: EnhancedCatalogItem = {
    id: cleanId,
    type: "x",
    name: subckt.name,
    shortName,
    category: "macromodelos",
    categoryLabel: subckt.category || "Macromodelos",
    description: subckt.description || `Macromodelo SPICE comercial (${subckt.pinCount} pines: ${effectivePinNames.join(", ")})`,
    defaultVal: subckt.name,
    unit: `${subckt.pinCount}P`,
    academicSummary: `Macromodelo SPICE jerárquico importado: ${subckt.name}. Mapeo directo a solver MNA.`,
    spiceModelLevel: `.SUBCKT ${subckt.name} (${subckt.pinCount} pines)`,
    tags: [
      "macromodelo",
      "spice",
      "subckt",
      "chip",
      "ic",
      subckt.name.toLowerCase(),
      ...effectivePinNames.map((p) => p.toLowerCase()),
    ],
    svgIconIeee,
    svgIconIec,
    extraProps: {
      modelName: subckt.name,
      pinCount: subckt.pinCount,
      pinLabels: effectivePinLabels,
      spiceNetlist: subckt.rawNetlist,
      terminalType: layoutStyle,
    },
  };

  return {
    modelName: subckt.name,
    category: subckt.category || "Macromodelos",
    layoutStyle,
    pinCount: subckt.pinCount,
    pinNames: effectivePinNames,
    pins,
    halfExtents,
    description: subckt.description || `Macromodelo SPICE ${subckt.name}`,
    academicSummary: `Modelo SPICE jerárquico ${subckt.name}`,
    spiceModelLevel: `.SUBCKT ${subckt.name}`,
    rawNetlist: subckt.rawNetlist,
    svgIconIeee,
    svgIconIec,
    catalogItem,
  };
}

/**
 * Evalúa en tiempo real las magnitudes físicas de un macromodelo (potencia disipada, temperatura, saturación de salida).
 */
export function evaluateTranspiledBehavior(
  pinVoltages: Record<number, number | undefined> | readonly (number | undefined)[],
  comp: ComponentInstance,
): LiveComponentBehaviorResult & {
  temperatureCelsius?: number;
  speakerPower?: number;
} {
  const modelName = String(comp.modelName || comp.value || "").toUpperCase();
  const pinNames = comp.pinLabels ? Object.values(comp.pinLabels) : [];
  const layoutStyle =
    (comp.terminalType as SubcircuitLayoutStyle) ||
    detectSubcircuitLayoutStyle(modelName, pinNames);

  interface MutableResult {
    glowLevel?: number;
    relayClosed?: boolean;
    buzzerLevel?: number;
    temperatureCelsius?: number;
    speakerPower?: number;
    branchCurrents?: Record<number, number>;
  }

  const result: MutableResult = {};

  if (layoutStyle === "to220") {
    // Regulador TO-220: Pin 0 = IN, Pin 1 = GND/ADJ, Pin 2 = OUT
    const vIn = pinVoltages[0] ?? 0;
    const vGnd = pinVoltages[1] ?? 0;
    const vOut = pinVoltages[2] ?? 0;

    const vDiff = Math.abs(vIn - vOut);
    const iLoad = Math.max(0, Math.abs(vOut - vGnd) / 50.0);
    const pDiss = vDiff * iLoad;

    const glow = Math.min(1.0, pDiss / 3.0);
    comp.glowLevel = glow;
    const tempC = 25.0 + pDiss * 18.0;
    comp.temperatureCelsius = tempC;

    result.glowLevel = glow;
    result.temperatureCelsius = tempC;
  } else if (layoutStyle === "opamp_5p") {
    // Op-Amp 5P: Pin 0 = IN+, Pin 1 = IN-, Pin 2 = V+, Pin 3 = V-, Pin 4 = OUT
    const vPos = pinVoltages[2] ?? 15;
    const vNeg = pinVoltages[3] ?? -15;
    const vOut = pinVoltages[4] ?? 0;

    const isClipping = vOut >= vPos - 0.4 || vOut <= vNeg + 0.4;
    comp.buzzerActive = isClipping;
    result.buzzerLevel = isClipping ? 1.0 : 0.0;
  } else if (layoutStyle === "transformer_ct" || modelName.includes("TRAFO")) {
    const vPri = Math.abs((pinVoltages[0] ?? 0) - (pinVoltages[1] ?? 0));
    const vSec = Math.abs((pinVoltages[2] ?? 0) - (pinVoltages[3] ?? 0));
    const active = vPri > 1.0 || vSec > 0.5;
    comp.speakerPower = active ? 1.0 : 0.0;
    result.speakerPower = comp.speakerPower;
  }

  return result as LiveComponentBehaviorResult & {
    temperatureCelsius?: number;
    speakerPower?: number;
  };
}

/**
 * Transpila una directiva .MODEL SPICE en una especificación de componente nativo EDA.
 */
export function transpileSpiceModelToComponent(
  model: ParsedSpiceModel,
): TranspiledComponentSpec {
  const t = model.type.toLowerCase();
  const cleanId = `model-${model.name.toLowerCase().replace(/[^a-z0-9_-]/g, "_")}`;
  const shortName = model.name.slice(0, 8);

  let compType: ComponentInstance["type"] = "diode";
  const category: ComponentCategory = "semiconductores";
  let categoryLabel = "Semiconductores";
  let pinNames = ["A", "K"];
  let pins: LocalPinDefinition[] = [
    { index: 0, x: -20, y: 0, label: "A", name: "Ánodo (A)" },
    { index: 1, x: 20, y: 0, label: "K", name: "Cátodo (K)" },
  ];
  let halfExtents = { halfW: 25, halfH: 20 };
  let svgIconIeee = `<polygon points="12,8 28,20 12,32" stroke="#38BDF8" fill="#38BDF8" fill-opacity="0.2" /><line x1="28" y1="8" x2="28" y2="32" stroke="#38BDF8" stroke-width="2" />`;

  if (t === "d") {
    compType = "diode";
    categoryLabel = "Diodos";
    pinNames = ["A", "K"];
    pins = [
      { index: 0, x: -20, y: 0, label: "A", name: "Ánodo (A)" },
      { index: 1, x: 20, y: 0, label: "K", name: "Cátodo (K)" },
    ];
    svgIconIeee = `<polygon points="10,10 26,20 10,30" stroke="#38BDF8" fill="#38BDF8" fill-opacity="0.2" stroke-width="1.5" /><line x1="26" y1="10" x2="26" y2="30" stroke="#38BDF8" stroke-width="2" /><line x1="4" y1="20" x2="10" y2="20" stroke="#38BDF8" /><line x1="26" y1="20" x2="36" y2="20" stroke="#38BDF8" />`;
  } else if (t === "npn") {
    compType = "npn";
    categoryLabel = "Transistores BJT";
    pinNames = ["B", "C", "E"];
    pins = [
      { index: 0, x: -20, y: 0, label: "B", name: "Base (B)" },
      { index: 1, x: 20, y: -20, label: "C", name: "Colector (C)" },
      { index: 2, x: 20, y: 20, label: "E", name: "Emisor (E)" },
    ];
    halfExtents = { halfW: 25, halfH: 25 };
    svgIconIeee = `<circle cx="20" cy="20" r="14" stroke="#38BDF8" stroke-width="1.5" fill="none" /><line x1="14" y1="10" x2="14" y2="30" stroke="#38BDF8" stroke-width="2" /><line x1="6" y1="20" x2="14" y2="20" stroke="#38BDF8" />`;
  } else if (t === "pnp") {
    compType = "pnp";
    categoryLabel = "Transistores BJT";
    pinNames = ["B", "C", "E"];
    pins = [
      { index: 0, x: -20, y: 0, label: "B", name: "Base (B)" },
      { index: 1, x: 20, y: 20, label: "C", name: "Colector (C)" },
      { index: 2, x: 20, y: -20, label: "E", name: "Emisor (E)" },
    ];
    halfExtents = { halfW: 25, halfH: 25 };
    svgIconIeee = `<circle cx="20" cy="20" r="14" stroke="#F59E0B" stroke-width="1.5" fill="none" /><line x1="14" y1="10" x2="14" y2="30" stroke="#F59E0B" stroke-width="2" /><line x1="6" y1="20" x2="14" y2="20" stroke="#F59E0B" />`;
  } else if (t === "nmos") {
    compType = "nmos";
    categoryLabel = "MOSFETs";
    pinNames = ["G", "D", "S"];
    pins = [
      { index: 0, x: -20, y: 0, label: "G", name: "Compuerta (G)" },
      { index: 1, x: 20, y: -20, label: "D", name: "Drenador (D)" },
      { index: 2, x: 20, y: 20, label: "S", name: "Fuente (S)" },
    ];
    halfExtents = { halfW: 25, halfH: 25 };
    svgIconIeee = `<circle cx="20" cy="20" r="14" stroke="#10B981" stroke-width="1.5" fill="none" />`;
  } else if (t === "pmos") {
    compType = "pmos";
    categoryLabel = "MOSFETs";
    pinNames = ["G", "D", "S"];
    pins = [
      { index: 0, x: -20, y: 0, label: "G", name: "Compuerta (G)" },
      { index: 1, x: 20, y: 20, label: "D", name: "Drenador (D)" },
      { index: 2, x: 20, y: -20, label: "S", name: "Fuente (S)" },
    ];
    halfExtents = { halfW: 25, halfH: 25 };
    svgIconIeee = `<circle cx="20" cy="20" r="14" stroke="#A855F7" stroke-width="1.5" fill="none" />`;
  } else if (t === "njf" || t === "pjf") {
    compType = t === "njf" ? "njf" : "pjf";
    categoryLabel = "JFETs";
    pinNames = ["G", "D", "S"];
    pins = [
      { index: 0, x: -20, y: 0, label: "G", name: "Compuerta (G)" },
      { index: 1, x: 20, y: -20, label: "D", name: "Drenador (D)" },
      { index: 2, x: 20, y: 20, label: "S", name: "Fuente (S)" },
    ];
    halfExtents = { halfW: 25, halfH: 25 };
    svgIconIeee = `<circle cx="20" cy="20" r="14" stroke="#38BDF8" stroke-width="1.5" fill="none" />`;
  }

  const catalogItem: EnhancedCatalogItem = {
    id: cleanId,
    type: compType,
    name: model.name,
    shortName,
    category,
    categoryLabel,
    description: model.description || `Modelo SPICE .MODEL ${model.name} (${t.toUpperCase()})`,
    defaultVal: model.name,
    unit: t.toUpperCase(),
    academicSummary: `Modelo SPICE físico ${model.name}. Mapeo directo a solver SPICE/MNA.`,
    spiceModelLevel: `.MODEL ${model.name} ${t.toUpperCase()}`,
    tags: ["model", "spice", t, model.name.toLowerCase(), category],
    svgIconIeee,
    svgIconIec: svgIconIeee,
    extraProps: {
      modelName: model.name,
      pinCount: pinNames.length,
      spiceNetlist: model.rawDefinition,
    },
  };

  return {
    modelName: model.name,
    category,
    layoutStyle: "generic_box",
    pinCount: pinNames.length,
    pinNames,
    pins,
    halfExtents,
    description: model.description || `Modelo SPICE ${model.name}`,
    academicSummary: `Modelo SPICE ${model.name}`,
    spiceModelLevel: `.MODEL ${model.name}`,
    rawNetlist: model.rawDefinition,
    svgIconIeee,
    svgIconIec: svgIconIeee,
    catalogItem,
  };
}

/**
 * Renderiza vectorialmente en Canvas 2D un componente macromodelo con estilo industrial según su encapsulado.
 */
export function drawTranspiledSubcircuit(
  ctx: CanvasRenderingContext2D,
  comp: ComponentInstance,
  color: string,
  lineWidth: number = 1.5,
): void {
  const pinCount = comp.pinCount ?? 4;
  const layoutStyle = (comp.terminalType as SubcircuitLayoutStyle) || (comp.subcircuitLayout as SubcircuitLayoutStyle) || "dip";

  if (layoutStyle === "to220") {
    const glow = comp.glowLevel ?? 0;
    const tempC = comp.temperatureCelsius ?? 25.0;

    // Resplandor térmico dinámico en disipador si P > 0.2W
    if (glow > 0.05) {
      const grad = ctx.createRadialGradient(0, -26, 2, 0, -26, 24);
      grad.addColorStop(0, `rgba(239, 68, 68, ${glow * 0.7})`);
      grad.addColorStop(0.5, `rgba(245, 158, 11, ${glow * 0.3})`);
      grad.addColorStop(1, "rgba(239, 68, 68, 0)");
      ctx.save();
      ctx.fillStyle = grad;
      ctx.beginPath();
      ctx.arc(0, -26, 24, 0, Math.PI * 2);
      ctx.fill();
      ctx.restore();
    }

    // 1. Cuerpo plástico TO-220
    const isClassroom = typeof document !== "undefined" && document.documentElement.getAttribute("data-theme") === "classroom";
    ctx.fillStyle = isClassroom ? "rgba(241, 245, 249, 0.95)" : "rgba(15, 23, 42, 0.94)";
    ctx.fillRect(-24, -20, 48, 36);
    ctx.strokeStyle = color;
    ctx.lineWidth = lineWidth;
    ctx.strokeRect(-24, -20, 48, 36);

    // Pestaña metálica superior con orificio de fijación
    ctx.fillStyle = glow > 0.1 ? `rgba(245, 158, 11, ${0.2 + glow * 0.4})` : (isClassroom ? "rgba(203, 213, 225, 0.6)" : "rgba(148, 163, 184, 0.25)");
    ctx.fillRect(-20, -32, 40, 12);
    ctx.strokeStyle = glow > 0.1 ? "#EF4444" : color;
    ctx.strokeRect(-20, -32, 40, 12);
    ctx.beginPath();
    ctx.arc(0, -26, 3, 0, Math.PI * 2);
    ctx.stroke();

    // Nombre del regulador
    const modelName = String(comp.modelName || comp.value || "REG");
    ctx.fillStyle = isClassroom ? "#D97706" : "#F59E0B";
    ctx.font = "bold 9px 'JetBrains Mono', monospace";
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillText(modelName, 0, -6);

    // Lectura de temperatura en disipador si está caliente
    if (tempC > 30) {
      ctx.save();
      ctx.font = "bold 7px 'JetBrains Mono', monospace";
      ctx.fillStyle = tempC > 70 ? "#EF4444" : (isClassroom ? "#D97706" : "#F59E0B");
      ctx.fillText(`${Math.round(tempC)}°C`, 0, 6);
      ctx.restore();
    }

    // Terminales
    ctx.beginPath();
    ctx.strokeStyle = color;
    ctx.moveTo(-40, 0); // IN
    ctx.lineTo(-24, 0);
    ctx.moveTo(40, 0);  // OUT
    ctx.lineTo(24, 0);
    ctx.moveTo(0, 40);  // ADJ/GND
    ctx.lineTo(0, 16);
    ctx.stroke();

    ctx.font = "7px 'JetBrains Mono', monospace";
    ctx.fillStyle = isClassroom ? "#334155" : "#94A3B8";
    ctx.textAlign = "left";
    ctx.fillText(comp.pinLabels?.[0] ?? "IN", -20, 0);
    ctx.textAlign = "right";
    ctx.fillText(comp.pinLabels?.[2] ?? "OUT", 20, 0);
    ctx.textAlign = "center";
    ctx.fillText(comp.pinLabels?.[1] ?? "ADJ", 0, 12);
    return;
  }

  if (layoutStyle === "opamp_5p") {
    const isClipping = comp.buzzerActive ?? false;
    const isClassroom = typeof document !== "undefined" && document.documentElement.getAttribute("data-theme") === "classroom";

    // 1. Cuerpo triangular de Op-Amp
    ctx.beginPath();
    ctx.moveTo(-25, -30);
    ctx.lineTo(-25, 30);
    ctx.lineTo(25, 0);
    ctx.closePath();
    ctx.fillStyle = isClassroom ? "rgba(241, 245, 249, 0.95)" : "rgba(15, 23, 42, 0.94)";
    ctx.fill();
    ctx.strokeStyle = color;
    ctx.lineWidth = lineWidth;
    ctx.stroke();

    // LED de clipping / saturación
    if (isClipping) {
      ctx.save();
      ctx.beginPath();
      ctx.arc(16, -10, 3.5, 0, Math.PI * 2);
      ctx.fillStyle = "#EF4444";
      ctx.fill();
      ctx.strokeStyle = "#FCA5A5";
      ctx.stroke();
      ctx.font = "bold 6px 'JetBrains Mono', monospace";
      ctx.fillStyle = "#EF4444";
      ctx.fillText("CLIP", 16, -16);
      ctx.restore();
    }

    // Terminales
    ctx.beginPath();
    ctx.moveTo(-40, -20);
    ctx.lineTo(-25, -20);
    ctx.moveTo(-40, 20);
    ctx.lineTo(-25, 20);
    ctx.moveTo(25, 0);
    ctx.lineTo(40, 0);
    ctx.moveTo(0, -40);
    ctx.lineTo(0, -16);
    ctx.moveTo(0, 40);
    ctx.lineTo(0, 16);
    ctx.stroke();

    // Signos + y -
    ctx.font = "bold 10px 'JetBrains Mono', monospace";
    ctx.fillStyle = color;
    ctx.textAlign = "center";
    ctx.fillText("+", -18, -18);
    ctx.fillText("-", -18, 22);

    const modelName = String(comp.modelName || comp.value || "OPAMP");
    ctx.font = "bold 8px 'Inter', sans-serif";
    ctx.fillStyle = isClassroom ? "#0284C7" : "#38BDF8";
    ctx.fillText(modelName, -2, 0);
    return;
  }

  if (layoutStyle === "transformer_ct") {
    const isTransmitting = (comp.speakerPower ?? 0) > 0.05;
    const isClassroom = typeof document !== "undefined" && document.documentElement.getAttribute("data-theme") === "classroom";

    // Cuerpo gráfico de transformador con toma central
    const halfW = 28;
    const halfH = 30;
    ctx.fillStyle = isClassroom ? "rgba(241, 245, 249, 0.95)" : "rgba(15, 23, 42, 0.94)";
    ctx.fillRect(-halfW, -halfH, halfW * 2, halfH * 2);
    ctx.strokeStyle = color;
    ctx.lineWidth = lineWidth;
    ctx.strokeRect(-halfW, -halfH, halfW * 2, halfH * 2);

    // Líneas dobles de núcleo magnético en el centro
    ctx.beginPath();
    ctx.moveTo(-3, -22);
    ctx.lineTo(-3, 22);
    ctx.moveTo(3, -22);
    ctx.lineTo(3, 22);
    ctx.strokeStyle = isTransmitting ? (isClassroom ? "#0284C7" : "#38BDF8") : (isClassroom ? "#7C3AED" : "#A78BFA");
    ctx.lineWidth = isTransmitting ? 2.0 : 1.5;
    ctx.stroke();

    // Terminales Primario (izq: -40, -20 y -40, +20)
    ctx.beginPath();
    ctx.strokeStyle = color;
    ctx.lineWidth = lineWidth;
    ctx.moveTo(-40, -20);
    ctx.lineTo(-halfW, -20);
    ctx.moveTo(-40, 20);
    ctx.lineTo(-halfW, 20);

    // Terminales Secundario (der: +40, -20; +40, 0; +40, +20)
    ctx.moveTo(40, -20);
    ctx.lineTo(halfW, -20);
    ctx.moveTo(40, 0);
    ctx.lineTo(halfW, 0);
    ctx.moveTo(40, 20);
    ctx.lineTo(halfW, 20);
    ctx.stroke();

    // Serigrafía / Etiquetas
    const modelName = String(comp.modelName || comp.value || "TRAFO-CT");
    ctx.save();
    ctx.fillStyle = isTransmitting ? (isClassroom ? "#0284C7" : "#38BDF8") : (isClassroom ? "#7C3AED" : "#A78BFA");
    ctx.font = "bold 7px 'JetBrains Mono', monospace";
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillText(modelName.slice(0, 10), 0, -12);
    ctx.restore();

    ctx.font = "6.5px 'JetBrains Mono', monospace";
    ctx.fillStyle = isClassroom ? "#334155" : "#94A3B8";
    ctx.textAlign = "left";
    ctx.fillText(comp.pinLabels?.[0] ?? "P1", -halfW + 3, -20);
    ctx.fillText(comp.pinLabels?.[1] ?? "P2", -halfW + 3, 20);
    ctx.textAlign = "right";
    ctx.fillText(comp.pinLabels?.[2] ?? "S1", halfW - 3, -20);
    ctx.fillText(comp.pinLabels?.[3] ?? "CT", halfW - 3, 0);
    ctx.fillText(comp.pinLabels?.[4] ?? "S2", halfW - 3, 20);
    return;
  }

  // Encapsulado DIP estándar
  const pinsPerSide = Math.ceil(pinCount / 2);
  const bodyHeight = Math.max(pinsPerSide * 20 + 20, 60);
  const halfH = Math.ceil(bodyHeight / 40) * 20;
  const halfW = 28;
  const isClassroom = typeof document !== "undefined" && document.documentElement.getAttribute("data-theme") === "classroom";

  // Cuerpo del CI
  ctx.fillStyle = isClassroom ? "rgba(241, 245, 249, 0.95)" : "rgba(15, 23, 42, 0.96)";
  ctx.fillRect(-halfW, -halfH, halfW * 2, halfH * 2);
  ctx.strokeStyle = isClassroom ? color : "rgba(255, 255, 255, 0.3)";
  ctx.lineWidth = lineWidth;
  ctx.strokeRect(-halfW, -halfH, halfW * 2, halfH * 2);

  // Muesca semicircular superior de orientación DIP
  ctx.beginPath();
  ctx.arc(0, -halfH, 7, 0, Math.PI, false);
  ctx.strokeStyle = color;
  ctx.stroke();

  // Serigrafía central del modelo
  const modelName = String(comp.modelName || comp.value || "DIP-IC");
  ctx.save();
  ctx.fillStyle = isClassroom ? "#0284C7" : "#38BDF8";
  ctx.font = "bold 9px 'JetBrains Mono', monospace";
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.fillText(modelName, 0, 0);
  ctx.restore();

  // Terminales y etiquetas
  for (let i = 0; i < pinCount; i++) {
    const isLeft = i < pinsPerSide;
    const slot = isLeft ? i : (pinCount - 1 - i);
    const y = isLeft ? (-halfH + 20 + slot * 20) : (halfH - 20 - (i - pinsPerSide) * 20);
    const xBody = isLeft ? -halfW : halfW;
    const xTip = isLeft ? -40 : 40;

    ctx.beginPath();
    ctx.moveTo(xBody, y);
    ctx.lineTo(xTip, y);
    ctx.strokeStyle = color;
    ctx.stroke();

    const label = comp.pinLabels?.[i] ?? `P${i + 1}`;
    ctx.font = "7px 'JetBrains Mono', monospace";
    ctx.fillStyle = isClassroom ? "#334155" : "#94A3B8";
    if (isLeft) {
      ctx.textAlign = "left";
      ctx.fillText(label, -halfW + 4, y + 2.5);
    } else {
      ctx.textAlign = "right";
      ctx.fillText(label, halfW - 4, y + 2.5);
    }
  }
}
