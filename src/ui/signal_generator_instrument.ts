/**
 * SignalGeneratorInstrument — Generador de Funciones Virtual
 */

import { CanvasOrchestrator, ComponentInstance } from "../canvas_orchestrator";

export class SignalGeneratorInstrument {
  private container: HTMLElement;
  private orchestrator: CanvasOrchestrator;
  private callbacks: any;

  // UI state
  private targetSourceId: string | null = null;

  constructor(container: HTMLElement, orchestrator: CanvasOrchestrator, callbacks: any) {
    this.container = container;
    this.orchestrator = orchestrator;
    this.callbacks = callbacks;
    this.render();
    this.bindEvents();
  }

  private render() {
    this.container.innerHTML = `
      <div style="display: flex; gap: 16px; height: 100%; padding: 10px; font-family: var(--font-sans);">
        <!-- Panel Izquierdo: Info e Indicador de Fuente Activa -->
        <div style="width: 35%; display: flex; flex-direction: column; background: rgba(0,0,0,0.4); border: 1px solid var(--border-color); border-radius: 8px; padding: 12px; justify-content: space-between;">
          <div>
            <h4 style="color: var(--cyan); font-size: 0.78rem; text-transform: uppercase; margin-bottom: 8px; letter-spacing: 0.5px;">Generador de Señales</h4>
            <p id="gen-source-info" style="font-size: 0.7rem; color: var(--text-muted); line-height: 1.4;">Buscando fuente compatible en el lienzo...</p>
          </div>
          <div style="background: rgba(168, 85, 247, 0.1); border: 1px solid rgba(168, 85, 247, 0.25); border-radius: 6px; padding: 8px; font-size: 0.68rem; color: var(--text-main);">
            <strong>Consejo:</strong> Selecciona cualquier fuente en el lienzo para vincularla a este generador.
          </div>
        </div>

        <!-- Panel Central: Selectores de Onda -->
        <div style="width: 65%; display: grid; grid-template-columns: repeat(2, 1fr); gap: 12px;">
          <!-- Tipo de Onda -->
          <div style="display: flex; flex-direction: column; gap: 6px;">
            <label style="font-size: 0.65rem; font-weight: 700; color: var(--text-muted); text-transform: uppercase;">Tipo de Onda</label>
            <select id="gen-wave-type" class="prop-input" style="background: rgba(0,0,0,0.5); border: 1px solid var(--border-color); border-radius: 6px; font-size: 0.72rem; padding: 6px; cursor: pointer; color: var(--text-bright);">
              <option value="dc">Corriente Continua (CC)</option>
              <option value="sine">Senoidal (Transitorio)</option>
              <option value="square">Cuadrada (Transitorio)</option>
              <option value="pulse">Pulso (Transitorio)</option>
            </select>
          </div>

          <!-- Frecuencia -->
          <div style="display: flex; flex-direction: column; gap: 4px;">
            <label style="font-size: 0.65rem; font-weight: 700; color: var(--text-muted); text-transform: uppercase; display: flex; justify-content: space-between;">
              <span>Frecuencia (Hz)</span>
              <span id="gen-freq-val" style="color: var(--accent-cyan);">1000 Hz</span>
            </label>
            <input id="gen-freq-slider" type="range" min="1" max="10000" step="1" value="1000" style="width: 100%; cursor: pointer;" />
          </div>

          <!-- Amplitud -->
          <div style="display: flex; flex-direction: column; gap: 4px;">
            <label style="font-size: 0.65rem; font-weight: 700; color: var(--text-muted); text-transform: uppercase; display: flex; justify-content: space-between;">
              <span>Amplitud (Vpk)</span>
              <span id="gen-amp-val" style="color: var(--accent-cyan);">5.0 V</span>
            </label>
            <input id="gen-amp-slider" type="range" min="0.1" max="24" step="0.1" value="5" style="width: 100%; cursor: pointer;" />
          </div>

          <!-- Offset -->
          <div style="display: flex; flex-direction: column; gap: 4px;">
            <label style="font-size: 0.65rem; font-weight: 700; color: var(--text-muted); text-transform: uppercase; display: flex; justify-content: space-between;">
              <span>Tensión Offset (V)</span>
              <span id="gen-offset-val" style="color: var(--accent-cyan);">0.0 V</span>
            </label>
            <input id="gen-offset-slider" type="range" min="-12" max="12" step="0.1" value="0" style="width: 100%; cursor: pointer;" />
          </div>
        </div>
      </div>
    `;
  }

  private bindEvents() {
    const waveSelect = this.container.querySelector("#gen-wave-type") as HTMLSelectElement;
    const freqSlider = this.container.querySelector("#gen-freq-slider") as HTMLInputElement;
    const ampSlider = this.container.querySelector("#gen-amp-slider") as HTMLInputElement;
    const offsetSlider = this.container.querySelector("#gen-offset-slider") as HTMLInputElement;

    const freqVal = this.container.querySelector("#gen-freq-val") as HTMLElement;
    const ampVal = this.container.querySelector("#gen-amp-val") as HTMLElement;
    const offsetVal = this.container.querySelector("#gen-offset-val") as HTMLElement;

    const updateValues = () => {
      const source = this.findLinkedSource();
      if (!source) return;

      source.waveType = waveSelect.value;
      source.frequency = parseFloat(freqSlider.value);
      source.amplitude = parseFloat(ampSlider.value);
      source.offset = parseFloat(offsetSlider.value);

      freqVal.textContent = `${source.frequency} Hz`;
      ampVal.textContent = `${source.amplitude.toFixed(1)} V`;
      offsetVal.textContent = `${source.offset.toFixed(1)} V`;

      // Notificar cambios de canvas para sincronizar el netlist
      this.callbacks.onCanvasModified();
      this.callbacks.onNetlistSync();
      this.callbacks.requestRender(true);
    };

    waveSelect.addEventListener("change", updateValues);
    freqSlider.addEventListener("input", updateValues);
    ampSlider.addEventListener("input", updateValues);
    offsetSlider.addEventListener("input", updateValues);

    // Actualizar periódicamente si cambia la selección en el canvas
    setInterval(() => this.updateLinkedSourceInfo(), 800);
  }

  private findLinkedSource(): ComponentInstance | null {
    // 1. Si hay una seleccionada y es fuente
    const sel = this.orchestrator.selectedComponent;
    if (sel && sel.type === "vsource") {
      this.targetSourceId = sel.id;
      return sel;
    }

    // 2. Si no, usar la última asociada
    if (this.targetSourceId) {
      const found = this.orchestrator.components.find((c) => c.id === this.targetSourceId);
      if (found) return found;
    }

    // 3. Si no, tomar la primera fuente que encontremos
    const first = this.orchestrator.components.find((c) => c.type === "vsource");
    if (first) {
      this.targetSourceId = first.id;
      return first;
    }

    return null;
  }

  public updateLinkedSourceInfo() {
    const infoText = this.container.querySelector("#gen-source-info") as HTMLElement;
    const source = this.findLinkedSource();

    if (infoText) {
      if (source) {
        infoText.innerHTML = `
          <strong>Conectado a:</strong> ${source.id}<br/>
          <strong>Tipo actual:</strong> ${source.waveType?.toUpperCase() ?? "CC"}<br/>
          <strong>Frecuencia:</strong> ${source.frequency ?? 1000} Hz<br/>
          <strong>Amplitud:</strong> ${source.amplitude ?? 5} V
        `;
        
        // Sincronizar selectores si la fuente cambió por fuera
        const waveSelect = this.container.querySelector("#gen-wave-type") as HTMLSelectElement;
        const freqSlider = this.container.querySelector("#gen-freq-slider") as HTMLInputElement;
        const ampSlider = this.container.querySelector("#gen-amp-slider") as HTMLInputElement;
        const offsetSlider = this.container.querySelector("#gen-offset-slider") as HTMLInputElement;

        if (waveSelect && document.activeElement !== waveSelect) {
          waveSelect.value = source.waveType ?? "dc";
        }
        if (freqSlider && document.activeElement !== freqSlider) {
          freqSlider.value = (source.frequency ?? 1000).toString();
        }
        if (ampSlider && document.activeElement !== ampSlider) {
          ampSlider.value = (source.amplitude ?? 5).toString();
        }
        if (offsetSlider && document.activeElement !== offsetSlider) {
          offsetSlider.value = (source.offset ?? 0).toString();
        }
      } else {
        infoText.innerHTML = `<span style="color: var(--red);">No hay fuentes en el lienzo.</span><br/>Coloca una fuente de tensión (VSource) para controlarla desde aquí.`;
      }
    }
  }
}
