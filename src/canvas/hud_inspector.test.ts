// @vitest-environment happy-dom
import { describe, expect, it, vi } from "vitest";
import {
  drawSparkline,
  extractSparklinePoints,
  formatEngineeringValue,
  renderPinTelemetryHud,
  renderWireTelemetryHud,
  type TelemetryHistorySample,
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

  describe("extractSparklinePoints", () => {
    it("extrae serie de voltajes de forma segura", () => {
      const history: TelemetryHistorySample[] = [
        { nodeVoltages: { "1": 0.0 } },
        { nodeVoltages: { "1": 2.5 } },
        { nodeVoltages: { "1": 5.0 } },
      ];
      const pts = extractSparklinePoints(history, "1", false, 10);
      expect(pts).toEqual([0.0, 2.5, 5.0]);
    });

    it("retorna arreglo vacío si no hay historial", () => {
      expect(extractSparklinePoints(undefined, "1")).toEqual([]);
      expect(extractSparklinePoints([], "1")).toEqual([]);
    });

    it("limita al número máximo de puntos", () => {
      const history: TelemetryHistorySample[] = Array.from({ length: 50 }, (_, i) => ({
        nodeVoltages: { "1": i },
      }));
      const pts = extractSparklinePoints(history, "1", false, 10);
      expect(pts).toHaveLength(10);
      expect(pts[0]).toBe(40);
      expect(pts[9]).toBe(49);
    });
  });

  describe("drawSparkline", () => {
    it("dibuja la retícula y el trazo vectorial sin arrojar excepciones", () => {
      const ctx = {
        save: vi.fn(),
        restore: vi.fn(),
        beginPath: vi.fn(),
        roundRect: vi.fn(),
        fill: vi.fn(),
        stroke: vi.fn(),
        moveTo: vi.fn(),
        lineTo: vi.fn(),
        fillText: vi.fn(),
        setLineDash: vi.fn(),
      } as unknown as CanvasRenderingContext2D;

      drawSparkline(ctx, 10, 10, 100, 30, [0, 2.5, 5.0, 2.5, 0], "#38BDF8");

      expect(ctx.save).toHaveBeenCalled();
      expect(ctx.roundRect).toHaveBeenCalled();
      expect(ctx.stroke).toHaveBeenCalled();
      expect(ctx.restore).toHaveBeenCalled();
    });
  });

  describe("renderPinTelemetryHud", () => {
    it("dibuja caja HUD de telemetría de pin con mini-osciloscopio si hay historial", () => {
      const ctx = {
        save: vi.fn(),
        restore: vi.fn(),
        beginPath: vi.fn(),
        roundRect: vi.fn(),
        fill: vi.fn(),
        stroke: vi.fn(),
        moveTo: vi.fn(),
        lineTo: vi.fn(),
        fillText: vi.fn(),
        setLineDash: vi.fn(),
        measureText: vi.fn().mockReturnValue({ width: 50 }),
      } as unknown as CanvasRenderingContext2D;

      const pin: PinInstance = {
        componentId: "R1",
        pinIndex: 0,
        x: 100,
        y: 100,
      };

      const history: TelemetryHistorySample[] = [
        { nodeVoltages: { "1": 0.0 } },
        { nodeVoltages: { "1": 2.5 } },
        { nodeVoltages: { "1": 5.0 } },
      ];

      renderPinTelemetryHud(ctx, pin, "1", 5.0, 0.005, history);

      expect(ctx.save).toHaveBeenCalled();
      expect(ctx.roundRect).toHaveBeenCalled();
      expect(ctx.fillText).toHaveBeenCalled();
      expect(ctx.restore).toHaveBeenCalled();
    });
  });

  describe("renderWireTelemetryHud", () => {
    it("dibuja caja HUD de telemetría de cable con flecha vectorial y sparkline", () => {
      const ctx = {
        save: vi.fn(),
        restore: vi.fn(),
        beginPath: vi.fn(),
        roundRect: vi.fn(),
        fill: vi.fn(),
        stroke: vi.fn(),
        moveTo: vi.fn(),
        lineTo: vi.fn(),
        fillText: vi.fn(),
        setLineDash: vi.fn(),
        measureText: vi.fn().mockReturnValue({ width: 60 }),
      } as unknown as CanvasRenderingContext2D;

      const wire: WireInstance = {
        id: "W1",
        from: { componentId: "V1", pinIndex: 0 },
        to: { componentId: "R1", pinIndex: 0 },
        points: [{ x: 10, y: 10 }, { x: 50, y: 10 }],
        label: "NET_VCC",
      };

      const history: TelemetryHistorySample[] = [
        { nodeVoltages: { "1": 0.0 } },
        { nodeVoltages: { "1": 5.0 } },
      ];

      renderWireTelemetryHud(ctx, wire, 5.0, 0.025, "1", history);

      expect(ctx.save).toHaveBeenCalled();
      expect(ctx.roundRect).toHaveBeenCalled();
      expect(ctx.fillText).toHaveBeenCalled();
      expect(ctx.restore).toHaveBeenCalled();
    });
  });
});
