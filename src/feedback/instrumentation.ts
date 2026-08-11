import type { ERCResult } from "../simulation/simulation_dispatcher";
import { classifySimulationError } from "../simulation/simulation-error";
import type { CircuitNetlist } from "../simulation/netlist_extractor";
import type { FeedbackBus } from "./feedback_bus";
import type {
  ExportCreatedPayloadV1,
  PerformanceSampledPayloadV1,
  SimulationCompletedPayloadV1,
  SimulationFailedPayloadV1,
  SimulationStartedPayloadV1,
  UiErrorObservedPayloadV1,
} from "./contracts.generated";

export type FeedbackAnalysis = SimulationStartedPayloadV1["analysis"];
export type FeedbackFailurePhase = SimulationFailedPayloadV1["phase"];
export type FeedbackUiArea = UiErrorObservedPayloadV1["area"];

export interface FeedbackRunHandle {
  readonly enabled: boolean;
  readonly runId: string;
  readonly workspaceId: string;
  readonly analysis: FeedbackAnalysis;
  readonly startedAt: number;
  terminal: boolean;
}

export interface InvokeObservationToken {
  readonly kind: "analysis" | "parser";
  readonly startedAt: number;
  readonly run?: FeedbackRunHandle;
}

let activeBus: FeedbackBus | null = null;
let fallbackId = 0;
const sessionSalt = createId();
const recentUiErrors = new Map<string, number>();
const UI_ERROR_DEDUPLICATION_MS = 10_000;

function instrumentationEnabled(): boolean {
  return activeBus !== null && activeBus.getConsentMode() !== "disabled";
}

function createId(): string {
  if (typeof globalThis.crypto?.randomUUID === "function") {
    return globalThis.crypto.randomUUID();
  }
  fallbackId += 1;
  return `feedback-${Date.now()}-${fallbackId}`;
}

function elapsed(startedAt: number): number {
  return Math.max(0, Date.now() - startedAt);
}

function finite(value: unknown, fallback = 0): number {
  return typeof value === "number" && Number.isFinite(value) ? value : fallback;
}

function clampInteger(value: unknown, minimum = 0, maximum = 1_000_000_000): number {
  return Math.min(maximum, Math.max(minimum, Math.round(finite(value))));
}

function normalizeForFingerprint(value: unknown): string {
  if (value === null || value === undefined) return String(value);
  if (typeof value === "number") return Number.isFinite(value) ? value.toPrecision(12) : "non-finite";
  if (typeof value === "boolean" || typeof value === "string") return String(value);
  if (Array.isArray(value)) return `[${value.map(normalizeForFingerprint).join(",")}]`;
  if (typeof value === "object") {
    return `{${Object.entries(value as Record<string, unknown>)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, item]) => `${key}:${normalizeForFingerprint(item)}`)
      .join(",")}}`;
  }
  return typeof value;
}

export function privacyFingerprint(value: unknown): string {
  const input = `${sessionSalt}|${normalizeForFingerprint(value)}`;
  let hash = 0x811c9dc5;
  for (let index = 0; index < input.length; index += 1) {
    hash ^= input.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193);
  }
  return `fnv1a32:${(hash >>> 0).toString(16).padStart(8, "0")}`;
}

function nodeCount(netlist: CircuitNetlist | undefined): number {
  if (!netlist) return 0;
  return new Set(netlist.components.flatMap((component) => component.pins)).size;
}

function componentHistogram(netlist: CircuitNetlist): Record<string, number> {
  const histogram = new Map<string, number>();
  for (const component of netlist.components) {
    const key = component.type.slice(0, 64);
    histogram.set(key, (histogram.get(key) ?? 0) + 1);
  }
  return Object.fromEntries([...histogram.entries()].sort(([left], [right]) => left.localeCompare(right)));
}

function errorCode(error: unknown): string {
  const classified = classifySimulationError(error);
  switch (classified.kind) {
    case "singular-matrix": return "SIM_SINGULAR_MATRIX";
    case "max-iterations-exceeded": return "SIM_MAX_ITERATIONS";
    case "convergence-failure": return "SIM_CONVERGENCE_FAILURE";
    case "invalid-circuit": return "SIM_INVALID_CIRCUIT";
    case "unknown": return "SIM_UNKNOWN";
  }
}

function ercCode(message: string): string {
  const normalized = message.toLocaleLowerCase("es");
  if (/tierra|gnd/.test(normalized)) return "ERC_MISSING_GROUND";
  if (/cortocircuito franco/.test(normalized)) return "ERC_SHORTED_VSOURCE";
  if (/fuentes en paralelo/.test(normalized)) return "ERC_PARALLEL_VSOURCE";
  if (/mcu temporal/.test(normalized)) return "ERC_TEMPORAL_MCU";
  if (/pin flotante/.test(normalized)) return "ERC_FLOATING_PIN";
  if (/hu[eé]rfano/.test(normalized)) return "ERC_ORPHAN_COMPONENT";
  if (/subcircuito aislado/.test(normalized)) return "ERC_ISOLATED_SUBCIRCUIT";
  if (/lazo.*fuente|fuente.*lazo/.test(normalized)) return "ERC_IDEAL_SOURCE_LOOP";
  return "ERC_UNKNOWN";
}

function runOptions(run: FeedbackRunHandle): { runId: string; workspaceId: string } {
  return { runId: run.runId, workspaceId: run.workspaceId };
}

export function configureFeedbackInstrumentation(bus: FeedbackBus | null): void {
  activeBus = bus;
}

export function beginFeedbackRun(input: {
  analysis: FeedbackAnalysis;
  workspaceId?: string | null;
  netlist?: CircuitNetlist;
  settings?: unknown;
  requestedPointCount?: number;
}): FeedbackRunHandle {
  const enabled = instrumentationEnabled();
  if (!enabled) {
    return {
      enabled: false,
      runId: "",
      workspaceId: "",
      analysis: input.analysis,
      startedAt: Date.now(),
      terminal: false,
    };
  }
  const run: FeedbackRunHandle = {
    enabled: true,
    runId: createId(),
    workspaceId: privacyFingerprint(input.workspaceId ?? "workspace-unknown"),
    analysis: input.analysis,
    startedAt: Date.now(),
    terminal: false,
  };
  const payload: SimulationStartedPayloadV1 = {
    analysis: input.analysis,
    settingsFingerprint: privacyFingerprint(input.settings ?? {}),
    componentCount: input.netlist?.components.length ?? 0,
    nodeCount: nodeCount(input.netlist),
    ...(input.requestedPointCount === undefined
      ? {}
      : { requestedPointCount: clampInteger(input.requestedPointCount) }),
  };
  activeBus?.emit("simulation.started", payload, runOptions(run));
  return run;
}

export function recordCircuitSummary(
  run: FeedbackRunHandle,
  netlist: CircuitNetlist,
  wireCount = netlist.wires.length,
): void {
  if (!run.enabled) return;
  const histogram = componentHistogram(netlist);
  const topology = netlist.components.map((component) => ({
    type: component.type,
    pins: component.pins.length,
  })).sort((left, right) => left.type.localeCompare(right.type) || left.pins - right.pins);
  activeBus?.emit("circuit.summary_created", {
    topologyFingerprint: privacyFingerprint({ topology, nodes: nodeCount(netlist), wires: wireCount }),
    componentCount: netlist.components.length,
    nodeCount: nodeCount(netlist),
    wireCount: clampInteger(wireCount),
    nonlinearDeviceCount: netlist.components.filter((component) =>
      /diode|bjt|mos|jfet|opamp|switch/i.test(component.type)
    ).length,
    reactiveDeviceCount: netlist.components.filter((component) =>
      /capacitor|inductor|transmission/i.test(component.type)
    ).length,
    componentHistogram: histogram,
    containsFirmware: netlist.components.some((component) => Boolean(component.firmware?.length)),
  }, runOptions(run));
}

export function recordErc(run: FeedbackRunHandle | undefined, result: ERCResult, durationMs: number): void {
  if (run ? !run.enabled : !instrumentationEnabled()) return;
  const counts: Record<string, number> = {};
  for (const message of [...result.errors, ...result.warnings]) {
    const code = ercCode(message);
    counts[code] = (counts[code] ?? 0) + 1;
  }
  activeBus?.emit("erc.completed", {
    passed: result.passed,
    errorCount: result.errors.length,
    warningCount: result.warnings.length,
    codeCounts: counts,
    durationMs: clampInteger(durationMs, 0, 600_000),
  }, run ? runOptions(run) : {});
}

export function completeFeedbackRun(
  run: FeedbackRunHandle,
  details: Partial<Omit<SimulationCompletedPayloadV1, "analysis" | "durationMs">> = {},
): void {
  if (run.terminal) return;
  run.terminal = true;
  if (!run.enabled) return;
  const converged = details.converged ?? true;
  activeBus?.emit("simulation.completed", {
    analysis: run.analysis,
    durationMs: elapsed(run.startedAt),
    pointCount: clampInteger(details.pointCount),
    converged,
    ...(details.finalResidual === undefined ? {} : { finalResidual: Math.abs(finite(details.finalResidual)) }),
  }, runOptions(run));
}

export function failFeedbackRun(
  run: FeedbackRunHandle,
  error: unknown,
  phase: FeedbackFailurePhase = "unknown",
  explicitCode?: string,
): void {
  if (run.terminal) return;
  run.terminal = true;
  if (!run.enabled) return;
  activeBus?.emit("simulation.failed", {
    analysis: run.analysis,
    phase,
    errorCode: (explicitCode ?? errorCode(error)).slice(0, 96),
    messageFingerprint: privacyFingerprint(error instanceof Error ? error.message : error),
    durationMs: elapsed(run.startedAt),
  }, runOptions(run));
}

export function cancelFeedbackRun(
  run: FeedbackRunHandle,
  reason: "user" | "replaced" | "shutdown" | "timeout",
): void {
  if (run.terminal) return;
  run.terminal = true;
  if (!run.enabled) return;
  activeBus?.emit("simulation.cancelled", {
    reason,
    durationMs: elapsed(run.startedAt),
  }, runOptions(run));
}

export function recordConvergence(run: FeedbackRunHandle, result: unknown): void {
  if (!run.enabled) return;
  const record = typeof result === "object" && result !== null
    ? result as Record<string, unknown>
    : {};
  activeBus?.emit("solver.convergence_summary", {
    analysis: run.analysis,
    method: String(record.method ?? record.solverMethod ?? "unspecified").slice(0, 64),
    iterations: clampInteger(record.iterations ?? record.iterationCount),
    acceptedSteps: clampInteger(record.acceptedSteps ?? record.accepted_steps),
    rejectedSteps: clampInteger(record.rejectedSteps ?? record.rejected_steps),
    ...(typeof (record.finalResidual ?? record.final_residual) === "number"
      ? { finalResidual: Math.abs(finite(record.finalResidual ?? record.final_residual)) }
      : {}),
    homotopyUsed: Boolean(record.homotopyUsed ?? record.homotopy_used),
  }, runOptions(run));
}

export function inferPointCount(result: unknown): number {
  if (Array.isArray(result)) return result.length;
  if (typeof result !== "object" || result === null) return 1;
  const record = result as Record<string, unknown>;
  for (const key of ["frequencies", "points", "samples", "results", "transient"]) {
    const value = record[key];
    if (Array.isArray(value)) return value.length;
  }
  return 1;
}

export function recordParserCompleted(
  success: boolean,
  componentCount: number,
  durationMs: number,
  error?: unknown,
): void {
  if (!instrumentationEnabled()) return;
  activeBus?.emit("parser.completed", {
    format: "spice",
    success,
    componentCount: clampInteger(componentCount, 0, 10_000),
    durationMs: clampInteger(durationMs, 0, 600_000),
    ...(error === undefined ? {} : { errorCode: "PARSER_SPICE_FAILED" }),
  });
}

export function recordUiError(area: FeedbackUiArea, code: string, error: unknown): void {
  if (!instrumentationEnabled()) return;
  const messageFingerprint = privacyFingerprint(error instanceof Error ? error.message : error);
  const deduplicationKey = `${area}|${code}|${messageFingerprint}`;
  const now = Date.now();
  const previous = recentUiErrors.get(deduplicationKey);
  if (previous !== undefined && now - previous < UI_ERROR_DEDUPLICATION_MS) return;
  recentUiErrors.set(deduplicationKey, now);
  if (recentUiErrors.size > 256) {
    for (const [key, occurredAt] of recentUiErrors) {
      if (now - occurredAt >= UI_ERROR_DEDUPLICATION_MS) recentUiErrors.delete(key);
    }
  }
  activeBus?.emit("ui.error_observed", {
    area,
    errorCode: code.slice(0, 96),
    messageFingerprint,
  });
}

export function recordExport(
  exportKind: ExportCreatedPayloadV1["exportKind"],
  itemCount: number,
  redactionCount = 0,
): void {
  if (!instrumentationEnabled()) return;
  activeBus?.emit("export.created", {
    exportKind,
    itemCount: clampInteger(itemCount),
    redactionCount: clampInteger(redactionCount),
  });
}

export function recordPerformance(sample: PerformanceSampledPayloadV1): void {
  if (!instrumentationEnabled()) return;
  activeBus?.emit("performance.sampled", {
    fps: Math.max(0, finite(sample.fps)),
    cpuPercent: Math.min(100, Math.max(0, finite(sample.cpuPercent))),
    ramBytes: clampInteger(sample.ramBytes),
    canvasFrames: clampInteger(sample.canvasFrames),
    oscilloscopeFrames: clampInteger(sample.oscilloscopeFrames),
    skippedDmmUpdates: clampInteger(sample.skippedDmmUpdates),
  });
}

export function recordRecommendationShown(
  recommendation: {
    recommendationId: string;
    ruleId: string;
    safetyClass: "informational" | "reversible" | "scientific-review-required";
    confidence: number;
    settingsPatch?: unknown;
  },
  run?: FeedbackRunHandle,
): void {
  if (!instrumentationEnabled()) return;
  activeBus?.emit("recommendation.shown", {
    recommendationId: recommendation.recommendationId.slice(0, 128),
    ruleId: recommendation.ruleId.slice(0, 128),
    safetyClass: recommendation.safetyClass,
    confidence: Math.min(1, Math.max(0, finite(recommendation.confidence))),
    ...(recommendation.settingsPatch
      ? { proposedProfile: privacyFingerprint(recommendation.settingsPatch) }
      : {}),
  }, run ? runOptions(run) : {});
}

export function recordRecommendationOutcome(
  recommendationId: string,
  decision: "accepted" | "rejected" | "dismissed",
  applied: boolean,
): void {
  if (!instrumentationEnabled()) return;
  activeBus?.emit("recommendation.outcome", {
    recommendationId: recommendationId.slice(0, 128),
    decision,
    applied,
  });
}

const NATIVE_ANALYSES: Readonly<Record<string, FeedbackAnalysis>> = {
  run_dc_sweep: "DC_SWEEP",
  run_transient_simulation: "TRAN",
  run_monte_carlo_transient: "TRAN_MC",
  run_fft_analysis: "FFT",
  run_imd_analysis: "IMD",
  run_noise_sweep: "NOISE",
  solve_dc_thermal: "THERMAL",
};

export function observeInvokeBefore(
  command: string,
  args?: Record<string, unknown>,
): InvokeObservationToken | undefined {
  if (!instrumentationEnabled()) return undefined;
  if (command === "parse_spice_netlist") {
    return { kind: "parser", startedAt: Date.now() };
  }
  const analysis = NATIVE_ANALYSES[command];
  if (!analysis) return undefined;
  const netlist = args?.netlist as CircuitNetlist | undefined;
  const run = beginFeedbackRun({ analysis, netlist, settings: args });
  if (netlist) recordCircuitSummary(run, netlist);
  return { kind: "analysis", startedAt: Date.now(), run };
}

export function observeInvokeAfter(
  token: InvokeObservationToken | undefined,
  result: unknown,
  error?: unknown,
): void {
  if (!token) return;
  if (token.kind === "parser") {
    const record = typeof result === "object" && result !== null ? result as Record<string, unknown> : {};
    const components = Array.isArray(record.components) ? record.components.length : 0;
    recordParserCompleted(error === undefined, components, elapsed(token.startedAt), error);
    if (error !== undefined) recordUiError("parser", "PARSER_SPICE_FAILED", error);
    return;
  }
  const run = token.run;
  if (!run) return;
  if (error !== undefined) {
    failFeedbackRun(run, error, "ipc");
    return;
  }
  recordConvergence(run, result);
  completeFeedbackRun(run, { pointCount: inferPointCount(result), converged: true });
}
