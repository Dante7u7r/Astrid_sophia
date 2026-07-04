export const VISUAL_AUDIT_STAGES = ["static", "oscilloscope", "canvas", "tabs"] as const;
export const VISUAL_AUDIT_STEPS = [
  "full",
  "skip-render",
  "skip-canvas-render",
  "skip-osc-render",
  "orchestrator",
  "resize",
  "layout",
  "input",
  "drop",
] as const;

export type VisualAuditStage = (typeof VISUAL_AUDIT_STAGES)[number];
export type VisualAuditStep = (typeof VISUAL_AUDIT_STEPS)[number];

export interface VisualAuditRuntime {
  readonly isDevelopment: boolean;
  readonly mode: string;
}

export interface VisualAuditConfig {
  readonly enabled: boolean;
  readonly stage: VisualAuditStage;
  readonly step: VisualAuditStep;
  isStep(step: VisualAuditStep): boolean;
}

const DEFAULT_STAGE: VisualAuditStage = "static";
const DEFAULT_STEP: VisualAuditStep = "full";

function isOneOf<T extends string>(value: string | null, options: readonly T[]): value is T {
  return value !== null && options.some((option) => option === value);
}

export function resolveVisualAuditConfig(
  search: string,
  runtime: VisualAuditRuntime,
): VisualAuditConfig {
  const params = new URLSearchParams(search);
  const enabledByBuild = runtime.isDevelopment || runtime.mode === "audit";
  const enabled = enabledByBuild && params.get("audit") === "1";
  const requestedStage = params.get("auditStage");
  const requestedStep = params.get("auditStep");
  const stage = isOneOf(requestedStage, VISUAL_AUDIT_STAGES) ? requestedStage : DEFAULT_STAGE;
  const step = isOneOf(requestedStep, VISUAL_AUDIT_STEPS) ? requestedStep : DEFAULT_STEP;

  return {
    enabled,
    stage,
    step,
    isStep: (candidate) => enabled && step === candidate,
  };
}
