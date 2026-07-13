import { describe, expect, it } from "vitest";
import { findClosestTimeIndex, shouldRenderPlaybackCanvas } from "./playback_helpers";
import type { TimeStepResult } from "../ui/oscilloscope_panel";

const resultAt = (time: number): TimeStepResult => ({
  time,
  nodeVoltages: {},
  currents: {},
});

describe("findClosestTimeIndex", () => {
  it("reuses the previous window when target is between previous and next", () => {
    const results = [0, 0.1, 0.2, 0.3].map(resultAt);

    expect(findClosestTimeIndex(results, 0.18, 1)).toBe(2);
  });

  it("falls back to binary search when playback jumps", () => {
    const results = [0, 0.1, 0.2, 0.3, 0.4].map(resultAt);

    expect(findClosestTimeIndex(results, 0.31, 0)).toBe(3);
  });
});

describe("shouldRenderPlaybackCanvas", () => {
  it("limits playback canvas renders by elapsed time", () => {
    expect(shouldRenderPlaybackCanvas(120, 100)).toBe(false);
    expect(shouldRenderPlaybackCanvas(134, 100)).toBe(true);
  });
});
