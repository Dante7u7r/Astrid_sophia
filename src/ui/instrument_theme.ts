/**
 * instrument_theme.ts — Paleta de Colores y Adaptabilidad Visual para Instrumentos
 *
 * Provee colores de cuadrícula, fondo de pantalla (CRT vs Papel Técnico),
 * ejes, reglas de tiempo y formas de onda tanto para Modo Laboratorio (Oscuro)
 * como para Modo Proyector / Aula (Claro).
 */

export interface InstrumentThemeColors {
  isClassroom: boolean;
  screenBg: string;
  plotAreaBg: string;
  gridLine: string;
  axisLine: string;
  axisText: string;
  subRulerBg: string;
  subRulerBorder: string;
  cursorColorA: string;
  cursorColorB: string;
  traceColors: {
    ch1: string;
    ch2: string;
    ch3: string;
    ch4: string;
    diff: string;
    accent: string;
  };
}

export function getInstrumentThemeColors(): InstrumentThemeColors {
  const isClassroom =
    typeof document !== "undefined" &&
    document.documentElement.getAttribute("data-theme") === "classroom";

  if (isClassroom) {
    return {
      isClassroom: true,
      screenBg: "#FFFFFF",
      plotAreaBg: "#F8FAFC",
      gridLine: "rgba(2, 132, 199, 0.14)",
      axisLine: "rgba(2, 132, 199, 0.45)",
      axisText: "#334155",
      subRulerBg: "#F1F5F9",
      subRulerBorder: "#CBD5E1",
      cursorColorA: "#D97706",
      cursorColorB: "#0284C7",
      traceColors: {
        ch1: "#D97706", // Ámbar dorado de alto contraste
        ch2: "#0284C7", // Azul cian profundo
        ch3: "#E11D48", // Rojo carmesí
        ch4: "#16A34A", // Verde esmeralda
        diff: "#7C3AED", // Violeta técnico
        accent: "#0284C7",
      },
    };
  }

  return {
    isClassroom: false,
    screenBg: "#030508",
    plotAreaBg: "rgba(4, 9, 20, 0.95)",
    gridLine: "rgba(56, 189, 248, 0.12)",
    axisLine: "rgba(56, 189, 248, 0.35)",
    axisText: "#94A3B8",
    subRulerBg: "rgba(10, 16, 30, 0.9)",
    subRulerBorder: "rgba(79, 156, 249, 0.25)",
    cursorColorA: "#FACC15",
    cursorColorB: "#38BDF8",
    traceColors: {
      ch1: "#FACC15", // Amarillo fósforo brillante
      ch2: "#38BDF8", // Azul cian brillante
      ch3: "#F43F5E", // Rosa brillante
      ch4: "#4ADE80", // Verde neón
      diff: "#C084FC", // Púrpura brillante
      accent: "#38BDF8",
    },
  };
}
