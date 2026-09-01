import { describe, expect, it } from "vitest";
import { getComponentPins } from "../canvas/component_pins";
import { extractElectricalNetlist } from "../simulation/netlist_extractor";
import {
  findNearestStandardValue,
  synthesizeBjtVoltageDividerBias,
  synthesizeRfAttenuator,
  synthesizeSallenKeyFilter,
  synthesizeTimer555Astable,
  synthesizeZenerRegulator,
  generateSallenKeySchematic,
  generateBjtAmplifierSchematic,
  generateZenerRegulatorSchematic,
  generateTimer555Schematic,
  generateRfAttenuatorSchematic,
  generateMcuBlinkSchematic,
} from "./circuit_synthesizer";

type GeneratedCircuit = ReturnType<typeof generateSallenKeySchematic>["circuit"];

function hasDirectConnection(
  circuit: GeneratedCircuit,
  componentA: string,
  pinA: number,
  componentB: string,
  pinB: number,
): boolean {
  return circuit.wires.some((wire) => {
    const forward = wire.from.componentId === componentA
      && wire.from.pinIndex === pinA
      && wire.to.componentId === componentB
      && wire.to.pinIndex === pinB;
    const reverse = wire.from.componentId === componentB
      && wire.from.pinIndex === pinB
      && wire.to.componentId === componentA
      && wire.to.pinIndex === pinA;
    return forward || reverse;
  });
}

describe("CircuitSynthesizer — Asistente de Síntesis y Dimensionamiento", () => {
  it("encuentra el valor normalizado comercial E24/E96 más cercano", () => {
    // 4.62 kΩ en E24 debe aproximarse a 4.7 kΩ
    expect(findNearestStandardValue(4620, "E24")).toBe(4700);

    // 10.3 kΩ en E24 -> 10.0 kΩ
    expect(findNearestStandardValue(10300, "E24")).toBe(10000);

    // 4.95 kΩ en E96 -> 4.99 kΩ
    expect(findNearestStandardValue(4950, "E96")).toBe(4990);
  });

  it("sintetiza un filtro activo Sallen-Key Butterworth de 2do orden a 10 kHz", () => {
    const result = synthesizeSallenKeyFilter("lowpass", "butterworth", 10000, 10e-9);

    expect(result.filterType).toBe("lowpass");
    expect(result.approximation).toBe("butterworth");
    expect(result.targetCutoffHz).toBe(10000);
    expect(result.r1_standard).toBeGreaterThan(500);
    expect(result.r2_standard).toBeGreaterThan(500);
    expect(result.c1_standard).toBe(10e-9);
    // La frecuencia real con componentes estándar debe estar a menos del 15% del objetivo
    expect(result.actualCutoffHz).toBeGreaterThan(8500);
    expect(result.actualCutoffHz).toBeLessThan(11500);
  });

  it("rechaza la variante paso banda hasta contar con una síntesis validada", () => {
    expect(() => synthesizeSallenKeyFilter("bandpass", "butterworth", 1000)).toThrow(
      "paso banda todavía no tiene una síntesis validada",
    );
  });

  it("sintetiza una red de auto-polarización para BJT (Vcc=12V, Ic=2mA, Vce=6V)", () => {
    const result = synthesizeBjtVoltageDividerBias(12.0, 0.002, 6.0, 100);

    expect(result.vcc).toBe(12.0);
    expect(result.rc_standard).toBeGreaterThan(1000);
    expect(result.re_standard).toBeGreaterThan(100);
    expect(result.r1_standard).toBeGreaterThan(result.r2_standard);
    // Factor de estabilidad S < 15
    expect(result.stabilityFactor).toBeLessThan(15);
    // Ic real calculada con valores comerciales debe estar cerca de 2 mA
    expect(result.actualIcAmps).toBeGreaterThan(0.0015);
    expect(result.actualIcAmps).toBeLessThan(0.0025);
  });

  it("sintetiza un regulador Zener de 5.1V para entrada de 9V-15V", () => {
    const result = synthesizeZenerRegulator(9.0, 15.0, 5.1, 0.02); // 20 mA carga

    expect(result.isSafe).toBe(true);
    expect(result.rs_standard).toBeGreaterThan(50);
    expect(result.rs_powerWatts).toBeGreaterThan(0);
    expect(result.zener_maxPowerWatts).toBeGreaterThan(0);
  });

  it("sintetiza un temporizador 555 astable a 1 kHz con 60% duty cycle", () => {
    const result = synthesizeTimer555Astable(1000, 60, 100e-9);

    expect(result.ra_standard).toBeGreaterThan(100);
    expect(result.rb_standard).toBeGreaterThan(100);
    expect(result.actualFreqHz).toBeGreaterThan(800);
    expect(result.actualFreqHz).toBeLessThan(1200);
    expect(result.actualDutyPercent).toBeGreaterThan(50);
    expect(result.actualDutyPercent).toBeLessThan(75);
  });

  it("sintetiza un atenuador pasivo RF de 6 dB a 50 ohmios (red Pi)", () => {
    const result = synthesizeRfAttenuator(6, 50, "PI");

    expect(result.z0).toBe(50);
    expect(result.attenuationDb).toBe(6);
    expect(result.type).toBe("PI");
    // Para 6 dB / 50 ohms Pi: R_shunt ~ 150.5 ohms, R_series ~ 37.4 ohms
    expect(result.r1_series_std).toBeCloseTo(150, -1);
    expect(result.r2_shunt_std).toBeCloseTo(37.4, -1);
  });

  describe("Generadores procedurales de esquemáticos", () => {
    it("extrae netlists válidas de todos los generadores analógicos corregidos", () => {
      const circuits = [
        generateSallenKeySchematic(2500, "lowpass", "butterworth"),
        generateSallenKeySchematic(2500, "highpass", "butterworth"),
        generateBjtAmplifierSchematic(12, 0.002, 6, 100),
        generateZenerRegulatorSchematic(15, 20, 5.1, 0.05),
        generateTimer555Schematic(1000, 60),
        generateRfAttenuatorSchematic(10, 50, "PI"),
        generateRfAttenuatorSchematic(10, 50, "T"),
      ];

      for (const generated of circuits) {
        const result = extractElectricalNetlist(
          generated.circuit.components,
          generated.circuit.wires,
          getComponentPins,
        );
        expect(result.error, generated.title).toBeUndefined();
        expect(result.netlist.components.length, generated.title).toBeGreaterThan(0);
      }
    });

    it("genera la topología Sallen-Key paso bajas con seguidor ideal de tres pines", () => {
      const pkg = generateSallenKeySchematic(2500, "lowpass", "butterworth");
      expect(pkg.circuit.components.length).toBeGreaterThan(5);
      expect(pkg.circuit.wires.length).toBeGreaterThan(5);
      expect(pkg.circuit.components.some(c => c.id === "U1")).toBe(true);
      expect(pkg.circuit.components.some(c => c.id === "NET_VIN")).toBe(true);
      expect(pkg.circuit.components.some(c => c.id === "NET_VOUT")).toBe(true);
      expect(pkg.circuit.components.find(c => c.id === "U1")?.type).toBe("opamp_ideal");
      expect(hasDirectConnection(pkg.circuit, "R1", 1, "R2", 0)).toBe(true);
      expect(hasDirectConnection(pkg.circuit, "R1", 1, "C1", 0)).toBe(true);
      expect(hasDirectConnection(pkg.circuit, "R2", 1, "C2", 0)).toBe(true);
      expect(hasDirectConnection(pkg.circuit, "U1", 2, "C1", 1)).toBe(true);
      expect(hasDirectConnection(pkg.circuit, "U1", 2, "U1", 1)).toBe(true);
    });

    it("genera la topología dual Sallen-Key paso altas", () => {
      const pkg = generateSallenKeySchematic(2500, "highpass", "butterworth");

      expect(hasDirectConnection(pkg.circuit, "C1", 1, "C2", 0)).toBe(true);
      expect(hasDirectConnection(pkg.circuit, "C1", 1, "R1", 0)).toBe(true);
      expect(hasDirectConnection(pkg.circuit, "C2", 1, "R2", 0)).toBe(true);
      expect(hasDirectConnection(pkg.circuit, "U1", 2, "R1", 1)).toBe(true);
      expect(hasDirectConnection(pkg.circuit, "R2", 1, "GND2", 0)).toBe(true);
    });

    it("genera esquemático de amplificador BJT válido", () => {
      const pkg = generateBjtAmplifierSchematic(12, 0.002, 6, 100);
      expect(pkg.circuit.components.some(c => c.id === "Q1")).toBe(true);
      expect(pkg.circuit.components.some(c => c.id === "RC")).toBe(true);
      expect(pkg.circuit.wires.length).toBeGreaterThan(10);
    });

    it("genera esquemático de regulador Zener válido", () => {
      const pkg = generateZenerRegulatorSchematic(15, 20, 5.1, 0.05);
      expect(pkg.circuit.components.some(c => c.id === "D_ZENER")).toBe(true);
      expect(pkg.circuit.components.some(c => c.id === "RS")).toBe(true);
      expect(pkg.circuit.wires.length).toBeGreaterThan(4);
      expect(hasDirectConnection(pkg.circuit, "RS", 1, "D_ZENER", 1)).toBe(true);
      expect(hasDirectConnection(pkg.circuit, "D_ZENER", 0, "GND_Z", 0)).toBe(true);
    });

    it("no genera un regulador Zener con Vin menor o igual a Vz", () => {
      expect(() => generateZenerRegulatorSchematic(5, 6, 5.1, 0.02)).toThrow(
        "No se puede generar el regulador Zener",
      );
    });

    it("genera un equivalente conductual 555 con salida PULSE coherente", () => {
      const pkg = generateTimer555Schematic(1000, 60);
      expect(pkg.circuit.components.some(c => c.id === "RA")).toBe(true);
      expect(pkg.circuit.components.some(c => c.id === "RB")).toBe(true);
      expect(pkg.circuit.components.some(c => c.id === "C1")).toBe(true);
      const output = pkg.circuit.components.find(c => c.id === "V_OUT");
      expect(output).toMatchObject({ type: "vsource", waveType: "pulse", amplitude: 5 });
      expect(output?.frequency).toBeGreaterThan(800);
      expect(output?.frequency).toBeLessThan(1200);
      expect(output?.dutyCycle).toBeCloseTo(0.6, 1);
      expect(pkg.description).toContain("No representa el circuito interno");
    });

    it.each(["PI", "T"] as const)("genera la conectividad eléctrica correcta para el atenuador %s", (type) => {
      const pkg = generateRfAttenuatorSchematic(10, 50, type);

      expect(pkg.circuit.components.some(c => c.id === "V_RF")).toBe(true);
      if (type === "PI") {
        expect(hasDirectConnection(pkg.circuit, "V_RF", 0, "R1", 0)).toBe(true);
        expect(hasDirectConnection(pkg.circuit, "V_RF", 0, "R2", 0)).toBe(true);
        expect(hasDirectConnection(pkg.circuit, "R2", 1, "R3", 0)).toBe(true);
        expect(hasDirectConnection(pkg.circuit, "R2", 1, "RL", 0)).toBe(true);
      } else {
        expect(hasDirectConnection(pkg.circuit, "V_RF", 0, "R1", 0)).toBe(true);
        expect(hasDirectConnection(pkg.circuit, "R1", 1, "R2", 0)).toBe(true);
        expect(hasDirectConnection(pkg.circuit, "R1", 1, "R3", 0)).toBe(true);
        expect(hasDirectConnection(pkg.circuit, "R3", 1, "RL", 0)).toBe(true);
      }
    });

    it.each([
      ["mcu_8051", 39, 19, 20, 5],
      ["mcu_avr", 6, 7, 18, 5],
      ["esp32", 0, 13, 29, 3.3],
    ] as const)("cablea alimentación, tierra y salida Blink para %s", (type, vccPin, gndPin, outputPin, volts) => {
      const pkg = generateMcuBlinkSchematic(type);
      const source = pkg.circuit.components.find(c => c.id === "VCC");

      expect(source?.value).toBe(volts);
      expect(hasDirectConnection(pkg.circuit, "VCC", 0, "MCU1", vccPin)).toBe(true);
      expect(hasDirectConnection(pkg.circuit, "MCU1", gndPin, "GND_MCU", 0)).toBe(true);
      expect(hasDirectConnection(pkg.circuit, "MCU1", outputPin, "R_LED", 0)).toBe(true);
      expect(hasDirectConnection(pkg.circuit, "R_LED", 1, "LED1", 0)).toBe(true);
      if (type === "esp32") {
        expect(pkg.circuit.components.find(c => c.id === "MCU1")?.esp32SourceCode).toContain("digitalWrite");
      } else {
        expect(pkg.description).toContain("Requiere cargar firmware");
      }
    });
  });
});
