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
  | "timestep-too-small"
  | "unknown";

export interface ClassifiedSimulationError {
  kind: SimulationErrorKind;
  title: string;
  /** Mensaje original de Rust, sin modificar — para logs/debug. */
  rawMessage: string;
  /** Mensaje apto para mostrar al usuario, en español, sin jerga de álgebra lineal interna. */
  userMessage: string;
  /** Recomendación práctica para solucionar el problema. */
  remedy: string;
  severity: "error" | "warning";
  actionType: "focus" | "settings" | "none";
  /**
   * Si el mensaje de Rust menciona un identificador de nodo/componente
   * reconocible (best-effort regex), se extrae aquí para que la UI pueda
   * resaltarlo en el esquemático.
   */
  suspectedComponentOrNetId: string | null;
}

const PATTERNS: Array<{
  kind: SimulationErrorKind;
  regex: RegExp;
  title: string;
  userMessage: string;
  remedy: string;
  actionType: "focus" | "settings" | "none";
}> = [
  {
    kind: "singular-matrix",
    regex: /singular/i,
    title: "Matriz Singular (Nodo Flotante o Cortocircuito)",
    userMessage:
      "El circuito tiene una matriz singular — probablemente un nodo flotante (sin referencia a tierra) o un lazo de fuentes de voltaje en conflicto.",
    remedy:
      "Verifica que el circuito tenga al menos un terminal conectado a Tierra (GND) y que ninguna fuente de voltaje esté cortocircuitada consigo misma.",
    actionType: "focus",
  },
  {
    kind: "timestep-too-small",
    regex: /timestep too small|step size too small|dt min/i,
    title: "Paso de Integración Demasiado Pequeño",
    userMessage:
      "El solver redujo el paso de tiempo por debajo del umbral mínimo permitido debido a una conmutación extremadamente abrupta.",
    remedy:
      "Aumenta los tiempos de subida/bajada de las fuentes de pulsos, o cambia el método de integración a Gear-2 / Trapezoidal en Ajustes.",
    actionType: "settings",
  },
  {
    kind: "max-iterations-exceeded",
    regex: /100 iter|max.{0,20}iteration|iteration.{0,20}limit/i,
    title: "Límite de Iteraciones Excedido",
    userMessage:
      "El solver no convergió dentro del límite de 100 iteraciones de Newton-Raphson. Suele indicar un punto de operación inicial muy alejado de la solución, o un modelo no-lineal con comportamiento extremo en el rango actual.",
    remedy:
      "Ajusta el paso de tiempo dt en Ajustes o revisa componentes no lineales (diodos, MOSFETs) para asegurar que sus tensiones no excedan los límites físicos.",
    actionType: "settings",
  },
  {
    kind: "convergence-failure",
    regex: /converg/i,
    title: "Fallo de Convergencia Numérica",
    userMessage:
      "El análisis no convergió. Revisa componentes no-lineales (diodos, transistores) por valores de modelo poco realistas, o intenta ajustar las condiciones iniciales.",
    remedy:
      "Verifica que las fuentes no generen discontinuidades infinitas y considera añadir resistencias de amortiguamiento en paralelo.",
    actionType: "settings",
  },
  {
    kind: "invalid-circuit",
    regex: /invalid|disconnected|no ground|missing ground/i,
    title: "Circuito Inválido o Desconectado",
    userMessage:
      "El circuito no es válido para simular — verifica que exista una referencia a tierra (GND) y que no haya nets completamente desconectados del resto del circuito.",
    remedy:
      "Añade un símbolo de Tierra (GND) y conecta todos los terminales antes de iniciar la simulación.",
    actionType: "focus",
  },
];

// Best-effort: busca algo con forma de identificador de componente o net
const COMPONENT_OR_NET_ID_PATTERN = /\b([A-Z]{1,3}\d+|N\$\d+)\b/;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function stringField(record: Record<string, unknown>, key: string): string | null {
  const value = record[key];
  return typeof value === "string" ? value : null;
}

export function classifySimulationError(error: unknown): ClassifiedSimulationError {
  if (isRecord(error) && "kind" in error && "details" in error && isRecord(error.details)) {
    const kind = stringField(error, "kind");
    const details = error.details;
    const rawMessage = stringField(details, "message") ?? JSON.stringify(error);

    let tsKind: SimulationErrorKind = "unknown";
    let title = "Error de Simulación";
    let suspectedComponentOrNetId: string | null = null;
    let userMessage = stringField(details, "message") ?? "";
    let remedy = "Revisa los componentes y conexiones del circuito.";
    let actionType: "focus" | "settings" | "none" = "none";

    if (kind === "SingularMatrix") {
      tsKind = "singular-matrix";
      title = "Matriz Singular (Nodo Flotante)";
      suspectedComponentOrNetId = stringField(details, "node");
      userMessage = stringField(details, "message") ?? userMessage;
      remedy = "Asegura una conexión a Tierra (GND) y elimina nodos aislados.";
      actionType = "focus";
    } else if (kind === "MaxIterationsExceeded") {
      tsKind = "max-iterations-exceeded";
      title = "Límite de Iteraciones Excedido";
      suspectedComponentOrNetId = stringField(details, "component");
      userMessage = stringField(details, "message") ?? userMessage;
      remedy = "Ajusta la tolerancia o el paso de tiempo en Ajustes de Simulación.";
      actionType = "settings";
    } else if (kind === "ConvergenceFailure") {
      tsKind = "convergence-failure";
      title = "Fallo de Convergencia";
      suspectedComponentOrNetId = stringField(details, "component");
      userMessage = stringField(details, "message") ?? userMessage;
      remedy = "Revisa modelos de semiconductores o condiciones iniciales.";
      actionType = "settings";
    } else if (kind === "InvalidCircuit") {
      tsKind = "invalid-circuit";
      title = "Circuito Inválido";
      userMessage = stringField(details, "message") ?? userMessage;
      remedy = "Verifica que todos los cables estén correctamente enlazados a pines.";
      actionType = "focus";
    }

    return {
      kind: tsKind,
      title,
      rawMessage,
      userMessage,
      remedy,
      severity: "error",
      actionType,
      suspectedComponentOrNetId,
    };
  }

  const rawMessage = error instanceof Error ? error.message : String(error);

  for (const pattern of PATTERNS) {
    if (pattern.regex.test(rawMessage)) {
      const idMatch = rawMessage.match(COMPONENT_OR_NET_ID_PATTERN);
      return {
        kind: pattern.kind,
        title: pattern.title,
        rawMessage,
        userMessage: pattern.userMessage,
        remedy: pattern.remedy,
        severity: "error",
        actionType: pattern.actionType,
        suspectedComponentOrNetId: idMatch ? idMatch[1] : null,
      };
    }
  }

  return {
    kind: "unknown",
    title: "Error de Simulación",
    rawMessage,
    userMessage: `Error inesperado durante la simulación: ${rawMessage}`,
    remedy: "Revisa la consola de telemetría para obtener detalles técnicos adicionales.",
    severity: "error",
    actionType: "none",
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
