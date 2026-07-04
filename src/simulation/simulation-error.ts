/**
 * simulation-error.ts
 *
 * Todos los comandos Tauri del solver retornan `Result<T, String>` (ver
 * arquitectura de Astryd Sophia: firma segura de comandos). El string de
 * error que llega a TS vía la excepción de `invoke()` es texto libre
 * generado en Rust (probablemente desde `format!()` en mna_solver.rs o
 * engine.rs) — no un enum estructurado. Este módulo clasifica ese string
 * en un tipo de error con el que la UI puede tomar decisiones (qué
 * mensaje mostrar, si vale la pena resaltar un nodo en el esquemático).
 *
 * Esto es un clasificador best-effort por patrón de texto, NO un parser
 * robusto — funciona mientras los mensajes de error en Rust contengan
 * las palabras clave de abajo. Si cambias el texto de los errores en
 * mna_solver.rs/engine.rs, actualiza los patrones aquí en el mismo PR,
 * o el clasificador empezará a categorizar todo como "unknown" sin
 * avisar. Alternativa más robusta a futuro: que los comandos Tauri
 * retornen un enum de error serializado (ej. con thiserror + serde) en
 * vez de String — si llegas a ese punto, este archivo se simplifica
 * mucho (ya no hace falta adivinar por substring).
 */

export type SimulationErrorKind =
  | "convergence-failure"
  | "singular-matrix"
  | "max-iterations-exceeded"
  | "invalid-circuit"
  | "unknown";

export interface ClassifiedSimulationError {
  kind: SimulationErrorKind;
  /** Mensaje original de Rust, sin modificar — para logs/debug. */
  rawMessage: string;
  /** Mensaje apto para mostrar al usuario, en español, sin jerga de álgebra lineal interna. */
  userMessage: string;
  /**
   * Si el mensaje de Rust menciona un identificador de nodo/componente
   * reconocible (best-effort regex), se extrae aquí para que la UI pueda
   * resaltarlo en el esquemático — ver references/simulation-feedback.md,
   * "Convergence failure": el feedback debe señalar el nodo problemático,
   * no solo mostrar texto genérico.
   */
  suspectedComponentOrNetId: string | null;
}

const PATTERNS: Array<{ kind: SimulationErrorKind; regex: RegExp; userMessage: string }> = [
  {
    kind: "singular-matrix",
    regex: /singular/i,
    userMessage:
      "El circuito tiene una matriz singular — probablemente un nodo flotante (sin referencia a tierra) o un lazo de fuentes de voltaje en conflicto.",
  },
  {
    kind: "max-iterations-exceeded",
    regex: /100 iter|max.{0,20}iteration|iteration.{0,20}limit/i,
    userMessage:
      "El solver no convergió dentro del límite de 100 iteraciones de Newton-Raphson. Suele indicar un punto de operación inicial muy alejado de la solución, o un modelo no-lineal con comportamiento extremo en el rango actual.",
  },
  {
    kind: "convergence-failure",
    regex: /converg/i,
    userMessage:
      "El análisis no convergió. Revisa componentes no-lineales (diodos, transistores) por valores de modelo poco realistas, o intenta ajustar las condiciones iniciales.",
  },
  {
    kind: "invalid-circuit",
    regex: /invalid|disconnected|no ground|missing ground/i,
    userMessage:
      "El circuito no es válido para simular — verifica que exista una referencia a tierra (GND) y que no haya nets completamente desconectados del resto del circuito.",
  },
];

// Best-effort: busca algo con forma de identificador de componente o net
// dentro del mensaje de error (ej. "R1", "N$3", "Q2") — funciona si Rust
// interpola el id del nodo/componente problemático en el string de error
// (recomendado hacerlo en mna_solver.rs si no se hace ya, porque mejora
// muchísimo la utilidad de este clasificador). Si Rust no interpola
// ningún id, esto da null y la UI simplemente no resalta nada — caída
// segura, no un error.
const COMPONENT_OR_NET_ID_PATTERN = /\b([A-Z]{1,3}\d+|N\$\d+)\b/;

export function classifySimulationError(error: any): ClassifiedSimulationError {
  if (error && typeof error === "object" && "kind" in error && "details" in error) {
    const kind = error.kind;
    const details = error.details as any;
    const rawMessage = details.message || JSON.stringify(error);
    
    let tsKind: SimulationErrorKind = "unknown";
    let suspectedComponentOrNetId: string | null = null;
    let userMessage = details.message || "";

    if (kind === "SingularMatrix") {
      tsKind = "singular-matrix";
      suspectedComponentOrNetId = details.node || null;
      userMessage = details.message;
    } else if (kind === "MaxIterationsExceeded") {
      tsKind = "max-iterations-exceeded";
      suspectedComponentOrNetId = details.component || null;
      userMessage = details.message;
    } else if (kind === "ConvergenceFailure") {
      tsKind = "convergence-failure";
      suspectedComponentOrNetId = details.component || null;
      userMessage = details.message;
    } else if (kind === "InvalidCircuit") {
      tsKind = "invalid-circuit";
      userMessage = details.message;
    }

    return {
      kind: tsKind,
      rawMessage,
      userMessage,
      suspectedComponentOrNetId,
    };
  }

  const rawMessage = error instanceof Error ? error.message : String(error);

  for (const pattern of PATTERNS) {
    if (pattern.regex.test(rawMessage)) {
      const idMatch = rawMessage.match(COMPONENT_OR_NET_ID_PATTERN);
      return {
        kind: pattern.kind,
        rawMessage,
        userMessage: pattern.userMessage,
        suspectedComponentOrNetId: idMatch ? idMatch[1] : null,
      };
    }
  }

  return {
    kind: "unknown",
    rawMessage,
    userMessage: `Error de simulación no reconocido: ${rawMessage}`,
    suspectedComponentOrNetId: null,
  };
}

/**
 * Helper para envolver una llamada a `invoke()` de un comando Tauri que
 * retorna Result<T,String>, convirtiendo el catch en un
 * ClassifiedSimulationError en vez de dejar pasar el string crudo.
 *
 * Uso:
 *   const result = await callSimulationCommand(() => invoke<DcResult>("run_dc_operating_point", { ... }));
 *   if (!result.ok) {
 *     showError(result.error); // result.error es ClassifiedSimulationError
 *     return;
 *   }
 *   useDcResult(result.value);
 */
export async function callSimulationCommand<T>(
  invokeFn: () => Promise<T>
): Promise<{ ok: true; value: T } | { ok: false; error: ClassifiedSimulationError }> {
  try {
    const value = await invokeFn();
    return { ok: true, value };
  } catch (err) {
    return { ok: false, error: classifySimulationError(err) };
  }
}
