import { describe, expect, it } from "vitest";
import {
  TimerPeripheralModel,
  SarAdcModel,
  UartPeripheralModel,
  SpiPeripheralModel,
  I2cPeripheralModel,
  McuPeripheralsHub,
} from "./mcu_peripheral_models";

describe("MCU Peripheral Models Suite", () => {
  describe("1. Timer / Counter / PWM / Input Capture", () => {
    it("CTC Mode: cuenta hasta OCR0A y activa compareMatchA con reset a 0", () => {
      const timer = new TimerPeripheralModel({
        name: "Timer0",
        resolutionBits: 8,
        mode: "ctc",
        ocrA: 50,
        prescaler: 1,
      });

      const res1 = timer.step(50);
      expect(timer.counter).toBe(50);
      expect(res1.compareMatchA).toBe(true);

      const res2 = timer.step(1);
      expect(timer.counter).toBe(0); // Reset en CTC
    });

    it("Fast PWM Mode: genera salida modulada proporcional a OCR0A", () => {
      const timer = new TimerPeripheralModel({
        name: "Timer0",
        resolutionBits: 8,
        mode: "fast-pwm",
        ocrA: 128, // 50% duty cycle
        prescaler: 1,
      });

      timer.step(1);
      expect(timer.pwmOutputA).toBe(5.0); // Conteo inicial en nivel alto

      timer.step(127); // Llega a OCR0A = 128
      expect(timer.pwmOutputA).toBe(0.0); // Transición a nivel bajo tras compare match
    });

    it("Phase Correct PWM Mode: conteo dual-slope (ascendente y descendente)", () => {
      const timer = new TimerPeripheralModel({
        name: "Timer0",
        resolutionBits: 8,
        mode: "phase-correct-pwm",
        topValue: 10,
        ocrA: 5,
        prescaler: 1,
      });

      timer.step(10);
      expect(timer.counter).toBe(10);
      expect(timer.direction).toBe(-1); // Conteo descendente

      timer.step(5);
      expect(timer.counter).toBe(5);
    });

    it("Input Capture: captura valor de TCNT1 en ICR1 ante flanco de subida", () => {
      const timer = new TimerPeripheralModel({
        name: "Timer1",
        resolutionBits: 16,
        prescaler: 1,
        inputCaptureEdge: "rising",
      });

      // Avanzar timer a 1234 ciclos con pin en 0
      timer.step(1234, false);
      expect(timer.counter).toBe(1234);

      // Flanco de subida en pin Input Capture (0 -> 1)
      const res = timer.step(1, true);
      expect(res.inputCaptured).toBe(true);
      expect(timer.icr).toBe(1234); // Captura el valor del contador
    });
  });

  describe("2. SAR ADC (Successive Approximation Register)", () => {
    it("Conversión SAR de 10 bits con Sample & Hold de 2.5V a 5.0V Vref", () => {
      const adc = new SarAdcModel({
        resolutionBits: 10,
        referenceVoltage: 5.0,
        clockPrescaler: 1,
      });

      adc.setChannelVoltage(0, 2.5); // Entrada de 2.5V (50% de Vref)
      adc.startConversion(0);

      expect(adc.converting).toBe(true);

      // Avanzar los ciclos necesarios para la conversión SAR (12 ciclos)
      const res = adc.step(15);
      expect(res.completed).toBe(true);
      expect(res.digitalCode).toBeGreaterThanOrEqual(510);
      expect(res.digitalCode).toBeLessThanOrEqual(514); // ~512 con modelado de ruido
    });

    it("Ajuste a la izquierda (ADLAR) para lectura rápida de 8 bits", () => {
      const adc = new SarAdcModel({
        resolutionBits: 10,
        referenceVoltage: 5.0,
        clockPrescaler: 1,
      });
      adc.leftAdjust = true;
      adc.setChannelVoltage(1, 5.0); // Full-scale 5V
      adc.startConversion(1);
      adc.step(20);

      expect(adc.getHighByte()).toBe(255); // 8 bits MSB en ADCH
    });
  });

  describe("3. UART / USART Transceiver", () => {
    it("Transmisión y recepción serial en bucle (Loopback)", () => {
      const uart = new UartPeripheralModel({
        baudRate: 115200,
        clockFrequencyHz: 16_000_000,
      });

      uart.transmitString("OK");

      // Primer paso inicia la transmisión del START bit
      const step1 = uart.step(1);
      expect(step1.txPin).toBe(0); // Start bit en bajo

      // Simular llegada de byte 0x41 ('A') en pin RX
      const cyclesPerBit = uart.cyclesPerBit;
      uart.step(1, 0); // START bit en RX

      // Enviar bits de datos de 'A' (0x41 = 0b01000001) LSB first: 1, 0, 0, 0, 0, 0, 1, 0
      const bits = [1, 0, 0, 0, 0, 0, 1, 0];
      for (const bit of bits) {
        uart.step(cyclesPerBit, bit ? 1 : 0);
      }
      // STOP bit en 1
      uart.step(cyclesPerBit, 1);

      expect(uart.rxcFlag).toBe(true);
      expect(uart.readRxData()).toBe(0x41);
    });
  });

  describe("4. SPI Master / Slave Interface", () => {
    it("Intercambio Full-Duplex de bytes en bus SPI", () => {
      const spi = new SpiPeripheralModel({
        mode: "master",
        cpol: 0,
        cpha: 0,
      });

      const received = spi.transferByte(0xAB, 0x55);
      expect(received).toBe(0x55);
      expect(spi.spifFlag).toBe(true);
    });
  });

  describe("5. I2C / TWI Master & Slave Interface", () => {
    it("Secuencia de transacción I2C: START -> SLA+W -> DATA -> STOP", () => {
      const master = new I2cPeripheralModel({ mode: "master" });
      const slave = new I2cPeripheralModel({ mode: "slave", ownAddress: 0x3C });

      master.masterStart();
      expect(master.busState).toBe("start");
      expect(master.statusRegister).toBe(0x08);

      master.masterSendAddress(0x3C, false); // SLA+W
      expect(master.statusRegister).toBe(0x18);
      expect(slave.slaveMatchAddress(0x3C << 1)).toBe(true);

      master.masterSendByte(0xA5); // Enviar dato
      expect(master.statusRegister).toBe(0x28);

      master.masterStop();
      expect(master.busState).toBe("stop");
    });
  });

  describe("6. Unified McuPeripheralsHub", () => {
    it("Ejecuta paso unificado sobre todos los periféricos", () => {
      const hub = new McuPeripheralsHub();
      hub.adc.setChannelVoltage(0, 3.3);
      hub.adc.startConversion(0);
      hub.uart.writeTxData(0x5A);

      hub.stepAll(2000);

      expect(hub.timers.get("Timer0")?.counter).toBeGreaterThan(0);
      expect(hub.adc.conversionCompleteFlag).toBe(true);
    });
  });
});
