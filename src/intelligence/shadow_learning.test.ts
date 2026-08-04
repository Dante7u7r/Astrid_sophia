import { describe, expect, it } from "vitest";
import type { FeedbackEventV1 } from "../feedback/contracts.generated";
import {
  createShadowRegistryArtifact,
  evaluateShadowPromotion,
  extractShadowExamples,
  registerShadowArtifact,
  rollbackShadowRegistry,
  trainShadowModel,
} from "./shadow_learning";

function syntheticEvents(runCount: number): FeedbackEventV1[] {
  const events: FeedbackEventV1[] = [];
  for (let index = 0; index < runCount; index += 1) {
    const runId = `run-${index}`;
    const sessionId = `session-${Math.floor(index / 25)}`;
    const recommendationId = `recommendation-${index}`;
    const occurredAt = 1_000 + index * 10;
    events.push({
      schemaVersion: 1,
      eventId: `started-${index}`,
      occurredAtUnixMs: occurredAt,
      sessionId,
      runId,
      appVersion: index < runCount * 0.8 ? "0.1.0" : "0.2.0",
      privacyClass: "circuit-derived",
      kind: "simulation.started",
      payload: {
        analysis: index % 2 === 0 ? "DC" : "TRAN",
        settingsFingerprint: `settings-${index}`,
        componentCount: 10,
        nodeCount: 5,
      },
    });
    events.push({
      schemaVersion: 1,
      eventId: `summary-${index}`,
      occurredAtUnixMs: occurredAt + 1,
      sessionId,
      runId,
      appVersion: "0.1.0",
      privacyClass: "circuit-derived",
      kind: "circuit.summary_created",
      payload: {
        topologyFingerprint: `topology-${index}`,
        componentCount: index % 3 === 0 ? 300 : 10,
        nodeCount: 5,
        wireCount: 8,
        nonlinearDeviceCount: index % 4,
        reactiveDeviceCount: 1,
        componentHistogram: { resistor: 8 },
        containsFirmware: false,
      },
    });
    const ruleId = index % 2 === 0 ? "rule-good" : "rule-bad";
    events.push({
      schemaVersion: 1,
      eventId: `shown-${index}`,
      occurredAtUnixMs: occurredAt + 2,
      sessionId,
      runId,
      appVersion: "0.1.0",
      privacyClass: "operational",
      kind: "recommendation.shown",
      payload: {
        recommendationId,
        ruleId,
        safetyClass: "reversible",
        confidence: 0.9,
      },
    });
    events.push({
      schemaVersion: 1,
      eventId: `completed-${index}`,
      occurredAtUnixMs: occurredAt + 3,
      sessionId,
      runId,
      appVersion: "0.1.0",
      privacyClass: "operational",
      kind: "simulation.completed",
      payload: {
        analysis: index % 2 === 0 ? "DC" : "TRAN",
        durationMs: 10,
        pointCount: 1,
        converged: true,
      },
    });
    events.push({
      schemaVersion: 1,
      eventId: `outcome-${index}`,
      occurredAtUnixMs: occurredAt + 4,
      sessionId,
      appVersion: "0.1.0",
      privacyClass: "operational",
      kind: "recommendation.outcome",
      payload: {
        recommendationId,
        decision: ruleId === "rule-good" ? "accepted" : "rejected",
        applied: ruleId === "rule-good",
        improved: ruleId === "rule-good",
      },
    });
  }
  return events;
}

describe("aprendizaje local en modo sombra", () => {
  it("extrae características sin usar netlists, valores ni identificadores de componentes", () => {
    const dataset = extractShadowExamples(syntheticEvents(10));
    expect(dataset.examples).toHaveLength(10);
    expect(dataset.usefulExecutionCount).toBe(10);
    expect(dataset.examples[0]).toMatchObject({
      ruleId: "rule-good",
      analysis: "DC",
      componentBucket: "large",
      nonlinearBucket: "none",
      accepted: true,
    });
    expect(JSON.stringify(dataset.examples)).not.toContain("topology-");
    expect(JSON.stringify(dataset.examples)).not.toContain("settings-");
  });

  it("bloquea el entrenamiento por debajo de 500 ejecuciones útiles", () => {
    const result = trainShadowModel(syntheticEvents(499), 9_999);
    expect(result).toEqual(expect.objectContaining({
      status: "blocked",
      usefulExecutionCount: 499,
      requiredExecutionCount: 500,
      requiredSessionCount: 10,
    }));
  });

  it("bloquea 500 ejecuciones concentradas en una sola sesión", () => {
    const events = syntheticEvents(500).map((event) => ({ ...event, sessionId: "single-session" }));
    const result = trainShadowModel(events, 9_999);
    expect(result).toEqual(expect.objectContaining({
      status: "blocked",
      usefulExecutionCount: 500,
      sessionCount: 1,
      requiredSessionCount: 10,
    }));
  });

  it("entrena de forma reproducible con corte temporal y nunca se promociona", () => {
    const events = syntheticEvents(600);
    const first = trainShadowModel(events, 9_999);
    const second = trainShadowModel(events, 9_999);
    expect(second).toEqual(first);
    expect(first.status).toBe("shadow");
    if (first.status !== "shadow") return;
    expect(first.model.trainingExamples).toBe(475);
    expect(first.model.holdoutExamples).toBe(125);
    expect(first.model.trainingSessionCount).toBe(19);
    expect(first.model.holdoutSessionCount).toBe(5);
    expect(first.model.trainingEndUnixMs).toBeLessThan(first.model.holdoutStartUnixMs!);
    expect(first.model.sessionCount).toBe(24);
    expect(first.model.promoted).toBe(false);
    expect(first.model.holdoutBrierScore).not.toBeNull();
    expect(first.model.holdoutBrierScore!).toBeLessThan(first.model.fixedBaselineBrierScore!);
    expect(first.model.brierImprovement).toBeGreaterThan(0);
    expect(first.model.brierImprovementLower95).toBeGreaterThan(0);
  });

  it("registra artefactos reproducibles, conserva historial y permite rollback", async () => {
    const events = syntheticEvents(600);
    const first = await createShadowRegistryArtifact(events, 9_999);
    const repeated = await createShadowRegistryArtifact(events, 9_999);
    expect(repeated).toEqual(first);
    expect(first.status).toBe("artifact");
    if (first.status !== "artifact") return;
    expect(first.artifact.signatureStatus).toBe("unsigned");
    expect(first.artifact.integritySha256).toMatch(/^[0-9a-f]{64}$/);
    const second = await createShadowRegistryArtifact(events, 10_000);
    expect(second.status).toBe("artifact");
    if (second.status !== "artifact") return;
    const withFirst = registerShadowArtifact(null, first.artifact);
    const withSecond = registerShadowArtifact(withFirst, second.artifact);
    expect(withSecond.artifacts).toHaveLength(2);
    expect(withSecond.activeArtifactId).toBe(second.artifact.artifactId);
    expect(rollbackShadowRegistry(withSecond).activeArtifactId).toBe(first.artifact.artifactId);
  });

  it("no habilita promoción sin firma, matriz científica y piloto prospectivo", () => {
    const result = trainShadowModel(syntheticEvents(600), 9_999);
    expect(result.status).toBe("shadow");
    if (result.status !== "shadow") return;
    const blocked = evaluateShadowPromotion(result.model, {
      scientificValidationPassed: true,
      artifactSignatureVerified: false,
      prospectiveFieldPilotCompleted: false,
    });
    expect(blocked.eligible).toBe(false);
    expect(blocked.reasons).toEqual(expect.arrayContaining([
      expect.stringContaining("firma"),
      expect.stringContaining("piloto"),
    ]));
    expect(evaluateShadowPromotion(result.model, {
      scientificValidationPassed: true,
      artifactSignatureVerified: true,
      prospectiveFieldPilotCompleted: true,
    }).eligible).toBe(true);
  });
});
