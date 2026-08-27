// ==========================================================================
// ASTRYD SOPHIA — MODAL INSPECTOR PEDAGÓGICO DE LA MATRIZ MNA
// ==========================================================================
// Permite a estudiantes, docentes e investigadores inspeccionar la formulación
// algebraica y numérica exacta del Modified Nodal Analysis (MNA), con copia
// de ecuaciones a LaTeX para informes y exámenes.
// ==========================================================================

import type { CircuitNetlist } from "../simulation/netlist_extractor";
import { extractMnaSymbolicMatrix, type MnaSymbolicResult } from "../simulation/mna_symbolic_inspector";

export interface MnaInspectorModalDeps {
  getNetlist: () => CircuitNetlist;
}

export class MnaInspectorModal {
  private modalEl: HTMLElement | null = null;
  private contentEl: HTMLElement | null = null;
  private btnClose: HTMLButtonElement | null = null;
  private btnCopyLatex: HTMLButtonElement | null = null;
  private triggerBtn: HTMLButtonElement | null = null;
  private latestResult: MnaSymbolicResult | null = null;

  constructor(private readonly deps: MnaInspectorModalDeps) {
    this.initDOMElements();
    this.bindEvents();
  }

  private initDOMElements(): void {
    if (typeof document === "undefined") return;
    this.modalEl = document.getElementById("mna-inspector-modal");
    this.contentEl = document.getElementById("mna-inspector-content");
    this.btnClose = document.getElementById("btn-close-mna-inspector") as HTMLButtonElement | null;
    this.btnCopyLatex = document.getElementById("btn-copy-mna-latex") as HTMLButtonElement | null;
    this.triggerBtn = document.getElementById("btn-mna-inspector") as HTMLButtonElement | null;
  }

  private bindEvents(): void {
    this.triggerBtn?.addEventListener("click", () => this.open());
    this.btnClose?.addEventListener("click", () => this.close());
    this.btnCopyLatex?.addEventListener("click", () => this.copyLatex());

    this.modalEl?.addEventListener("click", (e) => {
      if (e.target === this.modalEl) {
        this.close();
      }
    });

    if (typeof window !== "undefined") {
      window.addEventListener("keydown", (e) => {
        if (e.key === "Escape" && this.isOpen()) {
          this.close();
        }
      });
    }
  }

  public isOpen(): boolean {
    return this.modalEl?.classList.contains("open") ?? false;
  }

  public open(): void {
    if (!this.modalEl) return;
    const netlist = this.deps.getNetlist();
    const result = extractMnaSymbolicMatrix(netlist);
    this.latestResult = result;
    this.render(result);
    this.modalEl.classList.add("open");
    this.modalEl.setAttribute("aria-hidden", "false");
  }

  public close(): void {
    if (!this.modalEl) return;
    this.modalEl.classList.remove("open");
    this.modalEl.setAttribute("aria-hidden", "true");
  }

  public render(result: MnaSymbolicResult): void {
    if (!this.contentEl) return;

    if (result.size === 0) {
      this.contentEl.innerHTML = `
        <div style="padding: 24px; text-align: center; color: var(--text-muted);">
          <p>⚠️ No hay componentes activos conectados en el esquemático para formular la matriz MNA.</p>
        </div>
      `;
      return;
    }

    const { size, nodeCount, vsourceCount, unknownLabels, matrixG, vectorZ, latexNodalEquations, latexEquation } = result;

    // Encabezados de tabla
    const thCols = unknownLabels.map((u) => `<th style="padding: 6px 10px; border: 1px solid var(--border-color);">${u}</th>`).join("");

    // Filas de tabla simbólica
    const tbodyRows = matrixG
      .map((row, rIdx) => {
        const rowLabel = rIdx < nodeCount ? `Nodo ${rIdx + 1}` : `Rama ${unknownLabels[rIdx]}`;
        const cells = row
          .map((c) => `<td style="padding: 6px 10px; text-align: center; border: 1px solid var(--border-color); font-family: var(--font-mono); font-size: 0.8rem;">${c.symbolic}</td>`)
          .join("");
        const zCell = `<td style="padding: 6px 10px; text-align: center; border: 1px solid var(--border-color); font-family: var(--font-mono); font-size: 0.8rem; background: rgba(59, 130, 246, 0.1);">${vectorZ[rIdx].symbolic}</td>`;
        return `<tr><th style="padding: 6px 10px; border: 1px solid var(--border-color); text-align: left; background: var(--bg-surface);">${rowLabel}</th>${cells}${zCell}</tr>`;
      })
      .join("");

    // Ecuaciones nodales
    const eqList = latexNodalEquations
      .map((eq) => `<li style="margin-bottom: 6px; font-family: var(--font-mono); font-size: 0.82rem; color: var(--text-color);">${eq}</li>`)
      .join("");

    this.contentEl.innerHTML = `
      <div style="display: flex; gap: 12px; margin-bottom: 16px; flex-wrap: wrap;">
        <span class="hud-pill">Dimensión: ${size} × ${size}</span>
        <span class="hud-pill">Nodos activos: ${nodeCount}</span>
        <span class="hud-pill">Ecuaciones de rama: ${vsourceCount}</span>
      </div>

      <h4 style="font-size: 0.9rem; color: var(--accent-color); margin-bottom: 8px;">1. Matriz de Admitancias Estampada $\\mathbf{G} \\cdot \\mathbf{v} = \\mathbf{z}$</h4>
      <div style="overflow-x: auto; margin-bottom: 20px; border: 1px solid var(--border-color); border-radius: 6px;">
        <table style="width: 100%; border-collapse: collapse; font-size: 0.85rem;">
          <thead style="background: var(--bg-surface); color: var(--text-muted);">
            <tr>
              <th style="padding: 6px 10px; border: 1px solid var(--border-color);">Fila / Ecuación</th>
              ${thCols}
              <th style="padding: 6px 10px; border: 1px solid var(--border-color); background: rgba(59, 130, 246, 0.15);">Vector $\\mathbf{z}$</th>
            </tr>
          </thead>
          <tbody>
            ${tbodyRows}
          </tbody>
        </table>
      </div>

      <h4 style="font-size: 0.9rem; color: var(--accent-color); margin-bottom: 8px;">2. Ecuaciones Nodales Simbólicas</h4>
      <ul style="list-style: none; padding-left: 0; margin-bottom: 20px;">
        ${eqList}
      </ul>

      <h4 style="font-size: 0.9rem; color: var(--accent-color); margin-bottom: 8px;">3. Formulación Matricial en Código LaTeX</h4>
      <pre style="background: var(--bg-surface); border: 1px solid var(--border-color); padding: 12px; border-radius: 6px; font-size: 0.75rem; font-family: var(--font-mono); overflow-x: auto; color: var(--text-muted);">${latexEquation}</pre>
    `;
  }

  public async copyLatex(): Promise<void> {
    if (!this.latestResult?.latexEquation) return;
    try {
      if (typeof navigator !== "undefined" && navigator.clipboard) {
        await navigator.clipboard.writeText(this.latestResult.latexEquation);
      }
      if (this.btnCopyLatex) {
        const orig = this.btnCopyLatex.textContent;
        this.btnCopyLatex.textContent = "✅ ¡Copiado!";
        setTimeout(() => {
          if (this.btnCopyLatex) this.btnCopyLatex.textContent = orig;
        }, 2000);
      }
    } catch {
      /* ignore clipboard errors in headless */
    }
  }
}
