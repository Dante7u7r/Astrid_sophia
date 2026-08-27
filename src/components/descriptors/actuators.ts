// ==========================================================================
// ACTUATOR & SWITCH COMPONENT DESCRIPTORS — Relés SPDT, Conmutadores, Motores, Displays
// ==========================================================================

import {
  drawBuzzer,
  drawDcMotor,
  drawLamp,
  drawLcd16x2,
  drawRelay,
  drawSevenSegment,
  drawServoMotor,
  drawStepperMotor,
  drawSpeaker,
  drawSolenoid,
  drawSsr,
} from "../../canvas/component_actuator_renderer";
import {
  drawPushbutton,
  drawSwitch,
  drawSwitchDpdt,
  drawSwitchSpdt,
} from "../../canvas/component_discrete_renderer";
import type { ComponentDefinition, LocalPinDefinition } from "../types";

const STANDARD_TWO_PINS: readonly LocalPinDefinition[] = [
  { index: 0, x: -40, y: 0, label: "1", name: "Terminal 1" },
  { index: 1, x: 40, y: 0, label: "2", name: "Terminal 2" },
];

export const LampDefinition: ComponentDefinition = {
  type: "lamp",
  name: "Lámpara Incandescente",
  category: "actuadores",
  prefix: "LP",
  defaultProperties: { value: "12V 5W;vnom=12;pnom=5;rcold=3.2;rhot=28.8" },
  halfExtents: { halfW: 40, halfH: 40 },
  getPins: () => STANDARD_TWO_PINS,
  render: (ctx, comp) => {
    drawLamp(ctx, comp);
  },
  evaluateLiveBehavior: (pinVoltages, comp) => {
    const v0 = pinVoltages[0] ?? 0;
    const v1 = pinVoltages[1] ?? 0;
    const vDiff = Math.abs(v0 - v1);
    const vNom = comp.lampVoltage ?? 12.0;

    // Detección de sobretensión destructiva (> 160% Vnom)
    if (vDiff > vNom * 1.6 && !comp.lampBurned) {
      comp.lampBurned = true;
    }

    if (comp.lampBurned) {
      comp.glowLevel = 0;
      return { glowLevel: 0, branchCurrents: { 0: 0, 1: 0 } };
    }

    const glow = vDiff > 1.0 ? Math.min(1.0, Math.pow(vDiff / vNom, 2)) : 0;
    comp.glowLevel = glow;
    // Resistencia con coeficiente térmico dinámico
    const rLamp = glow > 0.05 ? 28.8 : 3.2;
    const i = (v0 - v1) / rLamp;
    return {
      glowLevel: glow,
      branchCurrents: { 0: i, 1: -i },
    };
  },
};

/**
 * Relé Electromecánico SPDT (5 Pines reales)
 * Lado Izquierdo: Bobina (COIL1 en y=-20, COIL2 en y=20)
 * Lado Derecho: Contactos (NC en y=-20, COM en y=0, NO en y=20)
 */
export const RelayDefinition: ComponentDefinition = {
  type: "relay",
  name: "Relé Electromecánico SPDT (5 Pines)",
  category: "actuadores",
  prefix: "RY",
  defaultProperties: { value: "12V;rcoil=120;pull=30m;hold=16m;ron=50m;roff=100Meg" },
  halfExtents: { halfW: 45, halfH: 25 },
  hasStandardLeads: false,
  getPins: () => [
    { index: 0, x: -40, y: -20, label: "COIL1", name: "Bobina 1 (+)" },
    { index: 1, x: -40, y: 20, label: "COIL2", name: "Bobina 2 (-)" },
    { index: 2, x: 40, y: 0, label: "COM", name: "Terminal Común (COM)" },
    { index: 3, x: 40, y: 20, label: "NO", name: "Normalmente Abierto (NO)" },
    { index: 4, x: 40, y: -20, label: "NC", name: "Normalmente Cerrado (NC)" },
  ],
  render: (ctx, comp) => {
    drawRelay(ctx, comp);
  },
  evaluateLiveBehavior: (pinVoltages, comp) => {
    const vCoil1 = pinVoltages[0] ?? 0;
    const vCoil2 = pinVoltages[1] ?? 0;
    const vCom = pinVoltages[2] ?? 0;
    const vNo = pinVoltages[3] ?? 0;
    const vNc = pinVoltages[4] ?? 0;

    const rCoil = 120.0;
    const coilCurrent = Math.abs(vCoil1 - vCoil2) / rCoil;
    const isClosed = coilCurrent >= 0.03; // Pull-in current threshold ~30mA
    comp.relayClosed = isClosed;

    const rOn = 0.05;
    const rOff = 1e8;

    const branchCurrents: Record<number, number> = {};
    branchCurrents[0] = (vCoil1 - vCoil2) / rCoil;
    branchCurrents[1] = -branchCurrents[0];

    if (isClosed) {
      // COM conectado a NO
      const iNo = (vCom - vNo) / rOn;
      const iNc = (vCom - vNc) / rOff;
      branchCurrents[2] = iNo + iNc;
      branchCurrents[3] = -iNo;
      branchCurrents[4] = -iNc;
    } else {
      // COM conectado a NC
      const iNc = (vCom - vNc) / rOn;
      const iNo = (vCom - vNo) / rOff;
      branchCurrents[2] = iNc + iNo;
      branchCurrents[3] = -iNo;
      branchCurrents[4] = -iNc;
    }

    return {
      relayClosed: isClosed,
      branchCurrents,
    };
  },
};

export const BuzzerDefinition: ComponentDefinition = {
  type: "buzzer",
  name: "Zumbador Piezoeléctrico (Buzzer)",
  category: "actuadores",
  prefix: "BZ",
  defaultProperties: { value: "5V 2.4kHz;vnom=5;vstart=1.2;freq=2400" },
  halfExtents: { halfW: 40, halfH: 40 },
  getPins: () => [
    { index: 0, x: -40, y: 0, label: "+", name: "Positivo (+)" },
    { index: 1, x: 40, y: 0, label: "-", name: "Negativo (-)" },
  ],
  render: (ctx, comp) => {
    drawBuzzer(ctx, comp);
  },
  evaluateLiveBehavior: (pinVoltages, comp) => {
    const v0 = pinVoltages[0] ?? 0;
    const v1 = pinVoltages[1] ?? 0;
    const vDrop = Math.abs(v0 - v1);
    const vStart = 1.2;
    const buzzerLevel = Math.max(0, Math.min(1, (vDrop - vStart) / 3.8));
    comp.buzzerLevel = buzzerLevel;
    comp.buzzerActive = buzzerLevel > 0.1;

    const rBuzzer = 220.0;
    const i = (v0 - v1) / rBuzzer;
    return {
      buzzerLevel,
      branchCurrents: { 0: i, 1: -i },
    };
  },
};

export const SwitchDefinition: ComponentDefinition = {
  type: "switch",
  name: "Interruptor SPST",
  category: "actuadores",
  prefix: "SW",
  defaultProperties: { value: "SPST", switchState: false },
  halfExtents: { halfW: 45, halfH: 15 },
  getPins: () => [
    { index: 0, x: -40, y: 0, label: "T1", name: "Terminal 1" },
    { index: 1, x: 40, y: 0, label: "T2", name: "Terminal 2" },
  ],
  render: (ctx, comp) => {
    drawSwitch(ctx, comp);
  },
  evaluateLiveBehavior: (pinVoltages, comp) => {
    const isClosed = comp.switchState ?? false;
    if (!isClosed) return { branchCurrents: { 0: 0, 1: 0 } };
    const v0 = pinVoltages[0] ?? 0;
    const v1 = pinVoltages[1] ?? 0;
    const i = (v0 - v1) / 0.05;
    return {
      branchCurrents: { 0: i, 1: -i },
    };
  },
};

export const SwitchSpdtDefinition: ComponentDefinition = {
  type: "switch_spdt",
  name: "Conmutador SPDT (1 Polo, 2 Tiros)",
  category: "actuadores",
  prefix: "SW",
  defaultProperties: { value: "SPDT", switchPosition: 0 },
  halfExtents: { halfW: 45, halfH: 25 },
  hasStandardLeads: false,
  getPins: () => [
    { index: 0, x: -40, y: 0, label: "COM", name: "Común (COM)" },
    { index: 1, x: 40, y: -16, label: "T1", name: "Tiro 1 (T1)" },
    { index: 2, x: 40, y: 16, label: "T2", name: "Tiro 2 (T2)" },
  ],
  render: (ctx, comp) => {
    drawSwitchSpdt(ctx, comp);
  },
  evaluateLiveBehavior: (pinVoltages, comp) => {
    const pos = comp.switchPosition ?? (comp.switchState ? 1 : 0);
    const vCom = pinVoltages[0] ?? 0;
    const vT1 = pinVoltages[1] ?? 0;
    const vT2 = pinVoltages[2] ?? 0;

    const rOn = 0.01;
    const rOff = 1e9;

    const iT1 = (vCom - vT1) / (pos === 0 ? rOn : rOff);
    const iT2 = (vCom - vT2) / (pos === 1 ? rOn : rOff);

    return {
      branchCurrents: {
        0: iT1 + iT2,
        1: -iT1,
        2: -iT2,
      },
    };
  },
};

export const SwitchDpdtDefinition: ComponentDefinition = {
  type: "switch_dpdt",
  name: "Conmutador DPDT (2 Polos, 2 Tiros)",
  category: "actuadores",
  prefix: "SW",
  defaultProperties: { value: "DPDT", switchPosition: 0 },
  halfExtents: { halfW: 45, halfH: 35 },
  hasStandardLeads: false,
  getPins: () => [
    { index: 0, x: -40, y: -16, label: "COM1", name: "Común 1 (COM1)" },
    { index: 1, x: 40, y: -28, label: "1A", name: "Tiro 1A" },
    { index: 2, x: 40, y: -4, label: "1B", name: "Tiro 1B" },
    { index: 3, x: -40, y: 16, label: "COM2", name: "Común 2 (COM2)" },
    { index: 4, x: 40, y: 4, label: "2A", name: "Tiro 2A" },
    { index: 5, x: 40, y: 28, label: "2B", name: "Tiro 2B" },
  ],
  render: (ctx, comp) => {
    drawSwitchDpdt(ctx, comp);
  },
  evaluateLiveBehavior: (pinVoltages, comp) => {
    const pos = comp.switchPosition ?? (comp.switchState ? 1 : 0);
    const rOn = 0.01;
    const rOff = 1e9;

    // Polo 1
    const vCom1 = pinVoltages[0] ?? 0;
    const v1A = pinVoltages[1] ?? 0;
    const v1B = pinVoltages[2] ?? 0;
    const i1A = (vCom1 - v1A) / (pos === 0 ? rOn : rOff);
    const i1B = (vCom1 - v1B) / (pos === 1 ? rOn : rOff);

    // Polo 2
    const vCom2 = pinVoltages[3] ?? 0;
    const v2A = pinVoltages[4] ?? 0;
    const v2B = pinVoltages[5] ?? 0;
    const i2A = (vCom2 - v2A) / (pos === 0 ? rOn : rOff);
    const i2B = (vCom2 - v2B) / (pos === 1 ? rOn : rOff);

    return {
      branchCurrents: {
        0: i1A + i1B,
        1: -i1A,
        2: -i1B,
        3: i2A + i2B,
        4: -i2A,
        5: -i2B,
      },
    };
  },
};

export const PushbuttonDefinition: ComponentDefinition = {
  type: "pushbutton",
  name: "Pulsador Momentáneo",
  category: "actuadores",
  prefix: "PB",
  defaultProperties: { value: "NO", switchState: false, isMomentary: true },
  halfExtents: { halfW: 45, halfH: 20 },
  getPins: () => [
    { index: 0, x: -40, y: 0, label: "1", name: "Terminal 1" },
    { index: 1, x: 40, y: 0, label: "2", name: "Terminal 2" },
  ],
  render: (ctx, comp) => {
    drawPushbutton(ctx, comp);
  },
  evaluateLiveBehavior: (pinVoltages, comp) => {
    const isPressed = comp.switchState ?? false;
    const isNc = comp.isMomentary === false || comp.value === "NC";
    const isClosed = isNc ? !isPressed : isPressed;
    if (!isClosed) return { branchCurrents: { 0: 0, 1: 0 } };

    const v0 = pinVoltages[0] ?? 0;
    const v1 = pinVoltages[1] ?? 0;
    const i = (v0 - v1) / 0.05;
    return {
      branchCurrents: { 0: i, 1: -i },
    };
  },
};

export const DcMotorDefinition: ComponentDefinition = {
  type: "dc_motor",
  name: "Motor de Corriente Continua (DC)",
  category: "actuadores",
  prefix: "M",
  defaultProperties: { value: "12V 3000RPM;ra=4.5;la=2m;ke=0.038;kt=0.038" },
  halfExtents: { halfW: 45, halfH: 35 },
  getPins: () => [
    { index: 0, x: -40, y: 0, label: "+", name: "Borne Positivo (+)" },
    { index: 1, x: 40, y: 0, label: "-", name: "Borne Negativo (-)" },
  ],
  render: (ctx, comp) => {
    drawDcMotor(ctx, comp);
  },
  evaluateLiveBehavior: (pinVoltages, comp) => {
    const v0 = pinVoltages[0] ?? 0;
    const v1 = pinVoltages[1] ?? 0;
    const vDrop = v0 - v1;

    const rArmature = 4.5;
    const ke = 0.038; // Constante de Back-EMF (V·s/rad)
    // Velocidad angular en régimen permanente (rad/s)
    const omega = vDrop / Math.max(ke, 1e-4);
    const rpm = (omega * 60) / (2 * Math.PI);

    comp.motorRpm = rpm;
    comp.motorAngle = ((comp.motorAngle ?? 0) + (rpm / 60) * 0.05) % (Math.PI * 2);

    const i = vDrop / (rArmature + 10.0);
    return {
      branchCurrents: { 0: i, 1: -i },
    };
  },
};

export const SevenSegmentDefinition: ComponentDefinition = {
  type: "seven_segment",
  name: "Display de 7 Segmentos (10 Pines)",
  category: "actuadores",
  prefix: "DS",
  defaultProperties: { value: "Catodo Común", sevenSegmentType: "common_cathode" },
  halfExtents: { halfW: 30, halfH: 45 },
  hasStandardLeads: false,
  getPins: () => [
    // Pines superiores (0 a 4: G, F, COM1, A, B)
    { index: 0, x: -16, y: -40, label: "G", name: "Segmento G" },
    { index: 1, x: -8, y: -40, label: "F", name: "Segmento F" },
    { index: 2, x: 0, y: -40, label: "COM", name: "Común 1 (COM)" },
    { index: 3, x: 8, y: -40, label: "A", name: "Segmento A" },
    { index: 4, x: 16, y: -40, label: "B", name: "Segmento B" },
    // Pines inferiores (5 a 9: E, D, COM2, C, DP)
    { index: 5, x: -16, y: 40, label: "E", name: "Segmento E" },
    { index: 6, x: -8, y: 40, label: "D", name: "Segmento D" },
    { index: 7, x: 0, y: 40, label: "COM", name: "Común 2 (COM)" },
    { index: 8, x: 8, y: 40, label: "C", name: "Segmento C" },
    { index: 9, x: 16, y: 40, label: "DP", name: "Punto Decimal (DP)" },
  ],
  render: (ctx, comp) => {
    drawSevenSegment(ctx, comp);
  },
  evaluateLiveBehavior: (pinVoltages, comp) => {
    const isAnode = comp.sevenSegmentType === "common_anode" || comp.value === "Anodo Comun";
    const vCom = pinVoltages[2] ?? (isAnode ? 5.0 : 0.0);

    const segmentStates: Record<string, boolean> = {};
    const branchCurrents: Record<number, number> = {};

    const pinMap: Record<string, number> = {
      G: 0, F: 1, A: 3, B: 4, E: 5, D: 6, C: 8, DP: 9,
    };

    let totalComCurrent = 0;
    for (const [seg, pinIdx] of Object.entries(pinMap)) {
      const vPin = pinVoltages[pinIdx] ?? (isAnode ? 5.0 : 0.0);
      const vDiode = isAnode ? (vCom - vPin) : (vPin - vCom);
      const isOn = vDiode >= 1.8; // Umbral de encendido del LED rojo (~1.8V)
      segmentStates[seg] = isOn;

      const iSeg = isOn ? (vDiode - 1.8) / 220.0 : 0;
      branchCurrents[pinIdx] = isAnode ? -iSeg : iSeg;
      totalComCurrent += isAnode ? iSeg : -iSeg;
    }

    branchCurrents[2] = totalComCurrent / 2;
    branchCurrents[7] = totalComCurrent / 2;
    comp.segmentStates = segmentStates;

    return {
      branchCurrents,
    };
  },
};

export const ServoMotorDefinition: ComponentDefinition = {
  type: "servo_motor",
  name: "Servomotor RC (SG90)",
  category: "actuadores",
  prefix: "SRV",
  defaultProperties: { value: "SG90 0-180°", servoAngle: 90 },
  halfExtents: { halfW: 45, halfH: 45 },
  getPins: () => [
    { index: 0, x: -40, y: 0, label: "PWM", name: "Señal PWM (Control)" },
    { index: 1, x: 0, y: -40, label: "VCC", name: "Alimentación (+5V)" },
    { index: 2, x: 0, y: 40, label: "GND", name: "Masa / Tierra (GND)" },
  ],
  render: (ctx, comp) => {
    drawServoMotor(ctx, comp);
  },
  evaluateLiveBehavior: (pinVoltages, comp) => {
    const vPwm = pinVoltages[0] ?? 0;
    const vCc = pinVoltages[1] ?? 0;
    const vGnd = pinVoltages[2] ?? 0;

    const vSupply = vCc - vGnd;
    const isPowered = vSupply >= 3.8;

    let targetAngle = 90;
    if (isPowered) {
      const vSignal = Math.max(0, vPwm - vGnd);
      // Mapeo lineal: 0V -> 0°, 2.5V -> 90°, 5V -> 180°
      targetAngle = Math.max(0, Math.min(180, (vSignal / 5.0) * 180));
    }
    comp.servoAngle = targetAngle;

    const rControl = 100000.0; // 100k impedancia de entrada PWM
    const iPwm = isPowered ? (vPwm - vGnd) / rControl : 0;
    const iSupply = isPowered ? 0.02 + (Math.abs(targetAngle - 90) / 180) * 0.04 : 0;

    return {
      branchCurrents: {
        0: iPwm,
        1: iSupply,
        2: -(iPwm + iSupply),
      },
    };
  },
};

export const StepperMotorDefinition: ComponentDefinition = {
  type: "stepper_motor",
  name: "Motor Paso a Paso Bipolar (4 Fases)",
  category: "actuadores",
  prefix: "STP",
  defaultProperties: { value: "NEMA 17 (1.8°)", motorAngle: 0, stepperSteps: 0 },
  halfExtents: { halfW: 45, halfH: 45 },
  getPins: () => [
    { index: 0, x: -40, y: -20, label: "A+", name: "Fase A+" },
    { index: 1, x: -40, y: 20, label: "A-", name: "Fase A-" },
    { index: 2, x: 40, y: -20, label: "B+", name: "Fase B+" },
    { index: 3, x: 40, y: 20, label: "B-", name: "Fase B-" },
  ],
  render: (ctx, comp) => {
    drawStepperMotor(ctx, comp);
  },
  evaluateLiveBehavior: (pinVoltages, comp) => {
    const vA1 = pinVoltages[0] ?? 0;
    const vA2 = pinVoltages[1] ?? 0;
    const vB1 = pinVoltages[2] ?? 0;
    const vB2 = pinVoltages[3] ?? 0;

    const vA = vA1 - vA2;
    const vB = vB1 - vB2;

    const rPhase = 30.0; // Resistencia por bobina (30 Ohm)
    const iA = vA / rPhase;
    const iB = vB / rPhase;

    if (Math.abs(vA) > 1.5 || Math.abs(vB) > 1.5) {
      const angle = Math.atan2(vB, vA);
      comp.motorAngle = angle;
      const stepIdx = Math.round(((angle + Math.PI) / (Math.PI * 2)) * 200) % 200;
      comp.stepperSteps = stepIdx;
    }

    return {
      branchCurrents: {
        0: iA,
        1: -iA,
        2: iB,
        3: -iB,
      },
    };
  },
};

export const SpeakerDefinition: ComponentDefinition = {
  type: "speaker",
  name: "Altavoz Dinámico (8Ω)",
  category: "actuadores",
  prefix: "SPK",
  defaultProperties: { value: "8Ω 0.5W" },
  halfExtents: { halfW: 45, halfH: 35 },
  getPins: () => [
    { index: 0, x: -40, y: 0, label: "+", name: "Borne Positivo (+)" },
    { index: 1, x: 40, y: 0, label: "-", name: "Borne Negativo (-)" },
  ],
  render: (ctx, comp) => {
    drawSpeaker(ctx, comp);
  },
  evaluateLiveBehavior: (pinVoltages, comp) => {
    const v0 = pinVoltages[0] ?? 0;
    const v1 = pinVoltages[1] ?? 0;
    const vDrop = v0 - v1;
    const rSpeaker = 8.0;

    const i = vDrop / rSpeaker;
    const power = (vDrop * vDrop) / rSpeaker;
    comp.speakerPower = power;

    return {
      branchCurrents: { 0: i, 1: -i },
    };
  },
};

export const SolenoidDefinition: ComponentDefinition = {
  type: "solenoid",
  name: "Solenoide / Actuador Lineal",
  category: "actuadores",
  prefix: "SOL",
  defaultProperties: { value: "12V 10N" },
  halfExtents: { halfW: 45, halfH: 30 },
  getPins: () => [
    { index: 0, x: -40, y: 0, label: "+", name: "Borne (+)" },
    { index: 1, x: 40, y: 0, label: "-", name: "Borne (-)" },
  ],
  render: (ctx, comp) => {
    drawSolenoid(ctx, comp);
  },
  evaluateLiveBehavior: (pinVoltages, comp) => {
    const v0 = pinVoltages[0] ?? 0;
    const v1 = pinVoltages[1] ?? 0;
    const vDrop = v0 - v1;
    const rCoil = 24.0;

    const i = vDrop / rCoil;
    const iMag = Math.abs(i);
    const isEngaged = iMag >= 0.25;
    comp.solenoidEngaged = isEngaged;
    comp.solenoidPosition = Math.min(1.0, iMag / 0.45);

    return {
      branchCurrents: { 0: i, 1: -i },
    };
  },
};

export const SsrDefinition: ComponentDefinition = {
  type: "ssr",
  name: "Relé de Estado Sólido (SSR)",
  category: "actuadores",
  prefix: "SSR",
  defaultProperties: { value: "3-32VDC / 240VAC" },
  halfExtents: { halfW: 45, halfH: 35 },
  getPins: () => [
    { index: 0, x: -40, y: -20, label: "IN+", name: "Entrada de Control (+)" },
    { index: 1, x: -40, y: 20, label: "IN-", name: "Entrada de Control (-)" },
    { index: 2, x: 40, y: -20, label: "OUT1", name: "Terminal de Carga 1" },
    { index: 3, x: 40, y: 20, label: "OUT2", name: "Terminal de Carga 2" },
  ],
  render: (ctx, comp) => {
    drawSsr(ctx, comp);
  },
  evaluateLiveBehavior: (pinVoltages, comp) => {
    const vIn1 = pinVoltages[0] ?? 0;
    const vIn2 = pinVoltages[1] ?? 0;
    const vOut1 = pinVoltages[2] ?? 0;
    const vOut2 = pinVoltages[3] ?? 0;

    const vCtrl = vIn1 - vIn2;
    const isActive = vCtrl >= 3.0; // Umbral de disparo optoacoplado ~3V
    comp.ssrActive = isActive;

    const rIn = 600.0;
    const iCtrl = isActive ? (vCtrl - 1.2) / rIn : 0;

    const rLoad = isActive ? 0.05 : 1e8;
    const iLoad = (vOut1 - vOut2) / rLoad;

    return {
      branchCurrents: {
        0: iCtrl,
        1: -iCtrl,
        2: iLoad,
        3: -iLoad,
      },
    };
  },
};

const LCD16X2_PIN_LABELS = [
  "VSS", "VDD", "V0", "RS", "RW", "E", "D0", "D1", "D2", "D3", "D4", "D5", "D6", "D7", "A", "K",
] as const;

export const Lcd16x2Definition: ComponentDefinition = {
  type: "lcd_16x2",
  name: "Display LCD 16x2 Alfanumérico (HD44780)",
  category: "actuadores",
  prefix: "LCD",
  defaultProperties: { value: "HD44780" },
  halfExtents: { halfW: 105, halfH: 55 },
  hasStandardLeads: false,
  hasValueLabel: false,
  optionalFloatingPins: [6, 7, 8, 9], // D0..D3 pueden flotar en modo 4 bits
  getPins: () => {
    const pins: LocalPinDefinition[] = [];
    for (let i = 0; i < 16; i++) {
      pins.push({
        index: i,
        x: -75 + i * 10,
        y: -50,
        label: LCD16X2_PIN_LABELS[i],
        name: `Pin ${i + 1} (${LCD16X2_PIN_LABELS[i]})`,
      });
    }
    return pins;
  },
  render: (ctx, comp) => {
    drawLcd16x2(ctx, comp);
  },
  evaluateLiveBehavior: (pinVoltages, comp) => {
    const vVdd = pinVoltages[1] ?? 5.0;
    const vVss = pinVoltages[0] ?? 0.0;
    const vA = pinVoltages[14] ?? 5.0;
    const vK = pinVoltages[15] ?? 0.0;

    const isPowered = vVdd - vVss >= 3.0;
    const isBacklightOn = vA - vK >= 2.5;
    comp.glowLevel = isBacklightOn ? 1.0 : 0.0;

    const iVdd = isPowered ? 0.003 : 0.0; // ~3mA lógica
    const iLed = isBacklightOn ? (vA - vK - 2.0) / 100.0 : 0.0; // ~20mA backlight

    return {
      glowLevel: comp.glowLevel,
      branchCurrents: {
        1: iVdd,
        0: -iVdd,
        14: iLed,
        15: -iLed,
      },
    };
  },
};


