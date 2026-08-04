import type { FeedbackEventV1 } from "../feedback/contracts.generated";

export interface ShadowExample {
  readonly recommendationId: string;
  readonly ruleId: string;
  readonly analysis: string;
  readonly componentBucket: "small" | "medium" | "large";
  readonly nonlinearBucket: "none" | "some" | "many";
  readonly accepted: boolean;
  readonly improved: boolean | null;
  readonly occurredAtUnixMs: number;
  readonly sessionId: string;
}

export interface ShadowRuleEstimate {
  readonly ruleId: string;
  readonly observations: number;
  readonly accepted: number;
  readonly posteriorMean: number;
  readonly lower95: number;
  readonly upper95: number;
}

export interface ShadowModel {
  readonly format: "astryd-shadow-rule-model";
  readonly version: 1;
  readonly trainedAtUnixMs: number;
  readonly trainingExamples: number;
  readonly holdoutExamples: number;
  readonly trainingSessionCount: number;
  readonly holdoutSessionCount: number;
  readonly trainingEndUnixMs: number | null;
  readonly holdoutStartUnixMs: number | null;
  readonly usefulExecutionCount: number;
  readonly sessionCount: number;
  readonly ruleEstimates: readonly ShadowRuleEstimate[];
  readonly holdoutBrierScore: number | null;
  readonly fixedBaselineBrierScore: number | null;
  readonly brierImprovement: number | null;
  readonly brierImprovementLower95: number | null;
  readonly brierImprovementUpper95: number | null;
  readonly promoted: false;
}

export type ShadowTrainingResult =
  | {
      readonly status: "blocked";
      readonly usefulExecutionCount: number;
      readonly requiredExecutionCount: 500;
      readonly sessionCount: number;
      readonly requiredSessionCount: 10;
      readonly reason: string;
    }
  | { readonly status: "shadow"; readonly model: ShadowModel };

export interface ShadowDatasetDescriptor {
  readonly format: "astryd-shadow-dataset";
  readonly version: 1;
  readonly createdAtUnixMs: number;
  readonly eventCount: number;
  readonly recommendationExampleCount: number;
  readonly usefulExecutionCount: number;
  readonly sessionCount: number;
  readonly firstExampleUnixMs: number | null;
  readonly lastExampleUnixMs: number | null;
  readonly contentSha256: string;
}

export interface ShadowRegistryArtifact {
  readonly format: "astryd-shadow-registry-artifact";
  readonly version: 1;
  readonly artifactId: string;
  readonly dataset: ShadowDatasetDescriptor;
  readonly model: ShadowModel;
  readonly integritySha256: string;
  readonly signatureStatus: "unsigned";
}

export interface ShadowModelRegistry {
  readonly format: "astryd-shadow-model-registry";
  readonly version: 1;
  readonly activeArtifactId: string | null;
  readonly artifacts: readonly ShadowRegistryArtifact[];
}

export interface ShadowPromotionEvidence {
  readonly scientificValidationPassed: boolean;
  readonly artifactSignatureVerified: boolean;
  readonly prospectiveFieldPilotCompleted: boolean;
}

export interface ShadowPromotionDecision {
  readonly eligible: boolean;
  readonly reasons: readonly string[];
}

function bucketComponents(value: number): ShadowExample["componentBucket"] {
  if (value < 50) return "small";
  if (value < 250) return "medium";
  return "large";
}

async function sha256Hex(value: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value));
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

function bucketNonlinear(value: number): ShadowExample["nonlinearBucket"] {
  if (value === 0) return "none";
  if (value < 10) return "some";
  return "many";
}

export function extractShadowExamples(events: readonly FeedbackEventV1[]): {
  readonly examples: readonly ShadowExample[];
  readonly usefulExecutionCount: number;
  readonly sessionCount: number;
} {
  const runAnalysis = new Map<string, string>();
  const runCircuit = new Map<string, { componentCount: number; nonlinearDeviceCount: number }>();
  const recommendation = new Map<string, {
    ruleId: string;
    runId?: string;
    occurredAtUnixMs: number;
    sessionId: string;
  }>();
  const completedRuns = new Set<string>();
  const sessions = new Set<string>();

  for (const event of [...events].sort((left, right) => left.occurredAtUnixMs - right.occurredAtUnixMs)) {
    sessions.add(event.sessionId);
    if (event.kind === "simulation.started" && event.runId) {
      runAnalysis.set(event.runId, event.payload.analysis);
    } else if (event.kind === "circuit.summary_created" && event.runId) {
      runCircuit.set(event.runId, {
        componentCount: event.payload.componentCount,
        nonlinearDeviceCount: event.payload.nonlinearDeviceCount,
      });
    } else if (event.kind === "simulation.completed" && event.runId && event.payload.converged) {
      completedRuns.add(event.runId);
    } else if (event.kind === "recommendation.shown") {
      recommendation.set(event.payload.recommendationId, {
        ruleId: event.payload.ruleId,
        runId: event.runId,
        occurredAtUnixMs: event.occurredAtUnixMs,
        sessionId: event.sessionId,
      });
    }
  }

  const examples: ShadowExample[] = [];
  for (const event of events) {
    if (event.kind !== "recommendation.outcome") continue;
    const shown = recommendation.get(event.payload.recommendationId);
    if (!shown) continue;
    const circuit = shown.runId ? runCircuit.get(shown.runId) : undefined;
    examples.push({
      recommendationId: event.payload.recommendationId,
      ruleId: shown.ruleId,
      analysis: shown.runId ? runAnalysis.get(shown.runId) ?? "unknown" : "unknown",
      componentBucket: bucketComponents(circuit?.componentCount ?? 0),
      nonlinearBucket: bucketNonlinear(circuit?.nonlinearDeviceCount ?? 0),
      accepted: event.payload.decision === "accepted" && event.payload.applied,
      improved: event.payload.improved ?? null,
      occurredAtUnixMs: event.occurredAtUnixMs,
      sessionId: shown.sessionId,
    });
  }
  return {
    examples: examples.sort((left, right) => left.occurredAtUnixMs - right.occurredAtUnixMs),
    usefulExecutionCount: completedRuns.size,
    sessionCount: sessions.size,
  };
}

function wilsonInterval(successes: number, observations: number): { lower: number; upper: number } {
  if (observations === 0) return { lower: 0, upper: 1 };
  const z = 1.96;
  const proportion = successes / observations;
  const denominator = 1 + (z * z) / observations;
  const center = (proportion + (z * z) / (2 * observations)) / denominator;
  const margin = (
    z * Math.sqrt((proportion * (1 - proportion) + (z * z) / (4 * observations)) / observations)
  ) / denominator;
  return { lower: Math.max(0, center - margin), upper: Math.min(1, center + margin) };
}

function brierScore(
  examples: readonly ShadowExample[],
  probability: (example: ShadowExample) => number,
): number | null {
  if (examples.length === 0) return null;
  return examples.reduce((sum, example) => {
    const error = probability(example) - (example.accepted ? 1 : 0);
    return sum + error * error;
  }, 0) / examples.length;
}

function brierImprovementInterval(
  examples: readonly ShadowExample[],
  probability: (example: ShadowExample) => number,
): { mean: number; lower95: number; upper95: number } | null {
  if (examples.length < 2) return null;
  const improvements = examples.map((example) => {
    const outcome = example.accepted ? 1 : 0;
    const modelError = (probability(example) - outcome) ** 2;
    const baselineError = (0.5 - outcome) ** 2;
    return baselineError - modelError;
  });
  const mean = improvements.reduce((sum, value) => sum + value, 0) / improvements.length;
  const variance = improvements.reduce((sum, value) => sum + (value - mean) ** 2, 0)
    / (improvements.length - 1);
  const margin = 1.96 * Math.sqrt(variance / improvements.length);
  return { mean, lower95: mean - margin, upper95: mean + margin };
}

export function trainShadowModel(
  events: readonly FeedbackEventV1[],
  trainedAtUnixMs = Date.now(),
): ShadowTrainingResult {
  const dataset = extractShadowExamples(events);
  if (dataset.usefulExecutionCount < 500) {
    return {
      status: "blocked",
      usefulExecutionCount: dataset.usefulExecutionCount,
      requiredExecutionCount: 500,
      sessionCount: dataset.sessionCount,
      requiredSessionCount: 10,
      reason: "Se requieren al menos 500 ejecuciones convergidas antes de entrenar; el mínimo no garantiza diversidad estadística.",
    };
  }
  if (dataset.sessionCount < 10) {
    return {
      status: "blocked",
      usefulExecutionCount: dataset.usefulExecutionCount,
      requiredExecutionCount: 500,
      sessionCount: dataset.sessionCount,
      requiredSessionCount: 10,
      reason: "Se requieren al menos 10 sesiones cronológicamente distintas para evitar evaluar sobre la misma sesión de entrenamiento.",
    };
  }
  const orderedSessions = [...new Map(
    dataset.examples.map((example) => [example.sessionId, example.occurredAtUnixMs]),
  ).entries()]
    .sort((left, right) => left[1] - right[1])
    .map(([sessionId]) => sessionId);
  const sessionSplitIndex = Math.max(
    1,
    Math.min(orderedSessions.length - 1, Math.floor(orderedSessions.length * 0.8)),
  );
  const trainingSessions = new Set(orderedSessions.slice(0, sessionSplitIndex));
  const holdoutSessions = new Set(orderedSessions.slice(sessionSplitIndex));
  const training = dataset.examples.filter((example) => trainingSessions.has(example.sessionId));
  const holdout = dataset.examples.filter((example) => holdoutSessions.has(example.sessionId));
  const byRule = new Map<string, { observations: number; accepted: number }>();
  for (const example of training) {
    const counter = byRule.get(example.ruleId) ?? { observations: 0, accepted: 0 };
    counter.observations += 1;
    if (example.accepted) counter.accepted += 1;
    byRule.set(example.ruleId, counter);
  }
  const ruleEstimates = [...byRule.entries()].sort(([left], [right]) => left.localeCompare(right)).map(
    ([ruleId, counter]) => {
      const interval = wilsonInterval(counter.accepted, counter.observations);
      return {
        ruleId,
        observations: counter.observations,
        accepted: counter.accepted,
        posteriorMean: (counter.accepted + 1) / (counter.observations + 2),
        lower95: interval.lower,
        upper95: interval.upper,
      };
    },
  );
  const estimateByRule = new Map(ruleEstimates.map((estimate) => [estimate.ruleId, estimate]));
  const probability = (example: ShadowExample): number => (
    estimateByRule.get(example.ruleId)?.posteriorMean ?? 0.5
  );
  const improvement = brierImprovementInterval(holdout, probability);
  return {
    status: "shadow",
    model: {
      format: "astryd-shadow-rule-model",
      version: 1,
      trainedAtUnixMs,
      trainingExamples: training.length,
      holdoutExamples: holdout.length,
      trainingSessionCount: trainingSessions.size,
      holdoutSessionCount: holdoutSessions.size,
      trainingEndUnixMs: training[training.length - 1]?.occurredAtUnixMs ?? null,
      holdoutStartUnixMs: holdout[0]?.occurredAtUnixMs ?? null,
      usefulExecutionCount: dataset.usefulExecutionCount,
      sessionCount: dataset.sessionCount,
      ruleEstimates,
      holdoutBrierScore: brierScore(holdout, probability),
      fixedBaselineBrierScore: brierScore(holdout, () => 0.5),
      brierImprovement: improvement?.mean ?? null,
      brierImprovementLower95: improvement?.lower95 ?? null,
      brierImprovementUpper95: improvement?.upper95 ?? null,
      promoted: false,
    },
  };
}

export async function createShadowRegistryArtifact(
  events: readonly FeedbackEventV1[],
  trainedAtUnixMs = Date.now(),
): Promise<ShadowTrainingResult | { readonly status: "artifact"; readonly artifact: ShadowRegistryArtifact }> {
  const result = trainShadowModel(events, trainedAtUnixMs);
  if (result.status === "blocked") return result;
  const extracted = extractShadowExamples(events);
  const datasetContentSha256 = await sha256Hex(JSON.stringify(extracted.examples));
  const dataset: ShadowDatasetDescriptor = {
    format: "astryd-shadow-dataset",
    version: 1,
    createdAtUnixMs: trainedAtUnixMs,
    eventCount: events.length,
    recommendationExampleCount: extracted.examples.length,
    usefulExecutionCount: extracted.usefulExecutionCount,
    sessionCount: extracted.sessionCount,
    firstExampleUnixMs: extracted.examples[0]?.occurredAtUnixMs ?? null,
    lastExampleUnixMs: extracted.examples[extracted.examples.length - 1]?.occurredAtUnixMs ?? null,
    contentSha256: datasetContentSha256,
  };
  const integritySha256 = await sha256Hex(JSON.stringify({ dataset, model: result.model }));
  return {
    status: "artifact",
    artifact: {
      format: "astryd-shadow-registry-artifact",
      version: 1,
      artifactId: `shadow-${integritySha256.slice(0, 16)}`,
      dataset,
      model: result.model,
      integritySha256,
      signatureStatus: "unsigned",
    },
  };
}

export function registerShadowArtifact(
  registry: ShadowModelRegistry | null,
  artifact: ShadowRegistryArtifact,
  maximumArtifacts = 5,
): ShadowModelRegistry {
  const previous = registry?.format === "astryd-shadow-model-registry" ? registry.artifacts : [];
  const withoutDuplicate = previous.filter((entry) => entry.artifactId !== artifact.artifactId);
  const artifacts = [...withoutDuplicate, artifact].slice(-Math.max(1, maximumArtifacts));
  return {
    format: "astryd-shadow-model-registry",
    version: 1,
    activeArtifactId: artifact.artifactId,
    artifacts,
  };
}

export function rollbackShadowRegistry(registry: ShadowModelRegistry): ShadowModelRegistry {
  const currentIndex = registry.artifacts.findIndex(
    (artifact) => artifact.artifactId === registry.activeArtifactId,
  );
  const previousIndex = currentIndex > 0 ? currentIndex - 1 : registry.artifacts.length - 2;
  return {
    ...registry,
    activeArtifactId: previousIndex >= 0 ? registry.artifacts[previousIndex]?.artifactId ?? null : null,
  };
}

export function evaluateShadowPromotion(
  model: ShadowModel,
  evidence: ShadowPromotionEvidence,
): ShadowPromotionDecision {
  const reasons: string[] = [];
  if (model.usefulExecutionCount < 500) reasons.push("Menos de 500 ejecuciones útiles.");
  if (model.trainingSessionCount < 8 || model.holdoutSessionCount < 2) {
    reasons.push("Separación de sesiones insuficiente.");
  }
  if (
    model.trainingEndUnixMs === null
    || model.holdoutStartUnixMs === null
    || model.trainingEndUnixMs >= model.holdoutStartUnixMs
  ) {
    reasons.push("El holdout no es estrictamente posterior al entrenamiento.");
  }
  if (model.brierImprovementLower95 === null || model.brierImprovementLower95 <= 0) {
    reasons.push("La mejora Brier no es positiva en el límite inferior del intervalo del 95 %.");
  }
  if (!evidence.scientificValidationPassed) reasons.push("Falta el gate científico de no regresión.");
  if (!evidence.artifactSignatureVerified) reasons.push("El artefacto no tiene una firma de procedencia verificada.");
  if (!evidence.prospectiveFieldPilotCompleted) reasons.push("Falta un piloto prospectivo con sesiones reales futuras.");
  return { eligible: reasons.length === 0, reasons };
}
