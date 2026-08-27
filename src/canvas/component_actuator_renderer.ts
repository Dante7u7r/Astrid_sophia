import type { ComponentInstance } from "../canvas_orchestrator";

export function drawLamp(
  ctx: CanvasRenderingContext2D,
  comp: ComponentInstance,
): void {
  const glow = comp.glowLevel ?? 0;
  const isBurned = comp.lampBurned ?? false;

  if (glow > 0.05 && !isBurned) {
    const grad = ctx.createRadialGradient(0, 0, 2, 0, 0, 26);
    grad.addColorStop(0, `rgba(255, 190, 0, ${glow * 0.55})`);
    grad.addColorStop(0.5, `rgba(255, 160, 0, ${glow * 0.22})`);
    grad.addColorStop(1, "rgba(255, 160, 0, 0)");
    ctx.save();
    ctx.fillStyle = grad;
    ctx.beginPath();
    ctx.arc(0, 0, 26, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();
  }

  // Bulbo exterior de vidrio
  ctx.beginPath();
  ctx.arc(0, 0, 16, 0, Math.PI * 2);
  ctx.stroke();

  // Filamento interior en cruz
  if (isBurned) {
    // Filamento roto / fundido
    ctx.beginPath();
    ctx.moveTo(-11, -11);
    ctx.lineTo(-3, -3);
    ctx.moveTo(11, 11);
    ctx.lineTo(3, 3);
    ctx.moveTo(11, -11);
    ctx.lineTo(3, -3);
    ctx.moveTo(-11, 11);
    ctx.lineTo(-3, 3);
    ctx.strokeStyle = "#EF4444";
    ctx.stroke();

    ctx.save();
    ctx.fillStyle = "#EF4444";
    ctx.font = "bold 8px 'Inter', sans-serif";
    ctx.textAlign = "center";
    ctx.fillText("🔥 FUNDIDA", 0, -20);
    ctx.restore();
  } else {
    ctx.beginPath();
    ctx.moveTo(-11, -11);
    ctx.lineTo(11, 11);
    ctx.moveTo(11, -11);
    ctx.lineTo(-11, 11);

    if (glow > 0.05) {
      ctx.save();
      ctx.strokeStyle = `rgba(245, 158, 11, ${0.4 + glow * 0.5})`;
      ctx.lineWidth = 3.5;
      ctx.stroke();

      // Núcleo incandescente de tungsteno
      ctx.strokeStyle = `rgba(254, 240, 138, ${0.7 + glow * 0.3})`;
      ctx.lineWidth = 1.8;
      ctx.stroke();
      ctx.restore();
    } else {
      ctx.stroke();
    }
  }
}

/**
 * Relé Electromecánico SPDT (5 Pines reales)
 * Pines:
 * 0: COIL1 (-40, -20)
 * 1: COIL2 (-40, 20)
 * 2: COM (40, 0)
 * 3: NO (40, 20)
 * 4: NC (40, -20)
 */
export function drawRelay(
  ctx: CanvasRenderingContext2D,
  comp: ComponentInstance,
): void {
  const closed = comp.relayClosed ?? false;

  // 1. Terminales de bobina (COIL1, COIL2 en el lado izquierdo)
  ctx.beginPath();
  ctx.moveTo(-40, -20);
  ctx.lineTo(-20, -20);
  ctx.moveTo(-40, 20);
  ctx.lineTo(-20, 20);
  ctx.stroke();

  // 2. Terminales de contacto (NC, COM, NO en el lado derecho)
  ctx.beginPath();
  ctx.moveTo(40, -20); // NC
  ctx.lineTo(20, -20);
  ctx.moveTo(40, 0);   // COM
  ctx.lineTo(12, 0);
  ctx.moveTo(40, 20);  // NO
  ctx.lineTo(20, 20);
  ctx.stroke();

  // 3. Símbolo de la bobina electromagnética
  ctx.beginPath();
  ctx.rect(-20, -20, 10, 40);
  ctx.stroke();
  ctx.beginPath();
  ctx.moveTo(-15, -20);
  ctx.lineTo(-15, 20);
  ctx.stroke();

  // Acoplamiento electromagnético punteado
  ctx.save();
  ctx.setLineDash([3, 2]);
  ctx.strokeStyle = closed ? "rgba(56, 189, 248, 0.75)" : "rgba(255, 255, 255, 0.25)";
  ctx.beginPath();
  ctx.moveTo(-10, 0);
  ctx.lineTo(10, 0);
  ctx.stroke();
  ctx.restore();

  // 4. Bornes de contacto fijos
  ctx.beginPath();
  ctx.arc(20, -20, 2.5, 0, Math.PI * 2); // NC
  ctx.arc(20, 20, 2.5, 0, Math.PI * 2);  // NO
  ctx.arc(12, 0, 2.5, 0, Math.PI * 2);   // COM
  ctx.fill();

  // 5. Armadura móvil articulada desde COM (12, 0)
  ctx.beginPath();
  ctx.moveTo(12, 0);
  if (closed) {
    // Conmuta hacia NO (20, 20)
    ctx.lineTo(20, 18);
    ctx.save();
    ctx.strokeStyle = "#38BDF8";
    ctx.lineWidth = 2.2;
    ctx.stroke();
    ctx.restore();
  } else {
    // En reposo conecta con NC (20, -20)
    ctx.lineTo(20, -18);
    ctx.save();
    ctx.strokeStyle = "#10B981";
    ctx.lineWidth = 2.2;
    ctx.stroke();
    ctx.restore();
  }

  // Etiquetas de terminales de contacto
  ctx.save();
  ctx.font = "bold 7px 'JetBrains Mono', monospace";
  ctx.fillStyle = "rgba(255, 255, 255, 0.7)";
  ctx.fillText("NC", 24, -22);
  ctx.fillText("COM", 24, -2);
  ctx.fillText("NO", 24, 22);
  ctx.restore();
}

export function drawBuzzer(
  ctx: CanvasRenderingContext2D,
  comp: ComponentInstance,
  nowMs: number = Date.now(),
): void {
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

  // Signo '+' indicativo en el terminal positivo del buzzer
  ctx.save();
  ctx.fillStyle = "#38BDF8";
  ctx.font = "bold 9px 'Inter', sans-serif";
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.fillText("+", -16, -8);
  ctx.restore();

  if (level > 0.05) {
    ctx.save();
    ctx.strokeStyle = `rgba(56, 189, 248, ${level * 0.85})`;
    ctx.lineWidth = 1.6;
    const wavePhase = (nowMs / 150) % 3;
    for (let i = 0; i < 3; i++) {
      const r = 18 + i * 7 + wavePhase;
      ctx.beginPath();
      ctx.arc(4, 0, r, -Math.PI / 4, Math.PI / 4, false);
      ctx.stroke();
    }
    ctx.restore();
  }
}

/**
 * Motor de Corriente Continua (DC Motor) con animación de giro y tacómetro en RPM
 */
export function drawDcMotor(
  ctx: CanvasRenderingContext2D,
  comp: ComponentInstance,
): void {
  const rpm = comp.motorRpm ?? 0;
  const angle = comp.motorAngle ?? 0;

  // 1. Terminales de entrada
  ctx.beginPath();
  ctx.moveTo(-40, 0);
  ctx.lineTo(-20, 0);
  ctx.moveTo(20, 0);
  ctx.lineTo(40, 0);
  ctx.stroke();

  // 2. Chasis cilíndrico del motor
  ctx.beginPath();
  ctx.arc(0, 0, 20, 0, Math.PI * 2);
  ctx.stroke();

  // Letra 'M' central si está detenido
  if (Math.abs(rpm) < 1.0) {
    ctx.save();
    ctx.font = "bold 16px 'Inter', sans-serif";
    ctx.fillStyle = "white";
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillText("M", 0, 0);
    ctx.restore();
  } else {
    // 3. Rotor giratorio animado (Cruz angular)
    ctx.save();
    ctx.rotate(angle);
    ctx.strokeStyle = "#38BDF8";
    ctx.lineWidth = 2.0;
    ctx.beginPath();
    ctx.moveTo(-12, 0);
    ctx.lineTo(12, 0);
    ctx.moveTo(0, -12);
    ctx.lineTo(0, 12);
    ctx.stroke();
    ctx.beginPath();
    ctx.arc(0, 0, 4, 0, Math.PI * 2);
    ctx.fillStyle = "#38BDF8";
    ctx.fill();
    ctx.restore();
  }

  // 4. Tacómetro en RPM
  ctx.save();
  ctx.font = "bold 8px 'JetBrains Mono', monospace";
  ctx.fillStyle = Math.abs(rpm) > 1 ? "#10B981" : "rgba(255, 255, 255, 0.6)";
  ctx.textAlign = "center";
  ctx.fillText(`${Math.round(rpm)} RPM`, 0, 30);
  ctx.restore();
}

/**
 * Display de 7 Segmentos (10 Pines) con decodificación e iluminación LED en tiempo real
 */
export function drawSevenSegment(
  ctx: CanvasRenderingContext2D,
  comp: ComponentInstance,
): void {
  const states = comp.segmentStates || {};

  // 1. Cuerpo del encapsulado DIP
  ctx.fillStyle = "rgba(15, 23, 42, 0.94)";
  ctx.fillRect(-22, -32, 44, 64);
  ctx.strokeStyle = "rgba(255, 255, 255, 0.25)";
  ctx.strokeRect(-22, -32, 44, 64);

  // 2. Terminales (5 arriba, 5 abajo)
  for (let i = 0; i < 5; i++) {
    const x = -16 + i * 8;
    ctx.beginPath();
    ctx.moveTo(x, -40);
    ctx.lineTo(x, -32);
    ctx.moveTo(x, 32);
    ctx.lineTo(x, 40);
    ctx.stroke();
  }

  // 3. Segmentos LED individuales (A, B, C, D, E, F, G, DP)
  const drawSegment = (name: string, x: number, y: number, w: number, h: number) => {
    const isOn = states[name] ?? false;
    ctx.fillStyle = isOn ? "#EF4444" : "rgba(239, 68, 68, 0.12)";
    ctx.fillRect(x, y, w, h);
    if (isOn) {
      ctx.save();
      ctx.strokeStyle = "rgba(254, 202, 202, 0.8)";
      ctx.lineWidth = 1;
      ctx.strokeRect(x, y, w, h);
      ctx.restore();
    }
  };

  // Coordenadas de los 7 segmentos
  drawSegment("A", -12, -24, 20, 4);  // Segmento A (Superior)
  drawSegment("B", 8, -22, 4, 18);    // Segmento B (Sup. Derecho)
  drawSegment("C", 8, 2, 4, 18);      // Segmento C (Inf. Derecho)
  drawSegment("D", -12, 18, 20, 4);   // Segmento D (Inferior)
  drawSegment("E", -16, 2, 4, 18);    // Segmento E (Inf. Izquierdo)
  drawSegment("F", -16, -22, 4, 18);  // Segmento F (Sup. Izquierdo)
  drawSegment("G", -12, -2, 20, 4);   // Segmento G (Central)
  drawSegment("DP", 14, 18, 4, 4);    // Punto Decimal (DP)
}

/**
 * Servomotor RC (SG90) con brazo giratorio (Horn) animado de 0° a 180°
 */
export function drawServoMotor(
  ctx: CanvasRenderingContext2D,
  comp: ComponentInstance,
): void {
  const angleDeg = Math.max(0, Math.min(180, comp.servoAngle ?? 90));
  const angleRad = ((angleDeg - 90) * Math.PI) / 180; // 0° = izquierda, 90° = arriba, 180° = derecha

  // 1. Terminales (PWM izq: -40,0; VCC arr: 0,-40; GND abj: 0,40)
  ctx.beginPath();
  ctx.moveTo(-40, 0);
  ctx.lineTo(-24, 0);
  ctx.moveTo(0, -40);
  ctx.lineTo(0, -24);
  ctx.moveTo(0, 40);
  ctx.lineTo(0, 24);
  ctx.stroke();

  // 2. Chasis plástico azul translúcido (estilo Micro Servo SG90)
  ctx.fillStyle = "rgba(14, 116, 144, 0.88)"; // Azul cian / petróleo
  ctx.fillRect(-24, -24, 48, 48);
  ctx.strokeStyle = "rgba(56, 189, 248, 0.9)";
  ctx.lineWidth = 1.5;
  ctx.strokeRect(-24, -24, 48, 48);

  // Orejetas de fijación
  ctx.fillStyle = "rgba(14, 116, 144, 0.6)";
  ctx.fillRect(-28, -8, 4, 16);
  ctx.fillRect(24, -8, 4, 16);

  // 3. Eje central del servo
  ctx.beginPath();
  ctx.arc(0, 0, 8, 0, Math.PI * 2);
  ctx.fillStyle = "#E2E8F0";
  ctx.fill();
  ctx.strokeStyle = "rgba(0, 0, 0, 0.4)";
  ctx.stroke();

  // 4. Aspa del servo (Servo Horn) giratoria
  ctx.save();
  ctx.rotate(angleRad);
  ctx.beginPath();
  ctx.moveTo(0, 0);
  ctx.lineTo(20, -3);
  ctx.arc(20, 0, 3, -Math.PI / 2, Math.PI / 2);
  ctx.lineTo(0, 3);
  ctx.closePath();
  ctx.fillStyle = "#F8FAFC";
  ctx.fill();
  ctx.strokeStyle = "#0284C7";
  ctx.lineWidth = 1.2;
  ctx.stroke();

  // Orificios de fijación del brazo
  ctx.beginPath();
  ctx.arc(10, 0, 1.2, 0, Math.PI * 2);
  ctx.arc(16, 0, 1.2, 0, Math.PI * 2);
  ctx.fillStyle = "#334155";
  ctx.fill();
  ctx.restore();

  // 5. Lectura digital del ángulo
  ctx.save();
  ctx.font = "bold 8px 'JetBrains Mono', monospace";
  ctx.fillStyle = "#38BDF8";
  ctx.textAlign = "center";
  ctx.fillText(`${Math.round(angleDeg)}°`, 0, -28);
  ctx.restore();
}

/**
 * Motor Paso a Paso (Stepper Motor) de 4 Fases con animación de paso angular
 */
export function drawStepperMotor(
  ctx: CanvasRenderingContext2D,
  comp: ComponentInstance,
): void {
  const angle = comp.motorAngle ?? 0;
  const steps = comp.stepperSteps ?? 0;

  // 1. Terminales de bobinas (Fase A izq: -40,-20 y -40,20; Fase B der: 40,-20 y 40,20)
  ctx.beginPath();
  ctx.moveTo(-40, -20);
  ctx.lineTo(-24, -20);
  ctx.moveTo(-40, 20);
  ctx.lineTo(-24, 20);
  ctx.moveTo(40, -20);
  ctx.lineTo(24, -20);
  ctx.moveTo(40, 20);
  ctx.lineTo(24, 20);
  ctx.stroke();

  // 2. Chasis cilíndrico metálico
  ctx.fillStyle = "rgba(30, 41, 59, 0.95)";
  ctx.beginPath();
  ctx.arc(0, 0, 24, 0, Math.PI * 2);
  ctx.fill();
  ctx.strokeStyle = "rgba(148, 163, 184, 0.8)";
  ctx.lineWidth = 1.5;
  ctx.stroke();

  // Polos del estator (Marcadores en 0, 90, 180, 270)
  ctx.strokeStyle = "rgba(245, 158, 11, 0.6)";
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.moveTo(0, -24);
  ctx.lineTo(0, -17);
  ctx.moveTo(0, 24);
  ctx.lineTo(0, 17);
  ctx.moveTo(-24, 0);
  ctx.lineTo(-17, 0);
  ctx.moveTo(24, 0);
  ctx.lineTo(17, 0);
  ctx.stroke();

  // 3. Rotor multipolar giratorio animado
  ctx.save();
  ctx.rotate(angle);
  ctx.beginPath();
  ctx.arc(0, 0, 12, 0, Math.PI * 2);
  ctx.fillStyle = "#475569";
  ctx.fill();
  ctx.strokeStyle = "#38BDF8";
  ctx.lineWidth = 1.5;
  ctx.stroke();

  // Flecha indicadora de paso
  ctx.beginPath();
  ctx.moveTo(0, 0);
  ctx.lineTo(0, -11);
  ctx.strokeStyle = "#EF4444";
  ctx.lineWidth = 2;
  ctx.stroke();
  ctx.restore();

  // 4. Indicador de pasos
  ctx.save();
  ctx.font = "bold 7.5px 'JetBrains Mono', monospace";
  ctx.fillStyle = "#A78BFA";
  ctx.textAlign = "center";
  ctx.fillText(`PASO ${steps}`, 0, 32);
  ctx.restore();
}

/**
 * Altavoz Dinámico (Speaker 8 Ohm) con vibración de cono acústico
 */
export function drawSpeaker(
  ctx: CanvasRenderingContext2D,
  comp: ComponentInstance,
): void {
  const pwr = comp.speakerPower ?? 0;
  const isVibrating = pwr > 0.005;

  // 1. Terminales (izq -40,0; der 40,0)
  ctx.beginPath();
  ctx.moveTo(-40, 0);
  ctx.lineTo(-20, 0);
  ctx.moveTo(40, 0);
  ctx.lineTo(20, 0);
  ctx.stroke();

  // 2. Chasis del altavoz (Imán trasero y cono acampanado)
  ctx.fillStyle = "rgba(15, 23, 42, 0.95)";
  // Imán posterior
  ctx.fillRect(-18, -8, 8, 16);
  ctx.strokeRect(-18, -8, 8, 16);

  // Cono acústico
  ctx.beginPath();
  ctx.moveTo(-10, -8);
  ctx.lineTo(10, -22);
  ctx.lineTo(10, 22);
  ctx.lineTo(-10, 8);
  ctx.closePath();
  ctx.fillStyle = "rgba(30, 41, 59, 0.9)";
  ctx.fill();
  ctx.stroke();

  // Cúpula central
  ctx.beginPath();
  ctx.arc(10, 0, 8, -Math.PI / 2, Math.PI / 2);
  ctx.fillStyle = "#64748B";
  ctx.fill();
  ctx.stroke();

  // 3. Ondas sonoras animadas si hay potencia
  if (isVibrating) {
    ctx.save();
    ctx.strokeStyle = `rgba(56, 189, 248, ${Math.min(1, pwr * 1.5 + 0.3)})`;
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    ctx.arc(12, 0, 14, -Math.PI / 3, Math.PI / 3);
    ctx.stroke();
    ctx.beginPath();
    ctx.arc(12, 0, 20, -Math.PI / 4, Math.PI / 4);
    ctx.stroke();
    ctx.restore();
  }

  // 4. Etiqueta de impedancia
  ctx.save();
  ctx.font = "bold 7.5px 'JetBrains Mono', monospace";
  ctx.fillStyle = isVibrating ? "#38BDF8" : "rgba(255, 255, 255, 0.6)";
  ctx.textAlign = "center";
  ctx.fillText("8Ω", 0, -26);
  ctx.restore();
}

/**
 * Solenoide / Actuador Lineal con émbolo móvil y bobina helicoidal
 */
export function drawSolenoid(
  ctx: CanvasRenderingContext2D,
  comp: ComponentInstance,
): void {
  const pos = comp.solenoidPosition ?? 0; // 0 = extendido, 1 = retraído
  const offset = pos * 10;

  // 1. Terminales (izq -40,0; der 40,0)
  ctx.beginPath();
  ctx.moveTo(-40, 0);
  ctx.lineTo(-24, 0);
  ctx.moveTo(40, 0);
  ctx.lineTo(24, 0);
  ctx.stroke();

  // 2. Chasis cilíndrico de la bobina
  ctx.fillStyle = "rgba(15, 23, 42, 0.94)";
  ctx.fillRect(-24, -14, 48, 28);
  ctx.strokeRect(-24, -14, 48, 28);

  // Bobinado helicoidal de cobre
  ctx.strokeStyle = "#F59E0B";
  ctx.lineWidth = 1.5;
  for (let i = -18; i <= 14; i += 6) {
    ctx.beginPath();
    ctx.moveTo(i, -12);
    ctx.lineTo(i + 4, 12);
    ctx.stroke();
  }

  // 3. Émbolo de hierro deslizante (Plunger)
  ctx.fillStyle = "#CBD5E1";
  ctx.fillRect(-28 + offset, -5, 20, 10);
  ctx.strokeStyle = "#475569";
  ctx.lineWidth = 1;
  ctx.strokeRect(-28 + offset, -5, 20, 10);

  // Punta del émbolo
  ctx.beginPath();
  ctx.arc(-28 + offset, 0, 5, Math.PI / 2, (Math.PI * 3) / 2);
  ctx.fillStyle = "#94A3B8";
  ctx.fill();
  ctx.stroke();

  // 4. Etiqueta de estado
  ctx.save();
  ctx.font = "bold 7.5px 'JetBrains Mono', monospace";
  ctx.fillStyle = pos > 0.5 ? "#10B981" : "rgba(255, 255, 255, 0.5)";
  ctx.textAlign = "center";
  ctx.fillText(pos > 0.5 ? "RETRAÍDO" : "EXTENDIDO", 0, 22);
  ctx.restore();
}

/**
 * Relé de Estado Sólido (Solid State Relay - SSR)
 */
export function drawSsr(
  ctx: CanvasRenderingContext2D,
  comp: ComponentInstance,
): void {
  const active = comp.ssrActive ?? false;

  // 1. Terminales (Control izq: -40,-20 y -40,20; Carga der: 40,-20 y 40,20)
  ctx.beginPath();
  ctx.moveTo(-40, -20);
  ctx.lineTo(-24, -20);
  ctx.moveTo(-40, 20);
  ctx.lineTo(-24, 20);
  ctx.moveTo(40, -20);
  ctx.lineTo(24, -20);
  ctx.moveTo(40, 20);
  ctx.lineTo(24, 20);
  ctx.stroke();

  // 2. Encapsulado tipo bloque "Puck" industrial
  ctx.fillStyle = "rgba(15, 23, 42, 0.95)";
  ctx.fillRect(-24, -30, 48, 60);
  ctx.strokeStyle = "rgba(255, 255, 255, 0.3)";
  ctx.lineWidth = 1.5;
  ctx.strokeRect(-24, -30, 48, 60);

  // 3. LED indicador de control
  ctx.beginPath();
  ctx.arc(0, -16, 4, 0, Math.PI * 2);
  ctx.fillStyle = active ? "#10B981" : "#334155";
  ctx.fill();
  ctx.strokeStyle = active ? "#6EE7B7" : "rgba(255, 255, 255, 0.2)";
  ctx.stroke();

  if (active) {
    ctx.save();
    ctx.fillStyle = "rgba(16, 185, 129, 0.4)";
    ctx.beginPath();
    ctx.arc(0, -16, 8, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();
  }

  // 4. Símbolo optoacoplado interno
  ctx.save();
  ctx.strokeStyle = "rgba(56, 189, 248, 0.7)";
  ctx.lineWidth = 1.2;
  // Diodo emisor
  ctx.beginPath();
  ctx.moveTo(-10, -2);
  ctx.lineTo(-10, 8);
  ctx.lineTo(-4, 3);
  ctx.closePath();
  ctx.stroke();

  // TRIAC / Tiristores opuestos
  ctx.beginPath();
  ctx.moveTo(10, -2);
  ctx.lineTo(10, 8);
  ctx.lineTo(4, 3);
  ctx.closePath();
  ctx.stroke();
  ctx.restore();

  // 5. Serigrafía SSR
  ctx.save();
  ctx.font = "bold 8px 'JetBrains Mono', monospace";
  ctx.fillStyle = "#38BDF8";
  ctx.textAlign = "center";
  ctx.fillText("SSR", 0, 20);
  ctx.restore();
}

export function drawLcd16x2(
  ctx: CanvasRenderingContext2D,
  comp: ComponentInstance,
): void {
  ctx.save();

  // 1. PCB Verde Oscuro / Azul de la placa LCD HD44780
  const isBacklightOn = comp.glowLevel !== undefined ? comp.glowLevel > 0.1 : true;
  ctx.fillStyle = "rgba(10, 40, 25, 0.95)";
  ctx.fillRect(-100, -50, 200, 100);
  ctx.strokeStyle = "rgba(255, 255, 255, 0.25)";
  ctx.lineWidth = 1.5;
  ctx.strokeRect(-100, -50, 200, 100);

  // 4 Orificios de montaje en esquinas
  ctx.fillStyle = "rgba(200, 200, 200, 0.3)";
  [[-92, -42], [92, -42], [-92, 42], [92, 42]].forEach(([hx, hy]) => {
    ctx.beginPath();
    ctx.arc(hx, hy, 3.5, 0, Math.PI * 2);
    ctx.fill();
    ctx.stroke();
  });

  // 2. Marco Metálico del Display
  ctx.fillStyle = "#1e293b";
  ctx.fillRect(-85, -28, 170, 56);
  ctx.strokeStyle = "rgba(148, 163, 184, 0.5)";
  ctx.strokeRect(-85, -28, 170, 56);

  // 3. Cristal Líquido (Pantalla LCD con Matriz de Puntos)
  ctx.fillStyle = isBacklightOn ? "#15803d" : "#14532d"; // Verde retroiluminado HD44780 clásico
  ctx.fillRect(-80, -23, 160, 46);

  // 4. Texto DDRAM de 16x2 Caracteres
  const line1 = String(comp.displayChar || comp.label || "Astryd Sophia").slice(0, 16).padEnd(16, " ");
  const line2 = String(comp.displayLine2 || "HD44780 16x2 LCD").slice(0, 16).padEnd(16, " ");

  ctx.font = "bold 9px 'JetBrains Mono', 'Courier New', monospace";
  ctx.fillStyle = isBacklightOn ? "#022c22" : "#052e16"; // Texto oscuro sobre matriz verde
  ctx.textAlign = "left";
  ctx.textBaseline = "middle";

  ctx.fillText(line1, -74, -10);
  ctx.fillText(line2, -74, 10);

  // 5. Serigrafía de Pines Superiores (P1..P16)
  ctx.font = "6px monospace";
  ctx.fillStyle = "rgba(255, 255, 255, 0.6)";
  ctx.textAlign = "center";
  ctx.fillText("1 (VSS)", -85, -42);
  ctx.fillText("16 (K)", 85, -42);

  ctx.restore();
}


