import { afterEach, describe, expect, it, vi } from "vitest";
import type { CircuitNetlist } from "../simulation/netlist_extractor";
import { FeedbackBus, type FeedbackStoreStatus, type FeedbackTransport } from "./feedback_bus";
import {
  beginFeedbackRun,
  completeFeedbackRun,
  configureFeedbackInstrumentation,
  failFeedbackRun,
  observeInvokeAfter,
  observeInvokeBefore,
  privacyFingerprint,
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

function previousCircuitSummary(input: CircuitNetlist, wireCount = input.wires.length) {
  const histogram = new Map<string, number>();
  for (const component of input.components) {
    const key = component.type.slice(0, 64);
    histogram.set(key, (histogram.get(key) ?? 0) + 1);
  }
  const countNodes = () => new Set(input.components.flatMap((component) => component.pins)).size;
  const topology = input.components.map((component) => ({
    type: component.type,
    pins: component.pins.length,
  })).sort((left, right) => left.type.localeCompare(right.type) || left.pins - right.pins);
  return {
    topologyFingerprint: privacyFingerprint({ topology, nodes: countNodes(), wires: wireCount }),
    componentCount: input.components.length,
    nodeCount: countNodes(),
    wireCount,
    nonlinearDeviceCount: input.components.filter((component) =>
      /diode|bjt|mos|jfet|opamp|switch/i.test(component.type)
    ).length,
    reactiveDeviceCount: input.components.filter((component) =>
      /capacitor|inductor|transmission/i.test(component.type)
    ).length,
    componentHistogram: Object.fromEntries([...histogram.entries()]
      .sort(([left], [right]) => left.localeCompare(right))),
    containsFirmware: input.components.some((component) => Boolean(component.firmware?.length)),
  };
}

describe("instrumentación de feedback", () => {
  it("conserva exactamente el resumen previo y su privacidad en topologías mixtas y mutables", async () => {
    const { bus, transport } = await enabledBus();
    const firmware = new Uint8Array([251, 239, 223, 211, 199]);
    const mixed: CircuitNetlist = {
      components: [
        { pins: ["N_SECRET_B", "0"], value: 345678.9123, type: "resistor", id: "R_SECRET" },
        { id: "C_SECRET", type: "capacitor", pins: ["N_SECRET_A", "N_SECRET_B"], value: 1e-9 },
        { value: 1, pins: ["N_SECRET_A", "0", "N_SECRET_B"], id: "M_SECRET", type: "bsim3nmos" },
        { id: "D_SECRET", value: 1, type: "DIODE", pins: ["N_SECRET_B", "0"] },
        { id: "T_SECRET", type: "transmission_line", value: 50, pins: ["N_SECRET_A", "0", "N_SECRET_B", "0"] },
        { id: "U_SECRET", pins: ["N_SECRET_A", "0"], type: "mcu_avr", value: 1, firmware },
        { id: "LONG_SECRET", type: `custom_${"x".repeat(80)}`, value: 1, pins: [] },
        { id: "EMPTY_FW_SECRET", type: "mcu_avr", value: 1, pins: ["0"], firmware: new Uint8Array() },
      ],
      wires: [{ id: "WIRE_SECRET", nodes: ["N_SECRET_A", "N_SECRET_B"] }],
    };
    const run = beginFeedbackRun({ analysis: "DC" });
    const expected = previousCircuitSummary(mixed, 7);
    recordCircuitSummary(run, mixed, 7);
    mixed.components.reverse();
    recordCircuitSummary(run, mixed, 7);
    // La misma netlist puede cambiar entre llamadas: no debe utilizarse una caché por identidad.
    mixed.components.push({ id: "R_NEW_SECRET", type: "resistor", value: 2, pins: ["N_NEW_SECRET", "0"] });
    const expectedAfterMutation = previousCircuitSummary(mixed, 7);
    recordCircuitSummary(run, mixed, 7);
    await bus.flush();

    const summaries = (transport.events as Array<{ kind: string; payload: unknown }>)
      .filter((event) => event.kind === "circuit.summary_created");
    expect(summaries.map((event) => event.payload)).toEqual([expected, expected, expectedAfterMutation]);
    const serialized = JSON.stringify(summaries);
    for (const secret of ["SECRET", "345678.9123", JSON.stringify(firmware), JSON.stringify([...firmware])]) {
      expect(serialized).not.toContain(secret);
    }
  });

  it("lee una sola vez los pines de cada componente al construir el resumen", async () => {
    const { bus } = await enabledBus();
    const pinsRead = vi.fn(() => ["PRIVATE_NODE", "0"]);
    const component = { id: "R_PRIVATE", type: "resistor", value: 1, get pins() { return pinsRead(); } };
    const run = beginFeedbackRun({ analysis: "DC" });
    recordCircuitSummary(run, { components: [component], wires: [] });
    expect(pinsRead).toHaveBeenCalledTimes(1);
    await bus.flush();
  });

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
