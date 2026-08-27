// ==========================================================================
// SUBCIRCUIT INSPECTOR MODAL — Visor y Editor Jerárquico de Macromodelos SPICE
// ==========================================================================

import type { ComponentInstance } from "../canvas_orchestrator";
import { COMMERCIAL_SUBCIRCUITS } from "../simulation/commercial_ic_library";
import { ALL_COMMERCIAL_DISCRETE_MODELS } from "../simulation/commercial_discrete_models";

export interface SubcircuitInspectorState {
  isOpen: boolean;
  activeComponent: ComponentInstance | null;
}

let activeModalElement: HTMLElement | null = null;

/**
 * Abre el inspector jerárquico de macromodelo para un componente dado.
 */
export function openSubcircuitInspector(
  comp: ComponentInstance,
  _onUpdateParams?: (newParams: Record<string, number | string>) => void,
): void {
  closeSubcircuitInspector();

  const modelName = String(comp.modelName || comp.subcircuitName || comp.value || "MACRO");
  const commercialSub = COMMERCIAL_SUBCIRCUITS.find(
    (s) => s.name.toUpperCase() === modelName.toUpperCase(),
  );
  const discreteMod = ALL_COMMERCIAL_DISCRETE_MODELS.find(
    (m) => m.name.toUpperCase() === modelName.toUpperCase(),
  );

  const rawNetlist =
    comp.spiceMacro ||
    commercialSub?.rawNetlist ||
    discreteMod?.rawDefinition ||
    `* Macromodelo ${modelName}\n.SUBCKT ${modelName}\n* Sin netlist embebido\n.ENDS`;

  const pinLabels = comp.pinLabels ? Object.entries(comp.pinLabels) : [];
  const description =
    commercialSub?.description ||
    discreteMod?.description ||
    comp.label ||
    `Macromodelo SPICE jerárquico (${modelName}).`;

  const modal = document.createElement("div");
  modal.className = "subcircuit-inspector-overlay";
  modal.style.cssText = `
    position: fixed;
    top: 0;
    left: 0;
    width: 100vw;
    height: 100vh;
    background: rgba(0, 0, 0, 0.75);
    backdrop-filter: blur(8px);
    display: flex;
    align-items: center;
    justify-content: center;
    z-index: 9999;
    font-family: 'Inter', system-ui, sans-serif;
  `;

  const container = document.createElement("div");
  container.className = "subcircuit-inspector-dialog";
  container.style.cssText = `
    background: #0f172a;
    border: 1px solid rgba(56, 189, 248, 0.3);
    border-radius: 12px;
    width: 90%;
    max-width: 680px;
    max-height: 85vh;
    display: flex;
    flex-direction: column;
    box-shadow: 0 20px 40px rgba(0, 0, 0, 0.6);
    overflow: hidden;
    color: #f8fafc;
  `;

  container.innerHTML = `
    <div style="padding: 16px 20px; background: rgba(30, 41, 59, 0.8); border-bottom: 1px solid rgba(255, 255, 255, 0.1); display: flex; justify-content: space-between; align-items: center;">
      <div>
        <h3 style="margin: 0; font-size: 16px; font-weight: 700; color: #38bdf8; display: flex; align-items: center; gap: 8px;">
          <span>🔍</span> Inspector de Macromodelo: ${modelName}
        </h3>
        <p style="margin: 4px 0 0 0; font-size: 12px; color: #94a3b8;">${description}</p>
      </div>
      <button id="close-inspector-btn" style="background: transparent; border: none; color: #94a3b8; font-size: 20px; cursor: pointer; padding: 4px 8px; border-radius: 4px;">✕</button>
    </div>

    <div style="padding: 20px; overflow-y: auto; display: flex; flex-direction: column; gap: 16px;">
      <!-- Terminales del Componente -->
      <div>
        <h4 style="margin: 0 0 8px 0; font-size: 13px; text-transform: uppercase; letter-spacing: 0.5px; color: #94a3b8;">Mapa de Terminales y Pines</h4>
        <div style="display: grid; grid-template-columns: repeat(auto-fill, minmax(120px, 1fr)); gap: 8px;">
          ${
            pinLabels.length > 0
              ? pinLabels
                  .map(
                    ([idx, label]) => `
              <div style="background: rgba(30, 41, 59, 0.5); border: 1px solid rgba(255, 255, 255, 0.08); padding: 6px 10px; border-radius: 6px; font-size: 12px;">
                <span style="color: #64748b; font-weight: bold;">#${Number(idx) + 1}</span>
                <span style="color: #38bdf8; font-family: monospace; font-weight: 600; margin-left: 4px;">${label}</span>
              </div>
            `,
                  )
                  .join("")
              : '<p style="font-size: 12px; color: #64748b; margin: 0;">Pines estándar definidos en modelo.</p>'
          }
        </div>
      </div>

      <!-- Netlist SPICE -->
      <div>
        <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 6px;">
          <h4 style="margin: 0; font-size: 13px; text-transform: uppercase; letter-spacing: 0.5px; color: #94a3b8;">Definición SPICE (.SUBCKT / .MODEL)</h4>
          <button id="copy-spice-btn" style="background: rgba(56, 189, 248, 0.15); border: 1px solid rgba(56, 189, 248, 0.3); color: #38bdf8; font-size: 11px; padding: 4px 8px; border-radius: 4px; cursor: pointer;">📋 Copiar SPICE</button>
        </div>
        <pre style="background: #020617; border: 1px solid rgba(255, 255, 255, 0.1); border-radius: 6px; padding: 12px; font-family: 'JetBrains Mono', monospace; font-size: 11px; line-height: 1.5; color: #a5f3fc; overflow-x: auto; margin: 0; max-height: 240px;">${rawNetlist}</pre>
      </div>
    </div>

    <div style="padding: 12px 20px; background: rgba(30, 41, 59, 0.6); border-top: 1px solid rgba(255, 255, 255, 0.1); display: flex; justify-content: flex-end; gap: 8px;">
      <button id="close-modal-footer-btn" style="background: #334155; border: none; color: #f8fafc; font-size: 12px; font-weight: 600; padding: 8px 16px; border-radius: 6px; cursor: pointer;">Cerrar</button>
    </div>
  `;

  modal.appendChild(container);
  document.body.appendChild(modal);
  activeModalElement = modal;

  // Event Listeners
  const closeBtn = container.querySelector("#close-inspector-btn");
  const footerCloseBtn = container.querySelector("#close-modal-footer-btn");
  const copyBtn = container.querySelector("#copy-spice-btn") as HTMLButtonElement;

  const handleClose = () => closeSubcircuitInspector();
  closeBtn?.addEventListener("click", handleClose);
  footerCloseBtn?.addEventListener("click", handleClose);

  modal.addEventListener("click", (e) => {
    if (e.target === modal) handleClose();
  });

  copyBtn?.addEventListener("click", async () => {
    try {
      await navigator.clipboard.writeText(rawNetlist);
      copyBtn.textContent = "✓ Copiado";
      setTimeout(() => {
        if (copyBtn) copyBtn.textContent = "📋 Copiar SPICE";
      }, 1500);
    } catch (e) {}
  });
}

/**
 * Cierra y desmonta el inspector de macromodelos si está abierto.
 */
export function closeSubcircuitInspector(): void {
  if (activeModalElement) {
    try {
      document.body.removeChild(activeModalElement);
    } catch (e) {}
    activeModalElement = null;
  }
}
