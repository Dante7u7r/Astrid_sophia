import { describe, expect, it } from "vitest";
import { PerformanceMonitor } from "./performance_monitor";

describe("PerformanceMonitor", () => {
  it("cuenta frames y skips sin depender de IPC", () => {
    const monitor = new PerformanceMonitor();

    monitor.recordCanvasFrame();
    monitor.recordCanvasFrame();
    monitor.recordOscilloscopeFrame();
    monitor.recordSkippedDmmUpdate();

    expect(monitor.snapshot()).toMatchObject({
      canvasFrames: 2,
      oscilloscopeFrames: 1,
      skippedDmmUpdates: 1,
    });
  });
});
