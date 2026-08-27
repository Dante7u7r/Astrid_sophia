import { describe, it, expect, vi } from "vitest";
import {
  LampDefinition,
  RelayDefinition,
  BuzzerDefinition,
  SwitchDefinition,
  SwitchSpdtDefinition,
  SwitchDpdtDefinition,
  PushbuttonDefinition,
  DcMotorDefinition,
  SevenSegmentDefinition,
  ServoMotorDefinition,
  StepperMotorDefinition,
  SpeakerDefinition,
  SolenoidDefinition,
  SsrDefinition,
  Lcd16x2Definition,
} from "../components/descriptors/actuators";

describe("Industrial & Educational Actuators and Switches Upgrade", () => {
  const dummyState = {
    color: "#E6EAF0",
    lineWidth: 2,
    shadowBlur: 0,
  };

  const createMockCtx = () => ({
    beginPath: vi.fn(),
    moveTo: vi.fn(),
    lineTo: vi.fn(),
    arc: vi.fn(),
    rect: vi.fn(),
    fillRect: vi.fn(),
    strokeRect: vi.fn(),
    stroke: vi.fn(),
    fill: vi.fn(),
    closePath: vi.fn(),
    save: vi.fn(),
    restore: vi.fn(),
    rotate: vi.fn(),
    fillText: vi.fn(),
    createRadialGradient: vi.fn(() => ({
      addColorStop: vi.fn(),
    })),
    setLineDash: vi.fn(),
    font: "",
    fillStyle: "",
    strokeStyle: "",
    lineWidth: 1,
    textAlign: "left",
  }) as unknown as CanvasRenderingContext2D;

  it("Relé SPDT: Valida 5 pines y conmutación entre NC en reposo y NO energizado", () => {
    const comp = { id: "RY1", type: "relay" as const, x: 0, y: 0, rotation: 0, value: "12V", relayClosed: false };
    const pins = RelayDefinition.getPins(comp);
    expect(pins.length).toBe(5);
    expect(pins.map(p => p.label)).toEqual(["COIL1", "COIL2", "COM", "NO", "NC"]);

    // 1. Desenergizado (0V en bobina, 12V en COM, 0V en NO y NC)
    const restBehavior = RelayDefinition.evaluateLiveBehavior?.([0, 0, 12, 0, 0], comp);
    expect(restBehavior?.relayClosed).toBe(false);
    // COM (pin 2) conecta a NC (pin 4) con baja resistencia -> corriente alta hacia NC
    expect(Math.abs(restBehavior?.branchCurrents[4] ?? 0)).toBeGreaterThan(100);
    expect(Math.abs(restBehavior?.branchCurrents[3] ?? 0)).toBeLessThan(0.001); // NO desconectado

    // 2. Energizado (12V en bobina -> I_coil = 100mA > 30mA)
    const energizedBehavior = RelayDefinition.evaluateLiveBehavior?.([12, 0, 12, 0, 0], comp);
    expect(energizedBehavior?.relayClosed).toBe(true);
    // COM (pin 2) conmuta a NO (pin 3) con baja resistencia
    expect(Math.abs(energizedBehavior?.branchCurrents[3] ?? 0)).toBeGreaterThan(100);
    expect(Math.abs(energizedBehavior?.branchCurrents[4] ?? 0)).toBeLessThan(0.001); // NC desconectado

    const ctx = createMockCtx();
    RelayDefinition.render(ctx, comp, dummyState, {});
    expect(ctx.stroke).toHaveBeenCalled();
  });

  it("Conmutadores SPDT y DPDT: Conmutan vías según la posición del interruptor", () => {
    // SPDT
    const spdtComp = { id: "SW1", type: "switch_spdt" as const, x: 0, y: 0, rotation: 0, value: "SPDT", switchPosition: 0 };
    const spdtPins = SwitchSpdtDefinition.getPins(spdtComp);
    expect(spdtPins.length).toBe(3);

    // Posición 0: COM (pin 0) -> T1 (pin 1)
    const spdtPos0 = SwitchSpdtDefinition.evaluateLiveBehavior?.([5, 0, 0], spdtComp);
    expect(Math.abs(spdtPos0?.branchCurrents[1] ?? 0)).toBeGreaterThan(100);
    expect(Math.abs(spdtPos0?.branchCurrents[2] ?? 0)).toBeLessThan(0.001);

    // Posición 1: COM (pin 0) -> T2 (pin 2)
    spdtComp.switchPosition = 1;
    const spdtPos1 = SwitchSpdtDefinition.evaluateLiveBehavior?.([5, 0, 0], spdtComp);
    expect(Math.abs(spdtPos1?.branchCurrents[2] ?? 0)).toBeGreaterThan(100);
    expect(Math.abs(spdtPos1?.branchCurrents[1] ?? 0)).toBeLessThan(0.001);

    // DPDT
    const dpdtComp = { id: "SW2", type: "switch_dpdt" as const, x: 0, y: 0, rotation: 0, value: "DPDT", switchPosition: 0 };
    expect(SwitchDpdtDefinition.getPins(dpdtComp).length).toBe(6);

    const ctx = createMockCtx();
    SwitchSpdtDefinition.render(ctx, spdtComp, dummyState, {});
    SwitchDpdtDefinition.render(ctx, dpdtComp, dummyState, {});
    expect(ctx.stroke).toHaveBeenCalled();
  });

  it("Pulsador Pushbutton: Diferencia entre normalmente abierto (NO) y normalmente cerrado (NC)", () => {
    const noBtn = { id: "PB1", type: "pushbutton" as const, x: 0, y: 0, rotation: 0, value: "NO", switchState: false };
    // Sin presionar: abierto
    expect(Math.abs(PushbuttonDefinition.evaluateLiveBehavior?.([5, 0], noBtn)?.branchCurrents[0] ?? 0)).toBeLessThan(0.001);
    // Presionado: cerrado
    noBtn.switchState = true;
    expect(Math.abs(PushbuttonDefinition.evaluateLiveBehavior?.([5, 0], noBtn)?.branchCurrents[0] ?? 0)).toBeCloseTo(100);

    const ncBtn = { id: "PB2", type: "pushbutton" as const, x: 0, y: 0, rotation: 0, value: "NC", switchState: false, isMomentary: false };
    // Sin presionar: cerrado
    expect(Math.abs(PushbuttonDefinition.evaluateLiveBehavior?.([5, 0], ncBtn)?.branchCurrents[0] ?? 0)).toBeCloseTo(100);
    // Presionado: abierto
    ncBtn.switchState = true;
    expect(Math.abs(PushbuttonDefinition.evaluateLiveBehavior?.([5, 0], ncBtn)?.branchCurrents[0] ?? 0)).toBeLessThan(0.001);
  });

  it("Motor DC: Calcula RPM y velocidad angular con rotación continua", () => {
    const motor = { id: "M1", type: "dc_motor" as const, x: 0, y: 0, rotation: 0, value: "12V", motorRpm: 0, motorAngle: 0 };
    const pins = DcMotorDefinition.getPins(motor);
    expect(pins.length).toBe(2);

    // 12V aplicados al motor DC
    DcMotorDefinition.evaluateLiveBehavior?.([12, 0], motor);
    expect(motor.motorRpm).toBeGreaterThan(2000); // ~3000 RPM
    expect(motor.motorAngle).toBeGreaterThan(0);

    const ctx = createMockCtx();
    DcMotorDefinition.render(ctx, motor, dummyState, {});
    expect(ctx.rotate).toHaveBeenCalled();
    expect(ctx.fillText).toHaveBeenCalledWith(expect.stringContaining("RPM"), 0, 30);
  });

  it("Display de 7 Segmentos: Ilumina segmentos individuales en tiempo real con 10 pines DIP", () => {
    const display = {
      id: "DS1",
      type: "seven_segment" as const,
      x: 0,
      y: 0,
      rotation: 0,
      value: "Catodo Común",
      sevenSegmentType: "common_cathode" as const,
      segmentStates: {},
    };

    const pins = SevenSegmentDefinition.getPins(display);
    expect(pins.length).toBe(10);

    // Conectar COM a 0V, encender segmentos A y B (pines 3 y 4 a 5V)
    const pinVoltages: number[] = new Array(10).fill(0);
    pinVoltages[2] = 0; // COM1
    pinVoltages[7] = 0; // COM2
    pinVoltages[3] = 5; // Pin A
    pinVoltages[4] = 5; // Pin B

    SevenSegmentDefinition.evaluateLiveBehavior?.(pinVoltages, display);
    expect(display.segmentStates["A"]).toBe(true);
    expect(display.segmentStates["B"]).toBe(true);
    expect(display.segmentStates["C"]).toBe(false);

    const ctx = createMockCtx();
    SevenSegmentDefinition.render(ctx, display, dummyState, {});
    expect(ctx.fillRect).toHaveBeenCalled();
  });

  it("Servomotor RC (SG90): Calcula ángulo de 0° a 180° según señal PWM y VCC", () => {
    const servo = { id: "SRV1", type: "servo_motor" as const, x: 0, y: 0, rotation: 0, value: "SG90", servoAngle: 90 };
    const pins = ServoMotorDefinition.getPins(servo);
    expect(pins.length).toBe(3);
    expect(pins.map(p => p.label)).toEqual(["PWM", "VCC", "GND"]);

    // Pines alineados a cuadrícula de 20px
    for (const pin of pins) {
      expect(Math.abs(pin.x % 20)).toBe(0);
      expect(Math.abs(pin.y % 20)).toBe(0);
    }

    // PWM a 2.5V con 5V VCC -> ~90°
    ServoMotorDefinition.evaluateLiveBehavior?.([2.5, 5.0, 0.0], servo);
    expect(servo.servoAngle).toBeCloseTo(90, 0);

    // PWM a 5V -> 180°
    ServoMotorDefinition.evaluateLiveBehavior?.([5.0, 5.0, 0.0], servo);
    expect(servo.servoAngle).toBeCloseTo(180, 0);

    // PWM a 0V -> 0°
    ServoMotorDefinition.evaluateLiveBehavior?.([0.0, 5.0, 0.0], servo);
    expect(servo.servoAngle).toBeCloseTo(0, 0);

    const ctx = createMockCtx();
    ServoMotorDefinition.render(ctx, servo, dummyState, {});
    expect(ctx.rotate).toHaveBeenCalled();
    expect(ctx.fillText).toHaveBeenCalledWith(expect.stringContaining("°"), 0, -28);
  });

  it("Motor Paso a Paso Bipolar: Responde a secuencias en fases A y B y acumula pasos", () => {
    const stepper = { id: "STP1", type: "stepper_motor" as const, x: 0, y: 0, rotation: 0, value: "NEMA 17", motorAngle: 0, stepperSteps: 0 };
    const pins = StepperMotorDefinition.getPins(stepper);
    expect(pins.length).toBe(4);
    expect(pins.map(p => p.label)).toEqual(["A+", "A-", "B+", "B-"]);

    for (const pin of pins) {
      expect(Math.abs(pin.x % 20)).toBe(0);
      expect(Math.abs(pin.y % 20)).toBe(0);
    }

    // Fase A activa (12V, 0V), Fase B inactiva (0V, 0V)
    StepperMotorDefinition.evaluateLiveBehavior?.([12, 0, 0, 0], stepper);
    expect(stepper.motorAngle).toBeCloseTo(0, 1);

    // Fase B activa (0V, 0V, 12V, 0V)
    StepperMotorDefinition.evaluateLiveBehavior?.([0, 0, 12, 0], stepper);
    expect(stepper.motorAngle).toBeCloseTo(Math.PI / 2, 1);

    const ctx = createMockCtx();
    StepperMotorDefinition.render(ctx, stepper, dummyState, {});
    expect(ctx.rotate).toHaveBeenCalled();
    expect(ctx.fillText).toHaveBeenCalledWith(expect.stringContaining("PASO"), 0, 32);
  });

  it("Altavoz Dinámico (8Ω): Calcula disipación de potencia acústica y anima cono", () => {
    const spk = { id: "SPK1", type: "speaker" as const, x: 0, y: 0, rotation: 0, value: "8Ω", speakerPower: 0 };
    const pins = SpeakerDefinition.getPins(spk);
    expect(pins.length).toBe(2);

    // 4V RMS -> P = 4^2 / 8 = 2W
    SpeakerDefinition.evaluateLiveBehavior?.([4, 0], spk);
    expect(spk.speakerPower).toBeCloseTo(2.0, 1);

    const ctx = createMockCtx();
    SpeakerDefinition.render(ctx, spk, dummyState, {});
    expect(ctx.arc).toHaveBeenCalled();
    expect(ctx.fillText).toHaveBeenCalledWith("8Ω", 0, -26);
  });

  it("Solenoide Lineal: Se activa y retrae émbolo con corriente de umbral", () => {
    const sol = { id: "SOL1", type: "solenoid" as const, x: 0, y: 0, rotation: 0, value: "12V", solenoidPosition: 0, solenoidEngaged: false };
    const pins = SolenoidDefinition.getPins(sol);
    expect(pins.length).toBe(2);

    // 0V -> Desactivado
    SolenoidDefinition.evaluateLiveBehavior?.([0, 0], sol);
    expect(sol.solenoidEngaged).toBe(false);
    expect(sol.solenoidPosition).toBe(0);

    // 12V -> I = 12/24 = 0.5A > 0.25A -> Activado
    SolenoidDefinition.evaluateLiveBehavior?.([12, 0], sol);
    expect(sol.solenoidEngaged).toBe(true);
    expect(sol.solenoidPosition).toBe(1.0);

    const ctx = createMockCtx();
    SolenoidDefinition.render(ctx, sol, dummyState, {});
    expect(ctx.strokeRect).toHaveBeenCalled();
    expect(ctx.fillText).toHaveBeenCalledWith("RETRAÍDO", 0, 22);
  });

  it("Relé de Estado Sólido (SSR): Conmuta con control óptico de 3V a 32V", () => {
    const ssr = { id: "SSR1", type: "ssr" as const, x: 0, y: 0, rotation: 0, value: "SSR", ssrActive: false };
    const pins = SsrDefinition.getPins(ssr);
    expect(pins.length).toBe(4);
    expect(pins.map(p => p.label)).toEqual(["IN+", "IN-", "OUT1", "OUT2"]);

    // Control inactivo (0V) -> Carga en alta impedancia
    const resOff = SsrDefinition.evaluateLiveBehavior?.([0, 0, 24, 0], ssr);
    expect(ssr.ssrActive).toBe(false);
    expect(Math.abs(resOff?.branchCurrents[2] ?? 0)).toBeLessThan(0.001);

    // Control activo (5V) -> Carga en baja impedancia (conducción alta)
    const resOn = SsrDefinition.evaluateLiveBehavior?.([5, 0, 24, 0], ssr);
    expect(ssr.ssrActive).toBe(true);
    expect(Math.abs(resOn?.branchCurrents[2] ?? 0)).toBeGreaterThan(100);

    const ctx = createMockCtx();
    SsrDefinition.render(ctx, ssr, dummyState, {});
    expect(ctx.strokeRect).toHaveBeenCalled();
    expect(ctx.fillText).toHaveBeenCalledWith("SSR", 0, 20);
  });

  it("Display LCD 16x2 (HD44780): Valida 16 pines, retroiluminación y renderizado", () => {
    const lcd = {
      id: "LCD1",
      type: "lcd_16x2" as const,
      x: 0,
      y: 0,
      rotation: 0,
      displayChar: "Hola Mundo!",
      displayLine2: "Astryd Sophia",
      glowLevel: 0,
    };

    const pins = Lcd16x2Definition.getPins(lcd);
    expect(pins.length).toBe(16);
    expect(pins[0].label).toBe("VSS");
    expect(pins[15].label).toBe("K");

    // Alimentación 5V y Backlight 5V (A=5V, K=0V)
    const pinVoltages: Record<number, number> = {
      0: 0.0, // VSS
      1: 5.0, // VDD
      14: 5.0, // A
      15: 0.0, // K
    };

    const res = Lcd16x2Definition.evaluateLiveBehavior?.(pinVoltages, lcd);
    expect(res?.glowLevel).toBe(1.0);
    expect(lcd.glowLevel).toBe(1.0);

    const ctx = createMockCtx();
    Lcd16x2Definition.render(ctx, lcd, dummyState, {});
    expect(ctx.fillRect).toHaveBeenCalled();
    expect(ctx.fillText).toHaveBeenCalledWith(expect.stringContaining("Hola Mundo!"), -74, -10);
    expect(ctx.fillText).toHaveBeenCalledWith(expect.stringContaining("Astryd Sophia"), -74, 10);
  });
});
