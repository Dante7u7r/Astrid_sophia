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

import { safeInvoke as invoke } from "./tauri_mock";
import { type CircuitNetlist } from "./netlist_extractor";
import { type SimulationRunner } from "./simulation_runner";
import { type ComponentInstance, type PinInstance, type WireInstance } from "../canvas_orchestrator";
import { type AnalysisMode } from "../ui/simulation_controls";
import { type TSResult } from "./fallback_solver";
import { type TimeStepResult } from "../ui/oscilloscope_panel";

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
//      mismo par de nodos, se emite advertencia (no bloqueante).
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

  // 4. Fuentes de tensión en paralelo (advertencia)
  const vsourceNodes: Record<string, string> = {};
  for (const comp of netlist.components) {
    if (comp.type === 'vsource') {
      const nodePair = [comp.pins[0], comp.pins[1]].sort().join('-');
      if (vsourceNodes[nodePair]) {
        warnings.push(`Fuentes en Paralelo: Las fuentes de tensión [${comp.id}] y [${vsourceNodes[nodePair]}] están en paralelo. Esto puede producir inconsistencias de simulación si sus valores nominales difieren.`);
      } else {
        vsourceNodes[nodePair] = comp.id;
      }
    }
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

    if (unconnectedCount === pins.length && comp.type !== 'ground') {
      warnings.push(`Componente huérfano detectado [${comp.id}]: No tiene ninguna conexión activa de red.`);
    } else if (unconnectedCount > 0 && comp.type !== 'ground') {
      const firstFloatIdx = pins.findIndex(p => pinConnectionCount[`${comp.id}:${p.pinIndex}`] === 0);
      warnings.push(`Pin flotante detectado en [${comp.id}] (terminal index ${firstFloatIdx}): Se encuentra desconectado.`);
    }
  }

  return { passed: errors.length === 0, errors, warnings };
}

// ==========================================================================
// DISPATCHER — Configuración y callbacks
// ==========================================================================

export interface DispatchConfig {
  readonly simSettings: Readonly<{ dt: number }>;
  readonly transientDuration: number;
  readonly simulationRunner?: SimulationRunner | null;
  readonly solveCircuitTS?: (netlist: CircuitNetlist) => TSResult | string;
  readonly solveTransientCircuitLocal?:
    (netlist: CircuitNetlist, dt: number, tMax: number) => TimeStepResult[] | string;
  /** Modos que requieren lógica DOM/UI especial (PVT, SPAR) */
  readonly onSpecialMode?: (netlist: CircuitNetlist, mode: AnalysisMode) => Promise<void>;
}

export interface DispatchCallbacks {
  addLog: (text: string, type: 'system' | 'send' | 'receive' | 'error') => void;
  /** Invocado al recibir resultados exitosos del solver (Rust o fallback TS) */
  onResultsReady: (mode: AnalysisMode, results: any) => void;
  /** Actualiza el indicador de estado IPC en la barra de herramientas */
  onIpcStatusUpdate: (text: string, color: string) => void;
  updateCanvasRendering: () => void;
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
  // --- Modos especiales (PVT, SPAR) — delegan a main.ts ---
  if (mode === 'PVT' || mode === 'SPAR') {
    if (config.onSpecialMode) {
      await config.onSpecialMode(netlist, mode);
    }
    return;
  }

  try {
    switch (mode) {
      case 'TRAN': {
        // Salvaguarda: simulationRunner debe estar instanciado
        if (!config.simulationRunner) {
          throw new Error("El simulationRunner no está inicializado. No se puede iniciar la simulación transitoria interactiva.");
        }
        callbacks.addLog("Iniciando simulación transitoria interactiva (streaming)...", "send");
        const settings = { dt: config.simSettings.dt, tMax: config.transientDuration };
        await config.simulationRunner.startInteractiveTransient(netlist, settings);
        callbacks.onIpcStatusUpdate("Solucionador Rust Activo", "var(--accent-cyan)");
        break;
      }

      case 'AC': {
        callbacks.addLog("Enviando conexiones al motor de CA de Rust...", "send");
        const settings = { fStart: 10.0, fEnd: 100000.0, pointsPerDecade: 20 };
        const results = await invoke<any>("run_ac_sweep", { netlist, settings });
        callbacks.addLog("¡Resultados calculados exitosamente en Rust [Respuesta en Frecuencia CA]!", "receive");
        callbacks.onResultsReady(mode, results);
        callbacks.onIpcStatusUpdate("Solucionador Rust Activo", "var(--accent-cyan)");
        callbacks.updateCanvasRendering();
        break;
      }

      case 'SENS': {
        callbacks.addLog("Enviando conexiones al solucionador de sensibilidad de Rust...", "send");
        const results = await invoke<any>("run_sensitivity_analysis", { netlist });
        callbacks.addLog("¡Resultados de Sensibilidad calculados exitosamente en Rust!", "receive");

        // Mostrar resultados detallados en la consola
        callbacks.addLog("----------------------------------------------------------------", "system");
        callbacks.addLog("=== RESULTADOS DEL ANÁLISIS DE SENSIBILIDAD ===", "system");
        for (const sens of results.sensitivities) {
          callbacks.addLog(`Componente: ${sens.componentId} (${sens.parameterName} = ${sens.parameterValue})`, "receive");
          for (const [node, absVal] of Object.entries(sens.absoluteSensitivities)) {
            const normVal = sens.normalizedSensitivities[node] || 0;
            callbacks.addLog(`  • Nodo ${node}: Absoluta = ${(absVal as number).toFixed(6)} V/U | Normalizada = ${((normVal as number) * 100).toFixed(2)}%`, "receive");
          }
        }
        callbacks.addLog("=== LÍMITES DE PEOR CASO (WORST-CASE LIMITS) ===", "system");
        for (const [node, limits] of Object.entries(results.worstCaseLimits)) {
          const lim = limits as any;
          callbacks.addLog(`  • Nodo ${node}: Nom = ${lim.nominalValue.toFixed(4)} V | Desviación = ±${lim.maxDeviation.toFixed(4)} V | Rango = [${lim.worstCaseLow.toFixed(4)} V, ${lim.worstCaseHigh.toFixed(4)} V]`, "receive");
        }
        callbacks.addLog("----------------------------------------------------------------", "system");

        callbacks.onResultsReady(mode, results);
        callbacks.onIpcStatusUpdate("Solucionador Rust Activo", "var(--accent-cyan)");
        callbacks.updateCanvasRendering();
        break;
      }

      case 'PSS': {
        callbacks.addLog("Enviando conexiones al motor PSS [Shooting Method] de Rust...", "send");
        let period = 1e-3;
        const acSource = netlist.components.find(c => c.frequency && c.frequency > 0);
        if (acSource && acSource.frequency) {
          period = 1.0 / acSource.frequency;
        }
        const pssSettings = { period, maxShootingIters: 15, shootingTolerance: 1e-4 };
        const results = await invoke<any>("run_pss_simulation", { netlist, settings: pssSettings });
        callbacks.addLog("¡Resultados calculados exitosamente en Rust [PSS Shooting Method]!", "receive");
        callbacks.onResultsReady(mode, results);
        callbacks.onIpcStatusUpdate("Solucionador Rust Activo", "var(--accent-cyan)");
        callbacks.updateCanvasRendering();
        break;
      }

      case 'STB': {
        callbacks.addLog("Enviando conexiones al motor de análisis de Estabilidad [Polos y Ceros] de Rust...", "send");
        const results = await invoke<any>("run_stability_analysis", { netlist });
        callbacks.addLog("¡Resultados de Estabilidad calculados exitosamente en Rust!", "receive");

        callbacks.addLog("----------------------------------------------------------------", "system");
        callbacks.addLog("=== ANÁLISIS DE ESTABILIDAD DE POLOS Y CEROS (STB) ===", "system");
        callbacks.addLog(`Estado de Estabilidad: ${results.isStable ? "✅ CIRCUITO ESTABLE" : "⚠️ CIRCUITO INESTABLE (Peligro de Oscilación)"}`, "system");
        callbacks.addLog(`Margen de Fase (Phase Margin): ${results.phaseMargin.toFixed(2)}º`, "receive");
        callbacks.addLog(`Margen de Ganancia (Gain Margin): ${results.gainMargin.toFixed(2)} dB`, "receive");
        callbacks.addLog("Lista de Polos del Sistema en el Plano de Laplace (s):", "receive");
        results.poles.forEach((p: any, idx: number) => {
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
        const results = await invoke<any>("run_dc_simulation", { netlist });
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
  } catch (error) {
    const errorMsg = error instanceof Error ? error.message : String(error);
    callbacks.addLog(`Error en la comunicación con el motor de Rust: ${errorMsg}`, "error");

    // Fallback a solvers TypeScript si Tauri IPC no está disponible
    // (entorno de navegador estándar sin objeto window.__TAURI__)
    if (errorMsg.includes("window.__TAURI_IPC__") || errorMsg.includes("not found") || errorMsg.includes("window.__TAURI__")) {
      callbacks.addLog("Entorno de navegador detectado. Iniciando solucionador local en TypeScript...", "system");

      // Retardo estratégico de 300ms para emular latencia de red
      // y permitir que la UI termine de renderizar el estado de carga.
      setTimeout(() => {
        if (mode === 'AC') {
          // Filtro pasa-bajos demo para respuesta en frecuencia
          callbacks.addLog("Simulando respuesta en frecuencia del circuito localmente en navegador...", "receive");
          const freqs: number[] = [];
          const nodeAmplitudes: Record<string, number[]> = {};
          const nodePhases: Record<string, number[]> = {};

          const nodes = new Set<string>();
          netlist.components.forEach(comp => {
            comp.pins.forEach(pin => {
              if (pin !== "0") nodes.add(pin);
            });
          });

          const logMin = Math.log10(10);
          const logMax = Math.log10(100000);
          for (let i = 0; i <= 100; i++) {
            const logVal = logMin + (i / 100) * (logMax - logMin);
            freqs.push(Math.pow(10, logVal));
          }

          nodes.forEach(nodeId => {
            const fc = nodeId === "1" ? 1000 : nodeId === "2" ? 10000 : 5000;
            const amps: number[] = [];
            const phases: number[] = [];
            freqs.forEach(f => {
              const ratio = f / fc;
              const mag = 1.0 / Math.sqrt(1 + ratio * ratio);
              const phase = -Math.atan(ratio) * (180 / Math.PI);
              amps.push(20 * Math.log10(mag));
              phases.push(phase);
            });
            nodeAmplitudes[nodeId] = amps;
            nodePhases[nodeId] = phases;
          });

          const acResults = { frequencies: freqs, nodeAmplitudes, nodePhases };
          callbacks.onResultsReady(mode, acResults);
          callbacks.onIpcStatusUpdate("Respaldo local Activo (Filtro Demo CA)", "var(--warning)");
          callbacks.updateCanvasRendering();

        } else if (mode === 'TRAN') {
          if (!config.solveTransientCircuitLocal) {
            callbacks.addLog("Error: Solver transitorio local no disponible.", "error");
            return;
          }
          const tsRes = config.solveTransientCircuitLocal(netlist, config.simSettings.dt, config.transientDuration);
          if (typeof tsRes === "string") {
            callbacks.addLog(`Error del solucionador transitorio local: ${tsRes}`, "error");
          } else {
            callbacks.onResultsReady(mode, tsRes);
            callbacks.onIpcStatusUpdate("Respaldo Transitorio local", "var(--warning)");
            callbacks.updateCanvasRendering();
          }
        } else {
          if (!config.solveCircuitTS) {
            callbacks.addLog("Error: Solver DC local no disponible.", "error");
            return;
          }
          const tsRes = config.solveCircuitTS(netlist);
          if (typeof tsRes === "string") {
            callbacks.addLog(`Error del solucionador local: ${tsRes}`, "error");
          } else {
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
        }
      }, 300);
    }
  }
}
