import type { PinInstance, WireInstance } from "../canvas_orchestrator";
import { calculateWireMidpoint } from "./wiring_model";
import { getInstrumentThemeColors } from "../ui/instrument_theme";

export interface TelemetryHistorySample {
  readonly time?: number;
  readonly nodeVoltages?: Readonly<Record<string, number>>;
  readonly branchCurrents?: Readonly<Record<string, number>>;
}

export interface SignalMetrics {
  readonly vInstant?: number;
  readonly vMin: number;
  readonly vMax: number;
  readonly vpp: number;
  readonly vrms: number;
  readonly vdc: number;
  readonly freqHz?: number;
  readonly logicLevel?: "ALTO (5V)" | "ALTO (3.3V)" | "BAJO (0V)" | "PULSOS" | "INDETERMINADO";
}

export interface PinTelemetryOptions {
  readonly componentType?: string;
  readonly componentValue?: string | number;
  readonly connectedCount?: number;
  readonly probeChannel?: "CH1" | "CH2" | "CH3" | "CH4" | null;
  readonly sparMarker?: string | null;
  readonly ercWarning?: string | null;
  readonly netLabel?: string | null;
}

export interface WireTelemetryOptions {
  readonly netLabel?: string | null;
  readonly nodeId?: string | null;
  readonly fromDescriptor?: string | null;
  readonly toDescriptor?: string | null;
  readonly probeChannel?: "CH1" | "CH2" | "CH3" | "CH4" | null;
  readonly isOverloaded?: boolean;
}

/**
 * Formatea un valor numérico con prefijos de ingeniería estándar (p, n, µ, m, k, M, G).
 */
export function formatEngineeringValue(val: number | undefined, unit: string): string {
  if (val === undefined || !Number.isFinite(val)) {
    return `-- ${unit}`;
  }

  const abs = Math.abs(val);
  if (abs === 0 || abs < 1e-12) {
    return `0.000 ${unit}`;
  }

  const sign = val < 0 ? "-" : "";

  if (abs >= 1e6) {
    return `${sign}${(abs / 1e6).toFixed(3)} M${unit}`;
  }
  if (abs >= 1e3) {
    return `${sign}${(abs / 1e3).toFixed(3)} k${unit}`;
  }
  if (abs >= 1) {
    return `${sign}${abs.toFixed(3)} ${unit}`;
  }
  if (abs >= 1e-3) {
    return `${sign}${(abs * 1e3).toFixed(3)} m${unit}`;
  }
  if (abs >= 1e-6) {
    return `${sign}${(abs * 1e6).toFixed(3)} µ${unit}`;
  }
  if (abs >= 1e-9) {
    return `${sign}${(abs * 1e9).toFixed(3)} n${unit}`;
  }
  return `${sign}${(abs * 1e12).toFixed(3)} p${unit}`;
}

/**
 * Extrae puntos recientes de una serie temporal para graficar un mini-osciloscopio sparkline.
 */
export function extractSparklinePoints(
  history: readonly TelemetryHistorySample[] | undefined,
  key: string,
  isCurrent = false,
  maxPoints = 40,
): number[] {
  if (!history || history.length === 0) return [];
  const start = Math.max(0, history.length - maxPoints);
  const points: number[] = [];
  for (let i = start; i < history.length; i++) {
    const s = history[i];
    const map = isCurrent ? s.branchCurrents : s.nodeVoltages;
    const v = map?.[key];
    if (v !== undefined && Number.isFinite(v)) {
      points.push(v);
    }
  }
  return points;
}

/**
 * Calcula métricas eléctricas clave (Vpp, Vrms, Vdc, frecuencia estimada y nivel lógico)
 * a partir del historial transitorio disponible.
 */
export function calculateSignalMetrics(
  history: readonly TelemetryHistorySample[] | undefined,
  key: string,
  instantVoltage?: number,
  isCurrent = false,
): SignalMetrics | null {
  if (!history || history.length < 2) {
    if (instantVoltage !== undefined && Number.isFinite(instantVoltage)) {
      return {
        vInstant: instantVoltage,
        vMin: instantVoltage,
        vMax: instantVoltage,
        vpp: 0,
        vrms: Math.abs(instantVoltage),
        vdc: instantVoltage,
        logicLevel: instantVoltage >= 2.4 ? "ALTO (5V)" : (instantVoltage <= 0.8 ? "BAJO (0V)" : "INDETERMINADO"),
      };
    }
    return null;
  }

  const rawValues: number[] = [];
  const times: number[] = [];

  for (const s of history) {
    const map = isCurrent ? s.branchCurrents : s.nodeVoltages;
    const v = map?.[key];
    if (v !== undefined && Number.isFinite(v)) {
      rawValues.push(v);
      if (s.time !== undefined && Number.isFinite(s.time)) {
        times.push(s.time);
      }
    }
  }

  if (rawValues.length === 0) return null;

  let min = rawValues[0];
  let max = rawValues[0];
  let sum = 0;
  let sumSq = 0;

  for (let i = 0; i < rawValues.length; i++) {
    const val = rawValues[i];
    if (val < min) min = val;
    if (val > max) max = val;
    sum += val;
    sumSq += val * val;
  }

  const n = rawValues.length;
  const vdc = sum / n;
  const vrms = Math.sqrt(sumSq / n);
  const vpp = max - min;

  // Detección de frecuencia por cruces por el promedio DC
  let freqHz: number | undefined;
  if (times.length === rawValues.length && vpp > 1e-4 && times.length >= 4) {
    const crossings: number[] = [];
    for (let i = 1; i < rawValues.length; i++) {
      const prev = rawValues[i - 1] - vdc;
      const curr = rawValues[i] - vdc;
      if (prev <= 0 && curr > 0) {
        // Interpolación lineal del tiempo de cruce ascendente
        const tPrev = times[i - 1];
        const tCurr = times[i];
        const fraction = -prev / (curr - prev);
        crossings.push(tPrev + fraction * (tCurr - tPrev));
      }
    }
    if (crossings.length >= 2) {
      const totalTimeSpan = crossings[crossings.length - 1] - crossings[0];
      const cycles = crossings.length - 1;
      if (totalTimeSpan > 1e-15 && cycles >= 1) {
        const period = totalTimeSpan / cycles;
        if (period > 1e-15) {
          freqHz = 1 / period;
        }
      }
    }
  }

  // Detección de nivel lógico digital
  const vCheck = instantVoltage !== undefined && Number.isFinite(instantVoltage) ? instantVoltage : rawValues[rawValues.length - 1];
  let logicLevel: SignalMetrics["logicLevel"];
  if (vpp > 1.5 && min <= 0.8 && max >= 2.4) {
    logicLevel = "PULSOS";
  } else if (vCheck >= 3.0) {
    logicLevel = "ALTO (5V)";
  } else if (vCheck >= 2.0) {
    logicLevel = "ALTO (3.3V)";
  } else if (vCheck <= 0.8) {
    logicLevel = "BAJO (0V)";
  } else {
    logicLevel = "INDETERMINADO";
  }

  return {
    vInstant: vCheck,
    vMin: min,
    vMax: max,
    vpp,
    vrms,
    vdc,
    freqHz,
    logicLevel,
  };
}

/**
 * Dibuja un mini osciloscopio vectorial (Sparkline Scope) de alta resolución.
 */
export function drawSparkline(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  width: number,
  height: number,
  points: readonly number[],
  strokeColor?: string,
): void {
  if (points.length < 2) return;

  const theme = getInstrumentThemeColors();
  const effectiveStroke = strokeColor ?? (theme.isClassroom ? "#0284C7" : "#38BDF8");

  let min = points[0];
  let max = points[0];
  for (let i = 1; i < points.length; i++) {
    const p = points[i];
    if (p < min) min = p;
    if (p > max) max = p;
  }

  ctx.save();

  // Mini pantalla de osciloscopio adaptada al tema
  ctx.fillStyle = theme.isClassroom ? "#F8FAFC" : "rgba(10, 15, 26, 0.90)";
  ctx.strokeStyle = theme.isClassroom ? "rgba(2, 132, 199, 0.35)" : "rgba(56, 189, 248, 0.30)";
  ctx.lineWidth = 0.8;
  ctx.beginPath();
  if (typeof ctx.roundRect === "function") {
    ctx.roundRect(x, y, width, height, 3);
  } else {
    ctx.rect(x, y, width, height);
  }
  ctx.fill();
  ctx.stroke();

  // Retícula central
  ctx.strokeStyle = theme.isClassroom ? "rgba(2, 132, 199, 0.12)" : "rgba(255, 255, 255, 0.08)";
  ctx.beginPath();
  ctx.moveTo(x, y + height / 2);
  ctx.lineTo(x + width, y + height / 2);
  ctx.moveTo(x + width / 2, y);
  ctx.lineTo(x + width / 2, y + height);
  ctx.stroke();

  const span = max - min;
  const paddingY = 3;
  const plotH = Math.max(height - paddingY * 2, 2);
  const plotY = y + paddingY;

  // Línea de referencia 0V si la señal cruza por cero
  if (min < 0 && max > 0 && span > 1e-9) {
    const zeroY = plotY + plotH * (1 - (0 - min) / span);
    ctx.strokeStyle = theme.isClassroom ? "rgba(100, 116, 139, 0.5)" : "rgba(148, 163, 184, 0.4)";
    ctx.setLineDash([2, 2]);
    ctx.beginPath();
    ctx.moveTo(x, zeroY);
    ctx.lineTo(x + width, zeroY);
    ctx.stroke();
    ctx.setLineDash([]);
  }

  // Trazo vectorial de la forma de onda
  ctx.beginPath();
  const stepX = width / (points.length - 1);
  for (let i = 0; i < points.length; i++) {
    const ptX = x + i * stepX;
    const normY = span < 1e-9 ? 0.5 : (points[i] - min) / span;
    const ptY = plotY + plotH * (1 - normY);
    if (i === 0) ctx.moveTo(ptX, ptY);
    else ctx.lineTo(ptX, ptY);
  }

  ctx.strokeStyle = effectiveStroke;
  ctx.lineWidth = 1.3;
  ctx.stroke();

  // Indicador de amplitud pico a pico (Vpp / Ipp)
  ctx.font = "6px 'JetBrains Mono', monospace";
  ctx.fillStyle = theme.isClassroom ? "rgba(51, 65, 85, 0.85)" : "rgba(226, 232, 240, 0.75)";
  ctx.textAlign = "right";
  const ppLabel = span >= 1 ? `${span.toFixed(2)}V` : `${(span * 1000).toFixed(0)}mV`;
  ctx.fillText(ppLabel, x + width - 3, y + 8);

  ctx.restore();
}
/**
 * Dibuja un HUD de telemetría flotante para un Pin/Nodo con Mini-Osciloscopio y Métricas Avanzadas.
 */
export function renderPinTelemetryHud(
  ctx: CanvasRenderingContext2D,
  pin: PinInstance,
  nodeId: string | undefined,
  voltage: number | undefined,
  current: number | undefined,
  history?: readonly TelemetryHistorySample[],
  options?: PinTelemetryOptions,
): void {
  const theme = getInstrumentThemeColors();
  const pinDescriptor = pin.name ? ` • ${pin.name}` : (pin.label ? ` • ${pin.label}` : "");
  const compVal = options?.componentValue !== undefined ? ` (${options.componentValue})` : "";
  const compHeader = `[${pin.componentId}]${compVal} Pin ${pin.pinIndex}${pinDescriptor}`;

  let nodeTitle: string;
  if (nodeId === "0") {
    nodeTitle = "Red: GND (0V • Tierra de Referencia)";
  } else if (options?.netLabel) {
    nodeTitle = `Red: ${options.netLabel}${nodeId ? ` (Nodo ${nodeId})` : ""}`;
  } else if (nodeId !== undefined) {
    nodeTitle = `Nodo Eléctrico: ${nodeId}`;
  } else {
    nodeTitle = "Terminal no asignado a nodo";
  }

  const isSimulated = voltage !== undefined || current !== undefined || (history && history.length > 0);
  const voltText = `V: ${formatEngineeringValue(voltage, "V")}`;
  const currText = `I: ${formatEngineeringValue(current, "A")}`;

  const headerColor = theme.isClassroom ? "#0284C7" : "#38BDF8";
  const subHeaderColor = theme.isClassroom ? "#475569" : "#94A3B8";
  const voltColor = theme.isClassroom ? "#0F172A" : "#E6EAF0";
  const currColor = theme.isClassroom ? "#B45309" : "#F2C94C";

  const lines: { text: string; color: string; font: string }[] = [
    { text: compHeader, color: headerColor, font: "bold 9px 'Inter', sans-serif" },
    { text: nodeTitle, color: subHeaderColor, font: "600 8.5px 'Inter', sans-serif" },
  ];

  if (options?.probeChannel) {
    lines.push({
      text: `📍 Sonda Activa: ${options.probeChannel} (Osciloscopio)`,
      color: theme.isClassroom ? "#0284C7" : "#38BDF8",
      font: "bold 8.5px 'Inter', sans-serif",
    });
  }

  if (options?.sparMarker) {
    lines.push({
      text: `📡 Puerto RF S-Parameters: ${options.sparMarker}`,
      color: "#10B981",
      font: "bold 8.5px 'Inter', sans-serif",
    });
  }

  if (isSimulated) {
    lines.push({ text: voltText, color: voltColor, font: "600 9px 'JetBrains Mono', monospace" });
    if (current !== undefined) {
      lines.push({ text: currText, color: currColor, font: "600 9px 'JetBrains Mono', monospace" });
    }

    const metrics = nodeId ? calculateSignalMetrics(history, nodeId, voltage, false) : null;
    if (metrics && metrics.vpp > 0.05) {
      const statsLine = `Vpp: ${formatEngineeringValue(metrics.vpp, "V")} | Vrms: ${formatEngineeringValue(metrics.vrms, "V")}`;
      lines.push({ text: statsLine, color: theme.isClassroom ? "#2563EB" : "#60A5FA", font: "600 8.5px 'JetBrains Mono', monospace" });
      if (metrics.freqHz !== undefined && metrics.freqHz > 0) {
        lines.push({
          text: `Frecuencia: ${formatEngineeringValue(metrics.freqHz, "Hz")}`,
          color: theme.isClassroom ? "#16A34A" : "#4ADE80",
          font: "600 8.5px 'JetBrains Mono', monospace",
        });
      }
    } else if (metrics && metrics.logicLevel) {
      lines.push({
        text: `Nivel Lógico: [${metrics.logicLevel}]`,
        color: metrics.logicLevel.startsWith("ALTO") ? "#10B981" : (metrics.logicLevel.startsWith("BAJO") ? "#94A3B8" : "#F59E0B"),
        font: "bold 8.5px 'Inter', sans-serif",
      });
    }
  } else {
    // Modo de diseño / Pre-simulación
    const connInfo = options?.connectedCount !== undefined && options.connectedCount > 0
      ? `Conexión: ${options.connectedCount} cable(s) enlazados`
      : "Conexión: Pin Abierto (Sin cable)";
    lines.push({
      text: connInfo,
      color: options?.connectedCount ? (theme.isClassroom ? "#0F172A" : "#CBD5E1") : "#F59E0B",
      font: "8.5px 'Inter', sans-serif",
    });
  }

  if (options?.ercWarning) {
    lines.push({
      text: `⚠️ ERC: ${options.ercWarning}`,
      color: "#EF4444",
      font: "bold 8.5px 'Inter', sans-serif",
    });
  }

  const sparkPoints = nodeId ? extractSparklinePoints(history, nodeId, false, 35) : [];
  const sparkline = sparkPoints.length >= 2 ? { points: sparkPoints, color: headerColor } : undefined;

  renderHudBox(ctx, pin.x, pin.y, lines, "bottom", sparkline);
}

/**
 * Dibuja un HUD de telemetría flotante para un Cable con Mini-Osciloscopio integrado y Terminales Conectados.
 */
export function renderWireTelemetryHud(
  ctx: CanvasRenderingContext2D,
  wire: WireInstance,
  voltage: number | undefined,
  current: number | undefined,
  nodeId?: string,
  history?: readonly TelemetryHistorySample[],
  options?: WireTelemetryOptions,
): void {
  const mid = calculateWireMidpoint(wire.points);
  if (!mid) return;

  const theme = getInstrumentThemeColors();
  const arrow = current !== undefined && Math.abs(current) > 1e-7
    ? (current >= 0 ? " ➔" : " ⬅")
    : "";

  const resolvedNet = options?.netLabel || wire.label;
  let wireTitle: string;
  if (resolvedNet) {
    wireTitle = `Red: ${resolvedNet}${nodeId ? ` (Nodo ${nodeId})` : ""}`;
  } else if (nodeId === "0") {
    wireTitle = "Pista: GND (0V • Masa)";
  } else if (nodeId !== undefined) {
    wireTitle = `Pista: Nodo Eléctrico ${nodeId}`;
  } else {
    wireTitle = "Pista Conductora";
  }

  const headerColor = theme.isClassroom ? "#0284C7" : "#38BDF8";
  const subHeaderColor = theme.isClassroom ? "#475569" : "#94A3B8";
  const voltColor = theme.isClassroom ? "#0F172A" : "#E6EAF0";
  const currColor = theme.isClassroom ? "#B45309" : "#F2C94C";

  const lines: { text: string; color: string; font: string }[] = [
    { text: wireTitle, color: headerColor, font: "bold 9px 'Inter', sans-serif" },
  ];

  // Endpoints conectados
  const fromDesc = options?.fromDescriptor || `${wire.from.componentId}:${wire.from.pinIndex}`;
  const toDesc = options?.toDescriptor || `${wire.to.componentId}:${wire.to.pinIndex}`;
  lines.push({
    text: `Enlace: ${fromDesc} ➔ ${toDesc}`,
    color: subHeaderColor,
    font: "8.5px 'JetBrains Mono', monospace",
  });

  if (options?.probeChannel) {
    lines.push({
      text: `📍 Sonda Activa: ${options.probeChannel}`,
      color: theme.isClassroom ? "#0284C7" : "#38BDF8",
      font: "bold 8.5px 'Inter', sans-serif",
    });
  }

  const isSimulated = voltage !== undefined || current !== undefined || (history && history.length > 0);
  if (isSimulated) {
    const voltText = `V: ${formatEngineeringValue(voltage, "V")}`;
    const currText = `I: ${formatEngineeringValue(Math.abs(current ?? 0), "A")}${arrow}`;
    lines.push({ text: voltText, color: voltColor, font: "600 9px 'JetBrains Mono', monospace" });
    lines.push({ text: currText, color: currColor, font: "600 9px 'JetBrains Mono', monospace" });

    const lookupKey = nodeId || `${wire.from.componentId}:${wire.from.pinIndex}`;
    const metrics = lookupKey ? calculateSignalMetrics(history, lookupKey, voltage, false) : null;
    if (metrics && metrics.vpp > 0.05) {
      const statsLine = `Vpp: ${formatEngineeringValue(metrics.vpp, "V")} | Vrms: ${formatEngineeringValue(metrics.vrms, "V")}`;
      lines.push({ text: statsLine, color: theme.isClassroom ? "#2563EB" : "#60A5FA", font: "600 8.5px 'JetBrains Mono', monospace" });
      if (metrics.freqHz !== undefined && metrics.freqHz > 0) {
        lines.push({
          text: `Frecuencia: ${formatEngineeringValue(metrics.freqHz, "Hz")}`,
          color: theme.isClassroom ? "#16A34A" : "#4ADE80",
          font: "600 8.5px 'JetBrains Mono', monospace",
        });
      }
    }
  }

  if (options?.isOverloaded) {
    lines.push({
      text: "⚠️ ¡Alta densidad de corriente en pista!",
      color: "#EF4444",
      font: "bold 8.5px 'Inter', sans-serif",
    });
  }

  const lookupKey = nodeId || `${wire.from.componentId}:${wire.from.pinIndex}`;
  const sparkPoints = extractSparklinePoints(history, lookupKey, false, 35);
  const sparkline = sparkPoints.length >= 2 ? { points: sparkPoints, color: headerColor } : undefined;

  renderHudBox(ctx, mid.x, mid.y, lines, "bottom", sparkline);
}

/**
 * Dibuja un HUD de telemetría flotante para un Empalme o Unión en T (Junction Point).
 */
export function renderJunctionTelemetryHud(
  ctx: CanvasRenderingContext2D,
  pos: { x: number; y: number },
  nodeId: string | undefined,
  netLabel: string | undefined,
  connectedBranchesCount: number,
  voltage: number | undefined,
  current: number | undefined,
  history?: readonly TelemetryHistorySample[],
  probeChannel?: "CH1" | "CH2" | "CH3" | "CH4" | null,
): void {
  const theme = getInstrumentThemeColors();
  let nodeTitle: string;
  if (nodeId === "0") {
    nodeTitle = "Empalme GND (0V • Masa)";
  } else if (netLabel) {
    nodeTitle = `Empalme Red: ${netLabel}${nodeId ? ` (Nodo ${nodeId})` : ""}`;
  } else if (nodeId !== undefined) {
    nodeTitle = `Empalme: Nodo Eléctrico ${nodeId}`;
  } else {
    nodeTitle = "Empalme de Cables";
  }

  const headerColor = theme.isClassroom ? "#0284C7" : "#38BDF8";
  const subHeaderColor = theme.isClassroom ? "#475569" : "#94A3B8";
  const voltColor = theme.isClassroom ? "#0F172A" : "#E6EAF0";
  const currColor = theme.isClassroom ? "#B45309" : "#F2C94C";

  const lines: { text: string; color: string; font: string }[] = [
    { text: nodeTitle, color: headerColor, font: "bold 9px 'Inter', sans-serif" },
    { text: `Topología: ${connectedBranchesCount} ramales en contacto`, color: subHeaderColor, font: "8.5px 'Inter', sans-serif" },
  ];

  if (probeChannel) {
    lines.push({
      text: `📍 Sonda Activa: ${probeChannel}`,
      color: theme.isClassroom ? "#0284C7" : "#38BDF8",
      font: "bold 8.5px 'Inter', sans-serif",
    });
  }

  const isSimulated = voltage !== undefined || current !== undefined || (history && history.length > 0);
  if (isSimulated) {
    lines.push({ text: `V: ${formatEngineeringValue(voltage, "V")}`, color: voltColor, font: "600 9px 'JetBrains Mono', monospace" });
    if (current !== undefined) {
      lines.push({ text: `I: ${formatEngineeringValue(current, "A")}`, color: currColor, font: "600 9px 'JetBrains Mono', monospace" });
    }

    const metrics = nodeId ? calculateSignalMetrics(history, nodeId, voltage, false) : null;
    if (metrics && metrics.vpp > 0.05) {
      const statsLine = `Vpp: ${formatEngineeringValue(metrics.vpp, "V")} | Vrms: ${formatEngineeringValue(metrics.vrms, "V")}`;
      lines.push({ text: statsLine, color: theme.isClassroom ? "#2563EB" : "#60A5FA", font: "600 8.5px 'JetBrains Mono', monospace" });
      if (metrics.freqHz !== undefined && metrics.freqHz > 0) {
        lines.push({
          text: `Frecuencia: ${formatEngineeringValue(metrics.freqHz, "Hz")}`,
          color: theme.isClassroom ? "#16A34A" : "#4ADE80",
          font: "600 8.5px 'JetBrains Mono', monospace",
        });
      }
    }
  }

  const sparkPoints = nodeId ? extractSparklinePoints(history, nodeId, false, 35) : [];
  const sparkline = sparkPoints.length >= 2 ? { points: sparkPoints, color: headerColor } : undefined;

  renderHudBox(ctx, pos.x, pos.y, lines, "bottom", sparkline);
}

/**
 * Dibuja un HUD de telemetría flotante para un Componente con Cálculo de Potencia (P = V · I) y Alerta de Sobrecarga.
 */
export function renderComponentTelemetryHud(
  ctx: CanvasRenderingContext2D,
  component: { id: string; type: string; value?: string | number; x: number; y: number },
  voltageDrop: number | undefined,
  current: number | undefined,
  powerRatingWatts = 0.25,
): void {
  const theme = getInstrumentThemeColors();
  const title = `[${component.id}] ${component.type.toUpperCase()}${component.value !== undefined ? ` (${component.value})` : ""}`;
  const vText = `ΔV: ${formatEngineeringValue(voltageDrop !== undefined ? Math.abs(voltageDrop) : undefined, "V")}`;
  const iText = `I: ${formatEngineeringValue(current !== undefined ? Math.abs(current) : undefined, "A")}`;

  const hasPower = voltageDrop !== undefined && current !== undefined && Number.isFinite(voltageDrop) && Number.isFinite(current);
  const powerWatts = hasPower ? Math.abs(voltageDrop * current) : undefined;
  const pText = `P: ${formatEngineeringValue(powerWatts, "W")}`;

  const isOverloaded = component.type === "resistor" && powerWatts !== undefined && powerWatts > powerRatingWatts;

  const headerColor = theme.isClassroom ? "#0284C7" : "#38BDF8";
  const voltColor = theme.isClassroom ? "#0F172A" : "#E6EAF0";
  const currColor = theme.isClassroom ? "#B45309" : "#F2C94C";
  const pColor = theme.isClassroom ? "#16A34A" : "#4ADE80";

  const lines = [
    { text: title, color: headerColor, font: "bold 9px 'Inter', sans-serif" },
    { text: vText, color: voltColor, font: "600 9px 'JetBrains Mono', monospace" },
    { text: iText, color: currColor, font: "600 9px 'JetBrains Mono', monospace" },
    { text: pText, color: pColor, font: "600 9px 'JetBrains Mono', monospace" },
  ];

  if (isOverloaded && powerWatts !== undefined) {
    const pct = ((powerWatts / powerRatingWatts) * 100).toFixed(0);
    lines.push({
      text: `⚠️ SOBRECARGA: ${pct}% del límite (${powerRatingWatts}W)`,
      color: "#EF4444",
      font: "bold 8.5px 'Inter', sans-serif",
    });
  }

  renderHudBox(ctx, component.x, component.y, lines, "bottom");
}

export function renderHudBox(
  ctx: CanvasRenderingContext2D,
  anchorX: number,
  anchorY: number,
  lines: { text: string; color: string; font: string }[],
  placement: "bottom" | "top" = "bottom",
  sparkline?: { points: readonly number[]; color: string },
): void {
  if (lines.length === 0) return;

  const theme = getInstrumentThemeColors();
  ctx.save();

  const lineHeight = 13;
  const paddingX = 9;
  const paddingY = 7;
  const pointerHeight = 6;
  const pointerHalfWidth = 5;
  const hasSpark = Boolean(sparkline && sparkline.points.length >= 2);
  const sparkHeight = hasSpark ? 26 : 0;
  const sparkMarginTop = hasSpark ? 5 : 0;

  let maxWidth = 0;
  for (const line of lines) {
    ctx.font = line.font;
    const w = ctx.measureText(line.text).width;
    if (w > maxWidth) maxWidth = w;
  }

  const minBoxWidth = hasSpark ? 115 : 85;
  const boxW = Math.max(maxWidth + paddingX * 2, minBoxWidth);
  const boxH = lines.length * lineHeight + paddingY * 2 + sparkHeight + sparkMarginTop;

  // Auto-flip si la caja sobrepasa el límite superior
  const effectivePlacement = (placement === "bottom" && (anchorY - boxH - pointerHeight - 10) < 0) ? "top" : placement;

  const boxX = anchorX - boxW / 2;
  const boxY = effectivePlacement === "bottom" ? anchorY - boxH - pointerHeight - 4 : anchorY + pointerHeight + 6;

  // 1. Fondo adaptativo de alto contraste, elevación y desenfoque suave
  ctx.save();
  ctx.shadowColor = theme.isClassroom ? "rgba(15, 23, 42, 0.18)" : "rgba(0, 0, 0, 0.70)";
  ctx.shadowBlur = theme.isClassroom ? 8 : 14;
  ctx.shadowOffsetY = effectivePlacement === "bottom" ? 3 : -2;

  ctx.fillStyle = theme.isClassroom ? "#FFFFFF" : "rgba(11, 17, 32, 0.96)";
  ctx.strokeStyle = theme.isClassroom ? "#94A3B8" : "rgba(56, 189, 248, 0.40)";
  ctx.lineWidth = 1;

  // Dibujar cuerpo redondeado
  ctx.beginPath();
  if (typeof ctx.roundRect === "function") {
    ctx.roundRect(boxX, boxY, boxW, boxH, 6);
  } else {
    ctx.rect(boxX, boxY, boxW, boxH);
  }
  ctx.fill();
  ctx.stroke();

  // 2. Dibujar puntero triangular (Callout beak) hacia el elemento
  ctx.beginPath();
  if (effectivePlacement === "bottom") {
    const tipY = anchorY - 3;
    const baseY = boxY + boxH;
    ctx.moveTo(anchorX, tipY);
    ctx.lineTo(anchorX - pointerHalfWidth, baseY);
    ctx.lineTo(anchorX + pointerHalfWidth, baseY);
  } else {
    const tipY = anchorY + 3;
    const baseY = boxY;
    ctx.moveTo(anchorX, tipY);
    ctx.lineTo(anchorX - pointerHalfWidth, baseY);
    ctx.lineTo(anchorX + pointerHalfWidth, baseY);
  }
  ctx.closePath();
  ctx.fill();
  ctx.stroke();

  ctx.restore(); // Limpiar sombra para trazo nítido de texto y gráficos

  // 3. Trazo del contenido de texto
  ctx.textAlign = "left";

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    ctx.font = line.font;
    ctx.fillStyle = line.color;
    ctx.fillText(line.text, boxX + paddingX, boxY + paddingY + (i + 0.75) * lineHeight);
  }

  // 4. Trazo del mini osciloscopio si aplica
  if (hasSpark && sparkline) {
    const sparkX = boxX + paddingX;
    const sparkY = boxY + paddingY + lines.length * lineHeight + sparkMarginTop;
    const sparkW = boxW - paddingX * 2;
    drawSparkline(ctx, sparkX, sparkY, sparkW, sparkHeight, sparkline.points, sparkline.color);
  }

  ctx.restore();
}
