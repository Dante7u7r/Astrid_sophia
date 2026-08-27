import { describe, expect, it } from "vitest";
import {
  compileEsp32Sketch,
  createEsp32Runtime,
  getEsp32DevKitPinVoltages,
  stepEsp32,
} from "./esp32_runtime";

describe("esp32_runtime (ESP32 C++/Arduino Execution Engine)", () => {
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
});
