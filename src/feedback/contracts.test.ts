import { describe, expect, it } from "vitest";
import {
  expectedPrivacyClass,
  FEEDBACK_EVENT_KINDS,
  FEEDBACK_EVENT_PRIVACY,
  FEEDBACK_PRIVACY_CLASSES,
  FEEDBACK_SCHEMA_VERSION,
  type FeedbackEventV1,
} from "./contracts.generated";

describe("contratos de feedback generados", () => {
  it("mantiene un catalogo unico y versionado", () => {
    expect(FEEDBACK_SCHEMA_VERSION).toBe(1);
    expect(FEEDBACK_EVENT_KINDS).toHaveLength(18);
    expect(new Set(FEEDBACK_EVENT_KINDS).size).toBe(FEEDBACK_EVENT_KINDS.length);
    expect(FEEDBACK_PRIVACY_CLASSES).toEqual([
      "operational",
      "circuit-derived",
      "user-content",
    ]);
  });

  it("asocia cada evento con una clase de privacidad", () => {
    for (const kind of FEEDBACK_EVENT_KINDS) {
      expect(expectedPrivacyClass(kind)).toBe(FEEDBACK_EVENT_PRIVACY[kind]);
    }
    expect(expectedPrivacyClass("user.feedback_submitted")).toBe("user-content");
  });

  it("expone una union discriminada para payloads", () => {
    const event: FeedbackEventV1 = {
      schemaVersion: 1,
      eventId: "event-1",
      occurredAtUnixMs: 1_785_460_000_000,
      sessionId: "session-1",
      appVersion: "0.1.0",
      privacyClass: FEEDBACK_EVENT_PRIVACY["simulation.started"],
      kind: "simulation.started",
      payload: {
        analysis: "TRAN",
        settingsFingerprint: "sha256:fixture",
        componentCount: 3,
        nodeCount: 2,
        requestedPointCount: 1000,
      },
    };

    expect(event.payload.analysis).toBe("TRAN");
    expect(event.privacyClass).toBe("circuit-derived");
  });
});
