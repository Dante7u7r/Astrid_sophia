import type { CircuitNetlist } from "../simulation/netlist_extractor";
import type {
  PortDefinition,
  SParameterResult,
  SParameterSettings,
} from "../simulation";
import { formatTouchstone } from "../simulation/touchstone";
import type { OscilloscopePanel } from "../ui/oscilloscope_panel";

export interface SParameterPortSelection {
  nodeId: string;
  z0: number;
}

export interface SParameterExportDependencies {
  getOscilloscopePanel(): OscilloscopePanel | null;
  getPorts(): readonly SParameterPortSelection[];
  clearProbePlacementMode(): void;
  resetPerformanceCaches(): void;
  setIpcStatus(text: string, color: string): void;
  addLog(text: string, type?: "system" | "send" | "receive" | "error"): void;
  invokeTauri<T>(cmd: string, args?: unknown): Promise<T>;
}

export interface SParameterSweepSettings {
  fStart: number;
  fEnd: number;
  pointsPerDecade: number;
}

export class SParameterExportController {
  constructor(
    private readonly dependencies: SParameterExportDependencies,
    private readonly sweepSettings: SParameterSweepSettings,
  ) {}

  async run(netlist: CircuitNetlist): Promise<void> {
    const oscilloscopePanel = this.dependencies.getOscilloscopePanel();
    if (!oscilloscopePanel) return;

    const selectedPorts = this.dependencies.getPorts();
    if (selectedPorts.length === 0) {
      this.dependencies.addLog(
        "Modo Seleccion de Puertos RF: Haz clic en los nodos del circuito para designarlos como puertos.",
        "system",
      );
      this.dependencies.clearProbePlacementMode();
      this.dependencies.addLog(
        "Selecciona uno o mas terminales y vuelve a pulsar Simular. GND se usa como referencia.",
        "system",
      );
      return;
    }

    const ports: PortDefinition[] = selectedPorts.map((port, index) => ({
      name: `Puerto ${index + 1}`,
      positiveNode: port.nodeId,
      negativeNode: "0",
      referenceImpedance: port.z0,
    }));

    this.dependencies.addLog(
      `Iniciando extraccion de parametros S para ${ports.length} puertos de RF...`,
      "send",
    );

    const settings: SParameterSettings = {
      ports,
      fStart: this.sweepSettings.fStart,
      fEnd: this.sweepSettings.fEnd,
      pointsPerDecade: this.sweepSettings.pointsPerDecade,
      outputFormat: "ma",
    };

    try {
      const result = await this.dependencies.invokeTauri<SParameterResult>(
        "extract_sparameter",
        { netlist, settings },
      );

      if (!result.converged) {
        this.dependencies.addLog(`Error en extraccion S: ${result.error ?? "desconocido"}`, "error");
        return;
      }

      oscilloscopePanel.sparResult = result;
      oscilloscopePanel.activeAnalysisMode = "SPAR";
      this.dependencies.resetPerformanceCaches();
      oscilloscopePanel.start();

      const touchstoneContent = formatTouchstone(result);
      if (!touchstoneContent) {
        this.dependencies.addLog("Error al formatear el archivo Touchstone.", "error");
        return;
      }

      this.dependencies.addLog(
        "Matriz S extraida correctamente. Abriendo dialogo de exportacion...",
        "receive",
      );

      const nPorts = ports.length;
      try {
        const savedPath = await this.dependencies.invokeTauri<string>(
          "export_touchstone_file",
          { content: touchstoneContent, nPorts },
        );
        this.dependencies.addLog(
          `Archivo Touchstone .s${nPorts}p exportado exitosamente: ${savedPath}`,
          "receive",
        );
      } catch (dialogErr) {
        if (typeof dialogErr === "string" && dialogErr.includes("cancelada")) {
          this.dependencies.addLog("Exportacion cancelada por el usuario.", "system");
        } else {
          this.dependencies.addLog(`Error al guardar archivo Touchstone: ${dialogErr}`, "error");
        }
      }

      this.dependencies.setIpcStatus("S-Parameter Solver Activo", "var(--accent-cyan)");
    } catch (error) {
      const errorMsg = error instanceof Error ? error.message : String(error);
      this.dependencies.addLog(`Error en extraccion de parametros S: ${errorMsg}`, "error");
    }
  }
}

export function createSParameterExportController(
  dependencies: SParameterExportDependencies,
  sweepSettings: SParameterSweepSettings,
): SParameterExportController {
  return new SParameterExportController(dependencies, sweepSettings);
}
