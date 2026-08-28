// ==========================================================================
// COMPONENT RENDER MODEL — Estados visuales, etiquetas y formateo
// ==========================================================================

import type { ComponentInstance } from "../canvas_orchestrator";

const WAVE_LABELS: Record<string, string> = {
  sine: "∿",
  square: "⊓",
  triangle: "△",
  sawtooth: "⩘",
  pulse: "⊓",
  am: "AM",
};

/** Devuelve un glifo compacto para el tipo de onda */
export function formatWaveLabel(waveType: string): string {
  return WAVE_LABELS[waveType] ?? waveType.toUpperCase();
}

/** Formatea frecuencia con sufijo de ingeniería (Hz, kHz, MHz) */
export function formatFreq(hz: number): string {
  if (hz >= 1e6) return `${+(hz / 1e6).toPrecision(4)} MHz`;
  if (hz >= 1e3) return `${+(hz / 1e3).toPrecision(4)} kHz`;
  return `${+hz.toPrecision(4)} Hz`;
}

export interface ComponentVisualState {
  color: string;
  lineWidth: number;
  shadowBlur: number;
}

export interface ComponentLabelLayout {
  idY: number;
  valueY: number;
  idX?: number;
  valueX?: number;
  align?: CanvasTextAlign;
}

export function getComponentVisualState(
  isSelected: boolean,
  isHovered: boolean,
  isClassroom?: boolean,
): ComponentVisualState {
  const isClassroomTheme = isClassroom ?? (
    typeof document !== "undefined" &&
    document.documentElement.getAttribute("data-theme") === "classroom"
  );

  let color = isClassroomTheme ? "#1E293B" : "#E6EAF0";
  let lineWidth = 2;
  let shadowBlur = 0;

  if (isSelected) {
    color = isClassroomTheme ? "#0284C7" : "#38BDF8";
    lineWidth = 2.8;
    shadowBlur = 0;
  } else if (isHovered) {
    color = isClassroomTheme ? "#0369A1" : "#5B9FD6";
    lineWidth = 2.4;
    shadowBlur = 0;
  }

  return {
    color,
    lineWidth,
    shadowBlur,
  };
}

export function shouldDrawStandardLeads(type: ComponentInstance["type"]): boolean {
  return type === "resistor" || type === "capacitor" || type === "inductor"
    || type === "diode" || type === "zener_diode" || type === "schottky_diode"
    || type === "fuse" || type === "ldr" || type === "thermistor" || type === "lamp";
}

export function getComponentLabelLayout(comp: ComponentInstance): ComponentLabelLayout {
  const rot = Math.abs(Math.round(comp.rotation || 0)) % 360;
  const isVertical = rot === 90 || rot === 270;

  if (comp.type === "ground") {
    if (rot === 90) return { idX: 24, idY: 0, valueX: 24, valueY: 0, align: "left" };
    if (rot === 270) return { idX: -24, idY: 0, valueX: -24, valueY: 0, align: "right" };
    if (rot === 180) return { idX: 0, idY: -24, valueX: 0, valueY: -32, align: "center" };
    return { idX: 0, idY: 24, valueX: 0, valueY: 32, align: "center" };
  }
  if (comp.type === "dmm") return { idX: 0, idY: -44, valueX: 0, valueY: 32, align: "center" };
  if (comp.type === "mcu_8051") return { idX: 0, idY: -230, valueX: 0, valueY: 215, align: "center" };
  if (comp.type === "mcu_avr") return { idX: 0, idY: -170, valueX: 0, valueY: 155, align: "center" };
  if (comp.type === "arduino_uno" || comp.type === "esp32" || comp.type === "raspberry_pi_pico") {
    return { idX: 0, idY: -70, valueX: 0, valueY: 75, align: "center" };
  }
  if (comp.type === "x") {
    const pinsLeft = Math.ceil((comp.pinCount ?? 4) / 2);
    const totalHeight = Math.max(pinsLeft * 40, 60);
    return {
      idX: 0,
      idY: -totalHeight / 2 - 10,
      valueX: 0,
      valueY: totalHeight / 2 + 14,
      align: "center",
    };
  }

  // Componentes pasivos, discretos y fuentes de 2 terminales
  if (isVertical) {
    return {
      idX: 24,
      idY: -7,
      valueX: 24,
      valueY: 9,
      align: "left",
    };
  }

  return { idX: 0, idY: -24, valueX: 0, valueY: 32, align: "center" };
}

export function shouldDrawValueLabel(type: ComponentInstance["type"]): boolean {
  return type !== "ground" && type !== "net_label" && type !== "text_note" && type !== "dmm" && type !== "x";
}

function cleanFloat(val: number): string {
  return Number(val.toPrecision(6)).toString();
}

export function formatComponentValue(comp: ComponentInstance): string {
  let formattedVal = comp.value ? comp.value.toString() : "";
  if (comp.type === "resistor") {
    const numericVal = Number(comp.value);
    formattedVal = numericVal >= 1000 ? `${cleanFloat(numericVal / 1000)} kOhm` : `${cleanFloat(numericVal)} Ohm`;
    if (comp.tolerance !== undefined) {
      formattedVal += ` \u00B1${comp.tolerance}%`;
    }
  } else if (comp.type === "capacitor") {
    const numericVal = Number(comp.value);
    formattedVal = numericVal < 1e-6 ? `${cleanFloat(numericVal * 1e9)} nF` : `${cleanFloat(numericVal * 1e6)} uF`;
    if (comp.voltageRating !== undefined) {
      formattedVal += ` ${comp.voltageRating}V`;
    }
  } else if (comp.type === "inductor") {
    const numericVal = Number(comp.value);
    formattedVal = numericVal < 1e-3 ? `${cleanFloat(numericVal * 1e6)} uH` : `${cleanFloat(numericVal * 1e3)} mH`;
    if (comp.currentRating !== undefined) {
      formattedVal += ` ${comp.currentRating}A`;
    }
  } else if (comp.type === "vsource") {
    if (comp.waveType && comp.waveType !== "dc") {
      const amp = comp.amplitude ?? comp.value;
      const freq = comp.frequency ?? 1000;
      if (comp.waveType === "am") {
        const m = comp.modIndex !== undefined ? Math.round(comp.modIndex * 100) : 80;
        formattedVal = `AM ${amp}Vp ${formatFreq(freq)} (m=${m}%)`;
      } else {
        formattedVal = `${formatWaveLabel(comp.waveType)} ${amp}Vp ${formatFreq(freq)}`;
      }
    } else {
      formattedVal = `${comp.value} V`;
    }
  } else if (comp.type === "isource") {
    if (comp.waveType && comp.waveType !== "dc") {
      const amp = comp.amplitude ?? comp.value;
      const freq = comp.frequency ?? 1000;
      if (comp.waveType === "am") {
        const m = comp.modIndex !== undefined ? Math.round(comp.modIndex * 100) : 80;
        formattedVal = `AM ${amp}Ap ${formatFreq(freq)} (m=${m}%)`;
      } else {
        formattedVal = `${formatWaveLabel(comp.waveType)} ${amp}Ap ${formatFreq(freq)}`;
      }
    } else {
      formattedVal = `${comp.value} A`;
    }
  } else if (comp.type === "power_port") {
    const v = comp.value ?? comp.voltage ?? 5;
    formattedVal = `${v} V`;
  } else if (comp.type === "led") {
    formattedVal = comp.ledColor ? `LED ${comp.ledColor.toUpperCase()}` : "LED";
  } else if (comp.type === "potentiometer") {
    const totalR = Number(comp.value);
    const formattedR = totalR >= 1000 ? `${totalR / 1000} kOhm` : `${totalR} Ohm`;
    const wPos = Math.round((comp.wiperPosition ?? 0.5) * 100);
    formattedVal = `${formattedR} (${wPos}%)`;
  } else if (comp.type === "ldr") {
    formattedVal = `${comp.lux ?? 100} Lx`;
  } else if (comp.type === "thermistor") {
    formattedVal = `${comp.temperatureCelsius ?? 25} \u00BA C`;
  } else if (comp.type === "npn" || comp.type === "pnp") {
    formattedVal = `\u03B2=${comp.value || 100}`;
  } else if (comp.type === "lamp" || comp.type === "relay" || comp.type === "buzzer") {
    formattedVal = comp.value.toString().split(";")[0].trim();
  } else if (
    comp.type === "mcu_8051"
    || comp.type === "mcu_avr"
  ) {
    formattedVal = comp.firmwareHex ? "Firmware cargado" : "Sin firmware";
  } else if (
    comp.type === "arduino_uno"
    || comp.type === "esp32"
    || comp.type === "raspberry_pi_pico"
  ) {
    const mode = Number(comp.value);
    const supply = comp.type === "arduino_uno" ? "USB 5 V" : "USB 3.3 V";
    if (comp.firmwareHex) formattedVal = `Firmware cargado · ${supply}`;
    else if (mode === 1) formattedVal = `Modo integrado: Blink · ${supply}`;
    else if (mode === 2) formattedVal = `Modo integrado: Umbral · ${supply}`;
    else if (mode === 3) formattedVal = `Modo integrado: PWM · ${supply}`;
    else formattedVal = `Modo integrado: Seguidor · ${supply}`;
  } else if (comp.type === "switch") {
    formattedVal = comp.switchState ? "Cerrado" : "Abierto";
  } else if (comp.type === "transformer") {
    formattedVal = `${comp.primaryInductance ?? 1e-3} H / ${comp.secondaryInductance ?? 1e-3} H (k=${comp.couplingCoefficient ?? 0.9})`;
  }
  return formattedVal;
}
