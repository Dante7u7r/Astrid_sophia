// @vitest-environment happy-dom

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { safeInvoke, safeListen, shouldEnableWebMocks } from "./tauri_mock";

describe("politica de mocks Tauri", () => {
  it("los desactiva en produccion y los limita a entornos instrumentados", () => {
    expect(shouldEnableWebMocks("production", false)).toBe(false);
    expect(shouldEnableWebMocks("development", true)).toBe(true);
    expect(shouldEnableWebMocks("test", false)).toBe(true);
    expect(shouldEnableWebMocks("audit", false)).toBe(true);
    expect(shouldEnableWebMocks("wdio", false)).toBe(true);
  });

  it("rechaza comandos desconocidos en vez de fingir exito", async () => {
    await expect(safeInvoke("comando_inexistente")).rejects.toThrow(
      "No existe un mock web explícito",
    );
  });
});

describe("Tauri web mock streaming", () => {
  beforeEach(async () => {
    vi.useFakeTimers();
    await safeInvoke("stop_interactive_transient");
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("emite frames transitorios y termina con un frame final", async () => {
    const frames: Array<{ runId: number; time: number; isFinal: boolean }> = [];
    const unlisten = await safeListen<{ runId: number; time: number; isFinal: boolean }>(
      "sim-frame-update",
      (event) => frames.push(event.payload),
    );

    await safeInvoke("start_interactive_transient", {
      netlist: { components: [], wires: [] },
      settings: { dt: 1e-4, tMax: 0.05 },
      runId: 42,
    });
    await vi.advanceTimersByTimeAsync(2_500);

    expect(frames).toHaveLength(60);
    expect(frames.at(-1)).toMatchObject({ runId: 42, time: 0.05, isFinal: true });
    unlisten();
  });

  it("detiene el stream antes del frame final", async () => {
    const frames: Array<{ isFinal: boolean }> = [];
    const unlisten = await safeListen<{ isFinal: boolean }>(
      "sim-frame-update",
      (event) => frames.push(event.payload),
    );

    await safeInvoke("start_interactive_transient", {
      netlist: { components: [], wires: [] },
      settings: { dt: 1e-4, tMax: 0.05 },
      disablePacing: false,
    });
    await vi.advanceTimersByTimeAsync(50);
    await safeInvoke("stop_interactive_transient");
    await vi.advanceTimersByTimeAsync(300);

    expect(frames.length).toBeGreaterThan(0);
    expect(frames.some((frame) => frame.isFinal)).toBe(false);
    unlisten();
  });

  it("ignora una cancelacion tardia de una corrida anterior", async () => {
    const frames: Array<{ runId: number; isFinal: boolean }> = [];
    const unlisten = await safeListen<{ runId: number; isFinal: boolean }>(
      "sim-frame-update",
      (event) => frames.push(event.payload),
    );

    await safeInvoke("start_interactive_transient", {
      netlist: { components: [], wires: [] },
      settings: { dt: 1e-4, tMax: 0.05 },
      runId: 100,
      disablePacing: false,
    });
    await safeInvoke("start_interactive_transient", {
      netlist: { components: [], wires: [] },
      settings: { dt: 1e-4, tMax: 0.05 },
      runId: 101,
      disablePacing: false,
    });
    await safeInvoke("stop_interactive_transient", { runId: 100 });
    await vi.advanceTimersByTimeAsync(2_500);

    expect(frames.some(frame => frame.runId === 100)).toBe(false);
    expect(frames.at(-1)).toMatchObject({ runId: 101, isFinal: true });
    unlisten();
  });
});
