import type { ComponentInstance } from "../canvas_orchestrator";
import {
  BOARD_PIN_LABELS,
  MCU_8051_PIN_LABELS,
  MCU_AVR_PIN_LABELS,
  getBoardRenderInfo,
} from "./component_chip_catalog";

function drawPinStateDot(
  ctx: CanvasRenderingContext2D,
  pinValue: number | string | undefined,
  x: number,
  y: number,
): void {
  ctx.fillStyle = pinValue === 1 || pinValue === "1"
    ? "hsl(355, 80%, 55%)"
    : pinValue === 0 || pinValue === "0"
      ? "hsl(174, 97%, 69%)"
      : "rgba(255,255,255,0.25)";
  ctx.beginPath();
  ctx.arc(x, y, 3, 0, Math.PI * 2);
  ctx.fill();
}

export function drawMcu8051(
  ctx: CanvasRenderingContext2D,
  comp: ComponentInstance,
  color: string,
): void {
  ctx.fillStyle = "rgba(10, 15, 30, 0.85)";
  ctx.fillRect(-50, -220, 100, 420);
  ctx.strokeRect(-50, -220, 100, 420);

  ctx.beginPath();
  ctx.arc(0, -220, 12, 0, Math.PI, false);
  ctx.stroke();

  ctx.fillStyle = color;
  ctx.font = "bold 13px var(--font-sans)";
  ctx.textAlign = "center";
  ctx.fillText("Intel 8051", 0, -40);
  ctx.font = "8px var(--font-mono)";
  ctx.fillStyle = "var(--text-muted)";
  ctx.fillText("MCS-51 ARCH", 0, -25);

  const states = comp.mcuPinStates || {};
  for (let i = 0; i < 40; i++) {
    const isLeft = i < 20;
    const xBody = isLeft ? -50 : 50;
    const xTip = isLeft ? -60 : 60;
    const y = isLeft ? -200 + i * 20 : 180 - (i - 20) * 20;
    const label = MCU_8051_PIN_LABELS[i];

    ctx.beginPath();
    ctx.moveTo(xBody, y);
    ctx.lineTo(xTip, y);
    ctx.stroke();

    drawPinStateDot(ctx, states[i], xTip, y);

    ctx.font = "7px var(--font-mono)";
    ctx.fillStyle = "var(--text-muted)";
    if (isLeft) {
      ctx.textAlign = "left";
      ctx.fillText(label, -44, y + 2.5);
      ctx.textAlign = "right";
      ctx.fillText((i + 1).toString(), -52, y - 2);
    } else {
      ctx.textAlign = "right";
      ctx.fillText(label, 44, y + 2.5);
      ctx.textAlign = "left";
      ctx.fillText((i + 1).toString(), 52, y - 2);
    }
  }
}

export function drawMcuAvr(
  ctx: CanvasRenderingContext2D,
  comp: ComponentInstance,
  color: string,
): void {
  ctx.fillStyle = "rgba(10, 15, 30, 0.85)";
  ctx.fillRect(-50, -160, 100, 300);
  ctx.strokeRect(-50, -160, 100, 300);

  ctx.beginPath();
  ctx.arc(0, -160, 12, 0, Math.PI, false);
  ctx.stroke();

  ctx.fillStyle = color;
  ctx.font = "bold 12px var(--font-sans)";
  ctx.textAlign = "center";
  ctx.fillText("ATmega328P", 0, -30);
  ctx.font = "8px var(--font-mono)";
  ctx.fillStyle = "var(--text-muted)";
  ctx.fillText("AVR 8-BIT MCU", 0, -15);

  const states = comp.mcuPinStates || {};
  for (let i = 0; i < 28; i++) {
    const isLeft = i < 14;
    const xBody = isLeft ? -50 : 50;
    const xTip = isLeft ? -60 : 60;
    const y = isLeft ? -140 + i * 20 : 120 - (i - 14) * 20;
    const label = MCU_AVR_PIN_LABELS[i];

    ctx.beginPath();
    ctx.moveTo(xBody, y);
    ctx.lineTo(xTip, y);
    ctx.stroke();

    drawPinStateDot(ctx, states[i], xTip, y);

    ctx.font = "7px var(--font-mono)";
    ctx.fillStyle = "var(--text-muted)";
    if (isLeft) {
      ctx.textAlign = "left";
      ctx.fillText(label, -44, y + 2.5);
      ctx.textAlign = "right";
      ctx.fillText((i + 1).toString(), -52, y - 2);
    } else {
      ctx.textAlign = "right";
      ctx.fillText(label, 44, y + 2.5);
      ctx.textAlign = "left";
      ctx.fillText((i + 1).toString(), 52, y - 2);
    }
  }
}

export function drawDevelopmentBoard(
  ctx: CanvasRenderingContext2D,
  comp: ComponentInstance,
  color: string,
  isSelected: boolean,
): void {
  const boardInfo = getBoardRenderInfo(comp.type);
  ctx.fillStyle = boardInfo.pcbColor;
  ctx.fillRect(-30, -60, 60, 120);

  ctx.save();
  ctx.strokeStyle = color;
  ctx.lineWidth = isSelected ? 2.5 : 1.5;
  ctx.strokeRect(-30, -60, 60, 120);
  ctx.restore();

  ctx.fillStyle = "white";
  ctx.font = "bold 8px var(--font-sans)";
  ctx.textAlign = "center";
  ctx.fillText(boardInfo.title, 0, -25);
  ctx.font = "6px var(--font-mono)";
  ctx.fillStyle = "rgba(255, 255, 255, 0.6)";
  ctx.fillText("MIXED SIGNAL", 0, -15);

  ctx.fillStyle = "#111";
  ctx.fillRect(-12, 0, 24, 24);
  ctx.strokeStyle = "rgba(255,255,255,0.2)";
  ctx.strokeRect(-12, 0, 24, 24);

  const states = comp.mcuPinStates || {};
  const coords = [
    { x: -30, y: -40, isLeft: true },
    { x: 30, y: -40, isLeft: false },
    { x: -30, y: 0, isLeft: true },
    { x: 30, y: 0, isLeft: false },
    { x: -30, y: 40, isLeft: true },
    { x: 30, y: 40, isLeft: false },
  ];

  for (let i = 0; i < 6; i++) {
    const c = coords[i];
    const xTip = c.isLeft ? -40 : 40;
    const y = c.y;
    const label = BOARD_PIN_LABELS[i];

    ctx.beginPath();
    ctx.moveTo(c.x, y);
    ctx.lineTo(xTip, y);
    ctx.stroke();

    drawPinStateDot(ctx, states[i], xTip, y);

    ctx.font = "6px var(--font-mono)";
    ctx.fillStyle = "rgba(255, 255, 255, 0.7)";
    if (c.isLeft) {
      ctx.textAlign = "left";
      ctx.fillText(label, -26, y + 2.5);
    } else {
      ctx.textAlign = "right";
      ctx.fillText(label, 26, y + 2.5);
    }
  }
}
