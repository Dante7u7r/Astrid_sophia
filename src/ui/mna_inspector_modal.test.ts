// @vitest-environment happy-dom
// ==========================================================================
// PRUEBAS UNITARIAS — MODAL INSPECTOR DE LA MATRIZ MNA
// ==========================================================================

import { describe, it, expect, beforeEach } from "vitest";
import { MnaInspectorModal } from "./mna_inspector_modal";
import type { CircuitNetlist, ExtractedComponent } from "../simulation/netlist_extractor";

describe("MnaInspectorModal", () => {
  let netlist: CircuitNetlist;

  beforeEach(() => {
    document.body.innerHTML = `
      <button id="btn-mna-inspector">Matriz MNA</button>
      <div id="mna-inspector-modal" class="modal-overlay" aria-hidden="true">
        <div class="modal-box">
          <div id="mna-inspector-content"></div>
          <button id="btn-copy-mna-latex">Copiar LaTeX</button>
          <button id="btn-close-mna-inspector">Cerrar</button>
        </div>
      </div>
    `;

    netlist = {
      components: [
        { id: "V1", type: "vsource", value: 10, pins: ["1", "0"], frequency: 0 },
        { id: "R1", type: "resistor", value: 1000, pins: ["1", "2"] },
        { id: "R2", type: "resistor", value: 2000, pins: ["2", "0"] },
      ] as ExtractedComponent[],
      wires: [],
    };
  });

  it("abre y cierra el modal alternando la clase open y aria-hidden", () => {
    const modal = new MnaInspectorModal({
      getNetlist: () => netlist,
    });

    expect(modal.isOpen()).toBe(false);

    modal.open();
    expect(modal.isOpen()).toBe(true);
    const modalEl = document.getElementById("mna-inspector-modal");
    expect(modalEl?.classList.contains("open")).toBe(true);
    expect(modalEl?.getAttribute("aria-hidden")).toBe("false");

    modal.close();
    expect(modal.isOpen()).toBe(false);
    expect(modalEl?.classList.contains("open")).toBe(false);
    expect(modalEl?.getAttribute("aria-hidden")).toBe("true");
  });

  it("renderiza correctamente las dimensiones y ecuaciones nodales", () => {
    const modal = new MnaInspectorModal({
      getNetlist: () => netlist,
    });

    modal.open();
    const contentEl = document.getElementById("mna-inspector-content");
    expect(contentEl?.innerHTML).toContain("Dimensión: 3 × 3");
    expect(contentEl?.innerHTML).toContain("G_{R1}");
    expect(contentEl?.innerHTML).toContain("Nodo 1");
    expect(contentEl?.innerHTML).toContain("Rama i_{V1}");
  });
});
