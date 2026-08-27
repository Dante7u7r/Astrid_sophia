import type { ComponentInstance, WireInstance } from "../canvas_orchestrator";
import { findWireJunctionPoints } from "../canvas/wiring_model";

export interface CadTitleBlockInfo {
  readonly title: string;
  readonly author: string;
  readonly organization: string;
  readonly revision: string;
  readonly date: string;
  readonly sheet: string;
  readonly approvedBy?: string;
}

export interface CadExportOptions {
  readonly theme: "print_clean" | "cad_dark" | "blueprint";
  readonly includeGrid: boolean;
  readonly includeTitleBlock: boolean;
  readonly titleBlockInfo: CadTitleBlockInfo;
  readonly includeNetLabels: boolean;
  readonly padding?: number;
}

interface ColorPalette {
  readonly background: string;
  readonly frame: string;
  readonly titleBlockBg: string;
  readonly titleBlockBorder: string;
  readonly titleBlockText: string;
  readonly titleBlockAccent: string;
  readonly wire: string;
  readonly junction: string;
  readonly componentBody: string;
  readonly componentStroke: string;
  readonly componentText: string;
  readonly valueText: string;
  readonly netLabelBg: string;
  readonly netLabelBorder: string;
  readonly netLabelText: string;
}

const THEME_PALETTES: Record<CadExportOptions["theme"], ColorPalette> = {
  print_clean: {
    background: "#FFFFFF",
    frame: "#1E293B",
    titleBlockBg: "#F8FAFC",
    titleBlockBorder: "#0F172A",
    titleBlockText: "#0F172A",
    titleBlockAccent: "#0284C7",
    wire: "#0284C7",
    junction: "#0F172A",
    componentBody: "#F1F5F9",
    componentStroke: "#0F172A",
    componentText: "#0F172A",
    valueText: "#475569",
    netLabelBg: "#E0F2FE",
    netLabelBorder: "#0284C7",
    netLabelText: "#0369A1",
  },
  cad_dark: {
    background: "#0D1117",
    frame: "#30363D",
    titleBlockBg: "#161B22",
    titleBlockBorder: "#30363D",
    titleBlockText: "#E6EDF3",
    titleBlockAccent: "#38BDF8",
    wire: "#38BDF8",
    junction: "#F2C94C",
    componentBody: "rgba(22, 27, 34, 0.85)",
    componentStroke: "#7DD3FC",
    componentText: "#E6EDF3",
    valueText: "#94A3B8",
    netLabelBg: "rgba(56, 189, 248, 0.15)",
    netLabelBorder: "#38BDF8",
    netLabelText: "#38BDF8",
  },
  blueprint: {
    background: "#0A2540",
    frame: "#4A90E2",
    titleBlockBg: "#0F3256",
    titleBlockBorder: "#63B3ED",
    titleBlockText: "#EBF8FF",
    titleBlockAccent: "#90CDF4",
    wire: "#63B3ED",
    junction: "#FAF089",
    componentBody: "#0F3256",
    componentStroke: "#EBF8FF",
    componentText: "#EBF8FF",
    valueText: "#BEE3F8",
    netLabelBg: "rgba(99, 179, 237, 0.2)",
    netLabelBorder: "#63B3ED",
    netLabelText: "#EBF8FF",
  },
};

/**
 * Genera un archivo SVG vectorial CAD profesional con bloques de título ISO 7200 / ANSI Y14 y capas estandarizadas.
 */
export function buildCadSchematicSvg(
  components: readonly ComponentInstance[],
  wires: readonly WireInstance[],
  options: CadExportOptions,
): { filename: string; content: string } {
  const palette = THEME_PALETTES[options.theme] || THEME_PALETTES.print_clean;
  const padding = options.padding ?? 60;

  // 1. Calcular caja envolvente del circuito
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;

  for (const c of components) {
    minX = Math.min(minX, c.x - 60);
    minY = Math.min(minY, c.y - 60);
    maxX = Math.max(maxX, c.x + 60);
    maxY = Math.max(maxY, c.y + 60);
  }

  for (const w of wires) {
    for (const p of w.points) {
      minX = Math.min(minX, p.x);
      minY = Math.min(minY, p.y);
      maxX = Math.max(maxX, p.x);
      maxY = Math.max(maxY, p.y);
    }
  }

  if (!Number.isFinite(minX) || !Number.isFinite(minY)) {
    minX = 0;
    minY = 0;
    maxX = 800;
    maxY = 500;
  }

  // Dimensiones del plano (A4 Landscape proporcional)
  const circuitW = maxX - minX;
  const circuitH = maxY - minY;

  const contentW = Math.max(circuitW + padding * 2, 900);
  const contentH = Math.max(circuitH + padding * 2 + (options.includeTitleBlock ? 110 : 0), 600);

  const originX = minX - padding;
  const originY = minY - padding;

  let svg = `<?xml version="1.0" encoding="UTF-8"?>\n`;
  svg += `<svg xmlns="http://www.w3.org/2000/svg" viewBox="${originX} ${originY} ${contentW} ${contentH}" width="${contentW}" height="${contentH}" style="background-color:${palette.background}; font-family:'Inter', -apple-system, sans-serif;">\n`;

  // Estilos embebidos
  svg += `  <defs>\n`;
  svg += `    <style>\n`;
  svg += `      .cad-text { font-family: 'Inter', sans-serif; font-size: 11px; fill: ${palette.componentText}; }\n`;
  svg += `      .cad-value { font-family: 'JetBrains Mono', monospace; font-size: 9px; fill: ${palette.valueText}; }\n`;
  svg += `      .cad-wire { fill: none; stroke: ${palette.wire}; stroke-width: 2; stroke-linecap: round; stroke-linejoin: round; }\n`;
  svg += `      .cad-title-header { font-size: 9px; font-weight: 700; fill: ${palette.titleBlockAccent}; text-transform: uppercase; }\n`;
  svg += `      .cad-title-val { font-size: 11px; font-weight: 600; fill: ${palette.titleBlockText}; }\n`;
  svg += `    </style>\n`;
  svg += `  </defs>\n\n`;

  // CAPA 1: Marco exterior del plano y rejilla de coordenadas (Zone Grid)
  svg += `  <!-- CAPA: MARCO DE PLANO Y ZONAS -->\n`;
  svg += `  <g id="layer-drawing-frame">\n`;
  svg += `    <rect x="${originX + 10}" y="${originY + 10}" width="${contentW - 20}" height="${contentH - 20}" fill="none" stroke="${palette.frame}" stroke-width="2" />\n`;
  svg += `    <rect x="${originX + 16}" y="${originY + 16}" width="${contentW - 32}" height="${contentH - 32}" fill="none" stroke="${palette.frame}" stroke-width="0.75" />\n`;
  svg += `  </g>\n\n`;

  // CAPA 2: Pistas conductoras (Wires) y Nodos de Unión
  svg += `  <!-- CAPA: PISTAS Y CABLES CONDUCTORES -->\n`;
  svg += `  <g id="layer-wires">\n`;
  for (const w of wires) {
    if (!w.points || w.points.length < 2) continue;
    let d = `M ${w.points[0].x} ${w.points[0].y}`;
    for (let i = 1; i < w.points.length; i++) {
      d += ` L ${w.points[i].x} ${w.points[i].y}`;
    }
    svg += `    <path d="${d}" class="cad-wire" />\n`;
  }

  // Nodos de Unión en T
  const junctions = findWireJunctionPoints(wires);
  for (const j of junctions) {
    svg += `    <circle cx="${j.x}" cy="${j.y}" r="3.5" fill="${palette.junction}" stroke="${palette.background}" stroke-width="1" />\n`;
  }
  svg += `  </g>\n\n`;

  // CAPA 3: Componentes y Símbolos
  svg += `  <!-- CAPA: COMPONENTES Y SIMBOLOS ESQUEMATICOS -->\n`;
  svg += `  <g id="layer-components">\n`;
  for (const comp of components) {
    svg += `    <g id="comp-${comp.id}" transform="translate(${comp.x}, ${comp.y}) rotate(${comp.rotation || 0})">\n`;
    svg += renderComponentSvgSymbol(comp, palette);
    svg += `    </g>\n`;
  }
  svg += `  </g>\n\n`;

  // CAPA 4: Etiquetas de Red (Net Labels) y Notas de Texto
  if (options.includeNetLabels) {
    svg += `  <!-- CAPA: ETIQUETAS DE RED Y ANOTACIONES -->\n`;
    svg += `  <g id="layer-annotations">\n`;
    for (const comp of components) {
      if (comp.type === "net_label") {
        const tType = comp.terminalType || (["GND", "0", "0V", "TIERRA", "GROUND", "AGND", "DGND", "EARTH", "CHASSIS"].includes(String(comp.label || comp.value || "").toUpperCase()) ? "ground" : (comp.voltage !== undefined || /^[+-]?\d+(\.\d+)?V?$/i.test(String(comp.label || comp.value || "")) ? "power" : "signal"));
        const netName = String(comp.label || comp.value || "NET");
        const rot = comp.rotation || 0;
        const textLen = Math.max(26, netName.length * 7.5);
        const totalW = textLen + 18;

        svg += `    <g transform="translate(${comp.x}, ${comp.y}) rotate(${rot})">\n`;
        if (tType === "power") {
          svg += `      <line x1="0" y1="0" x2="0" y2="-12" stroke="#F59E0B" stroke-width="1.8" stroke-linecap="round" />\n`;
          svg += `      <polygon points="-6,-12 0,-21 6,-12" fill="#F59E0B" stroke="#F59E0B" stroke-width="1.2" />\n`;
          svg += `      <circle cx="0" cy="0" r="2.5" fill="#F59E0B" />\n`;
          svg += `      <text x="0" y="-26" text-anchor="middle" font-weight="bold" font-size="10" font-family="monospace" fill="#F59E0B">${netName}</text>\n`;
        } else if (tType === "ground") {
          const gStyle = comp.terminalStyle || (["EARTH", "PE"].includes(netName.toUpperCase()) ? "earth" : ["CHASSIS", "CHASIS"].includes(netName.toUpperCase()) ? "chassis" : "standard");
          svg += `      <line x1="0" y1="0" x2="0" y2="10" stroke="#10B981" stroke-width="1.8" stroke-linecap="round" />\n`;
          if (gStyle === "earth") {
            svg += `      <line x1="-11" y1="10" x2="11" y2="10" stroke="#10B981" stroke-width="1.8" />\n`;
            svg += `      <line x1="-7" y1="14" x2="7" y2="14" stroke="#10B981" stroke-width="1.8" />\n`;
            svg += `      <line x1="-3" y1="18" x2="3" y2="18" stroke="#10B981" stroke-width="1.8" />\n`;
            svg += `      <circle cx="0" cy="13" r="13" fill="none" stroke="#10B981" stroke-width="1.5" />\n`;
            svg += `      <text x="0" y="32" text-anchor="middle" font-weight="bold" font-size="9" font-family="monospace" fill="#10B981">${netName}</text>\n`;
          } else if (gStyle === "chassis") {
            svg += `      <line x1="-10" y1="10" x2="10" y2="10" stroke="#10B981" stroke-width="1.8" />\n`;
            svg += `      <line x1="-7" y1="10" x2="-12" y2="17" stroke="#10B981" stroke-width="1.8" />\n`;
            svg += `      <line x1="0" y1="10" x2="-5" y2="17" stroke="#10B981" stroke-width="1.8" />\n`;
            svg += `      <line x1="7" y1="10" x2="2" y2="17" stroke="#10B981" stroke-width="1.8" />\n`;
            svg += `      <text x="0" y="26" text-anchor="middle" font-weight="bold" font-size="9" font-family="monospace" fill="#10B981">${netName}</text>\n`;
          } else {
            svg += `      <line x1="-11" y1="10" x2="11" y2="10" stroke="#10B981" stroke-width="1.8" />\n`;
            svg += `      <line x1="-7" y1="14" x2="7" y2="14" stroke="#10B981" stroke-width="1.8" />\n`;
            svg += `      <line x1="-3" y1="18" x2="3" y2="18" stroke="#10B981" stroke-width="1.8" />\n`;
            svg += `      <text x="0" y="27" text-anchor="middle" font-weight="bold" font-size="9" font-family="monospace" fill="#10B981">${netName}</text>\n`;
          }
          svg += `      <circle cx="0" cy="0" r="2.5" fill="#10B981" />\n`;
        } else if (tType === "input") {
          svg += `      <polygon points="0,0 8,-10 ${totalW},-10 ${totalW},10 8,10" fill="rgba(49, 46, 129, 0.9)" stroke="#818CF8" stroke-width="1.5" />\n`;
          svg += `      <circle cx="0" cy="0" r="2.5" fill="#818CF8" />\n`;
          svg += `      <text x="${8 + (totalW - 8) / 2}" y="3.5" text-anchor="middle" font-weight="bold" font-size="10" font-family="monospace" fill="#E0E7FF">${netName}</text>\n`;
        } else if (tType === "output") {
          svg += `      <polygon points="0,-10 ${totalW - 8},-10 ${totalW},0 ${totalW - 8},10 0,10" fill="rgba(6, 78, 59, 0.85)" stroke="#34D399" stroke-width="1.5" />\n`;
          svg += `      <circle cx="0" cy="0" r="2.5" fill="#34D399" />\n`;
          svg += `      <text x="${(totalW - 8) / 2}" y="3.5" text-anchor="middle" font-weight="bold" font-size="10" font-family="monospace" fill="#E2E8F0">${netName}</text>\n`;
        } else if (tType === "bidirectional") {
          const bW = totalW + 8;
          svg += `      <polygon points="0,0 8,-11 ${bW - 8},-11 ${bW},0 ${bW - 8},11 8,11" fill="rgba(88, 28, 135, 0.9)" stroke="#A855F7" stroke-width="1.5" />\n`;
          svg += `      <circle cx="0" cy="0" r="2.5" fill="#A855F7" />\n`;
          svg += `      <text x="${bW / 2}" y="3.5" text-anchor="middle" font-weight="bold" font-size="9" font-family="monospace" fill="#F3E8FF">&lt; ${netName} &gt;</text>\n`;
        } else if (tType === "bus_tap") {
          svg += `      <polygon points="0,0 9,-12 ${totalW + 4},-12 ${totalW + 4},12 9,12" fill="rgba(120, 53, 15, 0.9)" stroke="#F59E0B" stroke-width="2.0" />\n`;
          svg += `      <circle cx="0" cy="0" r="3" fill="#F59E0B" />\n`;
          svg += `      <text x="${9 + (totalW - 5) / 2}" y="3.5" text-anchor="middle" font-weight="bold" font-size="9" font-family="monospace" fill="#FEF3C7">${netName}</text>\n`;
        } else if (tType === "test_point") {
          svg += `      <circle cx="0" cy="0" r="7" fill="rgba(251, 191, 36, 0.3)" stroke="#FBBF24" stroke-width="1.6" />\n`;
          svg += `      <line x1="-9" y1="0" x2="9" y2="0" stroke="#FBBF24" stroke-width="1.2" />\n`;
          svg += `      <line x1="0" y1="-9" x2="0" y2="9" stroke="#FBBF24" stroke-width="1.2" />\n`;
          svg += `      <circle cx="0" cy="0" r="2" fill="#FBBF24" />\n`;
          svg += `      <text x="0" y="-14" text-anchor="middle" font-weight="bold" font-size="9" font-family="monospace" fill="#FDE68A">${netName}</text>\n`;
        } else if (tType === "no_connect") {
          svg += `      <line x1="-6" y1="-6" x2="6" y2="6" stroke="#EF4444" stroke-width="2.0" stroke-linecap="round" />\n`;
          svg += `      <line x1="-6" y1="6" x2="6" y2="-6" stroke="#EF4444" stroke-width="2.0" stroke-linecap="round" />\n`;
          svg += `      <circle cx="0" cy="0" r="2" fill="#EF4444" />\n`;
          svg += `      <text x="12" y="3" font-weight="bold" font-size="8" font-family="monospace" fill="#FCA5A5">NC</text>\n`;
        } else {
          svg += `      <polygon points="0,0 8,-10 ${totalW},-10 ${totalW},10 8,10" fill="${palette.netLabelBg}" stroke="${palette.netLabelBorder}" stroke-width="1.4" />\n`;
          svg += `      <circle cx="0" cy="0" r="2.5" fill="${palette.netLabelBorder}" />\n`;
          svg += `      <text x="${8 + (totalW - 8) / 2}" y="3.5" text-anchor="middle" font-weight="bold" font-size="10" font-family="monospace" fill="${palette.netLabelText}">${netName}</text>\n`;
        }
        svg += `    </g>\n`;
      } else if (comp.type === "text_note") {
        const noteText = String(comp.value || comp.label || "Nota");
        const lines = noteText.split("\n");
        const fontSize = comp.fontSize || 12;
        const lineHeight = fontSize * 1.38;
        const maxLen = Math.max(...lines.map(l => l.length));
        const boxW = Math.max(80, maxLen * fontSize * 0.6 + 28);
        const boxH = Math.max(36, lines.length * lineHeight + 24);

        svg += `    <g transform="translate(${comp.x}, ${comp.y})">\n`;
        svg += `      <rect x="${-boxW / 2}" y="${-boxH / 2}" width="${boxW}" height="${boxH}" rx="6" fill="${palette.componentBody}" stroke="${palette.componentStroke}" stroke-width="1.2" />\n`;
        svg += `      <rect x="${-boxW / 2}" y="${-boxH / 2}" width="${boxW}" height="3.5" rx="2" fill="${palette.titleBlockAccent}" />\n`;
        lines.forEach((line, idx) => {
          svg += `      <text x="${-boxW / 2 + 14}" y="${-boxH / 2 + 16 + idx * lineHeight}" font-size="${fontSize}" fill="${palette.componentText}" font-family="sans-serif">${line}</text>\n`;
        });
        svg += `    </g>\n`;
      }
    }
    svg += `  </g>\n\n`;
  }

  // CAPA 5: Bloque de Título de Ingeniería (Title Block ISO 7200)
  if (options.includeTitleBlock) {
    const info = options.titleBlockInfo;
    const tbW = 340;
    const tbH = 90;
    const tbX = originX + contentW - tbW - 16;
    const tbY = originY + contentH - tbH - 16;

    svg += `  <!-- CAPA: BLOQUE DE TITULO DE INGENIERIA (ISO 7200 / ANSI) -->\n`;
    svg += `  <g id="layer-title-block" transform="translate(${tbX}, ${tbY})">\n`;
    svg += `    <rect x="0" y="0" width="${tbW}" height="${tbH}" fill="${palette.titleBlockBg}" stroke="${palette.titleBlockBorder}" stroke-width="1.5" />\n`;

    // Divisiones de celdas
    svg += `    <line x1="0" y1="30" x2="${tbW}" y2="30" stroke="${palette.titleBlockBorder}" stroke-width="1" />\n`;
    svg += `    <line x1="0" y1="60" x2="${tbW}" y2="60" stroke="${palette.titleBlockBorder}" stroke-width="1" />\n`;
    svg += `    <line x1="170" y1="30" x2="170" y2="${tbH}" stroke="${palette.titleBlockBorder}" stroke-width="1" />\n`;
    svg += `    <line x1="255" y1="60" x2="255" y2="${tbH}" stroke="${palette.titleBlockBorder}" stroke-width="1" />\n`;

    // Fila 1: Título y Organización
    svg += `    <text x="10" y="14" class="cad-title-header">PROYECTO / ESQUEMA:</text>\n`;
    svg += `    <text x="10" y="25" class="cad-title-val" font-size="12">${info.title || "Circuito Biaani"}</text>\n`;
    svg += `    <text x="${tbW - 10}" y="20" text-anchor="end" class="cad-title-header">${info.organization || "BIAANI"}</text>\n`;

    // Fila 2: Diseñador y Aprobación
    svg += `    <text x="10" y="42" class="cad-title-header">DISEÑADOR / AUTOR:</text>\n`;
    svg += `    <text x="10" y="54" class="cad-title-val">${info.author || "Ingeniería Electrónica"}</text>\n`;
    svg += `    <text x="180" y="42" class="cad-title-header">ESTADO / REVISIÓN:</text>\n`;
    svg += `    <text x="180" y="54" class="cad-title-val">REV ${info.revision || "1.0"}</text>\n`;

    // Fila 3: Fecha y Hoja
    svg += `    <text x="10" y="72" class="cad-title-header">FECHA DE EMISIÓN:</text>\n`;
    svg += `    <text x="10" y="83" class="cad-title-val">${info.date || new Date().toISOString().split("T")[0]}</text>\n`;
    svg += `    <text x="180" y="72" class="cad-title-header">HOJA:</text>\n`;
    svg += `    <text x="180" y="83" class="cad-title-val">${info.sheet || "1 / 1"}</text>\n`;
    svg += `    <text x="265" y="72" class="cad-title-header">COMP.:</text>\n`;
    svg += `    <text x="265" y="83" class="cad-title-val">${components.length}</text>\n`;

    svg += `  </g>\n`;
  }

  svg += `</svg>\n`;

  const safeTitle = (options.titleBlockInfo.title || "plano_esquematico").toLowerCase().replace(/[^a-z0-9]/g, "_");
  return {
    filename: `${safeTitle}_cad_${options.theme}.svg`,
    content: svg,
  };
}

/**
 * Renderiza el símbolo vectorial individual de cada componente para el plano SVG.
 */
function renderComponentSvgSymbol(comp: ComponentInstance, palette: ColorPalette): string {
  let s = "";
  const idLabel = `<text x="0" y="-18" text-anchor="middle" class="cad-text" font-weight="bold">${comp.id}</text>`;
  const valLabel = comp.value !== undefined ? `<text x="0" y="24" text-anchor="middle" class="cad-value">${comp.value}</text>` : "";

  switch (comp.type) {
    case "resistor":
      s += `      <rect x="-24" y="-8" width="48" height="16" fill="${palette.componentBody}" stroke="${palette.componentStroke}" stroke-width="1.8" rx="2" />\n`;
      s += `      <line x1="-34" y1="0" x2="-24" y2="0" stroke="${palette.componentStroke}" stroke-width="1.8" />\n`;
      s += `      <line x1="24" y1="0" x2="34" y2="0" stroke="${palette.componentStroke}" stroke-width="1.8" />\n`;
      break;

    case "capacitor":
      s += `      <line x1="-4" y1="-14" x2="-4" y2="14" stroke="${palette.componentStroke}" stroke-width="2.2" />\n`;
      s += `      <line x1="4" y1="-14" x2="4" y2="14" stroke="${palette.componentStroke}" stroke-width="2.2" />\n`;
      s += `      <line x1="-20" y1="0" x2="-4" y2="0" stroke="${palette.componentStroke}" stroke-width="1.8" />\n`;
      s += `      <line x1="4" y1="0" x2="20" y2="0" stroke="${palette.componentStroke}" stroke-width="1.8" />\n`;
      break;

    case "inductor":
      s += `      <path d="M -24 0 A 6 6 0 0 1 -12 0 A 6 6 0 0 1 0 0 A 6 6 0 0 1 12 0 A 6 6 0 0 1 24 0" fill="none" stroke="${palette.componentStroke}" stroke-width="1.8" />\n`;
      s += `      <line x1="-34" y1="0" x2="-24" y2="0" stroke="${palette.componentStroke}" stroke-width="1.8" />\n`;
      s += `      <line x1="24" y1="0" x2="34" y2="0" stroke="${palette.componentStroke}" stroke-width="1.8" />\n`;
      break;

    case "diode":
    case "led":
      s += `      <polygon points="-10,-10 -10,10 10,0" fill="${palette.componentBody}" stroke="${palette.componentStroke}" stroke-width="1.8" />\n`;
      s += `      <line x1="10" y1="-10" x2="10" y2="10" stroke="${palette.componentStroke}" stroke-width="2" />\n`;
      s += `      <line x1="-24" y1="0" x2="-10" y2="0" stroke="${palette.componentStroke}" stroke-width="1.8" />\n`;
      s += `      <line x1="10" y1="0" x2="24" y2="0" stroke="${palette.componentStroke}" stroke-width="1.8" />\n`;
      break;

    case "ground":
      s += `      <line x1="0" y1="-10" x2="0" y2="0" stroke="${palette.componentStroke}" stroke-width="1.8" />\n`;
      s += `      <line x1="-12" y1="0" x2="12" y2="0" stroke="${palette.componentStroke}" stroke-width="2" />\n`;
      s += `      <line x1="-8" y1="5" x2="8" y2="5" stroke="${palette.componentStroke}" stroke-width="1.8" />\n`;
      s += `      <line x1="-4" y1="10" x2="4" y2="10" stroke="${palette.componentStroke}" stroke-width="1.5" />\n`;
      return s; // No ID / value for ground

    case "vsource":
    case "isource":
      s += `      <circle cx="0" cy="0" r="18" fill="${palette.componentBody}" stroke="${palette.componentStroke}" stroke-width="1.8" />\n`;
      s += `      <line x1="0" y1="-28" x2="0" y2="-18" stroke="${palette.componentStroke}" stroke-width="1.8" />\n`;
      s += `      <line x1="0" y1="18" x2="0" y2="28" stroke="${palette.componentStroke}" stroke-width="1.8" />\n`;
      s += `      <text x="0" y="-5" text-anchor="middle" font-weight="bold" font-size="9" fill="${palette.componentStroke}">+</text>\n`;
      s += `      <text x="0" y="11" text-anchor="middle" font-weight="bold" font-size="9" fill="${palette.componentStroke}">-</text>\n`;
      break;

    case "opamp":
    case "opamp_ideal":
      s += `      <polygon points="-24,-24 -24,24 24,0" fill="${palette.componentBody}" stroke="${palette.componentStroke}" stroke-width="1.8" />\n`;
      s += `      <line x1="-34" y1="-12" x2="-24" y2="-12" stroke="${palette.componentStroke}" stroke-width="1.8" />\n`;
      s += `      <line x1="-34" y1="12" x2="-24" y2="12" stroke="${palette.componentStroke}" stroke-width="1.8" />\n`;
      s += `      <line x1="24" y1="0" x2="34" y2="0" stroke="${palette.componentStroke}" stroke-width="1.8" />\n`;
      s += `      <text x="-16" y="-8" font-size="10" font-weight="bold" fill="${palette.componentStroke}">-</text>\n`;
      s += `      <text x="-16" y="16" font-size="10" font-weight="bold" fill="${palette.componentStroke}">+</text>\n`;
      break;

    case "x": // Subcircuito / Chip DIP
    default:
      const pCount = comp.pinCount ?? 4;
      const pHalf = Math.ceil(pCount / 2);
      const h = Math.max(pHalf * 36, 50);
      s += `      <rect x="-40" y="${-h / 2}" width="80" height="${h}" fill="${palette.componentBody}" stroke="${palette.componentStroke}" stroke-width="1.8" rx="4" />\n`;
      s += `      <circle cx="0" cy="${-h / 2}" r="5" fill="none" stroke="${palette.componentStroke}" stroke-width="1" />\n`;
      s += `      <text x="0" y="4" text-anchor="middle" font-weight="bold" font-size="10" fill="${palette.componentStroke}">${comp.modelName || comp.value || "IC"}</text>\n`;
      break;
  }

  return s + `      ${idLabel}\n      ${valLabel}\n`;
}
