import type { Point2D } from "../canvas_orchestrator";

export class CircuitFileValidationError extends Error {}

export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function finiteNumber(value: unknown, path: string, fallback?: number): number {
  if (value === undefined && fallback !== undefined) return fallback;
  if (typeof value !== "number" || !Number.isFinite(value)) {
    throw new CircuitFileValidationError(`${path} debe ser un numero finito.`);
  }
  return value;
}

export function finiteInteger(value: unknown, path: string, fallback?: number): number {
  const parsed = finiteNumber(value, path, fallback);
  if (!Number.isInteger(parsed)) {
    throw new CircuitFileValidationError(`${path} debe ser un entero.`);
  }
  return parsed;
}

export function nullableString(value: unknown, path: string, fallback: string | null): string | null {
  if (value === undefined) return fallback;
  if (typeof value === "string" || value === null) return value;
  throw new CircuitFileValidationError(`${path} debe ser texto o null.`);
}

export function parsePoint(value: unknown, path: string): Point2D {
  if (!isRecord(value)) throw new CircuitFileValidationError(`${path} no es un punto valido.`);
  return {
    x: finiteNumber(value.x, `${path}.x`),
    y: finiteNumber(value.y, `${path}.y`),
  };
}
