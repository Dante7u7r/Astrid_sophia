// ==========================================================================
// SIMULATION DISPATCHER — Orquestador de solvers (Rust IPC + Fallback TS)
// ==========================================================================
// Responsabilidades:
//   1. Ejecutar el Chequeo de Reglas Eléctricas (ERC) sobre el netlist
//      para validar la topología del circuito antes de simular.
//   2. Despachar el netlist al solver correspondiente según el modo de
//      análisis (DC, AC, TRAN, SENS, PSS, STB, PVT, SPAR) mediante
//      invocaciones IPC a Tauri v2 (Rust) o solvers de respaldo TS.
//   3. Gestionar el fallback automático cuando Tauri IPC no está
//      disponible (entorno de navegador estándar).
//
// Desacoplamiento:
//   El módulo NO tiene acceso a la UI (oscilloscopePanel, canvas,
//   liveVoltages). Toda notificación a la capa de presentación ocurre
//   a través de la interfaz DispatchCallbacks, inyectada por main.ts.
//
//   Dependencias de importación (sin ciclos):
//     dispatcher → netlist_extractor, simulation_runner, fallback_solver
//     dispatcher → canvas_orchestrator (solo tipos ComponentInstance)
//     main.ts → dispatcher (NUNCA al revés)
// ==========================================================================

import { invokeTyped, type SimulationDispatchResult } from "./tauri_commands";
import { type CircuitNetlist } from "./netlist_extractor";
import { type SimulationRunner } from "./simulation_runner";
import { TelemetryPanel } from "../ui/telemetry_panel";
import { type ComponentInstance, type PinInstance, type WireInstance } from "../canvas_orchestrator";
import { type AnalysisMode } from "../ui/simulation_controls";
import { type TSResult } from "./fallback_solver";
import { type TimeStepResult } from "../ui/oscilloscope_panel";
import { type SimulationSettings } from "../ui/settings_modal";
import { classifySimulationError } from "./simulation-error";
import {
  findIsolatedActiveNodes,
  hasIdealVoltageSourceCycle,
} from "./erc_graph";
import { allowsFloatingPins } from "./component_pin_rules";
import {
  completeFeedbackRun,
  failFeedbackRun,
  inferPointCount,
  recordConvergence,
  type FeedbackRunHandle,
} from "../feedback/instrumentation";

let fallbackTimeoutId: ReturnType<typeof setTimeout> | null = null;

export function clearPendingTimeouts(): void {
  if (fallbackTimeoutId !== null) {
    clearTimeout(fallbackTimeoutId);
    fallbackTimeoutId = null;
  }
}

// ==========================================================================
// ERC — ELECTRICAL RULE CHECK
// ==========================================================================
// Validaciones secuenciales:
//   1. Netlist vacío → pasa (sin errores).
//   2. Presencia obligatoria de nodo de referencia a Tierra ("0").
//      Si no hay componente tipo 'ground', se reporta error fatal.
//   3. Cortocircuito franco en fuentes de tensión: si ambos terminales
//      (pins[0] y pins[1]) están en el mismo nodo eléctrico.
//   4. Fuentes de tensión en paralelo: si dos VSources comparten el
//      mismo par de nodos, se bloquea por restricción MNA redundante.
//   5. Conteo de conexiones por pin físico: se itera sobre los
//      componentes del orchestrator y se cuentan las uniones por
//      cable. Si un pin tiene 0 conexiones y no es GND, se reporta:
//      - "Componente huérfano" si ningún pin del componente está conectado.
//      - "Pin flotante" si al menos un pin está conectado.
// ==========================================================================

export interface ERCResult {
  readonly passed: boolean;
  readonly errors: readonly string[];
  readonly warnings: readonly string[];
}

export function runElectricalRuleCheck(
  netlist: CircuitNetlist,
  components: readonly ComponentInstance[],
  wires: readonly WireInstance[],
  getPins: (c: ComponentInstance) => PinInstance[],
): ERCResult {
  const errors: string[] = [];
  const warnings: string[] = [];

  // 1. Netlist vacío
  if (!netlist || netlist.components.length === 0) {
    return { passed: true, errors, warnings };
  }

  // 2. Tierra (GND) — referencia obligatoria
  const hasGnd = netlist.components.some(c => c.type === 'ground');
  if (!hasGnd) {
    errors.push("Referencia a Tierra ausente (GND): El circuito necesita al menos un nodo de referencia de 0 V para que el motor matemático de Rust converja.");
  }

  // 3. Cortocircuito franco en fuentes de tensión
  for (const comp of netlist.components) {
    if (comp.type === 'vsource') {
      if (comp.pins[0] === comp.pins[1]) {
        errors.push(`Cortocircuito Franco detectado en la fuente [${comp.id}]: Sus terminales positivo y negativo están conectados al mismo nodo eléctrico.`);
      }
    }
  }

  // 4. Fuentes de tensión en paralelo (restricción MNA singular)
  const vsourceNodes: Record<string, string> = {};
  let hasParallelVoltageSources = false;
  for (const comp of netlist.components) {
    if (comp.type === 'vsource') {
      const nodePair = [comp.pins[0], comp.pins[1]].sort().join('-');
      if (vsourceNodes[nodePair]) {
        hasParallelVoltageSources = true;
        errors.push(`Fuentes en Paralelo: Las fuentes de tensión [${comp.id}] y [${vsourceNodes[nodePair]}] imponen restricciones redundantes y generan una matriz MNA singular.`);
      } else {
        vsourceNodes[nodePair] = comp.id;
      }
    }
  }

  const temporalMcu = netlist.components.find(component =>
    component.type === "mcu_8051" || component.type === "mcu_avr"
  );
  if (temporalMcu) {
    errors.push(
      `MCU temporal no simulable [${temporalMcu.id}]: el runtime actual no ejecuta firmware. Use un modelo funcional de placa o retire el componente.`,
    );
  }

  // 5. Conteo de conexiones por pin (pines flotantes / huérfanos)
  const pinConnectionCount: Record<string, number> = {};

  for (const comp of components) {
    const pins = getPins(comp);
    for (const pin of pins) {
      const pinKey = `${comp.id}:${pin.pinIndex}`;
      pinConnectionCount[pinKey] = 0;
    }
  }

  for (const wire of wires) {
    const keyFrom = `${wire.from.componentId}:${wire.from.pinIndex}`;
    const keyTo = `${wire.to.componentId}:${wire.to.pinIndex}`;
    if (pinConnectionCount[keyFrom] !== undefined) pinConnectionCount[keyFrom]++;
    if (pinConnectionCount[keyTo] !== undefined) pinConnectionCount[keyTo]++;
  }

  for (const comp of components) {
    const pins = getPins(comp);
    let unconnectedCount = 0;
    for (const pin of pins) {
      const pinKey = `${comp.id}:${pin.pinIndex}`;
      if (pinConnectionCount[pinKey] === 0) unconnectedCount++;
    }

    if (allowsFloatingPins(comp.type)) {
      continue;
    }

    if (unconnectedCount === pins.length && comp.type !== 'ground') {
      warnings.push(`Componente huérfano detectado [${comp.id}]: No tiene ninguna conexión activa de red.`);
    } else if (unconnectedCount > 0 && comp.type !== 'ground') {
      const firstFloatIdx = pins.findIndex(p => pinConnectionCount[`${comp.id}:${p.pinIndex}`] === 0);
      warnings.push(`Pin flotante detectado en [${comp.id}] (terminal index ${firstFloatIdx}): Se encuentra desconectado.`);
    }
  }

  // 6. Conectividad a Tierra (subcircuitos aislados)
  const isolatedNodes = findIsolatedActiveNodes(netlist);

  if (isolatedNodes.length > 0) {
    const isolatedComps = new Set<string>();
    for (const comp of netlist.components) {
      if (comp.pins.some(pin => isolatedNodes.includes(pin))) {
        if (comp.type !== 'ground') {
          isolatedComps.add(comp.id);
        }
      }
    }
    if (isolatedComps.size > 0) {
      errors.push(`Subcircuito aislado detectado: Los componentes [${Array.from(isolatedComps).join(', ')}] están conectados a nodos sin ruta de corriente continua (DC) a Tierra (GND).`);
    }
  }

  // 7. Bucle de fuentes de tensión ideales
  if (!hasParallelVoltageSources && hasIdealVoltageSourceCycle(netlist)) {
    errors.push("Bucle de fuentes de tensión detectado: Hay un lazo cerrado compuesto únicamente por fuentes de tensión ideales. Esto produce una corriente indeterminada (matriz singular).");
  }

  return { passed: errors.length === 0, errors, warnings };
}

// ==========================================================================
// DISPATCHER — Configuración y callbacks
// ==========================================================================

export interface DispatchConfig {
  readonly simSettings: Readonly<
    Pick<SimulationSettings, "dt">
    & Partial<Pick<SimulationSettings, "tolerance" | "maxIterations">>
  >;
  readonly transientDuration: number;
  readonly simulationOwnerId?: string;
  readonly simulationRunner?: SimulationRunner | null;
  readonly feedbackRun?: FeedbackRunHandle;
  readonly solveCircuitTS?: (netlist: CircuitNetlist) => TSResult | string;
  readonly solveTransientCircuitLocal?:
    (netlist: CircuitNetlist, dt: number, tMax: number) => Promise<TimeStepResult[] | string> | TimeStepResult[] | string;
  /** Modos que requieren lógica DOM/UI especial (PVT, SPAR) */
  readonly onSpecialMode?: (netlist: CircuitNetlist, mode: AnalysisMode) => Promise<void>;
}

export interface DispatchCallbacks {
  addLog: (text: string, type: 'system' | 'send' | 'receive' | 'error') => void;
  /** Invocado al recibir resultados exitosos del solver (Rust o fallback TS) */
  onResultsReady: (mode: AnalysisMode, results: SimulationDispatchResult) => void;
  /** Actualiza el indicador de estado IPC en la barra de herramientas */
  onIpcStatusUpdate: (text: string, color: string) => void;
  updateCanvasRendering: () => void;
  onSimulationFinished?: () => void;
  /** Resalta un componente o nodo sospechoso en la interfaz visual */
  onHighlightElement?: (id: string) => void;
}

// ==========================================================================
// DISPATCHER — Orquestación de solvers
// ==========================================================================
// Flujo:
//   1. Si mode es PVT o SPAR → delega a config.onSpecialMode() y retorna.
//   2. Si mode es TRAN:
//      a. Verifica que simulationRunner esté instanciado.
//      b. Llama a simulationRunner.startInteractiveTransient().
//      c. El streaming de frames se maneja via los callbacks del runner.
//   3. Para el resto de modos (DC, AC, SENS, PSS, STB):
//      a. Invoca el comando Tauri v2 correspondiente.
//      b. Notifica resultados via onResultsReady + onIpcStatusUpdate.
//   4. Catch IPC: si Tauri no está disponible (entorno navegador),
//      ejecuta el solver de respaldo TypeScript (fallback) con
//      un retardo de 300ms para emular latencia de red.
// ==========================================================================

export async function dispatchSimulation(
  netlist: CircuitNetlist,
  mode: AnalysisMode,
  config: DispatchConfig,
  callbacks: DispatchCallbacks,
): Promise<void> {
  clearPendingTimeouts();
  const tolerance = config.simSettings.tolerance ?? 1e-6;
  const maxIterations = config.simSettings.maxIterations ?? 100;
  // --- Modos especiales (PVT, SPAR) — delegan a main.ts ---
  if (mode === 'PVT' || mode === 'SPAR') {
    try {
      if (config.onSpecialMode) {
        await config.onSpecialMode(netlist, mode);
      }
    } finally {
      callbacks.onSimulationFinished?.();
    }
    return;
  }

  try {
    let dispatchResult: SimulationDispatchResult | undefined;
    switch (mode) {
      case 'TRAN': {
        // Salvaguarda: simulationRunner debe estar instanciado
        if (!config.simulationRunner) {
          throw new Error("El simulationRunner no está inicializado. No se puede iniciar la simulación transitoria interactiva.");
        }
        callbacks.addLog("Iniciando simulación transitoria interactiva (streaming)...", "send");
        const settings = {
          dt: config.simSettings.dt,
          tMax: config.transientDuration,
          tolerance,
          maxIterations,
        };
        await config.simulationRunner.startInteractiveTransient(
          netlist,
          settings,
          config.simulationOwnerId ?? "unknown",
          config.feedbackRun,
        );
        callbacks.onIpcStatusUpdate("Solucionador Rust Activo", "var(--accent-cyan)");
        break;
      }

      case 'AC': {
        callbacks.addLog("Enviando conexiones al motor de CA de Rust...", "send");
        const settings = { fStart: 10.0, fEnd: 100000.0, pointsPerDecade: 20 };
        const results = await invokeTyped("run_ac_sweep", { netlist, settings });
        dispatchResult = results;
        callbacks.addLog("¡Resultados calculados exitosamente en Rust [Respuesta en Frecuencia CA]!", "receive");
        callbacks.onResultsReady(mode, results);
        callbacks.onIpcStatusUpdate("Solucionador Rust Activo", "var(--accent-cyan)");
        callbacks.updateCanvasRendering();
        break;
      }

      case 'SENS': {
        callbacks.addLog("Enviando conexiones al solucionador de sensibilidad de Rust...", "send");
        const results = await invokeTyped("run_sensitivity_analysis", { netlist });
        dispatchResult = results;
        callbacks.addLog("¡Resultados de Sensibilidad calculados exitosamente en Rust!", "receive");

        // Mostrar resultados detallados en la consola
        callbacks.addLog("----------------------------------------------------------------", "system");
        callbacks.addLog("=== RESULTADOS DEL ANÁLISIS DE SENSIBILIDAD ===", "system");
        for (const sens of results.sensitivities) {
          callbacks.addLog(`Componente: ${sens.componentId} (${sens.parameterName} = ${sens.parameterValue})`, "receive");
          for (const [node, absVal] of Object.entries(sens.absoluteSensitivities)) {
            const normVal = sens.normalizedSensitivities[node] || 0;
            callbacks.addLog(`  • Nodo ${node}: Absoluta = ${absVal.toFixed(6)} V/U | Normalizada = ${(normVal * 100).toFixed(2)}%`, "receive");
          }
        }
        callbacks.addLog("=== LÍMITES DE PEOR CASO (WORST-CASE LIMITS) ===", "system");
        for (const [node, limits] of Object.entries(results.worstCaseLimits)) {
          callbacks.addLog(`  • Nodo ${node}: Nom = ${limits.nominalValue.toFixed(4)} V | Desviación = ±${limits.maxDeviation.toFixed(4)} V | Rango = [${limits.worstCaseLow.toFixed(4)} V, ${limits.worstCaseHigh.toFixed(4)} V]`, "receive");
        }
        callbacks.addLog("----------------------------------------------------------------", "system");

        callbacks.onResultsReady(mode, results);
        callbacks.onIpcStatusUpdate("Solucionador Rust Activo", "var(--accent-cyan)");
        callbacks.updateCanvasRendering();
        break;
      }

      case 'PSS': {
        callbacks.addLog(
          "PSS EXPERIMENTAL: shooting periódico validado sólo en un RC lineal; sin validación externa ni garantía para osciladores o circuitos no lineales.",
          "system",
        );
        callbacks.addLog("Enviando conexiones al motor PSS [Shooting Method] de Rust...", "send");
        let period = 1e-3;
        const acSource = netlist.components.find(c => c.frequency && c.frequency > 0);
        if (acSource && acSource.frequency) {
          period = 1.0 / acSource.frequency;
        }
        const pssSettings = {
          period,
          maxShootingIters: Math.min(maxIterations, 1_000),
          shootingTolerance: tolerance,
        };
        const results = await invokeTyped("run_pss_simulation", { netlist, settings: pssSettings });
        dispatchResult = results;
        callbacks.addLog("¡Resultados calculados exitosamente en Rust [PSS Shooting Method]!", "receive");
        callbacks.onResultsReady(mode, results);
        callbacks.onIpcStatusUpdate("Solucionador Rust Activo", "var(--accent-cyan)");
        callbacks.updateCanvasRendering();
        break;
      }

      case 'STB': {
        callbacks.addLog(
          "POLOS/CEROS EXPERIMENTAL: modelo reducido. No calcula ganancia de lazo ni márgenes de fase/ganancia.",
          "system",
        );
        callbacks.addLog("Enviando conexiones al extractor experimental de polos y ceros de Rust...", "send");
        const results = await invokeTyped("run_stability_analysis", { netlist });
        dispatchResult = results;
        callbacks.addLog("¡Resultados de Estabilidad calculados exitosamente en Rust!", "receive");

        callbacks.addLog("----------------------------------------------------------------", "system");
        callbacks.addLog("=== EXTRACCIÓN EXPERIMENTAL DE POLOS Y CEROS ===", "system");
        callbacks.addLog(
          `Polos del modelo reducido: ${results.isStable ? "todos en el semiplano izquierdo" : "hay polos en el semiplano derecho"}`,
          "system",
        );
        callbacks.addLog("Lista de Polos del Sistema en el Plano de Laplace (s):", "receive");
        results.poles.forEach((p, idx) => {
          callbacks.addLog(`  • Polo ${idx + 1}: ${p.re.toFixed(2)} ${p.im >= 0 ? "+" : "-"} ${Math.abs(p.im).toFixed(2)}j rad/s`, "receive");
        });
        callbacks.addLog("----------------------------------------------------------------", "system");

        callbacks.onResultsReady(mode, results);
        callbacks.onIpcStatusUpdate("Solucionador Rust Activo", "var(--accent-cyan)");
        callbacks.updateCanvasRendering();
        break;
      }

      default: {
        // DC — modo por defecto
        callbacks.addLog(`Enviando conexiones a Rust con ${netlist.components.length} componentes...`, "send");
        const results = await invokeTyped("run_dc_simulation", {
          netlist,
          tolerance,
          maxIterations,
        });
        dispatchResult = results;
        callbacks.addLog("¡Resultados calculados exitosamente en Rust [MNA Newton-Raphson]!", "receive");
        callbacks.addLog("----------------------------------------------------------------", "system");
        callbacks.addLog("=== VOLTAJES DE NODOS (DC) ===", "system");
        for (const [node, volt] of Object.entries(results.nodeVoltages || {})) {
          callbacks.addLog(`Nodo ${node}: Voltaje = ${(volt as number).toFixed(4)} V`, "receive");
        }
        callbacks.addLog("----------------------------------------------------------------", "system");
        callbacks.onResultsReady(mode, results);
        callbacks.onIpcStatusUpdate("Solucionador Rust Activo", "var(--accent-cyan)");
        callbacks.updateCanvasRendering();
        break;
      }
    }
    if (mode !== "TRAN" && config.feedbackRun && dispatchResult !== undefined) {
      recordConvergence(config.feedbackRun, dispatchResult);
      completeFeedbackRun(config.feedbackRun, {
        pointCount: inferPointCount(dispatchResult),
        converged: !(
          typeof dispatchResult === "object"
          && dispatchResult !== null
          && "converged" in dispatchResult
          && dispatchResult.converged === false
        ),
      });
    }
    if (mode !== 'TRAN' && callbacks.onSimulationFinished) {
      callbacks.onSimulationFinished();
    }
  } catch (error) {
    const errorMsg = error instanceof Error ? error.message : String(error);
    const isBrowserEnv = errorMsg.includes("window.__TAURI_IPC__") || errorMsg.includes("not found") || errorMsg.includes("window.__TAURI__");

    if (isBrowserEnv) {
      callbacks.addLog("Entorno de navegador detectado. Iniciando solucionador local en TypeScript...", "system");

      // Retardo estratégico de 300ms para emular latencia de red
      // y permitir que la UI termine de renderizar el estado de carga.
      fallbackTimeoutId = setTimeout(async () => {
        fallbackTimeoutId = null;
        try {
        const rustOnlyModes: Partial<Record<AnalysisMode, string>> = {
          AC: "AC",
          SENS: "de sensibilidad",
          PSS: "PSS",
          STB: "de estabilidad",
        };
        const rustOnlyLabel = rustOnlyModes[mode];
        if (rustOnlyLabel) {
          if (config.feedbackRun) {
            failFeedbackRun(config.feedbackRun, `${mode} requires Rust`, "ipc", "FALLBACK_UNAVAILABLE");
          }
          callbacks.addLog(
            `El análisis ${rustOnlyLabel} no dispone de fallback científico en navegador. Abra la aplicación Tauri para usar el solver Rust.`,
            "error",
          );
          callbacks.onIpcStatusUpdate(`Análisis ${rustOnlyLabel} no disponible sin Rust`, "var(--accent-red)");
          if (callbacks.onSimulationFinished) {
            callbacks.onSimulationFinished();
          }

        } else if (mode === 'TRAN') {
          if (!config.solveTransientCircuitLocal) {
            if (config.feedbackRun) failFeedbackRun(config.feedbackRun, "Transient fallback unavailable", "ipc", "FALLBACK_UNAVAILABLE");
            callbacks.addLog("Error: Solver transitorio local no disponible.", "error");
            if (callbacks.onSimulationFinished) {
              callbacks.onSimulationFinished();
            }
            return;
          }
          const tsRes = await config.solveTransientCircuitLocal(netlist, config.simSettings.dt, config.transientDuration);
          if (typeof tsRes === "string") {
            if (config.feedbackRun) failFeedbackRun(config.feedbackRun, tsRes, "iteration");
            callbacks.addLog(`Error del solucionador transitorio local: ${tsRes}`, "error");
          } else {
            if (config.feedbackRun) completeFeedbackRun(config.feedbackRun, { pointCount: tsRes.length, converged: true });
            callbacks.onResultsReady(mode, tsRes);
            callbacks.onIpcStatusUpdate("Respaldo Transitorio local", "var(--warning)");
            callbacks.updateCanvasRendering();
          }
          if (callbacks.onSimulationFinished) {
            callbacks.onSimulationFinished();
          }
        } else {
          if (!config.solveCircuitTS) {
            if (config.feedbackRun) failFeedbackRun(config.feedbackRun, "DC fallback unavailable", "ipc", "FALLBACK_UNAVAILABLE");
            callbacks.addLog("Error: Solver DC local no disponible.", "error");
            if (callbacks.onSimulationFinished) {
              callbacks.onSimulationFinished();
            }
            return;
          }
          const tsRes = config.solveCircuitTS(netlist);
          if (typeof tsRes === "string") {
            if (config.feedbackRun) failFeedbackRun(config.feedbackRun, tsRes, "iteration");
            callbacks.addLog(`Error del solucionador local: ${tsRes}`, "error");
          } else {
            if (config.feedbackRun) completeFeedbackRun(config.feedbackRun, { pointCount: inferPointCount(tsRes), converged: true });
            callbacks.addLog("Solucionador de respaldo: Resultados calculados en TypeScript.", "receive");
            callbacks.addLog("----------------------------------------------------------------", "system");
            callbacks.addLog("=== VOLTAJES DE NODOS (DC - Fallback) ===", "system");
            for (const [node, volt] of Object.entries(tsRes.nodeVoltages)) {
              callbacks.addLog(`Nodo ${node}: Voltaje = ${(volt as number).toFixed(4)} V`, "receive");
            }
            callbacks.addLog("----------------------------------------------------------------", "system");
            callbacks.onResultsReady(mode, tsRes);
            callbacks.onIpcStatusUpdate("Respaldo local Activo", "var(--warning)");
            callbacks.updateCanvasRendering();
          }
          if (callbacks.onSimulationFinished) {
            callbacks.onSimulationFinished();
          }
        }
        } catch (fallbackError) {
          if (config.feedbackRun) failFeedbackRun(config.feedbackRun, fallbackError, "iteration");
          const message = fallbackError instanceof Error ? fallbackError.message : String(fallbackError);
          callbacks.addLog(`Error del solucionador local: ${message}`, "error");
          callbacks.onIpcStatusUpdate("Error del respaldo local", "var(--accent-red)");
          if (callbacks.onSimulationFinished) callbacks.onSimulationFinished();
        }
      }, 300);
    } else {
      if (config.feedbackRun) failFeedbackRun(config.feedbackRun, error, "ipc");
      const classified = classifySimulationError(errorMsg);
      callbacks.addLog(`Error en el solver de Rust: ${classified.userMessage}`, "error");
      callbacks.addLog(`[Detalles técnicos] ${classified.rawMessage}`, "system");

      if (classified.suspectedComponentOrNetId) {
        callbacks.addLog(`Componente o nodo sospechoso de falla: ${classified.suspectedComponentOrNetId}`, "error");
        if (callbacks.onHighlightElement) {
          callbacks.onHighlightElement(classified.suspectedComponentOrNetId);
        }
      }

      TelemetryPanel.logError(classified.userMessage);
      callbacks.onIpcStatusUpdate("Error de simulación", "var(--accent-red)");
      if (callbacks.onSimulationFinished) {
        callbacks.onSimulationFinished();
      }
    }
  }
}
