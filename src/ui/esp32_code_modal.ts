// ==========================================================================
// ESP32 CODE EDITOR & LIVE SERIAL MONITOR MODAL
// ==========================================================================

import type { ComponentInstance } from "../canvas_orchestrator";
import {
  compileEsp32Sketch,
  getOrCreateEsp32Runtime,
} from "../simulation/esp32_runtime";

let activeModal: HTMLElement | null = null;
let serialPollingInterval: ReturnType<typeof setInterval> | null = null;

const CODE_PRESETS: Record<string, string> = {
  blink: `// 1. Blink LED Onboard (IO2)
int ledPin = 2;

void setup() {
  pinMode(ledPin, OUTPUT);
  Serial.begin(115200);
  Serial.println("ESP32: Blink iniciado en IO2.");
}

void loop() {
  digitalWrite(ledPin, HIGH);
  Serial.println("LED ON (3.3V)");
  delay(500);

  digitalWrite(ledPin, LOW);
  Serial.println("LED OFF (0V)");
  delay(500);
}`,

  dac_sine: `// 2. Generador Senoidal con DAC (IO25)
int dacPin = 25;
int step = 0;

void setup() {
  Serial.begin(115200);
  Serial.println("ESP32: DAC Senoidal en IO25.");
}

void loop() {
  float rad = (step * 3.14159) / 180.0;
  int dacVal = (int)(127.5 + 127.5 * sin(rad));
  dacWrite(dacPin, dacVal);

  step = (step + 10) % 360;
  delay(20);
}`,

  pwm_ledc: `// 3. Control de Brillo PWM (LEDC en IO4)
int pwmPin = 4;
int ledcChannel = 0;
int duty = 0;

void setup() {
  Serial.begin(115200);
  ledcSetup(ledcChannel, 5000, 8); // 5 kHz, 8 bits (0-255)
  ledcAttachPin(pwmPin, ledcChannel);
  Serial.println("ESP32: PWM LEDC configurado en IO4.");
}

void loop() {
  ledcWrite(ledcChannel, duty);
  duty = (duty + 15) % 256;
  delay(50);
}`,

  adc_telemetry: `// 4. Lectura Analógica ADC (IO34) y Telemetría
int sensorPin = 34;

void setup() {
  Serial.begin(115200);
  Serial.println("ESP32: ADC Telemetry en IO34.");
}

void loop() {
  int rawAdc = analogRead(sensorPin);
  float voltage = (rawAdc / 4095.0) * 3.3;

  Serial.print("ADC: ");
  Serial.print(rawAdc);
  Serial.print(" | Tension: ");
  Serial.print(voltage);
  Serial.println(" V");

  delay(200);
}`,
};

export function openEsp32CodeModal(
  comp: ComponentInstance,
  onCodeUpdated?: (newCode: string) => void,
): void {
  closeEsp32CodeModal();

  const runtime = getOrCreateEsp32Runtime(comp, comp.esp32SourceCode);

  const modal = document.createElement("div");
  modal.className = "esp32-modal-overlay";
  modal.style.cssText = `
    position: fixed;
    top: 0;
    left: 0;
    width: 100vw;
    height: 100vh;
    background: rgba(0, 0, 0, 0.78);
    backdrop-filter: blur(8px);
    display: flex;
    align-items: center;
    justify-content: center;
    z-index: 9999;
    font-family: 'Inter', system-ui, sans-serif;
  `;

  const container = document.createElement("div");
  container.style.cssText = `
    background: #0f172a;
    border: 1px solid rgba(56, 189, 248, 0.35);
    border-radius: 12px;
    width: 92%;
    max-width: 860px;
    height: 85vh;
    display: flex;
    flex-direction: column;
    box-shadow: 0 25px 50px rgba(0, 0, 0, 0.75);
    overflow: hidden;
    color: #f8fafc;
  `;

  container.innerHTML = `
    <div style="padding: 14px 20px; background: rgba(30, 41, 59, 0.85); border-bottom: 1px solid rgba(255, 255, 255, 0.1); display: flex; justify-content: space-between; align-items: center;">
      <div style="display: flex; align-items: center; gap: 10px;">
        <span style="font-size: 20px;">⚡</span>
        <div>
          <h3 style="margin: 0; font-size: 15px; font-weight: 700; color: #38bdf8;">ESP32 DevKit V1 — Intérprete Arduino & Monitor Serie</h3>
          <p style="margin: 2px 0 0 0; font-size: 11px; color: #94a3b8;">Subconjunto educativo seguro: sentencias escalares, GPIO, ADC, DAC, LEDC y Serial; sin if/for/while</p>
        </div>
      </div>
      <button id="close-esp32-btn" style="background: transparent; border: none; color: #94a3b8; font-size: 20px; cursor: pointer; padding: 4px 8px;">✕</button>
    </div>

    <!-- Barra de Herramientas de Código -->
    <div style="padding: 10px 20px; background: rgba(15, 23, 42, 0.95); border-bottom: 1px solid rgba(255, 255, 255, 0.08); display: flex; justify-content: space-between; align-items: center; gap: 12px; flex-wrap: wrap;">
      <div style="display: flex; align-items: center; gap: 8px;">
        <span style="font-size: 12px; color: #94a3b8;">Plantillas:</span>
        <select id="preset-select" style="background: #1e293b; border: 1px solid rgba(255, 255, 255, 0.2); color: #f8fafc; font-size: 11px; padding: 4px 8px; border-radius: 4px; outline: none;">
          <option value="blink">1. Blink LED Onboard (IO2)</option>
          <option value="dac_sine">2. Generador Senoidal DAC (IO25)</option>
          <option value="pwm_ledc">3. Control Brillo PWM LEDC (IO4)</option>
          <option value="adc_telemetry">4. Telemetría ADC (IO34)</option>
        </select>
      </div>

      <button id="compile-run-btn" style="background: #0284c7; border: none; color: #ffffff; font-size: 12px; font-weight: 600; padding: 6px 16px; border-radius: 6px; cursor: pointer; display: flex; align-items: center; gap: 6px;">
        <span>▶️</span> Validar y ejecutar
      </button>
    </div>

    <!-- Panel Dividido: Editor de Código (Izquierda) + Monitor Serie (Derecha) -->
    <div style="display: flex; flex: 1; overflow: hidden;">
      <!-- Editor de Código -->
      <div style="flex: 1.2; display: flex; flex-direction: column; border-right: 1px solid rgba(255, 255, 255, 0.1);">
        <textarea id="esp32-code-area" spellcheck="false" style="flex: 1; background: #020617; color: #a5f3fc; border: none; padding: 14px; font-family: 'JetBrains Mono', 'Fira Code', monospace; font-size: 12px; line-height: 1.5; resize: none; outline: none;"></textarea>
        <div id="compiler-status" style="padding: 6px 12px; background: rgba(30, 41, 59, 0.6); font-size: 11px; color: #10b981; border-top: 1px solid rgba(255, 255, 255, 0.08);">
          Listo para validar el subconjunto soportado
        </div>
      </div>

      <!-- Monitor Serie UART0 -->
      <div style="flex: 0.8; display: flex; flex-direction: column; background: #0b1120;">
        <div style="padding: 8px 12px; background: rgba(30, 41, 59, 0.7); border-bottom: 1px solid rgba(255, 255, 255, 0.08); display: flex; justify-content: space-between; align-items: center;">
          <span style="font-size: 11px; font-weight: 600; color: #38bdf8;">📟 Monitor Serie (115200 Baud)</span>
          <button id="clear-serial-btn" style="background: transparent; border: 1px solid rgba(255, 255, 255, 0.2); color: #94a3b8; font-size: 10px; padding: 2px 6px; border-radius: 4px; cursor: pointer;">Limpiar</button>
        </div>
        <pre id="serial-terminal" style="flex: 1; padding: 12px; font-family: 'JetBrains Mono', monospace; font-size: 11px; color: #4ade80; overflow-y: auto; margin: 0; white-space: pre-wrap; line-height: 1.4;"></pre>
      </div>
    </div>
  `;

  modal.appendChild(container);
  document.body.appendChild(modal);
  activeModal = modal;

  const codeArea = container.querySelector("#esp32-code-area") as HTMLTextAreaElement;
  const presetSelect = container.querySelector("#preset-select") as HTMLSelectElement;
  const compileBtn = container.querySelector("#compile-run-btn") as HTMLButtonElement;
  const closeBtn = container.querySelector("#close-esp32-btn") as HTMLButtonElement;
  const clearSerialBtn = container.querySelector("#clear-serial-btn") as HTMLButtonElement;
  const statusEl = container.querySelector("#compiler-status") as HTMLDivElement;
  const terminalEl = container.querySelector("#serial-terminal") as HTMLElement;
  codeArea.value = runtime.sourceCode;

  presetSelect.addEventListener("change", () => {
    const selected = presetSelect.value;
    if (CODE_PRESETS[selected]) {
      codeArea.value = CODE_PRESETS[selected];
    }
  });

  const handleCompile = () => {
    const code = codeArea.value;
    comp.esp32SourceCode = code;
    const ok = compileEsp32Sketch(runtime, code);
    if (ok) {
      statusEl.style.color = "#10b981";
      statusEl.textContent = "✓ Sketch válido. El intérprete educativo está ejecutándolo.";
      onCodeUpdated?.(code);
    } else {
      statusEl.style.color = "#ef4444";
      statusEl.textContent = `❌ ${runtime.errorMessage}`;
    }
  };

  compileBtn.addEventListener("click", handleCompile);
  closeBtn.addEventListener("click", () => closeEsp32CodeModal());
  clearSerialBtn.addEventListener("click", () => {
    runtime.serialTxBuffer = [];
    terminalEl.textContent = "";
  });

  // Polling del búfer serie en vivo para actualizar el terminal
  serialPollingInterval = setInterval(() => {
    if (runtime.serialTxBuffer.length > 0) {
      while (runtime.serialTxBuffer.length > 0) {
        const line = runtime.serialTxBuffer.shift();
        if (line) {
          terminalEl.textContent = (terminalEl.textContent || "") + line;
        }
      }
      terminalEl.scrollTop = terminalEl.scrollHeight;
    }
  }, 100);
}

export function closeEsp32CodeModal(): void {
  if (serialPollingInterval) {
    clearInterval(serialPollingInterval);
    serialPollingInterval = null;
  }
  if (activeModal) {
    activeModal.remove();
    activeModal = null;
  }
}
