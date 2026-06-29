import { invoke } from "@tauri-apps/api/core";

/**
 * Invoca un comando de Tauri de manera segura.
 * Si se ejecuta dentro del contenedor de Tauri (desktop), llama a invoke real.
 * Si se ejecuta en un navegador web convencional (sin __TAURI_INTERNALS__),
 * devuelve respuestas simuladas (mock) para evitar fallos y permitir pruebas de UI.
 */
export async function safeInvoke<T>(cmd: string, args?: Record<string, unknown>): Promise<T> {
  const isTauriEnv = typeof window !== "undefined" && ("__TAURI_INTERNALS__" in window || "__TAURI__" in window);

  if (isTauriEnv) {
    return await invoke<T>(cmd, args);
  }

  // MOCK FALLBACK FOR WEB BROWSER
  console.warn(`[Tauri Web Mock] Interceptado comando IPC '${cmd}' con argumentos:`, args);

  switch (cmd) {
    case "get_performance_telemetry":
      return {
        cpu_usage: 8.5 + Math.random() * 5.0,
        memory_used_mb: 210,
        process_memory_mb: 65,
      } as T;

    case "run_dc_simulation":
      return {
        node_voltages: { "0": 0.0, "1": 5.0, "2": 2.5 },
        branch_currents: { "V1": -0.0025 },
        iterations: 4,
        converged: true,
      } as T;

    case "run_transient_simulation":
      return {
        time: [0, 0.001, 0.002, 0.003, 0.004, 0.005],
        node_voltages: {
          "1": [5.0, 5.0, 5.0, 5.0, 5.0, 5.0],
          "2": [0.0, 1.2, 2.5, 3.4, 4.1, 4.5],
        },
        branch_currents: {},
        converged: true,
      } as T;

    case "run_ac_sweep":
      return {
        frequencies: [10, 100, 1000, 10000, 100000],
        magnitude_db: { "2": [0.0, -0.04, -3.01, -20.0, -40.0] },
        phase_deg: { "2": [0.0, -5.7, -45.0, -84.3, -89.4] },
      } as T;

    case "run_sensitivity_analysis":
      return {
        sensitivities: { "R1": 0.5, "R2": -0.5 },
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
        message: "Web mock simulation completed successfully",
      } as T;

    case "open_circuit_file":
      return ["demo_circuit.astryd", JSON.stringify({ components: [], wires: [] })] as T;

    case "save_circuit_file":
    case "save_circuit_to_path":
    case "export_touchstone_file":
      return "mock_exported_file.txt" as T;

    case "start_interactive_transient":
    case "stop_interactive_transient":
    case "inject_live_mutation":
      return undefined as T;

    default:
      console.warn(`[Tauri Web Mock] Comando sin mock explícito '${cmd}', devolviendo objeto vacío.`);
      return {} as T;
  }
}
