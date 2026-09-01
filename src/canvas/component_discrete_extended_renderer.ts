/**
 * Renderizador de dispositivos semiconductores discretos extendidos (Optoacopladores y JFETs).
 * Mantiene la precisión gráfica de simbología electrónica en Canvas 2D.
 */

import type { ComponentInstance } from "../canvas_orchestrator";

export function drawOptocoupler(ctx: CanvasRenderingContext2D, _comp: ComponentInstance, color: string): void {
  // 1. Leads
  // Lado izquierdo: Ánodo (-40, -20) -> (-24, -20), Cátodo (-40, 20) -> (-24, 20)
  ctx.beginPath();
  ctx.moveTo(-40, -20);
  ctx.lineTo(-24, -20);
  ctx.moveTo(-40, 20);
  ctx.lineTo(-24, 20);
  // Lado derecho: Colector (40, -20) -> (24, -20), Emisor (40, 20) -> (24, 20)
  ctx.moveTo(40, -20);
  ctx.lineTo(24, -20);
  ctx.moveTo(40, 20);
  ctx.lineTo(24, 20);
  ctx.stroke();

  // 2. Encapsulado DIP-4 / Contorno
  const isClassroom = typeof document !== "undefined" && document.documentElement.getAttribute("data-theme") === "classroom";
  ctx.save();
  ctx.strokeStyle = isClassroom ? "rgba(2, 132, 199, 0.45)" : "rgba(102, 252, 241, 0.35)";
  ctx.fillStyle = isClassroom ? "rgba(241, 245, 249, 0.95)" : "rgba(10, 15, 26, 0.85)";
  ctx.lineWidth = 1.2;
  ctx.fillRect(-24, -30, 48, 60);
  ctx.strokeRect(-24, -30, 48, 60);
  ctx.restore();

  // 3. Diodo Emisor (Lado izquierdo interno)
  ctx.save();
  ctx.strokeStyle = color;
  ctx.lineWidth = 1.6;
  ctx.beginPath();
  ctx.moveTo(-16, -20);
  ctx.lineTo(-16, -6);
  ctx.moveTo(-16, 6);
  ctx.lineTo(-16, 20);
  ctx.stroke();

  // Triángulo del LED emisor
  ctx.beginPath();
  ctx.moveTo(-22, -6);
  ctx.lineTo(-10, -6);
  ctx.lineTo(-16, 6);
  ctx.closePath();
  ctx.stroke();
  ctx.fillStyle = color;
  ctx.fill();

  // Barra del cátodo
  ctx.beginPath();
  ctx.moveTo(-22, 6);
  ctx.lineTo(-10, 6);
  ctx.stroke();

  // Flechas de emisión de fotones (hacia la derecha/centro)
  ctx.beginPath();
  ctx.moveTo(-7, -4);
  ctx.lineTo(0, 3);
  ctx.lineTo(-2, 3);
  ctx.moveTo(0, 3);
  ctx.lineTo(0, 1);

  ctx.moveTo(-7, 2);
  ctx.lineTo(0, 9);
  ctx.lineTo(-2, 9);
  ctx.moveTo(0, 9);
  ctx.lineTo(0, 7);
  ctx.stroke();

  // 4. Fototransistor (Lado derecho interno)
  // Barra vertical de la base fotosensible
  ctx.beginPath();
  ctx.moveTo(8, -12);
  ctx.lineTo(8, 12);
  ctx.stroke();

  // Rama Colector
  ctx.beginPath();
  ctx.moveTo(8, -6);
  ctx.lineTo(18, -18);
  ctx.lineTo(18, -20);
  ctx.stroke();

  // Rama Emisor con flecha saliente
  ctx.beginPath();
  ctx.moveTo(8, 6);
  ctx.lineTo(18, 18);
  ctx.lineTo(18, 20);
  ctx.stroke();

  // Flecha del emisor (saliente)
  ctx.beginPath();
  ctx.moveTo(13, 12);
  ctx.lineTo(18, 18);
  ctx.lineTo(14, 18);
  ctx.stroke();

  ctx.restore();
}

export function drawJfet(ctx: CanvasRenderingContext2D, _comp: ComponentInstance, isPChannel: boolean, color: string): void {
  // 1. Leads
  // Drenador (pin 1): (20, -40) -> (20, -18) -> (0, -18)
  // Fuente (pin 2): (20, 40) -> (20, 18) -> (0, 18)
  // Compuerta (pin 0): (-40, 0) -> (0, 0)
  ctx.beginPath();
  ctx.moveTo(20, -40);
  ctx.lineTo(20, -18);
  ctx.lineTo(0, -18);

  ctx.moveTo(20, 40);
  ctx.lineTo(20, 18);
  ctx.lineTo(0, 18);

  ctx.moveTo(-40, 0);
  ctx.lineTo(0, 0);
  ctx.stroke();

  // 2. Barra de canal vertical gruesa
  ctx.save();
  ctx.lineWidth = 3.5;
  ctx.strokeStyle = color;
  ctx.beginPath();
  ctx.moveTo(0, -22);
  ctx.lineTo(0, 22);
  ctx.stroke();
  ctx.restore();

  // 3. Flecha de la compuerta (Hacia adentro para Canal-N, hacia afuera para Canal-P)
  ctx.save();
  ctx.fillStyle = color;
  ctx.beginPath();
  if (isPChannel) {
    // Canal P: flecha saliente (apunta hacia la izquierda)
    ctx.moveTo(-16, 0);
    ctx.lineTo(-6, -5);
    ctx.lineTo(-6, 5);
  } else {
    // Canal N: flecha entrante (apunta hacia la derecha / canal)
    ctx.moveTo(-4, 0);
    ctx.lineTo(-14, -5);
    ctx.lineTo(-14, 5);
  }
  ctx.closePath();
  ctx.fill();
  ctx.restore();
}

/** ─── TIRISTOR SCR (2N5064 / BT151) ─── */
export function drawScr(
  ctx: CanvasRenderingContext2D,
  _comp: ComponentInstance,
  color: string,
  isConducting?: boolean,
): void {
  ctx.save();
  ctx.strokeStyle = color;
  ctx.lineWidth = 1.6;
  ctx.lineCap = "round";
  ctx.lineJoin = "round";

  // 1. Leads
  // Ánodo (0, -40) -> (0, -10)
  // Cátodo (0, 10) -> (0, 40)
  // Puerta (-40, 20) -> (-14, 20) -> (-6, 10)
  ctx.beginPath();
  ctx.moveTo(0, -40);
  ctx.lineTo(0, -10);

  ctx.moveTo(0, 10);
  ctx.lineTo(0, 40);

  ctx.moveTo(-40, 20);
  ctx.lineTo(-14, 20);
  ctx.lineTo(-6, 10);
  ctx.stroke();

  // 2. Triángulo del diodo / ánodo
  const isClassroom = typeof document !== "undefined" && document.documentElement.getAttribute("data-theme") === "classroom";
  ctx.beginPath();
  ctx.moveTo(-12, -10);
  ctx.lineTo(12, -10);
  ctx.lineTo(0, 10);
  ctx.closePath();

  if (isConducting) {
    ctx.fillStyle = isClassroom ? "rgba(5, 150, 105, 0.85)" : "rgba(16, 185, 129, 0.85)";
    ctx.fill();
    ctx.strokeStyle = isClassroom ? "#059669" : "#34D399";
  } else {
    ctx.fillStyle = isClassroom ? "rgba(226, 232, 240, 0.6)" : "rgba(15, 23, 42, 0.8)";
    ctx.fill();
  }
  ctx.stroke();

  // 3. Barra del cátodo
  ctx.beginPath();
  ctx.moveTo(-12, 10);
  ctx.lineTo(12, 10);
  ctx.stroke();

  ctx.restore();
}

/** ─── TRIAC (BT136 / BTA16) ─── */
export function drawTriac(
  ctx: CanvasRenderingContext2D,
  _comp: ComponentInstance,
  color: string,
  isConducting?: boolean,
): void {
  const isClassroom = typeof document !== "undefined" && document.documentElement.getAttribute("data-theme") === "classroom";
  ctx.save();
  ctx.strokeStyle = color;
  ctx.lineWidth = 1.6;
  ctx.lineCap = "round";
  ctx.lineJoin = "round";

  // 1. Leads
  // MT2 (0, -40) -> (0, -10)
  // MT1 (0, 10) -> (0, 40)
  // Puerta G (-40, 20) -> (-14, 20) -> (-4, 10)
  ctx.beginPath();
  ctx.moveTo(0, -40);
  ctx.lineTo(0, -10);

  ctx.moveTo(0, 10);
  ctx.lineTo(0, 40);

  ctx.moveTo(-40, 20);
  ctx.lineTo(-14, 20);
  ctx.lineTo(-4, 10);
  ctx.stroke();

  // 2. Doble triángulo antiparalelo
  // Triángulo 1 (hacia abajo)
  ctx.beginPath();
  ctx.moveTo(-12, -10);
  ctx.lineTo(2, -10);
  ctx.lineTo(-5, 10);
  ctx.closePath();

  // Triángulo 2 (hacia arriba)
  ctx.moveTo(-2, 10);
  ctx.lineTo(12, 10);
  ctx.lineTo(5, -10);
  ctx.closePath();

  if (isConducting) {
    ctx.fillStyle = isClassroom ? "rgba(5, 150, 105, 0.85)" : "rgba(16, 185, 129, 0.85)";
    ctx.fill();
    ctx.strokeStyle = isClassroom ? "#059669" : "#34D399";
  } else {
    ctx.fillStyle = isClassroom ? "rgba(226, 232, 240, 0.6)" : "rgba(15, 23, 42, 0.8)";
    ctx.fill();
  }
  ctx.stroke();

  // 3. Barras de ánodo / cátodo duales
  ctx.beginPath();
  ctx.moveTo(-12, -10);
  ctx.lineTo(12, -10);
  ctx.moveTo(-12, 10);
  ctx.lineTo(12, 10);
  ctx.stroke();

  ctx.restore();
}

/** ─── DIAC (DB3 / BR100) ─── */
export function drawDiac(
  ctx: CanvasRenderingContext2D,
  _comp: ComponentInstance,
  color: string,
  isConducting?: boolean,
): void {
  const isClassroom = typeof document !== "undefined" && document.documentElement.getAttribute("data-theme") === "classroom";
  ctx.save();
  ctx.strokeStyle = color;
  ctx.lineWidth = 1.6;
  ctx.lineCap = "round";
  ctx.lineJoin = "round";

  // 1. Leads
  // A1 (0, -40) -> (0, -10)
  // A2 (0, 10) -> (0, 40)
  ctx.beginPath();
  ctx.moveTo(0, -40);
  ctx.lineTo(0, -10);

  ctx.moveTo(0, 10);
  ctx.lineTo(0, 40);
  ctx.stroke();

  // 2. Doble triángulo antiparalelo simétrico
  ctx.beginPath();
  ctx.moveTo(-12, -10);
  ctx.lineTo(2, -10);
  ctx.lineTo(-5, 10);
  ctx.closePath();

  ctx.moveTo(-2, 10);
  ctx.lineTo(12, 10);
  ctx.lineTo(5, -10);
  ctx.closePath();

  if (isConducting) {
    ctx.fillStyle = isClassroom ? "rgba(2, 132, 199, 0.85)" : "rgba(56, 189, 248, 0.85)";
    ctx.fill();
    ctx.strokeStyle = isClassroom ? "#0284C7" : "#38BDF8";
  } else {
    ctx.fillStyle = isClassroom ? "rgba(226, 232, 240, 0.6)" : "rgba(15, 23, 42, 0.8)";
    ctx.fill();
  }
  ctx.stroke();

  // Barras
  ctx.beginPath();
  ctx.moveTo(-12, -10);
  ctx.lineTo(12, -10);
  ctx.moveTo(-12, 10);
  ctx.lineTo(12, 10);
  ctx.stroke();

  ctx.restore();
}

/** ─── REGULADOR SHUNT DE PRECISIÓN TL431 ─── */
export function drawTl431(
  ctx: CanvasRenderingContext2D,
  _comp: ComponentInstance,
  color: string,
  isRegulating?: boolean,
): void {
  const isClassroom = typeof document !== "undefined" && document.documentElement.getAttribute("data-theme") === "classroom";
  ctx.save();
  ctx.strokeStyle = color;
  ctx.lineWidth = 1.6;
  ctx.lineCap = "round";
  ctx.lineJoin = "round";

  // 1. Leads
  // Cátodo K (0, -40) -> (0, -10)
  // Ánodo A (0, 10) -> (0, 40)
  // Referencia REF (-40, 0) -> (-10, 0)
  ctx.beginPath();
  ctx.moveTo(0, -40);
  ctx.lineTo(0, -10);

  ctx.moveTo(0, 10);
  ctx.lineTo(0, 40);

  ctx.moveTo(-40, 0);
  ctx.lineTo(-8, 0);
  ctx.stroke();

  // 2. Triángulo Zener (Ánodo apunta hacia cátodo superior)
  ctx.beginPath();
  ctx.moveTo(-12, 10);
  ctx.lineTo(12, 10);
  ctx.lineTo(0, -10);
  ctx.closePath();

  if (isRegulating) {
    ctx.fillStyle = isClassroom ? "rgba(5, 150, 105, 0.85)" : "rgba(16, 185, 129, 0.85)";
    ctx.fill();
    ctx.strokeStyle = isClassroom ? "#059669" : "#34D399";
  } else {
    ctx.fillStyle = isClassroom ? "rgba(226, 232, 240, 0.6)" : "rgba(15, 23, 42, 0.8)";
    ctx.fill();
  }
  ctx.stroke();

  // 3. Barra de cátodo con alas Zener en forma de Z
  ctx.beginPath();
  ctx.moveTo(-14, -6);
  ctx.lineTo(-12, -10);
  ctx.lineTo(12, -10);
  ctx.lineTo(14, -14);
  ctx.stroke();

  // Rótulo REF
  ctx.fillStyle = isClassroom ? "#475569" : "rgba(148, 163, 184, 0.9)";
  ctx.font = "bold 7px monospace";
  ctx.textAlign = "right";
  ctx.textBaseline = "middle";
  ctx.fillText("REF", -12, -6);

  ctx.restore();
}

export function drawIgbt(
  ctx: CanvasRenderingContext2D,
  comp: ComponentInstance,
  color: string,
  voltageMap?: Record<string, number>,
): void {
  const vG = voltageMap?.[`${comp.id}:0`] ?? 0;
  const vC = voltageMap?.[`${comp.id}:1`] ?? 0;
  const vE = voltageMap?.[`${comp.id}:2`] ?? 0;
  const vGE = vG - vE;
  const vCE = vC - vE;
  const vth = Number(comp.value) || 5.0;
  const isConducting = vGE >= vth && vCE > 0.5;
  const isClassroom = typeof document !== "undefined" && document.documentElement.getAttribute("data-theme") === "classroom";

  ctx.save();
  ctx.strokeStyle = isConducting ? (isClassroom ? "#059669" : "#10B981") : color;
  ctx.lineWidth = isConducting ? 2.4 : 1.8;

  // 1. Terminales externos
  // Compuerta G: (-40, 0) -> (-14, 0)
  ctx.beginPath();
  ctx.moveTo(-40, 0);
  ctx.lineTo(-14, 0);

  // Placa de compuerta aislada (Gate Plate) en x = -14
  ctx.moveTo(-14, -18);
  ctx.lineTo(-14, 18);
  ctx.stroke();

  // 2. Placa de canal/colector en x = -8
  ctx.beginPath();
  ctx.moveTo(-8, -18);
  ctx.lineTo(-8, 18);
  ctx.stroke();

  // 3. Ramas de Colector (arriba) y Emisor (abajo)
  // Colector C: (-8, -10) -> (20, -25) -> (20, -40)
  ctx.beginPath();
  ctx.moveTo(-8, -10);
  ctx.lineTo(20, -25);
  ctx.lineTo(20, -40);

  // Emisor E: (-8, 10) -> (20, 25) -> (20, 40)
  ctx.moveTo(-8, 10);
  ctx.lineTo(20, 25);
  ctx.lineTo(20, 40);
  ctx.stroke();

  // 4. Flecha saliente en el terminal de Emisor (indica N-channel IGBT)
  ctx.beginPath();
  ctx.moveTo(10, 20);
  ctx.lineTo(18, 24);
  ctx.lineTo(13, 27);
  ctx.closePath();
  ctx.fillStyle = isConducting ? (isClassroom ? "#059669" : "#10B981") : color;
  ctx.fill();
  ctx.stroke();

  // 5. Insignia "IGBT"
  ctx.fillStyle = isConducting ? (isClassroom ? "#059669" : "#34D399") : (isClassroom ? "#334155" : "rgba(148, 163, 184, 0.85)");
  ctx.font = "bold 8px monospace";
  ctx.textAlign = "left";
  ctx.textBaseline = "middle";
  ctx.fillText("IGBT", -4, 0);

  ctx.restore();
}

/**
 * Renderiza un Puente Rectificador de Diodos Integrado (Graetz Bridge) de 4 terminales.
 * Pines:
 *  0: Entrada AC 1 (AC1 / ~) en (-40, -20)
 *  1: Entrada AC 2 (AC2 / ~) en (-40,  20)
 *  2: Salida DC+ (+)         en ( 40, -20)
 *  3: Salida DC- (-)         en ( 40,  20)
 */
export function drawDiodeBridge(ctx: CanvasRenderingContext2D, comp: ComponentInstance, color: string): void {
  const isClassroom = typeof document !== "undefined" && document.documentElement.getAttribute("data-theme") === "classroom";

  ctx.save();

  // 1. Terminal Leads
  ctx.strokeStyle = color;
  ctx.lineWidth = 1.5;
  ctx.beginPath();
  // Entrada AC1: (-40, -20) -> (-26, -20)
  ctx.moveTo(-40, -20);
  ctx.lineTo(-26, -20);
  // Entrada AC2: (-40, 20) -> (-26, 20)
  ctx.moveTo(-40, 20);
  ctx.lineTo(-26, 20);
  // Salida DC+: (40, -20) -> (26, -20)
  ctx.moveTo(40, -20);
  ctx.lineTo(26, -20);
  // Salida DC-: (40, 20) -> (26, 20)
  ctx.moveTo(40, 20);
  ctx.lineTo(26, 20);
  ctx.stroke();

  // 2. Encapsulado del Módulo Rectificador (Cuerpo rectangular estilizado con chaflán)
  ctx.save();
  ctx.fillStyle = isClassroom ? "rgba(241, 245, 249, 0.95)" : "rgba(11, 17, 32, 0.92)";
  ctx.strokeStyle = isClassroom ? "rgba(71, 85, 105, 0.5)" : "rgba(56, 189, 248, 0.4)";
  ctx.lineWidth = 1.4;

  const bx = -26;
  const by = -28;
  const bw = 52;
  const bh = 56;
  const rad = 6;

  ctx.beginPath();
  if (typeof ctx.roundRect === "function") {
    ctx.roundRect(bx, by, bw, bh, rad);
  } else {
    ctx.rect(bx, by, bw, bh);
  }
  ctx.fill();
  ctx.stroke();

  // Marca de chaflán de esquina positiva (arriba a la derecha)
  ctx.strokeStyle = isClassroom ? "#DC2626" : "#F43F5E";
  ctx.lineWidth = 1.6;
  ctx.beginPath();
  ctx.moveTo(20, -28);
  ctx.lineTo(26, -22);
  ctx.stroke();
  ctx.restore();

  // 3. Símbolo interno del Rombo de Graetz
  ctx.save();
  ctx.strokeStyle = isClassroom ? "rgba(100, 116, 139, 0.6)" : "rgba(148, 163, 184, 0.5)";
  ctx.lineWidth = 1.2;
  ctx.beginPath();
  ctx.moveTo(0, -18); // Arriba
  ctx.lineTo(16, 0);  // Derecha (+)
  ctx.lineTo(0, 18);  // Abajo
  ctx.lineTo(-16, 0); // Izquierda
  ctx.closePath();
  ctx.stroke();

  // Diodos estilizados en los 4 brazos del rombo
  const drawBridgeDiode = (fromX: number, fromY: number, toX: number, toY: number) => {
    const mx = (fromX + toX) / 2;
    const my = (fromY + toY) / 2;
    const dx = toX - fromX;
    const dy = toY - fromY;
    const len = Math.hypot(dx, dy);
    if (len === 0) return;
    const ux = dx / len;
    const uy = dy / len;
    const px = -uy;
    const py = ux;

    // Triángulo
    ctx.beginPath();
    ctx.moveTo(mx + ux * 3.5, my + uy * 3.5);
    ctx.lineTo(mx - ux * 3.5 + px * 3, my - uy * 3.5 + py * 3);
    ctx.lineTo(mx - ux * 3.5 - px * 3, my - uy * 3.5 - py * 3);
    ctx.closePath();
    ctx.fillStyle = isClassroom ? "#475569" : "#94A3B8";
    ctx.fill();

    // Barra de cátodo
    ctx.beginPath();
    ctx.moveTo(mx + ux * 3.5 + px * 3, my + uy * 3.5 + py * 3);
    ctx.lineTo(mx + ux * 3.5 - px * 3, my + uy * 3.5 - py * 3);
    ctx.stroke();
  };

  // D1: (-16, 0) -> (0, -18) hacia la rama superior (+)
  drawBridgeDiode(-16, 0, 0, -18);
  // D2: (0, 18) -> (-16, 0) desde la rama inferior (-)
  drawBridgeDiode(0, 18, -16, 0);
  // D3: (0, 18) -> (16, 0)
  drawBridgeDiode(0, 18, 16, 0);
  // D4: (16, 0) -> (0, -18)
  drawBridgeDiode(16, 0, 0, -18);
  ctx.restore();

  // 4. Etiquetas de Polaridad en los 4 extremos
  ctx.save();
  ctx.font = "bold 9px 'JetBrains Mono', 'Inter', monospace";
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";

  // AC1: '~'
  ctx.fillStyle = isClassroom ? "#0284C7" : "#38BDF8";
  ctx.fillText("~", -18, -20);

  // AC2: '~'
  ctx.fillText("~", -18, 20);

  // DC+: '+'
  ctx.fillStyle = isClassroom ? "#DC2626" : "#F43F5E";
  ctx.fillText("+", 18, -20);

  // DC-: '-'
  ctx.fillStyle = isClassroom ? "#2563EB" : "#60A5FA";
  ctx.fillText("-", 18, 20);

  // Modelo comercial o identificador
  const modelText = comp.modelName || comp.value?.toString() || "BRIDGE";
  ctx.font = "bold 7.5px 'JetBrains Mono', monospace";
  ctx.fillStyle = isClassroom ? "#334155" : "#94A3B8";
  ctx.fillText(modelText.length > 8 ? modelText.slice(0, 8) : modelText, 0, 0);

  ctx.restore();
  ctx.restore();
}

