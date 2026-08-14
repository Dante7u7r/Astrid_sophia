// @vitest-environment happy-dom
import { describe, expect, it, vi } from "vitest";
import {
  formatEngineeringValue,
  renderPinTelemetryHud,
  renderWireTelemetryHud,
} from "./hud_inspector";
import type { PinInstance, WireInstance } from "../canvas_orchestrator";

describe("hud_inspector", () => {
  describe("formatEngineeringValue", () => {
    it("formatea valores normales y cero", () => {
      expect(formatEngineeringValue(0, "V")).toBe("0.000 V");
      expect(formatEngineeringValue(undefined, "V")).toBe("-- V");
      expect(formatEngineeringValue(5, "V")).toBe("5.000 V");
      expect(formatEngineeringValue(-12.5, "V")).toBe("-12.500 V");
    });

    it("formatea múltiplos (k, M)", () => {
      expect(formatEngineeringValue(1000, "V")).toBe("1.000 kV");
      expect(formatEngineeringValue(2500000, "Ω")).toBe("2.500 MΩ");
    });

    it("formatea submúltiplos (m, µ, n, p)", () => {
      expect(formatEngineeringValue(0.025, "A")).toBe("25.000 mA");
      expect(formatEngineeringValue(0.000005, "A")).toBe("5.000 µA");
      expect(formatEngineeringValue(0.000000002, "F")).toBe("2.000 nF");
      expect(formatEngineeringValue(0.000000000015, "F")).toBe("15.000 pF");
    });
  });

  describe("renderPinTelemetryHud", () => {
    it("dibuja caja HUD de telemetría de pin sin errores", () => {
      const ctx = {
        save: vi.fn(),
        restore: vi.fn(),
        beginPath: vi.fn(),
        roundRect: vi.fn(),
        fill: vi.fn(),
        stroke: vi.fn(),
        fillText: vi.fn(),
        measureText: vi.fn().mockReturnValue({ width: 50 }),
      } as unknown as CanvasRenderingContext2D;

      const pin: PinInstance = {
        componentId: "R1",
        pinIndex: 0,
        x: 100,
        y: 100,
      };

      renderPinTelemetryHud(ctx, pin, "1", 5.0, 0.005);

      expect(ctx.save).toHaveBeenCalled();
      expect(ctx.roundRect).toHaveBeenCalled();
      expect(ctx.fillText).toHaveBeenCalledTimes(3);
      expect(ctx.restore).toHaveBeenCalled();
    });
  });

  describe("renderWireTelemetryHud", () => {
    it("dibuja caja HUD de telemetría de cable con flecha vectorial", () => {
      const ctx = {
        save: vi.fn(),
        restore: vi.fn(),
        beginPath: vi.fn(),
        roundRect: vi.fn(),
        fill: vi.fn(),
        stroke: vi.fn(),
        fillText: vi.fn(),
        measureText: vi.fn().mockReturnValue({ width: 60 }),
      } as unknown as CanvasRenderingContext2D;

      const wire: WireInstance = {
        id: "W1",
        from: { componentId: "V1", pinIndex: 0 },
        to: { componentId: "R1", pinIndex: 0 },
        points: [{ x: 10, y: 10 }, { x: 50, y: 10 }],
        label: "NET_VCC",
      };

      renderWireTelemetryHud(ctx, wire, 5.0, 0.025);

      expect(ctx.save).toHaveBeenCalled();
      expect(ctx.roundRect).toHaveBeenCalled();
      expect(ctx.fillText).toHaveBeenCalledTimes(3);
      expect(ctx.restore).toHaveBeenCalled();
    });
  });
});
