import { describe, expect, it } from "vitest";
import {
  evaluateWaveformMath,
  tokenizeWaveformMath,
  WaveformMathParser,
} from "./waveform_math_parser";
import type { TimeStepResult } from "./oscilloscope_panel";

describe("WaveformMathParser", () => {
  it("tokeniza operadores, números SPICE y canales", () => {
    const tokens = tokenizeWaveformMath("CH1 - CH2 * 1.5k + DERIV(CH1) / 100u");
    const types = tokens.map((t) => t.type);

    expect(types).toEqual([
      "CHANNEL",
      "MINUS",
      "CHANNEL",
      "MUL",
      "NUMBER",
      "PLUS",
      "IDENTIFIER",
      "LPAREN",
      "CHANNEL",
      "RPAREN",
      "DIV",
      "NUMBER",
      "EOF",
    ]);

    const num1 = tokens.find((t) => t.value === "1.5k");
    expect(num1?.numValue).toBe(1500);

    const num2 = tokens.find((t) => t.value === "100u");
    expect(num2?.numValue).toBeCloseTo(0.0001);
  });

  it("construye un AST respetando la precedencia de operadores", () => {
    const parser = new WaveformMathParser("CH1 + CH2 * 2");
    const ast = parser.parse();

    expect(ast.type).toBe("BINARY_OP");
    if (ast.type === "BINARY_OP") {
      expect(ast.op).toBe("+");
      expect(ast.left.type).toBe("CHANNEL");
      expect(ast.right.type).toBe("BINARY_OP");
      if (ast.right.type === "BINARY_OP") {
        expect(ast.right.op).toBe("*");
      }
    }
  });

  it("evalúa CH1 - CH2 (canal diferencial)", () => {
    const results: TimeStepResult[] = [
      { time: 0.0, nodeVoltages: { "1": 5.0, "2": 2.0 }, branchCurrents: {} },
      { time: 0.001, nodeVoltages: { "1": 6.0, "2": 1.5 }, branchCurrents: {} },
      { time: 0.002, nodeVoltages: { "1": 7.0, "2": 3.0 }, branchCurrents: {} },
    ];

    const bindings = { ch1Node: "1", ch2Node: "2", ch3Node: null, ch4Node: null };
    const mathVals = evaluateWaveformMath("CH1 - CH2", results, bindings);

    expect(mathVals).toHaveLength(3);
    expect(mathVals[0]).toBeCloseTo(3.0);
    expect(mathVals[1]).toBeCloseTo(4.5);
    expect(mathVals[2]).toBeCloseTo(4.0);
  });

  it("evalúa CH1 * CH2 (potencia o modulación)", () => {
    const results: TimeStepResult[] = [
      { time: 0.0, nodeVoltages: { "1": 2.0, "2": 3.0 }, branchCurrents: {} },
      { time: 0.001, nodeVoltages: { "1": 4.0, "2": 5.0 }, branchCurrents: {} },
    ];

    const bindings = { ch1Node: "1", ch2Node: "2", ch3Node: null, ch4Node: null };
    const mathVals = evaluateWaveformMath("CH1 * CH2", results, bindings);

    expect(mathVals[0]).toBeCloseTo(6.0);
    expect(mathVals[1]).toBeCloseTo(20.0);
  });

  it("evalúa DERIV(CH1) derivada temporal dV/dt", () => {
    // Rampa lineal: V = 1000 * t (pendiente 1000 V/s)
    const results: TimeStepResult[] = [
      { time: 0.0, nodeVoltages: { "1": 0.0 }, branchCurrents: {} },
      { time: 0.001, nodeVoltages: { "1": 1.0 }, branchCurrents: {} },
      { time: 0.002, nodeVoltages: { "1": 2.0 }, branchCurrents: {} },
      { time: 0.003, nodeVoltages: { "1": 3.0 }, branchCurrents: {} },
    ];

    const bindings = { ch1Node: "1", ch2Node: null, ch3Node: null, ch4Node: null };
    const derivVals = evaluateWaveformMath("DERIV(CH1)", results, bindings);

    expect(derivVals).toHaveLength(4);
    expect(derivVals[0]).toBeCloseTo(1000.0, 1);
    expect(derivVals[1]).toBeCloseTo(1000.0, 1);
    expect(derivVals[2]).toBeCloseTo(1000.0, 1);
  });

  it("evalúa INTEG(CH1) integral numérica trapezoidal", () => {
    // Constante V = 2V => Integral a t = 0.002 es 2 * 0.002 = 0.004
    const results: TimeStepResult[] = [
      { time: 0.0, nodeVoltages: { "1": 2.0 }, branchCurrents: {} },
      { time: 0.001, nodeVoltages: { "1": 2.0 }, branchCurrents: {} },
      { time: 0.002, nodeVoltages: { "1": 2.0 }, branchCurrents: {} },
    ];

    const bindings = { ch1Node: "1", ch2Node: null, ch3Node: null, ch4Node: null };
    const integVals = evaluateWaveformMath("INTEG(CH1)", results, bindings);

    expect(integVals[0]).toBe(0);
    expect(integVals[1]).toBeCloseTo(0.002, 5);
    expect(integVals[2]).toBeCloseTo(0.004, 5);
  });

  it("evalúa FFT(CH1) magnitud de frecuencia sobre señal sinusoidal", () => {
    // 64 muestras de una senoide pura
    const results: TimeStepResult[] = [];
    const N = 64;
    const freq = 100; // 100 Hz
    const T = 0.02; // 20 ms
    for (let i = 0; i < N; i++) {
      const t = (i / N) * T;
      const v = Math.sin(2 * Math.PI * freq * t);
      results.push({ time: t, nodeVoltages: { "1": v }, branchCurrents: {} });
    }

    const bindings = { ch1Node: "1", ch2Node: null, ch3Node: null, ch4Node: null };
    const fftVals = evaluateWaveformMath("FFT(CH1)", results, bindings);

    expect(fftVals).toHaveLength(N);
    // Debe haber un pico significativo distinto de cero en el espectro
    const maxVal = Math.max(...Array.from(fftVals));
    expect(maxVal).toBeGreaterThan(0.1);
  });
});
