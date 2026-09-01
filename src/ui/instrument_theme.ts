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
      gridLine: "rgba(100, 116, 139, 0.14)",
      axisLine: "rgba(71, 85, 105, 0.35)",
      axisText: "#334155",
      subRulerBg: "#F1F5F9",
      subRulerBorder: "#CBD5E1",
      cursorColorA: "#D97706",
      cursorColorB: "#0284C7",
      traceColors: {
        ch1: "#D97706", // Ámbar dorado de alto contraste
        ch2: "#0284C7", // Azul cian profundo
        ch3: "#E11D48", // Rojo carmesí
        ch4: "#059669", // Verde esmeralda profundo
        diff: "#7C3AED", // Violeta técnico
        accent: "#0284C7",
      },
    };
  }

  return {
    isClassroom: false,
    screenBg: "#050811",
    plotAreaBg: "rgba(5, 8, 17, 0.96)",
    gridLine: "rgba(148, 163, 184, 0.10)",
    axisLine: "rgba(148, 163, 184, 0.28)",
    axisText: "#94A3B8",
    subRulerBg: "rgba(10, 16, 30, 0.9)",
    subRulerBorder: "rgba(148, 163, 184, 0.20)",
    cursorColorA: "#FACC15",
    cursorColorB: "#38BDF8",
    traceColors: {
      ch1: "#FACC15", // CH1: Amarillo fósforo / oro brillante
      ch2: "#38BDF8", // CH2: Azul cian brillante (ahora nítido y sin interferencia del retículo)
      ch3: "#F43F5E", // CH3: Rosa neón / magenta vivo
      ch4: "#34D399", // CH4: Verde esmeralda vibrante (distinción limpia y sin confusión con CH1)
      diff: "#C084FC", // DIFF / MATH: Púrpura eléctrico
      accent: "#38BDF8",
    },
  };
}
