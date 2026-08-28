import type { ComponentInstance } from "../canvas_orchestrator";
import {
  ARDUINO_UNO_PIN_LABELS,
  ESP32_DEVKIT_PIN_LABELS,
  RPI_PICO_PIN_LABELS,
  MCU_8051_PIN_LABELS,
  MCU_AVR_PIN_LABELS,
  MCU_PIC16F84A_PIN_LABELS,
  getBoardRenderInfo,
} from "./component_chip_catalog";

function drawPinStateDot(
  ctx: CanvasRenderingContext2D,
  pinValue: number | string | undefined,
  x: number,
  y: number,
): void {
  const isClassroom = typeof document !== "undefined" && document.documentElement.getAttribute("data-theme") === "classroom";
  ctx.fillStyle = pinValue === 1 || pinValue === "1"
    ? "hsl(355, 80%, 55%)"
    : pinValue === 0 || pinValue === "0"
      ? (isClassroom ? "hsl(174, 90%, 35%)" : "hsl(174, 97%, 69%)")
      : (isClassroom ? "rgba(148, 163, 184, 0.5)" : "rgba(255,255,255,0.25)");
  ctx.beginPath();
  ctx.arc(x, y, 3, 0, Math.PI * 2);
  ctx.fill();
}

export function drawMcu8051(
  ctx: CanvasRenderingContext2D,
  comp: ComponentInstance,
  color: string,
): void {
  const isClassroom = typeof document !== "undefined" && document.documentElement.getAttribute("data-theme") === "classroom";
  ctx.fillStyle = isClassroom ? "rgba(241, 245, 249, 0.95)" : "rgba(10, 15, 30, 0.88)";
  ctx.fillRect(-50, -210, 100, 420);
  ctx.strokeStyle = color;
  ctx.lineWidth = 1.5;
  ctx.strokeRect(-50, -210, 100, 420);

  // Muesca superior DIP (Pin 1 a la izquierda)
  ctx.beginPath();
  ctx.arc(0, -210, 10, 0, Math.PI, false);
  ctx.stroke();

  // Serigrafía del chip
  ctx.fillStyle = isClassroom ? "#0F172A" : color;
  ctx.font = "bold 13px 'Inter', sans-serif";
  ctx.textAlign = "center";
  ctx.fillText("Intel 8051", 0, -40);
  ctx.font = "8px 'JetBrains Mono', monospace";
  ctx.fillStyle = isClassroom ? "#475569" : "#94A3B8";
  ctx.fillText("MCS-51 ARCH", 0, -25);
  ctx.fillText("DIP-40", 0, -12);

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

    ctx.font = "7px 'JetBrains Mono', monospace";
    ctx.fillStyle = isClassroom ? "#334155" : "#94A3B8";
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
  const isClassroom = typeof document !== "undefined" && document.documentElement.getAttribute("data-theme") === "classroom";
  ctx.fillStyle = isClassroom ? "rgba(241, 245, 249, 0.95)" : "rgba(10, 15, 30, 0.88)";
  ctx.fillRect(-50, -160, 100, 320);
  ctx.strokeStyle = color;
  ctx.lineWidth = 1.5;
  ctx.strokeRect(-50, -160, 100, 320);

  // Muesca superior DIP
  ctx.beginPath();
  ctx.arc(0, -160, 10, 0, Math.PI, false);
  ctx.stroke();

  ctx.fillStyle = isClassroom ? "#0F172A" : color;
  ctx.font = "bold 12px 'Inter', sans-serif";
  ctx.textAlign = "center";
  ctx.fillText("ATmega328P", 0, -30);
  ctx.font = "8px 'JetBrains Mono', monospace";
  ctx.fillStyle = isClassroom ? "#475569" : "#94A3B8";
  ctx.fillText("AVR 8-BIT MCU", 0, -15);
  ctx.fillText("DIP-28", 0, -2);

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

    ctx.font = "7px 'JetBrains Mono', monospace";
    ctx.fillStyle = isClassroom ? "#334155" : "#94A3B8";
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

export function drawMcuPic16(
  ctx: CanvasRenderingContext2D,
  comp: ComponentInstance,
  color: string,
): void {
  const isClassroom = typeof document !== "undefined" && document.documentElement.getAttribute("data-theme") === "classroom";
  ctx.fillStyle = isClassroom ? "rgba(241, 245, 249, 0.95)" : "rgba(10, 15, 30, 0.88)";
  ctx.fillRect(-50, -110, 100, 220);
  ctx.strokeStyle = color;
  ctx.lineWidth = 1.5;
  ctx.strokeRect(-50, -110, 100, 220);

  // Muesca superior DIP
  ctx.beginPath();
  ctx.arc(0, -110, 10, 0, Math.PI, false);
  ctx.stroke();

  ctx.fillStyle = isClassroom ? "#0F172A" : color;
  ctx.font = "bold 12px 'Inter', sans-serif";
  ctx.textAlign = "center";
  ctx.fillText("PIC16F84A", 0, -25);
  ctx.font = "8px 'JetBrains Mono', monospace";
  ctx.fillStyle = isClassroom ? "#475569" : "#94A3B8";
  ctx.fillText("MICROCHIP RISC", 0, -10);
  ctx.fillText("DIP-18", 0, 3);

  const states = comp.mcuPinStates || {};
  for (let i = 0; i < 18; i++) {
    const isLeft = i < 9;
    const xBody = isLeft ? -50 : 50;
    const xTip = isLeft ? -60 : 60;
    const y = isLeft ? -90 + i * 20 : 70 - (i - 9) * 20;
    const label = MCU_PIC16F84A_PIN_LABELS[i];

    ctx.beginPath();
    ctx.moveTo(xBody, y);
    ctx.lineTo(xTip, y);
    ctx.stroke();

    drawPinStateDot(ctx, states[i], xTip + (isLeft ? -5 : 5), y);

    ctx.fillStyle = isClassroom ? "#334155" : "#94A3B8";
    ctx.font = "8px 'JetBrains Mono', monospace";
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

export function drawArduinoUnoBoard(
  ctx: CanvasRenderingContext2D,
  comp: ComponentInstance,
  color: string,
  isSelected: boolean,
): void {
  // 1. PCB Azul Marino Oficial Arduino Uno
  ctx.fillStyle = "rgba(0, 80, 130, 0.92)";
  ctx.fillRect(-60, -150, 120, 300);

  ctx.save();
  ctx.strokeStyle = color;
  ctx.lineWidth = isSelected ? 2.5 : 1.5;
  ctx.strokeRect(-60, -150, 120, 300);
  ctx.restore();

  // 2. Conectores externos y periféricos
  // Conector USB-B (Arriba Izquierda)
  ctx.fillStyle = "rgba(180, 190, 200, 0.85)";
  ctx.fillRect(-55, -145, 24, 28);
  ctx.strokeStyle = "#475569";
  ctx.strokeRect(-55, -145, 24, 28);

  // Jack de Alimentación DC Barrel (Abajo Izquierda)
  ctx.fillStyle = "#1e293b";
  ctx.fillRect(-55, 110, 26, 32);
  ctx.strokeStyle = "#475569";
  ctx.strokeRect(-55, 110, 26, 32);

  // Chip MCU ATmega328P en zócalo central
  ctx.fillStyle = "rgba(15, 23, 42, 0.95)";
  ctx.fillRect(-18, -35, 36, 90);
  ctx.strokeStyle = "rgba(255,255,255,0.3)";
  ctx.strokeRect(-18, -35, 36, 90);

  // Muesca del chip ATmega328P
  ctx.beginPath();
  ctx.arc(0, -35, 4, 0, Math.PI, false);
  ctx.stroke();

  // Serigrafía central
  ctx.fillStyle = "white";
  ctx.font = "bold 9px 'Inter', sans-serif";
  ctx.textAlign = "center";
  ctx.fillText("ARDUINO", 0, -60);
  ctx.font = "bold 8px 'Inter', sans-serif";
  ctx.fillStyle = "rgba(255, 255, 255, 0.85)";
  ctx.fillText("UNO R3", 0, -48);

  // Botón de Reset y LED L
  ctx.fillStyle = "#DC2626"; // Botón rojo
  ctx.fillRect(28, -135, 12, 12);
  const glowL = comp.glowLevel ?? (comp.mcuPinStates?.[27] === 1 ? 1 : 0);
  ctx.fillStyle = glowL > 0 ? "#FACC15" : "rgba(255,255,255,0.2)";
  ctx.beginPath();
  ctx.arc(34, -110, 3.5, 0, Math.PI * 2);
  ctx.fill();

  // 3. Tiras de cabeceras (14 izquierda, 14 derecha)
  const states = comp.mcuPinStates || {};
  for (let i = 0; i < 28; i++) {
    const isLeft = i < 14;
    const xBody = isLeft ? -60 : 60;
    const xTip = isLeft ? -70 : 70;
    const y = isLeft ? -130 + i * 20 : -130 + (i - 14) * 20;
    const label = ARDUINO_UNO_PIN_LABELS[i];

    ctx.beginPath();
    ctx.moveTo(xBody, y);
    ctx.lineTo(xTip, y);
    ctx.stroke();

    drawPinStateDot(ctx, states[i], xTip, y);

    ctx.font = "6.5px 'JetBrains Mono', monospace";
    ctx.fillStyle = "rgba(255, 255, 255, 0.85)";
    if (isLeft) {
      ctx.textAlign = "left";
      ctx.fillText(label, -54, y + 2.5);
    } else {
      ctx.textAlign = "right";
      ctx.fillText(label, 54, y + 2.5);
    }
  }
}

export function drawEsp32DevKitBoard(
  ctx: CanvasRenderingContext2D,
  comp: ComponentInstance,
  color: string,
  isSelected: boolean,
): void {
  // 1. PCB Negro Mate
  ctx.fillStyle = "rgba(25, 28, 35, 0.94)";
  ctx.fillRect(-50, -160, 100, 320);

  ctx.save();
  ctx.strokeStyle = color;
  ctx.lineWidth = isSelected ? 2.5 : 1.5;
  ctx.strokeRect(-50, -160, 100, 320);
  ctx.restore();

  // Blindaje metálico RF ESP-WROOM-32
  ctx.fillStyle = "rgba(160, 170, 185, 0.85)";
  ctx.fillRect(-35, -145, 70, 80);
  ctx.strokeStyle = "#64748B";
  ctx.strokeRect(-35, -145, 70, 80);

  // Trazas antena PCB superior
  ctx.strokeStyle = "rgba(234, 179, 8, 0.7)";
  ctx.lineWidth = 1.2;
  ctx.beginPath();
  ctx.moveTo(-25, -135);
  ctx.lineTo(-25, -142);
  ctx.lineTo(25, -142);
  ctx.lineTo(25, -135);
  ctx.stroke();

  // Micro-USB en la parte inferior
  ctx.fillStyle = "rgba(180, 190, 200, 0.9)";
  ctx.fillRect(-15, 142, 30, 16);
  ctx.strokeStyle = "#475569";
  ctx.strokeRect(-15, 142, 30, 16);

  // Serigrafía central
  ctx.fillStyle = "white";
  ctx.font = "bold 9px 'Inter', sans-serif";
  ctx.textAlign = "center";
  ctx.fillText("ESP32", 0, -45);
  ctx.font = "6.5px 'JetBrains Mono', monospace";
  ctx.fillStyle = "rgba(255, 255, 255, 0.65)";
  ctx.fillText("Wi-Fi + BT BLE", 0, -32);

  // 15 pines izquierda, 15 pines derecha
  const states = comp.mcuPinStates || {};
  for (let i = 0; i < 30; i++) {
    const isLeft = i < 15;
    const xBody = isLeft ? -50 : 50;
    const xTip = isLeft ? -60 : 60;
    const y = isLeft ? -140 + i * 20 : -140 + (i - 15) * 20;
    const label = ESP32_DEVKIT_PIN_LABELS[i];

    ctx.beginPath();
    ctx.moveTo(xBody, y);
    ctx.lineTo(xTip, y);
    ctx.stroke();

    drawPinStateDot(ctx, states[i], xTip, y);

    ctx.font = "6.5px 'JetBrains Mono', monospace";
    ctx.fillStyle = "rgba(255, 255, 255, 0.85)";
    if (isLeft) {
      ctx.textAlign = "left";
      ctx.fillText(label, -45, y + 2.5);
    } else {
      ctx.textAlign = "right";
      ctx.fillText(label, 45, y + 2.5);
    }
  }
}

export function drawRpiPicoBoard(
  ctx: CanvasRenderingContext2D,
  comp: ComponentInstance,
  color: string,
  isSelected: boolean,
): void {
  // 1. PCB Verde Esmeralda Raspberry Pi
  ctx.fillStyle = "rgba(0, 110, 55, 0.92)";
  ctx.fillRect(-50, -210, 100, 420);

  ctx.save();
  ctx.strokeStyle = color;
  ctx.lineWidth = isSelected ? 2.5 : 1.5;
  ctx.strokeRect(-50, -210, 100, 420);
  ctx.restore();

  // Micro-USB superior
  ctx.fillStyle = "rgba(180, 190, 200, 0.9)";
  ctx.fillRect(-15, -208, 30, 16);
  ctx.strokeStyle = "#475569";
  ctx.strokeRect(-15, -208, 30, 16);

  // Procesador RP2040 central
  ctx.fillStyle = "rgba(15, 23, 42, 0.95)";
  ctx.fillRect(-20, -20, 40, 40);
  ctx.strokeStyle = "rgba(255,255,255,0.4)";
  ctx.strokeRect(-20, -20, 40, 40);

  // Botón BOOTSEL
  ctx.fillStyle = "#E2E8F0";
  ctx.fillRect(-12, -70, 24, 14);

  // Serigrafía central
  ctx.fillStyle = "white";
  ctx.font = "bold 9px 'Inter', sans-serif";
  ctx.textAlign = "center";
  ctx.fillText("Raspberry Pi", 0, -40);
  ctx.font = "bold 8px 'Inter', sans-serif";
  ctx.fillText("Pico RP2040", 0, 35);

  // 20 pines izquierda, 20 pines derecha
  const states = comp.mcuPinStates || {};
  for (let i = 0; i < 40; i++) {
    const isLeft = i < 20;
    const xBody = isLeft ? -50 : 50;
    const xTip = isLeft ? -60 : 60;
    const y = isLeft ? -190 + i * 20 : -190 + (i - 20) * 20;
    const label = RPI_PICO_PIN_LABELS[i];

    ctx.beginPath();
    ctx.moveTo(xBody, y);
    ctx.lineTo(xTip, y);
    ctx.stroke();

    drawPinStateDot(ctx, states[i], xTip, y);

    ctx.font = "6.5px 'JetBrains Mono', monospace";
    ctx.fillStyle = "rgba(255, 255, 255, 0.85)";
    if (isLeft) {
      ctx.textAlign = "left";
      ctx.fillText(label, -45, y + 2.5);
    } else {
      ctx.textAlign = "right";
      ctx.fillText(label, 45, y + 2.5);
    }
  }
}

export function drawDevelopmentBoard(
  ctx: CanvasRenderingContext2D,
  comp: ComponentInstance,
  color: string,
  isSelected: boolean,
): void {
  if (comp.type === "arduino_uno") {
    drawArduinoUnoBoard(ctx, comp, color, isSelected);
  } else if (comp.type === "esp32") {
    drawEsp32DevKitBoard(ctx, comp, color, isSelected);
  } else if (comp.type === "raspberry_pi_pico") {
    drawRpiPicoBoard(ctx, comp, color, isSelected);
  } else {
    // Fallback genérico
    const boardInfo = getBoardRenderInfo(comp.type);
    ctx.fillStyle = boardInfo.pcbColor;
    ctx.fillRect(-30, -60, 60, 120);
    ctx.strokeStyle = color;
    ctx.strokeRect(-30, -60, 60, 120);
  }
}

