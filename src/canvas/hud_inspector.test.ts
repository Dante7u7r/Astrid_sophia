// @vitest-environment happy-dom
import { describe, expect, it, vi } from "vitest";
import {
  calculateSignalMetrics,
  drawSparkline,
  extractSparklinePoints,
  formatEngineeringValue,
  renderComponentTelemetryHud,
  renderHudBox,
  renderJunctionTelemetryHud,
  renderPinTelemetryHud,
  renderWireTelemetryHud,
  type TelemetryHistorySample,
} from "./hud_inspector";
import type { PinInstance, WireInstance } from "../canvas_orchestrator";
import { findJunctionInfoAt, resolveNetLabelForWire } from "./wiring_model";

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

  describe("calculateSignalMetrics", () => {
    it("retorna null si no hay datos ni voltaje instantáneo", () => {
      expect(calculateSignalMetrics(undefined, "1")).toBeNull();
      expect(calculateSignalMetrics([], "1")).toBeNull();
    });

    it("calcula métricas para voltaje DC estático", () => {
      const history: TelemetryHistorySample[] = [
        { time: 0.0, nodeVoltages: { "1": 5.0 } },
        { time: 0.001, nodeVoltages: { "1": 5.0 } },
        { time: 0.002, nodeVoltages: { "1": 5.0 } },
      ];
      const metrics = calculateSignalMetrics(history, "1", 5.0);
      expect(metrics).not.toBeNull();
      expect(metrics?.vMin).toBe(5.0);
      expect(metrics?.vMax).toBe(5.0);
      expect(metrics?.vpp).toBe(0.0);
      expect(metrics?.vdc).toBe(5.0);
      expect(metrics?.vrms).toBe(5.0);
      expect(metrics?.logicLevel).toBe("ALTO (5V)");
    });

    it("calcula Vpp, Vrms y frecuencia para una señal sinusoidal oscilante", () => {
      const freq = 1000; // 1 kHz -> período 1 ms
      const dt = 0.00005; // 50 µs
      const history: TelemetryHistorySample[] = [];
      for (let i = 0; i < 40; i++) {
        const t = i * dt;
        const v = 2.5 + 2.5 * Math.sin(2 * Math.PI * freq * t);
        history.push({ time: t, nodeVoltages: { "1": v } });
      }

      const metrics = calculateSignalMetrics(history, "1");
      expect(metrics).not.toBeNull();
      expect(metrics?.vpp).toBeGreaterThan(4.5);
      expect(metrics?.vdc).toBeCloseTo(2.5, 0.5);
      expect(metrics?.freqHz).toBeDefined();
      expect(metrics?.freqHz!).toBeGreaterThan(800);
      expect(metrics?.freqHz!).toBeLessThan(1200);
    });

    it("detecta nivel lógico digital BAJO y PULSOS", () => {
      const lowMetrics = calculateSignalMetrics(undefined, "1", 0.2);
      expect(lowMetrics?.logicLevel).toBe("BAJO (0V)");

      const pulseHistory: TelemetryHistorySample[] = [
        { time: 0, nodeVoltages: { "1": 0.0 } },
        { time: 0.001, nodeVoltages: { "1": 5.0 } },
        { time: 0.002, nodeVoltages: { "1": 0.0 } },
        { time: 0.003, nodeVoltages: { "1": 5.0 } },
      ];
      const pulseMetrics = calculateSignalMetrics(pulseHistory, "1", 5.0);
      expect(pulseMetrics?.logicLevel).toBe("PULSOS");
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
      expect(ctx.stroke).toHaveBeenCalled();
      expect(ctx.restore).toHaveBeenCalled();
    });
  });

  describe("renderPinTelemetryHud", () => {
    it("dibuja caja HUD de telemetría de pin con opciones y modo simulación", () => {
      const ctx = {
        save: vi.fn(),
        restore: vi.fn(),
        beginPath: vi.fn(),
        roundRect: vi.fn(),
        fill: vi.fn(),
        stroke: vi.fn(),
        moveTo: vi.fn(),
        lineTo: vi.fn(),
        closePath: vi.fn(),
        fillText: vi.fn(),
        setLineDash: vi.fn(),
        measureText: vi.fn().mockReturnValue({ width: 50 }),
      } as unknown as CanvasRenderingContext2D;

      const pin: PinInstance = {
        componentId: "R1",
        pinIndex: 0,
        name: "Anodo",
        x: 100,
        y: 100,
      };

      const history: TelemetryHistorySample[] = [
        { nodeVoltages: { "1": 0.0 } },
        { nodeVoltages: { "1": 2.5 } },
        { nodeVoltages: { "1": 5.0 } },
      ];

      renderPinTelemetryHud(ctx, pin, "1", 5.0, 0.005, history, {
        componentType: "resistor",
        componentValue: "10k",
        probeChannel: "CH1",
        netLabel: "VIN",
      });

      expect(ctx.save).toHaveBeenCalled();
      expect(ctx.fillText).toHaveBeenCalledWith(
        expect.stringContaining("R1"),
        expect.any(Number),
        expect.any(Number),
      );
      expect(ctx.fillText).toHaveBeenCalledWith(
        expect.stringContaining("CH1"),
        expect.any(Number),
        expect.any(Number),
      );
      expect(ctx.restore).toHaveBeenCalled();
    });

    it("dibuja HUD de pin en modo edición / pre-simulación con alerta ERC", () => {
      const ctx = {
        save: vi.fn(),
        restore: vi.fn(),
        beginPath: vi.fn(),
        roundRect: vi.fn(),
        fill: vi.fn(),
        stroke: vi.fn(),
        moveTo: vi.fn(),
        lineTo: vi.fn(),
        closePath: vi.fn(),
        fillText: vi.fn(),
        setLineDash: vi.fn(),
        measureText: vi.fn().mockReturnValue({ width: 50 }),
      } as unknown as CanvasRenderingContext2D;

      const pin: PinInstance = {
        componentId: "Q1",
        pinIndex: 1,
        name: "Base",
        x: 80,
        y: 80,
      };

      renderPinTelemetryHud(ctx, pin, undefined, undefined, undefined, undefined, {
        componentType: "npn",
        connectedCount: 0,
        ercWarning: "Terminal flotante no conectado",
      });

      expect(ctx.fillText).toHaveBeenCalledWith(
        expect.stringContaining("Base"),
        expect.any(Number),
        expect.any(Number),
      );
      expect(ctx.fillText).toHaveBeenCalledWith(
        expect.stringContaining("ERC: Terminal flotante"),
        expect.any(Number),
        expect.any(Number),
      );
    });
  });

  describe("renderWireTelemetryHud", () => {
    it("dibuja caja HUD de telemetría de cable con enlace, flecha y sparkline", () => {
      const ctx = {
        save: vi.fn(),
        restore: vi.fn(),
        beginPath: vi.fn(),
        roundRect: vi.fn(),
        fill: vi.fn(),
        stroke: vi.fn(),
        moveTo: vi.fn(),
        lineTo: vi.fn(),
        closePath: vi.fn(),
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

      renderWireTelemetryHud(ctx, wire, 5.0, 0.025, "1", history, {
        fromDescriptor: "V1.0",
        toDescriptor: "R1.0",
        probeChannel: "CH2",
      });

      expect(ctx.save).toHaveBeenCalled();
      expect(ctx.fillText).toHaveBeenCalledWith(
        expect.stringContaining("V1.0 ➔ R1.0"),
        expect.any(Number),
        expect.any(Number),
      );
      expect(ctx.restore).toHaveBeenCalled();
    });
  });

  describe("renderJunctionTelemetryHud", () => {
    it("dibuja HUD de empalme en T con topología y mediciones", () => {
      const ctx = {
        save: vi.fn(),
        restore: vi.fn(),
        beginPath: vi.fn(),
        roundRect: vi.fn(),
        fill: vi.fn(),
        stroke: vi.fn(),
        moveTo: vi.fn(),
        lineTo: vi.fn(),
        closePath: vi.fn(),
        fillText: vi.fn(),
        setLineDash: vi.fn(),
        measureText: vi.fn().mockReturnValue({ width: 60 }),
      } as unknown as CanvasRenderingContext2D;

      renderJunctionTelemetryHud(
        ctx,
        { x: 120, y: 140 },
        "2",
        "VOUT",
        3,
        3.3,
        0.012,
        undefined,
        "CH1",
      );

      expect(ctx.fillText).toHaveBeenCalledWith(
        expect.stringContaining("Empalme Red: VOUT"),
        expect.any(Number),
        expect.any(Number),
      );
      expect(ctx.fillText).toHaveBeenCalledWith(
        expect.stringContaining("3 ramales"),
        expect.any(Number),
        expect.any(Number),
      );
    });
  });

  describe("renderComponentTelemetryHud", () => {
    it("dibuja caja HUD de telemetría de componente con cálculo de potencia", () => {
      const ctx = {
        save: vi.fn(),
        restore: vi.fn(),
        beginPath: vi.fn(),
        roundRect: vi.fn(),
        fill: vi.fn(),
        stroke: vi.fn(),
        moveTo: vi.fn(),
        lineTo: vi.fn(),
        closePath: vi.fn(),
        fillText: vi.fn(),
        setLineDash: vi.fn(),
        measureText: vi.fn().mockReturnValue({ width: 80 }),
      } as unknown as CanvasRenderingContext2D;

      const comp = { id: "R1", type: "resistor", value: "1k", x: 100, y: 100 };

      renderComponentTelemetryHud(ctx, comp, 5.0, 0.005, 0.25);

      expect(ctx.save).toHaveBeenCalled();
      expect(ctx.fillText).toHaveBeenCalled();
      expect(ctx.restore).toHaveBeenCalled();
    });

    it("incluye alerta de sobrecarga térmica si la potencia excede el límite", () => {
      const ctx = {
        save: vi.fn(),
        restore: vi.fn(),
        beginPath: vi.fn(),
        roundRect: vi.fn(),
        fill: vi.fn(),
        stroke: vi.fn(),
        moveTo: vi.fn(),
        lineTo: vi.fn(),
        closePath: vi.fn(),
        fillText: vi.fn(),
        setLineDash: vi.fn(),
        measureText: vi.fn().mockReturnValue({ width: 90 }),
      } as unknown as CanvasRenderingContext2D;

      const comp = { id: "R1", type: "resistor", value: "100", x: 100, y: 100 };

      // 10V * 0.1A = 1W > 0.25W nominal
      renderComponentTelemetryHud(ctx, comp, 10.0, 0.1, 0.25);

      expect(ctx.fillText).toHaveBeenCalledWith(
        expect.stringContaining("SOBRECARGA"),
        expect.any(Number),
        expect.any(Number),
      );
    });
  });

  describe("wiring_model helpers", () => {
    it("findJunctionInfoAt resuelve correctamente nodo y ramales", () => {
      const wires: WireInstance[] = [
        { id: "w1", from: { componentId: "R1", pinIndex: 1 }, to: { componentId: "junction_100_100", pinIndex: 0, isJunction: true }, points: [{ x: 50, y: 100 }, { x: 100, y: 100 }], label: "NET_A" },
        { id: "w2", from: { componentId: "junction_100_100", pinIndex: 0, isJunction: true }, to: { componentId: "C1", pinIndex: 0 }, points: [{ x: 100, y: 100 }, { x: 100, y: 150 }] },
        { id: "w3", from: { componentId: "junction_100_100", pinIndex: 0, isJunction: true }, to: { componentId: "D1", pinIndex: 0 }, points: [{ x: 100, y: 100 }, { x: 150, y: 100 }] },
      ];

      const nodeMap = { "R1:1": "3", "C1:0": "3", "D1:0": "3" };
      const voltageMap = { "R1:1": 4.8 };

      const info = findJunctionInfoAt({ x: 100, y: 100 }, wires, nodeMap, voltageMap);
      expect(info).not.toBeNull();
      expect(info?.branchCount).toBe(3);
      expect(info?.nodeId).toBe("3");
      expect(info?.netLabel).toBe("NET_A");
      expect(info?.voltage).toBe(4.8);
    });

    it("resolveNetLabelForWire propaga etiquetas en la misma red", () => {
      const w1: WireInstance = { id: "w1", from: { componentId: "R1", pinIndex: 1 }, to: { componentId: "C1", pinIndex: 0 }, points: [{ x: 0, y: 0 }, { x: 50, y: 0 }], label: "V_IN" };
      const w2: WireInstance = { id: "w2", from: { componentId: "C1", pinIndex: 0 }, to: { componentId: "D1", pinIndex: 0 }, points: [{ x: 50, y: 0 }, { x: 100, y: 0 }] };

      const nodeMap = { "R1:1": "5", "C1:0": "5", "D1:0": "5" };
      const label = resolveNetLabelForWire(w2, [w1, w2], nodeMap);
      expect(label).toBe("V_IN");
    });
  });
});
