import { type ComponentInstance } from "../canvas_orchestrator";
import {
  DMM_INITIAL_DISPLAY,
  normalizeDmmMode,
} from "../simulation/dmm";
import { drawCompactComponent } from "./component_compact_renderer";
import {
  formatComponentValue,
  getComponentLabelLayout,
  getComponentVisualState,
  shouldDrawStandardLeads,
  shouldDrawValueLabel,
} from "./component_render_model";
import {
  drawDevelopmentBoard,
  drawMcu8051,
  drawMcuAvr,
} from "./component_chip_renderer";
import {
  drawBuzzer,
  drawLamp,
  drawRelay,
} from "./component_actuator_renderer";
import {
  drawLed,
  drawSwitch,
  drawTransformer,
} from "./component_discrete_renderer";

export interface ComponentRenderOptions {
  readonly detail?: "full" | "compact";
}

export function drawComponentSymbol(
  ctx: CanvasRenderingContext2D,
  comp: ComponentInstance,
  isSelected: boolean,
  isHovered: boolean,
  options: ComponentRenderOptions = {},
): void {
  ctx.save();
  ctx.translate(comp.x, comp.y);
  ctx.rotate((comp.rotation * Math.PI) / 180);
  if (comp.mirror) {
    ctx.scale(-1, 1);
  }

  const visualState = getComponentVisualState(isSelected, isHovered);
  const { color } = visualState;

  ctx.strokeStyle = color;
  ctx.lineWidth = visualState.lineWidth;
  ctx.fillStyle = "rgba(8, 12, 22, 0.75)";

  if (visualState.shadowBlur > 0) {
    ctx.shadowColor = color;
    ctx.shadowBlur = visualState.shadowBlur;
  }

  if (options.detail === "compact" && !isSelected && !isHovered) {
    drawCompactComponent(ctx, comp, color);
    ctx.restore();
    return;
  }

  // 1. Draw Leads
  if (shouldDrawStandardLeads(comp.type)) {
    ctx.beginPath();
    ctx.moveTo(-40, 0);
    ctx.lineTo(-20, 0);
    ctx.moveTo(20, 0);
    ctx.lineTo(40, 0);
    ctx.stroke();
  } else if (comp.type === 'ground') {
    ctx.beginPath();
    ctx.moveTo(0, -20);
    ctx.lineTo(0, 0);
    ctx.stroke();
  }

  // 2. Draw Core Symbol Body
  ctx.beginPath();
  switch (comp.type) {
    case 'dmm': {
      // Casing
      ctx.rect(-24, -36, 48, 72);
      ctx.stroke();

      // LCD display screen background
      ctx.fillStyle = "rgba(10, 25, 10, 0.9)";
      ctx.fillRect(-18, -30, 36, 18);
      ctx.strokeStyle = "rgba(255, 255, 255, 0.1)";
      ctx.strokeRect(-18, -30, 36, 18);

      // Text value on LCD
      ctx.save();
      ctx.fillStyle = "#39ff14"; // Neon green digital color
      ctx.font = "bold 8px var(--font-mono)";
      ctx.textAlign = "center";

      const mode = normalizeDmmMode(comp.value);
      const valStr = comp.dmmValue ?? DMM_INITIAL_DISPLAY;
      ctx.fillText(valStr, 0, -18);

      ctx.fillStyle = "rgba(57, 255, 20, 0.4)";
      ctx.font = "bold 6px var(--font-mono)";
      ctx.fillText(mode, 13, -14);
      ctx.restore();

      // Dial Knob
      ctx.beginPath();
      ctx.arc(0, 14, 8, 0, 2 * Math.PI);
      ctx.stroke();

      ctx.beginPath();
      ctx.moveTo(0, 14);
      const angle = mode === "V" ? -Math.PI / 2 : mode === "A" ? Math.PI / 6 : 5 * Math.PI / 6;
      ctx.lineTo(6 * Math.cos(angle), 14 + 6 * Math.sin(angle));
      ctx.stroke();

      // Terminal indicators +/-
      ctx.fillStyle = "rgba(255,255,255,0.4)";
      ctx.font = "bold 8px var(--font-sans)";
      ctx.fillText("+", -12, 6);
      ctx.fillText("-", 12, 6);

      // Leads connections from -24 to -40 and +24 to +40
      ctx.beginPath();
      ctx.moveTo(-24, 0);
      ctx.lineTo(-40, 0);
      ctx.moveTo(24, 0);
      ctx.lineTo(40, 0);
      ctx.stroke();
      break;
    }

    case 'resistor':
      // Zig-zag symbol
      ctx.moveTo(-20, 0);
      ctx.lineTo(-15, -8);
      ctx.lineTo(-10, 8);
      ctx.lineTo(-5, -8);
      ctx.lineTo(0, 8);
      ctx.lineTo(5, -8);
      ctx.lineTo(10, 8);
      ctx.lineTo(15, -8);
      ctx.lineTo(20, 0);
      ctx.stroke();
      break;

    case 'potentiometer':
      // Zig-zag symbol
      ctx.moveTo(-20, 0);
      ctx.lineTo(-15, -8);
      ctx.lineTo(-10, 8);
      ctx.lineTo(-5, -8);
      ctx.lineTo(0, 8);
      ctx.lineTo(5, -8);
      ctx.lineTo(10, 8);
      ctx.lineTo(15, -8);
      ctx.lineTo(20, 0);
      ctx.stroke();

      // Wiper line and arrow head pointing to the middle
      ctx.beginPath();
      ctx.moveTo(0, 40);
      ctx.lineTo(0, 15);
      // Arrow head pointing up
      ctx.lineTo(0, 5);
      ctx.lineTo(-4, 10);
      ctx.moveTo(0, 5);
      ctx.lineTo(4, 10);
      ctx.stroke();
      break;

    case 'ldr':
      // 1. Resistor zig-zag core
      ctx.moveTo(-20, 0);
      ctx.lineTo(-15, -8);
      ctx.lineTo(-10, 8);
      ctx.lineTo(-5, -8);
      ctx.lineTo(0, 8);
      ctx.lineTo(5, -8);
      ctx.lineTo(10, 8);
      ctx.lineTo(15, -8);
      ctx.lineTo(20, 0);
      ctx.stroke();

      // 2. Outer circle
      ctx.beginPath();
      ctx.arc(0, 0, 24, 0, 2 * Math.PI);
      ctx.stroke();

      // 3. Two incoming light arrows pointing from top-left to center-ish
      ctx.beginPath();
      ctx.moveTo(-22, -22);
      ctx.lineTo(-12, -12);
      // Arrow head 1
      ctx.lineTo(-12, -16);
      ctx.moveTo(-12, -12);
      ctx.lineTo(-16, -12);

      // Arrow 2
      ctx.moveTo(-16, -26);
      ctx.lineTo(-6, -16);
      // Arrow head 2
      ctx.lineTo(-6, -20);
      ctx.moveTo(-6, -16);
      ctx.lineTo(-10, -16);
      ctx.stroke();
      break;

    case 'thermistor':
      // 1. Resistor zig-zag core
      ctx.moveTo(-20, 0);
      ctx.lineTo(-15, -8);
      ctx.lineTo(-10, 8);
      ctx.lineTo(-5, -8);
      ctx.lineTo(0, 8);
      ctx.lineTo(5, -8);
      ctx.lineTo(10, 8);
      ctx.lineTo(15, -8);
      ctx.lineTo(20, 0);
      ctx.stroke();

      // 2. Diagonal temperature control line with small foot
      ctx.beginPath();
      ctx.moveTo(-26, 12);
      ctx.lineTo(-22, 12);
      ctx.lineTo(22, -12);
      ctx.stroke();

      // 3. Small "-t°" label beside it
      ctx.fillStyle = "currentColor";
      ctx.font = "bold 10px var(--font-sans)";
      ctx.fillText("-t°", 15, -13);
      break;

    case 'capacitor':
      // Parallel plates
      ctx.moveTo(-6, -14);
      ctx.lineTo(-6, 14);
      ctx.moveTo(6, -14);
      ctx.lineTo(6, 14);
      ctx.stroke();
      break;

    case 'inductor':
      // Curved coils
      ctx.moveTo(-20, 0);
      for (let i = 0; i < 4; i++) {
        const startX = -20 + i * 10;
        ctx.arc(startX + 5, 0, 5, Math.PI, 0, false);
      }
      ctx.stroke();
      break;

    case 'diode':
      // Triangle + bar
      ctx.moveTo(-12, -10);
      ctx.lineTo(-12, 10);
      ctx.lineTo(8, 0);
      ctx.closePath();
      ctx.fill();
      ctx.stroke();

      ctx.beginPath();
      ctx.moveTo(8, -10);
      ctx.lineTo(8, 10);
      ctx.stroke();
      break;

    case 'nmos':
      // MOSFET Canal N
      // Canal vertical central
      ctx.moveTo(10, -20);
      ctx.lineTo(10, 20);
      
      // Placa a la izquierda (Puerta / Gate)
      ctx.moveTo(-10, -15);
      ctx.lineTo(-10, 15);
      
      // Terminal de la Puerta (Gate)
      ctx.moveTo(-10, 0);
      ctx.lineTo(-40, 0);
      
      // Terminal del Drenaje (Drain)
      ctx.moveTo(10, -15);
      ctx.lineTo(20, -15);
      ctx.lineTo(20, -40);
      
      // Terminal de la Fuente (Source)
      ctx.moveTo(10, 15);
      ctx.lineTo(20, 15);
      ctx.lineTo(20, 40);
      
      // Flecha característica apuntando al sustrato (canal N)
      ctx.moveTo(10, 15);
      ctx.lineTo(15, 11);
      ctx.moveTo(10, 15);
      ctx.lineTo(15, 19);
      
      ctx.stroke();
      break;

    case 'pmos':
      // MOSFET Canal P
      // Canal vertical central
      ctx.moveTo(10, -20);
      ctx.lineTo(10, 20);
      
      // Burbuja de inversión en puerta
      ctx.moveTo(-6, 0);
      ctx.stroke();
      ctx.beginPath();
      ctx.arc(-11, 0, 4, 0, Math.PI * 2);
      ctx.stroke();
      
      // Placa a la izquierda (Puerta / Gate)
      ctx.beginPath();
      ctx.moveTo(-6, -15);
      ctx.lineTo(-6, 15);
      
      // Terminal de la Puerta (Gate)
      ctx.moveTo(-15, 0);
      ctx.lineTo(-40, 0);
      
      // Terminal del Drenaje (Drain)
      ctx.moveTo(10, -15);
      ctx.lineTo(20, -15);
      ctx.lineTo(20, -40);
      
      // Terminal de la Fuente (Source)
      ctx.moveTo(10, 15);
      ctx.lineTo(20, 15);
      ctx.lineTo(20, 40);
      
      // Flecha en la fuente apuntando hacia el canal (invertida respecto a NMOS)
      ctx.moveTo(15, 15);
      ctx.lineTo(10, 11);
      ctx.moveTo(15, 15);
      ctx.lineTo(10, 19);
      
      ctx.stroke();
      break;

    case 'npn':
      // BJT NPN
      // Barra vertical de la Base
      ctx.moveTo(-10, -20);
      ctx.lineTo(-10, 20);
      
      // Terminal de la Base (Base)
      ctx.moveTo(-10, 0);
      ctx.lineTo(-40, 0);
      
      // Colector (Collector)
      ctx.moveTo(-10, -10);
      ctx.lineTo(20, -25);
      ctx.lineTo(20, -40);
      
      // Emisor (Emitter)
      ctx.moveTo(-10, 10);
      ctx.lineTo(20, 25);
      ctx.lineTo(20, 40);
      
      // Flecha en el emisor apuntando hacia AFUERA
      ctx.moveTo(20, 25);
      ctx.lineTo(12, 23);
      ctx.moveTo(20, 25);
      ctx.lineTo(17, 17);
      
      ctx.stroke();
      break;

    case 'pnp':
      // BJT PNP
      // Barra vertical de la Base
      ctx.moveTo(-10, -20);
      ctx.lineTo(-10, 20);
      
      // Terminal de la Base (Base)
      ctx.moveTo(-10, 0);
      ctx.lineTo(-40, 0);
      
      // Colector (Collector)
      ctx.moveTo(-10, -10);
      ctx.lineTo(20, -25);
      ctx.lineTo(20, -40);
      
      // Emisor (Emitter)
      ctx.moveTo(-10, 10);
      ctx.lineTo(20, 25);
      ctx.lineTo(20, 40);
      
      // Flecha en el emisor apuntando hacia ADENTRO
      ctx.moveTo(-10, 10);
      ctx.lineTo(-2, 12);
      ctx.moveTo(-10, 10);
      ctx.lineTo(-5, 18);
      
      ctx.stroke();
      break;

    case 'vsource':
      // Circle with + and - signs
      ctx.arc(0, 0, 18, 0, Math.PI * 2);
      ctx.fill();
      ctx.stroke();

      // Plus and minus
      ctx.strokeStyle = color;
      ctx.lineWidth = 1.5;
      // Plus (+) near positive side (-10)
      ctx.beginPath();
      ctx.moveTo(-11, 0);
      ctx.lineTo(-5, 0);
      ctx.moveTo(-8, -3);
      ctx.lineTo(-8, 3);
      // Minus (-) near negative side (10)
      ctx.moveTo(5, 0);
      ctx.lineTo(11, 0);
      ctx.stroke();
      break;

    case 'ground':
      // Horizontal parallel lines of decreasing size
      ctx.moveTo(-14, 0);
      ctx.lineTo(14, 0);
      ctx.moveTo(-9, 5);
      ctx.lineTo(9, 5);
      ctx.moveTo(-4, 10);
      ctx.lineTo(4, 10);
      ctx.stroke();
      break;

    case 'opamp':
      // Triángulo de Op-Amp de 5 pines
      // 1. Cuerpo principal (triángulo apuntando a la derecha)
      ctx.beginPath();
      ctx.moveTo(-30, -30);
      ctx.lineTo(-30, 30);
      ctx.lineTo(30, 0);
      ctx.closePath();
      ctx.fill();
      ctx.stroke();

      // 2. Terminales de Pines Físicos
      ctx.beginPath();
      // Entrada No Inversora (In+) en (-40, -15)
      ctx.moveTo(-30, -15);
      ctx.lineTo(-40, -15);
      
      // Entrada Inversora (In-) en (-40, 15)
      ctx.moveTo(-30, 15);
      ctx.lineTo(-40, 15);

      // Alimentación V+ en (0, -40)
      ctx.moveTo(0, -15);
      ctx.lineTo(0, -40);

      // Alimentación V- en (0, 40)
      ctx.moveTo(0, 15);
      ctx.lineTo(0, 40);

      // Salida Out en (40, 0)
      ctx.moveTo(30, 0);
      ctx.lineTo(40, 0);
      
      // 3. Signos + y - interiores
      // Signo + en Entrada No Inversora
      ctx.moveTo(-24, -15);
      ctx.lineTo(-16, -15);
      ctx.moveTo(-20, -19);
      ctx.lineTo(-20, -11);

      // Signo - en Entrada Inversora
      ctx.moveTo(-24, 15);
      ctx.lineTo(-16, 15);

      ctx.stroke();
      break;

    case 'lamp':
      drawLamp(ctx, comp);
      break;

    case 'relay':
      drawRelay(ctx, comp);
      break;

    case 'buzzer':
      drawBuzzer(ctx, comp);
      break;
    case 'mcu_8051':
      drawMcu8051(ctx, comp, color);
      break;

    case 'mcu_avr':
      drawMcuAvr(ctx, comp, color);
      break;

    case 'arduino_uno':
    case 'esp32':
    case 'raspberry_pi_pico':
      drawDevelopmentBoard(ctx, comp, color, isSelected);
      break;
    case 'isource': {
      // Circle with arrow inside (current source symbol)
      ctx.arc(0, 0, 18, 0, Math.PI * 2);
      ctx.fill();
      ctx.stroke();

      // Arrow inside circle
      ctx.strokeStyle = color;
      ctx.lineWidth = 1.5;
      ctx.beginPath();
      ctx.moveTo(-6, -6);
      ctx.lineTo(0, 0);
      ctx.lineTo(-6, 6);
      ctx.moveTo(0, 0);
      ctx.lineTo(8, 0);
      ctx.stroke();
      break;
    }

    case 'led':
      drawLed(ctx, comp, color);
      break;

    case 'switch':
      drawSwitch(ctx, comp);
      break;

    case 'transformer':
      drawTransformer(ctx, color);
      break;

    // --- Caja negra para Subcircuito Genérico (tipo 'x') ---
    case 'x': {
      const pinCount = comp.pinCount ?? 4;
      const pinsLeft = Math.ceil(pinCount / 2);
      const totalHeight = Math.max(pinsLeft * 40, 60);
      const halfH = totalHeight / 2;

      // 1. Hilos de conexión (Leads) desde el cuerpo (-40) hasta el terminal (-60)
      ctx.strokeStyle = color;
      ctx.lineWidth = isSelected ? 3 : 2;
      ctx.beginPath();
      for (let i = 0; i < pinCount; i++) {
        const pos = Math.floor(i / 2);
        const yPin = -halfH + 20 + pos * 40;
        if (i % 2 === 0) {
          ctx.moveTo(-60, yPin);
          ctx.lineTo(-40, yPin);
        } else {
          ctx.moveTo(40, yPin);
          ctx.lineTo(60, yPin);
        }
      }
      ctx.stroke();

      // 2. Caja negra con estética premium Glassmorphic
      ctx.fillStyle = "rgba(8, 12, 22, 0.85)";
      ctx.strokeStyle = color;
      ctx.lineWidth = isSelected ? 2.5 : 1.5;
      if (isSelected || isHovered) {
        ctx.shadowColor = color;
        ctx.shadowBlur = isSelected ? 10 : 5;
      }
      const r = 6; // Radio de redondeo
      ctx.beginPath();
      ctx.moveTo(-40 + r, -halfH);
      ctx.lineTo(40 - r, -halfH);
      ctx.arcTo(40, -halfH, 40, -halfH + r, r);
      ctx.lineTo(40, halfH - r);
      ctx.arcTo(40, halfH, 40 - r, halfH, r);
      ctx.lineTo(-40 + r, halfH);
      ctx.arcTo(-40, halfH, -40, halfH - r, r);
      ctx.lineTo(-40, -halfH + r);
      ctx.arcTo(-40, -halfH, -40 + r, -halfH, r);
      ctx.closePath();
      ctx.fill();
      ctx.stroke();

      // Brillo interno superior
      ctx.shadowBlur = 0;
      ctx.strokeStyle = "rgba(255, 255, 255, 0.06)";
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo(-38 + r, -halfH + 2);
      ctx.lineTo(38 - r, -halfH + 2);
      ctx.stroke();

      // 3. Renderizar números identificadores de pines físicos (.subckt)
      for (let i = 0; i < pinCount; i++) {
        const pos = Math.floor(i / 2);
        const yLabel = -halfH + 20 + pos * 40;
        ctx.fillStyle = "hsl(210, 17%, 60%)";
        ctx.font = "8px var(--font-mono)";
        ctx.textAlign = i % 2 === 0 ? "left" : "right";
        ctx.fillText(`${i + 1}`, i % 2 === 0 ? -34 : 34, yLabel + 3);
      }

      break;
    }
  }

  // 3. Draw text value and label
  ctx.shadowBlur = 0;
  if (comp.mirror) {
    ctx.scale(-1, 1);
  }
  ctx.rotate(-(comp.rotation * Math.PI) / 180); // Un-rotate text so it stays horizontal

  const { idY, valueY } = getComponentLabelLayout(comp);

  ctx.fillStyle = isSelected ? "hsl(270, 89%, 80%)" : "hsl(210, 17%, 85%)";
  ctx.font = "bold 11px var(--font-sans)";
  ctx.textAlign = "center";
  ctx.fillText(comp.id, 0, idY);

  if (shouldDrawValueLabel(comp.type)) {
    ctx.fillStyle = "var(--text-muted)";
    ctx.font = "9px var(--font-mono)";
    ctx.fillText(formatComponentValue(comp), 0, valueY);
  }
  ctx.restore();
}
