import { describe, test, expect, vi } from "vitest";
import {
  getTerminalType,
  isPowerRailName,
  parsePowerRailVoltage,
  drawNetLabel,
} from "./component_annotation_renderer";
import type { ComponentInstance } from "../canvas_orchestrator";

describe("component_annotation_renderer terminal helpers", () => {
  test("isPowerRailName identifies common power rails", () => {
    expect(isPowerRailName("VCC")).toBe(true);
    expect(isPowerRailName("VDD")).toBe(true);
    expect(isPowerRailName("VEE")).toBe(true);
    expect(isPowerRailName("VSS")).toBe(true);
    expect(isPowerRailName("+5V")).toBe(true);
    expect(isPowerRailName("+3.3V")).toBe(true);
    expect(isPowerRailName("+12V")).toBe(true);
    expect(isPowerRailName("-12V")).toBe(true);
    expect(isPowerRailName("+15V")).toBe(true);
    expect(isPowerRailName("-15V")).toBe(true);
    expect(isPowerRailName("24V")).toBe(true);
    expect(isPowerRailName("NET_A")).toBe(false);
    expect(isPowerRailName("CLK")).toBe(false);
    expect(isPowerRailName("DATA0")).toBe(false);
  });

  test("getTerminalType accurately classifies terminals", () => {
    const compPowerExplicit: ComponentInstance = {
      id: "T1",
      type: "net_label",
      value: "CUSTOM",
      label: "CUSTOM",
      terminalType: "power",
      x: 0,
      y: 0,
      rotation: 0,
    };
    expect(getTerminalType(compPowerExplicit)).toBe("power");

    const compGnd: ComponentInstance = {
      id: "T2",
      type: "net_label",
      value: "GND",
      label: "GND",
      x: 0,
      y: 0,
      rotation: 0,
    };
    expect(getTerminalType(compGnd)).toBe("ground");

    const compVcc: ComponentInstance = {
      id: "T3",
      type: "net_label",
      value: "+5V",
      label: "+5V",
      x: 0,
      y: 0,
      rotation: 0,
    };
    expect(getTerminalType(compVcc)).toBe("power");

    const compClk: ComponentInstance = {
      id: "T4",
      type: "net_label",
      value: "CLK",
      label: "CLK",
      waveType: "square",
      frequency: 1000,
      x: 0,
      y: 0,
      rotation: 0,
    };
    expect(getTerminalType(compClk)).toBe("generator");

    const compSig: ComponentInstance = {
      id: "T5",
      type: "net_label",
      value: "RESET",
      label: "RESET",
      x: 0,
      y: 0,
      rotation: 0,
    };
    expect(getTerminalType(compSig)).toBe("signal");
  });

  test("parsePowerRailVoltage correctly extracts voltage levels", () => {
    expect(parsePowerRailVoltage({ voltage: 9 } as any)).toBe(9);
    expect(parsePowerRailVoltage({ label: "+5V" } as any)).toBe(5);
    expect(parsePowerRailVoltage({ label: "+3.3V" } as any)).toBe(3.3);
    expect(parsePowerRailVoltage({ label: "+12V" } as any)).toBe(12);
    expect(parsePowerRailVoltage({ label: "-12V" } as any)).toBe(-12);
    expect(parsePowerRailVoltage({ label: "VCC" } as any)).toBe(5);
    expect(parsePowerRailVoltage({ label: "VDD" } as any)).toBe(3.3);
    expect(parsePowerRailVoltage({ label: "VEE" } as any)).toBe(-5);
    expect(parsePowerRailVoltage({ label: "VSS" } as any)).toBe(0);
    expect(parsePowerRailVoltage({ label: "V+" } as any)).toBe(15);
    expect(parsePowerRailVoltage({ label: "V-" } as any)).toBe(-15);
    expect(parsePowerRailVoltage({ label: "+24V" } as any)).toBe(24);
  });

  test("drawNetLabel renders without errors for all terminal types", () => {
    const mockCtx = {
      save: vi.fn(),
      restore: vi.fn(),
      beginPath: vi.fn(),
      moveTo: vi.fn(),
      lineTo: vi.fn(),
      closePath: vi.fn(),
      stroke: vi.fn(),
      fill: vi.fn(),
      arc: vi.fn(),
      fillText: vi.fn(),
      measureText: vi.fn().mockReturnValue({ width: 30 }),
      quadraticCurveTo: vi.fn(),
    } as unknown as CanvasRenderingContext2D;

    const compPower: ComponentInstance = {
      id: "P1",
      type: "net_label",
      value: "+5V",
      label: "+5V",
      terminalType: "power",
      voltage: 5,
      x: 0,
      y: 0,
      rotation: 0,
    };
    expect(() => drawNetLabel(mockCtx, compPower, false, false, "#38BDF8")).not.toThrow();

    const compGnd: ComponentInstance = {
      id: "G1",
      type: "net_label",
      value: "GND",
      label: "GND",
      terminalType: "ground",
      x: 0,
      y: 0,
      rotation: 0,
    };
    expect(() => drawNetLabel(mockCtx, compGnd, false, false, "#10B981")).not.toThrow();

    const compGen: ComponentInstance = {
      id: "C1",
      type: "net_label",
      value: "CLK",
      label: "CLK",
      terminalType: "generator",
      waveType: "square",
      frequency: 1000,
      x: 0,
      y: 0,
      rotation: 0,
    };
    expect(() => drawNetLabel(mockCtx, compGen, false, false, "#FBBF24")).not.toThrow();

    const compSig: ComponentInstance = {
      id: "S1",
      type: "net_label",
      value: "DATA0",
      label: "DATA0",
      terminalType: "signal",
      x: 0,
      y: 0,
      rotation: 0,
    };
    expect(() => drawNetLabel(mockCtx, compSig, false, false, "#38BDF8")).not.toThrow();

    const compNc: ComponentInstance = {
      id: "NC1",
      type: "net_label",
      value: "NC",
      label: "NC",
      terminalType: "no_connect",
      x: 0,
      y: 0,
      rotation: 0,
    };
    expect(() => drawNetLabel(mockCtx, compNc, false, false, "#EF4444")).not.toThrow();

    const compInput: ComponentInstance = {
      id: "IN1",
      type: "net_label",
      value: "SIG_IN",
      label: "SIG_IN",
      terminalType: "input",
      x: 0,
      y: 0,
      rotation: 0,
    };
    expect(() => drawNetLabel(mockCtx, compInput, false, false, "#818CF8")).not.toThrow();

    const compOutput: ComponentInstance = {
      id: "OUT1",
      type: "net_label",
      value: "SIG_OUT",
      label: "SIG_OUT",
      terminalType: "output",
      x: 0,
      y: 0,
      rotation: 0,
    };
    expect(() => drawNetLabel(mockCtx, compOutput, false, false, "#34D399")).not.toThrow();
  });

  test("getTerminalType detects no_connect, input and output names", () => {
    expect(getTerminalType({ id: "1", type: "net_label", value: "NC" } as any)).toBe("no_connect");
    expect(getTerminalType({ id: "2", type: "net_label", value: "NO CONNECT" } as any)).toBe("no_connect");
    expect(getTerminalType({ id: "3", type: "net_label", value: "SIN_CONEXION" } as any)).toBe("no_connect");
    expect(getTerminalType({ id: "4", type: "net_label", terminalType: "input", value: "A" } as any)).toBe("input");
    expect(getTerminalType({ id: "5", type: "net_label", terminalType: "output", value: "Y" } as any)).toBe("output");
  });
});
