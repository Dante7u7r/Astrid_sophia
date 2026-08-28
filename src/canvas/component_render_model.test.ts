import { describe, expect, it } from "vitest";
import type { ComponentInstance } from "../canvas_orchestrator";
import {
  formatComponentValue,
  formatFreq,
  formatWaveLabel,
  getComponentLabelLayout,
  getComponentVisualState,
  shouldDrawStandardLeads,
  shouldDrawValueLabel,
} from "./component_render_model";

function component(
  type: ComponentInstance["type"],
  value: ComponentInstance["value"] = 1,
): ComponentInstance {
  return { id: "X1", type, value, x: 0, y: 0, rotation: 0 };
}

describe("component_render_model", () => {
  it("resuelve color, grosor y brillo por estado visual en modo oscuro y claro", () => {
    expect(getComponentVisualState(false, false, false)).toEqual({
      color: "#E6EAF0",
      lineWidth: 2,
      shadowBlur: 0,
    });
    expect(getComponentVisualState(true, false, false)).toMatchObject({
      color: "#38BDF8",
      lineWidth: 2.8,
      shadowBlur: 0,
    });
    expect(getComponentVisualState(false, true, false)).toMatchObject({
      color: "#5B9FD6",
      lineWidth: 2.4,
      shadowBlur: 0,
    });

    // Modo Classroom (Tema Claro)
    expect(getComponentVisualState(false, false, true)).toEqual({
      color: "#1E293B",
      lineWidth: 2,
      shadowBlur: 0,
    });
    expect(getComponentVisualState(true, false, true)).toMatchObject({
      color: "#0284C7",
      lineWidth: 2.8,
      shadowBlur: 0,
    });
    expect(getComponentVisualState(false, true, true)).toMatchObject({
      color: "#0369A1",
      lineWidth: 2.4,
      shadowBlur: 0,
    });
  });

  it("identifica componentes con leads estandar y labels de valor", () => {
    expect(shouldDrawStandardLeads("resistor")).toBe(true);
    expect(shouldDrawStandardLeads("opamp")).toBe(false);
    expect(shouldDrawStandardLeads("opamp_ideal")).toBe(false);
    expect(shouldDrawValueLabel("resistor")).toBe(true);
    expect(shouldDrawValueLabel("dmm")).toBe(false);
  });

  it("calcula layout de labels para componentes altos", () => {
    expect(getComponentLabelLayout(component("mcu_8051"))).toMatchObject({ idY: -230, valueY: 215 });
    expect(getComponentLabelLayout({ ...component("x"), pinCount: 8 })).toMatchObject({ idY: -90, valueY: 94 });
  });

  it("formatea etiquetas de onda y frecuencias", () => {
    expect(formatWaveLabel("sine")).toBe("∿");
    expect(formatWaveLabel("square")).toBe("⊓");
    expect(formatWaveLabel("triangle")).toBe("△");
    expect(formatWaveLabel("sawtooth")).toBe("⩘");
    expect(formatWaveLabel("pulse")).toBe("⊓");
    expect(formatWaveLabel("am")).toBe("AM");
    expect(formatWaveLabel("custom")).toBe("CUSTOM");

    expect(formatFreq(1e6)).toBe("1 MHz");
    expect(formatFreq(2.5e6)).toBe("2.5 MHz");
    expect(formatFreq(1e3)).toBe("1 kHz");
    expect(formatFreq(440)).toBe("440 Hz");
  });

  it("calcula layout de labels para componentes diversos y rotaciones", () => {
    expect(getComponentLabelLayout(component("ground"))).toMatchObject({ idY: 24, valueY: 32 });
    expect(getComponentLabelLayout(component("dmm"))).toMatchObject({ idY: -44, valueY: 32 });
    expect(getComponentLabelLayout(component("mcu_8051"))).toMatchObject({ idY: -230, valueY: 215 });
    expect(getComponentLabelLayout(component("mcu_avr"))).toMatchObject({ idY: -170, valueY: 155 });
    expect(getComponentLabelLayout(component("esp32"))).toMatchObject({ idY: -70, valueY: 75 });
    expect(getComponentLabelLayout(component("arduino_uno"))).toMatchObject({ idY: -70, valueY: 75 });
    expect(getComponentLabelLayout(component("raspberry_pi_pico"))).toMatchObject({ idY: -70, valueY: 75 });
    expect(getComponentLabelLayout({ ...component("x"), pinCount: 8 })).toMatchObject({ idY: -90, valueY: 94 });
    expect(getComponentLabelLayout(component("resistor"))).toMatchObject({ idX: 0, idY: -24, valueX: 0, valueY: 32, align: "center" });

    // Rotación vertical (90 grados) - evita colisión con leads
    const verticalResistor = { ...component("resistor"), rotation: 90 };
    expect(getComponentLabelLayout(verticalResistor)).toMatchObject({
      idX: 24,
      idY: -7,
      valueX: 24,
      valueY: 9,
      align: "left",
    });
  });

  it("formatea valores visibles sin mojibake", () => {
    expect(formatComponentValue(component("resistor", 2200))).toBe("2.2 kOhm");
    expect(formatComponentValue({ ...component("resistor", 100), tolerance: 5 })).toBe("100 Ohm ±5%");
    expect(formatComponentValue(component("capacitor", 1e-7))).toBe("100 nF");
    expect(formatComponentValue({ ...component("capacitor", 1e-5), voltageRating: 50 })).toBe("10 uF 50V");
    expect(formatComponentValue(component("inductor", 2e-6))).toBe("2 uH");
    expect(formatComponentValue({ ...component("inductor", 2e-2), currentRating: 2 })).toBe("20 mH 2A");

    // VSource & ISource
    expect(formatComponentValue(component("vsource", 12))).toBe("12 V");
    expect(formatComponentValue({ ...component("vsource", 5), waveType: "sine", amplitude: 5, frequency: 1000 })).toBe("∿ 5Vp 1 kHz");
    expect(formatComponentValue({ ...component("vsource", 5), waveType: "am", amplitude: 5, frequency: 1000, modIndex: 0.5 })).toBe("AM 5Vp 1 kHz (m=50%)");
    expect(formatComponentValue(component("isource", 2))).toBe("2 A");
    expect(formatComponentValue({ ...component("isource", 1), waveType: "square", amplitude: 1, frequency: 500 })).toBe("⊓ 1Ap 500 Hz");
    expect(formatComponentValue({ ...component("isource", 1), waveType: "am", amplitude: 1, frequency: 1000 })).toBe("AM 1Ap 1 kHz (m=80%)");

    // Sensores y semiconductores
    expect(formatComponentValue({ ...component("led"), ledColor: "red" })).toBe("LED RED");
    expect(formatComponentValue(component("led"))).toBe("LED");
    expect(formatComponentValue({ ...component("potentiometer", 10000), wiperPosition: 0.75 })).toBe("10 kOhm (75%)");
    expect(formatComponentValue({ ...component("ldr"), lux: 250 })).toBe("250 Lx");
    expect(formatComponentValue({ ...component("thermistor"), temperatureCelsius: 40 })).toBe("40 º C");
    expect(formatComponentValue(component("npn", 150))).toBe("β=150");
    expect(formatComponentValue(component("pnp", 200))).toBe("β=200");
    expect(formatComponentValue(component("relay", "12V;10A"))).toBe("12V");

    // MCUs
    expect(formatComponentValue(component("mcu_8051"))).toBe("Sin firmware");
    expect(formatComponentValue({ ...component("mcu_avr"), firmwareHex: ":00" })).toBe("Firmware cargado");
    expect(formatComponentValue(component("arduino_uno", 1))).toBe("Modo integrado: Blink · USB 5 V");
    expect(formatComponentValue(component("esp32", 2))).toBe("Modo integrado: Umbral · USB 3.3 V");
    expect(formatComponentValue(component("esp32", 3))).toBe("Modo integrado: PWM · USB 3.3 V");
    expect(formatComponentValue(component("esp32", 4))).toBe("Modo integrado: Seguidor · USB 3.3 V");
    expect(formatComponentValue({ ...component("arduino_uno", 1), firmwareHex: ":00" })).toBe("Firmware cargado · USB 5 V");

    // Switches y transformadores
    expect(formatComponentValue({ ...component("switch"), switchState: true })).toBe("Cerrado");
    expect(formatComponentValue({ ...component("switch"), switchState: false })).toBe("Abierto");
    expect(formatComponentValue({ ...component("transformer"), primaryInductance: 1e-3, secondaryInductance: 2e-3, couplingCoefficient: 0.95 }))
      .toBe("0.001 H / 0.002 H (k=0.95)");
  });
});
