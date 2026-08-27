// ==========================================================================
// COMPONENT INSTRUMENT RENDERER — Instrumentación de Banco y Sondas en Canvas 2D
// Vatímetro, Sonda Lógica Digital, Inyector de Pulsos, Frecuencímetro
// ==========================================================================

import type { ComponentInstance } from "../canvas_orchestrator";
import { getInstrumentThemeColors } from "../ui/instrument_theme";

function formatPower(watts: number): string {
  const absP = Math.abs(watts);
  if (absP === 0) return "0.00 W";
  if (absP >= 1e6) return `${(watts / 1e6).toFixed(2)} MW`;
  if (absP >= 1e3) return `${(watts / 1e3).toFixed(2)} kW`;
  if (absP >= 1) return `${watts.toFixed(2)} W`;
  if (absP >= 1e-3) return `${(watts * 1e3).toFixed(2)} mW`;
  return `${(watts * 1e6).toFixed(1)} µW`;
}

function formatFrequency(hz: number): string {
  const absF = Math.abs(hz);
  if (absF === 0) return "0.00 Hz";
  if (absF >= 1e9) return `${(hz / 1e9).toFixed(3)} GHz`;
  if (absF >= 1e6) return `${(hz / 1e6).toFixed(3)} MHz`;
  if (absF >= 1e3) return `${(hz / 1e3).toFixed(2)} kHz`;
  return `${hz.toFixed(2)} Hz`;
}

/** ─── 1. VATÍMETRO / ANALIZADOR DE POTENCIA ─── */
export function drawWattmeter(
  ctx: CanvasRenderingContext2D,
  comp: ComponentInstance,
  color: string,
): void {
  const theme = getInstrumentThemeColors();
  ctx.save();

  // 1. Leads
  ctx.strokeStyle = color;
  ctx.lineWidth = 1.6;
  ctx.lineCap = "round";

  // I_in (-40, -20) -> (-28, -20)
  // I_out (40, -20) -> (28, -20)
  // V+ (-40, 20) -> (-28, 20)
  // V- (40, 20) -> (28, 20)
  ctx.beginPath();
  ctx.moveTo(-40, -20);
  ctx.lineTo(-28, -20);
  ctx.moveTo(40, -20);
  ctx.lineTo(28, -20);
  ctx.moveTo(-40, 20);
  ctx.lineTo(-28, 20);
  ctx.moveTo(40, 20);
  ctx.lineTo(28, 20);
  ctx.stroke();

  // 2. Chasis del instrumento
  ctx.fillStyle = theme.isClassroom ? "#FFFFFF" : "rgba(11, 17, 32, 0.95)";
  ctx.strokeStyle = color;
  ctx.lineWidth = 1.5;
  ctx.beginPath();
  ctx.roundRect(-28, -28, 56, 56, 5);
  ctx.fill();
  ctx.stroke();

  // 3. Pantalla OLED interna
  ctx.fillStyle = theme.isClassroom ? "#F1F5F9" : "#030712";
  ctx.strokeStyle = theme.isClassroom ? "#CBD5E1" : "#1E293B";
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.roundRect(-22, -22, 44, 26, 3);
  ctx.fill();
  ctx.stroke();

  // 4. Lectura digital de Potencia y Factor de Potencia
  const pVal = comp.activePower ?? (typeof comp.value === "number" ? comp.value : 0);
  const pfVal = comp.powerFactor ?? 1.0;

  ctx.fillStyle = "#10B981";
  ctx.font = "bold 9px monospace";
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.fillText(formatPower(pVal), 0, -14);

  ctx.fillStyle = "#94A3B8";
  ctx.font = "7px monospace";
  ctx.fillText(`PF: ${pfVal.toFixed(2)}`, 0, -4);

  // 5. Rótulos de terminales
  ctx.font = "bold 6.5px sans-serif";
  ctx.fillStyle = "#38BDF8";
  ctx.textAlign = "left";
  ctx.fillText("I+", -24, -20);
  ctx.textAlign = "right";
  ctx.fillText("I-", 24, -20);

  ctx.fillStyle = "#F59E0B";
  ctx.textAlign = "left";
  ctx.fillText("V+", -24, 20);
  ctx.textAlign = "right";
  ctx.fillText("V-", 24, 20);

  // 6. Título del instrumento
  ctx.fillStyle = "#64748B";
  ctx.font = "bold 6px sans-serif";
  ctx.textAlign = "center";
  ctx.fillText("WATTMETER", 0, 10);

  ctx.restore();
}

/** ─── 2. SONDA LÓGICA DIGITAL ─── */
export function drawLogicProbe(
  ctx: CanvasRenderingContext2D,
  comp: ComponentInstance,
  color: string,
): void {
  const theme = getInstrumentThemeColors();
  ctx.save();

  // 1. Aguja de contacto inferior (0, 20) -> (0, 10)
  ctx.strokeStyle = theme.isClassroom ? "#64748B" : "#CBD5E1";
  ctx.lineWidth = 2.0;
  ctx.lineCap = "round";
  ctx.beginPath();
  ctx.moveTo(0, 20);
  ctx.lineTo(0, 10);
  ctx.stroke();

  // 2. Cuerpo de la sonda (Forma estilizada de lápiz de prueba)
  ctx.fillStyle = theme.isClassroom ? "#FFFFFF" : "rgba(15, 23, 42, 0.95)";
  ctx.strokeStyle = color;
  ctx.lineWidth = 1.4;

  ctx.beginPath();
  ctx.moveTo(0, 10);
  ctx.lineTo(-10, 2);
  ctx.lineTo(-10, -32);
  ctx.lineTo(10, -32);
  ctx.lineTo(10, 2);
  ctx.closePath();
  ctx.fill();
  ctx.stroke();

  // 3. Ventana de estado LED
  const state = comp.logicState ?? "X";
  let ledColor = "#F59E0B"; // Ámbar por defecto (Hi-Z / Indeterminado)
  let ledGlow = "rgba(245, 158, 11, 0.4)";

  if (state === "1") {
    ledColor = "#EF4444"; // Rojo brillante para HIGH
    ledGlow = "rgba(239, 68, 68, 0.6)";
  } else if (state === "0") {
    ledColor = "#10B981"; // Verde brillante para LOW
    ledGlow = "rgba(16, 185, 129, 0.6)";
  }

  // Resplandor del LED
  ctx.fillStyle = ledGlow;
  ctx.beginPath();
  ctx.arc(0, -10, 7, 0, Math.PI * 2);
  ctx.fill();

  // Lente del LED
  ctx.fillStyle = ledColor;
  ctx.strokeStyle = "#FFFFFF";
  ctx.lineWidth = 0.8;
  ctx.beginPath();
  ctx.arc(0, -10, 4.5, 0, Math.PI * 2);
  ctx.fill();
  ctx.stroke();

  // 4. Dígito / Texto de nivel
  ctx.fillStyle = theme.isClassroom ? "#0F172A" : "#FFFFFF";
  ctx.font = "bold 9px monospace";
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.fillText(state, 0, -22);

  // Rótulo LOGIC
  ctx.fillStyle = theme.isClassroom ? "#475569" : "#64748B";
  ctx.font = "bold 5.5px sans-serif";
  ctx.fillText("PROBE", 0, -2);

  ctx.restore();
}

/** ─── 3. INYECTOR DE PULSOS LÓGICOS ─── */
export function drawPulseGenerator(
  ctx: CanvasRenderingContext2D,
  _comp: ComponentInstance,
  color: string,
): void {
  const theme = getInstrumentThemeColors();
  ctx.save();

  // 1. Leads: GND (-20, 0) -> (-15, 0), OUT (20, 0) -> (15, 0)
  ctx.strokeStyle = color;
  ctx.lineWidth = 1.6;
  ctx.lineCap = "round";
  ctx.beginPath();
  ctx.moveTo(-20, 0);
  ctx.lineTo(-15, 0);
  ctx.moveTo(20, 0);
  ctx.lineTo(15, 0);
  ctx.stroke();

  // 2. Chasis
  ctx.fillStyle = theme.isClassroom ? "#FFFFFF" : "rgba(15, 23, 42, 0.95)";
  ctx.strokeStyle = color;
  ctx.lineWidth = 1.4;
  ctx.beginPath();
  ctx.roundRect(-15, -22, 30, 44, 4);
  ctx.fill();
  ctx.stroke();

  // 3. Botón de disparo / Actividad
  ctx.fillStyle = "#0284C7";
  ctx.strokeStyle = "#38BDF8";
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.arc(0, -6, 6, 0, Math.PI * 2);
  ctx.fill();
  ctx.stroke();

  // 4. Icono de onda de pulso _/\_
  ctx.strokeStyle = "#FFFFFF";
  ctx.lineWidth = 1.2;
  ctx.beginPath();
  ctx.moveTo(-7, 8);
  ctx.lineTo(-3, 8);
  ctx.lineTo(-3, 4);
  ctx.lineTo(3, 4);
  ctx.lineTo(3, 8);
  ctx.lineTo(7, 8);
  ctx.stroke();

  // 5. Rótulos
  ctx.fillStyle = theme.isClassroom ? "#475569" : "#94A3B8";
  ctx.font = "bold 5.5px sans-serif";
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.fillText("PULSER", 0, -16);

  ctx.font = "5px monospace";
  ctx.fillText("5V", 0, 15);

  ctx.restore();
}

/** ─── 4. FRECUENCÍMETRO DIGITAL ─── */
export function drawFrequencyCounter(
  ctx: CanvasRenderingContext2D,
  comp: ComponentInstance,
  color: string,
): void {
  const theme = getInstrumentThemeColors();
  ctx.save();

  // 1. Leads: IN (-40, 0) -> (-28, 0), COM (40, 0) -> (28, 0)
  ctx.strokeStyle = color;
  ctx.lineWidth = 1.6;
  ctx.lineCap = "round";
  ctx.beginPath();
  ctx.moveTo(-40, 0);
  ctx.lineTo(-28, 0);
  ctx.moveTo(40, 0);
  ctx.lineTo(28, 0);
  ctx.stroke();

  // 2. Chasis de banco
  ctx.fillStyle = theme.isClassroom ? "#FFFFFF" : "rgba(11, 17, 32, 0.95)";
  ctx.strokeStyle = color;
  ctx.lineWidth = 1.5;
  ctx.beginPath();
  ctx.roundRect(-28, -20, 56, 40, 4);
  ctx.fill();
  ctx.stroke();

  // 3. Pantalla VFD fluorescente
  ctx.fillStyle = theme.isClassroom ? "#F1F5F9" : "#030712";
  ctx.strokeStyle = theme.isClassroom ? "#CBD5E1" : "#1E293B";
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.roundRect(-22, -14, 44, 20, 3);
  ctx.fill();
  ctx.stroke();

  // 4. Lectura digital de frecuencia
  const freq = comp.frequencyReading ?? (typeof comp.value === "number" ? comp.value : 1000);
  ctx.fillStyle = theme.isClassroom ? "#0D9488" : "#2DD4BF";
  ctx.font = "bold 8.5px monospace";
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.fillText(formatFrequency(freq), 0, -4);

  // 5. Rótulo de función
  ctx.fillStyle = theme.isClassroom ? "#475569" : "#64748B";
  ctx.font = "bold 6px sans-serif";
  ctx.fillText("FREQ COUNTER", 0, 12);

  // Terminales
  ctx.font = "bold 6px sans-serif";
  ctx.fillStyle = theme.isClassroom ? "#0284C7" : "#38BDF8";
  ctx.textAlign = "left";
  ctx.fillText("IN", -24, 0);
  ctx.textAlign = "right";
  ctx.fillStyle = theme.isClassroom ? "#475569" : "#94A3B8";
  ctx.fillText("COM", 24, 0);

  ctx.restore();
}

/** ─── 5. SONDA DE ESTABILIDAD TIAN / MIDDLEBROOK (STB PROBE) ─── */
export function drawStbProbe(
  ctx: CanvasRenderingContext2D,
  _comp: ComponentInstance,
  color: string,
): void {
  const theme = getInstrumentThemeColors();
  ctx.save();

  // 1. Leads: A (-20, 0) -> (-12, 0), B (20, 0) -> (12, 0)
  ctx.strokeStyle = color;
  ctx.lineWidth = 1.6;
  ctx.lineCap = "round";
  ctx.beginPath();
  ctx.moveTo(-20, 0);
  ctx.lineTo(-12, 0);
  ctx.moveTo(20, 0);
  ctx.lineTo(12, 0);
  ctx.stroke();

  // 2. Chasis / Insignia de la sonda
  ctx.fillStyle = theme.isClassroom ? "#FFFFFF" : "rgba(15, 23, 42, 0.95)";
  ctx.strokeStyle = theme.isClassroom ? "#8B5CF6" : "#A78BFA";
  ctx.lineWidth = 1.5;
  ctx.beginPath();
  ctx.roundRect(-12, -10, 24, 20, 3);
  ctx.fill();
  ctx.stroke();

  // 3. Flecha de dirección de lazo (A -> B)
  ctx.strokeStyle = theme.isClassroom ? "#7C3AED" : "#C4B5FD";
  ctx.fillStyle = theme.isClassroom ? "#7C3AED" : "#C4B5FD";
  ctx.lineWidth = 1.2;
  ctx.beginPath();
  ctx.moveTo(-6, -3);
  ctx.lineTo(5, -3);
  ctx.lineTo(2, -6);
  ctx.moveTo(5, -3);
  ctx.lineTo(2, 0);
  ctx.stroke();

  // 4. Texto STB y etiquetas de pines A / B
  ctx.font = "bold 6.5px monospace";
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.fillStyle = theme.isClassroom ? "#6D28D9" : "#DDD6FE";
  ctx.fillText("STB", 0, 4);

  ctx.font = "bold 5.5px sans-serif";
  ctx.fillStyle = theme.isClassroom ? "#0284C7" : "#38BDF8";
  ctx.textAlign = "left";
  ctx.fillText("A", -10, 5);

  ctx.fillStyle = theme.isClassroom ? "#10B981" : "#34D399";
  ctx.textAlign = "right";
  ctx.fillText("B", 10, 5);

  ctx.restore();
}

