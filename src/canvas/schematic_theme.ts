/**
 * schematic_theme.ts — Paleta de Colores y Adaptabilidad Visual para el Lienzo Esquemático (Canvas CAD)
 *
 * Provee colores tipados para cables, buses, niveles de tensión, terminales/pines,
 * símbolos de componentes, capas de selección, cuadrícula y etiquetas.
 */

export interface SchematicThemeColors {
  isClassroom: boolean;
  grid: {
    dotColor: string;
  };
  wire: {
    normal: string;
    selected: string;
    hovered: string;
    netHighlighted: string;
    bus: string;
    busHovered: string;
    ground0V: string;
    highVcc: string;
    negRail: string;
    activeSignal: string;
  };
  component: {
    stroke: string;
    strokeSelected: string;
    strokeHovered: string;
    fill: string;
    labelDefault: string;
    labelSelected: string;
  };
  pin: {
    normal: string;
    hovered: string;
    activeForWire: string;
    connectedDot: string;
  };
  overlays: {
    tempWireStroke: string;
    tempWireNode: string;
    selectionBoxFill: string;
    selectionBoxStroke: string;
    alignmentGuideStroke: string;
    alignmentGuideNode: string;
  };
  probes: {
    ch1: { stroke: string; bgFill: string; text: string };
    ch2: { stroke: string; bgFill: string; text: string };
    ch3: { stroke: string; bgFill: string; text: string };
    ch4: { stroke: string; bgFill: string; text: string };
  };
  erc: {
    errorStroke: string;
    errorFill: string;
    warningStroke: string;
    warningFill: string;
  };
}

export function getSchematicThemeColors(isClassroomExplicit?: boolean): SchematicThemeColors {
  const isClassroom = isClassroomExplicit ?? (
    typeof document !== "undefined" &&
    document.documentElement.getAttribute("data-theme") === "classroom"
  );

  if (isClassroom) {
    return {
      isClassroom: true,
      grid: {
        dotColor: "rgba(100, 116, 139, 0.35)",
      },
      wire: {
        normal: "#334155",
        selected: "#0284C7",
        hovered: "#0369A1",
        netHighlighted: "#0284C7",
        bus: "#4F46E5",
        busHovered: "#6366F1",
        ground0V: "#64748B",
        highVcc: "#DC2626",
        negRail: "#7C3AED",
        activeSignal: "#0284C7",
      },
      component: {
        stroke: "#1E293B",
        strokeSelected: "#0284C7",
        strokeHovered: "#0369A1",
        fill: "rgba(248, 250, 252, 0.95)",
        labelDefault: "#0F172A",
        labelSelected: "#0284C7",
      },
      pin: {
        normal: "#64748B",
        hovered: "#0284C7",
        activeForWire: "#D97706",
        connectedDot: "#0F172A",
      },
      overlays: {
        tempWireStroke: "rgba(2, 132, 199, 0.85)",
        tempWireNode: "#0284C7",
        selectionBoxFill: "rgba(2, 132, 199, 0.12)",
        selectionBoxStroke: "rgba(2, 132, 199, 0.85)",
        alignmentGuideStroke: "rgba(2, 132, 199, 0.85)",
        alignmentGuideNode: "#0284C7",
      },
      probes: {
        ch1: { stroke: "#D97706", bgFill: "#FEF3C7", text: "#92400E" },
        ch2: { stroke: "#0284C7", bgFill: "#E0F2FE", text: "#075985" },
        ch3: { stroke: "#E11D48", bgFill: "#FFE4E6", text: "#9F1239" },
        ch4: { stroke: "#16A34A", bgFill: "#DCFCE7", text: "#166534" },
      },
      erc: {
        errorStroke: "#DC2626",
        errorFill: "rgba(239, 68, 68, 0.20)",
        warningStroke: "#D97706",
        warningFill: "rgba(245, 158, 11, 0.20)",
      },
    };
  }

  return {
    isClassroom: false,
    grid: {
      dotColor: "rgba(148, 163, 184, 0.28)",
    },
    wire: {
      normal: "#8595A6",
      selected: "#38BDF8",
      hovered: "#94A3B8",
      netHighlighted: "#38BDF8",
      bus: "#818CF8",
      busHovered: "#A5B4FC",
      ground0V: "#64748B",
      highVcc: "#F43F5E",
      negRail: "#A855F7",
      activeSignal: "#38BDF8",
    },
    component: {
      stroke: "#E6EAF0",
      strokeSelected: "#38BDF8",
      strokeHovered: "#5B9FD6",
      fill: "rgba(10, 15, 29, 0.90)",
      labelDefault: "#F1F5F9",
      labelSelected: "#38BDF8",
    },
    pin: {
      normal: "#94A3B8",
      hovered: "#38BDF8",
      activeForWire: "#FACC15",
      connectedDot: "#F8FAFC",
    },
    overlays: {
      tempWireStroke: "rgba(56, 189, 248, 0.85)",
      tempWireNode: "#38BDF8",
      selectionBoxFill: "rgba(56, 189, 248, 0.15)",
      selectionBoxStroke: "rgba(56, 189, 248, 0.85)",
      alignmentGuideStroke: "rgba(56, 189, 248, 0.85)",
      alignmentGuideNode: "#38BDF8",
    },
    probes: {
      ch1: { stroke: "#FACC15", bgFill: "rgba(42, 36, 10, 0.95)", text: "#FACC15" },
      ch2: { stroke: "#38BDF8", bgFill: "rgba(10, 32, 48, 0.95)", text: "#38BDF8" },
      ch3: { stroke: "#F43F5E", bgFill: "rgba(42, 12, 24, 0.95)", text: "#F43F5E" },
      ch4: { stroke: "#34D399", bgFill: "rgba(6, 40, 28, 0.95)", text: "#34D399" },
    },
    erc: {
      errorStroke: "hsl(0, 84%, 60%)",
      errorFill: "rgba(239, 68, 68, 0.25)",
      warningStroke: "hsl(38, 96%, 52%)",
      warningFill: "rgba(245, 158, 11, 0.25)",
    },
  };
}
