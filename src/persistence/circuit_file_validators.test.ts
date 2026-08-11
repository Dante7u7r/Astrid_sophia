import { describe, expect, it } from "vitest";
import {
  CircuitFileValidationError,
  finiteInteger,
  finiteNumber,
  isRecord,
  nullableString,
  parsePoint,
} from "./circuit_file_validators";

describe("circuit_file_validators", () => {
  it("detecta records JSON planos", () => {
    expect(isRecord({ a: 1 })).toBe(true);
    expect(isRecord(null)).toBe(false);
    expect(isRecord([])).toBe(false);
  });

  it("valida numeros finitos e integer", () => {
    expect(finiteNumber(undefined, "x", 3)).toBe(3);
    expect(finiteNumber(2.5, "x")).toBe(2.5);
    expect(finiteInteger(2, "i")).toBe(2);

    expect(() => finiteNumber(Number.NaN, "x")).toThrow(CircuitFileValidationError);
    expect(() => finiteInteger(2.5, "i")).toThrow("entero");
  });

  it("valida cadenas opcionales y puntos", () => {
    expect(nullableString(undefined, "node", "1")).toBe("1");
    expect(nullableString(null, "node", "1")).toBeNull();
    expect(parsePoint({ x: 10, y: -4 }, "p")).toEqual({ x: 10, y: -4 });

    expect(() => nullableString(12, "node", null)).toThrow("texto");
    expect(() => parsePoint({ x: 1, y: "bad" }, "p")).toThrow("p.y");
  });
});
