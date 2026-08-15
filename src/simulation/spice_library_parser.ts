/**
 * Parser de Bibliotecas y Macromodelos SPICE (.lib, .mod, .cir, .subckt).
 * Extrae definiciones jerárquicas .SUBCKT y .MODEL para generar componentes dinámicos en la paleta.
 */

export interface ParsedSubcircuit {
  readonly name: string;
  readonly pinNames: readonly string[];
  readonly pinCount: number;
  readonly pinLabels: Readonly<Record<number, string>>;
  readonly description: string;
  readonly category: string;
  readonly suggestedType: string;
  readonly defaultParams: Readonly<Record<string, number>>;
  readonly rawNetlist: string;
}

export interface ParsedSpiceModel {
  readonly name: string;
  readonly type: string;
  readonly rawDefinition: string;
}

export interface ParsedSpiceLibrary {
  readonly subcircuits: readonly ParsedSubcircuit[];
  readonly models: readonly ParsedSpiceModel[];
  readonly rawContent: string;
}

/**
 * Une líneas con continuación SPICE (+) y normaliza saltos de línea.
 */
export function normalizeSpiceLines(text: string): string[] {
  const rawLines = text.split(/\r?\n/);
  const normalized: string[] = [];

  for (const line of rawLines) {
    const trimmed = line.trim();
    if (!trimmed) continue;

    if (trimmed.startsWith("+")) {
      if (normalized.length > 0) {
        normalized[normalized.length - 1] += " " + trimmed.substring(1).trim();
      } else {
        normalized.push(trimmed.substring(1).trim());
      }
    } else {
      normalized.push(trimmed);
    }
  }

  return normalized;
}

/**
 * Parsea un valor numérico SPICE con prefijos de ingeniería estándar (MEG, k, m, u, n, p, f).
 */
export function parseSpiceNumericValue(valStr: string): number {
  const trimmed = valStr.trim();
  if (!trimmed) return NaN;

  const upper = trimmed.toUpperCase();
  if (upper.includes("MEG")) {
    const num = parseFloat(upper.replace("MEG", ""));
    return Number.isFinite(num) ? num * 1e6 : NaN;
  }

  const match = upper.match(/^([+-]?[0-9]*\.?[0-9]+(?:[eE][+-]?[0-9]+)?)([A-Z]+)?$/);
  if (!match) {
    return parseFloat(trimmed);
  }

  const base = parseFloat(match[1]);
  if (!Number.isFinite(base)) return NaN;

  const suffix = match[2] ? match[2][0] : "";
  switch (suffix) {
    case "T": return base * 1e12;
    case "G": return base * 1e9;
    case "K": return base * 1e3;
    case "M": return base * 1e-3;
    case "U": return base * 1e-6;
    case "N": return base * 1e-9;
    case "P": return base * 1e-12;
    case "F": return base * 1e-15;
    default: return base;
  }
}

/**
 * Infiere el tipo de componente a partir de su nombre o terminales.
 */
function inferSubcircuitType(name: string, pins: readonly string[]): { category: string; suggestedType: string } {
  const upper = name.toUpperCase();
  const pinsUpper = pins.map((p) => p.toUpperCase());

  if (
    upper.includes("OPAMP") ||
    upper.startsWith("LM741") ||
    upper.startsWith("TL07") ||
    upper.startsWith("TL08") ||
    upper.startsWith("OPA") ||
    upper.startsWith("AD8") ||
    (pinsUpper.includes("IN+") && pinsUpper.includes("IN-") && pinsUpper.includes("OUT")) ||
    (pinsUpper.includes("NON_INV") && pinsUpper.includes("INV"))
  ) {
    return { category: "Amplificadores", suggestedType: "opamp" };
  }

  if (upper.includes("555") || upper.startsWith("NE555") || upper.startsWith("LM555")) {
    return { category: "Temporizadores", suggestedType: "timer" };
  }

  if (upper.startsWith("78") || upper.startsWith("79") || upper.startsWith("LM317") || upper.startsWith("TL431")) {
    return { category: "Reguladores", suggestedType: "regulator" };
  }

  if (upper.startsWith("L298") || upper.startsWith("L293") || upper.includes("BRIDGE")) {
    return { category: "Controladores de Potencia", suggestedType: "motor_driver" };
  }

  if (pins.length === 2 && (pinsUpper.includes("A") || pinsUpper.includes("ANODE"))) {
    return { category: "Diodos", suggestedType: "diode" };
  }

  if (pins.length === 3 && (pinsUpper.includes("B") || pinsUpper.includes("BASE"))) {
    return { category: "Transistores", suggestedType: "bjt" };
  }

  if (pins.length === 3 && (pinsUpper.includes("G") || pinsUpper.includes("GATE"))) {
    return { category: "Transistores", suggestedType: "mosfet" };
  }

  return { category: "Macromodelos", suggestedType: "subcircuit" };
}

/**
 * Parsea el texto de una biblioteca o archivo SPICE completo.
 */
export function parseSpiceLibrary(spiceText: string): ParsedSpiceLibrary {
  const lines = normalizeSpiceLines(spiceText);
  const subcircuits: ParsedSubcircuit[] = [];
  const models: ParsedSpiceModel[] = [];

  let currentSubcircuit: {
    name: string;
    pins: string[];
    description: string;
    lines: string[];
    defaultParams: Record<string, number>;
  } | null = null;

  let lastComment = "";

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];

    if (line.startsWith("*")) {
      const commentText = line.replace(/^\*+\s*/, "").trim();
      if (commentText.length > 0) {
        lastComment = lastComment ? `${lastComment} | ${commentText}` : commentText;
      }
      continue;
    }

    const tokens = line.split(/\s+/);
    if (tokens.length === 0) continue;

    const directive = tokens[0].toUpperCase();

    // Detección de .SUBCKT
    if (directive === ".SUBCKT") {
      if (tokens.length >= 2) {
        const subName = tokens[1];
        const pins: string[] = [];
        const defaultParams: Record<string, number> = {};

        let inParams = false;
        for (let j = 2; j < tokens.length; j++) {
          const tok = tokens[j];
          if (tok.toUpperCase().startsWith("PARAMS:") || tok.toUpperCase() === "PARAMS") {
            inParams = true;
            continue;
          }

          if (inParams) {
            const [paramName, paramVal] = tok.split("=");
            if (paramName && paramVal !== undefined) {
              const num = parseSpiceNumericValue(paramVal);
              if (!Number.isNaN(num)) defaultParams[paramName.trim()] = num;
            }
          } else {
            pins.push(tok);
          }
        }

        currentSubcircuit = {
          name: subName,
          pins,
          description: lastComment || `Macromodelo SPICE ${subName}`,
          lines: [line],
          defaultParams,
        };
        lastComment = "";
      }
      continue;
    }

    // Detección de .ENDS
    if (directive === ".ENDS") {
      if (currentSubcircuit) {
        currentSubcircuit.lines.push(line);

        const pinLabels: Record<number, string> = {};
        currentSubcircuit.pins.forEach((pin, idx) => {
          pinLabels[idx] = pin;
        });

        const { category, suggestedType } = inferSubcircuitType(
          currentSubcircuit.name,
          currentSubcircuit.pins,
        );

        subcircuits.push({
          name: currentSubcircuit.name,
          pinNames: currentSubcircuit.pins,
          pinCount: currentSubcircuit.pins.length,
          pinLabels,
          description: currentSubcircuit.description,
          category,
          suggestedType,
          defaultParams: currentSubcircuit.defaultParams,
          rawNetlist: currentSubcircuit.lines.join("\n"),
        });

        currentSubcircuit = null;
      }
      lastComment = "";
      continue;
    }

    // Dentro de un subcircuito activo
    if (currentSubcircuit) {
      currentSubcircuit.lines.push(line);
      continue;
    }

    // Detección de .MODEL
    if (directive === ".MODEL" && tokens.length >= 3) {
      const modelName = tokens[1];
      const rawType = tokens[2].split("(")[0];
      const modelType = rawType.replace(/[()]/g, "").trim().toLowerCase();
      models.push({
        name: modelName,
        type: modelType,
        rawDefinition: line,
      });
      lastComment = "";
    }
  }

  return {
    subcircuits,
    models,
    rawContent: spiceText,
  };
}
