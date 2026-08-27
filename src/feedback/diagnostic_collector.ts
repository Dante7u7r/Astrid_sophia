import type { CanvasOrchestrator } from "../canvas_orchestrator";
import type { CircuitDocumentController } from "../app/circuit_document_controller";
import type { ConsoleLogEntry } from "../ui/console_log_controller";
import type { AnalysisMode } from "../ui/simulation_controls";
import type { SimulationSettings } from "../ui/settings_modal";
import { exportToSpiceNetlist } from "../simulation/spice_netlist_exporter";
import packageMetadata from "../../package.json";

export interface DiagnosticEnvironment {
  readonly appVersion: string;
  readonly os: string;
  readonly userAgent: string;
  readonly screenResolution: string;
  readonly devicePixelRatio: number;
  readonly timestamp: string;
}

export interface DiagnosticInclusions {
  readonly includeCircuitFile?: boolean;
  readonly includeSpiceNetlist?: boolean;
  readonly includeScreenshot?: boolean;
  readonly includeLogs?: boolean;
  readonly includeEnvironment?: boolean;
}

export interface DiagnosticErrorDetails {
  readonly message: string;
  readonly stack?: string;
  readonly area?: string;
  readonly occurredAt?: string;
}

export interface DiagnosticExternalAttachment {
  readonly name: string;
  readonly mimeType: string;
  readonly sizeBytes: number;
  readonly dataUrl?: string;
  readonly textContent?: string;
}

export interface DiagnosticBundle {
  readonly format: "biaani-diagnostic-bundle";
  readonly schemaVersion: 1;
  readonly createdAt: string;
  readonly category: string;
  readonly userNote: string;
  readonly contact?: string;
  readonly environment?: DiagnosticEnvironment;
  readonly circuit?: {
    readonly componentCount: number;
    readonly wireCount: number;
    readonly rawFileJson: string;
  };
  readonly spiceNetlist?: string;
  readonly screenshotBase64?: string;
  readonly externalAttachment?: DiagnosticExternalAttachment;
  readonly recentLogs?: readonly ConsoleLogEntry[];
  readonly simulation?: {
    readonly activeMode: AnalysisMode;
    readonly settings: SimulationSettings;
    readonly isSimulating: boolean;
    readonly tabName?: string;
  };
  readonly errorDetails?: DiagnosticErrorDetails;
}

export interface DiagnosticCollectorDeps {
  readonly getOrchestrator: () => CanvasOrchestrator | null;
  readonly getCircuitDocumentController?: () => CircuitDocumentController | null;
  readonly getSimulationSettings: () => SimulationSettings;
  readonly getActiveAnalysisMode: () => AnalysisMode;
  readonly isSimulationActive: () => boolean;
  readonly getRecentLogs: () => readonly ConsoleLogEntry[];
  readonly getCanvasElement?: () => HTMLCanvasElement | null;
  readonly getActiveTabName?: () => string;
}

export function captureEnvironmentMetadata(): DiagnosticEnvironment {
  const platform = typeof navigator !== "undefined"
    ? (navigator.platform || navigator.userAgent || "Desktop")
    : "Node/Test";
  const userAgent = typeof navigator !== "undefined" ? navigator.userAgent : "Headless";
  const width = typeof window !== "undefined" ? window.innerWidth : 1200;
  const height = typeof window !== "undefined" ? window.innerHeight : 800;
  const dpr = typeof window !== "undefined" ? (window.devicePixelRatio || 1) : 1;

  return {
    appVersion: packageMetadata.version || "0.1.0",
    os: platform.slice(0, 64),
    userAgent: userAgent.slice(0, 256),
    screenResolution: `${width}x${height}`,
    devicePixelRatio: dpr,
    timestamp: new Date().toISOString(),
  };
}

export function captureCanvasScreenshot(canvas: HTMLCanvasElement | null): string | undefined {
  if (!canvas || typeof canvas.toDataURL !== "function") return undefined;
  try {
    return canvas.toDataURL("image/png");
  } catch {
    return undefined;
  }
}

export function collectDiagnosticBundle(
  deps: DiagnosticCollectorDeps,
  options: {
    category?: string;
    userNote?: string;
    contact?: string;
    inclusions?: DiagnosticInclusions;
    errorDetails?: DiagnosticErrorDetails;
    externalAttachment?: DiagnosticExternalAttachment;
  } = {},
): DiagnosticBundle {
  const inclusions: DiagnosticInclusions = {
    includeCircuitFile: options.inclusions?.includeCircuitFile !== false,
    includeSpiceNetlist: options.inclusions?.includeSpiceNetlist !== false,
    includeScreenshot: options.inclusions?.includeScreenshot !== false,
    includeLogs: options.inclusions?.includeLogs !== false,
    includeEnvironment: options.inclusions?.includeEnvironment !== false,
  };

  const orchestrator = deps.getOrchestrator();
  const componentCount = orchestrator ? orchestrator.components.length : 0;
  const wireCount = orchestrator ? orchestrator.wires.length : 0;

  let rawFileJson = "{}";
  if (inclusions.includeCircuitFile) {
    const docController = deps.getCircuitDocumentController?.();
    if (docController) {
      rawFileJson = docController.serializeCircuit();
    } else if (orchestrator) {
      rawFileJson = JSON.stringify({
        components: orchestrator.components,
        wires: orchestrator.wires,
      });
    }
  }

  let spiceNetlist: string | undefined;
  if (inclusions.includeSpiceNetlist && orchestrator) {
    try {
      spiceNetlist = exportToSpiceNetlist(orchestrator.components, orchestrator.wires, {
        title: deps.getActiveTabName?.() || "Biaani Schematic Circuit",
      });
    } catch (err) {
      spiceNetlist = `* Error al extraer netlist: ${String(err)}`;
    }
  }

  const canvas = deps.getCanvasElement?.() ?? (typeof document !== "undefined" ? document.querySelector<HTMLCanvasElement>("#circuit-canvas") : null);
  const screenshotBase64 = inclusions.includeScreenshot ? captureCanvasScreenshot(canvas) : undefined;

  const logs = inclusions.includeLogs ? deps.getRecentLogs() : undefined;
  const environment = inclusions.includeEnvironment ? captureEnvironmentMetadata() : undefined;

  return {
    format: "biaani-diagnostic-bundle",
    schemaVersion: 1,
    createdAt: new Date().toISOString(),
    category: options.category ?? "general",
    userNote: options.userNote ?? "",
    contact: options.contact || undefined,
    environment,
    circuit: inclusions.includeCircuitFile
      ? {
          componentCount,
          wireCount,
          rawFileJson,
        }
      : undefined,
    spiceNetlist,
    screenshotBase64,
    externalAttachment: options.externalAttachment,
    recentLogs: logs,
    simulation: {
      activeMode: deps.getActiveAnalysisMode(),
      settings: deps.getSimulationSettings(),
      isSimulating: deps.isSimulationActive(),
      tabName: deps.getActiveTabName?.(),
    },
    errorDetails: options.errorDetails,
  };
}
