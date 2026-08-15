import { parseSpiceLibrary, type ParsedSubcircuit } from "../simulation/spice_library_parser";
import { addSubcircuitCardToPalette } from "./component_palette_controller";

let modalElement: HTMLElement | null = null;
let parsedSubcircuitsCache: ParsedSubcircuit[] = [];

/**
 * Abre el Modal de Importación de Bibliotecas SPICE.
 */
export function openSpiceImportModal(): void {
  if (!modalElement) {
    createSpiceImportModalDOM();
  }

  if (modalElement) {
    modalElement.style.display = "flex";
    const textarea = modalElement.querySelector<HTMLTextAreaElement>("#spice-import-textarea");
    if (textarea) textarea.focus();
  }
}

/**
 * Cierra el Modal de Importación de Bibliotecas SPICE.
 */
export function closeSpiceImportModal(): void {
  if (modalElement) {
    modalElement.style.display = "none";
  }
}

function createSpiceImportModalDOM(): void {
  const modal = document.createElement("div");
  modal.id = "spice-import-modal";
  modal.className = "modal-backdrop";
  modal.style.cssText = `
    position: fixed;
    inset: 0;
    background: rgba(10, 15, 26, 0.78);
    backdrop-filter: blur(8px);
    z-index: 1000;
    display: none;
    align-items: center;
    justify-content: center;
  `;

  modal.innerHTML = `
    <div class="modal-dialog" style="
      background: #151A22;
      border: 1px solid #30363D;
      border-radius: 10px;
      width: 680px;
      max-width: 95vw;
      max-height: 88vh;
      display: flex;
      flex-direction: column;
      box-shadow: 0 20px 40px rgba(0,0,0,0.6);
      color: #E6EDF3;
      font-family: 'Inter', sans-serif;
      overflow: hidden;
    ">
      <!-- Modal Header -->
      <div style="
        padding: 16px 20px;
        border-bottom: 1px solid #21262D;
        display: flex;
        align-items: center;
        justify-content: space-between;
      ">
        <div style="display: flex; align-items: center; gap: 10px;">
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="#38BDF8" stroke-width="2">
            <path d="M4 4h16c1.1 0 2 .9 2 2v12c0 1.1-.9 2-2 2H4c-1.1 0-2-.9-2-2V6c0-1.1.9-2 2-2z"/>
            <polyline points="22,6 12,13 2,6"/>
          </svg>
          <span style="font-size: 15px; font-weight: 600;">Importar Biblioteca SPICE (.lib / .subckt / .mod)</span>
        </div>
        <button id="btn-close-spice-modal" style="
          background: transparent;
          border: none;
          color: #8B949E;
          font-size: 18px;
          cursor: pointer;
          padding: 4px 8px;
          border-radius: 4px;
        ">&times;</button>
      </div>

      <!-- Modal Body -->
      <div style="padding: 20px; overflow-y: auto; display: flex; flex-direction: column; gap: 16px; flex: 1;">
        <!-- Dropzone / Input -->
        <div id="spice-dropzone" style="
          border: 2px dashed #30363D;
          border-radius: 8px;
          padding: 20px;
          text-align: center;
          background: #0D1117;
          cursor: pointer;
          transition: border-color 0.2s;
        ">
          <input type="file" id="spice-file-input" accept=".lib,.mod,.cir,.subckt,.txt" style="display: none;" />
          <p style="margin: 0 0 6px 0; font-size: 13px; color: #C9D1D9;">
            Arrastra un archivo <strong>.lib</strong>, <strong>.subckt</strong> o <strong>.mod</strong> aquí o <span style="color: #38BDF8; text-decoration: underline;">selecciona un archivo</span>
          </p>
          <span style="font-size: 11px; color: #8B949E;">Soporta modelos de TI, Analog Devices, ST, ON Semi, etc.</span>
        </div>

        <!-- Textarea para pegar código SPICE -->
        <div>
          <label style="display: block; font-size: 12px; font-weight: 500; color: #8B949E; margin-bottom: 6px;">
            O pega el código de macromodelos SPICE (.SUBCKT ... .ENDS):
          </label>
          <textarea id="spice-import-textarea" placeholder=".SUBCKT LM741 IN+ IN- VCC VEE OUT&#10;...&#10;.ENDS LM741" style="
            width: 100%;
            height: 120px;
            background: #0D1117;
            border: 1px solid #30363D;
            border-radius: 6px;
            color: #58A6FF;
            font-family: 'JetBrains Mono', monospace;
            font-size: 12px;
            padding: 10px;
            box-sizing: border-box;
            resize: vertical;
          "></textarea>
        </div>

        <!-- Contenedor de Subcircuitos Detectados -->
        <div id="spice-detected-container" style="display: none; flex-direction: column; gap: 8px;">
          <span style="font-size: 12px; font-weight: 600; color: #38BDF8;">Macromodelos Detectados:</span>
          <div id="spice-detected-list" style="
            max-height: 180px;
            overflow-y: auto;
            border: 1px solid #21262D;
            border-radius: 6px;
            background: #0D1117;
            padding: 8px;
            display: flex;
            flex-direction: column;
            gap: 6px;
          "></div>
        </div>
      </div>

      <!-- Modal Footer -->
      <div style="
        padding: 14px 20px;
        border-top: 1px solid #21262D;
        display: flex;
        align-items: center;
        justify-content: flex-end;
        gap: 10px;
        background: #11151C;
      ">
        <button id="btn-analyze-spice" style="
          background: #21262D;
          border: 1px solid #30363D;
          color: #C9D1D9;
          font-size: 12px;
          font-weight: 500;
          padding: 7px 14px;
          border-radius: 6px;
          cursor: pointer;
        ">Analizar Código</button>

        <button id="btn-register-spice" disabled style="
          background: #238636;
          border: 1px solid rgba(240, 246, 252, 0.1);
          color: #FFFFFF;
          font-size: 12px;
          font-weight: 600;
          padding: 7px 16px;
          border-radius: 6px;
          cursor: not-allowed;
          opacity: 0.6;
        ">Registrar en la Paleta</button>
      </div>
    </div>
  `;

  document.body.appendChild(modal);
  modalElement = modal;

  // Event Listeners
  const closeBtn = modal.querySelector<HTMLButtonElement>("#btn-close-spice-modal");
  closeBtn?.addEventListener("click", closeSpiceImportModal);

  modal.addEventListener("click", (e) => {
    if (e.target === modal) closeSpiceImportModal();
  });

  const dropzone = modal.querySelector<HTMLElement>("#spice-dropzone");
  const fileInput = modal.querySelector<HTMLInputElement>("#spice-file-input");
  const textarea = modal.querySelector<HTMLTextAreaElement>("#spice-import-textarea");
  const analyzeBtn = modal.querySelector<HTMLButtonElement>("#btn-analyze-spice");
  const registerBtn = modal.querySelector<HTMLButtonElement>("#btn-register-spice");
  const detectedContainer = modal.querySelector<HTMLElement>("#spice-detected-container");
  const detectedList = modal.querySelector<HTMLElement>("#spice-detected-list");

  dropzone?.addEventListener("click", () => fileInput?.click());

  fileInput?.addEventListener("change", () => {
    const file = fileInput.files?.[0];
    if (!file) return;

    const reader = new FileReader();
    reader.onload = (event) => {
      const text = String(event.target?.result ?? "");
      if (textarea) textarea.value = text;
      runAnalysis(text);
    };
    reader.readAsText(file);
  });

  dropzone?.addEventListener("dragover", (e) => {
    e.preventDefault();
    dropzone.style.borderColor = "#38BDF8";
  });

  dropzone?.addEventListener("dragleave", () => {
    dropzone.style.borderColor = "#30363D";
  });

  dropzone?.addEventListener("drop", (e) => {
    e.preventDefault();
    dropzone.style.borderColor = "#30363D";
    const file = e.dataTransfer?.files[0];
    if (!file) return;

    const reader = new FileReader();
    reader.onload = (event) => {
      const text = String(event.target?.result ?? "");
      if (textarea) textarea.value = text;
      runAnalysis(text);
    };
    reader.readAsText(file);
  });

  analyzeBtn?.addEventListener("click", () => {
    if (textarea) runAnalysis(textarea.value);
  });

  registerBtn?.addEventListener("click", () => {
    const checkboxes = detectedList?.querySelectorAll<HTMLInputElement>("input[type='checkbox']:checked");
    if (!checkboxes || checkboxes.length === 0) return;

    let registeredCount = 0;
    checkboxes.forEach((cb) => {
      const index = parseInt(cb.dataset.index ?? "-1", 10);
      const subckt = parsedSubcircuitsCache[index];
      if (subckt) {
        addSubcircuitCardToPalette(subckt);
        registeredCount++;
      }
    });

    closeSpiceImportModal();
  });

  function runAnalysis(text: string): void {
    if (!text.trim()) return;

    const parsed = parseSpiceLibrary(text);
    parsedSubcircuitsCache = [...parsed.subcircuits];

    if (!detectedContainer || !detectedList || !registerBtn) return;

    detectedList.innerHTML = "";

    if (parsed.subcircuits.length === 0) {
      detectedContainer.style.display = "flex";
      detectedList.innerHTML = `<span style="font-size: 12px; color: #F85149; padding: 6px;">No se encontraron directivas .SUBCKT válidas en el texto proporcionado.</span>`;
      registerBtn.disabled = true;
      registerBtn.style.opacity = "0.6";
      registerBtn.style.cursor = "not-allowed";
      return;
    }

    detectedContainer.style.display = "flex";

    parsed.subcircuits.forEach((sub, idx) => {
      const item = document.createElement("div");
      item.style.cssText = `
        display: flex;
        align-items: center;
        justify-content: space-between;
        padding: 8px 10px;
        background: #161B22;
        border: 1px solid #30363D;
        border-radius: 6px;
      `;

      const pinBadges = sub.pinNames
        .map(
          (p) =>
            `<span style="background: #21262D; color: #79C0FF; font-size: 10px; font-family: monospace; padding: 2px 6px; border-radius: 3px; border: 1px solid #30363D;">${p}</span>`,
        )
        .join(" ");

      item.innerHTML = `
        <div style="display: flex; align-items: center; gap: 10px;">
          <input type="checkbox" checked data-index="${idx}" id="sub-check-${idx}" style="cursor: pointer;" />
          <div>
            <div style="font-size: 13px; font-weight: 600; color: #E6EDF3;">${sub.name} <span style="font-size: 11px; font-weight: normal; color: #8B949E;">(${sub.category})</span></div>
            <div style="font-size: 11px; color: #8B949E; margin-top: 2px;">${sub.description}</div>
            <div style="margin-top: 5px; display: flex; gap: 4px; flex-wrap: wrap;">${pinBadges}</div>
          </div>
        </div>
      `;
      detectedList.appendChild(item);
    });

    registerBtn.disabled = false;
    registerBtn.style.opacity = "1";
    registerBtn.style.cursor = "pointer";
  }
}
