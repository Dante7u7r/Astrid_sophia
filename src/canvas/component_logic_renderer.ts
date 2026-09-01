/**
 * Renderizador de compuertas lógicas estándar IEEE para Canvas 2D con visualización de niveles lógicos en vivo.
 * Soporta configuración dinámica de 2, 3, 4 y 8 entradas y símbolo de histéresis Schmitt.
 */

export interface LogicGateRenderOptions {
  levelA?: "1" | "0" | "X" | "Z";
  levelB?: "1" | "0" | "X" | "Z";
  levelY?: "1" | "0" | "X" | "Z";
  inputLevels?: readonly ("1" | "0" | "X" | "Z" | undefined)[];
  inputCount?: number;
  schmittTrigger?: boolean;
  openCollector?: boolean;
  symbolStandard?: "IEEE" | "IEC";
}

export function getGateInputYOffsets(count: number): number[] {
  if (count <= 1) return [0];
  if (count === 2) return [-10, 10];
  if (count === 3) return [-20, 0, 20];
  if (count === 4) return [-30, -10, 10, 30];
  if (count === 8) return [-70, -50, -30, -10, 10, 30, 50, 70];
  const step = 20;
  const half = ((count - 1) * step) / 2;
  return Array.from({ length: count }, (_, i) => -half + i * step);
}

function getLogicColor(level?: "1" | "0" | "X" | "Z"): string {
  const isClassroom = typeof document !== "undefined" && document.documentElement.getAttribute("data-theme") === "classroom";
  if (level === "1") return isClassroom ? "#059669" : "#10B981"; // Verde Esmeralda (Nivel Alto)
  if (level === "0") return isClassroom ? "#475569" : "#64748B"; // Pizarra / Gris Oscuro (Nivel Bajo)
  if (level === "X") return isClassroom ? "#D97706" : "#F59E0B"; // Ámbar (Indeterminado)
  if (level === "Z") return isClassroom ? "#EA580C" : "#F97316"; // Naranja brillante (Alta impedancia / Flotante)
  return isClassroom ? "#334155" : "#475569";
}

function drawLogicTerminalNode(ctx: CanvasRenderingContext2D, x: number, y: number, level?: "1" | "0" | "X" | "Z"): void {
  if (!level) return;
  ctx.save();
  ctx.fillStyle = getLogicColor(level);
  ctx.beginPath();
  if (level === "Z") {
    ctx.arc(x, y, 3.2, 0, Math.PI * 2);
    ctx.strokeStyle = "#FFFFFF";
    ctx.lineWidth = 1;
    ctx.stroke();
  } else {
    ctx.arc(x, y, 2.5, 0, Math.PI * 2);
  }
  ctx.fill();
  ctx.restore();
}

function drawSchmittHysteresisSymbol(ctx: CanvasRenderingContext2D, x: number, y: number): void {
  ctx.save();
  ctx.strokeStyle = "rgba(56, 189, 248, 0.9)";
  ctx.lineWidth = 1.3;
  ctx.beginPath();
  ctx.moveTo(x - 5, y + 4);
  ctx.lineTo(x + 1, y + 4);
  ctx.lineTo(x + 1, y - 4);
  ctx.lineTo(x + 5, y - 4);
  ctx.moveTo(x + 5, y - 4);
  ctx.lineTo(x - 1, y - 4);
  ctx.lineTo(x - 1, y + 4);
  ctx.stroke();
  ctx.restore();
}

function drawIecGateBox(
  ctx: CanvasRenderingContext2D,
  opts: LogicGateRenderOptions | undefined,
  halfH: number,
  operatorSymbol: string,
  hasInversion: boolean,
): void {
  const inputCount = opts?.inputCount ?? 2;
  const yOffsets = getGateInputYOffsets(inputCount);
  const levels = opts?.inputLevels ?? [opts?.levelA, opts?.levelB];

  // 1. Leads de entrada
  ctx.beginPath();
  yOffsets.forEach((y, idx) => {
    ctx.moveTo(-40, y);
    ctx.lineTo(-20, y);
    drawLogicTerminalNode(ctx, -38, y, levels[idx]);
  });

  // Lead de salida
  const outStartX = hasInversion ? 24 : 20;
  ctx.moveTo(outStartX, 0);
  ctx.lineTo(40, 0);
  ctx.stroke();
  drawLogicTerminalNode(ctx, 38, 0, opts?.levelY);

  // 2. Caja rectangular IEC
  ctx.beginPath();
  ctx.rect(-20, -halfH, 40, halfH * 2);
  if (opts?.levelY === "1") {
    ctx.save();
    ctx.fillStyle = "rgba(16, 185, 129, 0.16)";
    ctx.fill();
    ctx.restore();
  } else {
    ctx.fill();
  }
  ctx.stroke();

  // 3. Símbolo calificador IEC (&, ≥1, 1, =1)
  const isClassroom = typeof document !== "undefined" && document.documentElement.getAttribute("data-theme") === "classroom";
  ctx.save();
  ctx.fillStyle = isClassroom ? "#0F172A" : "rgba(255, 255, 255, 0.9)";
  ctx.font = "bold 11px 'Inter', sans-serif";
  ctx.textAlign = "center";
  ctx.textBaseline = "top";
  ctx.fillText(operatorSymbol, 0, -halfH + 4);
  ctx.restore();

  // 4. Inversión si aplica (Círculo de negación en salida)
  if (hasInversion) {
    ctx.beginPath();
    ctx.arc(24, 0, 4, 0, Math.PI * 2);
    ctx.stroke();
    ctx.fill();
  }

  // 5. Histéresis Schmitt
  if (opts?.schmittTrigger) {
    drawSchmittHysteresisSymbol(ctx, 0, 6);
  }
}

export function drawAndGate(ctx: CanvasRenderingContext2D, opts?: LogicGateRenderOptions): void {
  const inputCount = opts?.inputCount ?? 2;
  const yOffsets = getGateInputYOffsets(inputCount);
  const halfH = Math.max(20, (yOffsets[yOffsets.length - 1] ?? 10) + 10);

  if (opts?.symbolStandard === "IEC") {
    drawIecGateBox(ctx, opts, halfH, "&", false);
    return;
  }

  const levels = opts?.inputLevels ?? [opts?.levelA, opts?.levelB];

  // 1. Leads de entrada
  ctx.beginPath();
  yOffsets.forEach((y, idx) => {
    ctx.moveTo(-40, y);
    ctx.lineTo(-20, y);
    drawLogicTerminalNode(ctx, -38, y, levels[idx]);
  });

  // Lead de salida
  ctx.moveTo(20, 0);
  ctx.lineTo(40, 0);
  ctx.stroke();
  drawLogicTerminalNode(ctx, 38, 0, opts?.levelY);

  // 2. Cuerpo AND (Base plana + arco)
  ctx.beginPath();
  ctx.moveTo(-20, -halfH);
  ctx.lineTo(-2, -halfH);
  ctx.arc(0, 0, halfH, -Math.PI / 2, Math.PI / 2, false);
  ctx.lineTo(-20, halfH);
  ctx.closePath();

  if (opts?.levelY === "1") {
    ctx.save();
    ctx.fillStyle = "rgba(16, 185, 129, 0.16)";
    ctx.fill();
    ctx.restore();
  } else {
    ctx.fill();
  }
  ctx.stroke();

  if (opts?.schmittTrigger) {
    drawSchmittHysteresisSymbol(ctx, -6, 0);
  }
}

export function drawOrGate(ctx: CanvasRenderingContext2D, opts?: LogicGateRenderOptions): void {
  const inputCount = opts?.inputCount ?? 2;
  const yOffsets = getGateInputYOffsets(inputCount);
  const halfH = Math.max(22, (yOffsets[yOffsets.length - 1] ?? 10) + 12);

  if (opts?.symbolStandard === "IEC") {
    drawIecGateBox(ctx, opts, halfH, "≥1", false);
    return;
  }

  const levels = opts?.inputLevels ?? [opts?.levelA, opts?.levelB];

  // 1. Leads
  ctx.beginPath();
  yOffsets.forEach((y, idx) => {
    // Lead extendido hasta la curva cóncava de entrada
    const curveX = -20 + 8 * (1 - Math.abs(y / halfH));
    ctx.moveTo(-40, y);
    ctx.lineTo(curveX, y);
    drawLogicTerminalNode(ctx, -38, y, levels[idx]);
  });

  ctx.moveTo(24, 0);
  ctx.lineTo(40, 0);
  ctx.stroke();
  drawLogicTerminalNode(ctx, 38, 0, opts?.levelY);

  // 2. Cuerpo OR
  ctx.beginPath();
  ctx.moveTo(-22, -halfH);
  ctx.quadraticCurveTo(6, -halfH * 0.9, 24, 0);
  ctx.quadraticCurveTo(6, halfH * 0.9, -22, halfH);
  ctx.quadraticCurveTo(-10, 0, -22, -halfH);
  ctx.closePath();

  if (opts?.levelY === "1") {
    ctx.save();
    ctx.fillStyle = "rgba(16, 185, 129, 0.16)";
    ctx.fill();
    ctx.restore();
  } else {
    ctx.fill();
  }
  ctx.stroke();

  if (opts?.schmittTrigger) {
    drawSchmittHysteresisSymbol(ctx, -4, 0);
  }
}

export function drawNotGate(ctx: CanvasRenderingContext2D, opts?: LogicGateRenderOptions): void {
  if (opts?.symbolStandard === "IEC") {
    drawIecGateBox(ctx, opts, 18, "1", true);
    return;
  }

  // 1. Leads
  ctx.beginPath();
  ctx.moveTo(-40, 0);
  ctx.lineTo(-16, 0);
  ctx.moveTo(20, 0);
  ctx.lineTo(40, 0);
  ctx.stroke();

  drawLogicTerminalNode(ctx, -38, 0, opts?.levelA ?? opts?.inputLevels?.[0]);
  drawLogicTerminalNode(ctx, 38, 0, opts?.levelY);

  // 2. Triángulo inversor
  ctx.beginPath();
  ctx.moveTo(-16, -16);
  ctx.lineTo(12, 0);
  ctx.lineTo(-16, 16);
  ctx.closePath();

  if (opts?.levelY === "1") {
    ctx.save();
    ctx.fillStyle = "rgba(16, 185, 129, 0.16)";
    ctx.fill();
    ctx.restore();
  } else {
    ctx.fill();
  }
  ctx.stroke();

  // 3. Burbuja de inversión
  ctx.beginPath();
  ctx.arc(16, 0, 4, 0, Math.PI * 2);
  ctx.stroke();
  ctx.fill();

  if (opts?.schmittTrigger) {
    drawSchmittHysteresisSymbol(ctx, -4, 0);
  }
}

export function drawNandGate(ctx: CanvasRenderingContext2D, opts?: LogicGateRenderOptions): void {
  const inputCount = opts?.inputCount ?? 2;
  const yOffsets = getGateInputYOffsets(inputCount);
  const halfH = Math.max(20, (yOffsets[yOffsets.length - 1] ?? 10) + 10);

  if (opts?.symbolStandard === "IEC") {
    drawIecGateBox(ctx, opts, halfH, "&", true);
    return;
  }

  const levels = opts?.inputLevels ?? [opts?.levelA, opts?.levelB];

  // 1. Leads
  ctx.beginPath();
  yOffsets.forEach((y, idx) => {
    ctx.moveTo(-40, y);
    ctx.lineTo(-20, y);
    drawLogicTerminalNode(ctx, -38, y, levels[idx]);
  });

  ctx.moveTo(24, 0);
  ctx.lineTo(40, 0);
  ctx.stroke();
  drawLogicTerminalNode(ctx, 38, 0, opts?.levelY);

  // 2. Cuerpo AND
  ctx.beginPath();
  ctx.moveTo(-20, -halfH);
  ctx.lineTo(-2, -halfH);
  ctx.arc(0, 0, halfH, -Math.PI / 2, Math.PI / 2, false);
  ctx.lineTo(-20, halfH);
  ctx.closePath();

  if (opts?.levelY === "1") {
    ctx.save();
    ctx.fillStyle = "rgba(16, 185, 129, 0.16)";
    ctx.fill();
    ctx.restore();
  } else {
    ctx.fill();
  }
  ctx.stroke();

  // 3. Burbuja de inversión
  ctx.beginPath();
  ctx.arc(20, 0, 4, 0, Math.PI * 2);
  ctx.stroke();
  ctx.fill();

  if (opts?.schmittTrigger) {
    drawSchmittHysteresisSymbol(ctx, -6, 0);
  }
}

export function drawNorGate(ctx: CanvasRenderingContext2D, opts?: LogicGateRenderOptions): void {
  const inputCount = opts?.inputCount ?? 2;
  const yOffsets = getGateInputYOffsets(inputCount);
  const halfH = Math.max(22, (yOffsets[yOffsets.length - 1] ?? 10) + 12);

  if (opts?.symbolStandard === "IEC") {
    drawIecGateBox(ctx, opts, halfH, "≥1", true);
    return;
  }

  const levels = opts?.inputLevels ?? [opts?.levelA, opts?.levelB];

  // 1. Leads
  ctx.beginPath();
  yOffsets.forEach((y, idx) => {
    const curveX = -20 + 8 * (1 - Math.abs(y / halfH));
    ctx.moveTo(-40, y);
    ctx.lineTo(curveX, y);
    drawLogicTerminalNode(ctx, -38, y, levels[idx]);
  });

  ctx.moveTo(28, 0);
  ctx.lineTo(40, 0);
  ctx.stroke();
  drawLogicTerminalNode(ctx, 38, 0, opts?.levelY);

  // 2. Cuerpo OR
  ctx.beginPath();
  ctx.moveTo(-22, -halfH);
  ctx.quadraticCurveTo(6, -halfH * 0.9, 20, 0);
  ctx.quadraticCurveTo(6, halfH * 0.9, -22, halfH);
  ctx.quadraticCurveTo(-10, 0, -22, -halfH);
  ctx.closePath();

  if (opts?.levelY === "1") {
    ctx.save();
    ctx.fillStyle = "rgba(16, 185, 129, 0.16)";
    ctx.fill();
    ctx.restore();
  } else {
    ctx.fill();
  }
  ctx.stroke();

  // 3. Burbuja de inversión
  ctx.beginPath();
  ctx.arc(24, 0, 4, 0, Math.PI * 2);
  ctx.stroke();
  ctx.fill();

  if (opts?.schmittTrigger) {
    drawSchmittHysteresisSymbol(ctx, -4, 0);
  }
}

export function drawXorGate(ctx: CanvasRenderingContext2D, opts?: LogicGateRenderOptions): void {
  const inputCount = opts?.inputCount ?? 2;
  const yOffsets = getGateInputYOffsets(inputCount);
  const halfH = Math.max(22, (yOffsets[yOffsets.length - 1] ?? 10) + 12);

  if (opts?.symbolStandard === "IEC") {
    drawIecGateBox(ctx, opts, halfH, "=1", false);
    return;
  }

  const levels = opts?.inputLevels ?? [opts?.levelA, opts?.levelB];

  // 1. Leads
  ctx.beginPath();
  yOffsets.forEach((y, idx) => {
    ctx.moveTo(-40, y);
    ctx.lineTo(-24, y);
    drawLogicTerminalNode(ctx, -38, y, levels[idx]);
  });

  ctx.moveTo(24, 0);
  ctx.lineTo(40, 0);
  ctx.stroke();
  drawLogicTerminalNode(ctx, 38, 0, opts?.levelY);

  // 2. Línea adicional de entrada curva (XOR)
  ctx.beginPath();
  ctx.moveTo(-28, -halfH);
  ctx.quadraticCurveTo(-16, 0, -28, halfH);
  ctx.stroke();

  // 3. Cuerpo principal OR
  ctx.beginPath();
  ctx.moveTo(-22, -halfH);
  ctx.quadraticCurveTo(6, -halfH * 0.9, 24, 0);
  ctx.quadraticCurveTo(6, halfH * 0.9, -22, halfH);
  ctx.quadraticCurveTo(-10, 0, -22, -halfH);
  ctx.closePath();

  if (opts?.levelY === "1") {
    ctx.save();
    ctx.fillStyle = "rgba(16, 185, 129, 0.16)";
    ctx.fill();
    ctx.restore();
  } else {
    ctx.fill();
  }
  ctx.stroke();

  if (opts?.schmittTrigger) {
    drawSchmittHysteresisSymbol(ctx, -4, 0);
  }
}

/** ─── FLIP-FLOP D (74HC74) ─── */
export interface FlipFlopRenderOptions {
  levelD?: "1" | "0" | "X";
  levelClk?: "1" | "0" | "X";
  levelPre?: "1" | "0" | "X";
  levelClr?: "1" | "0" | "X";
  levelQ?: "1" | "0" | "X";
  levelQNot?: "1" | "0" | "X";
  levelJ?: "1" | "0" | "X";
  levelK?: "1" | "0" | "X";
  symbolStandard?: "IEEE" | "IEC";
}

export function drawFlipFlopD(
  ctx: CanvasRenderingContext2D,
  color: string,
  lineWidth: number,
  opts?: FlipFlopRenderOptions,
): void {
  ctx.save();
  ctx.strokeStyle = color;
  ctx.lineWidth = lineWidth;
  ctx.lineCap = "round";
  ctx.lineJoin = "round";

  // 1. Leads
  ctx.beginPath();
  // D (-40, -20) -> (-24, -20)
  ctx.moveTo(-40, -20);
  ctx.lineTo(-24, -20);
  // CLK (-40, 0) -> (-24, 0)
  ctx.moveTo(-40, 0);
  ctx.lineTo(-24, 0);
  // PRE (0, -40) -> (0, -30)
  ctx.moveTo(0, -40);
  ctx.lineTo(0, -30);
  // CLR (0, 40) -> (0, 30)
  ctx.moveTo(0, 40);
  ctx.lineTo(0, 30);
  // Q (24, -20) -> (40, -20)
  ctx.moveTo(24, -20);
  ctx.lineTo(40, -20);
  // Q_NOT (24, 20) -> (40, 20)
  ctx.moveTo(28, 20);
  ctx.lineTo(40, 20);
  ctx.stroke();

  // Burbujas de inversión para PRE (activo bajo), CLR (activo bajo) y Q_NOT
  ctx.beginPath();
  ctx.arc(0, -32, 2.5, 0, Math.PI * 2);
  ctx.arc(0, 32, 2.5, 0, Math.PI * 2);
  ctx.arc(26, 20, 2.5, 0, Math.PI * 2);
  ctx.stroke();

  // Nodos lógicos coloreados
  drawLogicTerminalNode(ctx, -38, -20, opts?.levelD);
  drawLogicTerminalNode(ctx, -38, 0, opts?.levelClk);
  drawLogicTerminalNode(ctx, 0, -38, opts?.levelPre);
  drawLogicTerminalNode(ctx, 0, 38, opts?.levelClr);
  drawLogicTerminalNode(ctx, 38, -20, opts?.levelQ);
  drawLogicTerminalNode(ctx, 38, 20, opts?.levelQNot);

  // 2. Cuerpo del CI
  const isClassroom = typeof document !== "undefined" && document.documentElement.getAttribute("data-theme") === "classroom";
  ctx.fillStyle = isClassroom
    ? (opts?.levelQ === "1" ? "rgba(5, 150, 105, 0.12)" : "rgba(241, 245, 249, 0.95)")
    : (opts?.levelQ === "1" ? "rgba(16, 185, 129, 0.08)" : "rgba(30, 41, 59, 0.6)");
  ctx.beginPath();
  ctx.rect(-24, -30, 48, 60);
  ctx.fill();
  ctx.stroke();

  // Símbolo de reloj dinámico (triángulo interno)
  ctx.beginPath();
  ctx.moveTo(-24, -6);
  ctx.lineTo(-14, 0);
  ctx.lineTo(-24, 6);
  ctx.stroke();

  // 3. Rótulos de terminales
  ctx.fillStyle = color;
  ctx.font = "bold 9px monospace";
  ctx.textAlign = "left";
  ctx.textBaseline = "middle";
  ctx.fillText("D", -20, -20);

  ctx.textAlign = "right";
  ctx.fillText("Q", 20, -20);
  ctx.fillText("Q̄", 20, 20);

  ctx.textAlign = "center";
  ctx.font = "7px sans-serif";
  ctx.fillText("PRE", 0, -23);
  ctx.fillText("CLR", 0, 23);

  ctx.font = "bold 8px sans-serif";
  ctx.fillStyle = isClassroom ? "#0F172A" : "rgba(148, 163, 184, 0.9)";
  ctx.fillText("74HC74", 0, 0);

  ctx.restore();
}

/** ─── FLIP-FLOP JK (74HC73) ─── */
export function drawFlipFlopJK(
  ctx: CanvasRenderingContext2D,
  color: string,
  lineWidth: number,
  opts?: FlipFlopRenderOptions,
): void {
  ctx.save();
  ctx.strokeStyle = color;
  ctx.lineWidth = lineWidth;
  ctx.lineCap = "round";
  ctx.lineJoin = "round";

  // 1. Leads
  ctx.beginPath();
  // J (-40, -20) -> (-24, -20)
  ctx.moveTo(-40, -20);
  ctx.lineTo(-24, -20);
  // CLK (-40, 0) -> (-24, 0)
  ctx.moveTo(-40, 0);
  ctx.lineTo(-24, 0);
  // K (-40, 20) -> (-24, 20)
  ctx.moveTo(-40, 20);
  ctx.lineTo(-24, 20);
  // CLR (0, 40) -> (0, 30)
  ctx.moveTo(0, 40);
  ctx.lineTo(0, 30);
  // Q (24, -20) -> (40, -20)
  ctx.moveTo(24, -20);
  ctx.lineTo(40, -20);
  // Q_NOT (24, 20) -> (40, 20)
  ctx.moveTo(28, 20);
  ctx.lineTo(40, 20);
  ctx.stroke();

  // Inversión CLR y Q_NOT
  ctx.beginPath();
  ctx.arc(0, 32, 2.5, 0, Math.PI * 2);
  ctx.arc(26, 20, 2.5, 0, Math.PI * 2);
  ctx.stroke();

  // Nodos lógicos
  drawLogicTerminalNode(ctx, -38, -20, opts?.levelJ);
  drawLogicTerminalNode(ctx, -38, 0, opts?.levelClk);
  drawLogicTerminalNode(ctx, -38, 20, opts?.levelK);
  drawLogicTerminalNode(ctx, 0, 38, opts?.levelClr);
  drawLogicTerminalNode(ctx, 38, -20, opts?.levelQ);
  drawLogicTerminalNode(ctx, 38, 20, opts?.levelQNot);

  // 2. Cuerpo del CI
  const isClassroom = typeof document !== "undefined" && document.documentElement.getAttribute("data-theme") === "classroom";
  ctx.fillStyle = isClassroom
    ? (opts?.levelQ === "1" ? "rgba(5, 150, 105, 0.12)" : "rgba(241, 245, 249, 0.95)")
    : (opts?.levelQ === "1" ? "rgba(16, 185, 129, 0.08)" : "rgba(30, 41, 59, 0.6)");
  ctx.beginPath();
  ctx.rect(-24, -30, 48, 60);
  ctx.fill();
  ctx.stroke();

  // Triángulo de reloj
  ctx.beginPath();
  ctx.moveTo(-24, -6);
  ctx.lineTo(-14, 0);
  ctx.lineTo(-24, 6);
  ctx.stroke();

  // 3. Rótulos
  ctx.fillStyle = color;
  ctx.font = "bold 9px monospace";
  ctx.textAlign = "left";
  ctx.textBaseline = "middle";
  ctx.fillText("J", -20, -20);
  ctx.fillText("K", -20, 20);

  ctx.textAlign = "right";
  ctx.fillText("Q", 20, -20);
  ctx.fillText("Q̄", 20, 20);

  ctx.textAlign = "center";
  ctx.font = "7px sans-serif";
  ctx.fillText("CLR", 0, 23);

  ctx.font = "bold 8px sans-serif";
  ctx.fillStyle = isClassroom ? "#0F172A" : "rgba(148, 163, 184, 0.9)";
  ctx.fillText("74HC73", 0, 0);

  ctx.restore();
}

/** ─── DECODIFICADOR BCD A 7 SEGMENTOS (74HC47 / 74HC48) ─── */
export interface BcdDecoderRenderOptions {
  inputLevels?: readonly ("1" | "0" | "X" | undefined)[];
  outputLevels?: readonly ("1" | "0" | "X" | undefined)[];
  decodedDigit?: number | string;
}

export function drawBcdTo7Seg(
  ctx: CanvasRenderingContext2D,
  color: string,
  lineWidth: number,
  opts?: BcdDecoderRenderOptions,
): void {
  ctx.save();
  ctx.strokeStyle = color;
  ctx.lineWidth = lineWidth;
  ctx.lineCap = "round";
  ctx.lineJoin = "round";

  const inY = [-60, -20, 20, 60]; // 4 entradas A, B, C, D (múltiplos de 20px)
  const outY = [-60, -40, -20, 0, 20, 40, 60]; // 7 salidas a..g
  const inLabels = ["A", "B", "C", "D"];
  const outLabels = ["a", "b", "c", "d", "e", "f", "g"];

  // 1. Leads de entrada y salida
  ctx.beginPath();
  inY.forEach((y, idx) => {
    ctx.moveTo(-40, y);
    ctx.lineTo(-24, y);
    drawLogicTerminalNode(ctx, -38, y, opts?.inputLevels?.[idx]);
  });
  outY.forEach((y, idx) => {
    ctx.moveTo(24, y);
    ctx.lineTo(40, y);
    drawLogicTerminalNode(ctx, 38, y, opts?.outputLevels?.[idx]);
  });
  ctx.stroke();

  // 2. Encapsulado principal
  const isClassroom = typeof document !== "undefined" && document.documentElement.getAttribute("data-theme") === "classroom";
  ctx.fillStyle = isClassroom ? "rgba(241, 245, 249, 0.95)" : "rgba(30, 41, 59, 0.65)";
  ctx.beginPath();
  ctx.rect(-24, -70, 48, 140);
  ctx.fill();
  ctx.stroke();

  // 3. Rótulos
  ctx.fillStyle = color;
  ctx.font = "bold 8px monospace";
  ctx.textAlign = "left";
  ctx.textBaseline = "middle";
  inY.forEach((y, idx) => {
    ctx.fillText(inLabels[idx], -20, y);
  });

  ctx.textAlign = "right";
  outY.forEach((y, idx) => {
    ctx.fillText(outLabels[idx], 20, y);
  });

  // Título e indicador central
  ctx.textAlign = "center";
  ctx.font = "bold 8px sans-serif";
  ctx.fillStyle = isClassroom ? "#0F172A" : "rgba(148, 163, 184, 0.9)";
  ctx.fillText("74HC47", 0, -52);
  ctx.font = "7px sans-serif";
  ctx.fillStyle = isClassroom ? "#475569" : "rgba(148, 163, 184, 0.9)";
  ctx.fillText("BCD→7SEG", 0, -42);

  // Preview digital si hay dígito decodificado
  if (opts?.decodedDigit !== undefined) {
    ctx.font = "bold 16px monospace";
    ctx.fillStyle = isClassroom ? "#059669" : "#10B981";
    ctx.fillText(String(opts.decodedDigit), 0, 0);
  }

  ctx.restore();
}

/** ─── REGISTRO DE DESPLAZAMIENTO 8-BIT SIPO (74HC595) ─── */
export interface ShiftRegisterRenderOptions {
  inputLevels?: readonly ("1" | "0" | "X" | undefined)[];
  outputLevels?: readonly ("1" | "0" | "X" | undefined)[];
  latchValue?: number;
}

export function drawShiftRegister595(
  ctx: CanvasRenderingContext2D,
  color: string,
  lineWidth: number,
  opts?: ShiftRegisterRenderOptions,
): void {
  ctx.save();
  ctx.strokeStyle = color;
  ctx.lineWidth = lineWidth;
  ctx.lineCap = "round";
  ctx.lineJoin = "round";

  const inY = [-40, -20, 0, 20, 40]; // SER, SRCLK, RCLK, OE, SRCLR
  const outY = [-80, -60, -40, -20, 0, 20, 40, 60, 80]; // Q0..Q7, QH'
  const inLabels = ["SER", "SRCLK", "RCLK", "OE", "SRCLR"];
  const outLabels = ["Q0", "Q1", "Q2", "Q3", "Q4", "Q5", "Q6", "Q7", "QH'"];

  // 1. Leads
  ctx.beginPath();
  inY.forEach((y, idx) => {
    ctx.moveTo(-40, y);
    ctx.lineTo(-24, y);
    drawLogicTerminalNode(ctx, -38, y, opts?.inputLevels?.[idx]);
  });
  outY.forEach((y, idx) => {
    ctx.moveTo(24, y);
    ctx.lineTo(40, y);
    drawLogicTerminalNode(ctx, 38, y, opts?.outputLevels?.[idx]);
  });
  ctx.stroke();

  // Inversión en OE y SRCLR
  ctx.beginPath();
  ctx.arc(-26, 20, 2.5, 0, Math.PI * 2);
  ctx.arc(-26, 40, 2.5, 0, Math.PI * 2);
  ctx.stroke();

  // 2. Encapsulado
  const isClassroom = typeof document !== "undefined" && document.documentElement.getAttribute("data-theme") === "classroom";
  ctx.fillStyle = isClassroom ? "rgba(241, 245, 249, 0.95)" : "rgba(30, 41, 59, 0.65)";
  ctx.beginPath();
  ctx.rect(-24, -90, 48, 180);
  ctx.fill();
  ctx.stroke();

  // 3. Rótulos
  ctx.fillStyle = color;
  ctx.font = "bold 7px monospace";
  ctx.textAlign = "left";
  ctx.textBaseline = "middle";
  inY.forEach((y, idx) => {
    ctx.fillText(inLabels[idx], -20, y);
  });

  ctx.textAlign = "right";
  outY.forEach((y, idx) => {
    ctx.fillText(outLabels[idx], 20, y);
  });

  // Título e indicador de valor hex
  ctx.textAlign = "center";
  ctx.font = "bold 8px sans-serif";
  ctx.fillStyle = isClassroom ? "#0F172A" : "rgba(148, 163, 184, 0.9)";
  ctx.fillText("74HC595", 0, -75);
  ctx.font = "7px sans-serif";
  ctx.fillStyle = isClassroom ? "#475569" : "rgba(148, 163, 184, 0.9)";
  ctx.fillText("8-BIT SIPO", 0, -65);

  if (opts?.latchValue !== undefined) {
    ctx.font = "bold 10px monospace";
    ctx.fillStyle = isClassroom ? "#0284C7" : "#38BDF8";
    const hex = `0x${(opts.latchValue & 0xff).toString(16).toUpperCase().padStart(2, "0")}`;
    ctx.fillText(hex, 0, 0);
  }

  ctx.restore();
}

// ─── RENDERIZADORES PARA CD4017, 74HC90, 74HC193, 74HC138 Y 74HC151 ───────

export interface GenericLogicIcRenderOptions {
  readonly inputLevels?: readonly ("1" | "0" | "X" | undefined)[];
  readonly outputLevels?: readonly ("1" | "0" | "X" | undefined)[];
  readonly activeIndex?: number;
  readonly displayValue?: string | number;
}

export function drawJohnsonCounter4017(
  ctx: CanvasRenderingContext2D,
  color: string,
  lineWidth: number,
  opts?: GenericLogicIcRenderOptions,
): void {
  ctx.save();
  ctx.strokeStyle = color;
  ctx.lineWidth = lineWidth;
  ctx.lineCap = "round";
  ctx.lineJoin = "round";

  const inY = [-20, 0, 20]; // CLK, CLK_INH, RST
  const inLabels = ["CLK", "INH", "RST"];
  const outY = [-100, -80, -60, -40, -20, 0, 20, 40, 60, 80, 100]; // Q0..Q9, CO
  const outLabels = ["Q0", "Q1", "Q2", "Q3", "Q4", "Q5", "Q6", "Q7", "Q8", "Q9", "CO"];

  // Leads
  ctx.beginPath();
  inY.forEach((y, idx) => {
    ctx.moveTo(-40, y);
    ctx.lineTo(-24, y);
    drawLogicTerminalNode(ctx, -38, y, opts?.inputLevels?.[idx]);
  });
  outY.forEach((y, idx) => {
    ctx.moveTo(24, y);
    ctx.lineTo(40, y);
    drawLogicTerminalNode(ctx, 38, y, opts?.outputLevels?.[idx]);
  });
  ctx.stroke();

  // Encapsulado
  const isClassroom = typeof document !== "undefined" && document.documentElement.getAttribute("data-theme") === "classroom";
  ctx.fillStyle = isClassroom ? "rgba(241, 245, 249, 0.95)" : "rgba(30, 41, 59, 0.65)";
  ctx.beginPath();
  ctx.rect(-24, -110, 48, 220);
  ctx.fill();
  ctx.stroke();

  // Rótulos
  ctx.fillStyle = color;
  ctx.font = "bold 7px monospace";
  ctx.textAlign = "left";
  ctx.textBaseline = "middle";
  inY.forEach((y, idx) => ctx.fillText(inLabels[idx], -20, y));

  ctx.textAlign = "right";
  outY.forEach((y, idx) => ctx.fillText(outLabels[idx], 20, y));

  ctx.textAlign = "center";
  ctx.font = "bold 8px sans-serif";
  ctx.fillStyle = isClassroom ? "#0F172A" : "rgba(148, 163, 184, 0.9)";
  ctx.fillText("CD4017", 0, -95);
  ctx.font = "6px sans-serif";
  ctx.fillStyle = isClassroom ? "#475569" : "rgba(148, 163, 184, 0.9)";
  ctx.fillText("DECADE", 0, -85);

  if (opts?.activeIndex !== undefined) {
    ctx.font = "bold 12px monospace";
    ctx.fillStyle = isClassroom ? "#0284C7" : "#38BDF8";
    ctx.fillText(`[Q${opts.activeIndex}]`, 0, -50);
  }

  ctx.restore();
}

export function drawBcdCounter90(
  ctx: CanvasRenderingContext2D,
  color: string,
  lineWidth: number,
  opts?: GenericLogicIcRenderOptions,
): void {
  ctx.save();
  ctx.strokeStyle = color;
  ctx.lineWidth = lineWidth;
  ctx.lineCap = "round";

  const inY = [-50, -30, -10, 10, 30, 50]; // CKA, CKB, R0_1, R0_2, R9_1, R9_2
  const inLabels = ["CKA", "CKB", "R0(1)", "R0(2)", "R9(1)", "R9(2)"];
  const outY = [-30, -10, 10, 30]; // QA, QB, QC, QD
  const outLabels = ["QA", "QB", "QC", "QD"];

  ctx.beginPath();
  inY.forEach((y, idx) => {
    ctx.moveTo(-40, y);
    ctx.lineTo(-24, y);
    drawLogicTerminalNode(ctx, -38, y, opts?.inputLevels?.[idx]);
  });
  outY.forEach((y, idx) => {
    ctx.moveTo(24, y);
    ctx.lineTo(40, y);
    drawLogicTerminalNode(ctx, 38, y, opts?.outputLevels?.[idx]);
  });
  ctx.stroke();

  const isClassroom = typeof document !== "undefined" && document.documentElement.getAttribute("data-theme") === "classroom";
  ctx.fillStyle = isClassroom ? "rgba(241, 245, 249, 0.95)" : "rgba(30, 41, 59, 0.65)";
  ctx.beginPath();
  ctx.rect(-24, -60, 48, 120);
  ctx.fill();
  ctx.stroke();

  ctx.fillStyle = color;
  ctx.font = "bold 7px monospace";
  ctx.textAlign = "left";
  ctx.textBaseline = "middle";
  inY.forEach((y, idx) => ctx.fillText(inLabels[idx], -20, y));

  ctx.textAlign = "right";
  outY.forEach((y, idx) => ctx.fillText(outLabels[idx], 20, y));

  ctx.textAlign = "center";
  ctx.font = "bold 8px sans-serif";
  ctx.fillStyle = isClassroom ? "#0F172A" : "rgba(148, 163, 184, 0.9)";
  ctx.fillText("74HC90", 0, -45);

  if (opts?.displayValue !== undefined) {
    ctx.font = "bold 11px monospace";
    ctx.fillStyle = isClassroom ? "#0284C7" : "#38BDF8";
    ctx.fillText(`${opts.displayValue}`, 0, 0);
  }

  ctx.restore();
}

export function drawUpDownCounter193(
  ctx: CanvasRenderingContext2D,
  color: string,
  lineWidth: number,
  opts?: GenericLogicIcRenderOptions,
): void {
  ctx.save();
  ctx.strokeStyle = color;
  ctx.lineWidth = lineWidth;
  ctx.lineCap = "round";

  const inY = [-70, -50, -30, -10, 10, 30, 50, 70]; // CPU, CPD, PL, D0..D3, MR
  const inLabels = ["CPU", "CPD", "PL", "D0", "D1", "D2", "D3", "MR"];
  const outY = [-50, -30, -10, 10, 30, 50]; // Q0..Q3, TCU, TCD
  const outLabels = ["Q0", "Q1", "Q2", "Q3", "TCU", "TCD"];

  ctx.beginPath();
  inY.forEach((y, idx) => {
    ctx.moveTo(-40, y);
    ctx.lineTo(-24, y);
    drawLogicTerminalNode(ctx, -38, y, opts?.inputLevels?.[idx]);
  });
  outY.forEach((y, idx) => {
    ctx.moveTo(24, y);
    ctx.lineTo(40, y);
    drawLogicTerminalNode(ctx, 38, y, opts?.outputLevels?.[idx]);
  });
  ctx.stroke();

  const isClassroom = typeof document !== "undefined" && document.documentElement.getAttribute("data-theme") === "classroom";
  ctx.fillStyle = isClassroom ? "rgba(241, 245, 249, 0.95)" : "rgba(30, 41, 59, 0.65)";
  ctx.beginPath();
  ctx.rect(-24, -80, 48, 160);
  ctx.fill();
  ctx.stroke();

  ctx.fillStyle = color;
  ctx.font = "bold 7px monospace";
  ctx.textAlign = "left";
  ctx.textBaseline = "middle";
  inY.forEach((y, idx) => ctx.fillText(inLabels[idx], -20, y));

  ctx.textAlign = "right";
  outY.forEach((y, idx) => ctx.fillText(outLabels[idx], 20, y));

  ctx.textAlign = "center";
  ctx.font = "bold 8px sans-serif";
  ctx.fillStyle = isClassroom ? "#0F172A" : "rgba(148, 163, 184, 0.9)";
  ctx.fillText("74HC193", 0, -65);
  ctx.font = "6px sans-serif";
  ctx.fillStyle = isClassroom ? "#475569" : "rgba(148, 163, 184, 0.9)";
  ctx.fillText("UP/DOWN", 0, -55);

  if (opts?.displayValue !== undefined) {
    ctx.font = "bold 11px monospace";
    ctx.fillStyle = isClassroom ? "#0284C7" : "#38BDF8";
    ctx.fillText(`${opts.displayValue}`, 0, 0);
  }

  ctx.restore();
}

export function drawDecoder138(
  ctx: CanvasRenderingContext2D,
  color: string,
  lineWidth: number,
  opts?: GenericLogicIcRenderOptions,
): void {
  ctx.save();
  ctx.strokeStyle = color;
  ctx.lineWidth = lineWidth;
  ctx.lineCap = "round";

  const inY = [-50, -30, -10, 10, 30, 50]; // A0, A1, A2, G1, G2A, G2B
  const inLabels = ["A0", "A1", "A2", "G1", "G2A", "G2B"];
  const outY = [-70, -50, -30, -10, 10, 30, 50, 70]; // Y0..Y7
  const outLabels = ["Y0", "Y1", "Y2", "Y3", "Y4", "Y5", "Y6", "Y7"];

  ctx.beginPath();
  inY.forEach((y, idx) => {
    ctx.moveTo(-40, y);
    ctx.lineTo(-24, y);
    drawLogicTerminalNode(ctx, -38, y, opts?.inputLevels?.[idx]);
  });
  outY.forEach((y, idx) => {
    ctx.moveTo(24, y);
    ctx.lineTo(40, y);
    drawLogicTerminalNode(ctx, 38, y, opts?.outputLevels?.[idx]);
  });
  ctx.stroke();

  // Inversión en G2A, G2B y en todas las salidas Y
  ctx.beginPath();
  ctx.arc(-26, 30, 2.5, 0, Math.PI * 2);
  ctx.arc(-26, 50, 2.5, 0, Math.PI * 2);
  outY.forEach((y) => ctx.arc(26, y, 2.5, 0, Math.PI * 2));
  ctx.stroke();

  const isClassroom = typeof document !== "undefined" && document.documentElement.getAttribute("data-theme") === "classroom";
  ctx.fillStyle = isClassroom ? "rgba(241, 245, 249, 0.95)" : "rgba(30, 41, 59, 0.65)";
  ctx.beginPath();
  ctx.rect(-24, -80, 48, 160);
  ctx.fill();
  ctx.stroke();

  ctx.fillStyle = color;
  ctx.font = "bold 7px monospace";
  ctx.textAlign = "left";
  ctx.textBaseline = "middle";
  inY.forEach((y, idx) => ctx.fillText(inLabels[idx], -20, y));

  ctx.textAlign = "right";
  outY.forEach((y, idx) => ctx.fillText(outLabels[idx], 20, y));

  ctx.textAlign = "center";
  ctx.font = "bold 8px sans-serif";
  ctx.fillStyle = isClassroom ? "#0F172A" : "rgba(148, 163, 184, 0.9)";
  ctx.fillText("74HC138", 0, -65);
  ctx.font = "6px sans-serif";
  ctx.fillStyle = isClassroom ? "#475569" : "rgba(148, 163, 184, 0.9)";
  ctx.fillText("DEMUX 3:8", 0, -55);

  ctx.restore();
}

export function drawMultiplexer151(
  ctx: CanvasRenderingContext2D,
  color: string,
  lineWidth: number,
  opts?: GenericLogicIcRenderOptions,
): void {
  ctx.save();
  ctx.strokeStyle = color;
  ctx.lineWidth = lineWidth;
  ctx.lineCap = "round";

  const inY = [-90, -70, -50, -30, -10, 10, 30, 50, 70, 85, 100, 115]; // D0..D7, S0, S1, S2, E
  const inLabels = ["D0", "D1", "D2", "D3", "D4", "D5", "D6", "D7", "S0", "S1", "S2", "E"];
  const outY = [-20, 20]; // Y, W
  const outLabels = ["Y", "W"];

  ctx.beginPath();
  inY.forEach((y, idx) => {
    ctx.moveTo(-40, y);
    ctx.lineTo(-24, y);
    drawLogicTerminalNode(ctx, -38, y, opts?.inputLevels?.[idx]);
  });
  outY.forEach((y, idx) => {
    ctx.moveTo(24, y);
    ctx.lineTo(40, y);
    drawLogicTerminalNode(ctx, 38, y, opts?.outputLevels?.[idx]);
  });
  ctx.stroke();

  // Inversión en E (Strobe) y salida W (Y_NOT)
  ctx.beginPath();
  ctx.arc(-26, 115, 2.5, 0, Math.PI * 2);
  ctx.arc(26, 20, 2.5, 0, Math.PI * 2);
  ctx.stroke();

  const isClassroom = typeof document !== "undefined" && document.documentElement.getAttribute("data-theme") === "classroom";
  ctx.fillStyle = isClassroom ? "rgba(241, 245, 249, 0.95)" : "rgba(30, 41, 59, 0.65)";
  ctx.beginPath();
  ctx.rect(-24, -100, 48, 225);
  ctx.fill();
  ctx.stroke();

  ctx.fillStyle = color;
  ctx.font = "bold 7px monospace";
  ctx.textAlign = "left";
  ctx.textBaseline = "middle";
  inY.forEach((y, idx) => ctx.fillText(inLabels[idx], -20, y));

  ctx.textAlign = "right";
  outY.forEach((y, idx) => ctx.fillText(outLabels[idx], 20, y));

  ctx.textAlign = "center";
  ctx.font = "bold 8px sans-serif";
  ctx.fillStyle = isClassroom ? "#0F172A" : "rgba(148, 163, 184, 0.9)";
  ctx.fillText("74HC151", 0, -85);
  ctx.font = "6px sans-serif";
  ctx.fillStyle = isClassroom ? "#475569" : "rgba(148, 163, 184, 0.9)";
  ctx.fillText("MUX 8:1", 0, -75);

  ctx.restore();
}




