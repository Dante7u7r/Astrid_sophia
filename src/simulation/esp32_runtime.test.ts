import { describe, expect, it } from "vitest";
import {
  compileEsp32Sketch,
  createEsp32Runtime,
  getEsp32DevKitPinVoltages,
  stepEsp32,
} from "./esp32_runtime";

describe("esp32_runtime (intérprete Arduino restringido)", () => {
  it("compila y ejecuta sketch de parpadeo (Blink) en GPIO 2", () => {
    const sketch = `
      int led = 2;
      void setup() {
        pinMode(led, OUTPUT);
        digitalWrite(led, HIGH);
      }
      void loop() {}
    `;

    const esp32 = createEsp32Runtime(sketch);
    expect(esp32.setupFn).toBeDefined();

    stepEsp32(esp32, 0.01);
    expect(esp32.digitalOutputs[2]).toBe(1);

    const pinVoltages = getEsp32DevKitPinVoltages(esp32);
    expect(pinVoltages[29]).toBe(3.3); // Pin 29 es IO2
  });

  it("configura canal LEDC PWM y genera tensión fraccional correspondiente al ciclo de trabajo", () => {
    const sketch = `
      void setup() {
        ledcSetup(0, 5000, 8); // 8 bits (0-255)
        ledcAttachPin(4, 0); // GPIO 4 (Pin DevKit 28)
        ledcWrite(0, 128); // ~50% duty
      }
      void loop() {}
    `;

    const esp32 = createEsp32Runtime(sketch);
    stepEsp32(esp32, 0.01);

    const pinVoltages = getEsp32DevKitPinVoltages(esp32);
    // 128 / 255 * 3.3 ≈ 1.656 V
    expect(pinVoltages[28]).toBeCloseTo(1.65, 1);
  });

  it("escribe en el conversor DAC de 8 bits en GPIO 25 (Pin DevKit 8)", () => {
    const sketch = `
      void setup() {
        dacWrite(25, 255); // 3.3V máximo
      }
      void loop() {}
    `;

    const esp32 = createEsp32Runtime(sketch);
    stepEsp32(esp32, 0.01);

    const pinVoltages = getEsp32DevKitPinVoltages(esp32);
    expect(pinVoltages[8]).toBe(3.3);
  });

  it("lee entradas analógicas ADC de 12 bits (0 a 4095) en GPIO 34", () => {
    const sketch = `
      int readVal = 0;
      void setup() {}
      void loop() {
        readVal = analogRead(34);
      }
    `;

    const esp32 = createEsp32Runtime(sketch);
    // Simular tensión de 1.65V en GPIO34 (~50% de 3.3V -> ~2048)
    stepEsp32(esp32, 0.01, { 34: 1.65 });

    expect(esp32.analogInputs[34]).toBeCloseTo(2048, -2);
  });

  it("transmite mensajes a través de Serial.print y Serial.println", () => {
    const sketch = `
      void setup() {
        Serial.begin(115200);
        Serial.print("TEST_");
        Serial.println("OK");
      }
      void loop() {}
    `;

    const esp32 = createEsp32Runtime(sketch);
    stepEsp32(esp32, 0.01);

    expect(esp32.serialTxBuffer.join("")).toContain("TEST_OK\n");
  });

  it("rechaza APIs y objetos globales que no estén en la lista permitida", () => {
    const sketch = `
      void setup() {
        globalThis.pwned(1);
      }
      void loop() {}
    `;
    const esp32 = createEsp32Runtime();

    expect(compileEsp32Sketch(esp32, sketch)).toBe(false);
    expect(esp32.isRunning).toBe(false);
    expect(esp32.errorMessage).toContain("API no soportada: globalThis.pwned");
  });

  it("rechaza bloques de control que el subconjunto no implementa", () => {
    const sketch = `
      void setup() {}
      void loop() {
        for (int i = 0; i < 10; i++) {
          digitalWrite(2, HIGH);
        }
      }
    `;
    const esp32 = createEsp32Runtime();

    expect(compileEsp32Sketch(esp32, sketch)).toBe(false);
    expect(esp32.errorMessage).toContain("if, for, while");
  });

  it("interpreta aritmética, cast y funciones matemáticas sin ejecutar JavaScript del usuario", () => {
    const sketch = `
      int step = 90;
      void setup() {}
      void loop() {
        int dacVal = (int)(127.5 + 127.5 * sin(step * PI / 180));
        dacWrite(25, dacVal);
      }
    `;
    const esp32 = createEsp32Runtime(sketch);

    stepEsp32(esp32, 0.001);

    expect(esp32.errorMessage).toBeNull();
    expect(esp32.dacOutputs[25]).toBe(255);
  });

  it("detiene el runtime después de un error de ejecución", () => {
    const sketch = `
      void setup() {
        int invalid = 1 / 0;
      }
      void loop() {
        digitalWrite(2, HIGH);
      }
    `;
    const esp32 = createEsp32Runtime(sketch);

    stepEsp32(esp32, 0.001);

    expect(esp32.isRunning).toBe(false);
    expect(esp32.hasSetupRun).toBe(false);
    expect(esp32.digitalOutputs[2]).toBeUndefined();
    expect(esp32.errorMessage).toContain("División entre cero");
  });
});
