import { type ComponentInstance } from "../canvas_orchestrator";
import {
  DMM_INITIAL_DISPLAY,
  normalizeDmmMode,
} from "../simulation/dmm";

export function drawComponentSymbol(
  ctx: CanvasRenderingContext2D,
  comp: ComponentInstance,
  isSelected: boolean,
  isHovered: boolean
): void {
  ctx.save();
  ctx.translate(comp.x, comp.y);
  ctx.rotate((comp.rotation * Math.PI) / 180);
  if (comp.mirror) {
    ctx.scale(-1, 1);
  }

  // Color systems
  let color = "hsl(174, 97%, 69%)"; // Default electric cyan
  if (isSelected) {
    color = "hsl(270, 89%, 65%)"; // Selected purple
  } else if (isHovered) {
    color = "hsl(210, 100%, 56%)"; // Hovered accent blue
  }

  ctx.strokeStyle = color;
  ctx.lineWidth = isSelected ? 3 : 2;
  ctx.fillStyle = "rgba(8, 12, 22, 0.75)";

  // Add subtle glow if selected or hovered
  if (isSelected || isHovered) {
    ctx.shadowColor = color;
    ctx.shadowBlur = isSelected ? 8 : 4;
  }

  // 1. Draw Leads
  if (comp.type !== 'ground' && comp.type !== 'nmos' && comp.type !== 'pmos' && comp.type !== 'npn' && comp.type !== 'pnp' && comp.type !== 'opamp' && comp.type !== 'relay' && comp.type !== 'mcu_8051' && comp.type !== 'mcu_avr' && comp.type !== 'arduino_uno' && comp.type !== 'esp32' && comp.type !== 'raspberry_pi_pico' && comp.type !== 'x' && comp.type !== 'dmm') {
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

    case 'lamp': {
      const glow = comp.glowLevel ?? 0;
      if (glow > 0.05) {
        const grad = ctx.createRadialGradient(0, 0, 2, 0, 0, 24);
        grad.addColorStop(0, `rgba(255, 180, 0, ${glow * 0.45})`);
        grad.addColorStop(0.5, `rgba(255, 180, 0, ${glow * 0.15})`);
        grad.addColorStop(1, 'rgba(255, 180, 0, 0)');
        ctx.save();
        ctx.fillStyle = grad;
        ctx.beginPath();
        ctx.arc(0, 0, 24, 0, Math.PI * 2);
        ctx.fill();
        ctx.restore();
      }
      ctx.beginPath();
      ctx.arc(0, 0, 16, 0, Math.PI * 2);
      ctx.stroke();
      ctx.beginPath();
      ctx.moveTo(-11, -11);
      ctx.lineTo(11, 11);
      ctx.moveTo(11, -11);
      ctx.lineTo(-11, 11);
      if (glow > 0.05) {
        ctx.save();
        ctx.strokeStyle = `rgba(255, 230, 150, ${0.4 + glow * 0.6})`;
        ctx.shadowColor = "rgba(255, 180, 0, 0.9)";
        ctx.shadowBlur = 10 * glow;
        ctx.lineWidth = 2.5;
        ctx.stroke();
        ctx.restore();
      } else {
        ctx.stroke();
      }
      break;
    }

    case 'relay': {
      const closed = comp.relayClosed ?? false;
      ctx.beginPath();
      ctx.moveTo(-40, -20);
      ctx.lineTo(-20, -20);
      ctx.moveTo(-40, 20);
      ctx.lineTo(-20, 20);
      ctx.stroke();
      ctx.beginPath();
      ctx.moveTo(40, -20);
      ctx.lineTo(20, -20);
      ctx.moveTo(40, 20);
      ctx.lineTo(20, 20);
      ctx.stroke();
      ctx.beginPath();
      ctx.rect(-20, -20, 10, 40);
      ctx.stroke();
      ctx.beginPath();
      ctx.moveTo(-15, -20);
      ctx.lineTo(-15, 20);
      ctx.stroke();
      ctx.save();
      ctx.setLineDash([3, 2]);
      ctx.strokeStyle = "rgba(255, 255, 255, 0.25)";
      ctx.beginPath();
      ctx.moveTo(-10, 0);
      ctx.lineTo(10, 0);
      ctx.stroke();
      ctx.restore();
      ctx.beginPath();
      ctx.arc(20, -20, 2, 0, Math.PI * 2);
      ctx.arc(20, 20, 2, 0, Math.PI * 2);
      ctx.fill();
      ctx.beginPath();
      if (closed) {
        ctx.moveTo(20, -20);
        ctx.lineTo(20, 20);
        ctx.save();
        ctx.strokeStyle = "hsl(174, 97%, 69%)";
        ctx.shadowColor = "hsl(174, 97%, 69%)";
        ctx.shadowBlur = 6;
        ctx.lineWidth = 2.0;
        ctx.stroke();
        ctx.restore();
      } else {
        ctx.moveTo(20, -20);
        ctx.lineTo(10, 10);
        ctx.stroke();
      }
      break;
    }

    case 'buzzer': {
      const level = comp.buzzerLevel ?? 0;
      ctx.beginPath();
      ctx.moveTo(-12, -16);
      ctx.lineTo(-12, 16);
      ctx.lineTo(12, 18);
      ctx.lineTo(12, -18);
      ctx.closePath();
      ctx.stroke();
      ctx.beginPath();
      ctx.moveTo(-20, 0);
      ctx.lineTo(-12, 0);
      ctx.stroke();
      if (level > 0.05) {
        ctx.save();
        ctx.strokeStyle = `rgba(102, 252, 241, ${level * 0.8})`;
        ctx.shadowColor = "hsl(174, 97%, 69%)";
        ctx.shadowBlur = 4 * level;
        const wavePhase = (Date.now() / 150) % 3;
        for (let i = 0; i < 3; i++) {
          const r = 20 + i * 8 + wavePhase;
          ctx.beginPath();
          ctx.arc(4, 0, r, -Math.PI / 4, Math.PI / 4, false);
          ctx.stroke();
        }
        ctx.restore();
      }
      break;
    }

    case 'mcu_8051': {
      const pins8051 = [
        "P1.0", "P1.1", "P1.2", "P1.3", "P1.4", "P1.5", "P1.6", "P1.7",
        "RST", "P3.0/RxD", "P3.1/TxD", "P3.2/Int0", "P3.3/Int1", "P3.4/T0", "P3.5/T1", "P3.6/WR", "P3.7/RD",
        "XTAL2", "XTAL1", "GND",
        "P2.0", "P2.1", "P2.2", "P2.3", "P2.4", "P2.5", "P2.6", "P2.7",
        "PSEN", "ALE", "EA", "P0.7", "P0.6", "P0.5", "P0.4", "P0.3", "P0.2", "P0.1", "P0.0", "VCC"
      ];
      // Body
      ctx.fillStyle = "rgba(10, 15, 30, 0.85)";
      ctx.fillRect(-50, -220, 100, 420);
      ctx.strokeRect(-50, -220, 100, 420);
      
      // Notch
      ctx.beginPath();
      ctx.arc(0, -220, 12, 0, Math.PI, false);
      ctx.stroke();

      // Label
      ctx.fillStyle = color;
      ctx.font = "bold 13px var(--font-sans)";
      ctx.textAlign = "center";
      ctx.fillText("Intel 8051", 0, -40);
      ctx.font = "8px var(--font-mono)";
      ctx.fillStyle = "var(--text-muted)";
      ctx.fillText("MCS-51 ARCH", 0, -25);

      // Pins
      const states = comp.mcuPinStates || {};
      for (let i = 0; i < 40; i++) {
        let x_body = 0;
        let x_tip = 0;
        let y = 0;
        let isLeft = i < 20;
        let label = pins8051[i];
        
        if (isLeft) {
          x_body = -50;
          x_tip = -60;
          y = -200 + i * 20;
        } else {
          x_body = 50;
          x_tip = 60;
          y = 180 - (i - 20) * 20;
        }

        // Lead line
        ctx.beginPath();
        ctx.moveTo(x_body, y);
        ctx.lineTo(x_tip, y);
        ctx.stroke();

        // State dot
        const pinVal = states[i];
        ctx.fillStyle = pinVal === 1 || pinVal === "1" ? "hsl(355, 80%, 55%)" : pinVal === 0 || pinVal === "0" ? "hsl(174, 97%, 69%)" : "rgba(255,255,255,0.25)";
        ctx.beginPath();
        ctx.arc(x_tip, y, 3, 0, Math.PI * 2);
        ctx.fill();

        // Labels
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
      break;
    }

    case 'mcu_avr': {
      const pinsAvr = [
        "PC6/RST", "PD0/RXD", "PD1/TXD", "PD2/INT0", "PD3/INT1", "PD4/T0", "VCC",
        "GND", "PB6/XT1", "PB7/XT2", "PD5/T1", "PD6/AIN0", "PD7/AIN1", "PB0/CLKO",
        "PB1/OC1A", "PB2/OC1B", "PB3/MOSI", "PB4/MISO", "PB5/SCK", "AVCC", "AREF",
        "GND", "PC5/SCL", "PC4/SDA", "PC3/ADC3", "PC2/ADC2", "PC1/ADC1", "PC0/ADC0"
      ];
      // Body
      ctx.fillStyle = "rgba(10, 15, 30, 0.85)";
      ctx.fillRect(-50, -160, 100, 300);
      ctx.strokeRect(-50, -160, 100, 300);
      
      // Notch
      ctx.beginPath();
      ctx.arc(0, -160, 12, 0, Math.PI, false);
      ctx.stroke();

      // Label
      ctx.fillStyle = color;
      ctx.font = "bold 12px var(--font-sans)";
      ctx.textAlign = "center";
      ctx.fillText("ATmega328P", 0, -30);
      ctx.font = "8px var(--font-mono)";
      ctx.fillStyle = "var(--text-muted)";
      ctx.fillText("AVR 8-BIT MCU", 0, -15);

      // Pins
      const states = comp.mcuPinStates || {};
      for (let i = 0; i < 28; i++) {
        let x_body = 0;
        let x_tip = 0;
        let y = 0;
        let isLeft = i < 14;
        let label = pinsAvr[i];
        
        if (isLeft) {
          x_body = -50;
          x_tip = -60;
          y = -140 + i * 20;
        } else {
          x_body = 50;
          x_tip = 60;
          y = 120 - (i - 14) * 20;
        }

        // Lead line
        ctx.beginPath();
        ctx.moveTo(x_body, y);
        ctx.lineTo(x_tip, y);
        ctx.stroke();

        // State dot
        const pinVal = states[i];
        ctx.fillStyle = pinVal === 1 || pinVal === "1" ? "hsl(355, 80%, 55%)" : pinVal === 0 || pinVal === "0" ? "hsl(174, 97%, 69%)" : "rgba(255,255,255,0.25)";
        ctx.beginPath();
        ctx.arc(x_tip, y, 3, 0, Math.PI * 2);
        ctx.fill();

        // Labels
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
      break;
    }

    case 'arduino_uno':
    case 'esp32':
    case 'raspberry_pi_pico': {
      const boardLabels = [
        "IN (GP0)", "OUT (GP1)",
        "ADC (A0)", "DAC (D0)",
        "VCC",      "GND"
      ];
      // PCB Body
      const pcbColor = comp.type === 'arduino_uno' ? "rgba(0, 100, 150, 0.85)" : comp.type === 'esp32' ? "rgba(40, 45, 55, 0.85)" : "rgba(0, 120, 60, 0.85)";
      ctx.fillStyle = pcbColor;
      ctx.fillRect(-30, -60, 60, 120);
      
      ctx.save();
      ctx.strokeStyle = color;
      ctx.lineWidth = isSelected ? 2.5 : 1.5;
      ctx.strokeRect(-30, -60, 60, 120);
      ctx.restore();

      // Title
      ctx.fillStyle = "white";
      ctx.font = "bold 8px var(--font-sans)";
      ctx.textAlign = "center";
      const name = comp.type === 'arduino_uno' ? "ARDUINO" : comp.type === 'esp32' ? "ESP32" : "RPI PICO";
      ctx.fillText(name, 0, -25);
      ctx.font = "6px var(--font-mono)";
      ctx.fillStyle = "rgba(255, 255, 255, 0.6)";
      ctx.fillText("MIXED SIGNAL", 0, -15);

      // Draw microcontroller chip model in the middle
      ctx.fillStyle = "#111";
      ctx.fillRect(-12, 0, 24, 24);
      ctx.strokeStyle = "rgba(255,255,255,0.2)";
      ctx.strokeRect(-12, 0, 24, 24);

      // Pins
      const states = comp.mcuPinStates || {};
      const coords = [
        { x: -30, y: -40, isLeft: true },
        { x: 30, y: -40, isLeft: false },
        { x: -30, y: 0, isLeft: true },
        { x: 30, y: 0, isLeft: false },
        { x: -30, y: 40, isLeft: true },
        { x: 30, y: 40, isLeft: false }
      ];

      for (let i = 0; i < 6; i++) {
        const c = coords[i];
        const x_body = c.x;
        const x_tip = c.isLeft ? -40 : 40;
        const y = c.y;
        const label = boardLabels[i];

        // Lead line
        ctx.beginPath();
        ctx.moveTo(x_body, y);
        ctx.lineTo(x_tip, y);
        ctx.stroke();

        // State dot
        const pinVal = states[i];
        ctx.fillStyle = pinVal === 1 || pinVal === "1" ? "hsl(355, 80%, 55%)" : pinVal === 0 || pinVal === "0" ? "hsl(174, 97%, 69%)" : "rgba(255,255,255,0.25)";
        ctx.beginPath();
        ctx.arc(x_tip, y, 3, 0, Math.PI * 2);
        ctx.fill();

        // Text labels
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
      break;
    }

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

    case 'led': {
      // LED symbol: diode triangle + bar with two arrows pointing outward
      ctx.moveTo(-12, -10);
      ctx.lineTo(-12, 10);
      ctx.lineTo(8, 0);
      ctx.closePath();
      ctx.fill();
      ctx.stroke();

      // Bar
      ctx.beginPath();
      ctx.moveTo(8, -10);
      ctx.lineTo(8, 10);
      ctx.stroke();

      // Two small arrows pointing outward (light emission)
      ctx.strokeStyle = color;
      ctx.lineWidth = 1.2;
      ctx.beginPath();
      // Arrow 1 (up-right)
      ctx.moveTo(14, -6);
      ctx.lineTo(20, -10);
      ctx.moveTo(20, -10);
      ctx.lineTo(16, -10);
      ctx.moveTo(20, -10);
      ctx.lineTo(20, -6);
      // Arrow 2 (down-right)
      ctx.moveTo(14, 6);
      ctx.lineTo(20, 10);
      ctx.moveTo(20, 10);
      ctx.lineTo(16, 10);
      ctx.moveTo(20, 10);
      ctx.lineTo(20, 6);
      ctx.stroke();

      // Glow effect if forward biased (using glowLevel like lamp)
      const glow = comp.glowLevel ?? 0;
      if (glow > 0.05) {
        const grad = ctx.createRadialGradient(8, 0, 4, 8, 0, 28);
        grad.addColorStop(0, `rgba(255, 100, 0, ${glow * 0.5})`);
        grad.addColorStop(0.5, `rgba(255, 180, 0, ${glow * 0.2})`);
        grad.addColorStop(1, 'rgba(255, 180, 0, 0)');
        ctx.save();
        ctx.fillStyle = grad;
        ctx.beginPath();
        ctx.arc(8, 0, 28, 0, Math.PI * 2);
        ctx.fill();
        ctx.restore();
      }
      break;
    }

    case 'switch': {
      // Switch symbol: open/closed contact
      const isClosed = comp.switchState ?? false;
      ctx.beginPath();
      // Fixed contact (left)
      ctx.moveTo(-40, 0);
      ctx.lineTo(-15, 0);
      ctx.moveTo(-15, -5);
      ctx.lineTo(-15, 5);
      ctx.stroke();

      // Movable contact (right)
      if (isClosed) {
        ctx.beginPath();
        ctx.moveTo(15, 0);
        ctx.lineTo(40, 0);
        ctx.moveTo(15, -5);
        ctx.lineTo(15, 5);
        ctx.stroke();
        // Connecting line
        ctx.beginPath();
        ctx.moveTo(-15, 0);
        ctx.lineTo(15, 0);
        ctx.strokeStyle = "hsl(174, 97%, 69%)";
        ctx.shadowColor = "hsl(174, 97%, 69%)";
        ctx.shadowBlur = 6;
        ctx.lineWidth = 2.5;
        ctx.stroke();
      } else {
        // Open switch - angled gap
        ctx.beginPath();
        ctx.moveTo(15, -8);
        ctx.lineTo(40, -8);
        ctx.moveTo(15, -8);
        ctx.lineTo(20, 0);
        ctx.lineTo(15, 8);
        ctx.moveTo(40, 0);
        ctx.lineTo(40, 8);
        ctx.stroke();
      }
      break;
    }

    case 'transformer': {
      // Two coupled inductors with core lines
      // Primary (left)
      ctx.moveTo(-40, -20);
      for (let i = 0; i < 3; i++) {
        const startX = -40 + i * 10;
        ctx.arc(startX + 5, -20, 5, Math.PI, 0, false);
      }
      ctx.lineTo(-10, -20);

      // Secondary (right)
      ctx.moveTo(10, 20);
      for (let i = 0; i < 3; i++) {
        const startX = 10 + i * 10;
        ctx.arc(startX + 5, 20, 5, Math.PI, 0, false);
      }
      ctx.lineTo(40, 20);

      // Core lines (vertical dashed lines indicating magnetic coupling)
      ctx.save();
      ctx.setLineDash([4, 3]);
      ctx.strokeStyle = "rgba(255, 255, 255, 0.3)";
      ctx.beginPath();
      ctx.moveTo(-10, -20);
      ctx.lineTo(-10, 20);
      ctx.moveTo(10, -20);
      ctx.lineTo(10, 20);
      ctx.stroke();
      ctx.restore();

      // Dots for polarity (primary top, secondary top)
      ctx.fillStyle = color;
      ctx.beginPath();
      ctx.arc(-30, -20, 3, 0, Math.PI * 2);
      ctx.fill();
      ctx.beginPath();
      ctx.arc(20, 20, 3, 0, Math.PI * 2);
      ctx.fill();
      break;
    }

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

  let idY = -24;
  let valY = 32;
  if (comp.type === 'ground') {
    idY = 24;
  } else if (comp.type === 'dmm') {
    idY = -44;
  } else if (comp.type === 'mcu_8051') {
    idY = -230;
    valY = 215;
  } else if (comp.type === 'mcu_avr') {
    idY = -170;
    valY = 155;
  } else if (comp.type === 'arduino_uno' || comp.type === 'esp32' || comp.type === 'raspberry_pi_pico') {
    idY = -70;
    valY = 75;
  } else if (comp.type === 'x') {
    const pinsLeft = Math.ceil((comp.pinCount ?? 4) / 2);
    const totalHeight = Math.max(pinsLeft * 40, 60);
    idY = -totalHeight / 2 - 10;
    valY = totalHeight / 2 + 14;
  }

  ctx.fillStyle = isSelected ? "hsl(270, 89%, 80%)" : "hsl(210, 17%, 85%)";
  ctx.font = "bold 11px var(--font-sans)";
  ctx.textAlign = "center";
  ctx.fillText(comp.id, 0, idY);

  if (comp.type !== 'ground' && comp.type !== 'x' && comp.type !== 'dmm') {
    ctx.fillStyle = "var(--text-muted)";
    ctx.font = "9px var(--font-mono)";
    let formattedVal = comp.value ? comp.value.toString() : "";
    if (comp.type === 'resistor') {
      const numericVal = Number(comp.value);
      formattedVal = numericVal >= 1000 ? (numericVal / 1000) + " kΩ" : numericVal + " Ω";
    } else if (comp.type === 'capacitor') {
      const numericVal = Number(comp.value);
      formattedVal = numericVal < 1e-6 ? (numericVal * 1e9) + " nF" : (numericVal * 1e6) + " µF";
    } else if (comp.type === 'inductor') {
      const numericVal = Number(comp.value);
      formattedVal = numericVal < 1e-3 ? (numericVal * 1e6) + " µH" : (numericVal * 1e3) + " mH";
    } else if (comp.type === 'vsource') {
      formattedVal = comp.value + " V";
    } else if (comp.type === 'lamp' || comp.type === 'relay' || comp.type === 'buzzer') {
      formattedVal = comp.value.toString().split(';')[0].trim();
    } else if (comp.type === 'mcu_8051' || comp.type === 'mcu_avr' || comp.type === 'arduino_uno' || comp.type === 'esp32' || comp.type === 'raspberry_pi_pico') {
      formattedVal = comp.firmwareHex ? "Firmware cargado" : "Sin firmware";
    } else if (comp.type === 'isource') {
      formattedVal = comp.value + " A";
    } else if (comp.type === 'led') {
      formattedVal = "LED";
    } else if (comp.type === 'switch') {
      formattedVal = comp.switchState ? "Cerrado" : "Abierto";
    } else if (comp.type === 'transformer') {
      formattedVal = `${comp.primaryInductance ?? 1e-3} H / ${comp.secondaryInductance ?? 1e-3} H (k=${comp.couplingCoefficient ?? 0.9})`;
    }
    ctx.fillText(formattedVal, 0, valY);
  }

  ctx.restore();
}
