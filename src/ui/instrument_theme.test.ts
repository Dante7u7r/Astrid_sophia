// @vitest-environment happy-dom
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { getInstrumentThemeColors } from "./instrument_theme";

describe("instrument_theme", () => {
  beforeEach(() => {
    document.documentElement.removeAttribute("data-theme");
  });

  afterEach(() => {
    document.documentElement.removeAttribute("data-theme");
  });

  it("devuelve la paleta oscura por defecto", () => {
    const theme = getInstrumentThemeColors();
    expect(theme.isClassroom).toBe(false);
    expect(theme.screenBg).toBe("#050811");
    expect(theme.traceColors.ch1).toBe("#FACC15");
    expect(theme.traceColors.ch2).toBe("#38BDF8");
    expect(theme.traceColors.ch4).toBe("#34D399");
    expect(theme.gridLine).toBe("rgba(148, 163, 184, 0.10)");
    expect(theme.axisLine).toBe("rgba(148, 163, 184, 0.28)");
  });

  it("devuelve la paleta clara de alto contraste cuando data-theme es classroom", () => {
    document.documentElement.setAttribute("data-theme", "classroom");
    const theme = getInstrumentThemeColors();
    expect(theme.isClassroom).toBe(true);
    expect(theme.screenBg).toBe("#FFFFFF");
    expect(theme.traceColors.ch1).toBe("#D97706");
    expect(theme.traceColors.ch2).toBe("#0284C7");
    expect(theme.traceColors.ch4).toBe("#059669");
  });
});
