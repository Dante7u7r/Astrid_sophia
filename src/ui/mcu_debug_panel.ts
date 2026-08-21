/**
 * Panel de Depuración de Firmware para Microcontroladores (8051 y AVR).
 *
 * Proporciona:
 * 1. Control de ejecución: Ejecutar (Run/Continue), Paso a Paso (Step Into), Paso por encima (Step Over), Pausar y Reiniciar.
 * 2. Gestión de Breakpoints: Puntos de interrupción interactivos en desensamblado o por dirección.
 * 3. Inspección y edición de Registros: PC, SP, ACC, B, PSW/SREG con desglose de banderas (CY, AC, OV, P, I, T, H, S, V, N, Z, C) y registros R0..R31.
 * 4. Visor Hexadecimal de Memoria: Volcado de RAM (SRAM), SFRs/IO y Flash (ROM) con visualización ASCII.
 * 5. Expresiones de Inspección (Watch Expressions): Evaluación en tiempo real de registros, memoria y bits en formatos Hex, Dec y Bin.
 */
import { 
  createMcuRuntime, 
  resetRuntime, 
  getRuntimeState, 
  getRegisterDump, 
  disassemble8051,
  disassembleAvr,
  STANDARD_8051_DEFINITION,
  ATMEGA328P_DEFINITIONS
} from "../simulation";
import type { ComponentInstance } from "../canvas_orchestrator";
import {
  parseIntelHex,
  translateInstructionToSpanish,
  evaluateWatchExpression,
  formatMemoryDump,
  stepUntilBreakpoint,
  stepOver,
  type WatchResult,
} from "./mcu_debug_model";

export { parseIntelHex };

export class McuDebugPanel {
  private container: HTMLDivElement | null = null;
  private currentComponent: ComponentInstance | null = null;
  private onUpdateCallback: () => void = () => {};

  // Estado de depuración
  private breakpoints: Set<number> = new Set();
  private watchExpressions: string[] = ["ACC", "PSW.CY", "SP", "R0", "RAM[0x20]"];
  private isRunningContinuous: boolean = false;
  private continuousTimerId: number | null = null;
  private memoryViewTab: "ram" | "sfr" | "flash" = "ram";

  constructor(parent: HTMLElement, onUpdate: () => void) {
    this.onUpdateCallback = onUpdate;
    this.initUI(parent);
  }

  private initUI(parent: HTMLElement) {
    this.container = document.createElement("div");
    this.container.id = "mcu-debug-container";
    this.container.className = "properties-form";
    this.container.style.display = "none";
    this.container.style.borderTop = "1px solid var(--border-color)";
    this.container.style.paddingTop = "16px";
    this.container.style.marginTop = "8px";
    
    this.container.innerHTML = `
      <!-- 1. Carga de Firmware -->
      <div class="property-group">
        <label class="property-label">Carga de Firmware</label>
        <div class="mcu-firmware-area">
          <input type="file" id="mcu-file-loader" accept=".hex,.bin" style="display: none;" />
          <button id="mcu-btn-upload" class="btn-ctrl" style="width: 100%; justify-content: center; background: rgba(255,255,255,0.03); border: 1px solid var(--border-color); padding: 8px;">
            Cargar Firmware (.HEX / .BIN)
          </button>
          <span id="mcu-file-status" class="comp-desc" style="display: block; text-align: center; margin-top: 6px; color: var(--text-muted);">Sin firmware cargado</span>
        </div>
      </div>

      <!-- 2. Controles de Ejecución de Depuración -->
      <div class="property-group">
        <label class="property-label">Control de Ejecución (Debug ISA)</label>
        <div class="mcu-debug-controls" style="display: grid; grid-template-columns: repeat(4, 1fr); gap: 6px;">
          <button id="mcu-btn-run" class="btn-adj" style="height: 32px; background: rgba(34, 197, 94, 0.15); border-color: rgba(34, 197, 94, 0.4);" title="Ejecutar hasta breakpoint">Ejecutar</button>
          <button id="mcu-btn-step-into" class="btn-adj" style="height: 32px;" title="Paso a paso (Step Into)">Paso</button>
          <button id="mcu-btn-step-over" class="btn-adj" style="height: 32px;" title="Paso sobre subrutina (Step Over)">Sobre</button>
          <button id="mcu-btn-reset" class="btn-adj" style="height: 32px; background: rgba(239, 68, 68, 0.15); border-color: rgba(239, 68, 68, 0.4);" title="Reiniciar CPU y registros">Reiniciar</button>
        </div>
      </div>

      <!-- 3. Registros de CPU y Banderas -->
      <div class="property-group">
        <label class="property-label">Registros de la CPU</label>
        <div id="mcu-registers-container" class="mcu-registers-grid" style="display: grid; grid-template-columns: repeat(3, 1fr); gap: 6px; background: rgba(0,0,0,0.3); padding: 10px; border-radius: 8px; font-family: var(--font-mono); font-size: 0.75rem;">
          <div>PC: <span id="mcu-reg-pc" style="color: var(--accent-cyan);">0000</span></div>
          <div>SP: <span id="mcu-reg-sp" style="color: var(--accent-cyan);">00</span></div>
          <div>ACC: <span id="mcu-reg-acc" style="color: var(--accent-purple);">00</span></div>
          <div>B: <span id="mcu-reg-b" style="color: var(--accent-purple);">00</span></div>
          <div>PSW: <span id="mcu-reg-psw" style="color: var(--text-muted);">00</span></div>
          <div>Ciclos: <span id="mcu-reg-cycles" style="color: var(--text-muted);">0</span></div>
        </div>
        <div id="mcu-flags-container" style="display: flex; gap: 4px; margin-top: 6px; font-family: var(--font-mono); font-size: 0.7rem;">
          <!-- Banderas dinámicas -->
        </div>
      </div>

      <!-- 4. Desensamblado y Breakpoints -->
      <div class="property-group">
        <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 4px;">
          <label class="property-label" style="margin-bottom: 0;">Desensamblado (Click para Breakpoint)</label>
          <span id="mcu-bp-count" class="badge" style="font-size: 0.65rem; background: rgba(239, 68, 68, 0.2); color: #f87171;">0 BPs</span>
        </div>
        <div id="mcu-disasm-list" class="console-output" style="height: 140px; border: 1px solid var(--border-color); border-radius: 8px; font-size: 0.7rem; padding: 6px; overflow-y: auto; background: rgba(0,0,0,0.5);">
          <!-- Instrucciones generadas dinámicamente -->
        </div>
        <div id="mcu-asm-explainer" class="comp-desc" style="margin-top: 6px; padding: 6px 8px; border-radius: 6px; background: rgba(168, 85, 247, 0.08); border: 1px solid rgba(168, 85, 247, 0.2); font-size: 0.72rem; color: var(--text-main); display: none;">
          <strong>Asistente ASM:</strong> <span id="mcu-asm-explainer-text">Selecciona una instrucción para ver su explicación.</span>
        </div>
      </div>

      <!-- 5. Expresiones de Inspección (Watch Expressions) -->
      <div class="property-group">
        <label class="property-label">Expresiones de Inspección (Watch)</label>
        <div style="display: flex; gap: 6px; margin-bottom: 6px;">
          <input type="text" id="mcu-watch-input" placeholder="Ej: ACC, R16, RAM[0x20], SREG.Z" style="flex-grow: 1; padding: 4px 8px; font-size: 0.75rem; background: rgba(0,0,0,0.3); border: 1px solid var(--border-color); border-radius: 4px; color: var(--text-main);" />
          <button id="mcu-btn-add-watch" class="btn-adj" style="padding: 0 12px; height: 28px;">Añadir</button>
        </div>
        <div id="mcu-watch-list" style="display: flex; flex-direction: column; gap: 4px; max-height: 110px; overflow-y: auto;">
          <!-- Watches generados dinámicamente -->
        </div>
      </div>

      <!-- 6. Visor Hexadecimal de Memoria -->
      <div class="property-group">
        <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 6px;">
          <label class="property-label" style="margin-bottom: 0;">Visor de Memoria</label>
          <div style="display: flex; gap: 4px;">
            <button id="mcu-tab-ram" class="btn-adj" style="height: 22px; padding: 0 6px; font-size: 0.65rem; background: rgba(168, 85, 247, 0.2);">RAM</button>
            <button id="mcu-tab-sfr" class="btn-adj" style="height: 22px; padding: 0 6px; font-size: 0.65rem;">SFR/IO</button>
            <button id="mcu-tab-flash" class="btn-adj" style="height: 22px; padding: 0 6px; font-size: 0.65rem;">Flash</button>
          </div>
        </div>
        <div id="mcu-memory-hex" class="console-output" style="height: 120px; font-family: var(--font-mono); font-size: 0.65rem; padding: 6px; overflow-y: auto; background: rgba(0,0,0,0.6); border: 1px solid var(--border-color); border-radius: 6px; white-space: pre;">
          <!-- Hex dump dinámico -->
        </div>
      </div>
    `;

    parent.appendChild(this.container);
    this.bindEvents();
  }

  private bindEvents() {
    const btnUpload = this.container?.querySelector("#mcu-btn-upload") as HTMLButtonElement;
    const fileLoader = this.container?.querySelector("#mcu-file-loader") as HTMLInputElement;
    const btnRun = this.container?.querySelector("#mcu-btn-run") as HTMLButtonElement;
    const btnStepInto = this.container?.querySelector("#mcu-btn-step-into") as HTMLButtonElement;
    const btnStepOver = this.container?.querySelector("#mcu-btn-step-over") as HTMLButtonElement;
    const btnReset = this.container?.querySelector("#mcu-btn-reset") as HTMLButtonElement;
    const btnAddWatch = this.container?.querySelector("#mcu-btn-add-watch") as HTMLButtonElement;
    const watchInput = this.container?.querySelector("#mcu-watch-input") as HTMLInputElement;

    const tabRam = this.container?.querySelector("#mcu-tab-ram") as HTMLButtonElement;
    const tabSfr = this.container?.querySelector("#mcu-tab-sfr") as HTMLButtonElement;
    const tabFlash = this.container?.querySelector("#mcu-tab-flash") as HTMLButtonElement;

    btnUpload?.addEventListener("click", () => fileLoader?.click());
    fileLoader?.addEventListener("change", (e) => this.handleFileChange(e));

    btnRun?.addEventListener("click", () => this.toggleRunContinuous());
    btnStepInto?.addEventListener("click", () => this.handleStepInto());
    btnStepOver?.addEventListener("click", () => this.handleStepOver());

    btnReset?.addEventListener("click", () => {
      if (this.currentComponent && this.currentComponent.mcuRuntime) {
        this.stopContinuousExecution();
        resetRuntime(this.currentComponent.mcuRuntime);
        this.updateGPIOFromRuntime();
        this.updateData();
        this.onUpdateCallback();
      }
    });

    btnAddWatch?.addEventListener("click", () => {
      const val = watchInput?.value?.trim();
      if (val && !this.watchExpressions.includes(val)) {
        this.watchExpressions.push(val);
        watchInput.value = "";
        this.updateWatches();
      }
    });

    watchInput?.addEventListener("keydown", (e) => {
      if (e.key === "Enter") {
        btnAddWatch?.click();
      }
    });

    tabRam?.addEventListener("click", () => {
      this.memoryViewTab = "ram";
      this.highlightActiveMemoryTab();
      this.updateMemoryView();
    });
    tabSfr?.addEventListener("click", () => {
      this.memoryViewTab = "sfr";
      this.highlightActiveMemoryTab();
      this.updateMemoryView();
    });
    tabFlash?.addEventListener("click", () => {
      this.memoryViewTab = "flash";
      this.highlightActiveMemoryTab();
      this.updateMemoryView();
    });
  }

  private highlightActiveMemoryTab() {
    const tabRam = this.container?.querySelector("#mcu-tab-ram") as HTMLElement;
    const tabSfr = this.container?.querySelector("#mcu-tab-sfr") as HTMLElement;
    const tabFlash = this.container?.querySelector("#mcu-tab-flash") as HTMLElement;

    if (tabRam) tabRam.style.background = this.memoryViewTab === "ram" ? "rgba(168, 85, 247, 0.3)" : "";
    if (tabSfr) tabSfr.style.background = this.memoryViewTab === "sfr" ? "rgba(168, 85, 247, 0.3)" : "";
    if (tabFlash) tabFlash.style.background = this.memoryViewTab === "flash" ? "rgba(168, 85, 247, 0.3)" : "";
  }

  private handleStepInto() {
    if (!this.currentComponent?.mcuRuntime) return;
    this.stopContinuousExecution();
    stepUntilBreakpoint(this.currentComponent.mcuRuntime, this.breakpoints, 1);
    this.updateGPIOFromRuntime();
    this.updateData();
    this.onUpdateCallback();
  }

  private handleStepOver() {
    if (!this.currentComponent?.mcuRuntime) return;
    this.stopContinuousExecution();
    stepOver(this.currentComponent.mcuRuntime, this.breakpoints, 10000);
    this.updateGPIOFromRuntime();
    this.updateData();
    this.onUpdateCallback();
  }

  private toggleRunContinuous() {
    if (this.isRunningContinuous) {
      this.stopContinuousExecution();
    } else {
      this.startContinuousExecution();
    }
  }

  private startContinuousExecution() {
    if (!this.currentComponent?.mcuRuntime) return;
    this.isRunningContinuous = true;
    const btnRun = this.container?.querySelector("#mcu-btn-run") as HTMLButtonElement;
    if (btnRun) {
      btnRun.textContent = "Pausar";
      btnRun.style.background = "rgba(239, 68, 68, 0.25)";
      btnRun.style.borderColor = "rgba(239, 68, 68, 0.5)";
    }

    const runBatch = () => {
      if (!this.isRunningContinuous || !this.currentComponent?.mcuRuntime) return;
      const res = stepUntilBreakpoint(this.currentComponent.mcuRuntime, this.breakpoints, 200);
      this.updateGPIOFromRuntime();
      this.updateData();
      this.onUpdateCallback();

      if (res.hitBreakpoint || res.halted) {
        this.stopContinuousExecution();
        return;
      }
      this.continuousTimerId = window.setTimeout(runBatch, 20);
    };

    runBatch();
  }

  private stopContinuousExecution() {
    this.isRunningContinuous = false;
    if (this.continuousTimerId !== null) {
      clearTimeout(this.continuousTimerId);
      this.continuousTimerId = null;
    }
    const btnRun = this.container?.querySelector("#mcu-btn-run") as HTMLButtonElement;
    if (btnRun) {
      btnRun.textContent = "Ejecutar";
      btnRun.style.background = "rgba(34, 197, 94, 0.15)";
      btnRun.style.borderColor = "rgba(34, 197, 94, 0.4)";
    }
  }

  private handleFileChange(e: Event) {
    const loader = e.target as HTMLInputElement;
    if (!loader.files || loader.files.length === 0) return;

    const file = loader.files[0];
    const reader = new FileReader();
    const isHex = file.name.toLowerCase().endsWith(".hex");

    reader.onload = (event) => {
      if (!this.currentComponent) return;
      const content = event.target?.result;
      
      const baseDefinition = this.currentComponent.type === 'mcu_avr'
        ? ATMEGA328P_DEFINITIONS
        : STANDARD_8051_DEFINITION;
      const def = {
        ...baseDefinition,
        clockSpeed: this.currentComponent.mcuClockSpeed ?? baseDefinition.clockSpeed,
      };
      
      try {
        if (isHex && typeof content === "string") {
          this.currentComponent.firmware = parseIntelHex(content, def.flashSize);
          this.currentComponent.firmwareHex = content;
        } else if (content instanceof ArrayBuffer) {
          if (content.byteLength > def.flashSize) {
            throw new Error(`El binario excede la flash de ${def.flashSize} bytes.`);
          }
          this.currentComponent.firmware = new Uint8Array(content);
          this.currentComponent.firmwareHex = "[Binario de firmware]";
        } else {
          throw new Error("El archivo no pudo leerse en el formato esperado.");
        }

        this.currentComponent.mcuRuntime = createMcuRuntime({
          definition: def,
          firmware: this.currentComponent.firmware
        });
        this.currentComponent.mcuPinStates = {};
        this.updateGPIOFromRuntime();
        this.updateData();
        this.onUpdateCallback();
        this.setFileStatus(`Firmware cargado (${this.currentComponent.firmware.length} bytes)`, false);
      } catch (error) {
        this.setFileStatus(error instanceof Error ? error.message : "Firmware inválido.", true);
      }
    };
    reader.onerror = () => this.setFileStatus("No se pudo leer el archivo.", true);

    if (isHex) {
      reader.readAsText(file);
    } else {
      reader.readAsArrayBuffer(file);
    }
  }

  private setFileStatus(message: string, isError: boolean) {
    const statusLabel = this.container?.querySelector("#mcu-file-status") as HTMLElement | null;
    if (!statusLabel) return;
    statusLabel.textContent = message;
    statusLabel.style.color = isError ? "var(--danger)" : "var(--accent-cyan)";
  }

  private updateGPIOFromRuntime() {
    if (!this.currentComponent || !this.currentComponent.mcuRuntime) return;
    const runtime = this.currentComponent.mcuRuntime;
    const pinStates: Record<number, number | string> = {};

    if (this.currentComponent.type === 'mcu_8051') {
      const p1 = runtime.memory.sfr[0x90 - 0x80] ?? 0xFF;
      const p3 = runtime.memory.sfr[0xB0 - 0x80] ?? 0xFF;
      const p2 = runtime.memory.sfr[0xA0 - 0x80] ?? 0xFF;
      const p0 = runtime.memory.sfr[0x80 - 0x80] ?? 0xFF;
      
      for (let i = 0; i < 8; i++) {
        pinStates[i] = (p1 & (1 << i)) ? 1 : 0;
        pinStates[9 + i] = (p3 & (1 << i)) ? 1 : 0;
        pinStates[20 + i] = (p2 & (1 << i)) ? 1 : 0;
        pinStates[31 + i] = (p0 & (1 << i)) ? 1 : 0;
      }
      pinStates[8] = 0; pinStates[17] = 0; pinStates[18] = 0; pinStates[19] = 0;
      pinStates[28] = 1; pinStates[29] = 1; pinStates[30] = 1; pinStates[39] = 1;
    } else if (this.currentComponent.type === 'mcu_avr') {
      const portb = runtime.memory.sfr[0x05 - 0x20] ?? 0x00;
      const portc = runtime.memory.sfr[0x08 - 0x20] ?? 0x00;
      const portd = runtime.memory.sfr[0x0B - 0x20] ?? 0x00;
      
      for (let i = 0; i < 8; i++) {
        pinStates[8 + i] = (portb & (1 << i)) ? 1 : 0;
        pinStates[10 + i] = (portd & (1 << i)) ? 1 : 0;
      }
      for (let i = 0; i < 6; i++) {
        pinStates[22 + i] = (portc & (1 << i)) ? 1 : 0;
      }
      pinStates[0] = 1; pinStates[6] = 1; pinStates[7] = 0;
      pinStates[18] = 0; pinStates[19] = 1; pinStates[20] = 1;
    }

    this.currentComponent.mcuPinStates = pinStates;
  }

  public show(comp: ComponentInstance) {
    this.currentComponent = comp;
    if (this.container) {
      this.container.style.display = "flex";
      
      if (!comp.mcuRuntime) {
        const baseDefinition = comp.type === 'mcu_avr'
          ? ATMEGA328P_DEFINITIONS
          : STANDARD_8051_DEFINITION;
        const def = {
          ...baseDefinition,
          clockSpeed: comp.mcuClockSpeed ?? baseDefinition.clockSpeed,
        };
        comp.mcuRuntime = createMcuRuntime({
          definition: def,
          firmware: comp.firmware
        });
      }
      
      this.updateGPIOFromRuntime();
      this.updateData();
    }
  }

  public hide() {
    this.stopContinuousExecution();
    this.currentComponent = null;
    if (this.container) {
      this.container.style.display = "none";
    }
  }

  public updateData() {
    if (!this.currentComponent || !this.currentComponent.mcuRuntime || !this.container) return;
    
    const runtime = this.currentComponent.mcuRuntime;
    const state = getRuntimeState(runtime);
    const isAvr = runtime.definition.architecture === "avr";
    
    // Status text
    const statusLabel = this.container.querySelector("#mcu-file-status") as HTMLElement;
    if (statusLabel) {
      statusLabel.textContent = this.currentComponent.firmware
        ? `Firmware cargado (${this.currentComponent.firmware.length} bytes) - ${isAvr ? "AVR ATmega328P" : "Intel 8051"}`
        : "Sin firmware cargado";
      statusLabel.style.color = this.currentComponent.firmware ? "var(--accent-cyan)" : "var(--text-muted)";
    }

    // Registers Grid
    const regsContainer = this.container.querySelector("#mcu-registers-container") as HTMLElement;
    if (regsContainer) {
      const pcHex = state.pc.toString(16).toUpperCase().padStart(4, "0");
      const spHex = state.sp.toString(16).toUpperCase().padStart(isAvr ? 4 : 2, "0");
      const regs = getRegisterDump(runtime);

      if (isAvr) {
        const r16 = (regs.find(r => r.name === "R16")?.value ?? 0).toString(16).toUpperCase().padStart(2, "0");
        const r17 = (regs.find(r => r.name === "R17")?.value ?? 0).toString(16).toUpperCase().padStart(2, "0");
        const sreg = (regs.find(r => r.name === "SREG")?.value ?? 0).toString(16).toUpperCase().padStart(2, "0");
        regsContainer.innerHTML = `
          <div>PC: <span style="color: var(--accent-cyan); font-weight: bold;">0x${pcHex}</span></div>
          <div>SP: <span style="color: var(--accent-cyan);">0x${spHex}</span></div>
          <div>SREG: <span style="color: var(--accent-purple);">0x${sreg}</span></div>
          <div>R16: <span style="color: var(--accent-green);">0x${r16}</span></div>
          <div>R17: <span style="color: var(--accent-green);">0x${r17}</span></div>
          <div>Ciclos: <span style="color: var(--text-muted);">${state.cycle}</span></div>
        `;
      } else {
        const acc = (regs.find(r => r.name === "A")?.value ?? 0).toString(16).toUpperCase().padStart(2, "0");
        const b = (regs.find(r => r.name === "B")?.value ?? 0).toString(16).toUpperCase().padStart(2, "0");
        const psw = (regs.find(r => r.name === "PSW")?.value ?? 0).toString(16).toUpperCase().padStart(2, "0");
        regsContainer.innerHTML = `
          <div>PC: <span style="color: var(--accent-cyan); font-weight: bold;">0x${pcHex}</span></div>
          <div>SP: <span style="color: var(--accent-cyan);">0x${spHex}</span></div>
          <div>ACC: <span style="color: var(--accent-purple);">0x${acc}</span></div>
          <div>B: <span style="color: var(--accent-purple);">0x${b}</span></div>
          <div>PSW: <span style="color: var(--text-muted);">0x${psw}</span></div>
          <div>Ciclos: <span style="color: var(--text-muted);">${state.cycle}</span></div>
        `;
      }
    }

    // Banderas (Flags)
    const flagsContainer = this.container.querySelector("#mcu-flags-container") as HTMLElement;
    if (flagsContainer) {
      if (isAvr) {
        const sregVal = runtime.memory.sfr[0x3F - 0x20] ?? 0;
        const flags = [
          { name: "I", val: (sregVal & 0x80) !== 0 },
          { name: "T", val: (sregVal & 0x40) !== 0 },
          { name: "H", val: (sregVal & 0x20) !== 0 },
          { name: "S", val: (sregVal & 0x10) !== 0 },
          { name: "V", val: (sregVal & 0x08) !== 0 },
          { name: "N", val: (sregVal & 0x04) !== 0 },
          { name: "Z", val: (sregVal & 0x02) !== 0 },
          { name: "C", val: (sregVal & 0x01) !== 0 },
        ];
        flagsContainer.innerHTML = flags.map(f => `
          <span style="padding: 1px 4px; border-radius: 3px; background: ${f.val ? 'rgba(34, 197, 94, 0.2)' : 'rgba(255,255,255,0.05)'}; color: ${f.val ? '#4ade80' : 'var(--text-muted)'}; font-weight: ${f.val ? 'bold' : 'normal'};">
            ${f.name}:${f.val ? '1' : '0'}
          </span>
        `).join("");
      } else {
        const pswVal = runtime.memory.sfr[0xD0 - 0x80] ?? 0;
        const flags = [
          { name: "CY", val: (pswVal & 0x80) !== 0 },
          { name: "AC", val: (pswVal & 0x40) !== 0 },
          { name: "F0", val: (pswVal & 0x20) !== 0 },
          { name: "RS1", val: (pswVal & 0x10) !== 0 },
          { name: "RS0", val: (pswVal & 0x08) !== 0 },
          { name: "OV", val: (pswVal & 0x04) !== 0 },
          { name: "P", val: (pswVal & 0x01) !== 0 },
        ];
        flagsContainer.innerHTML = flags.map(f => `
          <span style="padding: 1px 4px; border-radius: 3px; background: ${f.val ? 'rgba(34, 197, 94, 0.2)' : 'rgba(255,255,255,0.05)'}; color: ${f.val ? '#4ade80' : 'var(--text-muted)'}; font-weight: ${f.val ? 'bold' : 'normal'};">
            ${f.name}:${f.val ? '1' : '0'}
          </span>
        `).join("");
      }
    }

    // Breakpoint count
    const bpCountElem = this.container.querySelector("#mcu-bp-count") as HTMLElement;
    if (bpCountElem) {
      bpCountElem.textContent = `${this.breakpoints.size} BPs`;
    }

    // Disassembly list
    const disasmList = this.container.querySelector("#mcu-disasm-list") as HTMLElement;
    if (disasmList) {
      disasmList.innerHTML = "";
      const startAddress = Math.max(0, state.pc - 6);
      const instructions = isAvr
        ? disassembleAvr(runtime, startAddress, 15)
        : disassemble8051(runtime, startAddress, 15);
      
      let activeAsmText = "";

      for (const inst of instructions) {
        const line = document.createElement("div");
        line.className = "log-line";
        line.style.display = "flex";
        line.style.alignItems = "center";
        line.style.cursor = "pointer";
        line.style.padding = "2px 4px";
        line.style.borderRadius = "3px";

        const hasBp = this.breakpoints.has(inst.address);
        const isCurrentPc = inst.address === state.pc;

        if (isCurrentPc) {
          line.style.background = "rgba(168, 85, 247, 0.25)";
          line.style.color = "var(--text-bright)";
          line.style.borderLeft = "3px solid var(--accent-purple)";
          line.style.fontWeight = "bold";
          activeAsmText = inst.instruction.mnemonic;
        }

        line.innerHTML = `
          <span style="width: 14px; text-align: center; color: #ef4444; font-size: 0.9rem; line-height: 1;">${hasBp ? "●" : ""}</span>
          <span style="color: var(--text-muted); margin-right: 8px; font-family: var(--font-mono);">0x${inst.address.toString(16).toUpperCase().padStart(4, "0")}</span>
          <span style="flex-grow: 1; font-family: var(--font-mono);">${inst.instruction.mnemonic}</span>
        `;

        // Toggle breakpoint on click
        line.addEventListener("click", () => {
          if (this.breakpoints.has(inst.address)) {
            this.breakpoints.delete(inst.address);
          } else {
            this.breakpoints.add(inst.address);
          }
          this.updateData();
        });

        disasmList.appendChild(line);
      }

      // ASM Explainer
      const explainer = this.container.querySelector("#mcu-asm-explainer") as HTMLElement;
      const explainerText = this.container.querySelector("#mcu-asm-explainer-text") as HTMLElement;
      if (explainer && explainerText) {
        if (activeAsmText) {
          explainer.style.display = "block";
          explainerText.textContent = translateInstructionToSpanish(activeAsmText);
        } else {
          explainer.style.display = "none";
        }
      }

      // Auto-scroll to active instruction
      const activeLine = disasmList.querySelector("[style*='rgba(168, 85, 247, 0.25)']") as HTMLElement;
      if (activeLine) {
        disasmList.scrollTop = activeLine.offsetTop - disasmList.offsetHeight / 2 + activeLine.offsetHeight / 2;
      }
    }

    this.updateWatches();
    this.updateMemoryView();
  }

  private updateWatches() {
    if (!this.currentComponent?.mcuRuntime || !this.container) return;
    const watchListElem = this.container.querySelector("#mcu-watch-list") as HTMLElement;
    if (!watchListElem) return;

    watchListElem.innerHTML = "";

    for (let i = 0; i < this.watchExpressions.length; i++) {
      const expr = this.watchExpressions[i];
      const res: WatchResult = evaluateWatchExpression(expr, this.currentComponent.mcuRuntime);

      const row = document.createElement("div");
      row.style.display = "flex";
      row.style.justifyContent = "space-between";
      row.style.alignItems = "center";
      row.style.background = "rgba(0,0,0,0.3)";
      row.style.padding = "3px 6px";
      row.style.borderRadius = "4px";
      row.style.fontSize = "0.7rem";
      row.style.fontFamily = "var(--font-mono)";

      row.innerHTML = `
        <span style="color: var(--accent-cyan); font-weight: bold; width: 30%; overflow: hidden; text-overflow: ellipsis;">${expr}</span>
        <span style="color: ${res.valid ? '#a855f7' : 'var(--danger)'}; width: 25%;">${res.formattedHex}</span>
        <span style="color: var(--text-muted); width: 20%;">${res.formattedDec}</span>
        <button class="btn-adj" style="height: 18px; width: 18px; padding: 0; line-height: 1; font-size: 0.6rem; color: #ef4444;" title="Eliminar watch">✕</button>
      `;

      const btnDel = row.querySelector("button");
      btnDel?.addEventListener("click", () => {
        this.watchExpressions.splice(i, 1);
        this.updateWatches();
      });

      watchListElem.appendChild(row);
    }
  }

  private updateMemoryView() {
    if (!this.currentComponent?.mcuRuntime || !this.container) return;
    const hexElem = this.container.querySelector("#mcu-memory-hex") as HTMLElement;
    if (!hexElem) return;

    const runtime = this.currentComponent.mcuRuntime;
    let targetMem: Uint8Array;

    if (this.memoryViewTab === "ram") {
      targetMem = runtime.memory.ram;
    } else if (this.memoryViewTab === "sfr") {
      targetMem = runtime.memory.sfr;
    } else {
      targetMem = runtime.memory.flash;
    }

    const rows = formatMemoryDump(targetMem, 0, 128);
    let output = "Dir   00 01 02 03 04 05 06 07  08 09 0A 0B 0C 0D 0E 0F   ASCII\n";
    output += "------------------------------------------------------------------\n";

    for (const r of rows) {
      const hexPart1 = r.hexStrings.slice(0, 8).join(" ");
      const hexPart2 = r.hexStrings.slice(8, 16).join(" ");
      output += `0x${r.addressHex}  ${hexPart1}  ${hexPart2}  |${r.ascii}|\n`;
    }

    hexElem.textContent = output;
  }
}
