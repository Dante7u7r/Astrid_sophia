import { afterEach, describe, expect, it } from "vitest";
import type { CircuitNetlist } from "../simulation/netlist_extractor";
import { FeedbackBus, type FeedbackStoreStatus, type FeedbackTransport } from "./feedback_bus";
import {
  beginFeedbackRun,
  completeFeedbackRun,
  configureFeedbackInstrumentation,
  failFeedbackRun,
  observeInvokeAfter,
  observeInvokeBefore,
  recordCircuitSummary,
  recordErc,
} from "./instrumentation";

class CapturingTransport implements FeedbackTransport {
  readonly events: unknown[] = [];

  async invoke<T>(command: string, args?: Record<string, unknown>): Promise<T> {
    if (command === "get_feedback_status" || command === "set_feedback_consent") {
      return {
        consentMode: command === "set_feedback_consent" ? args?.mode : "disabled",
        eventCount: this.events.length,
        logicalBytes: 0,
        databaseSchemaVersion: 1,
        eventSchemaVersion: 1,
      } as FeedbackStoreStatus as T;
    }
    if (command === "ingest_feedback_batch") {
      const batch = args?.batch as { events: unknown[] };
      this.events.push(...batch.events);
      return { accepted: batch.events.length, duplicates: 0, persistedAtUnixMs: Date.now() } as T;
    }
    return undefined as T;
  }
}

const netlist: CircuitNetlist = {
  components: [
    { id: "V_SECRET", type: "vsource", value: 9.87654321, pins: ["PRIVATE_NET", "0"] },
    { id: "R_SECRET", type: "resistor", value: 123456.789, pins: ["PRIVATE_NET", "0"] },
  ],
  wires: [{ id: "WIRE_SECRET", nodes: ["PRIVATE_NET", "0"] }],
};

async function enabledBus(): Promise<{ bus: FeedbackBus; transport: CapturingTransport }> {
  const transport = new CapturingTransport();
  const bus = new FeedbackBus({
    transport,
    sessionId: "instrumentation-session",
    appVersion: "0.1.0",
    flushIntervalMs: 0,
  });
  await bus.initialize();
  await bus.setConsent("local");
  configureFeedbackInstrumentation(bus);
  return { bus, transport };
}

afterEach(() => configureFeedbackInstrumentation(null));

describe("instrumentación de feedback", () => {
  it("correlaciona el ciclo completo sin persistir contenido del circuito", async () => {
    const { bus, transport } = await enabledBus();
    const run = beginFeedbackRun({
      analysis: "DC",
      workspaceId: "TAB_PRIVATE",
      netlist,
      settings: { tolerance: 1e-9, internalLabel: "DO_NOT_STORE" },
    });
    recordCircuitSummary(run, netlist, 1);
    recordErc(run, {
      passed: true,
      errors: [],
      warnings: ["Pin flotante detectado en [R_SECRET]"],
    }, 0.4);
    completeFeedbackRun(run, { pointCount: 1, converged: true });
    await bus.flush();

    const events = transport.events as Array<Record<string, unknown>>;
    expect(events.map((event) => event.kind)).toEqual([
      "simulation.started",
      "circuit.summary_created",
      "erc.completed",
      "simulation.completed",
    ]);
    expect(new Set(events.map((event) => event.runId))).toEqual(new Set([run.runId]));
    expect(new Set(events.map((event) => event.workspaceId))).toEqual(new Set([run.workspaceId]));

    const persisted = JSON.stringify(events);
    for (const secret of [
      "V_SECRET",
      "R_SECRET",
      "WIRE_SECRET",
      "PRIVATE_NET",
      "TAB_PRIVATE",
      "9.87654321",
      "123456.789",
      "DO_NOT_STORE",
    ]) {
      expect(persisted).not.toContain(secret);
    }
    expect(persisted).toContain("ERC_FLOATING_PIN");
  });

  it("emite un único terminal aunque se reporten fallo y éxito", async () => {
    const { bus, transport } = await enabledBus();
    const run = beginFeedbackRun({ analysis: "AC", netlist });
    failFeedbackRun(run, "singular matrix at PRIVATE_NET", "iteration");
    completeFeedbackRun(run, { pointCount: 20, converged: true });
    await bus.flush();

    const kinds = (transport.events as Array<{ kind: string }>).map((event) => event.kind);
    expect(kinds.filter((kind) => kind === "simulation.failed")).toHaveLength(1);
    expect(kinds).not.toContain("simulation.completed");
    expect(JSON.stringify(transport.events)).not.toContain("PRIVATE_NET");
  });

  it("observa parser y análisis IPC no orquestados por la UI", async () => {
    const { bus, transport } = await enabledBus();
    const parser = observeInvokeBefore("parse_spice_netlist", { netlist: "SECRET SPICE" });
    observeInvokeAfter(parser, { components: [{}, {}] });
    const fft = observeInvokeBefore("run_fft_analysis", { netlist, settings: { bins: 64 } });
    observeInvokeAfter(fft, { frequencies: [1, 2, 3], converged: true });
    await bus.flush();

    const kinds = (transport.events as Array<{ kind: string }>).map((event) => event.kind);
    expect(kinds).toContain("parser.completed");
    expect(kinds).toContain("simulation.started");
    expect(kinds).toContain("solver.convergence_summary");
    expect(kinds).toContain("simulation.completed");
    expect(JSON.stringify(transport.events)).not.toContain("SECRET SPICE");
  });
});
