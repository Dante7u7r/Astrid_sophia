import { describe, test, expect, vi } from "vitest";
import {
  getTerminalType,
  isPowerRailName,
  parsePowerRailVoltage,
  drawNetLabel,
  drawTextNote,
  getNetLabelDynamicExtents,
  getTextNoteDynamicExtents,
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
      translate: vi.fn(),
      rotate: vi.fn(),
      scale: vi.fn(),
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
    expect(getTerminalType({ id: "6", type: "net_label", terminalType: "bidirectional", value: "SDA" } as any)).toBe("bidirectional");
    expect(getTerminalType({ id: "7", type: "net_label", value: "DATA[7:0]" } as any)).toBe("bus_tap");
    expect(getTerminalType({ id: "8", type: "net_label", value: "TP1" } as any)).toBe("test_point");
    expect(getTerminalType({ id: "9", type: "net_label", value: "TEST_POINT" } as any)).toBe("test_point");
  });

  test("drawNetLabel renders bidirectional, bus_tap and test_point without throwing", () => {
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
      measureText: vi.fn().mockReturnValue({ width: 40 }),
      quadraticCurveTo: vi.fn(),
      translate: vi.fn(),
      rotate: vi.fn(),
      scale: vi.fn(),
    } as unknown as CanvasRenderingContext2D;

    const compBidir: ComponentInstance = {
      id: "B1",
      type: "net_label",
      value: "SDA",
      label: "SDA",
      terminalType: "bidirectional",
      x: 0,
      y: 0,
      rotation: 180,
    };
    expect(() => drawNetLabel(mockCtx, compBidir, false, false, "#A855F7")).not.toThrow();

    const compBus: ComponentInstance = {
      id: "BUS1",
      type: "net_label",
      value: "DATA[15:0]",
      label: "DATA[15:0]",
      terminalType: "bus_tap",
      x: 0,
      y: 0,
      rotation: 270,
    };
    expect(() => drawNetLabel(mockCtx, compBus, false, false, "#F59E0B")).not.toThrow();

    const compTp: ComponentInstance = {
      id: "TP1",
      type: "net_label",
      value: "TP_VOUT",
      label: "TP_VOUT",
      terminalType: "test_point",
      x: 0,
      y: 0,
      rotation: 0,
    };
    expect(() => drawNetLabel(mockCtx, compTp, false, false, "#FBBF24")).not.toThrow();
  });

  test("drawNetLabel renders power and ground style variants correctly", () => {
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
      translate: vi.fn(),
      rotate: vi.fn(),
      scale: vi.fn(),
    } as unknown as CanvasRenderingContext2D;

    // Power styles: circle, bar, triangle
    const pCircle: ComponentInstance = { id: "P1", type: "net_label", terminalType: "power", terminalStyle: "circle", value: "VCC", label: "VCC", x: 0, y: 0, rotation: 0 };
    const pBar: ComponentInstance = { id: "P2", type: "net_label", terminalType: "power", terminalStyle: "bar", value: "+12V", label: "+12V", x: 0, y: 0, rotation: 0 };
    const pTri: ComponentInstance = { id: "P3", type: "net_label", terminalType: "power", terminalStyle: "triangle", value: "-12V", label: "-12V", x: 0, y: 0, rotation: 0 };
    expect(() => drawNetLabel(mockCtx, pCircle, false, false, "#F59E0B")).not.toThrow();
    expect(() => drawNetLabel(mockCtx, pBar, false, false, "#F59E0B")).not.toThrow();
    expect(() => drawNetLabel(mockCtx, pTri, false, false, "#38BDF8")).not.toThrow();

    // Ground styles: earth, chassis, digital, analog, standard
    const gEarth: ComponentInstance = { id: "G1", type: "net_label", terminalType: "ground", terminalStyle: "earth", value: "PE", label: "PE", x: 0, y: 0, rotation: 0 };
    const gChassis: ComponentInstance = { id: "G2", type: "net_label", terminalType: "ground", terminalStyle: "chassis", value: "CHASSIS", label: "CHASSIS", x: 0, y: 0, rotation: 0 };
    const gDigital: ComponentInstance = { id: "G3", type: "net_label", terminalType: "ground", terminalStyle: "digital", value: "DGND", label: "DGND", x: 0, y: 0, rotation: 0 };
    const gAnalog: ComponentInstance = { id: "G4", type: "net_label", terminalType: "ground", terminalStyle: "analog", value: "AGND", label: "AGND", x: 0, y: 0, rotation: 0 };
    expect(() => drawNetLabel(mockCtx, gEarth, false, false, "#10B981")).not.toThrow();
    expect(() => drawNetLabel(mockCtx, gChassis, false, false, "#10B981")).not.toThrow();
    expect(() => drawNetLabel(mockCtx, gDigital, false, false, "#10B981")).not.toThrow();
    expect(() => drawNetLabel(mockCtx, gAnalog, false, false, "#10B981")).not.toThrow();
  });

  test("getNetLabelDynamicExtents calculates proper half-extents per terminal type and label length", () => {
    const shortLabel: ComponentInstance = { id: "L1", type: "net_label", value: "IN", label: "IN", terminalType: "signal", x: 0, y: 0, rotation: 0 };
    const longLabel: ComponentInstance = { id: "L2", type: "net_label", value: "VERY_LONG_BUS_NAME_SIGNAL", label: "VERY_LONG_BUS_NAME_SIGNAL", terminalType: "signal", x: 0, y: 0, rotation: 0 };
    const gndComp: ComponentInstance = { id: "G1", type: "net_label", value: "GND", label: "GND", terminalType: "ground", x: 0, y: 0, rotation: 0 };
    const pwrComp: ComponentInstance = { id: "P1", type: "net_label", value: "+5V", label: "+5V", terminalType: "power", x: 0, y: 0, rotation: 0 };
    const ncComp: ComponentInstance = { id: "NC1", type: "net_label", value: "NC", label: "NC", terminalType: "no_connect", x: 0, y: 0, rotation: 0 };

    const extShort = getNetLabelDynamicExtents(shortLabel);
    const extLong = getNetLabelDynamicExtents(longLabel);
    const extGnd = getNetLabelDynamicExtents(gndComp);
    const extPwr = getNetLabelDynamicExtents(pwrComp);
    const extNc = getNetLabelDynamicExtents(ncComp);

    expect(extLong.halfW).toBeGreaterThan(extShort.halfW);
    expect(extGnd.halfH).toBeGreaterThanOrEqual(16);
    expect(extPwr.halfH).toBeGreaterThanOrEqual(14);
    expect(extNc.halfW).toBeGreaterThanOrEqual(8);
  });

  test("getTextNoteDynamicExtents calculates bounding box based on multi-line text and font size", () => {
    const singleLine: ComponentInstance = { id: "N1", type: "text_note", value: "Title", fontSize: 12, x: 0, y: 0, rotation: 0 };
    const multiLine: ComponentInstance = { id: "N2", type: "text_note", value: "Line 1\nLine 2\nLine 3 with much longer description text", fontSize: 16, x: 0, y: 0, rotation: 0 };

    const ext1 = getTextNoteDynamicExtents(singleLine);
    const ext2 = getTextNoteDynamicExtents(multiLine);

    expect(ext2.halfW).toBeGreaterThan(ext1.halfW);
    expect(ext2.halfH).toBeGreaterThan(ext1.halfH);
  });

  test("drawTextNote renders across all supported themes without errors", () => {
    const mockCtx = {
      save: vi.fn(),
      restore: vi.fn(),
      beginPath: vi.fn(),
      moveTo: vi.fn(),
      lineTo: vi.fn(),
      closePath: vi.fn(),
      stroke: vi.fn(),
      fill: vi.fn(),
      fillText: vi.fn(),
      measureText: vi.fn().mockReturnValue({ width: 60 }),
      translate: vi.fn(),
      rotate: vi.fn(),
      scale: vi.fn(),
      setLineDash: vi.fn(),
      roundRect: vi.fn(),
    } as unknown as CanvasRenderingContext2D;

    const themes: Array<"card" | "plain" | "warning" | "info" | "success" | "outline"> = [
      "card", "plain", "warning", "info", "success", "outline"
    ];

    for (const theme of themes) {
      const noteComp: ComponentInstance = {
        id: `N_${theme}`,
        type: "text_note",
        value: `Note with theme ${theme}`,
        noteTheme: theme,
        fontSize: 12,
        x: 100,
        y: 100,
        rotation: 0,
      };
      expect(() => drawTextNote(mockCtx, noteComp, false)).not.toThrow();
    }
  });
});
