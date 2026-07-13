import { describe, expect, it } from "vitest";
import type { ComponentInstance } from "../canvas_orchestrator";
import {
  formatComponentValue,
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
  it("resuelve color, grosor y brillo por estado visual", () => {
    expect(getComponentVisualState(false, false)).toEqual({
      color: "hsl(174, 97%, 69%)",
      lineWidth: 2,
      shadowBlur: 0,
    });
    expect(getComponentVisualState(true, false)).toMatchObject({
      color: "hsl(270, 89%, 65%)",
      lineWidth: 3,
      shadowBlur: 8,
    });
    expect(getComponentVisualState(false, true).shadowBlur).toBe(4);
  });

  it("identifica componentes con leads estandar y labels de valor", () => {
    expect(shouldDrawStandardLeads("resistor")).toBe(true);
    expect(shouldDrawStandardLeads("opamp")).toBe(false);
    expect(shouldDrawValueLabel("resistor")).toBe(true);
    expect(shouldDrawValueLabel("dmm")).toBe(false);
  });

  it("calcula layout de labels para componentes altos", () => {
    expect(getComponentLabelLayout(component("mcu_8051"))).toEqual({ idY: -230, valueY: 215 });
    expect(getComponentLabelLayout({ ...component("x"), pinCount: 8 })).toEqual({ idY: -90, valueY: 94 });
  });

  it("formatea valores visibles sin mojibake", () => {
    expect(formatComponentValue(component("resistor", 2200))).toBe("2.2 kOhm");
    expect(formatComponentValue(component("capacitor", 1e-7))).toBe("100 nF");
    expect(formatComponentValue(component("inductor", 2e-6))).toBe("2 uH");
    expect(formatComponentValue({ ...component("switch"), switchState: true })).toBe("Cerrado");
    expect(formatComponentValue({ ...component("mcu_avr"), firmwareHex: ":00" })).toBe("Firmware cargado");
  });
});
