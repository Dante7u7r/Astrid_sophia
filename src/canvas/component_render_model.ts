import type { ComponentInstance } from "../canvas_orchestrator";

export interface ComponentVisualState {
  color: string;
  lineWidth: number;
  shadowBlur: number;
}

export interface ComponentLabelLayout {
  idY: number;
  valueY: number;
}

const NO_STANDARD_LEADS = new Set<ComponentInstance["type"]>([
  "ground",
  "nmos",
  "pmos",
  "npn",
  "pnp",
  "opamp",
  "relay",
  "mcu_8051",
  "mcu_avr",
  "arduino_uno",
  "esp32",
  "raspberry_pi_pico",
  "x",
  "dmm",
]);

export function getComponentVisualState(
  isSelected: boolean,
  isHovered: boolean,
): ComponentVisualState {
  let color = "hsl(174, 97%, 69%)";
  if (isSelected) {
    color = "hsl(270, 89%, 65%)";
  } else if (isHovered) {
    color = "hsl(210, 100%, 56%)";
  }

  return {
    color,
    lineWidth: isSelected ? 3 : 2,
    shadowBlur: isSelected ? 8 : isHovered ? 4 : 0,
  };
}

export function shouldDrawStandardLeads(type: ComponentInstance["type"]): boolean {
  return !NO_STANDARD_LEADS.has(type);
}

export function getComponentLabelLayout(comp: ComponentInstance): ComponentLabelLayout {
  if (comp.type === "ground") return { idY: 24, valueY: 32 };
  if (comp.type === "dmm") return { idY: -44, valueY: 32 };
  if (comp.type === "mcu_8051") return { idY: -230, valueY: 215 };
  if (comp.type === "mcu_avr") return { idY: -170, valueY: 155 };
  if (comp.type === "arduino_uno" || comp.type === "esp32" || comp.type === "raspberry_pi_pico") {
    return { idY: -70, valueY: 75 };
  }
  if (comp.type === "x") {
    const pinsLeft = Math.ceil((comp.pinCount ?? 4) / 2);
    const totalHeight = Math.max(pinsLeft * 40, 60);
    return {
      idY: -totalHeight / 2 - 10,
      valueY: totalHeight / 2 + 14,
    };
  }
  return { idY: -24, valueY: 32 };
}

export function shouldDrawValueLabel(type: ComponentInstance["type"]): boolean {
  return type !== "ground" && type !== "x" && type !== "dmm";
}

export function formatComponentValue(comp: ComponentInstance): string {
  let formattedVal = comp.value ? comp.value.toString() : "";
  if (comp.type === "resistor") {
    const numericVal = Number(comp.value);
    formattedVal = numericVal >= 1000 ? `${numericVal / 1000} kOhm` : `${numericVal} Ohm`;
  } else if (comp.type === "capacitor") {
    const numericVal = Number(comp.value);
    formattedVal = numericVal < 1e-6 ? `${numericVal * 1e9} nF` : `${numericVal * 1e6} uF`;
  } else if (comp.type === "inductor") {
    const numericVal = Number(comp.value);
    formattedVal = numericVal < 1e-3 ? `${numericVal * 1e6} uH` : `${numericVal * 1e3} mH`;
  } else if (comp.type === "vsource") {
    formattedVal = `${comp.value} V`;
  } else if (comp.type === "lamp" || comp.type === "relay" || comp.type === "buzzer") {
    formattedVal = comp.value.toString().split(";")[0].trim();
  } else if (
    comp.type === "mcu_8051"
    || comp.type === "mcu_avr"
    || comp.type === "arduino_uno"
    || comp.type === "esp32"
    || comp.type === "raspberry_pi_pico"
  ) {
    formattedVal = comp.firmwareHex ? "Firmware cargado" : "Sin firmware";
  } else if (comp.type === "isource") {
    formattedVal = `${comp.value} A`;
  } else if (comp.type === "led") {
    formattedVal = "LED";
  } else if (comp.type === "switch") {
    formattedVal = comp.switchState ? "Cerrado" : "Abierto";
  } else if (comp.type === "transformer") {
    formattedVal = `${comp.primaryInductance ?? 1e-3} H / ${comp.secondaryInductance ?? 1e-3} H (k=${comp.couplingCoefficient ?? 0.9})`;
  }
  return formattedVal;
}
