import { describe, expect, it } from "vitest";
import { parseSpiceValue, formatSpiceValue } from "./spice_value_parser";

describe("Enhanced SPICE & Engineering Value Parser", () => {
  describe("1. Basic numbers and scientific notation", () => {
    it("parses integers, decimals, and signed numbers", () => {
      expect(parseSpiceValue("100")).toEqual({ valid: true, value: 100, suffix: "" });
      expect(parseSpiceValue("0.05")).toEqual({ valid: true, value: 0.05, suffix: "" });
      expect(parseSpiceValue("-12.5")).toEqual({ valid: true, value: -12.5, suffix: "" });
      expect(parseSpiceValue("+5")).toEqual({ valid: true, value: 5, suffix: "" });
    });

    it("parses scientific notation with and without units", () => {
      expect(parseSpiceValue("1e-6").value).toBeCloseTo(1e-6, 15);
      expect(parseSpiceValue("50e-9").value).toBeCloseTo(50e-9, 15);
      expect(parseSpiceValue("1.5E3").value).toBeCloseTo(1500, 10);
      expect(parseSpiceValue("2.2e-6 F").value).toBeCloseTo(2.2e-6, 15);
      expect(parseSpiceValue("1e6 ohms").value).toBeCloseTo(1e6, 10);
    });

    it("handles commas as decimal separator", () => {
      expect(parseSpiceValue("4,7k").value).toBe(4700);
      expect(parseSpiceValue("0,05").value).toBe(0.05);
    });
  });

  describe("2. Standard engineering prefixes and multipliers", () => {
    it("parses standard engineering suffixes", () => {
      expect(parseSpiceValue("10k").value).toBe(10000);
      expect(parseSpiceValue("10K").value).toBe(10000);
      expect(parseSpiceValue("1kilo").value).toBe(1000);
      expect(parseSpiceValue("100m").value).toBeCloseTo(0.1, 10);
      expect(parseSpiceValue("10u").value).toBeCloseTo(10e-6, 15);
      expect(parseSpiceValue("10µ").value).toBeCloseTo(10e-6, 15);
      expect(parseSpiceValue("50n").value).toBeCloseTo(50e-9, 15);
      expect(parseSpiceValue("100p").value).toBeCloseTo(100e-12, 18);
      expect(parseSpiceValue("10f").value).toBeCloseTo(10e-15, 20);
      expect(parseSpiceValue("2G").value).toBe(2e9);
      expect(parseSpiceValue("1T").value).toBe(1e12);
    });

    it("parses Mega in various forms (1M, 1Meg, 1Mega)", () => {
      expect(parseSpiceValue("1M").value).toBe(1e6);
      expect(parseSpiceValue("1Meg").value).toBe(1e6);
      expect(parseSpiceValue("1MEG").value).toBe(1e6);
      expect(parseSpiceValue("1mega").value).toBe(1e6);
      expect(parseSpiceValue("10M").value).toBe(10e6);
      expect(parseSpiceValue("2.2M").value).toBe(2.2e6);
    });
  });

  describe("3. Natural language units in Spanish & English (User reported cases)", () => {
    it("parses resistors with various unit notations (1M homs, 1Mohm, 10k ohmios)", () => {
      expect(parseSpiceValue("1M homs").value).toBe(1e6);
      expect(parseSpiceValue("1 M homs").value).toBe(1e6);
      expect(parseSpiceValue("1M ohms").value).toBe(1e6);
      expect(parseSpiceValue("1Mohm").value).toBe(1e6);
      expect(parseSpiceValue("1MΩ").value).toBe(1e6);
      expect(parseSpiceValue("10k ohmios").value).toBe(10000);
      expect(parseSpiceValue("100 ohm").value).toBe(100);
      expect(parseSpiceValue("470 homs").value).toBe(470);
      expect(parseSpiceValue("100R").value).toBe(100);
    });

    it("parses capacitors with shorthand abbreviations (10uf, 10nf, 100pf, 10u, 10n)", () => {
      expect(parseSpiceValue("10uf").value).toBeCloseTo(10e-6, 15);
      expect(parseSpiceValue("10uF").value).toBeCloseTo(10e-6, 15);
      expect(parseSpiceValue("10u").value).toBeCloseTo(10e-6, 15);
      expect(parseSpiceValue("10nf").value).toBeCloseTo(10e-9, 15);
      expect(parseSpiceValue("10nF").value).toBeCloseTo(10e-9, 15);
      expect(parseSpiceValue("10n").value).toBeCloseTo(10e-9, 15);
      expect(parseSpiceValue("100pf").value).toBeCloseTo(100e-12, 18);
      expect(parseSpiceValue("100pF").value).toBeCloseTo(100e-12, 18);
      expect(parseSpiceValue("100p").value).toBeCloseTo(100e-12, 18);
      expect(parseSpiceValue("1mf").value).toBeCloseTo(1e-3, 10);
      expect(parseSpiceValue("1mF").value).toBeCloseTo(1e-3, 10);
      expect(parseSpiceValue("1m").value).toBeCloseTo(1e-3, 10);
      expect(parseSpiceValue("50nF").value).toBeCloseTo(50e-9, 15);
      expect(parseSpiceValue("50 nF").value).toBeCloseTo(50e-9, 15);
      expect(parseSpiceValue("50 nanofaradios").value).toBeCloseTo(50e-9, 15);
      expect(parseSpiceValue("10 microfaradios").value).toBeCloseTo(10e-6, 15);
    });

    it("parses resistors with shorthand abbreviations (10k, 1k, 1M, 4.7k, 100r, 100)", () => {
      expect(parseSpiceValue("10k").value).toBe(10000);
      expect(parseSpiceValue("1k").value).toBe(1000);
      expect(parseSpiceValue("4.7k").value).toBe(4700);
      expect(parseSpiceValue("1M").value).toBe(1e6);
      expect(parseSpiceValue("2.2M").value).toBe(2.2e6);
      expect(parseSpiceValue("100r").value).toBe(100);
      expect(parseSpiceValue("100R").value).toBe(100);
      expect(parseSpiceValue("100").value).toBe(100);
    });

    it("parses inductors, voltages, currents, and frequencies", () => {
      expect(parseSpiceValue("10mh").value).toBeCloseTo(10e-3, 10);
      expect(parseSpiceValue("10mH").value).toBeCloseTo(10e-3, 10);
      expect(parseSpiceValue("100uh").value).toBeCloseTo(100e-6, 15);
      expect(parseSpiceValue("100uH").value).toBeCloseTo(100e-6, 15);
      expect(parseSpiceValue("1h").value).toBe(1);
      expect(parseSpiceValue("1H").value).toBe(1);
      expect(parseSpiceValue("12v").value).toBe(12);
      expect(parseSpiceValue("12V").value).toBe(12);
      expect(parseSpiceValue("5v").value).toBe(5);
      expect(parseSpiceValue("5V").value).toBe(5);
      expect(parseSpiceValue("500mv").value).toBeCloseTo(0.5, 10);
      expect(parseSpiceValue("500 mV").value).toBeCloseTo(0.5, 10);
      expect(parseSpiceValue("2a").value).toBe(2);
      expect(parseSpiceValue("2A").value).toBe(2);
      expect(parseSpiceValue("100ma").value).toBeCloseTo(0.1, 10);
      expect(parseSpiceValue("100 mA").value).toBeCloseTo(0.1, 10);
      expect(parseSpiceValue("1khz").value).toBe(1000);
      expect(parseSpiceValue("1 kHz").value).toBe(1000);
      expect(parseSpiceValue("50hz").value).toBe(50);
      expect(parseSpiceValue("50 Hz").value).toBe(50);
      expect(parseSpiceValue("10mhz").value).toBe(10e6);
      expect(parseSpiceValue("10 MHz").value).toBe(10e6);
    });
  });

  describe("4. European embedded decimal notation (4k7, 4R7, 2u2, 1n5, 1M5)", () => {
    it("correctly converts embedded prefix notation", () => {
      expect(parseSpiceValue("4k7").value).toBe(4700);
      expect(parseSpiceValue("4K7").value).toBe(4700);
      expect(parseSpiceValue("4R7").value).toBe(4.7);
      expect(parseSpiceValue("0R5").value).toBe(0.5);
      expect(parseSpiceValue("1M5").value).toBe(1.5e6);
      expect(parseSpiceValue("2u2").value).toBeCloseTo(2.2e-6, 15);
      expect(parseSpiceValue("2µ2").value).toBeCloseTo(2.2e-6, 15);
      expect(parseSpiceValue("1n5").value).toBeCloseTo(1.5e-9, 15);
      expect(parseSpiceValue("3p3").value).toBeCloseTo(3.3e-12, 18);
      expect(parseSpiceValue("4k7 ohm").value).toBe(4700);
    });
  });

  describe("5. Error handling and edge cases", () => {
    it("handles empty or invalid strings gracefully", () => {
      expect(parseSpiceValue("").valid).toBe(false);
      expect(parseSpiceValue("   ").valid).toBe(false);
      expect(parseSpiceValue("abc").valid).toBe(false);
      expect(parseSpiceValue("100xyz").valid).toBe(false);
    });
  });

  describe("6. formatSpiceValue", () => {
    it("formats clean SPICE values without floating point glitches", () => {
      expect(formatSpiceValue(10000)).toBe("10k");
      expect(formatSpiceValue(4700)).toBe("4.7k");
      expect(formatSpiceValue(1000000)).toBe("1Meg");
      expect(formatSpiceValue(50e-9)).toBe("50n");
      expect(formatSpiceValue(10e-6)).toBe("10u");
      expect(formatSpiceValue(100e-12)).toBe("100p");
      expect(formatSpiceValue(0.001)).toBe("1m");
      expect(formatSpiceValue(0)).toBe("0");
    });
  });
});
