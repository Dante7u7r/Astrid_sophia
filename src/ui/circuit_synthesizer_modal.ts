/**
 * circuit_synthesizer_modal.ts — Modal Interactivo de Síntesis y Dimensionamiento de Circuitos
 *
 * Permite diseñar circuitos paramétricos con valores comerciales E12/E24/E96
 * e insertarlos directamente en el lienzo de trabajo listos para simular.
 */

import {
  generateSallenKeySchematic,
  generateBjtAmplifierSchematic,
  generateZenerRegulatorSchematic,
  generateTimer555Schematic,
  generateRfAttenuatorSchematic,
  generateMcuBlinkSchematic,
  synthesizeSallenKeyFilter,
  synthesizeBjtVoltageDividerBias,
  synthesizeZenerRegulator,
  synthesizeTimer555Astable,
  synthesizeRfAttenuator,
  type FilterApproximation,
  type FilterType,
  type SynthesizedCircuitPackage,
} from "../intelligence/circuit_synthesizer";

export interface CircuitSynthesizerModalDeps {
  /** true confirma la inserción completa; no implica que la simulación haya convergido. */
  onInsertCircuit: (pkg: SynthesizedCircuitPackage, createNewTab: boolean) => Promise<boolean> | boolean;
  addLog?: (text: string, type?: "system" | "send" | "receive" | "error") => void;
}

export type SynthesizerCircuitType = "sallen_key" | "bjt_amp" | "zener_reg" | "timer_555" | "rf_attenuator" | "mcu_blink";

export class CircuitSynthesizerModal {
  private modalEl: HTMLElement | null = null;
  private selectedType: SynthesizerCircuitType = "sallen_key";
  private isInserting = false;
  private readonly keydownHandler = (event: KeyboardEvent): void => {
    if (event.key === "Escape" && this.isOpen()) this.close();
  };

  constructor(private readonly deps: CircuitSynthesizerModalDeps) {
    this.ensureModalDOM();
    this.bindEvents();
  }

  private ensureModalDOM(): void {
    if (typeof document === "undefined") return;
    let existing = document.getElementById("circuit-synthesizer-modal");
    if (!existing) {
      existing = document.createElement("div");
      existing.id = "circuit-synthesizer-modal";
      existing.className = "modal-overlay circuit-synthesizer-modal";
      existing.setAttribute("role", "dialog");
      existing.setAttribute("aria-modal", "true");
      existing.setAttribute("aria-hidden", "true");
      existing.setAttribute("aria-labelledby", "synth-modal-title");
      document.body.appendChild(existing);
    }
    this.modalEl = existing;
    this.renderModalContent();
  }

  private renderModalContent(): void {
    if (!this.modalEl) return;
    this.modalEl.innerHTML = `
      <div class="modal-box synthesizer-dialog" style="max-width: 700px; width: 92vw; max-height: calc(100vh - 40px); display: flex; flex-direction: column;">
        <div class="panel-header" style="display: flex; align-items: center; justify-content: space-between; padding: 14px 18px; border-bottom: 1px solid var(--border-subtle, rgba(255, 255, 255, 0.08));">
          <div class="modal-title-wrap" style="display: flex; align-items: center; gap: 10px;">
            <span class="modal-icon" style="font-size: 1.3rem;">🧮</span>
            <div>
              <h2 id="synth-modal-title" class="panel-title" style="margin: 0; font-size: 1.05rem; font-weight: 700;">Asistente de Síntesis CAD</h2>
              <span style="font-size: 0.75rem; opacity: 0.8;">Diseño paramétrico normalizado con series estándar E12 / E24 / E96</span>
            </div>
          </div>
          <button id="btn-close-synthesizer-modal" class="modal-close-btn" type="button" aria-label="Cerrar modal" style="font-size: 1.1rem; width: 28px; height: 28px; display: flex; align-items: center; justify-content: center; background: transparent; border: none; color: inherit; cursor: pointer; border-radius: 6px;">✕</button>
        </div>

        <div class="panel-body synth-modal-body" style="padding: 18px; display: flex; flex-direction: column; gap: 16px; overflow-y: auto;">
          <div class="form-group">
            <label for="synth-circuit-type" style="display: block; font-weight: 600; margin-bottom: 6px; font-size: 0.85rem;">Tipo de Circuito a Sintetizar:</label>
            <select id="synth-circuit-type" class="form-control" style="width: 100%; padding: 8px 12px; border-radius: 6px; font-size: 0.9rem;">
              <option value="sallen_key">🌊 Filtro Activo Sallen-Key (2º Orden)</option>
              <option value="bjt_amp">⚡ Amplificador Transistorizado BJT (Emisor Común)</option>
              <option value="zener_reg">🛡️ Regulador de Tensión Zener Shunt</option>
              <option value="timer_555">⏱️ Equivalente conductual 555 Astable</option>
              <option value="rf_attenuator">📡 Atenuador Pasivo RF (50 Ω, Red Pi / T)</option>
              <option value="mcu_blink">🤖 Sistema Embebido Microcontrolador (Blink)</option>
            </select>
          </div>

          <div id="synth-params-container" class="synth-params-container">
            <!-- Parámetros dinámicos según el tipo -->
          </div>

          <div id="synth-telemetry-container" class="synth-telemetry-container">
            <!-- Valores calculados y normalizados E12/E24/E96 -->
          </div>
        </div>

        <div class="modal-footer" style="display: flex; justify-content: space-between; align-items: center; padding: 12px 18px; border-top: 1px solid var(--border-subtle, rgba(255, 255, 255, 0.08));">
          <div style="font-size: 0.78rem; opacity: 0.75; display: flex; align-items: center; gap: 6px;">
            <span style="display: inline-block; width: 8px; height: 8px; border-radius: 50%; background: #0D9488;"></span>
            <span>Cálculo y dimensionamiento en tiempo real</span>
          </div>
          <div style="display: flex; gap: 10px;">
            <button id="btn-synth-cancel" class="btn-cancel" type="button">Cancelar</button>
            <button id="btn-synth-generate" class="btn-save" type="button" style="background: var(--teal, #0D9488); color: #fff; font-weight: 700; border: none; cursor: pointer; display: flex; align-items: center; gap: 6px; box-shadow: 0 4px 14px rgba(13, 148, 136, 0.35);">
              <span>✨ Insertar en Esquema</span>
            </button>
          </div>
        </div>
      </div>
    `;
    this.updateParamsView();
  }

  private updateParamsView(): void {
    if (!this.modalEl) return;
    const container = this.modalEl.querySelector("#synth-params-container");
    const telemetry = this.modalEl.querySelector("#synth-telemetry-container");
    if (!container || !telemetry) return;
    const generateButton = this.modalEl.querySelector<HTMLButtonElement>("#btn-synth-generate");
    if (generateButton) {
      generateButton.disabled = false;
      generateButton.removeAttribute("aria-disabled");
      generateButton.style.opacity = "1";
    }

    if (this.selectedType === "sallen_key") {
      container.innerHTML = `
        <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 12px;">
          <div class="form-group">
            <label for="synth-filter-type">Configuración:</label>
            <select id="synth-filter-type" class="form-control">
              <option value="lowpass">Paso Bajas (Low-pass)</option>
              <option value="highpass">Paso Altas (High-pass)</option>
            </select>
          </div>
          <div class="form-group">
            <label for="synth-filter-approx">Polinomio:</label>
            <select id="synth-filter-approx" class="form-control">
              <option value="butterworth">Butterworth (Maximally Flat)</option>
              <option value="chebyshev_05db">Chebyshev (0.5 dB Ripple)</option>
              <option value="bessel">Bessel (Linear Phase)</option>
            </select>
          </div>
          <div class="form-group">
            <label for="synth-cutoff-freq">Frecuencia de Corte fc (Hz):</label>
            <input type="number" id="synth-cutoff-freq" class="form-control" value="1000" min="10" max="1000000" step="10">
          </div>
        </div>
      `;
      const updateFilterTel = () => {
        const fc = parseFloat((container.querySelector("#synth-cutoff-freq") as HTMLInputElement)?.value || "1000");
        const type = (container.querySelector("#synth-filter-type") as HTMLSelectElement)?.value as FilterType || "lowpass";
        const approx = (container.querySelector("#synth-filter-approx") as HTMLSelectElement)?.value as FilterApproximation || "butterworth";
        const res = synthesizeSallenKeyFilter(type, approx, fc);
        telemetry.innerHTML = `
          <div><strong>R1 (E24):</strong> ${res.r1_standard} Ω | <strong>R2 (E24):</strong> ${res.r2_standard} Ω</div>
          <div><strong>C1 (E12):</strong> ${(res.c1_standard * 1e9).toFixed(1)} nF | <strong>C2 (E12):</strong> ${(res.c2_standard * 1e9).toFixed(1)} nF</div>
          <div><strong>Frecuencia Real:</strong> ${Math.round(res.actualCutoffHz)} Hz (Q = ${res.qFactor.toFixed(2)})</div>
        `;
      };
      container.querySelectorAll("input, select").forEach(el => el.addEventListener("input", updateFilterTel));
      updateFilterTel();
    } else if (this.selectedType === "bjt_amp") {
      container.innerHTML = `
        <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 12px;">
          <div class="form-group">
            <label for="synth-bjt-vcc">Tensión VCC (V):</label>
            <input type="number" id="synth-bjt-vcc" class="form-control" value="12" min="3" max="50" step="1">
          </div>
          <div class="form-group">
            <label for="synth-bjt-ic">Corriente Colector Ic (mA):</label>
            <input type="number" id="synth-bjt-ic" class="form-control" value="2" min="0.1" max="500" step="0.5">
          </div>
          <div class="form-group">
            <label for="synth-bjt-vce">Tensión VCE deseada (V):</label>
            <input type="number" id="synth-bjt-vce" class="form-control" value="6" min="1" max="45" step="0.5">
          </div>
          <div class="form-group">
            <label for="synth-bjt-beta">Ganancia hFE (Beta):</label>
            <input type="number" id="synth-bjt-beta" class="form-control" value="100" min="20" max="800" step="10">
          </div>
        </div>
      `;
      const updateBjtTel = () => {
        const vcc = parseFloat((container.querySelector("#synth-bjt-vcc") as HTMLInputElement)?.value || "12");
        const ic = parseFloat((container.querySelector("#synth-bjt-ic") as HTMLInputElement)?.value || "2") / 1000;
        const vce = parseFloat((container.querySelector("#synth-bjt-vce") as HTMLInputElement)?.value || "6");
        const beta = parseFloat((container.querySelector("#synth-bjt-beta") as HTMLInputElement)?.value || "100");
        const res = synthesizeBjtVoltageDividerBias(vcc, ic, vce, beta);
        telemetry.innerHTML = `
          <div><strong>R1 (E24):</strong> ${res.r1_standard} Ω | <strong>R2 (E24):</strong> ${res.r2_standard} Ω</div>
          <div><strong>RC (E24):</strong> ${res.rc_standard} Ω | <strong>RE (E24):</strong> ${res.re_standard} Ω</div>
          <div><strong>Punto Q Real:</strong> Ic = ${(res.actualIcAmps * 1000).toFixed(2)} mA, Vce = ${res.actualVceVolts.toFixed(2)} V (S = ${res.stabilityFactor.toFixed(1)})</div>
        `;
      };
      container.querySelectorAll("input").forEach(el => el.addEventListener("input", updateBjtTel));
      updateBjtTel();
    } else if (this.selectedType === "zener_reg") {
      container.innerHTML = `
        <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 12px;">
          <div class="form-group">
            <label for="synth-zen-vin-min">Vin Mínima (V):</label>
            <input type="number" id="synth-zen-vin-min" class="form-control" value="15" min="2" max="100" step="1">
          </div>
          <div class="form-group">
            <label for="synth-zen-vin-max">Vin Máxima (V):</label>
            <input type="number" id="synth-zen-vin-max" class="form-control" value="20" min="2" max="100" step="1">
          </div>
          <div class="form-group">
            <label for="synth-zen-vz">Tensión Zener Vz (V):</label>
            <input type="number" id="synth-zen-vz" class="form-control" value="5.1" min="1.2" max="48" step="0.1">
          </div>
          <div class="form-group">
            <label for="synth-zen-il">Corriente Carga Máx (mA):</label>
            <input type="number" id="synth-zen-il" class="form-control" value="50" min="1" max="1000" step="5">
          </div>
        </div>
      `;
      const updateZenTel = () => {
        const vMin = parseFloat((container.querySelector("#synth-zen-vin-min") as HTMLInputElement)?.value || "15");
        const vMax = parseFloat((container.querySelector("#synth-zen-vin-max") as HTMLInputElement)?.value || "20");
        const vz = parseFloat((container.querySelector("#synth-zen-vz") as HTMLInputElement)?.value || "5.1");
        const il = parseFloat((container.querySelector("#synth-zen-il") as HTMLInputElement)?.value || "50") / 1000;
        const res = synthesizeZenerRegulator(vMin, vMax, vz, il);
        if (generateButton) {
          generateButton.disabled = !res.isSafe;
          generateButton.setAttribute("aria-disabled", String(!res.isSafe));
          generateButton.style.opacity = res.isSafe ? "1" : "0.5";
        }
        telemetry.innerHTML = `
          <div><strong>Resistencia Serie RS (E24):</strong> ${res.rs_standard} Ω (Potencia: ${res.rs_powerWatts.toFixed(2)} W)</div>
          <div><strong>Potencia Máx en Zener:</strong> ${res.zener_maxPowerWatts.toFixed(2)} W</div>
          <div style="color: ${res.isSafe ? "#10b981" : "#ef4444"};"><strong>Validez física:</strong> ${res.isSafe ? "Parámetros coherentes; seleccione potencias nominales con margen." : "Inválido: Vin máx. ≥ Vin mín. > Vz es obligatorio."}</div>
        `;
      };
      container.querySelectorAll("input").forEach(el => el.addEventListener("input", updateZenTel));
      updateZenTel();
    } else if (this.selectedType === "timer_555") {
      container.innerHTML = `
        <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 12px;">
          <div class="form-group">
            <label for="synth-555-freq">Frecuencia Objetivo (Hz):</label>
            <input type="number" id="synth-555-freq" class="form-control" value="1000" min="1" max="500000" step="10">
          </div>
          <div class="form-group">
            <label for="synth-555-duty">Ciclo de Trabajo (%):</label>
            <input type="number" id="synth-555-duty" class="form-control" value="60" min="51" max="99" step="1">
          </div>
        </div>
      `;
      const update555Tel = () => {
        const f = parseFloat((container.querySelector("#synth-555-freq") as HTMLInputElement)?.value || "1000");
        const d = parseFloat((container.querySelector("#synth-555-duty") as HTMLInputElement)?.value || "60");
        const res = synthesizeTimer555Astable(f, d);
        telemetry.innerHTML = `
          <div><strong>RA (E24):</strong> ${res.ra_standard} Ω | <strong>RB (E24):</strong> ${res.rb_standard} Ω</div>
          <div><strong>Capacitor C (E12):</strong> ${(res.c_standard * 1e9).toFixed(1)} nF</div>
          <div><strong>Frecuencia Real:</strong> ${Math.round(res.actualFreqHz)} Hz (Duty: ${Math.round(res.actualDutyPercent)}%)</div>
          <div><strong>Modelo generado:</strong> fuente PULSE equivalente y red de cálculo; no macromodelo interno del NE555.</div>
        `;
      };
      container.querySelectorAll("input").forEach(el => el.addEventListener("input", update555Tel));
      update555Tel();
    } else if (this.selectedType === "rf_attenuator") {
      container.innerHTML = `
        <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 12px;">
          <div class="form-group">
            <label for="synth-rf-att">Atenuación (dB):</label>
            <input type="number" id="synth-rf-att" class="form-control" value="10" min="1" max="60" step="1">
          </div>
          <div class="form-group">
            <label for="synth-rf-z0">Impedancia Z0 (Ω):</label>
            <input type="number" id="synth-rf-z0" class="form-control" value="50" min="10" max="600" step="5">
          </div>
          <div class="form-group">
            <label for="synth-rf-type">Topología:</label>
            <select id="synth-rf-type" class="form-control">
              <option value="PI">Red Pi (π)</option>
              <option value="T">Red T</option>
            </select>
          </div>
        </div>
      `;
      const updateRfTel = () => {
        const att = parseFloat((container.querySelector("#synth-rf-att") as HTMLInputElement)?.value || "10");
        const z0 = parseFloat((container.querySelector("#synth-rf-z0") as HTMLInputElement)?.value || "50");
        const type = (container.querySelector("#synth-rf-type") as HTMLSelectElement)?.value as "T" | "PI" || "PI";
        const res = synthesizeRfAttenuator(att, z0, type);
        telemetry.innerHTML = `
          <div><strong>R1 Shunt/Series (E96):</strong> ${res.r1_series_std} Ω | <strong>R2 (E96):</strong> ${res.r2_shunt_std} Ω</div>
          <div><strong>Topología:</strong> ${type} @ ${z0} Ω (-${att} dB)</div>
        `;
      };
      container.querySelectorAll("input, select").forEach(el => el.addEventListener("input", updateRfTel));
      updateRfTel();
    } else if (this.selectedType === "mcu_blink") {
      container.innerHTML = `
        <div class="form-group">
          <label for="synth-mcu-family">Arquitectura de Microcontrolador:</label>
          <select id="synth-mcu-family" class="form-control">
            <option value="mcu_8051">Intel 8051 (Harv / SFR)</option>
            <option value="mcu_avr">Microchip AVR (ATmega328P)</option>
            <option value="esp32">Espressif ESP32 (Xtensa Dual-Core)</option>
          </select>
        </div>
      `;
      const familySelect = container.querySelector<HTMLSelectElement>("#synth-mcu-family");
      const updateMcuTelemetry = () => {
        const family = familySelect?.value ?? "mcu_8051";
        const output = family === "mcu_8051" ? "P2.0" : family === "mcu_avr" ? "PB5/SCK" : "GPIO2";
        telemetry.innerHTML = family === "esp32"
          ? `<div><strong>Cableado:</strong> 3.3 V, GND, ${output}, resistencia y LED.</div><div><strong>Programa:</strong> sketch Blink del intérprete educativo precargado.</div>`
          : `<div><strong>Cableado:</strong> alimentación, GND, ${output}, resistencia y LED.</div><div><strong>Firmware:</strong> no incluido; debe cargar un binario compatible para producir el parpadeo.</div>`;
      };
      familySelect?.addEventListener("change", updateMcuTelemetry);
      updateMcuTelemetry();
    }
  }

  private bindEvents(): void {
    if (!this.modalEl) return;

    this.modalEl.querySelector("#btn-close-synthesizer-modal")?.addEventListener("click", () => this.close());
    this.modalEl.querySelector("#btn-synth-cancel")?.addEventListener("click", () => this.close());

    this.modalEl.querySelector("#synth-circuit-type")?.addEventListener("change", (e) => {
      if (this.isInserting) return;
      this.selectedType = (e.target as HTMLSelectElement).value as SynthesizerCircuitType;
      this.updateParamsView();
    });

    this.modalEl.querySelector("#btn-synth-generate")?.addEventListener("click", async () => {
      const modalEl = this.modalEl;
      const generateButton = modalEl?.querySelector<HTMLButtonElement>("#btn-synth-generate");
      if (!modalEl || !this.isOpen() || this.isInserting || generateButton?.disabled) return;
      this.isInserting = true;
      const controls = Array.from(modalEl.querySelectorAll<HTMLInputElement | HTMLSelectElement | HTMLButtonElement>("input, select, button"),
        (control) => ({ control, disabled: control.disabled }));
      controls.forEach(({ control }) => { control.disabled = true; });
      modalEl.setAttribute("aria-busy", "true");
      try {
        const circuit = this.buildCircuit();
        if (!circuit) throw new Error("No se pudo construir el circuito con estos parámetros.");
        const inserted = await this.deps.onInsertCircuit(circuit, true);
        if (this.modalEl !== modalEl) return;
        if (inserted !== true) {
          throw new Error("La aplicación no confirmó la inserción completa. Revise los mensajes de error antes de reintentar.");
        }
        this.isInserting = false;
        this.close();
        this.deps.addLog?.(`Circuito sintetizado [${circuit.title}] insertado en el esquema.`, "receive");
      } catch (error: unknown) {
        if (this.modalEl !== modalEl) return;
        const message = error instanceof Error ? error.message : String(error);
        const telemetry = modalEl.querySelector<HTMLElement>("#synth-telemetry-container");
        if (telemetry) telemetry.textContent = `No se confirmó la inserción: ${message}`;
        this.deps.addLog?.(`Inserción no confirmada: ${message}`, "error");
      } finally {
        this.isInserting = false;
        if (this.modalEl === modalEl) {
          controls.forEach(({ control, disabled }) => { control.disabled = disabled; });
          modalEl.removeAttribute("aria-busy");
        }
      }
    });

    this.modalEl.addEventListener("click", (e) => {
      if (e.target === this.modalEl) this.close();
    });

    if (typeof window !== "undefined") {
      window.addEventListener("keydown", this.keydownHandler);
    }
  }

  public buildCircuit(): SynthesizedCircuitPackage | null {
    if (!this.modalEl) return null;
    const container = this.modalEl.querySelector("#synth-params-container");
    if (!container) return null;

    if (this.selectedType === "sallen_key") {
      const fc = parseFloat((container.querySelector("#synth-cutoff-freq") as HTMLInputElement)?.value || "1000");
      const type = (container.querySelector("#synth-filter-type") as HTMLSelectElement)?.value as FilterType || "lowpass";
      const approx = (container.querySelector("#synth-filter-approx") as HTMLSelectElement)?.value as FilterApproximation || "butterworth";
      return generateSallenKeySchematic(fc, type, approx);
    }

    if (this.selectedType === "bjt_amp") {
      const vcc = parseFloat((container.querySelector("#synth-bjt-vcc") as HTMLInputElement)?.value || "12");
      const ic = parseFloat((container.querySelector("#synth-bjt-ic") as HTMLInputElement)?.value || "2") / 1000;
      const vce = parseFloat((container.querySelector("#synth-bjt-vce") as HTMLInputElement)?.value || "6");
      const beta = parseFloat((container.querySelector("#synth-bjt-beta") as HTMLInputElement)?.value || "100");
      return generateBjtAmplifierSchematic(vcc, ic, vce, beta);
    }

    if (this.selectedType === "zener_reg") {
      const vMin = parseFloat((container.querySelector("#synth-zen-vin-min") as HTMLInputElement)?.value || "15");
      const vMax = parseFloat((container.querySelector("#synth-zen-vin-max") as HTMLInputElement)?.value || "20");
      const vz = parseFloat((container.querySelector("#synth-zen-vz") as HTMLInputElement)?.value || "5.1");
      const il = parseFloat((container.querySelector("#synth-zen-il") as HTMLInputElement)?.value || "50") / 1000;
      return generateZenerRegulatorSchematic(vMin, vMax, vz, il);
    }

    if (this.selectedType === "timer_555") {
      const f = parseFloat((container.querySelector("#synth-555-freq") as HTMLInputElement)?.value || "1000");
      const d = parseFloat((container.querySelector("#synth-555-duty") as HTMLInputElement)?.value || "60");
      return generateTimer555Schematic(f, d);
    }

    if (this.selectedType === "rf_attenuator") {
      const att = parseFloat((container.querySelector("#synth-rf-att") as HTMLInputElement)?.value || "10");
      const z0 = parseFloat((container.querySelector("#synth-rf-z0") as HTMLInputElement)?.value || "50");
      const type = (container.querySelector("#synth-rf-type") as HTMLSelectElement)?.value as "T" | "PI" || "PI";
      return generateRfAttenuatorSchematic(att, z0, type);
    }

    if (this.selectedType === "mcu_blink") {
      const mcu = (container.querySelector("#synth-mcu-family") as HTMLSelectElement)?.value as "mcu_8051" | "mcu_avr" | "esp32" || "mcu_8051";
      return generateMcuBlinkSchematic(mcu);
    }

    return null;
  }

  public open(): void {
    if (!this.modalEl || this.isInserting) return;
    this.modalEl.classList.remove("hidden");
    this.modalEl.classList.add("open");
    this.modalEl.setAttribute("aria-hidden", "false");
    this.updateParamsView();

    // Enfocar automáticamente el selector principal
    const typeSelect = this.modalEl.querySelector<HTMLSelectElement>("#synth-circuit-type");
    if (typeSelect) {
      setTimeout(() => typeSelect.focus(), 50);
    }
  }

  public close(): void {
    if (!this.modalEl || this.isInserting) return;
    this.modalEl.classList.remove("open");
    this.modalEl.setAttribute("aria-hidden", "true");
  }

  public isOpen(): boolean {
    return this.modalEl?.classList.contains("open") ?? false;
  }

  public destroy(): void {
    if (typeof window !== "undefined") {
      window.removeEventListener("keydown", this.keydownHandler);
    }
    this.modalEl?.remove();
    this.modalEl = null;
  }
}
