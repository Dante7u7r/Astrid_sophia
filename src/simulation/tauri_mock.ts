import { invoke } from "@tauri-apps/api/core";
import { listen, type Event, type UnlistenFn } from "@tauri-apps/api/event";

type WebEventHandler = (event: Event<unknown>) => void;

const webEventListeners = new Map<string, Set<WebEventHandler>>();
const loggedMockCommands = new Set<string>();
let webTransientRunId = 0;
let webActiveExternalRunId: number | null = null;
let webTransientTimers: ReturnType<typeof setTimeout>[] = [];

function isTauriEnvironment(): boolean {
  return typeof window !== "undefined" && ("__TAURI_INTERNALS__" in window || "__TAURI__" in window);
}

function emitWebEvent<T>(eventName: string, payload: T, id: number): void {
  const handlers = webEventListeners.get(eventName);
  if (!handlers) return;

  const event = { event: eventName, id, payload } as Event<T>;
  handlers.forEach((handler) => handler(event as Event<unknown>));
}

function stopWebTransient(expectedRunId?: number): void {
  if (
    expectedRunId !== undefined
    && webActiveExternalRunId !== null
    && expectedRunId !== webActiveExternalRunId
  ) {
    return;
  }
  webTransientRunId += 1;
  webActiveExternalRunId = null;
  webTransientTimers.forEach((timer) => clearTimeout(timer));
  webTransientTimers = [];
}

function startWebTransient(args?: Record<string, unknown>): void {
  stopWebTransient();
  const cancellationId = webTransientRunId;
  const runId = typeof args?.runId === "number" ? args.runId : cancellationId;
  webActiveExternalRunId = runId;
  const settings = args?.settings as { dt?: number; tMax?: number } | undefined;
  const tMax = Math.max(settings?.tMax ?? 0.05, settings?.dt ?? 1e-4);
  const frameCount = 60;

  for (let index = 0; index < frameCount; index += 1) {
    const timer = setTimeout(() => {
      if (cancellationId !== webTransientRunId) return;

      const time = tMax * (index / (frameCount - 1));
      const isFinal = index === frameCount - 1;
      emitWebEvent("sim-frame-update", {
        runId,
        time,
        nodeVoltages: {
          "0": 0,
          "1": 5,
          "2": 5 * (1 - Math.exp(-time / 0.001)),
        },
        branchCurrents: {
          V1: -0.005 * Math.exp(-time / 0.001),
        },
        frameIndex: index,
        isFinal,
        triggerEvent: null,
      }, index);

      if (isFinal) webTransientTimers = [];
    }, 40 * (index + 1));
    webTransientTimers.push(timer);
  }
}

export async function safeListen<T>(
  eventName: string,
  handler: (event: Event<T>) => void,
): Promise<UnlistenFn> {
  if (isTauriEnvironment()) {
    return await listen<T>(eventName, handler);
  }

  const handlers = webEventListeners.get(eventName) ?? new Set<WebEventHandler>();
  const webHandler = handler as WebEventHandler;
  handlers.add(webHandler);
  webEventListeners.set(eventName, handlers);

  return () => {
    handlers.delete(webHandler);
    if (handlers.size === 0) webEventListeners.delete(eventName);
  };
}

/**
 * Invoca un comando de Tauri de manera segura.
 * Si se ejecuta dentro del contenedor de Tauri (desktop), llama a invoke real.
 * Si se ejecuta en un navegador web convencional (sin __TAURI_INTERNALS__),
 * devuelve respuestas simuladas (mock) para evitar fallos y permitir pruebas de UI.
 */
export async function safeInvoke<T>(cmd: string, args?: Record<string, unknown>): Promise<T> {
  if (isTauriEnvironment()) {
    return await invoke<T>(cmd, args);
  }

  // MOCK FALLBACK FOR WEB BROWSER
  if (!loggedMockCommands.has(cmd)) {
    console.debug(`[Tauri Web Mock] Comando IPC simulado: '${cmd}'.`);
    loggedMockCommands.add(cmd);
  }

  switch (cmd) {
    case "get_performance_telemetry":
      return {
        cpu_usage: 8.5 + Math.random() * 5.0,
        cpuPercent: 8.5 + Math.random() * 5.0,
        memory_used_mb: 210,
        ramFormatted: "210 MB",
        process_memory_mb: 65,
      } as T;

    case "run_dc_simulation":
      return {
        nodeVoltages: { "0": 0.0, "1": 5.0, "2": 2.5 },
        node_voltages: { "0": 0.0, "1": 5.0, "2": 2.5 },
        branchCurrents: { "V1": -0.0025 },
        branch_currents: { "V1": -0.0025 },
        iterations: 4,
        converged: true,
      } as T;

    case "run_transient_simulation":
      return {
        time: [0, 0.001, 0.002, 0.003, 0.004, 0.005],
        nodeVoltages: {
          "1": [5.0, 5.0, 5.0, 5.0, 5.0, 5.0],
          "2": [0.0, 1.2, 2.5, 3.4, 4.1, 4.5],
        },
        node_voltages: {
          "1": [5.0, 5.0, 5.0, 5.0, 5.0, 5.0],
          "2": [0.0, 1.2, 2.5, 3.4, 4.1, 4.5],
        },
        branchCurrents: {},
        branch_currents: {},
        converged: true,
      } as T;

    case "run_ac_sweep":
      return {
        frequencies: [10, 100, 1000, 10000, 100000],
        magnitude_db: { "2": [0.0, -0.04, -3.01, -20.0, -40.0] },
        phase_deg: { "2": [0.0, -5.7, -45.0, -84.3, -89.4] },
        nodeAmplitudes: { "2": [1.0, 0.99, 0.707, 0.1, 0.01] },
        nodePhases: { "2": [0.0, -5.7, -45.0, -84.3, -89.4] },
        converged: true,
      } as T;

    case "run_sensitivity_analysis":
      return {
        sensitivities: { "R1": 0.5, "R2": -0.5 },
        converged: true,
      } as T;

    case "run_pss_simulation":
    case "run_stability_analysis":
    case "run_dc_sweep":
    case "run_noise_sweep":
    case "run_monte_carlo_transient":
    case "run_fft_analysis":
    case "run_imd_analysis":
      return {
        converged: true,
        nodeVoltages: { "0": 0.0, "1": 5.0, "2": 2.5 },
        node_voltages: { "0": 0.0, "1": 5.0, "2": 2.5 },
        message: "Web mock simulation completed successfully",
      } as T;

    case "open_circuit_file":
      return ["demo_circuit.astryd", JSON.stringify({ components: [], wires: [] })] as T;

    case "save_circuit_file":
    case "save_circuit_to_path":
    case "export_touchstone_file":
      return "mock_exported_file.txt" as T;

    case "start_interactive_transient":
      startWebTransient(args);
      return undefined as T;

    case "stop_interactive_transient":
      stopWebTransient(typeof args?.runId === "number" ? args.runId : undefined);
      return undefined as T;

    case "inject_live_mutation":
      return undefined as T;

    default:
      console.warn(`[Tauri Web Mock] Comando sin mock explícito '${cmd}', devolviendo objeto vacío.`);
      return { converged: true } as T;
  }
}
