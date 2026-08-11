import { describe, expect, it } from "vitest";
import Ajv2020 from "ajv/dist/2020.js";
import supportBundleSchema from "../../feedback/contracts/support-bundle.v2.schema.json";
import eventSchema from "../../feedback/contracts/feedback-event.v1.schema.json";
import type { FeedbackEventV1 } from "./contracts.generated";
import { createRedactedSupportBundle } from "./intelligence_center";

const completed: FeedbackEventV1 = {
  schemaVersion: 1,
  eventId: "event-secret-completed",
  occurredAtUnixMs: 100,
  sessionId: "session-secret",
  runId: "run-secret",
  workspaceId: "workspace-secret",
  appVersion: "0.1.0",
  privacyClass: "operational",
  kind: "simulation.completed",
  payload: {
    analysis: "DC",
    durationMs: 12,
    pointCount: 1,
    converged: true,
  },
};

const humanFeedback: FeedbackEventV1 = {
  schemaVersion: 1,
  eventId: "event-secret-feedback",
  occurredAtUnixMs: 101,
  sessionId: "session-secret",
  appVersion: "0.1.0",
  privacyClass: "user-content",
  kind: "user.feedback_submitted",
  payload: {
    subjectEventId: "event-secret-completed",
    rating: "incorrect",
    category: "model",
    note: "El valor físicamente esperado es menor.",
    noteFingerprint: "fnv1a32:secret",
    attachmentIncluded: false,
  },
};

describe("paquete redactado de soporte", () => {
  it("reasigna identificadores y fingerprints conservando referencias internas", async () => {
    const bundle = await createRedactedSupportBundle([completed, humanFeedback], false, 1234);
    const serialized = JSON.stringify(bundle);

    for (const secret of [
      "event-secret-completed",
      "event-secret-feedback",
      "session-secret",
      "run-secret",
      "workspace-secret",
      "fnv1a32:secret",
    ]) {
      expect(serialized).not.toContain(secret);
    }
    expect(bundle.events[0]?.eventId).toBe("event-0001");
    expect(bundle.events[1]?.kind).toBe("user.feedback_submitted");
    if (bundle.events[1]?.kind === "user.feedback_submitted") {
      expect(bundle.events[1].payload.subjectEventId).toBe(bundle.events[0]?.eventId);
      expect(bundle.events[1].payload.note).toBe("El valor físicamente esperado es menor.");
      expect(bundle.events[1].payload.noteFingerprint).toBe("fingerprint-0001");
    }
    expect(bundle.manifest.redactions).toMatchObject({
      eventIds: 2,
      sessionIds: 1,
      runIds: 1,
      workspaceIds: 1,
      fingerprints: 1,
    });
    expect(bundle.manifest.contentSha256).toMatch(/^[0-9a-f]{64}$/);
    expect(bundle.manifest.formatVersion).toBe(2);
    expect(bundle.summaryMarkdown).toContain("# Diagnóstico de Astryd Sophia");
    expect(bundle.summaryMarkdown).toContain("0.1.0");
    const ajv = new Ajv2020({ strict: true });
    ajv.addSchema(eventSchema);
    expect(ajv.validate(supportBundleSchema, bundle), ajv.errorsText()).toBe(true);
  });

  it("produce el mismo contenido y hash con la misma entrada y fecha", async () => {
    const first = await createRedactedSupportBundle([completed, humanFeedback], false, 1234);
    const second = await createRedactedSupportBundle([completed, humanFeedback], false, 1234);
    expect(second).toEqual(first);
  });
});
