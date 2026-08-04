import { describe, expect, it } from "vitest";
import type {
  FeedbackConsentMode,
  FeedbackStoreStatus,
  FeedbackTransport,
} from "./feedback_bus";
import { FeedbackBus } from "./feedback_bus";

class TestTransport implements FeedbackTransport {
  readonly calls: Array<{ command: string; args?: Record<string, unknown> }> = [];
  mode: FeedbackConsentMode = "disabled";
  failNextBatch = false;

  async invoke<T>(
    command: string,
    args?: Record<string, unknown>,
  ): Promise<T> {
    this.calls.push({ command, args });
    if (command === "get_feedback_status") return this.status() as T;
    if (command === "set_feedback_consent") {
      this.mode = args?.mode as FeedbackConsentMode;
      return this.status() as T;
    }
    if (command === "ingest_feedback_batch") {
      if (this.failNextBatch) {
        this.failNextBatch = false;
        throw new Error("fallo simulado");
      }
      const batch = args?.batch as { events: unknown[] };
      return {
        accepted: batch.events.length,
        duplicates: 0,
        persistedAtUnixMs: 100,
      } as T;
    }
    return undefined as T;
  }

  private status(): FeedbackStoreStatus {
    return {
      consentMode: this.mode,
      eventCount: 0,
      logicalBytes: 0,
      databaseSchemaVersion: 1,
      eventSchemaVersion: 1,
    };
  }
}

function createBus(transport: TestTransport, maxQueueEvents = 8): FeedbackBus {
  let id = 0;
  return new FeedbackBus({
    transport,
    sessionId: "session-test",
    appVersion: "0.1.0",
    flushIntervalMs: 0,
    maxQueueEvents,
    now: () => 123,
    createId: () => `event-${++id}`,
  });
}

describe("FeedbackBus", () => {
  it("no captura nada sin consentimiento", async () => {
    const transport = new TestTransport();
    const bus = createBus(transport);
    await bus.initialize();

    expect(bus.emit("session.started", { os: "Windows" })).toBe(false);
    expect(bus.getMetrics().queued).toBe(0);
    expect(
      transport.calls.some((call) => call.command === "ingest_feedback_batch"),
    ).toBe(false);
  });

  it("forma un lote tipado cuando el modo local esta activo", async () => {
    const transport = new TestTransport();
    const bus = createBus(transport);
    await bus.initialize();
    await bus.setConsent("local");

    expect(bus.emit("session.started", { os: "Windows" })).toBe(true);
    expect(bus.emit("session.ended", {
      durationMs: 50,
      cleanShutdown: true,
    })).toBe(true);

    const receipt = await bus.flush();
    expect(receipt?.accepted).toBe(2);
    const call = transport.calls.find(
      (candidate) => candidate.command === "ingest_feedback_batch",
    );
    const batch = call?.args?.batch as { events: Array<{ kind: string }> };
    expect(batch.events.map((event) => event.kind)).toEqual([
      "session.started",
      "session.ended",
    ]);
  });

  it("combina rendimiento pendiente y preserva eventos de ciclo de vida", async () => {
    const transport = new TestTransport();
    const bus = createBus(transport, 2);
    await bus.initialize();
    await bus.setConsent("local");

    bus.emit("session.started", { os: "Windows" });
    bus.emit("performance.sampled", {
      fps: 60,
      cpuPercent: 10,
      ramBytes: 100,
      canvasFrames: 1,
      oscilloscopeFrames: 0,
      skippedDmmUpdates: 0,
    });
    bus.emit("performance.sampled", {
      fps: 58,
      cpuPercent: 11,
      ramBytes: 110,
      canvasFrames: 2,
      oscilloscopeFrames: 0,
      skippedDmmUpdates: 0,
    });

    expect(bus.getMetrics()).toEqual({
      queued: 2,
      dropped: 1,
      flushFailures: 0,
    });
    await bus.flush();
    const call = transport.calls.find(
      (candidate) => candidate.command === "ingest_feedback_batch",
    );
    const batch = call?.args?.batch as {
      events: Array<{ kind: string; payload: { fps?: number } }>;
    };
    expect(batch.events[1]?.payload.fps).toBe(58);
  });

  it("restaura el lote si IPC falla", async () => {
    const transport = new TestTransport();
    const bus = createBus(transport);
    await bus.initialize();
    await bus.setConsent("local");
    bus.emit("session.started", { os: "Windows" });

    transport.failNextBatch = true;
    await expect(bus.flush()).rejects.toThrow("fallo simulado");
    expect(bus.getMetrics()).toEqual({
      queued: 1,
      dropped: 0,
      flushFailures: 1,
    });

    await expect(bus.flush()).resolves.toMatchObject({ accepted: 1 });
    expect(bus.getMetrics().queued).toBe(0);
  });

  it("exige confirmacion separada para contenido del usuario", async () => {
    const transport = new TestTransport();
    const bus = createBus(transport);
    await bus.initialize();
    await bus.setConsent("local");
    const payload = {
      rating: "uncertain" as const,
      category: "model" as const,
      attachmentIncluded: false,
    };

    expect(bus.emit("user.feedback_submitted", payload)).toBe(false);
    expect(bus.emit("user.feedback_submitted", payload, {
      userContentConfirmed: true,
    })).toBe(true);
  });

  it("vacia eventos aceptados antes del cierre normal", async () => {
    const transport = new TestTransport();
    const bus = createBus(transport);
    await bus.initialize();
    await bus.setConsent("local");
    bus.emit("session.ended", {
      durationMs: 500,
      cleanShutdown: true,
    });

    await bus.close();

    const commands = transport.calls.map((call) => call.command);
    expect(commands.indexOf("ingest_feedback_batch")).toBeGreaterThan(-1);
    expect(commands.at(-1)).toBe("flush_feedback_store");
    expect(bus.getMetrics().queued).toBe(0);
  });
});
