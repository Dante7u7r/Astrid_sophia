export interface ParseResult {
  valid: boolean;
  value?: number;
  suffix?: string;
  error?: string;
}

// Prefijos y multiplicadores de ingeniería ordenados por longitud para coincidencia precisa
const PREFIX_MULTIPLIERS: Array<{ prefix: string; multiplier: number; canonical: string }> = [
  { prefix: "tera", multiplier: 1e12, canonical: "T" },
  { prefix: "t", multiplier: 1e12, canonical: "T" },
  { prefix: "giga", multiplier: 1e9, canonical: "G" },
  { prefix: "g", multiplier: 1e9, canonical: "G" },
  { prefix: "mega", multiplier: 1e6, canonical: "Meg" },
  { prefix: "meg", multiplier: 1e6, canonical: "Meg" },
  { prefix: "kilo", multiplier: 1e3, canonical: "k" },
  { prefix: "k", multiplier: 1e3, canonical: "k" },
  { prefix: "milli", multiplier: 1e-3, canonical: "m" },
  { prefix: "mili", multiplier: 1e-3, canonical: "m" },
  { prefix: "micro", multiplier: 1e-6, canonical: "u" },
  { prefix: "u", multiplier: 1e-6, canonical: "u" },
  { prefix: "µ", multiplier: 1e-6, canonical: "u" },
  { prefix: "nano", multiplier: 1e-9, canonical: "n" },
  { prefix: "n", multiplier: 1e-9, canonical: "n" },
  { prefix: "pico", multiplier: 1e-12, canonical: "p" },
  { prefix: "p", multiplier: 1e-12, canonical: "p" },
  { prefix: "femto", multiplier: 1e-15, canonical: "f" },
  { prefix: "f", multiplier: 1e-15, canonical: "f" },
  { prefix: "m", multiplier: 1e-3, canonical: "m" },
  { prefix: "r", multiplier: 1, canonical: "" },
];

// Notación europea embebida (ej. 4k7, 4K7, 1M5, 1Meg5, 2u2, 2µ2, 1n5, 3p3, 0R5, 4R7, 100R)
const EUROPEAN_NOTATION_REGEX = /^([+-]?\d+)\s*([rkmgtunpf]|meg|mega|kilo|micro|nano|pico|mili|milli|µ)\s*(\d+)?\s*(.*)$/i;

// Nombres de unidades físicas y símbolos a reconocer (español, inglés y símbolos estándar)
const KNOWN_UNITS = [
  "ohmios", "ohmio", "ohms", "ohm", "homs", "hom", "ω", "Ω",
  "faradios", "faradio", "farads", "farad",
  "henrios", "henrio", "henrys", "henry", "h",
  "voltios", "voltio", "volts", "volt", "v",
  "amperios", "amperio", "amperes", "ampere", "amps", "amp", "a",
  "hercios", "hercio", "hertz", "herz", "hz",
  "segundos", "segundo", "seconds", "second", "sec", "seg", "s",
  "%",
];

export function parseSpiceValue(input: string): ParseResult {
  const trimmed = input.trim().replace(/,/g, ".");
  if (trimmed === "") {
    return { valid: false, error: "Valor vacío" };
  }

  // 1. Detección de notación europea embebida (ej. 4k7, 1M5, 2u2, 4R7, 100R)
  const eurMatch = trimmed.match(EUROPEAN_NOTATION_REGEX);
  if (eurMatch && (eurMatch[3] !== undefined || eurMatch[2].toLowerCase() === "r")) {
    const intPart = eurMatch[1];
    const rawMult = eurMatch[2];
    const multLower = rawMult.toLowerCase();
    const fracPart = eurMatch[3];
    const tail = eurMatch[4].trim().toLowerCase();

    // Determinar multiplicador considerando 'M' (Mega) vs 'm' (mili)
    let mult = 1;
    let canonical = "";
    if (rawMult === "M" || multLower === "meg" || multLower === "mega") {
      mult = 1e6;
      canonical = "Meg";
    } else {
      const found = PREFIX_MULTIPLIERS.find(p => p.prefix === multLower);
      if (found) {
        mult = found.multiplier;
        canonical = found.canonical;
      }
    }

    if (mult !== undefined) {
      const isTailValid = tail === "" || KNOWN_UNITS.some(u => tail === u || tail.startsWith(u));
      if (isTailValid) {
        const fullNumStr = fracPart ? `${intPart}.${fracPart}` : intPart;
        const num = Number(fullNumStr);
        if (Number.isFinite(num)) {
          return { valid: true, value: num * mult, suffix: canonical };
        }
      }
    }
  }

  // 2. Notación científica estándar (ej. 1e-6, 50e-9, 1.5e3)
  const sciMatch = trimmed.match(/^([+-]?\d*\.?\d+[eE][+-]?\d+)\s*(.*)$/);
  if (sciMatch) {
    const val = Number(sciMatch[1]);
    const tail = sciMatch[2].trim().toLowerCase();
    const isTailValid = tail === "" || tail === "f" || tail === "v" || tail === "a" || tail === "h" || tail === "s" || tail === "hz" || KNOWN_UNITS.some(u => tail === u || tail.startsWith(u));
    if (Number.isFinite(val) && isTailValid) {
      return { valid: true, value: val, suffix: "" };
    }
  }

  // 3. Número decimal estándar seguido de prefijo y/o unidad
  const numMatch = trimmed.match(/^([+-]?\d*\.?\d+)\s*(.*)$/);
  if (!numMatch) {
    return { valid: false, error: `No se reconoce "${trimmed}" como un número` };
  }

  const baseValue = Number(numMatch[1]);
  if (!Number.isFinite(baseValue)) {
    return { valid: false, error: `"${numMatch[1]}" no es un número válido` };
  }

  const rawRest = numMatch[2].trim();
  if (rawRest === "") {
    return { valid: true, value: baseValue, suffix: "" };
  }

  const lowerRest = rawRest.toLowerCase();

  // Si el texto es directamente una unidad conocida sin prefijo multiplicador (ej. "ohms", "homs", "faradios", "V", "Hz", "F")
  if (rawRest === "F") {
    return { valid: true, value: baseValue, suffix: "" };
  }
  for (const unit of KNOWN_UNITS) {
    if (lowerRest === unit) {
      return { valid: true, value: baseValue, suffix: "" };
    }
  }

  // Tratamiento explícito de Mega (M mayúscula, Meg, Mega, MHz, MOhm)
  if (
    rawRest.startsWith("M") ||
    lowerRest.startsWith("meg") ||
    lowerRest.startsWith("mega") ||
    lowerRest.startsWith("mhz") ||
    lowerRest.startsWith("mohm")
  ) {
    let afterM = "";
    if (lowerRest.startsWith("megahertz") || lowerRest.startsWith("megahz")) {
      afterM = "";
    } else if (lowerRest.startsWith("mega")) {
      afterM = lowerRest.slice(4).trim();
    } else if (lowerRest.startsWith("meg")) {
      afterM = lowerRest.slice(3).trim();
    } else if (lowerRest.startsWith("mhz")) {
      afterM = lowerRest.slice(3).trim();
    } else if (lowerRest.startsWith("mohm")) {
      afterM = lowerRest.slice(4).trim();
    } else {
      afterM = rawRest.slice(1).trim().toLowerCase();
    }

    const isAfterValid = afterM === "" || KNOWN_UNITS.some(u => afterM === u || afterM.startsWith(u)) || /^[a-zωΩµ]*$/.test(afterM);
    if (isAfterValid) {
      return { valid: true, value: baseValue * 1e6, suffix: "Meg" };
    }
  }

  // Comprobación de todos los prefijos en orden de especificidad
  for (const { prefix, multiplier, canonical } of PREFIX_MULTIPLIERS) {
    if (lowerRest.startsWith(prefix)) {
      const afterPrefix = lowerRest.slice(prefix.length).trim();
      const isAfterValid = afterPrefix === "" || KNOWN_UNITS.some(u => afterPrefix === u || afterPrefix.startsWith(u)) || /^[a-zωΩµ]*$/.test(afterPrefix);
      if (isAfterValid) {
        return { valid: true, value: baseValue * multiplier, suffix: canonical };
      }
    }
  }

  return {
    valid: false,
    error: `Sufijo "${rawRest}" no reconocido`,
  };
}

const ORDERED_FOR_DISPLAY = [
  { suffix: "T", multiplier: 1e12 },
  { suffix: "G", multiplier: 1e9 },
  { suffix: "Meg", multiplier: 1e6 },
  { suffix: "k", multiplier: 1e3 },
  { suffix: "", multiplier: 1 },
  { suffix: "m", multiplier: 1e-3 },
  { suffix: "u", multiplier: 1e-6 },
  { suffix: "n", multiplier: 1e-9 },
  { suffix: "p", multiplier: 1e-12 },
  { suffix: "f", multiplier: 1e-15 },
];

export function formatSpiceValue(value: number, unitSuffix = ""): string {
  if (value === 0) return `0${unitSuffix}`;

  const sign = value < 0 ? "-" : "";
  const absValue = Math.abs(value);

  for (const { suffix, multiplier } of ORDERED_FOR_DISPLAY) {
    const mantissa = absValue / multiplier;
    if (mantissa >= 0.999999 && mantissa < 999.999999) {
      const rounded = Number(mantissa.toPrecision(6));
      return `${sign}${rounded}${suffix}${unitSuffix}`;
    }
  }

  return `${sign}${absValue.toExponential(2)}${unitSuffix}`;
}
