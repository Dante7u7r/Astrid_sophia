/**
 * spice-value-parser.ts
 *
 * Parseo y formateo de valores numéricos en notación SPICE/ingeniería.
 * Ver references/component-inspector.md, sección "El problema específico
 * de este dominio: notación de ingeniería" — ESPECIALMENTE la nota sobre
 * "M" vs "Meg". Este archivo es la pieza de código más sensible a errores
 * silenciosos de toda la skill: un bug aquí no falla ruidosamente, produce
 * un valor numéricamente incorrecto que la simulación acepta sin queja.
 * Si modificas esto, vuelve a correr los tests en la sección de abajo del
 * archivo (o muévelos a tu test runner real) antes de confiar en el cambio.
 */

// Orden de chequeo importa: "Meg" debe probarse ANTES que "M" sola para
// no confundir un valor "1Meg" con "1M" + resto-de-string-no-parseado.
// Los sufijos están ordenados de más largo a más corto explícitamente
// para que el matching greedy funcione sin ambigüedad.
const SUFFIX_MULTIPLIERS: Array<{ suffix: string; multiplier: number }> = [
  { suffix: "Meg", multiplier: 1e6 },
  { suffix: "T", multiplier: 1e12 },
  { suffix: "G", multiplier: 1e9 },
  { suffix: "k", multiplier: 1e3 },
  { suffix: "K", multiplier: 1e3 }, // tolerar K mayúscula como alias de k
  { suffix: "m", multiplier: 1e-3 },
  { suffix: "u", multiplier: 1e-6 },
  { suffix: "µ", multiplier: 1e-6 },
  { suffix: "n", multiplier: 1e-9 },
  { suffix: "p", multiplier: 1e-12 },
  { suffix: "f", multiplier: 1e-15 },
  // Nota deliberada: "M" sola NO está en esta tabla. En convención SPICE,
  // "M" sola es no-estándar/ambigua (ver doc) — la tratamos como sufijo
  // desconocido y forzamos al usuario a escribir "Meg" explícitamente,
  // en vez de adivinar mega o mili y arriesgar una interpretación
  // silenciosamente incorrecta. Esto es más seguro que "soportar M como
  // mili" porque un usuario que pega "1M" de un contexto mega-céntrico
  // (no-SPICE) obtiene un error visible en vez de un valor 1e9x distinto
  // sin avisos.
];

export interface ParseResult {
  valid: boolean;
  /** Valor en unidad base SI (ohms, faradios, voltios, etc. sin multiplicador). Solo presente si valid. */
  value?: number;
  /** Sufijo de unidad detectado, sin incluir la unidad base (ej "k", "Meg", "" si ninguno). */
  suffix?: string;
  error?: string;
}

/**
 * Parsea un string de valor SPICE. Acepta:
 *   "4.7k", "4.7K", "1Meg", "10m", "1u", "1µ", "100n", "22p"
 *   "100" (sin sufijo, tomado como unidad base)
 *   "1e-6", "4.7e3" (notación científica directa, sin sufijo)
 * Rechaza explícitamente "M" sola (ver comentario en SUFFIX_MULTIPLIERS).
 *
 * unitSuffix opcional (ej "F", "Ω", "H") se permite trailing y se ignora
 * en el parseo numérico — así "4.7kΩ" y "4.7k" producen el mismo valor.
 */
export function parseSpiceValue(input: string): ParseResult {
  const trimmed = input.trim();
  if (trimmed === "") {
    return { valid: false, error: "Valor vacío" };
  }

  // Notación científica directa (sin sufijo de ingeniería): "1e-6", "4.7E3"
  const scientificMatch = trimmed.match(/^[+-]?\d*\.?\d+[eE][+-]?\d+$/);
  if (scientificMatch) {
    const value = Number(trimmed);
    if (Number.isFinite(value)) {
      return { valid: true, value, suffix: "" };
    }
  }

  // Número puro, posiblemente con sufijo de ingeniería + unidad trailing opcional.
  // Captura: signo+dígitos+decimal (grupo numérico), luego el resto del string.
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

  // Intenta cada sufijo conocido, de más largo a más corto (ya ordenado así
  // arriba) para que "Meg" no sea capturado parcialmente como "M"+"eg" sobrante.
  for (const { suffix, multiplier } of SUFFIX_MULTIPLIERS) {
    if (rest.startsWith(suffix)) {
      // El resto tras el sufijo debe ser vacío o una unidad alfabética
      // trailing (F, H, Ω, ohm, etc.) — no dígitos sobrantes, eso indicaría
      // un sufijo mal formado como "4.7kk" o similar.
      const afterSuffix = rest.slice(suffix.length);
      if (afterSuffix === "" || /^[a-zA-ZΩ]*$/.test(afterSuffix)) {
        return { valid: true, value: baseValue * multiplier, suffix };
      }
    }
  }

  // Caso explícito: "M" sola, no como parte de "Meg" — error claro en vez
  // de adivinar, ver justificación en el comentario de la tabla.
  if (rest.startsWith("M") && !rest.startsWith("Meg")) {
    return {
      valid: false,
      error: `"M" es ambiguo en notación SPICE — usa "Meg" para mega o "m" (minúscula) para mili`,
    };
  }

  return {
    valid: false,
    error: `Sufijo "${rest}" no reconocido`,
  };
}

/**
 * Formatea un valor en unidad base SI de vuelta a la notación de sufijo
 * más legible — ver references/component-inspector.md sección "Unidades
 * mostradas vs. unidades almacenadas". Elige el sufijo cuyo multiplicador
 * deja la mantisa en un rango razonablemente legible (entre 1 y 999.9),
 * no fuerza siempre el sufijo "más cercano" por valor absoluto del
 * exponente, que a veces produce mantisas como "0.001" o "999000" feas.
 */
export function formatSpiceValue(value: number, unitSuffix = ""): string {
  if (value === 0) return `0${unitSuffix}`;

  const sign = value < 0 ? "-" : "";
  const absValue = Math.abs(value);

  // Tabla ordenada de mayor a menor multiplicador para encontrar el
  // primer sufijo donde la mantisa caiga en [1, 1000).
  const orderedForDisplay = [
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

  for (const { suffix, multiplier } of orderedForDisplay) {
    const mantissa = absValue / multiplier;
    if (mantissa >= 1 && mantissa < 1000) {
      const rounded = Math.round(mantissa * 100) / 100; // 2 decimales máx, sin ceros sobrantes
      return `${sign}${trimTrailingZeros(rounded)}${suffix}${unitSuffix}`;
    }
  }

  // Fuera de todos los rangos prácticos (extremadamente grande o pequeño)
  // — cae a notación científica en vez de un sufijo que no existe.
  return `${sign}${absValue.toExponential(2)}${unitSuffix}`;
}

function trimTrailingZeros(n: number): string {
  return n.toString();
}

// ---------------------------------------------------------------------
// Tests de referencia. No son un test runner real — son verificación
// manual del comportamiento crítico de M-vs-Meg y casos límite. Cópialos
// a tu suite de tests real (vitest/jest) y ejecútalos como CI gate antes
// de confiar en cualquier modificación futura a este archivo.
// ---------------------------------------------------------------------

function assertEqual(actual: unknown, expected: unknown, label: string): void {
  // Tolerancia relativa para floats (1e-9): el parser es correcto incluso
  // cuando el resultado difiere del literal "esperado" en el último bit
  // representable de un double — eso es aritmética de punto flotante
  // normal (ej. 100n -> 1.0000000000000001e-7), no un bug de parseo.
  // Comparación exacta de bits aquí daría falsos negativos sin
  // significado práctico para un simulador de circuitos.
  let pass: boolean;
  if (typeof actual === "number" && typeof expected === "number") {
    if (expected === 0) {
      pass = Math.abs(actual) < 1e-15;
    } else {
      pass = Math.abs((actual - expected) / expected) < 1e-9;
    }
  } else {
    pass = JSON.stringify(actual) === JSON.stringify(expected);
  }
  console.log(`${pass ? "✓" : "✗ FAIL"} ${label}`);
  if (!pass) {
    console.log(`  esperado: ${JSON.stringify(expected)}`);
    console.log(`  obtenido: ${JSON.stringify(actual)}`);
  }
}

export function runSpiceParserSelfTests(): void {
  assertEqual(parseSpiceValue("4.7k").value, 4700, "4.7k = 4700");
  assertEqual(parseSpiceValue("1Meg").value, 1_000_000, "1Meg = 1,000,000 (mega, no mili)");
  assertEqual(parseSpiceValue("1u").value, 0.000001, "1u = 1e-6");
  assertEqual(parseSpiceValue("1µ").value, 0.000001, "1µ (símbolo) = 1e-6");
  assertEqual(parseSpiceValue("100n").value, 0.0000001, "100n = 1e-7");
  assertEqual(parseSpiceValue("22p").value, 0.000000000022, "22p = 22e-12");
  assertEqual(parseSpiceValue("100").value, 100, "100 sin sufijo = 100");
  assertEqual(parseSpiceValue("1e-6").value, 0.000001, "notación científica directa");
  assertEqual(parseSpiceValue("4.7kΩ").value, 4700, "sufijo + unidad trailing (kΩ)");
  assertEqual(parseSpiceValue("1M").valid, false, "M sola es inválida explícitamente");
  assertEqual(parseSpiceValue("4.7x").valid, false, "sufijo desconocido es inválido");
  assertEqual(parseSpiceValue("").valid, false, "string vacío es inválido");

  assertEqual(formatSpiceValue(4700), "4.7k", "formateo 4700 -> 4.7k");
  assertEqual(formatSpiceValue(1_000_000), "1Meg", "formateo 1e6 -> 1Meg");
  assertEqual(formatSpiceValue(0.000001), "1u", "formateo 1e-6 -> 1u");
  assertEqual(formatSpiceValue(100), "100", "formateo sin sufijo cuando mantisa cae en rango base");
  assertEqual(formatSpiceValue(0), "0", "formateo de cero");
  assertEqual(formatSpiceValue(-4700), "-4.7k", "formateo preserva signo negativo");
}

