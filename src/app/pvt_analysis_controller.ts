import type { CircuitNetlist } from "../simulation/netlist_extractor";
import {
  PVT_PROFILE_AUTOMOTIVE,
  PVT_PROFILE_COMMERCIAL,
  PVT_PROFILE_INDUSTRIAL,
  type PvtConfig,
} from "../simulation";
import type {
  OscilloscopePanel,
  PvtRunResult,
  PvtTrace,
} from "../ui/oscilloscope_panel";
import type { SimulationSettings } from "../ui/settings_modal";

const PVT_LABELS: Record<string, string> = {
  tt: "TT (Nominal)",
  ff: "FF (Fast-Fast)",
  ss: "SS (Slow-Slow)",
  fs: "FS (Fast-Slow)",
  sf: "SF (Slow-Fast)",
};

const PVT_COLORS: string[] = ["#66fcf1", "#a855f7", "#f97316", "#22c55e", "#ef4444"];

export interface PvtAnalysisDependencies {
  getOscilloscopePanel(): OscilloscopePanel | null;
  getSimulationSettings(): SimulationSettings;
  getSimulationBar(): Element | null;
  setSimulationRunning(running: boolean): void;
  resetPerformanceCaches(): void;
  setIpcStatus(text: string, color: string): void;
  addLog(text: string, type?: "system" | "send" | "receive" | "error"): void;
  invokeTauri<T>(cmd: string, args?: unknown): Promise<T>;
  documentRef?: Document;
}

export class PvtAnalysisController {
  constructor(private readonly dependencies: PvtAnalysisDependencies) {}

  run(netlist: CircuitNetlist): void {
    const oscilloscopePanel = this.dependencies.getOscilloscopePanel();
    if (!oscilloscopePanel) return;

    this.dependencies.addLog(
      "Selecciona un perfil PVT predefinido para el analisis matricial:",
      "system",
    );

    const container = this.dependencies.getSimulationBar();
    if (!container) return;

    this.getDocument().querySelectorAll(".pvt-profile-btn").forEach((element) => element.remove());

    const profiles: { label: string; configs: readonly PvtConfig[] }[] = [
      { label: "Comercial (0-70 C)", configs: PVT_PROFILE_COMMERCIAL },
      { label: "Industrial (-40-85 C)", configs: PVT_PROFILE_INDUSTRIAL },
      { label: "Automotriz (-40-125 C)", configs: PVT_PROFILE_AUTOMOTIVE },
    ];

    for (const profile of profiles) {
      const button = this.getDocument().createElement("button");
      button.className = "btn-ctrl pvt-profile-btn";
      button.type = "button";
      button.textContent = profile.label;
      button.addEventListener("click", async () => {
        const profileButtons = Array.from(
          this.getDocument().querySelectorAll<HTMLButtonElement>(".pvt-profile-btn"),
        );
        profileButtons.forEach((profileButton) => {
          profileButton.classList.remove("active");
          profileButton.disabled = true;
        });
        button.classList.add("active");
        this.dependencies.setSimulationRunning(true);
        try {
          await this.executeMatrix(netlist, [...profile.configs]);
        } finally {
          profileButtons.forEach((profileButton) => {
            profileButton.disabled = false;
          });
          this.dependencies.setSimulationRunning(false);
        }
      });

      const separator = container.querySelector('div[style*="width: 1px"]');
      if (separator) {
        container.insertBefore(button, separator);
      } else {
        container.appendChild(button);
      }
    }
  }

  async executeMatrix(netlist: CircuitNetlist, pvtConfigs: PvtConfig[]): Promise<void> {
    const oscilloscopePanel = this.dependencies.getOscilloscopePanel();
    if (!oscilloscopePanel) return;

    this.dependencies.addLog("Iniciando analisis matricial PVT paralelo en Rust...", "send");

    const monitoredNodes = [
      oscilloscopePanel.ch1ProbeNode,
      oscilloscopePanel.ch2ProbeNode,
      oscilloscopePanel.ch3ProbeNode,
      oscilloscopePanel.ch4ProbeNode,
    ].filter((node): node is string => Boolean(node));

    const pvtDuration = 0.05;
    const pvtMaxTimeSteps = 2_000;
    const simulationSettings = this.dependencies.getSimulationSettings();
    const transientSettings = {
      dt: Math.max(simulationSettings.dt, pvtDuration / pvtMaxTimeSteps),
      tMax: pvtDuration,
      fixedStep: true,
    };

    try {
      const results = await this.dependencies.invokeTauri<PvtRunResult[]>(
        "run_pvt_matrix_analysis",
        {
          netlist,
          transientSettings,
          pvtConfigs,
          monitoredNodes,
        },
      );

      const traces: PvtTrace[] = results.map((result, index) => ({
        config: result.config,
        results: result.transient,
        visible: true,
        color: PVT_COLORS[index % PVT_COLORS.length],
      }));
      oscilloscopePanel.pvtTraces = traces;
      oscilloscopePanel.pvtMode = true;
      oscilloscopePanel.transientResults = [];
      oscilloscopePanel.sweepTime = 0.0;
      oscilloscopePanel.activeAnalysisMode = "PVT";
      this.dependencies.resetPerformanceCaches();
      oscilloscopePanel.start();

      this.dependencies.addLog("----------------------------------------------------------------", "system");
      this.dependencies.addLog(
        "=== RESULTADOS DEL ANALISIS PVT (PROCESS-VOLTAGE-TEMPERATURE) ===",
        "system",
      );
      for (const result of results) {
        const label = PVT_LABELS[result.config.corner] ?? result.config.corner.toUpperCase();
        const convergence = result.converged ? "OK" : "FALLO";
        const status = result.converged ? "Convergio" : `Fallo: ${result.error ?? "desconocido"}`;
        this.dependencies.addLog(
          `${convergence} ${label} | T = ${result.config.temperatureC} C | V = ${(result.config.voltageScaling * 100).toFixed(0)}% | ${status}`,
          "receive",
        );
      }
      this.dependencies.addLog("----------------------------------------------------------------", "system");
      this.dependencies.setIpcStatus("PVT Matrix Solver Activo", "var(--accent-cyan)");
    } catch (error) {
      const errorMsg = error instanceof Error ? error.message : String(error);
      this.dependencies.addLog(`Error en analisis PVT: ${errorMsg}`, "error");
    }
  }

  private getDocument(): Document {
    return this.dependencies.documentRef ?? document;
  }
}

export function createPvtAnalysisController(
  dependencies: PvtAnalysisDependencies,
): PvtAnalysisController {
  return new PvtAnalysisController(dependencies);
}
