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
  readonly description?: string;
  readonly category?: string;
  readonly parameters?: Readonly<Record<string, number>>;
}

export interface ParsedSpiceLibrary {
  readonly subcircuits: readonly ParsedSubcircuit[];
  readonly models: readonly ParsedSpiceModel[];
  readonly rawContent: string;
}

/**
 * Parsea los parámetros numéricos de una directiva .MODEL SPICE.
 */
export function parseModelParameters(line: string): Record<string, number> {
  const params: Record<string, number> = {};
  const openParen = line.indexOf("(");
  const closeParen = line.lastIndexOf(")");
  let paramsStr = "";
  if (openParen >= 0 && closeParen > openParen) {
    paramsStr = line.substring(openParen + 1, closeParen);
  } else {
    const tokens = line.split(/\s+/);
    paramsStr = tokens.slice(3).join(" ");
  }

  const matches = paramsStr.matchAll(/([A-Za-z0-9_]+)\s*=\s*([^\s=(),]+)/g);
  for (const m of matches) {
    const key = m[1].toUpperCase();
    const val = parseSpiceNumericValue(m[2]);
    if (!Number.isNaN(val)) {
      params[key] = val;
    }
  }
  return params;
}

/**
 * Obtiene la categoría y descripción amigable según el tipo de dispositivo .MODEL.
 */
export function getModelCategoryAndLabel(type: string): { category: string; label: string } {
  const t = type.toLowerCase();
  switch (t) {
    case "d":
      return { category: "Diodos", label: "Diodo semiconductor" };
    case "npn":
      return { category: "Transistores", label: "Transistor BJT NPN" };
    case "pnp":
      return { category: "Transistores", label: "Transistor BJT PNP" };
    case "nmos":
      return { category: "Transistores", label: "MOSFET Canal N" };
    case "pmos":
      return { category: "Transistores", label: "MOSFET Canal P" };
    case "njf":
      return { category: "Transistores", label: "JFET Canal N" };
    case "pjf":
      return { category: "Transistores", label: "JFET Canal P" };
    case "sw":
    case "vswitch":
      return { category: "Interruptores", label: "Interruptor analógico" };
    default:
      return { category: "Semiconductores", label: `Modelo ${type.toUpperCase()}` };
  }
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
 * Parsea un valor numérico SPICE con prefijos de ingeniería estándar (MEG, MIL, k, m, u, n, p, f, g, t).
 */
export function parseSpiceNumericValue(valStr: string): number {
  const trimmed = valStr.trim();
  if (!trimmed) return NaN;

  const upper = trimmed.toUpperCase();
  if (upper.includes("MEG")) {
    const num = parseFloat(upper.replace("MEG", ""));
    return Number.isFinite(num) ? num * 1e6 : NaN;
  }
  if (upper.includes("MIL")) {
    const num = parseFloat(upper.replace("MIL", ""));
    return Number.isFinite(num) ? num * 25.4e-6 : NaN;
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
 * Evalúa expresiones aritméticas SPICE con parámetros (ej. "{2*R1 + 10k}", "{VCC/2}", "{sqrt(100) + pow(2, 3)}", "{1/(2*PI*1k)}").
 * Utiliza un parser descendente recursivo puro sin dependencias externas ni `Function`/`eval`.
 */
export function evaluateSpiceExpression(expr: string, params: Record<string, number> = {}): number {
  const clean = expr.trim().replace(/^\{+|\}+$/g, "").trim();
  if (!clean) return NaN;

  const allParams: Record<string, number> = {
    PI: Math.PI,
    E: Math.E,
    VT: 0.02585,
  };
  for (const [k, v] of Object.entries(params)) {
    allParams[k.toUpperCase()] = v;
  }

  let pos = 0;

  function peek(): string {
    while (pos < clean.length && /\s/.test(clean[pos])) pos++;
    return pos < clean.length ? clean[pos] : "";
  }

  function parsePrimary(): number {
    const ch = peek();
    if (ch === "(") {
      pos++; // consumir '('
      const val = parseAdditive();
      if (peek() === ")") pos++;
      return val;
    }

    if (ch === "+" || ch === "-") {
      pos++;
      const val = parsePrimary();
      return ch === "-" ? -val : val;
    }

    // Número con posible sufijo de ingeniería SPICE (10k, 1.5meg, 100u, 1e-3, 25mil, etc.)
    if (/[0-9.]/.test(ch)) {
      const start = pos;
      while (pos < clean.length && /[0-9a-zA-Z._%]/.test(clean[pos])) {
        // Manejar notación científica ej. 1e-6
        if ((clean[pos] === "+" || clean[pos] === "-") && pos > start) {
          const prev = clean[pos - 1];
          if (prev === "e" || prev === "E") {
            pos++;
            continue;
          }
          break;
        }
        pos++;
      }
      const raw = clean.slice(start, pos);
      return parseSpiceNumericValue(raw);
    }

    // Identificador: función matemática o parámetro
    if (/[a-zA-Z_]/.test(ch)) {
      const start = pos;
      while (pos < clean.length && /[a-zA-Z0-9_]/.test(clean[pos])) {
        pos++;
      }
      const name = clean.slice(start, pos);
      const upper = name.toUpperCase();

      // Llamada a función matemática: func(...)
      if (peek() === "(") {
        pos++; // consumir '('
        const args: number[] = [];
        if (peek() !== ")") {
          while (true) {
            args.push(parseAdditive());
            if (peek() === ",") {
              pos++;
            } else if (peek() === ")") {
              pos++;
              break;
            } else {
              break;
            }
          }
        } else {
          pos++; // consumir ')'
        }

        switch (upper) {
          case "SQRT": return Math.sqrt(args[0] ?? 0);
          case "EXP": return Math.exp(args[0] ?? 0);
          case "LN": return Math.log(args[0] ?? 0);
          case "LOG":
          case "LOG10": return Math.log10(args[0] ?? 0);
          case "POW": return Math.pow(args[0] ?? 0, args[1] ?? 1);
          case "ABS": return Math.abs(args[0] ?? 0);
          case "MIN": return Math.min(args[0] ?? 0, args[1] ?? 0);
          case "MAX": return Math.max(args[0] ?? 0, args[1] ?? 0);
          case "SIN": return Math.sin(args[0] ?? 0);
          case "COS": return Math.cos(args[0] ?? 0);
          case "TAN": return Math.tan(args[0] ?? 0);
          case "SINH": return Math.sinh(args[0] ?? 0);
          case "COSH": return Math.cosh(args[0] ?? 0);
          case "TANH": return Math.tanh(args[0] ?? 0);
          case "FLOOR": return Math.floor(args[0] ?? 0);
          case "CEIL": return Math.ceil(args[0] ?? 0);
          case "ROUND": return Math.round(args[0] ?? 0);
          default: return NaN;
        }
      }

      // Parámetro definido en el entorno
      if (upper in allParams) {
        return allParams[upper];
      }
      const parsed = parseSpiceNumericValue(name);
      return Number.isFinite(parsed) ? parsed : NaN;
    }

    return NaN;
  }

  function parsePower(): number {
    let base = parsePrimary();
    if (peek() === "^") {
      pos++;
      const exp = parsePower(); // asociatividad por la derecha
      base = Math.pow(base, exp);
    }
    return base;
  }

  function parseMultiplicative(): number {
    let left = parsePower();
    while (true) {
      const ch = peek();
      if (ch === "*") {
        pos++;
        left *= parsePower();
      } else if (ch === "/") {
        pos++;
        const right = parsePower();
        left = Math.abs(right) < 1e-30 ? 0 : left / right;
      } else {
        break;
      }
    }
    return left;
  }

  function parseAdditive(): number {
    let left = parseMultiplicative();
    while (true) {
      const ch = peek();
      if (ch === "+") {
        pos++;
        left += parseMultiplicative();
      } else if (ch === "-") {
        pos++;
        left -= parseMultiplicative();
      } else {
        break;
      }
    }
    return left;
  }

  try {
    const result = parseAdditive();
    return Number.isFinite(result) ? result : NaN;
  } catch {
    return NaN;
  }
}

function cleanFloatString(val: number): string {
  if (!Number.isFinite(val)) return "NaN";
  return Number(val.toPrecision(12)).toString();
}

/**
 * Sustituye y evalúa directivas .PARAM y expresiones entre llaves {expr} en el netlist SPICE.
 */
export function evaluateSpiceParamExpressions(
  spiceText: string,
  externalParams: Record<string, number> = {},
): { netlist: string; params: Record<string, number> } {
  const lines = normalizeSpiceLines(spiceText);
  const params: Record<string, number> = { ...externalParams };

  // 1. Extraer todas las definiciones .PARAM
  for (const line of lines) {
    const trimmed = line.trim();
    if (trimmed.toUpperCase().startsWith(".PARAM")) {
      const parts = trimmed.substring(6).trim();
      const matches = parts.matchAll(/([a-zA-Z0-9_]+)\s*=\s*([^{}\s=,]+|\{[^{}]+\})/g);
      for (const m of matches) {
        const paramName = m[1].toUpperCase();
        const rawVal = m[2].trim();
        const evalVal = rawVal.startsWith("{")
          ? evaluateSpiceExpression(rawVal, params)
          : parseSpiceNumericValue(rawVal);
        if (!Number.isNaN(evalVal)) {
          params[paramName] = Number(evalVal.toPrecision(12));
        }
      }
    }
  }

  // 2. Sustituir expresiones {expr}
  const processedLines = lines.map((line) => {
    if (line.trim().startsWith("*") || line.trim().toUpperCase().startsWith(".PARAM")) {
      return line;
    }
    return line.replace(/\{([^{}]+)\}/g, (_, innerExpr) => {
      const val = evaluateSpiceExpression(innerExpr, params);
      return Number.isFinite(val) ? cleanFloatString(val) : `{${innerExpr}}`;
    });
  });

  return {
    netlist: processedLines.join("\n"),
    params,
  };
}

/**
 * Extrae nombres semánticos de pines analizando los bloques de comentarios de cabecera que preceden al .SUBCKT.
 */
export function extractPinNamesFromHeaderComments(
  commentText: string,
  pinCount: number,
): string[] | null {
  if (!commentText || pinCount <= 0) return null;

  const rawComments = commentText.split("|").map((c) => c.trim());
  const extractedPins: string[] = [];

  // Patrón 1: Formato "PIN 1: NON_INV", "PIN 2: INV", etc.
  const pinNumRegex = /(?:PIN|NODE|TERMINAL)\s*#?([0-9]+)\s*[:=–-]\s*([A-Za-z0-9_+/–-]+)/gi;
  const mapByNumber: Record<number, string> = {};

  for (const comment of rawComments) {
    const matches = comment.matchAll(pinNumRegex);
    for (const m of matches) {
      const pinIdx = parseInt(m[1], 10);
      const pinName = m[2].trim().toUpperCase();
      if (pinIdx >= 1 && pinIdx <= pinCount) {
        mapByNumber[pinIdx - 1] = pinName;
      }
    }
  }

  if (Object.keys(mapByNumber).length === pinCount) {
    for (let i = 0; i < pinCount; i++) {
      extractedPins.push(mapByNumber[i]);
    }
    return extractedPins;
  }

  // Patrón 2: Formato "CONNECTIONS: IN+ IN- V+ V- OUT" o "PINS: IN+, IN-, VCC, GND, OUT"
  const connRegex = /(?:CONNECTIONS|PINS|NODES|TERMINALS|TERMINALES)\s*[:=]\s*(.+)/i;
  for (const comment of rawComments) {
    const match = comment.match(connRegex);
    if (match) {
      const pinTokens = match[1]
        .split(/[\s,;|]+/)
        .map((t) => t.trim().toUpperCase())
        .filter((t) => t.length > 0 && !t.includes("=") && !t.includes(":"));
      if (pinTokens.length === pinCount) {
        return pinTokens;
      }
    }
  }

  return null;
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
    upper.startsWith("LM358") ||
    upper.startsWith("LM324") ||
    upper.startsWith("LM386") ||
    upper.startsWith("AD620") ||
    upper.startsWith("INA128") ||
    upper.startsWith("OPA") ||
    upper.startsWith("AD8") ||
    (pinsUpper.includes("IN+") && pinsUpper.includes("IN-") && pinsUpper.includes("OUT")) ||
    (pinsUpper.includes("NON_INV") && pinsUpper.includes("INV"))
  ) {
    return { category: "Amplificadores", suggestedType: "opamp" };
  }

  if (upper.startsWith("LM393") || upper.startsWith("LM339") || upper.startsWith("LM311") || upper.includes("COMP")) {
    return { category: "Comparadores", suggestedType: "comparator" };
  }

  if (upper.includes("555") || upper.startsWith("NE555") || upper.startsWith("LM555")) {
    return { category: "Temporizadores", suggestedType: "timer" };
  }

  if (
    upper.startsWith("78") ||
    upper.startsWith("79") ||
    upper.startsWith("LM78") ||
    upper.startsWith("LM79") ||
    upper.startsWith("LM317") ||
    upper.startsWith("LM337") ||
    upper.startsWith("TL431") ||
    upper.startsWith("LM2596")
  ) {
    return { category: "Reguladores", suggestedType: "regulator" };
  }

  if (
    upper.startsWith("PC817") ||
    upper.startsWith("4N25") ||
    upper.startsWith("4N35") ||
    upper.startsWith("MOC") ||
    upper.includes("OPTO")
  ) {
    return { category: "Optoelectrónica", suggestedType: "optocoupler" };
  }

  if (
    upper.startsWith("L298") ||
    upper.startsWith("L293") ||
    upper.startsWith("ULN2003") ||
    upper.startsWith("ULN2803") ||
    upper.includes("BRIDGE") ||
    upper.includes("DRIVER")
  ) {
    return { category: "Controladores de Potencia", suggestedType: "motor_driver" };
  }

  if (
    upper.startsWith("74HC") ||
    upper.startsWith("74LS") ||
    upper.startsWith("74HCT") ||
    upper.startsWith("CD40") ||
    upper.startsWith("HEF40")
  ) {
    return { category: "Lógica Digital", suggestedType: "logic_ic" };
  }

  if (
    upper.startsWith("TRAFO") ||
    upper.includes("TRANSFORMER") ||
    upper.startsWith("XFMR") ||
    (pinsUpper.includes("PRI1") && (pinsUpper.includes("SEC1") || pinsUpper.includes("SEC_A")))
  ) {
    return { category: "Transformadores", suggestedType: "transformer" };
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

        let effectivePins = currentSubcircuit.pins;
        const extractedHeaderPins = extractPinNamesFromHeaderComments(
          currentSubcircuit.description,
          currentSubcircuit.pins.length,
        );

        // Si los pines del .SUBCKT son puramente numéricos (1, 2, 3...) y se extrajeron nombres semánticos, usarlos
        const areAllNumeric = currentSubcircuit.pins.every((p) => /^[0-9]+$/.test(p));
        if (areAllNumeric && extractedHeaderPins && extractedHeaderPins.length === currentSubcircuit.pins.length) {
          effectivePins = extractedHeaderPins;
        }

        const pinLabels: Record<number, string> = {};
        effectivePins.forEach((pin, idx) => {
          pinLabels[idx] = pin;
        });

        const { category, suggestedType } = inferSubcircuitType(
          currentSubcircuit.name,
          effectivePins,
        );

        subcircuits.push({
          name: currentSubcircuit.name,
          pinNames: effectivePins,
          pinCount: effectivePins.length,
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
      const params = parseModelParameters(line);
      const { category, label } = getModelCategoryAndLabel(modelType);
      const description = lastComment ? `${lastComment} (${label})` : `Modelo SPICE ${modelName} (${label})`;

      models.push({
        name: modelName,
        type: modelType,
        rawDefinition: line,
        description,
        category,
        parameters: params,
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
