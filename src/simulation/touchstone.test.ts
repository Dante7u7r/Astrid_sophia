import { describe, expect, test } from "vitest";
import type { SParameterResult } from "./mcu-types";
import { formatTouchstone } from "./touchstone";

describe("formatTouchstone", () => {
  test("usa orden S11, S21, S12, S22 para dos puertos", () => {
    const result: SParameterResult = {
      frequencies: [1_000],
      sMatrices: [[
        [{ re: 11, im: 0 }, { re: 12, im: 0 }],
        [{ re: 21, im: 0 }, { re: 22, im: 0 }],
      ]],
      format: "ri",
      referenceImpedance: 50,
      converged: true,
      error: null,
    };

    const output = formatTouchstone(result, new Date("2026-01-01T00:00:00.000Z"));
    const dataLine = output.split("\n").find(line => line.startsWith("1.000000e+3"));

    expect(dataLine).toContain(
      "1.100000e+1 0.000000e+0  2.100000e+1 0.000000e+0  1.200000e+1 0.000000e+0  2.200000e+1 0.000000e+0",
    );
  });

  test("rechaza matrices inconsistentes", () => {
    const invalid = {
      frequencies: [1],
      sMatrices: [[[{ re: 0, im: 0 }], []]],
      format: "ri",
      referenceImpedance: 50,
      converged: false,
      error: "invalid",
    } as unknown as SParameterResult;

    expect(formatTouchstone(invalid)).toBe("");
  });
});
