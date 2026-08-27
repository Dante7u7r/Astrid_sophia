// ==========================================================================
// ESP32 HARDWARE RUNTIME & ARDUINO C++ EXECUTION ENGINE
// ==========================================================================

export type Esp32PinMode = "INPUT" | "OUTPUT" | "INPUT_PULLUP" | "INPUT_PULLDOWN";

export interface LedcChannel {
  channel: number;
  freq: number;
  resolutionBits: number;
  duty: number; // 0 a (2^res - 1)
  attachedPin: number | null; // GPIO number
}

export interface Esp32RuntimeState {
  // 1. Estado de los GPIO (por número de GPIO)
  pinModes: Record<number, Esp32PinMode>;
  digitalOutputs: Record<number, number>; // 0 o 1
  analogInputs: Record<number, number>; // 0 a 4095 (12 bits)
  dacOutputs: Record<number, number>; // 0 a 255 (8 bits en GPIO25/26)

  // 2. Controlador PWM LEDC (16 canales)
  ledcChannels: LedcChannel[];

  // 3. Monitor Serie (UART0)
  serialTxBuffer: string[];
  serialRxBuffer: string[];
  baudRate: number;

  // 4. Temporizadores y estado de simulación
  timeMicros: number;
  lastLoopMicros: number;
  loopIntervalMicros: number;
  isRunning: boolean;
  hasSetupRun: boolean;

  // 5. Código fuente y funciones de usuario compiladas
  sourceCode: string;
  setupFn: (() => void) | null;
  loopFn: (() => void) | null;
  errorMessage: string | null;
}

// Mapeo de número de Pin físico del DevKit (0..29) a número de GPIO
export const DEVKIT_INDEX_TO_GPIO: Record<number, number | null> = {
  0: null, // 3V3
  1: null, // EN
  2: 36,   // VP / IO36
  3: 39,   // VN / IO39
  4: 34,   // IO34
  5: 35,   // IO35
  6: 32,   // IO32
  7: 33,   // IO33
  8: 25,   // IO25 (DAC1)
  9: 26,   // IO26 (DAC2)
  10: 27,  // IO27
  11: 14,  // IO14
  12: 12,  // IO12
  13: null,// GND
  14: 13,  // IO13

  15: null,// VIN
  16: null,// GND
  17: 23,  // IO23
  18: 22,  // IO22
  19: 1,   // TX0 / IO1
  20: 3,   // RX0 / IO3
  21: 21,  // IO21
  22: null,// GND
  23: 19,  // IO19
  24: 18,  // IO18
  25: 5,   // IO5
  26: 17,  // IO17
  27: 16,  // IO16
  28: 4,   // IO4
  29: 2,   // IO2 (LED Onboard)
};

export function createEsp32Runtime(initialCode?: string): Esp32RuntimeState {
  const ledcChannels: LedcChannel[] = [];
  for (let i = 0; i < 16; i++) {
    ledcChannels.push({
      channel: i,
      freq: 5000,
      resolutionBits: 8,
      duty: 0,
      attachedPin: null,
    });
  }

  const defaultSketch = initialCode || `
// Sketch ESP32 Arduino - Blink & Serial Telemetry
int ledPin = 2; // LED Onboard
int sensorPin = 34; // Entrada analógica

void setup() {
  pinMode(ledPin, OUTPUT);
  Serial.begin(115200);
  Serial.println("ESP32 Inicializado correctamente.");
}

void loop() {
  digitalWrite(ledPin, HIGH);
  int val = analogRead(sensorPin);
  Serial.print("Lectura Sensor: ");
  Serial.println(val);
  delay(500);
  
  digitalWrite(ledPin, LOW);
  delay(500);
}
`;

  const state: Esp32RuntimeState = {
    pinModes: {},
    digitalOutputs: {},
    analogInputs: {},
    dacOutputs: {},
    ledcChannels,
    serialTxBuffer: [],
    serialRxBuffer: [],
    baudRate: 115200,
    timeMicros: 0,
    lastLoopMicros: 0,
    loopIntervalMicros: 10000, // 10ms por iteración de loop por defecto
    isRunning: true,
    hasSetupRun: false,
    sourceCode: defaultSketch,
    setupFn: null,
    loopFn: null,
    errorMessage: null,
  };

  compileEsp32Sketch(state, defaultSketch);
  return state;
}

/**
 * Transpila y compila un sketch Arduino/C++ a funciones ejecutables en el sandbox de hardware ESP32.
 */
export function compileEsp32Sketch(state: Esp32RuntimeState, code: string): boolean {
  state.sourceCode = code;
  state.errorMessage = null;
  state.hasSetupRun = false;

  try {
    // 1. Limpieza de tipos de C++ para permitir ejecución JS segura
    let jsCode = code
      .replace(/\bint\s+/g, "let ")
      .replace(/\bfloat\s+/g, "let ")
      .replace(/\bdouble\s+/g, "let ")
      .replace(/\bchar\s+/g, "let ")
      .replace(/\bbool\s+/g, "let ")
      .replace(/\bboolean\s+/g, "let ")
      .replace(/\bString\s+/g, "let ")
      .replace(/\bunsigned\s+int\s+/g, "let ")
      .replace(/\bunsigned\s+long\s+/g, "let ")
      .replace(/\blong\s+/g, "let ")
      .replace(/\bvoid\s+setup\s*\(\s*\)/g, "function setup()")
      .replace(/\bvoid\s+loop\s*\(\s*\)/g, "function loop()")
      .replace(/\bconst\s+let\s+/g, "const ");

    // 2. Creación del Sandbox con APIs de Hardware de Espressif
    const sandboxFactory = new Function(
      "api",
      `
      with (api) {
        ${jsCode}
        return {
          setup: typeof setup === 'function' ? setup : null,
          loop: typeof loop === 'function' ? loop : null
        };
      }
    `,
    );

    const api = {
      // Constantes estándar
      HIGH: 1,
      LOW: 0,
      INPUT: "INPUT",
      OUTPUT: "OUTPUT",
      INPUT_PULLUP: "INPUT_PULLUP",
      INPUT_PULLDOWN: "INPUT_PULLDOWN",

      // GPIO Digital
      pinMode: (pin: number, mode: Esp32PinMode) => {
        state.pinModes[pin] = mode;
      },
      digitalWrite: (pin: number, val: number) => {
        state.digitalOutputs[pin] = val ? 1 : 0;
      },
      digitalRead: (pin: number): number => {
        return state.digitalOutputs[pin] ?? 0;
      },

      // Convertidor ADC (12 bits: 0 a 4095)
      analogRead: (pin: number): number => {
        return state.analogInputs[pin] ?? 0;
      },

      // Convertidor DAC (8 bits: 0 a 255 en GPIO25/26)
      dacWrite: (pin: number, val: number) => {
        state.dacOutputs[pin] = Math.max(0, Math.min(255, Math.round(val)));
      },

      // Controlador PWM LEDC
      ledcSetup: (channel: number, freq: number, resolutionBits: number) => {
        if (state.ledcChannels[channel]) {
          state.ledcChannels[channel].freq = freq;
          state.ledcChannels[channel].resolutionBits = resolutionBits;
        }
      },
      ledcAttachPin: (pin: number, channel: number) => {
        if (state.ledcChannels[channel]) {
          state.ledcChannels[channel].attachedPin = pin;
          state.pinModes[pin] = "OUTPUT";
        }
      },
      ledcWrite: (channel: number, duty: number) => {
        if (state.ledcChannels[channel]) {
          state.ledcChannels[channel].duty = duty;
        }
      },

      // Monitor Serie
      Serial: {
        begin: (baud: number) => {
          state.baudRate = baud;
        },
        print: (msg: any) => {
          const str = String(msg);
          state.serialTxBuffer.push(str);
        },
        println: (msg: any = "") => {
          const str = String(msg) + "\n";
          state.serialTxBuffer.push(str);
        },
        available: () => state.serialRxBuffer.length,
        read: () => {
          if (state.serialRxBuffer.length === 0) return -1;
          const char = state.serialRxBuffer.shift();
          return char ? char.charCodeAt(0) : -1;
        },
      },

      // Temporizadores y Delays
      millis: () => Math.floor(state.timeMicros / 1000),
      micros: () => Math.floor(state.timeMicros),
      delay: (ms: number) => {
        // En simulación paced no bloqueamos el hilo principal
        state.timeMicros += ms * 1000;
      },
      delayMicroseconds: (us: number) => {
        state.timeMicros += us;
      },

      // Funciones matemáticas Arduino
      map: (val: number, in_min: number, in_max: number, out_min: number, out_max: number) => {
        return ((val - in_min) * (out_max - out_min)) / (in_max - in_min) + out_min;
      },
      constrain: (val: number, minVal: number, maxVal: number) => {
        return Math.max(minVal, Math.min(maxVal, val));
      },
      sq: (val: number) => val * val,
    };

    const compiled = sandboxFactory(api);
    state.setupFn = compiled.setup;
    state.loopFn = compiled.loop;
    return true;
  } catch (err: any) {
    state.errorMessage = err?.message || String(err);
    state.setupFn = null;
    state.loopFn = null;
    return false;
  }
}

/**
 * Avanza el estado del hardware del ESP32 un intervalo de tiempo dtSeconds.
 */
export function stepEsp32(
  state: Esp32RuntimeState,
  dtSeconds: number,
  analogVoltages: Record<number, number> = {},
): void {
  if (!state.isRunning) return;

  state.timeMicros += Math.round(dtSeconds * 1e6);

  // 1. Actualizar entradas analógicas ADC de los pines (0 a 3.3V -> 0 a 4095)
  for (const [gpioStr, v] of Object.entries(analogVoltages)) {
    const gpio = Number(gpioStr);
    const adcVal = Math.max(0, Math.min(4095, Math.round((v / 3.3) * 4095)));
    state.analogInputs[gpio] = adcVal;
  }

  // 2. Ejecutar setup() si aún no ha corrido
  if (!state.hasSetupRun && state.setupFn) {
    try {
      state.setupFn();
      state.hasSetupRun = true;
    } catch (e: any) {
      state.errorMessage = `Error en setup(): ${e?.message || e}`;
    }
  }

  // 3. Ejecutar loop()
  if (state.hasSetupRun && state.loopFn) {
    try {
      state.loopFn();
    } catch (e: any) {
      state.errorMessage = `Error en loop(): ${e?.message || e}`;
    }
  }
}

/**
 * Obtiene la tensión analógica calculada para cada pin físico del módulo DevKit (0 a 29).
 */
export function getEsp32DevKitPinVoltages(state: Esp32RuntimeState): Record<number, number> {
  const voltages: Record<number, number> = {
    0: 3.3,  // Pin 3V3
    13: 0.0, // GND
    15: 5.0, // VIN
    16: 0.0, // GND
    22: 0.0, // GND
  };

  for (let pinIdx = 0; pinIdx < 30; pinIdx++) {
    const gpio = DEVKIT_INDEX_TO_GPIO[pinIdx];
    if (gpio === null || gpio === undefined) continue;

    // Verificar si el pin tiene salida DAC activa (GPIO25/GPIO26)
    if ((gpio === 25 || gpio === 26) && state.dacOutputs[gpio] !== undefined) {
      voltages[pinIdx] = (state.dacOutputs[gpio] / 255.0) * 3.3;
      continue;
    }

    // Verificar si el pin está asignado a un canal PWM LEDC
    const ledc = state.ledcChannels.find((c) => c.attachedPin === gpio);
    if (ledc && ledc.duty > 0) {
      const maxDuty = Math.pow(2, ledc.resolutionBits) - 1;
      const dutyFraction = Math.min(1.0, ledc.duty / maxDuty);
      voltages[pinIdx] = dutyFraction * 3.3;
      continue;
    }

    // Salida Digital estándar
    if (state.pinModes[gpio] === "OUTPUT") {
      const isHigh = state.digitalOutputs[gpio] === 1;
      voltages[pinIdx] = isHigh ? 3.3 : 0.0;
    } else if (state.pinModes[gpio] === "INPUT_PULLUP") {
      voltages[pinIdx] = 3.3;
    } else {
      voltages[pinIdx] = 0.0;
    }
  }

  return voltages;
}
