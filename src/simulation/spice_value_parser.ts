const SUFFIX_MULTIPLIERS: Array<{ suffix: string; multiplier: number }> = [
  { suffix: "Meg", multiplier: 1e6 },
  { suffix: "T", multiplier: 1e12 },
  { suffix: "G", multiplier: 1e9 },
  { suffix: "k", multiplier: 1e3 },
  { suffix: "K", multiplier: 1e3 },
  { suffix: "m", multiplier: 1e-3 },
  { suffix: "u", multiplier: 1e-6 },
  { suffix: "µ", multiplier: 1e-6 },
  { suffix: "n", multiplier: 1e-9 },
  { suffix: "p", multiplier: 1e-12 },
  { suffix: "f", multiplier: 1e-15 },
];

export interface ParseResult {
  valid: boolean;
  value?: number;
  suffix?: string;
  error?: string;
}

export function parseSpiceValue(input: string): ParseResult {
  const trimmed = input.trim();
  if (trimmed === "") {
    return { valid: false, error: "Valor vacío" };
  }

  const scientificMatch = trimmed.match(/^[+-]?\d*\.?\d+[eE][+-]?\d+$/);
  if (scientificMatch) {
    const value = Number(trimmed);
    if (Number.isFinite(value)) {
      return { valid: true, value, suffix: "" };
    }
  }

  const numericMatch = trimmed.match(/^([+-]?\d*\.?\d+)(.*)$/);
  if (!numericMatch) {
    return { valid: false, error: `No se reconoce "${trimmed}" como un número` };
  }

  const [, numberPart, rest] = numericMatch;
  const baseValue = Number(numberPart);
  if (!Number.isFinite(baseValue)) {
    return { valid: false, error: `"${numberPart}" no es un número válido` };
  }

  if (rest === "") {
    return { valid: true, value: baseValue, suffix: "" };
  }

  for (const { suffix, multiplier } of SUFFIX_MULTIPLIERS) {
    if (rest.startsWith(suffix)) {
      const afterSuffix = rest.slice(suffix.length);
      if (afterSuffix === "" || /^[a-zA-ZΩµ]*$/.test(afterSuffix)) {
        return { valid: true, value: baseValue * multiplier, suffix };
      }
    }
  }

  if (rest.startsWith("M") && !rest.startsWith("Meg")) {
    return {
      valid: false,
      error: '"M" es ambiguo — usa "Meg" para mega o "m" para mili',
    };
  }

  return {
    valid: false,
    error: `Sufijo "${rest}" no reconocido`,
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
    if (mantissa >= 1 && mantissa < 1000) {
      const rounded = Math.round(mantissa * 100) / 100;
      return `${sign}${rounded}${suffix}${unitSuffix}`;
    }
  }

  return `${sign}${absValue.toExponential(2)}${unitSuffix}`;
}
