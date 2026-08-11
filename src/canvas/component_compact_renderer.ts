import type { ComponentInstance } from "../canvas_orchestrator";
import { shouldDrawStandardLeads } from "./component_render_model";

export function drawCompactComponent(
  ctx: CanvasRenderingContext2D,
  comp: ComponentInstance,
  color: string,
): void {
  ctx.strokeStyle = color;
  ctx.fillStyle = "rgba(8, 12, 22, 0.72)";
  ctx.lineWidth = 2;

  if (shouldDrawStandardLeads(comp.type)) {
    ctx.beginPath();
    ctx.moveTo(-40, 0);
    ctx.lineTo(-22, 0);
    ctx.moveTo(22, 0);
    ctx.lineTo(40, 0);
    ctx.stroke();
  }

  ctx.beginPath();
  switch (comp.type) {
    case "ground":
      ctx.moveTo(0, -20);
      ctx.lineTo(0, 0);
      ctx.moveTo(-14, 0);
      ctx.lineTo(14, 0);
      ctx.moveTo(-8, 6);
      ctx.lineTo(8, 6);
      ctx.stroke();
      break;
    case "mcu_8051":
      ctx.rect(-50, -220, 100, 420);
      ctx.fill();
      ctx.stroke();
      break;
    case "mcu_avr":
      ctx.rect(-50, -160, 100, 300);
      ctx.fill();
      ctx.stroke();
      break;
    case "arduino_uno":
    case "esp32":
    case "raspberry_pi_pico":
      ctx.rect(-30, -60, 60, 120);
      ctx.fill();
      ctx.stroke();
      break;
    case "x": {
      const pinsLeft = Math.ceil((comp.pinCount ?? 4) / 2);
      const totalHeight = Math.max(pinsLeft * 40, 60);
      ctx.rect(-40, -totalHeight / 2, 80, totalHeight);
      ctx.fill();
      ctx.stroke();
      break;
    }
    case "dmm":
      ctx.rect(-24, -36, 48, 72);
      ctx.fill();
      ctx.stroke();
      break;
    case "vsource":
    case "isource":
      ctx.arc(0, 0, 18, 0, Math.PI * 2);
      ctx.fill();
      ctx.stroke();
      break;
    case "capacitor":
      ctx.moveTo(-6, -14);
      ctx.lineTo(-6, 14);
      ctx.moveTo(6, -14);
      ctx.lineTo(6, 14);
      ctx.stroke();
      break;
    case "inductor":
      ctx.moveTo(-20, 0);
      ctx.bezierCurveTo(-12, -10, -8, -10, 0, 0);
      ctx.bezierCurveTo(8, 10, 12, 10, 20, 0);
      ctx.stroke();
      break;
    default:
      ctx.rect(-20, -10, 40, 20);
      ctx.fill();
      ctx.stroke();
      break;
  }
}
