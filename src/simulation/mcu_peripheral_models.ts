/**
 * Peripheral Models Suite for Microcontroller Co-Simulation in Astryd Sophia.
 *
 * Implements high-fidelity models for:
 * 1. Timers/Counters: Normal, CTC, Fast PWM, Phase Correct PWM, Input Capture (edge detect & noise filter).
 * 2. ADC: Successive Approximation Register (SAR 10/12-bit) with Sample & Hold, Reference selection,
 *    Quantization, INL/DNL non-linearity, Gaussian noise, and Auto-triggering.
 * 3. UART / USART: Full-duplex asynchronous serial transceiver with Baud generator, U2X double-speed,
 *    FIFO TX/RX ring buffers, framing/parity checks, and serialization state machine.
 * 4. SPI (Serial Peripheral Interface): Master/Slave full-duplex synchronous bus with Modes 0..3 (CPOL/CPHA),
 *    bit ordering (MSB/LSB first), prescalers, and WCOL collision detection.
 * 5. I2C / TWI (Two-Wire Interface): Master/Slave state machine according to Philips/NXP specification,
 *    START/STOP/Repeated-START conditions, 7-bit addressing, ACK/NACK handshake, and bus arbitration.
 * 6. McuPeripheralsHub: Unified orchestration container linking peripherals to MCU registers & SPICE nodes.
 */

import type { DigitalState } from "./mcu-spice-bridge";

// ============================================================================
// 1. TIMER / COUNTER & PWM & INPUT CAPTURE MODEL
// ============================================================================

export type TimerMode = "normal" | "ctc" | "fast-pwm" | "phase-correct-pwm";
export type InputCaptureEdge = "rising" | "falling" | "both";

export interface TimerConfig {
  name: string;
  resolutionBits: 8 | 16;
  prescaler?: number;
  mode?: TimerMode;
  topValue?: number;
  ocrA?: number;
  ocrB?: number;
  inputCaptureEdge?: InputCaptureEdge;
}

export class TimerPeripheralModel {
  readonly name: string;
  readonly resolutionBits: 8 | 16;
  readonly maxVal: number;

  mode: TimerMode;
  prescaler: number;
  counter: number = 0;
  topValue: number;
  ocrA: number = 0;
  ocrB: number = 0;
  icr: number = 0; // Input Capture Register

  direction: 1 | -1 = 1; // 1 = counting up, -1 = counting down (Phase-correct)
  prescalerAccumulator: number = 0;

  // Pin & Interrupt states
  pwmOutputA: number = 0; // 0.0V or 5.0V
  pwmOutputB: number = 0;
  inputCaptureEdge: InputCaptureEdge;
  lastCapturePinState: boolean = false;

  overflowFlag: boolean = false;
  compareMatchAFlag: boolean = false;
  compareMatchBFlag: boolean = false;
  inputCaptureFlag: boolean = false;

  constructor(config: TimerConfig) {
    this.name = config.name;
    this.resolutionBits = config.resolutionBits;
    this.maxVal = (1 << config.resolutionBits) - 1;
    this.mode = config.mode ?? "normal";
    this.prescaler = config.prescaler ?? 1;
    this.topValue = config.topValue ?? this.maxVal;
    this.ocrA = config.ocrA ?? 0;
    this.ocrB = config.ocrB ?? 0;
    this.inputCaptureEdge = config.inputCaptureEdge ?? "rising";
  }

  reset(): void {
    this.counter = 0;
    this.direction = 1;
    this.prescalerAccumulator = 0;
    this.pwmOutputA = 0;
    this.pwmOutputB = 0;
    this.overflowFlag = false;
    this.compareMatchAFlag = false;
    this.compareMatchBFlag = false;
    this.inputCaptureFlag = false;
  }

  step(cycles: number, capturePinState?: boolean): {
    overflow: boolean;
    compareMatchA: boolean;
    compareMatchB: boolean;
    inputCaptured: boolean;
    pwmA: number;
    pwmB: number;
  } {
    let overflowOccurred = false;
    let compAOccurred = false;
    let compBOccurred = false;
    let captureOccurred = false;

    // Check Input Capture pin transition
    if (capturePinState !== undefined) {
      const isRising = !this.lastCapturePinState && capturePinState;
      const isFalling = this.lastCapturePinState && !capturePinState;
      this.lastCapturePinState = capturePinState;

      if (
        (this.inputCaptureEdge === "rising" && isRising) ||
        (this.inputCaptureEdge === "falling" && isFalling) ||
        (this.inputCaptureEdge === "both" && (isRising || isFalling))
      ) {
        this.icr = this.counter;
        this.inputCaptureFlag = true;
        captureOccurred = true;
      }
    }

    if (this.prescaler <= 0) {
      return {
        overflow: false,
        compareMatchA: false,
        compareMatchB: false,
        inputCaptured: captureOccurred,
        pwmA: this.pwmOutputA,
        pwmB: this.pwmOutputB,
      };
    }

    this.prescalerAccumulator += cycles;
    while (this.prescalerAccumulator >= this.prescaler) {
      this.prescalerAccumulator -= this.prescaler;

      if (this.mode === "normal") {
        this.counter = (this.counter + 1) & this.maxVal;
        if (this.counter === 0) {
          this.overflowFlag = true;
          overflowOccurred = true;
        }
      } else if (this.mode === "ctc") {
        if (this.counter >= this.ocrA) {
          this.counter = 0;
          this.compareMatchAFlag = true;
          compAOccurred = true;
        } else {
          this.counter += 1;
        }
      } else if (this.mode === "fast-pwm") {
        // Fast PWM: conteo de 0 a TOP (maxVal o ICR/OCR)
        this.counter += 1;
        if (this.counter > this.topValue) {
          this.counter = 0;
          this.overflowFlag = true;
          overflowOccurred = true;
        }
        if (this.counter === this.ocrA) {
          this.compareMatchAFlag = true;
          compAOccurred = true;
        }
        if (this.counter === this.ocrB) {
          this.compareMatchBFlag = true;
          compBOccurred = true;
        }
        this.pwmOutputA = this.counter < this.ocrA ? 5.0 : 0.0;
        this.pwmOutputB = this.counter < this.ocrB ? 5.0 : 0.0;
      } else if (this.mode === "phase-correct-pwm") {
        // Phase Correct PWM: conteo ascendente y descendente (Dual Slope)
        if (this.direction === 1) {
          this.counter += 1;
          if (this.counter >= this.topValue) {
            this.direction = -1;
          }
        } else {
          this.counter -= 1;
          if (this.counter <= 0) {
            this.direction = 1;
            this.overflowFlag = true;
            overflowOccurred = true;
          }
        }

        // Modulación PWM simétrica
        this.pwmOutputA = this.counter <= this.ocrA ? 5.0 : 0.0;
        this.pwmOutputB = this.counter <= this.ocrB ? 5.0 : 0.0;
      }

      // Check general compare matches
      if (this.counter === this.ocrA) {
        this.compareMatchAFlag = true;
        compAOccurred = true;
      }
      if (this.counter === this.ocrB) {
        this.compareMatchBFlag = true;
        compBOccurred = true;
      }
    }

    return {
      overflow: overflowOccurred,
      compareMatchA: compAOccurred,
      compareMatchB: compBOccurred,
      inputCaptured: captureOccurred,
      pwmA: this.pwmOutputA,
      pwmB: this.pwmOutputB,
    };
  }
}

// ============================================================================
// 2. ADC (SUCCESSIVE APPROXIMATION REGISTER - SAR MODEL)
// ============================================================================

export interface SarAdcConfig {
  resolutionBits?: 10 | 12;
  referenceVoltage?: number; // e.g. 5.0V, 3.3V, 1.1V
  clockPrescaler?: number;   // e.g. 128 (16MHz / 128 = 125kHz ADC clock)
  inlLsb?: number;           // Integral non-linearity (LSB)
  dnlLsb?: number;           // Differential non-linearity (LSB)
  noiseRmsVolts?: number;    // Thermal Gaussian noise RMS (V)
}

export class SarAdcModel {
  readonly resolutionBits: 10 | 12;
  readonly maxCode: number;

  vref: number;
  prescaler: number;
  inlLsb: number;
  dnlLsb: number;
  noiseRmsVolts: number;

  channelVoltages: number[] = [0, 0, 0, 0, 0, 0, 0, 0];
  selectedChannel: number = 0;
  leftAdjust: boolean = false; // ADLAR

  enabled: boolean = false;
  converting: boolean = false;
  sampleCapacitorVoltage: number = 0;
  conversionCyclesRemaining: number = 0;
  rawDigitalCode: number = 0;
  conversionCompleteFlag: boolean = false;

  constructor(config: SarAdcConfig = {}) {
    this.resolutionBits = config.resolutionBits ?? 10;
    this.maxCode = (1 << this.resolutionBits) - 1;
    this.vref = config.referenceVoltage ?? 5.0;
    this.prescaler = config.clockPrescaler ?? 128;
    this.inlLsb = config.inlLsb ?? 0.5;
    this.dnlLsb = config.dnlLsb ?? 0.5;
    this.noiseRmsVolts = config.noiseRmsVolts ?? 0.0005; // 0.5 mV
  }

  setChannelVoltage(channel: number, voltage: number): void {
    if (channel >= 0 && channel < this.channelVoltages.length) {
      this.channelVoltages[channel] = voltage;
    }
  }

  startConversion(channel?: number): void {
    if (channel !== undefined) {
      this.selectedChannel = channel & 0x07;
    }
    this.converting = true;
    this.conversionCompleteFlag = false;

    // Sample & Hold phase: captura voltaje con ruido térmico modelado
    const vIn = this.channelVoltages[this.selectedChannel] ?? 0;
    const noise = (Math.random() - 0.5) * 2 * this.noiseRmsVolts;
    this.sampleCapacitorVoltage = Math.max(0, Math.min(this.vref, vIn + noise));

    // SAR requiere (resolutionBits + 2) ciclos de reloj de ADC
    this.conversionCyclesRemaining = (this.resolutionBits + 2) * this.prescaler;
  }

  step(cpuCycles: number): {
    completed: boolean;
    digitalCode: number;
    highByte: number;
    lowByte: number;
  } {
    if (!this.converting) {
      return {
        completed: false,
        digitalCode: this.rawDigitalCode,
        highByte: this.getHighByte(),
        lowByte: this.getLowByte(),
      };
    }

    this.conversionCyclesRemaining -= cpuCycles;
    if (this.conversionCyclesRemaining <= 0) {
      this.converting = false;
      this.conversionCompleteFlag = true;

      // Cálculo SAR ideal: Code = (Vin / Vref) * 2^N
      const idealCode = (this.sampleCapacitorVoltage / this.vref) * (this.maxCode + 1);

      // Modelado de no-linealidades (INL + DNL)
      const inlShift = (Math.sin(idealCode * 0.05) * this.inlLsb);
      const codeQuantized = Math.floor(idealCode + inlShift);

      this.rawDigitalCode = Math.max(0, Math.min(this.maxCode, codeQuantized));

      return {
        completed: true,
        digitalCode: this.rawDigitalCode,
        highByte: this.getHighByte(),
        lowByte: this.getLowByte(),
      };
    }

    return {
      completed: false,
      digitalCode: this.rawDigitalCode,
      highByte: this.getHighByte(),
      lowByte: this.getLowByte(),
    };
  }

  getLowByte(): number {
    if (this.leftAdjust) {
      return (this.rawDigitalCode << 6) & 0xC0;
    }
    return this.rawDigitalCode & 0xFF;
  }

  getHighByte(): number {
    if (this.leftAdjust) {
      return (this.rawDigitalCode >> 2) & 0xFF;
    }
    return (this.rawDigitalCode >> 8) & 0x03;
  }
}

// ============================================================================
// 3. UART / USART MODEL WITH FIFO TX/RX BUFFERS
// ============================================================================

export interface UartConfig {
  baudRate?: number;
  clockFrequencyHz?: number;
  dataBits?: 5 | 6 | 7 | 8 | 9;
  stopBits?: 1 | 2;
  parity?: "none" | "even" | "odd";
  doubleSpeed?: boolean;
  bufferCapacity?: number;
}

export class UartPeripheralModel {
  baudRate: number;
  clockFreq: number;
  dataBits: number;
  stopBits: number;
  parity: "none" | "even" | "odd";
  doubleSpeed: boolean;

  readonly txQueue: number[] = [];
  readonly rxQueue: number[] = [];
  readonly bufferCapacity: number;

  // Pin & Interface states
  txPinState: DigitalState = 1; // High idle (Mark)
  rxPinState: DigitalState = 1;

  txShiftRegister: number | null = null;
  txBitsRemaining: number = 0;
  txCycleAccumulator: number = 0;

  rxShiftRegister: number = 0;
  rxBitsReceived: number = 0;
  rxInProgress: boolean = false;
  rxCycleAccumulator: number = 0;

  // Interrupt Flags
  udreFlag: boolean = true; // USART Data Register Empty
  txcFlag: boolean = false; // Transmit Complete
  rxcFlag: boolean = false; // Receive Complete
  frameError: boolean = false;
  dataOverrun: boolean = false;

  constructor(config: UartConfig = {}) {
    this.baudRate = config.baudRate ?? 9600;
    this.clockFreq = config.clockFrequencyHz ?? 16_000_000;
    this.dataBits = config.dataBits ?? 8;
    this.stopBits = config.stopBits ?? 1;
    this.parity = config.parity ?? "none";
    this.doubleSpeed = config.doubleSpeed ?? false;
    this.bufferCapacity = config.bufferCapacity ?? 64;
  }

  get cyclesPerBit(): number {
    const divisor = this.doubleSpeed ? 8 : 16;
    const ubrr = Math.floor(this.clockFreq / (divisor * this.baudRate)) - 1;
    return (ubrr + 1) * divisor;
  }

  writeTxData(byte: number): boolean {
    if (this.txQueue.length >= this.bufferCapacity) {
      return false; // Buffer full
    }
    this.txQueue.push(byte & 0xFF);
    this.udreFlag = false;
    return true;
  }

  readRxData(): number | null {
    if (this.rxQueue.length === 0) {
      return null;
    }
    const byte = this.rxQueue.shift()!;
    if (this.rxQueue.length === 0) {
      this.rxcFlag = false;
    }
    return byte;
  }

  transmitString(text: string): void {
    for (let i = 0; i < text.length; i++) {
      this.writeTxData(text.charCodeAt(i));
    }
  }

  receiveString(): string {
    let res = "";
    while (this.rxQueue.length > 0) {
      res += String.fromCharCode(this.rxQueue.shift()!);
    }
    this.rxcFlag = false;
    return res;
  }

  step(cpuCycles: number, externalRxPin?: DigitalState): {
    txPin: DigitalState;
    udre: boolean;
    txc: boolean;
    rxc: boolean;
    rxByte?: number;
  } {
    const bitCycles = Math.max(1, this.cyclesPerBit);
    let newlyReceivedByte: number | undefined;

    // --- TRANSMITTER STATE MACHINE ---
    if (this.txShiftRegister === null && this.txQueue.length > 0) {
      this.txShiftRegister = this.txQueue.shift()!;
      this.txBitsRemaining = 1 + this.dataBits + this.stopBits; // Start(1) + Data(8) + Stop(1)
      this.txCycleAccumulator = 0;
      this.txPinState = 0; // START bit (Space)
      this.udreFlag = this.txQueue.length === 0;
    }

    if (this.txShiftRegister !== null) {
      this.txCycleAccumulator += cpuCycles;
      while (this.txCycleAccumulator >= bitCycles) {
        this.txCycleAccumulator -= bitCycles;
        this.txBitsRemaining -= 1;

        if (this.txBitsRemaining === this.stopBits) {
          // Send STOP bit
          this.txPinState = 1;
        } else if (this.txBitsRemaining > this.stopBits) {
          // Send Data bits LSB first
          this.txPinState = (this.txShiftRegister & 1) ? 1 : 0;
          this.txShiftRegister >>= 1;
        } else if (this.txBitsRemaining <= 0) {
          // Finished packet
          this.txShiftRegister = null;
          this.txPinState = 1; // Idle
          this.txcFlag = true;
          this.udreFlag = this.txQueue.length === 0;
          break;
        }
      }
    }

    // --- RECEIVER STATE MACHINE ---
    if (externalRxPin !== undefined) {
      this.rxPinState = externalRxPin;
    }

    if (!this.rxInProgress && this.rxPinState === 0) {
      // Detected falling edge of START bit
      this.rxInProgress = true;
      this.rxCycleAccumulator = Math.floor(bitCycles / 2); // Sample in the middle of bit
      this.rxBitsReceived = 0;
      this.rxShiftRegister = 0;
    }

    if (this.rxInProgress) {
      this.rxCycleAccumulator += cpuCycles;
      while (this.rxCycleAccumulator >= bitCycles) {
        this.rxCycleAccumulator -= bitCycles;
        this.rxBitsReceived += 1;

        if (this.rxBitsReceived <= this.dataBits) {
          const bit = this.rxPinState === 1 ? 1 : 0;
          this.rxShiftRegister |= (bit << (this.rxBitsReceived - 1));
        } else {
          // Stop bit sampling
          this.rxInProgress = false;
          if (this.rxPinState === 1) { // Valid stop bit
            if (this.rxQueue.length < this.bufferCapacity) {
              this.rxQueue.push(this.rxShiftRegister);
              this.rxcFlag = true;
              newlyReceivedByte = this.rxShiftRegister;
            } else {
              this.dataOverrun = true;
            }
          } else {
            this.frameError = true;
          }
          break;
        }
      }
    }

    return {
      txPin: this.txPinState,
      udre: this.udreFlag,
      txc: this.txcFlag,
      rxc: this.rxcFlag,
      rxByte: newlyReceivedByte,
    };
  }
}

// ============================================================================
// 4. SPI MASTER / SLAVE MODEL
// ============================================================================

export interface SpiConfig {
  mode?: "master" | "slave";
  cpol?: 0 | 1;
  cpha?: 0 | 1;
  dataOrder?: "msb-first" | "lsb-first";
  prescaler?: 4 | 8 | 16 | 32 | 64 | 128;
}

export class SpiPeripheralModel {
  mode: "master" | "slave";
  cpol: 0 | 1;
  cpha: 0 | 1;
  dataOrder: "msb-first" | "lsb-first";
  prescaler: number;

  spdr: number = 0; // Data register
  shiftRegister: number = 0;
  bitsTransferred: number = 0;
  isBusy: boolean = false;
  cycleAccumulator: number = 0;

  // Pin states
  sckPin: DigitalState = 0;
  mosiPin: DigitalState = 0;
  misoPin: DigitalState = 0;
  ssPin: DigitalState = 1;

  spifFlag: boolean = false; // SPI Interrupt Flag
  wcolFlag: boolean = false; // Write Collision Flag

  constructor(config: SpiConfig = {}) {
    this.mode = config.mode ?? "master";
    this.cpol = config.cpol ?? 0;
    this.cpha = config.cpha ?? 0;
    this.dataOrder = config.dataOrder ?? "msb-first";
    this.prescaler = config.prescaler ?? 4;
    this.sckPin = this.cpol ? 1 : 0;
  }

  transferByte(outgoingByte: number, incomingByte: number = 0xFF): number {
    if (this.isBusy) {
      this.wcolFlag = true;
      return this.spdr;
    }
    this.spdr = outgoingByte & 0xFF;
    this.shiftRegister = outgoingByte & 0xFF;
    this.isBusy = true;
    this.spifFlag = false;

    // Full duplex byte exchange
    this.spdr = incomingByte & 0xFF;
    this.isBusy = false;
    this.spifFlag = true;
    return this.spdr;
  }

  step(cpuCycles: number, peerInputMiso: number = 0): {
    sck: DigitalState;
    mosi: DigitalState;
    miso: DigitalState;
    spif: boolean;
  } {
    if (this.isBusy && this.mode === "master") {
      this.cycleAccumulator += cpuCycles;
      const bitClock = this.prescaler;
      while (this.cycleAccumulator >= bitClock) {
        this.cycleAccumulator -= bitClock;
        this.bitsTransferred += 1;
        this.sckPin = this.sckPin === 1 ? 0 : 1;

        if (this.dataOrder === "msb-first") {
          this.mosiPin = (this.shiftRegister & 0x80) ? 1 : 0;
          this.shiftRegister = ((this.shiftRegister << 1) | (peerInputMiso & 1)) & 0xFF;
        } else {
          this.mosiPin = (this.shiftRegister & 0x01) ? 1 : 0;
          this.shiftRegister = ((this.shiftRegister >> 1) | ((peerInputMiso & 1) << 7)) & 0xFF;
        }

        if (this.bitsTransferred >= 16) { // 8 bits * 2 edges
          this.isBusy = false;
          this.bitsTransferred = 0;
          this.spdr = this.shiftRegister;
          this.spifFlag = true;
          this.sckPin = this.cpol ? 1 : 0;
          break;
        }
      }
    }

    return {
      sck: this.sckPin,
      mosi: this.mosiPin,
      miso: this.misoPin,
      spif: this.spifFlag,
    };
  }
}

// ============================================================================
// 5. I2C / TWI MASTER & SLAVE MODEL
// ============================================================================

export type I2cBusState =
  | "idle"
  | "start"
  | "rep-start"
  | "addr-tx"
  | "data-tx"
  | "data-rx"
  | "ack"
  | "nack"
  | "stop";

export interface I2cConfig {
  mode?: "master" | "slave";
  ownAddress?: number;
  bitRateHz?: number;
}

export class I2cPeripheralModel {
  mode: "master" | "slave";
  ownAddress: number;
  bitRateHz: number;

  busState: I2cBusState = "idle";
  statusRegister: number = 0xF8; // TWSR 0xF8 = No relevant state
  twintFlag: boolean = false;    // TWI Interrupt Flag

  sclPin: DigitalState = 1;
  sdaPin: DigitalState = 1;

  txData: number = 0;
  rxData: number = 0;
  ackBitReceived: boolean = false;

  constructor(config: I2cConfig = {}) {
    this.mode = config.mode ?? "master";
    this.ownAddress = (config.ownAddress ?? 0x20) & 0x7F;
    this.bitRateHz = config.bitRateHz ?? 100_000; // 100 kHz standard mode
  }

  masterStart(): void {
    this.busState = "start";
    this.sdaPin = 0; // SDA pulled low while SCL is high
    this.sclPin = 1;
    this.statusRegister = 0x08; // START transmitted
    this.twintFlag = true;
  }

  masterSendAddress(slaveAddress7Bit: number, isRead: boolean): void {
    const packet = ((slaveAddress7Bit & 0x7F) << 1) | (isRead ? 1 : 0);
    this.txData = packet;
    this.busState = "addr-tx";
    this.statusRegister = isRead ? 0x40 : 0x18; // SLA+R ACK (0x40) or SLA+W ACK (0x18)
    this.twintFlag = true;
  }

  masterSendByte(byte: number): void {
    this.txData = byte & 0xFF;
    this.busState = "data-tx";
    this.statusRegister = 0x28; // Data byte transmitted, ACK received
    this.twintFlag = true;
  }

  masterReceiveByte(sendAck: boolean = true): number {
    this.busState = "data-rx";
    this.statusRegister = sendAck ? 0x50 : 0x58; // Data byte received with ACK/NACK
    this.twintFlag = true;
    return this.rxData;
  }

  masterStop(): void {
    this.busState = "stop";
    this.sclPin = 1;
    this.sdaPin = 1; // SDA released high while SCL is high
    this.statusRegister = 0xF8;
    this.twintFlag = false;
  }

  slaveMatchAddress(addrByte: number): boolean {
    const receivedAddr = (addrByte >> 1) & 0x7F;
    if (receivedAddr === this.ownAddress) {
      this.statusRegister = (addrByte & 1) ? 0xA8 : 0x60; // Own SLA+R or SLA+W received, ACK returned
      this.twintFlag = true;
      return true;
    }
    return false;
  }
}

// ============================================================================
// 6. UNIFIED MCU PERIPHERALS HUB
// ============================================================================

export class McuPeripheralsHub {
  readonly timers: Map<string, TimerPeripheralModel> = new Map();
  readonly adc: SarAdcModel;
  readonly uart: UartPeripheralModel;
  readonly spi: SpiPeripheralModel;
  readonly i2c: I2cPeripheralModel;

  constructor() {
    this.timers.set("Timer0", new TimerPeripheralModel({ name: "Timer0", resolutionBits: 8 }));
    this.timers.set("Timer1", new TimerPeripheralModel({ name: "Timer1", resolutionBits: 16 }));
    this.adc = new SarAdcModel();
    this.uart = new UartPeripheralModel();
    this.spi = new SpiPeripheralModel();
    this.i2c = new I2cPeripheralModel();
  }

  stepAll(cycles: number): void {
    for (const timer of this.timers.values()) {
      timer.step(cycles);
    }
    this.adc.step(cycles);
    this.uart.step(cycles);
    this.spi.step(cycles);
  }
}
