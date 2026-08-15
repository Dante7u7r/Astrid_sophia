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
  ctx.save();
  ctx.strokeStyle = "rgba(102, 252, 241, 0.35)";
  ctx.fillStyle = "rgba(10, 15, 26, 0.85)";
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
