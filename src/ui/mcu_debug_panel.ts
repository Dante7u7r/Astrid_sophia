import { 
  createMcuRuntime, 
  resetRuntime, 
  singleStep, 
  getRuntimeState, 
  getRegisterDump, 
  disassemble8051,
  STANDARD_8051_DEFINITION,
  ATMEGA328P_DEFINITIONS
} from "../simulation";
import type { ComponentInstance } from "../canvas_orchestrator";

// Intel HEX file parser
export function parseIntelHex(hexStr: string, flashSize: number): Uint8Array {
  const flash = new Uint8Array(flashSize);
  const lines = hexStr.split(/\r?\n/);
  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed.startsWith(":")) continue;
    
    const byteCount = parseInt(trimmed.substring(1, 3), 16);
    const address = parseInt(trimmed.substring(3, 7), 16);
    const recordType = parseInt(trimmed.substring(7, 9), 16);
    
    if (recordType === 0) { // Data record
      for (let i = 0; i < byteCount; i++) {
        const byteVal = parseInt(trimmed.substring(9 + i * 2, 9 + i * 2 + 2), 16);
        if (address + i < flashSize) {
          
          flash[address + i] = byteVal;
        }
      }
    } else if (recordType === 1) { // End of File
      break;
    }
  }
  return flash;
}

export class McuDebugPanel {
  private container: HTMLDivElement | null = null;
  private currentComponent: ComponentInstance | null = null;
  private onUpdateCallback: () => void = () => {};

  constructor(parent: HTMLElement, onUpdate: () => void) {
    this.onUpdateCallback = onUpdate;
    this.initUI(parent);
  }

  private initUI(parent: HTMLElement) {
    // Create container
    this.container = document.createElement("div");
    this.container.id = "mcu-debug-container";
    this.container.className = "properties-form";
    this.container.style.display = "none";
    this.container.style.borderTop = "1px solid var(--border-color)";
    this.container.style.paddingTop = "16px";
    this.container.style.marginTop = "8px";
    
    this.container.innerHTML = `
      <div class="property-group">
        <label class="property-label">Firmware del MCU</label>
        <div class="mcu-firmware-area">
          <input type="file" id="mcu-file-loader" accept=".hex,.bin" style="display: none;" />
          <button id="mcu-btn-upload" class="btn-ctrl" style="width: 100%; justify-content: center; background: rgba(255,255,255,0.03); border: 1px solid var(--border-color); padding: 8px;">
            📥 Cargar Código (.HEX / .BIN)
          </button>
          <span id="mcu-file-status" class="comp-desc" style="display: block; text-align: center; margin-top: 6px; color: var(--text-muted);">Sin firmware cargado</span>
        </div>
      </div>

      <div class="property-group">
        <label class="property-label">Control de Depuración</label>
        <div class="mcu-debug-controls" style="display: flex; gap: 8px; justify-content: space-between;">
          <button id="mcu-btn-run" class="btn-adj" style="flex-grow: 1; height: 32px;" title="Iniciar Ejecución">▶</button>
          <button id="mcu-btn-step" class="btn-adj" style="flex-grow: 1; height: 32px;" title="Paso a Paso">⏯</button>
          <button id="mcu-btn-reset" class="btn-adj" style="flex-grow: 1; height: 32px;" title="Reiniciar">↺</button>
        </div>
      </div>

      <div class="property-group">
        <label class="property-label">Registros Internos</label>
        <div class="mcu-registers-grid" style="display: grid; grid-template-columns: repeat(2, 1fr); gap: 6px; background: rgba(0,0,0,0.3); padding: 10px; border-radius: 8px; font-family: var(--font-mono); font-size: 0.75rem;">
          <div>PC: <span id="mcu-reg-pc" style="color: var(--accent-cyan);">0000</span></div>
          <div>SP: <span id="mcu-reg-sp" style="color: var(--accent-cyan);">00</span></div>
          <div>ACC: <span id="mcu-reg-acc" style="color: var(--accent-purple);">00</span></div>
          <div>B: <span id="mcu-reg-b" style="color: var(--accent-purple);">00</span></div>
          <div>PSW: <span id="mcu-reg-psw" style="color: var(--text-muted);">00</span></div>
          <div>Ciclos: <span id="mcu-reg-cycles" style="color: var(--text-muted);">0</span></div>
        </div>
      </div>

      <div class="property-group">
        <label class="property-label">Desensamblado de Código</label>
        <div id="mcu-disasm-list" class="console-output" style="height: 140px; border: 1px solid var(--border-color); border-radius: 8px; font-size: 0.7rem; padding: 8px; overflow-y: auto; background: rgba(0,0,0,0.5);">
          <!-- Instructions fill dynamically -->
        </div>
        <div id="mcu-asm-explainer" class="comp-desc" style="margin-top: 8px; padding: 8px; border-radius: 6px; background: rgba(168, 85, 247, 0.08); border: 1px solid rgba(168, 85, 247, 0.2); font-size: 0.72rem; color: var(--text-main); display: none;">
          <strong>Asistente ASM:</strong> <span id="mcu-asm-explainer-text">Selecciona una instrucción para ver su explicación.</span>
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
    const btnStep = this.container?.querySelector("#mcu-btn-step") as HTMLButtonElement;
    const btnReset = this.container?.querySelector("#mcu-btn-reset") as HTMLButtonElement;

    btnUpload?.addEventListener("click", () => fileLoader?.click());
    fileLoader?.addEventListener("change", (e) => this.handleFileChange(e));

    btnStep?.addEventListener("click", () => {
      if (this.currentComponent && this.currentComponent.mcuRuntime) {
        singleStep(this.currentComponent.mcuRuntime);
        this.updateGPIOFromRuntime();
        this.updateData();
        this.onUpdateCallback();
      }
    });

    btnReset?.addEventListener("click", () => {
      if (this.currentComponent && this.currentComponent.mcuRuntime) {
        resetRuntime(this.currentComponent.mcuRuntime);
        this.updateGPIOFromRuntime();
        this.updateData();
        this.onUpdateCallback();
      }
    });

    btnRun?.addEventListener("click", () => {
      // Toggle run mode for debug panel (simulated cycle stepping)
      if (this.currentComponent && this.currentComponent.mcuRuntime) {
        const runtime = this.currentComponent.mcuRuntime;
        runtime.state.running = !runtime.state.running;
        btnRun.textContent = runtime.state.running ? "⏸" : "▶";
        btnRun.title = runtime.state.running ? "Pausar" : "Iniciar Ejecución";
        if (runtime.state.running) {
          this.startVisualRunLoop();
        }
      }
    });
  }

  private startVisualRunLoop() {
    const stepLoop = () => {
      if (this.currentComponent && this.currentComponent.mcuRuntime && this.currentComponent.mcuRuntime.state.running) {
        for (let i = 0; i < 1000; i++) {
          singleStep(this.currentComponent.mcuRuntime);
        }
        this.updateGPIOFromRuntime();
        this.updateData();
        this.onUpdateCallback();
        requestAnimationFrame(stepLoop);
      } else {
        const btnRun = this.container?.querySelector("#mcu-btn-run") as HTMLButtonElement;
        if (btnRun) btnRun.textContent = "▶";
      }
    };
    requestAnimationFrame(stepLoop);
  }

  private handleFileChange(e: Event) {
    const loader = e.target as HTMLInputElement;
    if (!loader.files || loader.files.length === 0) return;

    const file = loader.files[0];
    const reader = new FileReader();
    
    const isHex = file.name.endsWith(".hex");

    reader.onload = (event) => {
      if (!this.currentComponent) return;
      const content = event.target?.result;
      
      const def = this.currentComponent.type === 'mcu_avr' ? ATMEGA328P_DEFINITIONS : STANDARD_8051_DEFINITION;
      
      if (isHex && typeof content === "string") {
        this.currentComponent.firmwareHex = content;
        this.currentComponent.firmware = parseIntelHex(content, def.flashSize);
      } else if (content instanceof ArrayBuffer) {
        this.currentComponent.firmware = new Uint8Array(content);
        this.currentComponent.firmwareHex = "[Binario de firmware]";
      }

      // Recreate runtime with firmware
      this.currentComponent.mcuRuntime = createMcuRuntime({
        definition: def,
        firmware: this.currentComponent.firmware
      });
      
      // Clear pin states
      this.currentComponent.mcuPinStates = {};
      
      this.updateGPIOFromRuntime();
      this.updateData();
      this.onUpdateCallback();
    };

    if (isHex) {
      reader.readAsText(file);
    } else {
      reader.readAsArrayBuffer(file);
    }
  }

  private updateGPIOFromRuntime() {
    if (!this.currentComponent || !this.currentComponent.mcuRuntime) return;
    const runtime = this.currentComponent.mcuRuntime;
    
    // For 8051: P0 (0x80), P1 (0x90), P2 (0xA0), P3 (0xB0)
    // For AVR: PORTB (0x05), PORTC (0x08), PORTD (0x0B)
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
      pinStates[8] = 0; // RST
      pinStates[17] = 0; // XTAL2
      pinStates[18] = 0; // XTAL1
      pinStates[19] = 0; // GND
      pinStates[28] = 1; // PSEN
      pinStates[29] = 1; // ALE
      pinStates[30] = 1; // EA
      pinStates[39] = 1; // VCC
    } else if (this.currentComponent.type === 'mcu_avr') {
      const portb = runtime.memory.sfr[0x05 - 0x80] ?? 0x00;
      const portc = runtime.memory.sfr[0x08 - 0x80] ?? 0x00;
      const portd = runtime.memory.sfr[0x0B - 0x80] ?? 0x00;
      
      for (let i = 0; i < 8; i++) {
        pinStates[8 + i] = (portb & (1 << i)) ? 1 : 0;
        pinStates[10 + i] = (portd & (1 << i)) ? 1 : 0;
      }
      for (let i = 0; i < 6; i++) {
        pinStates[22 + i] = (portc & (1 << i)) ? 1 : 0;
      }
      pinStates[0] = 1; // RESET
      pinStates[6] = 1; // VCC
      pinStates[7] = 0; // GND
      pinStates[18] = 0; // GND
      pinStates[19] = 1; // AVCC
      pinStates[20] = 1; // AREF
    }

    this.currentComponent.mcuPinStates = pinStates;
  }

  public show(comp: ComponentInstance) {
    this.currentComponent = comp;
    if (this.container) {
      this.container.style.display = "flex";
      
      // Initialize runtime if not already done
      if (!comp.mcuRuntime) {
        const def = comp.type === 'mcu_avr' ? ATMEGA328P_DEFINITIONS : STANDARD_8051_DEFINITION;
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
    this.currentComponent = null;
    if (this.container) {
      this.container.style.display = "none";
    }
  }

  public updateData() {
    if (!this.currentComponent || !this.currentComponent.mcuRuntime || !this.container) return;
    
    const runtime = this.currentComponent.mcuRuntime;
    const state = getRuntimeState(runtime);
    
    // Status text
    const statusLabel = this.container.querySelector("#mcu-file-status") as HTMLElement;
    if (statusLabel) {
      statusLabel.textContent = this.currentComponent.firmwareHex 
        ? `Código Cargado (${this.currentComponent.firmware?.length} bytes)` 
        : "Sin firmware cargado";
      statusLabel.style.color = this.currentComponent.firmwareHex ? "var(--accent-cyan)" : "var(--text-muted)";
    }

    // Controls button text
    const btnRun = this.container.querySelector("#mcu-btn-run") as HTMLButtonElement;
    if (btnRun) {
      btnRun.textContent = state.running ? "⏸" : "▶";
    }

    // Registers
    const pcElem = this.container.querySelector("#mcu-reg-pc") as HTMLElement;
    const spElem = this.container.querySelector("#mcu-reg-sp") as HTMLElement;
    const accElem = this.container.querySelector("#mcu-reg-acc") as HTMLElement;
    const bElem = this.container.querySelector("#mcu-reg-b") as HTMLElement;
    const pswElem = this.container.querySelector("#mcu-reg-psw") as HTMLElement;
    const cyclesElem = this.container.querySelector("#mcu-reg-cycles") as HTMLElement;

    if (pcElem) pcElem.textContent = state.pc.toString(16).toUpperCase().padStart(4, "0");
    if (spElem) spElem.textContent = state.sp.toString(16).toUpperCase().padStart(2, "0");
    
    const regs = getRegisterDump(runtime);
    if (accElem) accElem.textContent = (regs.find(r => r.name === "A")?.value ?? 0).toString(16).toUpperCase().padStart(2, "0");
    if (bElem) bElem.textContent = (regs.find(r => r.name === "B")?.value ?? 0).toString(16).toUpperCase().padStart(2, "0");
    if (pswElem) pswElem.textContent = (regs.find(r => r.name === "PSW")?.value ?? 0).toString(16).toUpperCase().padStart(2, "0");
    if (cyclesElem) cyclesElem.textContent = state.cycle.toString();

    // Disassembly list
    const disasmList = this.container.querySelector("#mcu-disasm-list") as HTMLElement;
    if (disasmList) {
      disasmList.innerHTML = "";
      
      const startAddress = Math.max(0, state.pc - 8);
      const instructions = disassemble8051(runtime, startAddress, 15);
      
      let activeAsmText = "";
      
      for (const inst of instructions) {
        const line = document.createElement("div");
        line.className = "log-line";
        if (inst.address === state.pc) {
          line.style.background = "rgba(168, 85, 247, 0.25)";
          line.style.color = "var(--text-bright)";
          line.style.borderLeft = "2px solid var(--accent-purple)";
          line.style.paddingLeft = "4px";
          line.style.fontWeight = "bold";
          activeAsmText = inst.instruction.mnemonic;
        }
        
        const addrStr = inst.address.toString(16).toUpperCase().padStart(4, "0");
        line.innerHTML = `<span style="color: var(--text-muted); margin-right: 8px;">0x${addrStr}</span> ${inst.instruction.mnemonic}`;
        disasmList.appendChild(line);
      }
      
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
      
      // Auto-scroll to center the current instruction
      const activeLine = disasmList.querySelector("[style*='rgba(168, 85, 247, 0.25)']") as HTMLElement;
      if (activeLine) {
        disasmList.scrollTop = activeLine.offsetTop - disasmList.offsetHeight / 2 + activeLine.offsetHeight / 2;
      }
    }
  }
}

function translateInstructionToSpanish(mnemonic: string): string {
  const cleanMnemonic = mnemonic.trim().toUpperCase();
  const parts = cleanMnemonic.split(/\s+/);
  const op = parts[0];
  const args = parts.slice(1).join(" ");

  switch (op) {
    case "NOP":
      return "No realiza ninguna operación (Consume 1 ciclo de reloj).";
    case "MOV": {
      const ops = args.split(",");
      const dest = ops[0] ? ops[0].trim() : "";
      const src = ops[1] ? ops[1].trim() : "";
      return `Mueve/Copia el valor de ${src} a ${dest}.`;
    }
    case "ADD":
      return `Suma el valor de ${args} al Acumulador (A).`;
    case "ADDC":
      return `Suma con acarreo (Carry) el valor de ${args} al Acumulador (A).`;
    case "SUBB":
      return `Resta con acarreo el valor de ${args} del Acumulador (A).`;
    case "INC":
      return `Incrementa en 1 el valor de ${args}.`;
    case "DEC":
      return `Decrementa en 1 el valor de ${args}.`;
    case "MUL":
      return "Multiplica los registros A y B. El resultado se guarda en A y B.";
    case "DIV":
      return "Divide el registro A entre el registro B. El cociente va a A y el residuo a B.";
    case "ANL": {
      const ops = args.split(",");
      return `Realiza una operación lógica AND de ${ops[1] || ""} sobre ${ops[0] || ""}.`;
    }
    case "ORL": {
      const ops = args.split(",");
      return `Realiza una operación lógica OR de ${ops[1] || ""} sobre ${ops[0] || ""}.`;
    }
    case "XRL": {
      const ops = args.split(",");
      return `Realiza una operación lógica XOR de ${ops[1] || ""} sobre ${ops[0] || ""}.`;
    }
    case "CLR":
      return `Limpia/Pone en cero el registro o bit ${args}.`;
    case "SETB":
      return `Activa/Pone en uno el bit ${args}.`;
    case "CPL":
      return `Complementa/Invierte los bits de ${args}.`;
    case "LJMP":
      return `Salto largo incondicional a la dirección de memoria ${args}.`;
    case "AJMP":
      return `Salto absoluto a la dirección de memoria ${args}.`;
    case "SJMP":
      return `Salto relativo corto a la dirección ${args}.`;
    case "JZ":
      return `Salta a la etiqueta ${args} si el Acumulador (A) es igual a cero.`;
    case "JNZ":
      return `Salta a la etiqueta ${args} si el Acumulador (A) es diferente de cero.`;
    case "JC":
      return `Salta a la etiqueta ${args} si el indicador de Acarreo (Carry) está activo.`;
    case "JNC":
      return `Salta a la etiqueta ${args} si el indicador de Acarreo (Carry) está inactivo.`;
    case "JB": {
      const ops = args.split(",");
      return `Salta a la etiqueta ${ops[1] || ""} si el bit ${ops[0] || ""} está activo (1).`;
    }
    case "JNB": {
      const ops = args.split(",");
      return `Salta a la etiqueta ${ops[1] || ""} si el bit ${ops[0] || ""} está inactivo (0).`;
    }
    case "JBC": {
      const ops = args.split(",");
      return `Salta a la etiqueta ${ops[1] || ""} si el bit ${ops[0] || ""} está activo, y luego limpia el bit.`;
    }
    case "CJNE": {
      const ops = args.split(",");
      return `Compara ${ops[0] || ""} con ${ops[1] || ""} y salta a la dirección ${ops[2] || ""} si no son iguales.`;
    }
    case "DJNZ": {
      const ops = args.split(",");
      return `Decrementa ${ops[0] || ""} en 1 y salta a la etiqueta ${ops[1] || ""} si no es cero.`;
    }
    case "ACALL":
      return `Llamada absoluta a la subrutina en la dirección ${args}.`;
    case "LCALL":
      return `Llamada larga a la subrutina en la dirección ${args}.`;
    case "RET":
      return "Retorna de una llamada a subrutina restaurando el program counter (PC) de la pila.";
    case "RETI":
      return "Retorna de una subrutina de interrupción, restaurando el estado e interrupciones.";
    case "PUSH":
      return `Empuja el valor de ${args} a la pila (Stack), incrementando SP.`;
    case "POP":
      return `Saca el valor de la pila (Stack) y lo guarda en ${args}, decrementando SP.`;
    case "RL":
      return "Rota el contenido del Acumulador (A) a la izquierda de forma circular.";
    case "RLC":
      return "Rota el contenido del Acumulador (A) a la izquierda a través del bit de Acarreo (Carry).";
    case "RR":
      return "Rota el contenido del Acumulador (A) a la derecha de forma circular.";
    case "RRC":
      return "Rota el contenido del Acumulador (A) a la derecha a través del bit de Acarreo (Carry).";
    case "SWAP":
      return "Intercambia los nibbles altos y bajos (4 bits) del Acumulador (A).";
    default:
      if (cleanMnemonic.startsWith("LDI")) {
        return "Carga un valor inmediato directamente en un registro de trabajo.";
      }
      if (cleanMnemonic.startsWith("STS") || cleanMnemonic.startsWith("OUT")) {
        return "Escribe el contenido del registro en el espacio de E/S o periféricos.";
      }
      if (cleanMnemonic.startsWith("IN")) {
        return "Lee el contenido de un pin de puerto o registro de E/S hacia la CPU.";
      }
      return `Ejecuta la instrucción '${op}' con argumentos '${args}'.`;
  }
}
