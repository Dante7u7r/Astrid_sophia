// @vitest-environment happy-dom
import { describe, expect, it, vi } from "vitest";
import Ajv2020 from "ajv/dist/2020.js";
import supportBundleSchema from "../../feedback/contracts/support-bundle.v2.schema.json";
import eventSchema from "../../feedback/contracts/feedback-event.v1.schema.json";
import type { FeedbackEventV1 } from "./contracts.generated";
import { createRedactedSupportBundle, IntelligenceCenter } from "./intelligence_center";

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
    expect(bundle.summaryMarkdown).toContain("# Diagnóstico de Biaani");
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

describe("IntelligenceCenter UI & Asesor Component", () => {
  it("conserva historial, privacidad y feedback junto a las tarjetas del asesor", async () => {
    const container = document.createElement("div");
    container.id = "inst-intelligence";
    document.body.appendChild(container);

    const mockBus = {
      getStatus: () => Promise.resolve({ consentMode: "local", eventCount: 15, logicalBytes: 1024 }),
      query: () => Promise.resolve({ events: [completed], hasMore: false }),
      export: () => Promise.resolve({ events: [completed], hasMore: false }),
      delete: () => Promise.resolve({ rowsDeleted: 0 }),
      emit: vi.fn(() => true),
      flush: () => Promise.resolve(),
    };

    const center = new IntelligenceCenter(mockBus as any, document);
    center.init();

    const list = document.querySelector("#intelligence-recommendations-list");
    expect(list).not.toBeNull();
    for (const id of [
      "intelligence-kind-filter",
      "intelligence-history-body",
      "intelligence-privacy-viewer",
      "intelligence-feedback-form",
      "intelligence-feedback-submit",
      "intelligence-content-confirm",
      "intelligence-feedback-category",
      "intelligence-expected-value",
      "intelligence-expected-unit",
      "intelligence-feedback-note",
      "intelligence-version-comparison",
      "intelligence-shadow-evaluate",
      "intelligence-shadow-rollback",
      "intelligence-shadow-disable",
      "intelligence-delete-expired",
      "intelligence-delete-confirm",
      "intelligence-delete-all",
    ]) {
      expect(document.getElementById(id), `${id} debe existir`).not.toBeNull();
    }
    expect(document.querySelectorAll('[name="feedback-rating"]')).toHaveLength(3);
    expect(document.querySelectorAll("#intelligence-empty-state")).toHaveLength(1);
    expect(document.querySelectorAll("#intelligence-recommendations-empty-state")).toHaveLength(1);

    await center.refresh();
    const row = document.querySelector<HTMLTableRowElement>("#intelligence-history-body tr");
    expect(row).not.toBeNull();
    row!.click();
    expect(document.getElementById("intelligence-privacy-viewer")?.textContent).toContain(completed.eventId);
    expect(document.getElementById("intelligence-empty-state")?.hidden).toBe(true);
    expect(document.getElementById("intelligence-recommendations-empty-state")?.hidden).toBe(false);

    const form = document.getElementById("intelligence-feedback-form") as HTMLFormElement;
    const rating = document.querySelector<HTMLInputElement>('[name="feedback-rating"][value="incorrect"]')!;
    rating.checked = true;
    (document.getElementById("intelligence-feedback-note") as HTMLTextAreaElement).value = "Resultado revisado.";
    form.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }));
    expect(mockBus.emit).not.toHaveBeenCalled();

    (document.getElementById("intelligence-content-confirm") as HTMLInputElement).checked = true;
    form.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }));
    await vi.waitFor(() => expect(mockBus.emit).toHaveBeenCalledWith(
      "user.feedback_submitted",
      expect.objectContaining({ subjectEventId: completed.eventId, rating: "incorrect", note: "Resultado revisado." }),
      { userContentConfirmed: true },
    ));

    // Disparar evento de recomendaciones con diferentes clases de seguridad
    window.dispatchEvent(
      new CustomEvent("astryd-recommendations", {
        detail: [
          {
            recommendationId: "rec-1",
            ruleId: "tran.rc-time-step",
            ruleVersion: 1,
            title: "Reduce el paso temporal respecto a RC",
            explanation: "Explicación teórica",
            evidence: "dt/tau = 10",
            safetyClass: "reversible",
            confidence: 0.95,
            settingsPatch: { dt: 1e-5 },
          },
          {
            recommendationId: "rec-2",
            ruleId: "model.experimental-bsim",
            ruleVersion: 1,
            title: "Trata BSIM como modelo experimental",
            explanation: "No reproduce corriente de referencia",
            evidence: "1 dispositivo BSIM",
            safetyClass: "scientific-review-required",
            confidence: 1.0,
          },
        ],
      }),
    );

    const cards = document.querySelectorAll(".intelligence-recommendation");
    expect(cards.length).toBe(2);
    expect(cards[0].textContent).toContain("Ajuste Automático");
    expect(cards[0].textContent).toContain("⚡ Aplicar ajuste");
    expect(cards[1].textContent).toContain("Revisión Requerida");

    container.remove();
  });
});
