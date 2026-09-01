import { describe, it, expect } from "vitest";
import { getSchematicThemeColors } from "./schematic_theme";

describe("schematic_theme", () => {
  it("returns dark theme colors by default or when isClassroom is false", () => {
    const theme = getSchematicThemeColors(false);
    expect(theme.isClassroom).toBe(false);
    expect(theme.wire.normal).toBe("#8595A6");
    expect(theme.wire.selected).toBe("#38BDF8");
    expect(theme.component.stroke).toBe("#E6EAF0");
    expect(theme.component.strokeSelected).toBe("#38BDF8");
    expect(theme.component.labelDefault).toBe("#F1F5F9");
    expect(theme.probes.ch1.stroke).toBe("#FACC15");
    expect(theme.probes.ch2.stroke).toBe("#38BDF8");
    expect(theme.probes.ch3.stroke).toBe("#F43F5E");
    expect(theme.probes.ch4.stroke).toBe("#34D399");
  });

  it("returns classroom theme colors with high contrast on white background", () => {
    const theme = getSchematicThemeColors(true);
    expect(theme.isClassroom).toBe(true);
    expect(theme.wire.normal).toBe("#334155");
    expect(theme.wire.selected).toBe("#0284C7");
    expect(theme.component.stroke).toBe("#1E293B");
    expect(theme.component.strokeSelected).toBe("#0284C7");
    expect(theme.component.labelDefault).toBe("#0F172A");
    expect(theme.probes.ch1.stroke).toBe("#D97706");
    expect(theme.probes.ch2.stroke).toBe("#0284C7");
    expect(theme.probes.ch3.stroke).toBe("#E11D48");
    expect(theme.probes.ch4.stroke).toBe("#16A34A");
  });
});
